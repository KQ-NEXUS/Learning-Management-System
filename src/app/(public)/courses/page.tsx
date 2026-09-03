import Link from "next/link";
import { listPublicCourses } from "@/server/services/public-catalogue-service";

// ISR: anonymous reads stay fast (NFR-02); a listing/publish/archive action
// calls revalidatePath('/courses') so correctness is restored within one round
// trip. `next.config.ts` has cacheComponents off, so this is the ordinary model.
export const revalidate = 300;

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
