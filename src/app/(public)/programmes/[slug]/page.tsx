import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { notFound } from "next/navigation";
import { getPublicProgrammeBySlug } from "@/server/services/public-catalogue-service";
import { CohortCards, DELIVERY_MODE_LABEL } from "@/app/(public)/CohortCards";
import { FactsStrip, ROW, Section } from "@/components/site/Section";

// Rendered per request, never prerendered — the Docker builder has no
// DATABASE_URL (04-15 planner fallback; 04-10 `docker build` requirement).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const programme = await getPublicProgrammeBySlug(slug);
  if (!programme) return { title: "Not found" };
  return { title: programme.title, description: programme.summary ?? undefined };
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
    <article className="flex flex-col">
      <LearnerPageHeader
        tint="bg-tint-2"
        title={programme.title}
        subtitle={programme.summary ?? undefined}
        back={{ label: "Back to programmes", href: "/programmes" }}
        band={<FactsStrip facts={facts} />}
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

          <Section
            title="Courses in this programme"
            aside={programme.memberCourseTitles.length > 0 ? `${programme.memberCourseTitles.length} ${programme.memberCourseTitles.length === 1 ? "course" : "courses"}` : undefined}
          >
            {programme.memberCourseTitles.length === 0 ? (
              <p className={`${ROW} text-ink-soft`}>No courses have been added yet.</p>
            ) : (
              <ol>
                {programme.memberCourseTitles.map((title, index) => (
                  <li key={`${index}-${title}`} className={`${ROW} grid grid-cols-[52px_minmax(0,1fr)] items-baseline gap-2`}>
                    <span className="ietc-display text-[26px] leading-none text-orange-text">{String(index + 1).padStart(2, "0")}</span>
                    <b className="font-bold">{title}</b>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {programme.audience && (
            <Section title="Who it's for">
              <p className={ROW}>
                <span className="block max-w-[60ch]">{programme.audience}</span>
              </p>
            </Section>
          )}
        </div>

        <aside aria-labelledby="upcoming" className="rounded-[18px] bg-paper p-6 shadow-card max-lg:-order-1 lg:sticky lg:top-5">
          <h2 id="upcoming" className="ietc-display text-[25px] leading-none md:text-[28px]">
            Upcoming cohorts
          </h2>
          {programme.upcomingCohorts.length === 0 ? (
            <p className="mt-3 text-ink-soft">No dates are scheduled yet.</p>
          ) : (
            <CohortCards cohorts={programme.upcomingCohorts} />
          )}
        </aside>
      </div>
    </article>
  );
}
