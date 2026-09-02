/**
 * Programme operations.
 *
 * CAT-02: a Course is added to a Programme by REFERENCE. `addCourseToProgramme`
 * creates a `ProgrammeCourse` join row and nothing else — there is no clone
 * path here, and any future "duplicate this course" feature must create a new
 * Course explicitly rather than being a side effect of Programme membership.
 *
 * The Programme CRUD surface (list/get/create/update/archive) is built on
 * `createResourceService`, exactly like `course-service.ts` — no hand-written
 * scope check. Membership add/remove is new surface the factory does not
 * cover, so it is hand-written here, but still routes every mutation through
 * `withPermission` and `recordAudit` like everything else in the codebase.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import { nextAppendPosition } from "@/lib/positions";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";

type ProgrammeRecord = { id: string };

/** A Programme is reached by a PROGRAMME-scoped grant, or any global grant. */
export function programmeScope(id: string): ResourceScope {
  return { programmeId: id };
}

export const programmeService = createResourceService<ProgrammeRecord>({
  name: "Programme",
  delegate: prisma.programme as unknown as Delegate<ProgrammeRecord>,
  permissions: {
    view: "programmes.view",
    create: "programmes.manage",
    edit: "programmes.manage",
  },
  toScope: programmeScope,
  withPermission,
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

/** Thrown when a courseId is already a member of the target Programme. */
export class DuplicateMembershipError extends Error {
  constructor(message = "This Course is already a member of this Programme.") {
    super(message);
    this.name = "DuplicateMembershipError";
  }
}

/** Thrown when the (programmeId, courseId) pair named for removal has no row. */
export class MembershipNotFoundError extends Error {
  constructor(message = "This Course is not a member of this Programme.") {
    super(message);
    this.name = "MembershipNotFoundError";
  }
}

export type ProgrammeCourseRow = {
  id: string;
  programmeId: string;
  courseId: string;
  position: number;
};

/**
 * The subset of the `ProgrammeCourse` delegate the membership operations
 * use. Kept narrow, like `resource-service.ts`'s `Delegate<T>`, so tests can
 * inject an in-memory fake instead of a real Prisma client.
 */
export type ProgrammeCourseDelegate = {
  findMany(args: { where: { programmeId: string } }): Promise<ProgrammeCourseRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<ProgrammeCourseRow>;
  delete(args: { where: { id: string } }): Promise<ProgrammeCourseRow>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<ProgrammeCourseRow>;
};

type WithPermissionFn = ReturnType<typeof createWithPermission>;

export type ProgrammeMembershipDeps = {
  programmeCourse: ProgrammeCourseDelegate;
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  /**
   * Groups the sibling read, the position computation and the write into one
   * unit of work, same purpose as `resource-service.ts`'s `runInTransaction`.
   * Injected rather than imported so this module stays free of a hard
   * dependency on a real Prisma client in tests. Defaults to running the
   * callback directly (no transaction wrapper) when omitted.
   */
  runInTransaction?: <R>(fn: () => Promise<R>) => Promise<R>;
};

/**
 * Builds `addCourseToProgramme` and `removeCourseFromProgramme` against
 * injected dependencies. A factory function (rather than two bare exports
 * bound to the real `prisma` client) so tests can supply an in-memory fake
 * `ProgrammeCourseDelegate` and a harness-built `withPermission`, in the
 * style of `tests/resource-service.test.ts`.
 */
export function createProgrammeMembershipOperations(deps: ProgrammeMembershipDeps) {
  const { programmeCourse, withPermission: wp, audit } = deps;
  const runInTransaction = deps.runInTransaction ?? (<R,>(fn: () => Promise<R>) => fn());

  const addCourseToProgramme = wp<{ programmeId: string; courseId: string }>(
    "programmes.manage",
    (input) => programmeScope(input.programmeId),
  )(async (input, ctx) => {
    const { created, memberIdsBefore, memberIdsAfter } = await runInTransaction(async () => {
      const siblings = await programmeCourse.findMany({
        where: { programmeId: input.programmeId },
      });

      if (siblings.some((s) => s.courseId === input.courseId)) {
        throw new DuplicateMembershipError();
      }

      const ordered = siblings.slice().sort((a, b) => a.position - b.position);
      const memberIdsBefore = ordered.map((s) => s.courseId);

      // Position is computed here, from the max LIVE position among this
      // Programme's existing members, read inside this same unit of work —
      // never taken from the caller. See <position_rule> in the plan.
      const maxPosition = siblings.length
        ? Math.max(...siblings.map((s) => s.position))
        : null;
      const position = nextAppendPosition(maxPosition);

      const created = await programmeCourse.create({
        data: { programmeId: input.programmeId, courseId: input.courseId, position },
      });

      return {
        created,
        memberIdsBefore,
        memberIdsAfter: [...memberIdsBefore, input.courseId],
      };
    });

    await audit({
      action: "programme.course_added",
      targetType: "Programme",
      targetId: input.programmeId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: memberIdsBefore,
      after: memberIdsAfter,
    });

    return created;
  });

  const removeCourseFromProgramme = wp<{ programmeId: string; courseId: string }>(
    "programmes.manage",
    (input) => programmeScope(input.programmeId),
  )(async (input, ctx) => {
    const { memberIdsBefore, memberIdsAfter } = await runInTransaction(async () => {
      const siblings = await programmeCourse.findMany({
        where: { programmeId: input.programmeId },
      });
      const target = siblings.find((s) => s.courseId === input.courseId);
      if (!target) {
        throw new MembershipNotFoundError();
      }

      const ordered = siblings.slice().sort((a, b) => a.position - b.position);
      const memberIdsBefore = ordered.map((s) => s.courseId);

      // A hard delete — the ONE place in this phase where that is correct.
      // `ProgrammeCourse` holds no history: it is a pure membership edge, the
      // Course on either end survives untouched, and the historical record
      // of what a Programme contained lives in the immutable
      // `ProgrammePublication.payload` (plan 04-08), not in this table.
      // Soft-deleting the edge instead would mean every membership query
      // everywhere carries a `withdrawnAt: null` filter forever, for a row
      // that nothing points at. The project-wide archive-never-delete rule
      // exists to protect history (an enrolment, a grade, a certificate must
      // remain readable) — this row is not history, it is current shape.
      await programmeCourse.delete({ where: { id: target.id } });

      // Renumber survivors to a contiguous 0..n-1 sequence. Ascending order
      // guarantees no update ever collides with a not-yet-processed sibling:
      // each survivor's new position is <= its old position, and every
      // survivor already renumbered holds a strictly smaller final value.
      const survivors = ordered.filter((s) => s.id !== target.id);
      for (let i = 0; i < survivors.length; i++) {
        if (survivors[i].position !== i) {
          await programmeCourse.update({
            where: { id: survivors[i].id },
            data: { position: i },
          });
        }
      }

      return {
        memberIdsBefore,
        memberIdsAfter: survivors.map((s) => s.courseId),
      };
    });

    await audit({
      action: "programme.course_removed",
      targetType: "Programme",
      targetId: input.programmeId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: memberIdsBefore,
      after: memberIdsAfter,
    });
  });

  return { addCourseToProgramme, removeCourseFromProgramme };
}

export const { addCourseToProgramme, removeCourseFromProgramme } =
  createProgrammeMembershipOperations({
    programmeCourse: prisma.programmeCourse as unknown as ProgrammeCourseDelegate,
    withPermission,
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
    runInTransaction: (fn) => prisma.$transaction(fn),
  });
