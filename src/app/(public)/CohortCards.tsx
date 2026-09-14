import { enrollAction } from "@/app/(checkout)/actions";
import type { PublicCohort } from "@/server/services/public-catalogue-service";
import { SUPPORT_CONTACT_EMAIL } from "@/server/support-contact";

/**
 * The vertical cohort-card stack REG-01 needs on a course/programme detail
 * page (06-UI-SPEC.md 7.1). A server component — every CTA is a form POST to
 * a Server Action, never a `<Link>`, so a prefetch cannot create an order.
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

const DELIVERY_MODE_LABEL: Record<string, string> = {
  SELF_PACED: "Self-paced",
  INSTRUCTOR_LED: "Instructor-led",
  BLENDED: "Blended",
};

const BUTTON_CLASS =
  "w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 sm:w-auto";

function formatDateRange(startsAt: Date, endsAt: Date): string {
  const fmt = (value: Date) =>
    new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `${fmt(startsAt)}–${fmt(endsAt)}`;
}

function formatPrice(priceMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(priceMinor / 100);
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

export function CohortCards({ cohorts }: { cohorts: PublicCohort[] }) {
  if (cohorts.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {cohorts.map((cohort) => {
        const isFull = cohort.seatsAvailable === 0;
        const ngnAvailable = cohort.priceNgnMinor !== null;
        const usdAvailable = cohort.priceUsdMinor !== null;
        const noRailAvailable = !ngnAvailable && !usdAvailable;

        return (
          <div
            key={cohort.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1 break-words text-sm sm:flex-row sm:items-center sm:gap-4">
              <span className="text-foreground">{formatDateRange(cohort.startsAt, cohort.endsAt)}</span>
              <span className="text-muted-foreground">
                {DELIVERY_MODE_LABEL[cohort.deliveryMode] ?? cohort.deliveryMode}
              </span>
              {/* A null rail renders no price at all — never a formatted
                  zero standing in for "not offered." */}
              {ngnAvailable && (
                <span className="font-semibold text-foreground">
                  {formatPrice(cohort.priceNgnMinor as number, "NGN")}
                </span>
              )}
              {usdAvailable && (
                <span className="font-semibold text-foreground">
                  {formatPrice(cohort.priceUsdMinor as number, "USD")}
                </span>
              )}
              {isFull ? (
                <span className="text-muted-foreground">Full</span>
              ) : (
                <span className="text-muted-foreground">{cohort.seatsAvailable} seats left</span>
              )}
            </div>

            {!isFull && (ngnAvailable || usdAvailable) && (
              <div className="flex flex-col gap-2 sm:flex-row">
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
            {!isFull && noRailAvailable && (
              <div className="flex flex-col gap-1 rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-warning sm:max-w-xs">
                <p>
                  Payment is temporarily unavailable for this cohort.{" "}
                  <a
                    href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
                    className="underline underline-offset-2"
                  >
                    Contact support
                  </a>{" "}
                  to enrol.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
