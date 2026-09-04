/**
 * Plan 05-06: the scheduled-session service (COH-03).
 *
 * Driven by in-memory fake delegates plus a harness-built `withPermission`
 * (`createTestWithPermission`). No real Postgres — timezone-correct creation,
 * the member-course tag guard, soft-cancel, the repeat-weekly row-inserter and
 * the meeting-link visibility gate are all provable against fakes.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createScheduledSessionService,
  isMeetingLinkVisible,
  InvalidTimeZoneError,
  SessionTimeRangeError,
  SessionCourseNotInCohortError,
  ReasonRequiredError,
  RepeatOccurrencesError,
  type ScheduledSessionRecord,
} from "@/server/services/scheduled-session-service";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { type Delegate } from "@/server/services/resource-service";

const LAGOS = "Africa/Lagos";
const NY = "America/New_York";

type CohortInfo = {
  timezone: string;
  courseId: string | null;
  programmeId: string | null;
  cohortCourses: Array<{ courseId: string }>;
};

function makeSessionRow(over: Partial<ScheduledSessionRecord> = {}): ScheduledSessionRecord {
  return {
    id: "session-1",
    cohortId: "cohort-1",
    courseId: null,
    title: "Week 1",
    startsAt: new Date("2026-03-01T08:00:00.000Z"),
    endsAt: new Date("2026-03-01T11:00:00.000Z"),
    location: null,
    meetingUrl: "https://meet.example/abc",
    linkVisibleFromMinutes: 60,
    facilitatorId: null,
    attendanceExpected: true,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  cohort?: CohortInfo | null;
  rows?: ScheduledSessionRecord[];
  enrolled?: boolean;
  now?: Date;
  createImpl?: (data: Record<string, unknown>) => ScheduledSessionRecord | never;
}) {
  const store = new Map(
    (opts?.rows ?? []).map((r) => [r.id, r] as const),
  );
  let seq = 0;
  const audits: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];

  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (opts?.createImpl) return opts.createImpl(data);
    seq += 1;
    const row = makeSessionRow({
      id: `session-new-${seq}`,
      ...(data as Partial<ScheduledSessionRecord>),
    });
    store.set(row.id, row);
    return row;
  });

  const delegate: Delegate<ScheduledSessionRecord> = {
    findMany: vi.fn(async ({ where }: { where?: unknown }) => {
      const cohortId = (where as { cohortId?: string })?.cohortId;
      return [...store.values()].filter((r) => !cohortId || r.cohortId === cohortId);
    }),
    findUnique: vi.fn(async ({ where }) => store.get(where.id) ?? null),
    create,
    update: vi.fn(async ({ where, data }) => {
      const next = {
        ...(store.get(where.id) as ScheduledSessionRecord),
        ...(data as Partial<ScheduledSessionRecord>),
      };
      store.set(where.id, next);
      return next;
    }),
  };

  const cohortRow: CohortInfo | null =
    opts && "cohort" in opts
      ? opts.cohort ?? null
      : { timezone: LAGOS, courseId: "course-1", programmeId: null, cohortCourses: [] };

  const cohort = {
    findUnique: vi.fn(async () => cohortRow),
  };

  // Transactional fake: writes land in `staged` and only merge to `store`
  // when the callback resolves. A mid-callback throw leaves `store` untouched.
  const db = {
    $transaction: async <R>(fn: (tx: unknown) => Promise<R>): Promise<R> => {
      const staged = new Map<string, ScheduledSessionRecord>();
      const tx = {
        scheduledSession: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const row = await create({ data });
            staged.set(row.id, row);
            return row;
          },
          update: async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const base = store.get(where.id) as ScheduledSessionRecord;
            const next = { ...base, ...(data as Partial<ScheduledSessionRecord>) };
            staged.set(where.id, next);
            return next;
          },
        },
        domainEvent: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            events.push(data);
            return { id: `evt-${events.length}` };
          },
        },
      };
      const result = await fn(tx);
      for (const [id, row] of staged) store.set(id, row);
      return result;
    },
  };

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("cohorts.view"), grant("cohorts.manage")],
  );

  const service = createScheduledSessionService({
    delegate,
    cohort: cohort as never,
    db: db as never,
    sessionScope: (id) => ({ cohortId: "cohort-1", courseIds: ["course-1"] }),
    cohortScope: (id) => ({ cohortId: id, courseIds: ["course-1"] }),
    isViewerEnrolled: async () => opts?.enrolled ?? true,
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    runInTransaction: (fn) => fn(),
    now: () => opts?.now ?? new Date("2026-02-01T00:00:00.000Z"),
  });

  return { service, delegate, cohort, audits, events, store };
}

const BASE_CREATE = {
  cohortId: "cohort-1",
  title: "Week 1",
  date: "2026-03-01",
  startTime: "09:00",
  endTime: "12:00",
};

describe("createSessionFromWallTime — timezone-correct creation (D-23)", () => {
  it("stores the exact UTC instant for a 09:00 Africa/Lagos wall time", async () => {
    const { service, store } = harness();
    const created = await service.createSessionFromWallTime(BASE_CREATE);
    expect(created.startsAt.toISOString()).toBe("2026-03-01T08:00:00.000Z");
    expect(created.endsAt.toISOString()).toBe("2026-03-01T11:00:00.000Z");
    expect(store.get(created.id)?.startsAt.toISOString()).toBe(
      "2026-03-01T08:00:00.000Z",
    );
  });

  it("converts through the cohort's own timezone, not a fixed offset", async () => {
    const { service } = harness({
      cohort: {
        timezone: NY,
        courseId: "course-1",
        programmeId: null,
        cohortCourses: [],
      },
    });
    const created = await service.createSessionFromWallTime(BASE_CREATE);
    // 2026-03-01 is EST (UTC-5) in New York.
    expect(created.startsAt.toISOString()).toBe("2026-03-01T14:00:00.000Z");
  });

  it("refuses an invalid cohort timezone before any write", async () => {
    const { service, delegate } = harness({
      cohort: {
        timezone: "Mars/Olympus",
        courseId: "course-1",
        programmeId: null,
        cohortCourses: [],
      },
    });
    await expect(service.createSessionFromWallTime(BASE_CREATE)).rejects.toBeInstanceOf(
      InvalidTimeZoneError,
    );
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it("refuses when endTime is not after startTime", async () => {
    const { service } = harness();
    await expect(
      service.createSessionFromWallTime({ ...BASE_CREATE, endTime: "09:00" }),
    ).rejects.toBeInstanceOf(SessionTimeRangeError);
  });

  it("requires cohorts.manage", async () => {
    const { service } = harness({ grants: [grant("cohorts.view")] });
    await expect(service.createSessionFromWallTime(BASE_CREATE)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("emits a session.created domain event and audits", async () => {
    const { service, events, audits } = harness();
    await service.createSessionFromWallTime(BASE_CREATE);
    expect(events.map((e) => e.type)).toContain("session.created");
    expect(audits.some((a) => a.action === "session.created" && a.outcome === "SUCCESS")).toBe(
      true,
    );
  });
});

describe("createSessionFromWallTime — member-course tag (D-24)", () => {
  it("allows courseId omitted", async () => {
    const { service } = harness();
    await expect(service.createSessionFromWallTime(BASE_CREATE)).resolves.toBeTruthy();
  });

  it("refuses a courseId on a standalone-Course cohort", async () => {
    const { service } = harness();
    await expect(
      service.createSessionFromWallTime({ ...BASE_CREATE, courseId: "course-1" }),
    ).rejects.toBeInstanceOf(SessionCourseNotInCohortError);
  });

  it("refuses a courseId that is not a member of the Programme cohort", async () => {
    const { service } = harness({
      cohort: {
        timezone: LAGOS,
        courseId: null,
        programmeId: "programme-1",
        cohortCourses: [{ courseId: "course-a" }, { courseId: "course-b" }],
      },
    });
    await expect(
      service.createSessionFromWallTime({ ...BASE_CREATE, courseId: "course-z" }),
    ).rejects.toBeInstanceOf(SessionCourseNotInCohortError);
  });

  it("accepts a member course of the Programme cohort", async () => {
    const { service } = harness({
      cohort: {
        timezone: LAGOS,
        courseId: null,
        programmeId: "programme-1",
        cohortCourses: [{ courseId: "course-a" }, { courseId: "course-b" }],
      },
    });
    const created = await service.createSessionFromWallTime({
      ...BASE_CREATE,
      courseId: "course-b",
    });
    expect(created.courseId).toBe("course-b");
  });
});

describe("cancelSession — soft-cancel with a mandatory reason (D-26)", () => {
  it("sets cancelledAt + cancellationReason and leaves the row in place", async () => {
    const { service, store } = harness({ rows: [makeSessionRow()] });
    const result = await service.cancelSession({
      sessionId: "session-1",
      reason: "Facilitator unavailable",
    });
    expect(result.cancelledAt).toBeInstanceOf(Date);
    expect(result.cancellationReason).toBe("Facilitator unavailable");
    expect(store.get("session-1")).toBeTruthy();
  });

  it("refuses a blank reason with ReasonRequiredError", async () => {
    const { service } = harness({ rows: [makeSessionRow()] });
    await expect(
      service.cancelSession({ sessionId: "session-1", reason: "   " }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("emits session.cancelled and audits before/after", async () => {
    const { service, events, audits } = harness({ rows: [makeSessionRow()] });
    await service.cancelSession({ sessionId: "session-1", reason: "Venue lost" });
    expect(events.map((e) => e.type)).toContain("session.cancelled");
    const audit = audits.find((a) => a.action === "session.cancelled");
    expect(audit?.before).toBeTruthy();
    expect(audit?.after).toBeTruthy();
  });

  it("has no delete operation on the service or delegate", async () => {
    const { service, delegate } = harness({ rows: [makeSessionRow()] });
    expect((service as Record<string, unknown>).delete).toBeUndefined();
    expect((delegate as Record<string, unknown>).delete).toBeUndefined();
  });
});

describe("listSessionsForCohort", () => {
  it("returns sessions ordered by startsAt including cancelled ones, with the timezone label, and no meetingUrl", async () => {
    const rows = [
      makeSessionRow({ id: "s2", startsAt: new Date("2026-03-08T08:00:00.000Z") }),
      makeSessionRow({
        id: "s1",
        startsAt: new Date("2026-03-01T08:00:00.000Z"),
        cancelledAt: new Date("2026-02-20T00:00:00.000Z"),
        cancellationReason: "snowed off",
      }),
    ];
    const { service } = harness({ rows });
    const list = await service.listSessionsForCohort("cohort-1");
    expect(list.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(list[0].cancelledAt).toBeInstanceOf(Date);
    expect(list[0].timezone).toBe(LAGOS);
    expect("meetingUrl" in list[0]).toBe(false);
  });

  it("requires cohorts.view", async () => {
    const { service } = harness({ grants: [], rows: [makeSessionRow()] });
    await expect(service.listSessionsForCohort("cohort-1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe("repeatWeeklySessions — the ×N row inserter (D-22)", () => {
  const REPEAT = { ...BASE_CREATE, occurrences: 4 };

  it("inserts exactly N rows at 7-day wall-clock steps", async () => {
    const { service } = harness();
    const created = await service.repeatWeeklySessions(REPEAT);
    expect(created).toHaveLength(4);
    const starts = created.map((s) => s.startsAt.toISOString());
    expect(starts).toEqual([
      "2026-03-01T08:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-15T08:00:00.000Z",
      "2026-03-22T08:00:00.000Z",
    ]);
  });

  it("keeps the same local start time across a DST boundary", async () => {
    // New York springs forward on 2026-03-08. A 09:00 local start on 03-01
    // (EST, UTC-5 -> 14:00Z) must still be 09:00 local on 03-08 (EDT, UTC-4 -> 13:00Z).
    const { service } = harness({
      cohort: {
        timezone: NY,
        courseId: "course-1",
        programmeId: null,
        cohortCourses: [],
      },
    });
    const created = await service.repeatWeeklySessions({ ...REPEAT, occurrences: 2 });
    expect(created[0].startsAt.toISOString()).toBe("2026-03-01T14:00:00.000Z");
    expect(created[1].startsAt.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("refuses occurrences below 1 or above 52", async () => {
    const { service } = harness();
    await expect(
      service.repeatWeeklySessions({ ...REPEAT, occurrences: 0 }),
    ).rejects.toBeInstanceOf(RepeatOccurrencesError);
    await expect(
      service.repeatWeeklySessions({ ...REPEAT, occurrences: 53 }),
    ).rejects.toBeInstanceOf(RepeatOccurrencesError);
  });

  it("inserts all N rows in one transaction — a mid-loop failure leaves zero rows", async () => {
    let calls = 0;
    const { service, store } = harness({
      createImpl: (data) => {
        calls += 1;
        if (calls === 3) throw new Error("row 3 blew up");
        return makeSessionRow({ id: `session-new-${calls}`, ...(data as Partial<ScheduledSessionRecord>) });
      },
    });
    await expect(service.repeatWeeklySessions(REPEAT)).rejects.toThrow("row 3 blew up");
    expect(store.size).toBe(0);
  });

  it("emits one session.created event per row", async () => {
    const { service, events } = harness();
    await service.repeatWeeklySessions(REPEAT);
    expect(events.filter((e) => e.type === "session.created")).toHaveLength(4);
  });
});

describe("isMeetingLinkVisible — the visibility gate (D-25)", () => {
  const startsAt = new Date("2026-03-01T09:00:00.000Z");
  const session = { startsAt, linkVisibleFromMinutes: 60, cancelledAt: null };

  it("is false one minute before the window opens", () => {
    const now = new Date(startsAt.getTime() - 61 * 60_000);
    expect(isMeetingLinkVisible(session, now, { enrolled: true })).toBe(false);
  });

  it("is true at exactly startsAt - linkVisibleFromMinutes", () => {
    const now = new Date(startsAt.getTime() - 60 * 60_000);
    expect(isMeetingLinkVisible(session, now, { enrolled: true })).toBe(true);
  });

  it("is true after startsAt", () => {
    const now = new Date(startsAt.getTime() + 30 * 60_000);
    expect(isMeetingLinkVisible(session, now, { enrolled: true })).toBe(true);
  });

  it("is false at every instant for an unenrolled viewer", () => {
    const after = new Date(startsAt.getTime() + 60 * 60_000);
    expect(isMeetingLinkVisible(session, after, { enrolled: false })).toBe(false);
  });

  it("is false for a cancelled session even inside the window", () => {
    const cancelled = { ...session, cancelledAt: new Date("2026-02-25T00:00:00.000Z") };
    expect(isMeetingLinkVisible(cancelled, startsAt, { enrolled: true })).toBe(false);
  });
});

describe("readSessionForViewer — server-side link gate", () => {
  it("includes meetingUrl only when the gate is open", async () => {
    const { service } = harness({
      rows: [makeSessionRow({ startsAt: new Date("2026-02-01T00:30:00.000Z") })],
      enrolled: true,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const result = await service.readSessionForViewer({ sessionId: "session-1" });
    expect(result.meetingUrl).toBe("https://meet.example/abc");
  });

  it("omits the meetingUrl key entirely when the gate is closed and returns an availableFrom instant", async () => {
    const { service } = harness({
      rows: [makeSessionRow({ startsAt: new Date("2026-06-01T09:00:00.000Z") })],
      enrolled: true,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const result = await service.readSessionForViewer({ sessionId: "session-1" });
    expect("meetingUrl" in result).toBe(false);
    expect(result.meetingUrlAvailableFrom).toBeInstanceOf(Date);
  });

  it("omits meetingUrl for an unenrolled viewer", async () => {
    const { service } = harness({
      rows: [makeSessionRow({ startsAt: new Date("2026-02-01T00:30:00.000Z") })],
      enrolled: false,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const result = await service.readSessionForViewer({ sessionId: "session-1" });
    expect("meetingUrl" in result).toBe(false);
  });
});
