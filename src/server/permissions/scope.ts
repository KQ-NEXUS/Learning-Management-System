/**
 * Scope matching — the pure core of authorization.
 *
 * PRD RBAC-04 and RBAC-05: a user's effective access is the union of active
 * role assignments whose scope matches the requested resource or one of its
 * documented parents. An absent, inactive, expired, revoked, or out-of-scope
 * grant is a denial (RBAC-06).
 *
 * Everything here is a pure function of its arguments so the rules can be
 * tested exhaustively without a database. Loading grants and resolving a
 * resource's ancestry are separate concerns — see with-permission.ts.
 */

import { isGlobalOnly, type Permission } from "./catalogue";

export type ScopeType = "GLOBAL" | "PROGRAMME" | "COURSE" | "COHORT";

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

/** One row of authority: a permission granted at a scope. */
export type Grant = {
  permission: Permission;
  scopeType: ScopeType;
  /** Null only when scopeType is GLOBAL. */
  scopeId: string | null;
};

/**
 * The requested resource expressed as the scopes a grant could match.
 *
 * A cohort resolves to its own id plus the programme and courses it
 * delivers, so a Programme- or Course-scoped grant reaches it. Callers build
 * this from the database; matching never queries.
 */
export type ResourceScope = {
  cohortId?: string;
  programmeId?: string;
  courseIds?: string[];
};

/** The shape of an assignment's validity window. */
export type GrantWindow = {
  active: boolean;
  revokedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

/**
 * Whether a single grant reaches a resource.
 *
 * A GLOBAL grant reaches everything. A narrower grant must name an id the
 * resource actually carries — a scoped grant with no scopeId reaches nothing,
 * because treating it as global is the failure mode that turns a mistake into
 * a privilege escalation.
 */
export function grantMatches(grant: Grant, resource: ResourceScope): boolean {
  if (grant.scopeType === "GLOBAL") return true;
  if (!grant.scopeId) return false;

  switch (grant.scopeType) {
    case "COHORT":
      return resource.cohortId === grant.scopeId;
    case "PROGRAMME":
      return resource.programmeId === grant.scopeId;
    case "COURSE":
      return resource.courseIds?.includes(grant.scopeId) ?? false;
    default:
      return false;
  }
}

/**
 * Whether any grant authorizes this permission on this resource.
 *
 * Deny by default: an empty grant list is always a denial.
 */
export function hasPermission(
  grants: readonly Grant[],
  permission: Permission,
  resource: ResourceScope,
): boolean {
  return grants.some(
    (grant) => grant.permission === permission && grantMatches(grant, resource),
  );
}

/**
 * Whether an assignment is currently in force.
 *
 * Checked separately from scope so an expired grant is never even considered
 * for matching.
 */
export function isGrantActive(window: GrantWindow, now: Date = new Date()): boolean {
  if (!window.active) return false;
  if (window.revokedAt !== null) return false;
  if (window.startsAt !== null && window.startsAt > now) return false;
  if (window.endsAt !== null && window.endsAt < now) return false;
  return true;
}

/**
 * Guards assignment creation: some permissions may only be granted globally
 * (PRD §18.4). Called when a role is assigned, not when it is exercised.
 */
export function assertScopeAllowed(permission: Permission, scopeType: ScopeType): void {
  if (scopeType !== "GLOBAL" && isGlobalOnly(permission)) {
    throw new ScopeError(
      `${permission} may only be granted at global scope, not ${scopeType}.`,
    );
  }
}
