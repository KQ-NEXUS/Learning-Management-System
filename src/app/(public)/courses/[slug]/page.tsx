import { notFound } from "next/navigation";
import { getPublicCourseBySlug } from "@/server/services/public-catalogue-service";

export const revalidate = 300;

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

  // TOP-LEVEL await, BEFORE any <Suspense> boundary in this file. Once the
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
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{course.title}</h1>
        {course.summary && <p className="max-w-prose text-zinc-700">{course.summary}</p>}
      </header>

      {course.outcomes && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            What you&apos;ll be able to do
          </h2>
          <p className="max-w-prose whitespace-pre-line text-sm text-zinc-700">{course.outcomes}</p>
        </section>
      )}

      {facts.length > 0 && (
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
              <dd className="text-sm text-zinc-700">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">Upcoming dates</h2>
        {course.upcomingCohorts.length === 0 ? (
          <p className="text-sm text-zinc-500">No dates are scheduled yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-zinc-700">
            {course.upcomingCohorts.map((cohort, index) => (
              <li key={index}>Starts {formatDate(cohort.startsAt)}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
