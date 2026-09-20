/**
 * Grading service — the grader-facing half of ASM-05.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO RULES A FUTURE CONTRIBUTOR MUST NOT BREAK.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. Every exported mutation and read here resolves its scope through
 *      `enrolmentCohortScope` (`cohort-scope.ts`) on the REAL row — the
 *      submission's or grade's own `enrolmentId`, read from the database —
 *      never a caller-asserted cohort id. This is D-05's "graders cannot
 *      access unrelated Cohorts", and reusing the existing resolver
 *      unmodified is what inherits the T-05-07/T-05-08 mitigations its
 *      header documents rather than reintroducing them.
 *
 *   2. This file's ordinary draft-save path (`saveDraftGrade`) must refuse a
 *      RELEASED grade. `grade-override-service.ts` (plan 10-09) is the ONLY
 *      write path permitted to change an already-released score, and it is
 *      audited with a mandatory reason. Letting a plain re-save through here
 *      would be a mandatory-reason bypass (T-10-05).
 *
 * D-06's batch release (`releaseGradesBatch`) is ONE server action over an
 * array of Grade ids, executed inside ONE `prisma.$transaction` — Next.js
 * 16.3.4 dispatches Server Actions sequentially per client, so N
 * client-dispatched calls would be both slow and would fragment the audit
 * and outbox trail into N entries for what the user experienced as one
 * action (10-RESEARCH.md Pattern 4).
 *
 * Permission identifier: `grades.manage` for every mutation in this file
 * (single AND batch release — the catalogue is closed and already covers
 * both; see `assessments.create`/`assessments.edit`/`submissions.view` for
 * the other Phase-10 identifiers). `submissions.view` covers the read-only
 * queue/summary/detail exports. No new permission identifier is added.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";
import {
  cohortResourceScope,
  enrolmentCohortScope,
} from "@/server/services/cohort-scope";

type WithPermission = ReturnType<typeof createWithPermission>;
type Audit = (entry: ResourceAuditEntry) => Promise<void>;

/**
 * D-06 — a single request cannot hold a long write transaction open
 * indefinitely. Documented and enforced in `commonGradesScope` before any
 * grade is even read (T-10-24).
 */
export const MAX_BATCH_RELEASE = 200;

// ---------------------------------------------------------------------------
// Typed refusals
// ---------------------------------------------------------------------------

/**
 * Thrown by `saveDraftGrade` when the target Grade is already `RELEASED`.
 * The plain draft-save path refuses BEFORE any write — the only route to
 * changing a released score is plan 10-09's audited, reason-mandatory
 * override (T-10-05).
 */
export class GradeAlreadyReleasedError extends Error {
  readonly gradeId: string;

  constructor(gradeId: string) {
    super("This grade has already been released and cannot be edited through the draft-save path.");
    this.name = "GradeAlreadyReleasedError";
    this.gradeId = gradeId;
  }
}

export class SubmissionNotFoundError extends Error {
  readonly submissionId: string;

  constructor(submissionId: string) {
    super("Submission not found.");
    this.name = "SubmissionNotFoundError";
    this.submissionId = submissionId;
  }
}

export class GradeNotFoundError extends Error {
  readonly gradeId: string;

  constructor(gradeId: string) {
    super("Grade not found.");
    this.name = "GradeNotFoundError";
    this.gradeId = gradeId;
  }
}

/** `saveDraftGrade` refuses a score outside `[0, maxScore]` BEFORE any write. */
export class InvalidScoreError extends Error {
  readonly score: number;
  readonly maxScore: number;

  constructor(score: number, maxScore: number) {
    super(`Score must be an integer between 0 and ${maxScore}.`);
    this.name = "InvalidScoreError";
    this.score = score;
    this.maxScore = maxScore;
  }
}

/** `releaseGradesBatch` refuses a selection larger than `MAX_BATCH_RELEASE` BEFORE any read or write (T-10-24). */
export class BatchTooLargeError extends Error {
  readonly count: number;

