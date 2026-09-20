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

import { describe, expect, it, vi } from "vitest";
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
  type DashboardCompletionRecordStoreRow,
  type DashboardCertificateStoreRow,
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
import type {
  AssessmentObligation,
  LearnerResultCard,
} from "@/server/services/learner-results-service";
import type { EnrolmentDashboardLearnerResults } from "@/server/services/enrolment-dashboard-service";

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

function assessmentObligation(overrides: Partial<AssessmentObligation> = {}): AssessmentObligation {
  return {
    assessmentId: "assessment-1",
    title: "Module Quiz",
    type: "QUIZ",
    lessonId: "lesson-1",
    dueAt: null,
    state: "not-started",
    ...overrides,
  };
}

function resultCard(overrides: Partial<LearnerResultCard> = {}): LearnerResultCard {
  return {
    assessmentId: "assessment-1",
    title: "Module Quiz",
    type: "QUIZ",
    effectiveScore: 8,
    maxScore: 10,
    passed: true,
    passMark: 6,
    feedback: null,
    attemptsRemaining: null,
    history: [
      { kind: "attempt", ref: "attempt-1", number: 1, at: new Date("2026-09-01T10:00:00.000Z"), status: "SUBMITTED", score: 8 },
    ],
    overrides: [],
    ...overrides,
  };
}

/** Plan 10-15 — the `learner-results-service.ts` fake, keyed by enrolmentId,
 *  mirroring `makeDashboardStore`'s own shape so a test only supplies the
 *  fixtures it actually varies. */
