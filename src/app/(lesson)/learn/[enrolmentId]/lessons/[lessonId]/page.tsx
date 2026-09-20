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
import {
  countLessonsRelockedBy,
  getOwnWatchProgress,
} from "@/server/services/lesson-progress-service";
import { LessonContent } from "@/components/catalogue/LessonContent";
import { LessonCompleteControl } from "@/components/learner/LessonCompleteControl";
import { LessonOutline } from "@/components/learner/LessonOutline";
import { LessonFrame } from "@/components/learner/LessonFrame";
import { VideoWatchTracker } from "@/components/learner/VideoWatchTracker";
import { QuizAttemptPanel } from "@/components/learner/QuizAttemptPanel";
import { AssignmentSubmissionPanel } from "@/components/learner/AssignmentSubmissionPanel";
import { loadLearnerQuiz } from "@/server/services/learner-quiz-service";
import { loadAssignmentSubmissionView } from "./submission-actions";

/**
 * `/learn/[enrolmentId]/lessons/[lessonId]` (LRN-03/04/05, 09-11 Task 1) —
 * the lesson reading pane: `LessonContent` rendered unchanged (DD-25), the
 * server-side `assertLessonOpenable` gate BEFORE any content read (LRN-02,
 * T-09-34), prev/next wayfinding that never links into a locked lesson, and
 * the manual mark-complete/undo control.
 *
 * Content column is constrained to `max-w-[720px]` — no narrower, since
 * `LessonContent` already assumes `max-w-2xl` for embedded media/images.
 *
 * 09-12 Task 3: for a VIDEO lesson ALONE (`lesson.type === "VIDEO"`, never
 * `allowManualComplete` — DD-16's two completion gates stay independent, so
 * a VIDEO lesson may render both the auto-tracker and the manual control),
 * `LessonContent` is wrapped in `VideoWatchTracker` with the learner's own
 * stored watch position (`getOwnWatchProgress`, 0 when no row exists yet).
 * Every other lesson type renders `LessonContent` exactly as 09-11 left it.
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
      <LessonFrame backHref={`/learn/${enrolmentId}`} backLabel="Back to course">
        <div className="flex flex-col gap-2 border-t border-foreground py-12">
          <p className="text-base font-semibold text-foreground">Your access window has ended</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            You can no longer open lesson content, but your progress and results stay on record.
          </p>
        </div>
      </LessonFrame>
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
  const quiz = content.type === "QUIZ" ? await loadLearnerQuiz(actor, { enrolmentId, lessonId }) : null;
  const assignment =
    content.type === "ASSIGNMENT" && content.assessmentId
      ? await loadAssignmentSubmissionView({ assessmentId: content.assessmentId, enrolmentId })
      : null;

  const isVideoLesson = content.type === "VIDEO";
  const initialSecondsWatched = isVideoLesson
    ? ((await getOwnWatchProgress(actor, { enrolmentId, lessonId }))?.secondsWatched ?? 0)
    : 0;

  const lessonContent = (
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
  );

  const outlineCourses = path.courses.map((course) => ({
    id: course.courseId,
    title: course.courseTitle,
    modules: course.modules.map((mod) => ({
      id: mod.id,
      title: mod.title,
      lessons: mod.lessons.map((l) => ({ id: l.id, title: l.title, completed: l.completed, locked: l.locked })),
    })),
  }));

  // Position within the module ("Lesson 1 of 3") and overall required-lesson progress for the header.
  let moduleTitle = current.moduleTitle;
  let lessonNumber = 1;
  let lessonsInModule = 1;
  let requiredTotal = 0;
  let requiredDone = 0;
  for (const course of path.courses) {
    for (const mod of course.modules) {
      const at = mod.lessons.findIndex((l) => l.id === lessonId);
      if (at >= 0) {
        moduleTitle = mod.title;
        lessonNumber = at + 1;
        lessonsInModule = mod.lessons.length;
      }
      for (const l of mod.lessons) {
        if (l.required) {
          requiredTotal += 1;
          if (l.completed) requiredDone += 1;
        }
      }
    }
  }

  const NAV_BTN =
    "inline-flex min-h-[46px] items-center gap-2 rounded-md border border-input-border bg-surface px-5 text-sm font-semibold text-foreground hover:bg-surface-2";
  const NAV_BTN_PRIMARY =
    "inline-flex min-h-[46px] items-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep";
  const NAV_BTN_OFF = "inline-flex min-h-[46px] items-center gap-2 px-5 text-sm text-muted-foreground";

  return (
    <LessonFrame
      backHref={`/learn/${enrolmentId}`}
      backLabel={current.courseTitle}
      progress={requiredTotal > 0 ? { done: requiredDone, total: requiredTotal } : undefined}
      outline={<LessonOutline enrolmentId={enrolmentId} courses={outlineCourses} currentLessonId={lessonId} />}
    >
      <p className="text-sm text-muted-foreground">
        {moduleTitle ? `${moduleTitle} · ` : ""}Lesson {lessonNumber} of {lessonsInModule}
      </p>
      <h1 className="text-[36px] leading-[1.06] font-bold tracking-[-0.04em] break-words text-foreground md:text-[48px]">
        {content.title}
      </h1>

      {isVideoLesson ? (
        <VideoWatchTracker
          enrolmentId={enrolmentId}
          lessonId={lessonId}
          initialSecondsWatched={initialSecondsWatched}
        >
          {lessonContent}
        </VideoWatchTracker>
      ) : (
        lessonContent
      )}

      {quiz && <QuizAttemptPanel {...quiz} enrolmentId={enrolmentId} lessonId={lessonId} />}
      {assignment && <AssignmentSubmissionPanel {...assignment} />}
      <LessonCompleteControl
        enrolmentId={enrolmentId}
        lessonId={lessonId}
        completed={openResult.lesson.completed}
        completedSource={openResult.lesson.completedSource}
        allowManualComplete={openResult.lesson.allowManualComplete}
        relockCount={relockCount}
      />

      <nav className="flex items-center justify-between pt-4 text-sm">
        {prev ? (
          <Link href={`/learn/${enrolmentId}/lessons/${prev.lesson.id}`} className={NAV_BTN}>
            ← Previous lesson
          </Link>
        ) : (
          <span className={NAV_BTN_OFF}>← Previous lesson</span>
        )}

        {/* "Next lesson" is NOT gated on this lesson's own completion
            (UI-SPEC 7.3) — only on the NEXT lesson actually being openable.
            A locked next lesson (or none — the last lesson) renders muted,
            non-interactive text with no href, never hidden. */}
        {next && !next.lesson.locked ? (
          <Link href={`/learn/${enrolmentId}/lessons/${next.lesson.id}`} className={NAV_BTN_PRIMARY}>
            Next lesson →
          </Link>
        ) : (
          <span className={NAV_BTN_OFF}>Next lesson →</span>
        )}
      </nav>
    </LessonFrame>
  );
}
