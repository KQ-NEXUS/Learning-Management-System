/**
 * Finance-facing payment reads (PAY-06, PAY-12, D-14, D-18).
 *
 * Two `payments.view`-scoped reads back `/staff/payments` and
 * `/staff/payments/[orderId]` (07-10): a flat list row view-model across all
 * three providers, and a detail read pairing the Order's own D-13 commercial
 * snapshot against the actual settlement evidence 07-07's reconciliation
 * sweep writes onto `PaymentAttempt`.
 *
 * `derivedSettlementState` lives here, not in either page component —
 * 07-UI-SPEC §7.5 flags the three-state label as a view-model under
 * CONTEXT.md's Claude's-discretion allowance, and deriving it once,
 * server-side, is what keeps the list row and the detail badge from ever
 * disagreeing about the same Order.
 *
 * Neither read writes anything. Both are read-only, `withPermission`-wrapped
 * boundaries — the authorization is the server check, never the rendered
 * button (RBAC-06).
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { orderCohortScope } from "@/server/services/cohort-scope";

type WithPermission = ReturnType<typeof createWithPermission>;

// ---------------------------------------------------------------------------
// Settlement-state derivation (discretionary view-model, 07-UI-SPEC §7.5)
// ---------------------------------------------------------------------------

export type SettlementState = "ESTIMATED_ONLY" | "RECONCILED" | "EXCEPTION";

/** The slice of `PaymentAttempt` the derivation needs — never a whole row. */
export type SettlementActuals = {
  gatewayFeeActualMinor: number | null;
  schoolSettlementActualMinor: number | null;
  platformGrossActualMinor: number | null;
  platformNetActualMinor: number | null;
  exceptionNote: string | null;
};

/**
 * "Estimated only" while every actual field is null (D-14 — null before
 * evidence arrives is the normal state for a fresh payment, never an error).
 * "Exception" once actuals are present and 07-07's reconciliation sweep
 * flagged a variance (`exceptionNote` set). "Reconciled" once actuals are
 * present with no flagged variance.
 */
export function derivedSettlementState(actuals: SettlementActuals | null): SettlementState {
  if (!actuals) return "ESTIMATED_ONLY";
  const allNull =
    actuals.gatewayFeeActualMinor === null &&
    actuals.schoolSettlementActualMinor === null &&
    actuals.platformGrossActualMinor === null &&
    actuals.platformNetActualMinor === null;
  if (allNull) return "ESTIMATED_ONLY";
  return actuals.exceptionNote ? "EXCEPTION" : "RECONCILED";
}

/** The latest SUCCEEDED attempt by `confirmedAt`, or null if none exists. */
function latestSucceeded<T extends { status: string; confirmedAt: Date | null }>(
  attempts: readonly T[],
): T | null {
  const succeeded = attempts.filter((a) => a.status === "SUCCEEDED");
  if (succeeded.length === 0) return null;
  return succeeded.reduce((latest, current) => {
    const currentAt = current.confirmedAt?.getTime() ?? 0;
    const latestAt = latest.confirmedAt?.getTime() ?? 0;
    return currentAt >= latestAt ? current : latest;
  });
}

// ---------------------------------------------------------------------------
// List — /staff/payments
// ---------------------------------------------------------------------------

export type PaymentListRow = {
  id: string;
  reference: string;
  cohortTitle: string;
  learnerName: string;
  learnerEmail: string;
  amountMinor: number;
  currency: string;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL" | null;
  status: string;
  settlementState: SettlementState;
};

export type PaymentListOrderRow = {
  id: string;
  reference: string;
  currency: string;
  amountMinor: number;
  status: string;
  selectedProvider: "PAYSTACK" | "STRIPE" | "MANUAL" | null;
  cohort: { title: string };
  user: { name: string; email: string };
  paymentAttempts: Array<SettlementActuals & { status: string; confirmedAt: Date | null }>;
};

// ---------------------------------------------------------------------------
// Detail — /staff/payments/[orderId]
// ---------------------------------------------------------------------------

