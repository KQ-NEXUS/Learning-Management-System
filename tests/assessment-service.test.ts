/**
 * Plan 10-03: the Assessment authoring service.
 *
 * Driven by in-memory fake delegates plus a harness-built `withPermission`
 * (`createTestWithPermission` — COURSE-scoped or GLOBAL grants per test). No
 * real Postgres: scope denial, the publish readiness gate, version-bump
 * semantics and the nested question write are all provable against fakes.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createAssessmentService,
  AssessmentNotPublishableError,
  AssessmentNotFoundError,
  NotAQuizError,
  InvalidFeedbackBehaviourError,
  type AssessmentRecord,
  type AssessmentAggregateRow,
  type AssessmentTx,
  type QuizQuestionRecord,
  type QuizOptionRecord,
} from "@/server/services/assessment-service";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { type Delegate } from "@/server/services/resource-service";
import type { RawGrant } from "@/server/permissions/with-permission";

function makeAssessmentRow(overrides: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    id: "a1",
    courseId: "course-a",
    type: "QUIZ",
    title: "Quiz One",
    instructions: null,
    version: 1,
    status: "DRAFT",
    availableFrom: null,
    availableUntil: null,
    dueAt: null,
    maxAttempts: 3,
    passMark: 1,
    totalMarks: 1,
    attemptGradingMethod: "HIGHEST",
    allowedFileTypes: [],
    maxFileSizeBytes: null,
    allowResubmission: false,
    feedbackBehaviour: "ON_RELEASE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeValidQuizAggregate(
  overrides: Partial<AssessmentAggregateRow> = {},
): AssessmentAggregateRow {
  return {
    id: "a1",
    type: "QUIZ",
    title: "Quiz One",
    status: "DRAFT",
    version: 1,
    instructions: null,
    availableFrom: null,
    availableUntil: null,
    dueAt: null,
    maxAttempts: 3,
    passMark: 1,
    totalMarks: 1,
    attemptGradingMethod: "HIGHEST",
    feedbackBehaviour: "ON_RELEASE",
    allowedFileTypes: [],
    maxFileSizeBytes: null,
    allowResubmission: false,
    questions: [
      {
        position: 0,
        prompt: "2 + 2?",
        type: "SINGLE_CHOICE",
        marks: 1,
        options: [
          { position: 0, label: "3", isCorrect: false },
          { position: 1, label: "4", isCorrect: true },
        ],
      },
    ],
    ...overrides,
  };
}

function makeAssessmentDelegate(initial: AssessmentRecord[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let nextId = initial.length + 1;

  const delegate: Delegate<AssessmentRecord> = {
    findMany: vi.fn(async () => [...rows.values()]),
    findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `assessment-${nextId++}`,
        ...(data as Partial<AssessmentRecord>),
      } as AssessmentRecord;
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const existing = rows.get(where.id);
      if (!existing) throw new Error("not found");
      const next = { ...existing, ...(data as Partial<AssessmentRecord>) };
      rows.set(where.id, next);
      return next;
    }),
  };

  return { delegate, rows };
}

/** A minimal `AssessmentTx` fake — quizQuestion/quizOption stores keyed by
 *  assessmentId/questionId, and `assessment.update` delegating to the SAME
 *  assessment delegate so `saveQuizQuestions`' recomputed `totalMarks` is
 *  observable through the ordinary `findUnique`. */
function makeTx(assessmentDelegate: Delegate<AssessmentRecord>) {
  const questionsByAssessment = new Map<string, QuizQuestionRecord[]>();
  const optionsByQuestion = new Map<string, QuizOptionRecord[]>();
  let questionId = 1;
  let optionId = 1;

  const tx: AssessmentTx = {
    assessment: {
      update: vi.fn(async ({ where, data }) => assessmentDelegate.update({ where, data })),
    },
    quizQuestion: {
      findMany: vi.fn(async ({ where }) => questionsByAssessment.get(where.assessmentId) ?? []),
      deleteMany: vi.fn(async ({ where }) => {
        const existing = questionsByAssessment.get(where.assessmentId) ?? [];
        questionsByAssessment.delete(where.assessmentId);
        for (const question of existing) optionsByQuestion.delete(question.id);
        return { count: existing.length };
      }),
      create: vi.fn(async ({ data }) => {
        const row = {
          id: `q${questionId++}`,
          explanation: null,
          ...(data as Partial<QuizQuestionRecord>),
        } as QuizQuestionRecord;
        const list = questionsByAssessment.get(row.assessmentId) ?? [];
        list.push(row);
        questionsByAssessment.set(row.assessmentId, list);
        return row;
      }),
    },
    quizOption: {
      create: vi.fn(async ({ data }) => {
        const row = {
          id: `o${optionId++}`,
          ...(data as Partial<QuizOptionRecord>),
        } as QuizOptionRecord;
        const list = optionsByQuestion.get(row.questionId) ?? [];
        list.push(row);
        optionsByQuestion.set(row.questionId, list);
        return row;
      }),
    },
  };

  return { tx, questionsByAssessment, optionsByQuestion };
}

