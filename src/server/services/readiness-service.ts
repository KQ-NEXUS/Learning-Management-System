/**
 * The single readiness evaluator (D-25, D-26, D-27).
 *
 * Pure module: no data-access import, no UI-framework import, no
 * authorization import. It has three consumers — the persistent panel on
 * the course detail page, the summary inside the listing dialog, and the
 * server-side refusal in the public-listing action — and it must be
 * callable from all three without dragging any of them in. A UI-only
 * evaluator would leave the server-side gate unenforced; a copy inside the
 * server action would drift from what staff see on screen. One function,
 * three call sites.
 */

/**
 * `NOT_YET_CHECKED` is a THIRD state — neither a grey PASS nor a grey FAIL.
 * The PXR's instruction is that a gap Phase 5/Phase 10 will fill must read
 * as a named gap, not be silently assumed to pass. It is easy to erode this
 * into a tick over time; it must not become one.
 */
export type ReadinessState = "PASS" | "FAIL" | "WARN" | "NOT_YET_CHECKED";

export type ReadinessCategory =
  | "Content"
  | "Schedule"
  | "Price"
  | "Capacity"
  | "Instructors"
  | "Completion";

export type ReadinessItem = {
  /** Stable identifier. The panel keys on it — never derive it from `label`. */
  id: string;
  category: ReadinessCategory;
  label: string;
  state: ReadinessState;
  detail?: string;
  blocking: boolean;
  deferredTo?: "Phase 5" | "Phase 10";
};

// ---------------------------------------------------------------------------
// Structural input types — no data-access import.
// ---------------------------------------------------------------------------

export type ReadinessLessonInput = {
  type: string;
  withdrawnAt: Date | string | null;
};

export type ReadinessModuleInput = {
  withdrawnAt: Date | string | null;
  lessons: ReadinessLessonInput[];
};

export type ReadinessCourseInput = {
  title: string | null;
  summary: string | null;
  outcomes: string | null;
  durationHours: number | null;
  prerequisites: string | null;
  status: string;
  upcomingCohortCount: number;
  modules: ReadinessModuleInput[];
};

export type ReadinessProgrammeInput = {
  title: string | null;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  status: string;
  courses: unknown[];
};

// A single boolean literal, reused wherever a Programme item needs to be
// blocking — kept out of the Course evaluator below so the block of four
// core Course blockers stays the only place the literal is written by hand.
const BLOCKING = true;

function hasNonWithdrawnLesson(moduleRow: ReadinessModuleInput): boolean {
  return moduleRow.lessons.some((lessonRow) => lessonRow.withdrawnAt == null);
}

function hasAssessmentLesson(modules: ReadinessModuleInput[]): boolean {
  return modules
    .filter((moduleRow) => moduleRow.withdrawnAt == null)
    .some((moduleRow) =>
      moduleRow.lessons.some(
        (lessonRow) => lessonRow.withdrawnAt == null && (lessonRow.type === "QUIZ" || lessonRow.type === "ASSIGNMENT"),
      ),
    );
}

/**
 * Evaluates a Course's readiness. Exactly four items carry a blocking flag
 * of true — `title`, `summary`, `modules`, `module-lessons`. Every other
 * item, however severe it looks, is advisory.
 */
