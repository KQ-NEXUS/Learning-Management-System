import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  loadLearnerPath,
  assertLessonOpenable,
  type LearnerPath,
  type DecoratedLesson,
} from "@/server/services/learner-access";
import { getLessonContentForLearner } from "@/server/services/lesson-service";
import { listLessonResourcesForLearner } from "@/server/services/lesson-resource-service";
import { countLessonsRelockedBy } from "@/server/services/lesson-progress-service";
import { LessonContent } from "@/components/catalogue/LessonContent";
import { LessonCompleteControl } from "@/components/learner/LessonCompleteControl";

/**
 * `/learn/[enrolmentId]/lessons/[lessonId]` (LRN-03/04/05, 09-11 Task 1) —
 * the lesson reading pane: `LessonContent` rendered unchanged (DD-25), the
 * server-side `assertLessonOpenable` gate BEFORE any content read (LRN-02,
 * T-09-34), prev/next wayfinding that never links into a locked lesson, and
 * the manual mark-complete/undo control.
 *
 * Content column is constrained to `max-w-[720px]` — no narrower, since
 * `LessonContent` already assumes `max-w-2xl` for embedded media/images.
 */

export const metadata = { title: "Lesson" };

type FlatLessonEntry = {
  lesson: DecoratedLesson;
  courseTitle: string;
  moduleTitle: string;
};

/** Flattens `path.courses` in the same course -> module -> lesson order
 *  `loadLearnerPath` already sorted by pinned position — this file performs
 *  no sequencing computation of its own (DD-21's convention, applied here). */
function flattenPath(path: LearnerPath): FlatLessonEntry[] {
  const flat: FlatLessonEntry[] = [];
  for (const course of path.courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        flat.push({ lesson, courseTitle: course.courseTitle, moduleTitle: mod.title });
      }
    }
  }
  return flat;
}

export default async function LessonReadingPage({
  params,
}: {
  params: Promise<{ enrolmentId: string; lessonId: string }>;
}) {
  const { enrolmentId, lessonId } = await params;

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const path = await loadLearnerPath(actor, enrolmentId);
  if (!path) notFound();

  const openResult = assertLessonOpenable(path, lessonId);
  if (!openResult.ok) {
    // "not-found" and "locked" both resolve to notFound() — a learner who
    // typed the URL for a locked lesson learns nothing they could not
    // already see on the list page, and a distinct "locked" screen here
    // would be a second lock surface to keep in sync (T-09-34).
    if (openResult.reason !== "access-window-closed") notFound();

    // D-03's ended-access panel renders INSTEAD of content — no lesson
    // title, module structure, or body text leaks through this branch
    // (T-09-38).
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
        <Link
          href={`/learn/${enrolmentId}`}
          className="w-fit text-sm text-accent underline underline-offset-2"
        >
          ← Back to course
        </Link>
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-6 py-12 shadow-card">
          <p className="text-sm font-semibold text-foreground">Your access window has ended</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            You can no longer open lesson content, but your progress and results stay on record.
          </p>
        </div>
      </div>
    );
  }

  // The full content body (`body`/`embedUrl`/`linkUrl`) lives on the LIVE
  // Lesson row, not on `learner-access.ts`'s decorated (obligation-focused)
  // lesson — see `getLessonContentForLearner`'s own doc comment for why.
  const content = await getLessonContentForLearner(actor, lessonId);
  if (!content) notFound();

  const flat = flattenPath(path);
  const index = flat.findIndex((entry) => entry.lesson.id === lessonId);
  const current = flat[index];
  const prev = index > 0 ? flat[index - 1] : null;
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;

  const resources = await listLessonResourcesForLearner(actor, lessonId);
  const shapedResources = resources.map((resource) => ({
    id: resource.id,
    title: resource.title,
    filename: resource.filename,
    mimeType: resource.mimeType,
    // The column is a BigInt — never a JSON number (`LessonContentResource`'s
    // own doc comment), shaped exactly as the staff preview page does.
    sizeBytes: resource.sizeBytes.toString(),
    uploadStatus: resource.uploadStatus,
  }));

  const relockCount = countLessonsRelockedBy(path, lessonId);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href={`/learn/${enrolmentId}`}
          className="w-fit text-sm text-accent underline underline-offset-2"
        >
          ← {current.courseTitle}
        </Link>
        {current.moduleTitle && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {current.moduleTitle}
          </p>
        )}
        <h1 className="text-[25px] font-semibold leading-[1.2] text-foreground">{content.title}</h1>
      </header>

      <LessonContent
        lesson={{
          id: content.id,
          title: content.title,
          type: content.type,
          body: content.body,
          embedUrl: content.embedUrl,
          linkUrl: content.linkUrl,
          withdrawnAt: content.withdrawnAt,
        }}
        resources={shapedResources}
      />

      <LessonCompleteControl
        enrolmentId={enrolmentId}
        lessonId={lessonId}
        completed={openResult.lesson.completed}
        completedSource={openResult.lesson.completedSource}
        allowManualComplete={openResult.lesson.allowManualComplete}
        relockCount={relockCount}
      />

      <nav className="flex items-center justify-between border-t border-border pt-4 text-sm">
        {prev ? (
          <Link
            href={`/learn/${enrolmentId}/lessons/${prev.lesson.id}`}
            className="text-accent underline underline-offset-2"
          >
            ← Previous lesson
          </Link>
        ) : (
          <span className="text-muted-foreground">← Previous lesson</span>
        )}

        {/* "Next lesson" is NOT gated on this lesson's own completion
            (UI-SPEC 7.3) — only on the NEXT lesson actually being openable.
            A locked next lesson (or none — the last lesson) renders muted,
            non-interactive text with no href, never hidden. */}
        {next && !next.lesson.locked ? (
          <Link
            href={`/learn/${enrolmentId}/lessons/${next.lesson.id}`}
            className="text-accent underline underline-offset-2"
          >
            Next lesson →
          </Link>
        ) : (
          <span className="text-muted-foreground">Next lesson →</span>
        )}
      </nav>
    </div>
  );
}
