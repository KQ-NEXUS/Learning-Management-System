import { notFound } from "next/navigation";
import { getPublicProgrammeBySlug } from "@/server/services/public-catalogue-service";

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

  // TOP-LEVEL await before any <Suspense>, so `notFound()` is a real 404 and
  // not a soft one (CAT-07). The experimental 403 helper is avoided — a 403 confirms existence.
  const programme = await getPublicProgrammeBySlug(slug);
  if (!programme) notFound();

  // A Programme has no such columns (plan
  // 04-02 kept its migration whole) — course-level details belong to the member
  // Courses, shown below instead.

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{programme.title}</h1>
        {programme.summary && <p className="max-w-prose text-zinc-700">{programme.summary}</p>}
      </header>

      {programme.outcomes && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            What you&apos;ll be able to do
          </h2>
          <p className="max-w-prose whitespace-pre-line text-sm text-zinc-700">{programme.outcomes}</p>
        </section>
      )}

      {programme.audience && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">Who it&apos;s for</h2>
          <p className="max-w-prose text-sm text-zinc-700">{programme.audience}</p>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">Courses in this programme</h2>
        {programme.memberCourseTitles.length === 0 ? (
          <p className="text-sm text-zinc-500">No courses have been added yet.</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-zinc-700">
            {programme.memberCourseTitles.map((title, index) => (
              <li key={index}>{title}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">Upcoming dates</h2>
        {programme.upcomingCohorts.length === 0 ? (
          <p className="text-sm text-zinc-500">No dates are scheduled yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-zinc-700">
            {programme.upcomingCohorts.map((cohort, index) => (
              <li key={index}>Starts {formatDate(cohort.startsAt)}</li>
            ))}
          </ul>
        )}
      </section>

      {programme.certificateEnabled && (
        <p className="text-sm text-zinc-600">A certificate is awarded on completion.</p>
      )}
    </article>
  );
}
