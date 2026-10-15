import { notFound } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { getPublicCourseBySlug } from "@/server/services/public-catalogue-service";
import { CohortCards, DELIVERY_MODE_LABEL } from "@/app/(public)/CohortCards";
import { CheckoutNotice } from "@/app/(public)/CheckoutNotice";
import { FactsStrip, ROW, Section } from "@/components/site/Section";

// Rendered per request, never prerendered — the Docker builder has no
// DATABASE_URL (04-15 planner fallback; 04-10 `docker build` requirement).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // 404-safe: an unlisted slug must not throw here either.
  const course = await getPublicCourseBySlug(slug);
  if (!course) return { title: "Not found" };
  return { title: course.title, description: course.summary ?? undefined };
}

export default async function PublicCourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const { notice } = await searchParams;

  // TOP-LEVEL await, BEFORE any streaming boundary in this file. Once the
  // response begins streaming the status code is fixed and `notFound()` only
  // produces a soft 404 (200 + noindex) — which does not satisfy "direct
  // unpublished URLs reveal nothing" (CAT-07). The experimental 403 helper is
  // avoided too: a 403 would confirm the record exists.
  const course = await getPublicCourseBySlug(slug);
  if (!course) notFound();

  const nextCohort = course.upcomingCohorts[0];
  const durationLabel = course.durationHours != null ? `${course.durationHours} hours` : undefined;
  const lessonTotal = course.modules.reduce((sum, m) => sum + m.lessonCount, 0);
  const outcomeLines = (course.outcomes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // The facts strip on the peach head: only what this course actually has.
  const facts: [string, string][] = [];
  if (durationLabel) facts.push(["Duration", durationLabel]);
  if (course.modules.length > 0)
    facts.push(["Structure", `${course.modules.length} ${course.modules.length === 1 ? "module" : "modules"}, ${lessonTotal} ${lessonTotal === 1 ? "lesson" : "lessons"}`]);
  if (nextCohort) facts.push(["Format", DELIVERY_MODE_LABEL[nextCohort.deliveryMode] ?? nextCohort.deliveryMode]);
  if (course.certificateEnabled) facts.push(["On completion", "Certificate"]);
  const structure = `${course.modules.length} ${course.modules.length === 1 ? "module" : "modules"}, ${lessonTotal} ${lessonTotal === 1 ? "lesson" : "lessons"}`;

  return (
    <article className="flex flex-col">
      <LearnerPageHeader
        tint="bg-peach"
        title={course.title}
        subtitle={course.summary ?? undefined}
        back={{ label: "Back to courses", href: "/courses" }}
        band={facts.length > 0 ? <FactsStrip facts={facts} /> : undefined}
      />

      <div className="grid items-start gap-9 pt-7 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16 lg:pt-11">
        <div className="flex min-w-0 flex-col gap-10 lg:gap-[52px]">
          {outcomeLines.length > 0 && (
            <Section title="What you'll be able to do">
              {outcomeLines.map((line) => (
                <p key={line} className={ROW}>
                  {line}
                </p>
              ))}
            </Section>
          )}

          {course.modules.length > 0 && (
            <Section title="What the course covers" aside={structure}>
              <ol>
                {course.modules.map((mod, index) => (
                  <li key={`${index}-${mod.title}`} className={`${ROW} grid grid-cols-[52px_minmax(0,1fr)_auto] items-baseline gap-2`}>
                    <span className="ietc-display text-[26px] leading-none text-orange-text">{String(index + 1).padStart(2, "0")}</span>
                    <b className="font-bold">{mod.title}</b>
                    <span className="text-[14.5px] text-ink-soft">
                      {mod.lessonCount} {mod.lessonCount === 1 ? "lesson" : "lessons"}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {course.audience && (
            <Section title="Who it's for">
              <p className={ROW}>
                <span className="block max-w-[60ch]">{course.audience}</span>
              </p>
            </Section>
          )}

          {course.prerequisites && (
            <Section title="Before you start">
              <p className={ROW}>
                <span className="block max-w-[60ch]">{course.prerequisites}</span>
              </p>
            </Section>
          )}
        </div>

        <aside aria-labelledby="upcoming" className="rounded-[18px] bg-paper p-6 shadow-card max-lg:-order-1 lg:sticky lg:top-5">
          <h2 id="upcoming" className="ietc-display text-[25px] leading-none md:text-[28px]">
            Upcoming cohorts
          </h2>
          <div className="mt-3.5 empty:hidden">
            <CheckoutNotice notice={notice} />
          </div>
          {course.upcomingCohorts.length === 0 ? (
            <p className="mt-3 text-ink-soft">No dates are scheduled yet.</p>
          ) : (
            <CohortCards cohorts={course.upcomingCohorts} durationLabel={durationLabel} />
          )}
        </aside>
      </div>
    </article>
  );
}
