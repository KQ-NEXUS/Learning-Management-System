---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 10
subsystem: ui-time-formatting
tags: [d-17, u-12, lagos-time, s6, staff, nfr-09]
status: complete

requires:
  - phase: 15-05
    provides: LagosTime component and the Lagos formatter
provides:
  - "Staff slice 1 of the Lagos-time sweep: support, audit, overview, order detail, cohorts list, cohort detail (exceptions and roster tabs), export history, email log, enrolments render through LagosTime"
affects: [15-32, 15-33]

actuals:
  tokens: 9000
  tasks: 2
  commits: 0

key-files:
  modified:
    - src/app/staff/support/SupportWorkspace.tsx
    - src/app/staff/audit/AuditTable.tsx
    - src/app/staff/page.tsx
    - src/app/staff/payments/[orderId]/page.tsx
    - src/app/staff/cohorts/CohortsTable.tsx
    - src/app/staff/cohorts/[id]/page.tsx
    - src/app/staff/cohorts/[id]/ExceptionsTab.tsx
    - src/app/staff/cohorts/[id]/RosterTab.tsx
    - src/app/staff/reports/exports/ExportHistory.tsx
    - src/app/staff/email-log/EmailLogTable.tsx
    - src/app/staff/enrolments/EnrolmentsTable.tsx
    - tests/components/audit-table.test.tsx

key-decisions:
  - "Staff overview SVG week labels now format in Africa/Lagos (day and month kept); dayHeading, timeOf and the 'starts' line stay in the cohort's own zone (ledger OQ4)"
  - "Cohort detail enrolment window and dates render in Lagos time; the cohort's own timezone is named after the range only when it is not Africa/Lagos"
  - "Cohorts list 'Starts' column is a Lagos date; the cohort timezone subtitle is kept"

requirements-completed: []
---

# Phase 15 Plan 10: Lagos time, staff slice 1 Summary

**Eleven staff files now render every timestamp through LagosTime ("5 Oct 2026, 14:30 WAT" in a time element with the ISO UTC instant), audit rows show seconds, and the staff support "Data as of" line no longer says UTC.**

## What changed

- **SupportWorkspace:** the "Data as of ... UTC" line (left by 15-05) is now `LagosTime`.
- **AuditTable:** desktop and mobile rows use `LagosTime variant="dateTimeSeconds"` with mono 13px nowrap.
- **Staff overview (`page.tsx`):** SVG week labels switched from UTC to Africa/Lagos; the cohort-zone session helpers are untouched.
- **Order detail:** the local `toLocaleDateString` helper is gone. The "already paid" sentence uses a Lagos date, the Date fact and refund rows use Lagos date-time.
- **Cohorts list and detail:** the `formatInZone` Intl helper (with its UTC fallback) and the `zoned` helper are replaced with LagosTime (`CohortRange` for the two ranges). Exceptions "corrected on" and roster "Latest transition" use LagosTime.
- **Export history:** the local Intl helper is removed; six `<time>` sites became LagosTime (table cells get mono 13px nowrap).
- **Email log and enrolments:** all four formatter call sites became LagosTime (`AccessWindow` helper in enrolments, dates as Lagos days).

## Tests

- `tests/components/audit-table.test.tsx` (the only test edited): the timestamp assertion now expects the seconds form, a `TIME` element, the ISO `datetime` attribute and the text "15 Jan 2026, 11:30:00 WAT".
- Passed: audit-table + support-workspace (48 passed, 1 skipped, pre-existing skip); cohorts-table, cohort-pages, cohort-roster, ExportHistory, email-log-table (62 passed, unchanged); payment-detail (25 passed, run read-only as the page changed); design-contract (105 passed, run after each task).
- Plan 15-10's node slice check prints "slice ok". `npx tsc --noEmit` clean; eslint clean on all twelve touched files.
- No test file needs a date-expectation change for plan 15-33 from this slice.

## Deviations from Plan

None that change behaviour beyond the plan. Judgement calls the owner may want to review:

1. Cohort detail enrolment window and dates were previously shown in the cohort's own zone with a "(zone)" suffix. The plan lists that file for the sweep, so they are now Lagos time, and a "(cohort timezone: X)" note appears only for non-Lagos cohorts. The edit form still uses the cohort's zone.
2. Cohorts list "Starts" is now a Lagos calendar day; for a cohort in another zone this can differ by a day from the cohort-zone date.
3. `dateFormat` in the overview subtitle (long weekday date, already Africa/Lagos) was left as is: it is not UTC and not a timestamp.

## Known Stubs

None.

## Neon go-live list

No migrations in this plan.

## Threat Flags

None.

## Self-Check: PASSED

- All twelve modified files exist and were checked by tsc, eslint and the slice script.
- No commits made (run override); nothing staged.
