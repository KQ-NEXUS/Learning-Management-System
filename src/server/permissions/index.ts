/**
 * The application's live `withPermission`.
 *
 * Import this in server actions and route handlers. The factory in
 * with-permission.ts stays dependency-free so the rules can be unit-tested;
 * this file is where the real session, grants, and audit sink are bound in.
 */

import { getCurrentActor } from "@/server/auth/current-actor";
import { loadGrantsForUser } from "@/server/services/grant-service";
import { recordAuthorizationAudit } from "@/server/services/audit-service";
import { createWithPermission } from "./with-permission";
import { hasPermission, isGrantActive, type ResourceScope } from "./scope";
import { collectionScopeFromGrants, type CollectionScopeSnapshot } from "./collection-scope";
import type { Permission } from "./catalogue";

export const withPermission = createWithPermission({
  getActor: getCurrentActor,
  loadGrants: loadGrantsForUser,
  audit: recordAuthorizationAudit,
});

/**
 * Non-throwing permission check for rendering — "should this control appear?".
 *
 * It is a courtesy, never a gate: the Server Action behind every control
 * re-checks through `withPermission` and refuses regardless (T-04-53). Returns
 * false for an anonymous caller.
 */
export async function can(
  permission: Permission,
  resource: ResourceScope,
): Promise<boolean> {
  const actor = await getCurrentActor();
  if (!actor) return false;
  const now = new Date();
  const grants = (await loadGrantsForUser(actor.userId))
    .filter((grant) => isGrantActive(grant, now))
    .map(({ permission: p, scopeType, scopeId }) => ({ permission: p, scopeType, scopeId }));
  return hasPermission(grants, permission, resource);
}

/**
 * Integration warning #1 — the union of the caller's active grants for a
 * permission, or null when they hold it nowhere. Like `can`, a rendering
 * courtesy (what to show, which rows to count); every action behind it still
 * re-checks through `withPermission`.
 */
export async function collectionScopeFor(permission: Permission): Promise<CollectionScopeSnapshot | null> {
  const actor = await getCurrentActor();
  if (!actor) return null;
  return collectionScopeFromGrants(await loadGrantsForUser(actor.userId), permission, new Date());
}

/**
 * Whether the caller holds `permission` at ANY scope. `can(permission, {})`
 * is true only for a GLOBAL grant; a cohort-scoped instructor needs this to
 * see the sections whose lists are filtered to their scope.
 */
export async function canAnywhere(permission: Permission): Promise<boolean> {
  return (await collectionScopeFor(permission)) !== null;
}

export { AuthenticationError, AuthorizationError } from "./with-permission";
export type { Actor, AuthorizedContext } from "./with-permission";
export { PERMISSIONS, isPermission, isGlobalOnly } from "./catalogue";
export type { Permission } from "./catalogue";
export { assertScopeAllowed, ScopeError } from "./scope";
export type { ResourceScope, ScopeType } from "./scope";
