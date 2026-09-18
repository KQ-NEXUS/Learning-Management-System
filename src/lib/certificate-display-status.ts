/**
 * `certificateDisplayStatus` — UI-SPEC §5's four-branch tone precedence, owned in exactly one
 * place so the queue, the issued list, the detail page and the dashboard slot can never disagree
 * on what a certificate "looks like".
 *
 * A PURE module — no `@prisma/client`, no `next/headers`, no permission import — deliberately
 * split out of `certificate-service.ts` (which re-exports it for backward compatibility) so a
 * `"use client"` table component can call it directly without pulling the whole service module's
 * server-only import graph (Prisma, `withPermission`, `next/headers`) into the browser bundle
 * (Next 16's Client Component boundary — a plain `import type` erases at compile time, but a
 * VALUE import of a function does not, and `certificateDisplayStatus` is a value every client
 * table needs to call, not just type).
 */
export type CertificateDisplayStatus = "revoked" | "flagged" | "superseded" | "active";

/**
 * First match wins, in this exact order (UI-SPEC §5, load-bearing): (1)
 * `status === "REVOKED"` -> "revoked"; (2) `reviewFlaggedAt !== null` ->
 * "flagged" — EVEN IF `status === "ACTIVE"`, so a flagged-but-technically-
 * active certificate never renders as a plain green "Active"; (3) `status
 * === "SUPERSEDED"` -> "superseded"; (4) otherwise -> "active".
 */
export function certificateDisplayStatus(certificate: {
  status: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  reviewFlaggedAt: Date | null;
}): CertificateDisplayStatus {
  if (certificate.status === "REVOKED") return "revoked";
  if (certificate.reviewFlaggedAt !== null) return "flagged";
  if (certificate.status === "SUPERSEDED") return "superseded";
  return "active";
}
