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
} from "@/server/services/learner-access";
import type { Actor } from "@/server/permissions/with-permission";

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

function makeStore(opts: {
  enrolments?: EnrolmentStoreRow[];
  cohorts?: CohortStoreRow[];
  cohortCourses?: CohortCourseStoreRow[];
}): LearnerAccessStore {
  const enrolments = opts.enrolments ?? [];
  const cohorts = opts.cohorts ?? [];
  const cohortCourses = opts.cohortCourses ?? [];

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
