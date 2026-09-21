import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { getPaymentDetailForStaff } from "@/server/services/payment-read-service";
import { isManualPaymentConfirmationBlocked } from "@/server/payments/order-status";
import { orderCohortScope } from "@/server/services/cohort-scope";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { OrderBreakdownCard } from "@/components/checkout/OrderBreakdownCard";
import { ManualPaymentDialog } from "@/app/staff/payments/ManualPaymentDialog";
import { RefundDialog } from "@/app/staff/payments/RefundDialog";

/**
 * The Finance payment detail (PAY-03, PAY-04, PAY-05, PAY-07, PAY-13, PAY-17,
 * D-14, D-18, 07-UI-SPEC §7.6).
 *
 * `getPaymentDetailForStaff` is the one `payments.view`-scoped read behind
 * this screen. `can()` below is a rendering courtesy only — both the
 * manual-confirm and refund Server Actions (`actions.ts`) re-check
 * `payments.confirm`/`refunds.manage` themselves and refuse a direct POST
 * regardless of what this page renders (RBAC-06).
 */

export const metadata = { title: "Payment" };

const PAYMENT_STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  PENDING: "neutral",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "warning",
  PARTIALLY_REFUNDED: "warning",
  EXCEPTION: "danger",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
  EXCEPTION: "Exception",
};

const SETTLEMENT_LABEL: Record<string, string> = {
  ESTIMATED_ONLY: "Estimated only",
  RECONCILED: "Reconciled",
  EXCEPTION: "Exception",
};

const SETTLEMENT_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  ESTIMATED_ONLY: "neutral",
  RECONCILED: "success",
  EXCEPTION: "danger",
};

const PROVIDER_LABEL: Record<string, string> = {
  PAYSTACK: "Paystack",
  STRIPE: "Stripe",
  MANUAL: "Manual",
};

// 07-UI-SPEC §5's guard note reused for `RefundStatus` (07-10's own
// discretionary mapping — the design contract's §5 table names only
// `RECORDED_MANUALLY`'s accent tone explicitly; the rest follow the same
// evaluative-outcome convention every other `StatusPill` in this phase uses).
const REFUND_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Requested",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  RECORDED_MANUALLY: "Recorded manually",
};

const REFUND_STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger" | "accent"> = {
  REQUESTED: "neutral",
  PROCESSING: "neutral",
  COMPLETED: "success",
  FAILED: "danger",
  RECORDED_MANUALLY: "accent",
};

