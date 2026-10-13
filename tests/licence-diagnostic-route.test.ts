/**
 * GET /api/staff/licence/diagnostic (Phase 14, plan 14-15; LIC-02, LIC-06, D-14,
 * D-17, T-14-15-05): allow-listed report as a non-cacheable attachment, 401 with
 * no session, empty 404 for a denied caller, fixed 500 for anything else.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDiagnostic: vi.fn() }));

vi.mock("@/server/services/licence-staff-service", () => ({
  licenceStaffService: { getDiagnosticForStaff: mocks.getDiagnostic },
}));
vi.mock("@/server/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/server/permissions/with-permission")>(
    "@/server/permissions/with-permission",
  );
  return { AuthenticationError: actual.AuthenticationError, AuthorizationError: actual.AuthorizationError };
});

import * as route from "@/app/api/staff/licence/diagnostic/route";
import { DIAGNOSTIC_REPORT_KEYS, type DiagnosticReport } from "@/server/services/licence-service";
import { AuthenticationError, AuthorizationError } from "@/server/permissions/with-permission";

const STORED_RAW = "LMS-LIC1.c3RvcmVkLWhlYWRlcg.c3RvcmVkLXBheWxvYWQ.c3RvcmVkLXNpZw";

function report(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    reportVersion: 1,
    generatedAt: "2026-10-02T09:30:00.000Z",
    state: "ACTIVE",
    reasonCode: null,
    licenceId: "LIC-2026-0001",
    keyId: "key-1",
    schemaVersion: 1,
    deploymentId: "fixture-deployment-0001",
    registeredClientId: "client-1",
    issuedAt: "2026-09-30T12:00:00.000Z",
    expiresAt: "2027-03-31T22:59:59.000Z",
    graceEndsAt: "2027-04-14T22:59:59.000Z",
    lastVerifiedAt: "2026-10-02T09:00:00.000Z",
    lastVerificationOutcome: "OK",
    attentionSince: null,
    highWaterAt: "2026-10-02T09:29:00.000Z",
    clockSkewSeconds: 0,
    trustSetKeyIds: ["key-1"],
    appVersion: "1.0.0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getDiagnostic.mockReset();
});

describe("GET /api/staff/licence/diagnostic", () => {
  it("Test 1: an authorized actor gets 200, JSON, a private no-store attachment named for the licence and date, and exactly the allow-listed keys", async () => {
    mocks.getDiagnostic.mockResolvedValue(report());

    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toBe('attachment; filename="licence-diagnostic-LIC-2026-0001-20261002.json"');
    expect(disposition).toMatch(/^attachment; filename="licence-diagnostic-[A-Za-z0-9._-]+-\d{8}\.json"$/);

    const body = JSON.parse(await response.text());
    expect(Object.keys(body)).toEqual([...DIAGNOSTIC_REPORT_KEYS]);
    expect(body.licenceId).toBe("LIC-2026-0001");
    expect(mocks.getDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("Test 1: a deployment with no licence is named not-activated", async () => {
    mocks.getDiagnostic.mockResolvedValue(report({ licenceId: null, state: "UNLICENSED" }));
    const response = await route.GET();
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="licence-diagnostic-not-activated-20261002.json"',
    );
  });

  it("the file name date is the UTC date of generatedAt, not the server's local date", async () => {
    mocks.getDiagnostic.mockResolvedValue(report({ generatedAt: "2026-12-31T23:59:59.000Z" }));
    const response = await route.GET();
    expect(response.headers.get("Content-Disposition")).toContain("-20261231.json");
  });

  it("a stored licence id with characters outside A-Za-z0-9._- can never break the header", async () => {
    mocks.getDiagnostic.mockResolvedValue(report({ licenceId: 'LIC"; x=1 Set-Cookie: y' }));
    const response = await route.GET();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="licence-diagnostic-[A-Za-z0-9._-]+-20261002\.json"$/);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("Test 2: AuthenticationError returns 401 with a JSON body and a private no-store header", async () => {
    mocks.getDiagnostic.mockRejectedValue(new AuthenticationError());
    const response = await route.GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("Test 2: AuthorizationError returns 404 with an empty body and a private no-store header", async () => {
    mocks.getDiagnostic.mockRejectedValue(new AuthorizationError("licence.view"));
    const response = await route.GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
  });

  it("Test 2: any other error returns the fixed 500 JSON with no message or stack, logging only the error name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class StoreDownError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "StoreDownError";
      }
    }
    mocks.getDiagnostic.mockRejectedValue(new StoreDownError(`connect failed ${STORED_RAW}`));

    const response = await route.GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "diagnostic_unavailable" });
    expect(text).not.toContain("connect failed");
    expect(text).not.toContain("StoreDownError");
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("StoreDownError");
    expect(logged).not.toContain("connect failed");
    expect(logged).not.toContain(STORED_RAW);
  });

  it("Test 3: the body never contains raw licence text and the route adds no fields to the report", async () => {
    mocks.getDiagnostic.mockResolvedValue(report());
    const response = await route.GET();
    const text = await response.text();
    expect(text).not.toContain(STORED_RAW);
    expect(text).not.toContain("LMS-LIC1");
    expect(Object.keys(JSON.parse(text))).toEqual([...DIAGNOSTIC_REPORT_KEYS]);
  });

  it("exports GET only and no route segment config (no dynamic or revalidate)", () => {
    expect(Object.keys(route).sort()).toEqual(["GET"]);
  });
});
