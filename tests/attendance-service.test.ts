/**
 * Plan 05-08: the attendance service (ATT-01..ATT-03).
 *
 * Driven by an in-memory staged-commit fake plus a harness-built
 * `withPermission` (`createTestWithPermission`). The real
 * `computeAttendanceComponent` and the real `writeDomainEvent` run against the
 * fake `tx`, so the "attendance.changed" payload is shaped for real at unit
 * level. No Postgres — `tests/attendance-service.integration.test.ts` proves
 * roster scoping, the window boundary and the event payload against the real
 * schema.
 */

import { describe, expect, it } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { writeDomainEvent } from "@/server/services/domain-event-service";
import { ATTENDANCE_MARKING_WINDOW_HOURS } from "@/lib/attendance-window";
import {
  CorrectionReasonRequiredError,
  createAttendanceService,
  LearnerNotOnRosterError,
  PreMarkingStateError,
} from "@/server/services/attendance-service";
import { AuthorizationError } from "@/server/permissions/with-permission";

// ---------------------------------------------------------------------------
// Time anchors — a session that ran on 2026-02-01, 10:00–12:00 UTC.
// ---------------------------------------------------------------------------

const STARTS_AT = new Date("2026-02-01T10:00:00.000Z");
const ENDS_AT = new Date("2026-02-01T12:00:00.000Z");
const WINDOW_MS = ATTENDANCE_MARKING_WINDOW_HOURS * 3_600_000;
const WINDOW_CLOSES_AT = new Date(ENDS_AT.getTime() + WINDOW_MS);

const BEFORE_START = new Date(STARTS_AT.getTime() - 60_000);
const DURING = new Date(STARTS_AT.getTime() + 30 * 60_000);
const AT_CLOSE = new Date(WINDOW_CLOSES_AT.getTime());
const JUST_AFTER_CLOSE = new Date(WINDOW_CLOSES_AT.getTime() + 1);

// ---------------------------------------------------------------------------
// Fake store + staged-commit transaction
// ---------------------------------------------------------------------------

type SessionRow = {
  id: string;
  cohortId: string;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
  attendanceExpected: boolean;
};

type CohortRow = { id: string; attendanceThresholdPct: number | null };

type EnrolmentRow = {
  id: string;
  cohortId: string;
  status: string;
  userId: string;
  userName: string;
  userEmail: string;
};

type RecordRow = {
  sessionId: string;
  enrolmentId: string;
  state: string;
  note: string | null;
  recordedById: string | null;
  recordedAt: Date | null;
  correctedById: string | null;
  correctedAt: Date | null;
  correctionReason: string | null;
};

const key = (sessionId: string, enrolmentId: string) => `${sessionId}:${enrolmentId}`;

function ses(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: over.id ?? "ses-1",
    cohortId: over.cohortId ?? "cohort-1",
    startsAt: over.startsAt ?? STARTS_AT,
    endsAt: over.endsAt ?? ENDS_AT,
    cancelledAt: over.cancelledAt ?? null,
    attendanceExpected: over.attendanceExpected ?? true,
  };
}

function coh(over: Partial<CohortRow> = {}): CohortRow {
  return {
    id: over.id ?? "cohort-1",
    attendanceThresholdPct:
      over.attendanceThresholdPct === undefined ? 75 : over.attendanceThresholdPct,
  };
}

function enr(over: Partial<EnrolmentRow> = {}): EnrolmentRow {
  const id = over.id ?? "enr-1";
  return {
    id,
    cohortId: over.cohortId ?? "cohort-1",
    status: over.status ?? "ACTIVE",
    userId: over.userId ?? `user-${id}`,
    userName: over.userName ?? `Learner ${id}`,
    userEmail: over.userEmail ?? `${id}@fixture.test`,
  };
}

