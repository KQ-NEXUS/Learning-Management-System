import { enrollAction } from "@/app/(checkout)/actions";
import type { PublicCohort } from "@/server/services/public-catalogue-service";
import { SUPPORT_CONTACT_EMAIL } from "@/server/support-contact";
import { humanizeCode } from "@/lib/humanize";
import { LagosTime } from "@/components/time/LagosTime";

/**
 * The "Upcoming cohorts" stack REG-01 needs on a course/programme detail page (06-UI-SPEC.md
 * 7.1), drawn as the mockup's sidebar: start date, format, big price, seats left, then the CTA.
 * A server component — every CTA is a form POST to a Server Action, never a `<Link>`, so a prefetch cannot create an order.
 *
 * 07-09 replaces the tracer's single NGN CTA with the full 07-UI-SPEC §7.2
 * branch set. `priceNgnMinor`/`priceUsdMinor` already fold in the D-05
 * "school settlement account absent" case at the service layer
 * (`public-catalogue-service.ts`) — this component only ever asks "is this
 * rail's price non-null," never why it might not be. That is the whole of
 * the zero/one/two-rail decision:
 *   - both non-null  -> two CTAs, side by side at >=640px, stacked below
 *   - exactly one     -> one CTA, in the position the old single CTA held
 *   - neither         -> no CTA; the unavailable-rail notice renders instead
 * `seatsAvailable === 0` is a distinct condition checked first and always
 * wins — a full cohort never shows a CTA, whatever its rails look like, and
 * it never reuses the unavailable-rail notice's copy for its own state.
 */

export const DELIVERY_MODE_LABEL: Record<string, string> = {
  SELF_PACED: "Self-paced",
  INSTRUCTOR_LED: "Instructor-led",
  BLENDED: "Blended",
};

const BUTTON_CLASS =
  "inline-flex min-h-12 w-full items-center justify-center rounded-[10px] bg-ink px-5 text-[15.5px] font-bold text-white hover:bg-ink-hover";
/** The second rail's button when both are offered: an ink outline, so one choice leads. */
const BUTTON_LINE_CLASS =
  "inline-flex min-h-12 w-full items-center justify-center rounded-[10px] px-5 text-[15.5px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] hover:bg-ink/5";

/** Whole-unit price ("₦185,000"), no decimals unless the amount has minor units. */
export function formatPrice(priceMinor: number, currency: string): string {
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceMinor / 100);
}

function PayCta({ cohortId, currency, label, secondary = false }: { cohortId: string; currency: "NGN" | "USD"; label: string; secondary?: boolean }) {
  return (
    <form action={enrollAction}>
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="currency" value={currency} />
      <button type="submit" className={secondary ? BUTTON_LINE_CLASS : BUTTON_CLASS}>
        {label}
      </button>
    </form>
  );
}

export function CohortCards({ cohorts, durationLabel }: { cohorts: PublicCohort[]; durationLabel?: string }) {
  if (cohorts.length === 0) return null;

  return (
    <div className="mt-3.5 flex flex-col border-t-2 border-ink">
      {cohorts.map((cohort, index) => {
        const isFull = cohort.seatsAvailable === 0;
        const ngnAvailable = cohort.priceNgnMinor !== null;
        const usdAvailable = cohort.priceUsdMinor !== null;
        const noRailAvailable = !ngnAvailable && !usdAvailable;
        const last = index === cohorts.length - 1;

        return (
          <div
            key={cohort.id}
            className={`flex flex-col gap-3.5 py-5 ${last ? "pb-0" : "border-b border-rule"}`}
          >
            <div className="flex min-w-0 flex-col break-words">
              <span className={`text-[17px] font-bold ${isFull ? "text-ink-soft" : "text-ink"}`}>
                {cohort.hasStarted ? "Started" : "Starts"} <LagosTime value={cohort.startsAt} variant="date" />
                {cohort.hasStarted && <span className="font-normal text-muted-foreground"> · still enrolling</span>}
              </span>
              <span className="text-[14.5px] text-ink-soft">
                <span>{DELIVERY_MODE_LABEL[cohort.deliveryMode] ?? humanizeCode(cohort.deliveryMode)}</span>
                {durationLabel && <span> · {durationLabel}</span>}
              </span>
            </div>

            {isFull ? (
              <p className="text-[14.5px] text-ink-soft">
                <span className="font-bold">Full</span>
                <span>. Registration is closed.</span>
              </p>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  {/* A null rail renders no price at all — never a formatted
                      zero standing in for "not offered." */}
                  <div className="flex min-w-0 flex-col break-words">
                    {ngnAvailable && (
                      <span className="ietc-display text-[40px] leading-none tabular-nums">
                        {formatPrice(cohort.priceNgnMinor as number, "NGN")}
                      </span>
                    )}
                    {usdAvailable && (
                      <span
                        className={
                          ngnAvailable
                            ? "mt-1 text-[14.5px] text-ink-soft"
                            : "ietc-display text-[40px] leading-none tabular-nums"
                        }
                      >
                        {ngnAvailable ? "or " : ""}
                        {formatPrice(cohort.priceUsdMinor as number, "USD")}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[14.5px] font-bold tabular-nums ${cohort.seatsAvailable <= 3 ? "text-warning" : "text-success"}`}
                  >
                    {cohort.seatsAvailable} {cohort.seatsAvailable === 1 ? "seat" : "seats"} left
                  </span>
                </div>

                {(ngnAvailable || usdAvailable) && (
                  <div className="flex flex-col gap-2">
                    {ngnAvailable && (
                      <PayCta cohortId={cohort.id} currency="NGN" label="Pay in NGN with Paystack" />
                    )}
                    {usdAvailable && (
                      <PayCta cohortId={cohort.id} currency="USD" label="Pay in USD with Stripe" secondary={ngnAvailable} />
                    )}
                  </div>
                )}

                {/* D-19/D-05 — a configuration gap, not a capacity gap: this
                    never renders alongside, or instead of, the Full label. */}
                {noRailAvailable && (
                  <div className="flex flex-col gap-1 rounded-xl bg-warning-surface px-4 py-3.5 text-[15px] text-pill-amber-ink">
                    <p>
                      Payment is temporarily unavailable for this cohort.{" "}
                      <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="font-bold underline underline-offset-4">
                        Contact support
                      </a>{" "}
                      to enrol.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
