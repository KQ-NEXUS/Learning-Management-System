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
  | "Catalogue"
  | "Schedule"
  | "Price"
  | "Capacity"
  | "Instructors"
  | "Completion"
  // Added by 10-03 for `evaluateAssessmentReadiness` (assessment-readiness.ts)
  // — pass mark, attempt limit, attempt-grading method and feedback-behaviour
  // items. None of the existing seven slots fit a per-Assessment grading
  // setting, so this extends the union rather than forcing those items into
  // "Content" (which is reserved for questions/instructions/file settings).
  | "Grading";

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

    // The schedule / price / capacity / instructors slots that used to live
    // here as NOT_YET_CHECKED stubs reserved for Phase 5 have moved to
    // `evaluateCohortReadiness` below. They are per-Cohort properties a Course
    // does not have (a Course has no start date, seat count, price, or
    // instructor roster — its Cohorts do). See RESEARCH Open Question 1
    // (05-RESEARCH.md, RESOLVED) and plan 05-03 Task 1. The `assessments`
    // slot stays here — Phase 10 owns it and it is genuinely per-Course.
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

// ---------------------------------------------------------------------------
// Cohort readiness (COH-04 / D-27 / D-28 / D-29).
//
// Structural input only — the caller (`cohort-service`, plan 05-05) reads the
// cohort aggregate and hands plain values in, so this stays a pure, testable
// function with zero data-access. Plan 05-15's publish action calls
// `blockingFailures(evaluateCohortReadiness(...))` — never its own copy of
// these rules — so the on-screen panel and the server-side refusal agree by
// construction.
// ---------------------------------------------------------------------------

export type ReadinessCohortInput = {
  deliveryMode: string;
  startsAt: Date | string;
  endsAt: Date | string;
  capacity: number;
  seatsTaken: number;
  // D-06/D-08 — the two independent, nullable dual-currency base prices
  // (07-05). `null` means "this rail is not offered," never "free."
  priceNgnMinor: number | null;
  priceUsdMinor: number | null;
  // Which online rails THIS DEPLOYMENT has turned on (D-02/D-05 — the
  // school's settlement account identifier is configured for that
  // provider). Derived by the caller from deployment configuration; this
  // function stays pure and data-access-free.
  enabledRails: { ngn: boolean; usd: boolean };
  attendanceThresholdPct: number | null;
  instructorCount: number;
  nonCancelledSessionCount: number;
  sessions: Array<{ startsAt: Date | string; endsAt: Date | string; cancelledAt: Date | string | null }>;
  pin: {
    kind: "course" | "programme";
    publicationId: string | null;
    targetStatus: string | null;
    completionRule: unknown;
  } | null;
};

/** Same `Intl.NumberFormat` convention the Cohort detail page's own
 *  `formatPrice` helper uses — falls back to a plain minor-units string if
 *  the currency code is somehow not renderable. */
function formatRailAmount(minorUnits: number, currency: "NGN" | "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minorUnits / 100);
  } catch {
    return `${minorUnits} minor units ${currency}`;
  }
}

