/**
 * The pure lesson-sequencing / prerequisite-lock evaluator (D-04, D-05,
 * D-06, LRN-02).
 *
 * PURE MODULE — no imports at all. Same discipline as `readiness-service.ts`
 * and `attendance-component.ts`: a data-access import here would put this
 * module on the worker import closure and break `tests/boundary.test.ts`.
 *
 * It has two consumers — the lesson-list page's rendered lock state and the
 * lesson-reading page's server-side access gate — and it must be callable
 * from both without dragging either in. A UI-only copy of this walk would
 * leave the server-side gate unenforced (LRN-02 requires enforcement, not
 * just display); a second, independently-written copy inside the server
 * gate would eventually drift from what the lesson-list page renders,
 * showing a lesson as unlocked while the server still refuses it (or the
 * reverse). One function, two call sites.
 */

export type SequencingLesson = {
  id: string;
  title: string;
  required: boolean;
  position: number;
  moduleId: string;
  /** A non-null value excludes the lesson from the walk entirely (D-17). */
  withdrawnAt: Date | string | null;
};

export type SequencingResult = {
  lessonId: string;
  locked: boolean;
  /** The blocking lesson's title (D-06) — never a position, never a generic string. */
  blockingLessonTitle: string | null;
};

function byPositionThenId(a: SequencingLesson, b: SequencingLesson): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Walks every non-withdrawn lesson across the WHOLE course (D-05 — a single
 * global path, not per-module), sorted by `position` ascending then `id`
 * ascending as a tiebreak. The first `required: true` lesson that is not yet
 * in `completedLessonIds` becomes the blocker for every lesson after it;
 * once set, that blocker is never overwritten by a later incomplete
 * required lesson — only completing IT clears it (D-04, D-06).
 *
 * Does not sort mutably: the input array is copied before sorting (the same
 * discipline `publication.ts`'s `buildCourseObligationTree` uses), so a
 * caller's own array order can never be affected by calling this function.
 */
export function evaluateLessonSequencing(
  courseLessons: SequencingLesson[],
  completedLessonIds: ReadonlySet<string>,
): SequencingResult[] {
  const ordered = courseLessons
    .filter((lesson) => lesson.withdrawnAt == null)
    .slice()
    .sort(byPositionThenId);

  let blockingLessonTitle: string | null = null;

  return ordered.map((lesson) => {
    const result: SequencingResult = {
      lessonId: lesson.id,
      locked: blockingLessonTitle !== null,
      blockingLessonTitle,
    };

    if (blockingLessonTitle === null && lesson.required && !completedLessonIds.has(lesson.id)) {
      blockingLessonTitle = lesson.title;
    }

    return result;
  });
}

/**
 * The lesson-reading page's server-side access gate calls this. An unknown
 * lesson id (never evaluated, e.g. a guessed/stale id) is locked, never
 * open by default (T-09-13) — the absence of a result row must never read
 * as "no lock configured."
 */
export function isLessonUnlocked(results: SequencingResult[], lessonId: string): boolean {
  const result = results.find((r) => r.lessonId === lessonId);
  if (!result) return false;
  return !result.locked;
}
