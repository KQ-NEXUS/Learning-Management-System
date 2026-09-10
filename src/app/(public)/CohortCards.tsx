import { enrollAction } from "@/app/(checkout)/actions";
import type { PublicCohort } from "@/server/services/public-catalogue-service";

/**
 * The vertical cohort-card stack REG-01 needs on a course/programme detail
 * page (06-UI-SPEC.md 7.1). A server component — the Enroll CTA is a form
 * POST to a Server Action, never a `<Link>`, so a prefetch cannot create an
 * order.
 */

const DELIVERY_MODE_LABEL: Record<string, string> = {
  SELF_PACED: "Self-paced",
  INSTRUCTOR_LED: "Instructor-led",
  BLENDED: "Blended",
};

function formatDateRange(startsAt: Date, endsAt: Date): string {
  const fmt = (value: Date) =>
    new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `${fmt(startsAt)}–${fmt(endsAt)}`;
}

function formatPrice(priceMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(priceMinor / 100);
}

export function CohortCards({ cohorts }: { cohorts: PublicCohort[] }) {
  if (cohorts.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {cohorts.map((cohort) => (
        <div
          key={cohort.id}
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-col gap-1 break-words text-sm sm:flex-row sm:items-center sm:gap-4">
            <span className="text-foreground">{formatDateRange(cohort.startsAt, cohort.endsAt)}</span>
            <span className="text-muted-foreground">
              {DELIVERY_MODE_LABEL[cohort.deliveryMode] ?? cohort.deliveryMode}
            </span>
            <span className="font-semibold text-foreground">
              {formatPrice(cohort.priceMinor, cohort.currency)}
            </span>
            {cohort.seatsAvailable === 0 ? (
              <span className="text-muted-foreground">Full</span>
            ) : (
              <span className="text-muted-foreground">{cohort.seatsAvailable} seats left</span>
            )}
          </div>

          {cohort.seatsAvailable === 0 ? null : (
            <form action={enrollAction}>
              <input type="hidden" name="cohortId" value={cohort.id} />
              <button
                type="submit"
                className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 sm:w-auto"
              >
                Enroll now
              </button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
