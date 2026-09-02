/**
 * The whole-list reorder — Module, Lesson and ProgrammeCourse.
 *
 * CAT-03's "ordering is stable after save" and D-20's "explicit Save order"
 * both depend on this file. It is the highest-risk mechanism in Phase 4: the
 * obvious implementation is wrong in a way no small test catches.
 *
 * Three prohibitions, and why, so nobody re-derives them the hard way:
 *
 *   1. Never `SET CONSTRAINTS ... DEFERRED` here. Prisma emits position
 *      uniqueness as `CREATE UNIQUE INDEX`, not a deferrable constraint —
 *      `prisma/migrations/20260901115332_init/migration.sql` lines 827
 *      (`ProgrammeCourse_programmeId_position_key`), 839
 *      (`Module_courseId_position_key`) and 845
 *      (`Lesson_moduleId_position_key`). PostgreSQL can only defer
 *      constraints; `SET CONSTRAINTS` neither errors nor warns when handed
 *      an index name — it silently does nothing, passes small tests, and
 *      throws "duplicate key value violates unique constraint" on the first
 *      real reorder in production.
 *   2. Never add `CHECK (position >= 0)`. Pass one below deliberately writes
 *      negative positions for the duration of one transaction; a check
 *      constraint would break it.
 *   3. Never replace the unique indexes with deferrable constraints either
 *      (the documented-but-rejected alternative in 04-RESEARCH.md Pattern
 *      3). It permits a single renumbering UPDATE, but creates permanent
 *      Prisma-migrate drift — `@@unique` keeps wanting to re-create the
 *      index — for no gain over the two-statement version below.
 *
 * The two-pass pattern: PASS ONE parks every affected LIVE row at a negative
 * position (`-position - 1`), which no committed row occupies, because a
 * single per-row UPDATE can violate the unique index mid-statement —
 * PostgreSQL evaluates a non-deferrable unique index per row as the
 * statement progresses, not once at statement end. PASS TWO then writes the
 * final arrangement. Both run inside one `$transaction`, so no other session
 * ever observes a negative position.
 *
 * Band contract (see src/lib/positions.ts): live rows are always `>= 0`,
 * reorder-parking occupies `-1 .. -n` for the duration of one statement, and
 * withdrawn rows are parked at or under `WITHDRAWN_PARK_BASE` (-1,000,000).
 * Pass one MUST filter to live rows only (`"withdrawnAt" IS NULL`) — a
 * withdrawn row parked at -1,000,001 would negate to 1,000,000 and be
 * stranded in the live band forever, which is why that predicate appears on
 * every Module/Lesson pass-one statement below and is not optional.
 * `ProgrammeCourse` has no `withdrawnAt` column at all, so its pass-one
 * statement has no such predicate to add — there is no band for it to
 * protect against.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import { assertArrangementSize } from "@/lib/positions";

type WithPermission = ReturnType<typeof createWithPermission>;

export class StaleOrderError extends Error {
  constructor(message = "Someone else reordered this — reload and try again.") {
    super(message);
    this.name = "StaleOrderError";
  }
}

export class ArrangementMismatchError extends Error {
  constructor(
    message = "The arrangement does not match this record's current, live children.",
  ) {
    super(message);
    this.name = "ArrangementMismatchError";
  }
}

/**
 * D-23 / RESEARCH A8: `updatedAt` is a `DateTime` at PostgreSQL microsecond
 * precision. Rendering it via `toISOString()` truncates to milliseconds and
 * can silently never match on the round trip. `getTime()` and `new Date(ms)`
 * both operate at millisecond precision throughout, so the round trip is
 * exact by construction rather than by coincidence — see the integration
 * test that reads a real `updatedAt` from the database and asserts the
 * round-tripped token still authorizes a write.
 */
export function serialiseOrderToken(d: Date): string {
  return String(d.getTime());
}

export function parseOrderToken(s: string): Date {
  return new Date(Number(s));
}

export type PlannedRow = {
  id: string;
  /** Pass-one parking slot: always negative, always distinct. */
  parkPosition: number;
  /** Pass-two final slot: the row's index in the requested arrangement. */
  finalPosition: number;
};

/**
 * Pure helper — no database, no permission check. Given an ordered list of
 * ids, returns the parking and final position each row will be written to.
 * `-position - 1` maps `[0,1,2,…]` onto `[-1,-2,-3,…]`: disjoint from both
 * the live band (`>= 0`) and, for any arrangement within
 * `MAX_ARRANGEMENT_SIZE`, disjoint from the withdrawn band too.
 */
export function planTwoPass(arrangement: string[]): PlannedRow[] {
  return arrangement.map((id, position) => ({
    id,
    parkPosition: -position - 1,
    finalPosition: position,
  }));
}