function makeLearnerResultsFake(opts: {
  assessmentObligationsByEnrolment?: Record<string, AssessmentObligation[]>;
  resultsByEnrolment?: Record<string, LearnerResultCard[]>;
}): EnrolmentDashboardLearnerResults {
  const obligations = opts.assessmentObligationsByEnrolment ?? {};
  const results = opts.resultsByEnrolment ?? {};
  return {
    getOwnAssessmentObligations: async (_actor, input) => obligations[input.enrolmentId] ?? [],
    getOwnResults: async (_actor, input) => (input.enrolmentId ? (results[input.enrolmentId] ?? []) : []),
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
  completionRecords?: DashboardCompletionRecordStoreRow[];
  certificates?: DashboardCertificateStoreRow[];
  /** WR-06 - Course.certificateEnabled by id. Any id not listed defaults to
   *  ENABLED so every pre-existing scenario keeps its current expectation. */
  courseCertificateEnabled?: Record<string, boolean>;
  /** WR-06 - Programme.certificateEnabled by id (same default). */
  programmeCertificateEnabled?: Record<string, boolean>;
}): EnrolmentDashboardStore {
  const sessionsByCohort = opts.sessionsByCohort ?? {};
  const attendanceByEnrolment = opts.attendanceByEnrolment ?? {};
  const completionRecords = opts.completionRecords ?? [];
  const certificates = opts.certificates ?? [];
  const courseEnabled = opts.courseCertificateEnabled ?? {};
  const programmeEnabled = opts.programmeCertificateEnabled ?? {};
  return {
    course: {
      findMany: async ({ where }) =>
        where.id.in.map((id) => ({ id, certificateEnabled: courseEnabled[id] ?? true })),
    },
    programme: {
      findMany: async ({ where }) =>
        where.id.in.map((id) => ({ id, certificateEnabled: programmeEnabled[id] ?? true })),
    },
    scheduledSession: {
      findMany: async ({ where }) => sessionsByCohort[where.cohortId] ?? [],
    },
    attendanceRecord: {
      findMany: async ({ where }) => attendanceByEnrolment[where.enrolmentId] ?? [],
    },
    // Plan 11-13 — both filter honestly by the `in` clause and the extra
    // predicate a real Prisma call would apply, so a query that forgot to
    // scope by enrolment id would be caught here too.
    completionRecord: {
      findMany: async ({ where }) =>
        completionRecords.filter(
          (r) => where.enrolmentId.in.includes(r.enrolmentId) && where.supersededAt === null,
        ),
    },
    certificate: {
      findMany: async ({ where }) =>
        certificates.filter(
          (c) => where.enrolmentId.in.includes(c.enrolmentId) && c.status !== "SUPERSEDED",
        ),
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
  assessmentObligationsByEnrolment?: Record<string, AssessmentObligation[]>;
  resultsByEnrolment?: Record<string, LearnerResultCard[]>;
  completionRecords?: DashboardCompletionRecordStoreRow[];
  certificates?: DashboardCertificateStoreRow[];
  courseCertificateEnabled?: Record<string, boolean>;
  programmeCertificateEnabled?: Record<string, boolean>;
  now?: () => Date;
  /** Plan 11-17 - spy hooks: swap in wrapped fakes to count calls. */
  learnerResults?: EnrolmentDashboardLearnerResults;
  wrapDashboardStore?: (store: EnrolmentDashboardStore) => EnrolmentDashboardStore;
}) {
  const learnerAccessStore = makeLearnerAccessStore(opts);
  const learnerAccess = createLearnerAccessService({ store: learnerAccessStore, now: opts.now ?? (() => NOW) });
  const baseDashboardStore = makeDashboardStore(opts);
  const dashboardStore = opts.wrapDashboardStore ? opts.wrapDashboardStore(baseDashboardStore) : baseDashboardStore;
  const learnerResults = opts.learnerResults ?? makeLearnerResultsFake(opts);
  return createEnrolmentDashboardService({
    store: dashboardStore,
    learnerAccess,
    learnerResults,
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

  it("keeps tickets deferred — Phase 12's own named gap, untouched by plan 11-13", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.tickets).toEqual({ kind: "deferred", phase: 12 });
  });

  it("plan 11-13 — certificate is not-complete with no unsuperseded completion record, never a deferred placeholder", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.certificate).toEqual({ kind: "not-complete" });
  });

  it("plan 11-13 — certificate is issued when an unsuperseded completion record and an ACTIVE certificate both exist", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
      completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
      certificates: [
        {
          enrolmentId: "enrolment-1",
          scope: "COURSE",
          id: "cert-1",
          status: "ACTIVE",
          reviewFlaggedAt: null,
          verificationRef: "VERIF-REF-1",
          issuedAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      ],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.certificate).toEqual({
      kind: "issued",
      certificateId: "cert-1",
      verificationRef: "VERIF-REF-1",
      issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  // -------------------------------------------------------------------------
  // Plan 11-17 - UAT test 10 (BLOCKER) / decision G-01: a COMPLETED enrolment
  // is the status certificate issuance itself writes (D-05). No fixture in
  // this file previously used it, which is why the bug escaped.
  // -------------------------------------------------------------------------

  function completedFixtures(extra: Parameters<typeof makeService>[0] = {}): Parameters<typeof makeService>[0] {
    return {
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
      ...extra,
    };
  }

  const activeCert: DashboardCertificateStoreRow = {
    enrolmentId: "enrolment-1",
    scope: "COURSE",
    id: "cert-1",
    status: "ACTIVE",
    reviewFlaggedAt: null,
    verificationRef: "VERIF-REF-1",
    issuedAt: new Date("2026-09-01T00:00:00.000Z"),
  };

  const soonSession = session({
    startsAt: new Date("2026-09-14T14:00:00.000Z"),
    endsAt: new Date("2026-09-14T15:00:00.000Z"),
  });

  it("UAT test 10 - a COMPLETED enrolment with an ACTIVE certificate still gets a card carrying the certificate column", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED" })],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
        certificates: [activeCert],
      }),
    );

    const { cards } = await svc.loadLearnerDashboard(actorA);
    expect(cards).toHaveLength(1);
    expect(cards[0].enrolmentStatus).toBe("COMPLETED");
    expect(cards[0].certificate).toEqual({
      kind: "issued",
      certificateId: "cert-1",
      verificationRef: "VERIF-REF-1",
      issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    // Real progress is still shown from the returned path.
    expect(cards[0].progress).toMatchObject({ structure: "structure", requiredLessonsTotal: 1 });
  });

  it("G-01 - an ACTIVE card reports enrolmentStatus ACTIVE", async () => {
    const svc = makeService(completedFixtures({ enrolments: [enrolment()] }));
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.enrolmentStatus).toBe("ACTIVE");
  });

  it("a flagged certificate on a COMPLETED enrolment is kind 'flagged' and still carries certificateId", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED" })],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
        certificates: [{ ...activeCert, reviewFlaggedAt: new Date("2026-09-10T00:00:00.000Z") }],
      }),
    );
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.certificate).toMatchObject({ kind: "flagged", certificateId: "cert-1" });
  });

  it("G-01 - a COMPLETED card's nextAction is 'complete' even with an incomplete required lesson and a session within 24 hours", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED" })],
        sessionsByCohort: { "cohort-1": [soonSession] },
      }),
    );
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.progress.requiredLessonsComplete).toBe(0);
    expect(card.nextAction).toEqual({ kind: "complete" });

    // The same fixture ACTIVE proves the COMPLETED guard is what suppresses the link.
    const active = makeService(
      completedFixtures({ enrolments: [enrolment()], sessionsByCohort: { "cohort-1": [soonSession] } }),
    );
    const [activeCard] = (await active.loadLearnerDashboard(actorA)).cards;
    expect(activeCard.nextAction.kind).toBe("session");
  });

  it("G-01 - learnerResults reads are never called for a COMPLETED card, but are for an ACTIVE one", async () => {
    const getOwnAssessmentObligations = vi.fn(async () => [] as AssessmentObligation[]);
    const getOwnResults = vi.fn(async () => [] as LearnerResultCard[]);
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ id: "enrolment-done", status: "COMPLETED" }), enrolment({ id: "enrolment-live" })],
        learnerResults: { getOwnAssessmentObligations, getOwnResults },
      }),
    );

    const { cards } = await svc.loadLearnerDashboard(actorA);
    expect(cards).toHaveLength(2);
    expect(getOwnAssessmentObligations).toHaveBeenCalledTimes(1);
    expect(getOwnAssessmentObligations).toHaveBeenCalledWith(actorA, { enrolmentId: "enrolment-live" });
    expect(getOwnResults).toHaveBeenCalledTimes(1);
    expect(getOwnResults).toHaveBeenCalledWith(actorA, { enrolmentId: "enrolment-live" });
  });

  it("orders ACTIVE cards before COMPLETED cards, and never lists another learner's COMPLETED enrolment (T-11-73)", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [
          enrolment({ id: "done-new", status: "COMPLETED", activatedAt: new Date("2026-08-01T00:00:00.000Z") }),
          enrolment({ id: "live-old", activatedAt: new Date("2026-01-01T00:00:00.000Z") }),
          enrolment({ id: "done-other-user", status: "COMPLETED", userId: "user-b" }),
        ],
        completionRecords: [{ enrolmentId: "done-other-user", scope: "COURSE" }],
        certificates: [{ ...activeCert, enrolmentId: "done-other-user", id: "cert-b" }],
      }),
    );
    const { cards } = await svc.loadLearnerDashboard(actorA);
    expect(cards.map((c) => c.enrolmentId)).toEqual(["live-old", "done-new"]);
    expect(cards.map((c) => c.enrolmentStatus)).toEqual(["ACTIVE", "COMPLETED"]);
    expect(cards.every((c) => c.certificate.kind === "not-complete")).toBe(true);
  });

  it("D-01 - a Programme-cohort COMPLETED enrolment resolves its certificate from the PROGRAMME scope key, ignoring COURSE rows", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED", cohortId: "cohort-prog" })],
        cohorts: [cohort({ id: "cohort-prog", courseId: null, programmeId: "programme-1", coursePublicationId: null })],
        completionRecords: [
          { enrolmentId: "enrolment-1", scope: "COURSE" },
          { enrolmentId: "enrolment-1", scope: "PROGRAMME" },
        ],
        certificates: [
          { ...activeCert, scope: "COURSE", id: "cert-course", verificationRef: "COURSE-REF" },
          { ...activeCert, scope: "PROGRAMME", id: "cert-programme", verificationRef: "PROGRAMME-REF" },
        ],
      }),
    );
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.enrolmentStatus).toBe("COMPLETED");
    expect(card.certificate).toMatchObject({ kind: "issued", certificateId: "cert-programme" });
    expect(card.nextAction).toEqual({ kind: "complete" });
  });

  it("reads completion records and certificates exactly once for one ACTIVE plus one COMPLETED enrolment (no N+1)", async () => {
    const completionFindMany = vi.fn();
    const certificateFindMany = vi.fn();
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ id: "enrolment-1", status: "COMPLETED" }), enrolment({ id: "enrolment-2" })],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
        certificates: [activeCert],
        wrapDashboardStore: (store) => ({
          ...store,
          completionRecord: {
            findMany: (args) => {
              completionFindMany(args);
              return store.completionRecord.findMany(args);
            },
          },
          certificate: {
            findMany: (args) => {
              certificateFindMany(args);
              return store.certificate.findMany(args);
            },
          },
        }),
      }),
    );

    const { cards } = await svc.loadLearnerDashboard(actorA);
    expect(cards).toHaveLength(2);
    expect(completionFindMany).toHaveBeenCalledTimes(1);
    expect(certificateFindMany).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // WR-06 - the certificate column is certificateEnabled-aware. The
  // enrolment's OWN scope decides which award is read (D-01): a COURSE cohort
  // reads Course.certificateEnabled, a PROGRAMME cohort reads
  // Programme.certificateEnabled, never a member course's flag.
  // -------------------------------------------------------------------------

  const programmeCohort = () =>
    cohort({ id: "cohort-prog", courseId: null, programmeId: "programme-1", coursePublicationId: null });

  it("WR-06 - a COURSE-cohort card whose Course has certificateEnabled false, with a completion record and no certificate, is not-applicable", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED" })],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
        courseCertificateEnabled: { "course-1": false },
      }),
    );
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.certificate).toEqual({ kind: "not-applicable" });
  });

  it("WR-06 - a PROGRAMME-cohort card follows Programme.certificateEnabled false, not the member course", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED", cohortId: "cohort-prog" })],
        cohorts: [programmeCohort()],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "PROGRAMME" }],
        courseCertificateEnabled: { "course-1": true },
        programmeCertificateEnabled: { "programme-1": false },
      }),
    );
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.certificate).toEqual({ kind: "not-applicable" });
  });

  it("WR-06 / D-01 - an enabled Programme whose member Course is disabled still yields pending-issuance", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED", cohortId: "cohort-prog" })],
        cohorts: [programmeCohort()],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "PROGRAMME" }],
        courseCertificateEnabled: { "course-1": false },
        programmeCertificateEnabled: { "programme-1": true },
      }),
    );
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.certificate).toEqual({ kind: "pending-issuance" });
  });

  it("WR-06 - certificateEnabled false never hides an existing certificate row (issued, flagged, revoked)", async () => {
    const run = async (cert: DashboardCertificateStoreRow) => {
      const svc = makeService(
        completedFixtures({
          enrolments: [enrolment({ status: "COMPLETED" })],
          certificates: [cert],
          courseCertificateEnabled: { "course-1": false },
        }),
      );
      return (await svc.loadLearnerDashboard(actorA)).cards[0].certificate;
    };
    expect(await run(activeCert)).toMatchObject({ kind: "issued", certificateId: "cert-1" });
    expect(await run({ ...activeCert, reviewFlaggedAt: new Date("2026-09-10T00:00:00.000Z") })).toMatchObject({
      kind: "flagged",
      certificateId: "cert-1",
    });
    expect(await run({ ...activeCert, status: "REVOKED" })).toEqual({ kind: "revoked" });
  });

  it("WR-06 - an award row that cannot be found is treated as NOT enabled", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ status: "COMPLETED" })],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
        wrapDashboardStore: (store) => ({ ...store, course: { findMany: async () => [] } }),
      }),
    );
    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.certificate).toEqual({ kind: "not-applicable" });
  });

  it("WR-06 - certificateEnabled true keeps pending-issuance / not-complete for the no-certificate branches", async () => {
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment({ id: "enrolment-1" }), enrolment({ id: "enrolment-2" })],
        completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
      }),
    );
    const { cards } = await svc.loadLearnerDashboard(actorA);
    expect(cards.map((c) => c.certificate.kind).sort()).toEqual(["not-complete", "pending-issuance"]);
  });

  it("WR-06 - reads Course and Programme certificateEnabled exactly once each for a mixed dashboard (no N+1)", async () => {
    const courseFindMany = vi.fn();
    const programmeFindMany = vi.fn();
    const svc = makeService(
      completedFixtures({
        enrolments: [
          enrolment({ id: "enrolment-1" }),
          enrolment({ id: "enrolment-2", cohortId: "cohort-prog" }),
          enrolment({ id: "enrolment-3" }),
        ],
        cohorts: [cohort(), programmeCohort()],
        wrapDashboardStore: (store) => ({
          ...store,
          course: {
            findMany: (args) => {
              courseFindMany(args);
              return store.course.findMany(args);
            },
          },
          programme: {
            findMany: (args) => {
              programmeFindMany(args);
              return store.programme.findMany(args);
            },
          },
        }),
      }),
    );
    const { cards } = await svc.loadLearnerDashboard(actorA);
    expect(cards).toHaveLength(3);
    expect(courseFindMany).toHaveBeenCalledTimes(1);
    expect(courseFindMany.mock.calls[0][0].where.id.in).toEqual(["course-1"]);
    expect(programmeFindMany).toHaveBeenCalledTimes(1);
    expect(programmeFindMany.mock.calls[0][0].where.id.in).toEqual(["programme-1"]);
  });

  it("WR-06 - a dashboard of only course cohorts issues no programme query", async () => {
    const programmeFindMany = vi.fn();
    const svc = makeService(
      completedFixtures({
        enrolments: [enrolment()],
        wrapDashboardStore: (store) => ({
          ...store,
          programme: {
            findMany: (args) => {
              programmeFindMany(args);
              return store.programme.findMany(args);
            },
          },
        }),
      }),
    );
    await svc.loadLearnerDashboard(actorA);
    expect(programmeFindMany).not.toHaveBeenCalled();
  });

  it("assessmentObligations returns a tracked inhabitant, in the order learner-results-service returned it, when the learner has outstanding assessments", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
      assessmentObligationsByEnrolment: {
        "enrolment-1": [
          assessmentObligation({ assessmentId: "a-1", title: "First Quiz" }),
          assessmentObligation({ assessmentId: "a-2", title: "Second Assignment", type: "ASSIGNMENT" }),
        ],
      },
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.assessmentObligations).toEqual({
      kind: "tracked",
      items: [
        assessmentObligation({ assessmentId: "a-1", title: "First Quiz" }),
        assessmentObligation({ assessmentId: "a-2", title: "Second Assignment", type: "ASSIGNMENT" }),
      ],
    });
  });

  it("assessmentObligations returns a tracked-but-empty inhabitant, not a deferred one, when nothing is due", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.assessmentObligations).toEqual({ kind: "tracked", items: [] });
  });

  it("results caps recent at 3 even when more released results exist, most-recent first", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
      resultsByEnrolment: {
        "enrolment-1": [
          resultCard({ assessmentId: "r-1", title: "Oldest", history: [{ kind: "attempt", ref: "x1", number: 1, at: new Date("2026-01-01T00:00:00.000Z"), status: "SUBMITTED", score: 8 }] }),
          resultCard({ assessmentId: "r-2", title: "Newest", history: [{ kind: "attempt", ref: "x2", number: 1, at: new Date("2026-09-01T00:00:00.000Z"), status: "SUBMITTED", score: 8 }] }),
          resultCard({ assessmentId: "r-3", title: "Middle-old", history: [{ kind: "attempt", ref: "x3", number: 1, at: new Date("2026-03-01T00:00:00.000Z"), status: "SUBMITTED", score: 8 }] }),
          resultCard({ assessmentId: "r-4", title: "Middle-new", history: [{ kind: "attempt", ref: "x4", number: 1, at: new Date("2026-06-01T00:00:00.000Z"), status: "SUBMITTED", score: 8 }] }),
        ],
      },
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.results.kind).toBe("tracked");
    const recent = card.results.kind === "tracked" ? card.results.recent : [];
    expect(recent).toHaveLength(3);
    expect(recent.map((r) => r.assessmentId)).toEqual(["r-2", "r-4", "r-3"]);
  });

  it("results returns a tracked-empty inhabitant, not a deferred one, when the learner has no released results", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.results).toEqual({ kind: "tracked", recent: [] });
  });

  it("falls back to the deferred inhabitant for both columns when the cohort is unpinned (no computable obligation set)", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: null })],
      courses: [course()],
      assessmentObligationsByEnrolment: {
        "enrolment-1": [assessmentObligation()],
      },
      resultsByEnrolment: {
        "enrolment-1": [resultCard()],
      },
    });

    const [card] = (await svc.loadLearnerDashboard(actorA)).cards;
    expect(card.assessmentObligations).toEqual({ kind: "deferred", phase: 10 });
    expect(card.results).toEqual({ kind: "deferred", phase: 10 });
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
