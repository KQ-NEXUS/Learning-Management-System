/**
 * Plan 09-07: `enrolment-dashboard-service.ts` — the aggregate read behind
 * `/dashboard` (Task 1: typed named gaps, ownership scoping, progress,
 * access notice, upcoming sessions; Task 2: `deriveNextAction`, DD-5).
 *
 * Driven entirely by an in-memory fake store plus a real
 * `createLearnerAccessService` instance built over its own in-memory fake —
 * mirroring `tests/learner-access.test.ts`'s own injected-store convention.
 * No Postgres, no module mocking.
 */

import { describe, expect, it } from "vitest";
import {
  createEnrolmentDashboardService,
  deriveSessionMode,
  deriveAccessNotice,
  buildUpcomingSessions,
  collectRequiredLessonEvidence,
  deriveNextAction,
  type EnrolmentDashboardStore,
  type DashboardSessionStoreRow,
  type DashboardAttendanceRecordStoreRow,
} from "@/server/services/enrolment-dashboard-service";
import {
  createLearnerAccessService,
  type LearnerAccessStore,
  type LearnerPath,
  type EnrolmentStoreRow,
  type CohortStoreRow,
  type CohortCourseStoreRow,
  type CourseStoreRow,
  type PublicationStoreRow,
  type ModuleStoreRow,
  type LessonStoreRow,
  type LessonProgressStoreRow,
} from "@/server/services/learner-access";
import type { Actor } from "@/server/permissions/with-permission";
import type { CourseObligationPayload } from "@/server/services/publication";
import type { AccessWindow } from "@/server/services/access-window";
import type { CompletionVerdict } from "@/server/services/completion-engine";

// ---------------------------------------------------------------------------
// Fixtures + fake stores
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-14T12:00:00.000Z");

const actorA: Actor = { userId: "user-a", roles: [] } as unknown as Actor;

function cohort(overrides: Partial<CohortStoreRow> = {}): CohortStoreRow {
  return {
    id: "cohort-1",
    title: "Cohort One",
    deliveryMode: "INSTRUCTOR_LED",
    timezone: "Africa/Lagos",
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    endsAt: new Date("2026-12-31T00:00:00.000Z"),
    attendanceThresholdPct: null,
    courseId: "course-1",
    programmeId: null,
    accessDurationDays: null,
    coursePublicationId: "pub-1",
    programmePublicationId: null,
    ...overrides,
  };
}

