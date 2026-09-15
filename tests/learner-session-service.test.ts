/**
 * Plan 09-10 Task 1: `learner-session-service.ts` — the ownership-scoped
 * LRN-06 session read with the server-side meeting-link gate (DD-23, DD-24).
 *
 * Driven entirely by an in-memory fake store plus a real
 * `createLearnerAccessService` instance built over its own in-memory fake —
 * mirroring `tests/enrolment-dashboard-service.test.ts`'s own injected-store
 * convention. No Postgres, no module mocking.
 */

import { describe, expect, it } from "vitest";
import {
  createLearnerSessionService,
  type LearnerSessionStore,
  type LearnerSessionStoreRow,
  type LearnerSessionAttendanceStoreRow,
} from "@/server/services/learner-session-service";
import {
  createLearnerAccessService,
  type LearnerAccessStore,
  type EnrolmentStoreRow,
  type CohortStoreRow,
} from "@/server/services/learner-access";
import type { Actor } from "@/server/permissions/with-permission";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const MEETING_URL = "https://meet.example.com/room/abc-123-secret";

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
    coursePublicationId: null,
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

function session(overrides: Partial<LearnerSessionStoreRow> = {}): LearnerSessionStoreRow {
  return {
    id: "session-1",
    title: "Session One",
    startsAt: new Date("2026-09-20T10:00:00.000Z"),
    endsAt: new Date("2026-09-20T12:00:00.000Z"),
    location: null,
    meetingUrl: null,
    linkVisibleFromMinutes: 60,
    cancelledAt: null,
    cancellationReason: null,
    ...overrides,
  };
}

function makeLearnerAccessStore(opts: {
  enrolments?: EnrolmentStoreRow[];
  cohorts?: CohortStoreRow[];
}): LearnerAccessStore {
  const enrolments = opts.enrolments ?? [];
  const cohorts = opts.cohorts ?? [];
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
      findMany: async () => [],
      findFirst: async () => null,
    },
    course: {
      findUnique: async () => null,
    },
    coursePublication: {
      findUnique: async () => null,
    },
    programmePublication: {
      findUnique: async () => null,
    },
    module: {
      findMany: async () => [],
    },
    lesson: {
      findMany: async () => [],
    },
    lessonProgress: {
      findMany: async () => [],
    },
  };
}