function toEpoch(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Evaluates a Cohort's publication readiness across the six D-28/D-29
 * categories. Catalogue, Schedule, Capacity and Instructors are
 * `blocking: true` and FAIL-capable; Completion and the two WARN sub-items
 * are advisory. No item is ever `NOT_YET_CHECKED` — D-28 turns every
 * reserved slot into a real check.
 *
 * Price (D-06/D-08, 07-05) is now TWO items, `price-ngn` and `price-usd` —
 * one per online rail — replacing the single item this comment used to
 * describe as "effectively always PASS." That is no longer true: each item
 * is `blocking` only when `enabledRails` says this deployment has turned
 * that rail on, and FAILs when the matching price is null or non-positive.
 * A rail this deployment has not enabled is never blocking, however it is
 * priced — D-08 only requires a price for every ENABLED rail.
 */
export function evaluateCohortReadiness(cohort: ReadinessCohortInput): ReadinessItem[] {
  const selfPaced = cohort.deliveryMode === "SELF_PACED";
  const modeLabel = cohort.deliveryMode.toLowerCase().replace(/_/g, "-");

  // --- Catalogue (D-29) -----------------------------------------------------
  const pinKindLabel = cohort.pin?.kind === "programme" ? "Programme" : "Course";
  const cataloguePass =
    cohort.pin != null && cohort.pin.publicationId != null && cohort.pin.targetStatus === "PUBLISHED";
  const catalogue: ReadinessItem = {
    id: "catalogue",
    category: "Catalogue",
    label: "Pinned to a published Course or Programme",
    blocking: true,
    state: cataloguePass ? "PASS" : "FAIL",
    detail: cataloguePass
      ? `Pinned to a published ${pinKindLabel} publication`
      : cohort.pin == null || cohort.pin.publicationId == null
        ? "Not pinned to a published Course or Programme — publish the catalogue item first"
        : `The pinned ${pinKindLabel} is ${cohort.pin.targetStatus ?? "not published"}, not PUBLISHED — only a frozen publication can back a cohort`,
  };

  // --- Schedule (D-28) ----------------------------------------------------
  const schedulePass = selfPaced || cohort.nonCancelledSessionCount > 0;
  const schedule: ReadinessItem = {
    id: "schedule",
    category: "Schedule",
    label: "Schedule set",
    blocking: true,
    state: schedulePass ? "PASS" : "FAIL",
    detail: selfPaced
      ? "Self-paced cohort — no scheduled sessions required"
      : schedulePass
        ? `${cohort.nonCancelledSessionCount} non-cancelled session${cohort.nonCancelledSessionCount === 1 ? "" : "s"} scheduled`
        : "No non-cancelled sessions — add at least one session or set the cohort to self-paced",
  };

  const cohortStart = toEpoch(cohort.startsAt);
  const cohortEnd = toEpoch(cohort.endsAt);
  const strayCount = cohort.sessions.filter(
    (session) =>
      session.cancelledAt == null &&
      (toEpoch(session.startsAt) < cohortStart || toEpoch(session.endsAt) > cohortEnd),
  ).length;
  const scheduleDates: ReadinessItem = {
    id: "schedule-dates",
    category: "Schedule",
    label: "Sessions fall within the cohort dates",
    blocking: false,
    state: strayCount > 0 ? "WARN" : "PASS",
    detail:
      strayCount > 0
        ? `${strayCount} session${strayCount === 1 ? "" : "s"} start before the cohort begins or end after it finishes`
        : "Every non-cancelled session falls within the cohort start and end dates",
  };

  // --- Price (D-06/D-08) — per-rail, blocking only for an enabled rail ---
  const ngnPricePass = cohort.priceNgnMinor != null && cohort.priceNgnMinor > 0;
  const priceNgn: ReadinessItem = {
    id: "price-ngn",
    category: "Price",
    label: "NGN price set (Paystack)",
    blocking: cohort.enabledRails.ngn,
    state: ngnPricePass ? "PASS" : "FAIL",
    detail: ngnPricePass
      ? `${formatRailAmount(cohort.priceNgnMinor as number, "NGN")} (Paystack)`
      : "No NGN price set — this rail is unavailable to learners until an administrator adds one.",
  };

  const usdPricePass = cohort.priceUsdMinor != null && cohort.priceUsdMinor > 0;
  const priceUsd: ReadinessItem = {
    id: "price-usd",
    category: "Price",
    label: "USD price set (Stripe)",
    blocking: cohort.enabledRails.usd,
    state: usdPricePass ? "PASS" : "FAIL",
    detail: usdPricePass
      ? `${formatRailAmount(cohort.priceUsdMinor as number, "USD")} (Stripe)`
      : "No USD price set — this rail is unavailable to learners until an administrator adds one.",
  };

  // --- Capacity (D-28) --------------------------------------------------
  const capacityPass = cohort.capacity > 0 && cohort.capacity >= cohort.seatsTaken;
  const capacity: ReadinessItem = {
    id: "capacity",
    category: "Capacity",
    label: "Capacity set and not oversold",
    blocking: true,
    state: capacityPass ? "PASS" : "FAIL",
    detail:
      cohort.capacity < 1
        ? "Capacity is 0 — set at least 1 seat"
        : cohort.capacity < cohort.seatsTaken
          ? `${cohort.seatsTaken} seats already taken but capacity is ${cohort.capacity}`
          : `${cohort.seatsTaken} of ${cohort.capacity} seats taken`,
  };

  // --- Instructors (D-28) ---------------------------------------------
  const instructorsPass = selfPaced || cohort.instructorCount > 0;
  const instructors: ReadinessItem = {
    id: "instructors",
    category: "Instructors",
    label: "At least one instructor assigned",
    blocking: true,
    state: instructorsPass ? "PASS" : "FAIL",
    detail: selfPaced
      ? "Self-paced cohort — no instructor required"
      : instructorsPass
        ? `${cohort.instructorCount} instructor${cohort.instructorCount === 1 ? "" : "s"} assigned`
        : `No instructor assigned to this ${modeLabel} cohort`,
  };

  // --- Completion (D-28) — WARN-only ---------------------------------
  const hasCompletionRule = cohort.pin != null && cohort.pin.completionRule != null;
  const completion: ReadinessItem = {
    id: "completion",
    category: "Completion",
    label: "Pinned publication carries a completion rule",
    blocking: false,
    state: hasCompletionRule ? "PASS" : "WARN",
    detail: hasCompletionRule
      ? "The pinned publication defines how a learner completes"
      : "The pinned publication has no completion rule — learners cannot be marked complete until the Phase 9/11 engine ships",
  };

  const attendanceThresholdOnSelfPaced =
    cohort.attendanceThresholdPct != null && selfPaced;
  const attendanceThresholdSelfPaced: ReadinessItem = {
    id: "attendance-threshold-self-paced",
    category: "Completion",
    label: "Attendance threshold suits the delivery mode",
    blocking: false,
    state: attendanceThresholdOnSelfPaced ? "WARN" : "PASS",
    detail: attendanceThresholdOnSelfPaced
      ? `An attendance threshold of ${cohort.attendanceThresholdPct}% is set on a self-paced cohort, which has no sessions to attend`
      : cohort.attendanceThresholdPct != null
        ? `Attendance threshold of ${cohort.attendanceThresholdPct}%`
        : "No attendance threshold set on this cohort",
  };

  return [
    catalogue,
    schedule,
    scheduleDates,
    priceNgn,
    priceUsd,
    capacity,
    instructors,
    completion,
    attendanceThresholdSelfPaced,
  ];
}

/** Only items that both FAILed and are `blocking` stop public listing. */
export function blockingFailures(items: ReadinessItem[]): ReadinessItem[] {
  return items.filter((item) => item.state === "FAIL" && item.blocking === true);
}
