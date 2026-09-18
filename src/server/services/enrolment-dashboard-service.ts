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
 * Plan 10-15 — `assessmentObligations` and `results` WIDENED (DD-32
 * precedent). Each is now `DeferredColumn | { kind: "tracked"; ... }`
 * (`AssessmentObligationsColumn` / `ResultsColumn` below), populated from
 * `learner-results-service.ts`'s `getOwnAssessmentObligations`/`getOwnResults`
 * — a real runtime import this time, injected as `deps.learnerResults` so
 * `tests/enrolment-dashboard-service.test.ts` can keep proving this module
 * with in-memory fakes only, no Prisma. The deferred inhabitant is still
 * reachable for a card with no pinned course structure (mirrors Progress's
 * own `"unpinned"` branch — no computable obligation set is a named gap, not
 * a fake empty list). `tickets` remains untouched — Phase 12's own gap to
 * close. `certificate` was ALSO untouched through Plan 10-15 but is no
 * longer a named gap at all — see the Plan 11-13 header block below.
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLAN 11-13 — `certificate` WIDENED FROM `DeferredColumn` TO A REAL
 * `CertificateColumn`, PHASE 9'S NAMED GAP CLOSED.
 * ─────────────────────────────────────────────────────────────────────────────
 * Same DD-32 precedent Plan 10-15 used for `assessmentObligations`/`results`:
 * the deferred inhabitant is gone from this column entirely (not widened to a
 * union with it), replaced by a five-branch `CertificateColumn` derived by
 * the pure, independently-tested `deriveCertificateColumn`. The branch
 * precedence for an existing certificate is NEVER reimplemented here — it
 * delegates to `certificate-service.ts`'s own `certificateDisplayStatus`
 * (the single owner of "flagged beats active, revoked beats everything") so
 * this card and the staff-facing certificate surfaces can never disagree.
 *
 * Both new reads (`completionRecord.findMany`, `certificate.findMany`) are
 * batched ONCE per `loadLearnerDashboard` call across every enrolment id —
 * not once per card inside `buildCardContext` — so a 3-enrolment dashboard
 * issues exactly the same two additional queries a 1-enrolment dashboard
 * does, never N+1. Results are looked up per enrolment by an
 * `${enrolmentId}:${scope}` key, matching the enrolment's OWN cohort scope
 * (COURSE vs PROGRAMME) so a programme-cohort's internal per-member-course
 * `CompletionRecord` rows (D-01, the same distinction `listPendingIssuance`
 * applies) are never mistaken for the card's own completion signal.
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
// Plan 10-15 — a real (non-type-only) import: this module now CALLS
// `getOwnAssessmentObligations`/`getOwnResults` to populate the two widened
// columns, unlike the roster-service.ts import above which is deliberately
// type-only. `learner-results-service.ts` itself imports no permission
// choke point (DD-15, its own header) so this stays a narrow addition to
// the runtime closure, not the wide one DD-18 warned against.
import {
  getOwnAssessmentObligations,
  getOwnResults,
  type AssessmentObligation,
  type LearnerResultCard,
} from "@/server/services/learner-results-service";
// Plan 11-13 — a real (non-type-only) import for the SAME reason the
// learner-results import above is real, not type-only: this module now
// CALLS `certificateDisplayStatus` to derive the certificate column's
// existing-certificate branches, rather than re-implementing its
// revoked-beats-flagged-beats-active precedence a second time.
import { certificateDisplayStatus } from "@/server/services/certificate-service";

// ---------------------------------------------------------------------------
// Named-gap constants (DD-18) — phase numbers match this plan's ruling.
// ---------------------------------------------------------------------------

const ASSESSMENT_OBLIGATIONS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 10 };
const RESULTS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 10 };
const TICKETS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 12 };

/**
 * Plan 10-15 — DD-32-precedent second inhabitant for the two columns Phase
 * 10 owns. `DeferredColumn` itself is unchanged (roster-service.ts); these
 * unions live here because the tracked shape is specific to what this
 * dashboard card renders, not to the roster.
 */
