import { describe, expect, it } from "vitest";
import { BrevoError, BrevoTimeoutError, Brevo } from "@getbrevo/brevo";
import {
  buildTransactionalEmailPayload,
  describeBrevoFailure,
} from "@/server/email/brevo-client";

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
