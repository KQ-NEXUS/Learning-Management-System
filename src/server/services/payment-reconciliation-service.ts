/**
 * SCHEDULED-FUNCTION-ONLY actual-settlement reconciliation sweep —
 * DELIBERATELY unauthorized.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE "FIXING" THE MISSING AUTHORIZATION CHECK.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The request-scoped permission choke point resolves the current actor by
 * reading the session cookie off an incoming request. A Netlify Scheduled
 * Function is a cron-invoked, off-request process — no request, no cookie
 * jar. This is the fourth instance of the `AsSystem` pattern in this
 * codebase, after `hold-release-system-service.ts`, `scan-system-service.ts`,
 * and `checkout-webhook-system-service.ts` — the same narrow, named,
 * filter-less shape proven three times already, not a new authorization
 * model.
 *
 * The controls that make it safe are structural:
 *   1. The exported operation is suffixed `AsSystem` — the label is the
 *      warning.
 *   2. It takes NO caller-supplied filter beyond a batch size — it resolves
 *      its own work set from `status = 'SUCCEEDED' AND reconciledAt IS NULL`,
 *      scoped to the two online providers this sweep knows how to verify
 *      (`PAYSTACK`, `STRIPE` — a future `MANUAL` row from 07-08 is invisible
 *      to this query, not a crash).
 *   3. It still audits — `actorId: null, actorType: "SYSTEM"` — under an
 *      action name distinct from any staff-driven action.
 *   4. `tests/boundary.test.ts` proves this module's scheduled-function
 *      entrypoint stays free of the permission choke point and the
 *      request-scoped actor getter.
 *
 * THIS MODULE MUST NEVER WRITE A PAID STATUS AND MUST NEVER CALL
 * `applyEnrolmentActivation`. `tests/checkout-phase-invariants.test.ts`'s
 * `assertSinglePaidOrderWriter` is a hard, mechanically-enforced CI gate:
 * exactly one file in `src/` may contain an object-literal `status: "PAID"`
 * assignment, and it is `checkout-webhook-system-service.ts`. Reconciling a
 * payment's actual figures is enrichment, never a second settlement path —
 * `Order.status`, `Enrolment.status`, and the seat count are never touched
 * here (D-18, PAY-10).
 *
 * Idempotency (D-21, PAY-11) is two-layered, matching the drift 07-RESEARCH.md
 * confirmed: a Netlify Scheduled Function has no retry queue, so the SWEEP
 * ITSELF is the only retry mechanism, and it must be safe to re-run
 * unconditionally.
 *   - The candidate query already excludes any row with `reconciledAt` set,
 *     so a row this sweep already enriched is simply not selected again on a
 *     later invocation.
 *   - The write itself is ALSO conditional on `reconciledAt IS NULL`
 *     (`updateMany`, not `update`) — belt-and-suspenders against two
 *     concurrent invocations racing over the same row. A `count: 0` result
 *     means a concurrent sweep already won; this run neither double-writes
 *     nor double-audits nor double-emits a domain event for that row.
 *   - A failed provider lookup leaves the row completely untouched —
 *     `reconciledAt` stays NULL, so the very next scheduled invocation is
 *     the retry. No second dedupe mechanism is added on top of this; one
 *     already exists and a second is only a second place for staleness to
 *     hide (mirroring `hold-release-system-service.ts`'s own documented
 *     reasoning for its own idempotency-by-convergence design).
 */

import { prisma } from "@/server/db";
import { recordAudit } from "@/server/services/audit-service";
import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";
import { buildReconciliationVarianceNote } from "@/server/services/checkout-webhook-system-service";
import { fetchActualSettlement as fetchPaystackActualSettlement } from "@/server/payments/providers/paystack/client";
import { fetchActualSettlement as fetchStripeActualSettlement } from "@/server/payments/providers/stripe/client";

export const SYSTEM_ACTOR_TYPE = "SYSTEM";

/** Mirrors `HOLD_SWEEP_BATCH_SIZE`'s convention — the scheduled-task module
 *  owns the production constant (`RECONCILE_PAYMENTS_BATCH_SIZE`); this is
 *  only this service's own default when a caller omits `batchLimit`. */
