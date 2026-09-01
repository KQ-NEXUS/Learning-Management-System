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

export const withPermission = createWithPermission({
  getActor: getCurrentActor,
  loadGrants: loadGrantsForUser,
  audit: recordAuthorizationAudit,
});

export { AuthenticationError, AuthorizationError } from "./with-permission";
export type { Actor, AuthorizedContext } from "./with-permission";
export { PERMISSIONS, isPermission, isGlobalOnly } from "./catalogue";
export type { Permission } from "./catalogue";
export { assertScopeAllowed, ScopeError } from "./scope";
export type { ResourceScope, ScopeType } from "./scope";
