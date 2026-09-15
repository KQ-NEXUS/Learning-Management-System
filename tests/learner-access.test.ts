/**
 * Plan 09-03: `learner-access.ts` — ownership-scoped enrolment resolution
 * (Task 1), pinned course structure / completion-rule source (Task 2), and
 * the sequencing-applied learner path + server-side open gate (Task 3).
 *
 * Driven entirely by an in-memory fake `LearnerAccessStore` — no Postgres —
 * mirroring `tests/roster-service.test.ts` and `tests/checkout-service.test.ts`'s
 * own injected-store convention.
 */

import { describe, expect, it } from "vitest";
import {
  createLearnerAccessService,
  type LearnerAccessStore,
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
import type { CourseObligationPayload, ProgrammeObligationPayload } from "@/server/services/publication";

// ---------------------------------------------------------------------------
// Fixtures + fake store
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-14T12:00:00.000Z");

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
    coursePublicationId: null,
    programmePublicationId: null,
    ...overrides,
  };
}

function enrolment(overrides: Partial<EnrolmentStoreRow> = {}): EnrolmentStoreRow {
  return {
    id: "enrolment-1",
    userId: "user-1",
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

function programmePayload(
  overrides: Partial<ProgrammeObligationPayload> = {},
): ProgrammeObligationPayload {
  return {
    schema: 1,
    sequential: true,
    completionRule: null,
    completionRuleVersion: 1,
    courses: [{ courseId: "course-1", position: 0 }],
    ...overrides,
  };
}

function makeStore(opts: {
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
      findUnique: async ({ where }) =>
        enrolments.find((e) => e.id === where.id) ?? null,
      findMany: async ({ where }) =>
        enrolments.filter((e) => e.userId === where.userId && e.status === where.status),
    },
    cohort: {
      findUnique: async ({ where }) => cohorts.find((c) => c.id === where.id) ?? null,
    },
    cohortCourse: {
      findMany: async ({ where }) => cohortCourses.filter((c) => c.cohortId === where.cohortId),
      findFirst: async ({ where }) =>
        cohortCourses.find((c) => c.cohortId === where.cohortId && c.courseId === where.courseId) ??
        null,
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

function progressRow(overrides: Partial<LessonProgressStoreRow> = {}): LessonProgressStoreRow {
  return {
    enrolmentId: "enrolment-1",
    lessonId: "lesson-1",
    completedAt: new Date("2026-01-05T00:00:00.000Z"),
    source: "MANUAL",
    ...overrides,
  };
}

function actorFor(userId: string): Actor {
  return { userId };
}

// ---------------------------------------------------------------------------
// Task 1 — ownership-scoped enrolment resolution
// ---------------------------------------------------------------------------

describe("getOwnActiveEnrolment", () => {
  it("returns null when the enrolment does not exist", async () => {
    const service = createLearnerAccessService({ store: makeStore({}), now: () => NOW });
    const result = await service.getOwnActiveEnrolment(actorFor("user-1"), "missing");
    expect(result).toBeNull();
  });

  it("returns null when the enrolment belongs to someone else", async () => {
    const store = makeStore({
      enrolments: [enrolment({ userId: "someone-else" })],
      cohorts: [cohort()],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const result = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    expect(result).toBeNull();
  });

  it("returns null when the enrolment is not ACTIVE", async () => {
    const store = makeStore({
      enrolments: [enrolment({ status: "PENDING_PAYMENT" })],
      cohorts: [cohort()],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const result = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    expect(result).toBeNull();
  });

  it("returns the identical null for all three denial causes", async () => {
    const storeMissing = makeStore({});
    const storeNotMine = makeStore({
      enrolments: [enrolment({ userId: "someone-else" })],
      cohorts: [cohort()],
    });
    const storeNotActive = makeStore({
      enrolments: [enrolment({ status: "WITHDRAWN" })],
      cohorts: [cohort()],
    });

    const svcMissing = createLearnerAccessService({ store: storeMissing, now: () => NOW });
    const svcNotMine = createLearnerAccessService({ store: storeNotMine, now: () => NOW });
    const svcNotActive = createLearnerAccessService({ store: storeNotActive, now: () => NOW });

    const r1 = await svcMissing.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const r2 = await svcNotMine.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const r3 = await svcNotActive.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(r3).toBeNull();
    expect(r1).toStrictEqual(r2);
    expect(r2).toStrictEqual(r3);
  });

  it("returns a snapshot with the access window computed, and readOnly true does not null the result", async () => {
    const store = makeStore({
      enrolments: [
        enrolment({
          activatedAt: new Date("2025-01-01T00:00:00.000Z"),
          accessEndsAt: new Date("2025-02-01T00:00:00.000Z"),
        }),
      ],
      cohorts: [cohort({ deliveryMode: "SELF_PACED", accessDurationDays: 30 })],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const result = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");

    expect(result).not.toBeNull();
    expect(result?.accessWindow.kind).toBe("windowed");
    expect(result?.accessWindow.readOnly).toBe(true);
    expect(result?.status).toBe("ACTIVE");
  });

  it("never returns a userId key on the snapshot", async () => {
    const store = makeStore({ enrolments: [enrolment()], cohorts: [cohort()] });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const result = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");

    expect(result).not.toBeNull();
    expect("userId" in (result as object)).toBe(false);
  });
});

describe("listOwnActiveEnrolments", () => {
  it("returns every ACTIVE enrolment for the actor, ordered by activatedAt descending with id as tiebreak", async () => {
    const store = makeStore({
      enrolments: [
        enrolment({ id: "e-a", activatedAt: new Date("2026-01-01T00:00:00.000Z") }),
        enrolment({ id: "e-b", activatedAt: new Date("2026-03-01T00:00:00.000Z") }),
        enrolment({ id: "e-c", activatedAt: new Date("2026-01-01T00:00:00.000Z") }), // tie with e-a
        enrolment({ id: "e-other-user", userId: "someone-else" }),
        enrolment({ id: "e-pending", status: "PENDING_PAYMENT" }),
      ],
      cohorts: [cohort()],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const results = await service.listOwnActiveEnrolments(actorFor("user-1"));

    expect(results.map((r) => r.id)).toEqual(["e-b", "e-a", "e-c"]);
  });
});

describe("hasActiveEnrolmentCoveringCourse", () => {
  it("is true for an ACTIVE enrolment in a standalone course-cohort covering that course", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ courseId: "course-1" })],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    expect(await service.hasActiveEnrolmentCoveringCourse("user-1", "course-1")).toBe(true);
  });

  it("is true for an ACTIVE enrolment in a programme-cohort whose CohortCourse covers that course", async () => {
    const store = makeStore({
      enrolments: [enrolment({ cohortId: "cohort-programme" })],
      cohorts: [cohort({ id: "cohort-programme", courseId: null, programmeId: "programme-1" })],
      cohortCourses: [
        { id: "cc-1", cohortId: "cohort-programme", courseId: "course-2", position: 0, coursePublicationId: null },
      ],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    expect(await service.hasActiveEnrolmentCoveringCourse("user-1", "course-2")).toBe(true);
  });

  it("is false for a PENDING_PAYMENT enrolment covering the same course", async () => {
    const store = makeStore({
      enrolments: [enrolment({ status: "PENDING_PAYMENT" })],
      cohorts: [cohort({ courseId: "course-1" })],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    expect(await service.hasActiveEnrolmentCoveringCourse("user-1", "course-1")).toBe(false);
  });

  it("is false for WITHDRAWN, CANCELLED, TRANSFERRED and COMPLETED enrolments", async () => {
    for (const status of ["WITHDRAWN", "CANCELLED", "TRANSFERRED", "COMPLETED"]) {
      const store = makeStore({
        enrolments: [enrolment({ status })],
        cohorts: [cohort({ courseId: "course-1" })],
      });
      const service = createLearnerAccessService({ store, now: () => NOW });
      expect(await service.hasActiveEnrolmentCoveringCourse("user-1", "course-1")).toBe(false);
    }
  });

  it("is false when no enrolment covers the course at all", async () => {
    const store = makeStore({ enrolments: [enrolment()], cohorts: [cohort({ courseId: "course-1" })] });
    const service = createLearnerAccessService({ store, now: () => NOW });
    expect(await service.hasActiveEnrolmentCoveringCourse("user-1", "course-999")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 2 — pinned course structure and pinned completion-rule source
// ---------------------------------------------------------------------------

describe("loadLearnerCourseStructure", () => {
  it("returns one course entry for a course-cohort", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: "pub-1" })],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const structure = await service.loadLearnerCourseStructure(own!);

    expect(structure.kind).toBe("structure");
    if (structure.kind !== "structure") throw new Error("unreachable");
    expect(structure.courses).toHaveLength(1);
    expect(structure.courses[0].courseId).toBe("course-1");
    expect(structure.courses[0].modules[0].lessons[0].id).toBe("lesson-1");
  });

  it("returns member courses ordered by CohortCourse position for a programme-cohort", async () => {
    const store = makeStore({
      enrolments: [enrolment({ cohortId: "cohort-prog" })],
      cohorts: [
        cohort({
          id: "cohort-prog",
          courseId: null,
          programmeId: "programme-1",
          programmePublicationId: "prog-pub-1",
        }),
      ],
      cohortCourses: [
        { id: "cc-2", cohortId: "cohort-prog", courseId: "course-2", position: 1, coursePublicationId: "pub-2" },
        { id: "cc-1", cohortId: "cohort-prog", courseId: "course-1", position: 0, coursePublicationId: "pub-1" },
      ],
      courses: [course({ id: "course-1", title: "Course One" }), course({ id: "course-2", title: "Course Two" })],
      coursePublications: {
        "pub-1": { payload: coursePayload() },
        "pub-2": {
          payload: coursePayload({
            modules: [
              {
                id: "module-2",
                position: 0,
                lessons: [{ id: "lesson-2", position: 0, required: true, type: "TEXT", assessmentId: null }],
              },
            ],
          }),
        },
      },
      modules: [moduleRow(), moduleRow({ id: "module-2", courseId: "course-2" })],
      lessons: [lessonRow(), lessonRow({ id: "lesson-2", moduleId: "module-2" })],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const structure = await service.loadLearnerCourseStructure(own!);

    expect(structure.kind).toBe("structure");
    if (structure.kind !== "structure") throw new Error("unreachable");
    expect(structure.courses.map((c) => c.courseId)).toEqual(["course-1", "course-2"]);
  });

  it("excludes a live lesson absent from the pinned payload entirely", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: "pub-1" })],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } }, // only lesson-1 pinned
      modules: [moduleRow()],
      lessons: [lessonRow(), lessonRow({ id: "lesson-2", position: 1 })], // lesson-2 live but not pinned
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const structure = await service.loadLearnerCourseStructure(own!);

    expect(structure.kind).toBe("structure");
    if (structure.kind !== "structure") throw new Error("unreachable");
    const lessonIds = structure.courses[0].modules[0].lessons.map((l) => l.id);
    expect(lessonIds).toEqual(["lesson-1"]);
  });

  it("still renders a pinned lesson that has since been withdrawn live", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: "pub-1" })],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } },
      modules: [moduleRow()],
      lessons: [lessonRow({ withdrawnAt: new Date("2026-02-01T00:00:00.000Z") })],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const structure = await service.loadLearnerCourseStructure(own!);

    expect(structure.kind).toBe("structure");
    if (structure.kind !== "structure") throw new Error("unreachable");
    const lesson = structure.courses[0].modules[0].lessons[0];
    expect(lesson.id).toBe("lesson-1");
    expect(lesson.withdrawnAt).not.toBeNull();
  });

  it("uses the PINNED required flag, not the live one, when they differ", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: "pub-1" })],
      courses: [course()],
      coursePublications: { "pub-1": { payload: coursePayload() } }, // pinned required: true
      modules: [moduleRow()],
      lessons: [lessonRow({ required: false })], // live required: false
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const structure = await service.loadLearnerCourseStructure(own!);

    expect(structure.kind).toBe("structure");
    if (structure.kind !== "structure") throw new Error("unreachable");
    expect(structure.courses[0].modules[0].lessons[0].required).toBe(true);
  });

  it("returns { kind: 'unpinned' } for a cohort with no publication pin at all, never a live-tree fallback", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: null })],
      courses: [course()],
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const structure = await service.loadLearnerCourseStructure(own!);

    expect(structure).toEqual({ kind: "unpinned" });
  });

  it("returns { kind: 'unpinned' } for a malformed publication payload", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: "pub-1" })],
      courses: [course()],
      coursePublications: { "pub-1": { payload: { garbage: true } } },
      modules: [moduleRow()],
      lessons: [lessonRow()],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const structure = await service.loadLearnerCourseStructure(own!);

    expect(structure).toEqual({ kind: "unpinned" });
  });
});

