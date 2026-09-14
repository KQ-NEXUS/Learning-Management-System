/**
 * The learner dashboard aggregate read (LRN-01, DD-5, DD-18, DD-19).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-18 — FOUR TYPED NAMED GAPS, NOT FOUR HARDCODED COPY STRINGS.
 * ─────────────────────────────────────────────────────────────────────────────
 * LRN-01 names seven things a learner must see on `/dashboard`. Three of
 * them (assessment obligations, results, support tickets) and one more
 * (certificate state) belong to later phases. Each card carries a typed
 * named-gap column for each of those four — `assessmentObligations` and
 * `results` pinned to phase 10, `tickets` pinned to phase 12, `certificate`
 * pinned to phase 11 — mirroring `roster-service.ts`'s own named-gap-column
 * precedent exactly. That column type is imported `import type` only: a
 * runtime import from `roster-service.ts` would drag `withPermission`,
 * `cohortResourceScope` and `prisma` onto THIS module's runtime closure for
 * no reason (this module never calls anything else in that file), which
 * `tests/boundary.test.ts` walks. A type-only import never enters that
 * closure (the walk skips `isTypeOnly` clauses).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-19 — THE "UPCOMING SESSIONS" CARD NEVER READS THE PRIVATE JOIN-LINK
 * COLUMN, AT ALL, EVER.
 * ─────────────────────────────────────────────────────────────────────────────
 * This service performs its OWN narrow `ScheduledSession` read for the
 * "Upcoming sessions" card and deliberately never selects the session's
 * private join-link column — the card shows title, start time and delivery
 * mode only. The visibility gate for that link lives entirely in 09-10's
 * sessions service. Not selecting the column at all (never naming it in a
 * `select`, never destructuring it) is a stronger guarantee than computing
 * visibility and hiding the value here: a value that was never read cannot
 * leak through a future refactor of this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNERSHIP (T-09-01) AND FIGURE CONSISTENCY (T-09-30).
 * ─────────────────────────────────────────────────────────────────────────────
 * `loadLearnerDashboard` takes only `actor` — there is no enrolment-id or
 * user-id parameter to tamper with. Every enrolment comes from
 * `learner-access.ts`'s `listOwnActiveEnrolments`, which filters on
 * `actor.userId` (DD-10's ownership-comparison model, not a permission
 * check — see that module's own header for why). Progress is computed by
 * calling the SAME `evaluateCompletion` + `parseCompletionRule` pair
 * `completion-service.ts` uses, over the SAME pinned-obligation evidence
 * (`learner-access.ts`'s decorated `LearnerPath`), so the dashboard's
 * figures and the recorded `CompletionRecord.evidence` can never disagree —
 * a second calculator is never written.
 *
 * Follows the injected-deps / live-singleton convention `learner-access.ts`
 * and `roster-service.ts` already use: `createEnrolmentDashboardService`
 * takes a narrow structural store slice plus the handful of `learner-access`
 * functions it composes (both unit-testable without Postgres), and a live
 * singleton is built at the bottom of the file from `prisma` and the real
 * `learner-access.ts` exports.
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import {
  listOwnActiveEnrolments,
  loadLearnerCourseStructure,
  loadLearnerPath,
  loadPinnedCompletionRuleSource,
  assertLessonOpenable,
  isCourseObligationPayload,
  isProgrammeObligationPayload,
  type OwnEnrolmentSnapshot,
  type LearnerCourseStructure,
  type LearnerPath,
  type PinnedCompletionRuleSource,
  type LessonOpenResult,
} from "@/server/services/learner-access";
import type { AccessWindow } from "@/server/services/access-window";
import {
  computeAttendanceComponent,
  type AttendanceComponent,
  type AttendanceStateValue,
} from "@/server/services/attendance-component";
import { evaluateCompletion, type CompletionVerdict } from "@/server/services/completion-engine";
import { parseCompletionRule } from "@/server/services/completion-rule";
// Type-only — see the DD-18 header note above for why a runtime import here
// would be wrong. This is deliberately the first mention of the imported
// identifier's name anywhere in this file.
import type { DeferredColumn } from "@/server/services/roster-service";

// ---------------------------------------------------------------------------
// Named-gap constants (DD-18) — phase numbers match this plan's ruling.
// ---------------------------------------------------------------------------

const ASSESSMENT_OBLIGATIONS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 10 };
const RESULTS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 10 };
const TICKETS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 12 };
const CERTIFICATE_DEFERRED: DeferredColumn = { kind: "deferred", phase: 11 };

/** A window closing within this many days surfaces the "ending" notice. */
const ACCESS_ENDING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

/** "Upcoming sessions" shows at most this many rows per card. */
const MAX_UPCOMING_SESSIONS = 3;

