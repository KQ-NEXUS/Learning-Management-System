/**
 * Assessment authoring (ASM-01, ASM-03).
 *
 * Base CRUD (`list`/`get`/`create`/`update`/`archive`) comes from
 * `createResourceService` — a service that re-implements scope checks,
 * permission gating or auditing is doing it wrong (`course-service.ts:5-7`).
 * What lives here on top of the factory is what it has no concept of:
 *
 *   1. Scope resolution through `createAssessmentScopeResolvers`
 *      (`assessment-scope.ts`, plan 10-01), built here from the SAME
 *      injected `delegate` the CRUD operations use — one fake in a unit
 *      test drives both, and there is no second, drifting implementation
 *      of "read the Assessment row's own courseId, never the caller's".
 *
 *   2. `saveQuizQuestions` — the nested QuizQuestion/QuizOption authoring
 *      write. Replace, not patch: `QuizQuestion`/`QuizOption` are
 *      authoring-time rows with `onDelete: Cascade` and no learner data
 *      hangs off them (learner evidence lives in `Attempt.answers`, a
 *      frozen snapshot per D-08), so delete-then-recreate inside one
 *      transaction is safe and simplest.
 *
 *   3. `publishAssessment` — a readiness-gated status transition that reads
 *      the SAME evaluator (`assessment-readiness.ts`) the authoring panel
 *      renders (T-10-14), and bumps `version` on every publish after the
 *      first (ASM-01's "published settings are versioned").
 *
 * Deliberate catalogue gap: the closed permission catalogue has
 * `assessments.create` / `assessments.edit` and no dedicated
 * Assessment-read permission — reads gate on `courses.view` instead (see
 * T-10-15 in the plan's threat model). Adding a new identifier is a
 * product decision requiring the PRD §1.3 approval path, out of this
 * plan's scope.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";
import { createAssessmentScopeResolvers, type AssessmentScopeDelegate } from "./assessment-scope";
import {
  evaluateAssessmentReadiness,
  FEEDBACK_BEHAVIOURS,
  type AssessmentReadinessInput,
} from "./assessment-readiness";
import { blockingFailures, type ReadinessItem } from "./readiness-service";

export { FEEDBACK_BEHAVIOURS } from "./assessment-readiness";

type WithPermissionFn = ReturnType<typeof createWithPermission>;

/** The Assessment columns the factory and the bespoke authoring writes touch. */
export type AssessmentRecord = {
  id: string;
  courseId: string;
  type: string;
  title: string;
  instructions: string | null;
  version: number;
  status: string;
  availableFrom: Date | null;
  availableUntil: Date | null;
  dueAt: Date | null;
  maxAttempts: number | null;
  passMark: number | null;
  totalMarks: number | null;
  attemptGradingMethod: string;
  allowedFileTypes: string[];
  maxFileSizeBytes: number | null;
  allowResubmission: boolean;
  feedbackBehaviour: string;
  createdAt: Date;
  updatedAt: Date;
};

export type QuizQuestionRecord = {
  id: string;
  assessmentId: string;
  position: number;
  prompt: string;
  type: string;
  marks: number;
  explanation: string | null;
};

export type QuizOptionRecord = {
  id: string;
  questionId: string;
  position: number;
  label: string;
  isCorrect: boolean;
};

export type QuestionOptionDraft = { label: string; isCorrect: boolean };

export type QuestionDraft = {
  prompt: string;
  type: string;
  marks: number;
  explanation?: string | null;
  options: QuestionOptionDraft[];
};

export type SaveQuizQuestionsInput = { assessmentId: string; questions: QuestionDraft[] };
export type PublishAssessmentInput = { assessmentId: string };

/** The nested tree `publishAssessment` reads to build an `AssessmentReadinessInput`. */
export type AssessmentAggregateQuestion = {
  position: number;
  prompt: string;
  type: string;
  marks: number;
  options: Array<{ position: number; label: string; isCorrect: boolean }>;
};

