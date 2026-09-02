/**
 * The frozen-obligation payload builder and the unpublished-changes
 * detector (D-01 through D-07).
 *
 * D-05's requirement is "protected from silent REQUIREMENT changes" — it
 * guards a learner's obligations, not typo fixes. Prose (a lesson's title
 * or body) stays live for everyone at every version; only the *rules* a
 * learner is bound to ever freeze. Adding a title field to this payload
 * would silently convert every typo fix into a version bump, which is
 * exactly the failure D-05 exists to prevent.
 *
 * This module is PURE: no data-access import, no framework import. It
 * takes a plain aggregate in and returns a value out, which is what lets
 * a later authorized transaction and a later Server Component both call it
 * from one implementation instead of two that can drift apart.
 */

/** The current shape version written to `payloadSchema` on every publish row. */
export const OBLIGATION_PAYLOAD_SCHEMA = 1;

// ---------------------------------------------------------------------------
// Structural input types — deliberately NOT imported from a data-access
// layer. Any object with this shape (however it was loaded) satisfies them.
// ---------------------------------------------------------------------------

export type ObligationLessonInput = {
  id: string;
  position: number;
  required: boolean;
  type: string;
  assessmentId: string | null;
  withdrawnAt: Date | string | null;
};

export type ObligationModuleInput = {
  id: string;
  position: number;
  withdrawnAt: Date | string | null;
  lessons: ObligationLessonInput[];
};

export type ObligationCourseInput = {
  status: string;
  completionRule: unknown;
  completionRuleVersion: number;
  modules: ObligationModuleInput[];
};

export type ObligationProgrammeCourseInput = {
  courseId: string;
  position: number;
};

export type ObligationProgrammeInput = {
  status: string;
  sequential: boolean;
  completionRule: unknown;
  completionRuleVersion: number;
  courses: ObligationProgrammeCourseInput[];
};

// ---------------------------------------------------------------------------
// Output payload shapes — this IS the full specification of what freezes.
// If a field isn't here, it must never be added without a payloadSchema
// bump: a stray field here would silently widen every future comparison.
// ---------------------------------------------------------------------------

export type CourseObligationLesson = {
  id: string;
  position: number;
  required: boolean;
  type: string;
  assessmentId: string | null;
};

export type CourseObligationModule = {
  id: string;
  position: number;
  lessons: CourseObligationLesson[];
};

export type CourseObligationPayload = {
  schema: number;
  completionRule: unknown;
  completionRuleVersion: number;
  modules: CourseObligationModule[];
};

export type ProgrammeObligationCourse = {
  courseId: string;
  position: number;
};

export type ProgrammeObligationPayload = {
  schema: number;
  sequential: boolean;
  completionRule: unknown;
  completionRuleVersion: number;
  courses: ProgrammeObligationCourse[];
};

function byPositionThenId<T extends { position: number; id: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Builds the frozen Course obligation tree.
 *
 * Sorts modules and lessons by `position` then `id` before emitting, so the
 * caller's own array order (whatever a database round-trip happened to
 * return) can never affect the result — an incidental query-order change
 * must never look like a requirement change.
 *
 * Withdrawn modules and lessons (non-null `withdrawnAt`) are excluded: a
 * withdrawal IS itself an obligation change (D-07), captured the moment it
 * happens by simply no longer appearing here. An older, already-published
 * payload that predates the withdrawal keeps the entry — this function
 * only ever builds a fresh tree from the current, live aggregate.
 */
export function buildCourseObligationTree(course: ObligationCourseInput): CourseObligationPayload {
  const modules = course.modules
    .filter((moduleRow) => moduleRow.withdrawnAt == null)
    .slice()
    .sort(byPositionThenId)
    .map((moduleRow) => ({
      id: moduleRow.id,
      position: moduleRow.position,
      lessons: moduleRow.lessons
        .filter((lessonRow) => lessonRow.withdrawnAt == null)
        .slice()
        .sort(byPositionThenId)
        .map((lessonRow) => ({
          id: lessonRow.id,
          position: lessonRow.position,
          required: lessonRow.required,
          type: lessonRow.type,
          assessmentId: lessonRow.assessmentId,
        })),
    }));

  return {
    schema: OBLIGATION_PAYLOAD_SCHEMA,
    completionRule: course.completionRule ?? null,
    completionRuleVersion: course.completionRuleVersion,
    modules,
  };
}

/**
 * Builds the frozen Programme obligation tree (D-04: identical treatment to
 * Course). Only `courseId` and `position` ever appear per member course —
 * never a course's own title, which lives on the Course row and is never
 * part of any snapshot.
 */
export function buildProgrammeObligationTree(programme: ObligationProgrammeInput): ProgrammeObligationPayload {
  const courses = programme.courses
    .slice()
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0;
    })
    .map((courseRow) => ({ courseId: courseRow.courseId, position: courseRow.position }));

  return {
    schema: OBLIGATION_PAYLOAD_SCHEMA,
    sequential: programme.sequential,
    completionRule: programme.completionRule ?? null,
    completionRuleVersion: programme.completionRuleVersion,
    courses,
  };
}

/**
 * `true` when the aggregate's live obligations differ from the last
 * published payload. Because the builders above sort deterministically and
 * emit only the frozen facets, a canonical `JSON.stringify` comparison is
 * total — it needs no field-by-field structural diff to be correct.
 *
 * When there is no publication yet, "unpublished changes" reduces to "is
 * this a published aggregate at all" — a DRAFT aggregate that has never
 * been published has nothing pinned to protect.
 */
