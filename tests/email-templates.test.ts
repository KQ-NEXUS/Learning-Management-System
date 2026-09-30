import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATEGORY, TEMPLATE_IDS, type TemplateId } from "@/server/communications/contracts";
import {
  renderEmail,
  TEMPLATE_REGISTRY,
  TEMPLATE_SAMPLES,
  type TemplateParamsMap,
} from "@/server/email/templates/registry";

beforeEach(() => {
  vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
  vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
  vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
  vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ticket-reply (tracer)", () => {
  it("renders subject, html and text with an absolute link", () => {
    const out = renderEmail("ticket-reply", { reference: "KQT-1", ticketPath: "/support/KQT-1" });
    expect(out.subject).toBe("Ticket KQT-1 has a new reply");
    expect(out.html).toContain("View ticket");
    expect(out.html).toContain('href="https://lms.acme.test/support/KQT-1"');
    expect(out.html).toContain("Acme Academy");
    expect(out.html).toContain("help@acme.test");
    expect(out.html).toContain("You are receiving this because of activity on your account.");
    expect(out.text.split("\n")).toContain("https://lms.acme.test/support/KQT-1");
  });

  it("escapes a hostile reference in html", () => {
    const out = renderEmail("ticket-reply", {
      reference: "<script>alert(1)</script>",
      ticketPath: "/support/x",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("strips CR and LF from the subject", () => {
    const out = renderEmail("ticket-reply", {
      reference: "KQT-1\r\nBcc: attacker@evil.test",
      ticketPath: "/support/x",
    });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("ignores a hostile extra params key", () => {
    const params = {
      reference: "KQT-1",
      ticketPath: "/support/KQT-1",
      body: "SECRET-BODY",
      reason: "SECRET-REASON",
    };
    const out = renderEmail("ticket-reply", params);
    expect(out.html).not.toContain("SECRET");
    expect(out.text).not.toContain("SECRET");
  });

  it("refuses a non-internal link path", () => {
    expect(() =>
      renderEmail("ticket-reply", { reference: "KQT-1", ticketPath: "https://evil.example/x" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Learner templates (plan 13-02 task 2)
// ---------------------------------------------------------------------------

const LEARNER_IDS = TEMPLATE_IDS.filter(
  (id) => TEMPLATE_CATEGORY[id] !== "AUTH" && TEMPLATE_CATEGORY[id] !== "STAFF",
);
const REFERENCE_ONLY_IDS: TemplateId[] = [
  "certificate-revoked",
  "ticket-created",
  "ticket-reply",
  "ticket-resolved",
  "ticket-reopened",
  "ticket-closed",
];

type AnyParams = Record<string, string | undefined>;
const sampleOf = (id: TemplateId): AnyParams =>
  (TEMPLATE_SAMPLES as unknown as Record<string, AnyParams>)[id];
const renderAny = (id: TemplateId, params: AnyParams) =>
  (renderEmail as unknown as (t: TemplateId, p: AnyParams) => ReturnType<typeof renderEmail>)(id, params);

describe("learner templates", () => {
  it("there are 20 learner ids and each has a registry entry and sample", () => {
    expect(LEARNER_IDS).toHaveLength(20);
    for (const id of LEARNER_IDS) {
      expect(TEMPLATE_REGISTRY[id as keyof TemplateParamsMap], id).toBeTypeOf("function");
      expect(sampleOf(id), id).toBeDefined();
    }
  });

  it.each(LEARNER_IDS)("%s renders subject, html and text from its sample", (id) => {
    const out = renderAny(id, sampleOf(id));
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.html.length).toBeGreaterThan(0);
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.subject).not.toMatch(/[\r\n]/);
    // sentence case, no emoji, no urgency
    expect(out.subject).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(out.html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(out.html + out.text).not.toMatch(/hurry|last chance|don't miss|limited time/i);
  });

  it.each(LEARNER_IDS)("%s never leaks hostile extra params", (id) => {
    const out = renderAny(id, {
      ...sampleOf(id),
      reason: "SECRET-REASON",
      body: "SECRET-BODY",
      message: "SECRET-BODY",
      filename: "secret-file.pdf",
      score: "SECRET-SCORE",
    });
    for (const secret of ["SECRET-REASON", "SECRET-BODY", "secret-file.pdf", "SECRET-SCORE"]) {
      expect(out.html).not.toContain(secret);
      expect(out.text).not.toContain(secret);
      expect(out.subject).not.toContain(secret);
    }
  });

  it.each(LEARNER_IDS)("%s renders absolute links from the configured base URL", (id) => {
    const out = renderAny(id, sampleOf(id));
    const hrefs = [...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith("mailto:"));
    // certificate-revoked is reference-only and carries no link (T-11-50).
    if (id === "certificate-revoked") {
      expect(hrefs).toHaveLength(0);
      return;
    }
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href.startsWith("https://lms.acme.test/")).toBe(true);
  });

  it.each(LEARNER_IDS)("%s escapes a script-tag title and survives a 200-char title", (id) => {
    const params = sampleOf(id);
    const titleKeys = Object.keys(params).filter((k) => /Title$/.test(k));
    if (titleKeys.length === 0) return;
    const hostile: AnyParams = { ...params };
    for (const k of titleKeys) hostile[k] = "<script>alert(1)</script>";
    const out = renderAny(id, hostile);
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    const long: AnyParams = { ...params };
    for (const k of titleKeys) long[k] = "T".repeat(200);
    const outLong = renderAny(id, long);
    expect(outLong.text).toContain("T".repeat(200));
  });

  it.each(LEARNER_IDS)("%s subject contains the reference when one exists", (id) => {
    const params = sampleOf(id);
    const ref = params.reference ?? params.orderReference ?? params.verificationRef ?? params.newVerificationRef;
    if (!ref) return;
    expect(renderAny(id, params).subject).toContain(ref);
  });

  it("reference-only templates render no free-text fields", () => {
    for (const id of REFERENCE_ONLY_IDS) {
      const keys = Object.keys(sampleOf(id));
      for (const key of keys) {
        expect(key, `${id}.${key}`).toMatch(/^(reference|verificationRef|ticketPath|dashboardPath)$/);
      }
    }
  });

  it("no template param sample declares reason, body, message, filename or score", () => {
    for (const id of LEARNER_IDS) {
      for (const key of Object.keys(sampleOf(id))) {
        expect(key, `${id}.${key}`).not.toMatch(/^(reason|body|message|filename|score)$/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Auth and staff templates, exhaustive registry (plan 13-02 task 3)
// ---------------------------------------------------------------------------

const AUTH_IDS: TemplateId[] = ["email-verification", "password-reset", "email-change-confirmation"];
const STAFF_IDS: TemplateId[] = [
  "staff-ticket-assigned",
  "staff-ticket-escalated",
  "staff-order-exception",
  "staff-reconciliation-exception",
];

describe("registry exhaustiveness", () => {
  it("has a registry entry and a sample for every one of the 28 ids", () => {
    expect(TEMPLATE_IDS).toHaveLength(28);
    for (const id of TEMPLATE_IDS) {
      expect(TEMPLATE_REGISTRY[id as keyof TemplateParamsMap], id).toBeTypeOf("function");
      expect(sampleOf(id), id).toBeDefined();
    }
  });

  it.each(TEMPLATE_IDS)("%s ignores hostile extra keys and never leaks them", (id) => {
    const out = renderAny(id, {
      ...sampleOf(id),
      reason: "SECRET-REASON",
      body: "SECRET-BODY",
      filename: "secret-file.pdf",
      note: "SECRET-NOTE",
    });
    for (const secret of ["SECRET-REASON", "SECRET-BODY", "secret-file.pdf", "SECRET-NOTE"]) {
      expect(out.html + out.text + out.subject).not.toContain(secret);
    }
  });

  it.each(TEMPLATE_IDS)("%s subject has no CR or LF", (id) => {
    expect(renderAny(id, sampleOf(id)).subject).not.toMatch(/[\r\n]/);
  });
});

describe("auth templates", () => {
  it.each(AUTH_IDS)("%s renders the supplied url as a button and a raw line, with the expiry", (id) => {
    const params = sampleOf(id);
    const out = renderAny(id, params);
    expect(out.html).toContain(`href="${params.url}"`);
    expect(out.text.split("\n")).toContain(params.url);
    expect(out.html).toContain(params.expiresInLabel);
    expect(out.text).toContain(params.expiresInLabel);
  });

  it.each(AUTH_IDS)("%s throws when the url is on a different origin", (id) => {
    expect(() =>
      renderAny(id, { ...sampleOf(id), url: "https://evil.example/verify?token=x" }),
    ).toThrow();
    expect(() =>
      renderAny(id, { ...sampleOf(id), url: "https://lms.acme.test.evil.example/verify" }),
    ).toThrow();
  });

  it("has the specified subjects", () => {
    expect(renderAny("email-verification", sampleOf("email-verification")).subject).toBe("Verify your account");
    expect(renderAny("password-reset", sampleOf("password-reset")).subject).toBe("Reset your password");
    expect(renderAny("email-change-confirmation", sampleOf("email-change-confirmation")).subject).toBe(
      "Confirm your new email address",
    );
  });

  it("only auth templates carry a token in a link", () => {
    for (const id of TEMPLATE_IDS) {
      if (AUTH_IDS.includes(id)) continue;
      expect(renderAny(id, sampleOf(id)).html, id).not.toMatch(/token=/);
    }
  });
});

describe("staff templates", () => {
  it.each(STAFF_IDS)("%s renders from references and labels", (id) => {
    const out = renderAny(id, sampleOf(id));
    expect(out.html).toContain("https://lms.acme.test/");
    expect(out.subject.length).toBeGreaterThan(0);
  });

  it("staff-order-exception shows the plain-language label, never coded detail", () => {
    const out = renderAny("staff-order-exception", {
      orderReference: "KQO-1",
      reasonLabel: "Amount mismatch",
      paymentPath: "/staff/payments/1",
      detail: "SECRET-DETAIL",
    });
    expect(out.html).toContain("Amount mismatch");
    expect(out.html + out.text).not.toContain("SECRET-DETAIL");
  });
});