export type ExistingAttemptFacts = {
  provider: string;
  confirmedAt: Date | null;
  providerRef: string | null;
  providerIntentId: string | null;
};

export type PaymentRefundRow = {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  actorId: string | null;
  createdAt: Date;
};

export type PaymentDetailResult = {
  id: string;
  reference: string;
  status: string;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL" | null;
  currency: string;
  cohortTitle: string;
  learnerName: string;
  learnerEmail: string;
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
  amountMinor: number;
  schoolSettlementExpectedMinor: number | null;
  settlementState: SettlementState;
  actual: {
    schoolSettlementActualMinor: number | null;
    platformGrossActualMinor: number | null;
    gatewayFeeActualMinor: number | null;
    platformNetActualMinor: number | null;
  };
  /** The latest successful attempt — populated whenever one exists (used for the PAY-04 already-paid banner). */
  existingAttempt: ExistingAttemptFacts | null;
  /** Learner total minus every non-FAILED recorded refund, floored at 0; 0 when nothing has ever been captured. */
  eligibleRefundMinor: number;
  refunds: Array<{
    id: string;
    amountMinor: number;
    currency: string;
    status: string;
    actorName: string | null;
    createdAt: Date;
  }>;
};

export type PaymentDetailOrderRow = {
  id: string;
  reference: string;
  status: string;
  currency: string;
  amountMinor: number;
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
  schoolSettlementExpectedMinor: number | null;
  selectedProvider: "PAYSTACK" | "STRIPE" | "MANUAL" | null;
  user: { name: string; email: string };
  cohort: { title: string };
  paymentAttempts: Array<
    SettlementActuals & {
      provider: string;
      status: string;
      confirmedAt: Date | null;
      providerRef: string | null;
      providerIntentId: string | null;
    }
  >;
  refunds: PaymentRefundRow[];
};

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export type PaymentReadServiceDeps = {
  order: {
    findMany(): Promise<PaymentListOrderRow[]>;
    findUnique(args: { where: { id: string } }): Promise<PaymentDetailOrderRow | null>;
  };
  user: {
    findMany(args: { where: { id: { in: string[] } } }): Promise<Array<{ id: string; name: string }>>;
  };
  orderScope: (orderId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
};

export function createPaymentReadService(deps: PaymentReadServiceDeps) {
  const listPaymentsForStaff = deps.withPermission<Record<string, never>>(
    "payments.view",
    // The list has no single Order to scope to — matching the resource-service
    // factory's own "list with no scope requires a GLOBAL grant" convention
    // (`resource-service.ts`).
    () => ({}),
  )(async (): Promise<PaymentListRow[]> => {
    const rows = await deps.order.findMany();
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      cohortTitle: row.cohort.title,
      learnerName: row.user.name,
      learnerEmail: row.user.email,
      amountMinor: row.amountMinor,
      currency: row.currency,
      provider: row.selectedProvider,
      status: row.status,
      settlementState: derivedSettlementState(latestSucceeded(row.paymentAttempts)),
    }));
  });

  const getPaymentDetailForStaff = deps.withPermission<string>(
    "payments.view",
    (orderId) => deps.orderScope(orderId),
  )(async (orderId): Promise<PaymentDetailResult | null> => {
    const row = await deps.order.findUnique({ where: { id: orderId } });
    if (!row) return null;

    const succeeded = latestSucceeded(row.paymentAttempts);
    const hasCapturedPayment = succeeded !== null;

    const alreadyRefundedMinor = row.refunds
      .filter((r) => r.status !== "FAILED")
      .reduce((sum, r) => sum + r.amountMinor, 0);
    const eligibleRefundMinor = hasCapturedPayment
      ? Math.max(row.amountMinor - alreadyRefundedMinor, 0)
      : 0;

    // Refund actor names are supplementary display data, not the gate
    // (payments.view already decided that above) — mirrors CohortsPage's own
    // best-effort course/programme title lookup precedent.
    const actorIds = [...new Set(row.refunds.map((r) => r.actorId).filter((id): id is string => !!id))];
    const actorNames = actorIds.length > 0 ? await deps.user.findMany({ where: { id: { in: actorIds } } }) : [];
    const actorNameById = new Map(actorNames.map((u) => [u.id, u.name]));

    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      provider: row.selectedProvider,
      currency: row.currency,
      cohortTitle: row.cohort.title,
      learnerName: row.user.name,
      learnerEmail: row.user.email,
      baseAmountMinor: row.baseAmountMinor,
      platformFeeMinor: row.platformFeeMinor,
      gatewayFeeEstimateMinor: row.gatewayFeeEstimateMinor,
      amountMinor: row.amountMinor,
      schoolSettlementExpectedMinor: row.schoolSettlementExpectedMinor,
      settlementState: derivedSettlementState(succeeded),
      actual: {
        schoolSettlementActualMinor: succeeded?.schoolSettlementActualMinor ?? null,
        platformGrossActualMinor: succeeded?.platformGrossActualMinor ?? null,
        gatewayFeeActualMinor: succeeded?.gatewayFeeActualMinor ?? null,
        platformNetActualMinor: succeeded?.platformNetActualMinor ?? null,
      },
      existingAttempt: succeeded
        ? {
            provider: succeeded.provider,
            confirmedAt: succeeded.confirmedAt,
            providerRef: succeeded.providerRef,
            providerIntentId: succeeded.providerIntentId,
          }
        : null,
      eligibleRefundMinor,
      refunds: row.refunds.map((r) => ({
        id: r.id,
        amountMinor: r.amountMinor,
        currency: r.currency,
        status: r.status,
        actorName: r.actorId ? (actorNameById.get(r.actorId) ?? null) : null,
        createdAt: r.createdAt,
      })),
    };
  });

  return { listPaymentsForStaff, getPaymentDetailForStaff };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const ATTEMPT_ACTUALS_SELECT = {
  status: true,
  confirmedAt: true,
  gatewayFeeActualMinor: true,
  schoolSettlementActualMinor: true,
  platformGrossActualMinor: true,
  platformNetActualMinor: true,
  exceptionNote: true,
} as const;

