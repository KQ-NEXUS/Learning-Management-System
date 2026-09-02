/**
 * Assignment lifecycle — grant and revoke, nothing else.
 *
 * Not routed through `createResourceService`, which has no concept of
 * revocation. Assignments are immutable once created (D-23): a scope or
 * end-date change is always revoke-old plus create-new, so there is no
 * `update` method here, deliberately.
 */

import { prisma } from "@/server/db";
import {
  withPermission,
  assertScopeAllowed,
  ScopeError,
  type Permission,
  type ResourceScope,
  type ScopeType,
} from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import { assertRoleManagementContinuity } from "@/server/services/continuity-service";
import { MIN_REASON_LENGTH } from "@/server/services/role-service";

export { MIN_REASON_LENGTH };

type WithPermission = ReturnType<typeof createWithPermission>;

/**
 * Mirrors `courseScope`'s shape. A non-GLOBAL type with a null scopeId is a
 * caller error — throwing here (rather than degrading to an empty object)
 * matters because an empty object is exactly the shape a GLOBAL grant
 * reaches; silently widening a scoped request into a global one is the
 * escalation `grantMatches` exists to prevent.
 */
export function assignmentTargetScope(
  scopeType: ScopeType,
  scopeId: string | null,
): ResourceScope {
  if (scopeType === "GLOBAL") return {};

  if (!scopeId) {
    throw new ScopeError(`A ${scopeType}-scoped assignment requires a scopeId.`);
  }

  switch (scopeType) {
    case "PROGRAMME":
      return { programmeId: scopeId };
    case "COURSE":
      return { courseIds: [scopeId] };
    case "COHORT":
      return { cohortId: scopeId };
    default:
      throw new ScopeError(`Unknown scope type: ${scopeType satisfies never}`);
  }
}

/** D-14 — revoking an assignment now demands a reason, same MIN_REASON_LENGTH as roles. */
export class AssignmentReasonRequiredError extends Error {
  constructor() {
    super(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
    this.name = "AssignmentReasonRequiredError";
  }
}

export type AssignmentRecord = {
  id: string;
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
  revokedAt: Date | null;
  revokedById: string | null;
};

type RoleForAssignment = { id: string; active: boolean; permissions: string[] };

export type CreateAssignmentInput = {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  endsAt?: Date | null;
  reason?: string | null;
};

export type RevokeAssignmentInput = {
  assignmentId: string;
  reason: string;
};

export type AssignmentWithRole = AssignmentRecord & { role: { id: string; name: string; active: boolean } };

/** The narrow slice of the Prisma client this service actually uses. */
export type AssignmentStore = {
  assignment: {
    findUnique(
      args: Record<string, unknown>,
    ): Promise<(AssignmentRecord & { role: RoleForAssignment }) | null>;
    findMany(args: Record<string, unknown>): Promise<AssignmentWithRole[]>;
    create(args: { data: Record<string, unknown> }): Promise<AssignmentRecord>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AssignmentRecord>;
    count(args: { where: unknown }): Promise<number>;
  };
  role: {
    findUnique(args: Record<string, unknown>): Promise<RoleForAssignment | null>;
  };
  $transaction<T>(fn: (tx: AssignmentStore) => Promise<T>): Promise<T>;
};

export function createAssignmentService(deps: {
  store: AssignmentStore;
  withPermission: WithPermission;
  audit: (event: BusinessAuditEvent) => Promise<void>;
}) {
  const { store, withPermission: authorize, audit } = deps;

  // The caller's own grant must reach the target scope — this is what stops
  // a Programme-scoped administrator granting globally (T-02-16).
  const createInternal = authorize<CreateAssignmentInput>(
    "roles.manage",
    (input) => assignmentTargetScope(input.scopeType, input.scopeId),
  )(async (input, ctx) => {
    const role = await store.role.findUnique({ where: { id: input.roleId } });
    if (!role || !role.active) {
      throw new Error("Role not found or inactive.");
    }

    // T-02-02 — a role bundling a global-only permission cannot be granted
    // below global scope. Checked for every permission the role carries.
    for (const permission of role.permissions) {
      assertScopeAllowed(permission as Permission, input.scopeType);
    }

    const created = await store.assignment.create({
      data: {
        userId: input.userId,
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        active: true,
        // D-20 — immediate start only; a caller-supplied start is never
        // accepted.
        startsAt: new Date(),
        endsAt: input.endsAt ?? null,
        reason: input.reason ?? null,
        createdById: ctx.actor.userId,
      },
    });

    await audit({
      actorId: ctx.actor.userId,
      action: "assignment.created",
      targetType: "Assignment",
      targetId: created.id,
      after: created,
      reason: input.reason ?? null,
      // RESEARCH Pitfall 3 — the assignment's own scope, never blank.
      scopeType: created.scopeType,
      scopeId: created.scopeId,
      outcome: "SUCCESS",
    });

    return created;
  });

  // Authority is checked against the assignment's REAL stored scope, not
  // anything the caller asserted.
  const revokeInternal = authorize<RevokeAssignmentInput>(
    "roles.manage",
    async (input) => {
      const assignment = await store.assignment.findUnique({
        where: { id: input.assignmentId },
      });
      if (!assignment) throw new Error(`Assignment ${input.assignmentId} not found.`);
      return assignmentTargetScope(assignment.scopeType, assignment.scopeId);
    },
  )(async (input, ctx) => {
    const reason = input.reason.trim();
    if (reason.length < MIN_REASON_LENGTH) {
      throw new AssignmentReasonRequiredError();
    }

    const current = await store.assignment.findUnique({
      where: { id: input.assignmentId },
      include: { role: { select: { id: true, active: true, permissions: true } } },
    });
    if (!current) {
      throw new Error(`Assignment ${input.assignmentId} not found.`);
    }

    // Already revoked — return unchanged rather than writing a second
    // revocation.
    if (current.revokedAt !== null) {
      return current;
    }

    const willLoseRolesManage =
      current.scopeType === "GLOBAL" && current.role.permissions.includes("roles.manage");

    const { before, after } = await store.$transaction(async (tx) => {
      // D-24a — revoking an assignment that grants roles.manage.
      if (willLoseRolesManage) {
        await assertRoleManagementContinuity(
          (where) => tx.assignment.count({ where }),
          { kind: "assignment", assignmentId: input.assignmentId },
        );
      }

      // Updates exactly this one row by id — never updateMany, never a
      // filter that could match a sibling (RBAC-04, edge RBAC-04/unclassified).
      const updated = await tx.assignment.update({
        where: { id: input.assignmentId },
        data: {
          revokedAt: new Date(),
          revokedById: ctx.actor.userId,
          active: false,
          reason,
        },
      });

      return { before: current, after: updated };
    });

    await audit({
      actorId: ctx.actor.userId,
      action: "assignment.revoked",
      targetType: "Assignment",
      targetId: input.assignmentId,
      before,
      after,
      reason,
      scopeType: after.scopeType,
      scopeId: after.scopeId,
      outcome: "SUCCESS",
    });

    return after;
  });

  const listForUserInternal = authorize<string>("users.view", () => ({}))(
    async (userId) =>
      store.assignment.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { role: { select: { id: true, name: true, active: true } } },
      }),
  );

  return {
    create: (input: CreateAssignmentInput) => createInternal(input),
    revoke: (input: RevokeAssignmentInput) => revokeInternal(input),
    listForUser: (userId: string) => listForUserInternal(userId),
  };
}

export const assignmentService = createAssignmentService({
  store: prisma as unknown as AssignmentStore,
  withPermission,
  audit: recordAudit,
});
