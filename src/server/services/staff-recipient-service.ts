/**
 * Drain-safe staff recipient resolution (D-20, T-13-13).
 *
 * The domain-event drain runs off-request (a Netlify scheduled function) and
 * cannot import the request-scoped `withPermission` choke point —
 * `tests/boundary.test.ts` enforces that its runtime import closure never
 * reaches `@/server/permissions` or its submodules. This module reproduces
 * the SAME grant-matching rules the authorization core applies
 * (`grantMatches` / `hasPermission` / `isGrantActive` in
 * `src/server/permissions/scope.ts`) as one parameterised SQL query, so a
 * staff member is alerted about a record only if they could actually open it
 * through the real, request-scoped path — nobody is alerted about a record
 * they could not open (D-20).
 *
 * This file imports the permission layer's TYPES ONLY (`Permission`,
 * `ResourceScope`) via `import type` — never a value from
 * `@/server/permissions` or its submodules, so the boundary rule holds.
 * `tests/staff-recipient-service.test.ts` is the real-Postgres parity test
 * proving this SQL agrees with `hasPermission` over `loadGrantsForUser`
 * across the full grant matrix (global, cohort, programme, course, wrong
 * scope id, inactive role, revoked, expired, not-yet-started, deactivated,
 * non-staff).
 *
 * A GLOBAL assignment always matches. A COHORT/PROGRAMME/COURSE assignment
 * matches only when the caller's `ResourceScope` actually carries the
 * matching id — a scope field left `undefined` omits that branch entirely
 * rather than being treated as a wildcard, mirroring `grantMatches`'s own
 * "an absent scope denies" rule.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type { Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";

/** The narrow client shape this module needs — a real `PrismaClient` or a
 * `$transaction` callback's `tx`, so a mapper can resolve holders inside the
 * SAME transaction the drain already opened. */
export type StaffRecipientDb = PrismaClient | Prisma.TransactionClient;

type StaffHolderRow = { id: string };

async function queryStaffHolders(
  db: StaffRecipientDb,
  params: { permission: Permission; scope: ResourceScope },
  at: Date,
): Promise<string[]> {
  const scopeBranches: Prisma.Sql[] = [Prisma.sql`a."scopeType" = 'GLOBAL'`];

  if (params.scope.cohortId !== undefined) {
    scopeBranches.push(
      Prisma.sql`(a."scopeType" = 'COHORT' AND a."scopeId" = ${params.scope.cohortId})`,
    );
  }
  if (params.scope.programmeId !== undefined) {
    scopeBranches.push(
      Prisma.sql`(a."scopeType" = 'PROGRAMME' AND a."scopeId" = ${params.scope.programmeId})`,
    );
  }
  if (params.scope.courseIds !== undefined && params.scope.courseIds.length > 0) {
    scopeBranches.push(
      Prisma.sql`(a."scopeType" = 'COURSE' AND a."scopeId" = ANY(${params.scope.courseIds}))`,
    );
  }

  const rows = await db.$queryRaw<StaffHolderRow[]>(Prisma.sql`
    SELECT DISTINCT u.id
    FROM "User" u
    JOIN "Assignment" a ON a."userId" = u.id
    JOIN "Role" r ON r.id = a."roleId"
    WHERE u."isStaff" = TRUE
      AND u.status = 'ACTIVE'
      AND a.active = TRUE
      AND a."revokedAt" IS NULL
      AND (a."startsAt" IS NULL OR a."startsAt" <= ${at})
      AND (a."endsAt" IS NULL OR a."endsAt" >= ${at})
      AND r.active = TRUE
      AND ${params.permission} = ANY(r.permissions)
      AND (${Prisma.join(scopeBranches, " OR ")})
    ORDER BY u.id
  `);

  return rows.map((row) => row.id);
}

/**
 * Resolves every active staff user (`isStaff`, `status = ACTIVE`) whose live,
 * in-window, unrevoked assignment on an active role grants `permission` at
 * GLOBAL scope or at a scope `scope` reaches (D-20). Evaluated against the
 * real current time — see `createStaffRecipientResolver` for a fixed-clock
 * variant a test can use.
 */
export function resolveStaffHolders(
  db: StaffRecipientDb,
  params: { permission: Permission; scope: ResourceScope },
): Promise<string[]> {
  return queryStaffHolders(db, params, new Date());
}

export type CreateStaffRecipientResolverDeps = {
  now?: () => Date;
};

/**
 * Factory variant of `resolveStaffHolders` for callers that need a fixed or
 * injectable clock (a test proving the not-yet-started / expired-window
 * cases against a deterministic instant) rather than the real one
 * `resolveStaffHolders` always uses.
 */
export function createStaffRecipientResolver(deps: CreateStaffRecipientResolverDeps = {}) {
  const now = deps.now ?? (() => new Date());
  return {
    resolveStaffHolders: (
      db: StaffRecipientDb,
      params: { permission: Permission; scope: ResourceScope },
    ): Promise<string[]> => queryStaffHolders(db, params, now()),
  };
}
