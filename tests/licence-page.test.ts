/**
 * The /staff/licence server page (Phase 14, plan 14-10; T-14-10-01, T-14-10-02,
 * T-14-10-03): the same denied response for an unauthorized actor whatever the
 * licence state is, session-ended for the unauthenticated, and fixed load-error
 * copy for any other failure.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, createWithPermission } from "@/server/permissions/with-permission";
import type { LicenceStatusSnapshot } from "@/server/licence/types";

const { mocks } = vi.hoisted(() => ({
  mocks: { getStatusForStaff: vi.fn(), can: vi.fn() },
}));

vi.mock("@/server/services/licence-staff-service", () => ({
  licenceStaffService: { getStatusForStaff: mocks.getStatusForStaff },
}));
vi.mock("@/server/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/server/permissions/with-permission")>(
    "@/server/permissions/with-permission",
  );
  return { AuthenticationError: actual.AuthenticationError, AuthorizationError: actual.AuthorizationError, can: mocks.can };
});

import LicencePage from "@/app/staff/licence/page";
import { ActivateLicenceForm } from "@/app/staff/licence/ActivateLicenceForm";
import { DiagnosticDownloadButton } from "@/app/staff/licence/DiagnosticDownloadButton";
import { LicenceStatusView } from "@/app/staff/licence/LicenceStatusView";
import { SessionEnded } from "@/components/shell/SessionEnded";
import { LOAD_ERROR_MESSAGE } from "@/server/licence/policy";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function snapshot(overrides: Partial<LicenceStatusSnapshot> = {}): LicenceStatusSnapshot {
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
    ...overrides,
  };
}

type PageElement = { type: unknown; props: Record<string, unknown> };
const render = async () => (await LicencePage()) as unknown as PageElement;

describe("LicencePage", () => {
  beforeEach(() => {
    mocks.getStatusForStaff.mockReset();
    mocks.can.mockReset().mockResolvedValue(true);
  });

  it("renders the status view with a view model and the two permission flags for a viewer", async () => {
    mocks.getStatusForStaff.mockResolvedValue(snapshot());
    mocks.can.mockImplementation(async (permission: string) => permission !== "reports.view");
    const element = await render();

    expect(element.type).toBe(LicenceStatusView);
    expect(element.props.canActivate).toBe(true);
    expect(element.props.vm).toMatchObject({ state: "ACTIVE", canActivate: true, canViewReports: false });
    expect(element.props.state).toBeUndefined();
    expect(mocks.can).toHaveBeenCalledWith("licence.activate", {});
    expect(mocks.can).toHaveBeenCalledWith("reports.view", {});
  });

  it("passes the activation form only to a holder of licence.activate and the diagnostic download to every viewer (plan 14-15)", async () => {
    mocks.getStatusForStaff.mockResolvedValue(snapshot());

    mocks.can.mockResolvedValue(true);
    const holder = await render();
    expect((holder.props.activationSlot as PageElement).type).toBe(ActivateLicenceForm);
    expect((holder.props.diagnosticSlot as PageElement).type).toBe(DiagnosticDownloadButton);

    mocks.can.mockImplementation(async (permission: string) => permission !== "licence.activate");
    const viewer = await render();
    expect(viewer.props.canActivate).toBe(false);
    expect(viewer.props.activationSlot).toBeUndefined();
    expect((viewer.props.diagnosticSlot as PageElement).type).toBe(DiagnosticDownloadButton);
  });

  it("gives the identical denied response whatever the licence state is, without reading the licence (no state oracle)", async () => {
    const states: Partial<LicenceStatusSnapshot>[] = [
      { state: "UNLICENSED", everActivated: false, licenceId: null },
      { state: "ACTIVE" },
      { state: "GRACE" },
      { state: "RESTRICTED_CONTINUITY", isRestricted: true },
      { state: "INVALID", isRestricted: true, reasonCode: "BAD_SIGNATURE" },
    ];
    const responses: PageElement[] = [];
    for (const overrides of states) {
      // The same guard the staff service applies, over a licence in this state, for an actor with no grants.
      const readLicence = vi.fn().mockResolvedValue(snapshot(overrides));
      const guarded = createWithPermission({
        getActor: async () => ({ userId: "staff-1" }),
        loadGrants: async () => [],
        audit: async () => undefined,
      })("licence.view", () => ({}))(async () => readLicence());
      mocks.getStatusForStaff.mockReset().mockImplementation(() => guarded(undefined));

      responses.push(await render());
      expect(readLicence).not.toHaveBeenCalled();
    }
    for (const element of responses) {
      expect(element.type).toBe(LicenceStatusView);
      expect(element.props).toEqual({ canActivate: false, state: { status: "denied", permission: "licence.view" } });
    }
    // Authorization failed first: no other check ran and no view model was built.
    expect(mocks.can).not.toHaveBeenCalled();
  });

  it("returns the session-ended state for an unauthenticated visitor", async () => {
    mocks.getStatusForStaff.mockRejectedValue(new AuthenticationError());
    expect((await render()).type).toBe(SessionEnded);
  });

  it("renders fixed load-error copy for any other failure, never the error message (T-14-10-02)", async () => {
    mocks.getStatusForStaff.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432 secret-token"));
    const element = await render();

    expect(element.type).toBe(LicenceStatusView);
    expect(element.props).toEqual({ canActivate: false, state: { status: "error", message: LOAD_ERROR_MESSAGE } });
    expect(JSON.stringify(element.props)).not.toContain("ECONNREFUSED");
  });

  it("treats a denial thrown by the activation or reports check like any other authorization failure", async () => {
    mocks.getStatusForStaff.mockResolvedValue(snapshot());
    mocks.can.mockRejectedValue(new AuthorizationError("licence.view"));
    const element = await render();
    expect(element.props).toEqual({ canActivate: false, state: { status: "denied", permission: "licence.view" } });
  });
});