// ---------------------------------------------------------------------------
// The narrow store slice (injected — unit-testable without a real Postgres)
// ---------------------------------------------------------------------------

/**
 * The exact session fields this card is allowed to see. There is
 * deliberately no join-link field on this row type at all (DD-19) — a fake
 * store built against this type structurally cannot hand this module a
 * value it must never read.
 */
export type DashboardSessionStoreRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  cancelledAt: Date | null;
  attendanceExpected: boolean;
};

export type DashboardAttendanceRecordStoreRow = {
  sessionId: string;
  state: AttendanceStateValue;
};

export type EnrolmentDashboardStore = {
  scheduledSession: {
    findMany(args: { where: { cohortId: string } }): Promise<DashboardSessionStoreRow[]>;
  };
  attendanceRecord: {
    findMany(args: { where: { enrolmentId: string } }): Promise<DashboardAttendanceRecordStoreRow[]>;
  };
};

/**
 * The handful of `learner-access.ts` functions this service composes,
 * bundled so a test can build its own `createLearnerAccessService(fakeStore)`
 * instance and hand its returned functions in here — full unit coverage of
 * `loadLearnerDashboard` with no Postgres and no module mocking.
 */
export type EnrolmentDashboardLearnerAccess = {
  listOwnActiveEnrolments(actor: Actor): Promise<OwnEnrolmentSnapshot[]>;
  loadLearnerCourseStructure(enrolment: OwnEnrolmentSnapshot): Promise<LearnerCourseStructure>;
  loadLearnerPath(actor: Actor, enrolmentId: string): Promise<LearnerPath | null>;
  loadPinnedCompletionRuleSource(
    enrolment: OwnEnrolmentSnapshot,
    courseId: string,
  ): Promise<PinnedCompletionRuleSource | null>;
  assertLessonOpenable(path: LearnerPath, lessonId: string): LessonOpenResult;
};

export type EnrolmentDashboardDeps = {
  store: EnrolmentDashboardStore;
  learnerAccess: EnrolmentDashboardLearnerAccess;
  /** Explicit clock — no caller may read a client-controlled value (T-09-10). */
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Returned shape
// ---------------------------------------------------------------------------

export type AccessNotice =
  | { kind: "none" }
  | { kind: "ending"; endsAt: Date }
  | { kind: "ended" };

/**
 * `structure` names WHICH evidence produced the counts — `"unpinned"` marks
 * an authoring anomaly (D-06/OQ-1) so the page can render a named gap rather
 * than a misleading "0 of 0 complete". It is always present, never an
 * optional field only set on one branch — the same "always declare which
 * state you're in" discipline `access-window.ts`'s four-variant union uses.
 */
export type LearnerDashboardProgress = {
  requiredLessonsComplete: number;
  requiredLessonsTotal: number;
  attendance: AttendanceComponent;
  structure: "structure" | "unpinned";
};

export type UpcomingSessionCard = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  mode: "in-person" | "virtual" | "unknown";
  location: string | null;
  cancelledAt: Date | null;
};

export type LearnerDashboardCard = {
  enrolmentId: string;
  assessmentObligations: DeferredColumn;
  results: DeferredColumn;
  tickets: DeferredColumn;
  certificate: DeferredColumn;
  progress: LearnerDashboardProgress;
  accessNotice: AccessNotice;
  upcomingSessions: UpcomingSessionCard[];
  hasMoreSessions: boolean;
};

export type LearnerDashboard = {
  cards: LearnerDashboardCard[];
};

// ---------------------------------------------------------------------------
// Pure helpers — each independently unit-testable with no store fake.
// ---------------------------------------------------------------------------

/**
 * A non-empty `location` is the only signal this module is permitted to use
 * (DD-19 forbids ever reading the private join-link column here) — its
 * absence is an honest `"unknown"`, never a guessed `"virtual"`. Guessing a
 * mode from data this module cannot see would be exactly the "fake state"
 * this codebase's named-gap discipline (`attendance-component.ts`,
 * `roster-service.ts`) exists to prevent.
 */
export function deriveSessionMode(location: string | null): "in-person" | "virtual" | "unknown" {
  if (location !== null && location.trim().length > 0) return "in-person";
  return "unknown";
}

/**
 * `access-window.ts`'s own header states every `AccessWindow` variant
 * carries `readOnly`/`endsAt` precisely so a caller can branch on them
 * uniformly regardless of `kind` — this reads exactly that way. `endsAt ===
 * null` covers `"unlimited"` and `"not-started"` (never a fake ending
 * notice before access has even begun). `readOnly === true` covers a closed
 * `"windowed"` window. Otherwise "ending" fires only inside the 14-day
 * horizon.
 */
