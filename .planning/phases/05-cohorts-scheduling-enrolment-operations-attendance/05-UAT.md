---
status: complete
phase: 05-cohorts-scheduling-enrolment-operations-attendance
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-05-SUMMARY.md, 05-06-SUMMARY.md, 05-07-SUMMARY.md, 05-08-SUMMARY.md, 05-09-SUMMARY.md, 05-10-SUMMARY.md, 05-11-SUMMARY.md, 05-12-SUMMARY.md, 05-13-SUMMARY.md, 05-14-SUMMARY.md, 05-15-SUMMARY.md, 05-16-SUMMARY.md]
started: 2026-09-07T13:21:41Z
updated: 2026-09-07T13:32:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Stop any running app/worker/db, then start everything from scratch. Server boots without errors; `npx prisma migrate status` reports 5 migrations applied with no drift; `npm run db:seed` completes; the worker logs `queues ready` including `enrolment.hold-sweep`; `/staff/cohorts` loads and shows seeded cohorts.
result: pass

### 2. Cohorts List Page
expected: Signing in as staff and opening `/staff/cohorts` shows a table with columns Code, Offer (title + kind), Delivery mode, Window (opens→closes + timezone), Seats (taken/capacity), Status. Search box plus status and delivery-mode filters work. A "Create cohort" link sits in the header. Sidebar shows a "Cohorts" nav entry.
result: pass

### 3. Create a Cohort
expected: "Create cohort" opens a form with every COH-02 field: pick exactly one Course OR one Programme (not both), enrolment opens/closes, start/end dates, timezone (IANA select), capacity (integer ≥1), price in minor units + currency, delivery mode, seat-hold minutes (hint: "default 30 · 0 or blank = seat taken only on activation"). Invalid input (end before start, both/neither offer, bad capacity) is rejected inline with a clear message. A valid submit creates the cohort in DRAFT and lands on its detail page.
result: pass

### 4. Offer-Lock on Edit
expected: Editing a cohort that has zero enrolments lets you change its Course/Programme. Editing a cohort that has at least one enrolment refuses a change of offer with a message naming the enrolment count; other fields still save.
result: pass

### 5. Cohort Detail Page — Overview
expected: Opening a cohort shows a tabbed layout: Overview, Sessions, Roster, Exceptions (each tab badge = row count). Overview lists offer target, enrolment window and dates shown in the cohort's own timezone, seats, price formatted as currency, delivery mode, seat-hold minutes, attendance threshold, plus the readiness panel.
result: pass

### 6. Readiness Panel + Publish Gate (COH-04)
expected: For a DRAFT cohort with a failing readiness slot (e.g. not pinned to a PUBLISHED offer, no sessions, capacity 0), the panel shows that item as FAIL and the Publish button inside the publish dialog is disabled with an itemized list of blocking items. Fixing the slot refreshes the panel to PASS and enables Publish; publishing flips status to PUBLISHED.
result: pass

### 7. Assign / Remove an Instructor
expected: On an INSTRUCTOR_LED or BLENDED cohort with no instructors, the Instructors readiness check is FAIL. The Instructors panel accepts a user id, assigns them, and the panel flips FAIL→PASS live; removing the last instructor flips it back to FAIL. Both assign and remove appear in the audit trail.
result: pass

### 8. Sessions Tab — Schedule, Repeat, Cancel
expected: The Sessions tab lists sessions ordered by start time with the cohort's timezone label. "Add session" stores a wall-clock time correctly for the cohort timezone (e.g. 09:00 Africa/Lagos on a date is stored as 08:00Z). "Repeat weekly ×N" (1–52) creates N independently-listed sessions one week apart, keeping the same local start time across a DST change. Soft-cancelling a session requires a reason (≥10 chars), keeps the row visible with a Cancelled status, and never deletes it.
result: pass

### 9. Bulk Attendance Marking (ATT-01)
expected: Opening a session's attendance screen shows one row per enrolled learner with a five-state control (PRESENT/ABSENT/LATE/EXCUSED/NOT_RECORDED), each state showing a text label, not colour alone. Before the session starts, PRESENT/ABSENT/LATE are disabled with a hint; EXCUSED/NOT_RECORDED stay enabled. Changing several rows and clicking "Save attendance" once commits only the changed rows; a dirty indicator and unsaved-changes warning behave correctly.
result: pass

### 10. Post-Window Attendance Correction (ATT-03)
expected: More than 168h after a session ends, each individual attendance change opens a confirmation dialog requiring a reason (confirm disabled under 10 chars). After confirming, `/staff/audit` shows both the original mark and the correction with before→after values, the actor, and the reason.
result: pass

### 11. Roster Tab (COH-07)
expected: The Roster tab shows one row per enrolment ordered by learner name: learner name + email, enrolment status pill with an expandable transition-history disclosure (count + latest actor/action/reason/time), access window, attendance as `earned% / required%` (or a "•" third state when the cohort has no threshold — never "0%"), and instructor names. Progress / Assessment / Completion columns each show "not tracked yet · Phase 9/10/11", never a number or blank.
result: pass

### 12. Enrolment Lifecycle Actions (COH-05)
expected: From the roster, a PENDING_PAYMENT enrolment offers Approve / Cancel; an ACTIVE enrolment offers Transfer / Withdraw / Cancel. Each action opens a modal requiring a reason (≥10 chars). Add-enrolment picks a learner + target status. Transfer is restricted to a sibling cohort of the same offer. A capacity-full add shows the exact "capacity reached" copy; a duplicate active enrolment shows the exact "already enrolled" copy — no raw error.
result: pass

### 13. Cohort Cancel — Bulk Withdraw (D-31)
expected: "Cancel cohort" opens a danger confirm modal stating the exact count of active enrolments to be withdrawn and requiring a reason (≥10 chars). After confirming: cohort status → Cancelled, seats → 0, every ACTIVE enrolment → Withdrawn, every PENDING_PAYMENT enrolment → Cancelled, open sessions → Cancelled, nothing deleted, and `/staff/audit` shows one row per affected enrolment and per session (not a single batched row) plus a `cohort.cancelled` row.
result: pass

### 14. Hold-Expiry Sweep (COH-06)
expected: With the worker running, an enrolment whose seat hold has expired (PENDING_PAYMENT past `holdExpiresAt`) is picked up within ~5 minutes: the worker logs `released N expired seat holds`, the enrolment becomes Cancelled with reason "hold expired", the seat is returned (seatsTaken decremented), and `/staff/audit` shows the change attributed to SYSTEM. A hold-less PENDING_PAYMENT enrolment (holdMinutes 0/null) is never swept.
result: pass

### 15. Exceptions Tab + CSV Parity (ATT-04)
expected: The Exceptions tab lists attendance exceptions across three categories (missing-register, at-risk, disputed), each with a text-labelled category pill. Category checkboxes and a learner-name search live in the URL so a reload restores the view. "Download CSV" respects the current filters and the CSV row count exactly matches the on-screen row count.
result: pass

### 16. Global Enrolments List
expected: `/staff/enrolments` (linked from the sidebar) lists every enrolment: learner, cohort code (link to the cohort), offer, status, access window, created date, with search + status + cohort filters. Row actions reuse the same enrolment-action modals as the roster.
result: pass

## Summary

total: 16
passed: 16
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