function rec(over: Partial<RecordRow> & { sessionId: string; enrolmentId: string }): RecordRow {
  return {
    state: "NOT_RECORDED",
    note: null,
    recordedById: null,
    recordedAt: null,
    correctedById: null,
    correctedAt: null,
    correctionReason: null,
    ...over,
  };
}

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  now?: Date;
  sessions?: SessionRow[];
  cohorts?: CohortRow[];
  enrolments?: EnrolmentRow[];
  records?: RecordRow[];
}) {
  const sessions = new Map<string, SessionRow>(
    (opts?.sessions ?? [ses()]).map((s) => [s.id, { ...s }]),
  );
  const cohorts = new Map<string, CohortRow>(
    (opts?.cohorts ?? [coh()]).map((c) => [c.id, { ...c }]),
  );
  const enrolments = new Map<string, EnrolmentRow>(
    (opts?.enrolments ?? [enr()]).map((e) => [e.id, { ...e }]),
  );
  const records = new Map<string, RecordRow>(
    (opts?.records ?? []).map((r) => [key(r.sessionId, r.enrolmentId), { ...r }]),
  );
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];

  const now = opts?.now ?? DURING;

  const matchRecords = (
    store: Map<string, RecordRow>,
    where: { sessionId?: string; enrolmentId?: string },
  ) =>
    [...store.values()].filter(
      (r) =>
        (where.sessionId === undefined || r.sessionId === where.sessionId) &&
        (where.enrolmentId === undefined || r.enrolmentId === where.enrolmentId),
    );

  function makeTx(
    recStaged: Map<string, RecordRow>,
    evStaged: Array<Record<string, unknown>>,
  ) {
    return {
      attendanceRecord: {
        findUnique: async ({
          where,
        }: {
          where: { sessionId_enrolmentId: { sessionId: string; enrolmentId: string } };
        }) =>
          recStaged.get(
            key(
              where.sessionId_enrolmentId.sessionId,
              where.sessionId_enrolmentId.enrolmentId,
            ),
          ) ?? null,
        findMany: async ({
          where,
        }: {
          where: { sessionId?: string; enrolmentId?: string };
        }) => matchRecords(recStaged, where).map((r) => ({ ...r })),
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { sessionId_enrolmentId: { sessionId: string; enrolmentId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const k = key(
            where.sessionId_enrolmentId.sessionId,
            where.sessionId_enrolmentId.enrolmentId,
          );
          const existing = recStaged.get(k);
          const next: RecordRow = existing
            ? { ...existing, ...(update as Partial<RecordRow>) }
            : {
                ...rec({
                  sessionId: where.sessionId_enrolmentId.sessionId,
                  enrolmentId: where.sessionId_enrolmentId.enrolmentId,
                }),
                ...(create as Partial<RecordRow>),
              };
          recStaged.set(k, next);
          return { ...next };
        },
      },
      scheduledSession: {
        findMany: async ({ where }: { where: { cohortId: string } }) =>
          [...sessions.values()]
            .filter((s) => s.cohortId === where.cohortId)
            .map((s) => ({ ...s })),
      },
      cohort: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const c = cohorts.get(where.id);
          return c ? { attendanceThresholdPct: c.attendanceThresholdPct } : null;
        },
      },
      domainEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          evStaged.push(data);
          return { id: `evt-${evStaged.length}` };
        },
      },
    };
  }

  const runInTransaction = async <R>(fn: (tx: unknown) => Promise<R>): Promise<R> => {
    const recStaged = new Map<string, RecordRow>(
      [...records].map(([k, v]) => [k, { ...v }]),
    );
    const evStaged: Array<Record<string, unknown>> = [];
    const result = await fn(makeTx(recStaged, evStaged));
    for (const [k, v] of recStaged) records.set(k, v);
    for (const e of evStaged) events.push(e);
    return result;
  };

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("attendance.manage"), grant("attendance.view")],
  );

  const service = createAttendanceService({
    attendance: {
      findUnique: async ({
        where,
      }: {
        where: { sessionId_enrolmentId: { sessionId: string; enrolmentId: string } };
      }) =>
        records.get(
          key(
            where.sessionId_enrolmentId.sessionId,
            where.sessionId_enrolmentId.enrolmentId,
          ),
        ) ?? null,
      findMany: async ({
        where,
      }: {
        where: { sessionId?: string; enrolmentId?: string };
      }) => matchRecords(records, where).map((r) => ({ ...r })),
    } as never,
    session: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (sessions.get(where.id) as never) ?? null,
      findMany: async ({ where }: { where: { cohortId: string } }) =>
        [...sessions.values()].filter((s) => s.cohortId === where.cohortId) as never,
    } as never,
    enrolment: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const e = enrolments.get(where.id);
        return e
          ? ({
              id: e.id,
              cohortId: e.cohortId,
              status: e.status,
            } as never)
          : null;
      },
      findMany: async ({
        where,
      }: {
        where: { cohortId: string; status?: { notIn?: string[] } };
      }) =>
        [...enrolments.values()]
          .filter(
            (e) =>
              e.cohortId === where.cohortId &&
              (where.status?.notIn
                ? !where.status.notIn.includes(e.status)
                : true),
          )
          .map((e) => ({
            id: e.id,
            status: e.status,
            user: { id: e.userId, name: e.userName, email: e.userEmail },
          })) as never,
    } as never,
    cohort: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (cohorts.get(where.id) as never) ?? null,
    } as never,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    writeEvent: writeDomainEvent,
    runInTransaction: runInTransaction as never,
    sessionScope: (sessionId: string) => {
      const s = sessions.get(sessionId);
      return s ? { cohortId: s.cohortId, courseIds: [] } : {};
    },
    withPermission,
    now: () => now,
  });

  return { service, sessions, cohorts, enrolments, records, events, audits };
}

