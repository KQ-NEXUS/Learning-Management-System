/**
 * Licence guard in the choke point (Phase 14, plan 14-11; D-09).
 *
 * No-oracle parity (T-14-11-01): an unauthorized or anonymous caller receives the
 * identical error whether the licence guard would allow or block, and the guard
 * is never called for them. Also the live binding, the refusal helper and the
 * shared harness option.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";
import {
  AuthenticationError,
  AuthorizationError,
  LicenceRestrictedError,
  createWithPermission,
  type AuditEntry,
  type LicenceGuardDep,
  type RawGrant,
} from "@/server/permissions/with-permission";
import { isLicenceRestricted, refusalMessage } from "@/server/permissions/refusal";
import { createTestWithPermission, grant } from "./support/harness";

const NOW = new Date("2026-10-01T12:00:00Z");

function build(options: { grants: RawGrant[]; actor: { userId: string } | null; licence: LicenceGuardDep }) {
  const audits: AuditEntry[] = [];
  const withPermission = createWithPermission({
    getActor: async () => options.actor,
    loadGrants: async () => options.grants,
    audit: async (entry) => {
      audits.push(entry);
    },
    now: () => NOW,
    licence: options.licence,
  });
  return { withPermission, audits };
}

const blockedGuard = () => ({ check: vi.fn(async () => ({ allowed: false as const })) });
const allowedGuard = () => ({ check: vi.fn(async () => ({ allowed: true as const })) });

describe("no state oracle (D-09, T-14-11-01)", () => {
  it("an actor without the grant gets the identical AuthorizationError in blocked and allowed harnesses, and the guard is never called", async () => {
    const blocked = blockedGuard();
    const allowed = allowedGuard();
    const inBlocked = build({ grants: [], actor: { userId: "user-1" }, licence: blocked });
    const inAllowed = build({ grants: [], actor: { userId: "user-1" }, licence: allowed });
    const handlerA = vi.fn(async () => "done");
    const handlerB = vi.fn(async () => "done");

    const errorBlocked = await inBlocked
      .withPermission("courses.edit", () => ({}))(handlerA)({})
      .catch((e: unknown) => e);
    const errorAllowed = await inAllowed
      .withPermission("courses.edit", () => ({}))(handlerB)({})
      .catch((e: unknown) => e);

    for (const error of [errorBlocked, errorAllowed]) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error).not.toBeInstanceOf(LicenceRestrictedError);
    }
    expect((errorBlocked as Error).name).toBe((errorAllowed as Error).name);
    expect((errorBlocked as Error).message).toBe((errorAllowed as Error).message);
    expect((errorBlocked as Error).message).not.toBe(LICENCE_REFUSAL_MESSAGE);

    expect(blocked.check).not.toHaveBeenCalled();
    expect(allowed.check).not.toHaveBeenCalled();
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();

    expect(inBlocked.audits).toHaveLength(1);
    expect(inBlocked.audits[0]).toMatchObject({ action: "authorization.denied", outcome: "DENIED" });
    expect(inAllowed.audits).toHaveLength(1);
    expect(inAllowed.audits[0]).toMatchObject({ action: "authorization.denied", outcome: "DENIED" });
  });

  it("an anonymous caller gets AuthenticationError and the guard is never called", async () => {
    const blocked = blockedGuard();
    const { withPermission, audits } = build({ grants: [], actor: null, licence: blocked });

    await expect(
      withPermission("courses.edit", () => ({}))(vi.fn(async () => "done"))({}),
    ).rejects.toBeInstanceOf(AuthenticationError);

    expect(blocked.check).not.toHaveBeenCalled();
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBeNull();
  });
});

describe("refusal helper (D-09 compatibility)", () => {
  const DENIED = "Your role does not permit this.";

  it("returns the licence sentence only for a LicenceRestrictedError", () => {
    expect(refusalMessage(new LicenceRestrictedError("courses.edit"), DENIED)).toBe(
      LICENCE_REFUSAL_MESSAGE,
    );
    expect(refusalMessage(new AuthorizationError("courses.edit"), DENIED)).toBe(DENIED);
    expect(refusalMessage(new Error("x"), "d")).toBe("d");
    expect(refusalMessage("not an error", "d")).toBe("d");
  });

  it("isLicenceRestricted narrows correctly", () => {
    const restricted: unknown = new LicenceRestrictedError("courses.edit");
    expect(isLicenceRestricted(restricted)).toBe(true);
    if (isLicenceRestricted(restricted)) expect(restricted.permission).toBe("courses.edit");
    expect(isLicenceRestricted(new AuthorizationError("courses.edit"))).toBe(false);
    expect(isLicenceRestricted(null)).toBe(false);
  });
});

describe("shared test harness", () => {
  it("createTestWithPermission forwards the licence guard", async () => {
    const licence = blockedGuard();
    const { withPermission } = createTestWithPermission([grant("courses.edit")], { licence });

    await expect(
      withPermission("courses.edit", () => ({}))(vi.fn(async () => "done"))({}),
    ).rejects.toBeInstanceOf(LicenceRestrictedError);
    expect(licence.check).toHaveBeenCalledWith({ permission: "courses.edit", actorId: "user-1" });
  });

  it("existing callers without a licence option are unaffected", async () => {
    const { withPermission } = createTestWithPermission([grant("courses.edit")]);
    await expect(
      withPermission("courses.edit", () => ({}))(vi.fn(async () => "done"))({}),
    ).resolves.toBe("done");
  });
});

describe("live binding (static)", () => {
  const read = (relative: string) =>
    readFileSync(path.resolve(process.cwd(), relative), "utf8");

  it("index.ts binds the guard to licenceService.checkWriteGate and re-exports the refusal API", () => {
    const source = read("src/server/permissions/index.ts");
    expect(source).toContain("checkWriteGate");
    expect(source).toMatch(/operation:\s*permission/);
    expect(source).toMatch(/LicenceRestrictedError/);
    expect(source).toMatch(/refusalMessage/);
    expect(source).toMatch(/isLicenceRestricted/);
  });

  it("with-permission.ts stays free of framework and service imports", () => {
    const source = read("src/server/permissions/with-permission.ts");
    const specifiers = [...source.matchAll(/^\s*(?:import|export)[^"']*from\s+["']([^"']+)["']/gm)].map(
      (match) => match[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(/^next(\/|$)/);
      expect(specifier).not.toMatch(/^@\/server\/services\//);
      expect(specifier).not.toBe("@/server/db");
      expect(specifier).not.toMatch(/^@prisma\//);
    }
    expect(specifiers).toContain("@/server/licence/effects");
    expect(specifiers).toContain("@/server/licence/policy");
  });
});