function makeSessionStore(opts: {
  sessionsByCohort?: Record<string, LearnerSessionStoreRow[]>;
  attendanceByEnrolment?: Record<string, LearnerSessionAttendanceStoreRow[]>;
}): LearnerSessionStore {
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

function makeService(opts: {
  enrolments?: EnrolmentStoreRow[];
  cohorts?: CohortStoreRow[];
  sessionsByCohort?: Record<string, LearnerSessionStoreRow[]>;
  attendanceByEnrolment?: Record<string, LearnerSessionAttendanceStoreRow[]>;
  now?: () => Date;
}) {
  const learnerAccessStore = makeLearnerAccessStore(opts);
  const learnerAccess = createLearnerAccessService({
    store: learnerAccessStore,
    now: opts.now ?? (() => NOW),
  });
  const sessionStore = makeSessionStore(opts);
  return createLearnerSessionService({
    store: sessionStore,
    access: { getOwnActiveEnrolment: learnerAccess.getOwnActiveEnrolment },
    now: opts.now ?? (() => NOW),
  });
}

describe("listOwnCohortSessions", () => {
  it("returns null when the enrolment does not exist", async () => {
    const svc = makeService({});
    const result = await svc.listOwnCohortSessions(actorA, "missing-enrolment", NOW);
    expect(result).toBeNull();
  });

  it("returns null when the enrolment belongs to another learner (T-09-01 denial parity)", async () => {
    const svc = makeService({
      enrolments: [enrolment({ id: "enrolment-1", userId: "user-b" })],
      cohorts: [cohort()],
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result).toBeNull();
  });

  it("returns null when the enrolment is not ACTIVE", async () => {
    const svc = makeService({
      enrolments: [enrolment({ status: "PENDING_PAYMENT" })],
      cohorts: [cohort()],
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result).toBeNull();
  });

  it("returns the cohort's timezone", async () => {
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort({ timezone: "Africa/Lagos" })],
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result?.timezone).toBe("Africa/Lagos");
  });

  it("splits sessions into upcoming (ascending) and past (descending) by endsAt vs now", async () => {
    const future1 = session({
      id: "future-1",
      startsAt: new Date("2026-09-25T10:00:00.000Z"),
      endsAt: new Date("2026-09-25T12:00:00.000Z"),
    });
    const future2 = session({
      id: "future-2",
      startsAt: new Date("2026-09-22T10:00:00.000Z"),
      endsAt: new Date("2026-09-22T12:00:00.000Z"),
    });
    const past1 = session({
      id: "past-1",
      startsAt: new Date("2026-09-01T10:00:00.000Z"),
      endsAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    const past2 = session({
      id: "past-2",
      startsAt: new Date("2026-09-05T10:00:00.000Z"),
      endsAt: new Date("2026-09-05T12:00:00.000Z"),
    });

    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [future1, future2, past1, past2] },
    });

    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result?.upcoming.map((s) => s.id)).toEqual(["future-2", "future-1"]);
    expect(result?.past.map((s) => s.id)).toEqual(["past-2", "past-1"]);
  });

  it('"meetingUrl" is absent one minute before the visibility window opens', async () => {
    // startsAt in 61 minutes, linkVisibleFromMinutes 60 -> opens in 1 minute, not yet.
    const startsAt = new Date(NOW.getTime() + 61 * 60_000);
    const s = session({ startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), meetingUrl: MEETING_URL, linkVisibleFromMinutes: 60 });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    const view = result?.upcoming[0];
    expect(view).toBeDefined();
    expect("meetingUrl" in (view as object)).toBe(false);
    expect(view?.meetingUrlAvailableFrom).toEqual(new Date(startsAt.getTime() - 60 * 60_000));
  });

  it('"meetingUrl" is present one minute after the visibility window opens', async () => {
    // startsAt in 59 minutes, linkVisibleFromMinutes 60 -> opened 1 minute ago.
    const startsAt = new Date(NOW.getTime() + 59 * 60_000);
    const s = session({ startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), meetingUrl: MEETING_URL, linkVisibleFromMinutes: 60 });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    const view = result?.upcoming[0];
    expect(view).toBeDefined();
    expect("meetingUrl" in (view as object)).toBe(true);
    expect(view?.meetingUrl).toBe(MEETING_URL);
  });

  it("a cancelled session inside its window has neither meetingUrl nor meetingUrlAvailableFrom", async () => {
    const startsAt = new Date(NOW.getTime() + 59 * 60_000);
    const s = session({
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      meetingUrl: MEETING_URL,
      linkVisibleFromMinutes: 60,
      cancelledAt: new Date(NOW.getTime() - 1_000),
      cancellationReason: "Facilitator unavailable",
    });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    const view = result?.upcoming[0];
    expect(view).toBeDefined();
    expect("meetingUrl" in (view as object)).toBe(false);
    expect("meetingUrlAvailableFrom" in (view as object)).toBe(false);
  });

  it("a virtual session outside its window reports mode: virtual without exposing the URL", async () => {
    const startsAt = new Date(NOW.getTime() + 61 * 60_000);
    const s = session({
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      meetingUrl: MEETING_URL,
      linkVisibleFromMinutes: 60,
    });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    const view = result?.upcoming[0];
    expect(view?.mode).toBe("virtual");
    expect(JSON.stringify(view)).not.toContain(MEETING_URL);
  });

  it("an in-person session (no meetingUrl, has location) reports mode: in-person", async () => {
    const s = session({ location: "Room 204, Main Campus", meetingUrl: null });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result?.upcoming[0].mode).toBe("in-person");
  });

  it("a session with neither meetingUrl nor location reports mode: unknown", async () => {
    const s = session({ location: null, meetingUrl: null });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result?.upcoming[0].mode).toBe("unknown");
  });

  it("carries the caller's own attendance state for a past session", async () => {
    const s = session({
      id: "past-session",
      startsAt: new Date("2026-09-01T10:00:00.000Z"),
      endsAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
      attendanceByEnrolment: {
        "enrolment-1": [{ sessionId: "past-session", state: "LATE" }],
      },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result?.past[0].attendance).toBe("LATE");
  });

  it('defaults attendance to "NOT_RECORDED" when no AttendanceRecord row exists', async () => {
    const s = session({
      id: "past-session",
      startsAt: new Date("2026-09-01T10:00:00.000Z"),
      endsAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    const svc = makeService({
      enrolments: [enrolment()],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result?.past[0].attendance).toBe("NOT_RECORDED");
  });

  it("never returns another learner's AttendanceRecord for the same session", async () => {
    const s = session({
      id: "shared-session",
      startsAt: new Date("2026-09-01T10:00:00.000Z"),
      endsAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    const svc = makeService({
      enrolments: [enrolment({ id: "enrolment-1", userId: "user-a" })],
      cohorts: [cohort()],
      sessionsByCohort: { "cohort-1": [s] },
      attendanceByEnrolment: {
        // Another learner's enrolment id in the same cohort — must never be read.
        "enrolment-other": [{ sessionId: "shared-session", state: "PRESENT" }],
      },
    });
    const result = await svc.listOwnCohortSessions(actorA, "enrolment-1", NOW);
    expect(result?.past[0].attendance).toBe("NOT_RECORDED");
  });
});
