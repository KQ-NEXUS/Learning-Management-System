/**
 * The Brevo base-URL test seam (plan 15-15; T-15-15-01).
 *
 * `BREVO_API_BASE_URL` lets the browser journey point the email client at a
 * local capture server. It must never be able to redirect real email: any
 * host other than localhost or 127.0.0.1 throws, and when it is unset the
 * client is built exactly as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailConfigError, getBrevoBaseUrl } from "@/server/email/config";
import { sendTransactionalEmail } from "@/server/email/brevo-client";

const sdk = vi.hoisted(() => ({ ctor: vi.fn(), send: vi.fn() }));

vi.mock("@getbrevo/brevo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@getbrevo/brevo")>();
  class FakeBrevoClient {
    transactionalEmails = { sendTransacEmail: sdk.send };
    constructor(options: unknown) {
      sdk.ctor(options);
    }
  }
  return { ...actual, BrevoClient: FakeBrevoClient };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBrevoBaseUrl", () => {
  it("returns undefined when unset or blank", () => {
    vi.stubEnv("BREVO_API_BASE_URL", "");
    expect(getBrevoBaseUrl()).toBeUndefined();
    vi.stubEnv("BREVO_API_BASE_URL", "   ");
    expect(getBrevoBaseUrl()).toBeUndefined();
  });

  it.each(["http://localhost:4010", "http://127.0.0.1:4010"])("accepts the loopback address %s", (url) => {
    vi.stubEnv("BREVO_API_BASE_URL", url);
    expect(getBrevoBaseUrl()).toBe(url);
  });

  it("strips trailing slashes", () => {
    vi.stubEnv("BREVO_API_BASE_URL", "http://localhost:4010/");
    expect(getBrevoBaseUrl()).toBe("http://localhost:4010");
  });

  it.each([
    "https://api.example.com",
    "https://api.brevo.com/v3",
    "http://localhost.evil.test:4010",
    "http://127.0.0.1.evil.test",
    "http://localhost@evil.test",
    "http://user:pw@localhost:4010",
    "http://10.0.0.5:4010",
    "ftp://localhost:4010",
    "not a url",
    "localhost:4010",
  ])("throws EmailConfigError for %s", (url) => {
    vi.stubEnv("BREVO_API_BASE_URL", url);
    expect(() => getBrevoBaseUrl()).toThrow(EmailConfigError);
    expect(() => getBrevoBaseUrl()).toThrow("BREVO_API_BASE_URL must point at localhost.");
  });
});

describe("sendTransactionalEmail with the seam", () => {
  beforeEach(() => {
    sdk.ctor.mockReset();
    sdk.send.mockReset();
    sdk.send.mockResolvedValue({ messageId: "<capture@localhost>" });
    vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
    vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("EMAIL_TRANSPORT", "");
  });

  const message = { to: "learner@example.com", subject: "S", textContent: "T" };

  it("builds the client with only the api key when the variable is unset", async () => {
    vi.stubEnv("BREVO_API_BASE_URL", "");
    await sendTransactionalEmail(message);
    expect(sdk.ctor).toHaveBeenCalledWith({ apiKey: "test-key" });
  });

  it("passes the loopback base URL to the client", async () => {
    vi.stubEnv("BREVO_API_BASE_URL", "http://localhost:4010");
    await sendTransactionalEmail(message);
    expect(sdk.ctor).toHaveBeenCalledWith({ apiKey: "test-key", baseUrl: "http://localhost:4010" });
  });

  it("refuses to send, and builds no client, for a non-loopback base URL", async () => {
    vi.stubEnv("BREVO_API_BASE_URL", "https://api.example.com");
    await expect(sendTransactionalEmail(message)).rejects.toThrow(EmailConfigError);
    expect(sdk.ctor).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("never reads the variable in stub mode", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    vi.stubEnv("BREVO_API_BASE_URL", "https://api.example.com");
    const result = await sendTransactionalEmail(message);
    expect(result.providerMessageId).toMatch(/^stub:/);
    expect(sdk.ctor).not.toHaveBeenCalled();
  });
});
