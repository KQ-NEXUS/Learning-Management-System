import { enrollAction } from "@/app/(checkout)/actions";
import type { PublicCohort } from "@/server/services/public-catalogue-service";
import { SUPPORT_CONTACT_EMAIL } from "@/server/support-contact";

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
  "inline-flex min-h-[50px] w-full items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep";

/** "30 November 2026": pinned locale so the server render never differs from a browser's. */
export function formatStartDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );
}

/** Whole-unit price ("₦185,000"), no decimals unless the amount has minor units. */
export function formatPrice(priceMinor: number, currency: string): string {
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceMinor / 100);
}

function PayCta({ cohortId, currency, label }: { cohortId: string; currency: "NGN" | "USD"; label: string }) {
  return (
    <form action={enrollAction}>
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="currency" value={currency} />
      <button type="submit" className={BUTTON_CLASS}>
        {label}
      </button>
    </form>
  );
}

export function CohortCards({ cohorts, durationLabel }: { cohorts: PublicCohort[]; durationLabel?: string }) {
  if (cohorts.length === 0) return null;

  return (
    <div className="flex flex-col gap-7">
      {cohorts.map((cohort, index) => {
        const isFull = cohort.seatsAvailable === 0;
        const ngnAvailable = cohort.priceNgnMinor !== null;
        const usdAvailable = cohort.priceUsdMinor !== null;
        const noRailAvailable = !ngnAvailable && !usdAvailable;
        const last = index === cohorts.length - 1;

        return (
          <div
            key={cohort.id}
            className={`flex flex-col gap-4 ${last ? "" : "border-b border-border pb-7"}`}
          >
            <div className="flex min-w-0 flex-col break-words">
              <span className={`text-[16px] font-semibold ${isFull ? "text-muted-foreground" : "text-foreground"}`}>
                Starts {formatStartDate(cohort.startsAt)}
              </span>
              <span className="text-sm text-muted-foreground">
                <span>{DELIVERY_MODE_LABEL[cohort.deliveryMode] ?? cohort.deliveryMode}</span>
                {durationLabel && <span> · {durationLabel}</span>}
              </span>
            </div>

            {isFull ? (
              <p className="text-sm text-muted-foreground">
                <span>Full</span>
                <span>. Registration is closed.</span>
              </p>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  {/* A null rail renders no price at all — never a formatted
                      zero standing in for "not offered." */}
                  <div className="flex min-w-0 flex-col break-words">
                    {ngnAvailable && (
                      <span className="text-[36px] leading-[1.1] font-bold tracking-[-0.03em] tabular-nums text-foreground">
                        {formatPrice(cohort.priceNgnMinor as number, "NGN")}
                      </span>
                    )}
                    {usdAvailable && (
                      <span
                        className={
                          ngnAvailable
                            ? "font-mono text-sm tabular-nums text-muted-foreground"
                            : "text-[36px] leading-[1.1] font-bold tracking-[-0.03em] tabular-nums text-foreground"
                        }
                      >
                        {formatPrice(cohort.priceUsdMinor as number, "USD")}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium tabular-nums text-success">
                    {cohort.seatsAvailable} seats left
                  </span>
                </div>

                {(ngnAvailable || usdAvailable) && (
                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                    {ngnAvailable && (
                      <PayCta cohortId={cohort.id} currency="NGN" label="Pay in NGN with Paystack" />
                    )}
                    {usdAvailable && (
                      <PayCta cohortId={cohort.id} currency="USD" label="Pay in USD with Stripe" />
                    )}
                  </div>
                )}

                {/* D-19/D-05 — a configuration gap, not a capacity gap: this
                    never renders alongside, or instead of, the Full label. */}
                {noRailAvailable && (
                  <div className="flex flex-col gap-1 border-l-2 border-warning py-1 pl-3 text-sm text-warning">
                    <p>
                      Payment is temporarily unavailable for this cohort.{" "}
                      <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="underline underline-offset-2">
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
