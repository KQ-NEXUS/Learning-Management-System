import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrevoError, BrevoTimeoutError, Brevo } from "@getbrevo/brevo";
import {
  buildTransactionalEmailPayload,
  classifyBrevoFailure,
  describeBrevoFailure,
  sendTransactionalEmail,
} from "@/server/email/brevo-client";
import { EmailConfigError } from "@/server/email/config";

describe("buildTransactionalEmailPayload", () => {
  it("produces the sender, recipient list, subject and text body Brevo expects", () => {
    const payload = buildTransactionalEmailPayload({
      to: "learner@example.com",
      subject: "Verify your account",
      textContent: "Click to verify: https://example.com/verify?token=abc",
      senderName: "Professional Training LMS",
      senderAddress: "no-reply@example.com",
    });

    expect(payload).toEqual({
      sender: { name: "Professional Training LMS", email: "no-reply@example.com" },
      to: [{ email: "learner@example.com" }],
      subject: "Verify your account",
      textContent: "Click to verify: https://example.com/verify?token=abc",
    });
  });
});

describe("describeBrevoFailure", () => {
  it("describes a BadRequestError without leaking the request body", () => {
    const error = new Brevo.BadRequestError({ code: "invalid_sender", details: "sender not verified" });
    const description = describeBrevoFailure(error);
    expect(description).toMatch(/bad request/i);
    expect(description).toMatch(/400/);
    expect(description).not.toContain("sender not verified");
  });

  it("describes a BrevoTimeoutError", () => {
    const error = new BrevoTimeoutError("timed out");
    expect(describeBrevoFailure(error)).toMatch(/timed out/i);
  });

  it("describes a generic BrevoError with its status code", () => {
    const error = new BrevoError({ message: "server error", statusCode: 500 });
    const description = describeBrevoFailure(error);
    expect(description).toMatch(/500/);
    expect(description).not.toContain("server error");
  });

  it("describes an unknown error without throwing", () => {
    expect(describeBrevoFailure(new Error("network down"))).toMatch(/unknown/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 13 plan 02: html + text, Reply-To, stub mode, classification
// ---------------------------------------------------------------------------

const sdk = vi.hoisted(() => ({
  ctor: vi.fn(),
  send: vi.fn(),
}));

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

describe("buildTransactionalEmailPayload with optional fields", () => {
  it("adds htmlContent, replyTo and tags only when supplied", () => {
    const payload = buildTransactionalEmailPayload({
      to: "learner@example.com",
      subject: "S",
      textContent: "T",
      htmlContent: "<p>T</p>",
      replyTo: { email: "help@example.com" },
      tags: ["ticket-reply"],
      senderName: "Acme",
      senderAddress: "no-reply@example.com",
    });
    expect(payload.htmlContent).toBe("<p>T</p>");
    expect(payload.replyTo).toEqual({ email: "help@example.com" });
    expect(payload.tags).toEqual(["ticket-reply"]);
  });
});

describe("sendTransactionalEmail", () => {
  beforeEach(() => {
    sdk.ctor.mockReset();
    sdk.send.mockReset();
    vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
    vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("EMAIL_TRANSPORT", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends sender, replyTo, subject, html and text and never a templateId", async () => {
    sdk.send.mockResolvedValue({ messageId: "<abc@brevo>" });
    const result = await sendTransactionalEmail({
      to: "learner@example.com",
      subject: "Ticket KQT-1 has a new reply",
      textContent: "text",
      htmlContent: "<p>html</p>",
      tags: ["ticket-reply"],
    });
    expect(result).toEqual({ providerMessageId: "<abc@brevo>" });
    expect(sdk.send).toHaveBeenCalledTimes(1);
    const payload = sdk.send.mock.calls[0][0];
    expect(payload).toEqual({
      sender: { name: "Acme Academy", email: "no-reply@acme.test" },
      replyTo: { email: "help@acme.test" },
      to: [{ email: "learner@example.com" }],
      subject: "Ticket KQT-1 has a new reply",
      htmlContent: "<p>html</p>",
      textContent: "text",
      tags: ["ticket-reply"],
    });
    expect(payload).not.toHaveProperty("templateId");
  });

  it("rejects with an EmailConfigError naming EMAIL_SENDER_ADDRESS and containing no default address", async () => {
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "");
    const error = await sendTransactionalEmail({ to: "a@b.test", subject: "s", textContent: "t" }).catch((e) => e);
    expect(error).toBeInstanceOf(EmailConfigError);
    expect(error.message).toContain("EMAIL_SENDER_ADDRESS");
    expect(error.message).not.toContain("no-reply@example.com");
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("fails loud on a missing BREVO_API_KEY", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    await expect(
      sendTransactionalEmail({ to: "a@b.test", subject: "s", textContent: "t" }),
    ).rejects.toBeInstanceOf(EmailConfigError);
  });

  it("stub mode returns a stub: id and never constructs the Brevo client", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    vi.stubEnv("BREVO_API_KEY", "");
    const result = await sendTransactionalEmail({ to: "a@b.test", subject: "s", textContent: "t" });
    expect(result.providerMessageId).toMatch(/^stub:[0-9a-f-]{36}$/);
    expect(sdk.ctor).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("stub mode still resolves the sender identity (fail loud)", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    vi.stubEnv("EMAIL_SENDER_NAME", "");
    await expect(
      sendTransactionalEmail({ to: "a@b.test", subject: "s", textContent: "t" }),
    ).rejects.toBeInstanceOf(EmailConfigError);
  });

  it("an unknown transport value throws", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "smtp");
    await expect(
      sendTransactionalEmail({ to: "a@b.test", subject: "s", textContent: "t" }),
    ).rejects.toBeInstanceOf(EmailConfigError);
  });
});

describe("classifyBrevoFailure", () => {
  it("permanent for a bad request, config error and 401/403/404/422", () => {
    expect(classifyBrevoFailure(new Brevo.BadRequestError({ code: "x" }))).toBe("permanent");
    expect(classifyBrevoFailure(new EmailConfigError("EMAIL_SENDER_NAME is not configured."))).toBe("permanent");
    for (const statusCode of [401, 403, 404, 422]) {
      expect(classifyBrevoFailure(new BrevoError({ message: "m", statusCode }))).toBe("permanent");
    }
  });

  it("transient for timeout, 408, 425, 429, 5xx and network errors", () => {
    expect(classifyBrevoFailure(new BrevoTimeoutError("t"))).toBe("transient");
    for (const statusCode of [408, 425, 429, 500, 502, 503, 504]) {
      expect(classifyBrevoFailure(new BrevoError({ message: "m", statusCode }))).toBe("transient");
    }
    expect(classifyBrevoFailure(new Error("ECONNRESET"))).toBe("transient");
  });

  it("describeBrevoFailure gives a generic message for a config error", () => {
    const description = describeBrevoFailure(new EmailConfigError("EMAIL_SENDER_NAME is not configured."));
    expect(description).toMatch(/configuration/i);
  });
});
