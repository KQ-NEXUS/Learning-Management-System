/**
 * The permission-wrapped licence staff service (Phase 14, plan 14-15; LIC-03,
 * LIC-06, D-07, D-14, T-14-15-01, T-14-15-05, T-14-15-06): activation and
 * inspection need `licence.activate` (Global), run in restricted continuity mode,
 * pass the authorized actor id to the activation service; the diagnostic report
 * needs `licence.view` and is audited with the actor.
 */

import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, LicenceRestrictedError } from "@/server/permissions/with-permission";
import type { DiagnosticReport, InspectResult } from "@/server/services/licence-service";
import type { ActivateLicenceResult } from "@/server/services/licence-activation-service";
import type { LicenceStatusSnapshot } from "@/server/licence/types";
import { createLicenceStaffService } from "@/server/services/licence-staff-service";
import { createTestWithPermission, grant } from "./support/harness";

const NOW = new Date("2026-10-01T12:00:00.000Z");

const SNAPSHOT = { state: "ACTIVE", licenceId: "LIC-2026-0001" } as unknown as LicenceStatusSnapshot;

const PREVIEW_RESULT: InspectResult = {
  ok: true,
  preview: {
    licenceId: "LIC-2026-0002",
    clientName: "Fixture Training Academy",
    deploymentId: "fixture-deployment-0001",
    issuedAt: NOW,
    notBefore: NOW,
    expiresAt: new Date("2027-03-31T22:59:59.000Z"),
    graceEndsAt: new Date("2027-04-14T22:59:59.000Z"),
    timeZone: "Africa/Lagos",
    replaces: null,
  },
};

const ACTIVATED: ActivateLicenceResult = { ok: true, snapshot: SNAPSHOT };

const REPORT = {
  reportVersion: 1,
  generatedAt: NOW.toISOString(),
  state: "ACTIVE",
  licenceId: "LIC-2026-0001",
} as unknown as DiagnosticReport;

const RAW = "LMS-LIC1.aGVhZGVy.cGF5bG9hZA.c2ln";

function build(grants: ReturnType<typeof grant>[], opts: Parameters<typeof createTestWithPermission>[1] = {}) {
  const { withPermission, audits } = createTestWithPermission(grants, opts);
  const licence = {
    getStatusSnapshot: vi.fn().mockResolvedValue(SNAPSHOT),
    inspect: vi.fn().mockResolvedValue(PREVIEW_RESULT),
    buildDiagnosticReport: vi.fn().mockResolvedValue(REPORT),
  };
  const activation = { activateLicence: vi.fn().mockResolvedValue(ACTIVATED) };
  const audit = vi.fn().mockResolvedValue(undefined);
  const service = createLicenceStaffService({ withPermission, licence, activation, audit });
  return { service, licence, activation, audit, audits, withPermission };
}

describe("licence.activate holders", () => {
  it("Test 1: inspect returns the licence service result; activate passes the actor id and the submitted text once", async () => {
    const { service, licence, activation } = build([grant("licence.activate")], { userId: "admin-7" });

    await expect(service.inspectLicenceForStaff({ raw: RAW })).resolves.toBe(PREVIEW_RESULT);
    expect(licence.inspect).toHaveBeenCalledWith(RAW);
    expect(activation.activateLicence).not.toHaveBeenCalled();

    await expect(service.activateLicenceForStaff({ raw: RAW, correlationId: "corr-1" })).resolves.toBe(ACTIVATED);
    expect(activation.activateLicence).toHaveBeenCalledTimes(1);
    expect(activation.activateLicence).toHaveBeenCalledWith({
      actorId: "admin-7",
      raw: RAW,
      correlationId: "corr-1",
    });
  });
});

describe("an actor holding only licence.view", () => {
  it("Test 2: inspect and activate reject with AuthorizationError, the fakes are never called, and the status read still works", async () => {
    const { service, licence, activation, audits } = build([grant("licence.view")]);

    await expect(service.inspectLicenceForStaff({ raw: RAW })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.activateLicenceForStaff({ raw: RAW })).rejects.toBeInstanceOf(AuthorizationError);

    expect(licence.inspect).not.toHaveBeenCalled();
    expect(activation.activateLicence).toHaveBeenCalledTimes(0);
    expect(audits.filter((entry) => entry.permission === "licence.activate" && entry.outcome === "DENIED")).toHaveLength(2);
    await expect(service.getStatusForStaff()).resolves.toBe(SNAPSHOT);
  });

  it("refuses a licence.activate grant held only at a narrower scope (Global only)", async () => {
    const { service, activation } = build([grant("licence.activate", "COHORT", "cohort-1")]);
    await expect(service.activateLicenceForStaff({ raw: RAW })).rejects.toBeInstanceOf(AuthorizationError);
    expect(activation.activateLicence).not.toHaveBeenCalled();
  });
});

describe("restricted continuity mode (D-07, OQ3)", () => {
  it("Test 3: activation and inspection still run behind a blocking licence guard while a write-class permission call is refused", async () => {
    const check = vi.fn().mockResolvedValue({ allowed: false });
    const { service, activation, licence, withPermission } = build(
      [grant("licence.activate"), grant("courses.publish")],
      { licence: { check } },
    );

    await expect(service.inspectLicenceForStaff({ raw: RAW })).resolves.toBe(PREVIEW_RESULT);
    await expect(service.activateLicenceForStaff({ raw: RAW })).resolves.toBe(ACTIVATED);
    expect(licence.inspect).toHaveBeenCalledTimes(1);
    expect(activation.activateLicence).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();

    const ran = vi.fn();
    const publish = withPermission("courses.publish", () => ({}))(async () => {
      ran();
    });
    await expect(publish(undefined)).rejects.toBeInstanceOf(LicenceRestrictedError);
    expect(check).toHaveBeenCalledTimes(1);
    expect(ran).not.toHaveBeenCalled();
  });
});

describe("getDiagnosticForStaff (licence.view, audited)", () => {
  it("returns the report and audits the download with the actor and the licence id only", async () => {
    const { service, audit, licence } = build([grant("licence.view")], { userId: "viewer-3" });

    await expect(service.getDiagnosticForStaff()).resolves.toBe(REPORT);
    expect(licence.buildDiagnosticReport).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({
      actorId: "viewer-3",
      action: "licence.diagnostic_downloaded",
      targetType: "LICENCE",
      targetId: "LIC-2026-0001",
      scopeType: "GLOBAL",
      outcome: "SUCCESS",
    });
    const event = audit.mock.calls[0][0] as Record<string, unknown>;
    expect(event).not.toHaveProperty("before");
    expect(event).not.toHaveProperty("after");
  });

  it("audits a download made before any licence is activated with no target id", async () => {
    const { service, audit, licence } = build([grant("licence.view")]);
    licence.buildDiagnosticReport.mockResolvedValue({ ...REPORT, licenceId: null });
    await service.getDiagnosticForStaff();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ targetId: null }));
  });

  it("denies an actor without licence.view before the report is built and writes no download audit", async () => {
    const { service, audit, licence } = build([grant("licence.activate")]);
    await expect(service.getDiagnosticForStaff()).rejects.toBeInstanceOf(AuthorizationError);
    expect(licence.buildDiagnosticReport).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("fails the request when the audit write fails (no download without evidence)", async () => {
    const { service, audit } = build([grant("licence.view")]);
    audit.mockRejectedValue(new Error("audit store down"));
    await expect(service.getDiagnosticForStaff()).rejects.toThrow("audit store down");
  });
});
