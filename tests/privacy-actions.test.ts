/**
 * `requestLearnerExportAction` and `anonymiseLearnerAction` (plan 15-22; D-12,
 * NFR-11, T-15-22-01, T-15-22-03): each action is a public POST endpoint, so it
 * validates its own input with a strict schema, delegates to the privacy
 * service (which re-checks the permission, the reason and the target), returns
 * a fixed `{ ok } | { ok: false, message }` result, and never passes a caught
 * exception's own text back to the browser.
 *
 * The services are mocked: their behaviour is proven against a real database in
 * `privacy-export.integration.test.ts` and `privacy-anonymise.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestLearnerExport: vi.fn(),
  anonymiseLearner: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/services/privacy-export-service", () => ({
  MIN_EXPORT_REASON_LENGTH: 10,
  MAX_EXPORT_REASON_LENGTH: 2000,
  privacyExportService: { requestLearnerExport: mocks.requestLearnerExport },
}));
vi.mock("@/server/services/privacy-anonymise-service", async () => {
  class AnonymiseConflictError extends Error {}
  return {
    MIN_ANONYMISE_REASON_LENGTH: 20,
    AnonymiseConflictError,
    privacyAnonymiseService: { anonymiseLearner: mocks.anonymiseLearner },
  };
});

import { anonymiseLearnerAction, requestLearnerExportAction } from "@/app/staff/privacy/actions";
import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";
import { AuthenticationError, AuthorizationError, LicenceRestrictedError } from "@/server/permissions";
import { AnonymiseConflictError } from "@/server/services/privacy-anonymise-service";

const EXPORT_FAILED = "The export was not requested. Try again; if it fails again, contact an administrator.";
const ANONYMISE_FAILED = "The account was not changed. Try again; if it fails again, contact an administrator.";
const RELOAD = "This account changed while you were working. Reload the page and check it before trying again.";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestLearnerExportAction", () => {
  const valid = { userId: "user-1", reason: "Learner request ref DSAR-0042" };

  it("returns ok with the job status, passes the trimmed input to the service and revalidates the record page", async () => {
    mocks.requestLearnerExport.mockResolvedValue({ jobId: "job-1", status: "QUEUED", reused: false });
    const result = await requestLearnerExportAction({ userId: "  user-1  ", reason: "  Learner request ref DSAR-0042  " });
    expect(result).toEqual({ ok: true, status: "QUEUED" });
    expect(mocks.requestLearnerExport).toHaveBeenCalledWith(valid);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff/privacy/user-1", "page");
  });

  it("reports an open request the same way (the service reuses it)", async () => {
    mocks.requestLearnerExport.mockResolvedValue({ jobId: "job-1", status: "PROCESSING", reused: true });
    expect(await requestLearnerExportAction(valid)).toEqual({ ok: true, status: "PROCESSING" });
  });

  it("returns a generic failure for a 9-character reason and never calls the service", async () => {
    expect(await requestLearnerExportAction({ userId: "user-1", reason: "123456789" })).toEqual({
      ok: false,
      message: EXPORT_FAILED,
    });
    expect(mocks.requestLearnerExport).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("accepts a reason of exactly 10 characters after trimming", async () => {
    mocks.requestLearnerExport.mockResolvedValue({ jobId: "job-1", status: "QUEUED", reused: false });
    expect((await requestLearnerExportAction({ userId: "user-1", reason: "  1234567890  " })).ok).toBe(true);
  });

  it("rejects a missing or empty userId, a non-object and extra keys (strict schema)", async () => {
    for (const input of [
      { reason: valid.reason },
      { userId: "", reason: valid.reason },
      { userId: "   ", reason: valid.reason },
      { userId: "x".repeat(129), reason: valid.reason },
      { ...valid, extra: "unexpected" },
      { ...valid, isStaff: true },
      null,
      undefined,
      "user-1",
      [valid],
    ]) {
      expect(await requestLearnerExportAction(input), JSON.stringify(input)).toEqual({ ok: false, message: EXPORT_FAILED });
    }
    expect(mocks.requestLearnerExport).not.toHaveBeenCalled();
  });

  it("collapses no permission, no session, an unknown id and any other failure to the same message", async () => {
    const failures = [
      new AuthorizationError("privacy.manage"),
      new AuthenticationError(),
      new Error("This learner could not be found."),
      new Error("SECRET internal detail"),
    ];
    const results = [];
    for (const failure of failures) {
      mocks.requestLearnerExport.mockRejectedValueOnce(failure);
      results.push(await requestLearnerExportAction(valid));
    }
    for (const result of results) expect(result).toEqual({ ok: false, message: EXPORT_FAILED });
    expect(JSON.stringify(results)).not.toContain("SECRET");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("anonymiseLearnerAction", () => {
  const valid = { userId: "user-1", reason: "Erasure request ref DSAR-0042 in writing" };

  it("returns ok, passes the trimmed input to the service and revalidates the record page", async () => {
    mocks.anonymiseLearner.mockResolvedValue({ userId: "user-1", anonymisedAt: new Date() });
    const result = await anonymiseLearnerAction({ userId: " user-1 ", reason: ` ${valid.reason} ` });
    expect(result).toEqual({ ok: true });
    expect(mocks.anonymiseLearner).toHaveBeenCalledWith(valid);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff/privacy/user-1", "page");
  });

  it("returns a generic failure for a 19-character reason and never calls the service", async () => {
    expect(await anonymiseLearnerAction({ userId: "user-1", reason: "1234567890123456789" })).toEqual({
      ok: false,
      message: ANONYMISE_FAILED,
    });
    expect(mocks.anonymiseLearner).not.toHaveBeenCalled();
  });

  it("accepts a reason of exactly 20 characters after trimming", async () => {
    mocks.anonymiseLearner.mockResolvedValue({ userId: "user-1", anonymisedAt: new Date() });
    expect((await anonymiseLearnerAction({ userId: "user-1", reason: "  12345678901234567890  " })).ok).toBe(true);
  });

  it("rejects a missing userId, a non-object and extra keys (strict schema)", async () => {
    for (const input of [
      { reason: valid.reason },
      { userId: "", reason: valid.reason },
      { ...valid, extra: "unexpected" },
      { ...valid, typedEmail: "ada@example.test" },
      null,
      undefined,
      42,
    ]) {
      expect(await anonymiseLearnerAction(input), JSON.stringify(input)).toEqual({ ok: false, message: ANONYMISE_FAILED });
    }
    expect(mocks.anonymiseLearner).not.toHaveBeenCalled();
  });

  it("maps the lost race of two anonymise calls to the reload copy", async () => {
    mocks.anonymiseLearner.mockRejectedValue(new AnonymiseConflictError());
    expect(await anonymiseLearnerAction(valid)).toEqual({ ok: false, message: RELOAD });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a restricted deployment to the licence refusal message the modal draws as a calm note", async () => {
    mocks.anonymiseLearner.mockRejectedValue(new LicenceRestrictedError("privacy.manage"));
    expect(await anonymiseLearnerAction(valid)).toEqual({ ok: false, message: LICENCE_REFUSAL_MESSAGE });
  });

  it("collapses no permission, no session, a refused target and any other failure to the same message", async () => {
    const failures = [
      new AuthorizationError("privacy.manage"),
      new AuthenticationError(),
      new Error("This account cannot be anonymised."),
      new Error("SECRET internal detail"),
    ];
    const results = [];
    for (const failure of failures) {
      mocks.anonymiseLearner.mockRejectedValueOnce(failure);
      results.push(await anonymiseLearnerAction(valid));
    }
    for (const result of results) expect(result).toEqual({ ok: false, message: ANONYMISE_FAILED });
    expect(JSON.stringify(results)).not.toContain("SECRET");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
