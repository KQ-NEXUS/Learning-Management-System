/**
 * WEBHOOK-ONLY Order/PaymentAttempt/Enrolment settlement — DELIBERATELY
 * unauthorized.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE "FIXING" THE MISSING AUTHORIZATION CHECK.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The permission choke point resolves the current actor by reading the
 * session cookie off the incoming request. A Stripe webhook is an
 * unauthenticated server-to-server POST with no cookie jar — there is no
 * actor to authorize. Wrapping this module's exports in that choke point
 * would fail closed: the learner pays, the enrolment never activates, and
 * nothing obviously errors.
 *
 * Decision (06-03 checkpoint, "as-system-module"): a separate, explicitly
 * unauthorized, narrowly-scoped module — the third instance of this pattern
 * in the codebase, after `hold-release-system-service.ts` (worker) and
 * `scan-system-service.ts` (upload route). The alternative — a synthetic
 * system actor holding a GLOBAL grant — means minting an identity that can
 * perform ANY permission-gated write, usable by anything that can reach the
 * database. A narrow, named, filter-less surface is the smaller blast
 * radius, and nothing new is invented: it is the same shape twice-proven.
 *
 * The controls that make it safe are structural:
 *   1. The settlement export is suffixed `AsSystem` — the label is the
 *      warning.
 *   2. It takes NO caller-supplied filter beyond ids that arrived inside a
 *      signature-verified Stripe event (`verifyStripeWebhook`, the route's
 *      job, not this module's).
 *   3. It still audits — `actorId: null, actorType: "SYSTEM"` — under
 *      action names distinct from any staff-driven action, so a webhook
 *      settlement is never mistakable for a staff override in the trail.
 *   4. `tests/boundary.test.ts` is re-run in this plan's verify gate, and a
 *      dedicated grep gate asserts this file's import closure stays free of
 *      the permission choke point, the request actor-getter, the
 *      request-side cohort-authorization plumbing, and anything under
 *      `next/`.
 *
 * Idempotency is the `WebhookEvent` model's own
 * `@@unique([provider, providerEventId])` constraint — insert BEFORE
 * processing, catch the unique-constraint violation, skip reprocessing. Do
 * NOT add a second dedupe mechanism; a second one is only a second place for
 * staleness to hide.
 */

import { prisma } from "@/server/db";
import { recordAudit } from "@/server/services/audit-service";
import { writeDomainEvent, type DomainEventTxClient } from "@/server/services/domain-event-service";
import {
  applyEnrolmentActivation,
  IllegalTransitionError,
  type EnrolmentActivationTxClient,
  type EnrolmentRow,
} from "@/server/services/enrolment-service";

export const SYSTEM_ACTOR_TYPE = "SYSTEM";

/**
 * True for a Prisma `PrismaClientKnownRequestError` with code `P2002`
 * (unique-constraint violation), duck-typed on `.code` so this file stays
 * free of a Prisma client import — copied from `seat-accounting.ts:189-196`.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// recordWebhookEventOrSkip — the idempotency guard
// ---------------------------------------------------------------------------

export type RecordWebhookEventInput = {
  provider: "STRIPE";
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export type RecordWebhookEventDeps = {
  webhookEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

export function createRecordWebhookEventOrSkip(deps: RecordWebhookEventDeps) {
  /**
   * Inserts a `WebhookEvent` row BEFORE any processing happens. A
   * unique-constraint violation on `(provider, providerEventId)` means this
   * exact event was already recorded (a redelivery, or a concurrent
   * duplicate) — the caller gets `{ isNew: false }` and does no
   * reprocessing, but still returns 200 to Stripe.
   */
  return async function recordWebhookEventOrSkip(
    input: RecordWebhookEventInput,
  ): Promise<{ isNew: boolean }> {
    try {
      await deps.webhookEvent.create({
        data: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          payload: input.payload,
          signatureValid: true, // only reached after signature verification succeeded
          status: "RECEIVED",
        },
      });
      return { isNew: true };
    } catch (err) {
      if (isUniqueConstraintViolation(err)) return { isNew: false };
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// activateOrderAsSystem — the actorless settlement transaction
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  enrolments: EnrolmentRow[];
};