export function deriveAccessNotice(accessWindow: AccessWindow, now: Date): AccessNotice {
  if (accessWindow.endsAt === null) return { kind: "none" };
  if (accessWindow.readOnly) return { kind: "ended" };

  const msRemaining = accessWindow.endsAt.getTime() - now.getTime();
  if (msRemaining <= ACCESS_ENDING_SOON_MS) {
    return { kind: "ending", endsAt: accessWindow.endsAt };
  }
  return { kind: "none" };
}

export type BuiltUpcomingSessions = {
  upcomingSessions: UpcomingSessionCard[];
  hasMoreSessions: boolean;
  /** Every future, non-cancelled session, ascending by `startsAt` — the
   *  ordering `deriveNextAction`'s priority 1 (09-07 Task 2) reads. */
  futureNonCancelled: DashboardSessionStoreRow[];
};

export function buildUpcomingSessions(
  sessions: DashboardSessionStoreRow[],
  now: Date,
): BuiltUpcomingSessions {
  const futureNonCancelled = sessions
    .filter((s) => s.cancelledAt === null && s.startsAt.getTime() > now.getTime())
    .slice()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const upcomingSessions: UpcomingSessionCard[] = futureNonCancelled
    .slice(0, MAX_UPCOMING_SESSIONS)
    .map((s) => ({
      id: s.id,
      title: s.title,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      mode: deriveSessionMode(s.location),
      location: s.location,
      cancelledAt: s.cancelledAt,
    }));

  return {
    upcomingSessions,
    hasMoreSessions: futureNonCancelled.length > MAX_UPCOMING_SESSIONS,
    futureNonCancelled,
  };
}

function computeAttendanceComponentForCard(
  enrolment: OwnEnrolmentSnapshot,
  sessions: DashboardSessionStoreRow[],
  records: DashboardAttendanceRecordStoreRow[],
): AttendanceComponent {
  const stateBySession = new Map(records.map((r) => [r.sessionId, r.state]));
  return computeAttendanceComponent({
    thresholdPct: enrolment.cohort.attendanceThresholdPct,
    entries: sessions.map((s) => ({
      state: stateBySession.get(s.id) ?? "NOT_RECORDED",
      attendanceExpected: s.attendanceExpected,
      cancelledAt: s.cancelledAt,
    })),
  });
}

/**
 * Flattens the decorated `LearnerPath` into the required-lesson evidence
 * `evaluateCompletion` needs — required AND not-since-withdrawn, the exact
 * D-17 exclusion `completion-service.ts`'s `loadCourseObligation` applies —
 * so this card's counts and the persisted `CompletionRecord.evidence` are
 * built from the identical evidence set, never two independent counters.
 */
export function collectRequiredLessonEvidence(path: LearnerPath): {
  requiredLessonIds: string[];
  completedLessonIds: ReadonlySet<string>;
} {
  const requiredLessonIds: string[] = [];
  for (const course of path.courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        if (lesson.required && lesson.withdrawnAt == null) {
          requiredLessonIds.push(lesson.id);
        }
      }
    }
  }
  return { requiredLessonIds, completedLessonIds: path.progress };
}

/**
 * The internal per-enrolment context `buildCard` assembles once and
 * `loadLearnerDashboard` (Task 1) narrows to `.card`. `verdict` and `path`
 * are threaded through, not discarded, because 09-07 Task 2's
 * `deriveNextAction` needs exactly this already-loaded evidence (the ordered
 * path with lock state and the completion verdict) rather than re-reading
 * the store a second time per enrolment.
 */