export type AssessmentAggregateRow = {
  id: string;
  type: string;
  title: string;
  status: string;
  version: number;
  instructions: string | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
  dueAt: Date | null;
  maxAttempts: number | null;
  passMark: number | null;
  totalMarks: number | null;
  attemptGradingMethod: string;
  feedbackBehaviour: string;
  allowedFileTypes: string[];
  maxFileSizeBytes: number | null;
  allowResubmission: boolean;
  questions: AssessmentAggregateQuestion[];
};

/**
 * The transaction client `saveQuizQuestions` and `publishAssessment` need —
 * structurally satisfied by a Prisma `tx` and by a unit-test fake, mirroring
 * `CohortPublishTx` (`cohort-service.ts`). A real Prisma `tx` satisfies
 * every field; a unit-test fake only needs to implement what the operation
 * under test calls.
 */
export type AssessmentTx = {
  assessment: {
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<AssessmentRecord>;
  };
  quizQuestion: {
    findMany(args: { where: { assessmentId: string } }): Promise<QuizQuestionRecord[]>;
    deleteMany(args: { where: { assessmentId: string } }): Promise<{ count: number }>;
    create(args: { data: Record<string, unknown> }): Promise<QuizQuestionRecord>;
  };
  quizOption: {
    create(args: { data: Record<string, unknown> }): Promise<QuizOptionRecord>;
  };
};

export type AssessmentDb = {
  $transaction: <R>(fn: (tx: AssessmentTx) => Promise<R>) => Promise<R>;
};

export type CreateAssessmentServiceDeps = {
  delegate: Delegate<AssessmentRecord>;
  aggregate: { findUnique(args: { where: { id: string } }): Promise<AssessmentAggregateRow | null> };
  db: AssessmentDb;
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
};

/** `update`/`create` refused a `feedbackBehaviour` value outside `FEEDBACK_BEHAVIOURS` — T-10-13. */
export class InvalidFeedbackBehaviourError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    super(
      `"${String(value)}" is not one of the allowed feedback behaviours (${FEEDBACK_BEHAVIOURS.join(", ")}).`,
    );
    this.name = "InvalidFeedbackBehaviourError";
    this.value = value;
  }
}

/** `saveQuizQuestions` was called for an Assessment that could not be found. */
export class AssessmentNotFoundError extends Error {
  readonly assessmentId: string;

  constructor(assessmentId: string) {
    super("This assessment could not be found.");
    this.name = "AssessmentNotFoundError";
    this.assessmentId = assessmentId;
  }
}

/** `saveQuizQuestions` was called on an Assessment whose `type` is not `QUIZ`. */
export class NotAQuizError extends Error {
  readonly assessmentId: string;

  constructor(assessmentId: string) {
    super("Questions can only be saved on a Quiz assessment.");
    this.name = "NotAQuizError";
    this.assessmentId = assessmentId;
  }
}

/**
 * A publish was refused because one or more blocking readiness items still
 * FAIL. Carries the failing items so the caller can list them, mirroring
 * `CohortReadinessRefusedError` (`cohort-service.ts`).
 */
export class AssessmentNotPublishableError extends Error {
  readonly failures: ReadinessItem[];

  constructor(failures: ReadinessItem[]) {
    super(
      `This assessment has ${failures.length} check${failures.length === 1 ? "" : "s"} ` +
        `that must pass before it can be published: ${failures.map((item) => item.label).join(", ")}.`,
    );
    this.name = "AssessmentNotPublishableError";
    this.failures = failures;
  }
}

function assertValidFeedbackBehaviour(data: Record<string, unknown>): void {
  if (!("feedbackBehaviour" in data) || data.feedbackBehaviour == null) return;
  if (!(FEEDBACK_BEHAVIOURS as readonly string[]).includes(data.feedbackBehaviour as string)) {
    throw new InvalidFeedbackBehaviourError(data.feedbackBehaviour);
  }
}

