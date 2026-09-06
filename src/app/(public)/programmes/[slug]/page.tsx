import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getPublicProgrammeBySlug } from "@/server/services/public-catalogue-service";

// Rendered per request, never prerendered — the Docker builder has no
// DATABASE_URL (04-15 planner fallback; 04-10 `docker build` requirement).
export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

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

  // A Programme has no such columns (plan
  // 04-02 kept its migration whole) — course-level details belong to the member
  // Courses, shown below instead.

  const facts: [string, string][] = [];
  if (programme.audience) facts.push(["Who it's for", programme.audience]);
  if (programme.certificateEnabled) facts.push(["Certificate", "Awarded on completion"]);

  return (
    <article className="flex flex-col gap-6">
      <Link
        href="/programmes"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-accent"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Back to programmes
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="break-words text-[33px] font-semibold leading-[1.12]">{programme.title}</h1>
        {programme.summary && (
          <p className="max-w-prose text-sm text-muted-foreground">{programme.summary}</p>
        )}
      </header>

      {programme.outcomes && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What you&apos;ll be able to do
          </h2>
          <p className="max-w-prose whitespace-pre-line text-sm text-foreground">
            {programme.outcomes}
          </p>
        </section>
      )}

      {facts.length > 0 && (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs"
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="break-words text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Courses in this programme
        </h2>
        {programme.memberCourseTitles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses have been added yet.</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-foreground">
            {programme.memberCourseTitles.map((title, index) => (
              <li key={index}>{title}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upcoming dates</h2>
        {programme.upcomingCohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dates are scheduled yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {programme.upcomingCohorts.map((cohort, index) => (
              <li key={index}>Starts {formatDate(cohort.startsAt)}</li>
            ))}
          </ul>
        )}
      </section>

    </article>
  );
}
