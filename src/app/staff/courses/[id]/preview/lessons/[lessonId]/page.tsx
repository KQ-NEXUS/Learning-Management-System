import { notFound } from "next/navigation";
import Link from "next/link";
import { Eye } from "lucide-react";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import {
  lessonService,
  loadCourseTree,
  type LessonRecord,
} from "@/server/services/lesson-service";
import { listLessonResources } from "@/server/services/lesson-resource-service";
import { LessonContent } from "@/components/catalogue/LessonContent";

export const metadata = { title: "Learner view preview" };

/**
 * The LEARNER lesson-view preview (D-13). Renders `LessonContent` inside the
 * module/lesson navigation a learner would have. Withdrawn lessons render
 * read-only with their marker rather than being hidden, so staff can see what
 * a pinned cohort still sees (D-03). Staff-gated on `courses.view`; a denial
 * maps to `notFound()`, never a 403. It is a staff-session surface with no shareable link.
 */

export default async function LearnerLessonPreviewPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const { id, lessonId } = await params;

  let lesson: LessonRecord | null;
  let tree: Awaited<ReturnType<typeof loadCourseTree>>;
  let resources: Awaited<ReturnType<typeof listLessonResources>>;
  try {
    // `courseService.get` establishes courses.view on the parent; both
    // sub-loads inherit the same scope.
    if (!(await courseService.get(id))) notFound();
    lesson = (await lessonService.get(lessonId)) as unknown as LessonRecord | null;
    tree = await loadCourseTree(id);
    resources = await listLessonResources(lessonId);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) notFound();
    throw error;
  }

  if (!lesson || !tree) notFound();

  // Flatten the tree to place this lesson and find its neighbours. A lesson
  // that is not in this course's tree (wrong course id, or withdrawn and
  // therefore absent) still renders, but without prev/next.
  const flat = tree.modules.flatMap((moduleRow) =>
    moduleRow.lessons.map((l) => ({ ...l, moduleTitle: moduleRow.title })),
  );
  const index = flat.findIndex((l) => l.id === lessonId);
  const prev = index > 0 ? flat[index - 1] : null;
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;
  const moduleTitle = index >= 0 ? flat[index].moduleTitle : null;

  const previewResources = resources.map((resource) => ({
    id: resource.id,
    title: resource.title,
    filename: resource.filename,
    mimeType: resource.mimeType,
    sizeBytes: resource.sizeBytes.toString(),
    scanStatus: resource.scanStatus,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex w-full items-start gap-2 rounded-md border border-border bg-surface-2 px-4 py-2.5">
        <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">
            Preview — the learner view of this lesson.
          </p>
          <Link
            href={`/staff/courses/${id}/preview`}
            className="w-fit text-xs text-accent underline underline-offset-2"
          >
            Back to the public page preview
          </Link>
        </div>
      </div>

      <header className="flex flex-col gap-1">
        {moduleTitle && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {moduleTitle}
          </p>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{lesson.title}</h1>
      </header>

      <LessonContent
        lesson={{
          id: lesson.id,
          title: lesson.title,
          type: lesson.type,
          body: lesson.body,
          embedUrl: lesson.embedUrl,
          linkUrl: lesson.linkUrl,
          withdrawnAt: lesson.withdrawnAt,
        }}
        resources={previewResources}
      />

      <nav className="flex items-center justify-between border-t border-border pt-4 text-sm">
        {prev ? (
          <Link
            href={`/staff/courses/${id}/preview/lessons/${prev.id}`}
            className="text-accent underline underline-offset-2"
          >
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/staff/courses/${id}/preview/lessons/${next.id}`}
            className="text-accent underline underline-offset-2"
          >
            {next.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
