/**
 * Plan 10-04: the learner quiz attempt state machine — start/resume with the
 * D-08 snapshot freeze (Task 2), and saveAttemptAnswers/getOwnAttempt/
 * listOwnAttempts.
 *
 * An in-memory fake store/tx — no Postgres, no `@prisma/client` import —
 * mirrors the fake-harness style `tests/lesson-progress-service.test.ts`
 * already uses. The snapshot-freeze cases mutate the fake store's live
 * `AssessmentRow` fixture AFTER `startAttempt` returns and assert the stored
 * `Attempt.answers` snapshot is unaffected — proving D-08 against the real
 * write logic, not a re-description of it.
 */

import { describe, expect, it } from "vitest";
import {
  createAttemptService,
  AttemptNotStartableError,
  AttemptNotWritableError,
  type AttemptStore,
  type AttemptTxClient,
  type AttemptDelegate,
  type AttemptRow,
  type AssessmentRow,
  type EnrolmentRow,
  type CohortRow,
  type AttemptServiceDeps,
} from "@/server/services/attempt-service";
import { writeDomainEvent } from "@/server/services/domain-event-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";

const NOW = new Date("2026-09-15T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAssessment(overrides: Partial<AssessmentRow> = {}): AssessmentRow {
  return {
    id: overrides.id ?? "assess-1",
    courseId: overrides.courseId ?? "course-1",
    type: overrides.type ?? "QUIZ",
    status: overrides.status ?? "PUBLISHED",
    version: overrides.version ?? 1,
    availableFrom: overrides.availableFrom ?? null,
    availableUntil: overrides.availableUntil ?? null,
    maxAttempts: overrides.maxAttempts === undefined ? null : overrides.maxAttempts,
    passMark: overrides.passMark === undefined ? 50 : overrides.passMark,
    totalMarks: overrides.totalMarks === undefined ? 100 : overrides.totalMarks,
    questions:
      overrides.questions ??
      [
        {
          id: "q-1",
          position: 0,
          prompt: "What is 2+2?",
          type: "SINGLE_CHOICE",
          marks: 10,
          explanation: null,
          options: [
            { id: "opt-1", position: 0, label: "3", isCorrect: false },
            { id: "opt-2", position: 1, label: "4", isCorrect: true },
          ],
        },
      ],
  };
}

function makeEnrolment(overrides: Partial<EnrolmentRow> = {}): EnrolmentRow {
  return {
    id: overrides.id ?? "enr-1",
    userId: overrides.userId ?? "learner-1",
    cohortId: overrides.cohortId ?? "cohort-1",
    status: overrides.status ?? "ACTIVE",
  };
}

function makeCohort(overrides: Partial<CohortRow> = {}): CohortRow {
  return {
    id: overrides.id ?? "cohort-1",
    courseId: overrides.courseId === undefined ? "course-1" : overrides.courseId,
    programmeId: overrides.programmeId ?? null,
  };
}