const DEFAULT_BATCH_LIMIT = 25;

/**
 * 07-07 — `roundingRule` (`GatewayFeeSchedule.roundingRule`) is a label
 * ("HALF_UP", "CEIL", ...), not a numeric magnitude anywhere in today's
 * schema or `pricing.ts`. The only rounding this codebase's own gross-up
 * formula (`calculateCheckoutBreakdown`, `ceilDiv`) can introduce against an
 * exact fractional value is a single minor-unit step. Absent a numeric
 * tolerance field on the schedule itself, one minor unit is the smallest
 * defensible reading of "the schedule's own rounding tolerance" the plan
 * asks for — this is Claude's own discretion (CONTEXT.md's third
 * agent-discretion bullet), recorded here rather than silently assumed.
 */
export const RECONCILIATION_ROUNDING_TOLERANCE_MINOR = 1;

/** The provider-neutral shape every provider lookup below returns —
 *  `payment-reconciliation-service.ts`'s own contract, never a Stripe or
 *  Paystack type (PAY-09). `platformNetActualMinor` is deliberately NOT part
 *  of this shape — it is derived by this module itself, in integer
 *  arithmetic, never returned by a provider lookup (D-24). */
export type ActualSettlement = {
  gatewayFeeActualMinor: number;
  schoolSettlementActualMinor: number;
  platformGrossActualMinor: number;
};

type ReconciliationCandidate = {
  id: string;
  provider: "PAYSTACK" | "STRIPE";
  status: string;
  providerIntentId: string | null;
  evidence: unknown;
  orderId: string;
  reconciledAt: Date | null;
};

/** Structural — real Prisma's `paymentAttempt` delegate satisfies this, and
 *  so does a test fake, so this file carries no `@prisma/client` import. */
type PaymentAttemptDelegate = {
  findMany(args: {
    where: {
      status: "SUCCEEDED";
      reconciledAt: null;
      provider: { in: Array<"PAYSTACK" | "STRIPE"> };
    };
    orderBy: { confirmedAt: "asc" };
    take: number;
    select: Record<string, boolean>;
  }): Promise<ReconciliationCandidate[]>;
};

type OrderExpectationRow = {
  currency: string;
  schoolSettlementExpectedMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
};

type OrderReadDelegate = {
  findUnique(args: {
    where: { id: string };
    select: Record<string, boolean>;
  }): Promise<OrderExpectationRow | null>;
};

/** The transaction client one row's reconciliation write needs — structural,
 *  so this file carries no `@prisma/client` type import. */
type ReconcileTxClient = DomainEventTxClient & {
  paymentAttempt: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

export type ReconcilePaymentsDeps = {
  paymentAttempt: PaymentAttemptDelegate;
  order: OrderReadDelegate;
  audit: (event: {
    actorId: string | null;
    actorType?: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: string;
    reason?: string | null;
  }) => Promise<void>;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx: ReconcileTxClient) => Promise<R>) => Promise<R>;
  /** Injected so no test ever performs a real Paystack network call. */
  lookupPaystackActualSettlement: (providerIntentId: string) => Promise<ActualSettlement>;
  /** Injected so no test ever performs a real Stripe network call. */
  lookupStripeActualSettlement: (paymentIntentId: string) => Promise<ActualSettlement>;
  now?: () => Date;
};

/** The `PaymentAttempt.evidence` shape 07-06 guarantees for a settled Stripe
 *  attempt always carries a non-null `paymentIntentId`, even when the
 *  delivered webhook event was not expanded (07-06 Decision 1). */