export function hasUnpublishedObligationChanges(
  aggregate: ObligationCourseInput | ObligationProgrammeInput,
  latestPublicationPayload: CourseObligationPayload | ProgrammeObligationPayload | null,
): boolean {
  if (latestPublicationPayload === null) {
    return aggregate.status === "PUBLISHED";
  }

  const freshTree = "courses" in aggregate ? buildProgrammeObligationTree(aggregate) : buildCourseObligationTree(aggregate);

  return JSON.stringify(freshTree) !== JSON.stringify(latestPublicationPayload);
}

function isCourseObligationPayload(
  payload: CourseObligationPayload | ProgrammeObligationPayload,
): payload is CourseObligationPayload {
  return "modules" in payload;
}

function diffLessons(
  nextLessons: CourseObligationLesson[],
  previousLessons: CourseObligationLesson[],
): string[] {
  const changes: string[] = [];
  const previousById = new Map(previousLessons.map((lessonRow) => [lessonRow.id, lessonRow]));
  const nextById = new Map(nextLessons.map((lessonRow) => [lessonRow.id, lessonRow]));

  for (const [id, previousLesson] of previousById) {
    const nextLesson = nextById.get(id);
    if (!nextLesson) {
      changes.push(`lesson ${id} withdrawn`);
      continue;
    }
    if (nextLesson.position !== previousLesson.position) {
      changes.push(`lesson ${id} order ${previousLesson.position} -> ${nextLesson.position}`);
    }
    if (nextLesson.required !== previousLesson.required) {
      changes.push(`lesson ${id} required ${previousLesson.required} -> ${nextLesson.required}`);
    }
    if (nextLesson.assessmentId !== previousLesson.assessmentId) {
      changes.push(`lesson ${id} assessment changed`);
    }
    if (nextLesson.type !== previousLesson.type) {
      changes.push(`lesson ${id} type changed`);
    }
  }

  for (const id of nextById.keys()) {
    if (!previousById.has(id)) {
      changes.push(`lesson ${id} added`);
    }
  }

  return changes;
}

function diffCourseTrees(next: CourseObligationPayload, previous: CourseObligationPayload): string[] {
  const changes: string[] = [];

  if (
    JSON.stringify(next.completionRule) !== JSON.stringify(previous.completionRule) ||
    next.completionRuleVersion !== previous.completionRuleVersion
  ) {
    changes.push("completion rule changed");
  }

  const previousModules = new Map(previous.modules.map((moduleRow) => [moduleRow.id, moduleRow]));
  const nextModules = new Map(next.modules.map((moduleRow) => [moduleRow.id, moduleRow]));

  for (const [id, previousModule] of previousModules) {
    const nextModule = nextModules.get(id);
    if (!nextModule) {
      changes.push(`module ${id} withdrawn`);
      continue;
    }
    if (nextModule.position !== previousModule.position) {
      changes.push(`module ${id} order ${previousModule.position} -> ${nextModule.position}`);
    }
    changes.push(...diffLessons(nextModule.lessons, previousModule.lessons));
  }

  for (const id of nextModules.keys()) {
    if (!previousModules.has(id)) {
      changes.push(`module ${id} added`);
    }
  }

  return changes;
}

function diffProgrammeTrees(next: ProgrammeObligationPayload, previous: ProgrammeObligationPayload): string[] {
  const changes: string[] = [];

  if (next.sequential !== previous.sequential) {
    changes.push("sequential flag changed");
  }
  if (
    JSON.stringify(next.completionRule) !== JSON.stringify(previous.completionRule) ||
    next.completionRuleVersion !== previous.completionRuleVersion
  ) {
    changes.push("completion rule changed");
  }

  const previousCourses = new Map(previous.courses.map((courseRow) => [courseRow.courseId, courseRow]));
  const nextCourses = new Map(next.courses.map((courseRow) => [courseRow.courseId, courseRow]));

  for (const [courseId, previousCourse] of previousCourses) {
    const nextCourse = nextCourses.get(courseId);
    if (!nextCourse) {
      changes.push(`course ${courseId} removed`);
      continue;
    }
    if (nextCourse.position !== previousCourse.position) {
      changes.push(`course ${courseId} order ${previousCourse.position} -> ${nextCourse.position}`);
    }
  }

  for (const courseId of nextCourses.keys()) {
    if (!previousCourses.has(courseId)) {
      changes.push(`course ${courseId} added`);
    }
  }

  return changes;
}

/**
 * A human-readable list of what changed between two obligation trees of the
 * same kind (`"lesson les-1 order 2 -> 0"`, `"lesson les-1 required true ->
 * false"`, `"module mod-2 withdrawn"`, `"completion rule changed"`). The
 * publish dialog shows this so staff can see WHY the unpublished-changes
 * banner is up — kept descriptive, not clever.
 */
export function diffObligationTrees(
  next: CourseObligationPayload | ProgrammeObligationPayload,
  previous: CourseObligationPayload | ProgrammeObligationPayload,
): string[] {
  if (isCourseObligationPayload(next) && isCourseObligationPayload(previous)) {
    return diffCourseTrees(next, previous);
  }
  if (!isCourseObligationPayload(next) && !isCourseObligationPayload(previous)) {
    return diffProgrammeTrees(next, previous);
  }
  return ["obligation tree kind changed"];
}
