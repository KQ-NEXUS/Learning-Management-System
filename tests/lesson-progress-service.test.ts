/**
 * Plan 09-06: the write side of learner progress tracking — learner
 * mark/undo (Task 1), video watch-progress + 90% auto-completion (Task 2),
 * and the mandatory-reason staff override (Task 3).
 *
 * An in-memory fake `tx` — no Postgres, no `@prisma/client` import — mirrors
 * the staged-commit style `tests/attendance-service.test.ts` and
 * `tests/completion-service.test.ts` already use. `LearnerPath` fixtures are
 * built by hand (the real `assertLessonOpenable`/`evaluateLessonSequencing`
 * run against them unmocked) so the real gating logic is proven, not a
 * re-description of it.
 */

import { describe, expect, it } from "vitest";
import {
  createLessonProgressService,
  countLessonsRelockedBy,
  LessonNotOpenableError,
  ManualCompletionNotPermittedError,
  NotAVideoLessonError,
  InvalidWatchProgressError,
  OverrideReasonRequiredError,
  VIDEO_COMPLETION_PCT,
  type LessonProgressTxClient,
  type LessonProgressServiceDeps,
  type LessonProgressRow,
  type LessonWatchProgressRow,
} from "@/server/services/lesson-progress-service";
import { writeDomainEvent } from "@/server/services/domain-event-service";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { createTestWithPermission, grant } from "./support/harness";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import type {
  LearnerPath,
  DecoratedLesson,
  DecoratedModule,
} from "@/server/services/learner-access";
import type { CompletionRecalculationResult } from "@/server/services/completion-service";

// ---------------------------------------------------------------------------
// LearnerPath fixtures
// ---------------------------------------------------------------------------

function makeLesson(overrides: Partial<DecoratedLesson> & { id: string }): DecoratedLesson {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    type: overrides.type ?? "TEXT",
    position: overrides.position ?? 0,
    required: overrides.required ?? true,
    allowManualComplete: overrides.allowManualComplete ?? true,
    withdrawnAt: overrides.withdrawnAt ?? null,
    locked: overrides.locked ?? false,
    blockingLessonTitle: overrides.blockingLessonTitle ?? null,
    completed: overrides.completed ?? false,
    completedSource: overrides.completedSource ?? null,
    completedAt: overrides.completedAt ?? null,
  };
}

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makePath(opts?: {
  enrolmentId?: string;
  readOnly?: boolean;
  lessons?: DecoratedLesson[];
}): LearnerPath {
  const lessons = opts?.lessons ?? [makeLesson({ id: "les-1" })];
  const modules: DecoratedModule[] = [{ id: "mod-1", title: "Module 1", position: 0, lessons }];
  return {
    enrolment: {
      id: opts?.enrolmentId ?? "enr-1",
      cohortId: "cohort-1",
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      accessStartsAt: null,
      accessEndsAt: null,
      cohort: {
        id: "cohort-1",
        title: "Cohort",
        deliveryMode: "SELF_PACED",
        timezone: "UTC",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-12-31T00:00:00.000Z"),
        attendanceThresholdPct: null,
        courseId: "course-1",
        programmeId: null,
      },
      accessWindow: { kind: "unlimited", readOnly: opts?.readOnly ?? false, endsAt: null },
    },
    courses: [{ courseId: "course-1", courseTitle: "Course", modules }],
    progress: new Set(lessons.filter((l) => l.completed).map((l) => l.id)),
    sequencing: [],
  };
}

// ---------------------------------------------------------------------------
// Fake tx + deps harness
// ---------------------------------------------------------------------------