  constructor(count: number) {
    super(`Cannot release ${count} grades in one batch; the limit is ${MAX_BATCH_RELEASE}.`);
    this.name = "BatchTooLargeError";
    this.count = count;
  }
}

// ---------------------------------------------------------------------------
// Row / delegate shapes
// ---------------------------------------------------------------------------

export type GradeStatusValue = "DRAFT" | "RELEASED";

export type GradeRow = {
  id: string;
  assessmentId: string;
  enrolmentId: string;
  submissionId: string | null;
  attemptId: string | null;
  score: number;
  maxScore: number;
  passed: boolean | null;
  feedback: string | null;
  status: GradeStatusValue;
  gradedById: string | null;
  gradedAt: Date;
  releasedById: string | null;
  releasedAt: Date | null;
};

export type SubmissionRow = {
  id: string;
  assessmentId: string;
  enrolmentId: string;
  attemptNumber: number;
  versionUsed: number;
  submittedAt: Date;
  isLate: boolean;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: string;
};

export type AssessmentRow = {
  id: string;
  courseId: string;
  type: string;
  title: string;
  totalMarks: number | null;
  passMark: number | null;
};

export type EnrolmentRow = { id: string; cohortId: string; userId: string };
export type UserRow = { id: string; name: string; email: string };
export type CohortRow = { id: string; programmeId: string | null; courseId: string | null };
export type CohortCourseRow = { cohortId: string; courseId: string };
export type GradeOverrideRow = {
  id: string;
  gradeId: string;
  previousScore: number;
  newScore: number;
  reason: string;
  actorId: string | null;
  createdAt: Date;
};

export type GradingQueueRow = {
  submissionId: string;
  enrolmentId: string;
  learnerName: string;
  submittedAt: Date;
  isLate: boolean;
  attemptNumber: number;
  uploadStatus: string;
  gradeId: string | null;
  gradeStatus: GradeStatusValue | null;
  score: number | null;
};

export type CohortGradingSummaryRow = {
  assessmentId: string;
  title: string;
  pendingCount: number;
  draftCount: number;
  releasedCount: number;
};

export type GradingDetail = {
  submission: SubmissionRow;
  learnerName: string;
  isLate: boolean;
  attemptNumber: number;
  uploadStatus: string;
  downloadRef: string;
  grade: GradeRow | null;
  /** Every prior `Submission` row for this enrolment+assessment, newest attempt first (D-04). */
  priorSubmissions: SubmissionRow[];
  overrides: GradeOverrideRow[];
  /**
   * The submission's OWN cohort (read from its enrolment row, never a
   * caller-supplied value) — plan 10-13's grade-entry route cross-checks
   * this against its `[id]` route param so a submission id that resolves
   * under a broader grant (PROGRAMME/GLOBAL) can never render under the
   * WRONG Cohort's D-05 scope banner, mirroring the same
   * row-proves-membership pattern `learners/[enrolmentId]/page.tsx` already
   * uses for `enrolmentId`.
   */
  cohortId: string;
  /** The score scale and title the grade-entry screen's read-only zone and
   * Score field hint need — resolved here (`submissions.view` scope, the
   * SAME grant already gating this whole read) rather than via a second
   * `courses.view`-gated call the grader may not hold. */
  assessment: { id: string; title: string; totalMarks: number | null; passMark: number | null };
};

/**
 * The transaction client `releaseGrade`/`releaseGradesBatch` need — a
 * structural type, so a Prisma transaction client and a unit-test fake both
 * satisfy it and this file needs no `@prisma/client` import.
 */
export type GradingTxClient = DomainEventTxClient & {
  grade: {
    findUnique(args: { where: { id: string } }): Promise<GradeRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<GradeRow>;
  };
};

