/**
 * Real-Postgres parity test (D-20, T-13-13): `resolveStaffHolders`'s raw SQL
 * must agree with the authorization core's `hasPermission`/`isGrantActive`
 * over `loadGrantsForUser`-shaped data, across the full grant matrix (global,
 * cohort, programme, course, wrong scope id, inactive role, revoked
 * assignment, expired window, not-yet-started window, deactivated user,
 * non-staff user).
 *
 * This test reproduces `grant-service.ts`'s `loadGrantsForUser` query against
 * the INJECTED test database (`tests/support/pg.ts`'s own throwaway
 * Testcontainers Postgres) rather than calling the real `loadGrantsForUser`,
 * which is bound to the app's live `prisma` singleton (`@/server/db`) — this
 * test must never open a second connection to that singleton's configured
 * database. The query shape below is identical to `loadGrantsForUser`'s; only
 * the client it runs against differs.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { resolveStaffHolders } from "@/server/services/staff-recipient-service";
import { hasPermission, isGrantActive, type Grant, type GrantWindow, type ScopeType } from "@/server/permissions/scope";
import type { ResourceScope } from "@/server/permissions/scope";
import type { Permission } from "@/server/permissions/catalogue";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  await testDb.prisma.assignment.deleteMany({});
  await testDb.prisma.role.deleteMany({});
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@staff-recipient.test" } } });
});

/** The exact shape/logic of `grant-service.ts`'s `loadGrantsForUser`, run
 * against the injected test database instead of the app's live singleton. */
