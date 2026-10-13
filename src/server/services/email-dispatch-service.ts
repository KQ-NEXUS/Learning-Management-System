/**
 * EmailDispatch — exactly-once transactional sending (D-05, D-10, COM-02).
 *
 * `dispatch` is the in-request path (registration, verification, password
 * reset, email change, and the legacy checkout webhook): it inserts the row
 * first under a stable `(template, correlationId)` key and sends immediately.
 * A unique violation on that key means "already dispatched" — the existing
 * row is loaded and returned without a second send, so a replayed request or
 * a double submit can never produce two provider sends.
 *
 * `sendQueued` is Pass 2 (the drain, wired by Plan 07): it claims due QUEUED
 * rows with `FOR UPDATE SKIP LOCKED` so two overlapping runs never claim the
 * same row, sends each with a render step, and retries transient failures on
 * a fixed backoff schedule before giving up permanently.
 *
 * `resend` (wired by Plan 12's delivery log) reuses a FAILED or SENT row
 * rather than creating a new one, and audits the actor and reason in the same
 * transaction as the requeue.
 *
 * `EmailDispatch.error` only ever stores `describeFailure(error)` — never the
 * raw error, a provider payload, or a recipient address (T-13-11).
 * `EmailDispatch.templateParams` stays `null` for every auth mail dispatched
 * through `dispatch()` — the raw token that produced `correlationId` is never
 * derivable from anything stored here (D-10).
 */

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { sendTransactionalEmail, describeBrevoFailure, classifyBrevoFailure } from "@/server/email/brevo-client";
import { renderEmail } from "@/server/email/templates/registry";
import type { TemplateParamsMap } from "@/server/email/templates/registry";
import type { TemplateId } from "@/server/communications/contracts";
import { TEMPLATE_CATEGORY, RETRY_BACKOFF_MS, MAX_SEND_ATTEMPTS, STALE_SENDING_MS } from "@/server/communications/contracts";
import { recordAuditInTransaction } from "@/server/services/audit-service";

export type EmailDispatchRow = {
  id: string;
  template: string;
  toEmail: string;
  userId: string | null;
  correlationId: string;
  status: string;
  providerMessageId: string | null;
  sentAt: Date | null;
  failedAt: Date | null;
  error: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  templateParams: Record<string, unknown> | null;
  resentCount: number;
};

/**
 * The params shape every in-request dispatch call site builds (COM-02, Plan
 * 08). `template` is `TemplateId` — a caller can no longer dispatch under an
 * id outside the shared registry, which also closes the door the legacy
 * checkout-webhook caller (`"order-confirmation"`) used before Plan 08
 * removed it. `correlationId` and `htmlContent` are REQUIRED: every dispatch
 * must carry its own stable dedup key and its own rendered HTML — there is
 * no longer a random-UUID fallback for an absent `correlationId`, so a
 * caller can never send under a key nothing else can ever look up again.
 */
export type DispatchParams = {
  template: TemplateId;
  toEmail: string;
  userId?: string | null;
  subject: string;
  textContent: string;
  htmlContent: string;
  correlationId: string;
};

/**
 * D-10 — the stable, one-way correlation key for an auth mail: `auth:`
 * followed by the SHA-256 hex of the raw token. Not reversible (the token is
 * high entropy), stable for one issuance, and new for every reissued token.
 */
