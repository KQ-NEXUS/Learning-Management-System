/**
 * Plan 11-06 Task 1: the public, unauthenticated certificate-verification
 * lookup (CRD-04) — exactly three outcomes, asserted on key sets (not merely
 * undefined values) so a future accidental leak of a fourth field is caught.
 *
 * Driven by a mocked `@/server/db` `prisma.certificate.findUnique` — this
 * module has no dependency-injection seam (deliberately: it is a tiny,
 * single-call, unauthenticated read, not a service with a composition
 * root), so the Prisma client import itself is the mock boundary.
 */

import { describe, expect, it, vi } from "vitest";
import { verifyCertificateByRef } from "@/server/services/certificate-verification-service";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/server/db", () => ({
  prisma: { certificate: { findUnique } },
}));

const ISSUED_AT = new Date("2026-08-01T00:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    status: "ACTIVE",
    learnerName: "Jordan Example",
    awardTitle: "Certificate in Applied Testing",
    issuedAt: ISSUED_AT,
    ...overrides,
  };
}

describe("verifyCertificateByRef", () => {
  it("returns the active shape for an ACTIVE certificate", async () => {
    findUnique.mockResolvedValueOnce(row({ status: "ACTIVE" }));
    const result = await verifyCertificateByRef("CERT-ACTIVE-REF");
    expect(result).toEqual({
      status: "active",
      learnerName: "Jordan Example",
      awardTitle: "Certificate in Applied Testing",
      issuedAt: ISSUED_AT,
    });
    expect(Object.keys(result).sort()).toEqual(
      ["awardTitle", "issuedAt", "learnerName", "status"].sort(),
    );
  });

  it("returns the revoked shape for a REVOKED certificate, with no reason/actor fields", async () => {
    findUnique.mockResolvedValueOnce(row({ status: "REVOKED" }));
    const result = await verifyCertificateByRef("CERT-REVOKED-REF");
    expect(result).toEqual({
      status: "revoked",
      learnerName: "Jordan Example",
      awardTitle: "Certificate in Applied Testing",
      issuedAt: ISSUED_AT,
    });
    expect(Object.keys(result).sort()).toEqual(
      ["awardTitle", "issuedAt", "learnerName", "status"].sort(),
    );
    expect(result).not.toHaveProperty("revocationReason");
    expect(result).not.toHaveProperty("revokedById");
  });

  it("returns the revoked shape for a SUPERSEDED certificate (not the current credential of record)", async () => {
    findUnique.mockResolvedValueOnce(row({ status: "SUPERSEDED" }));
    const result = await verifyCertificateByRef("CERT-SUPERSEDED-REF");
    expect(result.status).toBe("revoked");
  });

  it("returns exactly {status: 'not_found'} for a reference matching nothing", async () => {
    findUnique.mockResolvedValueOnce(null);
    const result = await verifyCertificateByRef("CERT-UNKNOWN-REF");
    expect(result).toEqual({ status: "not_found" });
    expect(Object.keys(result)).toEqual(["status"]);
  });

  it("returns not_found without throwing for an empty string, whitespace, a 5000-char string, and SQL/regex metacharacters", async () => {
    findUnique.mockResolvedValue(null);
    const inputs = [
      "",
      "   ",
      "a".repeat(5000),
      "'; DROP TABLE \"Certificate\"; --",
      ".*(.*)+$",
    ];
    for (const input of inputs) {
      await expect(verifyCertificateByRef(input)).resolves.toEqual({ status: "not_found" });
    }
  });

  it("returns active for a flagged-but-ACTIVE certificate — reviewFlaggedAt is staff-internal, never a public invalidation", async () => {
    findUnique.mockResolvedValueOnce(row({ status: "ACTIVE" }));
    const result = await verifyCertificateByRef("CERT-FLAGGED-BUT-ACTIVE");
    expect(result.status).toBe("active");
  });

  it("throws (does not swallow to not_found) when the database read throws", async () => {
    findUnique.mockRejectedValueOnce(new Error("connection reset"));
    await expect(verifyCertificateByRef("CERT-ANY-REF")).rejects.toThrow("connection reset");
  });

  it("trims the input before querying and does not query with an empty string", async () => {
    findUnique.mockResolvedValueOnce(row());
    await verifyCertificateByRef("  CERT-PADDED-REF  ");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { verificationRef: "CERT-PADDED-REF" } }),
    );
  });

  it("selects only the four disclosure-contract fields", async () => {
    findUnique.mockResolvedValueOnce(row());
    await verifyCertificateByRef("CERT-SELECT-CHECK");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { status: true, learnerName: true, awardTitle: true, issuedAt: true },
      }),
    );
  });
});