const changedEvents = (events: Array<Record<string, unknown>>) =>
  events.filter((e) => e.type === "attendance.changed");

// ---------------------------------------------------------------------------
// markAttendance — authorization + roster scoping
// ---------------------------------------------------------------------------

describe("markAttendance — authorization and roster scoping", () => {
  it("requires attendance.manage", async () => {
    const { service } = harness({ grants: [grant("attendance.view")] });
    await expect(
      service.markAttendance({
        sessionId: "ses-1",
        enrolmentId: "enr-1",
        state: "PRESENT",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses an enrolment that is not on the session's cohort roster and writes nothing", async () => {
    const { service, records, events } = harness({
      enrolments: [
        enr({ id: "enr-1", cohortId: "cohort-1" }),
        enr({ id: "enr-foreign", cohortId: "cohort-2" }),
      ],
    });
    await expect(
      service.markAttendance({
        sessionId: "ses-1",
        enrolmentId: "enr-foreign",
        state: "PRESENT",
      }),
    ).rejects.toBeInstanceOf(LearnerNotOnRosterError);
    expect(records.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("refuses an unknown enrolment id", async () => {
    const { service } = harness();
    await expect(
      service.markAttendance({
        sessionId: "ses-1",
        enrolmentId: "nope",
        state: "EXCUSED",
      }),
    ).rejects.toBeInstanceOf(LearnerNotOnRosterError);
  });
});

// ---------------------------------------------------------------------------
// markAttendance — the pre-marking restriction (D-09)
// ---------------------------------------------------------------------------

describe("markAttendance — pre-marking restriction (D-09)", () => {
  it("PRESENT before startsAt throws PreMarkingStateError and writes nothing", async () => {
    const { service, records, events } = harness({ now: BEFORE_START });
    await expect(
      service.markAttendance({
        sessionId: "ses-1",
        enrolmentId: "enr-1",
        state: "PRESENT",
      }),
    ).rejects.toBeInstanceOf(PreMarkingStateError);
    expect(records.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("ABSENT and LATE before startsAt are also refused", async () => {
    for (const state of ["ABSENT", "LATE"] as const) {
      const { service } = harness({ now: BEFORE_START });
      await expect(
        service.markAttendance({
          sessionId: "ses-1",
          enrolmentId: "enr-1",
          state,
        }),
      ).rejects.toBeInstanceOf(PreMarkingStateError);
    }
  });

  it("EXCUSED and NOT_RECORDED before startsAt succeed (no reason needed)", async () => {
    for (const state of ["EXCUSED", "NOT_RECORDED"] as const) {
      const { service, records } = harness({ now: BEFORE_START });
      const res = await service.markAttendance({
        sessionId: "ses-1",
        enrolmentId: "enr-1",
        state,
      });
      expect(res.state).toBe(state);
      expect(records.get(key("ses-1", "enr-1"))!.state).toBe(state);
      expect(records.get(key("ses-1", "enr-1"))!.correctionReason).toBeNull();
    }
  });

  it("PRESENT at exactly startsAt succeeds", async () => {
    const { service, records } = harness({ now: STARTS_AT });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
    });
    expect(records.get(key("ses-1", "enr-1"))!.state).toBe("PRESENT");
  });
});

// ---------------------------------------------------------------------------
// markAttendance — inside the window (D-07)
// ---------------------------------------------------------------------------

describe("markAttendance — inside the marking window (D-07)", () => {
  it("stamps recordedById/recordedAt, leaves the correction fields untouched, needs no reason", async () => {
    const { service, records } = harness({ now: DURING });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
      note: "arrived on time",
    });
    const row = records.get(key("ses-1", "enr-1"))!;
    expect(row.state).toBe("PRESENT");
    expect(row.note).toBe("arrived on time");
    expect(row.recordedById).toBe("user-1");
    expect(row.recordedAt).toEqual(DURING);
    expect(row.correctedById).toBeNull();
    expect(row.correctedAt).toBeNull();
    expect(row.correctionReason).toBeNull();
  });

  it("at exactly endsAt + 168h is still inside the window (no reason)", async () => {
    const { service, records } = harness({ now: AT_CLOSE });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "LATE",
    });
    const row = records.get(key("ses-1", "enr-1"))!;
    expect(row.state).toBe("LATE");
    expect(row.recordedById).toBe("user-1");
    expect(row.correctedAt).toBeNull();
  });

  it("re-marking the same learner upserts — never a second row", async () => {
    const { service, records } = harness({
      now: DURING,
      records: [rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "ABSENT" })],
    });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
    });
    expect([...records.values()].filter((r) => r.enrolmentId === "enr-1")).toHaveLength(1);
    expect(records.get(key("ses-1", "enr-1"))!.state).toBe("PRESENT");
  });

  it("emits exactly one attendance.changed event carrying ids, before, after and the component", async () => {
    const { service, events } = harness({
      now: DURING,
      cohorts: [coh({ attendanceThresholdPct: 75 })],
      records: [rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "ABSENT" })],
    });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
    });
    const evs = changedEvents(events);
    expect(evs).toHaveLength(1);
    const payload = evs[0].payload as Record<string, unknown>;
    expect(payload.sessionId).toBe("ses-1");
    expect(payload.enrolmentId).toBe("enr-1");
    expect(payload.cohortId).toBe("cohort-1");
    expect(payload.before).toBe("ABSENT");
    expect(payload.after).toBe("PRESENT");
    expect(payload.actorId).toBe("user-1");
    const component = payload.component as Record<string, unknown>;
    expect(component.kind).toBe("computed");
    expect(component.earnedPct).toBe(100);
  });

  it("records one audit row (before/after, reason null) with targetType Enrolment", async () => {
    const { service, audits } = harness({
      now: DURING,
      records: [rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "ABSENT" })],
    });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
    });
    const attendanceAudits = audits.filter((a) => a.targetType === "Enrolment");
    expect(attendanceAudits).toHaveLength(1);
    expect(attendanceAudits[0].targetId).toBe("enr-1");
    expect(attendanceAudits[0].before).toEqual({ state: "ABSENT" });
    expect(attendanceAudits[0].after).toEqual({ state: "PRESENT" });
    expect(attendanceAudits[0].reason).toBeNull();
  });

  it("a no-rule cohort still emits an event with a no-rule component", async () => {
    const { service, events } = harness({
      now: DURING,
      cohorts: [coh({ attendanceThresholdPct: null })],
    });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
    });
    const payload = changedEvents(events)[0].payload as Record<string, unknown>;
    expect((payload.component as Record<string, unknown>).kind).toBe("no-rule");
  });
});

