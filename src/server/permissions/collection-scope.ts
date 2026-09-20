/**
 * Collection authorization for reports and exports.
 *
 * Unlike a single-resource `withPermission` check, reporting needs the union
 * of every active grant translated into a database predicate before any
 * aggregate, row, identifier, or filter option is selected. Callers never
 * provide scope identifiers; they come only from the actor's Assignment rows.
 */

import type { Permission } from "./catalogue";
import { isGrantActive, type ScopeType } from "./scope";
import {
  AuthenticationError,
  AuthorizationError,
  type Actor,
  type AuditEntry,
  type RawGrant,
} from "./with-permission";
import { getCurrentActor } from "@/server/auth/current-actor";
import { recordAuthorizationAudit } from "@/server/services/audit-service";
import { loadGrantsForUser } from "@/server/services/grant-service";

export type CollectionScopeSnapshot = Readonly<{
  kind: "GLOBAL" | "LIMITED";
  programmeIds: readonly string[];
  courseIds: readonly string[];
  cohortIds: readonly string[];
}>;

/** Prisma-compatible predicate for the Cohort model. */
export type CohortCollectionWhere = Readonly<Record<string, unknown>>;

export type CollectionAuthorization = Readonly<{
  actor: Actor;
  permission: Permission;
  scope: CollectionScopeSnapshot;
  cohortWhere: CohortCollectionWhere;
}>;

export type CollectionAuthorizationDeps = {
  getActor: () => Promise<Actor | null>;
  loadGrants: (userId: string) => Promise<RawGrant[]>;
  audit: (entry: AuditEntry) => Promise<void>;
  now?: () => Date;
};

function validScope(grant: RawGrant): grant is RawGrant & { scopeType: ScopeType } {
  if (grant.scopeType === "GLOBAL") return grant.scopeId === null;
  if (!(["PROGRAMME", "COURSE", "COHORT"] as const).includes(grant.scopeType)) return false;
  return typeof grant.scopeId === "string" && grant.scopeId.trim().length > 0;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export function collectionScopeFromGrants(
  grants: readonly RawGrant[],
  permission: Permission,
  now: Date = new Date(),
): CollectionScopeSnapshot | null {
  const trusted = grants.filter(
    (grant) => grant.permission === permission && isGrantActive(grant, now) && validScope(grant),
  );
  if (trusted.length === 0) return null;

  if (trusted.some((grant) => grant.scopeType === "GLOBAL")) {
    return Object.freeze({
      kind: "GLOBAL" as const,
      programmeIds: Object.freeze([]),
      courseIds: Object.freeze([]),
      cohortIds: Object.freeze([]),
    });
  }

  return Object.freeze({
    kind: "LIMITED" as const,
    programmeIds: uniqueSorted(
      trusted.flatMap((grant) =>
        grant.scopeType === "PROGRAMME" && grant.scopeId ? [grant.scopeId] : [],
      ),
    ),
    courseIds: uniqueSorted(
      trusted.flatMap((grant) =>
        grant.scopeType === "COURSE" && grant.scopeId ? [grant.scopeId] : [],
      ),
    ),
    cohortIds: uniqueSorted(
      trusted.flatMap((grant) =>
        grant.scopeType === "COHORT" && grant.scopeId ? [grant.scopeId] : [],
      ),
    ),
  });
}

export function cohortWhereForCollection(scope: CollectionScopeSnapshot): CohortCollectionWhere {
  if (scope.kind === "GLOBAL") return Object.freeze({});

  const clauses: Record<string, unknown>[] = [];
  if (scope.cohortIds.length > 0) clauses.push({ id: { in: [...scope.cohortIds] } });
  if (scope.programmeIds.length > 0) {
    clauses.push({ programmeId: { in: [...scope.programmeIds] } });
  }
  if (scope.courseIds.length > 0) {
    clauses.push(
      { courseId: { in: [...scope.courseIds] } },
      { cohortCourses: { some: { courseId: { in: [...scope.courseIds] } } } },
    );
  }

  // A LIMITED scope can only be constructed from at least one valid narrow
  // grant. Keep the impossible predicate as a defensive fail-closed fallback.
  return Object.freeze(clauses.length > 0 ? { OR: clauses } : { id: { in: [] } });
}

export function createCollectionAuthorizer(deps: CollectionAuthorizationDeps) {
  const now = deps.now ?? (() => new Date());

  return async function authorizeCollection(permission: Permission): Promise<CollectionAuthorization> {
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

    const scope = collectionScopeFromGrants(await deps.loadGrants(actor.userId), permission, now());
    if (!scope) {
      await deps.audit({
        action: "authorization.denied",
        outcome: "DENIED",
        actorId: actor.userId,
        permission,
        scopeType: null,
        scopeId: null,
        reason: "No active grant authorized this collection.",
      });
      throw new AuthorizationError(permission);
    }

    return Object.freeze({
      actor,
      permission,
      scope,
      cohortWhere: cohortWhereForCollection(scope),
    });
  };
}

export const authorizeCollection = createCollectionAuthorizer({
  getActor: getCurrentActor,
  loadGrants: loadGrantsForUser,
  audit: recordAuthorizationAudit,
});
