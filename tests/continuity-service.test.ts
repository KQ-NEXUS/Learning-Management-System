import { describe, expect, it } from "vitest";
import {
  assertRoleManagementContinuity,
  buildContinuityWhere,
  ContinuityError,
  CONTINUITY_BLOCK_MESSAGE,
  type ContinuityExclusion,
} from "@/server/services/continuity-service";

const now = new Date("2026-09-02T12:00:00Z");

const EXCLUSIONS: ContinuityExclusion[] = [
  { kind: "assignment", assignmentId: "a1" },
  { kind: "role", roleId: "r1" },
  { kind: "user", userId: "u1" },
];

describe("buildContinuityWhere", () => {
  it.each(EXCLUSIONS)("sets the right not-equal key and only that key for %o", (exclude) => {
    const where = buildContinuityWhere(exclude, now);

    if (exclude.kind === "assignment") {
      expect(where.id).toEqual({ not: exclude.assignmentId });
      expect(where.roleId).toBeUndefined();
      expect(where.userId).toBeUndefined();
    } else if (exclude.kind === "role") {
      expect(where.roleId).toEqual({ not: exclude.roleId });
      expect(where.id).toBeUndefined();
      expect(where.userId).toBeUndefined();
    } else {
      expect(where.userId).toEqual({ not: exclude.userId });
      expect(where.id).toBeUndefined();
      expect(where.roleId).toBeUndefined();
    }
  });

  it.each(EXCLUSIONS)("constrains scopeType to GLOBAL (D-25)", (exclude) => {
    expect(buildContinuityWhere(exclude, now).scopeType).toBe("GLOBAL");
  });

  it.each(EXCLUSIONS)(
    "requires the joined user's status to be ACTIVE — excludes deactivated administrators (RESEARCH Pitfall 1)",
    (exclude) => {
      expect(buildContinuityWhere(exclude, now).user).toEqual({ status: "ACTIVE" });
    },
  );

  it.each(EXCLUSIONS)("requires the joined role to be active and hold roles.manage", (exclude) => {
    expect(buildContinuityWhere(exclude, now).role).toEqual({
      active: true,
      permissions: { has: "roles.manage" },
    });
  });

  it("uses the injected now for the start/end window clauses", () => {
    const where = buildContinuityWhere({ kind: "user", userId: "u1" }, now);
    expect(where.AND).toEqual([
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ]);
  });
});

describe("assertRoleManagementContinuity", () => {
  const exclude: ContinuityExclusion = { kind: "user", userId: "u1" };

  it("resolves when the injected count returns one or more", async () => {
    await expect(
      assertRoleManagementContinuity(async () => 1, exclude, now),
    ).resolves.toBeUndefined();
  });

  it("resolves when the injected count returns many", async () => {
    await expect(
      assertRoleManagementContinuity(async () => 3, exclude, now),
    ).resolves.toBeUndefined();
  });

  it("rejects with ContinuityError when the injected count returns zero", async () => {
    await expect(assertRoleManagementContinuity(async () => 0, exclude, now)).rejects.toThrow(
      ContinuityError,
    );
  });

  it("throws a message strictly equal to CONTINUITY_BLOCK_MESSAGE", async () => {
    await expect(
      assertRoleManagementContinuity(async () => 0, exclude, now),
    ).rejects.toThrow(CONTINUITY_BLOCK_MESSAGE);
  });

  it("carries a message with no digits and no at-sign — no administrator identity can leak (D-26)", async () => {
    expect(CONTINUITY_BLOCK_MESSAGE).not.toMatch(/[0-9]/);
    expect(CONTINUITY_BLOCK_MESSAGE).not.toMatch(/@/);
  });
});
