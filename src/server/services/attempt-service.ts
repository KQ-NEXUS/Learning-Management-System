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
 * comparison (the enrolment is re-derived from `actor.userId`, never accepted
 * from the caller), not a permission check. This file imports no permission
 * wrapper — that is deliberate, not an oversight. The closed 36-identifier
 * permission catalogue has no attempt-specific entry, and importing one here
 * would pull the permission choke point onto the
 * learner request closure — exactly what `tests/learning-phase-invariants.test.ts`
 * already gates for `lesson-progress-service.ts` and plan 10-17 will gate for
 * this file. No exported function's INPUT type ever carries an
 * `enrolmentId` — the enrolment is always resolved server-side from
 * `actor.userId`, which is what closes the T-10-02 IDOR surface.
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
import type { QuestionSnapshot, AttemptResponse } from "@/server/services/quiz-scoring";

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

/** The transactional surface `startAttempt`'s write path runs against. */
export type AttemptTxClient = DomainEventTxClient & {
  attempt: AttemptDelegate;
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

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createAttemptService(deps: AttemptServiceDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Re-derives the actor's own ACTIVE enrolment covering `courseId` — never
   * accepts a caller-supplied enrolment id (T-10-02). Mirrors
   * `learner-access.ts`'s `hasActiveEnrolmentCoveringCourse` boolean check,
   * but returns the actual row this file needs to attach an Attempt to.
   */
  async function resolveOwnEnrolmentForCourse(
    actor: Actor,
    courseId: string,
  ): Promise<EnrolmentRow | null> {
    const activeEnrolments = await deps.store.enrolment.findMany({
      where: { userId: actor.userId, status: "ACTIVE" },
    });

    for (const enrolment of activeEnrolments) {
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
    input: { assessmentId: string; startNew?: boolean },
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
    const enrolment = await resolveOwnEnrolmentForCourse(actor, assessment.courseId);
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

    const payload: AttemptAnswersPayload = attempt.answers ?? {
      questionSnapshot: [],
      responses: [],
      passMark: null,
      totalMarks: null,
    };

    const knownQuestions = new Map(payload.questionSnapshot.map((q) => [q.id, q]));
    const mergedByQuestionId = new Map(payload.responses.map((r) => [r.questionId, r]));

    for (const response of input.responses) {
      // A questionId absent from the frozen snapshot is discarded outright —
      // a crafted payload cannot inject a phantom question (T-10-16).
      const question = knownQuestions.get(response.questionId);
      if (!question) continue;

      const knownOptionIds = new Set(question.options.map((o) => o.id));
      const selectedOptionIds = response.selectedOptionIds.filter((id) => knownOptionIds.has(id));

      mergedByQuestionId.set(response.questionId, {
        questionId: response.questionId,
        selectedOptionIds,
      });
    }

    // Only the `responses` key changes — questionSnapshot, passMark and
    // totalMarks are carried through byte-identical from the frozen payload,
    // never rewritten after start.
    const updatedPayload: AttemptAnswersPayload = {
      questionSnapshot: payload.questionSnapshot,
      responses: [...mergedByQuestionId.values()],
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
  // getOwnAttempt — ownership read, `null` on "not yours" or "does not exist"
  // -------------------------------------------------------------------------

  async function getOwnAttempt(actor: Actor, attemptId: string): Promise<AttemptRow | null> {
    const attempt = await deps.store.attempt.findUnique({ where: { id: attemptId } });
    if (!attempt) return null;

    // "Not mine" and "does not exist" are the SAME answer — mirrors
    // checkout-service.ts's getOwnOrder (T-10-02).
    const enrolment = await deps.store.enrolment.findUnique({ where: { id: attempt.enrolmentId } });
    if (!enrolment || enrolment.userId !== actor.userId) return null;

    return attempt;
  }

  // -------------------------------------------------------------------------
  // listOwnAttempts — attempt-history UI, newest attemptNumber first
  // -------------------------------------------------------------------------

  async function listOwnAttempts(
    actor: Actor,
    input: { assessmentId: string },
  ): Promise<AttemptRow[]> {
    const assessment = await deps.store.assessment.findUnique({ where: { id: input.assessmentId } });
    if (!assessment) return [];

    const enrolment = await resolveOwnEnrolmentForCourse(actor, assessment.courseId);
    if (!enrolment) return [];

    const attempts = await deps.store.attempt.findMany({
      where: { assessmentId: input.assessmentId, enrolmentId: enrolment.id },
    });

    return attempts.slice().sort((a, b) => b.attemptNumber - a.attemptNumber);
  }

  return { startAttempt, saveAttemptAnswers, getOwnAttempt, listOwnAttempts };
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
export const getOwnAttempt = built.getOwnAttempt;
export const listOwnAttempts = built.listOwnAttempts;
