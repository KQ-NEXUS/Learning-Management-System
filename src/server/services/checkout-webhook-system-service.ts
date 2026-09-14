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
 * same shape, same reason: a settled `SUCCEEDED` status has an empty
 * allow-list, so a late or out-of-order webhook event cannot walk a settled
 * payment backwards. A provider-confirmed success can still recover a
 * declined or locally-cancelled attempt. `Order`'s own status is never separately
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
import {
  AlreadyEnrolledError,
  lockOpenCohort,
} from "@/server/services/seat-accounting";
import { calculatePlatformFeeMinor } from "@/server/payments/pricing";
import { isManualPaymentConfirmationBlocked } from "@/server/payments/order-status";
// D-18 — Phase 3's minimal send-wrapper, reused verbatim (no second mail
// client, no template engine, no dedup layer). `dispatchBestEffort` is
// imported by name here so the opt-out from `dispatch`'s throw is visible at
// this call site, exactly as `profile-service.ts` does it.
import {
  dispatchBestEffort,
  emailDispatchService,
  type DispatchParams,
} from "@/server/services/email-dispatch-service";

export const SYSTEM_ACTOR_TYPE = "SYSTEM";

const DEFAULT_BASE_URL = () =>
  process.env.APP_BASE_URL ?? "http://localhost:3000";

function formatMinorAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

/**
 * The plain-text confirmation body — following `profile-service.ts`'s
 * `buildEmailChangeText` pattern (a small local builder, no HTML, no
 * template file). States the order reference, the cohort title, the
 * formatted amount and a link to the receipt at its reference URL.
 */
function buildOrderConfirmationText(args: {
  reference: string;
  cohortTitle: string;
  amountMinor: number;
  currency: string;
  receiptUrl: string;
}): string {
  const amount = formatMinorAmount(args.amountMinor, args.currency);
  return `Your order ${args.reference} for ${args.cohortTitle} (${amount}) is confirmed and your seat is active. View your receipt: ${args.receiptUrl}`;
}

/**
 * The Pitfall-4 exception wording — the payment genuinely succeeded (the
 * PaymentAttempt reached SUCCEEDED) but the seat hold had already expired
 * before this webhook ran, so the enrolment could not activate. States that
 * plainly and says no action is needed — never claims the learner is
 * enrolled (this plan's own transparency prohibition, in email form).
 */
function buildOrderExceptionText(args: {
  reference: string;
  cohortTitle: string;
  amountMinor: number;
  currency: string;
  receiptUrl: string;
}): string {
  const amount = formatMinorAmount(args.amountMinor, args.currency);
  return `Your payment for order ${args.reference} (${args.cohortTitle}, ${amount}) was received. We need a moment to confirm your seat — no action is needed from you, and we'll email you again once it's done. View your order: ${args.receiptUrl}`;
}

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
 * The only legal `PaymentAttempt.status` moves. `SUCCEEDED` has an empty
 * allow-list, which stops a late or out-of-order event from walking a settled
 * payment backwards. A provider can report a later real success for the same
 * intent after a decline retry or local cancellation; captured money must
 * win, so FAILED/CANCELLED may move only to SUCCEEDED.
 * `PENDING_MANUAL_REVIEW` is Phase 7 scope; it is
 * declared here (rather than omitted) only so this table stays exhaustive
 * over the schema's full `PaymentStatus` enum, and is not reachable from any
 * transition this phase performs.
 */
export const PAYMENT_VALID_TRANSITIONS: Record<
  PaymentStatusValue,
  PaymentStatusValue[]
> = {
  PENDING: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: ["SUCCEEDED"],
  CANCELLED: ["SUCCEEDED"],
  PENDING_MANUAL_REVIEW: [],
};