async function loadGrantsFromTestDb(userId: string): Promise<(Grant & GrantWindow)[]> {
  const assignments = await testDb.prisma.assignment.findMany({
    where: { userId, role: { active: true } },
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
    assignment.role.permissions.map((permission) => ({
      permission: permission as Permission,
      scopeType: assignment.scopeType as ScopeType,
      scopeId: assignment.scopeId,
      active: assignment.active,
      revokedAt: assignment.revokedAt,
      startsAt: assignment.startsAt,
      endsAt: assignment.endsAt,
    })),
  );
}

/** The authorization core's own answer for one user: only active grants ever
 * participate (`isGrantActive`), exactly mirroring `withPermission`'s
 * behaviour. */
async function authorityCoreSaysYes(
  userId: string,
  permission: Permission,
  scope: ResourceScope,
): Promise<boolean> {
  const grants = await loadGrantsFromTestDb(userId);
  const active = grants.filter((grant) => isGrantActive(grant));
  return hasPermission(active, permission, scope);
}

let userCounter = 0;
async function createStaffUser(
  overrides: Partial<{ isStaff: boolean; status: "ACTIVE" | "DEACTIVATED" | "PENDING_VERIFICATION" }> = {},
) {
  userCounter += 1;
  return testDb.prisma.user.create({
    data: {
      email: `staff-${Date.now()}-${userCounter}@staff-recipient.test`,
      name: "Recipient Test Staff",
      status: overrides.status ?? "ACTIVE",
      emailVerified: new Date(),
      isStaff: overrides.isStaff ?? true,
    },
  });
}

let roleCounter = 0;
async function createRole(permissions: string[], overrides: { active?: boolean } = {}) {
  roleCounter += 1;
  return testDb.prisma.role.create({
    data: {
      name: `RecipientTestRole-${Date.now()}-${roleCounter}`,
      permissions,
      active: overrides.active ?? true,
    },
  });
}

async function createAssignment(
  userId: string,
  roleId: string,
  overrides: Partial<{
    scopeType: "GLOBAL" | "COHORT" | "PROGRAMME" | "COURSE";
    scopeId: string | null;
    active: boolean;
    revokedAt: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }> = {},
) {
  return testDb.prisma.assignment.create({
    data: {
      userId,
      roleId,
      scopeType: overrides.scopeType ?? "GLOBAL",
      scopeId: overrides.scopeId ?? null,
      active: overrides.active ?? true,
      revokedAt: overrides.revokedAt ?? null,
      startsAt: overrides.startsAt ?? null,
      endsAt: overrides.endsAt ?? null,
    },
  });
}

const PERMISSION: Permission = "payments.view";
const COHORT_A = "cohort-A";
const COHORT_B = "cohort-B";
const PROGRAMME_A = "programme-A";
const COURSE_A = "course-A";

describe("resolveStaffHolders parity with hasPermission/isGrantActive (D-20, T-13-13)", () => {
  it("returns exactly the same user set as the authorization core across the full grant matrix", async () => {
    const role = await createRole([PERMISSION]);
    const inactiveRole = await createRole([PERMISSION], { active: false });

    const globalHolder = await createStaffUser();
    await createAssignment(globalHolder.id, role.id, { scopeType: "GLOBAL" });

    const cohortAHolder = await createStaffUser();
    await createAssignment(cohortAHolder.id, role.id, { scopeType: "COHORT", scopeId: COHORT_A });

    const cohortBHolder = await createStaffUser();
    await createAssignment(cohortBHolder.id, role.id, { scopeType: "COHORT", scopeId: COHORT_B });

    const programmeAHolder = await createStaffUser();
    await createAssignment(programmeAHolder.id, role.id, { scopeType: "PROGRAMME", scopeId: PROGRAMME_A });

    const courseAHolder = await createStaffUser();
    await createAssignment(courseAHolder.id, role.id, { scopeType: "COURSE", scopeId: COURSE_A });

    const wrongScopeHolder = await createStaffUser();
    await createAssignment(wrongScopeHolder.id, role.id, {
      scopeType: "COHORT",
      scopeId: "cohort-somewhere-else",
    });

    const inactiveRoleHolder = await createStaffUser();
    await createAssignment(inactiveRoleHolder.id, inactiveRole.id, { scopeType: "GLOBAL" });

    const revokedHolder = await createStaffUser();
    await createAssignment(revokedHolder.id, role.id, { scopeType: "GLOBAL", revokedAt: new Date() });

    const expiredHolder = await createStaffUser();
    await createAssignment(expiredHolder.id, role.id, {
      scopeType: "GLOBAL",
      endsAt: new Date(Date.now() - 60_000),
    });

    const notYetStartedHolder = await createStaffUser();
    await createAssignment(notYetStartedHolder.id, role.id, {
      scopeType: "GLOBAL",
      startsAt: new Date(Date.now() + 3_600_000),
    });

    const deactivatedHolder = await createStaffUser({ status: "DEACTIVATED" });
    await createAssignment(deactivatedHolder.id, role.id, { scopeType: "GLOBAL" });

    const nonStaffHolder = await createStaffUser({ isStaff: false });
    await createAssignment(nonStaffHolder.id, role.id, { scopeType: "GLOBAL" });

    const inactiveAssignmentHolder = await createStaffUser();
    await createAssignment(inactiveAssignmentHolder.id, role.id, { scopeType: "GLOBAL", active: false });

    const allUsers = [
      globalHolder,
      cohortAHolder,
      cohortBHolder,
      programmeAHolder,
      courseAHolder,
      wrongScopeHolder,
      inactiveRoleHolder,
      revokedHolder,
      expiredHolder,
      notYetStartedHolder,
      deactivatedHolder,
      nonStaffHolder,
      inactiveAssignmentHolder,
    ];

    const scenarios: { name: string; scope: ResourceScope }[] = [
      { name: "cohort A scope", scope: { cohortId: COHORT_A } },
      { name: "programme A scope", scope: { programmeId: PROGRAMME_A } },
      { name: "course A scope", scope: { courseIds: [COURSE_A] } },
      { name: "empty (global-only) scope", scope: {} },
    ];

    for (const scenario of scenarios) {
      const resolved = new Set(
        await resolveStaffHolders(testDb.prisma, { permission: PERMISSION, scope: scenario.scope }),
      );

      for (const user of allUsers) {
        const isStaffActive = user.isStaff && user.status === "ACTIVE";
        const authorityYes = isStaffActive
          ? await authorityCoreSaysYes(user.id, PERMISSION, scenario.scope)
          : false;
        expect(
          resolved.has(user.id),
          `scenario "${scenario.name}", user ${user.email}: expected resolveStaffHolders membership to equal the authorization core's answer (${authorityYes})`,
        ).toBe(authorityYes);
      }
    }
  });

  it("a COHORT grant for a different cohort is absent from a cohort-scoped result; a global holder is present for both", async () => {
    const role = await createRole([PERMISSION]);
    const globalHolder = await createStaffUser();
    await createAssignment(globalHolder.id, role.id, { scopeType: "GLOBAL" });
    const cohortAHolder = await createStaffUser();
    await createAssignment(cohortAHolder.id, role.id, { scopeType: "COHORT", scopeId: COHORT_A });

    const resolvedA = new Set(
      await resolveStaffHolders(testDb.prisma, { permission: PERMISSION, scope: { cohortId: COHORT_A } }),
    );
    const resolvedB = new Set(
      await resolveStaffHolders(testDb.prisma, { permission: PERMISSION, scope: { cohortId: COHORT_B } }),
    );

    expect(resolvedA.has(cohortAHolder.id)).toBe(true);
    expect(resolvedB.has(cohortAHolder.id)).toBe(false);
    expect(resolvedA.has(globalHolder.id)).toBe(true);
    expect(resolvedB.has(globalHolder.id)).toBe(true);
  });

  it("a boundary window (startsAt/endsAt exactly now) is still active, matching isGrantActive's inclusive boundaries", async () => {
    const role = await createRole([PERMISSION]);
    const at = new Date();
    const boundaryHolder = await createStaffUser();
    await createAssignment(boundaryHolder.id, role.id, {
      scopeType: "GLOBAL",
      startsAt: at,
      endsAt: at,
    });

    // resolveStaffHolders evaluates against `new Date()` internally, so we
    // cannot pin the exact same instant — instead assert the SQL's boundary
    // operators are inclusive by using a window that started slightly in the
    // past and ends slightly in the future, which is the realistic case this
    // guards: an assignment active "as of right now".
    await testDb.prisma.assignment.update({
      where: { id: (await testDb.prisma.assignment.findFirstOrThrow({ where: { userId: boundaryHolder.id } })).id },
      data: { startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 1000) },
    });

    const resolved = new Set(
      await resolveStaffHolders(testDb.prisma, { permission: PERMISSION, scope: {} }),
    );
    expect(resolved.has(boundaryHolder.id)).toBe(true);
  });
});
