/**
 * Learner quiz attempt state machine — start/resume, the D-08 snapshot
 * freeze, and in-progress answer saving (ASM-01, ASM-02).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-15 — ZERO PERMISSION-WRAPPED EXPORTS IN THIS FILE.
 * ─────────────────────────────────────────────────────────────────────────────
 * `startAttempt`, `saveAttemptAnswers`, `getOwnAttempt` and `listOwnAttempts`
 * are ownership-scoped — like `lesson-progress-service.ts` and
 * `checkout-service.ts`'s `getOwnOrder`, authorization here is an ownership
 * comparison (the enrolment is re-derived from `actor.userId`), not a
 * permission check. This file imports no permission
 * wrapper — that is deliberate, not an oversight. The closed 36-identifier
 * permission catalogue has no attempt-specific entry, and importing one here
 * would pull the permission choke point onto the
 * learner request closure — exactly what `tests/learning-phase-invariants.test.ts`
 * already gates for `lesson-progress-service.ts` and plan 10-17 will gate for
 * this file. An optional enrolmentId disambiguates multiple owned enrolments;
 * it is matched only within actor.userId's ACTIVE enrolments, never trusted
 * as proof of ownership (T-10-02).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D-08 — THE FROZEN SNAPSHOT, NOT THE LIVE ROWS, IS THE SOURCE OF TRUTH.
 * ─────────────────────────────────────────────────────────────────────────────
 * `QuizQuestion` and `QuizOption` are plain mutable rows with no version
 * stamp. `startAttempt` is the ONE place the live question/option set is ever
 * read for a learner attempt — it is copied into `Attempt.answers` at start
 * time (`questionSnapshot`, alongside `passMark` and `totalMarks`, frozen for
 * the identical reason) and never re-read from the live rows again.
 * `saveAttemptAnswers` writes only the `responses` key of that payload; the
 * frozen fields are immutable after start. This is what makes ASM-01's "an
 * attempt uses the assigned version" and ASM-02's "reproducible calculation"
 * true rather than merely asserted — a later edit to a question, an option's
 * `isCorrect` flag, or the assessment's `passMark`/`totalMarks` can never
 * reach an attempt already in progress or already scored. Plan 10-06's
 * scoring pass reads exclusively from this snapshot.
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { recordAudit, type BusinessAuditEvent } from "@/server/services/audit-service";
import { writeDomainEvent, type DomainEventTxClient } from "@/server/services/domain-event-service";
import {
  scoreAttempt,
  selectEffectiveAttempt,
  type QuestionSnapshot,
  type AttemptResponse,
  type AttemptScore,
  type AttemptGradingMethod,
  type EffectiveAttemptResult,
} from "@/server/services/quiz-scoring";

// ---------------------------------------------------------------------------
// The frozen snapshot payload contract — plan 10-06's scoring and plan
// 10-11's rendering both read this exact shape from `Attempt.answers`.
// `QuestionSnapshot`/`AttemptResponse` are imported as TYPES from
// `quiz-scoring.ts` rather than redeclared — a second declaration is how the
// two would drift.
// ---------------------------------------------------------------------------

export type AttemptAnswersPayload = {
  questionSnapshot: QuestionSnapshot[];
  responses: AttemptResponse[];
  passMark: number | null;
  totalMarks: number | null;
};

// ---------------------------------------------------------------------------
// Typed refusals — one class per entry point, never a raw thrown string.
// ---------------------------------------------------------------------------

/**
 * `startAttempt`'s refusal reasons. `"not-found"` covers BOTH a genuinely
 * non-existent assessment id AND an assessment the caller's enrolment simply
 * doesn't reach — the two are made indistinguishable on purpose (T-10-02),
 * so a guessed assessment id cannot be used to probe whether it exists.
 */
export class AttemptNotStartableError extends Error {
  readonly assessmentId: string;
  readonly reason:
    | "not-found"
    | "not-a-quiz"
    | "not-published"
    | "window-not-open"
    | "window-closed"
    | "attempt-limit-reached";
  readonly maxAttempts: number | null;

  constructor(
    assessmentId: string,
    reason: AttemptNotStartableError["reason"],
    maxAttempts: number | null = null,
  ) {
    super(AttemptNotStartableError.messageFor(reason, maxAttempts));
    this.name = "AttemptNotStartableError";
    this.assessmentId = assessmentId;
    this.reason = reason;
    this.maxAttempts = maxAttempts;
  }

