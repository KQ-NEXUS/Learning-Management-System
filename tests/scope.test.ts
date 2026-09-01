import { describe, expect, it } from "vitest";
import {
  grantMatches,
  hasPermission,
  isGrantActive,
  assertScopeAllowed,
  ScopeError,
  type Grant,
  type ResourceScope,
} from "@/server/permissions/scope";

const global = (permission: string): Grant => ({
  permission: permission as Grant["permission"],
  scopeType: "GLOBAL",
  scopeId: null,
});

const scoped = (
  permission: string,
  scopeType: Grant["scopeType"],
  scopeId: string,
): Grant => ({
  permission: permission as Grant["permission"],
  scopeType,
  scopeId,
});

// A cohort delivering programme P, which contains courses C1 and C2.
const programmeCohort: ResourceScope = {
  cohortId: "cohort-1",
  programmeId: "prog-1",
  courseIds: ["course-1", "course-2"],
};

// A cohort delivering standalone course C9.
const standaloneCohort: ResourceScope = {
  cohortId: "cohort-9",
  courseIds: ["course-9"],
};

describe("grantMatches", () => {
  it("matches everything when the grant is global", () => {
    expect(grantMatches(global("cohorts.manage"), programmeCohort)).toBe(true);
    expect(grantMatches(global("cohorts.manage"), {})).toBe(true);
  });

  it("matches a cohort grant only against that cohort", () => {
    const g = scoped("cohorts.manage", "COHORT", "cohort-1");
    expect(grantMatches(g, programmeCohort)).toBe(true);
    expect(grantMatches(g, standaloneCohort)).toBe(false);
  });

  it("matches a programme grant against a cohort in that programme", () => {
    const g = scoped("cohorts.manage", "PROGRAMME", "prog-1");
    expect(grantMatches(g, programmeCohort)).toBe(true);
    expect(grantMatches(g, standaloneCohort)).toBe(false);
  });

  it("matches a course grant against a cohort delivering that course", () => {
    expect(
      grantMatches(scoped("courses.edit", "COURSE", "course-2"), programmeCohort),
    ).toBe(true);
    expect(
      grantMatches(scoped("courses.edit", "COURSE", "course-9"), programmeCohort),
    ).toBe(false);
  });

  it("denies a scoped grant when the resource carries no such ancestor", () => {
    expect(
      grantMatches(scoped("cohorts.manage", "PROGRAMME", "prog-1"), {
        cohortId: "cohort-9",
      }),
    ).toBe(false);
  });

  it("denies a scoped grant whose scopeId is missing", () => {
    const malformed: Grant = {
      permission: "cohorts.manage",
      scopeType: "COHORT",
      scopeId: null,
    };
    expect(grantMatches(malformed, programmeCohort)).toBe(false);
  });
});

describe("hasPermission", () => {
  it("denies by default when there are no grants", () => {
    expect(hasPermission([], "cohorts.manage", programmeCohort)).toBe(false);
  });

  it("denies when the permission does not match", () => {
    expect(
      hasPermission([global("cohorts.view")], "cohorts.manage", programmeCohort),
    ).toBe(false);
  });

  it("allows when one grant of many matches", () => {
    const grants = [
      scoped("cohorts.manage", "COHORT", "cohort-other"),
      scoped("cohorts.manage", "PROGRAMME", "prog-1"),
      global("tickets.view"),
    ];
    expect(hasPermission(grants, "cohorts.manage", programmeCohort)).toBe(true);
  });

  it("denies when every grant is out of scope", () => {
    const grants = [
      scoped("cohorts.manage", "COHORT", "cohort-other"),
      scoped("cohorts.manage", "COURSE", "course-other"),
    ];
    expect(hasPermission(grants, "cohorts.manage", programmeCohort)).toBe(false);
  });
});

describe("isGrantActive", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("accepts a grant with no window", () => {
    expect(
      isGrantActive({ active: true, revokedAt: null, startsAt: null, endsAt: null }, now),
    ).toBe(true);
  });

  it("rejects an inactive grant", () => {
    expect(
      isGrantActive({ active: false, revokedAt: null, startsAt: null, endsAt: null }, now),
    ).toBe(false);
  });

  it("rejects a revoked grant", () => {
    expect(
      isGrantActive(
        { active: true, revokedAt: new Date("2026-08-01"), startsAt: null, endsAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("rejects a grant that has not started", () => {
    expect(
      isGrantActive(
        { active: true, revokedAt: null, startsAt: new Date("2026-10-01"), endsAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("rejects an expired grant", () => {
    expect(
      isGrantActive(
        { active: true, revokedAt: null, startsAt: null, endsAt: new Date("2026-08-01") },
        now,
      ),
    ).toBe(false);
  });

  it("accepts a grant inside its window", () => {
    expect(
      isGrantActive(
        {
          active: true,
          revokedAt: null,
          startsAt: new Date("2026-08-01"),
          endsAt: new Date("2026-10-01"),
        },
        now,
      ),
    ).toBe(true);
  });
});

describe("assertScopeAllowed", () => {
  it("permits a scopeable permission at any scope", () => {
    expect(() => assertScopeAllowed("courses.edit", "COURSE")).not.toThrow();
    expect(() => assertScopeAllowed("courses.edit", "GLOBAL")).not.toThrow();
  });

  it("permits a global-only permission at global scope", () => {
    expect(() => assertScopeAllowed("licence.activate", "GLOBAL")).not.toThrow();
  });

  it("rejects a global-only permission at a narrower scope", () => {
    expect(() => assertScopeAllowed("licence.view", "COHORT")).toThrow(ScopeError);
    expect(() => assertScopeAllowed("licence.activate", "PROGRAMME")).toThrow(ScopeError);
  });
});