export type AssessmentObligationsColumn =
  | DeferredColumn
  | { kind: "tracked"; items: AssessmentObligation[] };
export type ResultsColumn = DeferredColumn | { kind: "tracked"; recent: LearnerResultCard[] };

/**
 * Plan 11-13 — UI-SPEC §7.6's five branches, first match wins: (1)
 * `not-complete` — no unsuperseded `CompletionRecord` for the enrolment's own
 * scope; (2) `pending-issuance` — a completion record exists but no
 * certificate has been issued yet (MANUAL-mode's D-04 queue, or an
 * AUTOMATIC-mode issuance not yet reflected); (3) `issued` — an
 * unflagged, current certificate; (4) `flagged` — a flagged-but-current
 * certificate, STILL carrying `certificateId` because the download stays
 * available (branch 4 — a flag never withdraws earned access); (5)
 * `revoked` — carries NO certificate id, because there is no download
 * affordance to build. Unlike `AssessmentObligationsColumn`/`ResultsColumn`,
 * this is NOT `DeferredColumn | …` — Phase 9's named gap is closed outright,
 * not widened to keep a still-reachable deferred inhabitant.
 */
export type CertificateColumn =
  | { kind: "not-complete" }
  | { kind: "pending-issuance" }
  | { kind: "issued"; certificateId: string; verificationRef: string; issuedAt: Date }
  | { kind: "flagged"; certificateId: string; verificationRef: string; issuedAt: Date }
  | { kind: "revoked" };

/** A window closing within this many days surfaces the "ending" notice. */
const ACCESS_ENDING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

/** "Upcoming sessions" shows at most this many rows per card. */
const MAX_UPCOMING_SESSIONS = 3;

/** The dashboard "Results" slot shows at most this many, most-recent-first (§6.1). */
const MAX_RECENT_RESULTS = 3;

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

/** Plan 11-13 — the narrow slice of `CompletionRecord` the certificate
 *  column needs: only whether an unsuperseded record exists for a given
 *  enrolment+scope pair. */
export type DashboardCompletionRecordStoreRow = {
  enrolmentId: string;
  scope: "COURSE" | "PROGRAMME";
};

/** Plan 11-13 — the narrow slice of `Certificate` the certificate column
 *  needs, structurally compatible with `certificate-service.ts`'s
 *  `certificateDisplayStatus` input so this module never re-derives that
 *  precedence itself. */
export type DashboardCertificateStoreRow = {
  enrolmentId: string;
  scope: "COURSE" | "PROGRAMME";
  id: string;
  status: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  reviewFlaggedAt: Date | null;
  verificationRef: string;
  issuedAt: Date;
};

