/**
 * The four-line commercial breakdown (D-16/D-17/D-18) rendered identically by
 * the order-summary page (`/checkout/[orderId]`) and the permanent receipt
 * (`/orders/[reference]`) — one shared component, not two independently
 * maintained copies of the same markup, per 07-UI-SPEC.md §7.4's requirement
 * that the two renderings never disagree.
 *
 * Pure and presentational: every value is a prop the caller reads straight
 * off the Order's own immutable snapshot columns. This component performs no
 * calculation, reads no Cohort price, and reads no GatewayFeeSchedule
 * (D-13/D-18) — it only formats and lays out numbers it is handed. A caller
 * that recomputes any of these five values before passing them in has
 * reintroduced exactly the drift D-18 forbids; this component cannot protect
 * against that; it can only refuse to do the recomputation itself.
 */

const PROVIDER_LABEL: Record<string, string> = {
  PAYSTACK: "Paystack",
  STRIPE: "Stripe",
  MANUAL: "Manual",
};

function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
}

export type OrderBreakdownCardProps = {
  baseAmountMinor: number;
  platformFeeMinor: number;
  gatewayFeeEstimateMinor: number;
  amountMinor: number;
  currency: string;
  /** The Order's own `selectedProvider` snapshot value ("PAYSTACK" | "STRIPE" | "MANUAL"). */
  provider: string;
};

export function OrderBreakdownCard({
  baseAmountMinor,
  platformFeeMinor,
  gatewayFeeEstimateMinor,
  amountMinor,
  currency,
  provider,
}: OrderBreakdownCardProps) {
  const providerLabel = PROVIDER_LABEL[provider] ?? provider;

  return (
    <section
      aria-label="Charge breakdown"
      className="flex flex-col gap-3 border-t border-foreground pt-5"
    >
      <dl className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <dt className="text-foreground">School fee</dt>
          <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatAmount(baseAmountMinor, currency)}
          </dd>
        </div>
        <div className="flex items-center justify-between text-sm">
          <dt className="text-foreground">KQ NEXUS platform fee (1.5%)</dt>
          <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatAmount(platformFeeMinor, currency)}
          </dd>
        </div>
        <div className="flex items-center justify-between text-sm">
          <dt className="text-foreground">Estimated payment-processing fee</dt>
          <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatAmount(gatewayFeeEstimateMinor, currency)}
          </dd>
        </div>
      </dl>

      {/* D-17 — a qualifier, not a warning: muted text, never --warning.
          Nothing is wrong with an estimate being an estimate. */}
      <p className="max-w-prose text-sm text-muted-foreground">
        This is an estimate from our current provider fee schedule. The actual gateway fee may
        differ slightly — it affects how the payment is reconciled behind the scenes and never
        changes the total above.
      </p>

      <dl className="flex flex-col gap-2 border-t border-border pt-2">
        <div className="flex items-center justify-between text-sm">
          <dt className="font-semibold text-foreground">Total charged</dt>
          <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatAmount(amountMinor, currency)}
          </dd>
        </div>
      </dl>

      <p className="text-sm text-muted-foreground">
        {currency} via {providerLabel}
      </p>
    </section>
  );
}
