/**
 * Component-aware refunds routed to the original provider (PAY-05, PAY-13,
 * D-22, D-23, D-24).
 *
 * A staff member holding `refunds.manage` in the Order's cohort scope records
 * a refund. Every refund is capped at the eligible captured value (the
 * learner's captured total minus every already-recorded, non-FAILED refund
 * for that Order — PAY-05, D-22), allocated across base/platform/gateway
 * components in pure integer arithmetic (D-24), and routed to the ORIGINAL
 * provider's own refund API — this file never assumes a processing fee was
 * returned; it records the provider's actual reported outcome (D-22).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "FULL" VS "PARTIAL" IS DERIVED, NOT STAFF-DECLARED.
 * ─────────────────────────────────────────────────────────────────────────────
 * D-23: "a full refund request means the full captured learner total." Rather
 * than adding a redundant `kind: "FULL" | "PARTIAL"` flag a caller could set
 * inconsistently with the amount they entered, THIS refund is a "full" one
 * exactly when its `amountMinor` equals the eligible cap computed at write
 * time — the same test 07-01's Decision A keys `reverse_transfer` off. A
 * partial refund of "everything remaining" and an explicit "full refund"
 * request are the same fact by definition, and this collapses them into one
 * source of truth instead of two that could disagree.
 *
 * The refund's access decision (`accessDecision`) is a separate, explicit
 * input — D-23 requires it recorded independently. This service does NOT
 * revoke or restore Enrolment access as a side effect of recording a refund;
 * it only stores the staff-made decision. Refunding never implicitly revokes
 * access, and revoking access (an `enrolment-service.ts` operation) never
 * implicitly refunds.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit, type BusinessAuditEvent } from "@/server/services/audit-service";
import {
  correlateReconciliationEvidenceAsSystem,
  syncReconciliationEvidenceAsSystem,
} from "@/server/services/reconciliation-case-service";
import { orderCohortScope } from "@/server/services/cohort-scope";
// Value imports only (PAY-09) — mirrors checkout-service.ts's own
// `initiatePaystackTransaction`/`buildCheckoutSessionParams` precedent. No
// TYPE is imported from either provider directory; every deps-facing shape
// below is redeclared structurally in THIS file instead, so a type-only
// import of a provider path never appears here (see the isolation-scan
// extension in tests/checkout-phase-invariants.test.ts, Task 3).
import { buildPaystackRefundRequest, refundPaystackTransaction } from "@/server/payments/providers/paystack/refund";
import { buildStripeRefundRequest, refundStripeCharge } from "@/server/payments/providers/stripe/refund";

type WithPermission = ReturnType<typeof createWithPermission>;
type Audit = (event: BusinessAuditEvent) => Promise<void>;

// ---------------------------------------------------------------------------
// Typed refusals
// ---------------------------------------------------------------------------

export class OrderNotFoundError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`Order ${orderId} does not exist.`);
    this.name = "OrderNotFoundError";
    this.orderId = orderId;
  }
}

/** No SUCCEEDED `PaymentAttempt` exists for this Order — nothing was ever captured to refund. */
export class NoCapturedPaymentError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`Order ${orderId} has no successful payment attempt to refund.`);
    this.name = "NoCapturedPaymentError";
    this.orderId = orderId;
  }
}

/** PAY-05/D-22 — the requested amount exceeds the learner total minus already-recorded refunds. */
export class RefundExceedsEligibleValueError extends Error {
  readonly orderId: string;
  readonly requestedMinor: number;
  readonly eligibleMinor: number;
  constructor(orderId: string, requestedMinor: number, eligibleMinor: number) {
    super(
      `Refund of ${requestedMinor} for order ${orderId} exceeds the eligible captured value of ${eligibleMinor}.`,
    );
    this.name = "RefundExceedsEligibleValueError";
    this.orderId = orderId;
    this.requestedMinor = requestedMinor;
    this.eligibleMinor = eligibleMinor;
  }
}

