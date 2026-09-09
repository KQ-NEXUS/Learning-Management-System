import Link from "next/link";
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

export default async function PublicCoursesPage() {
  const courses = await listPublicCourses();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] font-semibold leading-tight">Courses</h1>
      {courses.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-6 py-12 text-sm text-muted-foreground shadow-card">
          No courses are listed right now.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {courses.map((course) => (
            <li
              key={course.slug}
              className="flex min-h-32 min-w-0 flex-col rounded-xl border border-border bg-surface p-6 shadow-card"
            >
              <Link
                href={`/courses/${course.slug}`}
                className="break-words text-sm font-semibold text-accent underline underline-offset-2"
              >
                {course.title}
              </Link>
              {course.summary && (
                <p className="mt-2 max-w-prose break-words text-sm text-muted-foreground">
                  {course.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