type EnrolmentCardContext = {
  card: LearnerDashboardCard;
  verdict: CompletionVerdict | null;
  path: LearnerPath | null;
  futureNonCancelled: DashboardSessionStoreRow[];
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createEnrolmentDashboardService(deps: EnrolmentDashboardDeps) {
  const { store, learnerAccess } = deps;
  const now = deps.now ?? (() => new Date());

  function unpinnedProgress(attendance: AttendanceComponent): LearnerDashboardProgress {
    return {
      requiredLessonsComplete: 0,
      requiredLessonsTotal: 0,
      attendance,
      structure: "unpinned",
    };
  }

  async function buildCardContext(
    actor: Actor,
    enrolment: OwnEnrolmentSnapshot,
    nowDate: Date,
  ): Promise<EnrolmentCardContext> {
    const [sessions, records, structure] = await Promise.all([
      store.scheduledSession.findMany({ where: { cohortId: enrolment.cohortId } }),
      store.attendanceRecord.findMany({ where: { enrolmentId: enrolment.id } }),
      learnerAccess.loadLearnerCourseStructure(enrolment),
    ]);

    const attendance = computeAttendanceComponentForCard(enrolment, sessions, records);
    const { upcomingSessions, hasMoreSessions, futureNonCancelled } = buildUpcomingSessions(sessions, nowDate);
    const accessNotice = deriveAccessNotice(enrolment.accessWindow, nowDate);

    const base = {
      enrolmentId: enrolment.id,
      assessmentObligations: ASSESSMENT_OBLIGATIONS_DEFERRED,
      results: RESULTS_DEFERRED,
      tickets: TICKETS_DEFERRED,
      certificate: CERTIFICATE_DEFERRED,
      accessNotice,
      upcomingSessions,
      hasMoreSessions,
    };

    if (structure.kind === "unpinned") {
      return {
        card: { ...base, progress: unpinnedProgress(attendance) },
        verdict: null,
        path: null,
        futureNonCancelled,
      };
    }

    // Defensive fallback only — `getOwnActiveEnrolment` (inside
    // `loadLearnerPath`) cannot legitimately return null here: `enrolment`
    // was just confirmed ACTIVE and owned by `actor` by `listOwnActiveEnrolments`
    // itself. Treated identically to "unpinned" rather than throwing, since a
    // learner's dashboard must never hard-fail on one enrolment.
    const path = await learnerAccess.loadLearnerPath(actor, enrolment.id);
    if (!path) {
      return {
        card: { ...base, progress: unpinnedProgress(attendance) },
        verdict: null,
        path: null,
        futureNonCancelled,
      };
    }

    const { requiredLessonIds, completedLessonIds } = collectRequiredLessonEvidence(path);
    const requiredLessonsComplete = requiredLessonIds.filter((id) => completedLessonIds.has(id)).length;

    // Same evaluator, same evidence shape `completion-service.ts` uses for
    // the persisted `CompletionRecord` — a second, disagreeing calculator is
    // never written here (T-09-30). `structure.courses[0]` is a valid rule
    // source for BOTH a standalone course-cohort (its one course) and a
    // programme-cohort (`courseId` there is only an ownership guard per
    // `learner-access.ts`'s own doc comment, never a per-course pin picker).
    let verdict: CompletionVerdict | null = null;
    const ruleCourseId = structure.courses[0]?.courseId;
    if (ruleCourseId) {
      const ruleSource = await learnerAccess.loadPinnedCompletionRuleSource(enrolment, ruleCourseId);
      // `ruleSource.json` is the WHOLE pinned obligation payload (course or
      // programme) — `.completionRule` is the sub-blob `parseCompletionRule`
      // actually expects, same field `completion-service.ts`'s
      // `loadCourseObligation` reads (`payload.completionRule`). Narrowed via
      // the same two guards `learner-access.ts` itself validated the payload
      // with before ever constructing `ruleSource`.
      const completionRuleJson = isCourseObligationPayload(ruleSource?.json)
        ? ruleSource.json.completionRule
        : isProgrammeObligationPayload(ruleSource?.json)
          ? ruleSource.json.completionRule
          : undefined;
      if (ruleSource && completionRuleJson !== undefined) {
        const rule = parseCompletionRule({
          json: completionRuleJson,
          ruleVersion: ruleSource.ruleVersion,
          cohortAttendanceThresholdPct: enrolment.cohort.attendanceThresholdPct,
        });
        verdict = evaluateCompletion(rule, { requiredLessonIds, completedLessonIds, attendance });
      }
    }

    return {
      card: {
        ...base,
        progress: {
          requiredLessonsComplete,
          requiredLessonsTotal: requiredLessonIds.length,
          attendance,
          structure: "structure",
        },
      },
      verdict,
      path,
      futureNonCancelled,
    };
  }

  /** One card per own ACTIVE enrolment (T-09-01), most-recently-activated
   *  first — `listOwnActiveEnrolments` already returns that order, so no
   *  additional sort happens here. Zero enrolments returns `{ cards: [] }`;
   *  this service never fabricates a placeholder card. */
  async function loadLearnerDashboard(actor: Actor): Promise<LearnerDashboard> {
    const enrolments = await learnerAccess.listOwnActiveEnrolments(actor);
    const nowDate = now();
    const contexts = await Promise.all(
      enrolments.map((enrolment) => buildCardContext(actor, enrolment, nowDate)),
    );
    return { cards: contexts.map((c) => c.card) };
  }

  return { loadLearnerDashboard };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding — the same `prisma as unknown as <Store>` idiom
// `learner-access.ts` / `roster-service.ts` use, plus the real
// `learner-access.ts` exports bundled as `learnerAccess`.
// ---------------------------------------------------------------------------

const liveStore = prisma as unknown as EnrolmentDashboardStore;

const built = createEnrolmentDashboardService({
  store: liveStore,
  learnerAccess: {
    listOwnActiveEnrolments,
    loadLearnerCourseStructure,
    loadLearnerPath,
    loadPinnedCompletionRuleSource,
    assertLessonOpenable,
  },
});

export const loadLearnerDashboard = built.loadLearnerDashboard;
