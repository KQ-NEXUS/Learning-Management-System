/**
 * Route-table guard (plan 11-21, UAT test 13, threat T-11-87).
 *
 * `/verify` belongs to IAM-02 email verification (`(auth)/verify/page.tsx`,
 * linked from already-dispatched emails). Next.js refuses two pages on one
 * path, so the public reference-entry page lives at `/verify-certificate`.
 * These assertions fail loudly if a bare `src/app/verify/page.tsx` is ever
 * added or the auth page is moved.
 *
 * Plan 15-03 (D-11, UI-SPEC S5, T-15-03-03) adds the result page's fourth
 * render branch: a device past the certificate-check limit gets its own
 * heading block, no `<dl>`, and no lookup. The real limiter and audit sink run
 * here over a mocked Prisma slice, so the test proves the wiring end to end
 * without a database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const m = vi.hoisted(() => ({
  headers: new Headers(),
  queryRaw: vi.fn(),
  auditCreate: vi.fn(),
  verifyCertificateByRef: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => m.headers }));
vi.mock("@/server/db", () => ({
  prisma: { $queryRaw: m.queryRaw, auditEvent: { create: m.auditCreate } },
}));
vi.mock("@/server/services/certificate-verification-service", () => ({
  verifyCertificateByRef: m.verifyCertificateByRef,
}));
vi.mock("@/app/verify/VerifyReferenceForm", () => ({
  VerifyReferenceForm: () => createElement("form", { "data-testid": "reference-form" }),
}));
vi.mock("@/components/shell/LearnerPageHeader", () => ({
  LearnerPageHeader: ({ title }: { title: string }) => createElement("h1", null, title),
}));

import VerifyResultPage from "@/app/verify/[verificationRef]/page";

const exists = (rel: string) => fs.existsSync(path.resolve(process.cwd(), rel));

describe("verification route table", () => {
  it("keeps the IAM-02 email-verification page at /verify", () => {
    expect(exists("src/app/(auth)/verify/page.tsx")).toBe(true);
  });

  it("keeps the public result page at /verify/[verificationRef]", () => {
    expect(exists("src/app/verify/[verificationRef]/page.tsx")).toBe(true);
  });

  it("serves the reference-entry page at the non-colliding /verify-certificate", () => {
    expect(exists("src/app/verify-certificate/page.tsx")).toBe(true);
    expect(exists("src/app/verify-certificate/layout.tsx")).toBe(true);
  });

  it("has NO src/app/verify/page.tsx (would collide with the auth page)", () => {
    expect(exists("src/app/verify/page.tsx")).toBe(false);
  });
});

const REF = "VERIF-0001";

async function render(): Promise<string> {
  const element = await VerifyResultPage({ params: Promise.resolve({ verificationRef: REF }) });
  return renderToStaticMarkup(element);
}

describe("/verify/[verificationRef] — D-11 certificate-check limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.headers = new Headers();
    m.auditCreate.mockResolvedValue({});
    m.verifyCertificateByRef.mockResolvedValue({
      status: "active",
      learnerName: "Ada Lovelace",
      awardTitle: "Intro to Testing",
      issuedAt: new Date("2026-01-01T00:00:00Z"),
    });
  });

  it("a device past 60 checks gets the fourth branch: no <dl>, no lookup, one audit row", async () => {
    m.headers = new Headers({ "x-nf-client-connection-ip": "203.0.113.70" });
    m.queryRaw.mockResolvedValue([{ key: "cert-check:ip:203.0.113.70", failures: 61 }]);

    const html = await render();

    expect(html).toContain("Too many checks from this device.");
    expect(html).toContain("Wait 15 minutes, then check the reference again.");
    expect(html).toContain(`Reference: ${REF}`);
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("This certificate is valid.");
    expect(html).not.toContain("couldn&#x27;t find");
    // The Clock icon is decorative.
    const icon = html.match(/<svg[^>]*lucide-clock[^>]*>/)?.[0] ?? "";
    expect(icon).toContain('aria-hidden="true"');
    expect(icon).toContain("size-8");
    expect(icon).toContain("text-muted-foreground");
    expect(m.verifyCertificateByRef).not.toHaveBeenCalled();

    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    const row = m.auditCreate.mock.calls[0][0].data;
    expect(row).toMatchObject({
      action: "rate_limit.blocked",
      targetType: "RateLimit",
      targetId: "certificateCheck",
      outcome: "DENIED",
      ipAddress: "203.0.113.70",
    });
    expect(JSON.stringify(row)).not.toContain(REF);
  });

  it("a device at the limit still gets the lookup", async () => {
    m.headers = new Headers({ "x-nf-client-connection-ip": "203.0.113.70" });
    m.queryRaw.mockResolvedValue([{ key: "cert-check:ip:203.0.113.70", failures: 60 }]);

    const html = await render();

    expect(m.verifyCertificateByRef).toHaveBeenCalledWith(REF);
    expect(html).toContain("This certificate is valid.");
    expect(html).not.toContain("Too many checks");
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("without a trusted client IP the lookup runs as today and nothing is recorded", async () => {
    const html = await render();

    expect(m.verifyCertificateByRef).toHaveBeenCalledWith(REF);
    expect(html).toContain("This certificate is valid.");
    expect(html).toContain("<dl");
    expect(html).not.toContain("Too many checks");
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});
