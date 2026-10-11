/**
 * D-11 (plan 15-03) — forgot password and resend verification are limited
 * per device with the UI-SPEC S5 copy, and otherwise keep their single
 * neutral state for a known and an unknown address alike (P4).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  consume: vi.fn(),
  requestReset: vi.fn(),
  resendVerification: vi.fn(),
  headers: new Headers({ "x-nf-client-connection-ip": "198.51.100.7" }),
}));

vi.mock("next/headers", () => ({ headers: async () => m.headers }));
vi.mock("@/server/services/rate-limit-service", () => ({ rateLimitService: { consume: m.consume } }));
vi.mock("@/server/services/password-reset-service", () => ({
  passwordResetService: { requestReset: m.requestReset },
}));
vi.mock("@/server/services/verification-service", () => ({
  verificationService: { resendVerification: m.resendVerification },
}));

import { forgotPasswordAction } from "@/app/(auth)/forgot-password/actions";
import { resendVerificationAction } from "@/app/(auth)/verify/actions";

const INITIAL = { error: null, sent: false };

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.consume.mockResolvedValue({ limited: false, windowMinutes: 15 });
  m.requestReset.mockResolvedValue({ ok: true });
  m.resendVerification.mockResolvedValue({ ok: true });
});

describe("forgotPasswordAction — per-device limit", () => {
  it("a limited device gets the S5 reset message and requestReset is never called", async () => {
    m.consume.mockResolvedValueOnce({ limited: true, windowMinutes: 15 });

    expect(await forgotPasswordAction(INITIAL, form("ada@example.test"))).toEqual({
      error: "Too many reset requests from this device. Wait 15 minutes, then try again.",
      sent: false,
    });
    expect(m.requestReset).not.toHaveBeenCalled();
    expect(m.consume).toHaveBeenCalledWith("forgotPassword", { ip: "198.51.100.7", email: "ada@example.test" });
  });

  it("an unlimited device gets the unchanged neutral state for a known and an unknown address alike", async () => {
    m.requestReset.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: "NO_ACCOUNT" });
    const known = await forgotPasswordAction(INITIAL, form("ada@example.test"));
    const unknown = await forgotPasswordAction(INITIAL, form("nobody@example.test"));

    expect(known).toEqual({ error: null, sent: true });
    expect(unknown).toEqual(known);
    expect(m.requestReset).toHaveBeenCalledTimes(2);
  });

  it("an empty address is refused before the limiter, so it consumes nothing", async () => {
    await forgotPasswordAction(INITIAL, form(""));
    expect(m.consume).not.toHaveBeenCalled();
  });

  it("a limiter failure collapses to the same neutral state as any other failure", async () => {
    m.consume.mockRejectedValueOnce(new Error("database down"));
    expect(await forgotPasswordAction(INITIAL, form("ada@example.test"))).toEqual({ error: null, sent: true });
  });
});

describe("resendVerificationAction — per-device limit", () => {
  it("a limited device gets the S5 new-link message and resendVerification is never called", async () => {
    m.consume.mockResolvedValueOnce({ limited: true, windowMinutes: 15 });

    expect(await resendVerificationAction(INITIAL, form("ada@example.test"))).toEqual({
      error: "Too many requests for a new link from this device. Wait 15 minutes, then try again.",
      sent: false,
    });
    expect(m.resendVerification).not.toHaveBeenCalled();
    expect(m.consume).toHaveBeenCalledWith("resendVerification", { ip: "198.51.100.7", email: "ada@example.test" });
  });

  it("an unlimited device gets the unchanged neutral state for a known and an unknown address alike", async () => {
    m.resendVerification.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    const known = await resendVerificationAction(INITIAL, form("ada@example.test"));
    const unknown = await resendVerificationAction(INITIAL, form("nobody@example.test"));

    expect(known).toEqual({ error: null, sent: true });
    expect(unknown).toEqual(known);
  });

  it("an empty address is refused before the limiter, so it consumes nothing", async () => {
    await resendVerificationAction(INITIAL, form(""));
    expect(m.consume).not.toHaveBeenCalled();
  });
});
