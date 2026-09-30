import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmailConfigError,
  buildAbsoluteUrl,
  getBrandName,
  getEmailTransportMode,
  getPublicBaseUrl,
  getReplyTo,
  getSenderIdentity,
  sanitizeHeaderText,
} from "@/server/email/config";
import { requireSupportContactEmail } from "@/server/support-contact";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubIdentity() {
  vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
  vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
  vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
}

describe("getSenderIdentity", () => {
  it("returns the trimmed configured name and address", () => {
    vi.stubEnv("EMAIL_SENDER_NAME", "  Acme Academy ");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", " no-reply@acme.test ");
    expect(getSenderIdentity()).toEqual({ name: "Acme Academy", email: "no-reply@acme.test" });
  });

  it("throws naming EMAIL_SENDER_NAME when it is unset, with no default", () => {
    vi.stubEnv("EMAIL_SENDER_NAME", "");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
    expect(() => getSenderIdentity()).toThrow(EmailConfigError);
    expect(() => getSenderIdentity()).toThrow(/EMAIL_SENDER_NAME/);
  });

  it("throws naming EMAIL_SENDER_ADDRESS when it is unset, with no default", () => {
    vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "");
    expect(() => getSenderIdentity()).toThrow(/EMAIL_SENDER_ADDRESS/);
  });

  it("rejects an address without an at-sign or with CR/LF", () => {
    vi.stubEnv("EMAIL_SENDER_NAME", "Acme");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "not-an-address");
    expect(() => getSenderIdentity()).toThrow(EmailConfigError);
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "a@b.test\r\nBcc: x@y.test");
    expect(() => getSenderIdentity()).toThrow(EmailConfigError);
  });

  it("never puts the configured value in the error message", () => {
    vi.stubEnv("EMAIL_SENDER_NAME", "Acme");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "bad-address-value");
    try {
      getSenderIdentity();
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("bad-address-value");
    }
  });
});

describe("getBrandName / getReplyTo", () => {
  it("brand equals the sender name", () => {
    stubIdentity();
    expect(getBrandName()).toBe("Acme Academy");
  });

  it("Reply-To comes from SUPPORT_CONTACT_EMAIL and throws when unset", () => {
    stubIdentity();
    expect(getReplyTo()).toEqual({ email: "help@acme.test" });
    vi.stubEnv("SUPPORT_CONTACT_EMAIL", "");
    expect(() => getReplyTo()).toThrow(/SUPPORT_CONTACT_EMAIL/);
    expect(() => requireSupportContactEmail()).toThrow(/SUPPORT_CONTACT_EMAIL/);
  });
});

describe("getPublicBaseUrl", () => {
  it("strips trailing slashes from APP_BASE_URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://lms.acme.test//");
    expect(getPublicBaseUrl()).toBe("https://lms.acme.test");
  });

  it("throws in production when unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "");
    expect(() => getPublicBaseUrl()).toThrow(EmailConfigError);
  });

  it("falls back to localhost only in test/development", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_BASE_URL", "");
    expect(getPublicBaseUrl()).toBe("http://localhost:3000");
  });

  it("rejects a non-http(s) value", () => {
    vi.stubEnv("APP_BASE_URL", "ftp://lms.acme.test");
    expect(() => getPublicBaseUrl()).toThrow(EmailConfigError);
  });
});

describe("buildAbsoluteUrl", () => {
  it("joins an internal path to the base URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
    expect(buildAbsoluteUrl("/support/KQT-1")).toBe("https://lms.acme.test/support/KQT-1");
  });

  it("encodes the query record", () => {
    vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
    expect(buildAbsoluteUrl("/verify", { token: "a b&c" })).toBe(
      "https://lms.acme.test/verify?token=a%20b%26c",
    );
  });

  it.each(["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "support/x", "/a:b//c", ""])(
    "rejects %s",
    (bad) => {
      vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
      expect(() => buildAbsoluteUrl(bad)).toThrow(EmailConfigError);
    },
  );
});

describe("getEmailTransportMode", () => {
  it("defaults to brevo", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");
    expect(getEmailTransportMode()).toBe("brevo");
    vi.stubEnv("EMAIL_TRANSPORT", "brevo");
    expect(getEmailTransportMode()).toBe("brevo");
  });

  it("returns stub only for the exact value", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    expect(getEmailTransportMode()).toBe("stub");
  });

  it("throws on an unknown value", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "smtp");
    expect(() => getEmailTransportMode()).toThrow(EmailConfigError);
  });
});

describe("sanitizeHeaderText", () => {
  it("strips CR/LF and control characters and collapses whitespace", () => {
    expect(sanitizeHeaderText("Hi\r\nBcc: a@b.test\u0000  there")).toBe("Hi Bcc: a@b.test there");
  });
});
