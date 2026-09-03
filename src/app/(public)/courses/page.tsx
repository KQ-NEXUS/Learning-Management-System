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
      <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
      {courses.length === 0 ? (
        <p className="text-sm text-zinc-600">No courses are listed right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {courses.map((course) => (
            <li key={course.slug} className="border border-zinc-200 p-4">
              <Link
                href={`/courses/${course.slug}`}
                className="text-lg font-medium text-accent underline underline-offset-2"
              >
                {course.title}
              </Link>
              {course.summary && (
                <p className="mt-1 max-w-prose text-sm text-zinc-600">{course.summary}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