// ---------------------------------------------------------------------------
// markAttendance — after the window closes (D-06 / D-08)
// ---------------------------------------------------------------------------

describe("markAttendance — after the marking window closes (D-08)", () => {
  it("one millisecond after endsAt + 168h, a blank reason throws and writes nothing", async () => {
    const { service, records, events } = harness({ now: JUST_AFTER_CLOSE });
    await expect(
      service.markAttendance({
        sessionId: "ses-1",
        enrolmentId: "enr-1",
        state: "PRESENT",
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(CorrectionReasonRequiredError);
    expect(records.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("a missing reason after the window also throws", async () => {
    const { service } = harness({ now: JUST_AFTER_CLOSE });
    await expect(
      service.markAttendance({
        sessionId: "ses-1",
        enrolmentId: "enr-1",
        state: "PRESENT",
      }),
    ).rejects.toBeInstanceOf(CorrectionReasonRequiredError);
  });

  it("a change with a reason stamps correctedById/correctedAt/correctionReason and leaves recordedById/recordedAt intact", async () => {
    const originalRecordedAt = new Date("2026-02-01T11:00:00.000Z");
    const { service, records } = harness({
      now: JUST_AFTER_CLOSE,
      records: [
        rec({
          sessionId: "ses-1",
          enrolmentId: "enr-1",
          state: "ABSENT",
          recordedById: "user-original",
          recordedAt: originalRecordedAt,
        }),
      ],
    });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
      reason: "learner produced a medical note",
    });
    const row = records.get(key("ses-1", "enr-1"))!;
    expect(row.state).toBe("PRESENT");
    expect(row.correctedById).toBe("user-1");
    expect(row.correctedAt).toEqual(JUST_AFTER_CLOSE);
    expect(row.correctionReason).toBe("learner produced a medical note");
    // the original record stamps survive
    expect(row.recordedById).toBe("user-original");
    expect(row.recordedAt).toEqual(originalRecordedAt);
  });

  it("the post-window audit row carries the correction reason", async () => {
    const { service, audits } = harness({
      now: JUST_AFTER_CLOSE,
      records: [rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "ABSENT" })],
    });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
      reason: "roll call error",
    });
    const audit = audits.find((a) => a.targetType === "Enrolment")!;
    expect(audit.reason).toBe("roll call error");
  });

  it("the post-window event still carries the recomputed component and a correction flag", async () => {
    const { service, events } = harness({
      now: JUST_AFTER_CLOSE,
      records: [rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "ABSENT" })],
    });
    await service.markAttendance({
      sessionId: "ses-1",
      enrolmentId: "enr-1",
      state: "PRESENT",
      reason: "corrected after review",
    });
    const payload = changedEvents(events)[0].payload as Record<string, unknown>;
    expect(payload.correction).toBe(true);
    expect((payload.component as Record<string, unknown>).kind).toBe("computed");
  });
});

