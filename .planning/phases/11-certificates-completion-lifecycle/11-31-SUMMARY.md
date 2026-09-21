---
phase: 11-certificates-completion-lifecycle
plan: 31
subsystem: certificates
tags: [certificates, transactions, composition-roots, download-route, gap-closure, CR-01b]
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: certificate-file-service (runTransactionThenSettleCertificateFiles, ensureCertificateFile, registerPendingCertificateFile) from 11-30
provides:
  - Post-commit certificate file settle wired at the lesson-progress, attendance and certificate-service composition roots
  - Optional trailing `settle` parameter on both Prisma-backed factories; optional `settle` member of CertificateServiceDeps plus a private runSettled helper
  - Download route that produces a missing file on demand after authorization, with unchanged denial parity
affects: [11-32 (real Postgres + MinIO proof), 11-33 (human checkpoints), 11-29 (font swap is inside the renderer the file service calls)]
tech-stack:
  added: []
  patterns:
    - "Composition root wraps its existing $transaction call in runTransactionThenSettleCertificateFiles; the cast of tx is type-only, never a wrapper, so issuance and settle see the same object identity"
    - "certificate-service wires the settle inside createCertificateService (runSettled over the received runInTransaction) because its live binding is a module-level constant with no factory"
    - "Route authorization first, then on-demand production, then presign; production failure is the same empty 404"
key-files:
  created: []
  modified:
    - src/server/services/lesson-progress-service.ts
    - src/server/services/attendance-service.ts
    - src/server/services/certificate-service.ts
    - src/app/api/certificates/[id]/download/route.ts
    - tests/lesson-progress-service.test.ts
    - tests/attendance-service.test.ts
    - tests/certificate-service.test.ts
    - tests/certificate-download-route.test.ts
key-decisions:
  - "Settle default is chosen by omission: the trailing `settle` parameter (factories) and `deps.settle` (certificate-service) are undefined in production, so the wrapper's default parameter selects the live settle; the live binding at the bottom of certificate-service.ts is untouched"
  - "revokeCertificate and grade override stay on plain runInTransaction: neither issues a certificate, so there is nothing to settle"
  - "The route calls ensureCertificateFile only when certificate.storageKey is null, so the normal path adds no work"
requirements-completed: [CRD-01, CRD-03]
duration: ~35min
completed: 2026-09-19
---

# Phase 11 Plan 31: Wire post-commit settle and on-demand download (CR-01b) Summary

**Every path that can issue a certificate (lesson completion, attendance, manual issue, Reissue) now renders and stores the PDF only after its transaction commits, in a step that cannot fail or roll back the caller; the download route completes a file-less certificate on the first authorized click.**

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1. Settle at the three composition roots | 5c5a9e3 | `createPrismaBackedLessonProgressService` and `createPrismaBackedAttendanceService` run `client.$transaction` through `runTransactionThenSettleCertificateFiles` with an optional trailing `settle`; `createCertificateService` gets `settle?` on `CertificateServiceDeps` and a private `runSettled` used by `issueCertificateManually` and `reissueCertificate` only |
| 2. Download route on demand | 72a5974 | After both authorization predicates, a null `storageKey` triggers `await ensureCertificateFile(certificate.id)`; the returned key is presigned; null is the same empty 404 |

## How it behaves

- The wrapper captures the very tx object the body receives and passes it to settle only after `$transaction` resolved. The roots cast `tx` for typing only (no proxy), honouring the 11-30 hand-off, and the tests assert identity (`settleCalls[0] === txObject === tx seen by issuance/recalculate`).
- A rolled-back transaction rethrows and never settles; a rejecting settle is swallowed, so the learner's or staff member's committed write survives (CR-01b).
- Ordinary lesson progress and attendance writes register nothing, so the live settle returns before touching the store.
- Route: authorization block untouched. Denials (wrong owner, unknown, revoked, unauthenticated) return the empty 404 before `ensureCertificateFile` is reachable. No new status, header, route-config or caching export was added (invariant 4 green). The route awaits production (no fire-and-forget). Presigned URL is still short-lived and the 302 still carries `Cache-Control: private, no-store`.
- Next docs consulted: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (GET handler shape); no new export or config needed.

## Verification (RED then GREEN)

Tests were written first and run against the pre-change source (vitest does not type-check, so the new optional parameter did not block the RED run).

- Lesson-progress root: 2 failed before the wrapper (ordering/same-tx test and the rejecting-settle test: `order` was `[tx-begin, tx-commit]` with no `settle`), 50 others passed; after: 52/52.
- Attendance root: the same 2 failed before; after: 51/51.
- certificate-service: 4 of 8 new tests failed before (manual issue ordering, reissue ordering, and both "survives a failing settle" tests, none ever called settle); the rollback-no-settle, revoke-never-settles and default-live-settle tests pass before and after by design (they are guards, not fixes). After: 44/44.
- Download route: 4 new tests failed before (on-demand success for owner and for staff, unproducible parity, no fire-and-forget: all got a 404 without calling ensure); the ensure-not-called assertions added to the four denial tests hold before and after (guards). After: 13/13.
- Also green: certificate-revocation, certificate-file-service, boundary, certificate-phase-invariants (9/9) in one combined 7-file run of 235 tests plus invariants 22 in the route run; `npx tsc --noEmit` exits 0; `git diff package.json package-lock.json` empty.
- Integration (ran for real, Docker up): `attendance-service.integration`, `learner-journey.integration` (both use the real Prisma-backed factories through the new wrapper), `certificate-download.integration`, `certificate-concurrency.integration`: 4 files, 18/18 passed.

## Deviations from Plan

None material. Notes:

- certificate-service settle tests use `vi.mock` of `certificate-issuance-service` (keeping the real module's other exports, replacing `issueCertificateForEnrolment` with a spy) rather than the full staged-commit fake in `certificate-revocation.test.ts`; this keeps the tests in `tests/certificate-service.test.ts` as the plan specifies and isolates the wrapper. The mock does not affect the file's existing read-surface tests, which never call issuance.
- The plan's suggested "spy the store: zero certificate reads" for the lesson-progress and attendance no-op case is covered structurally (the live settle returns before any store access when nothing is registered; verified by the 11-30 unit suite) and by the composed no-op test, not by a dedicated store spy; the certificate-service variant does assert the exact read count.
- `certificate-service.ts` and its test have CRLF working-copy endings; git normalises to LF (`eol=lf`).

## Known Stubs

None.

## Threat Flags

None: no new endpoints or trust boundaries. T-11-129/130 (route oracle, forced renders) mitigated by ordering and asserted in tests; T-11-131 (post-commit failure failing the write) by rejecting-settle tests at all three roots; T-11-132 (render for rolled-back tx) by rollback tests; T-11-133 by unchanged headers and invariant 4.

## Self-Check: PASSED

- Modified files present: lesson-progress-service.ts, attendance-service.ts, certificate-service.ts, route.ts, and the four test files
- Commits 5c5a9e3 and 72a5974 present
