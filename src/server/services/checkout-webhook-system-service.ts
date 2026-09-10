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
 *   1. Every settlement export is suffixed `AsSystem` — the label is the
 *      warning.
 *   2. Each takes NO caller-supplied filter beyond ids that arrived inside a
 *      signature-verified Stripe event (`verifyStripeWebhook`, the route's
 *      job, not this module's).
 *   3. Every write still audits — `actorId: null, actorType: "SYSTEM"` —
 *      under action names distinct from any staff-driven action, so a
 *      webhook settlement is never mistakable for a staff override in the
 *      trail.
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
 *
 * The PAYMENT-STATE transition guard (below, `PAYMENT_VALID_TRANSITIONS`)
 * is the payment-side twin of `enrolment-service.ts`'s `VALID_TRANSITIONS` —
 * same shape, same reason: every terminal `PaymentStatus` has an empty
 * allow-list, so a late or out-of-order webhook event can never walk a
 * settled payment backwards. `Order`'s own status is never separately
 * gated by a transition table of its own: every write this module makes to
 * `Order.status` happens directly inside one of the three exported
 * functions below, each already gated by the PaymentAttempt guard or the
 * enrolment-activation guard (`applyEnrolmentActivation`'s own
 * `assertTransition`) before it ever reaches the `Order.update` call — a
 * second, parallel `OrderStatus` table would duplicate a check this module
 * already performs at its one and only write site per function.
 */

import { prisma } from "@/server/db";
import { recordAudit } from "@/server/services/audit-service";
import { writeDomainEvent } from "@/server/services/domain-event-service";
// Imported from enrolment-transitions.ts, NOT enrolment-service.ts — that
// file's own import graph pulls in the permission choke point and
// cohort-scope.ts for its OTHER (staff-authorized) exports, which would
// otherwise land on THIS module's runtime import closure merely by static
// import resolution, even though nothing here ever calls them. See
// enrolment-transitions.ts's own header for the full reasoning.
import {
  applyEnrolmentActivation,
  IllegalTransitionError,
  type EnrolmentActivationTxClient,
  type EnrolmentRow,
} from "@/server/services/enrolment-transitions";

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
// The payment-state transition table — the twin of enrolment-service.ts's
// VALID_TRANSITIONS/assertTransition pair, applied to PaymentAttempt.status.
// ---------------------------------------------------------------------------

export type PaymentStatusValue =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "PENDING_MANUAL_REVIEW";

/**
 * The only legal `PaymentAttempt.status` moves. Every terminal status
 * (`SUCCEEDED`, `FAILED`, `CANCELLED`) has an empty allow-list — that empty
 * list is what stops a late or out-of-order webhook event from walking a
 * settled payment backwards. `PENDING_MANUAL_REVIEW` is Phase 7 scope; it is
 * declared here (rather than omitted) only so this table stays exhaustive
 * over the schema's full `PaymentStatus` enum, and is not reachable from any
 * transition this phase performs.
 */
export const PAYMENT_VALID_TRANSITIONS: Record<PaymentStatusValue, PaymentStatusValue[]> = {
  PENDING: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  PENDING_MANUAL_REVIEW: [],
};

/** A `PaymentAttempt.status` move that is not in `PAYMENT_VALID_TRANSITIONS`. */
export class IllegalPaymentTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  readonly paymentAttemptId: string | null;

  constructor(from: string, to: string, paymentAttemptId: string | null = null) {
    super(`A PaymentAttempt cannot move from ${from} to ${to}.`);
    this.name = "IllegalPaymentTransitionError";
    this.from = from;
    this.to = to;
    this.paymentAttemptId = paymentAttemptId;
  }
}

/**
 * Throws `IllegalPaymentTransitionError` when `to` is not an allowed next
 * status for `from`. Every write path below calls this before touching a
 * `PaymentAttempt` row's status.
 */
export function assertPaymentTransition(
  from: PaymentStatusValue,
  to: PaymentStatusValue,
  paymentAttemptId: string | null = null,
): void {
  const allowed = PAYMENT_VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalPaymentTransitionError(from, to, paymentAttemptId);
  }
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
  webhookEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

