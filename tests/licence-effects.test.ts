/**
 * Permission effect classification and the works/blocked lists (plan 14-06; D-06,
 * D-09, assumptions A9 to A13). The classification is the single source both the
 * enforcement layer (plan 14-17) and the status screen render from.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LICENCE_PERMISSION_EFFECT,
  RESTRICTED_CAPABILITIES,
  effectForPermission,
  type LicenceEffect,
} from "@/server/licence/effects";
import { PERMISSIONS, type Permission } from "@/server/permissions/catalogue";

function permissionsWithEffect(effect: LicenceEffect): string[] {
  return PERMISSIONS.filter((permission) => LICENCE_PERMISSION_EFFECT[permission] === effect).sort();
}

const READ = [
  "users.view", "roles.view", "programmes.view", "courses.view", "cohorts.view", "enrolments.view",
  "attendance.view", "payments.view", "submissions.view", "certificates.view", "tickets.view",
  "reports.view", "audit.view", "licence.view",
].sort();

const CONTINUITY = [
  "attendance.manage", "payments.confirm", "refunds.manage", "grades.manage", "certificates.issue",
  "certificates.revoke", "tickets.manage", "reports.export", "audit.export", "licence.activate",
].sort();

const WRITE = [
  "users.manage", "roles.manage", "programmes.manage", "programmes.publish", "courses.create",
  "courses.edit", "courses.publish", "cohorts.manage", "cohorts.publish", "enrolments.manage",
  "assessments.create", "assessments.edit", "certificates.manage",
].sort();

describe("LICENCE_PERMISSION_EFFECT (D-09)", () => {
  it("Test 1: keys equal the closed catalogue and the counts are 14 read, 13 write, 10 continuity", () => {
    expect(Object.keys(LICENCE_PERMISSION_EFFECT).sort()).toEqual([...PERMISSIONS].sort());
    for (const permission of PERMISSIONS) expect(LICENCE_PERMISSION_EFFECT[permission], permission).toBeDefined();
    expect(permissionsWithEffect("read")).toHaveLength(14);
    expect(permissionsWithEffect("write")).toHaveLength(13);
    expect(permissionsWithEffect("continuity")).toHaveLength(10);
  });

  it("Test 2: read is exactly the fourteen view permissions", () => {
    expect(permissionsWithEffect("read")).toEqual(READ);
  });

  it("Test 3: continuity is exactly the ten continuity permissions", () => {
    expect(permissionsWithEffect("continuity")).toEqual(CONTINUITY);
  });

  it("Test 4: write is exactly the thirteen write permissions", () => {
    expect(permissionsWithEffect("write")).toEqual(WRITE);
  });

  it("every .view permission is read and every .export permission is continuity", () => {
    for (const permission of PERMISSIONS) {
      if (permission.endsWith(".view")) expect(LICENCE_PERMISSION_EFFECT[permission], permission).toBe("read");
      if (permission.endsWith(".export")) expect(LICENCE_PERMISSION_EFFECT[permission], permission).toBe("continuity");
    }
  });

  it("licence.activate is continuity so the recovery route is never blockable (T-14-06-03)", () => {
    expect(LICENCE_PERMISSION_EFFECT["licence.activate"]).toBe("continuity");
  });

  it("effectForPermission maps known permissions and defaults an unknown string to write (D-09)", () => {
    expect(effectForPermission("users.view")).toBe("read");
    expect(effectForPermission("grades.manage")).toBe("continuity");
    expect(effectForPermission("courses.edit")).toBe("write");
    expect(effectForPermission("not.a.permission")).toBe("write");
    expect(effectForPermission("")).toBe("write");
    // Object prototype members are not permissions.
    expect(effectForPermission("constructor")).toBe("write");
    expect(effectForPermission("__proto__")).toBe("write");
  });
});

describe("RESTRICTED_CAPABILITIES (D-06, D-07)", () => {
  const blockedPermissions = RESTRICTED_CAPABILITIES.blocked.flatMap((item) => [...item.permissions]);
  const worksPermissions = RESTRICTED_CAPABILITIES.works.flatMap((item) => [...item.permissions]);

  it("lists the planned works and blocked items by id", () => {
    expect(RESTRICTED_CAPABILITIES.works.map((item) => item.id)).toEqual([
      "learner-learning", "staff-delivery", "security", "payments", "exports-activation", "notifications", "support",
    ]);
    expect(RESTRICTED_CAPABILITIES.blocked.map((item) => item.id)).toEqual([
      "new-enrolments", "content-publishing", "staff-roles", "settings", "registration",
    ]);
  });

  it("Test 5: every write permission appears in exactly one blocked item", () => {
    for (const permission of WRITE) {
      const holders = RESTRICTED_CAPABILITIES.blocked.filter((item) =>
        (item.permissions as readonly string[]).includes(permission),
      );
      expect(holders.length, permission).toBe(1);
      expect(blockedPermissions.filter((p) => p === permission).length, permission).toBe(1);
    }
  });

  it("Test 5: every continuity permission appears in at least one works item", () => {
    for (const permission of CONTINUITY) {
      expect(worksPermissions, permission).toContain(permission);
    }
  });

  it("Test 5: no read permission appears in any item, and every listed permission is a catalogue permission", () => {
    const all = [...blockedPermissions, ...worksPermissions];
    for (const permission of all) {
      expect(PERMISSIONS as readonly string[], permission).toContain(permission);
      expect(LICENCE_PERMISSION_EFFECT[permission as Permission], permission).not.toBe("read");
    }
    for (const permission of READ) expect(all, permission).not.toContain(permission);
  });

  it("blocked items hold only write permissions and works items only continuity permissions", () => {
    for (const permission of blockedPermissions) {
      expect(LICENCE_PERMISSION_EFFECT[permission as Permission], permission).toBe("write");
    }
    for (const permission of worksPermissions) {
      expect(LICENCE_PERMISSION_EFFECT[permission as Permission], permission).toBe("continuity");
    }
  });

  it("Test 5: licence.activate is in a works item and never in a blocked item", () => {
    expect(worksPermissions).toContain("licence.activate");
    expect(blockedPermissions).not.toContain("licence.activate");
  });

  it("holds the UI-SPEC text with the A9, A11 and A12 reconciliations", () => {
    const text = (id: string): string | undefined =>
      [...RESTRICTED_CAPABILITIES.works, ...RESTRICTED_CAPABILITIES.blocked].find((item) => item.id === id)?.text;
    expect(text("learner-learning")).toBe("Learners continue coursework, quizzes, assignments and progress");
    expect(text("staff-delivery")).toBe("Attendance, grading and certificate issuance");
    expect(text("security")).toBe("Sign-in, password reset and security administration");
    expect(text("payments")).toBe(
      "Payment webhooks, refunds and reversals; payments started before the restriction still complete",
    );
    expect(text("exports-activation")).toBe("Data exports and licence activation");
    expect(text("notifications")).toBe("Email and in-product notifications");
    expect(text("support")).toBe("Support tickets and the support queue");
    expect(text("new-enrolments")).toBe("New enrolments and new checkout sessions");
    expect(text("content-publishing")).toBe("Publishing and content changes");
    expect(text("staff-roles")).toBe("Staff, role and permission changes");
    expect(text("settings")).toBe("Settings changes and other administrative edits");
    expect(text("registration")).toBe("New learner registration");
  });

  it("capability ids are unique and no text uses the retired post-grace wording", () => {
    const items = [...RESTRICTED_CAPABILITIES.works, ...RESTRICTED_CAPABILITIES.blocked];
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    const banned = new RegExp(["read", "[-\\s_]?", "only"].join(""), "i");
    for (const item of items) expect(banned.test(item.text), item.id).toBe(false);
  });
});

describe("effects.ts module shape", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/server/licence/effects.ts"), "utf8");

  it("imports Permission with import type only, so no permission-layer code enters worker closures", () => {
    expect(source).toContain('import type { Permission } from "@/server/permissions/catalogue"');
    expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*["']@\/server\/permissions/m);
  });
});