function enrolment(overrides: Partial<EnrolmentStoreRow> = {}): EnrolmentStoreRow {
  return {
    id: "enrolment-1",
    userId: "user-a",
    cohortId: "cohort-1",
    status: "ACTIVE",
    accessStartsAt: new Date("2026-01-01T00:00:00.000Z"),
    accessEndsAt: null,
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function course(overrides: Partial<CourseStoreRow> = {}): CourseStoreRow {
  return { id: "course-1", title: "Course One", ...overrides };
}

function moduleRow(overrides: Partial<ModuleStoreRow> = {}): ModuleStoreRow {
  return {
    id: "module-1",
    courseId: "course-1",
    title: "Module One",
    position: 0,
    withdrawnAt: null,
    ...overrides,
  };
}

function lessonRow(overrides: Partial<LessonStoreRow> = {}): LessonStoreRow {
  return {
    id: "lesson-1",
    moduleId: "module-1",
    title: "Lesson One",
    type: "TEXT",
    position: 0,
    required: true,
    allowManualComplete: true,
    withdrawnAt: null,
    ...overrides,
  };
}

function coursePayload(overrides: Partial<CourseObligationPayload> = {}): CourseObligationPayload {
  return {
    schema: 1,
    completionRule: null,
    completionRuleVersion: 1,
    modules: [
      {
        id: "module-1",
        position: 0,
        lessons: [{ id: "lesson-1", position: 0, required: true, type: "TEXT", assessmentId: null }],
      },
    ],
    ...overrides,
  };
}

function session(overrides: Partial<DashboardSessionStoreRow> = {}): DashboardSessionStoreRow {
  return {
    id: "session-1",
    title: "Session One",
    startsAt: new Date("2026-09-20T10:00:00.000Z"),
    endsAt: new Date("2026-09-20T12:00:00.000Z"),
    location: null,
    cancelledAt: null,
    attendanceExpected: true,
    ...overrides,
  };
}

/** Builds a `LearnerAccessStore` fake from simple fixture arrays. */
function makeLearnerAccessStore(opts: {
  enrolments?: EnrolmentStoreRow[];
  cohorts?: CohortStoreRow[];
  cohortCourses?: CohortCourseStoreRow[];
  courses?: CourseStoreRow[];
  coursePublications?: Record<string, PublicationStoreRow>;
  programmePublications?: Record<string, PublicationStoreRow>;
  modules?: ModuleStoreRow[];
  lessons?: LessonStoreRow[];
  lessonProgress?: LessonProgressStoreRow[];
}): LearnerAccessStore {
  const enrolments = opts.enrolments ?? [];
  const cohorts = opts.cohorts ?? [];
  const cohortCourses = opts.cohortCourses ?? [];
  const courses = opts.courses ?? [];
  const coursePublications = opts.coursePublications ?? {};
  const programmePublications = opts.programmePublications ?? {};
  const modules = opts.modules ?? [];
  const lessons = opts.lessons ?? [];
  const lessonProgress = opts.lessonProgress ?? [];

  return {
    enrolment: {
      findUnique: async ({ where }) => enrolments.find((e) => e.id === where.id) ?? null,
      findMany: async ({ where }) =>
        enrolments.filter((e) => e.userId === where.userId && e.status === where.status),
    },
    cohort: {
      findUnique: async ({ where }) => cohorts.find((c) => c.id === where.id) ?? null,
    },
    cohortCourse: {
      findMany: async ({ where }) => cohortCourses.filter((c) => c.cohortId === where.cohortId),
      findFirst: async ({ where }) =>
        cohortCourses.find((c) => c.cohortId === where.cohortId && c.courseId === where.courseId) ?? null,
    },
    course: {
      findUnique: async ({ where }) => courses.find((c) => c.id === where.id) ?? null,
    },
    coursePublication: {
      findUnique: async ({ where }) => coursePublications[where.id] ?? null,
    },
    programmePublication: {
      findUnique: async ({ where }) => programmePublications[where.id] ?? null,
    },
    module: {
      findMany: async ({ where }) => modules.filter((m) => m.courseId === where.courseId),
    },
    lesson: {
      findMany: async ({ where }) => lessons.filter((l) => where.moduleId.in.includes(l.moduleId)),
    },
    lessonProgress: {
      findMany: async ({ where }) => lessonProgress.filter((p) => p.enrolmentId === where.enrolmentId),
    },
  };
}

function makeDashboardStore(opts: {
  sessionsByCohort?: Record<string, DashboardSessionStoreRow[]>;
  attendanceByEnrolment?: Record<string, DashboardAttendanceRecordStoreRow[]>;
}): EnrolmentDashboardStore {
  const sessionsByCohort = opts.sessionsByCohort ?? {};
  const attendanceByEnrolment = opts.attendanceByEnrolment ?? {};
  return {
    scheduledSession: {
      findMany: async ({ where }) => sessionsByCohort[where.cohortId] ?? [],
    },
    attendanceRecord: {
      findMany: async ({ where }) => attendanceByEnrolment[where.enrolmentId] ?? [],
    },
  };
}

/** Assembles a full `createEnrolmentDashboardService` instance for one scenario. */
function makeService(opts: {
  enrolments?: EnrolmentStoreRow[];
  cohorts?: CohortStoreRow[];
  cohortCourses?: CohortCourseStoreRow[];
  courses?: CourseStoreRow[];
  coursePublications?: Record<string, PublicationStoreRow>;
  programmePublications?: Record<string, PublicationStoreRow>;
  modules?: ModuleStoreRow[];
  lessons?: LessonStoreRow[];
  lessonProgress?: LessonProgressStoreRow[];
  sessionsByCohort?: Record<string, DashboardSessionStoreRow[]>;
  attendanceByEnrolment?: Record<string, DashboardAttendanceRecordStoreRow[]>;
  now?: () => Date;
}) {
  const learnerAccessStore = makeLearnerAccessStore(opts);
  const learnerAccess = createLearnerAccessService({ store: learnerAccessStore, now: opts.now ?? (() => NOW) });
  const dashboardStore = makeDashboardStore(opts);
  return createEnrolmentDashboardService({
    store: dashboardStore,
    learnerAccess,
    now: opts.now ?? (() => NOW),
  });
}

// ---------------------------------------------------------------------------
// loadLearnerDashboard
// ---------------------------------------------------------------------------

describe("loadLearnerDashboard", () => {
  it("returns one card per own ACTIVE enrolment", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const dashboard = await svc.loadLearnerDashboard(actorA);
    expect(dashboard.cards).toHaveLength(1);
    expect(dashboard.cards[0].enrolmentId).toBe("enrolment-1");
  });

  it("returns an empty cards array for an actor with no ACTIVE enrolments, never a placeholder card", async () => {
    const svc = makeService({});
    const dashboard = await svc.loadLearnerDashboard(actorA);
    expect(dashboard.cards).toEqual([]);
  });

  it("never includes another learner's enrolment (ownership scoping, T-09-01)", async () => {
    const svc = makeService({
      enrolments: [
        enrolment({ id: "enrolment-a", userId: "user-a" }),
        enrolment({ id: "enrolment-b", userId: "user-b" }),
      ],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const dashboardA = await svc.loadLearnerDashboard(actorA);
    expect(dashboardA.cards).toHaveLength(1);
    expect(dashboardA.cards[0].enrolmentId).toBe("enrolment-a");
    expect(dashboardA.cards.some((c) => c.enrolmentId === "enrolment-b")).toBe(false);
  });

  it("orders multiple cards by activatedAt descending (most recent first)", async () => {
    const svc = makeService({
      enrolments: [
        enrolment({ id: "enrolment-old", activatedAt: new Date("2026-01-01T00:00:00.000Z") }),
        enrolment({ id: "enrolment-new", activatedAt: new Date("2026-06-01T00:00:00.000Z") }),
      ],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const dashboard = await svc.loadLearnerDashboard(actorA);
    expect(dashboard.cards.map((c) => c.enrolmentId)).toEqual(["enrolment-new", "enrolment-old"]);
  });

  it("carries all four deferred fields with their pinned phase numbers", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.assessmentObligations).toEqual({ kind: "deferred", phase: 10 });
    expect(card.results).toEqual({ kind: "deferred", phase: 10 });
    expect(card.tickets).toEqual({ kind: "deferred", phase: 12 });
    expect(card.certificate).toEqual({ kind: "deferred", phase: 11 });
  });

  it("computes requiredLessonsComplete/Total from live LessonProgress", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: {
        "pub-1": {
          payload: coursePayload({
            modules: [
              {
                id: "module-1",
                position: 0,
                lessons: [
                  { id: "lesson-1", position: 0, required: true, type: "TEXT", assessmentId: null },
                  { id: "lesson-2", position: 1, required: true, type: "TEXT", assessmentId: null },
                ],
              },
            ],
          }),
        },
      },
      modules: [moduleRow()],
      lessons: [lessonRow(), lessonRow({ id: "lesson-2", position: 1 })],
      lessonProgress: [{ enrolmentId: "enrolment-1", lessonId: "lesson-1", completedAt: NOW, source: "MANUAL" }],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.progress.requiredLessonsTotal).toBe(2);
    expect(card.progress.requiredLessonsComplete).toBe(1);
    expect(card.progress.structure).toBe("structure");
  });

  it("excludes a required lesson withdrawn since pinning from the required count (D-17 parity)", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: {
        "pub-1": {
          payload: coursePayload({
            modules: [
              {
                id: "module-1",
                position: 0,
                lessons: [
                  { id: "lesson-1", position: 0, required: true, type: "TEXT", assessmentId: null },
                  { id: "lesson-2", position: 1, required: true, type: "TEXT", assessmentId: null },
                ],
              },
            ],
          }),
        },
      },
      modules: [moduleRow()],
      lessons: [
        lessonRow(),
        lessonRow({ id: "lesson-2", position: 1, withdrawnAt: new Date("2026-05-01T00:00:00.000Z") }),
      ],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.progress.requiredLessonsTotal).toBe(1);
  });

  it("marks an unpinned cohort's card with structure: 'unpinned' and zeroed totals, not a fake zero", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: null })],
      courses: [course()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.progress.structure).toBe("unpinned");
    expect(card.progress.requiredLessonsTotal).toBe(0);
    expect(card.progress.requiredLessonsComplete).toBe(0);
  });

  it("carries a computed attendance component distinct from the lesson-progress component", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort({ attendanceThresholdPct: 80 })],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
      sessionsByCohort: {
        "cohort-1": [
          session({ id: "s1", startsAt: new Date("2026-08-01T00:00:00.000Z"), endsAt: new Date("2026-08-01T01:00:00.000Z") }),
        ],
      },
      attendanceByEnrolment: {
        "enrolment-1": [{ sessionId: "s1", state: "PRESENT" }],
      },
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.progress.attendance).toEqual({
      kind: "computed",
      earnedPct: 100,
      requiredPct: 80,
      attendedCount: 1,
      countableCount: 1,
      meetsThreshold: true,
    });
  });

  it("limits upcomingSessions to the 3 nearest future non-cancelled sessions and flags hasMoreSessions", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
      sessionsByCohort: {
        "cohort-1": [
          session({ id: "s1", startsAt: new Date("2026-09-25T00:00:00.000Z") }),
          session({ id: "s2", startsAt: new Date("2026-09-16T00:00:00.000Z") }),
          session({ id: "s3", startsAt: new Date("2026-09-20T00:00:00.000Z") }),
          session({ id: "s4", startsAt: new Date("2026-09-18T00:00:00.000Z") }),
          session({ id: "s5", startsAt: new Date("2026-09-10T00:00:00.000Z") }), // past — excluded
          session({ id: "s6", startsAt: new Date("2026-09-17T00:00:00.000Z"), cancelledAt: NOW }), // cancelled — excluded
        ],
      },
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.upcomingSessions.map((s) => s.id)).toEqual(["s2", "s4", "s3"]);
    expect(card.hasMoreSessions).toBe(true);
  });

  it("never returns a session object carrying a meeting-link key", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
      sessionsByCohort: {
        "cohort-1": [session({ id: "s1", startsAt: new Date("2026-09-20T00:00:00.000Z") })],
      },
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.upcomingSessions.length).toBeGreaterThan(0);
    expect(card.upcomingSessions.every((s) => !("meetingUrl" in s))).toBe(true);
  });

  it("derives an 'ending' access notice when the self-paced window closes within 14 days", async () => {
    const svc = makeService({
      enrolments: [
        enrolment({
          activatedAt: new Date("2026-09-01T00:00:00.000Z"),
        }),
      ],
      cohorts: [cohort({ deliveryMode: "SELF_PACED", accessDurationDays: 20 })], // ends 2026-09-21, 7 days from NOW
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.accessNotice.kind).toBe("ending");
  });

  it("derives an 'ended' access notice when a self-paced window has closed", async () => {
    const svc = makeService({
      enrolments: [enrolment({ activatedAt: new Date("2026-01-01T00:00:00.000Z") })],
      cohorts: [cohort({ deliveryMode: "SELF_PACED", accessDurationDays: 30 })], // ended long before NOW
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.accessNotice).toEqual({ kind: "ended" });
  });

  it("derives a 'none' access notice for unlimited self-paced access", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort({ deliveryMode: "SELF_PACED", accessDurationDays: null })],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.accessNotice).toEqual({ kind: "none" });
  });
});