export type EnrolmentDashboardStore = {
  scheduledSession: {
    findMany(args: { where: { cohortId: string } }): Promise<DashboardSessionStoreRow[]>;
  };
  attendanceRecord: {
    findMany(args: { where: { enrolmentId: string } }): Promise<DashboardAttendanceRecordStoreRow[]>;
  };
  /** Plan 11-13 — batched ONCE per `loadLearnerDashboard` call across every
   *  enrolment id (never per card) so the certificate column cannot regress
   *  the dashboard into an N+1. */
  completionRecord: {
    findMany(args: {
      where: { enrolmentId: { in: string[] }; supersededAt: null };
    }): Promise<DashboardCompletionRecordStoreRow[]>;
  };
  certificate: {
    findMany(args: {
      where: { enrolmentId: { in: string[] }; status: { not: "SUPERSEDED" } };
    }): Promise<DashboardCertificateStoreRow[]>;
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

/**
 * Plan 10-15 — the two `learner-results-service.ts` reads this module
 * composes, bundled the same way `EnrolmentDashboardLearnerAccess` is, so
 * `tests/enrolment-dashboard-service.test.ts` can hand in an in-memory fake
 * instead of the real Prisma-backed singleton.
 */
export type EnrolmentDashboardLearnerResults = {
  getOwnAssessmentObligations(
    actor: Actor,
    input: { enrolmentId: string },
  ): Promise<AssessmentObligation[]>;
  getOwnResults(actor: Actor, input: { enrolmentId?: string }): Promise<LearnerResultCard[]>;
};

export type EnrolmentDashboardDeps = {
  store: EnrolmentDashboardStore;
  learnerAccess: EnrolmentDashboardLearnerAccess;
  learnerResults: EnrolmentDashboardLearnerResults;
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

/**
 * DD-5 — exactly four variants, first match wins, evaluated per enrolment:
 * (1) `session` — an upcoming non-cancelled session starting within the
 * next 24 hours; (2) `lesson` — the next incomplete required lesson in
 * whole-course order, ONLY if it is confirmed openable; (3) `complete` —
 * the enrolment's completion verdict is satisfied; (4) `none` — anything
 * else, including a closed self-paced access window with required lessons
 * still outstanding. `deriveNextAction` below is total: every input
 * produces exactly one of these four.
 */
export type NextAction =
  | { kind: "session"; sessionId: string; title: string; startsAt: Date }
  | { kind: "lesson"; enrolmentId: string; lessonId: string; lessonTitle: string; moduleTitle: string }
  | { kind: "complete" }
  | { kind: "none" };

export type LearnerDashboardCard = {
  enrolmentId: string;
  /** `Cohort.title` — 09-08 Task 3 heads each dashboard section with it. */
  cohortTitle: string;
  /** `Cohort.timezone` (IANA) — 09-08's session/date rendering reads this
   *  rather than the server's local zone (matches
   *  `scheduled-session-service.ts`'s existing convention). */
  timezone: string;
  assessmentObligations: AssessmentObligationsColumn;
  results: ResultsColumn;
  tickets: DeferredColumn;
  certificate: CertificateColumn;
  progress: LearnerDashboardProgress;
  accessNotice: AccessNotice;
  upcomingSessions: UpcomingSessionCard[];
  hasMoreSessions: boolean;
  nextAction: NextAction;
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

/**
 * Plan 11-13 — pure and total, unit-testable with no store fake at all
 * (mirrors `deriveNextAction`'s own standalone-testability). Delegates the
 * existing-certificate precedence to `certificateDisplayStatus` rather than
 * re-deriving "revoked beats flagged beats active" a second time.
 */
export function deriveCertificateColumn(input: {
  hasCompletionRecord: boolean;
  certificate: DashboardCertificateStoreRow | null;
}): CertificateColumn {
  if (!input.hasCompletionRecord) return { kind: "not-complete" };
  if (!input.certificate) return { kind: "pending-issuance" };

  const displayStatus = certificateDisplayStatus(input.certificate);
  if (displayStatus === "revoked") return { kind: "revoked" };

  const shared = {
    certificateId: input.certificate.id,
    verificationRef: input.certificate.verificationRef,
    issuedAt: input.certificate.issuedAt,
  };
  if (displayStatus === "flagged") return { kind: "flagged", ...shared };
  // "active" (the normal case) and the defensive "superseded" fallback (the
  // batched query already excludes SUPERSEDED rows, so this never actually
  // occurs) both render as the plain issued branch.
  return { kind: "issued", ...shared };
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

/** A session's minimal shape for priority-1 next-action evaluation. */
export type NextActionSession = { id: string; title: string; startsAt: Date };

/**
 * The first required, not-since-withdrawn lesson with no `LessonProgress`
 * row, walked in whole-course order (the same order `path.courses` already
 * carries — course, then module, then lesson position). An optional
 * incomplete lesson is never a candidate; a withdrawn required lesson is
 * excluded for the same D-17 reason `collectRequiredLessonEvidence` excludes
 * it from the required count.
 */
function findNextIncompleteRequiredLesson(
  path: LearnerPath,
): { lessonId: string; lessonTitle: string; moduleTitle: string } | null {
  for (const course of path.courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        if (lesson.required && lesson.withdrawnAt == null && !lesson.completed) {
          return { lessonId: lesson.id, lessonTitle: lesson.title, moduleTitle: mod.title };
        }
      }
    }
  }
  return null;
}

const NEXT_ACTION_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * DD-5's four-branch priority order, pure and total. Takes ALREADY-LOADED
 * evidence (nearest future session, the decorated path with lock state, the
 * completion verdict, `now`) rather than reading anything itself — fully
 * unit-testable with no store fake at all, and the priority order stays
 * inspectable in exactly one place.
 *
 * Priority 2 re-checks `assertLessonOpenable` rather than assuming the next
 * required lesson is open: a closed self-paced access window (D-03) leaves
 * a lesson unopenable while it still exists in the path, and the render
 * must never assume "next required lesson" implies "open".
 */
export function deriveNextAction(input: {
  enrolmentId: string;
  now: Date;
  nearestFutureSession: NextActionSession | null;
  path: LearnerPath | null;
  verdict: CompletionVerdict | null;
}): NextAction {
  const { enrolmentId, now, nearestFutureSession, path, verdict } = input;

  if (nearestFutureSession) {
    const msUntilStart = nearestFutureSession.startsAt.getTime() - now.getTime();
    if (msUntilStart > 0 && msUntilStart <= NEXT_ACTION_SESSION_WINDOW_MS) {
      return {
        kind: "session",
        sessionId: nearestFutureSession.id,
        title: nearestFutureSession.title,
        startsAt: nearestFutureSession.startsAt,
      };
    }
  }

  if (path) {
    const nextLesson = findNextIncompleteRequiredLesson(path);
    if (nextLesson) {
      const openable = assertLessonOpenable(path, nextLesson.lessonId);
      if (openable.ok) {
        return {
          kind: "lesson",
          enrolmentId,
          lessonId: nextLesson.lessonId,
          lessonTitle: nextLesson.lessonTitle,
          moduleTitle: nextLesson.moduleTitle,
        };
      }
      // Not openable (e.g. a closed self-paced window, D-03) — falls through.
      // The required-lessons verdict item can never be satisfied while this
      // lesson is outstanding, so priority 3 below will not fire either;
      // this naturally lands on priority 4 without a special case.
    }
  }

  if (verdict && verdict.satisfied) {
    return { kind: "complete" };
  }

  return { kind: "none" };
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
  const { store, learnerAccess, learnerResults } = deps;
  const now = deps.now ?? (() => new Date());

  /** Most-recent-first by the result's own latest history entry (§6.1's
   *  "most-recent released results" — `LearnerResultCard` carries no
   *  top-level `releasedAt`, so the latest attempt/submission timestamp in
   *  its own `history[0]` is the recency signal). */
  function mostRecentFirst(cards: LearnerResultCard[]): LearnerResultCard[] {
    return cards
      .slice()
      .sort((a, b) => (b.history[0]?.at.getTime() ?? 0) - (a.history[0]?.at.getTime() ?? 0));
  }

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
    certificateContext: { hasCompletionRecord: boolean; certificate: DashboardCertificateStoreRow | null },
  ): Promise<EnrolmentCardContext> {
    const [sessions, records, structure] = await Promise.all([
      store.scheduledSession.findMany({ where: { cohortId: enrolment.cohortId } }),
      store.attendanceRecord.findMany({ where: { enrolmentId: enrolment.id } }),
      learnerAccess.loadLearnerCourseStructure(enrolment),
    ]);

    const attendance = computeAttendanceComponentForCard(enrolment, sessions, records);
    const { upcomingSessions, hasMoreSessions, futureNonCancelled } = buildUpcomingSessions(sessions, nowDate);
    const accessNotice = deriveAccessNotice(enrolment.accessWindow, nowDate);
    const nearestFutureSession: NextActionSession | null = futureNonCancelled[0]
      ? { id: futureNonCancelled[0].id, title: futureNonCancelled[0].title, startsAt: futureNonCancelled[0].startsAt }
      : null;

    const base = {
      enrolmentId: enrolment.id,
      cohortTitle: enrolment.cohort.title,
      timezone: enrolment.cohort.timezone,
      assessmentObligations: ASSESSMENT_OBLIGATIONS_DEFERRED,
      results: RESULTS_DEFERRED,
      tickets: TICKETS_DEFERRED,
      certificate: deriveCertificateColumn(certificateContext),
      accessNotice,
      upcomingSessions,
      hasMoreSessions,
    };

    if (structure.kind === "unpinned") {
      const nextAction = deriveNextAction({
        enrolmentId: enrolment.id,
        now: nowDate,
        nearestFutureSession,
        path: null,
        verdict: null,
      });
      return {
        card: { ...base, progress: unpinnedProgress(attendance), nextAction },
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
      const nextAction = deriveNextAction({
        enrolmentId: enrolment.id,
        now: nowDate,
        nearestFutureSession,
        path: null,
        verdict: null,
      });
      return {
        card: { ...base, progress: unpinnedProgress(attendance), nextAction },
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

    const nextAction = deriveNextAction({
      enrolmentId: enrolment.id,
      now: nowDate,
      nearestFutureSession,
      path,
      verdict,
    });

    // Plan 10-15 — tracked only once a course structure is pinned (`path`
    // resolved above), mirroring Progress's own unpinned/pinned split: an
    // unpinned cohort has no computable obligation set, so it falls through
    // to `base`'s deferred inhabitants instead (returned by the two earlier
    // branches above, never reaching here).
    const [obligations, results] = await Promise.all([
      learnerResults.getOwnAssessmentObligations(actor, { enrolmentId: enrolment.id }),
      learnerResults.getOwnResults(actor, { enrolmentId: enrolment.id }),
    ]);

    return {
      card: {
        ...base,
        assessmentObligations: { kind: "tracked", items: obligations },
        results: { kind: "tracked", recent: mostRecentFirst(results).slice(0, MAX_RECENT_RESULTS) },
        progress: {
          requiredLessonsComplete,
          requiredLessonsTotal: requiredLessonIds.length,
          attendance,
          structure: "structure",
        },
        nextAction,
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

    // Plan 11-13 — batched ONCE across every enrolment id (never per card):
    // a 3-enrolment dashboard issues the exact same two extra queries a
    // 1-enrolment dashboard does. `enrolmentIds` is already ownership-scoped
    // (it comes straight from `listOwnActiveEnrolments`), so this can never
    // surface another learner's certificate (T-11-61).
    const enrolmentIds = enrolments.map((e) => e.id);
    const [completionRecords, certificates] = enrolmentIds.length
      ? await Promise.all([
          store.completionRecord.findMany({
            where: { enrolmentId: { in: enrolmentIds }, supersededAt: null },
          }),
          store.certificate.findMany({
            where: { enrolmentId: { in: enrolmentIds }, status: { not: "SUPERSEDED" } },
          }),
        ])
      : [[], []];

    // Keyed by `${enrolmentId}:${scope}` — a Programme-cohort enrolment also
    // owns internal per-member-course COURSE-scope `CompletionRecord` rows
    // (D-01); only the record matching the enrolment's OWN cohort scope may
    // ever drive this card's certificate column.
    const completionKeys = new Set(completionRecords.map((r) => `${r.enrolmentId}:${r.scope}`));
    const certificateByKey = new Map(certificates.map((c) => [`${c.enrolmentId}:${c.scope}`, c]));

    const contexts = await Promise.all(
      enrolments.map((enrolment) => {
        const scope = enrolment.cohort.programmeId ? "PROGRAMME" : "COURSE";
        const key = `${enrolment.id}:${scope}`;
        return buildCardContext(actor, enrolment, nowDate, {
          hasCompletionRecord: completionKeys.has(key),
          certificate: certificateByKey.get(key) ?? null,
        });
      }),
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
  learnerResults: { getOwnAssessmentObligations, getOwnResults },
});

export const loadLearnerDashboard = built.loadLearnerDashboard;