  private static messageFor(
    reason: AttemptNotStartableError["reason"],
    maxAttempts: number | null,
  ): string {
    switch (reason) {
      case "not-found":
        return "This assessment is not part of your enrolled path.";
      case "not-a-quiz":
        return "This assessment is not a quiz.";
      case "not-published":
        return "This assessment is not yet published.";
      case "window-not-open":
        return "This assessment is not open yet.";
      case "window-closed":
        return "The window for this assessment has closed.";
      case "attempt-limit-reached":
        return maxAttempts != null
          ? `You've used all ${maxAttempts} of your attempts for this quiz.`
          : "You've used all of your attempts for this quiz.";
    }
  }
}

/** `saveAttemptAnswers`'s refusal reasons — distinct from `AttemptNotStartableError`'s, since a write to an attempt the caller can already see by id is not the same anti-enumeration surface as discovering an assessment. */
export class AttemptNotWritableError extends Error {
  readonly attemptId: string;
  readonly reason: "not-found" | "not-own" | "already-submitted" | "window-closed";

  constructor(attemptId: string, reason: AttemptNotWritableError["reason"]) {
    super(AttemptNotWritableError.messageFor(reason));
    this.name = "AttemptNotWritableError";
    this.attemptId = attemptId;
    this.reason = reason;
  }

  private static messageFor(reason: AttemptNotWritableError["reason"]): string {
    switch (reason) {
      case "not-found":
        return "This attempt could not be found.";
      case "not-own":
        return "This attempt does not belong to you.";
      case "already-submitted":
        return "This attempt has already been submitted.";
      case "window-closed":
        return "The window for this assessment has closed.";
    }
  }
}

// ---------------------------------------------------------------------------
// Injected surface — narrow structural slices, satisfied by a Prisma client
// (via the binding at the bottom of this file) and by the unit-test fakes in
// `tests/attempt-service.test.ts`.
// ---------------------------------------------------------------------------

export type QuizOptionRow = {
  id: string;
  position: number;
  label: string;
  isCorrect: boolean;
};

export type QuizQuestionRow = {
  id: string;
  position: number;
  prompt: string;
  type: "SINGLE_CHOICE" | "MULTI_CHOICE" | "TRUE_FALSE";
  marks: number;
  explanation: string | null;
  options: QuizOptionRow[];
};

/** The Assessment read this file needs, including its live questions/options for the D-08 snapshot freeze. */
export type AssessmentRow = {
  id: string;
  courseId: string;
  type: "QUIZ" | "ASSIGNMENT";
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: number;
  availableFrom: Date | null;
  availableUntil: Date | null;
  maxAttempts: number | null;
  passMark: number | null;
  totalMarks: number | null;
  /** D-02 — which Attempt's score getOwnAssessmentResult reports as effective. */
  attemptGradingMethod: AttemptGradingMethod;
  questions: QuizQuestionRow[];
};

export type AttemptRow = {
  id: string;
  assessmentId: string;
  enrolmentId: string;
  attemptNumber: number;
  versionUsed: number;
  status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED" | "EXPIRED";
  startedAt: Date;
  submittedAt: Date | null;
  answers: AttemptAnswersPayload | null;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
};

/**
 * An `AttemptRow` plus the `expired` presentation flag plan 10-11 renders the
 * UI-SPEC §0.3 provenance banner from. `getOwnAttempt`/`listOwnAttempts`
 * return this after `resolveAttemptExpiry` has had a chance to run — `expired`
 * is simply `status === "EXPIRED"`, computed once here so a caller never has
 * to repeat that comparison.
 */
export type AttemptView = AttemptRow & { expired: boolean };

/**
 * The post-submit/post-expiry result view — plan 10-11's review render and
 * plan 10-09's results page both consume this shape. Per T-10-22, the
 * `correctOptionIds`/`explanation` fields are populated ONLY here, never on
 * an in-progress `AttemptRow` read, and this type is built ONLY for
 * `SUBMITTED`/`EXPIRED` attempts.
 */
export type AttemptResultView = {
  attemptId: string;
  attemptNumber: number;
  status: AttemptRow["status"];
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  submittedAt: Date | null;
  perQuestion: Array<{
    questionId: string;
    prompt: string;
    marks: number;
    awarded: number;
    correct: boolean;
    selectedOptionIds: string[];
    optionLabels?: Record<string, string>;
    correctOptionIds: string[];
    explanation: string | null;
  }>;
  expired: boolean;
};

export type EnrolmentRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: string;
};

export type CohortRow = {
  id: string;
  courseId: string | null;
  programmeId: string | null;
};

/** Satisfied by `prisma.attempt` both outside and inside a `$transaction` callback — mirrors `resource-service.ts`'s `Delegate<T>` reuse. */
export type AttemptDelegate = {
  findMany(args: {
    where: { assessmentId: string; enrolmentId: string };
  }): Promise<AttemptRow[]>;
  findUnique(args: { where: { id: string } }): Promise<AttemptRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<AttemptRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AttemptRow>;
};

