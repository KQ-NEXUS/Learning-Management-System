/**
 * `resendEmailAction` (D-06, T-13-08): a `.strict()` schema with a 10-character
 * reason minimum, a fixed `{ ok } | { ok: false, message }` result, and a
 * closed error-message map that never passes a caught exception's own
 * `.message` back to the browser — mirrors `certificate-issue-action.test.ts`'s
 * shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resendDispatch: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/services/email-delivery-log-service", () => ({
  emailDeliveryLogService: { resendDispatch: mocks.resendDispatch },
}));

import { resendEmailAction } from "@/app/staff/email-log/actions";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";

const validInput = { dispatchId: "ed-1", reason: "a valid reason for resending" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resendEmailAction", () => {
  it("returns ok true and revalidates the email log page on success", async () => {
    mocks.resendDispatch.mockResolvedValue(undefined);
    const result = await resendEmailAction(validInput);
    expect(result).toEqual({ ok: true });
    expect(mocks.resendDispatch).toHaveBeenCalledWith(validInput);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff/email-log");
  });

  it("returns ok false for a 9-character reason and never calls the service", async () => {
    const result = await resendEmailAction({ dispatchId: "ed-1", reason: "123456789" });
    expect(result).toEqual({ ok: false, message: "Email not resent. Try again." });
    expect(mocks.resendDispatch).not.toHaveBeenCalled();
  });

  it("rejects a missing dispatchId", async () => {
    const result = await resendEmailAction({ reason: "a valid reason for resending" });
    expect(result.ok).toBe(false);
    expect(mocks.resendDispatch).not.toHaveBeenCalled();
  });

  it("rejects extra keys (.strict())", async () => {
    const result = await resendEmailAction({ ...validInput, extra: "unexpected" });
    expect(result.ok).toBe(false);
    expect(mocks.resendDispatch).not.toHaveBeenCalled();
  });

  it("maps AuthenticationError to a generic not-authorised message", async () => {
    mocks.resendDispatch.mockRejectedValue(new AuthenticationError());
    const result = await resendEmailAction(validInput);
    expect(result).toEqual({ ok: false, message: "You are not authorised to perform this action." });
  });

  it("maps AuthorizationError to a generic not-authorised message", async () => {
    mocks.resendDispatch.mockRejectedValue(new AuthorizationError("users.manage"));
    const result = await resendEmailAction(validInput);
    expect(result).toEqual({ ok: false, message: "You are not authorised to perform this action." });
  });

  it("maps any other failure (ineligible row, not found, etc.) to the fixed UI-SPEC failure copy", async () => {
    mocks.resendDispatch.mockRejectedValue(new Error("This email cannot be resent."));
    const result = await resendEmailAction(validInput);
    expect(result).toEqual({ ok: false, message: "Email not resent. Try again." });
  });

  it("never passes raw error text through", async () => {
    mocks.resendDispatch.mockRejectedValue(new Error("SECRET internal detail"));
    const result = await resendEmailAction(validInput);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});
