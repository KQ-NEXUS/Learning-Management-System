import Link from "next/link";
import { notFound } from "next/navigation";
import { courseService } from "@/server/services/course-service";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { loadCourseTree } from "@/server/services/lesson-service";
import {
  loadCourseReadinessAggregate,
  getUnpublishedChangeSummary,
} from "@/server/services/publish-service";
import { evaluateCourseReadiness } from "@/server/services/readiness-service";
import { blockingCohorts } from "@/server/services/catalogue-guards";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { ReadinessPanel } from "@/components/catalogue/ReadinessPanel";
import { CourseDetailActions } from "@/components/catalogue/CourseDetailActions";

type Course = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  status: string;
  contentVersion: number;
  durationHours: number | null;
  certificateEnabled: boolean;
  publiclyListed: boolean;
};

const TONE: Record<string, "success" | "neutral" | "warning"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
};

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let course: Course | null;
  let tree: Awaited<ReturnType<typeof loadCourseTree>>;
  let readinessAggregate: Awaited<ReturnType<typeof loadCourseReadinessAggregate>>;
  let changeSummary: Awaited<ReturnType<typeof getUnpublishedChangeSummary>>;
  try {
    course = (await courseService.get(id)) as unknown as Course | null;
    if (!course) notFound();
    tree = await loadCourseTree(id);
    readinessAggregate = await loadCourseReadinessAggregate(id);
    changeSummary = await getUnpublishedChangeSummary(id);
  } catch (error) {
    // A denial must not confirm existence — same response as "not found".
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }

  if (!tree) notFound();

  // D-27: the page runs the one shared evaluator; the panel only draws its output.
  const readinessItems = evaluateCourseReadiness(readinessAggregate);

  const firstLessonId = tree.modules.flatMap((m) => m.lessons)[0]?.id ?? null;

  const [canPublishContent, canManageListing, affectedCohorts] = await Promise.all([
    can("courses.publish", { courseIds: [id] }),
    can("programmes.publish", { courseIds: [id] }),
    blockingCohorts({ courseId: id }),
  ]);

  const contentOutline =
    tree.modules.length === 0 ? (
      <p className="text-sm text-foreground">
        No modules yet.{" "}
        <Link
          href={`/staff/courses/${id}/arrange`}
          className="text-accent underline underline-offset-2"
        >
          Add the first module on the arrange screen.
        </Link>
      </p>
    ) : (
      <div className="flex flex-col gap-4">
        <Link
          href={`/staff/courses/${id}/arrange`}
          className="self-start text-xs text-accent underline underline-offset-2"
        >
          Arrange modules and lessons
        </Link>
        <ol className="flex flex-col gap-4">
          {tree.modules.map((moduleRow) => (
            <li key={moduleRow.id} className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold">{moduleRow.title}</p>
              {moduleRow.lessons.length === 0 ? (
                <p className="pl-4 text-xs text-warning">No lessons in this module yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 pl-4">
                  {moduleRow.lessons.map((lesson) => (
                    <li key={lesson.id} className="flex items-baseline gap-2 text-sm">
                      <Link
                        href={`/staff/courses/${id}/lessons/${lesson.id}`}
                        className="text-accent underline underline-offset-2"
                      >
                        {lesson.title}
                      </Link>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {lesson.type}
                      </span>
                      {lesson.required && (
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          required
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    );

  return (
    <DetailLayout
      breadcrumbs={[
        { label: "Workspace", href: "/staff/courses" },
        { label: "Courses", href: "/staff/courses" },
        { label: course.title },
      ]}
      title={course.title}
      identifier={course.slug}
      subtitle={course.summary}
      actions={
        <div className="flex flex-wrap items-start gap-2">
          <CourseDetailActions
            courseId={id}
            status={readinessAggregate.status}
            publiclyListed={readinessAggregate.publiclyListed}
            canPublishContent={canPublishContent}
            canManageListing={canManageListing}
            expectedUpdatedAt={readinessAggregate.updatedAt.toISOString()}
            readinessItems={readinessItems}
            unpublishedChanges={changeSummary.changes}
            affectedCohorts={affectedCohorts}
          />
          {/* D-13 preview surfaces (plan 04-14) — staff-gated, no shareable link. */}
          <Link
            href={`/staff/courses/${id}/preview`}
            className="rounded-md border border-input-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
          >
            Preview public page
          </Link>
          {firstLessonId && (
            <Link
              href={`/staff/courses/${id}/preview/lessons/${firstLessonId}`}
              className="rounded-md border border-input-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
            >
              Preview learner view
            </Link>
          )}
        </div>
      }
      badges={
        <>
          <StatusPill label={course.status} tone={TONE[course.status] ?? "neutral"} />
          {course.publiclyListed && <StatusPill label="Listed publicly" tone="accent" />}
          {course.certificateEnabled && (
            <StatusPill label="Certificate enabled" tone="accent" />
          )}
        </>
      }
      sections={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <DetailFacts
              facts={[
                { label: "Slug", value: course.slug, mono: true },
                { label: "Status", value: course.status },
                {
                  label: "Public listing",
                  value: course.publiclyListed ? "Listed" : "Not listed",
                },
                { label: "Version", value: course.contentVersion, mono: true },
                {
                  label: "Duration",
                  value: course.durationHours ? `${course.durationHours} h` : "—",
                  mono: true,
                },
                {
                  label: "Certificate",
                  value: course.certificateEnabled ? "Enabled" : "Disabled",
                },
              ]}
            />
          ),
        },
        {
          id: "readiness",
          label: "Readiness",
          content: (
            <div className="flex flex-col gap-4">
              {changeSummary.hasChanges && (
                <div
                  role="status"
                  className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 shadow-card"
                >
                  <p className="text-sm font-semibold text-warning">
                    This course has obligation changes that have not been published.
                  </p>
                  {changeSummary.changes.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-foreground">
                      {changeSummary.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <ReadinessPanel items={readinessItems} />
            </div>
          ),
        },
        {
          id: "content",
          label: "Content",
          content: contentOutline,
        },
        {
          id: "cohorts",
          label: "Cohorts",
          content: (
            <p className="text-sm text-foreground">
              Cohorts delivering this course appear here.
            </p>
          ),
        },
      ]}
    />
  );
}
