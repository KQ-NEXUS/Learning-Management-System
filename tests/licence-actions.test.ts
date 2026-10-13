/**
 * Licence activation server actions (Phase 14, plan 14-15; LIC-03, D-14,
 * T-14-15-02, T-14-15-03, T-14-15-04): closed, fixed messages; input hygiene
 * before the service is called; revalidation of the staff layout and page; no
 * submitted text in results or logs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  activate: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/server/services/licence-staff-service", () => ({
  licenceStaffService: {
    inspectLicenceForStaff: mocks.inspect,
    activateLicenceForStaff: mocks.activate,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { activateLicenceAction, inspectLicenceAction } from "@/app/staff/licence/actions";
import { MAX_LICENCE_FILE_CHARS } from "@/server/licence/constants";
import {
  ACTIVATION_GENERIC_FAILURE,
  ACTIVATION_PERMISSION_NOTE,
  ACTIVATION_SUCCESS,
  LICENCE_REFUSAL_MESSAGE,
  LICENCE_STATE_LABELS,
  rejectionSentence,
} from "@/server/licence/policy";
import {
  AuthenticationError,
  AuthorizationError,
  LicenceRestrictedError,
} from "@/server/permissions/with-permission";

const RAW = "LMS-LIC1.aGVhZGVy.cGF5bG9hZA.c2ln";

const PREVIEW = {
  licenceId: "LIC-2026-0002",
  clientName: "Fixture Training Academy",
  deploymentId: "fixture-deployment-0001",
  issuedAt: new Date("2026-09-30T12:00:00.000Z"),
  notBefore: new Date("2026-10-01T00:00:00.000Z"),
  expiresAt: new Date("2027-03-31T22:59:59.000Z"),
  graceEndsAt: new Date("2027-04-14T22:59:59.000Z"),
  timeZone: "Africa/Lagos",
  replaces: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.inspect.mockReset();
  mocks.activate.mockReset();
  mocks.revalidate.mockReset();
});

describe("inspectLicenceAction", () => {
  it("Test 4: returns a preview of preformatted date strings and no raw text", async () => {
    mocks.inspect.mockResolvedValue({
      ok: true,
      preview: { ...PREVIEW, replaces: { licenceId: "LIC-2026-0001", expiresAt: new Date("2026-12-31T22:59:59.000Z") } },
    });

    const result = await inspectLicenceAction({ raw: `  ${RAW}\n` });

    expect(mocks.inspect).toHaveBeenCalledWith({ raw: RAW });
    expect(result).toEqual({
      ok: true,
      preview: {
        licenceId: "LIC-2026-0002",
        clientName: "Fixture Training Academy",
        deploymentId: "fixture-deployment-0001",
        zone: "Africa/Lagos",
        issued: { local: "30 Sep 2026, 13:00 WAT", utc: "2026-09-30T12:00:00Z" },
        starts: { local: "1 Oct 2026, 01:00 WAT", utc: "2026-10-01T00:00:00Z" },
        expires: { local: "31 Mar 2027, 23:59 WAT", utc: "2027-03-31T22:59:59Z" },
        graceEnds: { local: "14 Apr 2027, 23:59 WAT", utc: "2027-04-14T22:59:59Z" },
        replaces: {
          licenceId: "LIC-2026-0001",
          expires: { local: "31 Dec 2026, 23:59 WAT", utc: "2026-12-31T22:59:59Z" },
        },
        matchesDeployment: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain(RAW);
    expect(JSON.stringify(result)).not.toContain("LMS-LIC1");
  });

  it("Test 4: a verifier rejection returns the closed sentence followed by Nothing was changed.", async () => {
    mocks.inspect.mockResolvedValue({ ok: false, code: "BAD_SIGNATURE" });
    await expect(inspectLicenceAction({ raw: RAW })).resolves.toEqual({
      ok: false,
      code: "BAD_SIGNATURE",
      message: `${rejectionSentence("BAD_SIGNATURE")} Nothing was changed.`,
      neutral: false,
    });
  });

  it("Test 4: NOT_YET_VALID never echoes a date the verifier did not supply", async () => {
    mocks.inspect.mockResolvedValue({ ok: false, code: "NOT_YET_VALID" });
    const result = await inspectLicenceAction({ raw: RAW });
    expect(result).toMatchObject({ ok: false, code: "NOT_YET_VALID" });
    expect((result as { message: string }).message).toBe("This licence is not valid yet. Nothing was changed.");
  });

  it("Test 4: ALREADY_ACTIVE is neutral", async () => {
    mocks.inspect.mockResolvedValue({ ok: false, code: "ALREADY_ACTIVE" });
    await expect(inspectLicenceAction({ raw: RAW })).resolves.toMatchObject({
      ok: false,
      code: "ALREADY_ACTIVE",
      neutral: true,
      message: rejectionSentence("ALREADY_ACTIVE"),
    });
  });

  it.each([
    ["a string instead of an object", RAW],
    ["null", null],
    ["a missing raw member", {}],
    ["a non-string raw", { raw: 42 }],
    ["an unknown extra member", { raw: RAW, preview: { licenceId: "x" } }],
    ["an empty string", { raw: "   \n" }],
    ["a string over 8192 characters", { raw: "A".repeat(MAX_LICENCE_FILE_CHARS + 1) }],
    ["a space inside the text", { raw: "LMS-LIC1.aaa bbb.ccc.ddd" }],
    ["a newline inside the text", { raw: "LMS-LIC1.aaa\nbbb.ccc.ddd" }],
    ["a non-ASCII character", { raw: "LMS-LIC1.aaa.bbb.cccé" }],
    ["an HTML character", { raw: "LMS-LIC1.<script>.bbb.ccc" }],
  ])("Test 5: %s returns BAD_FORMAT and never calls the service", async (_name, input) => {
    const result = await inspectLicenceAction(input);
    expect(result).toEqual({
      ok: false,
      code: "BAD_FORMAT",
      message: `${rejectionSentence("BAD_FORMAT")} Nothing was changed.`,
      neutral: false,
    });
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it("Test 5: text of exactly 8192 allowed characters reaches the service", async () => {
    mocks.inspect.mockResolvedValue({ ok: false, code: "BAD_FORMAT" });
    await inspectLicenceAction({ raw: "A".repeat(MAX_LICENCE_FILE_CHARS) });
    expect(mocks.inspect).toHaveBeenCalledTimes(1);
  });

  it("maps a permission failure to the fixed note and an unexpected error to the generic failure, logging only the name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.inspect.mockRejectedValueOnce(new AuthorizationError("licence.activate"));
    await expect(inspectLicenceAction({ raw: RAW })).resolves.toMatchObject({
      ok: false,
      message: ACTIVATION_PERMISSION_NOTE,
    });

    mocks.inspect.mockRejectedValueOnce(new Error(`database said no for ${RAW}`));
    const result = await inspectLicenceAction({ raw: RAW });
    expect(result).toMatchObject({ ok: false, message: ACTIVATION_GENERIC_FAILURE });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(RAW);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("database said no");
  });
});

describe("activateLicenceAction", () => {
  it("Test 6: success returns the sentence for the new state and revalidates the staff layout and the licence page", async () => {
    mocks.activate.mockResolvedValue({ ok: true, snapshot: { state: "EXPIRING_SOON" } });

    const result = await activateLicenceAction({ raw: `${RAW}\n` });

    expect(mocks.activate).toHaveBeenCalledWith({ raw: RAW });
    expect(result).toEqual({ ok: true, message: ACTIVATION_SUCCESS(LICENCE_STATE_LABELS.EXPIRING_SOON) });
    expect(mocks.revalidate).toHaveBeenCalledWith("/staff", "layout");
    expect(mocks.revalidate).toHaveBeenCalledWith("/staff/licence", "page");
  });

  it("Test 6: the action sends only the submitted text, never preview fields", async () => {
    mocks.activate.mockResolvedValue({ ok: true, snapshot: { state: "ACTIVE" } });
    await activateLicenceAction({ raw: RAW, preview: { licenceId: "forged" } });
    // The strict schema rejects the extra member, so the service is not called with forged data.
    expect(mocks.activate).not.toHaveBeenCalled();

    await activateLicenceAction({ raw: RAW });
    expect(mocks.activate).toHaveBeenCalledTimes(1);
    expect(Object.keys(mocks.activate.mock.calls[0][0])).toEqual(["raw"]);
  });

  it("Test 7: a rejection returns Licence not activated plus the sentence and does not revalidate for a plain rejection", async () => {
    mocks.activate.mockResolvedValue({ ok: false, code: "WRONG_DEPLOYMENT" });
    await expect(activateLicenceAction({ raw: RAW })).resolves.toEqual({
      ok: false,
      code: "WRONG_DEPLOYMENT",
      message: `Licence not activated. ${rejectionSentence("WRONG_DEPLOYMENT")}`,
      neutral: false,
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["CONCURRENT_CHANGE", "ALREADY_ACTIVE", "OLDER_THAN_ACTIVE"])(
    "Test 7: %s revalidates the staff layout and the licence page",
    async (code) => {
      mocks.activate.mockResolvedValue({ ok: false, code });
      const result = await activateLicenceAction({ raw: RAW });
      expect(result).toMatchObject({ ok: false, code, neutral: code === "ALREADY_ACTIVE" });
      expect(mocks.revalidate).toHaveBeenCalledWith("/staff", "layout");
      expect(mocks.revalidate).toHaveBeenCalledWith("/staff/licence", "page");
    },
  );

  it("Test 7: CONCURRENT_CHANGE returns the concurrent-change copy", async () => {
    mocks.activate.mockResolvedValue({ ok: false, code: "CONCURRENT_CHANGE" });
    await expect(activateLicenceAction({ raw: RAW })).resolves.toMatchObject({
      message: rejectionSentence("CONCURRENT_CHANGE"),
    });
    expect(rejectionSentence("CONCURRENT_CHANGE")).toContain("The licence status changed while you were working.");
  });

  it("Test 7: AuthorizationError and AuthenticationError return the permission note", async () => {
    mocks.activate.mockRejectedValueOnce(new AuthorizationError("licence.activate"));
    await expect(activateLicenceAction({ raw: RAW })).resolves.toMatchObject({
      ok: false,
      message: ACTIVATION_PERMISSION_NOTE,
    });
    mocks.activate.mockRejectedValueOnce(new AuthenticationError());
    await expect(activateLicenceAction({ raw: RAW })).resolves.toMatchObject({
      ok: false,
      message: ACTIVATION_PERMISSION_NOTE,
    });
  });

  it("a licence refusal is never shown as a role denial (it keeps its own sentence)", async () => {
    mocks.activate.mockRejectedValueOnce(new LicenceRestrictedError("licence.activate"));
    await expect(activateLicenceAction({ raw: RAW })).resolves.toMatchObject({
      ok: false,
      message: LICENCE_REFUSAL_MESSAGE,
    });
  });

  it("Test 7: an unexpected Error returns the generic failure and logs only the error name, never the message or the text", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class StoreDownError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "StoreDownError";
      }
    }
    mocks.activate.mockRejectedValue(new StoreDownError(`insert failed for ${RAW}`));

    const result = await activateLicenceAction({ raw: RAW });

    expect(result).toEqual({
      ok: false,
      code: "FAILED",
      message: ACTIVATION_GENERIC_FAILURE,
      neutral: false,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("StoreDownError");
    expect(logged).not.toContain(RAW);
    expect(logged).not.toContain("insert failed");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("returns BAD_FORMAT for malformed input without calling the service", async () => {
    await expect(activateLicenceAction({ raw: "not a licence" })).resolves.toMatchObject({
      ok: false,
      code: "BAD_FORMAT",
    });
    await expect(activateLicenceAction(undefined)).resolves.toMatchObject({ ok: false, code: "BAD_FORMAT" });
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});
