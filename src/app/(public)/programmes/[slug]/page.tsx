import type { ReactNode } from "react";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { notFound } from "next/navigation";
import { getPublicProgrammeBySlug } from "@/server/services/public-catalogue-service";
import { CohortCards, DELIVERY_MODE_LABEL } from "@/app/(public)/CohortCards";

// Rendered per request, never prerendered — the Docker builder has no
// DATABASE_URL (04-15 planner fallback; 04-10 `docker build` requirement).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const programme = await getPublicProgrammeBySlug(slug);
  if (!programme) return { title: "Not found" };
  return { title: programme.title, description: programme.summary ?? undefined };
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

export default async function PublicProgrammeDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // TOP-LEVEL await before any streaming boundary, so `notFound()` is a real 404 and
  // not a soft one (CAT-07). The experimental 403 helper is avoided — a 403 confirms existence.
  const programme = await getPublicProgrammeBySlug(slug);
  if (!programme) notFound();

  // A Programme has no duration/prerequisites columns (plan 04-02 kept its migration whole) —
  // course-level details belong to the member Courses, listed below instead.

  const nextCohort = programme.upcomingCohorts[0];
  const outcomeLines = (programme.outcomes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const facts: [string, string][] = [];
  facts.push(["Courses", String(programme.memberCourseTitles.length)]);
  if (nextCohort) facts.push(["Format", DELIVERY_MODE_LABEL[nextCohort.deliveryMode] ?? nextCohort.deliveryMode]);
  if (programme.certificateEnabled) facts.push(["On completion", "Certificate"]);

  return (
    <article className="flex flex-col gap-6">
      <LearnerPageHeader
        size="display"
        title={programme.title}
        subtitle={programme.summary ?? undefined}
        back={{ label: "Back to programmes", href: "/programmes" }}
        band={
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

          <Section
            title="Courses in this programme"
            aside={
              programme.memberCourseTitles.length > 0
                ? `${programme.memberCourseTitles.length} ${programme.memberCourseTitles.length === 1 ? "course" : "courses"}`
                : undefined
            }
          >
            {programme.memberCourseTitles.length === 0 ? (
              <p className="border-b border-border py-4 text-sm text-muted-foreground">
                No courses have been added yet.
              </p>
            ) : (
              <ol>
                {programme.memberCourseTitles.map((title, index) => (
                  <li
                    key={`${index}-${title}`}
                    className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 border-b border-border py-5"
                  >
                    <span className="pt-1 font-mono font-medium text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="text-base font-semibold text-foreground">{title}</div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {programme.audience && (
            <Section title="Who it's for">
              <p className="border-b border-border py-4 text-base text-foreground">
                <span className="block max-w-[60ch]">{programme.audience}</span>
              </p>
            </Section>
          )}
        </div>

        <aside aria-label="Enrol" className="flex flex-col gap-7 lg:border-l lg:border-border lg:pl-10">
          <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
            Upcoming cohorts
          </h2>
          {programme.upcomingCohorts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dates are scheduled yet.</p>
          ) : (
            <CohortCards cohorts={programme.upcomingCohorts} />
          )}
        </aside>
      </div>
    </article>
  );
}
