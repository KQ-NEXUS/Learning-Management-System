/**
 * The attendance service (ATT-01, ATT-02, ATT-03).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE SERVER-SIDE RULES, AND NO COMPLETION VERDICT.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ATT-01..ATT-03 all turn on three rules that are cheap to state and easy to
 * skip:
 *
 *   1. The learner set is derived from the database, never from the request.
 *      A bulk save resolves the roster as `Enrolment where cohortId =
 *      session.cohortId`; every submitted enrolment id is validated against
 *      that set and an id outside it is refused — atomically, so not even the
 *      valid entries in the same batch are written (D-10, T-05-47).
 *
 *   2. The state must be legal for the session's timing. Before a session
 *      starts only `EXCUSED` / `NOT_RECORDED` may be set; `PRESENT` / `ABSENT`
 *      / `LATE` need the start to have passed (D-09, T-05-50).
 *
 *   3. A change after the 168-hour marking window has closed is a correction:
 *      it requires a non-empty reason and stamps `correctedById` /
 *      `correctedAt` / `correctionReason` without disturbing the original
 *      `recordedById` / `recordedAt` (D-06, D-08, T-05-49). All window
 *      arithmetic is UTC on the stored instants — the wall-clock zone is a
 *      display concern only and there is deliberately no locale-formatting
 *      import on this path (T-05-51).
 *
 * This module computes and exposes the ATTENDANCE COMPONENT only (earned vs
 * required percent, via `computeAttendanceComponent`) and emits exactly one
 * `attendance.changed` domain event per changed record carrying that
 * recomputed component. It does NOT compute, store, or expose an overall
 * completion verdict, nor recalculate one on a correction — D-20 reserves that
 * for the Phase 9 / Phase 11 completion engine, which subscribes to the event.
 * A later reader must not wire a completion rule in here.
 *
 * Every mutation records an `AuditEvent` with `targetType: "Enrolment"` and
 * `targetId` = the enrolment id, carrying the before state, the after state and
 * the correction reason (null inside the window) — the cohort roster
 * (plan 05-10) reads exactly that key for its transition/attendance history.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import {
  isBeforeSessionStart,
  isWithinMarkingWindow,
  markingWindowClosesAt,
} from "@/lib/attendance-window";
import {
  computeAttendanceComponent,
  type AttendanceComponent,
  type AttendanceStateValue,
} from "@/server/services/attendance-component";
import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";
import { createCohortScopeResolvers } from "@/server/services/cohort-scope";

type WithPermission = ReturnType<typeof createWithPermission>;
type Audit = (entry: ResourceAuditEntry) => Promise<void>;

// ---------------------------------------------------------------------------
// The state vocabulary — matches `prisma/schema.prisma` `enum AttendanceState`.
// ---------------------------------------------------------------------------

/** The states that need the session to have started (D-09). */
const LIVE_STATES: ReadonlySet<AttendanceStateValue> = new Set<AttendanceStateValue>([
  "PRESENT",
  "ABSENT",
  "LATE",
]);

/** Enrolment statuses that never appear on a marking register. */
const OFF_ROSTER_STATUSES = ["TRANSFERRED", "CANCELLED"] as const;

// ---------------------------------------------------------------------------
// Typed refusals — each one a Server Action turns into a specific message.
// ---------------------------------------------------------------------------

/**
 * A `PRESENT` / `ABSENT` / `LATE` mark attempted before the session's start
 * time (D-09). Only `EXCUSED` / `NOT_RECORDED` are legal pre-start.
 */
export class PreMarkingStateError extends Error {
  readonly sessionId: string;
  readonly enrolmentId: string;
  readonly state: AttendanceStateValue;

  constructor(sessionId: string, enrolmentId: string, state: AttendanceStateValue) {
    super(
      "You can only mark excused or not-recorded before the session starts. " +
        "Present, absent and late need the session to have begun.",
    );
    this.name = "PreMarkingStateError";
    this.sessionId = sessionId;
    this.enrolmentId = enrolmentId;
    this.state = state;
  }
}