describe("loadPinnedCompletionRuleSource", () => {
  it("resolves a COURSE scope rule from the pinned CoursePublication for a course-cohort", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: "pub-1" })],
      coursePublications: { "pub-1": { payload: coursePayload({ completionRuleVersion: 3 }) } },
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const source = await service.loadPinnedCompletionRuleSource(own!, "course-1");

    expect(source).not.toBeNull();
    expect(source?.ruleVersion).toBe(3);
  });

  it("resolves a PROGRAMME scope rule from the pinned ProgrammePublication for a programme-cohort", async () => {
    const store = makeStore({
      enrolments: [enrolment({ cohortId: "cohort-prog" })],
      cohorts: [
        cohort({
          id: "cohort-prog",
          courseId: null,
          programmeId: "programme-1",
          programmePublicationId: "prog-pub-1",
        }),
      ],
      cohortCourses: [
        { id: "cc-1", cohortId: "cohort-prog", courseId: "course-1", position: 0, coursePublicationId: null },
      ],
      programmePublications: { "prog-pub-1": { payload: programmePayload({ completionRuleVersion: 5 }) } },
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const source = await service.loadPinnedCompletionRuleSource(own!, "course-1");

    expect(source).not.toBeNull();
    expect(source?.ruleVersion).toBe(5);
  });

  it("returns null when no pin exists", async () => {
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: null })],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const own = await service.getOwnActiveEnrolment(actorFor("user-1"), "enrolment-1");
    const source = await service.loadPinnedCompletionRuleSource(own!, "course-1");

    expect(source).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 3 — sequencing-applied learner path and the open gate
// ---------------------------------------------------------------------------

/** A single-module, two-required-lesson course-cohort fixture. */
function twoLessonCourseStore(
  overrides: {
    cohort?: Partial<CohortStoreRow>;
    enrolment?: Partial<EnrolmentStoreRow>;
    lessonProgress?: LessonProgressStoreRow[];
  } = {},
) {
  return makeStore({
    enrolments: [enrolment(overrides.enrolment)],
    cohorts: [cohort({ coursePublicationId: "pub-1", ...overrides.cohort })],
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
    lessons: [lessonRow({ title: "Lesson One" }), lessonRow({ id: "lesson-2", position: 1, title: "Lesson Two" })],
    lessonProgress: overrides.lessonProgress ?? [],
  });
}

describe("loadLearnerPath", () => {
  it("returns null for every denial cause getOwnActiveEnrolment returns null for", async () => {
    const store = makeStore({});
    const service = createLearnerAccessService({ store, now: () => NOW });
    expect(await service.loadLearnerPath(actorFor("user-1"), "missing")).toBeNull();
  });

  it("names the specific blocking lesson for a locked lesson", async () => {
    const store = twoLessonCourseStore();
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");

    const lesson2 = path!.courses[0].modules[0].lessons[1];
    expect(lesson2.locked).toBe(true);
    expect(lesson2.blockingLessonTitle).toBe("Lesson One");
  });

  it("unlocks a lesson once its blocker is completed", async () => {
    const store = twoLessonCourseStore({ lessonProgress: [progressRow({ lessonId: "lesson-1" })] });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");

    const lesson1 = path!.courses[0].modules[0].lessons[0];
    const lesson2 = path!.courses[0].modules[0].lessons[1];
    expect(lesson1.completed).toBe(true);
    expect(lesson1.completedAt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
    expect(lesson2.locked).toBe(false);
    expect(lesson2.blockingLessonTitle).toBeNull();
  });

  it("carries completedAt as null for a lesson with no LessonProgress row", async () => {
    const store = twoLessonCourseStore();
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");

    expect(path!.courses[0].modules[0].lessons[0].completedAt).toBeNull();
  });

  it("a programme cohort locks course 2's first lesson on course 1's last required lesson", async () => {
    const store = makeStore({
      enrolments: [enrolment({ cohortId: "cohort-prog" })],
      cohorts: [
        cohort({
          id: "cohort-prog",
          courseId: null,
          programmeId: "programme-1",
          programmePublicationId: "prog-pub-1",
        }),
      ],
      cohortCourses: [
        { id: "cc-1", cohortId: "cohort-prog", courseId: "course-1", position: 0, coursePublicationId: "pub-1" },
        { id: "cc-2", cohortId: "cohort-prog", courseId: "course-2", position: 1, coursePublicationId: "pub-2" },
      ],
      courses: [course({ id: "course-1", title: "Course One" }), course({ id: "course-2", title: "Course Two" })],
      coursePublications: {
        "pub-1": { payload: coursePayload() }, // course-1: module-1/lesson-1, required
        "pub-2": {
          payload: coursePayload({
            modules: [
              {
                id: "module-2",
                position: 0,
                lessons: [{ id: "lesson-2", position: 0, required: true, type: "TEXT", assessmentId: null }],
              },
            ],
          }),
        },
      },
      modules: [moduleRow(), moduleRow({ id: "module-2", courseId: "course-2" })],
      lessons: [
        lessonRow({ title: "Course 1 Last Lesson" }),
        lessonRow({ id: "lesson-2", moduleId: "module-2", title: "Course 2 First Lesson" }),
      ],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");

    const course2Lesson1 = path!.courses[1].modules[0].lessons[0];
    expect(course2Lesson1.locked).toBe(true);
    expect(course2Lesson1.blockingLessonTitle).toBe("Course 1 Last Lesson");
  });

  it("locks module 2's first lesson on module 1's incomplete required lesson, even though both are module-local position 0", async () => {
    // Regression for a real production bug found during the 09-14 human
    // walkthrough: `lesson.position` is module-LOCAL (each module's own
    // lessons start again at 0), but the old flattening only offset by
    // course index, never by module — so a two-module course collided
    // module-1-position-0 with module-2-position-0 in the global sequencing
    // walk. `evaluateLessonSequencing` tiebreaks equal positions by lesson
    // id string, so this only manifests when the id ordering contradicts
    // module order — real cuids collide this way; sequential test ids like
    // "lesson-1"/"lesson-2" coincidentally sort correctly and hide the bug
    // (confirmed: this exact test passed against the buggy code until the
    // ids below were chosen to sort the WRONG way, matching production).
    const store = makeStore({
      enrolments: [enrolment()],
      cohorts: [cohort({ coursePublicationId: "pub-1" })],
      courses: [course()],
      coursePublications: {
        "pub-1": {
          payload: coursePayload({
            modules: [
              {
                id: "module-1",
                position: 0,
                lessons: [{ id: "z-module-1-lesson", position: 0, required: true, type: "TEXT", assessmentId: null }],
              },
              {
                id: "module-2",
                position: 1,
                lessons: [{ id: "a-module-2-lesson", position: 0, required: true, type: "TEXT", assessmentId: null }],
              },
            ],
          }),
        },
      },
      modules: [moduleRow(), moduleRow({ id: "module-2", position: 1, title: "Module Two" })],
      lessons: [
        lessonRow({ id: "z-module-1-lesson", title: "Module 1 Lesson" }),
        lessonRow({ id: "a-module-2-lesson", moduleId: "module-2", title: "Module 2 Lesson" }),
      ],
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");

    const module2Lesson = path!.courses[0].modules[1].lessons[0];
    expect(module2Lesson.locked).toBe(true);
    expect(module2Lesson.blockingLessonTitle).toBe("Module 1 Lesson");
  });
});

describe("assertLessonOpenable", () => {
  it("refuses a locked lesson with reason 'locked'", async () => {
    const store = twoLessonCourseStore();
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");
    const result = service.assertLessonOpenable(path!, "lesson-2");

    expect(result).toEqual({ ok: false, reason: "locked" });
  });

  it("opens an unlocked lesson", async () => {
    const store = twoLessonCourseStore();
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");
    const result = service.assertLessonOpenable(path!, "lesson-1");

    expect(result.ok).toBe(true);
  });

  it("refuses with 'access-window-closed' for a readOnly window, even for an unlocked lesson", async () => {
    // Enrolment activated far enough in the past that the 30-day SELF_PACED window has closed by NOW.
    const store = twoLessonCourseStore({
      cohort: { deliveryMode: "SELF_PACED", accessDurationDays: 30 },
      enrolment: { activatedAt: new Date("2025-01-01T00:00:00.000Z"), accessEndsAt: null },
    });
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");

    expect(path!.enrolment.accessWindow.readOnly).toBe(true);
    const result = service.assertLessonOpenable(path!, "lesson-1");
    expect(result).toEqual({ ok: false, reason: "access-window-closed" });
  });

  it("refuses a cross-course lesson id with 'not-found', not 'locked'", async () => {
    const store = twoLessonCourseStore();
    const service = createLearnerAccessService({ store, now: () => NOW });
    const path = await service.loadLearnerPath(actorFor("user-1"), "enrolment-1");
    const result = service.assertLessonOpenable(path!, "lesson-from-another-course");

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});
