/**
 * Role administration.
 *
 * Not routed through `createResourceService` — its generic `archive()` writes
 * a hard-coded `status: "ARCHIVED"` value that `Role` does not have (`Role`
 * uses `active: boolean`), and role edits need a versioning transaction the
 * factory has no concept of. `list`/`get` still follow the factory's exact
 * shape; `create` hand-writes the transaction Pattern 3 in 02-RESEARCH.md
 * describes.
 *
 * `roleScope()` returns an empty `ResourceScope`. Role and User rows carry no
 * cohort/programme/course parent, so an empty resource is reachable only by a
 * GLOBAL grant — role administration is inherently global with no extra code.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { isPermission, type Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import { assertRoleManagementContinuity, lockRoleManagementContinuity, type ContinuityLockTx } from "@/server/services/continuity-service";

type WithPermission = ReturnType<typeof createWithPermission>;

/** D-13 — shared by the service and the client-side ConfirmModal so the two never drift. */
export const MIN_REASON_LENGTH = 10;

/** An empty resource — reachable only by a GLOBAL grant (Pattern 1). */
export function roleScope(): ResourceScope {
  return {};
}

export class InvalidPermissionSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPermissionSetError";
  }
}

/** Edge RBAC-02/concurrency — the optimistic lock on Role.version. */
export class RoleVersionConflictError extends Error {
  constructor() {
    super("This role changed since you loaded it. Reload and reapply your changes.");
    this.name = "RoleVersionConflictError";
  }
}

/** D-09 — removing a permission demands a reason; D-10 — adding one never does. */
export class ReasonRequiredError extends Error {
  constructor() {
    super(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
    this.name = "ReasonRequiredError";
  }
}

/**
 * Re-validates every identifier through the catalogue closure, never trusting
 * the picker UI's own constraint (RBAC-03, T-02-01). An empty array is valid —
 * the seeded Learner role has no permissions (D-03, edge RBAC-01/empty).
 */
export function validateRolePermissionSet(
  input: readonly string[],
): Permission[] {
  const unknown = input.filter((p) => !isPermission(p));
  if (unknown.length > 0) {
    throw new InvalidPermissionSetError(
      `Unknown permission identifier(s): ${unknown.join(", ")}`,
    );
  }

  if (new Set(input).size !== input.length) {
    throw new InvalidPermissionSetError(
      "Duplicate permission identifiers are not allowed.",
    );
  }

  return input as Permission[];
}

export type RoleRecord = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  version: number;
  permissions: string[];
  createdAt: Date;
};

export type CreateRoleInput = {
  name: string;
  description?: string | null;
  permissions: readonly string[];
};

export type UpdateRoleInput = {
  id: string;
  expectedVersion: number;
  name: string;
  description?: string | null;
  permissions: readonly string[];
  reason?: string | null;
};

export type SetRoleActiveInput = {
  id: string;
  active: boolean;
  reason?: string | null;
};

export type RoleVersionRecord = {
  id: string;
  roleId: string;
  version: number;
  name: string;
  description: string | null;
  permissions: string[];
  active: boolean;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
};

/** The narrow slice of the Prisma client this service actually uses. */
export type RoleStore = ContinuityLockTx & {
  role: {
    findMany(args?: { where?: unknown }): Promise<RoleRecord[]>;
    findUnique(args: { where: { id: string } }): Promise<RoleRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<RoleRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<RoleRecord>;
  };
  roleVersion: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where?: unknown; orderBy?: unknown }): Promise<RoleVersionRecord[]>;
  };
  assignment: {
    count(args: { where: unknown }): Promise<number>;
  };
  $transaction<T>(fn: (tx: RoleStore) => Promise<T>): Promise<T>;
};

