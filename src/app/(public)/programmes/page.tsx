import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { CourseCard } from "@/components/site/CourseCard";
import { listPublicProgrammes } from "@/server/services/public-catalogue-service";

// Rendered per request, never prerendered — the Docker builder has no
// DATABASE_URL (04-15 planner fallback; 04-10 `docker build` requirement).
export const dynamic = "force-dynamic";
export const metadata = { title: "Programmes" };

export default async function PublicProgrammesPage() {
  const programmes = await listPublicProgrammes();

  return (
    <div className="flex flex-col">
      <LearnerPageHeader title="Programmes" subtitle="Structured programmes made of several courses." />
      {programmes.length === 0 ? (
        <div className="border-t-2 border-ink py-8">
          <p className="ietc-display text-[25px] leading-none">No programmes are listed right now.</p>
          <p className="mt-2 text-ink-soft">New programmes are added through the year. Please check back soon.</p>
        </div>
      ) : (
        <div className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {programmes.map((programme) => (
            <CourseCard key={programme.slug} course={programme} href={`/programmes/${programme.slug}`} />
          ))}
        </div>
      )}
    </div>
  );
}
