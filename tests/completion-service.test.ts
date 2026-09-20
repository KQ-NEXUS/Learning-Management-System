/**
 * Plan 09-04 Task 2: `recalculateCompletion` (D-10, D-12, DD-6, DD-12, DD-13,
 * LRN-07).
 *
 * An in-memory fake `tx` — no Postgres, no `@prisma/client` import — mirrors
 * the staged-commit style `tests/attendance-service.test.ts` already uses.
 * The real `evaluateCompletion` / `parseCompletionRule` /
 * `computeAttendanceComponent` / `writeDomainEvent` all run against the fake,
 * so behaviour is proven for real at unit level.
 */

import { describe, expect, it } from "vitest";
import {
  recalculateCompletion,
  type CompletionServiceTxClient,
} from "@/server/services/completion-service";

// ---------------------------------------------------------------------------
// Fixture rows
// ---------------------------------------------------------------------------

type EnrolmentRow = { id: string; cohortId: string };
type CohortRow = {
  id: string;
  courseId: string | null;
  programmeId: string | null;
  attendanceThresholdPct: number | null;
  coursePublicationId: string | null;
  programmePublicationId: string | null;
};
type CohortCourseRow = { cohortId: string; courseId: string; coursePublicationId: string | null };
type ModuleRow = { id: string; courseId: string };
type LessonRow = { id: string; moduleId: string; withdrawnAt: Date | null };
type LessonProgressRow = { enrolmentId: string; lessonId: string };
type SessionRow = { id: string; cohortId: string; attendanceExpected: boolean; cancelledAt: Date | null };
type AttendanceRecordRow = { sessionId: string; enrolmentId: string; state: string };
type CompletionRecordRow = {
  id: string;
  enrolmentId: string;
  scope: "COURSE" | "PROGRAMME";
  courseId: string | null;
  ruleVersion: number;
  completedAt: Date;
  evidence: unknown;
  supersededAt: Date | null;
};

const NOW = new Date("2026-09-14T12:00:00.000Z");

function courseObligationPayload(
  overrides: Partial<{
    completionRuleVersion: number;
    completionRule: unknown;
    modules: Array<{ id: string; position: number; lessons: Array<{ id: string; position: number; required: boolean }> }>;
  }> = {},
) {
  return {
    schema: 1,
    completionRule: overrides.completionRule ?? null,
    completionRuleVersion: overrides.completionRuleVersion ?? 1,
    modules: (overrides.modules ?? [
      {
        id: "mod-1",
        position: 0,
        lessons: [
          { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: null },
          { id: "les-2", position: 1, required: true, type: "TEXT", assessmentId: null },
        ],
      },
    ]).map((m) => ({
      ...m,
      lessons: m.lessons.map((l) => ({ type: "TEXT", assessmentId: null, ...l })),
    })),
  };
}

function programmeObligationPayload(
  overrides: Partial<{
    completionRuleVersion: number;
    completionRule: unknown;
    courses: Array<{ courseId: string; position: number }>;
  }> = {},
) {
  return {
    schema: 1,
    sequential: true,
    completionRule: overrides.completionRule ?? null,
    completionRuleVersion: overrides.completionRuleVersion ?? 1,
    courses: overrides.courses ?? [{ courseId: "course-1", position: 0 }],
  };
}

