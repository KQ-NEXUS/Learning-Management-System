/**
 * The cohort roster read service (COH-07 / D-17 / D-18 / D-21) and — added in
 * plan 05-10 Task 2 — the attendance-exceptions view with its bounded,
 * filter-parity CSV (ATT-04 / D-19).
 *
 * This is an authorized-read helper in the mould of
 * `programme-service.ts` `listProgrammesForIndex` / `loadProgrammeComposition`:
 * a `withPermission("<perm>.view", <db-resolved scope>)` wrapper around a
 * small number of narrow selects plus `_count`-style aggregates the CRUD
 * factory cannot express. It performs NO mutation and adds NO write path.
 *
 * Scoping is `withPermission` + `cohortResourceScope` ONLY (D-21, RBAC-06).
 * There is deliberately no hand-written scope check and no "filter an
 * out-of-scope cohort to an empty list" path — a denial is an
 * `AuthorizationError`, with identical messaging whether or not the cohort
 * exists (T-05-61 / T-05-62).
 *
 * Transition history (D-17) is read from the append-only `AuditEvent` trail —
 * there is deliberately no `EnrolmentTransition` table. The audit row already
 * carries actor / before / after / reason / outcome / time; a second copy
 * could disagree with it and then be trusted instead of it (T-05-67).
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import {
  computeAttendanceComponent,
  type AttendanceComponent,
  type AttendanceComponentEntry,
  type AttendanceStateValue,
} from "./attendance-component";
import { cohortResourceScope } from "./cohort-scope";

type WithPermission = ReturnType<typeof createWithPermission>;

// ---------------------------------------------------------------------------
// Deferred columns (D-18, RESEARCH 05 Pitfall 7)
// ---------------------------------------------------------------------------

/**
 * A roster column whose computing engine does not exist yet: Progress lands in
 * Phase 9, Assessment in Phase 10, Completion / certificate in Phase 11.
 *
 * Typed as EXACTLY this shape — not `number | DeferredColumn`, not
 * `number | null`. Making the named gap the only inhabitable type is what
 * stops a numeric fallback (a zero, which reads as "failing") or a blank
 * (which reads as a bug) creeping in later. When Phase 9 / 10 / 11 land, each
 * will DELIBERATELY widen its column's type (e.g. `DeferredColumn | { kind:
 * "tracked"; pct: number }`); until then the roster is structurally incapable
 * of rendering a fake zero for these columns.
 */
export type DeferredColumn = { kind: "deferred"; phase: 9 | 10 | 11 };

const PROGRESS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 9 };
const ASSESSMENT_DEFERRED: DeferredColumn = { kind: "deferred", phase: 10 };
const COMPLETION_DEFERRED: DeferredColumn = { kind: "deferred", phase: 11 };

// ---------------------------------------------------------------------------
// Row types (consumed verbatim by the plan 05-14 roster table)
// ---------------------------------------------------------------------------

/** The most recent enrolment-status transition, summarised from `AuditEvent`. */
export type RosterTransition = {
  action: string;
  reason: string | null;
  actorId: string | null;
  actorName: string | null;
  at: Date;
};

export type RosterRow = {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  enrolmentId: string;
  status: string;
  /** How many `AuditEvent` rows target this enrolment. */
  transitionCount: number;
  /** The latest of those rows, or `null` when the enrolment has no audit history. */
  latestTransition: RosterTransition | null;
  accessStartsAt: Date | null;
  accessEndsAt: Date | null;
  /** The cohort's assigned instructor names (D-17). */
  instructors: string[];
  /** The discriminated attendance component — `{ kind: "no-rule" }` when the
   *  cohort has no `attendanceThresholdPct` (D-20), never a fake `0%`. */
  attendance: AttendanceComponent;
  progress: DeferredColumn;
  assessment: DeferredColumn;
  completion: DeferredColumn;
};

// ---------------------------------------------------------------------------
// The narrow store slice (injected — unit-testable without a real Postgres)
// ---------------------------------------------------------------------------

type CohortRosterRow = {
  attendanceThresholdPct: number | null;
  instructors: Array<{ user: { name: string } }>;
};

type EnrolmentRosterRow = {
  id: string;
  status: string;
  accessStartsAt: Date | null;
  accessEndsAt: Date | null;
  user: { id: string; name: string; email: string };
};

type SessionRosterRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendanceExpected: boolean;
  cancelledAt: Date | null;
};

type AttendanceRosterRow = {
  enrolmentId: string;
  sessionId: string;
  state: AttendanceStateValue;
  correctionReason: string | null;
  correctedAt: Date | null;
  correctedBy: { name: string } | null;
};

type EnrolmentAuditRow = {
  targetId: string | null;
  action: string;
  reason: string | null;
  createdAt: Date;
  actorId: string | null;
  actor: { name: string } | null;
};

export type RosterStore = {
  cohort: {
    findUnique(args: Record<string, unknown>): Promise<CohortRosterRow | null>;
  };
  enrolment: {
    findMany(args: Record<string, unknown>): Promise<EnrolmentRosterRow[]>;
  };
  scheduledSession: {
    findMany(args: Record<string, unknown>): Promise<SessionRosterRow[]>;
  };
  attendanceRecord: {
    findMany(args: Record<string, unknown>): Promise<AttendanceRosterRow[]>;
  };
  auditEvent: {
    findMany(args: Record<string, unknown>): Promise<EnrolmentAuditRow[]>;
  };
};

const COHORT_SELECT = {
  attendanceThresholdPct: true,
  instructors: { select: { user: { select: { name: true } } } },
} as const;

const ENROLMENT_SELECT = {
  id: true,
  status: true,
  accessStartsAt: true,
  accessEndsAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

const SESSION_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  attendanceExpected: true,
  cancelledAt: true,
} as const;