function buildTxHarness() {
  const lessonProgressRows: LessonProgressRow[] = [];
  const lessonWatchRows: LessonWatchProgressRow[] = [];
  const domainEvents: Array<Record<string, unknown>> = [];
  const deleteManyCalls: unknown[] = [];
  const updateManyCalls: unknown[] = [];

  const key = (where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } }) =>
    where.enrolmentId_lessonId;

  const rawTx = {
    domainEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        domainEvents.push(data);
        return { id: `evt-${domainEvents.length}` };
      },
    },
    lessonProgress: {
      findUnique: async ({
        where,
      }: {
        where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
      }) => {
        const k = key({ enrolmentId_lessonId: where.enrolmentId_lessonId });
        return (
          lessonProgressRows.find((r) => r.enrolmentId === k.enrolmentId && r.lessonId === k.lessonId) ?? null
        );
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = where.enrolmentId_lessonId;
        const existing = lessonProgressRows.find(
          (r) => r.enrolmentId === k.enrolmentId && r.lessonId === k.lessonId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { enrolmentId: k.enrolmentId, lessonId: k.lessonId, ...create } as LessonProgressRow;
        lessonProgressRows.push(row);
        return row;
      },
      delete: async ({
        where,
      }: {
        where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
      }) => {
        const k = where.enrolmentId_lessonId;
        const idx = lessonProgressRows.findIndex(
          (r) => r.enrolmentId === k.enrolmentId && r.lessonId === k.lessonId,
        );
        if (idx >= 0) lessonProgressRows.splice(idx, 1);
        return {};
      },
      // Not part of LessonProgressTxClient's declared surface — present only
      // so a test can assert it is never invoked (no write-side cascade).
      deleteMany: async (args: unknown) => {
        deleteManyCalls.push(args);
        return { count: 0 };
      },
      updateMany: async (args: unknown) => {
        updateManyCalls.push(args);
        return { count: 0 };
      },
    },
    lessonWatchProgress: {
      findUnique: async ({
        where,
      }: {
        where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
      }) => {
        const k = where.enrolmentId_lessonId;
        return (
          lessonWatchRows.find((r) => r.enrolmentId === k.enrolmentId && r.lessonId === k.lessonId) ?? null
        );
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = where.enrolmentId_lessonId;
        const existing = lessonWatchRows.find(
          (r) => r.enrolmentId === k.enrolmentId && r.lessonId === k.lessonId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { enrolmentId: k.enrolmentId, lessonId: k.lessonId, ...create } as LessonWatchProgressRow;
        lessonWatchRows.push(row);
        return row;
      },
    },
  };

  return {
    tx: rawTx as unknown as LessonProgressTxClient,
    rawTx,
    lessonProgressRows,
    lessonWatchRows,
    domainEvents,
    deleteManyCalls,
    updateManyCalls,
  };
}

type BuildDepsOpts = {
  path: LearnerPath | null;
  now?: Date;
  enrolmentOwnerUserId?: string | null;
};

function buildDeps(opts: BuildDepsOpts) {
  const h = buildTxHarness();
  const auditCalls: ResourceAuditEntry[] = [];
  const recalcCalls: Array<{ tx: unknown; enrolmentId: string; now: Date }> = [];
  let txSeenByRecalc: unknown = null;

  const deps: LessonProgressServiceDeps = {
    store: {
      enrolment: {
        findUnique: async () =>
          opts.enrolmentOwnerUserId !== undefined && opts.enrolmentOwnerUserId !== null
            ? { userId: opts.enrolmentOwnerUserId }
            : opts.enrolmentOwnerUserId === null
              ? null
              : { userId: "learner-1" },
      },
    },
    loadLearnerPath: async () => opts.path,
    audit: async (entry) => {
      auditCalls.push(entry);
    },
    writeEvent: writeDomainEvent,
    runInTransaction: async (fn) => {
      const result = await fn(h.tx);
      return result;
    },
    recalculateCompletion: async (tx, args) => {
      txSeenByRecalc = tx;
      recalcCalls.push({ tx, enrolmentId: args.enrolmentId, now: args.now });
      const result: CompletionRecalculationResult = { kind: "evaluated", results: [] };
      return result;
    },
    enrolmentScope: async () => ({ cohortId: "cohort-1" }),
    withPermission: createTestWithPermission([grant("enrolments.manage")]).withPermission,
    now: () => opts.now ?? NOW,
  };

  return { deps, h, auditCalls, recalcCalls, getTxSeenByRecalc: () => txSeenByRecalc };
}

