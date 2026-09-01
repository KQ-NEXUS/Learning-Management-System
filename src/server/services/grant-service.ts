/**
 * Loads a user's role assignments.
 *
 * Returns every assignment the user holds, active or not — filtering by
 * validity window is withPermission's job (PRD RBAC-04), kept there so the
 * rule is unit-tested in one place rather than embedded in a query.
 *
 * Permissions come from the Role's current permission list. A deactivated
 * Role grants nothing, so those rows are excluded here.
 */

import { prisma } from "@/server/db";
import type { Permission } from "@/server/permissions/catalogue";
import { isPermission } from "@/server/permissions/catalogue";
import type { RawGrant } from "@/server/permissions/with-permission";
import type { ScopeType } from "@/server/permissions/scope";

export async function loadGrantsForUser(userId: string): Promise<RawGrant[]> {
  const assignments = await prisma.assignment.findMany({
    where: {
      userId,
      role: { active: true },
    },
    select: {
      scopeType: true,
      scopeId: true,
      active: true,
      revokedAt: true,
      startsAt: true,
      endsAt: true,
      role: { select: { permissions: true } },
    },
  });

  return assignments.flatMap((assignment) =>
    assignment.role.permissions
      // Defensive: a permission retired from the catalogue must stop granting
      // access even while historical role rows still name it (RBAC-03).
      .filter(isPermission)
      .map((permission: Permission): RawGrant => ({
        permission,
        scopeType: assignment.scopeType as ScopeType,
        scopeId: assignment.scopeId,
        active: assignment.active,
        revokedAt: assignment.revokedAt,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
      })),
  );
}