export function createRecordWebhookEventOrSkip(deps: RecordWebhookEventDeps) {
  /**
   * Inserts a `WebhookEvent` row BEFORE any processing happens. A
   * unique-constraint violation on `(provider, providerEventId)` means this
   * exact event was already recorded (a redelivery, or a concurrent
   * duplicate) — the caller gets `{ isNew: false }` and does no
   * reprocessing, but still returns 200 to Stripe.
   *
   * The duplicate path is observable, not merely silent: it updates the
   * EXISTING row (never a second one) to `DUPLICATE`, but only while that
   * row is still `RECEIVED` — a row already flipped to `PROCESSED` by a
   * genuine first processing run is left exactly as it is, so a redelivery
   * arriving after successful settlement does not erase the record that
   * settlement happened.
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
      if (isUniqueConstraintViolation(err)) {
        await deps.webhookEvent.updateMany({
          where: {
            provider: input.provider,
            providerEventId: input.providerEventId,
            status: "RECEIVED",
          },
          data: { status: "DUPLICATE" },
        });
        return { isNew: false };
      }
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Shared transaction surface for the three settlement entry points
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  enrolments: EnrolmentRow[];
};

type PaymentAttemptRow = { id: string; status: string };

/**
 * The transaction surface every settlement entry point below needs — a
 * superset of `EnrolmentActivationTxClient` (so `applyEnrolmentActivation`
 * is callable directly, no cast) plus `order.findUnique`/`update`,
 * `paymentAttempt.findFirst`/`update`, and `webhookEvent.updateMany`.
 * Structural, so this file carries no `@prisma/client` type import.
 */
export type SettlementTxClient = EnrolmentActivationTxClient & {
  order: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, unknown>;
    }): Promise<OrderRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  paymentAttempt: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<PaymentAttemptRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  webhookEvent: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

/** @deprecated kept as an alias — `activateOrderAsSystem`'s original exported type name. */
export type ActivationTxClient = SettlementTxClient;

