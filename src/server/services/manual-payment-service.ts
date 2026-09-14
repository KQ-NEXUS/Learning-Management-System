/**
 * Manual (offline) payment confirmation (PAY-03, PAY-04, PAY-10, D-15).
 *
 * A staff member holding `payments.confirm` in the Order's cohort scope
 * records that a learner paid outside the online rails (bank transfer, cash,
 * etc.) and confirms the Order/Enrolment through it. This is the
 * highest-privilege money path in the system that has no provider evidence
 * behind it at all — every one of PAY-03's seven fields (amount, currency,
 * date, channel, reference, evidence/note, reason) is required and validated
 * server-side (zod), never trusted from a client-rendered form alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE NEVER WRITES `Order.status = "PAID"` ITSELF (PAY-10).
 * ─────────────────────────────────────────────────────────────────────────────
 * `confirmManualPayment` writes the manual evidence onto a `PaymentAttempt`
 * (provider `MANUAL`) and then delegates the actual settlement transition —
 * the one that moves `Order.status` to `PAID` and the `Enrolment` to
 * `ACTIVE` — to `activateOrderAsSystem` (`checkout-webhook-system-service.ts`),
 * the SAME shared settlement writer the Stripe and Paystack webhooks call.
 * `tests/checkout-phase-invariants.test.ts`'s `assertSinglePaidOrderWriter`
 * mechanically enforces that this file contains no `status: "PAID"`
 * object-literal write — 07-RESEARCH.md names a second writer introduced
 * here as Pitfall 2, the single most likely regression in this plan.
 *
 * `PENDING_MANUAL_REVIEW` (the reserved `PaymentStatus` enum value) is
 * deliberately NOT used as an intermediate state here — D-15 does not
 * require a review step, and a direct transition audited under a distinct
 * `_manual`-suffixed action name (see `checkout-webhook-system-service.ts`)
 * already satisfies PAY-03 without one. It stays reserved/unreachable, by
 * this plan's own explicit choice, not an oversight.
 *
 * D-15's platform-fee/gateway-fee facts: the Order's `baseAmountMinor` and
 * `platformFeeMinor` are already provider-independent (both computed the
 * same way regardless of which rail was originally selected — D-10's
 * 1.5%-of-base formula has no provider term). The only figure that changes
 * for a manual confirmation is `gatewayFeeEstimateMinor`, which becomes
 * exactly 0 (no provider split ever happens for a bank transfer) — this
 * shared settlement transaction recomputes the Order's snapshot after
 * locking the Order row, so the amount/currency match guard (REG-03) sees
 * the manual total without exposing an intermediate snapshot to a webhook.
 */

import type { Actor } from "@/server/permissions/with-permission";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { prisma } from "@/server/db";
import { recordAudit, type BusinessAuditEvent } from "@/server/services/audit-service";
import { orderCohortScope } from "@/server/services/cohort-scope";
import { calculatePlatformFeeMinor } from "@/server/payments/pricing";
import { isManualPaymentConfirmationBlocked } from "@/server/payments/order-status";
import {
  activateOrderAsSystem as liveActivateOrderAsSystem,
  type ActivateOrderAsSystemInput,
  type ActivateOrderAsSystemResult,
} from "@/server/services/checkout-webhook-system-service";
import { z } from "zod";

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

/** A required PAY-03 field is missing, malformed, or the wrong type. */
export class ManualPaymentValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>;
  constructor(fieldErrors: Record<string, string[]>) {
    super(`Manual payment confirmation is missing or has invalid required field(s): ${Object.keys(fieldErrors).join(", ")}.`);
    this.name = "ManualPaymentValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/** The Order this confirmation targets has no D-13 commercial snapshot to confirm against. */
export class MissingCommercialSnapshotError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`Order ${orderId} has no commercial snapshot (baseAmountMinor) to confirm a manual payment against.`);
    this.name = "MissingCommercialSnapshotError";
    this.orderId = orderId;
  }
}

/** The staff-entered currency does not match the Order's own snapshotted currency. */
export class ManualPaymentCurrencyMismatchError extends Error {
  readonly orderId: string;
  constructor(orderId: string, orderCurrency: string, inputCurrency: string) {
    super(`Order ${orderId} is priced in ${orderCurrency}, but the confirmation was entered in ${inputCurrency}.`);
    this.name = "ManualPaymentCurrencyMismatchError";
    this.orderId = orderId;
  }
}