export function evaluateCourseReadiness(course: ReadinessCourseInput): ReadinessItem[] {
  const liveModules = course.modules.filter((moduleRow) => moduleRow.withdrawnAt == null);

  const items: ReadinessItem[] = [
    { id: "title", category: "Content", label: "Title", blocking: true, state: course.title?.trim() ? "PASS" : "FAIL" },
    {
      id: "summary",
      category: "Content",
      label: "Summary",
      blocking: true,
      state: course.summary?.trim() ? "PASS" : "FAIL",
    },
    {
      id: "modules",
      category: "Content",
      label: "At least one module",
      blocking: true,
      state: liveModules.length > 0 ? "PASS" : "FAIL",
    },
    {
      id: "module-lessons",
      category: "Content",
      label: "Every module has a lesson",
      blocking: true,
      state: liveModules.every(hasNonWithdrawnLesson) ? "PASS" : "FAIL",
    },

    // D-25 ruling, recorded 2026-09-02: "content not published" was
    // originally a blocking item here. That made D-08's draft+listed
    // combination — taking bookings before the lessons are finished —
    // impossible to create rather than merely unusual. Two locked
    // decisions contradicted each other; the user ruled D-08 wins, so this
    // item warns instead of blocking. Do not reinstate this as a blocker
    // without re-reading D-08 and D-25 together first.
    {
      id: "published",
      category: "Content",
      label: "Content published",
      blocking: false,
      state: course.status === "PUBLISHED" ? "PASS" : "WARN",
    },

    {
      id: "outcomes",
      category: "Content",
      label: "Outcomes stated",
      blocking: false,
      state: course.outcomes?.trim() ? "PASS" : "WARN",
    },
    {
      id: "duration",
      category: "Content",
      label: "Duration set",
      blocking: false,
      state: course.durationHours != null ? "PASS" : "WARN",
    },
    {
      id: "prerequisites",
      category: "Content",
      label: "Prerequisites stated",
      blocking: false,
      state: course.prerequisites?.trim() ? "PASS" : "WARN",
    },
    {
      id: "cohorts",
      category: "Content",
      label: "Upcoming cohorts",
      blocking: false,
      state: course.upcomingCohortCount > 0 ? "PASS" : "WARN",
    },

    // D-26 named gaps — a THIRD state, visually distinct from both a tick
    // and a cross. Never PASS: a silently assumed pass is what the PXR
    // forbids for a category this phase does not evaluate at all.
    { id: "schedule", category: "Schedule", label: "Schedule", blocking: false, state: "NOT_YET_CHECKED", deferredTo: "Phase 5" },
    { id: "price", category: "Price", label: "Price", blocking: false, state: "NOT_YET_CHECKED", deferredTo: "Phase 5" },
    { id: "capacity", category: "Capacity", label: "Capacity", blocking: false, state: "NOT_YET_CHECKED", deferredTo: "Phase 5" },
    {
      id: "instructors",
      category: "Instructors",
      label: "Instructors",
      blocking: false,
      state: "NOT_YET_CHECKED",
      deferredTo: "Phase 5",
    },
  ];

  // D-31 named gap — only present when the course actually has a QUIZ or
  // ASSIGNMENT lesson; the assessment picker has nothing to choose from yet.
  if (hasAssessmentLesson(course.modules)) {
    items.push({
      id: "assessments",
      category: "Completion",
      label: "Quiz/Assignment content",
      blocking: false,
      state: "NOT_YET_CHECKED",
      deferredTo: "Phase 10",
    });
  }

  return items;
}

/**
 * Evaluates a Programme's readiness. Blocks on `title`, `summary`, and
 * `courses` (at least one member Course); `published` is a warning here
 * too, for the same D-08/D-25 reason as the Course evaluator.
 */
export function evaluateProgrammeReadiness(programme: ReadinessProgrammeInput): ReadinessItem[] {
  return [
    {
      id: "title",
      category: "Content",
      label: "Title",
      blocking: BLOCKING,
      state: programme.title?.trim() ? "PASS" : "FAIL",
    },
    {
      id: "summary",
      category: "Content",
      label: "Summary",
      blocking: BLOCKING,
      state: programme.summary?.trim() ? "PASS" : "FAIL",
    },
    {
      id: "courses",
      category: "Content",
      label: "At least one course",
      blocking: BLOCKING,
      state: programme.courses.length > 0 ? "PASS" : "FAIL",
    },

    // Same D-08/D-25 ruling as the Course evaluator's "published" item.
    {
      id: "published",
      category: "Content",
      label: "Content published",
      blocking: false,
      state: programme.status === "PUBLISHED" ? "PASS" : "WARN",
    },

    {
      id: "outcomes",
      category: "Content",
      label: "Outcomes stated",
      blocking: false,
      state: programme.outcomes?.trim() ? "PASS" : "WARN",
    },
    {
      id: "audience",
      category: "Content",
      label: "Audience stated",
      blocking: false,
      state: programme.audience?.trim() ? "PASS" : "WARN",
    },
  ];
}

/** Only items that both FAILed and are `blocking` stop public listing. */
export function blockingFailures(items: ReadinessItem[]): ReadinessItem[] {
  return items.filter((item) => item.state === "FAIL" && item.blocking === true);
}
