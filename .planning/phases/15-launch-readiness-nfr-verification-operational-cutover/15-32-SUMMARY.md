---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 32
subsystem: ui-time-formatting
tags: [d-17, u-12, lagos-time, s6, staff, nfr-09]
status: complete

requires:
  - phase: 15-05
    provides: LagosTime component and the Lagos formatter
provides:
  - "Staff slice 2 of the Lagos-time sweep: certificates, grading, learner progress, users and the publish dialog render every timestamp through LagosTime"
affects: [15-33]

actuals:
  tokens: 7000
  tasks: 2
  commits: 0

key-files:
  modified:
    - src/app/staff/certificates/CertificateQueueTable.tsx
    - src/app/staff/certificates/RecentlyIssuedList.tsx
    - src/app/staff/certificates/issued/IssuedCertificatesTable.tsx
    - src/app/staff/certificates/issued/[id]/page.tsx
    - src/app/staff/certificates/templates/TemplatesTable.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/page.tsx
    - src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx
    - src/app/staff/cohorts/[id]/learners/[enrolmentId]/page.tsx
    - src/app/staff/users/AssignmentsPanel.tsx
    - src/app/staff/users/UsersTable.tsx
    - src/app/staff/users/[id]/page.tsx
    - src/components/catalogue/PublishDialog.tsx

key-decisions:
  - "GradeEntryClient keeps the last draft-save instant as an ISO string in state and renders 'Draft saved <LagosTime>' instead of storing preformatted text"
  - "Users and assignments dates are Lagos calendar days (variant date); the local fmtDate helpers are removed"

requirements-completed: []
---

# Phase 15 Plan 32: Lagos time, staff slice 2 Summary

**Fourteen staff and catalogue files now render every timestamp through LagosTime ("5 Oct 2026, 14:30 WAT" or a Lagos date, in a time element carrying the ISO UTC instant), and the publish dialog's locale-dependent end date is gone.**

## What changed

- **Certificates (Task 1, tracer):** queue "Eligible since", recently issued list, issued list, templates "Last edited" and the issued-record page ("Issued", "Revoked", "Flagged for review" text) use LagosTime. Table cells carry `font-mono text-[13px] whitespace-nowrap`. Null revoke or flag times render a plain dash with no time element. `TemplateCanvas.tsx` and all PDF code are untouched.
- **Grading:** queue "Submitted" cell, grade-entry overrides history, "Draft saved" status line, submission page "Submitted" fact and file line.
- **Learner progress:** lesson completed-at line in `ProgressOverridePanel` (now a JSX fragment instead of a template string) and the "latest" cell on the learner page.
- **Users:** users list Created/Deactivated, user detail Created/Deactivated, assignments panel start, end and revoked dates, all as Lagos days.
- **PublishDialog:** `formatEndDate` (toLocaleDateString with an undefined locale) is deleted; the affected-cohort end date is `LagosTime variant="date"`, identical on server and client (T-15-32-01).

## Tests

- `tests/components/certificate-queue`, `recently-issued-list`, `certificate-record`, `certificate-templates`: 4 files, 56 tests passed.
- `tests/components/grading-queue-table`, `grade-entry-client`, `staff-progress-override`, `assignments-panel`, `publish-dialog`: 5 files, 43 tests passed.
- `tests/unit/design-contract.test.ts`: 107 passed.
- The Task 2 node slice check prints "slice ok" (all fourteen files import LagosTime; no `timeZone: "UTC"`, `toLocaleDateString(` or `toLocaleTimeString(` outside comments).
- `npx tsc --noEmit` clean; eslint clean on all touched files.
- No test file was edited: none of the nine named test files asserted a date string that changed. Nothing to hand to plan 15-33 from this slice.
- Vitest was run with `--maxWorkers=1`; the default pool timed out starting workers under memory pressure on this machine.

## Deviations from Plan

None. One judgement call: `GradeEntryClient` state `draftStatus` now holds an ISO instant rather than the formatted sentence so the time can render in a time element.

## Known Stubs

None.

## Neon go-live list

No migrations in this plan.

## Threat Flags

None.

## Self-Check: PASSED

- All fourteen files exist and import LagosTime (slice check).
- `TemplateCanvas.tsx` unchanged.
- No commits made (owner instruction); nothing staged.
