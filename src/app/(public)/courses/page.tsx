import { ArrowRight } from "lucide-react";
import { CheckoutNotice } from "@/app/(public)/CheckoutNotice";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { CourseCard } from "@/components/site/CourseCard";
import { BRAND, COMPANY_CERTIFICATION } from "@/lib/brand";
import { listPublicCourses } from "@/server/services/public-catalogue-service";

// Rendered per request, never prerendered. 04-15's `<planner_decisions>`
// sanctioned this fallback: `next build` inside the Docker builder has no
// `DATABASE_URL`, so a statically-prerendered `listPublicCourses()` fails the
// image build (04-10's `docker build .` requirement). T-04-71's disposition
// was already "accept" — the query is a single indexed `where` over a small
// set, and `revalidatePath('/courses')` from the staff actions is now moot
// because every request re-reads. Correctness first, caching second.
export const dynamic = "force-dynamic";

export const metadata = { title: "Courses" };

/**
 * `/courses` in the IETC look (design/mockups/public-courses.html): every listed course as a
 * card, the ones with a dated class first, then IETC's company certification, which is not
 * a class. The mockup's three category groups wait on a course category field.
 */
export default async function PublicCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const courses = await listPublicCourses();
  const { notice } = await searchParams;
  // Dated courses first, soonest first; undated ones keep the catalogue's title order.
  const ordered = [...courses].sort((a, b) => {
    if (a.nextCohort && b.nextCohort) return a.nextCohort.startsAt.getTime() - b.nextCohort.startsAt.getTime();
    return (a.nextCohort ? 0 : 1) - (b.nextCohort ? 0 : 1);
  });

  return (
    <div className="flex flex-col">
      <LearnerPageHeader
        title="Courses"
        subtitle="Professional training you can enrol on, and certification for your organisation."
      />
      <CheckoutNotice notice={notice} />
      <section aria-labelledby="course-list" className="mt-6">
        <div className="flex items-baseline justify-between gap-4 border-b-2 border-ink pb-3">
          <h2 id="course-list" className="ietc-display text-[25px] leading-none md:text-[28px]">
            Courses you can enrol on
          </h2>
          <span className="font-semibold text-ink-soft">
            {courses.length} {courses.length === 1 ? "course" : "courses"}
          </span>
        </div>
        {ordered.length === 0 ? (
          <div className="py-8">
            <p className="ietc-display text-[25px] leading-none">No courses are listed right now.</p>
            <p className="mt-2 text-ink-soft">New classes are added through the year. Please check back soon.</p>
          </div>
        ) : (
          <div className="mt-[22px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((course) => (
              <CourseCard key={course.slug} course={course} />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="company"
        className="-mx-5 mt-12 -mb-[72px] bg-ink px-5 py-10 text-white md:-mx-14 md:mt-[72px] md:px-14 md:py-14"
      >
        <div className="grid gap-7 md:grid-cols-[1fr_440px] md:gap-16">
          <div>
            <span className="ietc-display inline-block rounded-md bg-orange px-2.5 py-1 text-[14px] tracking-[0.03em] text-ink uppercase">
              {COMPANY_CERTIFICATION.label}
            </span>
            <h2 id="company" className="ietc-display mt-3.5 text-[clamp(34px,3.6vw,52px)]">
              {COMPANY_CERTIFICATION.title}
            </h2>
            <p className="mt-3.5 max-w-[58ch] text-[17px] text-on-ink-soft md:text-[18.5px]">{COMPANY_CERTIFICATION.body}</p>
          </div>
          <div>
            <p className="text-on-ink-soft">{COMPANY_CERTIFICATION.detail}</p>
            <ul className="mt-3.5 flex flex-wrap gap-2">
              {COMPANY_CERTIFICATION.standards.map((standard) => (
                <li key={standard} className="ietc-display rounded-md px-2.5 py-[5px] text-[15px] shadow-[inset_0_0_0_1px_var(--ietc-chip-on-ink)]">
                  {standard}
                </li>
              ))}
            </ul>
            {/* The address stays visible as text: a mailto: link is a convenience that may do nothing. */}
            <a
              href={`mailto:${BRAND.contact.email}`}
              className="mt-[22px] inline-flex min-h-12 items-center gap-2.5 rounded-[10px] bg-orange px-[22px] text-[15.5px] font-bold text-ink hover:brightness-95"
            >
              {COMPANY_CERTIFICATION.cta} <ArrowRight aria-hidden className="size-[19px]" strokeWidth={2.3} />
            </a>
            <p className="mt-2 text-sm text-on-ink-soft">{BRAND.contact.email}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
