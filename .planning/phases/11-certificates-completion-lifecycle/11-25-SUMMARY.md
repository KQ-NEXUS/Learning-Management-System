---
phase: 11-certificates-completion-lifecycle
plan: 25
subsystem: certificates
tags: [certificates, issuance, revocation, enrolment-eligibility, gap-closure, review-cr-03, review-cr-04]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: issueCertificateForEnrolment, reactToCompletionResults, certificate-service revoke/reissue/pending queue (11-07, 11-11, 11-24)
provides:
  - CERTIFICATE_ELIGIBLE_ENROLMENT_STATUSES (ACTIVE, COMPLETED) as the single eligibility definition
  - not-eligible and revoked-blocked typed issuance outcomes, evaluated before any write
  - eligible-only, revoked-excluding manual issuance queue
  - Reissue supersedes every REVOKED row for the enrolment and scope
affects: [11-26..11-34, phase-11-verification]

tech-stack:
  added: []
  patterns:
    - "Typed non-error outcome instead of a throw when a function runs inside a caller's own transaction"

key-files:
  created:
    - tests/certificate-issue-action.test.ts
  modified:
    - src/server/services/certificate-issuance-service.ts
    - src/server/services/certificate-service.ts
    - src/app/staff/certificates/certificate-actions.ts
    - tests/certificate-issuance-service.test.ts
    - tests/certificate-service.test.ts
    - tests/certificate-revocation.test.ts

key-decisions:
  - "Only ACTIVE and COMPLETED enrolments are certificate-eligible; WITHDRAWN, PENDING_PAYMENT, TRANSFERRED, CANCELLED are not (COMPLETED stays only because Reissue delegates for an enrolment that never left COMPLETED)"
  - "A REVOKED certificate blocks issuance for every actor including the manual queue; only Reissue replaces it, after superseding every REVOKED row for that enrolment and scope"
  - "No new audit action for the revoked-blocked skip; the revocation is already audited"

patterns-established:
  - "Eligibility gate is the first check after loading the enrolment, before cohort/award reads and before any write"

requirements-completed: [CRD-01, CRD-02, CRD-04, CRD-05]

duration: ~1h
completed: 2026-09-19
---

# Phase 11 Plan 25: Eligibility gate and revoked-blocked issuance Summary

**Certificate issuance now returns typed `not-eligible` / `revoked-blocked` outcomes before any write, so an ineligible enrolment can never fail a caller's write and a staff revocation can never be silently undone by automation or the queue.**

## Accomplishments

- CR-03: `issueCertificateForEnrolment` returns `{ kind: "not-eligible" }` for any enrolment not ACTIVE/COMPLETED, immediately after loading the enrolment. Staff attendance marking for a WITHDRAWN or PENDING_PAYMENT enrolment that satisfies an AUTOMATIC award no longer throws `IllegalTransitionError`. `computePendingIssuance` skips those enrolments (application-code filter using the shared constant).
- CR-04: after the ACTIVE `already-issued` pre-check and before template resolution, a REVOKED row for the same enrolment and scope returns `{ kind: "revoked-blocked" }` for every actor. Undo then redo of a lesson after a revoke leaves one REVOKED certificate and an ACTIVE enrolment. The pending queue now reads `status in [ACTIVE, REVOKED]` so a revoked enrolment/scope never reappears.
- CRD-05 preserved: `reissueCertificate` gained STEP 1b, one `updateMany` superseding every remaining REVOKED row for the same `enrolmentId` and `scope`, so legacy data with two REVOKED rows still reissues (new row's `supersedesId` is the reissued row). ACTIVE rows are not touched.
- `issueCertificateAction` maps both new outcomes to fixed, distinct messages with `revalidatePath`; no raw error text.
- D-05 single-writer invariant unchanged (no new `status: "COMPLETED"` write); invariant test passes.

## Commits

- `003467c` fix(11-25): gate certificate issuance on enrolment eligibility (CR-03)
- `362fe79` fix(11-25): a REVOKED certificate blocks automatic and queue issuance (CR-04)

## Fail-before / pass-after evidence

Tests were written first and run against the unmodified source.

- Task 1 against pre-fix source: 12 failures (4 not-eligible statuses in issuance, not-eligible-over-not-enabled precedence, 2 `reactToCompletionResults` WITHDRAWN/PENDING_PAYMENT rejections, 4 pending-queue status omissions, 1 action message). All 12 pass after.
- Task 2 against the post-Task-1 source: 9 failures (revoked-blocked for system and staff actor, undo-then-redo, Programme-cohort undo/redo, manual issue revoked-blocked, legacy two-REVOKED reissue, queue REVOKED exclusion, and 2 action-message tests). All pass after.
- The supersede-all step is load-bearing: temporarily neutralising STEP 1b made the legacy two-REVOKED reissue test fail (and only it); restored afterwards.

## Verification

- `tests/certificate-issuance-service.test.ts`, `certificate-service.test.ts`, `certificate-revocation.test.ts`, `certificate-issue-action.test.ts`, `attendance-service.test.ts`, `lesson-progress-service.test.ts`: 218 tests pass.
- `tests/certificate-concurrency.integration.test.ts` and `tests/certificate-download.integration.test.ts` (Testcontainers Postgres): 5 tests pass, so the real partial-unique-index race is unaffected.
- `tests/boundary.test.ts` passes; `tests/certificate-phase-invariants.test.ts` passes (7/7) when run alone. In one combined run alongside boundary.test.ts, invariant 3 failed by timeout under load; it passed on re-run alone, as the environment notes anticipated.
- `npx tsc --noEmit` exits 0 (both switches exhaustive). `git diff package.json package-lock.json` empty. No prisma migrate/db push/db execute run; DATABASE_URL untouched.

## Deviations from Plan

**1. [Rule 3 - Blocking] Reissue tests live in tests/certificate-revocation.test.ts, not tests/certificate-service.test.ts**
- **Issue:** The plan placed the legacy two-REVOKED reissue test, and the rollback assertion, in `certificate-service.test.ts`, but that file's `runInTransaction` is a stub with no transaction fake; the reissue/manual-issue harness lives in `certificate-revocation.test.ts`.
- **Fix:** Added those tests to `certificate-revocation.test.ts` (added to the commit; not in the plan's `files_modified`). Also made its fake `certificate.updateMany` honour `enrolmentId` and `scope` filters so the other-scope / other-enrolment non-interference test is meaningful. Queue tests stayed in `certificate-service.test.ts`, whose pending-store fake now honours the `status` filter (`{ in: [...] }` or a string) so it can fail against ACTIVE-only behaviour.

**2. [Rule 1 - Test fix] Lost-race unit test fake made where-aware**
- **Issue:** The existing "zero-row ON CONFLICT DO NOTHING" test counted `findFirst` calls; the new REVOKED pre-check became call #2 and broke the count.
- **Fix:** The fake returns null for `status: "REVOKED"` queries without counting them. Service behaviour of the race path is unchanged (proved by the real-Postgres concurrency integration test).

**3. Test fixture typing:** `pendingRecord` in `certificate-service.test.ts` gained a defaulted `status` (ACTIVE) so existing fixtures with explicit `enrolment` objects still type-check.

## Known Stubs

None.

## Threat Flags

None. Threats T-11-102, T-11-103, T-11-104, T-11-140, T-11-105 are mitigated as planned; T-11-SC: nothing installed.

## Self-Check: PASSED

- src/server/services/certificate-issuance-service.ts, certificate-service.ts, certificate-actions.ts, and all four test files exist and are committed.
- Commits 003467c and 362fe79 present in `git log`.