export type SettlementDeps = {
  db: { $transaction: <R>(fn: (tx: SettlementTxClient) => Promise<R>) => Promise<R> };
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

/** @deprecated kept as an alias — `activateOrderAsSystem`'s original exported deps type name. */
export type ActivateOrderAsSystemDeps = SettlementDeps;

async function markWebhookEventException(
  tx: SettlementTxClient,
  args: { eventId: string; at: Date; error: string },
): Promise<void> {
  await tx.webhookEvent.updateMany({
    where: { provider: "STRIPE", providerEventId: args.eventId },
    data: { status: "EXCEPTION", processedAt: args.at, error: args.error },
  });
}

async function markWebhookEventProcessed(
  tx: SettlementTxClient,
  args: { eventId: string; at: Date },
): Promise<void> {
  await tx.webhookEvent.updateMany({
    where: { provider: "STRIPE", providerEventId: args.eventId },
    data: { status: "PROCESSED", processedAt: args.at },
  });
}

// ---------------------------------------------------------------------------
// activateOrderAsSystem — the actorless settlement transaction
// ---------------------------------------------------------------------------

export type ActivateOrderAsSystemInput = {
  orderId: string;
  providerIntentId: string;
  amountMinor: number;
  currency: string;
  eventId: string;
};

export function createActivateOrderAsSystem(deps: SettlementDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Moves a paid Order/Enrolment through their settlement transition. Four
   * outcomes:
   *   - `ACTIVATED` — the PaymentAttempt reaches SUCCEEDED, the Enrolment
   *     reaches ACTIVE via `applyEnrolmentActivation`, the Order reaches PAID.
   *   - `EXCEPTION` (illegal enrolment transition) — the seat hold had
   *     already expired or the enrolment was otherwise terminal by the time
   *     this ran (RESEARCH Pitfall 4). The money genuinely moved and that
   *     fact must not be lost: the PaymentAttempt stays/moves to SUCCEEDED,
   *     only the Order and Enrolment side is flagged EXCEPTION, and NO seat
   *     count is touched — reclaiming a seat that may now be full, or given
   *     to someone else, is worse than a flagged exception for
   *     reconciliation.
   *   - `EXCEPTION` (amount/currency mismatch, REG-03) — the webhook's
   *     `amount_total`/`currency` do not match the Order's own recorded
   *     `amountMinor`/`currency`. A mismatch is an exception to be recorded,
   *     never a value that overwrites the Order with — the PaymentAttempt is
   *     NOT moved to SUCCEEDED in this branch, since what actually settled
   *     cannot be trusted to equal what this Order expected.
   *   - `EXCEPTION` (illegal payment transition) — the matching
   *     PaymentAttempt is already terminal (most likely already SUCCEEDED —
   *     an echo of an event this module already settled under a different
   *     event id) and cannot legally move to SUCCEEDED again. The attempt is
   *     left exactly as it is; only a note and an outbox row record that the
   *     echo arrived.
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
        // to settle or roll back — record the fact on the WebhookEvent row
        // itself (there is no Order to flag instead) and let the route
        // acknowledge with 200 so Stripe does not retry a payload this app
        // can never resolve.
        await markWebhookEventException(tx, {
          eventId: input.eventId,
          at,
          error: `No Order found for id ${input.orderId}.`,
        });
        return { outcome: "EXCEPTION" as const, enrolmentId: null as string | null };
      }

      await markWebhookEventProcessed(tx, { eventId: input.eventId, at });

      // REG-03 — never mark PAID or activate from a webhook whose amount or
      // currency does not match what this Order was created with.
      const mismatched =
        order.amountMinor !== input.amountMinor ||
        order.currency.toUpperCase() !== input.currency.toUpperCase();
      if (mismatched) {
        await tx.order.update({ where: { id: order.id }, data: { status: "EXCEPTION" } });
        // The mismatch is written to PaymentAttempt.exceptionNote — status is
        // deliberately NOT moved to SUCCEEDED (what settled cannot be
        // trusted to equal what this Order expected), but the note itself
        // still records what Stripe reported, naming both figures, for
        // reconciliation.
        const mismatchedAttempt = await tx.paymentAttempt.findFirst({
          where: { orderId: order.id, providerIntentId: input.providerIntentId },
          select: { id: true, status: true },
        });
        if (mismatchedAttempt) {
          await tx.paymentAttempt.update({
            where: { id: mismatchedAttempt.id },
            data: {
              exceptionNote: `Stripe reported ${input.amountMinor} ${input.currency.toUpperCase()}, but this Order was created for ${order.amountMinor} ${order.currency.toUpperCase()}.`,
            },
          });
        }
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

      const attempt = await tx.paymentAttempt.findFirst({
        where: { orderId: order.id, providerIntentId: input.providerIntentId },
        select: { id: true, status: true },
      });

      if (!attempt) {
        // Nothing to correlate this settlement to — flag for reconciliation
        // rather than guessing which PaymentAttempt Stripe means.
        await tx.order.update({ where: { id: order.id }, data: { status: "EXCEPTION" } });
        await writeDomainEvent(tx, {
          type: "order.exception",
          payload: {
            orderId: order.id,
            providerIntentId: input.providerIntentId,
            reason: "payment_attempt_not_found",
          },
        });
        return { outcome: "EXCEPTION" as const, enrolmentId: enrolment?.id ?? null };
      }

      // Narrowed evidence — ids, amount, currency, status. Never the whole
      // raw Stripe object (PAY-14).
      const evidence = {
        providerIntentId: input.providerIntentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: "paid",
      };

      try {
        assertPaymentTransition(attempt.status as PaymentStatusValue, "SUCCEEDED", attempt.id);
      } catch (err) {
        if (err instanceof IllegalPaymentTransitionError) {
          // The attempt is already terminal (most likely SUCCEEDED) — this
          // is an echo, not a new settlement. Leave the attempt's status
          // exactly as it is; only record that the echo arrived.
          await writeDomainEvent(tx, {
            type: "order.exception",
            payload: {
              orderId: order.id,
              providerIntentId: input.providerIntentId,
              reason: "illegal_payment_transition",
              from: attempt.status,
            },
          });
          return { outcome: "EXCEPTION" as const, enrolmentId: enrolment?.id ?? null };
        }
        throw err;
      }

      try {
        if (!enrolment) throw new IllegalTransitionError("NONE", "ACTIVE", null);

        await applyEnrolmentActivation(tx, {
          enrolment,
          reason: "Stripe payment confirmed",
          actorId: null,
          now: at,
        });

        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: "SUCCEEDED", confirmedAt: at, evidence },
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
          await tx.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: "SUCCEEDED",
              confirmedAt: at,
              evidence,
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
// recordPaymentFailureAsSystem — PAY-02's FAILED transition
// ---------------------------------------------------------------------------

export type RecordPaymentFailureInput = {
  orderId: string;
  eventId: string;
  /**
   * The Checkout Session id, when available. `payment_intent.payment_failed`
   * events carry no Checkout Session id — the underlying PaymentIntent id is
   * not what `PaymentAttempt.providerIntentId` stores — so this is optional;
   * when absent, the most recently initiated PaymentAttempt for the Order is
   * the target (D-04's inline-retry model keeps at most one PaymentAttempt
   * actively PROCESSING per Order at a time).
   */
  providerIntentId?: string;
  failureReason: string;
};

export function createRecordPaymentFailureAsSystem(deps: SettlementDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Moves the target PaymentAttempt to FAILED with `failedAt`/`failureReason`
   * (PAY-02). Never touches the Enrolment or the seat count — the hold is
   * the hold-expiry worker's business, and Stripe Checkout's own hosted page
   * already offers the inline retry (D-04) without this app creating a new
   * PaymentAttempt per decline.
   */
  return async function recordPaymentFailureAsSystem(
    input: RecordPaymentFailureInput,
  ): Promise<{ outcome: "FAILED" | "EXCEPTION" }> {
    const at = now();

    const result = await deps.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, status: true, amountMinor: true, currency: true, enrolments: true },
      });
      if (!order) {
        await markWebhookEventException(tx, {
          eventId: input.eventId,
          at,
          error: `No Order found for id ${input.orderId}.`,
        });
        return { outcome: "EXCEPTION" as const };
      }

      await markWebhookEventProcessed(tx, { eventId: input.eventId, at });

      const attempt = input.providerIntentId
        ? await tx.paymentAttempt.findFirst({
            where: { orderId: order.id, providerIntentId: input.providerIntentId },
            select: { id: true, status: true },
          })
        : await tx.paymentAttempt.findFirst({
            where: { orderId: order.id },
            orderBy: { initiatedAt: "desc" },
            select: { id: true, status: true },
          });

      if (!attempt) {
        await writeDomainEvent(tx, {
          type: "order.exception",
          payload: { orderId: order.id, reason: "payment_attempt_not_found" },
        });
        return { outcome: "EXCEPTION" as const };
      }

      try {
        assertPaymentTransition(attempt.status as PaymentStatusValue, "FAILED", attempt.id);
      } catch (err) {
        if (err instanceof IllegalPaymentTransitionError) {
          // Never move an already-terminal attempt (most likely SUCCEEDED)
          // to FAILED — the attempt is left exactly as it is.
          await writeDomainEvent(tx, {
            type: "order.exception",
            payload: {
              orderId: order.id,
              reason: "illegal_payment_transition",
              from: attempt.status,
              to: "FAILED",
            },
          });
          return { outcome: "EXCEPTION" as const };
        }
        throw err;
      }

      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          failedAt: at,
          failureReason: input.failureReason,
          // Narrowed evidence — never the whole raw Stripe object (PAY-14).
          evidence: { providerIntentId: input.providerIntentId ?? null, status: "failed" },
        },
      });

      return { outcome: "FAILED" as const };
    });

    await deps.audit({
      actorId: null,
      actorType: SYSTEM_ACTOR_TYPE,
      action: result.outcome === "FAILED" ? "payment.failed" : "order.exception",
      targetType: "Order",
      targetId: input.orderId,
      outcome: "SUCCESS",
    });

    return { outcome: result.outcome };
  };
}