/**
 * The staff-entered amount does not equal D-15's expected manual total
 * (base + platform fee, zero gateway fee) — refused rather than silently
 * accepted, so a typo in the confirmed amount cannot understate or overstate
 * what the school and KQ NEXUS are owed.
 */
export class ManualPaymentAmountMismatchError extends Error {
  readonly orderId: string;
  readonly enteredMinor: number;
  readonly expectedMinor: number;
  constructor(orderId: string, enteredMinor: number, expectedMinor: number) {
    super(
      `Order ${orderId}'s manual confirmation amount (${enteredMinor}) does not equal the expected base + platform fee total (${expectedMinor}).`,
    );
    this.name = "ManualPaymentAmountMismatchError";
    this.orderId = orderId;
    this.enteredMinor = enteredMinor;
    this.expectedMinor = expectedMinor;
  }
}

// ---------------------------------------------------------------------------
// Input validation — every one of PAY-03's seven fields, server-side
// ---------------------------------------------------------------------------

const manualPaymentInputSchema = z.object({
  orderId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.enum(["NGN", "USD"]),
  manualPaidAt: z.date(),
  manualChannel: z.string().trim().min(1),
  manualReference: z.string().trim().min(1),
  manualEvidenceKey: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export type ManualPaymentInput = z.infer<typeof manualPaymentInputSchema>;

/** Field-scoped shape, built from `error.issues` directly (zod v4 — matches this codebase's own `zodErrors` convention in `src/app/staff/cohorts/actions.ts` rather than `.flatten()`). */
function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const byField: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "_root";
    (byField[key] ??= []).push(issue.message);
  }
  return byField;
}

/** The raw, not-yet-validated shape a caller (a server action) passes in — `orderId` is the only field this file trusts before validation, since it drives the permission scope resolution. */
export type ManualPaymentRawInput = { orderId: string } & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ManualPaymentOrderRow = {
  id: string;
  status: string;
  currency: string;
  baseAmountMinor: number | null;
};

export type ExistingAttemptFacts = {
  provider: string;
  confirmedAt: Date | null;
  providerRef: string | null;
  providerIntentId: string | null;
};

export type ConfirmManualPaymentResult =
  | { outcome: "ALREADY_PAID"; existingAttempt: ExistingAttemptFacts | null }
  | { outcome: "ACTIVATED" | "EXCEPTION" };

export type ManualPaymentServiceDeps = {
  order: {
    findUnique(args: { where: { id: string } }): Promise<ManualPaymentOrderRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  paymentAttempt: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }): Promise<ExistingAttemptFacts | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  /** Injected so tests never exercise the real settlement transaction — defaults to the real one at the Prisma-backed binding, below. */
  activateOrderAsSystem: (input: ActivateOrderAsSystemInput) => Promise<ActivateOrderAsSystemResult>;
  audit: Audit;
  orderScope: (orderId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
};

