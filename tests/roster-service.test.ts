/**
 * Plan 05-10: the cohort roster read service and the attendance-exceptions view.
 *
 * Driven by in-memory fake delegates plus a harness-built `withPermission`
 * (`createTestWithPermission`) and an injected cohort-scope resolver. No real
 * Postgres: the D-21 scoping denial, the D-18 named-deferred columns, the
 * three ATT-04 exception categories and the filter/CSV parity are all provable
 * against fakes.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import type { ResourceScope } from "@/server/permissions/scope";
import {
  createRosterService,
  type RosterRow,
  type RosterStore,
} from "@/server/services/roster-service";

const NOW = new Date("2026-03-15T12:00:00.000Z");
const PAST_SESSION_START = new Date("2026-03-01T09:00:00.000Z");
const PAST_SESSION_END = new Date("2026-03-01T11:00:00.000Z");
const FUTURE_SESSION_END = new Date("2026-03-20T11:00:00.000Z");

type RawCohort = {
  attendanceThresholdPct: number | null;
  instructors: Array<{ user: { name: string } }>;
};
type RawEnrolment = {
  id: string;
  status: string;
  accessStartsAt: Date | null;
  accessEndsAt: Date | null;
  user: { id: string; name: string; email: string };
};
type RawSession = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendanceExpected: boolean;
  cancelledAt: Date | null;
};
type RawRecord = {
  enrolmentId: string;
  sessionId: string;
  state: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "NOT_RECORDED";
  correctionReason: string | null;
  correctedAt: Date | null;
  correctedBy: { name: string } | null;
};
type RawAudit = {
  targetId: string | null;
  action: string;
  reason: string | null;
  createdAt: Date;
  actorId: string | null;
  actor: { name: string } | null;
};

function session(over: Partial<RawSession> = {}): RawSession {
  return {
    id: "session-past",
    title: "Week 1",
    startsAt: PAST_SESSION_START,
    endsAt: PAST_SESSION_END,
    attendanceExpected: true,
    cancelledAt: null,
    ...over,
  };
}

function enrolment(over: Partial<RawEnrolment> = {}): RawEnrolment {
  return {
    id: "enr-1",
    status: "ACTIVE",
    accessStartsAt: PAST_SESSION_START,
    accessEndsAt: FUTURE_SESSION_END,
    user: { id: "user-a", name: "Ada Learner", email: "ada@example.test" },
    ...over,
  };
}

function record(over: Partial<RawRecord> = {}): RawRecord {
  return {
    enrolmentId: "enr-1",
    sessionId: "session-past",
    state: "PRESENT",
    correctionReason: null,
    correctedAt: null,
    correctedBy: null,
    ...over,
  };
}

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  scope?: ResourceScope;
  cohort?: RawCohort | null;
  enrolments?: RawEnrolment[];
  sessions?: RawSession[];
  records?: RawRecord[];
  audits?: RawAudit[];
}) {
  const cohort: RawCohort | null =
    opts && "cohort" in opts
      ? opts.cohort ?? null
      : { attendanceThresholdPct: null, instructors: [{ user: { name: "Iris Instructor" } }] };

  const store = {
    cohort: { findUnique: vi.fn(async () => cohort) },
    enrolment: { findMany: vi.fn(async () => opts?.enrolments ?? [enrolment()]) },
    scheduledSession: { findMany: vi.fn(async () => opts?.sessions ?? [session()]) },
    attendanceRecord: { findMany: vi.fn(async () => opts?.records ?? []) },
    auditEvent: { findMany: vi.fn(async () => opts?.audits ?? []) },
  } as unknown as RosterStore;

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("cohorts.view"), grant("attendance.view")],
  );

  const service = createRosterService({
    store,
    resolveCohortScope: async () =>
      opts?.scope ?? { cohortId: "cohort-1", courseIds: ["course-1"] },
    withPermission,
    now: () => NOW,
  });

  return { service, store };
}

describe("loadCohortRoster — scoping (D-21, T-05-61/62)", () => {
  it("requires cohorts.view — a caller with no grant is denied", async () => {
    const { service } = harness({ grants: [] });
    await expect(service.loadCohortRoster({ cohortId: "cohort-1" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("denies an out-of-scope cohort with AuthorizationError, never an empty roster", async () => {
    const { service, store } = harness({
      grants: [grant("cohorts.view", "COHORT", "cohort-A")],
      scope: { cohortId: "cohort-B", courseIds: [] },
    });
    await expect(service.loadCohortRoster({ cohortId: "cohort-B" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(store.enrolment.findMany).not.toHaveBeenCalled();
  });

  it("lets a COURSE-scoped grant on a programme cohort's member course load the roster", async () => {
    const { service } = harness({
      grants: [grant("cohorts.view", "COURSE", "course-member")],
      scope: { cohortId: "cohort-1", programmeId: "prog-1", courseIds: ["course-member"] },
    });
    await expect(service.loadCohortRoster({ cohortId: "cohort-1" })).resolves.toHaveLength(1);
  });
});

describe("loadCohortRoster — row contents (D-17, D-18)", () => {
  it("returns one row per enrolment, ordered by learner name, with identity fields", async () => {
    const { service } = harness({
      enrolments: [
        enrolment({ id: "enr-z", user: { id: "u-z", name: "Zed Zulu", email: "zed@x.test" } }),
        enrolment({ id: "enr-a", user: { id: "u-a", name: "Ada Learner", email: "ada@x.test" } }),
      ],
      sessions: [],
    });
    const rows = await service.loadCohortRoster({ cohortId: "cohort-1" });
    expect(rows.map((r) => r.learnerName)).toEqual(["Ada Learner", "Zed Zulu"]);
    expect(rows[0]).toMatchObject({
      learnerId: "u-a",
      learnerEmail: "ada@x.test",
      enrolmentId: "enr-a",
      status: "ACTIVE",
    });
  });

  it("carries the access window and the cohort's instructor names", async () => {
    const { service } = harness({
      cohort: {
        attendanceThresholdPct: null,
        instructors: [{ user: { name: "Iris Instructor" } }, { user: { name: "Ove Owner" } }],
      },
      sessions: [],
    });
    const [row] = await service.loadCohortRoster({ cohortId: "cohort-1" });
    expect(row.accessStartsAt).toEqual(PAST_SESSION_START);
    expect(row.accessEndsAt).toEqual(FUTURE_SESSION_END);
    expect(row.instructors).toEqual(["Iris Instructor", "Ove Owner"]);
  });

  it("carries a transition count and the most recent transition drawn from AuditEvent", async () => {
    const { service } = harness({
      sessions: [],
      audits: [
        {
          targetId: "enr-1",
          action: "enrolment.activated",
          reason: "Comp seat",
          createdAt: new Date("2026-02-01T00:00:00.000Z"),
          actorId: "staff-1",
          actor: { name: "Sam Staff" },
        },
        {
          targetId: "enr-1",
          action: "enrolment.created",
          reason: null,
          createdAt: new Date("2026-01-15T00:00:00.000Z"),
          actorId: "staff-1",
          actor: { name: "Sam Staff" },
        },
      ],
    });
    const [row] = await service.loadCohortRoster({ cohortId: "cohort-1" });
    expect(row.transitionCount).toBe(2);
    expect(row.latestTransition).toMatchObject({
      action: "enrolment.activated",
      reason: "Comp seat",
      actorName: "Sam Staff",
    });
  });

  it("yields attendance { kind: 'no-rule' } when the cohort has no threshold", async () => {
    const { service } = harness({ sessions: [] });
    const [row] = await service.loadCohortRoster({ cohortId: "cohort-1" });
    expect(row.attendance).toEqual({ kind: "no-rule" });
  });

  it("computes the attendance component from the learner's records and the threshold", async () => {
    const { service } = harness({
      cohort: { attendanceThresholdPct: 75, instructors: [] },
      sessions: [
        session({ id: "s1" }),
        session({ id: "s2" }),
        session({ id: "s3" }),
        session({ id: "s4" }),
      ],
      records: [
        record({ sessionId: "s1", state: "PRESENT" }),
        record({ sessionId: "s2", state: "PRESENT" }),
        record({ sessionId: "s3", state: "PRESENT" }),
        record({ sessionId: "s4", state: "ABSENT" }),
      ],
    });
    const [row] = await service.loadCohortRoster({ cohortId: "cohort-1" });
    expect(row.attendance).toMatchObject({
      kind: "computed",
      earnedPct: 75,
      requiredPct: 75,
      meetsThreshold: true,
    });
  });

  it("renders progress/assessment/completion as the named deferred state, never a zero or blank", async () => {
    const { service } = harness({ sessions: [] });
    const [row] = await service.loadCohortRoster({ cohortId: "cohort-1" });
    expect(row.progress).toEqual({ kind: "deferred", phase: 9 });
    expect(row.assessment).toEqual({ kind: "deferred", phase: 10 });
    expect(row.completion).toEqual({ kind: "deferred", phase: 11 });
  });
});

// Type-level guard (D-18, Pitfall 7): the deferred columns are typed as
// `DeferredColumn` ONLY, so a numeric progress is a compile error. A `?? 0`
// cannot silently creep in later — Phase 9 must deliberately widen the union.
// @ts-expect-error a number is not assignable to RosterRow["progress"]
const _rejectsNumericProgress: RosterRow["progress"] = 42;
void _rejectsNumericProgress;
