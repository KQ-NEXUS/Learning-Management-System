/**
 * Kept OUT of `harness.ts` on purpose: `collection-scope.ts` imports the live
 * audit and grant services, which load the app's Prisma singleton. Several
 * integration files import `harness.ts` statically and only point
 * DATABASE_URL at their test container in `beforeAll`, so anything in
 * `harness.ts` that loads the singleton would bind it to the real database.
 */
import type { AuditEntry, RawGrant } from "@/server/permissions/with-permission";
import { createCollectionAuthorizer } from "@/server/permissions/collection-scope";

/**
 * Integration warning #1 — the collection-list counterpart of
 * `createTestWithPermission`: an `authorizeCollection` for a fixed set of
 * grants, so a list can be proven to return only rows inside the scope.
 */
export function createTestCollectionAuthorizer(grants: RawGrant[], opts?: { userId?: string }) {
  const audits: AuditEntry[] = [];
  const authorizeCollection = createCollectionAuthorizer({
    getActor: async () => ({ userId: opts?.userId ?? "user-1" }),
    loadGrants: async () => grants,
    audit: async (entry) => {
      audits.push(entry);
    },
  });
  return { authorizeCollection, audits };
}
