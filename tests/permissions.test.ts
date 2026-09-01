import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  GLOBAL_ONLY_PERMISSIONS,
  isPermission,
  isGlobalOnly,
} from "@/server/permissions/catalogue";

describe("permission catalogue", () => {
  it("contains exactly 36 identifiers", () => {
    expect(PERMISSIONS).toHaveLength(36);
  });

  it("contains no duplicates", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("uses domain.action form throughout", () => {
    for (const p of PERMISSIONS) {
      expect(p).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it("includes the financial identifiers from PRD 17.2", () => {
    expect(PERMISSIONS).toContain("payments.confirm");
    expect(PERMISSIONS).toContain("refunds.manage");
  });

  it("includes the licence identifiers from PRD 18.4", () => {
    expect(PERMISSIONS).toContain("licence.view");
    expect(PERMISSIONS).toContain("licence.activate");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
  });

  it("accepts a known identifier", () => {
    expect(isPermission("courses.publish")).toBe(true);
  });

  it("rejects an unknown identifier", () => {
    expect(isPermission("courses.destroy")).toBe(false);
    expect(isPermission("")).toBe(false);
    expect(isPermission("admin")).toBe(false);
  });

  it("marks licence permissions as global-only", () => {
    expect(isGlobalOnly("licence.view")).toBe(true);
    expect(isGlobalOnly("licence.activate")).toBe(true);
    expect(GLOBAL_ONLY_PERMISSIONS.size).toBe(2);
  });

  it("does not mark scopeable permissions as global-only", () => {
    expect(isGlobalOnly("courses.edit")).toBe(false);
    expect(isGlobalOnly("cohorts.manage")).toBe(false);
  });
});