/**
 * A change made after the 168-hour marking window closed, with no correction
 * reason (D-08). The DB CHECK `attendance_correction_has_reason` is the
 * backstop; this is the primary guard.
 */
export class CorrectionReasonRequiredError extends Error {
  readonly sessionId: string;
  readonly enrolmentId: string;
  readonly windowClosedAt: Date;

  constructor(sessionId: string, enrolmentId: string, windowClosedAt: Date) {
    super(
      `The marking window for this session closed on ${windowClosedAt.toISOString()}. ` +
        "Changes now need a reason and are recorded as corrections in the audit history.",
    );
    this.name = "CorrectionReasonRequiredError";
    this.sessionId = sessionId;
    this.enrolmentId = enrolmentId;
    this.windowClosedAt = windowClosedAt;
  }
}

/**
 * A caller-supplied `enrolmentId` that is not an enrolment of the session's
 * own cohort (D-10). The learner set is the database's, never the request's;
 * this is thrown before any write so the refusal is atomic (T-05-47).
 */
export class LearnerNotOnRosterError extends Error {
  readonly sessionId: string;
  readonly enrolmentId: string;

  constructor(sessionId: string, enrolmentId: string, detail = "is not on this session's roster") {
    super(`Enrolment ${enrolmentId} ${detail}.`);
    this.name = "LearnerNotOnRosterError";
    this.sessionId = sessionId;
    this.enrolmentId = enrolmentId;
  }
}

