"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * The three order-summary consent controls plus the Pay submit (REG-04).
 *
 * Each policy is its own separately-labelled, initially-unchecked control
 * with its own link to the policy text — never combined behind one control,
 * never rendered checked on first paint. The optional marketing control
 * never gates Pay. Both are consent-integrity rules, not styling
 * preferences: MUST NOT pre-tick, bundle, or imply consent.
 *
 * Gating Pay here is a courtesy to an honest learner, mirroring the server
 * rule rather than inventing a looser one — checkout-service.ts's
 * `PolicyConsentRequiredError` gate is what actually enforces REG-04. A
 * direct POST that skips this component entirely is refused server-side.
 */

// Inherited auth-shell checkbox treatment verbatim (04.1-UI-SPEC.md §7.2) —
// 16x16px, 1.5px border, 4px radius, native input.
const CHECKBOX = "mt-0.5 size-4 shrink-0 rounded-[4px] border-[1.5px] border-input-border";

const BTN_PRIMARY =
  "w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className={BTN_PRIMARY}>
      {pending ? "Paying…" : label}
    </button>
  );
}

export function PolicyConsentForm({
  orderId,
  action,
  forceDisabled = false,
  submitLabel,
}: {
  orderId: string;
  action: (formData: FormData) => void | Promise<void>;
  /** True while the D-13 verification banner is showing — Pay stays inert
   *  regardless of checkbox state. */
  forceDisabled?: boolean;
  submitLabel: string;
}) {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedRefundCancellation, setAcceptedRefundCancellation] = useState(false);
  const [acceptedMarketing, setAcceptedMarketing] = useState(false);

  const canPay = acceptedTerms && acceptedRefundCancellation && !forceDisabled;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="orderId" value={orderId} />

      <div className="flex flex-col gap-3 border-t border-foreground pt-5">
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            name="acceptedTerms"
            type="checkbox"
            value="true"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className={CHECKBOX}
          />
          <span>
            I agree to the{" "}
            <a href="/policies/terms" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              Terms of Service
            </a>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            name="acceptedRefundCancellation"
            type="checkbox"
            value="true"
            checked={acceptedRefundCancellation}
            onChange={(e) => setAcceptedRefundCancellation(e.target.checked)}
            className={CHECKBOX}
          />
          <span>
            I agree to the{" "}
            <a href="/policies/refund-cancellation" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              Refund &amp; Cancellation Policy
            </a>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            name="acceptedMarketing"
            type="checkbox"
            value="true"
            checked={acceptedMarketing}
            onChange={(e) => setAcceptedMarketing(e.target.checked)}
            className={CHECKBOX}
          />
          <span>Send me occasional programme updates</span>
        </label>
      </div>

      <div className="flex">
        <SubmitButton disabled={!canPay} label={submitLabel} />
      </div>
    </form>
  );
}