/**
 * The transaction surface `activateOrderAsSystem` needs — a superset of
 * `EnrolmentActivationTxClient` (so `applyEnrolmentActivation` is callable
 * directly, no cast) plus `order.findUnique`/`update`,
 * `paymentAttempt.updateMany`, and `webhookEvent.updateMany`. Structural, so
 * this file carries no `@prisma/client` type import.
 */
export type ActivationTxClient = EnrolmentActivationTxClient & {
  order: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, unknown>;
    }): Promise<OrderRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  paymentAttempt: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  webhookEvent: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

export type ActivateOrderAsSystemInput = {
  orderId: string;
  providerIntentId: string;
  amountMinor: number;
  currency: string;
  eventId: string;
};

export type ActivateOrderAsSystemDeps = {
  db: { $transaction: <R>(fn: (tx: ActivationTxClient) => Promise<R>) => Promise<R> };
  audit: (event: {
    actorId: string | null;
    actorType?: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: string;
    reason?: string | null;
  }) => Promise<void>;
  now?: () => Date;
};

export function createActivateOrderAsSystem(deps: ActivateOrderAsSystemDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Moves a paid Order/Enrolment through their settlement transition. Three
   * outcomes:
   *   - `ACTIVATED` — the PaymentAttempt reaches SUCCEEDED, the Enrolment
   *     reaches ACTIVE via `applyEnrolmentActivation`, the Order reaches PAID.
   *   - `EXCEPTION` (illegal transition) — the seat hold had already expired
   *     or the enrolment was otherwise terminal by the time this ran
   *     (RESEARCH Pitfall 4). The money genuinely moved and that fact must
   *     not be lost: the PaymentAttempt stays/moves to SUCCEEDED, only the
   *     Order and Enrolment side is flagged EXCEPTION, and NO seat count is
   *     touched — reclaiming a seat that may now be full, or given to
   *     someone else, is worse than a flagged exception for reconciliation.
   *   - `EXCEPTION` (amount/currency mismatch, REG-03) — the webhook's
   *     `amount_total`/`currency` do not match the Order's own recorded
   *     `amountMinor`/`currency`. A mismatch is an exception to be recorded,
   *     never a value that overwrites the Order with — the PaymentAttempt is
   *     NOT moved to SUCCEEDED in this branch, since what actually settled
   *     cannot be trusted to equal what this Order expected.
   * Every branch returns normally (never throws) so the webhook route always
   * has something to acknowledge with 200 — retrying will not change any of
   * these outcomes.
   */
  return async function activateOrderAsSystem(
    input: ActivateOrderAsSystemInput,
  ): Promise<{ outcome: "ACTIVATED" | "EXCEPTION" }> {
    const at = now();

    const result = await deps.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          enrolments: true,
        },
      });

      if (!order) {
        // No matching Order for this webhook's client_reference_id. Nothing
        // to settle or roll back — the route still acknowledges with 200 so
        // Stripe does not retry a payload this app can never resolve.
        return { outcome: "EXCEPTION" as const, enrolmentId: null as string | null };
      }

      await tx.webhookEvent.updateMany({
        where: { provider: "STRIPE", providerEventId: input.eventId },
        data: { status: "PROCESSED", processedAt: at },
      });

      // REG-03 — never mark PAID or activate from a webhook whose amount or
      // currency does not match what this Order was created with.
      const mismatched =
        order.amountMinor !== input.amountMinor ||
        order.currency.toUpperCase() !== input.currency.toUpperCase();
      if (mismatched) {
        await tx.order.update({ where: { id: order.id }, data: { status: "EXCEPTION" } });
        await writeDomainEvent(tx, {
          type: "order.exception",
          payload: {
            orderId: order.id,
            providerIntentId: input.providerIntentId,
            reason: "amount_or_currency_mismatch",
          },
        });
        const enrolment = order.enrolments[0] ?? null;
        return { outcome: "EXCEPTION" as const, enrolmentId: enrolment?.id ?? null };
      }

      const enrolment = order.enrolments[0];

      try {
        if (!enrolment) throw new IllegalTransitionError("NONE", "ACTIVE", null);

        await applyEnrolmentActivation(tx, {
          enrolment,
          reason: "Stripe payment confirmed",
          actorId: null,
          now: at,
        });

        await tx.paymentAttempt.updateMany({
          where: { orderId: order.id, providerIntentId: input.providerIntentId },
          data: { status: "SUCCEEDED", confirmedAt: at },
        });

        await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: at } });

        await writeDomainEvent(tx, {
          type: "order.paid",
          payload: {
            orderId: order.id,
            providerIntentId: input.providerIntentId,
            amountMinor: input.amountMinor,
            currency: input.currency,
          },
        });

        return { outcome: "ACTIVATED" as const, enrolmentId: enrolment.id };
      } catch (err) {
        if (err instanceof IllegalTransitionError) {
          await tx.paymentAttempt.updateMany({
            where: { orderId: order.id, providerIntentId: input.providerIntentId },
            data: {
              status: "SUCCEEDED",
              confirmedAt: at,
              exceptionNote:
                "Stripe payment confirmed after the seat hold was no longer eligible to activate; money captured, needs reconciliation.",
            },
          });
          await tx.order.update({ where: { id: order.id }, data: { status: "EXCEPTION" } });
          await writeDomainEvent(tx, {
            type: "order.exception",
            payload: {
              orderId: order.id,
              providerIntentId: input.providerIntentId,
              reason: "illegal_transition",
            },
          });
          return { outcome: "EXCEPTION" as const, enrolmentId: enrolment?.id ?? null };
        }
        throw err;
      }
    });

    await deps.audit({
      actorId: null,
      actorType: SYSTEM_ACTOR_TYPE,
      action: result.outcome === "ACTIVATED" ? "order.paid" : "order.exception",
      targetType: "Order",
      targetId: input.orderId,
      outcome: "SUCCESS",
    });

    if (result.enrolmentId) {
      await deps.audit({
        actorId: null,
        actorType: SYSTEM_ACTOR_TYPE,
        action: result.outcome === "ACTIVATED" ? "enrolment.activated" : "enrolment.activation_exception",
        targetType: "Enrolment",
        targetId: result.enrolmentId,
        outcome: "SUCCESS",
      });
    }

    return { outcome: result.outcome };
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const built = {
  recordWebhookEventOrSkip: createRecordWebhookEventOrSkip({
    webhookEvent: prisma.webhookEvent as unknown as RecordWebhookEventDeps["webhookEvent"],
  }),
  activateOrderAsSystem: createActivateOrderAsSystem({
    db: {
      $transaction: (fn) =>
        (prisma as AnyPrisma).$transaction((tx: unknown) => fn(tx as ActivationTxClient)),
    },
    audit: (event) => recordAudit(event),
  }),
};

/**
 * Records a `WebhookEvent` row, or reports `{ isNew: false }` on a
 * unique-constraint violation without reprocessing (webhook-only).
 */
export function recordWebhookEventOrSkip(
  input: RecordWebhookEventInput,
): Promise<{ isNew: boolean }> {
  return built.recordWebhookEventOrSkip(input);
}

/**
 * Settles a signature-verified Stripe payment into a PAID Order and an
 * ACTIVE Enrolment, or a flagged EXCEPTION — actorless, audited as SYSTEM
 * (webhook-only).
 */
export function activateOrderAsSystem(
  input: ActivateOrderAsSystemInput,
): Promise<{ outcome: "ACTIVATED" | "EXCEPTION" }> {
  return built.activateOrderAsSystem(input);
}