// ---------------------------------------------------------------------------
// recordSessionExpiredAsSystem — PAY-02's CANCELLED transition
// ---------------------------------------------------------------------------

export type RecordSessionExpiredInput = {
  orderId: string;
  eventId: string;
  providerIntentId: string;
};

export function createRecordSessionExpiredAsSystem(deps: SettlementDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Moves the target PaymentAttempt to CANCELLED (PAY-02) when a Stripe
   * Checkout Session expires unpaid. Sets neither `confirmedAt` nor
   * `failedAt` — CANCELLED is neither a success nor a failure timestamp.
   * Never touches the Enrolment or the seat count.
   */
  return async function recordSessionExpiredAsSystem(
    input: RecordSessionExpiredInput,
  ): Promise<{ outcome: "CANCELLED" | "EXCEPTION" }> {
    const at = now();

    const result = await deps.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, status: true, amountMinor: true, currency: true, enrolments: true },
      });
      if (!order) {
        await markWebhookEventException(tx, {
          eventId: input.eventId,
          at,
          error: `No Order found for id ${input.orderId}.`,
        });
        return { outcome: "EXCEPTION" as const };
      }

      await markWebhookEventProcessed(tx, { eventId: input.eventId, at });

      const attempt = await tx.paymentAttempt.findFirst({
        where: { orderId: order.id, providerIntentId: input.providerIntentId },
        select: { id: true, status: true },
      });

      if (!attempt) {
        await writeDomainEvent(tx, {
          type: "order.exception",
          payload: {
            orderId: order.id,
            providerIntentId: input.providerIntentId,
            reason: "payment_attempt_not_found",
          },
        });
        return { outcome: "EXCEPTION" as const };
      }

      try {
        assertPaymentTransition(attempt.status as PaymentStatusValue, "CANCELLED", attempt.id);
      } catch (err) {
        if (err instanceof IllegalPaymentTransitionError) {
          // Never move an already-terminal attempt (most likely SUCCEEDED —
          // the session completed before Stripe's own expiry housekeeping
          // caught up) to CANCELLED — the attempt is left exactly as it is.
          await writeDomainEvent(tx, {
            type: "order.exception",
            payload: {
              orderId: order.id,
              providerIntentId: input.providerIntentId,
              reason: "illegal_payment_transition",
              from: attempt.status,
              to: "CANCELLED",
            },
          });
          return { outcome: "EXCEPTION" as const };
        }
        throw err;
      }

      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "CANCELLED",
          // Narrowed evidence — never the whole raw Stripe object (PAY-14).
          evidence: { providerIntentId: input.providerIntentId, status: "expired" },
        },
      });

      return { outcome: "CANCELLED" as const };
    });

    await deps.audit({
      actorId: null,
      actorType: SYSTEM_ACTOR_TYPE,
      action: result.outcome === "CANCELLED" ? "payment.session_expired" : "order.exception",
      targetType: "Order",
      targetId: input.orderId,
      outcome: "SUCCESS",
    });

    return { outcome: result.outcome };
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const settlementDeps: SettlementDeps = {
  db: {
    $transaction: (fn) =>
      (prisma as AnyPrisma).$transaction((tx: unknown) => fn(tx as SettlementTxClient)),
  },
  audit: (event) => recordAudit(event),
};

