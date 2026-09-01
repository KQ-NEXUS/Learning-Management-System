/**
 * The resource service factory.
 *
 * Most of the PRD's domains — courses, modules, lessons, cohorts, tickets —
 * are the same shape: list, get, create, update, archive, each gated by a
 * permission and a scope, each auditing what it changed. Writing that per
 * domain produces a dozen chances to forget the scope check or the audit row.
 * Writing it once produces one.
 *
 * Two behaviours are deliberate and worth knowing before you use this:
 *
 *   1. There is no delete. PRD CAT-08 requires archiving that preserves
 *      historical enrolments, results, and certificates.
 *
 *   2. `list` with no scope requires a GLOBAL grant. A scoped user must say
 *      which scope they are listing within. This is deny-by-default applied
 *      to collections: the alternative — listing everything and filtering
 *      afterwards — leaks row counts and is the classic way scoped access
 *      becomes global access.
 */

import type { Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";

type WithPermission = ReturnType<typeof createWithPermission>;

/** The subset of a Prisma model delegate this factory uses. */
export type Delegate<T> = {
  findMany(args: { where?: unknown }): Promise<T[]>;
  findUnique(args: { where: { id: string } }): Promise<T | null>;
  create(args: { data: Record<string, unknown> }): Promise<T>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<T>;
};

export type ResourceAuditEntry = {
  action: string;
  targetType: string;
  targetId: string | null;
  actorId: string;
  outcome: string;
  reason: string | null;
  before?: unknown;
  after?: unknown;
};

export type ResourceServiceConfig<T> = {
  /** Used for audit action names and target type, e.g. "Course". */
  name: string;
  delegate: Delegate<T>;
  permissions: {
    view: Permission;
    create: Permission;
    edit: Permission;
  };
  /** Maps a record id to the scope a grant must match to reach it. */
  toScope: (id: string) => ResourceScope;
  withPermission: WithPermission;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
};

export function createResourceService<T extends { id: string }>(
  config: ResourceServiceConfig<T>,
) {
  const { name, delegate, permissions, toScope, withPermission, audit } = config;
  const slug = name.toLowerCase();

  const list = withPermission<{ where?: unknown; scope?: ResourceScope }>(
    permissions.view,
    (input) => input.scope ?? {},
  )(async (input) => delegate.findMany({ where: input.where }));

  const get = withPermission<string>(permissions.view, (id) => toScope(id))(
    async (id) => delegate.findUnique({ where: { id } }),
  );

  const create = withPermission<Record<string, unknown>>(
    permissions.create,
    () => ({}),
  )(async (data, ctx) => {
    const created = await delegate.create({ data });
    await audit({
      action: `${slug}.created`,
      targetType: name,
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });
    return created;
  });

  const update = withPermission<{
    id: string;
    data: Record<string, unknown>;
    reason?: string;
  }>(permissions.edit, (input) => toScope(input.id))(async (input, ctx) => {
    // Read before writing so the audit row carries both states (RBAC-08).
    const before = await delegate.findUnique({ where: { id: input.id } });
    const after = await delegate.update({ where: { id: input.id }, data: input.data });

    await audit({
      action: `${slug}.updated`,
      targetType: name,
      targetId: input.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: input.reason ?? null,
      before,
      after,
    });
    return after;
  });

  const archive = withPermission<{ id: string; reason: string }>(
    permissions.edit,
    (input) => toScope(input.id),
  )(async (input, ctx) => {
    const before = await delegate.findUnique({ where: { id: input.id } });
    const after = await delegate.update({
      where: { id: input.id },
      data: { status: "ARCHIVED" },
    });

    await audit({
      action: `${slug}.archived`,
      targetType: name,
      targetId: input.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: input.reason,
      before,
      after,
    });
    return after;
  });

  return {
    list: (input: { where?: unknown; scope?: ResourceScope } = {}) => list(input),
    get: (id: string) => get(id),
    create: (data: Record<string, unknown>) => create(data),
    update: (id: string, data: Record<string, unknown>, reason?: string) =>
      update({ id, data, reason }),
    archive: (id: string, reason: string) => archive({ id, reason }),
  };
}