export function createManualPaymentService(deps: ManualPaymentServiceDeps) {
  const confirmManualPayment = deps.withPermission<ManualPaymentRawInput>(
    "payments.confirm",
    (input) => deps.orderScope(input.orderId),
  )(async (rawInput, ctx): Promise<ConfirmManualPaymentResult> => {
    const order = await deps.order.findUnique({ where: { id: rawInput.orderId } });
    if (!order) throw new OrderNotFoundError(rawInput.orderId);

    // PAY-04 — runs BEFORE field validation, per this plan's own action text:
    // a historically-paid or fail-closed Order returns the existing successful
    // transaction and writes NOTHING, regardless of what the rest of the
    // (possibly stale or resubmitted) form contained.
    if (isManualPaymentConfirmationBlocked(order.status)) {
      const existing = await deps.paymentAttempt.findFirst({
        where: { orderId: rawInput.orderId, status: "SUCCEEDED" },
        orderBy: { confirmedAt: "desc" },
      });
      return { outcome: "ALREADY_PAID", existingAttempt: existing };
    }

    const parsed = manualPaymentInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ManualPaymentValidationError(fieldErrorsFrom(parsed.error));
    }
    const input = parsed.data;

    if (order.currency !== input.currency) {
      throw new ManualPaymentCurrencyMismatchError(rawInput.orderId, order.currency, input.currency);
    }
    if (order.baseAmountMinor === null) {
      throw new MissingCommercialSnapshotError(rawInput.orderId);
    }

    // D-15 — same 1.5%-of-base formula as every other Order, zero gateway fee.
    const platformFeeMinor = calculatePlatformFeeMinor(order.baseAmountMinor);
    const expectedTotalMinor = order.baseAmountMinor + platformFeeMinor;

    if (input.amountMinor !== expectedTotalMinor) {
      throw new ManualPaymentAmountMismatchError(rawInput.orderId, input.amountMinor, expectedTotalMinor);
    }

    // The idempotency key mirrors the provider+eventId shape the webhook
    // path uses (07-04) — `manual:{orderId}:{reference}` — so a resubmission
    // of the exact same reference cannot create a second PaymentAttempt.
    const idempotencyKey = `manual:${rawInput.orderId}:${input.manualReference}`;

    const result = await deps.activateOrderAsSystem({
      orderId: rawInput.orderId,
      provider: "MANUAL",
      providerIntentId: input.manualReference,
      providerRef: input.manualReference,
      amountMinor: expectedTotalMinor,
      currency: input.currency,
      eventId: idempotencyKey,
      manualConfirmation: {
        confirmedById: ctx.actor.userId,
        manualChannel: input.manualChannel,
        manualReference: input.manualReference,
        manualPaidAt: input.manualPaidAt,
        manualEvidenceKey: input.manualEvidenceKey,
        reason: input.reason,
      },
      // D-15 — the school amount and KQ allocation/remittance evidence exist
      // ONLY in this audit trail, since no provider split ever occurs for a
      // manual confirmation.
      settlementEvidence: {
        manualChannel: input.manualChannel,
        manualReference: input.manualReference,
        schoolAmountMinor: order.baseAmountMinor,
        kqAllocationMinor: platformFeeMinor,
      },
    });

    if (result.outcome === "ALREADY_PAID") {
      return result;
    }

    // Exactly one audit row naming the confirming actor and the reason — the
    // settlement transition's own audit writes (above) are SYSTEM-attributed
    // and name neither; this is the one row that does.
    await deps.audit({
      actorId: ctx.actor.userId,
      action: "payment.manual_confirmed",
      targetType: "Order",
      targetId: rawInput.orderId,
      outcome: result.outcome === "ACTIVATED" ? "SUCCESS" : "EXCEPTION",
      reason: input.reason,
      after: {
        schoolAmountMinor: order.baseAmountMinor,
        kqAllocationMinor: platformFeeMinor,
        manualChannel: input.manualChannel,
        manualReference: input.manualReference,
        manualEvidenceKey: input.manualEvidenceKey,
      },
    });

    return { outcome: result.outcome };
  });

  return { confirmManualPayment };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

export function createPrismaBackedManualPaymentService(
  client: AnyPrisma,
  withPermission: WithPermission,
  audit: Audit = recordAudit,
) {
  return createManualPaymentService({
    order: {
      findUnique: ({ where }) =>
        client.order.findUnique({
          where,
          select: { id: true, status: true, currency: true, baseAmountMinor: true },
        }),
      update: (args) => client.order.update({ where: args.where, data: args.data }),
    },
    paymentAttempt: {
      findFirst: (args) =>
        client.paymentAttempt.findFirst({
          where: args.where,
          orderBy: args.orderBy,
          select: { provider: true, confirmedAt: true, providerRef: true, providerIntentId: true },
        }),
      create: (args) => client.paymentAttempt.create({ data: args.data, select: { id: true } }),
    },
    activateOrderAsSystem: liveActivateOrderAsSystem,
    audit,
    orderScope: orderCohortScope,
    withPermission,
  });
}

const built = createPrismaBackedManualPaymentService(prisma, liveWithPermission);

export const confirmManualPayment = built.confirmManualPayment;

/** Re-exported so a caller can construct an `Actor` without a second import path. */
export type { Actor };
