/**
 * Shared test harness helpers.
 *
 * Generalises the `grant()` and `harness()` idioms that were duplicated
 * inside `tests/resource-service.test.ts` and `tests/with-permission.test.ts`
 * so new service tests (Programme, Module, Lesson) do not re-invent them.
 * Existing test files are left as-is — they pass today and rewriting them
 * is churn this plan does not need.
 */
import {
  createWithPermission,
  type AuditEntry,
  type RawGrant,
} from "@/server/permissions/with-permission";

/** Builds a valid, currently-active grant row for a given permission/scope. */
export function grant(
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant {
  return {
    permission: permission as RawGrant["permission"],
    scopeType,
    scopeId,
    active: true,
    revokedAt: null,
    startsAt: null,
    endsAt: null,
  };
}

/**
 * Builds a `withPermission` wired to a fixed set of grants for a single
 * actor, plus the array of audit entries it wrote. Injectable so callers
 * needing a non-default actor id may pass one via `opts.userId`.
 */
export function createTestWithPermission(
  grants: RawGrant[],
  opts?: { userId?: string },
) {
  const audits: AuditEntry[] = [];

  const withPermission = createWithPermission({
    getActor: async () => ({ userId: opts?.userId ?? "user-1" }),
    loadGrants: async () => grants,
    audit: async (entry) => {
      audits.push(entry);
    },
  });

  return { withPermission, audits };
}