function harness(opts?: {
  assessmentRows?: AssessmentRecord[];
  aggregateRow?: AssessmentAggregateRow | null;
  grants?: RawGrant[];
}) {
  const { delegate, rows } = makeAssessmentDelegate(opts?.assessmentRows ?? [makeAssessmentRow()]);
  const { tx, questionsByAssessment, optionsByQuestion } = makeTx(delegate);
  const audits: Array<Record<string, unknown>> = [];
  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("assessments.create"), grant("assessments.edit"), grant("courses.view")],
  );

  const aggregateRow =
    opts && "aggregateRow" in opts ? (opts.aggregateRow ?? null) : makeValidQuizAggregate();
  const aggregate = { findUnique: vi.fn(async () => aggregateRow) };

  const built = createAssessmentService({
    delegate,
    aggregate,
    db: { $transaction: async (fn) => fn(tx) },
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
  });

  return { ...built, delegate, rows, tx, questionsByAssessment, optionsByQuestion, audits };
}

describe("assessmentService — scope (T-10-07)", () => {
  it("allows update for a COURSE-scoped grant matching the Assessment's own courseId", async () => {
    const { assessmentService } = harness({
      assessmentRows: [makeAssessmentRow({ id: "a1", courseId: "course-a" })],
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    const updated = await assessmentService.update("a1", { title: "Updated title" });
    expect(updated.title).toBe("Updated title");
  });

  it("denies update for a COURSE-scoped grant on a different course — thrown, not a filtered/empty result", async () => {
    const { assessmentService } = harness({
      assessmentRows: [makeAssessmentRow({ id: "a1", courseId: "course-b" })],
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    await expect(assessmentService.update("a1", { title: "x" })).rejects.toThrow(AuthorizationError);
  });

  it("denies update for a missing Assessment id — empty scope, never widened", async () => {
    const { assessmentService } = harness({
      assessmentRows: [],
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    await expect(assessmentService.update("missing", { title: "x" })).rejects.toThrow(
      AuthorizationError,
    );
  });
});

describe("assessmentService.create — audit", () => {
  it("writes an audit entry with action assessment.created and the actor's id", async () => {
    const { assessmentService, audits } = harness({
      assessmentRows: [],
      grants: [grant("assessments.create")],
    });

    const created = await assessmentService.create({
      courseId: "course-a",
      type: "QUIZ",
      title: "New Quiz",
    });

    expect(created.title).toBe("New Quiz");
    expect(audits[0]).toMatchObject({ action: "assessment.created", actorId: "user-1" });
  });
});

describe("assessmentService — feedbackBehaviour validation (T-10-13)", () => {
  it("rejects an invalid feedbackBehaviour on update before any write, delegate.update never called", async () => {
    const { assessmentService, delegate } = harness({
      assessmentRows: [makeAssessmentRow({ id: "a1", courseId: "course-a" })],
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    await expect(
      assessmentService.update("a1", { feedbackBehaviour: "ALWAYS" }),
    ).rejects.toThrow(InvalidFeedbackBehaviourError);
    expect(delegate.update).not.toHaveBeenCalled();
  });
});

describe("publishAssessment — readiness gate (T-10-14)", () => {
  it("throws AssessmentNotPublishableError, carrying a blocking item, and never publishes", async () => {
    const { publishAssessment, delegate } = harness({
      assessmentRows: [makeAssessmentRow({ id: "a1", courseId: "course-a" })],
      aggregateRow: makeValidQuizAggregate({
        questions: [
          {
            position: 0,
            prompt: "2 + 2?",
            type: "SINGLE_CHOICE",
            marks: 1,
            options: [
              { position: 0, label: "3", isCorrect: false },
              { position: 1, label: "4", isCorrect: false },
            ],
          },
        ],
      }),
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    const err = await publishAssessment({ assessmentId: "a1" }).catch((thrown) => thrown);
    expect(err).toBeInstanceOf(AssessmentNotPublishableError);
    expect((err as AssessmentNotPublishableError).failures.length).toBeGreaterThan(0);
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it("throws AssessmentNotFoundError when the aggregate cannot be loaded", async () => {
    const { publishAssessment } = harness({
      assessmentRows: [makeAssessmentRow({ id: "a1", courseId: "course-a" })],
      aggregateRow: null,
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    await expect(publishAssessment({ assessmentId: "a1" })).rejects.toThrow(
      AssessmentNotFoundError,
    );
  });

  it("on a valid Quiz sets status: PUBLISHED and writes an assessment.published audit entry", async () => {
    const { publishAssessment, audits } = harness({
      assessmentRows: [makeAssessmentRow({ id: "a1", courseId: "course-a", status: "DRAFT", version: 1 })],
      aggregateRow: makeValidQuizAggregate({ status: "DRAFT", version: 1 }),
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    const result = await publishAssessment({ assessmentId: "a1" });
    expect(result.status).toBe("PUBLISHED");
    expect(audits.some((entry) => entry.action === "assessment.published")).toBe(true);
  });
});

describe("publishAssessment — version bump (ASM-01)", () => {
  it("does not bump version on the very first publish", async () => {
    const { publishAssessment } = harness({
      assessmentRows: [makeAssessmentRow({ id: "a1", courseId: "course-a", status: "DRAFT", version: 1 })],
      aggregateRow: makeValidQuizAggregate({ status: "DRAFT", version: 1 }),
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    const result = await publishAssessment({ assessmentId: "a1" });
    expect(result.version).toBe(1);
  });

  it("increments version when publishing an already-published Assessment", async () => {
    const { publishAssessment } = harness({
      assessmentRows: [
        makeAssessmentRow({ id: "a1", courseId: "course-a", status: "PUBLISHED", version: 1 }),
      ],
      aggregateRow: makeValidQuizAggregate({ status: "PUBLISHED", version: 1 }),
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    const result = await publishAssessment({ assessmentId: "a1" });
    expect(result.version).toBe(2);
  });
});

describe("saveQuizQuestions — nested write", () => {
  it("assigns sequential position values from array order and recomputes totalMarks", async () => {
    const { saveQuizQuestions, delegate } = harness({
      assessmentRows: [
        makeAssessmentRow({ id: "a1", courseId: "course-a", type: "QUIZ", totalMarks: 0 }),
      ],
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    const result = await saveQuizQuestions({
      assessmentId: "a1",
      questions: [
        {
          prompt: "Q1",
          type: "SINGLE_CHOICE",
          marks: 2,
          options: [
            { label: "A", isCorrect: true },
            { label: "B", isCorrect: false },
          ],
        },
        {
          prompt: "Q2",
          type: "SINGLE_CHOICE",
          marks: 3,
          options: [
            { label: "A", isCorrect: false },
            { label: "B", isCorrect: true },
          ],
        },
      ],
    });

    expect(result.totalMarks).toBe(5);
    expect(result.questions.map((question) => question.position)).toEqual([0, 1]);

    const updated = await delegate.findUnique({ where: { id: "a1" } });
    expect(updated?.totalMarks).toBe(5);
  });

  it("on an ASSIGNMENT-type Assessment throws NotAQuizError and writes nothing", async () => {
    const { saveQuizQuestions, tx } = harness({
      assessmentRows: [
        makeAssessmentRow({ id: "a1", courseId: "course-a", type: "ASSIGNMENT" }),
      ],
      grants: [grant("assessments.edit", "COURSE", "course-a")],
    });

    await expect(
      saveQuizQuestions({ assessmentId: "a1", questions: [] }),
    ).rejects.toThrow(NotAQuizError);
    expect(tx.quizQuestion.create).not.toHaveBeenCalled();
  });
});
