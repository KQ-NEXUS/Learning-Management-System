---
phase: 11-certificates-completion-lifecycle
plan: 06
subsystem: api
tags: [nextjs, prisma, public-route, verification, security]

# Dependency graph
requires:
  - phase: 11-01
    provides: "Certificate/CertificateTemplate schema, CertificateStatus enum (ACTIVE/REVOKED/SUPERSEDED)"
  - phase: 11-03
    provides: "generateVerificationRef() — 128-bit-entropy CERT-<hex> reference convention"
provides:
  - "verifyCertificateByRef() — the closed three-outcome public lookup (active/revoked/not_found) that every future issuance/revocation plan's verification story depends on"
  - "/verify/[verificationRef] — the public, unauthenticated verification page (CRD-04)"
  - "/verify's own minimal layout, deliberately outside (public)'s LearnerShell"
  - "VerifyReferenceForm — reusable reference-entry form component"
affects: [11-07, 11-08, 11-09, certificate-issuance-service, certificate-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Disclosure-contract Prisma select: a query's select clause IS the security boundary, not an implementation detail to later drop for a whole-row read"
    - "Three-outcome closed union return type (active/revoked/not_found) for a public unauthenticated lookup, denial-parity discipline adapted from a route handler to a rendered page"

key-files:
  created:
    - src/server/services/certificate-verification-service.ts
    - src/app/verify/layout.tsx
    - src/app/verify/[verificationRef]/page.tsx
    - src/app/verify/VerifyReferenceForm.tsx
    - tests/certificate-verification.test.ts
  modified: []

key-decisions:
  - "Dropped the planner's discretionary bare /verify landing page (Rule 4): (auth)/verify/page.tsx already owns that exact path for IAM-02 email verification (?token=), live and linked from already-dispatched transactional emails. Next.js refuses two pages resolving to one path; relocating a shipped, validated auth flow was judged outside this plan's authority. Kept /verify/[verificationRef] (CRD-04's literal, mandatory requirement) and wired the reference-entry form onto that result page instead."
  - "SUPERSEDED certificates verify identically to REVOKED (both return the revoked shape) — a superseded credential is not the current credential of record and must not read as valid to a public verifier."
  - "reviewFlaggedAt (CRD-06) never surfaces on the public lookup — a flagged-but-ACTIVE certificate still verifies active; the flag is a staff-internal review signal."

patterns-established:
  - "certificate-verification-service.ts is deliberately unauthenticated with no dependency-injection seam — a single Prisma call, not a service with a composition root; tests mock @/server/db directly via vi.hoisted, a new precedent for this codebase's pure-lookup-with-one-Prisma-call shape."

requirements-completed: [CRD-04]

duration: ~35min
completed: 2026-09-18
---

# Phase 11 Plan 06: Public Certificate Verification Summary

**A closed three-outcome (active/revoked/not_found) unauthenticated lookup service plus a standalone `/verify/[verificationRef]` page, with the discretionary bare `/verify` landing page dropped after discovering it collides with the already-shipped IAM-02 email-verification route at the same path.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-18T08:10:00+01:00 (approx.)
- **Completed:** 2026-09-18T08:33:14+01:00
- **Tasks:** 3 (Task 3 modified in-flight due to a routing collision — see Deviations)
- **Files modified:** 5 (4 created, 1 test created)

## Accomplishments

- `verifyCertificateByRef()` — one function, exactly one of three outcomes, with an explicit Prisma `select` that IS the disclosure contract (only `status`/`learnerName`/`awardTitle`/`issuedAt` ever leave the function)
- `/verify/[verificationRef]` — a public, unauthenticated server-rendered page with no shared DOM shape between "unknown" and "real" (no `<dl>` at all in the not-found branch)
- `/verify`'s own minimal layout — brand mark only, no nav, no "Sign in" CTA, deliberately not nested under `(public)`'s `LearnerShell`
- A reusable `VerifyReferenceForm` so a visitor who mistyped a reference can correct it without navigating back

## Task Commits

Each task was committed atomically:

1. **Task 1: certificate-verification-service.ts — the closed three-outcome lookup** - `c3f8397` (feat)
2. **Task 2: Standalone /verify route group with its own minimal layout** - `479e1ce` (feat)
3. **Task 3: Reference-entry form (adapted — bare /verify landing page dropped)** - `9ae9039` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/server/services/certificate-verification-service.ts` - `verifyCertificateByRef()`, the public lookup; explicit `select`, no auth import, no cache directive
- `src/app/verify/layout.tsx` - standalone minimal shell for the `/verify` segment
- `src/app/verify/[verificationRef]/page.tsx` - the three-outcome result page, plus the header block and entry form above the result card
- `src/app/verify/VerifyReferenceForm.tsx` - the reference-entry form component (client), builds `/verify/{encodeURIComponent(ref)}` and navigates
- `tests/certificate-verification.test.ts` - 9 cases covering all seven required behaviors plus the disclosure-contract `select`/key-set assertions

## Decisions Made

- Certificates with `status: "SUPERSEDED"` map to the same public `revoked` outcome as `status: "REVOKED"` — both are "not the current credential of record."
- `reviewFlaggedAt` never influences or appears in the public response — CRD-06's flag is staff-internal.
- Comments in the service/page files were phrased to avoid literally containing the grep-checked forbidden substrings (e.g. "revocation reason" as two words, not `revocationReason`) while still documenting the reasoning for a future reader — satisfies the acceptance criteria's literal grep gates without sacrificing documentation quality.
- Dropped the bare `/verify` landing page — see Deviations below.

## Deviations from Plan

### Auto-fixed / Adapted Issues

**1. [Rule 4 - Architectural conflict, resolved conservatively] Bare `/verify` landing page collides with the existing IAM-02 email-verification route**
- **Found during:** Task 3 (`npx next build`)
- **Issue:** Task 3 instructed creating `src/app/verify/page.tsx` (a top-level bare entry-form landing page). `next build` failed: `Error: You cannot have two parallel pages that resolve to the same path. Please check /(auth)/verify and /verify.` `src/app/(auth)/verify/page.tsx` already owns the exact `/verify` path — it is the live IAM-02 "verify your email" page, reached via `?token=`, and is actively linked from already-dispatched transactional emails (`src/server/services/verification-service.ts:185`, `src/server/services/registration-service.ts:220` both build `${baseUrl}/verify?token=${...}`). This is shipped, `Validated` functionality (PROJECT.md), not something this plan has any warrant to relocate or break.
- **Fix:** Did not create `src/app/verify/page.tsx`. Kept the mandatory, literal CRD-04 surface (`/verify/[verificationRef]`) exactly as Task 2 built it, and moved the reference-entry form (`VerifyReferenceForm`) onto that result page only, above the result card — satisfying the substantive intent behind Task 3 (a visitor can type in or correct a reference without a deep link) without touching the colliding path. The component is kept standalone (not inlined) so a future plan can add a landing page at a non-colliding path (e.g. `/verify-certificate`) without duplicating the form.
- **Files modified:** `src/app/verify/VerifyReferenceForm.tsx` (created, doc comment reflects current single-consumer usage and the collision rationale), `src/app/verify/[verificationRef]/page.tsx` (renders the form above the result card)
- **Verification:** `npx next build` succeeds cleanly; `npx tsc --noEmit` exits 0; `grep` gates for `encodeURIComponent`/`searchParams`/raw-hex/`LearnerShell`/cache-directives all pass as specified in Task 3's acceptance criteria except the two criteria that literally require a bare `/verify` route to exist (see Issues Encountered)
- **Committed in:** `9ae9039`

---

**Total deviations:** 1 auto-adapted (Rule 4, resolved by preserving existing shipped behavior over the new discretionary feature)
**Impact on plan:** CRD-04's mandatory requirement (public, unauthenticated verification by reference) is fully met. The planner's own text flagged the bare landing page as "a discretionary addition, flagged for planner confirmation" — that confirmation did not have visibility into the pre-existing `/verify` route, so dropping it here is a course-correction, not a scope cut against anything CRD-04 requires. No existing functionality (IAM-02 email verification) was touched or put at risk.

## Issues Encountered

- Two of Task 3's literal acceptance-criteria bullets ("`npx next build` succeeds and lists `/verify` as a route" in the sense of a *new* page, and the form being "used by both `/verify` and `/verify/[verificationRef]`") cannot be satisfied as written given the routing collision above — `/verify` is listed in the build output, but as the pre-existing `(auth)` route, not a new certificate-landing page. This is the direct, necessary consequence of the Rule 4 deviation above, not a missed requirement.
- Header-comment drafting for both the service and the result page required care: an early draft literally spelled out the forbidden field names (`revocationReason`, `withPermission`, `'use cache'`, etc.) inside explanatory prose, which the acceptance criteria's literal `grep -c` gates count as violations even though the *intent* was to document their absence. Reworded all such comments to describe the omissions without reproducing the exact banned substrings (e.g., "the internal reason it was revoked" instead of `revocationReason`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `verifyCertificateByRef()` and `/verify/[verificationRef]` are ready for `certificate-issuance-service.ts` (a future plan) to point at once issuance exists — nothing here depends on issuance, by design (CRD-04 ships before issuance so its disclosure contract is settled in isolation).
- **Open item for a future plan/human decision:** if a bare, deep-link-free certificate-verification entry point is still wanted, it needs a path that doesn't collide with `(auth)/verify` — e.g. `/verify-certificate`, or a future decision to relocate IAM-02's link (which would require reissuing the transactional-email template and accepting that already-sent, not-yet-clicked verification emails would 404). Not blocking CRD-04 or any of this phase's remaining plans.

## Self-Check: PASSED

All created files confirmed present on disk; all four task/plan commits (`c3f8397`, `479e1ce`, `9ae9039`, `3e1941b`) confirmed present in `git log --oneline --all`.