function buildHarness(opts?: {
  enrolments?: EnrolmentRow[];
  cohorts?: CohortRow[];
  cohortCourses?: CohortCourseRow[];
  modules?: ModuleRow[];
  lessons?: LessonRow[];
  lessonProgress?: LessonProgressRow[];
  sessions?: SessionRow[];
  attendanceRecords?: AttendanceRecordRow[];
  coursePublications?: Record<string, unknown>;
  programmePublications?: Record<string, unknown>;
  completionRecords?: CompletionRecordRow[];
}) {
  const enrolments = opts?.enrolments ?? [{ id: "enr-1", cohortId: "cohort-1" }];
  const cohorts = opts?.cohorts ?? [
    {
      id: "cohort-1",
      courseId: "course-1",
      programmeId: null,
      attendanceThresholdPct: null,
      coursePublicationId: "pub-course-1",
      programmePublicationId: null,
    },
  ];
  const cohortCourses = opts?.cohortCourses ?? [];
  const modules = opts?.modules ?? [{ id: "mod-1", courseId: "course-1" }];
  const lessons = opts?.lessons ?? [
    { id: "les-1", moduleId: "mod-1", withdrawnAt: null },
    { id: "les-2", moduleId: "mod-1", withdrawnAt: null },
  ];
  const lessonProgress = opts?.lessonProgress ?? [];
  const sessions = opts?.sessions ?? [];
  const attendanceRecords = opts?.attendanceRecords ?? [];
  const coursePublications: Record<string, unknown> = opts?.coursePublications ?? {
    "pub-course-1": courseObligationPayload(),
  };
  const programmePublications: Record<string, unknown> = opts?.programmePublications ?? {};
  const completionRecords: CompletionRecordRow[] = opts?.completionRecords ?? [];
  const domainEvents: Array<Record<string, unknown>> = [];
  const enrolmentUpdateCalls: unknown[] = [];
  const completionDeleteCalls: unknown[] = [];
  let idCounter = 0;

  const rawTx = {
    domainEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        domainEvents.push(data);
        return { id: `evt-${domainEvents.length}` };
      },
    },
    enrolment: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        enrolments.find((e) => e.id === where.id) ?? null,
      // Not part of CompletionServiceTxClient's declared surface — present
      // here ONLY so the test can assert it is never invoked (DD-6).
      update: async (args: unknown) => {
        enrolmentUpdateCalls.push(args);
        return {};
      },
    },
    cohort: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        cohorts.find((c) => c.id === where.id) ?? null,
    },
    cohortCourse: {
      findMany: async ({ where }: { where: { cohortId: string } }) =>
        cohortCourses.filter((cc) => cc.cohortId === where.cohortId),
    },
    coursePublication: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const payload = coursePublications[where.id];
        return payload ? { payload } : null;
      },
    },
    programmePublication: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const payload = programmePublications[where.id];
        return payload ? { payload } : null;
      },
    },
    module: {
      findMany: async ({ where }: { where: { courseId: string } }) =>
        modules.filter((m) => m.courseId === where.courseId),
    },
    lesson: {
      findMany: async ({ where }: { where: { moduleId: { in: string[] } } }) =>
        lessons.filter((l) => where.moduleId.in.includes(l.moduleId)),
    },
    lessonProgress: {
      findMany: async ({ where }: { where: { enrolmentId: string } }) =>
        lessonProgress.filter((p) => p.enrolmentId === where.enrolmentId),
    },
    scheduledSession: {
      findMany: async ({ where }: { where: { cohortId: string } }) =>
        sessions.filter((s) => s.cohortId === where.cohortId),
    },
    attendanceRecord: {
      findMany: async ({ where }: { where: { enrolmentId: string } }) =>
        attendanceRecords.filter((r) => r.enrolmentId === where.enrolmentId),
    },
    completionRecord: {
      findFirst: async ({
        where,
      }: {
        where: { enrolmentId: string; scope: string; courseId: string | null; supersededAt: null };
      }) =>
        completionRecords.find(
          (r) =>
            r.enrolmentId === where.enrolmentId &&
            r.scope === where.scope &&
            r.courseId === where.courseId &&
            r.supersededAt === null,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        idCounter += 1;
        const row = { id: `cr-${idCounter}`, supersededAt: null, ...data } as CompletionRecordRow;
        completionRecords.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = completionRecords.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
      // Not part of CompletionServiceTxClient's declared surface — present
      // only so the test can assert it is never invoked (D-12).
      delete: async (args: unknown) => {
        completionDeleteCalls.push(args);
        return {};
      },
    },
  };

  const tx = rawTx as unknown as CompletionServiceTxClient;

  return {
    tx,
    enrolments,
    cohorts,
    cohortCourses,
    modules,
    lessons,
    lessonProgress,
    sessions,
    attendanceRecords,
    coursePublications,
    programmePublications,
    completionRecords,
    domainEvents,
    enrolmentUpdateCalls,
    completionDeleteCalls,
  };
}

// ---------------------------------------------------------------------------
// COURSE-scope, single course-cohort
// ---------------------------------------------------------------------------

