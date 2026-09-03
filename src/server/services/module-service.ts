/**
 * Module operations.
 *
 * A Module has no permission of its own — CAT-03 gates every mutation on
 * the parent Course's courses.edit, resolved by query rather than trusted
 * from the caller (T-04-11). Withdrawal is not deletion (D-17): a withdrawn
 * row keeps its slot, parked below every live sibling, so it can be
 * restored later and so a Cohort pinned to a snapshot that included it
 * still resolves.
 *
 * Built on `createResourceService`, exactly like `course-service.ts` — no
 * hand-written scope check.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import { nextAppendPosition, parkedWithdrawnPosition } from "@/lib/positions";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";

export type ModuleRecord = {
  id: string;
  courseId: string;
  title: string;
  summary: string | null;
  position: number;
  withdrawnAt: Date | null;
};

/** The subset of the real Prisma Module delegate this file uses. */
export type ModuleDelegate = Delegate<ModuleRecord>;

type WithPermissionFn = ReturnType<typeof createWithPermission>;

// NO position field — see <position_rule>. .strict() rejects one outright
// rather than silently dropping it.
const createModuleInputSchema = z
  .object({
    courseId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2000).optional(),
  })
  .strict();

export type CreateModuleServiceDeps = {
  delegate: ModuleDelegate;
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  /**
   * Groups a sibling read and a write into one unit of work. Injected so
   * tests can supply an in-memory fake delegate instead of a real Prisma
   * client — the same purpose `resource-service.ts`'s `runInTransaction`
   * serves for `archive`/`restore`. Defaults to running the callback
   * directly when omitted.
   */
  runInTransaction?: <R>(fn: () => Promise<R>) => Promise<R>;
};

/**
 * Builds the whole Module surface against injected dependencies, in the
 * style of `programme-service.ts`'s `createProgrammeMembershipOperations`,
 * so tests can supply an in-memory fake delegate rather than a real Prisma
 * client.
 */
export function createModuleService(deps: CreateModuleServiceDeps) {
  const { delegate } = deps;
  const runInTransaction = deps.runInTransaction ?? (<R,>(fn: () => Promise<R>) => fn());

  /**
   * A Module has no scope of its own — its parent Course id is read from
   * the database, never trusted from the caller (T-04-11). Resolves to a
   * denial (`{ courseIds: [] }`), not a throw, when the id is unknown.
   */
  async function moduleScope(id: string): Promise<ResourceScope> {
    const row = await delegate.findUnique({ where: { id } });
    return { courseIds: row ? [row.courseId] : [] };
  }

  const moduleService = createResourceService<ModuleRecord>({
    name: "Module",
    delegate,
    permissions: { view: "courses.view", create: "courses.edit", edit: "courses.edit" },
    toScope: moduleScope,
    withPermission: deps.withPermission,
    audit: deps.audit,
    runInTransaction: deps.runInTransaction,
    // The two qualifiers below are different on purpose — the asymmetry is
    // the whole mechanism, read twice before changing either.
    //
    // parkedWithdrawnPosition must see the minimum across ALL siblings,
    // including already-withdrawn ones, so each withdrawal parks one slot
    // deeper than the last. Scoping that minimum to live rows only would
    // make every withdrawal in a Course return the same parked slot and the
    // second one would collide on the total unique index.
    archiveData: async (id) => {
      const row = await delegate.findUnique({ where: { id } });
      const siblings = row ? await delegate.findMany({ where: { courseId: row.courseId } }) : [];
      const minPosition = siblings.length
        ? Math.min(...siblings.map((s) => s.position))
        : null;
      return { withdrawnAt: new Date(), position: parkedWithdrawnPosition(minPosition) };
    },
    // nextAppendPosition must see only LIVE siblings — including a parked
    // row here would pull the append back inside the withdrawn band.
    // `{ withdrawnAt: null }` alone is NOT an acceptable restore payload:
    // the old slot is very likely occupied by now, and the position index
    // is total, so a naive restore is a unique violation waiting to happen.
    restoreData: async (id) => {
      const row = await delegate.findUnique({ where: { id } });
      const liveSiblings = row
        ? (await delegate.findMany({ where: { courseId: row.courseId } })).filter(
            (s) => s.withdrawnAt === null,
          )
        : [];
      const maxPosition = liveSiblings.length
        ? Math.max(...liveSiblings.map((s) => s.position))
        : null;
      return { withdrawnAt: null, position: nextAppendPosition(maxPosition) };
    },
  });

  // The factory's raw `create` must never be the path any UI calls — it
  // would pass `data` straight through, including a client-chosen
  // position. This wrapper is the only path that computes it, inside one
  // unit of work with the sibling read.
  const createModule = deps.withPermission<{
    courseId: string;
    title: string;
    summary?: string;
  }>("courses.edit", (input) => ({ courseIds: [input.courseId] }))(async (input, ctx) => {
    const parsed = createModuleInputSchema.parse(input);

    const created = await runInTransaction(async () => {
      const liveSiblings = (
        await delegate.findMany({ where: { courseId: parsed.courseId } })
      ).filter((s) => s.withdrawnAt === null);
      const maxPosition = liveSiblings.length
        ? Math.max(...liveSiblings.map((s) => s.position))
        : null;
      const position = nextAppendPosition(maxPosition);

      return delegate.create({
        data: {
          courseId: parsed.courseId,
          title: parsed.title,
          summary: parsed.summary ?? null,
          position,
        },
      });
    });

    await deps.audit({
      action: "module.created",
      targetType: "Module",
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });

    return created;
  });

  const listActiveModules = deps.withPermission<string>(
    "courses.view",
    (courseId) => ({ courseIds: [courseId] }),
  )(async (courseId) => {
    const rows = await delegate.findMany({ where: { courseId } });
    return rows.filter((r) => r.withdrawnAt === null).sort((a, b) => a.position - b.position);
  });

  const listWithdrawnModules = deps.withPermission<string>(
    "courses.view",
    (courseId) => ({ courseIds: [courseId] }),
  )(async (courseId) => {
    const rows = await delegate.findMany({ where: { courseId } });
    return rows.filter((r) => r.withdrawnAt !== null).sort((a, b) => a.position - b.position);
  });

  return { moduleScope, moduleService, createModule, listActiveModules, listWithdrawnModules };
}

const built = createModuleService({
  delegate: prisma.module as unknown as ModuleDelegate,
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

export const moduleScope = built.moduleScope;
export const moduleService = built.moduleService;
export const createModule = built.createModule;
export const listActiveModules = built.listActiveModules;
export const listWithdrawnModules = built.listWithdrawnModules;