const RECORD_SELECT = {
  enrolmentId: true,
  sessionId: true,
  state: true,
  correctionReason: true,
  correctedAt: true,
  correctedBy: { select: { name: true } },
} as const;

const AUDIT_SELECT = {
  targetId: true,
  action: true,
  reason: true,
  createdAt: true,
  actorId: true,
  actor: { select: { name: true } },
} as const;

// ---------------------------------------------------------------------------
// Shared read: the cohort's roster inputs in a bounded number of queries
// ---------------------------------------------------------------------------

type RosterInputs = {
  cohort: CohortRosterRow | null;
  enrolments: EnrolmentRosterRow[];
  sessions: SessionRosterRow[];
  records: AttendanceRosterRow[];
};

async function loadRosterInputs(
  store: RosterStore,
  cohortId: string,
  opts: { status?: string } = {},
): Promise<RosterInputs> {
  const cohort = await store.cohort.findUnique({
    where: { id: cohortId },
    select: COHORT_SELECT,
  });

  const enrolments = await store.enrolment.findMany({
    where: { cohortId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { user: { name: "asc" } },
    select: ENROLMENT_SELECT,
  });

  const sessions = await store.scheduledSession.findMany({
    where: { cohortId },
    orderBy: { startsAt: "asc" },
    select: SESSION_SELECT,
  });

  const enrolmentIds = enrolments.map((e) => e.id);
  const records = enrolmentIds.length
    ? await store.attendanceRecord.findMany({
        where: { enrolmentId: { in: enrolmentIds } },
        select: RECORD_SELECT,
      })
    : [];

  return { cohort, enrolments, sessions, records };
}

/** One `AttendanceComponentEntry` per session for `enrolmentId` — the real
 *  `cancelledAt` / `attendanceExpected` flow straight through so the pure
 *  component calculator does the excluding. */
function entriesFor(
  enrolmentId: string,
  sessions: SessionRosterRow[],
  records: AttendanceRosterRow[],
): AttendanceComponentEntry[] {
  const stateBySession = new Map<string, AttendanceStateValue>();
  for (const rec of records) {
    if (rec.enrolmentId === enrolmentId) stateBySession.set(rec.sessionId, rec.state);
  }
  return sessions.map((s) => ({
    state: stateBySession.get(s.id) ?? "NOT_RECORDED",
    attendanceExpected: s.attendanceExpected,
    cancelledAt: s.cancelledAt,
  }));
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type RosterServiceDeps = {
  store: RosterStore;
  resolveCohortScope: (cohortId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  now?: () => Date;
};

export function createRosterService(deps: RosterServiceDeps) {
  const { withPermission, store } = deps;

  /**
   * COH-07 / D-17. Gated on `cohorts.view` with a DB-resolved cohort scope, so
   * an Instructor only sees the rosters of cohorts they are assigned to and an
   * out-of-scope cohort is DENIED (not filtered to `[]`). One row per
   * enrolment, ordered by learner name, each carrying identity, status +
   * audit-derived transition history, access window, instructor assignment,
   * the attendance component, and the three named-deferred columns.
   */
  const loadCohortRoster = withPermission<{ cohortId: string }>(
    "cohorts.view",
    (input) => deps.resolveCohortScope(input.cohortId),
  )(async (input): Promise<RosterRow[]> => {
    const inputs = await loadRosterInputs(store, input.cohortId);
    const threshold = inputs.cohort?.attendanceThresholdPct ?? null;
    const instructors = (inputs.cohort?.instructors ?? []).map((ci) => ci.user.name);

    const enrolmentIds = inputs.enrolments.map((e) => e.id);
    const auditRows = enrolmentIds.length
      ? await store.auditEvent.findMany({
          where: { targetType: "Enrolment", targetId: { in: enrolmentIds } },
          orderBy: { createdAt: "desc" },
          select: AUDIT_SELECT,
        })
      : [];

    const auditByEnrolment = new Map<string, EnrolmentAuditRow[]>();
    for (const row of auditRows) {
      if (row.targetId === null) continue;
      const list = auditByEnrolment.get(row.targetId) ?? [];
      list.push(row);
      auditByEnrolment.set(row.targetId, list);
    }

    const rows: RosterRow[] = inputs.enrolments.map((enrolment) => {
      const history = auditByEnrolment.get(enrolment.id) ?? [];
      const latest = history[0] ?? null; // ordered createdAt desc

      return {
        learnerId: enrolment.user.id,
        learnerName: enrolment.user.name,
        learnerEmail: enrolment.user.email,
        enrolmentId: enrolment.id,
        status: enrolment.status,
        transitionCount: history.length,
        latestTransition: latest
          ? {
              action: latest.action,
              reason: latest.reason,
              actorId: latest.actorId,
              actorName: latest.actor?.name ?? null,
              at: latest.createdAt,
            }
          : null,
        accessStartsAt: enrolment.accessStartsAt,
        accessEndsAt: enrolment.accessEndsAt,
        instructors,
        attendance: computeAttendanceComponent({
          thresholdPct: threshold,
          entries: entriesFor(enrolment.id, inputs.sessions, inputs.records),
        }),
        progress: PROGRESS_DEFERRED,
        assessment: ASSESSMENT_DEFERRED,
        completion: COMPLETION_DEFERRED,
      };
    });

    return rows.sort((a, b) => a.learnerName.localeCompare(b.learnerName));
  });

  return { loadCohortRoster };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

const built = createRosterService({
  store: prisma as unknown as RosterStore,
  resolveCohortScope: cohortResourceScope,
  withPermission: liveWithPermission,
});

export const loadCohortRoster = built.loadCohortRoster;