// ---------------------------------------------------------------------------
// Pure helper unit tests (no store fake needed)
// ---------------------------------------------------------------------------

describe("deriveNextAction", () => {
  async function pathFor(options: { optional?: boolean; completed?: boolean; closed?: boolean } = {}): Promise<LearnerPath> {
    const store = makeLearnerAccessStore({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });
    const access = createLearnerAccessService({ store, now: () => NOW });
    const path = await access.loadLearnerPath(actorA, "enrolment-1");
    if (!path) throw new Error("Expected fixture learner path");
    const lesson = path.courses[0].modules[0].lessons[0];
    lesson.required = !options.optional;
    lesson.completed = options.completed ?? false;
    if (options.closed) path.enrolment.accessWindow = { kind: "windowed", endsAt: NOW, readOnly: true };
    return path;
  }

  const unmet: CompletionVerdict = { satisfied: false, items: [] };
  const satisfied: CompletionVerdict = { satisfied: true, items: [] };
  const base = { enrolmentId: "enrolment-1", now: NOW, nearestFutureSession: null, path: null, verdict: unmet };
  const sessionAt = (hours: number) => ({ id: "session-1", title: "Session One", startsAt: new Date(NOW.getTime() + hours * 3600000) });

  it("prioritizes a session in three hours over an incomplete lesson", async () => {
    expect(deriveNextAction({ ...base, path: await pathFor(), nearestFutureSession: sessionAt(3) })).toEqual({
      kind: "session", sessionId: "session-1", title: "Session One", startsAt: new Date("2026-09-14T15:00:00.000Z"),
    });
  });

  it("does not prioritize a session 25 hours away", async () => {
    expect(deriveNextAction({ ...base, path: await pathFor(), nearestFutureSession: sessionAt(25) }).kind).toBe("lesson");
  });

  it("includes the session exactly at the 24-hour boundary", () => {
    expect(deriveNextAction({ ...base, nearestFutureSession: sessionAt(24) }).kind).toBe("session");
  });

  it.each([0, -1])("excludes sessions starting %s hours from now", (hours) => {
    expect(deriveNextAction({ ...base, nearestFutureSession: sessionAt(hours) })).toEqual({ kind: "none" });
  });

  it("returns the open required lesson with its enrolment and module context", async () => {
    expect(deriveNextAction({ ...base, path: await pathFor() })).toEqual({
      kind: "lesson", enrolmentId: "enrolment-1", lessonId: "lesson-1", lessonTitle: "Lesson One", moduleTitle: "Module One",
    });
  });

  it("does not recommend an incomplete optional lesson", async () => {
    expect(deriveNextAction({ ...base, path: await pathFor({ optional: true }) })).toEqual({ kind: "none" });
  });

  it("does not recommend a completed required lesson", async () => {
    expect(deriveNextAction({ ...base, path: await pathFor({ completed: true }) })).toEqual({ kind: "none" });
  });

  it("skips a withdrawn lesson and continues into the next module", async () => {
    const path = await pathFor();
    const first = path.courses[0].modules[0].lessons[0];
    const second = { ...first, id: "lesson-2", title: "Lesson Two" };
    first.withdrawnAt = NOW;
    path.courses[0].modules.push({ id: "module-2", title: "Module Two", position: 1, lessons: [second] });
    expect(deriveNextAction({ ...base, path })).toEqual({
      kind: "lesson", enrolmentId: "enrolment-1", lessonId: "lesson-2", lessonTitle: "Lesson Two", moduleTitle: "Module Two",
    });
  });

  it("does not recommend lesson content after the access window closes", async () => {
    expect(deriveNextAction({ ...base, path: await pathFor({ closed: true }) })).toEqual({ kind: "none" });
  });

  it("does not recommend a prerequisite-locked required lesson", async () => {
    const path = await pathFor();
    path.courses[0].modules[0].lessons[0].locked = true;
    expect(deriveNextAction({ ...base, path })).toEqual({ kind: "none" });
  });

  it("returns complete when no earlier priority matches and the verdict is satisfied", async () => {
    expect(deriveNextAction({ ...base, path: await pathFor({ completed: true }), verdict: satisfied })).toEqual({ kind: "complete" });
  });

  it("keeps an imminent session ahead of a satisfied completion verdict", () => {
    expect(deriveNextAction({ ...base, verdict: satisfied, nearestFutureSession: sessionAt(3) }).kind).toBe("session");
  });

  it("returns none for missing path and verdict", () => {
    expect(deriveNextAction({ ...base, verdict: null })).toEqual({ kind: "none" });
  });

  it("attaches the derived lesson action to the aggregate dashboard card", async () => {
    const svc = makeService({
      enrolments: [enrolment()], cohorts: [cohort()], courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } }, modules: [moduleRow()], lessons: [lessonRow()],
    });
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.nextAction).toEqual({ kind: "lesson", enrolmentId: "enrolment-1", lessonId: "lesson-1", lessonTitle: "Lesson One", moduleTitle: "Module One" });
  });
});