const built = {
  recordWebhookEventOrSkip: createRecordWebhookEventOrSkip({
    webhookEvent: prisma.webhookEvent as unknown as RecordWebhookEventDeps["webhookEvent"],
  }),
  activateOrderAsSystem: createActivateOrderAsSystem(settlementDeps),
  recordPaymentFailureAsSystem: createRecordPaymentFailureAsSystem(settlementDeps),
  recordSessionExpiredAsSystem: createRecordSessionExpiredAsSystem(settlementDeps),
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

/**
 * Records a Stripe payment failure as FAILED on the matching PaymentAttempt
 * (PAY-02) — actorless, audited as SYSTEM (webhook-only).
 */
export function recordPaymentFailureAsSystem(
  input: RecordPaymentFailureInput,
): Promise<{ outcome: "FAILED" | "EXCEPTION" }> {
  return built.recordPaymentFailureAsSystem(input);
}

/**
 * Records an expired Stripe Checkout Session as CANCELLED on the matching
 * PaymentAttempt (PAY-02) — actorless, audited as SYSTEM (webhook-only).
 */
export function recordSessionExpiredAsSystem(
  input: RecordSessionExpiredInput,
): Promise<{ outcome: "CANCELLED" | "EXCEPTION" }> {
  return built.recordSessionExpiredAsSystem(input);
}
