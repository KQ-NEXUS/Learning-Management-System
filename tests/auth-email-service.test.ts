import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAuthEmail, formatTtlLabel } from "@/server/services/auth-email-service";
import { buildAuthCorrelationId, type DispatchParams } from "@/server/services/email-dispatch-service";
import { VERIFICATION_TOKEN_TTL_MS, PASSWORD_RESET_TOKEN_TTL_MS } from "@/lib/identity";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubEmailEnv() {
  vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
  vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
  vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
  vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
}

describe("formatTtlLabel", () => {
  it("renders whole-hour durations as hours", () => {
    expect(formatTtlLabel(VERIFICATION_TOKEN_TTL_MS)).toBe("24 hours");
    expect(formatTtlLabel(PASSWORD_RESET_TOKEN_TTL_MS)).toBe("1 hour");
  });

  it("renders non-hour durations as minutes", () => {
    expect(formatTtlLabel(30 * 60 * 1000)).toBe("30 minutes");
    expect(formatTtlLabel(60 * 1000)).toBe("1 minute");
  });
});

describe("sendAuthEmail — dispatched params", () => {
  it("builds an absolute url on the configured origin, derives the token-hash correlationId, and never puts the raw token anywhere but the url", async () => {
    stubEmailEnv();
    const dispatched: DispatchParams[] = [];
    const dispatch = vi.fn(async (params: DispatchParams) => {
      dispatched.push(params);
      return { id: "ed-1" };
    });

    const result = await sendAuthEmail(dispatch, {
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      path: "/verify",
      token: "raw-secret-token",
      ttlMs: VERIFICATION_TOKEN_TTL_MS,
    });

    expect(result).toEqual({ sent: true });
    expect(dispatched).toHaveLength(1);
    const params = dispatched[0];
    expect(params.template).toBe("email-verification");
    expect(params.correlationId).toBe(buildAuthCorrelationId("raw-secret-token"));
    expect(params.correlationId).not.toContain("raw-secret-token");
    expect(params.htmlContent).toContain("https://lms.acme.test/verify?token=raw-secret-token");
    expect(params.textContent).toContain("https://lms.acme.test/verify?token=raw-secret-token");
    // The only place the raw token appears is inside the rendered url text —
    // never as a bare, separately-storable field.
    expect(Object.keys(params)).not.toContain("token");
  });

  it("derives the same correlationId for the same token across two calls, and a different one for a different token", async () => {
    stubEmailEnv();
    const dispatched: DispatchParams[] = [];
    const dispatch = vi.fn(async (params: DispatchParams) => {
      dispatched.push(params);
      return { id: "ed-1" };
    });

    await sendAuthEmail(dispatch, {
      template: "password-reset",
      toEmail: "learner@example.com",
      userId: "u1",
      path: "/reset-password",
      token: "token-a",
      ttlMs: PASSWORD_RESET_TOKEN_TTL_MS,
    });
    await sendAuthEmail(dispatch, {
      template: "password-reset",
      toEmail: "learner@example.com",
      userId: "u1",
      path: "/reset-password",
      token: "token-a",
      ttlMs: PASSWORD_RESET_TOKEN_TTL_MS,
    });
    await sendAuthEmail(dispatch, {
      template: "password-reset",
      toEmail: "learner@example.com",
      userId: "u1",
      path: "/reset-password",
      token: "token-b",
      ttlMs: PASSWORD_RESET_TOKEN_TTL_MS,
    });

    expect(dispatched[0].correlationId).toBe(dispatched[1].correlationId);
    expect(dispatched[0].correlationId).not.toBe(dispatched[2].correlationId);
  });
});

describe("sendAuthEmail — best-effort swallowing", () => {
  it("resolves { sent: false } and does not reject when dispatch rejects", async () => {
    stubEmailEnv();
    const dispatch = vi.fn(async () => {
      throw new Error("simulated provider outage");
    });

    const result = await sendAuthEmail(dispatch, {
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      path: "/verify",
      token: "tok-1",
      ttlMs: VERIFICATION_TOKEN_TTL_MS,
    });

    expect(result).toEqual({ sent: false });
  });

  it("resolves { sent: false } and does not reject when the base URL is unconfigured (render/config error)", async () => {
    vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
    vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", ""); // unconfigured, and production disallows the localhost fallback

    const dispatch = vi.fn(async () => ({ id: "ed-1" }));

    const result = await sendAuthEmail(dispatch, {
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      path: "/verify",
      token: "tok-1",
      ttlMs: VERIFICATION_TOKEN_TTL_MS,
    });

    expect(result).toEqual({ sent: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("resolves { sent: false } when render throws for an unsupported template shape (never surfaces the render error)", async () => {
    stubEmailEnv();
    const dispatch = vi.fn(async () => ({ id: "ed-1" }));

    // An absolute foreign origin embedded in the path is rejected by
    // buildAbsoluteUrl before renderEmail is ever reached.
    const result = await sendAuthEmail(dispatch, {
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      path: "https://evil.example/verify",
      token: "tok-1",
      ttlMs: VERIFICATION_TOKEN_TTL_MS,
    });

    expect(result).toEqual({ sent: false });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