/** No `ScheduledSession` row for the given id. */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session ${sessionId} does not exist.`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

// ---------------------------------------------------------------------------
// Injected surface — a Prisma client satisfies it and so does a unit-test fake.
// ---------------------------------------------------------------------------

type SessionRow = {
  id: string;
  cohortId: string;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
};

type RosterEnrolmentRow = { id: string; status: string };

type RegisterEnrolmentRow = {
  id: string;
  status: string;
  user: { id: string; name: string | null; email: string };
};

type AttendanceRecordRow = {
  sessionId: string;
  enrolmentId: string;
  state: AttendanceStateValue;
  note: string | null;
  recordedById: string | null;
  recordedAt: Date | null;
  correctedById: string | null;
  correctedAt: Date | null;
  correctionReason: string | null;
};

/**
 * The transaction client the writes need — structural, so a Prisma
 * transaction client and a unit-test fake both satisfy it and this file needs
 * no `@prisma/client` import.
 */
export type AttendanceTxClient = DomainEventTxClient & {
  attendanceRecord: {
    findUnique(args: {
      where: { sessionId_enrolmentId: { sessionId: string; enrolmentId: string } };
    }): Promise<AttendanceRecordRow | null>;
    findMany(args: {
      where: { sessionId?: string; enrolmentId?: string };
    }): Promise<Array<{ sessionId: string; state: AttendanceStateValue }>>;
    upsert(args: {
      where: { sessionId_enrolmentId: { sessionId: string; enrolmentId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<AttendanceRecordRow>;
  };
  scheduledSession: {
    findMany(args: {
      where: { cohortId: string };
    }): Promise<Array<{ id: string; attendanceExpected: boolean; cancelledAt: Date | null }>>;
  };
  cohort: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ attendanceThresholdPct: number | null } | null>;
  };
};

export type AttendanceServiceDeps = {
  attendance: {
    findUnique(args: {
      where: { sessionId_enrolmentId: { sessionId: string; enrolmentId: string } };
    }): Promise<AttendanceRecordRow | null>;
    findMany(args: {
      where: { sessionId?: string; enrolmentId?: string };
    }): Promise<AttendanceRecordRow[]>;
  };
  session: {
    findUnique(args: { where: { id: string } }): Promise<SessionRow | null>;
    findMany(args: {
      where: { cohortId: string };
    }): Promise<Array<{ id: string; attendanceExpected: boolean; cancelledAt: Date | null }>>;
  };
  enrolment: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ id: string; cohortId: string; status: string } | null>;
    findMany(args: {
      where: { cohortId: string; status?: { notIn?: readonly string[] } };
    }): Promise<Array<RosterEnrolmentRow | RegisterEnrolmentRow>>;
  };
  cohort: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ attendanceThresholdPct: number | null } | null>;
  };
  audit: Audit;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx: AttendanceTxClient) => Promise<R>) => Promise<R>;
  /** Session id -> scope. Resolves the OWNING cohort from the row (D-21). */
  sessionScope: (sessionId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A non-empty, trimmed reason, or `null` when blank. */
function trimReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}

type Timing = {
  beforeStart: boolean;
  /** The window has CLOSED (now is past `endsAt + 168h`) — a change is a correction. */
  afterClose: boolean;
  closesAt: Date;
};

function timingFor(session: SessionRow, now: Date): Timing {
  const beforeStart = isBeforeSessionStart(session, now);
  const inWindow = isWithinMarkingWindow(session, now);
  // A correction reason is required only once the window has CLOSED — never
  // before it opens. `!beforeStart && !inWindow` is exactly `now > closesAt`.
  return {
    beforeStart,
    afterClose: !beforeStart && !inWindow,
    closesAt: markingWindowClosesAt(session),
  };
}

/**
 * Throws `PreMarkingStateError` / `CorrectionReasonRequiredError` if the
 * requested state is not legal for the session's timing. Pure — no write.
 */
function assertMarkAllowed(
  session: SessionRow,
  enrolmentId: string,
  state: AttendanceStateValue,
  reason: string | null,
  timing: Timing,
): void {
  if (timing.beforeStart && LIVE_STATES.has(state)) {
    throw new PreMarkingStateError(session.id, enrolmentId, state);
  }
  if (timing.afterClose && !reason) {
    throw new CorrectionReasonRequiredError(session.id, enrolmentId, timing.closesAt);
  }
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createAttendanceService(deps: AttendanceServiceDeps) {
  const { withPermission } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * Recomputes the learner's attendance component over every session of the
   * cohort and every attendance record for the enrolment — read through `tx`
   * so it reflects the write that just happened in the same transaction.
   */
  async function recomputeComponent(
    tx: AttendanceTxClient,
    cohortId: string,
    enrolmentId: string,
  ): Promise<AttendanceComponent> {
    const [cohortRow, sessions, records] = await Promise.all([
      tx.cohort.findUnique({ where: { id: cohortId } }),
      tx.scheduledSession.findMany({ where: { cohortId } }),
      tx.attendanceRecord.findMany({ where: { enrolmentId } }),
    ]);
    const stateBySession = new Map<string, AttendanceStateValue>(
      records.map((r) => [r.sessionId, r.state]),
    );
    return computeAttendanceComponent({
      thresholdPct: cohortRow?.attendanceThresholdPct ?? null,
      entries: sessions.map((s) => ({
        state: stateBySession.get(s.id) ?? "NOT_RECORDED",
        attendanceExpected: s.attendanceExpected,
        cancelledAt: s.cancelledAt,
      })),
    });
  }

  /**
   * Upserts one `AttendanceRecord` on `[sessionId, enrolmentId]`, recomputes
   * the component and emits one `attendance.changed` event — all inside the
   * caller's transaction. Returns the before/after states for the post-commit
   * audit.
   */
  async function writeOneRecord(
    tx: AttendanceTxClient,
    args: {
      session: SessionRow;
      enrolmentId: string;
      state: AttendanceStateValue;
      note: string | null;
      reason: string | null;
      afterClose: boolean;
      actorId: string;
    },
  ): Promise<{ before: AttendanceStateValue; after: AttendanceStateValue }> {
    const { session, enrolmentId, state, note, reason, afterClose, actorId } = args;

    const existing = await tx.attendanceRecord.findUnique({
      where: { sessionId_enrolmentId: { sessionId: session.id, enrolmentId } },
    });
    const before: AttendanceStateValue = existing?.state ?? "NOT_RECORDED";

    // Inside the window: stamp `recordedBy`. After it closes: stamp the
    // correction fields and NEVER blank the original `recordedBy` stamps.
    const stamps = afterClose
      ? { correctedById: actorId, correctedAt: now(), correctionReason: reason }
      : { recordedById: actorId, recordedAt: now() };

    await tx.attendanceRecord.upsert({
      where: { sessionId_enrolmentId: { sessionId: session.id, enrolmentId } },
      create: { sessionId: session.id, enrolmentId, state, note, ...stamps },
      update: { state, note, ...stamps },
    });

    const component = await recomputeComponent(tx, session.cohortId, enrolmentId);

    await deps.writeEvent(tx, {
      type: "attendance.changed",
      payload: {
        sessionId: session.id,
        enrolmentId,
        cohortId: session.cohortId,
        before,
        after: state,
        correction: afterClose,
        component,
        actorId,
      },
    });

    return { before, after: state };
  }

  async function auditChange(args: {
    enrolmentId: string;
    actorId: string;
    before: AttendanceStateValue;
    after: AttendanceStateValue;
    reason: string | null;
  }): Promise<void> {
    await deps.audit({
      action: "attendance.changed",
      targetType: "Enrolment",
      targetId: args.enrolmentId,
      actorId: args.actorId,
      outcome: "SUCCESS",
      reason: args.reason,
      before: { state: args.before },
      after: { state: args.after },
    });
  }

  // -------------------------------------------------------------------------
  // markAttendance — one learner, one session (D-07, D-08, D-09)
  // -------------------------------------------------------------------------

  const markAttendance = withPermission<{
    sessionId: string;
    enrolmentId: string;
    state: AttendanceStateValue;
    note?: string;
    reason?: string;
  }>("attendance.manage", (input) => deps.sessionScope(input.sessionId))(
    async (input, ctx) => {
      const session = await deps.session.findUnique({ where: { id: input.sessionId } });
      if (!session) throw new SessionNotFoundError(input.sessionId);

      // The enrolment id is caller-supplied — validate it against the
      // DB-resolved cohort, never trust it (D-10).
      const enrolment = await deps.enrolment.findUnique({
        where: { id: input.enrolmentId },
      });
      if (!enrolment || enrolment.cohortId !== session.cohortId) {
        throw new LearnerNotOnRosterError(input.sessionId, input.enrolmentId);
      }

      const reason = trimReason(input.reason);
      const timing = timingFor(session, now());
      assertMarkAllowed(session, input.enrolmentId, input.state, reason, timing);

      const { before, after } = await deps.runInTransaction((tx) =>
        writeOneRecord(tx, {
          session,
          enrolmentId: input.enrolmentId,
          state: input.state,
          note: input.note ?? null,
          reason,
          afterClose: timing.afterClose,
          actorId: ctx.actor.userId,
        }),
      );

      await auditChange({
        enrolmentId: input.enrolmentId,
        actorId: ctx.actor.userId,
        before,
        after,
        reason: timing.afterClose ? reason : null,
      });

      return {
        sessionId: input.sessionId,
        enrolmentId: input.enrolmentId,
        state: input.state,
        before,
        corrected: timing.afterClose,
      };
    },
  );

  // -------------------------------------------------------------------------
  // saveSessionAttendance — the whole roster, one commit (D-10, ATT-01)
  // -------------------------------------------------------------------------

  const saveSessionAttendance = withPermission<{
    sessionId: string;
    entries: Array<{
      enrolmentId: string;
      state: AttendanceStateValue;
      note?: string;
      reason?: string;
    }>;
  }>("attendance.manage", (input) => deps.sessionScope(input.sessionId))(
    async (input, ctx) => {
      const session = await deps.session.findUnique({ where: { id: input.sessionId } });
      if (!session) throw new SessionNotFoundError(input.sessionId);

      // The learner set comes from the DATABASE, filtered by the session's own
      // `cohortId` — never from the caller's list (D-10).
      const roster = await deps.enrolment.findMany({
        where: { cohortId: session.cohortId },
      });
      const rosterIds = new Set(roster.map((e) => e.id));

      // Validate every submitted id against that set and reject duplicates —
      // BEFORE any write, so a single bad id writes nothing at all (T-05-47).
      const seen = new Set<string>();
      for (const entry of input.entries) {
        if (seen.has(entry.enrolmentId)) {
          throw new LearnerNotOnRosterError(
            input.sessionId,
            entry.enrolmentId,
            "appears more than once in the submitted list",
          );
        }
        seen.add(entry.enrolmentId);
        if (!rosterIds.has(entry.enrolmentId)) {
          throw new LearnerNotOnRosterError(input.sessionId, entry.enrolmentId);
        }
      }

      // Per-entry pre-marking / correction-window rules, still before any
      // write so the whole batch refuses atomically.
      const timing = timingFor(session, now());
      const prepared = input.entries.map((entry) => {
        const reason = trimReason(entry.reason);
        assertMarkAllowed(session, entry.enrolmentId, entry.state, reason, timing);
        return { enrolmentId: entry.enrolmentId, state: entry.state, note: entry.note ?? null, reason };
      });

      // Skip entries whose state and note already match the stored row, so a
      // "save all" on an unchanged register produces no events (D-17).
      const existing = await deps.attendance.findMany({
        where: { sessionId: input.sessionId },
      });
      const existingByEnrolment = new Map(existing.map((r) => [r.enrolmentId, r]));
      const changed = prepared.filter((entry) => {
        const row = existingByEnrolment.get(entry.enrolmentId);
        const currentState: AttendanceStateValue = row?.state ?? "NOT_RECORDED";
        const currentNote = row?.note ?? null;
        return currentState !== entry.state || currentNote !== entry.note;
      });

      const results = await deps.runInTransaction(async (tx) => {
        const out: Array<{
          enrolmentId: string;
          before: AttendanceStateValue;
          after: AttendanceStateValue;
          reason: string | null;
        }> = [];
        for (const entry of changed) {
          const { before, after } = await writeOneRecord(tx, {
            session,
            enrolmentId: entry.enrolmentId,
            state: entry.state,
            note: entry.note,
            reason: entry.reason,
            afterClose: timing.afterClose,
            actorId: ctx.actor.userId,
          });
          out.push({ enrolmentId: entry.enrolmentId, before, after, reason: entry.reason });
        }
        return out;
      });

      // One audit row per changed record — ATT-03's before/after history is
      // per learner, not per batch.
      for (const r of results) {
        await auditChange({
          enrolmentId: r.enrolmentId,
          actorId: ctx.actor.userId,
          before: r.before,
          after: r.after,
          reason: timing.afterClose ? r.reason : null,
        });
      }

      return {
        sessionId: input.sessionId,
        total: input.entries.length,
        changed: results.length,
      };
    },
  );

  // -------------------------------------------------------------------------
  // loadSessionRegister — what the marking screen renders (D-21)
  // -------------------------------------------------------------------------

  const loadSessionRegister = withPermission<{ sessionId: string }>(
    "attendance.view",
    (input) => deps.sessionScope(input.sessionId),
  )(async (input) => {
    const session = await deps.session.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new SessionNotFoundError(input.sessionId);

    const [enrolments, records] = await Promise.all([
      deps.enrolment.findMany({
        where: {
          cohortId: session.cohortId,
          status: { notIn: OFF_ROSTER_STATUSES },
        },
      }),
      deps.attendance.findMany({ where: { sessionId: input.sessionId } }),
    ]);
    const recordByEnrolment = new Map(records.map((r) => [r.enrolmentId, r]));

    // A courtesy echo of the server rule the marking screen uses to disable
    // PRESENT/ABSENT/LATE — NOT the rule itself (that is `assertMarkAllowed`).
    const canSetLiveStates = !isBeforeSessionStart(session, now());
    const windowClosesAt = markingWindowClosesAt(session);

    return enrolments
      .map((row) => {
        const enrolment = row as RegisterEnrolmentRow;
        const record = recordByEnrolment.get(enrolment.id);
        return {
          enrolmentId: enrolment.id,
          learnerId: enrolment.user.id,
          learnerName: enrolment.user.name ?? enrolment.user.email,
          learnerEmail: enrolment.user.email,
          status: enrolment.status,
          state: record?.state ?? ("NOT_RECORDED" as AttendanceStateValue),
          note: record?.note ?? null,
          isCorrection: (record?.correctionReason ?? null) !== null,
          windowClosesAt,
          canSetLiveStates,
        };
      })
      .sort((a, b) => a.learnerName.localeCompare(b.learnerName));
  });

  return { markAttendance, saveSessionAttendance, loadSessionRegister };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const RECORD_SELECT = {
  sessionId: true,
  enrolmentId: true,
  state: true,
  note: true,
  recordedById: true,
  recordedAt: true,
  correctedById: true,
  correctedAt: true,
  correctionReason: true,
} as const;

const SESSION_SELECT = {
  id: true,
  cohortId: true,
  startsAt: true,
  endsAt: true,
  cancelledAt: true,
} as const;

const liveAudit: Audit = (entry) =>
  recordAudit({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
    outcome: entry.outcome,
  });

/**
 * Builds the attendance service against a given Prisma client and
 * `withPermission`. Production passes the singleton and the live authorizer;
 * `tests/attendance-service.integration.test.ts` passes a testcontainer client
 * and a harness `withPermission` so the integration test exercises the real
 * transaction, the real component calculator and the real
 * `attendance_correction_has_reason` CHECK. The cohort-scope resolvers are
 * bound to the SAME client so a COHORT-scoped grant is matched against the
 * container's rows, not the production database's.
 */
export function createPrismaBackedAttendanceService(
  client: AnyPrisma,
  withPermission: WithPermission,
  audit: Audit = liveAudit,
) {
  const scopeResolvers = createCohortScopeResolvers({
    cohort: client.cohort,
    session: client.scheduledSession,
    enrolment: client.enrolment,
  });

  return createAttendanceService({
    attendance: {
      findUnique: (args) =>
        client.attendanceRecord.findUnique({ where: args.where, select: RECORD_SELECT }),
      findMany: (args) =>
        client.attendanceRecord.findMany({ where: args.where, select: RECORD_SELECT }),
    },
    session: {
      findUnique: (args) =>
        client.scheduledSession.findUnique({ where: args.where, select: SESSION_SELECT }),
      findMany: (args) =>
        client.scheduledSession.findMany({
          where: args.where,
          select: { id: true, attendanceExpected: true, cancelledAt: true },
        }),
    },
    enrolment: {
      findUnique: (args) =>
        client.enrolment.findUnique({
          where: args.where,
          select: { id: true, cohortId: true, status: true },
        }),
      findMany: (args) =>
        client.enrolment.findMany({
          where: args.where,
          select: {
            id: true,
            status: true,
            user: { select: { id: true, name: true, email: true } },
          },
        }),
    },
    cohort: {
      findUnique: (args) =>
        client.cohort.findUnique({
          where: args.where,
          select: { attendanceThresholdPct: true },
        }),
    },
    audit,
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) => client.$transaction((tx: unknown) => fn(tx as AttendanceTxClient)),
    sessionScope: scopeResolvers.sessionCohortScope,
    withPermission,
  });
}

const built = createPrismaBackedAttendanceService(prisma, liveWithPermission);

export const markAttendance = built.markAttendance;
export const saveSessionAttendance = built.saveSessionAttendance;
export const loadSessionRegister = built.loadSessionRegister;

export { OFF_ROSTER_STATUSES };