function extractStripePaymentIntentId(evidence: unknown): string | null {
  if (typeof evidence !== "object" || evidence === null) return null;
  const value = (evidence as Record<string, unknown>).paymentIntentId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A provider correlation id this sweep needs was missing from the row
 *  itself — never thrown by a provider's own lookup, so it is kept distinct
 *  from a `PaystackApiError`/`StripeActualSettlementUnavailableError`. */
export class MissingReconciliationCorrelationError extends Error {
  constructor(paymentAttemptId: string, provider: string) {
    super(`PaymentAttempt ${paymentAttemptId} (${provider}) has no correlation id to reconcile against.`);
    this.name = "MissingReconciliationCorrelationError";
  }
}

export function createReconcilePayments(deps: ReconcilePaymentsDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Enriches at most `batchLimit` SUCCEEDED, un-reconciled `PaymentAttempt`
   * rows (oldest settled first) with verified provider evidence. Each row is
   * processed independently — a per-row failure is caught, logged and
   * counted rather than thrown, so one poison row cannot stall the sweep
   * (mirrors `hold-release-system-service.ts`'s own per-row isolation).
   */
  async function reconcilePayments(
    batchLimit: number = DEFAULT_BATCH_LIMIT,
  ): Promise<{ reconciled: number; failed: number }> {
    const candidates = await deps.paymentAttempt.findMany({
      where: {
        status: "SUCCEEDED",
        reconciledAt: null,
        provider: { in: ["PAYSTACK", "STRIPE"] },
      },
      orderBy: { confirmedAt: "asc" },
      take: batchLimit,
      select: {
        id: true,
        provider: true,
        status: true,
        providerIntentId: true,
        evidence: true,
        orderId: true,
        reconciledAt: true,
      },
    });

    // Defensive re-filter (mirrors hold-release-system-service.ts) so a test
    // fake that ignores the `where` clause still yields exactly the correct
    // set — never an already-reconciled or non-SUCCEEDED row.
    const work = candidates.filter(
      (row) =>
        row.status === "SUCCEEDED" &&
        row.reconciledAt === null &&
        (row.provider === "PAYSTACK" || row.provider === "STRIPE"),
    );

    let reconciled = 0;
    let failed = 0;

    for (const attempt of work) {
      try {
        const order = await deps.order.findUnique({
          where: { id: attempt.orderId },
          select: {
            currency: true,
            schoolSettlementExpectedMinor: true,
            gatewayFeeEstimateMinor: true,
          },
        });
        if (!order) {
          // No Order to compare against or emit an event about (should not
          // happen — an Order row is never deleted, D-13). Counted as a
          // failure so the row is retried, not silently skipped forever.
          throw new Error(`No Order found for PaymentAttempt ${attempt.id} (orderId ${attempt.orderId}).`);
        }

        const actual: ActualSettlement =
          attempt.provider === "PAYSTACK"
            ? await (() => {
                if (!attempt.providerIntentId) {
                  throw new MissingReconciliationCorrelationError(attempt.id, attempt.provider);
                }
                return deps.lookupPaystackActualSettlement(attempt.providerIntentId);
              })()
            : await (() => {
                const paymentIntentId = extractStripePaymentIntentId(attempt.evidence);
                if (!paymentIntentId) {
                  throw new MissingReconciliationCorrelationError(attempt.id, attempt.provider);
                }
                return deps.lookupStripeActualSettlement(paymentIntentId);
              })();

        // D-24 — integer minor-unit arithmetic only; derived here, never
        // returned by a provider lookup.
        const platformNetActualMinor = actual.platformGrossActualMinor - actual.gatewayFeeActualMinor;

        const noteParts: string[] = [];
        if (order.schoolSettlementExpectedMinor !== null) {
          const schoolVarianceMinor = Math.abs(
            actual.schoolSettlementActualMinor - order.schoolSettlementExpectedMinor,
          );
          if (schoolVarianceMinor > RECONCILIATION_ROUNDING_TOLERANCE_MINOR) {
            noteParts.push(
              buildReconciliationVarianceNote({
                label: "School settlement",
                actualMinor: actual.schoolSettlementActualMinor,
                expectedMinor: order.schoolSettlementExpectedMinor,
                toleranceMinor: RECONCILIATION_ROUNDING_TOLERANCE_MINOR,
              }),
            );
          }
        }
        if (order.gatewayFeeEstimateMinor !== null) {
          const feeVarianceMinor = Math.abs(actual.gatewayFeeActualMinor - order.gatewayFeeEstimateMinor);
          if (feeVarianceMinor > RECONCILIATION_ROUNDING_TOLERANCE_MINOR) {
            noteParts.push(
              buildReconciliationVarianceNote({
                label: "Gateway fee",
                actualMinor: actual.gatewayFeeActualMinor,
                expectedMinor: order.gatewayFeeEstimateMinor,
                toleranceMinor: RECONCILIATION_ROUNDING_TOLERANCE_MINOR,
              }),
            );
          }
        }
        const hasVariance = noteParts.length > 0;
        const exceptionNote = hasVariance ? noteParts.join(" ") : null;
        const at = now();

        const applied = await deps.runInTransaction(async (tx) => {
          // Conditional on `reconciledAt IS NULL` — belt-and-suspenders
          // idempotency against a concurrent invocation racing this same
          // row (the candidate query above already excludes it from a
          // LATER invocation once this write commits).
          const result = await tx.paymentAttempt.updateMany({
            where: { id: attempt.id, reconciledAt: null },
            data: {
              gatewayFeeActualMinor: actual.gatewayFeeActualMinor,
              schoolSettlementActualMinor: actual.schoolSettlementActualMinor,
              platformGrossActualMinor: actual.platformGrossActualMinor,
              platformNetActualMinor,
              reconciledAt: at,
              ...(exceptionNote ? { exceptionNote } : {}),
            },
          });
          if (result.count === 0) return false;

          await deps.writeEvent(tx, {
            type: hasVariance ? "payment.reconciliation_exception" : "payment.reconciled",
            payload: {
              paymentAttemptId: attempt.id,
              orderId: attempt.orderId,
              provider: attempt.provider,
              gatewayFeeActualMinor: actual.gatewayFeeActualMinor,
              schoolSettlementActualMinor: actual.schoolSettlementActualMinor,
              platformGrossActualMinor: actual.platformGrossActualMinor,
              platformNetActualMinor,
              ...(exceptionNote ? { exceptionNote } : {}),
            },
          });
          return true;
        });

        if (!applied) {
          // A concurrent invocation already reconciled this row between our
          // read and our write. Not a failure of THIS run, and not a second
          // success either — simply nothing left for this row to do.
          continue;
        }

        await deps.audit({
          actorId: null,
          actorType: SYSTEM_ACTOR_TYPE,
          action: hasVariance ? "payment.reconciliation_exception" : "payment.reconciled",
          targetType: "PaymentAttempt",
          targetId: attempt.id,
          outcome: "SUCCESS",
          reason: exceptionNote,
        });

        reconciled += 1;
      } catch (err) {
        // A failed provider lookup (or any other per-row error) leaves the
        // row entirely untouched — `reconciledAt` stays NULL, so the next
        // scheduled invocation retries it. No partial write, ever (D-14).
        failed += 1;
        console.error(`[payment-reconciliation] failed to reconcile attempt ${attempt.id}`, err);
      }
    }

    return { reconciled, failed };
  }

  return { reconcilePayments };
}

const built = createReconcilePayments({
  paymentAttempt: prisma.paymentAttempt as unknown as PaymentAttemptDelegate,
  order: prisma.order as unknown as OrderReadDelegate,
  audit: (event) => recordAudit(event),
  writeEvent: writeDomainEvent,
  runInTransaction: (fn) =>
    prisma.$transaction((tx) => fn(tx as unknown as ReconcileTxClient)),
  lookupPaystackActualSettlement: fetchPaystackActualSettlement,
  lookupStripeActualSettlement: fetchStripeActualSettlement,
});

/**
 * Sweeps SUCCEEDED, un-reconciled `PaymentAttempt` rows and enriches them
 * with verified provider evidence. No actor, no session — audits as
 * `actorType: "SYSTEM"`. Scheduled-function only.
 */
export function reconcilePaymentsAsSystem(
  batchLimit?: number,
): Promise<{ reconciled: number; failed: number }> {
  return built.reconcilePayments(batchLimit);
}