describe("deriveSessionMode", () => {
  it("returns 'in-person' when a non-empty location is present", () => {
    expect(deriveSessionMode("Room 4B")).toBe("in-person");
  });

  it("returns 'unknown' when location is null", () => {
    expect(deriveSessionMode(null)).toBe("unknown");
  });

  it("returns 'unknown' when location is blank", () => {
    expect(deriveSessionMode("   ")).toBe("unknown");
  });
});

describe("deriveAccessNotice", () => {
  function window(overrides: Partial<AccessWindow> = {}): AccessWindow {
    return { kind: "windowed", readOnly: false, endsAt: null, ...overrides } as AccessWindow;
  }

  it("returns 'none' when endsAt is null (unlimited/not-started)", () => {
    expect(deriveAccessNotice(window({ endsAt: null }), NOW)).toEqual({ kind: "none" });
  });

  it("returns 'ended' when readOnly is true", () => {
    const endsAt = new Date("2026-09-01T00:00:00.000Z");
    expect(deriveAccessNotice(window({ readOnly: true, endsAt }), NOW)).toEqual({ kind: "ended" });
  });

  it("returns 'ending' when the window closes within 14 days", () => {
    const endsAt = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
    expect(deriveAccessNotice(window({ endsAt }), NOW)).toEqual({ kind: "ending", endsAt });
  });

  it("returns 'none' when the window closes more than 14 days out", () => {
    const endsAt = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(deriveAccessNotice(window({ endsAt }), NOW)).toEqual({ kind: "none" });
  });
});