/** A `PaymentAttempt.status` move that is not in `PAYMENT_VALID_TRANSITIONS`. */
export class IllegalPaymentTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  readonly paymentAttemptId: string | null;

  constructor(
    from: string,
    to: string,
    paymentAttemptId: string | null = null,
  ) {
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
// buildReconciliationVarianceNote — shared exception-note text (07-07)
// ---------------------------------------------------------------------------

/**
 * 07-07 — the shared exception-note wording for a reconciliation variance
 * (D-18): names both the actual and expected figures for one commercial
 * component (school settlement or gateway fee) so Finance's payment-detail
 * view reads exactly what disagreed. A pure function, not a write — this
 * module still writes no reconciliation columns of its own; the caller
 * (`payment-reconciliation-service.ts`) is the only writer of
 * `PaymentAttempt.exceptionNote` for a reconciliation variance, and reuses
 * this helper only so its wording never drifts from a second, hand-written
 * copy.
 */
export function buildReconciliationVarianceNote(args: {
  label: string;
  actualMinor: number;
  expectedMinor: number;
  toleranceMinor: number;
}): string {
  return `${args.label} variance: actual ${args.actualMinor} differs from expected ${args.expectedMinor} by more than the ${args.toleranceMinor}-minor-unit rounding tolerance.`;
}

// ---------------------------------------------------------------------------
// recordWebhookEventOrSkip — the idempotency guard
// ---------------------------------------------------------------------------

/**
 * The provider literal union every settlement entry point below accepts —
 * widened from the original Stripe-only literal (07-04) so a second
 * provider's webhook route and any future manual-confirmation path can
 * share this module without a parallel settlement service. Deliberately NOT
 * the Prisma `PaymentProvider` enum: this file (like `checkout-service.ts`)
 * carries no `@prisma/client` type import.
 */
export type SettlementProvider = "STRIPE" | "PAYSTACK" | "MANUAL";

export type RecordWebhookEventInput = {
  provider: SettlementProvider;
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
        // A previous delivery may have been recorded successfully but failed
        // during downstream processing.  The route marks that row with a
        // non-null error so one provider redelivery can atomically claim it.
        // Ordinary concurrent duplicates have no error and still skip below.
        const retryClaim = await deps.webhookEvent.updateMany({
          where: {
            provider: input.provider,
            providerEventId: input.providerEventId,
            status: "RECEIVED",
            error: { not: null },
          },
          data: { status: "DUPLICATE", error: null },
        });
        if (retryClaim.count === 1) {
          return { isNew: true };
        }

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

export type MarkWebhookEventRetryableInput = {
  provider: SettlementProvider;
  providerEventId: string;
};

/** Leaves an authenticated event claimable after unexpected processing failure. */
export function createMarkWebhookEventRetryable(deps: RecordWebhookEventDeps) {
  return async function markWebhookEventRetryable(
    input: MarkWebhookEventRetryableInput,
  ): Promise<{ marked: boolean }> {
    const result = await deps.webhookEvent.updateMany({
      where: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        status: { in: ["RECEIVED", "DUPLICATE"] },
      },
      data: {
        status: "RECEIVED",
        error: "Webhook processing failed; awaiting provider retry.",
        processedAt: null,
      },
    });
    return { marked: result.count === 1 };
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
  baseAmountMinor?: number | null;
  enrolments: EnrolmentRow[];
};

type PaymentAttemptRow = {
  id: string;
  status: string;
  provider?: string;
  confirmedAt?: Date | null;
  providerRef?: string | null;
  providerIntentId?: string | null;
};

/**
 * The non-transactional order-reference/cohort-title/recipient-email read
 * the post-commit confirmation email needs (D-18). Deliberately NOT part of
 * `SettlementTxClient` — the send happens strictly after the settlement
 * transaction has committed (see `activateOrderAsSystem`'s own comment), so
 * this read has no business being inside that transaction's tx client.
 */
export type OrderEmailFacts = {
  reference: string;
  cohortTitle: string;
  userId: string;
  email: string | null;
};

/**
 * The transaction surface every settlement entry point below needs — a
 * superset of `EnrolmentActivationTxClient` (so `applyEnrolmentActivation`
 * is callable directly, no cast) plus `order.findUnique`/`update`,
 * `paymentAttempt.findFirst`/`update`, and `webhookEvent.updateMany`.
 * Structural, so this file carries no `@prisma/client` type import.
 */
export type SettlementTxClient = EnrolmentActivationTxClient & {
  enrolment: EnrolmentActivationTxClient["enrolment"] & {
    findFirst(args: {
      where: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  order: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, unknown>;
    }): Promise<OrderRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  paymentAttempt: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<PaymentAttemptRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
    create(args: {
      data: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: string }>;
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
  db: {
    $transaction: <R>(
      fn: (tx: SettlementTxClient) => Promise<R>,
      options?: { timeout?: number },
    ) => Promise<R>;
  };
  audit: (event: {
    actorId: string | null;
    actorType?: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: string;
    reason?: string | null;
  }) => Promise<void>;
  /** The `OrderEmailFacts` read the post-commit confirmation email needs. */
  orderEmailFacts: {
    findUnique(args: {
      where: { id: string };
    }): Promise<OrderEmailFacts | null>;
  };
  /** `emailDispatchService.dispatch`, imported by name at the call site (D-18). */
  dispatchEmail: (params: DispatchParams) => Promise<unknown>;
  baseUrl?: () => string;
  now?: () => Date;
};

/** @deprecated kept as an alias — `activateOrderAsSystem`'s original exported deps type name. */
export type ActivateOrderAsSystemDeps = SettlementDeps;

/**
 * `provider` is threaded through explicitly (07-04) — the original hard-coded
 * `provider: "STRIPE"` `where` clause would silently no-op (zero rows
 * matched, no error) for a Paystack event's `providerEventId`, since a
 * `WebhookEvent` row's uniqueness is `(provider, providerEventId)`, not
 * `providerEventId` alone.
 */
async function markWebhookEventException(
  tx: SettlementTxClient,
  args: {
    eventId: string;
    at: Date;
    error: string;
    provider: SettlementProvider;
  },
): Promise<void> {
  await tx.webhookEvent.updateMany({
    where: { provider: args.provider, providerEventId: args.eventId },
    data: { status: "EXCEPTION", processedAt: args.at, error: args.error },
  });
}

async function markWebhookEventProcessed(
  tx: SettlementTxClient,
  args: { eventId: string; at: Date; provider: SettlementProvider },
): Promise<void> {
  await tx.webhookEvent.updateMany({
    where: { provider: args.provider, providerEventId: args.eventId },
    data: { status: "PROCESSED", processedAt: args.at },
  });
}

// ---------------------------------------------------------------------------
// activateOrderAsSystem — the actorless settlement transaction
// ---------------------------------------------------------------------------

export type ActivateOrderAsSystemInput = {
  orderId: string;
  /** Threaded into `markWebhookEventException`/`markWebhookEventProcessed`'s
   *  `where` clause (07-04) — the `WebhookEvent` row's uniqueness is
   *  `(provider, providerEventId)`, so omitting this or hard-coding "STRIPE"
   *  would silently fail to mark a non-Stripe event's row. */
  provider: SettlementProvider;
  providerIntentId: string;
  /** Human/provider-facing transaction reference stored for staff lookup. */
  providerRef?: string | null;
  amountMinor: number;
  currency: string;
  eventId: string;
  /**
   * 07-06/07-07 — narrow, allow-listed provider correlation facts (e.g.
   * Stripe's paymentIntentId/chargeId/transferId/transferDestination) merged
   * into `PaymentAttempt.evidence` alongside the generic fields this
   * function already builds below. Never a whole raw provider payload
   * (D-21/PAY-14) — the caller (the webhook route) is responsible for
   * narrowing before this reaches here. Deliberately NOT the four "actual
   * settlement" columns (D-14) — those stay NULL regardless of what this
   * carries; only 07-07's reconciliation sweep, working from independently
   * verified provider evidence, may ever write them.
   */
  settlementEvidence?: Record<string, unknown> | null;
  /**
   * Present only for an authorized staff confirmation. Keeping preparation
   * here makes the manual snapshot, attempt creation, and settlement one
   * Order-row-locked transaction shared with provider webhooks.
   */
  manualConfirmation?: {
    confirmedById: string;
    manualChannel: string;
    manualReference: string;
    manualPaidAt: Date;
    manualEvidenceKey: string;
    reason: string;
  };
};

type ExistingSettlementAttempt = {
  provider: string;
  confirmedAt: Date | null;
  providerRef: string | null;
  providerIntentId: string | null;
};

export type ActivateOrderAsSystemResult =
  | { outcome: "ACTIVATED" | "EXCEPTION" }
  | {
      outcome: "ALREADY_PAID";
      existingAttempt: ExistingSettlementAttempt | null;
    };

export function createActivateOrderAsSystem(deps: SettlementDeps) {
  const now = deps.now ?? (() => new Date());
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;

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
   *     PaymentAttempt is already SUCCEEDED —
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
  ): Promise<ActivateOrderAsSystemResult> {
    const at = now();

    const result = await deps.db.$transaction(
      async (tx) => {
        // All settlement rails serialize on the Order before reading its
        // state. This closes the manual-vs-webhook check/write race.
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE
        `;

        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: {
            id: true,
            status: true,
            amountMinor: true,
            currency: true,
            baseAmountMinor: true,
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
            provider: input.provider,
          });
          return {
            outcome: "EXCEPTION" as const,
            enrolmentId: null as string | null,
            reason: "no_order" as const,
          };
        }

        if (input.manualConfirmation) {
          if (isManualPaymentConfirmationBlocked(order.status)) {
            const existingAttempt = await tx.paymentAttempt.findFirst({
              where: { orderId: order.id, status: "SUCCEEDED" },
              orderBy: { confirmedAt: "desc" },
              select: {
                provider: true,
                confirmedAt: true,
                providerRef: true,
                providerIntentId: true,
              },
            });
            return {
              outcome: "ALREADY_PAID" as const,
              existingAttempt: existingAttempt
                ? {
                    provider: existingAttempt.provider ?? "MANUAL",
                    confirmedAt: existingAttempt.confirmedAt ?? null,
                    providerRef: existingAttempt.providerRef ?? null,
                    providerIntentId:
                      existingAttempt.providerIntentId ?? null,
                  }
                : null,
              enrolmentId: null as string | null,
              reason: "already_paid" as const,
            };
          }

          if (order.baseAmountMinor == null) {
            throw new Error(
              `Order ${order.id} has no baseAmountMinor for manual settlement.`,
            );
          }
          const platformFeeMinor = calculatePlatformFeeMinor(
            order.baseAmountMinor,
          );
          const manualTotalMinor = order.baseAmountMinor + platformFeeMinor;
          if (
            manualTotalMinor !== input.amountMinor ||
            order.currency.toUpperCase() !== input.currency.toUpperCase()
          ) {
            throw new Error(
              `Order ${order.id} changed while its manual confirmation was being prepared.`,
            );
          }

          await tx.order.update({
            where: { id: order.id },
            data: {
              amountMinor: manualTotalMinor,
              platformFeeMinor,
              gatewayFeeEstimateMinor: 0,
              selectedProvider: "MANUAL",
              schoolSettlementExpectedMinor: order.baseAmountMinor,
            },
          });
          order.amountMinor = manualTotalMinor;

          const existingManualAttempt = await tx.paymentAttempt.findFirst({
            where: { idempotencyKey: input.eventId },
            select: { id: true, status: true },
          });
          if (!existingManualAttempt) {
            await tx.paymentAttempt.create({
              data: {
                orderId: order.id,
                provider: "MANUAL",
                providerRef:
                  input.providerRef ??
                  input.manualConfirmation.manualReference,
                providerIntentId: input.providerIntentId,
                amountMinor: manualTotalMinor,
                currency: input.currency,
                status: "PROCESSING",
                idempotencyKey: input.eventId,
                manualChannel: input.manualConfirmation.manualChannel,
                manualReference: input.manualConfirmation.manualReference,
                manualPaidAt: input.manualConfirmation.manualPaidAt,
                manualEvidenceKey:
                  input.manualConfirmation.manualEvidenceKey,
                confirmedById: input.manualConfirmation.confirmedById,
                reason: input.manualConfirmation.reason,
              },
              select: { id: true },
            });
          }
        }

        await markWebhookEventProcessed(tx, {
          eventId: input.eventId,
          at,
          provider: input.provider,
        });

        // REG-03 — never mark PAID or activate from a webhook whose amount or
        // currency does not match what this Order was created with.
        const mismatched =
          order.amountMinor !== input.amountMinor ||
          order.currency.toUpperCase() !== input.currency.toUpperCase();
        if (mismatched) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: "EXCEPTION" },
          });
          // The mismatch is written to PaymentAttempt.exceptionNote — status is
          // deliberately NOT moved to SUCCEEDED (what settled cannot be
          // trusted to equal what this Order expected), but the note itself
          // still records what Stripe reported, naming both figures, for
          // reconciliation.
          const mismatchedAttempt = await tx.paymentAttempt.findFirst({
            where: {
              orderId: order.id,
              providerIntentId: input.providerIntentId,
            },
            select: { id: true, status: true },
          });
          if (mismatchedAttempt) {
            await tx.paymentAttempt.update({
              where: { id: mismatchedAttempt.id },
              data: {
                exceptionNote: `${input.provider} reported ${input.amountMinor} ${input.currency.toUpperCase()}, but this Order was created for ${order.amountMinor} ${order.currency.toUpperCase()}.`,
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
          return {
            outcome: "EXCEPTION" as const,
            enrolmentId: enrolment?.id ?? null,
            reason: "amount_mismatch" as const,
          };
        }

        const enrolment = order.enrolments[0];

        const attempt = await tx.paymentAttempt.findFirst({
          where: {
            orderId: order.id,
            providerIntentId: input.providerIntentId,
          },
          select: { id: true, status: true },
        });

        if (!attempt) {
          // Nothing to correlate this settlement to — flag for reconciliation
          // rather than guessing which PaymentAttempt Stripe means.
          await tx.order.update({
            where: { id: order.id },
            data: { status: "EXCEPTION" },
          });
          await writeDomainEvent(tx, {
            type: "order.exception",
            payload: {
              orderId: order.id,
              providerIntentId: input.providerIntentId,
              reason: "payment_attempt_not_found",
            },
          });
          return {
            outcome: "EXCEPTION" as const,
            enrolmentId: enrolment?.id ?? null,
            reason: "attempt_not_found" as const,
          };
        }

        // Narrowed evidence — ids, amount, currency, status, plus whatever
        // narrow correlation facts the caller supplied (07-06/07-07). Never
        // the whole raw provider object (PAY-14/D-21).
        const evidence = {
          providerIntentId: input.providerIntentId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "paid",
          ...(input.settlementEvidence ?? {}),
        };

        try {
          assertPaymentTransition(
            attempt.status as PaymentStatusValue,
            "SUCCEEDED",
            attempt.id,
          );
        } catch (err) {
          if (err instanceof IllegalPaymentTransitionError) {
            // The attempt is already SUCCEEDED — this is an echo, not a new
            // settlement. Leave the attempt's status
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
            return {
              outcome: "EXCEPTION" as const,
              enrolmentId: enrolment?.id ?? null,
              reason: "illegal_payment_transition" as const,
            };
          }
          throw err;
        }

        try {
          if (!enrolment)
            throw new IllegalTransitionError("NONE", "ACTIVE", null);

          await lockOpenCohort(tx, enrolment.cohortId);
          const activeConflict = await tx.enrolment.findFirst({
            where: {
              userId: enrolment.userId,
              cohortId: enrolment.cohortId,
              status: "ACTIVE",
              id: { not: enrolment.id },
            },
            select: { id: true },
          });
          if (activeConflict) {
            throw new AlreadyEnrolledError(
              enrolment.userId,
              enrolment.cohortId,
            );
          }

          // 07-08 — the enrolment-transition reason names the ACTUAL settlement
          // provider (was hard-coded to "Stripe payment confirmed" for every
          // provider, including Paystack, before this plan; Rule 1 fix). The
          // Stripe wording is preserved byte-for-byte for backward
          // compatibility with anything reading that exact string.
          const providerLabel =
            input.provider === "STRIPE"
              ? "Stripe"
              : input.provider === "PAYSTACK"
                ? "Paystack"
                : "Manual";

          await applyEnrolmentActivation(tx, {
            enrolment,
            reason: `${providerLabel} payment confirmed`,
            actorId: null,
            now: at,
          });

          await tx.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: "SUCCEEDED",
              confirmedAt: at,
              providerRef: input.providerRef ?? input.providerIntentId,
              evidence,
            },
          });

          await tx.order.update({
            where: { id: order.id },
            data: { status: "PAID", paidAt: at },
          });

          await writeDomainEvent(tx, {
            type: "order.paid",
            payload: {
              orderId: order.id,
              providerIntentId: input.providerIntentId,
              amountMinor: input.amountMinor,
              currency: input.currency,
            },
          });

          return {
            outcome: "ACTIVATED" as const,
            enrolmentId: enrolment.id,
            reason: "activated" as const,
          };
        } catch (err) {
          if (
            err instanceof IllegalTransitionError ||
            err instanceof AlreadyEnrolledError
          ) {
            const duplicateActive = err instanceof AlreadyEnrolledError;
            await tx.paymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: "SUCCEEDED",
                confirmedAt: at,
                providerRef: input.providerRef ?? input.providerIntentId,
                evidence,
                exceptionNote: duplicateActive
                  ? `${input.provider} payment confirmed, but the learner already has an active enrolment in this cohort; money captured, needs reconciliation.`
                  : `${input.provider} payment confirmed after the seat hold was no longer eligible to activate; money captured, needs reconciliation.`,
              },
            });
            await tx.order.update({
              where: { id: order.id },
              data: { status: "EXCEPTION" },
            });
            await writeDomainEvent(tx, {
              type: "order.exception",
              payload: {
                orderId: order.id,
                providerIntentId: input.providerIntentId,
                reason: duplicateActive
                  ? "duplicate_active_enrolment"
                  : "illegal_transition",
              },
            });
            return {
              outcome: "EXCEPTION" as const,
              enrolmentId: enrolment?.id ?? null,
              reason: duplicateActive
                ? ("duplicate_active_enrolment" as const)
                : ("illegal_enrolment_transition" as const),
            };
          }
          throw err;
        }
      },
      { timeout: 15_000 },
    );

    // 07-08 — a MANUAL activation's action name carries a `_manual` suffix so
    // it is distinguishable from a webhook-driven one in the audit view, per
    // this plan's own action text. STRIPE/PAYSTACK keep the exact
    // pre-existing action strings — additive, not a breaking rename, since
    // other tests already assert those two literal names.
    const isManual = input.provider === "MANUAL";

    if (result.outcome === "ALREADY_PAID") {
      return {
        outcome: result.outcome,
        existingAttempt: result.existingAttempt,
      };
    }

    await deps.audit({
      actorId: null,
      actorType: SYSTEM_ACTOR_TYPE,
      action:
        result.outcome === "ACTIVATED"
          ? isManual
            ? "order.paid_manual"
            : "order.paid"
          : isManual
            ? "order.exception_manual"
            : "order.exception",
      targetType: "Order",
      targetId: input.orderId,
      outcome: "SUCCESS",
    });

    if (result.enrolmentId) {
      await deps.audit({
        actorId: null,
        actorType: SYSTEM_ACTOR_TYPE,
        action:
          result.outcome === "ACTIVATED"
            ? isManual
              ? "enrolment.activated_manual"
              : "enrolment.activated"
            : isManual
              ? "enrolment.activation_exception_manual"
              : "enrolment.activation_exception",
        targetType: "Enrolment",
        targetId: result.enrolmentId,
        outcome: "SUCCESS",
      });
    }

    // D-18 — the confirmation email, strictly AFTER the settlement
    // transaction has committed and both audit writes above have run (the
    // same post-commit ordering `hold-release-system-service.ts` uses for
    // its own audit — a side effect enqueued inside a transaction that later
    // rolls back would be a message about something that did not happen).
    //
    // Scoped to exactly the two outcomes this plan's transparency
    // prohibition can describe truthfully: `activated` (the seat is
    // genuinely ACTIVE) and `illegal_enrolment_transition` (the Pitfall-4
    // race — the money genuinely moved to SUCCEEDED but the seat hold had
    // already expired). The other EXCEPTION reasons (`no_order`,
    // `amount_mismatch`, `attempt_not_found`, `illegal_payment_transition`)
    // either never move the PaymentAttempt to SUCCEEDED (so "your payment
    // succeeded" would be false) or are an echo of an event this function
    // already settled once under a different event id (so a second send
    // would be a second copy for the same settlement) — none of those four
    // dispatch anything.
    //
    // No second idempotency guard needed here: plan 06-06's
    // recordWebhookEventOrSkip already returns before this transaction ever
    // runs for a redelivered event, so a duplicate send from a replay is
    // unreachable from this call site — see that function's own comment.
    if (
      result.reason === "activated" ||
      result.reason === "illegal_enrolment_transition"
    ) {
      const facts = await deps.orderEmailFacts.findUnique({
        where: { id: input.orderId },
      });
      if (facts?.email) {
        const receiptUrl = `${baseUrl()}/orders/${facts.reference}`;
        if (result.reason === "activated") {
          await dispatchBestEffort(deps.dispatchEmail, {
            template: "order-confirmation",
            toEmail: facts.email,
            userId: facts.userId,
            subject: "Your enrolment is confirmed",
            textContent: buildOrderConfirmationText({
              reference: facts.reference,
              cohortTitle: facts.cohortTitle,
              amountMinor: input.amountMinor,
              currency: input.currency,
              receiptUrl,
            }),
          });
        } else {
          await dispatchBestEffort(deps.dispatchEmail, {
            template: "order-payment-exception",
            toEmail: facts.email,
            userId: facts.userId,
            subject: "Payment received — finishing up",
            textContent: buildOrderExceptionText({
              reference: facts.reference,
              cohortTitle: facts.cohortTitle,
              amountMinor: input.amountMinor,
              currency: input.currency,
              receiptUrl,
            }),
          });
        }
      }
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
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          enrolments: true,
        },
      });
      if (!order) {
        // Stripe-only entry point (PAY-02 failure bookkeeping) — the literal
        // is intentional, not a regression of 07-04's `SettlementProvider`
        // widening, which scoped only `activateOrderAsSystem`.
        await markWebhookEventException(tx, {
          eventId: input.eventId,
          at,
          error: `No Order found for id ${input.orderId}.`,
          provider: "STRIPE",
        });
        return { outcome: "EXCEPTION" as const };
      }

      await markWebhookEventProcessed(tx, {
        eventId: input.eventId,
        at,
        provider: "STRIPE",
      });

      const attempt = input.providerIntentId
        ? await tx.paymentAttempt.findFirst({
            where: {
              orderId: order.id,
              providerIntentId: input.providerIntentId,
            },
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
        assertPaymentTransition(
          attempt.status as PaymentStatusValue,
          "FAILED",
          attempt.id,
        );
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
          evidence: {
            providerIntentId: input.providerIntentId ?? null,
            status: "failed",
          },
        },
      });

      return { outcome: "FAILED" as const };
    });

    await deps.audit({
      actorId: null,
      actorType: SYSTEM_ACTOR_TYPE,
      action:
        result.outcome === "FAILED" ? "payment.failed" : "order.exception",
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
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          enrolments: true,
        },
      });
      if (!order) {
        // Stripe-only entry point (PAY-02 session-expiry bookkeeping) — same
        // intentional literal as `recordPaymentFailureAsSystem`, above.
        await markWebhookEventException(tx, {
          eventId: input.eventId,
          at,
          error: `No Order found for id ${input.orderId}.`,
          provider: "STRIPE",
        });
        return { outcome: "EXCEPTION" as const };
      }

      await markWebhookEventProcessed(tx, {
        eventId: input.eventId,
        at,
        provider: "STRIPE",
      });

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
        assertPaymentTransition(
          attempt.status as PaymentStatusValue,
          "CANCELLED",
          attempt.id,
        );
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
          evidence: {
            providerIntentId: input.providerIntentId,
            status: "expired",
          },
        },
      });

      return { outcome: "CANCELLED" as const };
    });

    await deps.audit({
      actorId: null,
      actorType: SYSTEM_ACTOR_TYPE,
      action:
        result.outcome === "CANCELLED"
          ? "payment.session_expired"
          : "order.exception",
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
    $transaction: (fn, options) =>
      (prisma as AnyPrisma).$transaction(
        (tx: unknown) => fn(tx as SettlementTxClient),
        options,
      ),
  },
  audit: (event) => recordAudit(event),
  orderEmailFacts: {
    findUnique: async ({ where }) => {
      const row = await (prisma as AnyPrisma).order.findUnique({
        where,
        select: {
          reference: true,
          userId: true,
          cohort: { select: { title: true } },
          user: { select: { email: true } },
        },
      });
      if (!row) return null;
      return {
        reference: row.reference as string,
        cohortTitle: row.cohort.title as string,
        userId: row.userId as string,
        email: (row.user?.email as string | undefined) ?? null,
      };
    },
  },
  dispatchEmail: emailDispatchService.dispatch,
};

const built = {
  recordWebhookEventOrSkip: createRecordWebhookEventOrSkip({
    webhookEvent:
      prisma.webhookEvent as unknown as RecordWebhookEventDeps["webhookEvent"],
  }),
  markWebhookEventRetryable: createMarkWebhookEventRetryable({
    webhookEvent:
      prisma.webhookEvent as unknown as RecordWebhookEventDeps["webhookEvent"],
  }),
  activateOrderAsSystem: createActivateOrderAsSystem(settlementDeps),
  recordPaymentFailureAsSystem:
    createRecordPaymentFailureAsSystem(settlementDeps),
  recordSessionExpiredAsSystem:
    createRecordSessionExpiredAsSystem(settlementDeps),
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

export function markWebhookEventRetryable(
  input: MarkWebhookEventRetryableInput,
): Promise<{ marked: boolean }> {
  return built.markWebhookEventRetryable(input);
}

/**
 * Settles a signature-verified Stripe payment into a PAID Order and an
 * ACTIVE Enrolment, or a flagged EXCEPTION — actorless, audited as SYSTEM
 * (webhook-only).
 */
export function activateOrderAsSystem(
  input: ActivateOrderAsSystemInput,
): Promise<ActivateOrderAsSystemResult> {
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
