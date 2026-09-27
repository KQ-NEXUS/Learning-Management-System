import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// F-09 — every route carries the baseline security headers.
async function headersForAllRoutes() {
  const rules = (await nextConfig.headers?.()) ?? [];
  const all = rules.find((rule) => rule.source === "/:path*");
  return new Map((all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe("security headers (F-09)", () => {
  it("forbids framing by any other site (clickjacking)", async () => {
    const headers = await headersForAllRoutes();
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("locks down plugin content and the document base URL", async () => {
    const csp = (await headersForAllRoutes()).get("content-security-policy") ?? "";
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("sends nosniff, a referrer policy, HSTS and a permissions policy", async () => {
    const headers = await headersForAllRoutes();
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("strict-transport-security")).toMatch(/max-age=\d+; includeSubDomains/);
    expect(headers.get("permissions-policy")).toContain("camera=()");
  });

  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
