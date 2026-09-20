---
phase: 11-certificates-completion-lifecycle
plan: 28
subsystem: ui
tags: [dashboard, certificates, precedence, regression-test, uat-gap]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "Plan 11-13 CertificateColumn and certificateDisplayStatus; plan 11-24 flag-on-supersede behaviour"
provides:
  - "deriveCertificateColumn with certificate-first precedence: an existing certificate decides the slot before the completion record"
  - "Regression tests at pure, dashboard-wiring and component level for the superseded-completion plus flagged-certificate scenario"
affects: [UAT test 17 re-verification, learner dashboard certificate slot]

tech-stack:
  added: []
  patterns:
    - "Existing-certificate-first derivation: the completion record only chooses between not-complete and pending-issuance when no certificate exists"

key-files:
  created: []
  modified:
    - src/server/services/enrolment-dashboard-service.ts
    - tests/certificate-slot.test.ts
    - tests/components/certificate-slot.test.tsx

key-decisions:
  - "Kept the deriveCertificateColumn signature and the hasCompletionRecord parameter so loadLearnerDashboard needed no edit"
  - "WR-06 (REVOKED plus ACTIVE row selection, certificateEnabled false learners) left out of scope; a comment points at 11-REVIEW.md"

patterns-established:
  - "Regression-lock via temporary mutation: re-insert the old early return and confirm the new tests fail, then restore"

requirements-completed: [CRD-03, CRD-06]

duration: 25min
completed: 2026-09-19
---

# Phase 11 Plan 28: Certificate-first slot precedence Summary

**A learner whose completion was superseded by a correction now keeps their certificate slot and download: deriveCertificateColumn consults the certificate before the completion record.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-09-19
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Closed the open UAT gap (test 17). Root cause: `deriveCertificateColumn` returned `not-complete` whenever no unsuperseded completion record existed, before looking at the certificate. Corrections supersede the completion record (which is what raises the CRD-06 flag), so a flagged ACTIVE certificate rendered the deferred "arriving in a future update" copy and lost its download link, contradicting D-06/CRD-06.
- New order: an existing certificate decides first (revoked, flagged, active via the single `certificateDisplayStatus` helper); with no certificate, `hasCompletionRecord` picks pending-issuance or not-complete. Revoked still carries no `certificateId` key (T-11-116). JSDoc on `CertificateColumn` and `deriveCertificateColumn` updated to the new order.
- Tests: the old first case (record false plus certificate -> not-complete) encoded the bug and was replaced by one case per behaviour, with the no-certificate fallbacks and the live-record trio labelled as guards. Dashboard wiring tests cover the Programme scenario (Tunde Bello), the Course variant, and a foreign-enrolment leak guard. A component test renders the flagged column produced by the superseded scenario and asserts the download href, the reference, and the absence of the "future update" copy.

## Task Commits

1. **Task 1: Certificate-first precedence in deriveCertificateColumn** - `3ece601` (fix)
2. **Task 2: Wiring and component regression tests** - `f791743` (test)

## Red/green and non-vacuity evidence

- **Task 1 (red-first):** with the new pure-function tests written and the source unchanged, 3 failed: "no record + ACTIVE flagged -> flagged" (the UAT case), "no record + ACTIVE unflagged -> issued", "no record + REVOKED -> revoked". All passed after the reorder.
- **Task 2 (regression lock, cannot start red):** with the fix in place the new tests passed. To prove they are not vacuous the old early return (`if (!input.hasCompletionRecord) return { kind: "not-complete" }`) was temporarily re-inserted at the top of `deriveCertificateColumn`. Six tests then failed: the three pure cases above, the PROGRAMME wiring test, the COURSE wiring test, and the component test "flagged after a superseded completion". The line was then removed by restoring the file from a backup; `git diff` on `enrolment-dashboard-service.ts` was empty after restore, so Task 2 leaves no source change. (The foreign-enrolment guard passes both ways by design, since it asserts a fallback.)

## Verification

- `tests/certificate-slot.test.ts`, `tests/components/certificate-slot.test.tsx`, `tests/enrolment-dashboard-service.test.ts`, `tests/learner-dashboard-page.test.ts`: 4 files, 90 tests, all green.
- `tests/boundary.test.ts` and `tests/certificate-phase-invariants.test.ts`: 2 files, 24 tests, green.
- `npx tsc --noEmit` clean.
- `grep not-complete` in the service shows the return only on the no-certificate path.
- `git diff package.json package-lock.json` empty; no installs. No prisma migrate/db push/db execute run; `.env` DATABASE_URL not used.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The browser scenario itself (Programme card, superseded completion, flagged certificate) was not re-run in a browser; it is locked by the wiring and component tests and remains available for UAT re-verification.

## Known Stubs

None.

## Threat Flags

None. T-11-114 (guard test), T-11-115 (certificate-first precedence) and T-11-116 (no certificateId on revoked) are covered by tests; T-11-SC satisfied (no dependency change).

## Self-Check: PASSED

- 11-28-SUMMARY.md present; commits 3ece601 and f791743 exist; modified files present.
