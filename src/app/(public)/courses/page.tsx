import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { DELIVERY_MODE_LABEL, formatPrice } from "@/app/(public)/CohortCards";
import { listPublicCourses, type PublicCohort } from "@/server/services/public-catalogue-service";

// Rendered per request, never prerendered. 04-15's `<planner_decisions>`
// sanctioned this fallback: `next build` inside the Docker builder has no
// `DATABASE_URL`, so a statically-prerendered `listPublicCourses()` fails the
// image build (04-10's `docker build .` requirement). T-04-71's disposition
// was already "accept" — the query is a single indexed `where` over a small
// set, and `revalidatePath('/courses')` from the staff actions is now moot
// because every request re-reads. Correctness first, caching second.
export const dynamic = "force-dynamic";

export const metadata = { title: "Courses" };

/** "30 Nov 2026" — pinned locale so server and browser agree. */
function shortDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );
}

/** The soonest cohort's headline price: Naira when offered, else dollars. */
function headlinePrice(cohort: PublicCohort | null): string | null {
  if (!cohort) return null;
  if (cohort.priceNgnMinor !== null) return formatPrice(cohort.priceNgnMinor, "NGN");
  if (cohort.priceUsdMinor !== null) return formatPrice(cohort.priceUsdMinor, "USD");
  return null;
}

export default async function PublicCoursesPage() {
  const courses = await listPublicCourses();

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader size="hero" title="Courses" subtitle="Professional training you can enrol on." />
      {courses.length === 0 ? (
        <p className="border-t border-foreground py-12 text-sm text-muted-foreground">
          No courses are listed right now.
        </p>
      ) : (
        <ul className="border-t border-foreground">
          {courses.map((course) => {
            const price = headlinePrice(course.nextCohort);
            const format = [
              course.durationHours != null ? `${course.durationHours} hours` : null,
              course.nextCohort ? (DELIVERY_MODE_LABEL[course.nextCohort.deliveryMode] ?? null) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={course.slug} className="border-b border-border">
                <Link
                  href={`/courses/${course.slug}`}
                  className="grid gap-3 py-8 text-foreground hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_220px_150px_28px] md:items-center md:gap-8"
                >
                  <div className="min-w-0">
                    <div className="text-[24px] leading-[1.2] font-semibold tracking-[-0.025em] break-words">
                      {course.title}
                    </div>
                    {course.summary && (
                      <p className="mt-2 max-w-[560px] text-muted-foreground">{course.summary}</p>
                    )}
                  </div>
                  <div>
                    {format && <div className="text-[13px] text-muted-foreground">{format}</div>}
                    <div className={`mt-1 font-semibold ${course.nextCohort ? "" : "text-muted-foreground"}`}>
                      {course.nextCohort ? `Next start ${shortDate(course.nextCohort.startsAt)}` : "No dates scheduled"}
                    </div>
                  </div>
                  <div className="font-mono text-[16px] font-medium tabular-nums md:text-right">
                    {price ?? <span className="text-muted-foreground">—</span>}
                  </div>
                  <ArrowRight aria-hidden className="hidden size-5 text-accent md:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