export function buildAuthCorrelationId(token: string): string {
  return `auth:${createHash("sha256").update(token).digest("hex")}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Thrown by `resend` for every ineligible row — the message never
 * distinguishes "unknown id" from "auth template" from "recipient not
 * active" (T-13-08): a caller cannot use the failure shape to enumerate why. */
export class ResendNotAllowedError extends Error {
  constructor() {
    super("This email cannot be resent.");
    this.name = "ResendNotAllowedError";
  }
}

type RequeueResult =
  | { ok: true; row: EmailDispatchRow }
  | { ok: false; reason: "NOT_FOUND" | "NOT_ELIGIBLE" };

/** The narrow slice of persistence this service actually uses. A fake
 * implementing this shape is enough to unit test `dispatch`, `sendQueued` and
 * `resend`; `createPrismaEmailDispatchStore` is the real, transactional one. */
export type EmailDispatchStore = {
  emailDispatch: {
    create(args: { data: Record<string, unknown> }): Promise<EmailDispatchRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<EmailDispatchRow>;
    findUnique(args: {
      where: { template_correlationId: { template: string; correlationId: string } };
    }): Promise<EmailDispatchRow | null>;
  };
  /** D-02 — claims at most `limit` due QUEUED rows, oldest first, marking
   * them SENDING with `attempts` incremented, inside a single transaction
   * using `FOR UPDATE SKIP LOCKED` so overlapping callers never claim the
   * same row twice. */
  claimDue(params: { limit: number; now: Date }): Promise<EmailDispatchRow[]>;
  /** Moves SENDING rows whose `lastAttemptAt` is at or before `cutoff` back
   * to QUEUED with `nextAttemptAt` set to `now`. Returns the count moved. */
  recoverStale(params: { cutoff: Date; now: Date }): Promise<number>;
  /** D-06 — a single transaction: compare-and-set a FAILED or SENT row to
   * QUEUED (attempts reset, resentCount incremented, error cleared) and write
   * the `email.resent` audit entry in the same transaction. Eligibility
   * (status, auth-category, templateParams, recipient ACTIVE) is checked
   * inside the transaction so it can never race a concurrent status change. */
  requeueForResend(params: { id: string; actorId: string; reason: string; now: Date }): Promise<RequeueResult>;
};

export function createEmailDispatchService(deps: {
  store: EmailDispatchStore;
  send: (params: {
    to: string;
    subject: string;
    textContent: string;
    htmlContent?: string;
    tags?: string[];
  }) => Promise<{ providerMessageId: string | null }>;
  describeFailure: (error: unknown) => string;
  classifyFailure?: (error: unknown) => "permanent" | "transient";
  render?: <K extends TemplateId>(template: K, params: TemplateParamsMap[K]) => { subject: string; html: string; text: string };
  now?: () => Date;
}) {
  const { store, send, describeFailure } = deps;
  const classifyFailure = deps.classifyFailure ?? (() => "transient" as const);
  const now = deps.now ?? (() => new Date());

  async function dispatch(params: DispatchParams): Promise<EmailDispatchRow> {
    // COM-02 — `correlationId` is now REQUIRED on `DispatchParams` (Plan 08);
    // no caller can send under a random key nothing else can look up again.
    const correlationId = params.correlationId;

    let row: EmailDispatchRow;
    try {
      row = await store.emailDispatch.create({
        data: {
          template: params.template,
          toEmail: params.toEmail,
          userId: params.userId ?? null,
          correlationId,
          status: "SENDING",
          attempts: 1,
          lastAttemptAt: now(),
          templateParams: null,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Already dispatched under this key — a replay or double submit.
        // Load and return the existing row; never send a second time.
        const existing = await store.emailDispatch.findUnique({
          where: { template_correlationId: { template: params.template, correlationId } },
        });
        if (existing) return existing;
      }
      throw error;
    }

    try {
      const result = await send({
        to: params.toEmail,
        subject: params.subject,
        textContent: params.textContent,
        htmlContent: params.htmlContent,
        tags: [params.template],
      });
      return await store.emailDispatch.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          providerMessageId: result.providerMessageId,
          sentAt: now(),
        },
      });
    } catch (error) {
      await store.emailDispatch.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          failedAt: now(),
          error: describeFailure(error),
        },
      });
      throw error;
    }
  }

  /** D-03 — the delay before the next attempt after the Nth failed send.
   * `attemptsAfterFailure` is the row's `attempts` count at the moment of
   * that failure (1..4); indexes RETRY_BACKOFF_MS 0-based. */
  function computeNextAttemptAtInternal(instant: Date, attemptsAfterFailure: number): Date {
    const index = Math.max(0, Math.min(attemptsAfterFailure - 1, RETRY_BACKOFF_MS.length - 1));
    return new Date(instant.getTime() + RETRY_BACKOFF_MS[index]);
  }

  async function sendQueued(params: { limit: number }): Promise<{
    sent: number;
    retried: number;
    failed: { id: string; template: string; userId: string | null }[];
    recovered: number;
  }> {
    const instant = now();
    const recovered = await store.recoverStale({
      cutoff: new Date(instant.getTime() - STALE_SENDING_MS),
      now: instant,
    });
    const claimed = await store.claimDue({ limit: params.limit, now: instant });

    let sent = 0;
    let retried = 0;
    const failed: { id: string; template: string; userId: string | null }[] = [];

    // One row's failure must never stop the rest of the batch.
    for (const row of claimed) {
      try {
        if (!row.templateParams) {
          await store.emailDispatch.update({
            where: { id: row.id },
            data: { status: "FAILED", failedAt: now(), error: "Missing template parameters." },
          });
          failed.push({ id: row.id, template: row.template, userId: row.userId });
          continue;
        }

        let rendered: { subject: string; html: string; text: string };
        try {
          if (!deps.render) throw new Error("No render dependency configured.");
          rendered = deps.render(row.template as TemplateId, row.templateParams as never);
        } catch {
          await store.emailDispatch.update({
            where: { id: row.id },
            data: { status: "FAILED", failedAt: now(), error: "Failed to render email template." },
          });
          failed.push({ id: row.id, template: row.template, userId: row.userId });
          continue;
        }

        try {
          const result = await send({
            to: row.toEmail,
            subject: rendered.subject,
            textContent: rendered.text,
            htmlContent: rendered.html,
            tags: [row.template],
          });
          await store.emailDispatch.update({
            where: { id: row.id },
            data: {
              status: "SENT",
              providerMessageId: result.providerMessageId,
              sentAt: now(),
              error: null,
              nextAttemptAt: null,
            },
          });
          sent++;
        } catch (error) {
          const classification = classifyFailure(error);
          if (classification === "permanent" || row.attempts >= MAX_SEND_ATTEMPTS) {
            await store.emailDispatch.update({
              where: { id: row.id },
              data: { status: "FAILED", failedAt: now(), error: describeFailure(error) },
            });
            failed.push({ id: row.id, template: row.template, userId: row.userId });
          } else {
            const nextAttemptAt = computeNextAttemptAtInternal(now(), row.attempts);
            await store.emailDispatch.update({
              where: { id: row.id },
              data: { status: "QUEUED", nextAttemptAt, error: describeFailure(error) },
            });
            retried++;
          }
        }
      } catch {
        failed.push({ id: row.id, template: row.template, userId: row.userId });
      }
    }

    return { sent, retried, failed, recovered };
  }

  async function resend(params: { dispatchId: string; actorId: string; reason: string }): Promise<EmailDispatchRow> {
    const result = await store.requeueForResend({
      id: params.dispatchId,
      actorId: params.actorId,
      reason: params.reason,
      now: now(),
    });
    if (!result.ok) {
      throw new ResendNotAllowedError();
    }
    return result.row;
  }

  return { dispatch, sendQueued, resend };
}

/** D-03 — exported so `sendQueued`'s backoff schedule is directly testable
 * without exercising the full send/failure path. Same semantics as the
 * service's internal copy. */
export function computeNextAttemptAt(now: Date, attemptsAfterFailure: number): Date {
  const index = Math.max(0, Math.min(attemptsAfterFailure - 1, RETRY_BACKOFF_MS.length - 1));
  return new Date(now.getTime() + RETRY_BACKOFF_MS[index]);
}

export type DispatchBestEffortResult = { sent: boolean };

/**
 * `dispatch` deliberately still throws: the FAILED row plus a rethrow is the
 * contract Phase 13's exactly-once delivery work is specified against, and a
 * primitive that cannot fail cannot be retried. This wrapper is the single
 * sanctioned way to opt out of that throw. It is named, and imported by name
 * at every call site, so the opt-out is visible where the decision is made
 * rather than hidden inside the primitive. It resolves in both arms — on a
 * rejecting `dispatchFn` it reports `{ sent: false }` rather than rejecting
 * itself, and on a resolving one it reports `{ sent: true }`. It does not log
 * — `dispatch` has already written the FAILED row with a describe-failure
 * string, and the raw error here could carry the recipient address.
 */
export async function dispatchBestEffort(
  dispatchFn: (params: DispatchParams) => Promise<unknown>,
  params: DispatchParams,
): Promise<DispatchBestEffortResult> {
  try {
    await dispatchFn(params);
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

/**
 * The real, transactional store binding `emailDispatchService` uses in
 * production, and what the real-Postgres integration test exercises. Every
 * concurrency and atomicity guarantee this module makes is proven against
 * this implementation, never against a JS fake.
 */
export function createPrismaEmailDispatchStore(client: PrismaClient): EmailDispatchStore {
  return {
    emailDispatch: {
      create: (args) =>
        client.emailDispatch.create(args as Prisma.EmailDispatchCreateArgs) as unknown as Promise<EmailDispatchRow>,
      update: (args) =>
        client.emailDispatch.update(args as Prisma.EmailDispatchUpdateArgs) as unknown as Promise<EmailDispatchRow>,
      findUnique: (args) =>
        client.emailDispatch.findUnique(
          args as Prisma.EmailDispatchFindUniqueArgs,
        ) as unknown as Promise<EmailDispatchRow | null>,
    },

    async claimDue({ limit, now }) {
      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "EmailDispatch"
          WHERE "status" = 'QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          ORDER BY "createdAt" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}`;

        const claimed: EmailDispatchRow[] = [];
        for (const row of rows) {
          const updated = await tx.emailDispatch.update({
            where: { id: row.id },
            data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: now },
          });
          claimed.push(updated as unknown as EmailDispatchRow);
        }
        return claimed;
      });
    },

    async recoverStale({ cutoff, now }) {
      const result = await client.emailDispatch.updateMany({
        where: { status: "SENDING", lastAttemptAt: { lte: cutoff } },
        data: { status: "QUEUED", nextAttemptAt: now },
      });
      return result.count;
    },

    async requeueForResend({ id, actorId, reason, now }): Promise<RequeueResult> {
      return client.$transaction(async (tx) => {
        const row = await tx.emailDispatch.findUnique({ where: { id } });
        if (!row) return { ok: false, reason: "NOT_FOUND" };
        if (row.status !== "FAILED" && row.status !== "SENT") return { ok: false, reason: "NOT_ELIGIBLE" };
        if (row.templateParams === null || row.templateParams === undefined) return { ok: false, reason: "NOT_ELIGIBLE" };
        if (TEMPLATE_CATEGORY[row.template as TemplateId] === "AUTH") return { ok: false, reason: "NOT_ELIGIBLE" };
        if (!row.userId) return { ok: false, reason: "NOT_ELIGIBLE" };

        const recipient = await tx.user.findUnique({ where: { id: row.userId } });
        if (!recipient || recipient.status !== "ACTIVE") return { ok: false, reason: "NOT_ELIGIBLE" };

        // Compare-and-set on (id, status) — a concurrent resend or a fresh
        // send attempt changing the row's status loses the race cleanly.
        const changed = await tx.emailDispatch.updateMany({
          where: { id, status: row.status },
          data: {
            status: "QUEUED",
            attempts: 0,
            resentCount: { increment: 1 },
            error: null,
            failedAt: null,
            nextAttemptAt: null,
          },
        });
        if (changed.count !== 1) return { ok: false, reason: "NOT_ELIGIBLE" };

        await recordAuditInTransaction(tx, {
          actorId,
          action: "email.resent",
          targetType: "EmailDispatch",
          targetId: id,
          reason,
          outcome: "SUCCESS",
        });

        const updated = await tx.emailDispatch.findUnique({ where: { id } });
        if (!updated) return { ok: false, reason: "NOT_FOUND" };
        return { ok: true, row: updated as unknown as EmailDispatchRow };
      });
    },
  };
}

export const emailDispatchService = createEmailDispatchService({
  store: createPrismaEmailDispatchStore(prisma),
  send: sendTransactionalEmail,
  describeFailure: describeBrevoFailure,
  classifyFailure: classifyBrevoFailure,
  render: renderEmail,
});
