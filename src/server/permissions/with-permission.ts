/**
 * withPermission — the single authorization choke point.
 *
 * Every protected server action is wrapped by this. It is simultaneously the
 * authorization check (PRD RBAC-06, NFR-05), the denial audit hook (RBAC-08),
 * and the reason authorization logic is written once rather than per feature.
 *
 * Usage:
 *
 *   export const publishCourse = withPermission(
 *     "courses.publish",
 *     async (input: { courseId: string }) => ({ courseIds: [input.courseId] }),
 *   )(async (input, ctx) => {
 *     // ctx.actor is authenticated, ctx.resource is the matched scope
 *   });
 *
 * The App Router exposes four independent entry points — server components,
 * route handlers, server actions, and middleware. Securing three of four is
 * indistinguishable from securing none, so nothing reaches data without
 * passing through here.
 */

import type { Permission } from "./catalogue";
import {
  hasPermission,
  isGrantActive,
  type Grant,
  type GrantWindow,
  type ResourceScope,
  type ScopeType,
} from "./scope";

export class AuthenticationError extends Error {
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission) {
    // Deliberately does not reveal whether the resource exists — a denial
    // message must not become an enumeration oracle.
    super("You do not have access to perform this action.");
    this.name = "AuthorizationError";
    this.permission = permission;
  }
}

// isStaff is a presentation hint only, optional so no existing Actor
// construction stops compiling — used to choose the post-sign-in redirect
// (D-15) and the staff-layout guard (D-18), never as an authorization
// input. Authority always comes from Assignment rows resolved through
// withPermission.
export type Actor = { userId: string; isStaff?: boolean };

/** An assignment row: a grant plus its validity window. */
export type RawGrant = Grant & GrantWindow;

export type AuditEntry = {
  action: string;
  outcome: "DENIED" | "ALLOWED";
  actorId: string | null;
  permission: Permission;
  scopeType: ScopeType | null;
  scopeId: string | null;
  reason: string;
};

export type WithPermissionDeps = {
  /** Resolves the signed-in user, or null when anonymous. */
  getActor: () => Promise<Actor | null>;
  /** Loads every assignment held by the user, active or not. */
  loadGrants: (userId: string) => Promise<RawGrant[]>;
  /** Writes an audit event. Called on denial. */
  audit: (entry: AuditEntry) => Promise<void>;
  now?: () => Date;
};

export type AuthorizedContext = {
  actor: Actor;
  resource: ResourceScope;
  grants: readonly Grant[];
};

type ScopeResolver<TInput> = (
  input: TInput,
) => ResourceScope | Promise<ResourceScope>;

type Handler<TInput, TOutput> = (
  input: TInput,
  ctx: AuthorizedContext,
) => Promise<TOutput>;

/**
 * Builds a `withPermission` bound to concrete dependencies.
 *
 * Injecting them keeps the rules testable without a database or a session,
 * and keeps this module free of framework imports.
 */
export function createWithPermission(deps: WithPermissionDeps) {
  const now = deps.now ?? (() => new Date());

  return function withPermission<TInput>(
    permission: Permission,
    resolveScope: ScopeResolver<TInput>,
  ) {
    return function wrap<TOutput>(handler: Handler<TInput, TOutput>) {
      return async function authorized(input: TInput): Promise<TOutput> {
        const actor = await deps.getActor();

        if (!actor) {
          await deps.audit({
            action: "authorization.denied",
            outcome: "DENIED",
            actorId: null,
            permission,
            scopeType: null,
            scopeId: null,
            reason: "No authenticated actor.",
          });
          throw new AuthenticationError();
        }

        // Resolved before the check so the scope reflects the real record and
        // its parents, not something the caller asserted.
        const resource = await resolveScope(input);

        const grants: Grant[] = (await deps.loadGrants(actor.userId))
          .filter((grant) => isGrantActive(grant, now()))
          .map(({ permission: p, scopeType, scopeId }) => ({
            permission: p,
            scopeType,
            scopeId,
          }));

        if (!hasPermission(grants, permission, resource)) {
          await deps.audit({
            action: "authorization.denied",
            outcome: "DENIED",
            actorId: actor.userId,
            permission,
            scopeType: null,
            scopeId: resource.cohortId ?? resource.programmeId ?? null,
            reason: "No active grant matched the requested resource.",
          });
          throw new AuthorizationError(permission);
        }

        // Successful authorization is not itself audited — the service layer
        // audits the business action, which carries far more useful detail
        // than "someone was allowed to try".
        return handler(input, { actor, resource, grants });
      };
    };
  };
}