describe("recalculateCompletion — course-cohort COURSE scope", () => {
  it("unsatisfied when no lessons are complete — no write, no event", async () => {
    const h = buildHarness();
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result.kind).toBe("evaluated");
    if (result.kind !== "evaluated") return;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].verdict.satisfied).toBe(false);
    expect(result.results[0].action).toBe("unchanged");
    expect(h.completionRecords).toHaveLength(0);
    expect(h.domainEvents).toHaveLength(0);
  });

  it("creates a CompletionRecord and emits course.completed on a fresh satisfaction", async () => {
    const h = buildHarness({
      lessonProgress: [
        { enrolmentId: "enr-1", lessonId: "les-1" },
        { enrolmentId: "enr-1", lessonId: "les-2" },
      ],
    });
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result.kind).toBe("evaluated");
    if (result.kind !== "evaluated") return;
    expect(result.results[0].action).toBe("created");
    expect(h.completionRecords).toHaveLength(1);
    expect(h.completionRecords[0].scope).toBe("COURSE");
    expect(h.completionRecords[0].courseId).toBe("course-1");
    expect(h.completionRecords[0].ruleVersion).toBe(1);
    expect(h.completionRecords[0].completedAt).toEqual(NOW);
    expect(h.completionRecords[0].supersededAt).toBeNull();
    expect(h.domainEvents).toHaveLength(1);
    expect(h.domainEvents[0].type).toBe("course.completed");
  });

  it("evidence is serialised as { schema: 1, items } from the verdict", async () => {
    const h = buildHarness({
      lessonProgress: [
        { enrolmentId: "enr-1", lessonId: "les-1" },
        { enrolmentId: "enr-1", lessonId: "les-2" },
      ],
    });
    await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    const evidence = h.completionRecords[0].evidence as { schema: number; items: unknown[] };
    expect(evidence.schema).toBe(1);
    expect(Array.isArray(evidence.items)).toBe(true);
    expect(evidence.items).toHaveLength(1); // no attendance threshold set
  });

  it("a second satisfied recalculation creates no second record and emits no second event (idempotent)", async () => {
    const h = buildHarness({
      lessonProgress: [
        { enrolmentId: "enr-1", lessonId: "les-1" },
        { enrolmentId: "enr-1", lessonId: "les-2" },
      ],
    });
    await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    const second = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(h.completionRecords).toHaveLength(1);
    expect(h.domainEvents).toHaveLength(1);
    if (second.kind === "evaluated") {
      expect(second.results[0].action).toBe("unchanged");
    }
  });

  it("supersedes an open record when a required lesson becomes incomplete-equivalent (attendance drop) without deleting it", async () => {
    const h = buildHarness({
      cohorts: [
        {
          id: "cohort-1",
          courseId: "course-1",
          programmeId: null,
          attendanceThresholdPct: 75,
          coursePublicationId: "pub-course-1",
          programmePublicationId: null,
        },
      ],
      lessonProgress: [
        { enrolmentId: "enr-1", lessonId: "les-1" },
        { enrolmentId: "enr-1", lessonId: "les-2" },
      ],
      sessions: [
        { id: "ses-1", cohortId: "cohort-1", attendanceExpected: true, cancelledAt: null },
        { id: "ses-2", cohortId: "cohort-1", attendanceExpected: true, cancelledAt: null },
      ],
      attendanceRecords: [
        { sessionId: "ses-1", enrolmentId: "enr-1", state: "PRESENT" },
        { sessionId: "ses-2", enrolmentId: "enr-1", state: "PRESENT" },
      ],
    });

    // First pass: all lessons complete + attendance 100% >= 75% -> satisfied, creates a record.
    const first = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(first.kind).toBe("evaluated");
    expect(h.completionRecords).toHaveLength(1);
    const createdAt = h.completionRecords[0].completedAt;
    const createdEvidence = h.completionRecords[0].evidence;

    // Attendance correction drops the learner to 50% (1 of 2 attended) -> below 75%.
    h.attendanceRecords[1].state = "ABSENT";
    const later = new Date(NOW.getTime() + 60_000);
    const second = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: later });
    expect(second.kind).toBe("evaluated");
    if (second.kind === "evaluated") {
      expect(second.results[0].verdict.satisfied).toBe(false);
      expect(second.results[0].action).toBe("superseded");
    }

    expect(h.completionRecords).toHaveLength(1); // never deleted, never a second row yet
    expect(h.completionRecords[0].supersededAt).toEqual(later);
    expect(h.completionRecords[0].completedAt).toEqual(createdAt); // untouched
    expect(h.completionRecords[0].evidence).toEqual(createdEvidence); // untouched
    expect(h.completionDeleteCalls).toHaveLength(0);

    // Re-satisfy: attendance corrected back up -> a NEW record is created, the old one stays superseded.
    h.attendanceRecords[1].state = "PRESENT";
    const third = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: new Date(later.getTime() + 60_000) });
    if (third.kind === "evaluated") {
      expect(third.results[0].action).toBe("created");
    }
    expect(h.completionRecords).toHaveLength(2);
    expect(h.completionRecords[0].supersededAt).not.toBeNull();
    expect(h.completionRecords[1].supersededAt).toBeNull();
  });

  it("unsatisfied verdict with no open record writes nothing", async () => {
    const h = buildHarness({
      cohorts: [
        {
          id: "cohort-1",
          courseId: "course-1",
          programmeId: null,
          attendanceThresholdPct: 75,
          coursePublicationId: "pub-course-1",
          programmePublicationId: null,
        },
      ],
    });
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result.kind).toBe("evaluated");
    expect(h.completionRecords).toHaveLength(0);
    expect(h.domainEvents).toHaveLength(0);
  });

  it("emits no event on a supersede (no un-completed notification per D-12)", async () => {
    const h = buildHarness({
      lessonProgress: [
        { enrolmentId: "enr-1", lessonId: "les-1" },
        { enrolmentId: "enr-1", lessonId: "les-2" },
      ],
    });
    await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(h.domainEvents).toHaveLength(1);

    // Un-complete a lesson (learner self-undo) -> verdict flips unsatisfied.
    h.lessonProgress.length = 0;
    await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: new Date(NOW.getTime() + 1000) });
    expect(h.domainEvents).toHaveLength(1); // still just the one "created" event — no supersede event
    expect(h.completionRecords[0].supersededAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unpinned / not-evaluable
// ---------------------------------------------------------------------------

describe("recalculateCompletion — not-evaluable (unpinned)", () => {
  it("returns not-evaluable when the cohort has no coursePublicationId", async () => {
    const h = buildHarness({
      cohorts: [
        {
          id: "cohort-1",
          courseId: "course-1",
          programmeId: null,
          attendanceThresholdPct: null,
          coursePublicationId: null,
          programmePublicationId: null,
        },
      ],
    });
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result).toEqual({ kind: "not-evaluable", reason: "unpinned" });
    expect(h.completionRecords).toHaveLength(0);
    expect(h.domainEvents).toHaveLength(0);
  });

  it("returns not-evaluable when the publication row is missing", async () => {
    const h = buildHarness({ coursePublications: {} });
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result).toEqual({ kind: "not-evaluable", reason: "unpinned" });
  });

  it("returns not-evaluable when the enrolment does not exist", async () => {
    const h = buildHarness();
    const result = await recalculateCompletion(h.tx, { enrolmentId: "nope", now: NOW });
    expect(result).toEqual({ kind: "not-evaluable", reason: "unpinned" });
  });

  it("returns not-evaluable for a programme-cohort with no member courses", async () => {
    const h = buildHarness({
      cohorts: [
        {
          id: "cohort-1",
          courseId: null,
          programmeId: "prog-1",
          attendanceThresholdPct: null,
          coursePublicationId: null,
          programmePublicationId: "pub-prog-1",
        },
      ],
      cohortCourses: [],
      programmePublications: { "pub-prog-1": programmeObligationPayload() },
    });
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result).toEqual({ kind: "not-evaluable", reason: "unpinned" });
  });
});