// ---------------------------------------------------------------------------
// Task 1 — markLessonComplete / undoLessonComplete / countLessonsRelockedBy
// ---------------------------------------------------------------------------

describe("markLessonComplete", () => {
  it("creates a LessonProgress row with source MANUAL and calls recalculateCompletion in the same tx", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", allowManualComplete: true })] });
    const { deps, h, auditCalls, recalcCalls } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.markLessonComplete({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows).toHaveLength(1);
    expect(h.lessonProgressRows[0].source).toBe("MANUAL");
    expect(h.lessonProgressRows[0].completedAt).toEqual(NOW);
    expect(recalcCalls).toHaveLength(1);
    expect(recalcCalls[0].tx).toBe(h.tx);
    expect(h.domainEvents).toHaveLength(1);
    expect(h.domainEvents[0].type).toBe("lesson.completed");
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("lessonprogress.marked");
    expect(auditCalls[0].targetId).toBe("enr-1");
    expect(auditCalls[0].actorId).toBe("learner-1");
    expect(auditCalls[0].reason).toBeNull();
    expect(auditCalls[0].before).toEqual({ lessonId: "les-1", completed: false });
    expect(auditCalls[0].after).toEqual({ lessonId: "les-1", completed: true });
  });

  it("two consecutive marks leave exactly one row with an identical completedAt on both reads", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", allowManualComplete: true })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });
    const firstCompletedAt = h.lessonProgressRows[0].completedAt;

    await service.markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });

    expect(h.lessonProgressRows).toHaveLength(1);
    expect(h.lessonProgressRows[0].completedAt).toEqual(firstCompletedAt);
  });

  it("a second mark emits no second lesson.completed event", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", allowManualComplete: true })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });
    await service.markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });

    expect(h.domainEvents).toHaveLength(1);
  });

  it("does not overwrite an existing AUTO_VIDEO source on a repeat manual mark", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", allowManualComplete: true })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    h.lessonProgressRows.push({
      enrolmentId: "enr-1",
      lessonId: "les-1",
      source: "AUTO_VIDEO",
      completedAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    await service.markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });

    expect(h.lessonProgressRows).toHaveLength(1);
    expect(h.lessonProgressRows[0].source).toBe("AUTO_VIDEO");
    expect(h.lessonProgressRows[0].completedAt).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("succeeds manually marking a VIDEO lesson when allowManualComplete is true (DD-16)", async () => {
    const path = makePath({
      lessons: [makeLesson({ id: "les-1", type: "VIDEO", allowManualComplete: true })],
    });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.markLessonComplete({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows).toHaveLength(1);
  });

  it("refuses with ManualCompletionNotPermittedError when allowManualComplete is false, regardless of type", async () => {
    const path = makePath({
      lessons: [makeLesson({ id: "les-1", type: "TEXT", allowManualComplete: false })],
    });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await expect(
      service.markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" }),
    ).rejects.toBeInstanceOf(ManualCompletionNotPermittedError);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("refuses with LessonNotOpenableError(reason: 'locked') for a locked lesson", async () => {
    const path = makePath({
      lessons: [
        makeLesson({ id: "les-1", required: true, completed: false }),
        makeLesson({ id: "les-2", locked: true, blockingLessonTitle: "les-1" }),
      ],
    });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const err = await service
      .markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-2" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("locked");
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("refuses with LessonNotOpenableError(reason: 'access-window-closed') when the window is closed", async () => {
    const path = makePath({ readOnly: true, lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const err = await service
      .markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("access-window-closed");
  });

  it("refuses with LessonNotOpenableError(reason: 'not-found') for a lesson outside the path", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const err = await service
      .markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "nope" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("not-found");
  });

  it("refuses with LessonNotOpenableError(reason: 'not-found') when loadLearnerPath returns null (not the caller's enrolment)", async () => {
    const { deps } = buildDeps({ path: null });
    const service = createLessonProgressService(deps);

    const err = await service
      .markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("not-found");
  });
});

describe("undoLessonComplete", () => {
  it("deletes an existing MANUAL row with no reason argument and audits lessonprogress.unmarked", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", completed: true })] });
    const { deps, h, auditCalls, recalcCalls } = buildDeps({ path });
    const service = createLessonProgressService(deps);
    h.lessonProgressRows.push({ enrolmentId: "enr-1", lessonId: "les-1", source: "MANUAL", completedAt: NOW });

    const result = await service.undoLessonComplete({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
    });

    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);
    expect(recalcCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("lessonprogress.unmarked");
    expect(auditCalls[0].reason).toBeNull();
    expect(auditCalls[0].before).toEqual({ lessonId: "les-1", completed: true });
    expect(auditCalls[0].after).toEqual({ lessonId: "les-1", completed: false });
  });

  it("undoes an AUTO_VIDEO-sourced row with no reason supplied (D-13, D-15)", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", completed: true })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);
    h.lessonProgressRows.push({
      enrolmentId: "enr-1",
      lessonId: "les-1",
      source: "AUTO_VIDEO",
      completedAt: NOW,
    });

    const result = await service.undoLessonComplete({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
    });

    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("undo with no existing row is a successful no-op", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.undoLessonComplete({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
    });

    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("succeeds on a locked lesson (D-16 cascade scenario)", async () => {
    const path = makePath({
      lessons: [
        makeLesson({ id: "les-1", required: true, completed: false }),
        makeLesson({ id: "les-2", locked: true, blockingLessonTitle: "les-1", completed: true }),
      ],
    });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);
    h.lessonProgressRows.push({ enrolmentId: "enr-1", lessonId: "les-2", source: "MANUAL", completedAt: NOW });

    const result = await service.undoLessonComplete({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-2",
    });

    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("refuses with LessonNotOpenableError(reason: 'access-window-closed') when the window is closed", async () => {
    const path = makePath({ readOnly: true, lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const err = await service
      .undoLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("access-window-closed");
  });

  it("refuses with LessonNotOpenableError(reason: 'not-found') for a lesson outside the path", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const err = await service
      .undoLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "nope" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("not-found");
  });

  it("performs no cascade write over other lessons (no deleteMany/updateMany call)", async () => {
    const path = makePath({
      lessons: [
        makeLesson({ id: "les-1", completed: true }),
        makeLesson({ id: "les-2", completed: true }),
      ],
    });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);
    h.lessonProgressRows.push(
      { enrolmentId: "enr-1", lessonId: "les-1", source: "MANUAL", completedAt: NOW },
      { enrolmentId: "enr-1", lessonId: "les-2", source: "MANUAL", completedAt: NOW },
    );

    await service.undoLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });

    expect(h.deleteManyCalls).toHaveLength(0);
    expect(h.updateManyCalls).toHaveLength(0);
    expect(h.lessonProgressRows).toHaveLength(1);
    expect(h.lessonProgressRows[0].lessonId).toBe("les-2");
  });

  it("recalculateCompletion runs with the same tx identity that received the delete", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", completed: true })] });
    const { deps, h, getTxSeenByRecalc } = buildDeps({ path });
    const service = createLessonProgressService(deps);
    h.lessonProgressRows.push({ enrolmentId: "enr-1", lessonId: "les-1", source: "MANUAL", completedAt: NOW });

    await service.undoLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });

    expect(getTxSeenByRecalc()).toBe(h.tx);
  });
});

describe("countLessonsRelockedBy", () => {
  it("returns the number of lessons that would re-lock, with no write", async () => {
    const path = makePath({
      lessons: [
        makeLesson({ id: "les-1", position: 0, required: true, completed: true }),
        makeLesson({ id: "les-2", position: 1, required: true, completed: true }),
        makeLesson({ id: "les-3", position: 2, required: false, completed: false }),
      ],
    });
    // progress reflects les-1 and les-2 completed.
    const relockCount = countLessonsRelockedBy(path, "les-1");
    // Removing les-1's completion locks les-2 (required, now blocked by les-1)
    // and les-3 (comes after the newly-locked les-2).
    expect(relockCount).toBe(2);
  });

  it("returns 0 when un-completing a lesson with nothing required after it", async () => {
    const path = makePath({
      lessons: [makeLesson({ id: "les-1", position: 0, required: true, completed: true })],
    });
    expect(countLessonsRelockedBy(path, "les-1")).toBe(0);
  });

  it("counts a re-lock in module 2 caused by un-completing module 1's lesson, across module-local position resets", () => {
    // Regression: `flattenSequencingLessons` (this file) duplicates
    // `learner-access.ts`'s flattening and once had the identical
    // module-position-collision bug — position resets to 0 per module, so
    // a naive courseIndex-only offset let module 2's position-0 lesson
    // sort ahead of module 1's, undercounting (or missing entirely) the
    // re-lock this function exists to report. Two modules, each starting
    // at position 0, with ids chosen so a collision would sort them wrong.
    const path: LearnerPath = {
      enrolment: {
        id: "enr-1",
        cohortId: "cohort-1",
        status: "ACTIVE",
        activatedAt: new Date("2026-01-01T00:00:00.000Z"),
        accessStartsAt: null,
        accessEndsAt: null,
        cohort: {
          id: "cohort-1",
          title: "Cohort",
          deliveryMode: "SELF_PACED",
          timezone: "UTC",
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: new Date("2026-12-31T00:00:00.000Z"),
          attendanceThresholdPct: null,
          courseId: "course-1",
          programmeId: null,
        },
        accessWindow: { kind: "unlimited", readOnly: false, endsAt: null },
      },
      courses: [
        {
          courseId: "course-1",
          courseTitle: "Course",
          modules: [
            {
              id: "mod-1",
              title: "Module 1",
              position: 0,
              lessons: [makeLesson({ id: "z-mod1-lesson", position: 0, required: true, completed: true })],
            },
            {
              id: "mod-2",
              title: "Module 2",
              position: 1,
              lessons: [makeLesson({ id: "a-mod2-lesson", position: 0, required: true, completed: false })],
            },
          ],
        },
      ],
      progress: new Set(["z-mod1-lesson"]),
      sequencing: [],
    };

    // Un-completing module 1's lesson must re-lock module 2's lesson too.
    expect(countLessonsRelockedBy(path, "z-mod1-lesson")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 2 — recordWatchProgress
// ---------------------------------------------------------------------------

describe("recordWatchProgress", () => {
  it("stores the watch position and computes percentWatched server-side", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 30,
      durationSeconds: 100,
    });

    expect(result.percentWatched).toBe(30);
    expect(h.lessonWatchRows).toHaveLength(1);
    expect(h.lessonWatchRows[0].secondsWatched).toBe(30);
    expect(h.lessonWatchRows[0].percentWatched).toBe(30);
    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("refuses with NotAVideoLessonError for a non-VIDEO lesson", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "TEXT" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await expect(
      service.recordWatchProgress({ userId: "learner-1" }, {
        enrolmentId: "enr-1",
        lessonId: "les-1",
        secondsWatched: 10,
        durationSeconds: 100,
      }),
    ).rejects.toBeInstanceOf(NotAVideoLessonError);
    expect(h.lessonWatchRows).toHaveLength(0);
  });

  it("refuses with LessonNotOpenableError(reason: 'locked') for a locked VIDEO lesson", async () => {
    const path = makePath({
      lessons: [
        makeLesson({ id: "les-1", required: true, completed: false }),
        makeLesson({ id: "les-2", type: "VIDEO", locked: true, blockingLessonTitle: "les-1" }),
      ],
    });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const err = await service
      .recordWatchProgress({ userId: "learner-1" }, {
        enrolmentId: "enr-1",
        lessonId: "les-2",
        secondsWatched: 10,
        durationSeconds: 100,
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("locked");
  });

  it("throws InvalidWatchProgressError for a negative secondsWatched and writes nothing", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await expect(
      service.recordWatchProgress({ userId: "learner-1" }, {
        enrolmentId: "enr-1",
        lessonId: "les-1",
        secondsWatched: -5,
        durationSeconds: 100,
      }),
    ).rejects.toBeInstanceOf(InvalidWatchProgressError);
    expect(h.lessonWatchRows).toHaveLength(0);
  });

  it("throws InvalidWatchProgressError for a non-finite durationSeconds", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await expect(
      service.recordWatchProgress({ userId: "learner-1" }, {
        enrolmentId: "enr-1",
        lessonId: "les-1",
        secondsWatched: 10,
        durationSeconds: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toBeInstanceOf(InvalidWatchProgressError);
  });

  it("caps secondsWatched at durationSeconds when the input exceeds it", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 500,
      durationSeconds: 100,
    });

    expect(h.lessonWatchRows[0].secondsWatched).toBe(100);
    expect(h.lessonWatchRows[0].percentWatched).toBe(100);
  });

  it("a durationSeconds of 0 stores position without computing a percent or completing", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 10,
      durationSeconds: 0,
    });

    expect(result.percentWatched).toBe(0);
    expect(result.completed).toBe(false);
    expect(h.lessonWatchRows[0].secondsWatched).toBe(10);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("a durationSeconds of null stores position without computing a percent or completing", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 10,
      durationSeconds: null,
    });

    expect(result.percentWatched).toBe(0);
    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("does not lower the stored high-water mark on a backwards scrub", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 80,
      durationSeconds: 100,
    });
    const result = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 20,
      durationSeconds: 100,
    });

    expect(h.lessonWatchRows[0].secondsWatched).toBe(80);
    expect(h.lessonWatchRows[0].percentWatched).toBe(80);
    expect(result.percentWatched).toBe(80);
    // durationSeconds still moves to the latest incoming value.
    expect(h.lessonWatchRows[0].durationSeconds).toBe(100);
  });

  it("creates a LessonProgress row sourced AUTO_VIDEO on crossing 90%, recalculates and emits lesson.completed", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h, auditCalls, recalcCalls } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 95,
      durationSeconds: 100,
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows).toHaveLength(1);
    expect(h.lessonProgressRows[0].source).toBe("AUTO_VIDEO");
    expect(recalcCalls).toHaveLength(1);
    expect(h.domainEvents).toHaveLength(1);
    expect(h.domainEvents[0].type).toBe("lesson.completed");
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("lessonprogress.marked");
    expect(auditCalls[0].actorId).toBe("learner-1");
    expect(auditCalls[0].reason).toBeNull();
  });

  it("a second call at the same percent after crossing 90% creates no second row and emits no second event (idempotent)", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 95,
      durationSeconds: 100,
    });
    const second = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 95,
      durationSeconds: 100,
    });

    expect(second.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(1);
    expect(h.domainEvents).toHaveLength(1);
  });

  it("undo-then-recordWatchProgress at the same percent leaves the lesson incomplete (T-09-28)", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO", completed: true })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 95,
      durationSeconds: 100,
    });
    expect(h.lessonProgressRows).toHaveLength(1);

    // Learner self-undoes the AUTO_VIDEO completion (D-15) — the watch row's
    // high-water mark of 95% stays untouched by an undo.
    await service.undoLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });
    expect(h.lessonProgressRows).toHaveLength(0);

    // A throttled tick lands after the undo at the SAME percent — must not
    // silently re-complete.
    const result = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 95,
      durationSeconds: 100,
    });

    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("re-completes when the percent genuinely advances beyond the stored high-water mark after an undo", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 90,
      durationSeconds: 100,
    });
    await service.undoLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" });

    const result = await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 98,
      durationSeconds: 100,
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows).toHaveLength(1);
  });

  it("VIDEO_COMPLETION_PCT is 90 and is used as the threshold", async () => {
    expect(VIDEO_COMPLETION_PCT).toBe(90);
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.recordWatchProgress({ userId: "learner-1" }, {
      enrolmentId: "enr-1",
      lessonId: "les-1",
      secondsWatched: 89,
      durationSeconds: 100,
    });
    expect(h.lessonProgressRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 09-12 Task 3 — getOwnWatchProgress
// ---------------------------------------------------------------------------

describe("getOwnWatchProgress", () => {
  it("returns null when no LessonWatchProgress row exists yet", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    const result = await service.getOwnWatchProgress(
      { userId: "learner-1" },
      { enrolmentId: "enr-1", lessonId: "les-1" },
    );

    expect(result).toBeNull();
  });

  it("returns the stored watch position after recordWatchProgress has written one", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", type: "VIDEO" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await service.recordWatchProgress(
      { userId: "learner-1" },
      { enrolmentId: "enr-1", lessonId: "les-1", secondsWatched: 30, durationSeconds: 100 },
    );

    const result = await service.getOwnWatchProgress(
      { userId: "learner-1" },
      { enrolmentId: "enr-1", lessonId: "les-1" },
    );

    expect(result).toEqual({ secondsWatched: 30, durationSeconds: 100, percentWatched: 30 });
  });

  it("returns null when loadLearnerPath resolves null (not the caller's own enrolment)", async () => {
    const { deps } = buildDeps({ path: null });
    const service = createLessonProgressService(deps);

    const result = await service.getOwnWatchProgress(
      { userId: "learner-1" },
      { enrolmentId: "enr-1", lessonId: "les-1" },
    );

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 3 — overrideLessonProgress
// ---------------------------------------------------------------------------

describe("overrideLessonProgress", () => {
  it("throws OverrideReasonRequiredError for a whitespace-only reason and writes nothing", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps, h } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await expect(
      service.overrideLessonProgress({
        enrolmentId: "enr-1",
        lessonId: "les-1",
        complete: true,
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(OverrideReasonRequiredError);
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("throws OverrideReasonRequiredError for a missing reason", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path });
    const service = createLessonProgressService(deps);

    await expect(
      service.overrideLessonProgress({
        enrolmentId: "enr-1",
        lessonId: "les-1",
        complete: true,
        reason: "",
      }),
    ).rejects.toBeInstanceOf(OverrideReasonRequiredError);
  });

  it("complete: true upserts a STAFF_OVERRIDE row and audits with the reason and staff actorId", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps, h, auditCalls, recalcCalls } = buildDeps({ path, enrolmentOwnerUserId: "learner-1" });
    const service = createLessonProgressService(deps);

    const result = await service.overrideLessonProgress({
      enrolmentId: "enr-1",
      lessonId: "les-1",
      complete: true,
      reason: "Verified via alternate evidence",
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows).toHaveLength(1);
    expect(h.lessonProgressRows[0].source).toBe("STAFF_OVERRIDE");
    expect(recalcCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("lessonprogress.overridden");
    expect(auditCalls[0].reason).toBe("Verified via alternate evidence");
    expect(auditCalls[0].actorId).toBe("user-1"); // the test harness's default authorized actor
  });

  it("complete: false deletes the row (idempotent when none exists)", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", completed: true })] });
    const { deps, h } = buildDeps({ path, enrolmentOwnerUserId: "learner-1" });
    const service = createLessonProgressService(deps);
    h.lessonProgressRows.push({ enrolmentId: "enr-1", lessonId: "les-1", source: "MANUAL", completedAt: NOW });

    const result = await service.overrideLessonProgress({
      enrolmentId: "enr-1",
      lessonId: "les-1",
      complete: false,
      reason: "Learner disputed completion",
    });

    expect(result.completed).toBe(false);
    expect(h.lessonProgressRows).toHaveLength(0);

    // A second identical call is idempotent (no existing row to delete).
    await service.overrideLessonProgress({
      enrolmentId: "enr-1",
      lessonId: "les-1",
      complete: false,
      reason: "Learner disputed completion",
    });
    expect(h.lessonProgressRows).toHaveLength(0);
  });

  it("succeeds on a lesson with allowManualComplete: false", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1", allowManualComplete: false })] });
    const { deps, h } = buildDeps({ path, enrolmentOwnerUserId: "learner-1" });
    const service = createLessonProgressService(deps);

    const result = await service.overrideLessonProgress({
      enrolmentId: "enr-1",
      lessonId: "les-1",
      complete: true,
      reason: "Staff correction",
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows).toHaveLength(1);
  });

  it("succeeds on a locked lesson", async () => {
    const path = makePath({
      lessons: [
        makeLesson({ id: "les-1", required: true, completed: false }),
        makeLesson({ id: "les-2", locked: true, blockingLessonTitle: "les-1" }),
      ],
    });
    const { deps, h } = buildDeps({ path, enrolmentOwnerUserId: "learner-1" });
    const service = createLessonProgressService(deps);

    const result = await service.overrideLessonProgress({
      enrolmentId: "enr-1",
      lessonId: "les-2",
      complete: true,
      reason: "Staff correction",
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows.some((r) => r.lessonId === "les-2")).toBe(true);
  });

  it("succeeds past a closed access window", async () => {
    const path = makePath({ readOnly: true, lessons: [makeLesson({ id: "les-1" })] });
    const { deps, h } = buildDeps({ path, enrolmentOwnerUserId: "learner-1" });
    const service = createLessonProgressService(deps);

    const result = await service.overrideLessonProgress({
      enrolmentId: "enr-1",
      lessonId: "les-1",
      complete: true,
      reason: "Staff correction after window closed",
    });

    expect(result.completed).toBe(true);
    expect(h.lessonProgressRows).toHaveLength(1);
  });

  it("refuses a cross-course lesson id with LessonNotOpenableError(reason: 'not-found')", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path, enrolmentOwnerUserId: "learner-1" });
    const service = createLessonProgressService(deps);

    const err = await service
      .overrideLessonProgress({
        enrolmentId: "enr-1",
        lessonId: "not-in-this-course",
        complete: true,
        reason: "Staff correction",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LessonNotOpenableError);
    expect(err.reason).toBe("not-found");
  });

  it("a learner calling this for their own enrolment without the permission receives AuthorizationError", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path, enrolmentOwnerUserId: "learner-1" });
    const unauthorizedDeps: LessonProgressServiceDeps = {
      ...deps,
      withPermission: createTestWithPermission([], { userId: "learner-1" }).withPermission,
    };
    const service = createLessonProgressService(unauthorizedDeps);

    await expect(
      service.overrideLessonProgress({
        enrolmentId: "enr-1",
        lessonId: "les-1",
        complete: true,
        reason: "Self-service attempt",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting — exactly one withPermission-wrapped export (DD-15)
// ---------------------------------------------------------------------------

describe("DD-15 — exactly one withPermission-wrapped export", () => {
  it("overrideLessonProgress is the only export requiring a permission grant", async () => {
    const path = makePath({ lessons: [makeLesson({ id: "les-1" })] });
    const { deps } = buildDeps({ path });
    const noPermissionDeps: LessonProgressServiceDeps = {
      ...deps,
      withPermission: createTestWithPermission([]).withPermission,
    };
    const service = createLessonProgressService(noPermissionDeps);

    // markLessonComplete/undoLessonComplete/recordWatchProgress never call
    // withPermission at all — they succeed with zero grants.
    await expect(
      service.markLessonComplete({ userId: "learner-1" }, { enrolmentId: "enr-1", lessonId: "les-1" }),
    ).resolves.toMatchObject({ completed: true });
  });
});
