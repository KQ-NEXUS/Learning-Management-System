/**
 * The public certificate-verification lookup (CRD-04).
 *
 * Deliberately unauthenticated: this module does NOT import the permission
 * choke point that gates every other protected operation in this codebase.
 * Anyone holding a verification reference off a printed certificate — an
 * employer, a credential checker, a curious stranger — must be able to
 * resolve it without a session. Do not "fix" this by adding an authorization
 * check, and do not add a second export to this file that piggybacks on the
 * absence of one for something else; the omission here is scoped to this
 * one read-only, minimal-disclosure lookup only.
 *
 * One function, exactly one of three outcomes (Pitfall 3's denial-parity
 * discipline, adapted from `lesson-resources/[id]/download/route.ts`'s
 * "every non-success outcome looks the same" rule to a page-level lookup):
 *
 *   - `active`    — an ACTIVE certificate: minimal facts only.
 *   - `revoked`   — a REVOKED or SUPERSEDED certificate (a superseded
 *                   credential is not the current credential of record and
 *                   must not read as valid): the same minimal facts, never
 *                   the internal reason it was revoked, never who did it.
 *   - `not_found` — no matching certificate, or an unusable input. Exactly
 *                   `{ status: "not_found" }` — no other key present, so an
 *                   unknown reference cannot be structurally distinguished
 *                   from a real result by DOM/JSON shape.
 *
 * The Prisma `select` below IS the disclosure contract: it names only the
 * four fields ever allowed to leave this function. A future `select`-less
 * refactor (`findUnique` then destructure) would silently widen what a
 * stranger on the internet can read about a learner — do not "simplify"
 * this query. The certificate's owning enrolment, the owning learner's
 * account id, the underlying course/programme ids, the stored file's object
 * key, who performed a revocation, and the free-text revocation reason
 * never appear here.
 *
 * `reviewFlaggedAt` (CRD-06) is a staff-internal review signal, not a public
 * invalidation — a flagged-but-ACTIVE certificate still verifies `active`;
 * surfacing the flag here would disclose that a correction occurred.
 *
 * If the database read throws, this function throws — it does not swallow
 * the error into `not_found`. Masking an outage as "no such certificate"
 * would make every real credential unverifiable during downtime without any
 * signal that something is wrong.
 *
 * Per RESEARCH.md Pitfall 6 (Next 16 Cache Components): no opt-in-to-caching
 * wrapper, no static-generation export, no revalidation-interval export from
 * this module. The Prisma read already defers the calling route/page to
 * request time; wrapping it in a cache helper would let a stale "active"
 * verdict outlive a revocation.
 */

import { prisma } from "@/server/db";

export type CertificateVerificationResult =
  | { status: "active"; learnerName: string; awardTitle: string; issuedAt: Date }
  | { status: "revoked"; learnerName: string; awardTitle: string; issuedAt: Date }
  | { status: "not_found" };

export async function verifyCertificateByRef(
  verificationRef: string,
): Promise<CertificateVerificationResult> {
  const trimmed = verificationRef.trim();
  if (trimmed.length === 0) {
    return { status: "not_found" };
  }

  const certificate = await prisma.certificate.findUnique({
    where: { verificationRef: trimmed },
    select: {
      status: true,
      learnerName: true,
      awardTitle: true,
      issuedAt: true,
    },
  });

  if (!certificate) {
    return { status: "not_found" };
  }

  if (certificate.status === "ACTIVE") {
    return {
      status: "active",
      learnerName: certificate.learnerName,
      awardTitle: certificate.awardTitle,
      issuedAt: certificate.issuedAt,
    };
  }

  // REVOKED and SUPERSEDED both read as "revoked" to a public verifier — a
  // superseded credential is not the current credential of record.
  return {
    status: "revoked",
    learnerName: certificate.learnerName,
    awardTitle: certificate.awardTitle,
    issuedAt: certificate.issuedAt,
  };
}