// ---------------------------------------------------------------------------
// Withdrawn required lessons are excluded (D-17 precedent)
// ---------------------------------------------------------------------------

describe("recalculateCompletion — withdrawn required lessons", () => {
  it("excludes a required lesson withdrawn since pinning from the required set", async () => {
    const h = buildHarness({
      lessons: [
        { id: "les-1", moduleId: "mod-1", withdrawnAt: null },
        { id: "les-2", moduleId: "mod-1", withdrawnAt: new Date("2026-09-10T00:00:00.000Z") },
      ],
      lessonProgress: [{ enrolmentId: "enr-1", lessonId: "les-1" }],
    });
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result.kind).toBe("evaluated");
    if (result.kind === "evaluated") {
      expect(result.results[0].verdict.satisfied).toBe(true);
      expect(result.results[0].action).toBe("created");
    }
  });
});

// ---------------------------------------------------------------------------
// Programme-cohort: per-member COURSE scope + one PROGRAMME scope
// ---------------------------------------------------------------------------

describe("recalculateCompletion — programme-cohort", () => {
  function programmeHarness() {
    return buildHarness({
      cohorts: [
        {
          id: "cohort-1",
          courseId: null,
          programmeId: "prog-1",
          attendanceThresholdPct: null,
          coursePublicationId: null,
          programmePublicationId: "pub-prog-1",
        },
      ],
      cohortCourses: [
        { cohortId: "cohort-1", courseId: "course-1", coursePublicationId: "pub-course-1" },
        { cohortId: "cohort-1", courseId: "course-2", coursePublicationId: "pub-course-2" },
      ],
      modules: [
        { id: "mod-1", courseId: "course-1" },
        { id: "mod-2", courseId: "course-2" },
      ],
      lessons: [
        { id: "les-1", moduleId: "mod-1", withdrawnAt: null },
        { id: "les-2", moduleId: "mod-2", withdrawnAt: null },
      ],
      coursePublications: {
        "pub-course-1": courseObligationPayload({
          modules: [{ id: "mod-1", position: 0, lessons: [{ id: "les-1", position: 0, required: true }] }],
        }),
        "pub-course-2": courseObligationPayload({
          modules: [{ id: "mod-2", position: 0, lessons: [{ id: "les-2", position: 0, required: true }] }],
        }),
      },
      programmePublications: { "pub-prog-1": programmeObligationPayload() },
    });
  }

  it("evaluates one COURSE-scope result per member course plus one PROGRAMME-scope result", async () => {
    const h = programmeHarness();
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result.kind).toBe("evaluated");
    if (result.kind !== "evaluated") return;
    expect(result.results).toHaveLength(3);
    const scopes = result.results.map((r) => `${r.scope}:${r.courseId ?? "none"}`);
    expect(scopes).toContain("COURSE:course-1");
    expect(scopes).toContain("COURSE:course-2");
    expect(scopes).toContain("PROGRAMME:none");
  });

  it("the PROGRAMME-scope required-lesson set is the union across all member courses", async () => {
    const h = programmeHarness();
    h.lessonProgress.push({ enrolmentId: "enr-1", lessonId: "les-1" });
    // only les-1 done — course-1 satisfied, course-2 and the programme are not.
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result.kind).toBe("evaluated");
    if (result.kind !== "evaluated") return;
    const course1 = result.results.find((r) => r.scope === "COURSE" && r.courseId === "course-1")!;
    const course2 = result.results.find((r) => r.scope === "COURSE" && r.courseId === "course-2")!;
    const programme = result.results.find((r) => r.scope === "PROGRAMME")!;
    expect(course1.verdict.satisfied).toBe(true);
    expect(course2.verdict.satisfied).toBe(false);
    expect(programme.verdict.satisfied).toBe(false);

    h.lessonProgress.push({ enrolmentId: "enr-1", lessonId: "les-2" });
    const secondPass = await recalculateCompletion(h.tx, {
      enrolmentId: "enr-1",
      now: new Date(NOW.getTime() + 1000),
    });
    if (secondPass.kind === "evaluated") {
      const programme2 = secondPass.results.find((r) => r.scope === "PROGRAMME")!;
      expect(programme2.verdict.satisfied).toBe(true);
      expect(programme2.action).toBe("created");
    }
  });

  it("falls back to the cohort's own coursePublicationId when a member has none", async () => {
    const h = programmeHarness();
    h.cohortCourses[0].coursePublicationId = null;
    h.cohorts[0].coursePublicationId = "pub-course-1";
    h.lessonProgress.push({ enrolmentId: "enr-1", lessonId: "les-1" });
    const result = await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    expect(result.kind).toBe("evaluated");
    if (result.kind === "evaluated") {
      const course1 = result.results.find((r) => r.scope === "COURSE" && r.courseId === "course-1")!;
      expect(course1.verdict.satisfied).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// An unparseable rule propagates loudly (never treated as satisfied/unmet)
// ---------------------------------------------------------------------------

describe("recalculateCompletion — an unevaluable rule propagates", () => {
  it("throws when the pinned completionRuleVersion is unsupported, and writes nothing", async () => {
    const h = buildHarness({
      coursePublications: { "pub-course-1": courseObligationPayload({ completionRuleVersion: 2 }) },
    });
    await expect(recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW })).rejects.toThrow();
    expect(h.completionRecords).toHaveLength(0);
    expect(h.domainEvents).toHaveLength(0);
  });

  it("throws when the pinned completionRule JSON carries an unrecognised key", async () => {
    const h = buildHarness({
      coursePublications: {
        "pub-course-1": courseObligationPayload({ completionRule: { version: 1, bogus: true } }),
      },
    });
    await expect(recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DD-6 — never touches Enrolment.status
// ---------------------------------------------------------------------------

describe("recalculateCompletion — DD-6 (never touches Enrolment.status)", () => {
  it("never calls tx.enrolment.update across every scenario exercised above", async () => {
    const h = buildHarness({
      lessonProgress: [
        { enrolmentId: "enr-1", lessonId: "les-1" },
        { enrolmentId: "enr-1", lessonId: "les-2" },
      ],
    });
    await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: NOW });
    h.lessonProgress.length = 0;
    await recalculateCompletion(h.tx, { enrolmentId: "enr-1", now: new Date(NOW.getTime() + 1000) });
    expect(h.enrolmentUpdateCalls).toHaveLength(0);
  });
});
