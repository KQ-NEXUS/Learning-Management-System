/**
 * Plan 10-07: the grading service (ASM-05) — Cohort-scope denial, draft
 * invisibility to the outbox, explicit attributed release, and D-06's
 * all-or-nothing batch authorization.
 *
 * Driven by an in-memory staged-commit fake plus a harness-built
 * `withPermission` (`createTestWithPermission`), exactly like
 * `attendance-service.test.ts`. The REAL `createCohortScopeResolvers` and
 * the REAL `writeDomainEvent` run against the fakes, so
 * `enrolmentCohortScope`'s three-key resolution is proven, not stubbed out.
 */

import { describe, expect, it } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { writeDomainEvent } from "@/server/services/domain-event-service";
import { createCohortScopeResolvers } from "@/server/services/cohort-scope";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  BatchTooLargeError,
  createGradingService,
  GradeAlreadyReleasedError,
  MAX_BATCH_RELEASE,
  type AssessmentRow,
  type CohortCourseRow,
  type EnrolmentRow,
  type GradeRow,
  type SubmissionRow,
  type UserRow,
} from "@/server/services/grading-service";

const NOW = new Date("2026-03-01T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type CohortRow = { id: string; programmeId: string | null; courseId: string | null };

function cohort(over: Partial<CohortRow> & { id: string }): CohortRow {
  return { programmeId: null, courseId: null, ...over };
}

function enr(over: Partial<EnrolmentRow> & { id: string; cohortId: string }): EnrolmentRow {
  return { userId: `user-${over.id}`, ...over };
}

function user(over: Partial<UserRow> & { id: string }): UserRow {
  return { name: `Learner ${over.id}`, email: `${over.id}@fixture.test`, ...over };
}

function assessment(over: Partial<AssessmentRow> & { id: string; courseId: string }): AssessmentRow {
  return {
    type: "ASSIGNMENT",
    title: `Assessment ${over.id}`,
    totalMarks: 100,
    passMark: 50,
    ...over,
  };
}

function submission(
  over: Partial<SubmissionRow> & { id: string; assessmentId: string; enrolmentId: string },
): SubmissionRow {
  return {
    attemptNumber: 1,
    versionUsed: 1,
    submittedAt: NOW,
    isLate: false,
    storageKey: `submissions/${over.id}`,
    filename: "file.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    uploadStatus: "READY",
    ...over,
  };
}

function gradeRow(over: Partial<GradeRow> & { id: string; assessmentId: string; enrolmentId: string }): GradeRow {
  return {
    submissionId: null,
    attemptId: null,
    score: 80,
    maxScore: 100,
    passed: true,
    feedback: null,
    status: "DRAFT",
    gradedById: "grader-1",
    gradedAt: NOW,
    releasedById: null,
    releasedAt: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  cohorts?: CohortRow[];
  enrolments?: EnrolmentRow[];
  users?: UserRow[];
  assessments?: AssessmentRow[];
  submissions?: SubmissionRow[];
  grades?: GradeRow[];
  cohortCourses?: CohortCourseRow[];
  now?: Date;
}) {
  const cohorts = new Map<string, CohortRow>((opts?.cohorts ?? []).map((c) => [c.id, { ...c }]));
  const enrolments = new Map<string, EnrolmentRow>((opts?.enrolments ?? []).map((e) => [e.id, { ...e }]));
  const users = new Map<string, UserRow>((opts?.users ?? []).map((u) => [u.id, { ...u }]));
  const assessments = new Map<string, AssessmentRow>((opts?.assessments ?? []).map((a) => [a.id, { ...a }]));
  const submissions = new Map<string, SubmissionRow>((opts?.submissions ?? []).map((s) => [s.id, { ...s }]));
  const grades = new Map<string, GradeRow>((opts?.grades ?? []).map((g) => [g.id, { ...g }]));
  const cohortCourses = opts?.cohortCourses ?? [];

  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let transactionCalls = 0;
  let nextGradeId = grades.size + 1;

  const now = opts?.now ?? NOW;

  const { cohortResourceScope, enrolmentCohortScope } = createCohortScopeResolvers({
    cohort: {
      findUnique: async ({ where }) => {
        const c = cohorts.get(where.id);
        if (!c) return null;
        return {
          id: c.id,
          programmeId: c.programmeId,
          courseId: c.courseId,
          cohortCourses: cohortCourses.filter((cc) => cc.cohortId === c.id).map((cc) => ({ courseId: cc.courseId })),
        };
      },
    },
    session: { findUnique: async () => null },
    enrolment: {
      findUnique: async ({ where }) => {
        const e = enrolments.get(where.id);
        return e ? { cohortId: e.cohortId } : null;
      },
    },
  });

  function makeTx(gradesStaged: Map<string, GradeRow>, eventsStaged: Array<Record<string, unknown>>) {
    return {
      grade: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const g = gradesStaged.get(where.id);
          return g ? { ...g } : null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = gradesStaged.get(where.id);
          if (!existing) throw new Error(`no grade ${where.id}`);
          const next = { ...existing, ...data } as GradeRow;
          gradesStaged.set(where.id, next);
          return { ...next };
        },
      },
      domainEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          eventsStaged.push(data);
          return { id: `evt-${eventsStaged.length}` };
        },
      },
    };
  }

  const runInTransaction = async <R>(fn: (tx: unknown) => Promise<R>): Promise<R> => {
    transactionCalls += 1;
    const gradesStaged = new Map<string, GradeRow>([...grades].map(([k, v]) => [k, { ...v }]));
    const eventsStaged: Array<Record<string, unknown>> = [];
    const result = await fn(makeTx(gradesStaged, eventsStaged));
    for (const [k, v] of gradesStaged) grades.set(k, v);
    for (const e of eventsStaged) events.push(e);
    return result;
  };

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("grades.manage"), grant("submissions.view")],
  );

  const service = createGradingService({
    grade: {
      findUnique: async ({ where }) => {
        const g = grades.get(where.id);
        return g ? { ...g } : null;
      },
      findFirst: async ({ where }) => {
        const found = [...grades.values()].find((g) => g.submissionId === where.submissionId);
        return found ? { ...found } : null;
      },
      findMany: async ({ where }) => {
        const w = where as { assessmentId?: string };
        return [...grades.values()].filter((g) => (w.assessmentId ? g.assessmentId === w.assessmentId : true)).map((g) => ({ ...g }));
      },
      create: async ({ data }) => {
        const id = `grade-${nextGradeId++}`;
        const row = { id, ...data } as GradeRow;
        grades.set(id, row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const existing = grades.get(where.id);
        if (!existing) throw new Error(`no grade ${where.id}`);
        const next = { ...existing, ...data } as GradeRow;
        grades.set(where.id, next);
        return { ...next };
      },
    },
    submission: {
      findUnique: async ({ where }) => {
        const s = submissions.get(where.id);
        return s ? { ...s } : null;
      },
      findMany: async ({ where }) => {
        const w = where as { assessmentId?: string; enrolmentId?: string };
        return [...submissions.values()]
          .filter(
            (s) =>
              (w.assessmentId ? s.assessmentId === w.assessmentId : true) &&
              (w.enrolmentId ? s.enrolmentId === w.enrolmentId : true),
          )
          .map((s) => ({ ...s }));
      },
    },
    assessment: {
      findUnique: async ({ where }) => {
        const a = assessments.get(where.id);
        return a ? { ...a } : null;
      },
      findMany: async ({ where }) => {
        const w = where as { courseId?: { in: string[] } };
        const ids = w.courseId?.in ?? [];
        return [...assessments.values()].filter((a) => ids.includes(a.courseId)).map((a) => ({ ...a }));
      },
    },
    enrolment: {
      findUnique: async ({ where }) => {
        const e = enrolments.get(where.id);
        return e ? { ...e } : null;
      },
      findMany: async ({ where }) => [...enrolments.values()].filter((e) => e.cohortId === where.cohortId).map((e) => ({ ...e })),
    },
    user: {
      findUnique: async ({ where }) => {
        const u = users.get(where.id);
        return u ? { ...u } : null;
      },
    },
    cohort: {
      findUnique: async ({ where }) => {
        const c = cohorts.get(where.id);
        return c ? { ...c } : null;
      },
    },
    cohortCourse: {
      findMany: async ({ where }) => cohortCourses.filter((cc) => cc.cohortId === where.cohortId).map((cc) => ({ ...cc })),
    },
    gradeOverride: {
      findMany: async () => [],
    },
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    writeEvent: writeDomainEvent,
    runInTransaction: runInTransaction as never,
    enrolmentScope: enrolmentCohortScope,
    cohortScope: cohortResourceScope,
    withPermission,
    now: () => now,
  });

  return {
    service,
    grades,
    events,
    audits,
    getTransactionCalls: () => transactionCalls,
  };
}

