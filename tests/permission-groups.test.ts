import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/server/permissions/catalogue";
import {
  PERMISSION_GROUPS,
  summariseEffectiveAccess,
} from "@/lib/permission-groups";

describe("permission groups", () => {
  it("has exactly 14 groups", () => {
    expect(PERMISSION_GROUPS).toHaveLength(14);
  });

  it("covers every catalogue permission exactly once, in both directions", () => {
    const flattened = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(flattened)).toEqual(new Set(PERMISSIONS));
    expect(flattened).toHaveLength(PERMISSIONS.length);
  });

  it("never assigns an identifier to more than one group", () => {
    const seen = new Set<string>();
    for (const group of PERMISSION_GROUPS) {
      for (const permission of group.permissions) {
        expect(seen.has(permission)).toBe(false);
        seen.add(permission);
      }
    }
  });

  describe("summariseEffectiveAccess", () => {
    it("returns an empty array for an empty selection", () => {
      expect(summariseEffectiveAccess([])).toEqual([]);
    });

    it("summarises a Courses-only selection", () => {
      const lines = summariseEffectiveAccess(["courses.view", "courses.edit"]);
      const courses = lines.find((l) => l.group === "Courses");
      expect(courses?.verbs).toEqual(["view", "edit"]);

      const payments = lines.find((l) => l.group === "Payments");
      expect(payments?.verbs).toEqual(["no access"]);
    });

    it("reads refunds.manage as 'manage refunds' inside Payments", () => {
      const lines = summariseEffectiveAccess(["refunds.manage"]);
      const payments = lines.find((l) => l.group === "Payments");
      expect(payments?.verbs).toContain("manage refunds");
    });
  });
});
