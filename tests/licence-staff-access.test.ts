/**
 * Authorization of the Licence & System Status read (Phase 14, plan 14-10;
 * T-14-10-01, T-14-10-03): the staff service must authorize BEFORE reading the
 * licence. The page-level parity test lives in tests/licence-page.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, createWithPermission } from "@/server/permissions/with-permission";
import type { Permission } from "@/server/permissions/catalogue";
import type { ScopeType } from "@/server/permissions/scope";
import type { LicenceStatusSnapshot } from "@/server/licence/types";
import { createLicenceStaffService } from "@/server/services/licence-staff-service";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function snapshot(): LicenceStatusSnapshot {
  return {
    state: "ACTIVE",
    reasonCode: null,
    isRestricted: false,
    everActivated: true,
    licenceId: "LIC-2026-0001",
    keyId: "key-1",
    schemaVersion: 1,
    clientName: "Fixture Training Academy",
    deploymentId: "fixture-deployment-0001",
    issuedAt: NOW,
    notBefore: NOW,
    expiresAt: new Date("2027-03-31T22:59:59.000Z"),
    graceEndsAt: new Date("2027-04-14T22:59:59.000Z"),
    timeZone: "Africa/Lagos",
    support: null,
    restrictedAt: null,
    daysRemaining: 182,
    daysToGraceEnd: null,
    underOneDay: false,
    lastVerifiedAt: null,
    lastVerificationOutcome: null,
    attentionSince: null,
    clockAlertAt: null,
    highWaterAt: null,
    evaluatedAt: NOW,
  };
}

type GrantSpec = { permission: Permission; scopeType: ScopeType; scopeId: string | null };

function build(options: { actor: boolean; grants: GrantSpec[] }) {
  const getStatusSnapshot = vi.fn().mockResolvedValue(snapshot());
  const audit = vi.fn().mockResolvedValue(undefined);
  const withPermission = createWithPermission({
    getActor: async () => (options.actor ? { userId: "staff-1" } : null),
    loadGrants: async () =>
      options.grants.map((grant) => ({ ...grant, active: true, revokedAt: null, startsAt: null, endsAt: null })),
    audit,
  });
  return {
    service: createLicenceStaffService({
      withPermission,
      licence: { getStatusSnapshot, inspect: vi.fn(), buildDiagnosticReport: vi.fn() },
      activation: { activateLicence: vi.fn() },
      audit: vi.fn(),
    }),
    getStatusSnapshot,
    audit,
  };
}

describe("licenceStaffService.getStatusForStaff (licence.view, Global only)", () => {
  it("returns the snapshot for a Global licence.view holder", async () => {
    const { service, getStatusSnapshot } = build({
      actor: true,
      grants: [{ permission: "licence.view", scopeType: "GLOBAL", scopeId: null }],
    });
    await expect(service.getStatusForStaff()).resolves.toMatchObject({ licenceId: "LIC-2026-0001" });
    expect(getStatusSnapshot).toHaveBeenCalledTimes(1);
  });

  it("denies an actor without licence.view before reading the licence, and audits the denial", async () => {
    const { service, getStatusSnapshot, audit } = build({
      actor: true,
      grants: [{ permission: "licence.activate", scopeType: "GLOBAL", scopeId: null }],
    });
    await expect(service.getStatusForStaff()).rejects.toBeInstanceOf(AuthorizationError);
    expect(getStatusSnapshot).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ permission: "licence.view", outcome: "DENIED" }));
  });

  it("denies a licence.view grant held only at a narrower scope (Global only)", async () => {
    const { service, getStatusSnapshot } = build({
      actor: true,
      grants: [{ permission: "licence.view", scopeType: "COHORT", scopeId: "cohort-1" }],
    });
    await expect(service.getStatusForStaff()).rejects.toBeInstanceOf(AuthorizationError);
    expect(getStatusSnapshot).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller with an authentication error and reads nothing", async () => {
    const { service, getStatusSnapshot } = build({ actor: false, grants: [] });
    await expect(service.getStatusForStaff()).rejects.toBeInstanceOf(AuthenticationError);
    expect(getStatusSnapshot).not.toHaveBeenCalled();
  });
});
