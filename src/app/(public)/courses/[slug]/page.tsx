import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getPublicCourseBySlug } from "@/server/services/public-catalogue-service";

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
  // 404-safe: an unlisted slug must not throw here either.
  const course = await getPublicCourseBySlug(slug);
  if (!course) return { title: "Not found" };
  return { title: course.title, description: course.summary ?? undefined };
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

  const facts: [string, string][] = [];
  if (course.durationHours != null) facts.push(["Duration", `${course.durationHours} hours`]);
  if (course.audience) facts.push(["Who it's for", course.audience]);
  if (course.prerequisites) facts.push(["Prerequisites", course.prerequisites]);
  if (course.certificateEnabled) facts.push(["Certificate", "Awarded on completion"]);

  return (
    <article className="flex flex-col gap-6">
      <Link
        href="/courses"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-accent"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Back to courses
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="break-words text-[33px] font-semibold leading-[1.12]">{course.title}</h1>
        {course.summary && (
          <p className="max-w-prose text-sm text-muted-foreground">{course.summary}</p>
        )}
      </header>

      {course.outcomes && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What you&apos;ll be able to do
          </h2>
          <p className="max-w-prose whitespace-pre-line text-sm text-foreground">{course.outcomes}</p>
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upcoming dates</h2>
        {course.upcomingCohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dates are scheduled yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {course.upcomingCohorts.map((cohort, index) => (
              <li key={index}>Starts {formatDate(cohort.startsAt)}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