function toReadinessInput(row: AssessmentAggregateRow): AssessmentReadinessInput {
  return {
    type: row.type as "QUIZ" | "ASSIGNMENT",
    title: row.title,
    instructions: row.instructions,
    availableFrom: row.availableFrom,
    availableUntil: row.availableUntil,
    dueAt: row.dueAt,
    maxAttempts: row.maxAttempts,
    passMark: row.passMark,
    totalMarks: row.totalMarks,
    attemptGradingMethod: row.attemptGradingMethod,
    feedbackBehaviour: row.feedbackBehaviour,
    allowedFileTypes: row.allowedFileTypes,
    maxFileSizeBytes: row.maxFileSizeBytes,
    allowResubmission: row.allowResubmission,
    questions: row.questions.map((question) => ({
      position: question.position,
      prompt: question.prompt,
      type: question.type,
      marks: question.marks,
      options: question.options.map((option) => ({
        position: option.position,
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    })),
  };
}

export function createAssessmentService(deps: CreateAssessmentServiceDeps) {
  // Reuses the SAME injected `delegate` the CRUD operations use to build
  // the scope resolver — one fake drives both in a unit test, and this is
  // never a second implementation of "read the row's own courseId".
  const { assessmentCourseScope } = createAssessmentScopeResolvers({
    assessment: deps.delegate as unknown as AssessmentScopeDelegate,
  });

  const baseService = createResourceService<AssessmentRecord>({
    name: "Assessment",
    delegate: deps.delegate,
    permissions: {
      // Deliberate: the closed catalogue has no dedicated Assessment-read
      // permission. Staff who can view the Course can view its
      // Assessments — see this module's header and T-10-15.
      view: "courses.view",
      create: "assessments.create",
      edit: "assessments.edit",
    },
    toScope: assessmentCourseScope,
    withPermission: deps.withPermission,
    audit: deps.audit,
    // Default `{ status: "ARCHIVED" }` is correct — `Assessment.status` is
    // `PublicationStatus`, same as Course (D-16 precedent, no `restoreData`).
  });

  // feedbackBehaviour has no database-level constraint (a raw Prisma
  // `String` column) — validated here, before the factory's write, because
  // this is the only place the closed set is enforced (T-10-13).
  const assessmentService = {
    ...baseService,
    // `async` deliberately — a synchronous throw here would surface as a
    // thrown exception rather than a rejected Promise, breaking every
    // caller (including `.rejects.toThrow()` in tests) that expects
    // `create`/`update` to always return a Promise.
    create: async (data: Record<string, unknown>) => {
      assertValidFeedbackBehaviour(data);
      return baseService.create(data);
    },
    update: async (id: string, data: Record<string, unknown>, reason?: string) => {
      assertValidFeedbackBehaviour(data);
      return baseService.update(id, data, reason);
    },
  };

  /**
   * Replaces the Assessment's question set with the supplied drafts inside
   * one transaction, assigning `position` from array order starting at 0
   * (satisfying `@@unique([assessmentId, position])` /
   * `@@unique([questionId, position])`), and recomputes `Assessment.totalMarks`
   * as the sum of question marks in the same transaction so the derived
   * figure can never drift from the questions (UI-SPEC §7.1).
   */
  const saveQuizQuestions = deps.withPermission<SaveQuizQuestionsInput>(
    "assessments.edit",
    (input) => assessmentCourseScope(input.assessmentId),
  )(async (input, ctx) => {
    const before = await deps.delegate.findUnique({ where: { id: input.assessmentId } });
    if (!before) throw new AssessmentNotFoundError(input.assessmentId);
    if (before.type !== "QUIZ") throw new NotAQuizError(input.assessmentId);

    const totalMarks = input.questions.reduce((sum, question) => sum + question.marks, 0);

    const { beforeCount, createdQuestions } = await deps.db.$transaction(async (tx) => {
      const existing = await tx.quizQuestion.findMany({
        where: { assessmentId: input.assessmentId },
      });
      await tx.quizQuestion.deleteMany({ where: { assessmentId: input.assessmentId } });

      const created: Array<QuizQuestionRecord & { options: QuizOptionRecord[] }> = [];
      for (let i = 0; i < input.questions.length; i += 1) {
        const draft = input.questions[i];
        const question = await tx.quizQuestion.create({
          data: {
            assessmentId: input.assessmentId,
            position: i,
            prompt: draft.prompt,
            type: draft.type,
            marks: draft.marks,
            explanation: draft.explanation ?? null,
          },
        });

        const options: QuizOptionRecord[] = [];
        for (let j = 0; j < draft.options.length; j += 1) {
          const optionDraft = draft.options[j];
          const option = await tx.quizOption.create({
            data: {
              questionId: question.id,
              position: j,
              label: optionDraft.label,
              isCorrect: optionDraft.isCorrect,
            },
          });
          options.push(option);
        }

        created.push({ ...question, options });
      }

      await tx.assessment.update({
        where: { id: input.assessmentId },
        data: { totalMarks },
      });

      return { beforeCount: existing.length, createdQuestions: created };
    });

    await deps.audit({
      action: "assessment.questions_saved",
      targetType: "Assessment",
      targetId: input.assessmentId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: { questionCount: beforeCount },
      after: { questionCount: createdQuestions.length, totalMarks },
    });

    return { assessmentId: input.assessmentId, totalMarks, questions: createdQuestions };
  });

  /**
   * Loads the Assessment with its questions and options, evaluates the
   * SAME readiness function the authoring panel renders (T-10-14), and
   * refuses with `AssessmentNotPublishableError` when a blocking item still
   * FAILs — refusing BEFORE any write happens. On success, sets
   * `status: "PUBLISHED"` and bumps `version` — the first publish (current
   * `status` is not yet `PUBLISHED`) leaves `version` unchanged; every
   * publish after that increments it, because `Attempt.versionUsed` /
   * `Submission.versionUsed` stamp it (ASM-01). A single-row status/version
   * update needs no multi-table transaction, so this goes straight through
   * the same `delegate.update` the base CRUD service uses — no second write
   * path for the same column.
   */
  const publishAssessment = deps.withPermission<PublishAssessmentInput>(
    "assessments.edit",
    (input) => assessmentCourseScope(input.assessmentId),
  )(async (input, ctx) => {
    const row = await deps.aggregate.findUnique({ where: { id: input.assessmentId } });
    if (!row) throw new AssessmentNotFoundError(input.assessmentId);

    const failures = blockingFailures(evaluateAssessmentReadiness(toReadinessInput(row)));
    if (failures.length > 0) {
      throw new AssessmentNotPublishableError(failures);
    }

    const nextVersion = row.status === "PUBLISHED" ? row.version + 1 : row.version;

    const after = await deps.delegate.update({
      where: { id: input.assessmentId },
      data: { status: "PUBLISHED", version: nextVersion },
    });

    await deps.audit({
      action: "assessment.published",
      targetType: "Assessment",
      targetId: input.assessmentId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: { status: row.status, version: row.version },
      after: { status: after.status, version: after.version },
    });

    return after;
  });

  return { assessmentCourseScope, assessmentService, saveQuizQuestions, publishAssessment };
}

const built = createAssessmentService({
  delegate: prisma.assessment as unknown as Delegate<AssessmentRecord>,
  aggregate: {
    findUnique: async ({ where }) => {
      const row = await prisma.assessment.findUnique({
        where: { id: where.id },
        include: {
          questions: {
            orderBy: { position: "asc" },
            include: { options: { orderBy: { position: "asc" } } },
          },
        },
      });
      if (!row) return null;
      return row as unknown as AssessmentAggregateRow;
    },
  },
  db: {
    $transaction: (fn) => prisma.$transaction((tx) => fn(tx as unknown as AssessmentTx)),
  },
  withPermission: liveWithPermission,
  audit: (entry) =>
    recordAudit({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      outcome: entry.outcome,
    }),
});

export const assessmentService = built.assessmentService;
export const saveQuizQuestions = built.saveQuizQuestions;
export const publishAssessment = built.publishAssessment;