function makeAttemptRow(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: overrides.id ?? "attempt-existing-1",
    assessmentId: overrides.assessmentId ?? "assess-1",
    enrolmentId: overrides.enrolmentId ?? "enr-1",
    attemptNumber: overrides.attemptNumber ?? 1,
    versionUsed: overrides.versionUsed ?? 1,
    status: overrides.status ?? "IN_PROGRESS",
    startedAt: overrides.startedAt ?? NOW,
    submittedAt: overrides.submittedAt ?? null,
    answers:
      overrides.answers === undefined
        ? {
            questionSnapshot: [
              {
                id: "q-1",
                position: 0,
                prompt: "What is 2+2?",
                type: "SINGLE_CHOICE",
                marks: 10,
                explanation: null,
                options: [
                  { id: "opt-1", position: 0, label: "3", isCorrect: false },
                  { id: "opt-2", position: 1, label: "4", isCorrect: true },
                ],
              },
            ],
            responses: [],
            passMark: 50,
            totalMarks: 100,
          }
        : overrides.answers,
    score: overrides.score ?? null,
    maxScore: overrides.maxScore ?? null,
    passed: overrides.passed ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fake store/tx harness
// ---------------------------------------------------------------------------

type HarnessOpts = {
  assessment?: AssessmentRow | null;
  enrolments?: EnrolmentRow[];
  cohorts?: CohortRow[];
  cohortCourses?: Array<{ cohortId: string; courseId: string }>;
  attempts?: AttemptRow[];
  now?: Date;
};

function buildHarness(opts: HarnessOpts = {}) {
  const assessment = opts.assessment === undefined ? makeAssessment() : opts.assessment;
  const enrolments = opts.enrolments ?? [makeEnrolment()];
  const cohorts = opts.cohorts ?? [makeCohort()];
  const cohortCourses = opts.cohortCourses ?? [];
  const attempts: AttemptRow[] = opts.attempts ? [...opts.attempts] : [];
  const auditCalls: BusinessAuditEvent[] = [];

  const attemptDelegate: AttemptDelegate = {
    findMany: async ({ where }) =>
      attempts.filter(
        (a) => a.assessmentId === where.assessmentId && a.enrolmentId === where.enrolmentId,
      ),
    findUnique: async ({ where }) => attempts.find((a) => a.id === where.id) ?? null,
    create: async ({ data }) => {
      const row = {
        id: `attempt-${attempts.length + 1}`,
        submittedAt: null,
        score: null,
        maxScore: null,
        passed: null,
        ...data,
      } as AttemptRow;
      attempts.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = attempts.find((a) => a.id === where.id);
      if (!row) throw new Error(`Attempt ${where.id} not found`);
      Object.assign(row, data);
      return row;
    },
  };

  const store: AttemptStore = {
    assessment: {
      findUnique: async ({ where }) => (assessment && assessment.id === where.id ? assessment : null),
    },
    attempt: attemptDelegate,
    enrolment: {
      findMany: async ({ where }) =>
        enrolments.filter((e) => e.userId === where.userId && e.status === where.status),
      findUnique: async ({ where }) => enrolments.find((e) => e.id === where.id) ?? null,
    },
    cohort: {
      findUnique: async ({ where }) => cohorts.find((c) => c.id === where.id) ?? null,
    },
    cohortCourse: {
      findFirst: async ({ where }) =>
        cohortCourses.some((cc) => cc.cohortId === where.cohortId && cc.courseId === where.courseId)
          ? { id: "cc-1" }
          : null,
    },
  };

  const tx: AttemptTxClient = {
    attempt: attemptDelegate,
    domainEvent: {
      create: async () => ({}),
    },
  };

  const deps: AttemptServiceDeps = {
    store,
    runInTransaction: async (fn) => fn(tx),
    writeEvent: writeDomainEvent,
    audit: async (event) => {
      auditCalls.push(event);
    },
    now: () => opts.now ?? NOW,
  };

  return { deps, attempts, auditCalls, assessment };
}

// ---------------------------------------------------------------------------
// startAttempt
// ---------------------------------------------------------------------------

describe("startAttempt", () => {
  it("creates an IN_PROGRESS attempt with attemptNumber 1 and versionUsed equal to the assessment's version", async () => {
    const { deps, attempts, auditCalls } = buildHarness({ assessment: makeAssessment({ version: 3 }) });
    const service = createAttemptService(deps);

    const result = await service.startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" });

    expect(result.status).toBe("IN_PROGRESS");
    expect(result.attemptNumber).toBe(1);
    expect(result.versionUsed).toBe(3);
    expect(attempts).toHaveLength(1);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("attempt.started");
    expect(auditCalls[0].actorId).toBe("learner-1");
  });

  it("throws AttemptNotStartableError reason not-found for an actor with no enrolment covering the course — identical to a genuinely non-existent assessment id", async () => {
    const { deps } = buildHarness({ enrolments: [makeEnrolment({ userId: "someone-else" })] });
    const service = createAttemptService(deps);

    await expect(
      service.startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" }),
    ).rejects.toMatchObject({ reason: "not-found" });

    const { deps: deps2 } = buildHarness({ assessment: null });
    const service2 = createAttemptService(deps2);
    await expect(
      service2.startAttempt({ userId: "learner-1" }, { assessmentId: "does-not-exist" }),
    ).rejects.toMatchObject({ reason: "not-found" });
  });

  it("throws not-a-quiz for an ASSIGNMENT-type assessment", async () => {
    const { deps } = buildHarness({ assessment: makeAssessment({ type: "ASSIGNMENT" }) });
    const service = createAttemptService(deps);

    await expect(
      service.startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" }),
    ).rejects.toMatchObject({ reason: "not-a-quiz" });
  });

  it("throws not-published for a DRAFT assessment", async () => {
    const { deps } = buildHarness({ assessment: makeAssessment({ status: "DRAFT" }) });
    const service = createAttemptService(deps);

    await expect(
      service.startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" }),
    ).rejects.toMatchObject({ reason: "not-published" });
  });

  it("throws window-not-open before availableFrom, window-closed after availableUntil, and succeeds with both null", async () => {
    const before = buildHarness({
      assessment: makeAssessment({ availableFrom: new Date("2026-10-01T00:00:00.000Z") }),
    });
    await expect(
      createAttemptService(before.deps).startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" }),
    ).rejects.toMatchObject({ reason: "window-not-open" });

    const after = buildHarness({
      assessment: makeAssessment({ availableUntil: new Date("2026-09-01T00:00:00.000Z") }),
    });
    await expect(
      createAttemptService(after.deps).startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" }),
    ).rejects.toMatchObject({ reason: "window-closed" });

    const open = buildHarness({ assessment: makeAssessment({ availableFrom: null, availableUntil: null }) });
    const result = await createAttemptService(open.deps).startAttempt(
      { userId: "learner-1" },
      { assessmentId: "assess-1" },
    );
    expect(result.status).toBe("IN_PROGRESS");
  });

  it("throws attempt-limit-reached when maxAttempts is 2 and two non-abandoned attempts exist; succeeds at attempt 5 when maxAttempts is null", async () => {
    const twoUsed = buildHarness({
      assessment: makeAssessment({ maxAttempts: 2 }),
      attempts: [
        makeAttemptRow({ id: "a-1", attemptNumber: 1, status: "SUBMITTED" }),
        makeAttemptRow({ id: "a-2", attemptNumber: 2, status: "SUBMITTED" }),
      ],
    });
    await expect(
      createAttemptService(twoUsed.deps).startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" }),
    ).rejects.toMatchObject({ reason: "attempt-limit-reached" });

    const unlimited = buildHarness({
      assessment: makeAssessment({ maxAttempts: null }),
      attempts: [1, 2, 3, 4].map((n) =>
        makeAttemptRow({ id: `a-${n}`, attemptNumber: n, status: "SUBMITTED" }),
      ),
    });
    const result = await createAttemptService(unlimited.deps).startAttempt(
      { userId: "learner-1" },
      { assessmentId: "assess-1" },
    );
    expect(result.attemptNumber).toBe(5);
  });

  it("resumes an existing IN_PROGRESS attempt unchanged when startNew is not set — attempt count does not increase", async () => {
    const existing = makeAttemptRow({ id: "a-1", attemptNumber: 1, status: "IN_PROGRESS" });
    const { deps, attempts } = buildHarness({ attempts: [existing] });

    const result = await createAttemptService(deps).startAttempt(
      { userId: "learner-1" },
      { assessmentId: "assess-1" },
    );

    expect(result.id).toBe("a-1");
    expect(result.answers).toEqual(existing.answers);
    expect(attempts).toHaveLength(1);
  });

  it("flips the prior IN_PROGRESS attempt to ABANDONED and creates a new one with the next attemptNumber when startNew is true", async () => {
    const existing = makeAttemptRow({ id: "a-1", attemptNumber: 1, status: "IN_PROGRESS" });
    const { deps, attempts } = buildHarness({ attempts: [existing] });

    const result = await createAttemptService(deps).startAttempt(
      { userId: "learner-1" },
      { assessmentId: "assess-1", startNew: true },
    );

    expect(attempts.find((a) => a.id === "a-1")?.status).toBe("ABANDONED");
    expect(result.id).not.toBe("a-1");
    expect(result.attemptNumber).toBe(2);
    expect(result.status).toBe("IN_PROGRESS");
  });

  it("D-08 proof: mutating live QuizQuestion/QuizOption rows after start does not change the stored snapshot", async () => {
    const assessment = makeAssessment();
    const { deps } = buildHarness({ assessment });
    const service = createAttemptService(deps);

    const started = await service.startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" });
    const originalSnapshot = JSON.parse(JSON.stringify(started.answers!.questionSnapshot));

    // Mutate the live rows AFTER the attempt started.
    assessment.questions[0].marks = 999;
    assessment.questions[0].options[1].isCorrect = false;

    const readBack = await service.getOwnAttempt({ userId: "learner-1" }, started.id);
    expect(readBack?.answers?.questionSnapshot).toEqual(originalSnapshot);
    expect(readBack?.answers?.questionSnapshot[0].marks).toBe(10);
    expect(readBack?.answers?.questionSnapshot[0].options[1].isCorrect).toBe(true);
  });

  it("freezes passMark and totalMarks into the snapshot; mutating the assessment's live passMark afterwards does not change the stored snapshot", async () => {
    const assessment = makeAssessment({ passMark: 60, totalMarks: 100 });
    const { deps } = buildHarness({ assessment });
    const service = createAttemptService(deps);

    const started = await service.startAttempt({ userId: "learner-1" }, { assessmentId: "assess-1" });
    expect(started.answers?.passMark).toBe(60);
    expect(started.answers?.totalMarks).toBe(100);

    assessment.passMark = 999;

    const readBack = await service.getOwnAttempt({ userId: "learner-1" }, started.id);
    expect(readBack?.answers?.passMark).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// saveAttemptAnswers
// ---------------------------------------------------------------------------

describe("saveAttemptAnswers", () => {
  it("throws not-own for another user's attempt", async () => {
    const attempt = makeAttemptRow({ id: "a-1", enrolmentId: "enr-1" });
    const { deps } = buildHarness({
      attempts: [attempt],
      enrolments: [makeEnrolment({ id: "enr-1", userId: "learner-1" })],
    });
    const service = createAttemptService(deps);

    await expect(
      service.saveAttemptAnswers(
        { userId: "someone-else" },
        { attemptId: "a-1", responses: [] },
      ),
    ).rejects.toMatchObject({ reason: "not-own" });
  });

  it("throws already-submitted for a SUBMITTED attempt", async () => {
    const attempt = makeAttemptRow({ id: "a-1", status: "SUBMITTED" });
    const { deps } = buildHarness({ attempts: [attempt] });
    const service = createAttemptService(deps);

    await expect(
      service.saveAttemptAnswers({ userId: "learner-1" }, { attemptId: "a-1", responses: [] }),
    ).rejects.toMatchObject({ reason: "already-submitted" });
  });

  it("silently discards a response naming a questionId absent from the snapshot and leaves questionSnapshot byte-identical", async () => {
    const attempt = makeAttemptRow({ id: "a-1" });
    const originalSnapshot = JSON.parse(JSON.stringify(attempt.answers!.questionSnapshot));
    const { deps } = buildHarness({ attempts: [attempt] });
    const service = createAttemptService(deps);

    const updated = await service.saveAttemptAnswers(
      { userId: "learner-1" },
      { attemptId: "a-1", responses: [{ questionId: "phantom-question", selectedOptionIds: ["opt-x"] }] },
    );

    expect(updated.answers?.questionSnapshot).toEqual(originalSnapshot);
    expect(updated.answers?.responses).toEqual([]);
  });

  it("merges a valid response, discarding a selectedOptionId absent from that question's snapshot options", async () => {
    const attempt = makeAttemptRow({ id: "a-1" });
    const { deps } = buildHarness({ attempts: [attempt] });
    const service = createAttemptService(deps);

    const updated = await service.saveAttemptAnswers(
      { userId: "learner-1" },
      { attemptId: "a-1", responses: [{ questionId: "q-1", selectedOptionIds: ["opt-2", "phantom-option"] }] },
    );

    expect(updated.answers?.responses).toEqual([{ questionId: "q-1", selectedOptionIds: ["opt-2"] }]);
    expect(updated.answers?.passMark).toBe(attempt.answers?.passMark);
    expect(updated.answers?.totalMarks).toBe(attempt.answers?.totalMarks);
  });
});

// ---------------------------------------------------------------------------
// getOwnAttempt / listOwnAttempts
// ---------------------------------------------------------------------------

describe("getOwnAttempt", () => {
  it("returns null (not a throw) for another user's attempt id and for an unknown id", async () => {
    const attempt = makeAttemptRow({ id: "a-1", enrolmentId: "enr-1" });
    const { deps } = buildHarness({
      attempts: [attempt],
      enrolments: [makeEnrolment({ id: "enr-1", userId: "learner-1" })],
    });
    const service = createAttemptService(deps);

    await expect(service.getOwnAttempt({ userId: "someone-else" }, "a-1")).resolves.toBeNull();
    await expect(service.getOwnAttempt({ userId: "learner-1" }, "unknown-id")).resolves.toBeNull();
  });

  it("returns the attempt for its own owner", async () => {
    const attempt = makeAttemptRow({ id: "a-1", enrolmentId: "enr-1" });
    const { deps } = buildHarness({
      attempts: [attempt],
      enrolments: [makeEnrolment({ id: "enr-1", userId: "learner-1" })],
    });
    const service = createAttemptService(deps);

    const result = await service.getOwnAttempt({ userId: "learner-1" }, "a-1");
    expect(result?.id).toBe("a-1");
  });
});

describe("listOwnAttempts", () => {
  it("returns the actor's own attempts for one assessment, newest attemptNumber first", async () => {
    const { deps } = buildHarness({
      attempts: [
        makeAttemptRow({ id: "a-1", attemptNumber: 1, status: "SUBMITTED" }),
        makeAttemptRow({ id: "a-2", attemptNumber: 2, status: "SUBMITTED" }),
      ],
    });
    const service = createAttemptService(deps);

    const result = await service.listOwnAttempts({ userId: "learner-1" }, { assessmentId: "assess-1" });
    expect(result.map((a) => a.id)).toEqual(["a-2", "a-1"]);
  });

  it("returns an empty list for an actor with no enrolment covering the assessment's course", async () => {
    const { deps } = buildHarness({
      enrolments: [makeEnrolment({ userId: "someone-else" })],
      attempts: [makeAttemptRow({ id: "a-1" })],
    });
    const service = createAttemptService(deps);

    const result = await service.listOwnAttempts({ userId: "learner-1" }, { assessmentId: "assess-1" });
    expect(result).toEqual([]);
  });
});

describe("AttemptNotStartableError / AttemptNotWritableError", () => {
  it("are Error subclasses carrying their id and reason", () => {
    const startable = new AttemptNotStartableError("assess-1", "window-closed");
    expect(startable).toBeInstanceOf(Error);
    expect(startable.assessmentId).toBe("assess-1");
    expect(startable.message).toBe("The window for this assessment has closed.");

    const writable = new AttemptNotWritableError("attempt-1", "not-own");
    expect(writable).toBeInstanceOf(Error);
    expect(writable.attemptId).toBe("attempt-1");
  });
});