const releasedEvents = (events: Array<Record<string, unknown>>) =>
  events.filter((e) => e.type === "grade.released");

// ---------------------------------------------------------------------------
// Cohort-scope denial (D-05)
// ---------------------------------------------------------------------------

describe("Cohort-scope denial", () => {
  const cohortA = cohort({ id: "coh-a", courseId: "course-a" });
  const cohortB = cohort({ id: "coh-b", courseId: "course-b" });
  const enrA = enr({ id: "enr-a", cohortId: "coh-a" });
  const enrB = enr({ id: "enr-b", cohortId: "coh-b" });
  const asgA = assessment({ id: "asg-a", courseId: "course-a" });
  const asgB = assessment({ id: "asg-b", courseId: "course-b" });
  const subA = submission({ id: "sub-a", assessmentId: "asg-a", enrolmentId: "enr-a" });
  const subB = submission({ id: "sub-b", assessmentId: "asg-b", enrolmentId: "enr-b" });

  it("a COHORT-scoped grant for Cohort A allows saveDraftGrade on Cohort A's submission", async () => {
    const h = harness({
      grants: [grant("grades.manage", "COHORT", "coh-a")],
      cohorts: [cohortA, cohortB],
      enrolments: [enrA, enrB],
      assessments: [asgA, asgB],
      submissions: [subA, subB],
    });

    const result = await h.service.saveDraftGrade({ submissionId: "sub-a", score: 70, feedback: null });
    expect(result.status).toBe("DRAFT");
  });

  it("the same COHORT-A grant throws AuthorizationError for a Cohort B submission — a denial, not a filtered result", async () => {
    const h = harness({
      grants: [grant("grades.manage", "COHORT", "coh-a")],
      cohorts: [cohortA, cohortB],
      enrolments: [enrA, enrB],
      assessments: [asgA, asgB],
      submissions: [subA, subB],
    });

    await expect(
      h.service.saveDraftGrade({ submissionId: "sub-b", score: 70, feedback: null }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a PROGRAMME-scoped grant covering both cohorts allows both — proving the three-key resolution, not a bespoke cohortId check", async () => {
    const progCohortA = cohort({ id: "coh-a", programmeId: "prog-1" });
    const progCohortB = cohort({ id: "coh-b", programmeId: "prog-1" });
    const h = harness({
      grants: [grant("grades.manage", "PROGRAMME", "prog-1")],
      cohorts: [progCohortA, progCohortB],
      cohortCourses: [
        { cohortId: "coh-a", courseId: "course-a" },
        { cohortId: "coh-b", courseId: "course-b" },
      ],
      enrolments: [enrA, enrB],
      assessments: [asgA, asgB],
      submissions: [subA, subB],
    });

    await expect(h.service.saveDraftGrade({ submissionId: "sub-a", score: 70, feedback: null })).resolves.toMatchObject({
      status: "DRAFT",
    });
    await expect(h.service.saveDraftGrade({ submissionId: "sub-b", score: 70, feedback: null })).resolves.toMatchObject({
      status: "DRAFT",
    });
  });

  it("listGradingQueue for Cohort A never returns a row whose enrolment is in Cohort B, even when passed Cohort B's assessmentId", async () => {
    const h = harness({
      grants: [grant("grades.manage", "GLOBAL"), grant("submissions.view", "GLOBAL")],
      cohorts: [cohortA, cohortB],
      enrolments: [enrA, enrB],
      users: [user({ id: "user-enr-a" })],
      assessments: [asgA, asgB],
      submissions: [subA, subB],
    });

    const rows = await h.service.listGradingQueue({ cohortId: "coh-a", assessmentId: "asg-b" });
    expect(rows).toHaveLength(0);

    const ownRows = await h.service.listGradingQueue({ cohortId: "coh-a", assessmentId: "asg-a" });
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0].learnerName).toBe("Learner user-enr-a");
  });

  it("listCohortGradingSummary returns no row for a QUIZ-type Assessment", async () => {
    const quiz = assessment({ id: "quiz-a", courseId: "course-a", type: "QUIZ" });
    const h = harness({
      grants: [grant("submissions.view", "GLOBAL")],
      cohorts: [cohortA],
      enrolments: [enrA],
      assessments: [quiz],
      submissions: [],
    });

    const rows = await h.service.listCohortGradingSummary({ cohortId: "coh-a" });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Draft invisibility (T-10-04)
// ---------------------------------------------------------------------------

describe("saveDraftGrade — draft invisibility and validation", () => {
  const cohortA = cohort({ id: "coh-a", courseId: "course-a" });
  const enrA = enr({ id: "enr-a", cohortId: "coh-a" });
  const asgA = assessment({ id: "asg-a", courseId: "course-a", totalMarks: 100, passMark: 50 });
  const subA = submission({ id: "sub-a", assessmentId: "asg-a", enrolmentId: "enr-a" });

  it("writes status DRAFT, releasedById/releasedAt null, and NO domain event", async () => {
    const h = harness({ cohorts: [cohortA], enrolments: [enrA], assessments: [asgA], submissions: [subA] });

    const result = await h.service.saveDraftGrade({ submissionId: "sub-a", score: 60, feedback: "Good work" });

    expect(result.status).toBe("DRAFT");
    expect(result.releasedById).toBeNull();
    expect(result.releasedAt).toBeNull();
    expect(h.events).toHaveLength(0);
  });

  it("throws GradeAlreadyReleasedError on a RELEASED grade and never calls the delegate's update", async () => {
    const released = gradeRow({
      id: "grade-1",
      assessmentId: "asg-a",
      enrolmentId: "enr-a",
      submissionId: "sub-a",
      status: "RELEASED",
      score: 90,
    });
    const h = harness({
      cohorts: [cohortA],
      enrolments: [enrA],
      assessments: [asgA],
      submissions: [subA],
      grades: [released],
    });

    await expect(
      h.service.saveDraftGrade({ submissionId: "sub-a", score: 40, feedback: "changed" }),
    ).rejects.toBeInstanceOf(GradeAlreadyReleasedError);

    // Never written: the stored grade is unchanged.
    expect(h.grades.get("grade-1")?.score).toBe(90);
    expect(h.grades.get("grade-1")?.feedback).toBeNull();
  });

  it("refuses a score above maxScore before any write", async () => {
    const h = harness({ cohorts: [cohortA], enrolments: [enrA], assessments: [asgA], submissions: [subA] });

    await expect(h.service.saveDraftGrade({ submissionId: "sub-a", score: 150, feedback: null })).rejects.toThrow();
    expect(h.grades.size).toBe(0);
  });

  it("refuses a score below 0 before any write", async () => {
    const h = harness({ cohorts: [cohortA], enrolments: [enrA], assessments: [asgA], submissions: [subA] });

    await expect(h.service.saveDraftGrade({ submissionId: "sub-a", score: -1, feedback: null })).rejects.toThrow();
    expect(h.grades.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// releaseGrade — explicit, attributed, single release
// ---------------------------------------------------------------------------

describe("releaseGrade", () => {
  const cohortA = cohort({ id: "coh-a", courseId: "course-a" });
  const enrA = enr({ id: "enr-a", cohortId: "coh-a" });

  it("sets status RELEASED, releasedById to the acting staff user, releasedAt to now; writes one grade.released event with releasedBy STAFF and one audit row", async () => {
    const draft = gradeRow({ id: "grade-1", assessmentId: "asg-a", enrolmentId: "enr-a", status: "DRAFT" });
    const h = harness({ cohorts: [cohortA], enrolments: [enrA], grades: [draft] });

    const after = await h.service.releaseGrade({ gradeId: "grade-1" });

    expect(after.status).toBe("RELEASED");
    expect(after.releasedById).toBe("user-1");
    expect(after.releasedAt).toEqual(NOW);

    const events = releasedEvents(h.events);
    expect(events).toHaveLength(1);
    expect((events[0].payload as Record<string, unknown>).releasedBy).toBe("STAFF");

    const releaseAudits = h.audits.filter((a) => a.action === "grade.released");
    expect(releaseAudits).toHaveLength(1);
  });

  it("on an already-RELEASED grade is a no-op: no second event, no second audit row", async () => {
    const already = gradeRow({
      id: "grade-1",
      assessmentId: "asg-a",
      enrolmentId: "enr-a",
      status: "RELEASED",
      releasedById: "some-other-staff",
      releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const h = harness({ cohorts: [cohortA], enrolments: [enrA], grades: [already] });

    const after = await h.service.releaseGrade({ gradeId: "grade-1" });

    expect(after.releasedById).toBe("some-other-staff");
    expect(h.events).toHaveLength(0);
    expect(h.audits.filter((a) => a.action === "grade.released")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// releaseGradesBatch — D-06
// ---------------------------------------------------------------------------

describe("releaseGradesBatch", () => {
  const cohortA = cohort({ id: "coh-a", courseId: "course-a" });
  const cohortB = cohort({ id: "coh-b", courseId: "course-b" });
  const enrA = enr({ id: "enr-a", cohortId: "coh-a" });
  const enrA2 = enr({ id: "enr-a2", cohortId: "coh-a" });
  const enrA3 = enr({ id: "enr-a3", cohortId: "coh-a" });
  const enrB = enr({ id: "enr-b", cohortId: "coh-b" });

  it("releases all three DRAFT grades, writes three grade.released events, three per-grade audit rows plus one grade.released_batch entry, and reports all three in released", async () => {
    const grades = [
      gradeRow({ id: "g1", assessmentId: "asg-a", enrolmentId: "enr-a", status: "DRAFT" }),
      gradeRow({ id: "g2", assessmentId: "asg-a", enrolmentId: "enr-a2", status: "DRAFT" }),
      gradeRow({ id: "g3", assessmentId: "asg-a", enrolmentId: "enr-a3", status: "DRAFT" }),
    ];
    const h = harness({ cohorts: [cohortA], enrolments: [enrA, enrA2, enrA3], grades });

    const result = await h.service.releaseGradesBatch({ gradeIds: ["g1", "g2", "g3"] });

    expect(result.released).toEqual(["g1", "g2", "g3"]);
    expect(result.skipped).toEqual([]);
    expect(releasedEvents(h.events)).toHaveLength(3);
    expect(h.audits.filter((a) => a.action === "grade.released")).toHaveLength(3);
    expect(h.audits.filter((a) => a.action === "grade.released_batch")).toHaveLength(1);
  });

  it("releases two DRAFT and skips one already-RELEASED, writing no event for the skipped one", async () => {
    const grades = [
      gradeRow({ id: "g1", assessmentId: "asg-a", enrolmentId: "enr-a", status: "DRAFT" }),
      gradeRow({ id: "g2", assessmentId: "asg-a", enrolmentId: "enr-a2", status: "DRAFT" }),
      gradeRow({
        id: "g3",
        assessmentId: "asg-a",
        enrolmentId: "enr-a3",
        status: "RELEASED",
        releasedById: "someone",
        releasedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ];
    const h = harness({ cohorts: [cohortA], enrolments: [enrA, enrA2, enrA3], grades });

    const result = await h.service.releaseGradesBatch({ gradeIds: ["g1", "g2", "g3"] });

    expect(result.released.sort()).toEqual(["g1", "g2"]);
    expect(result.skipped).toEqual(["g3"]);
    expect(releasedEvents(h.events)).toHaveLength(2);
  });

  it("throws AuthorizationError and releases NOTHING when ids span a cohort the grant does not cover", async () => {
    const grades = [
      gradeRow({ id: "g1", assessmentId: "asg-a", enrolmentId: "enr-a", status: "DRAFT" }),
      gradeRow({ id: "g2", assessmentId: "asg-b", enrolmentId: "enr-b", status: "DRAFT" }),
    ];
    const h = harness({
      grants: [grant("grades.manage", "COHORT", "coh-a")],
      cohorts: [cohortA, cohortB],
      enrolments: [enrA, enrB],
      grades,
    });

    await expect(h.service.releaseGradesBatch({ gradeIds: ["g1", "g2"] })).rejects.toBeInstanceOf(AuthorizationError);

    expect(h.grades.get("g1")?.status).toBe("DRAFT");
    expect(h.grades.get("g2")?.status).toBe("DRAFT");
    expect(h.events).toHaveLength(0);
  });

  it("refuses a batch larger than MAX_BATCH_RELEASE before any write", async () => {
    const tooMany = Array.from({ length: MAX_BATCH_RELEASE + 1 }, (_, i) => `g${i}`);
    const h = harness({ cohorts: [cohortA], enrolments: [enrA] });

    await expect(h.service.releaseGradesBatch({ gradeIds: tooMany })).rejects.toBeInstanceOf(BatchTooLargeError);
    expect(h.getTransactionCalls()).toBe(0);
  });

  it("performs all batch writes inside exactly one transaction", async () => {
    const grades = [
      gradeRow({ id: "g1", assessmentId: "asg-a", enrolmentId: "enr-a", status: "DRAFT" }),
      gradeRow({ id: "g2", assessmentId: "asg-a", enrolmentId: "enr-a2", status: "DRAFT" }),
    ];
    const h = harness({ cohorts: [cohortA], enrolments: [enrA, enrA2], grades });

    await h.service.releaseGradesBatch({ gradeIds: ["g1", "g2"] });

    expect(h.getTransactionCalls()).toBe(1);
  });
});