/** The non-transactional reads every entry point uses for gating, before any write enters a transaction. */
export type AttemptStore = {
  assessment: {
    findUnique(args: { where: { id: string } }): Promise<AssessmentRow | null>;
  };
  attempt: AttemptDelegate;
  enrolment: {
    findMany(args: {
      where: { userId: string; status: "ACTIVE" };
    }): Promise<EnrolmentRow[]>;
    findUnique(args: { where: { id: string } }): Promise<EnrolmentRow | null>;
  };
  cohort: {
    findUnique(args: { where: { id: string } }): Promise<CohortRow | null>;
  };
  cohortCourse: {
    findFirst(args: {
      where: { cohortId: string; courseId: string };
    }): Promise<{ id: string } | null>;
  };
};

/** Satisfied by `prisma.grade` inside a `$transaction` callback — narrow to exactly the one call this file makes. */
export type GradeDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
};

/** The transactional surface `startAttempt`/`submitAttempt`/`resolveAttemptExpiry`'s write paths run against. */
export type AttemptTxClient = DomainEventTxClient & {
  attempt: AttemptDelegate;
  grade: GradeDelegate;
};

type Audit = (event: BusinessAuditEvent) => Promise<void>;

export type AttemptServiceDeps = {
  store: AttemptStore;
  runInTransaction: <R>(fn: (tx: AttemptTxClient) => Promise<R>) => Promise<R>;
  writeEvent: typeof writeDomainEvent;
  audit: Audit;
  /** Explicit clock — never read from a client-controlled value. */
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * True for a Prisma `PrismaClientKnownRequestError` with code `P2002`
 * (unique-constraint violation), duck-typed on `code` — the same convention
 * `resource-service.ts`'s own private helper uses, so this file stays free
 * of a `@prisma/client` error-class import.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** The shape `saveAttemptAnswers` falls back to when `Attempt.answers` is somehow null. */
function emptyPayload(): AttemptAnswersPayload {
  return { questionSnapshot: [], responses: [], passMark: null, totalMarks: null };
}

/**
 * The ONE discard-rule implementation `saveAttemptAnswers`, `submitAttempt`
 * and `resolveAttemptExpiry` all share — a questionId absent from the frozen
 * snapshot is dropped outright (T-10-16), and a selectedOptionId absent from
 * that question's snapshot options is dropped too. A second, drifted copy of
 * this logic is exactly what would let the submit path score something the
 * save path would have refused to persist.
 */
function mergeResponses(
  payload: AttemptAnswersPayload,
  incoming: AttemptResponse[],
): AttemptResponse[] {
  const knownQuestions = new Map(payload.questionSnapshot.map((q) => [q.id, q]));
  const mergedByQuestionId = new Map(payload.responses.map((r) => [r.questionId, r]));

  for (const response of incoming) {
    const question = knownQuestions.get(response.questionId);
    if (!question) continue;

    const knownOptionIds = new Set(question.options.map((o) => o.id));
    const selectedOptionIds = response.selectedOptionIds.filter((id) => knownOptionIds.has(id));

    mergedByQuestionId.set(response.questionId, {
      questionId: response.questionId,
      selectedOptionIds,
    });
  }

  return [...mergedByQuestionId.values()];
}

/**
 * Builds the learner-facing result view from a (now SUBMITTED/EXPIRED)
 * `AttemptRow`, the `scoreAttempt` output that produced it, and the frozen
 * payload — joining `scoreAttempt`'s per-question award against the
 * snapshot's `prompt`/`explanation`/`correctOptionIds` and the merged
 * responses' `selectedOptionIds`. T-10-22: only ever called for a
 * SUBMITTED/EXPIRED attempt, never for an in-progress one.
 */
function buildAttemptResultView(
  attempt: AttemptRow,
  attemptScore: AttemptScore,
  payload: AttemptAnswersPayload,
  mergedResponses: AttemptResponse[],
  expired: boolean,
): AttemptResultView {
  const responsesByQuestionId = new Map(mergedResponses.map((r) => [r.questionId, r]));
  const questionsById = new Map(payload.questionSnapshot.map((q) => [q.id, q]));

  const perQuestion = attemptScore.perQuestion.map((item) => {
    const question = questionsById.get(item.questionId);
    const response = responsesByQuestionId.get(item.questionId);
    return {
      questionId: item.questionId,
      prompt: question?.prompt ?? "",
      marks: item.marks,
      awarded: item.awarded,
      correct: item.correct,
      selectedOptionIds: response?.selectedOptionIds ?? [],
      optionLabels: Object.fromEntries((question?.options ?? []).map(o => [o.id, o.label])),
      correctOptionIds: question ? question.options.filter((o) => o.isCorrect).map((o) => o.id) : [],
      explanation: question?.explanation ?? null,
    };
  });

  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    score: attempt.score,
    maxScore: attempt.maxScore,
    passed: attempt.passed,
    submittedAt: attempt.submittedAt,
    perQuestion,
    expired,
  };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createAttemptService(deps: AttemptServiceDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Re-derives the actor's own ACTIVE enrolment covering `courseId`;
   * any requested ID must match that owned set (T-10-02). Mirrors
   * `learner-access.ts`'s `hasActiveEnrolmentCoveringCourse` boolean check,
   * but returns the actual row this file needs to attach an Attempt to.
   */
  async function resolveOwnEnrolmentForCourse(
    actor: Actor,
    courseId: string,
    enrolmentId?: string,
  ): Promise<EnrolmentRow | null> {
    const activeEnrolments = await deps.store.enrolment.findMany({
      where: { userId: actor.userId, status: "ACTIVE" },
    });

    for (const enrolment of activeEnrolments) {
      if (enrolmentId && enrolment.id !== enrolmentId) continue;
      const cohort = await deps.store.cohort.findUnique({ where: { id: enrolment.cohortId } });
      if (!cohort) continue;
      if (cohort.courseId === courseId) return enrolment;

      const member = await deps.store.cohortCourse.findFirst({
        where: { cohortId: cohort.id, courseId },
      });
      if (member) return enrolment;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // startAttempt — start or resume, freezing the D-08 snapshot on create
  // -------------------------------------------------------------------------

  async function startAttempt(
    actor: Actor,
    input: { assessmentId: string; startNew?: boolean; enrolmentId?: string },
  ): Promise<AttemptRow> {
    const assessment = await deps.store.assessment.findUnique({
      where: { id: input.assessmentId },
    });
    if (!assessment) {
      throw new AttemptNotStartableError(input.assessmentId, "not-found");
    }

    // Re-derived from actor.userId, never accepted from the caller (T-10-02).
    // The identical "not-found" refusal for a non-existent assessment and for
    // an assessment this actor's enrolment doesn't reach keeps a guessed
    // assessment id from confirming whether it exists.
    const enrolment = await resolveOwnEnrolmentForCourse(actor, assessment.courseId, input.enrolmentId);
    if (!enrolment) {
      throw new AttemptNotStartableError(input.assessmentId, "not-found");
    }

    if (assessment.type !== "QUIZ") {
      throw new AttemptNotStartableError(input.assessmentId, "not-a-quiz");
    }
    if (assessment.status !== "PUBLISHED") {
      throw new AttemptNotStartableError(input.assessmentId, "not-published");
    }

    const nowValue = now();
    if (assessment.availableFrom && nowValue < assessment.availableFrom) {
      throw new AttemptNotStartableError(input.assessmentId, "window-not-open");
    }
    // Per CONTEXT.md's Resolved note, availableUntil is the hard cutoff for
    // both Assessment types; dueAt never blocks anything.
    if (assessment.availableUntil && nowValue > assessment.availableUntil) {
      throw new AttemptNotStartableError(input.assessmentId, "window-closed");
    }

    const startNew = input.startNew === true;

    // Re-bound to non-null consts — TS's control-flow narrowing from the
    // `if (!assessment)`/`if (!enrolment)` guards above does not carry into
    // the nested closure below.
    const assessmentRow: AssessmentRow = assessment;
    const enrolmentRow: EnrolmentRow = enrolment;

    async function attemptWrite(): Promise<AttemptRow> {
      return deps.runInTransaction(async (tx) => {
        const existingAttempts = await tx.attempt.findMany({
          where: { assessmentId: input.assessmentId, enrolmentId: enrolmentRow.id },
        });

        const inProgress = existingAttempts.find((a) => a.status === "IN_PROGRESS");

        // Resume: return the existing attempt unchanged, no new row, no
        // attempt-limit check (resuming never consumes a new slot).
        if (inProgress && !startNew) {
          return inProgress;
        }

        // startNew: true abandons the prior IN_PROGRESS attempt inside this
        // same transaction (UI-SPEC §0.3) before creating a fresh one.
        if (inProgress && startNew) {
          await tx.attempt.update({ where: { id: inProgress.id }, data: { status: "ABANDONED" } });
        }

        // An attempt just abandoned above no longer counts toward the limit —
        // abandoning frees the slot it held. A null maxAttempts means
        // unlimited.
        const nonAbandonedCount = existingAttempts.filter((a) => {
          if (inProgress && startNew && a.id === inProgress.id) return false;
          return a.status !== "ABANDONED";
        }).length;
        if (assessmentRow.maxAttempts !== null && nonAbandonedCount >= assessmentRow.maxAttempts) {
          throw new AttemptNotStartableError(
            input.assessmentId,
            "attempt-limit-reached",
            assessmentRow.maxAttempts,
          );
        }

        // The @@unique([assessmentId, enrolmentId, attemptNumber]) constraint
        // is the race backstop if two requests land here concurrently — a
        // collision retries once below, in the same spirit as
        // resource-service.ts's PositionContentionError handling.
        const highestAttemptNumber = existingAttempts.reduce(
          (max, a) => Math.max(max, a.attemptNumber),
          0,
        );

        // The D-08 snapshot freeze — the ONE read of the live question/option
        // set for this attempt, ever. passMark and totalMarks are frozen
        // alongside it (10-RESEARCH.md Open Question 1's follow-up): a later
        // edit to either must never retroactively change whether this attempt
        // reads as passed.
        const questionSnapshot: QuestionSnapshot[] = assessmentRow.questions
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((question) => ({
            id: question.id,
            position: question.position,
            prompt: question.prompt,
            type: question.type,
            marks: question.marks,
            explanation: question.explanation,
            options: question.options
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((option) => ({
                id: option.id,
                position: option.position,
                label: option.label,
                isCorrect: option.isCorrect,
              })),
          }));

        const answers: AttemptAnswersPayload = {
          questionSnapshot,
          responses: [],
          passMark: assessmentRow.passMark,
          totalMarks: assessmentRow.totalMarks,
        };

        return tx.attempt.create({
          data: {
            assessmentId: input.assessmentId,
            enrolmentId: enrolmentRow.id,
            attemptNumber: highestAttemptNumber + 1,
            versionUsed: assessmentRow.version,
            status: "IN_PROGRESS",
            startedAt: nowValue,
            answers,
          },
        });
      });
    }

    let result: AttemptRow;
    try {
      result = await attemptWrite();
    } catch (err) {
      if (err instanceof AttemptNotStartableError) throw err;
      if (!isUniqueConstraintViolation(err)) throw err;
      result = await attemptWrite();
    }

    // No domain event at start — the outbox event fires at submit (plan
    // 10-06).
    await deps.audit({
      actorId: actor.userId,
      action: "attempt.started",
      targetType: "Attempt",
      targetId: result.id,
      outcome: "SUCCESS",
      after: { assessmentId: input.assessmentId, attemptNumber: result.attemptNumber, status: result.status },
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // saveAttemptAnswers — in-progress scratch state, never touches the frozen
  // fields
  // -------------------------------------------------------------------------

  async function saveAttemptAnswers(
    actor: Actor,
    input: { attemptId: string; responses: AttemptResponse[] },
  ): Promise<AttemptRow> {
    const attempt = await deps.store.attempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt) {
      throw new AttemptNotWritableError(input.attemptId, "not-found");
    }

    const enrolment = await deps.store.enrolment.findUnique({ where: { id: attempt.enrolmentId } });
    if (!enrolment || enrolment.userId !== actor.userId) {
      throw new AttemptNotWritableError(input.attemptId, "not-own");
    }

    if (attempt.status !== "IN_PROGRESS") {
      throw new AttemptNotWritableError(input.attemptId, "already-submitted");
    }

    // Plan 10-06's submit path handles the lazy IN_PROGRESS -> EXPIRED
    // transition; this path only refuses the write once the window is closed.
    const assessment = await deps.store.assessment.findUnique({ where: { id: attempt.assessmentId } });
    const nowValue = now();
    if (assessment?.availableUntil && nowValue > assessment.availableUntil) {
      throw new AttemptNotWritableError(input.attemptId, "window-closed");
    }

    const payload: AttemptAnswersPayload = attempt.answers ?? emptyPayload();

    // Only the `responses` key changes — questionSnapshot, passMark and
    // totalMarks are carried through byte-identical from the frozen payload,
    // never rewritten after start. `mergeResponses` is the ONE discard-rule
    // implementation this file has — `submitAttempt`/`resolveAttemptExpiry`
    // reuse it so the save path and the submit path can never drift apart.
    const updatedPayload: AttemptAnswersPayload = {
      questionSnapshot: payload.questionSnapshot,
      responses: mergeResponses(payload, input.responses),
      passMark: payload.passMark,
      totalMarks: payload.totalMarks,
    };

    // No audit entry per keystroke-level save — this is in-progress scratch
    // state, not a decision.
    return deps.runInTransaction((tx) =>
      tx.attempt.update({ where: { id: input.attemptId }, data: { answers: updatedPayload } }),
    );
  }

  // -------------------------------------------------------------------------
  // The shared submit/expire write body — submitAttempt and
  // resolveAttemptExpiry both funnel through this so the Attempt update, the
  // D-01 auto-released Grade, and the two outbox events are written exactly
  // once, identically, for both terminal transitions.
  // -------------------------------------------------------------------------

  async function applySubmission(params: {
    attempt: AttemptRow;
    payload: AttemptAnswersPayload;
    mergedResponses: AttemptResponse[];
    terminalStatus: "SUBMITTED" | "EXPIRED";
    submittedAt: Date;
  }): Promise<{ attempt: AttemptRow; attemptScore: AttemptScore }> {
    // Scoring reads ONLY the frozen snapshot passed in `params.payload` —
    // never a fresh QuizQuestion query (D-08, T-10-08).
    const attemptScore = scoreAttempt({
      questions: params.payload.questionSnapshot,
      responses: params.mergedResponses,
      passMark: params.payload.passMark,
    });

    const updatedAnswers: AttemptAnswersPayload = {
      questionSnapshot: params.payload.questionSnapshot,
      responses: params.mergedResponses,
      passMark: params.payload.passMark,
      totalMarks: params.payload.totalMarks,
    };

    const updatedAttempt = await deps.runInTransaction(async (tx) => {
      const updated = await tx.attempt.update({
        where: { id: params.attempt.id },
        data: {
          status: params.terminalStatus,
          submittedAt: params.submittedAt,
          score: attemptScore.score,
          maxScore: attemptScore.maxScore,
          passed: attemptScore.passed,
          answers: updatedAnswers,
        },
      });

      // D-01 — a quiz Grade is created already RELEASED inside this same
      // transaction. There is no staff DRAFT stage for a quiz grade because
      // there is no human judgment call to make on an objectively-scored
      // attempt. gradedById/releasedById are null because no staff member
      // acted, NOT a bug — do not "fix" these to the learner's id.
      const grade = await tx.grade.create({
        data: {
          assessmentId: params.attempt.assessmentId,
          enrolmentId: params.attempt.enrolmentId,
          attemptId: params.attempt.id,
          score: attemptScore.score,
          maxScore: attemptScore.maxScore,
          passed: attemptScore.passed,
          submissionId: null,
          status: "RELEASED",
          gradedById: null,
          gradedAt: params.submittedAt,
          releasedById: null,
          releasedAt: params.submittedAt,
        },
      });

      await deps.writeEvent(tx, {
        // Always "attempt.submitted" regardless of terminalStatus — the
        // closed DomainEventType union documents this: the type fires when
        // an Attempt transitions to SUBMITTED OR EXPIRED, distinguished by
        // the payload's `status`, not by a second event type.
        type: "attempt.submitted",
        payload: {
          attemptId: params.attempt.id,
          assessmentId: params.attempt.assessmentId,
          enrolmentId: params.attempt.enrolmentId,
          attemptNumber: params.attempt.attemptNumber,
          status: params.terminalStatus,
        },
        occurredAt: params.submittedAt,
      });

      await deps.writeEvent(tx, {
        type: "grade.released",
        payload: {
          gradeId: grade.id,
          assessmentId: params.attempt.assessmentId,
          enrolmentId: params.attempt.enrolmentId,
          attemptId: params.attempt.id,
          score: attemptScore.score,
          maxScore: attemptScore.maxScore,
          passed: attemptScore.passed,
          // Distinguishes this automatic quiz release from a staff release —
          // Phase 11/13 both drain grade.released and need to tell the two
          // apart without a second event type.
          releasedBy: "SYSTEM_AUTO",
        },
        occurredAt: params.submittedAt,
      });

      return updated;
    });

    return { attempt: updatedAttempt, attemptScore };
  }

  // -------------------------------------------------------------------------
  // submitAttempt — server-side scoring from the frozen snapshot, an
  // auto-released Grade, both outbox events, and an audit row with the
  // learner as actor (ASM-02, D-01, T-10-21)
  // -------------------------------------------------------------------------

  async function submitAttempt(
    actor: Actor,
    input: { attemptId: string; responses: AttemptResponse[] },
  ): Promise<AttemptResultView> {
    const attempt = await deps.store.attempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt) {
      throw new AttemptNotWritableError(input.attemptId, "not-found");
    }

    const enrolment = await deps.store.enrolment.findUnique({ where: { id: attempt.enrolmentId } });
    if (!enrolment || enrolment.userId !== actor.userId) {
      throw new AttemptNotWritableError(input.attemptId, "not-own");
    }

    if (attempt.status !== "IN_PROGRESS") {
      throw new AttemptNotWritableError(input.attemptId, "already-submitted");
    }

    const payload = attempt.answers ?? emptyPayload();
    const mergedResponses = mergeResponses(payload, input.responses);
    const submittedAt = now();

    const { attempt: updatedAttempt, attemptScore } = await applySubmission({
      attempt,
      payload,
      mergedResponses,
      terminalStatus: "SUBMITTED",
      submittedAt,
    });

    // The actor IS the learner — their submit action is the trigger — so
    // unlike an actorless system write, this audits with a real actor id
    // (10-RESEARCH.md Pitfall 4: the audit trail must not be skipped just
    // because no staff member clicked release).
    await deps.audit({
      actorId: actor.userId,
      action: "attempt.submitted",
      targetType: "Attempt",
      targetId: attempt.id,
      outcome: "SUCCESS",
      reason: null,
      before: { status: attempt.status, score: attempt.score },
      after: { status: updatedAttempt.status, score: updatedAttempt.score },
    });

    return buildAttemptResultView(updatedAttempt, attemptScore, payload, mergedResponses, false);
  }

  // -------------------------------------------------------------------------
  // resolveAttemptExpiry — lazy IN_PROGRESS -> EXPIRED transition on read,
  // reactive-only — resolved only when read, never by a background job or a
  // periodic sweep — mirrors completion-engine.ts's own convention
  // -------------------------------------------------------------------------

  async function resolveAttemptExpiry(actor: Actor, attemptId: string): Promise<AttemptRow | null> {
    const attempt = await deps.store.attempt.findUnique({ where: { id: attemptId } });
    if (!attempt) return null;

    const enrolment = await deps.store.enrolment.findUnique({ where: { id: attempt.enrolmentId } });
    if (!enrolment || enrolment.userId !== actor.userId) return null;

    if (attempt.status !== "IN_PROGRESS") return attempt;

    const assessment = await deps.store.assessment.findUnique({ where: { id: attempt.assessmentId } });
    const nowValue = now();
    if (!assessment?.availableUntil || nowValue <= assessment.availableUntil) return attempt;

    // Auto-submit whatever responses were already saved — mergeResponses
    // with no new input just re-derives the already-valid stored responses,
    // so this write path is byte-identical to submitAttempt's.
    const payload = attempt.answers ?? emptyPayload();
    const mergedResponses = mergeResponses(payload, []);

    const { attempt: updatedAttempt } = await applySubmission({
      attempt,
      payload,
      mergedResponses,
      terminalStatus: "EXPIRED",
      submittedAt: nowValue,
    });

    // The actor reading the stale page is still the trigger for this write —
    // same T-10-21 rationale as submitAttempt's audit, distinct action name.
    await deps.audit({
      actorId: actor.userId,
      action: "attempt.expired",
      targetType: "Attempt",
      targetId: attempt.id,
      outcome: "SUCCESS",
      reason: null,
      before: { status: attempt.status, score: attempt.score },
      after: { status: updatedAttempt.status, score: updatedAttempt.score },
    });

    return updatedAttempt;
  }

  // -------------------------------------------------------------------------
  // getOwnAttempt — ownership read, `null` on "not yours" or "does not exist"
  // -------------------------------------------------------------------------

  async function getOwnAttempt(actor: Actor, attemptId: string): Promise<AttemptView | null> {
    const resolved = await resolveAttemptExpiry(actor, attemptId);
    if (!resolved) return null;
    return { ...resolved, expired: resolved.status === "EXPIRED" };
  }

  // -------------------------------------------------------------------------
  // listOwnAttempts — attempt-history UI, newest attemptNumber first
  // -------------------------------------------------------------------------

  async function listOwnAttempts(
    actor: Actor,
    input: { assessmentId: string },
  ): Promise<AttemptView[]> {
    const assessment = await deps.store.assessment.findUnique({ where: { id: input.assessmentId } });
    if (!assessment) return [];

    const enrolment = await resolveOwnEnrolmentForCourse(actor, assessment.courseId);
    if (!enrolment) return [];

    const attempts = await deps.store.attempt.findMany({
      where: { assessmentId: input.assessmentId, enrolmentId: enrolment.id },
    });

    // A learner reloading a stale page must see the scored result, not a
    // live form — resolve any lazily-expirable IN_PROGRESS attempt before
    // returning.
    const resolved = await Promise.all(
      attempts.map(async (attempt) => {
        if (attempt.status !== "IN_PROGRESS") return attempt;
        return (await resolveAttemptExpiry(actor, attempt.id)) ?? attempt;
      }),
    );

    return resolved
      .slice()
      .sort((a, b) => b.attemptNumber - a.attemptNumber)
      .map((attempt) => ({ ...attempt, expired: attempt.status === "EXPIRED" }));
  }

  // -------------------------------------------------------------------------
  // getOwnAssessmentResult — the effective result across attempts (D-02)
  // -------------------------------------------------------------------------

  async function getOwnAssessmentResult(
    actor: Actor,
    input: { assessmentId: string; enrolmentId?: string },
  ): Promise<{
    effective: EffectiveAttemptResult | null;
    attempts: AttemptResultView[];
    attemptsRemaining: number | null;
  } | null> {
    const assessment = await deps.store.assessment.findUnique({ where: { id: input.assessmentId } });
    if (!assessment) return null;

    const enrolment = await resolveOwnEnrolmentForCourse(actor, assessment.courseId, input.enrolmentId);
    if (!enrolment) return null;

    const rawAttempts = await deps.store.attempt.findMany({
      where: { assessmentId: input.assessmentId, enrolmentId: enrolment.id },
    });

    // Resolve any stale IN_PROGRESS attempts first, so both the effective
    // result and the remaining-attempts count see up-to-date data.
    const resolvedAttempts = await Promise.all(
      rawAttempts.map(async (attempt) => {
        if (attempt.status !== "IN_PROGRESS") return attempt;
        return (await resolveAttemptExpiry(actor, attempt.id)) ?? attempt;
      }),
    );

    const effective = selectEffectiveAttempt(
      assessment.attemptGradingMethod,
      assessment.passMark,
      resolvedAttempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        score: attempt.score,
        maxScore: attempt.maxScore,
      })),
    );

    // T-10-22: only SUBMITTED/EXPIRED attempts are ever turned into a
    // AttemptResultView (which carries correctOptionIds/explanation) — an
    // ABANDONED or still-IN_PROGRESS attempt never appears here.
    const attemptViews = resolvedAttempts
      .filter((attempt) => attempt.status === "SUBMITTED" || attempt.status === "EXPIRED")
      .slice()
      .sort((a, b) => b.attemptNumber - a.attemptNumber)
      .map((attempt) => {
        const payload = attempt.answers ?? emptyPayload();
        const attemptScore = scoreAttempt({
          questions: payload.questionSnapshot,
          responses: payload.responses,
          passMark: payload.passMark,
        });
        return buildAttemptResultView(
          attempt,
          attemptScore,
          payload,
          payload.responses,
          attempt.status === "EXPIRED",
        );
      });

    // An ABANDONED attempt frees the slot it held (mirrors startAttempt's own
    // non-abandoned count) — it must not count against attemptsRemaining.
    const nonAbandonedCount = resolvedAttempts.filter((attempt) => attempt.status !== "ABANDONED").length;
    const attemptsRemaining =
      assessment.maxAttempts === null ? null : Math.max(0, assessment.maxAttempts - nonAbandonedCount);

    return { effective, attempts: attemptViews, attemptsRemaining };
  }

  return {
    startAttempt,
    saveAttemptAnswers,
    submitAttempt,
    resolveAttemptExpiry,
    getOwnAttempt,
    listOwnAttempts,
    getOwnAssessmentResult,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const liveAudit: Audit = (event) => recordAudit(event);

/**
 * Builds the attempt service against a given Prisma client. Production
 * passes the singleton; tests pass fakes for `store`/`runInTransaction`/
 * `audit` so the write logic is exercised without a database, matching
 * `lesson-progress-service.ts`'s own binding shape.
 */
export function createPrismaBackedAttemptService(client: AnyPrisma, audit: Audit = liveAudit) {
  return createAttemptService({
    store: {
      assessment: {
        findUnique: (args) =>
          client.assessment.findUnique({
            where: args.where,
            include: {
              questions: {
                orderBy: { position: "asc" },
                include: { options: { orderBy: { position: "asc" } } },
              },
            },
          }),
      },
      attempt: {
        findMany: (args) => client.attempt.findMany({ where: args.where }),
        findUnique: (args) => client.attempt.findUnique({ where: args.where }),
        create: (args) => client.attempt.create({ data: args.data }),
        update: (args) => client.attempt.update({ where: args.where, data: args.data }),
      },
      enrolment: {
        findMany: (args) => client.enrolment.findMany({ where: args.where }),
        findUnique: (args) => client.enrolment.findUnique({ where: args.where }),
      },
      cohort: {
        findUnique: (args) => client.cohort.findUnique({ where: args.where }),
      },
      cohortCourse: {
        findFirst: (args) => client.cohortCourse.findFirst({ where: args.where }),
      },
    },
    runInTransaction: (fn) => client.$transaction((tx: unknown) => fn(tx as AttemptTxClient)),
    writeEvent: writeDomainEvent,
    audit,
  });
}

const built = createPrismaBackedAttemptService(prisma);

export const startAttempt = built.startAttempt;
export const saveAttemptAnswers = built.saveAttemptAnswers;
export const submitAttempt = built.submitAttempt;
export const resolveAttemptExpiry = built.resolveAttemptExpiry;
export const getOwnAttempt = built.getOwnAttempt;
export const listOwnAttempts = built.listOwnAttempts;
export const getOwnAssessmentResult = built.getOwnAssessmentResult;