/** D-14 — an unresolved actual value renders the em-dash string, never "0" and never a blank cell. */
function money(minor: number | null, currency: string): string {
  if (minor === null) return "— (pending reconciliation)";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${minor} minor units ${currency}`;
  }
}

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  let detail: Awaited<ReturnType<typeof getPaymentDetailForStaff>>;
  try {
    detail = await getPaymentDetailForStaff(orderId);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // Identical to a missing record — RBAC-06, matching the Cohort/Course
      // detail pages' own convention.
      return (
        <DetailLayout
          title="Payment"
          sections={[]}
          state={{ status: "denied", permission: "payments.view" }}
        />
      );
    }
    throw error;
  }
  if (!detail) notFound();

  // D-13 hard-invariant guard, mirroring 07-09's OrderBreakdownCard callers —
  // theoretically null only for a pre-Phase-7 legacy Order.
  if (
    detail.baseAmountMinor === null ||
    detail.platformFeeMinor === null ||
    detail.gatewayFeeEstimateMinor === null ||
    detail.provider === null
  ) {
    throw new Error(
      `Order ${orderId} has no commercial snapshot (baseAmountMinor/platformFeeMinor/gatewayFeeEstimateMinor/selectedProvider) to render a Finance detail view for.`,
    );
  }

  const resource = await orderCohortScope(orderId);
  const [canConfirmManual, canManageRefunds] = await Promise.all([
    can("payments.confirm", resource),
    can("refunds.manage", resource),
  ]);

  const alreadyPaid = isManualPaymentConfirmationBlocked(detail.status);
  const showManualConfirm = canConfirmManual && !alreadyPaid;
  const showRefundButton = canManageRefunds && detail.eligibleRefundMinor > 0;

  return (
    <DetailLayout
      mode="stacked"
      breadcrumbs={[
        { label: "Workspace", href: "/staff/payments" },
        { label: "Payments", href: "/staff/payments" },
        { label: detail.reference },
      ]}
      title={detail.reference}
      badges={
        <>
          <StatusPill
            label={PAYMENT_STATUS_LABEL[detail.status] ?? detail.status}
            tone={PAYMENT_STATUS_TONE[detail.status] ?? "neutral"}
          />
          <StatusPill
            label={SETTLEMENT_LABEL[detail.settlementState] ?? detail.settlementState}
            tone={SETTLEMENT_TONE[detail.settlementState] ?? "neutral"}
          />
        </>
      }
      sections={[
        {
          id: "learner-charge",
          label: "Learner charge",
          content: (
            <div className="flex flex-col gap-4">
              <DetailFacts
                facts={[
                  { label: "Learner", value: <span className="max-w-prose break-words">{detail.learnerName}</span> },
                  { label: "Email", value: <span className="max-w-prose break-words">{detail.learnerEmail}</span> },
                  { label: "Cohort", value: <span className="max-w-prose break-words">{detail.cohortTitle}</span> },
                  { label: "Order reference", value: detail.reference, mono: true },
                ]}
              />
              <OrderBreakdownCard
                baseAmountMinor={detail.baseAmountMinor}
                platformFeeMinor={detail.platformFeeMinor}
                gatewayFeeEstimateMinor={detail.gatewayFeeEstimateMinor}
                amountMinor={detail.amountMinor}
                currency={detail.currency}
                provider={detail.provider}
              />
            </div>
          ),
        },
        {
          id: "settlement",
          label: "Settlement",
          content: (
            <div className="flex flex-col gap-4">
              {detail.settlementState === "EXCEPTION" && (
                <div role="alert" className="flex flex-col gap-1 border-l-2 border-warning py-1 pl-4">
                  <p className="text-sm font-semibold text-warning">
                    Settlement doesn&apos;t match the expected amount
                  </p>
                  <p className="max-w-prose text-sm text-foreground-soft">
                    This has been flagged for review. The learner&apos;s charge and enrolment are unaffected.
                  </p>
                </div>
              )}
              <DetailFacts
                facts={[
                  {
                    label: "Expected school settlement",
                    value: money(detail.schoolSettlementExpectedMinor, detail.currency),
                    mono: true,
                  },
                  {
                    label: "Actual school settlement",
                    value: money(detail.actual.schoolSettlementActualMinor, detail.currency),
                    mono: true,
                  },
                  {
                    label: "Expected KQ gross",
                    value: money(detail.platformFeeMinor, detail.currency),
                    mono: true,
                  },
                  {
                    label: "Actual KQ gross",
                    value: money(detail.actual.platformGrossActualMinor, detail.currency),
                    mono: true,
                  },
                  {
                    label: "Actual gateway fee",
                    value: money(detail.actual.gatewayFeeActualMinor, detail.currency),
                    mono: true,
                  },
                  {
                    label: "Actual KQ net",
                    value: money(detail.actual.platformNetActualMinor, detail.currency),
                    mono: true,
                  },
                ]}
              />
            </div>
          ),
        },
        {
          id: "manual-confirmation",
          label: "Manual confirmation",
          aside: true,
          content: alreadyPaid ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 border-l-2 border-warning py-1 pl-4">
                <p className="text-sm font-semibold text-warning">
                  {detail.existingAttempt ? "This order is already paid" : "This order can’t be confirmed manually"}
                </p>
                <p className="max-w-prose text-sm text-foreground-soft">
                  {detail.existingAttempt
                    ? `A payment was already recorded for this order on ${formatDate(detail.existingAttempt.confirmedAt ?? null)} via ${PROVIDER_LABEL[detail.existingAttempt.provider ?? ""] ?? "—"}. Check the existing transaction before taking any further action.`
                    : "It is already paid or under review, and no payment transaction is recorded against it yet."}
                </p>
              </div>
              {detail.existingAttempt && (
                <DetailFacts
                  facts={[
                    { label: "Provider", value: PROVIDER_LABEL[detail.existingAttempt.provider ?? ""] ?? "—" },
                    { label: "Date", value: formatDate(detail.existingAttempt.confirmedAt ?? null), mono: true },
                    {
                      label: "Reference",
                      value: detail.existingAttempt.providerRef ?? detail.existingAttempt.providerIntentId ?? "—",
                      mono: true,
                    },
                  ]}
                />
              )}
            </div>
          ) : showManualConfirm ? (
            <ManualPaymentDialog orderId={detail.id} currency={detail.currency} />
          ) : null,
        },
        {
          id: "refunds",
          label: "Refunds",
          badge: detail.refunds.length > 0 ? detail.refunds.length : undefined,
          content: (
            <div className="flex flex-col gap-4">
              {detail.refunds.length > 0 && (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-2 font-semibold">Reference</th>
                      <th className="py-2 pr-2 font-semibold">Amount</th>
                      <th className="py-2 pr-2 font-semibold">Status</th>
                      <th className="py-2 pr-2 font-semibold">Actor</th>
                      <th className="py-2 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.refunds.map((refund) => (
                      <tr key={refund.id} className="border-b border-border">
                        <td className="py-2 pr-2 font-mono text-sm">{refund.id}</td>
                        <td className="py-2 pr-2 font-mono tabular-nums">
                          {money(refund.amountMinor, refund.currency)}
                        </td>
                        <td className="py-2 pr-2">
                          <StatusPill
                            label={REFUND_STATUS_LABEL[refund.status] ?? refund.status}
                            tone={REFUND_STATUS_TONE[refund.status] ?? "neutral"}
                          />
                        </td>
                        <td className="py-2 pr-2 max-w-prose break-words">{refund.actorName ?? "—"}</td>
                        <td className="py-2 font-mono tabular-nums">{formatDate(refund.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {showRefundButton && (
                <RefundDialog
                  orderId={detail.id}
                  currency={detail.currency}
                  eligibleRefundMinor={detail.eligibleRefundMinor}
                />
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