export class RefundValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>;
  constructor(fieldErrors: Record<string, string[]>) {
    super(`Refund is missing or has invalid required field(s): ${Object.keys(fieldErrors).join(", ")}.`);
    this.name = "RefundValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/** A captured `PaymentAttempt` for an online provider has no `providerIntentId` to refund against — a data-integrity gap, not a normal refusal. */
export class MissingProviderReferenceError extends Error {
  constructor(paymentAttemptId: string) {
    super(`PaymentAttempt ${paymentAttemptId} has no providerIntentId to refund against.`);
    this.name = "MissingProviderReferenceError";
  }
}

/**
 * Resolves the id Stripe's refund API actually accepts for this attempt.
 *
 * `PaymentAttempt.providerIntentId` is populated with the Checkout Session id
 * (`cs_...`) at order INITIATION (`checkout-webhook-system-service.ts`
 * `activateOrderAsSystem`, mirroring `initiateStripePayment`'s own pre-payment
 * write) and is never overwritten after settlement. Stripe's Refund API does
 * not accept a Checkout Session id — only a PaymentIntent id (`pi_...`) or a
 * Charge id. The real PaymentIntent id IS captured separately, at settlement
 * time, inside `PaymentAttempt.evidence.paymentIntentId`
 * (`buildStripeSettlementEvidence`, 07-06/07-07) — this function prefers that
 * value and falls back to `providerIntentId` only when evidence carries no
 * usable id (an older or non-expanded delivery), so a call site never crashes
 * on a shape mismatch, it degrades to the previous try-`providerIntentId`
 * behaviour.
 */
export function resolveStripeRefundTarget(attempt: RefundPaymentAttemptRow): string | null {
  const evidence = attempt.evidence;
  if (evidence && typeof evidence === "object" && "paymentIntentId" in evidence) {
    const candidate = (evidence as { paymentIntentId?: unknown }).paymentIntentId;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return attempt.providerIntentId;
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const byField: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "_root";
    (byField[key] ??= []).push(issue.message);
  }
  return byField;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const refundInputSchema = z.object({
  orderId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(1),
  accessDecision: z.enum(["RETAINED", "REVOKED"]),
});

export type RefundInput = z.infer<typeof refundInputSchema>;

/** The raw, not-yet-validated shape a caller (a server action) passes in. */
export type RefundRawInput = { orderId: string } & Record<string, unknown>;

// ---------------------------------------------------------------------------
// allocateRefundComponents — pure, integer-only (D-24)
// ---------------------------------------------------------------------------

export type RefundOrderSnapshot = {
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
};

export type RefundComponents = {
  baseComponentMinor: number;
  platformComponentMinor: number;
  gatewayComponentMinor: number;
  /**
   * Always 0 on the normal path, where the eligible-value cap has already
   * been enforced before this function runs — the field exists as defence
   * in depth (D-24: a caller bypassing the cap must never silently drop
   * money rather than surface it) and is asserted 0 by the property-style
   * test across the whole allocation table.
   */
  nonRecoverableMinor: number;
};

/**
 * Sequentially consumes base, then platform, then gateway components against
 * the Order's own D-13 snapshot, in that priority order (D-23: "allocation
 * consumes refundable base and platform components... any gateway component
 * the provider does not return is recorded... as a KQ reconciliation
 * variance"). `alreadyRefundedMinor` is a running SCALAR total — this
 * function re-derives what that total already consumed under the SAME
 * priority order, so repeated calls as refunds accumulate always resume
 * exactly where the last one left off, without needing a separate
 * per-component ledger.
 *
 * Pure, integer-only (D-24) — the four returned figures always sum EXACTLY
 * to `refundAmountMinor`, by construction (each step subtracts what it
 * consumed before handing the remainder to the next).
 */
export function allocateRefundComponents(
  order: RefundOrderSnapshot,
  refundAmountMinor: number,
  alreadyRefundedMinor: number,
): RefundComponents {
  const totalBase = order.baseAmountMinor ?? 0;
  const totalPlatform = order.platformFeeMinor ?? 0;
  const totalGateway = order.gatewayFeeEstimateMinor ?? 0;

  const consumedBase = Math.min(alreadyRefundedMinor, totalBase);
  const afterBaseConsumed = alreadyRefundedMinor - consumedBase;
  const consumedPlatform = Math.min(afterBaseConsumed, totalPlatform);
  const afterPlatformConsumed = afterBaseConsumed - consumedPlatform;
  const consumedGateway = Math.min(afterPlatformConsumed, totalGateway);

  const remainingBase = totalBase - consumedBase;
  const remainingPlatform = totalPlatform - consumedPlatform;
  const remainingGateway = totalGateway - consumedGateway;

  const baseComponentMinor = Math.min(refundAmountMinor, remainingBase);
  const afterBase = refundAmountMinor - baseComponentMinor;
  const platformComponentMinor = Math.min(afterBase, remainingPlatform);
  const afterPlatform = afterBase - platformComponentMinor;
  const gatewayComponentMinor = Math.min(afterPlatform, remainingGateway);
  const nonRecoverableMinor = afterPlatform - gatewayComponentMinor;

  return { baseComponentMinor, platformComponentMinor, gatewayComponentMinor, nonRecoverableMinor };
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type RefundOrderRow = {
  id: string;
  currency: string;
  amountMinor: number;
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
};

export type RefundPaymentAttemptRow = {
  id: string;
  provider: "STRIPE" | "PAYSTACK" | "MANUAL";
  providerIntentId: string | null;
  // Narrowed provider evidence recorded at settlement (checkout-webhook-
  // system-service.ts, 07-06/07-07) — carries `paymentIntentId` for Stripe,
  // the real PaymentIntent id (`pi_...`), distinct from `providerIntentId`
  // above, which is the Checkout Session id (`cs_...`) captured at order
  // INITIATION, before a PaymentIntent necessarily existed. Stripe's refund
  // API accepts a PaymentIntent or Charge id, never a Checkout Session id —
  // see `resolveStripeRefundTarget` below for why this field, not
  // `providerIntentId`, is what a Stripe refund must be built against.
  evidence: unknown;
};

export type RecordRefundResult = {
  id: string;
  status: "COMPLETED" | "FAILED" | "RECORDED_MANUALLY";
  amountMinor: number;
  components: RefundComponents;
};

/**
 * The transaction surface the eligible-value reservation runs against —
 * `lockOrder` MUST take a real row lock (`SELECT ... FOR UPDATE`, mirroring
 * `seat-accounting.ts`'s `lockCohort`), not a plain read. Without that lock,
 * two concurrent `recordRefund` calls against the SAME Order could both read
 * `alreadyRefundedMinor` before either writes, both compute the FULL amount
 * as still eligible, and together refund more than the captured value — the
 * exact TOCTOU `lockOpenCohort` already closes for seat capacity, applied
 * here to money (PAY-05, D-22).
 */
export type RefundTxClient = {
  lockOrder(args: { orderId: string }): Promise<RefundOrderRow | null>;
  paymentAttempt: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }): Promise<RefundPaymentAttemptRow | null>;
  };
  refund: {
    /** Sum of `amountMinor` across every non-FAILED `Refund` row for this Order (D-22's "already-recorded" total) — a `PROCESSING` reservation counts, so a second locker sees the first's in-flight refund. */
    aggregateRefundedMinor(orderId: string): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
};

export type RefundServiceDeps = {
  db: { $transaction: <R>(fn: (tx: RefundTxClient) => Promise<R>) => Promise<R> };
  refund: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  order: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  /** Structural — never `ReturnType<typeof refundPaystackTransaction>` (PAY-09 discretion, see file header). */
  paystackRefund: (body: {
    transaction: string;
    amount?: number;
    currency?: string;
    merchant_note?: string;
  }) => Promise<{ id: number; status: string; amount: number; currency: string }>;
  /**
   * Structural — never a `Stripe.*` type (PAY-09 discretion, see file
   * header). `Record<string, unknown>` rather than a field-by-field
   * structural mirror of `Stripe.RefundCreateParams`: that interface types
   * every field optional (`payment_intent?: string`, ...) since it also
   * supports a `charge`-keyed refund this codebase never uses, so a
   * field-exact mirror here would itself have to make `payment_intent`
   * optional and lose the "this call always names a PaymentIntent" fact —
   * `buildStripeRefundRequest` (the pure builder actually called, below) is
   * what a test reads to prove the built request shape, not this deps type.
   */
  stripeRefund: (params: Record<string, unknown>) => Promise<{ id: string; status: string; amount: number; currency: string }>;
  orderScope: (orderId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  audit: Audit;
  syncReconciliationEvidence?: typeof syncReconciliationEvidenceAsSystem;
  correlateReconciliationEvidence?: typeof correlateReconciliationEvidenceAsSystem;
  now?: () => Date;
};

export function createRefundService(deps: RefundServiceDeps) {
  const now = deps.now ?? (() => new Date());

  const recordRefund = deps.withPermission<RefundRawInput>(
    "refunds.manage",
    (input) => deps.orderScope(input.orderId),
  )(async (rawInput, ctx): Promise<RecordRefundResult> => {
    const parsed = refundInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new RefundValidationError(fieldErrorsFrom(parsed.error));
    }
    const input = parsed.data;

    // PAY-05/D-22 — the Order-row lock, the eligible-value cap check, and the
    // initial PROCESSING reservation all happen inside ONE transaction. A
    // thrown refusal here (OrderNotFoundError, NoCapturedPaymentError,
    // RefundExceedsEligibleValueError) rolls the transaction back — no
    // orphan Refund row for a request that was refused.
    const reserved = await deps.db.$transaction(async (tx) => {
      const order = await tx.lockOrder({ orderId: input.orderId });
      if (!order) throw new OrderNotFoundError(input.orderId);

      const attempt = await tx.paymentAttempt.findFirst({
        where: { orderId: input.orderId, status: "SUCCEEDED" },
        orderBy: { confirmedAt: "desc" },
      });
      if (!attempt) throw new NoCapturedPaymentError(input.orderId);

      const alreadyRefundedMinor = await tx.refund.aggregateRefundedMinor(input.orderId);
      const eligibleMinor = Math.max(order.amountMinor - alreadyRefundedMinor, 0);

      // Computed here, from the Order's own snapshot and its own recorded
      // refund history, NEVER from a client-supplied "remaining balance."
      // Named in the refusal, per this plan's own acceptance criterion.
      if (input.amountMinor > eligibleMinor || eligibleMinor <= 0) {
        throw new RefundExceedsEligibleValueError(input.orderId, input.amountMinor, eligibleMinor);
      }

      // D-23 — "full" is derived: this refund exhausts the eligible cap to zero.
      const isFullRefund = input.amountMinor === eligibleMinor;
      const components = allocateRefundComponents(order, input.amountMinor, alreadyRefundedMinor);

      const created = await tx.refund.create({
        data: {
          orderId: input.orderId,
          paymentAttemptId: attempt.id,
          amountMinor: input.amountMinor,
          currency: order.currency,
          provider: attempt.provider,
          reason: input.reason,
          approverRef: ctx.actor.userId,
          // D-23 — recorded separately and explicitly; this write has no
          // effect on Enrolment access whatsoever.
          accessDecision: input.accessDecision,
          status: "PROCESSING",
          actorId: ctx.actor.userId,
          baseComponentMinor: components.baseComponentMinor,
          platformComponentMinor: components.platformComponentMinor,
          gatewayComponentMinor: components.gatewayComponentMinor,
        },
      });

      return { order, attempt, isFullRefund, components, refundId: created.id, alreadyRefundedMinor };
    });

    const { order, attempt, isFullRefund, components, refundId } = reserved;

    // The provider network call happens OUTSIDE the lock-holding transaction
    // — an external HTTP round trip must never hold a Postgres row lock open
    // (mirrors `initiatePaystackPayment`/`initiateStripePayment` creating the
    // PaymentAttempt in one transaction, then calling the provider after).
    let status: "COMPLETED" | "FAILED" | "RECORDED_MANUALLY";
    let providerRef: string | null = null;
    let providerOutcome: string;

    try {
      if (attempt.provider === "PAYSTACK") {
        if (!attempt.providerIntentId) throw new MissingProviderReferenceError(attempt.id);
        const body = buildPaystackRefundRequest({
          transactionReference: attempt.providerIntentId,
          amountMinor: isFullRefund ? undefined : input.amountMinor,
          currency: order.currency,
          note: input.reason,
        });
        const outcome = await deps.paystackRefund(body);
        providerRef = String(outcome.id);
        // 07-01 Decision B (B2, "ship now, record what Paystack reports") —
        // this response carries no confirmation the school's subaccount
        // settlement actually reversed; that is recorded as the caveat
        // below rather than assumed, per D-22.
        providerOutcome = `Paystack refund ${outcome.status} (amount ${outcome.amount} ${outcome.currency}). School-settlement reversal not independently confirmed by this response — recorded as reported (07-01 Decision B).`;
        status = "COMPLETED";
      } else if (attempt.provider === "STRIPE") {
        const stripeTarget = resolveStripeRefundTarget(attempt);
        if (!stripeTarget) throw new MissingProviderReferenceError(attempt.id);
        const reverseTransfer = isFullRefund; // 07-01 Decision A — explicit, every call.
        const params = buildStripeRefundRequest({
          paymentIntentId: stripeTarget,
          amountMinor: isFullRefund ? undefined : input.amountMinor,
          reverseTransfer,
          reason: input.reason,
        });
        // `params`'s real type (`Stripe.RefundCreateParams`, inferred from
        // `buildStripeRefundRequest`'s own return type) is deliberately
        // widened here, never named — see `stripeRefund`'s own deps-type
        // comment for why the boundary is `Record<string, unknown>`.
        const outcome = await deps.stripeRefund(params as unknown as Record<string, unknown>);
        providerRef = outcome.id;
        providerOutcome = `Stripe refund ${outcome.status} (amount ${outcome.amount} ${outcome.currency}); reverse_transfer=${reverseTransfer}.`;
        status = "COMPLETED";
      } else {
        // MANUAL — no provider API to call; RefundStatus.RECORDED_MANUALLY
        // exists exactly for this offline-reversal outcome.
        providerOutcome = "Recorded as a manual reversal — no provider refund API exists for a MANUAL payment.";
        status = "RECORDED_MANUALLY";
      }
    } catch (err) {
      // A provider failure never reports a success it did not get (D-22) —
      // the Refund row stays reserved but moves to FAILED, with the
      // provider's own error message recorded, never COMPLETED.
      status = "FAILED";
      providerOutcome = err instanceof Error ? err.message : "Unknown provider refund error.";
    }

    await deps.refund.update({
      where: { id: refundId },
      data: {
        status,
        providerRef,
        providerOutcome,
        completedAt: status === "FAILED" ? null : now(),
      },
    });

    if (status !== "FAILED") {
      const newTotalRefundedMinor = reserved.alreadyRefundedMinor + input.amountMinor;
      await deps.order.update({
        where: { id: input.orderId },
        data: { status: newTotalRefundedMinor >= order.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
    }

    await deps.audit({
      actorId: ctx.actor.userId,
      action: "refund.recorded",
      targetType: "Refund",
      targetId: refundId,
      outcome: status === "FAILED" ? "FAILED" : "SUCCESS",
      reason: input.reason,
      after: {
        orderId: input.orderId,
        amountMinor: input.amountMinor,
        status,
        accessDecision: input.accessDecision,
        ...components,
      },
    });

    const reconciliationEvidence = {
      orderId: input.orderId,
      paymentAttemptId: attempt.id,
      refundId,
      provider: attempt.provider,
      amountMinor: input.amountMinor,
      status,
      providerRef,
      providerOutcome,
    };
    if (status === "FAILED" && deps.syncReconciliationEvidence) {
      await deps.syncReconciliationEvidence({
        subject: "REFUND",
        refundId,
        risk: "MISSING_PROVIDER_DATA",
        evidence: reconciliationEvidence,
      });
    } else if (deps.correlateReconciliationEvidence) {
      await deps.correlateReconciliationEvidence({
        action: "refund.recorded",
        refundId,
        paymentAttemptId: attempt.id,
        orderId: input.orderId,
        evidence: reconciliationEvidence,
      });
    }

    return { id: refundId, status, amountMinor: input.amountMinor, components };
  });

  return { recordRefund };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

export function createPrismaBackedRefundService(
  client: AnyPrisma,
  withPermission: WithPermission,
  audit: Audit = recordAudit,
  options: Pick<RefundServiceDeps, "syncReconciliationEvidence" | "correlateReconciliationEvidence"> = {},
) {
  return createRefundService({
    db: {
      $transaction: (fn) =>
        client.$transaction((tx: AnyPrisma) =>
          fn({
            // The row lock (PAY-05/D-22) — `SELECT ... FOR UPDATE`, mirroring
            // `seat-accounting.ts#lockCohort`'s exact shape.
            lockOrder: async ({ orderId }) => {
              const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
                SELECT "id", "currency", "amountMinor", "baseAmountMinor", "platformFeeMinor", "gatewayFeeEstimateMinor"
                FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
              `;
              return (rows[0] as RefundOrderRow | undefined) ?? null;
            },
            paymentAttempt: {
              findFirst: (args) =>
                tx.paymentAttempt.findFirst({
                  where: args.where,
                  orderBy: args.orderBy,
                  select: { id: true, provider: true, providerIntentId: true, evidence: true },
                }),
            },
            refund: {
              aggregateRefundedMinor: async (orderId: string) => {
                const rows = await tx.refund.findMany({
                  where: { orderId, status: { not: "FAILED" } },
                  select: { amountMinor: true },
                });
                return rows.reduce((sum: number, row: { amountMinor: number }) => sum + row.amountMinor, 0);
              },
              create: (args) => tx.refund.create({ data: args.data, select: { id: true } }),
            },
          } satisfies RefundTxClient),
        ),
    },
    refund: {
      update: (args) => client.refund.update({ where: args.where, data: args.data }),
    },
    order: {
      update: (args) => client.order.update({ where: args.where, data: args.data }),
    },
    paystackRefund: (body) => refundPaystackTransaction(body),
    // Cast via `Parameters<typeof refundStripeCharge>[0]` rather than naming
    // `Stripe.RefundCreateParams` directly — this file must never import the
    // "stripe" specifier itself, type-only or otherwise (PAY-09's Stripe
    // isolation rule flags it unconditionally, unlike Paystack's narrower
    // type-only-only rule).
    stripeRefund: (params) => refundStripeCharge(params as Parameters<typeof refundStripeCharge>[0]),
    orderScope: orderCohortScope,
    withPermission,
    audit,
    ...options,
  });
}

const built = createPrismaBackedRefundService(prisma, liveWithPermission, recordAudit, {
  syncReconciliationEvidence: syncReconciliationEvidenceAsSystem,
  correlateReconciliationEvidence: correlateReconciliationEvidenceAsSystem,
});

export const recordRefund = built.recordRefund;

/** Re-exported so a caller can construct an `Actor` without a second import path. */
export type { Actor };
