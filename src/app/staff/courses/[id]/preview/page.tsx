import { notFound } from "next/navigation";
import Link from "next/link";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import { loadCourseTree } from "@/server/services/lesson-service";

export const metadata = { title: "Public page preview" };

/**
 * The PUBLIC sales-page preview (D-13). It shows exactly what an anonymous
 * visitor would see, but is reached through the staff area and gated on
 * `courses.view` in scope — it is a staff-session surface with no shareable
 * links. An `AuthorizationError` maps to `notFound()`; a 403 would confirm the
 * record exists.
 */

type Course = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  prerequisites: string | null;
  durationHours: number | null;
  status: string;
  publiclyListed: boolean;
};

export default async function CoursePublicPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let course: Course | null;
  let tree: Awaited<ReturnType<typeof loadCourseTree>>;
  try {
    course = (await courseService.get(id)) as unknown as Course | null;
    if (!course) notFound();
    tree = await loadCourseTree(id);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) notFound();
    throw error;
  }

  const facts: [string, string][] = [
    course.durationHours != null ? ["Duration", `${course.durationHours} hours`] : null,
    course.audience ? ["Who it's for", course.audience] : null,
    course.prerequisites ? ["Prerequisites", course.prerequisites] : null,
  ].filter((x): x is [string, string] => x !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 px-4 py-3">
        <p className="text-sm font-semibold text-warning">
          Preview — this is how the public page will look. It is not the live page.
        </p>
        {!course.publiclyListed && (
          <p className="text-xs text-muted-foreground">
            This course is <strong>not publicly listed</strong>, so this page is not reachable by
            visitors yet — previewing an unlisted course is the ordinary case.
          </p>
        )}
        <Link
          href={`/staff/courses/${id}`}
          className="w-fit text-xs text-accent underline underline-offset-2"
        >
          Back to the course workspace
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        <p className="font-mono text-[11px] text-muted-foreground">{course.slug}</p>
        <h1 className="break-words text-[33px] font-semibold leading-[1.12]">{course.title}</h1>
        {course.summary && <p className="max-w-prose text-sm text-muted-foreground">{course.summary}</p>}
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
            <div key={label} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="break-words text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Course content</h2>
        {!tree || tree.modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content published yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {tree.modules.map((moduleRow) => (
              <li key={moduleRow.id} className="flex flex-col gap-1">
                <p className="text-sm font-semibold">{moduleRow.title}</p>
                <ul className="flex flex-col gap-0.5 pl-4">
                  {moduleRow.lessons.map((lesson) => (
                    <li key={lesson.id} className="flex items-baseline gap-2 text-sm">
                      <Link
                        href={`/staff/courses/${id}/preview/lessons/${lesson.id}`}
                        className="text-accent underline underline-offset-2"
                      >
                        {lesson.title}
                      </Link>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {lesson.type}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          Lesson links open the learner view preview. Upcoming cohort dates and pricing appear on the
          live public page (built in a later plan).
        </p>
      </section>
    </div>
  );
}
