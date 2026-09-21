/**
 * The completion-recalculation persistence wrapper (LRN-07, D-10, D-12).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-6 — WHY THIS SERVICE NEVER TOUCHES `Enrolment.status`.
 * ─────────────────────────────────────────────────────────────────────────────
 * `enrolment-transitions.ts`'s `VALID_TRANSITIONS.COMPLETED` is `[]` —
 * terminal. D-12 requires a satisfied completion to be REVERSIBLE (an
 * attendance correction can drop a learner back below threshold, and
 * D-13/D-15 let a learner self-undo a manually completed lesson at any
 * time), so transitioning `Enrolment.status` to a terminal `COMPLETED`
 * would make the very next supersede unrepresentable — there is no legal
 * transition back out of a terminal status. Moving to `COMPLETED` would
 * also silently free the `(userId, cohortId) WHERE status = 'ACTIVE'`
 * partial unique index, permitting a duplicate enrolment. `CompletionRecord`
 * IS the evidence LRN-07 asks for and the evidence Phase 11 consumes; Phase
 * 11 ("Certificates & Completion Lifecycle") owns any `Enrolment.status`
 * transition, alongside the revocation semantics that make a terminal state
 * safe. This module does not import `assertTransition` and never calls
 * `tx.enrolment.update` — enforced here by never declaring that method on
 * `CompletionServiceTxClient` at all, and proven by an explicit test
 * assertion in `tests/completion-service.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-12 — A PLAIN SYNCHRONOUS CALL, NEVER AN OUTBOX POLL, NEVER A SWEEP.
 * ─────────────────────────────────────────────────────────────────────────────
 * `recalculateCompletion` takes the CALLER's `tx` and opens no transaction
 * of its own (D-11: reactive on every `LessonProgress` write and every
 * attendance change, never scheduled). It never reads `DomainEvent` —
 * `domain-event-service.ts`'s header is explicit that the outbox is not a
 * work-queue API — and it never sets a timer or a cron entry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-13 — WRITE-ONCE, READ-NEVER-BY-THIS-PHASE OUTPUT FOR PHASE 13.
 * ─────────────────────────────────────────────────────────────────────────────
 * The `course.completed` / `programme.completed` events this module emits
 * are Phase 13 drain input only. No Phase 9 code path may consume them as a
 * trigger for anything — doing so would create the duplicate/circular write
 * RESEARCH Pitfall 4 describes (a completion event causing another
 * recalculation causing another event, forever).
 *
 * Evidence is read inside the caller's `tx` (never the live `prisma`
 * singleton) so a write made earlier in the SAME transaction (an attendance
 * upsert, a `LessonProgress` create) is visible here before the transaction
 * commits — this is exactly what "recalculates without any batch job,
 * sweep, or outbox poll" means in practice.
 *
 * Obligations (required-lesson membership) come from the PINNED
 * `CoursePublication`/`ProgrammePublication` payload (DD-11, same rule
 * `learner-access.ts` documents) — never the live `Course`/`Module`/`Lesson`
 * tree, so a live edit can never retroactively change what an already
 * enrolled learner is evaluated against. A required lesson that has since
 * been WITHDRAWN (live `Lesson.withdrawnAt` set) is excluded from the
 * required set, mirroring `lesson-sequencing.ts`'s D-17 precedent — a
 * withdrawn lesson must never permanently block completion.
 */

import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";
import { evaluateCompletion, type CompletionVerdict } from "@/server/services/completion-engine";
import { parseCompletionRule } from "@/server/services/completion-rule";
import {
  computeAttendanceComponent,
  type AttendanceComponent,
  type AttendanceStateValue,
} from "@/server/services/attendance-component";
import {
  isCourseObligationPayload,
  isProgrammeObligationPayload,
} from "@/server/services/learner-access";
import type {
  CourseObligationPayload,
  ProgrammeObligationPayload,
} from "@/server/services/publication";

// ---------------------------------------------------------------------------
// Row shapes — the narrow structural slice this module needs, mirroring the
// `EnrolmentActivationTxClient` / `AttendanceTxClient` discipline so a test
// fake satisfies the type without a `@prisma/client` import.
// ---------------------------------------------------------------------------

export type CompletionEnrolmentRow = { id: string; cohortId: string };

export type CompletionCohortRow = {
  id: string;
  courseId: string | null;
  programmeId: string | null;
  attendanceThresholdPct: number | null;
  coursePublicationId: string | null;
  programmePublicationId: string | null;
};

