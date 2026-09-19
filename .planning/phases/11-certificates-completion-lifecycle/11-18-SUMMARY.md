---
phase: 11-certificates-completion-lifecycle
plan: 18
subsystem: learner-dashboard
tags: [gap-closure, uat-test-10, uat-test-19, completed-enrolment, certificates, dashboard]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "11-17 COMPLETED dashboard card (enrolmentStatus, real CertificateColumn)"
provides:
  - "COMPLETED-aware EnrolmentSection: certificate slot with download link and reference, no dead links"
  - "Accurate NextUpCard 'complete' copy"
  - "Real-Postgres issue-then-load-dashboard regression"

key-files:
  modified:
    - src/app/(learner)/dashboard/page.tsx
    - src/components/learner/NextUpCard.tsx
    - tests/learner-dashboard-page.test.ts
    - tests/certificate-download.integration.test.ts

key-decisions:
  - "Applies G-01: a COMPLETED card renders only cohort title, Next-up, progress, Support tickets slot and CertificateSlot. Access banner, Upcoming sessions, Assessments and Results are omitted because their links point at ACTIVE-only routes."
  - "COMPLETED detection is strict equality (=== 'COMPLETED'), so an absent enrolmentStatus is ACTIVE and legacy fixtures are unchanged."

requirements-completed: []
requirements-reopen: [CRD-03]

duration: ~15min
completed: 2026-09-19
---

# Phase 11 Plan 18: COMPLETED dashboard card surface Summary

**The dashboard now renders the COMPLETED card 11-17 supplies, with a working Download certificate link and verification reference and no dead links, the Next-up copy no longer promises certificates that already exist, and a real-Postgres test proves the chain against the status issuance really writes.**

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 | fd7ba8e | COMPLETED branch in `EnrolmentSection`; corrected `complete` copy in `NextUpCard`; 3 page tests |
| 2 | 9c46169 | Integration case: real issuance, then row status, dashboard card, stranger, G-01 |

## Regression verification

- Task 1: tests written first and run against the unmodified page: the COMPLETED-card test and the Next-up copy test failed (Upcoming sessions and "certificates ship" still rendered); the other 11 passed. After the change: 13/13. The ACTIVE guard test asserts Assessments, Results, Upcoming sessions and their links still render.
- Task 2: the integration suite was **executed for real** against a Testcontainers Postgres 16 and the MinIO container: 3/3 passed. The new case asserts (a) the enrolment row status is `COMPLETED` after real issuance, (b) exactly one dashboard card with `enrolmentStatus: COMPLETED` and `certificate` matching `{ kind: "issued", certificateId, verificationRef }`, (c) a second learner sees no card for the enrolment, (d) `hasActiveEnrolmentCoveringCourse` is false. I did not re-run it against a pre-11-17 service (that fix landed in the prior plan); its guard value is that it reads the status straight from the database row.

## Verification run

- `vitest`: learner-dashboard-page, certificate-slot (components), certificate-download-route: 28 passed. boundary, certificate-phase-invariants, learner-dashboard-page, enrolment-dashboard-service: 91 passed. certificate-download.integration: 3 passed.
- `npx tsc --noEmit`: exit 0. `npx next build`: clean.
- `grep "certificates ship" src`: no matches. `git diff package.json package-lock.json`: empty (T-11-SC).
- No browser walkthrough was done; UAT tests 10 and 19 remain to be re-checked by a person.

## Threat model coverage

- T-11-74: certificates come from the ownership-scoped batch in 11-17; the integration case asserts a stranger's dashboard has no card for the enrolment.
- T-11-75: page omits sessions, Assessments and Results for COMPLETED; page test asserts absence, including no `/learn/enrolment-1/` link at all.
- T-11-76: copy corrected and asserted absent by test.
- T-11-SC: nothing installed.

## Deviations from Plan

None. The plan executed as written. The COMPLETED page test also asserts no `/learn/{id}/` link renders anywhere on the card, a stricter form of the plan's listed absences.

## Known Stubs

None introduced. The Support tickets slot remains an intentional Phase 12 deferred slot.

## Threat Flags

None.

## Self-Check: PASSED

- Modified files present; commits fd7ba8e and 9c46169 exist on branch Khaliddev.