export function createPrismaBackedPaymentReadService(client: AnyPrisma, withPermission: WithPermission) {
  return createPaymentReadService({
    order: {
      findMany: () =>
        client.order.findMany({
          select: {
            id: true,
            reference: true,
            currency: true,
            amountMinor: true,
            status: true,
            selectedProvider: true,
            cohort: { select: { title: true } },
            user: { select: { name: true, email: true } },
            paymentAttempts: { select: ATTEMPT_ACTUALS_SELECT },
          },
          orderBy: { createdAt: "desc" },
        }),
      findUnique: ({ where }) =>
        client.order.findUnique({
          where,
          select: {
            id: true,
            reference: true,
            status: true,
            currency: true,
            amountMinor: true,
            baseAmountMinor: true,
            platformFeeMinor: true,
            gatewayFeeEstimateMinor: true,
            schoolSettlementExpectedMinor: true,
            selectedProvider: true,
            user: { select: { name: true, email: true } },
            cohort: { select: { title: true } },
            paymentAttempts: {
              select: {
                provider: true,
                providerRef: true,
                providerIntentId: true,
                ...ATTEMPT_ACTUALS_SELECT,
              },
            },
            refunds: {
              select: {
                id: true,
                amountMinor: true,
                currency: true,
                status: true,
                actorId: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
            },
          },
        }),
    },
    user: {
      findMany: (args) => client.user.findMany({ where: args.where, select: { id: true, name: true } }),
    },
    orderScope: orderCohortScope,
    withPermission,
  });
}

const built = createPrismaBackedPaymentReadService(prisma, liveWithPermission);

export const listPaymentsForStaff = () => built.listPaymentsForStaff({});
export const getPaymentDetailForStaff = (orderId: string) => built.getPaymentDetailForStaff(orderId);