export function createRoleService(deps: {
  store: RoleStore;
  withPermission: WithPermission;
  audit: (event: BusinessAuditEvent) => Promise<void>;
}) {
  const { store, withPermission: authorize, audit } = deps;

  const listInternal = authorize<Record<string, never>>(
    "roles.view",
    () => roleScope(),
  )(async () => store.role.findMany({}));

  const getInternal = authorize<string>("roles.view", () => roleScope())(
    async (id) => store.role.findUnique({ where: { id } }),
  );

  const createInternal = authorize<CreateRoleInput>(
    "roles.manage",
    () => roleScope(),
  )(async (input, ctx) => {
    const permissions = validateRolePermissionSet(input.permissions);

    const created = await store.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          active: true,
          isDefault: false,
          version: 1,
          permissions,
        },
      });

      // Two different tables for two different surfaces (Pattern 3): the
      // RoleVersion history and the AuditEvent trail are both written on
      // every create, never one in place of the other.
      await tx.roleVersion.create({
        data: {
          roleId: role.id,
          version: 1,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          active: role.active,
          reason: null,
          createdById: ctx.actor.userId,
        },
      });

      return role;
    });

    await audit({
      actorId: ctx.actor.userId,
      action: "role.created",
      targetType: "Role",
      targetId: created.id,
      after: created,
      reason: null,
      outcome: "SUCCESS",
    });

    return created;
  });

  // Not routed through createResourceService (RESEARCH Pitfall 2). D-39 —
  // isDefault influences nothing in update/setActive; a seeded default role
  // passes through exactly the same gates as a custom one.
  const updateInternal = authorize<UpdateRoleInput>(
    "roles.manage",
    () => roleScope(),
  )(async (input, ctx) => {
    const permissions = validateRolePermissionSet(input.permissions);
    const reason = input.reason?.trim() ?? "";
    const { before, after } = await store.$transaction(async (tx) => {
      await lockRoleManagementContinuity(tx);
      const current = await tx.role.findUnique({ where: { id: input.id } });
      if (!current) {
        throw new Error(`Role ${input.id} not found.`);
      }

      // Compare the version after waiting for any preceding role mutation.
      if (current.version !== input.expectedVersion) {
        throw new RoleVersionConflictError();
      }

      const nextPermissionSet = new Set<string>(permissions);
      const removed = current.permissions.filter((p) => !nextPermissionSet.has(p));
      // D-09/D-10/D-15 — a reduction demands one reason for the whole edit;
      // an addition-only edit demands none. Identical resubmissions are recorded.
      if (removed.length > 0 && reason.length < MIN_REASON_LENGTH) {
        throw new ReasonRequiredError();
      }

      const willLoseRolesManage =
        current.permissions.includes("roles.manage") && !permissions.includes("roles.manage");

      // D-24b — removing roles.manage from a role's permission set.
      if (willLoseRolesManage) {
        await assertRoleManagementContinuity(
          (where) => tx.assignment.count({ where }),
          { kind: "role", roleId: input.id },
        );
      }

      const nextVersion = current.version + 1;
      const updated = await tx.role.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description ?? null,
          permissions,
          version: nextVersion,
        },
      });

      // RoleVersion (product history) and AuditEvent (below) are two
      // different tables for two different surfaces (Pattern 3) — both
      // written on every edit, an identical resubmission included.
      await tx.roleVersion.create({
        data: {
          roleId: input.id,
          version: nextVersion,
          name: updated.name,
          description: updated.description,
          permissions: updated.permissions,
          active: updated.active,
          reason: reason || null,
          createdById: ctx.actor.userId,
        },
      });

      return { before: current, after: updated };
    });

    await audit({
      actorId: ctx.actor.userId,
      action: "role.updated",
      targetType: "Role",
      targetId: input.id,
      before,
      after,
      reason: reason || null,
      scopeType: "GLOBAL",
      scopeId: null,
      outcome: "SUCCESS",
    });

    return after;
  });

  const setActiveInternal = authorize<SetRoleActiveInput>(
    "roles.manage",
    () => roleScope(),
  )(async (input, ctx) => {
    const reason = input.reason?.trim() ?? "";
    // D-11 — deactivation demands a reason; reactivation demands none.
    if (!input.active && reason.length < MIN_REASON_LENGTH) {
      throw new ReasonRequiredError();
    }

    const { before, after } = await store.$transaction(async (tx) => {
      await lockRoleManagementContinuity(tx);
      const current = await tx.role.findUnique({ where: { id: input.id } });
      if (!current) throw new Error(`Role ${input.id} not found.`);
      const willLoseRolesManage = !input.active && current.permissions.includes("roles.manage");
      // D-24c — deactivating a role that grants roles.manage.
      if (willLoseRolesManage) {
        await assertRoleManagementContinuity(
          (where) => tx.assignment.count({ where }),
          { kind: "role", roleId: input.id },
        );
      }

      const nextVersion = current.version + 1;
      const updated = await tx.role.update({
        where: { id: input.id },
        data: { active: input.active, version: nextVersion },
      });

      await tx.roleVersion.create({
        data: {
          roleId: input.id,
          version: nextVersion,
          name: updated.name,
          description: updated.description,
          permissions: updated.permissions,
          active: updated.active,
          reason: reason || null,
          createdById: ctx.actor.userId,
        },
      });

      return { before: current, after: updated };
    });

    // Reactivation needs no per-assignment backfill: loadGrantsForUser joins
    // on the role's active flag at query time (`role: { active: true }`), so
    // flipping it back restores every previously-active assignment's grant
    // on the next authorization check (D-07's reversibility note describes
    // the cost of abandoning that live-join design, not of reactivating).
    await audit({
      actorId: ctx.actor.userId,
      action: input.active ? "role.reactivated" : "role.deactivated",
      targetType: "Role",
      targetId: input.id,
      before,
      after,
      reason: reason || null,
      scopeType: "GLOBAL",
      scopeId: null,
      outcome: "SUCCESS",
    });

    return after;
  });

  const versionsInternal = authorize<string>("roles.view", () => roleScope())(
    async (roleId) =>
      store.roleVersion.findMany({
        where: { roleId },
        orderBy: { version: "desc" },
      }),
  );

  const assignmentCountInternal = authorize<string>("roles.view", () => roleScope())(
    async (roleId) => {
      const now = new Date();
      return store.assignment.count({
        where: {
          roleId,
          active: true,
          revokedAt: null,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ],
        },
      });
    },
  );

  return {
    list: () => listInternal({}),
    get: (id: string) => getInternal(id),
    create: (input: CreateRoleInput) => createInternal(input),
    update: (input: UpdateRoleInput) => updateInternal(input),
    setActive: (input: SetRoleActiveInput) => setActiveInternal(input),
    versions: (roleId: string) => versionsInternal(roleId),
    assignmentCount: (roleId: string) => assignmentCountInternal(roleId),
  };
}

export const roleService = createRoleService({
  store: prisma as unknown as RoleStore,
  withPermission,
  audit: recordAudit,
});