export type GradingServiceDeps = {
  grade: {
    findUnique(args: { where: { id: string } }): Promise<GradeRow | null>;
    findFirst(args: { where: { submissionId: string } }): Promise<GradeRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<GradeRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<GradeRow>;
    update(args: { where: { id: string; status?: "DRAFT" }; data: Record<string, unknown> }): Promise<GradeRow>;
  };
  submission: {
    findUnique(args: { where: { id: string } }): Promise<SubmissionRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<SubmissionRow[]>;
  };
  assessment: {
    findUnique(args: { where: { id: string } }): Promise<AssessmentRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<AssessmentRow[]>;
  };
  enrolment: {
    findUnique(args: { where: { id: string } }): Promise<EnrolmentRow | null>;
    findMany(args: { where: { cohortId: string } }): Promise<EnrolmentRow[]>;
  };
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserRow | null>;
  };
  cohort: {
    findUnique(args: { where: { id: string } }): Promise<CohortRow | null>;
  };
  cohortCourse: {
    findMany(args: { where: { cohortId: string } }): Promise<CohortCourseRow[]>;
  };
  gradeOverride: {
    findMany(args: { where: { gradeId: string } }): Promise<GradeOverrideRow[]>;
  };
  audit: Audit;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx: GradingTxClient) => Promise<R>) => Promise<R>;
  /** Enrolment id -> scope. Resolves the OWNING cohort from the row (D-21) — bound to `enrolmentCohortScope`. */
  enrolmentScope: (enrolmentId: string) => ResourceScope | Promise<ResourceScope>;
  /** Cohort id -> scope, for the two Cohort-level list reads that scope on a caller-supplied cohortId directly. */
  cohortScope: (cohortId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createGradingService(deps: GradingServiceDeps) {
  const { withPermission } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * Reads the submission row to learn its OWN `enrolmentId`, then resolves
   * through `enrolmentScope` (`enrolmentCohortScope`) — never a caller-
   * supplied cohort id. Resolving from the row is what makes an IDOR on
   * `submissionId` a denial rather than a leak (T-10-23). A missing
   * submission resolves to `{}`, which only a GLOBAL grant can satisfy.
   */
  async function submissionEnrolmentScope(submissionId: string): Promise<ResourceScope> {
    const submission = await deps.submission.findUnique({ where: { id: submissionId } });
    if (!submission) return {};
    return deps.enrolmentScope(submission.enrolmentId);
  }

  /** Same shape as `submissionEnrolmentScope`, keyed on a Grade's own `enrolmentId` (T-10-23). */
  async function gradeEnrolmentScope(gradeId: string): Promise<ResourceScope> {
    const grade = await deps.grade.findUnique({ where: { id: gradeId } });
    if (!grade) return {};
    return deps.enrolmentScope(grade.enrolmentId);
  }

  /**
   * D-06/T-10-09 — resolves the COMMON scope covering every supplied Grade
   * id, so `releaseGradesBatch`'s single `withPermission` check authorizes
   * the WHOLE selection at once rather than authorizing the first id and
   * trusting the rest.
   *
   * `cohortId` is kept only when every grade shares the exact same cohort
   * (a COHORT-scoped grant can never legitimately cover two cohorts).
   * `programmeId` is kept only when every grade shares the same programme
   * (this is what lets a PROGRAMME-scoped grant cover a selection spanning
   * several of its Cohorts — `enrolmentCohortScope`'s three-key resolution,
   * not a bespoke cohort-id equality check). `courseIds` is the
   * INTERSECTION across every grade's own `courseIds`, so a COURSE-scoped
   * grant only matches a course common to every selected grade's cohort.
   * Refuses (`BatchTooLargeError`) before reading a single grade when the
   * selection exceeds `MAX_BATCH_RELEASE` (T-10-24).
   */
  async function commonGradesScope(gradeIds: string[]): Promise<ResourceScope> {
    if (gradeIds.length > MAX_BATCH_RELEASE) {
      throw new BatchTooLargeError(gradeIds.length);
    }
    if (gradeIds.length === 0) return {};

    const scopes: ResourceScope[] = [];
    for (const id of gradeIds) {
      scopes.push(await gradeEnrolmentScope(id));
    }

    const [first, ...rest] = scopes;

    const cohortId =
      first.cohortId !== undefined && rest.every((s) => s.cohortId === first.cohortId)
        ? first.cohortId
        : undefined;

    const programmeId =
      first.programmeId !== undefined && rest.every((s) => s.programmeId === first.programmeId)
        ? first.programmeId
        : undefined;

    const courseIds = scopes.reduce<string[]>(
      (acc, s) => acc.filter((c) => (s.courseIds ?? []).includes(c)),
      first.courseIds ?? [],
    );

    return {
      ...(cohortId ? { cohortId } : {}),
      ...(programmeId ? { programmeId } : {}),
      ...(courseIds.length ? { courseIds } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // listCohortGradingSummary — the Cohort Grading tab landing (§7.2.0)
  // -------------------------------------------------------------------------

  const listCohortGradingSummary = withPermission<{ cohortId: string }>(
    "submissions.view",
    (input) => deps.cohortScope(input.cohortId),
  )(async (input): Promise<CohortGradingSummaryRow[]> => {
    const cohort = await deps.cohort.findUnique({ where: { id: input.cohortId } });
    if (!cohort) return [];

    const courseIds = cohort.courseId
      ? [cohort.courseId]
      : (await deps.cohortCourse.findMany({ where: { cohortId: input.cohortId } })).map((cc) => cc.courseId);
    if (courseIds.length === 0) return [];

    // ASSIGNMENT-type only — D-01's auto-release means a Quiz never produces
    // a DRAFT grade a human needs to act on, so it never belongs on this
    // grader-facing landing tab.
    const assessments = (
      await deps.assessment.findMany({ where: { courseId: { in: courseIds } } })
    ).filter((a) => a.type === "ASSIGNMENT");
    if (assessments.length === 0) return [];

    const enrolments = await deps.enrolment.findMany({ where: { cohortId: input.cohortId } });
    const enrolmentIds = new Set(enrolments.map((e) => e.id));

    const rows: CohortGradingSummaryRow[] = [];
    for (const assessment of assessments) {
      const submissions = (
        await deps.submission.findMany({ where: { assessmentId: assessment.id } })
      ).filter((s) => enrolmentIds.has(s.enrolmentId) && s.uploadStatus === "READY");

      const grades = (
        await deps.grade.findMany({ where: { assessmentId: assessment.id } })
      ).filter((g) => enrolmentIds.has(g.enrolmentId));

      const gradedSubmissionIds = new Set(grades.map((g) => g.submissionId).filter((id): id is string => !!id));
      const pendingCount = submissions.filter((s) => !gradedSubmissionIds.has(s.id)).length;
      const draftCount = grades.filter((g) => g.status === "DRAFT").length;
      const releasedCount = grades.filter((g) => g.status === "RELEASED").length;

      rows.push({ assessmentId: assessment.id, title: assessment.title, pendingCount, draftCount, releasedCount });
    }
    return rows;
  });

  // -------------------------------------------------------------------------
  // listGradingQueue — the submission queue (§7.2.1)
  // -------------------------------------------------------------------------

  const listGradingQueue = withPermission<{
    cohortId: string;
    assessmentId: string;
    status?: GradeStatusValue;
  }>("submissions.view", (input) => deps.cohortScope(input.cohortId))(
    async (input): Promise<GradingQueueRow[]> => {
      // Constrained by the enrolment's OWN cohortId — never by a
      // caller-supplied list of submission ids, which would let a crafted
      // request pull rows from another cohort even under a valid grant.
      const enrolments = await deps.enrolment.findMany({ where: { cohortId: input.cohortId } });
      const enrolmentById = new Map(enrolments.map((e) => [e.id, e]));

      const submissions = (
        await deps.submission.findMany({ where: { assessmentId: input.assessmentId } })
      ).filter((s) => enrolmentById.has(s.enrolmentId) && s.uploadStatus === "READY");

      const grades = await deps.grade.findMany({ where: { assessmentId: input.assessmentId } });
      const gradeBySubmission = new Map(
        grades.filter((g): g is GradeRow & { submissionId: string } => !!g.submissionId).map((g) => [g.submissionId, g]),
      );

      const rows: GradingQueueRow[] = [];
      for (const submission of submissions) {
        const grade = gradeBySubmission.get(submission.id) ?? null;
        const gradeStatus = grade?.status ?? null;
        if (input.status && gradeStatus !== input.status) continue;

        const enrolment = enrolmentById.get(submission.enrolmentId);
        const user = enrolment ? await deps.user.findUnique({ where: { id: enrolment.userId } }) : null;

        rows.push({
          submissionId: submission.id,
          enrolmentId: submission.enrolmentId,
          learnerName: user?.name ?? user?.email ?? "Unknown learner",
          submittedAt: submission.submittedAt,
          isLate: submission.isLate,
          attemptNumber: submission.attemptNumber,
          uploadStatus: submission.uploadStatus,
          gradeId: grade?.id ?? null,
          gradeStatus,
          score: grade?.score ?? null,
        });
      }
      return rows;
    },
  );

  // -------------------------------------------------------------------------
  // getGradingDetail — the grade-entry screen's read model (§7.2.4)
  // -------------------------------------------------------------------------

  const getGradingDetail = withPermission<{ submissionId: string }>(
    "submissions.view",
    (input) => submissionEnrolmentScope(input.submissionId),
  )(async (input): Promise<GradingDetail> => {
    const submission = await deps.submission.findUnique({ where: { id: input.submissionId } });
    if (!submission) throw new SubmissionNotFoundError(input.submissionId);

    const assessment = await deps.assessment.findUnique({ where: { id: submission.assessmentId } });
    if (!assessment) throw new SubmissionNotFoundError(input.submissionId);

    const enrolment = await deps.enrolment.findUnique({ where: { id: submission.enrolmentId } });
    const user = enrolment ? await deps.user.findUnique({ where: { id: enrolment.userId } }) : null;

    const grade = await deps.grade.findFirst({ where: { submissionId: submission.id } });
    const overrides = grade ? await deps.gradeOverride.findMany({ where: { gradeId: grade.id } }) : [];

    const priorSubmissions = (
      await deps.submission.findMany({
        where: { assessmentId: submission.assessmentId, enrolmentId: submission.enrolmentId },
      })
    )
      .slice()
      .sort((a, b) => b.attemptNumber - a.attemptNumber);

    return {
      submission,
      learnerName: user?.name ?? user?.email ?? "Unknown learner",
      isLate: submission.isLate,
      attemptNumber: submission.attemptNumber,
      uploadStatus: submission.uploadStatus,
      downloadRef: submission.storageKey,
      grade,
      priorSubmissions,
      overrides,
      cohortId: enrolment?.cohortId ?? "",
      assessment: {
        id: assessment.id,
        title: assessment.title,
        totalMarks: assessment.totalMarks,
        passMark: assessment.passMark,
      },
    };
  });

  // -------------------------------------------------------------------------
  // saveDraftGrade — invisible to learners until released (T-10-04)
  // -------------------------------------------------------------------------

  const saveDraftGrade = withPermission<{
    submissionId: string;
    score: number;
    feedback: string | null;
  }>("grades.manage", (input) => submissionEnrolmentScope(input.submissionId))(
    async (input, ctx): Promise<GradeRow> => {
      const submission = await deps.submission.findUnique({ where: { id: input.submissionId } });
      if (!submission) throw new SubmissionNotFoundError(input.submissionId);

      const assessment = await deps.assessment.findUnique({ where: { id: submission.assessmentId } });
      if (!assessment) throw new SubmissionNotFoundError(input.submissionId);

      const existing = await deps.grade.findFirst({ where: { submissionId: submission.id } });
      // The ordinary draft-save path refuses a RELEASED grade BEFORE any
      // write — do NOT silently downgrade to an override (rule 2 in this
      // file's header).
      if (existing && existing.status === "RELEASED") {
        throw new GradeAlreadyReleasedError(existing.id);
      }

      const maxScore = assessment.totalMarks ?? 0;
      if (!Number.isInteger(input.score) || input.score < 0 || input.score > maxScore) {
        throw new InvalidScoreError(input.score, maxScore);
      }

      const passed = assessment.passMark === null ? null : input.score >= assessment.passMark;
      const nowValue = now();

      const data = {
        score: input.score,
        maxScore,
        passed,
        feedback: input.feedback,
        status: "DRAFT",
        gradedById: ctx.actor.userId,
        gradedAt: nowValue,
        releasedById: null,
        releasedAt: null,
      };

      let after: GradeRow;
      if (existing) {
        try {
          // Atomic predicate closes the read/write race with a staff release.
          // A released row cannot be rewritten or downgraded to a draft.
          after = await deps.grade.update({ where: { id: existing.id, status: "DRAFT" }, data });
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
            throw new GradeAlreadyReleasedError(existing.id);
          }
          throw error;
        }
      } else {
        after = await deps.grade.create({
            data: {
              ...data,
              assessmentId: submission.assessmentId,
              enrolmentId: submission.enrolmentId,
              submissionId: submission.id,
            },
          });
      }

      // No domain event — a draft grade is not a lifecycle event; nothing
      // downstream may act on it (T-10-04). A learner-facing notification
      // reading the outbox would otherwise leak an unreleased grade.
      await deps.audit({
        action: "grade.draft_saved",
        targetType: "Grade",
        targetId: after.id,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason: null,
        before: existing ? { score: existing.score, feedback: existing.feedback, status: existing.status } : null,
        after: { score: after.score, feedback: after.feedback, status: after.status },
      });

      return after;
    },
  );

  // -------------------------------------------------------------------------
  // releaseOneGrade — the shared body `releaseGrade`/`releaseGradesBatch`
  // both call, so the two write paths cannot drift.
  // -------------------------------------------------------------------------

  async function releaseOneGrade(
    tx: GradingTxClient,
    grade: GradeRow,
    actorId: string,
    nowValue: Date,
  ): Promise<GradeRow> {
    const after = await tx.grade.update({
      where: { id: grade.id },
      data: { status: "RELEASED", releasedById: actorId, releasedAt: nowValue },
    });

    // "grade.released" covers BOTH D-01's automatic quiz release AND this
    // staff release — one event type, distinguished by the `releasedBy`
    // payload marker so Phase 13's drain needs exactly one handler.
    await deps.writeEvent(tx, {
      type: "grade.released",
      payload: {
        gradeId: after.id,
        assessmentId: after.assessmentId,
        enrolmentId: after.enrolmentId,
        submissionId: after.submissionId,
        score: after.score,
        maxScore: after.maxScore,
        passed: after.passed,
        releasedBy: "STAFF",
      },
      occurredAt: nowValue,
    });

    return after;
  }

  // -------------------------------------------------------------------------
  // releaseGrade — single, explicit, attributed release
  // -------------------------------------------------------------------------

  const releaseGrade = withPermission<{ gradeId: string }>(
    "grades.manage",
    (input) => gradeEnrolmentScope(input.gradeId),
  )(async (input, ctx): Promise<GradeRow> => {
    const before = await deps.grade.findUnique({ where: { id: input.gradeId } });
    if (!before) throw new GradeNotFoundError(input.gradeId);

    // A second release is a no-op returning the existing row, never a
    // duplicate event or a duplicate audit row.
    if (before.status === "RELEASED") return before;

    const nowValue = now();
    let after!: GradeRow;
    await deps.runInTransaction(async (tx) => {
      after = await releaseOneGrade(tx, before, ctx.actor.userId, nowValue);
    });

    await deps.audit({
      action: "grade.released",
      targetType: "Grade",
      targetId: after.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: { status: before.status },
      after: { status: after.status, releasedById: after.releasedById, releasedAt: after.releasedAt },
    });

    return after;
  });

  // -------------------------------------------------------------------------
  // releaseGradesBatch — D-06, one transaction, one round trip
  // -------------------------------------------------------------------------

  const releaseGradesBatch = withPermission<{ gradeIds: string[] }>(
    "grades.manage",
    (input) => commonGradesScope(input.gradeIds),
  )(async (input, ctx): Promise<{ released: string[]; skipped: string[] }> => {
    const nowValue = now();
    const released: string[] = [];
    const skipped: string[] = [];
    const releasedRows: GradeRow[] = [];

    await deps.runInTransaction(async (tx) => {
      for (const id of input.gradeIds) {
        const grade = await tx.grade.findUnique({ where: { id } });
        // A stale client selection containing an already-released (or
        // missing) row is SKIPPED, never thrown on — the server-side skip
        // is the real safety boundary, not a client-side pre-filter
        // (§7.2.3).
        if (!grade || grade.status !== "DRAFT") {
          skipped.push(id);
          continue;
        }
        const after = await releaseOneGrade(tx, grade, ctx.actor.userId, nowValue);
        released.push(after.id);
        releasedRows.push(after);
      }
    });

    // One audit row per released grade — RPT-05's audit export sees the
    // same per-grade granularity a single release produces — plus one
    // batch-level entry carrying the released/skipped counts.
    for (const row of releasedRows) {
      await deps.audit({
        action: "grade.released",
        targetType: "Grade",
        targetId: row.id,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason: null,
        before: { status: "DRAFT" },
        after: { status: row.status, releasedById: row.releasedById, releasedAt: row.releasedAt },
      });
    }

    await deps.audit({
      action: "grade.released_batch",
      targetType: "Grade",
      targetId: null,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: null,
      after: { releasedCount: released.length, skippedCount: skipped.length, released, skipped },
    });

    return { released, skipped };
  });

  return {
    listCohortGradingSummary,
    listGradingQueue,
    getGradingDetail,
    saveDraftGrade,
    releaseGrade,
    releaseGradesBatch,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

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

const built = createGradingService({
  grade: prisma.grade as unknown as GradingServiceDeps["grade"],
  submission: prisma.submission as unknown as GradingServiceDeps["submission"],
  assessment: prisma.assessment as unknown as GradingServiceDeps["assessment"],
  enrolment: prisma.enrolment as unknown as GradingServiceDeps["enrolment"],
  user: prisma.user as unknown as GradingServiceDeps["user"],
  cohort: prisma.cohort as unknown as GradingServiceDeps["cohort"],
  cohortCourse: prisma.cohortCourse as unknown as GradingServiceDeps["cohortCourse"],
  gradeOverride: prisma.gradeOverride as unknown as GradingServiceDeps["gradeOverride"],
  audit: liveAudit,
  writeEvent: writeDomainEvent,
  runInTransaction: (fn) => (prisma as AnyPrisma).$transaction((tx: unknown) => fn(tx as GradingTxClient)),
  // Bound to `enrolmentCohortScope`/`cohortResourceScope` — the existing
  // D-21 resolvers, reused unmodified (this file's header rule 1).
  enrolmentScope: enrolmentCohortScope,
  cohortScope: cohortResourceScope,
  withPermission: liveWithPermission,
});

export const listCohortGradingSummary = built.listCohortGradingSummary;
export const listGradingQueue = built.listGradingQueue;
export const getGradingDetail = built.getGradingDetail;
export const saveDraftGrade = built.saveDraftGrade;
export const releaseGrade = built.releaseGrade;
export const releaseGradesBatch = built.releaseGradesBatch;

/**
 * Best-effort actor-name lookup for the grade-entry screen's override
 * history (`10-UI-SPEC.md` §6.1's "by {actorName}" copy) — supplementary
 * display data, not an authorization gate, mirroring
 * `payment-read-service.ts`'s own refund-actor-name lookup and
 * `learner-results-service.ts`'s identical override-actor resolution.
 * Not routed through `withPermission`: the caller already proved
 * `submissions.view`/`grades.manage` scope over the grade whose overrides
 * these ids came from, and a staff member's own name is not sensitive.
 */
export async function resolveActorNames(actorIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(actorIds)];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } } });
  return new Map(users.map((u) => [u.id, u.name]));
}
