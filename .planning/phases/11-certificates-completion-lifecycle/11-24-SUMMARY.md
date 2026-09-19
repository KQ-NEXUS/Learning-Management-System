---
phase: 11-certificates-completion-lifecycle
plan: 24
subsystem: certificates
tags: [gap-closure, uat-test-18, certificates, audit, attendance]
requires: ["11-16"]
provides:
  - "reactToCompletionResults superseded branch: D-01 guard, once-per-call flag, optional actorId"
  - "Attendance service passes the correcting staff actorId into recalculateCompletion"
affects: []
tech-stack:
  added: []
  patterns:
    - "One flag per enrolment per re-evaluation (flag is keyed on the enrolment, not the result)"
    - "Optional actorId widened on the dependency slot; lesson-progress path still passes none (SYSTEM)"
key-files:
  created: []
  modified:
    - src/server/services/certificate-issuance-service.ts
    - src/server/services/attendance-service.ts
    - tests/certificate-issuance-service.test.ts
    - tests/attendance-service.test.ts
key-decisions:
  - "COURSE-scope superseded results on a Programme cohort are skipped (mirrors the created-branch D-01 guard); the PROGRAMME-scope supersession still flags"
  - "recalculateCompletionAndIssue does not forward actorId into recalculateCompletion; it only feeds the flag reaction"
  - "No human actor (lesson progress) keeps actorId null with SYSTEM actorType"
requirements-completed: [CRD-06]
duration: 15min
completed: 2026-09-19
---

# Phase 11 Plan 24: Single attributable flag per correction Summary

One attendance correction on a Programme cohort now writes exactly one `certificate.review_flagged` audit row and one domain event, attributed to the correcting staff member (closes the UAT test 18 observation).

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1. D-01 guard, once-per-call flag, optional actor | 371ec17 | Seven tests in a new superseded-branch describe; 4 failed pre-fix (including the three-superseded Programme cohort case) |
| 2. Attribute the flag to the correcting staff member | 95737a5 | Two attendance tests failed pre-fix, pass after |

## Verification

- certificate-issuance, attendance, lesson-progress, completion-service suites and boundary.test.ts: 169 passed. Invariants suite plus issuance: 46 passed.
- `npx tsc --noEmit`: clean (wider args remain assignable to both consumer dependency slots).
- No new writer of the COMPLETED status; package.json and package-lock.json untouched.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED
