/**
 * The outbox drain: turns unprocessed `DomainEvent` rows into deduplicated
 * `EmailDispatch` and `Notification` rows exactly once, then sends the queued
 * mail (D-01, D-02, COM-01, COM-02).
 *
 * Two passes, never mixed:
 *
 * Pass 1 (`processEvents`) claims ONE unprocessed event at a time inside that
 * event's own transaction with `FOR UPDATE SKIP LOCKED` (D-02) — never a
 * whole batch in one long transaction, so one poison event can never roll
 * back a batch and overlapping runs can never double-process a row. Every
 * mapper for the event's type runs, its intents are gated by recipient state
 * and mute preferences (`decideEmailDisposition`), written with
 * `createMany({ skipDuplicates: true })` so a duplicate row from a replay
 * never aborts the transaction (Pitfall 1), and `processedAt` is set in the
 * SAME transaction. A mapper failure rolls back only that event; the drain
 * records the failure in a small separate transaction (attempts++, a safe
 * error summary) and, on the third failure, marks it processed-with-error
 * and writes one SYSTEM audit entry (D-04) — never inside the same rolled-
 * back transaction, since that transaction no longer exists to write into.
 *
 * Pass 2 (`sendQueued`, injected — `email-dispatch-service.ts`) runs strictly
 * AFTER every Pass 1 transaction for this run has committed: sending never
 * happens inside the event transaction (D-02), so a Brevo failure can never
 * roll back the row that queued it.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import type { DomainEventType } from "@/server/services/domain-event-service";
import { emailDispatchService } from "@/server/services/email-dispatch-service";
import { emailFailureAlertService } from "@/server/services/email-failure-alert-service";
import { recordAudit } from "@/server/services/audit-service";
import type { EventIntent, EventMapper } from "@/server/services/event-intent-mappers";
import { MalformedEventError, buildMapperTable, EVENT_MAPPER_GROUPS } from "@/server/services/event-intent-mappers";
import {
  EMAIL_STATUS,
  MAX_EVENT_ATTEMPTS,
  MUTABLE_EMAIL_CATEGORIES,
  TEMPLATE_CATEGORY,
  type EmailCategory,
  type MutableEmailCategory,
  type SkipReason,
} from "@/server/communications/contracts";

const EVENT_TX_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a database)
// ---------------------------------------------------------------------------

export type EmailDisposition =
  | { status: "QUEUED" }
  | { status: "SKIPPED"; reason: SkipReason };

/**
 * The single place recipient-state and mute-preference gating is decided
 * (D-11, D-16, D-19). Evaluated in order — the first matching rule wins:
 *
 * 1. The mapper's own skip reason (D-04/D-12 superseding/coalescing) always
 *    wins, regardless of recipient state.
 * 2. A DEACTIVATED recipient is always skipped, regardless of category.
 * 3. An unverified address is skipped for every non-AUTH category — an AUTH
 *    mail (verification itself) must still be able to reach an unverified
 *    address.
 * 4. A muted MUTABLE category (`TICKET_UPDATES`, `RESULT_NOTICES`,
 *    `SESSION_CHANGES`, `ENROLMENT_STATUS`) is skipped. `ALWAYS`, `AUTH` and
 *    `STAFF` are never mutable, so a caller's `mutedCategories` set can never
 *    affect them even if it (incorrectly) contained one of those names.
 * 5. Otherwise, QUEUED.
 */
export function decideEmailDisposition(input: {
  userStatus: string;
  emailVerified: Date | null;
  category: EmailCategory;
  mutedCategories: ReadonlySet<string>;
  mapperSkip?: SkipReason;
}): EmailDisposition {
  if (input.mapperSkip) {
    return { status: "SKIPPED", reason: input.mapperSkip };
  }
  if (input.userStatus === "DEACTIVATED") {
    return { status: "SKIPPED", reason: "recipient_deactivated" };
  }
  if (!input.emailVerified && input.category !== "AUTH") {
    return { status: "SKIPPED", reason: "email_unverified" };
  }
  if (
    (MUTABLE_EMAIL_CATEGORIES as readonly string[]).includes(input.category) &&
    input.mutedCategories.has(input.category)
  ) {
    return { status: "SKIPPED", reason: "muted_by_recipient" };
  }
  return { status: "QUEUED" };
}

/**
 * The ONLY thing ever written to `DomainEvent.lastError` (D-04, T-13-32): the
 * thrown value's name, plus its `code` when it has one — never its message,
 * which could carry a recipient address, a template param, or any other
 * detail a mapper's failure happened to be holding.
 */
export function safeErrorSummary(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (typeof code === "string" || typeof code === "number") {
    return `${name}:${code}`;
  }
  return name;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type EmailFailure = { id: string; template: string; userId: string | null };

export type SendQueuedFn = (params: { limit: number }) => Promise<{
  sent: number;
  retried: number;
  failed: EmailFailure[];
  recovered: number;
}>;

export type DrainAuditEvent = {
  actorId: string | null;
  actorType?: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: string;
  reason?: string | null;
  after?: unknown;
};

export type CreateDomainEventDrainServiceDeps = {
  db: PrismaClient;
  mapperTable: Record<DomainEventType, EventMapper[]>;
  sendQueued: SendQueuedFn;
  /** Best-effort hook for a future plan's "alert Administrators when an
   * email reaches FAILED" (D-08) — not implemented in this plan beyond the
   * call site; a failure here must never affect drain counts. */
  onEmailFailed?: (failure: EmailFailure) => Promise<void>;
  audit?: (event: DrainAuditEvent) => Promise<void>;
  now?: () => Date;
};

export type DrainResult = {
  processed: number;
  skipped: number;
  poisoned: number;
  sent: number;
  retried: number;
  failed: number;
};

type ClaimOutcome =
  | { outcome: "none" }
  | { outcome: "committed"; eventId: string; skippedCount: number }
  | { outcome: "poisoned"; eventId: string }
  | { outcome: "failed"; eventId: string };

export function createDomainEventDrainService(deps: CreateDomainEventDrainServiceDeps) {
  const { db, mapperTable, sendQueued, audit, onEmailFailed } = deps;
  const now = deps.now ?? (() => new Date());

  async function selectClaimId(
    tx: Prisma.TransactionClient,
    excludedIds: string[],
  ): Promise<string | null> {
    const whereClause =
      excludedIds.length > 0
        ? Prisma.sql`"processedAt" IS NULL AND "id" NOT IN (${Prisma.join(excludedIds)})`
        : Prisma.sql`"processedAt" IS NULL`;
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "DomainEvent"
      WHERE ${whereClause}
      ORDER BY "occurredAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1`);
    return rows[0]?.id ?? null;
  }

  /** Records a failed mapping attempt in its OWN small transaction — the
   * event's own transaction already rolled back, so this is never nested
   * inside it. Returns whether this failure was the one that exhausted
   * `MAX_EVENT_ATTEMPTS`, plus the event's type for the audit entry. */
  async function recordEventFailure(
    eventId: string,
    cause: unknown,
  ): Promise<{ poisoned: boolean; type?: string; attempts?: number }> {
    try {
      return await db.$transaction(async (tx) => {
        const event = await tx.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
        const attempts = event.attempts + 1;
        const lastError = safeErrorSummary(cause);
        if (attempts >= MAX_EVENT_ATTEMPTS) {
          await tx.domainEvent.update({
            where: { id: eventId },
            data: { attempts, lastError, processedAt: now() },
          });
          return { poisoned: true, type: event.type, attempts };
        }
        await tx.domainEvent.update({ where: { id: eventId }, data: { attempts, lastError } });
        return { poisoned: false };
      });
    } catch (recordErr) {
      // Never let a failure to RECORD a failure stop the run, and never log
      // anything from the original cause here — only that recording failed.
      console.error(`[domain-event-drain] failed to record a failed attempt for event ${eventId}`, recordErr);
      return { poisoned: false };
    }
  }

  async function auditPoisoned(eventId: string, type: string, attempts: number): Promise<void> {
    if (!audit) return;
    try {
      await audit({
        actorId: null,
        actorType: "SYSTEM",
        action: "domain_event.poisoned",
        targetType: "DomainEvent",
        targetId: eventId,
        outcome: "FAILED",
        reason: "Event exceeded the maximum mapping attempts.",
        after: { type, attempts },
      });
    } catch (auditErr) {
      console.error(`[domain-event-drain] failed to audit poisoned event ${eventId}`, auditErr);
    }
  }

  async function claimAndProcessOne(excludedIds: string[]): Promise<ClaimOutcome> {
    let capturedEventId: string | null = null;

    try {
      return await db.$transaction(
        async (tx) => {
          const eventId = await selectClaimId(tx, excludedIds);
          if (!eventId) return { outcome: "none" as const };
          capturedEventId = eventId;

          const event = await tx.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
          const type = event.type as DomainEventType;
          const mappers = mapperTable[type];
          if (mappers === undefined) {
            throw new MalformedEventError(`Unknown domain event type: ${event.type}`);
          }

          const drainEvent = {
            id: event.id,
            type,
            payload: event.payload as Record<string, unknown>,
            occurredAt: event.occurredAt,
          };

          const intents: EventIntent[] = [];
          for (const mapper of mappers) {
            const mapped = await mapper(drainEvent, { tx, now });
            intents.push(...mapped);
          }

          let skippedCount = 0;

          if (intents.length > 0) {
            const recipientIds = [...new Set(intents.map((intent) => intent.recipientUserId))];

            const users = await tx.user.findMany({ where: { id: { in: recipientIds } } });
            const userById = new Map(users.map((user) => [user.id, user]));

            const mutedRows = await tx.emailPreference.findMany({
              where: { userId: { in: recipientIds }, muted: true },
            });
            const mutedByUser = new Map<string, Set<string>>();
            for (const row of mutedRows) {
              const set = mutedByUser.get(row.userId) ?? new Set<string>();
              set.add(row.category);
              mutedByUser.set(row.userId, set);
            }

            const emailRows: Prisma.EmailDispatchCreateManyInput[] = [];
            const notificationRows: Prisma.NotificationCreateManyInput[] = [];

            for (const intent of intents) {
              const user = userById.get(intent.recipientUserId);
              if (!user) continue; // A5.5.5 / D-11 — missing user yields no rows.

              if (intent.email) {
                const category = TEMPLATE_CATEGORY[intent.email.template];
                const mutedForUser = mutedByUser.get(user.id) ?? new Set<string>();
                const relevantMuted = new Set(
                  (MUTABLE_EMAIL_CATEGORIES as readonly MutableEmailCategory[]).filter((mutable) =>
                    mutedForUser.has(mutable),
                  ),
                );
                const disposition = decideEmailDisposition({
                  userStatus: user.status,
                  emailVerified: user.emailVerified,
                  category,
                  mutedCategories: relevantMuted,
                  mapperSkip: intent.skipReason,
                });

                if (disposition.status === "QUEUED") {
                  emailRows.push({
                    template: intent.email.template,
                    toEmail: user.email,
                    userId: user.id,
                    correlationId: intent.email.correlationId,
                    status: EMAIL_STATUS.QUEUED,
                    templateParams: intent.email.params as Prisma.InputJsonValue,
                  });
                } else {
                  skippedCount += 1;
                  emailRows.push({
                    template: intent.email.template,
                    toEmail: user.email,
                    userId: user.id,
                    correlationId: intent.email.correlationId,
                    status: EMAIL_STATUS.SKIPPED,
                    skipReason: disposition.reason,
                    templateParams: Prisma.JsonNull,
                  });
                }
              }

              if (intent.notification && user.status === "ACTIVE" && !intent.skipReason) {
                notificationRows.push({
                  recipientId: user.id,
                  type: intent.notification.type,
                  targetType: intent.notification.targetType,
                  targetId: intent.notification.targetId,
                  params: intent.notification.params as Prisma.InputJsonValue,
                  sourceEventId: event.id,
                  // When it happened, not when the drain got to it: after a
                  // delayed or backlog drain every item otherwise reads
                  // "just now" (audit U-14).
                  createdAt: event.occurredAt,
                });
              }
            }

            // `skipDuplicates` (Pitfall 1): a duplicate under either unique
            // constraint is silently dropped rather than aborting the whole
            // transaction, so a replay or an overlapping run can never
            // produce a second row (D-05, COM-02).
            if (emailRows.length > 0) {
              await tx.emailDispatch.createMany({ data: emailRows, skipDuplicates: true });
            }
            if (notificationRows.length > 0) {
              await tx.notification.createMany({ data: notificationRows, skipDuplicates: true });
            }
          }

          await tx.domainEvent.update({ where: { id: event.id }, data: { processedAt: now() } });
          return { outcome: "committed" as const, eventId: event.id, skippedCount };
        },
        { timeout: EVENT_TX_TIMEOUT_MS, maxWait: EVENT_TX_TIMEOUT_MS },
      );
    } catch (err) {
      if (!capturedEventId) throw err; // The claim query itself never ran/failed unexpectedly.
      const failure = await recordEventFailure(capturedEventId, err);
      if (failure.poisoned) {
        await auditPoisoned(capturedEventId, failure.type ?? "unknown", failure.attempts ?? MAX_EVENT_ATTEMPTS);
        return { outcome: "poisoned", eventId: capturedEventId };
      }
      return { outcome: "failed", eventId: capturedEventId };
    }
  }

  /**
   * Claims and processes up to `limit` events, one per own transaction.
   * Stops as soon as a claim finds no unprocessed row — never spins the full
   * `limit` iterations against an empty queue. A poisoned or per-run-failed
   * event is excluded from further claims for the REST of this call only
   * (D-04) — the next scheduled invocation reclaims it normally.
   */
  async function processEvents(limit: number): Promise<{ processed: number; skipped: number; poisoned: number }> {
    let processed = 0;
    let skipped = 0;
    let poisoned = 0;
    const excludedIds: string[] = [];

    for (let i = 0; i < limit; i++) {
      const result = await claimAndProcessOne(excludedIds);
      if (result.outcome === "none") break;
      if (result.outcome === "committed") {
        processed += 1;
        skipped += result.skippedCount;
      } else if (result.outcome === "poisoned") {
        processed += 1;
        poisoned += 1;
        excludedIds.push(result.eventId);
      } else {
        excludedIds.push(result.eventId);
      }
    }

    return { processed, skipped, poisoned };
  }

  /** Pass 1 then Pass 2 — sending only ever starts after every Pass 1
   * transaction for this call has already committed (D-02). */
  async function drain(params: { events: number; sends: number }): Promise<DrainResult> {
    const { processed, skipped, poisoned } = await processEvents(params.events);
    const sendResult = await sendQueued({ limit: params.sends });

    if (onEmailFailed) {
      for (const failure of sendResult.failed) {
        try {
          await onEmailFailed(failure);
        } catch (hookErr) {
          console.error("[domain-event-drain] onEmailFailed hook threw", hookErr);
        }
      }
    }

    return {
      processed,
      skipped,
      poisoned,
      sent: sendResult.sent,
      retried: sendResult.retried,
      failed: sendResult.failed.length,
    };
  }

  return { processEvents, drain };
}

export const domainEventDrainService = createDomainEventDrainService({
  db: prisma,
  mapperTable: buildMapperTable(EVENT_MAPPER_GROUPS),
  sendQueued: (params) => emailDispatchService.sendQueued(params),
  // D-08 — every Pass-2 FAILED dispatch raises the administrator alert
  // (Plan 11 Task 3). `claimAndProcessOne`'s own try/catch around this call
  // means a failure inside the alert service can never affect drain counts.
  onEmailFailed: (failure) => emailFailureAlertService.notifyFailed(failure),
  audit: (event) => recordAudit(event),
});