// ---------------------------------------------------------------------------
// saveSessionAttendance — roster-scoped bulk (D-10, ATT-01)
// ---------------------------------------------------------------------------

const roster = () => [
  enr({ id: "enr-1", cohortId: "cohort-1" }),
  enr({ id: "enr-2", cohortId: "cohort-1" }),
  enr({ id: "enr-3", cohortId: "cohort-1" }),
];

describe("saveSessionAttendance — roster scoping (D-10)", () => {
  it("requires attendance.manage", async () => {
    const { service } = harness({
      grants: [grant("attendance.view")],
      enrolments: roster(),
    });
    await expect(
      service.saveSessionAttendance({
        sessionId: "ses-1",
        entries: [{ enrolmentId: "enr-1", state: "PRESENT" }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("writes every roster learner in one pass", async () => {
    const { service, records, events } = harness({ now: DURING, enrolments: roster() });
    const res = await service.saveSessionAttendance({
      sessionId: "ses-1",
      entries: [
        { enrolmentId: "enr-1", state: "PRESENT" },
        { enrolmentId: "enr-2", state: "ABSENT" },
        { enrolmentId: "enr-3", state: "LATE" },
      ],
    });
    expect(res.changed).toBe(3);
    expect(records.get(key("ses-1", "enr-1"))!.state).toBe("PRESENT");
    expect(records.get(key("ses-1", "enr-2"))!.state).toBe("ABSENT");
    expect(records.get(key("ses-1", "enr-3"))!.state).toBe("LATE");
    expect(changedEvents(events)).toHaveLength(3);
  });

  it("one out-of-roster entry causes ZERO writes and ZERO events — not even the valid entries", async () => {
    const { service, records, events } = harness({
      now: DURING,
      enrolments: [
        enr({ id: "enr-1", cohortId: "cohort-1" }),
        enr({ id: "enr-2", cohortId: "cohort-1" }),
        enr({ id: "enr-foreign", cohortId: "cohort-2" }),
      ],
    });
    await expect(
      service.saveSessionAttendance({
        sessionId: "ses-1",
        entries: [
          { enrolmentId: "enr-1", state: "PRESENT" },
          { enrolmentId: "enr-2", state: "PRESENT" },
          { enrolmentId: "enr-foreign", state: "PRESENT" },
        ],
      }),
    ).rejects.toBeInstanceOf(LearnerNotOnRosterError);
    expect(records.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("an unknown enrolment id is refused the same way", async () => {
    const { service, records } = harness({ now: DURING, enrolments: roster() });
    await expect(
      service.saveSessionAttendance({
        sessionId: "ses-1",
        entries: [
          { enrolmentId: "enr-1", state: "PRESENT" },
          { enrolmentId: "ghost", state: "PRESENT" },
        ],
      }),
    ).rejects.toBeInstanceOf(LearnerNotOnRosterError);
    expect(records.size).toBe(0);
  });

  it("a duplicate enrolmentId in the submitted list is refused with zero writes", async () => {
    const { service, records } = harness({ now: DURING, enrolments: roster() });
    await expect(
      service.saveSessionAttendance({
        sessionId: "ses-1",
        entries: [
          { enrolmentId: "enr-1", state: "PRESENT" },
          { enrolmentId: "enr-1", state: "ABSENT" },
        ],
      }),
    ).rejects.toBeInstanceOf(LearnerNotOnRosterError);
    expect(records.size).toBe(0);
  });
});

describe("saveSessionAttendance — per-entry timing rules", () => {
  it("a pre-start PRESENT entry fails the whole batch atomically", async () => {
    const { service, records } = harness({ now: BEFORE_START, enrolments: roster() });
    await expect(
      service.saveSessionAttendance({
        sessionId: "ses-1",
        entries: [
          { enrolmentId: "enr-1", state: "EXCUSED" },
          { enrolmentId: "enr-2", state: "PRESENT" },
        ],
      }),
    ).rejects.toBeInstanceOf(PreMarkingStateError);
    expect(records.size).toBe(0);
  });

  it("a post-window entry without a reason fails the whole batch atomically", async () => {
    const { service, records } = harness({ now: JUST_AFTER_CLOSE, enrolments: roster() });
    await expect(
      service.saveSessionAttendance({
        sessionId: "ses-1",
        entries: [
          { enrolmentId: "enr-1", state: "PRESENT", reason: "roll error" },
          { enrolmentId: "enr-2", state: "ABSENT" },
        ],
      }),
    ).rejects.toBeInstanceOf(CorrectionReasonRequiredError);
    expect(records.size).toBe(0);
  });

  it("a post-window batch with a reason per entry stamps the correction fields", async () => {
    const { service, records } = harness({
      now: JUST_AFTER_CLOSE,
      enrolments: roster(),
      records: [rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "ABSENT" })],
    });
    await service.saveSessionAttendance({
      sessionId: "ses-1",
      entries: [{ enrolmentId: "enr-1", state: "PRESENT", reason: "medical note produced" }],
    });
    const row = records.get(key("ses-1", "enr-1"))!;
    expect(row.correctedById).toBe("user-1");
    expect(row.correctionReason).toBe("medical note produced");
  });
});

describe("saveSessionAttendance — unchanged entries", () => {
  it("a save-all over an already-marked register emits zero events and writes nothing new", async () => {
    const { service, events, audits } = harness({
      now: DURING,
      enrolments: roster(),
      records: [
        rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "PRESENT" }),
        rec({ sessionId: "ses-1", enrolmentId: "enr-2", state: "ABSENT" }),
      ],
    });
    const res = await service.saveSessionAttendance({
      sessionId: "ses-1",
      entries: [
        { enrolmentId: "enr-1", state: "PRESENT" },
        { enrolmentId: "enr-2", state: "ABSENT" },
        { enrolmentId: "enr-3", state: "NOT_RECORDED" },
      ],
    });
    expect(res.changed).toBe(0);
    expect(changedEvents(events)).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("only the changed entries produce an event and an audit row", async () => {
    const { service, events, audits } = harness({
      now: DURING,
      enrolments: roster(),
      records: [
        rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "PRESENT" }),
        rec({ sessionId: "ses-1", enrolmentId: "enr-2", state: "ABSENT" }),
      ],
    });
    const res = await service.saveSessionAttendance({
      sessionId: "ses-1",
      entries: [
        { enrolmentId: "enr-1", state: "PRESENT" },
        { enrolmentId: "enr-2", state: "LATE" },
        { enrolmentId: "enr-3", state: "EXCUSED" },
      ],
    });
    expect(res.changed).toBe(2);
    expect(changedEvents(events)).toHaveLength(2);
    expect(audits.filter((a) => a.targetType === "Enrolment")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// loadSessionRegister — the marking-screen read (D-21)
// ---------------------------------------------------------------------------

describe("loadSessionRegister", () => {
  it("requires attendance.view", async () => {
    const { service } = harness({ grants: [grant("cohorts.view")], enrolments: roster() });
    await expect(
      service.loadSessionRegister({ sessionId: "ses-1" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("returns one row per non-terminal enrolment with identity, state and flags", async () => {
    const { service } = harness({
      now: DURING,
      enrolments: [
        enr({ id: "enr-1", cohortId: "cohort-1", status: "ACTIVE", userName: "Ada" }),
        enr({ id: "enr-2", cohortId: "cohort-1", status: "PENDING_PAYMENT", userName: "Bo" }),
        enr({ id: "enr-gone", cohortId: "cohort-1", status: "TRANSFERRED" }),
        enr({ id: "enr-void", cohortId: "cohort-1", status: "CANCELLED" }),
      ],
      records: [
        rec({ sessionId: "ses-1", enrolmentId: "enr-1", state: "PRESENT", note: "on time" }),
      ],
    });
    const rows = await service.loadSessionRegister({ sessionId: "ses-1" });
    expect(rows.map((r) => r.enrolmentId).sort()).toEqual(["enr-1", "enr-2"]);
    const ada = rows.find((r) => r.enrolmentId === "enr-1")!;
    expect(ada.learnerName).toBe("Ada");
    expect(ada.state).toBe("PRESENT");
    expect(ada.note).toBe("on time");
    expect(ada.isCorrection).toBe(false);
    const bo = rows.find((r) => r.enrolmentId === "enr-2")!;
    expect(bo.state).toBe("NOT_RECORDED");
    expect(bo.note).toBeNull();
  });

  it("canSetLiveStates is false before the session starts, true once it has begun", async () => {
    const before = await harness({ now: BEFORE_START, enrolments: roster() }).service.loadSessionRegister(
      { sessionId: "ses-1" },
    );
    expect(before.every((r) => r.canSetLiveStates === false)).toBe(true);

    const during = await harness({ now: DURING, enrolments: roster() }).service.loadSessionRegister(
      { sessionId: "ses-1" },
    );
    expect(during.every((r) => r.canSetLiveStates === true)).toBe(true);
  });

  it("flags a corrected record and exposes windowClosesAt", async () => {
    const { service } = harness({
      now: JUST_AFTER_CLOSE,
      enrolments: roster(),
      records: [
        rec({
          sessionId: "ses-1",
          enrolmentId: "enr-1",
          state: "PRESENT",
          correctionReason: "fixed after review",
          correctedById: "user-9",
        }),
      ],
    });
    const rows = await service.loadSessionRegister({ sessionId: "ses-1" });
    const row = rows.find((r) => r.enrolmentId === "enr-1")!;
    expect(row.isCorrection).toBe(true);
    expect(row.windowClosesAt).toEqual(WINDOW_CLOSES_AT);
  });
});
