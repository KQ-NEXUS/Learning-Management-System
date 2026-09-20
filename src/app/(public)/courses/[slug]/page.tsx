import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { getPublicCourseBySlug } from "@/server/services/public-catalogue-service";
import { CohortCards, DELIVERY_MODE_LABEL } from "@/app/(public)/CohortCards";

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

/** A titled block: heading row (with an optional aside on the right) over an ink rule. */
function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between gap-4 pb-4">
        <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
        {aside && <span className="text-[13px] text-muted-foreground">{aside}</span>}
      </div>
      <div className="border-t border-foreground">{children}</div>
    </section>
  );
}

export default async function PublicCourseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

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

  // The facts strip in the navy band: only what this course actually has.
  const facts: [string, string][] = [];
  if (durationLabel) facts.push(["Duration", durationLabel]);
  if (course.modules.length > 0)
    facts.push(["Structure", `${course.modules.length} ${course.modules.length === 1 ? "module" : "modules"}, ${lessonTotal} ${lessonTotal === 1 ? "lesson" : "lessons"}`]);
  if (nextCohort) facts.push(["Format", DELIVERY_MODE_LABEL[nextCohort.deliveryMode] ?? nextCohort.deliveryMode]);
  if (course.certificateEnabled) facts.push(["On completion", "Certificate"]);

  return (
    <article className="flex flex-col gap-6">
      <LearnerPageHeader
        size="display"
        title={course.title}
        subtitle={course.summary ?? undefined}
        back={{ label: "Back to courses", href: "/courses" }}
        band={
          facts.length > 0 ? (
            <dl className="grid grid-cols-2 gap-y-5 md:grid-cols-4">
              {facts.map(([label, value], i) => (
                <div
                  key={label}
                  className={`min-w-0 ${i === 0 ? "" : "md:border-l md:border-sidebar-line md:pl-6"} ${
                    i % 2 === 1 ? "pl-4" : ""
                  }`}
                >
                  <dt className="text-[13px] text-sidebar-soft">{label}</dt>
                  <dd className="mt-1 text-base font-semibold break-words text-white">{value}</dd>
                </div>
              ))}
            </dl>
          ) : undefined
        }
      />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-14 lg:pr-16">
          {outcomeLines.length > 0 && (
            <Section title="What you'll be able to do">
              {outcomeLines.map((line) => (
                <p key={line} className="border-b border-border py-4 text-base text-foreground">
                  {line}
                </p>
              ))}
            </Section>
          )}

          {course.modules.length > 0 && (
            <Section
              title="What the course covers"
              aside={`${course.modules.length} ${course.modules.length === 1 ? "module" : "modules"}, ${lessonTotal} ${
                lessonTotal === 1 ? "lesson" : "lessons"
              }`}
            >
              <ol>
                {course.modules.map((mod, index) => (
                  <li
                    key={`${index}-${mod.title}`}
                    className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 border-b border-border py-5"
                  >
                    <span className="pt-1 font-mono font-medium text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="text-base font-semibold text-foreground">{mod.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {mod.lessonCount} {mod.lessonCount === 1 ? "lesson" : "lessons"}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {course.audience && (
            <Section title="Who it's for">
              <p className="border-b border-border py-4 text-base text-foreground">
                <span className="block max-w-[60ch]">{course.audience}</span>
              </p>
            </Section>
          )}

          {course.prerequisites && (
            <Section title="Before you start">
              <p className="border-b border-border py-4 text-base text-foreground">
                <span className="block max-w-[60ch]">{course.prerequisites}</span>
              </p>
            </Section>
          )}
        </div>

        <aside aria-label="Enrol" className="flex flex-col gap-7 lg:border-l lg:border-border lg:pl-10">
          <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
            Upcoming cohorts
          </h2>
          {course.upcomingCohorts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dates are scheduled yet.</p>
          ) : (
            <CohortCards cohorts={course.upcomingCohorts} durationLabel={durationLabel} />
          )}
        </aside>
      </div>
    </article>
  );
}