export type CompletionCohortCourseRow = {
  cohortId: string;
  courseId: string;
  coursePublicationId: string | null;
};

export type CompletionModuleRow = { id: string; courseId: string };

export type CompletionLessonRow = { id: string; moduleId: string; withdrawnAt: Date | string | null };

export type CompletionLessonProgressRow = { lessonId: string };

export type CompletionSessionRow = {
  id: string;
  attendanceExpected: boolean;
  cancelledAt: Date | string | null;
};

export type CompletionAttendanceRecordRow = { sessionId: string; state: AttendanceStateValue };

export type CompletionRecordRow = { id: string };

/**
 * Structural — declares exactly the delegates `recalculateCompletion`
 * touches. NO `enrolment.update` and NO `completionRecord.delete` are
 * declared here (DD-6, D-12) — a caller cannot even compile a call to
 * either through this type, let alone accidentally make one.
 */
export type CompletionServiceTxClient = DomainEventTxClient & {
  enrolment: {
    findUnique(args: { where: { id: string } }): Promise<CompletionEnrolmentRow | null>;
  };
  cohort: {
    findUnique(args: { where: { id: string } }): Promise<CompletionCohortRow | null>;
  };
  cohortCourse: {
    findMany(args: { where: { cohortId: string } }): Promise<CompletionCohortCourseRow[]>;
  };
  coursePublication: {
    findUnique(args: { where: { id: string } }): Promise<{ payload: unknown } | null>;
  };
  programmePublication: {
    findUnique(args: { where: { id: string } }): Promise<{ payload: unknown } | null>;
  };
  module: {
    findMany(args: { where: { courseId: string } }): Promise<CompletionModuleRow[]>;
  };
  lesson: {
    findMany(args: { where: { moduleId: { in: string[] } } }): Promise<CompletionLessonRow[]>;
  };
  lessonProgress: {
    findMany(args: { where: { enrolmentId: string } }): Promise<CompletionLessonProgressRow[]>;
  };
  scheduledSession: {
    findMany(args: { where: { cohortId: string } }): Promise<CompletionSessionRow[]>;
  };
  attendanceRecord: {
    findMany(args: { where: { enrolmentId: string } }): Promise<CompletionAttendanceRecordRow[]>;
  };
  completionRecord: {
    findFirst(args: {
      where: { enrolmentId: string; scope: "COURSE" | "PROGRAMME"; courseId: string | null; supersededAt: null };
    }): Promise<CompletionRecordRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

export type CompletionScopeResult = {
  scope: "COURSE" | "PROGRAMME";
  courseId: string | null;
  verdict: CompletionVerdict;
  action: "created" | "superseded" | "unchanged";
};

export type CompletionRecalculationResult =
  | { kind: "not-evaluable"; reason: "unpinned" }
  | { kind: "evaluated"; results: CompletionScopeResult[] };

export type RecalculateCompletionArgs = { enrolmentId: string; now: Date };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type CourseObligation = {
  ruleJson: unknown;
  ruleVersion: number;
  requiredLessonIds: string[];
};

/**
 * Loads one course's frozen obligation tree from exactly one pin and
 * derives its required-lesson set, excluding any lesson withdrawn since
 * pinning (D-17 precedent). Returns `null` for an unresolved pin or an
 * invalid payload shape — treated by the caller exactly like "unpinned."
 */
async function loadCourseObligation(
  tx: CompletionServiceTxClient,
  courseId: string,
  publicationId: string | null,
): Promise<CourseObligation | null> {
  if (!publicationId) return null;

  const pub = await tx.coursePublication.findUnique({ where: { id: publicationId } });
  if (!pub || !isCourseObligationPayload(pub.payload)) return null;
  const payload: CourseObligationPayload = pub.payload;

  const liveModules = await tx.module.findMany({ where: { courseId } });
  const moduleIds = liveModules.map((m) => m.id);
  const liveLessons = moduleIds.length
    ? await tx.lesson.findMany({ where: { moduleId: { in: moduleIds } } })
    : [];
  const withdrawnByLessonId = new Map(liveLessons.map((l) => [l.id, l.withdrawnAt]));

  const requiredLessonIds: string[] = [];
  for (const mod of payload.modules) {
    for (const lesson of mod.lessons) {
      if (!lesson.required) continue;
      if ((withdrawnByLessonId.get(lesson.id) ?? null) != null) continue;
      requiredLessonIds.push(lesson.id);
    }
  }

  return {
    ruleJson: payload.completionRule,
    ruleVersion: payload.completionRuleVersion,
    requiredLessonIds,
  };
}

/**
 * Recomputes the attendance component for this enrolment over the cohort's
 * sessions and this enrolment's attendance records, read through `tx` —
 * the same read shape `attendance-service.ts`'s `recomputeComponent` uses,
 * duplicated rather than imported because that function is private to its
 * module and typed against `AttendanceTxClient`, not this module's
 * narrower client. Both call the SAME pure `computeAttendanceComponent`
 * (`attendance-component.ts`'s header forbids a second calculator).
 */
async function loadAttendanceComponent(
  tx: CompletionServiceTxClient,
  cohort: CompletionCohortRow,
  enrolmentId: string,
): Promise<AttendanceComponent> {
  const [sessions, records] = await Promise.all([
    tx.scheduledSession.findMany({ where: { cohortId: cohort.id } }),
    tx.attendanceRecord.findMany({ where: { enrolmentId } }),
  ]);
  const stateBySession = new Map(records.map((r) => [r.sessionId, r.state]));

  return computeAttendanceComponent({
    thresholdPct: cohort.attendanceThresholdPct,
    entries: sessions.map((s) => ({
      state: stateBySession.get(s.id) ?? "NOT_RECORDED",
      attendanceExpected: s.attendanceExpected,
      cancelledAt: s.cancelledAt,
    })),
  });
}

/**
 * Creates, supersedes or leaves alone the ONE open `CompletionRecord` for
 * `(enrolmentId, scope, courseId)`, per the full state table in this plan's
 * `<behavior>` block. Emits `course.completed` / `programme.completed`
 * ONLY on a fresh create — a supersede emits nothing (D-12 describes an
 * audit-trail stamp, not a notification; Phase 13 has no "un-completed"
 * mail to send).
 */
async function applyVerdict(
  tx: CompletionServiceTxClient,
  args: {
    enrolmentId: string;
    scope: "COURSE" | "PROGRAMME";
    courseId: string | null;
    ruleVersion: number;
    verdict: CompletionVerdict;
    now: Date;
  },
): Promise<"created" | "superseded" | "unchanged"> {
  const { enrolmentId, scope, courseId, ruleVersion, verdict, now } = args;

  const open = await tx.completionRecord.findFirst({
    where: { enrolmentId, scope, courseId, supersededAt: null },
  });

  if (verdict.satisfied) {
    if (open) return "unchanged"; // idempotent — a second mark-complete never creates a second record
    await tx.completionRecord.create({
      data: {
        enrolmentId,
        scope,
        courseId,
        ruleVersion,
        completedAt: now,
        evidence: { schema: 1, items: verdict.items },
      },
    });
    await writeDomainEvent(tx, {
      type: scope === "COURSE" ? "course.completed" : "programme.completed",
      payload: { enrolmentId, scope, courseId, ruleVersion },
      occurredAt: now,
    });
    return "created";
  }

  if (open) {
    // D-12 — stamp supersededAt, never delete, never blank completedAt/evidence.
    await tx.completionRecord.update({
      where: { id: open.id },
      data: { supersededAt: now },
    });
    return "superseded";
  }

  return "unchanged";
}

async function evaluateAndApplyCourseScope(
  tx: CompletionServiceTxClient,
  args: {
    enrolmentId: string;
    courseId: string;
    publicationId: string | null;
    cohort: CompletionCohortRow;
    completedLessonIds: ReadonlySet<string>;
    attendance: AttendanceComponent;
    now: Date;
  },
): Promise<{ obligation: CourseObligation; result: CompletionScopeResult } | null> {
  const obligation = await loadCourseObligation(tx, args.courseId, args.publicationId);
  if (!obligation) return null;

  const rule = parseCompletionRule({
    json: obligation.ruleJson,
    ruleVersion: obligation.ruleVersion,
    cohortAttendanceThresholdPct: args.cohort.attendanceThresholdPct,
  });
  const verdict = evaluateCompletion(rule, {
    requiredLessonIds: obligation.requiredLessonIds,
    completedLessonIds: args.completedLessonIds,
    attendance: args.attendance,
  });
  const action = await applyVerdict(tx, {
    enrolmentId: args.enrolmentId,
    scope: "COURSE",
    courseId: args.courseId,
    ruleVersion: obligation.ruleVersion,
    verdict,
    now: args.now,
  });

  return { obligation, result: { scope: "COURSE", courseId: args.courseId, verdict, action } };
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

/**
 * Reads all evidence through `tx`, evaluates the pinned completion rule(s)
 * for this enrolment's cohort, and creates/supersedes/leaves alone the
 * `CompletionRecord`(s) accordingly.
 *
 * Course-cohort (`Cohort.courseId` set): evaluates exactly one COURSE-scope
 * rule. Programme-cohort (`Cohort.programmeId` set): evaluates one
 * COURSE-scope rule per member course PLUS one PROGRAMME-scope rule whose
 * required-lesson set is the union across every member course.
 *
 * `parseCompletionRule` throwing (unknown version / unrecognised key)
 * propagates out of this function and out of the caller's transaction —
 * an unevaluable rule must fail loudly, never be silently treated as
 * unsatisfied or satisfied.
 */
export async function recalculateCompletion(
  tx: CompletionServiceTxClient,
  args: RecalculateCompletionArgs,
): Promise<CompletionRecalculationResult> {
  const { enrolmentId, now } = args;

  const enrolment = await tx.enrolment.findUnique({ where: { id: enrolmentId } });
  if (!enrolment) return { kind: "not-evaluable", reason: "unpinned" };

  const cohort = await tx.cohort.findUnique({ where: { id: enrolment.cohortId } });
  if (!cohort) return { kind: "not-evaluable", reason: "unpinned" };

  const completedLessonIds: ReadonlySet<string> = new Set(
    (await tx.lessonProgress.findMany({ where: { enrolmentId } })).map((p) => p.lessonId),
  );

  const attendance = await loadAttendanceComponent(tx, cohort, enrolmentId);

  if (cohort.courseId) {
    const evaluated = await evaluateAndApplyCourseScope(tx, {
      enrolmentId,
      courseId: cohort.courseId,
      publicationId: cohort.coursePublicationId,
      cohort,
      completedLessonIds,
      attendance,
      now,
    });
    if (!evaluated) return { kind: "not-evaluable", reason: "unpinned" };
    return { kind: "evaluated", results: [evaluated.result] };
  }

  if (cohort.programmeId) {
    const members = await tx.cohortCourse.findMany({ where: { cohortId: cohort.id } });
    if (members.length === 0 || !cohort.programmePublicationId) {
      return { kind: "not-evaluable", reason: "unpinned" };
    }

    const programmePub = await tx.programmePublication.findUnique({
      where: { id: cohort.programmePublicationId },
    });
    if (!programmePub || !isProgrammeObligationPayload(programmePub.payload)) {
      return { kind: "not-evaluable", reason: "unpinned" };
    }
    const programmePayload: ProgrammeObligationPayload = programmePub.payload;

    const results: CompletionScopeResult[] = [];
    const unionRequiredLessonIds = new Set<string>();

    for (const member of members) {
      const pinId = member.coursePublicationId ?? cohort.coursePublicationId;
      const evaluated = await evaluateAndApplyCourseScope(tx, {
        enrolmentId,
        courseId: member.courseId,
        publicationId: pinId,
        cohort,
        completedLessonIds,
        attendance,
        now,
      });
      if (!evaluated) return { kind: "not-evaluable", reason: "unpinned" };
      evaluated.obligation.requiredLessonIds.forEach((id) => unionRequiredLessonIds.add(id));
      results.push(evaluated.result);
    }

    const programmeRule = parseCompletionRule({
      json: programmePayload.completionRule,
      ruleVersion: programmePayload.completionRuleVersion,
      cohortAttendanceThresholdPct: cohort.attendanceThresholdPct,
    });
    const programmeVerdict = evaluateCompletion(programmeRule, {
      requiredLessonIds: [...unionRequiredLessonIds],
      completedLessonIds,
      attendance,
    });
    const programmeAction = await applyVerdict(tx, {
      enrolmentId,
      scope: "PROGRAMME",
      courseId: null,
      ruleVersion: programmePayload.completionRuleVersion,
      verdict: programmeVerdict,
      now,
    });
    results.push({ scope: "PROGRAMME", courseId: null, verdict: programmeVerdict, action: programmeAction });

    return { kind: "evaluated", results };
  }

  return { kind: "not-evaluable", reason: "unpinned" };
}