describe("buildUpcomingSessions", () => {
  it("sorts ascending and caps at 3", () => {
    const sessions = [
      session({ id: "a", startsAt: new Date("2026-09-25T00:00:00.000Z") }),
      session({ id: "b", startsAt: new Date("2026-09-15T00:00:00.000Z") }),
    ];
    const result = buildUpcomingSessions(sessions, NOW);
    expect(result.upcomingSessions.map((s) => s.id)).toEqual(["b", "a"]);
    expect(result.hasMoreSessions).toBe(false);
  });

  it("excludes past and cancelled sessions from futureNonCancelled", () => {
    const sessions = [
      session({ id: "past", startsAt: new Date("2026-01-01T00:00:00.000Z") }),
      session({ id: "cancelled", startsAt: new Date("2026-09-20T00:00:00.000Z"), cancelledAt: NOW }),
      session({ id: "future", startsAt: new Date("2026-09-20T00:00:00.000Z") }),
    ];
    const result = buildUpcomingSessions(sessions, NOW);
    expect(result.futureNonCancelled.map((s) => s.id)).toEqual(["future"]);
  });
});

describe("collectRequiredLessonEvidence", () => {
  it("excludes optional lessons and withdrawn required lessons", () => {
    const path = {
      enrolment: {} as never,
      courses: [
        {
          courseId: "course-1",
          courseTitle: "Course One",
          modules: [
            {
              id: "module-1",
              title: "Module One",
              position: 0,
              lessons: [
                {
                  id: "required-open",
                  title: "L1",
                  type: "TEXT",
                  position: 0,
                  required: true,
                  allowManualComplete: true,
                  withdrawnAt: null,
                  locked: false,
                  blockingLessonTitle: null,
                  completed: true,
                  completedSource: "MANUAL",
                },
                {
                  id: "required-withdrawn",
                  title: "L2",
                  type: "TEXT",
                  position: 1,
                  required: true,
                  allowManualComplete: true,
                  withdrawnAt: new Date("2026-05-01T00:00:00.000Z"),
                  locked: false,
                  blockingLessonTitle: null,
                  completed: false,
                  completedSource: null,
                },
                {
                  id: "optional-open",
                  title: "L3",
                  type: "TEXT",
                  position: 2,
                  required: false,
                  allowManualComplete: true,
                  withdrawnAt: null,
                  locked: false,
                  blockingLessonTitle: null,
                  completed: false,
                  completedSource: null,
                },
              ],
            },
          ],
        },
      ],
      progress: new Set(["required-open"]),
      sequencing: [],
    };

    const evidence = collectRequiredLessonEvidence(path as never);
    expect(evidence.requiredLessonIds).toEqual(["required-open"]);
    expect(evidence.completedLessonIds.has("required-open")).toBe(true);
  });
});