/** The subset of a Prisma transaction client this service uses. */
export type ReorderTx = {
  course: {
    updateMany: (args: {
      where: { id: string; updatedAt: Date };
      data: { updatedAt: Date };
    }) => Promise<{ count: number }>;
  };
  programme: {
    updateMany: (args: {
      where: { id: string; updatedAt: Date };
      data: { updatedAt: Date };
    }) => Promise<{ count: number }>;
  };
  module: {
    findMany: (args: {
      where: { courseId: string; withdrawnAt: null };
      orderBy: { position: "asc" };
    }) => Promise<{ id: string }[]>;
    update: (args: {
      where: { id: string };
      data: { position: number };
    }) => Promise<unknown>;
  };
  lesson: {
    findMany: (args: {
      where: { moduleId: { in: string[] }; withdrawnAt: null };
      orderBy: { position: "asc" };
    }) => Promise<{ id: string }[]>;
    update: (args: {
      where: { id: string };
      data: { position: number; moduleId: string };
    }) => Promise<unknown>;
  };
  programmeCourse: {
    findMany: (args: {
      where: { programmeId: string };
      orderBy: { position: "asc" };
    }) => Promise<{ id: string }[]>;
    update: (args: {
      where: { id: string };
      data: { position: number };
    }) => Promise<unknown>;
  };
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

/** Injected so this service stays testable without a real Postgres. */
export type ReorderDb = {
  $transaction: <R>(fn: (tx: ReorderTx) => Promise<R>) => Promise<R>;
};

export type ReorderServiceConfig = {
  db: ReorderDb;
  withPermission: WithPermission;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
};

export type CommitModuleOrderInput = {
  courseId: string;
  expectedUpdatedAt: Date;
  moduleIds: string[];
};

export type CommitLessonOrderInput = {
  courseId: string;
  expectedUpdatedAt: Date;
  /** D-21: every group's `moduleId` — source AND destination of any
   *  cross-module move — must appear here, or that module's untouched
   *  lessons will fail the completeness check below. */
  arrangement: { moduleId: string; lessonIds: string[] }[];
};

export type CommitProgrammeCourseOrderInput = {
  programmeId: string;
  expectedUpdatedAt: Date;
  programmeCourseIds: string[];
};

/**
 * Verifies the payload names exactly the parent's current, live children —
 * both as a count and as a set (never trust a client-supplied arrangement to
 * be complete, in-scope, or free of duplicates). Throws
 * `ArrangementMismatchError` on any mismatch: a foreign id, an omitted
 * live child, a duplicated id, or (because `existingIds` is drawn from a
 * live-only query) an included withdrawn id.
 */
function verifyArrangement(existingIds: string[], arrangementIds: string[]): void {
  const arrangementSet = new Set(arrangementIds);
  if (arrangementSet.size !== arrangementIds.length) {
    throw new ArrangementMismatchError();
  }
  if (existingIds.length !== arrangementIds.length) {
    throw new ArrangementMismatchError();
  }
  for (const id of existingIds) {
    if (!arrangementSet.has(id)) {
      throw new ArrangementMismatchError();
    }
  }
}

/**
 * Builds the three reorder operations against injected dependencies. The
 * bound production instance (`commitModuleOrder` etc., exported below) wires
 * this to the real Prisma client, the live `withPermission`, and
 * `recordAudit`. Tests — unit (Task 2, a fake `db`) and integration (Task 3,
 * a real Postgres via `tests/support/pg.ts`) — build their own instance with
 * `createReorderService` instead, so authorization can be exercised with a
 * GLOBAL-grant test harness without touching the real session machinery.
 */
export function createReorderService(config: ReorderServiceConfig) {
  const { db, withPermission, audit } = config;

  async function claimCourse(
    tx: ReorderTx,
    courseId: string,
    expectedUpdatedAt: Date,
  ): Promise<void> {
    // D-23 / Pattern 4: a conditional UPDATE, never read-then-compare — the
    // latter is itself a race between two concurrent reorders.
    const claimed = await tx.course.updateMany({
      where: { id: courseId, updatedAt: expectedUpdatedAt },
      data: { updatedAt: new Date() },
    });
    if (claimed.count === 0) throw new StaleOrderError();
  }

  async function claimProgramme(
    tx: ReorderTx,
    programmeId: string,
    expectedUpdatedAt: Date,
  ): Promise<void> {
    const claimed = await tx.programme.updateMany({
      where: { id: programmeId, updatedAt: expectedUpdatedAt },
      data: { updatedAt: new Date() },
    });
    if (claimed.count === 0) throw new StaleOrderError();
  }

  const commitModuleOrder = withPermission<CommitModuleOrderInput>(
    "courses.edit",
    (input) => ({ courseIds: [input.courseId] }),
  )(async (input, ctx) => {
    assertArrangementSize(input.moduleIds.length);

    const { before, after } = await db.$transaction(async (tx) => {
      await claimCourse(tx, input.courseId, input.expectedUpdatedAt);

      const existing = await tx.module.findMany({
        where: { courseId: input.courseId, withdrawnAt: null },
        orderBy: { position: "asc" },
      });
      const existingIds = existing.map((m) => m.id);
      verifyArrangement(existingIds, input.moduleIds);

      // PASS ONE — park every live Module of this Course. See the header
      // comment: withdrawnAt IS NULL is load-bearing, not decorative.
      await tx.$executeRaw`
        UPDATE "Module"
           SET "position" = -"position" - 1
         WHERE "courseId" = ${input.courseId}
           AND "withdrawnAt" IS NULL
      `;

      // PASS TWO — write the final arrangement.
      for (const [position, id] of input.moduleIds.entries()) {
        await tx.module.update({ where: { id }, data: { position } });
      }

      return { before: existingIds, after: input.moduleIds };
    });

    await audit({
      action: "module.reordered",
      targetType: "Course",
      targetId: input.courseId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before,
      after,
    });

    return { moved: after.length };
  });

  const commitLessonOrder = withPermission<CommitLessonOrderInput>(
    "courses.edit",
    (input) => ({ courseIds: [input.courseId] }),
  )(async (input, ctx) => {
    const allLessonIds = input.arrangement.flatMap((group) => group.lessonIds);
    assertArrangementSize(allLessonIds.length);
    const touchedModuleIds = input.arrangement.map((group) => group.moduleId);

    const { before, after } = await db.$transaction(async (tx) => {
      await claimCourse(tx, input.courseId, input.expectedUpdatedAt);

      // Every touched module's live lessons — source AND destination of any
      // cross-module move (D-21) — must all appear in the payload.
      const existing = await tx.lesson.findMany({
        where: { moduleId: { in: touchedModuleIds }, withdrawnAt: null },
        orderBy: { position: "asc" },
      });
      const existingIds = existing.map((l) => l.id);
      verifyArrangement(existingIds, allLessonIds);

      // PASS ONE — park every live Lesson in every touched Module, so a
      // cross-module move cannot collide with either module's live band.
      await tx.$executeRaw`
        UPDATE "Lesson"
           SET "position" = -"position" - 1
         WHERE "moduleId" = ANY(${touchedModuleIds}::text[])
           AND "withdrawnAt" IS NULL
      `;

      // PASS TWO — write the final arrangement, re-parenting as needed
      // (D-21) so a cross-module move commits in the same transaction.
      for (const group of input.arrangement) {
        for (const [position, id] of group.lessonIds.entries()) {
          await tx.lesson.update({
            where: { id },
            data: { moduleId: group.moduleId, position },
          });
        }
      }

      return { before: existingIds, after: allLessonIds };
    });

    await audit({
      action: "lesson.reordered",
      targetType: "Course",
      targetId: input.courseId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before,
      after,
    });

    return { moved: after.length };
  });

  const commitProgrammeCourseOrder = withPermission<CommitProgrammeCourseOrderInput>(
    "programmes.manage",
    (input) => ({ programmeId: input.programmeId }),
  )(async (input, ctx) => {
    assertArrangementSize(input.programmeCourseIds.length);

    const { before, after } = await db.$transaction(async (tx) => {
      await claimProgramme(tx, input.programmeId, input.expectedUpdatedAt);

      const existing = await tx.programmeCourse.findMany({
        where: { programmeId: input.programmeId },
        orderBy: { position: "asc" },
      });
      const existingIds = existing.map((pc) => pc.id);
      verifyArrangement(existingIds, input.programmeCourseIds);

      // PASS ONE — ProgrammeCourse carries no withdrawnAt column, so unlike
      // Module/Lesson above, this statement has no such predicate to add.
      await tx.$executeRaw`
        UPDATE "ProgrammeCourse"
           SET "position" = -"position" - 1
         WHERE "programmeId" = ${input.programmeId}
      `;

      // PASS TWO — write the final arrangement.
      for (const [position, id] of input.programmeCourseIds.entries()) {
        await tx.programmeCourse.update({ where: { id }, data: { position } });
      }

      return { before: existingIds, after: input.programmeCourseIds };
    });

    await audit({
      action: "programme.reordered",
      targetType: "Programme",
      targetId: input.programmeId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before,
      after,
    });

    return { moved: after.length };
  });

  return { commitModuleOrder, commitLessonOrder, commitProgrammeCourseOrder };
}

/** Adapts the real Prisma client to `ReorderDb` for the production binding. */
const productionDb: ReorderDb = {
  $transaction: (fn) => prisma.$transaction((tx) => fn(tx as unknown as ReorderTx)),
};

const reorderService = createReorderService({
  db: productionDb,
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

export const commitModuleOrder = reorderService.commitModuleOrder;
export const commitLessonOrder = reorderService.commitLessonOrder;
export const commitProgrammeCourseOrder = reorderService.commitProgrammeCourseOrder;
