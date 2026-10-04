---
created: 2026-10-04T12:00:00.000Z
title: Session calendar — staff schedule by clicking a day, learners see upcoming sessions highlighted
area: cohorts, learner
source: Owner idea (Khalid), 2026-10-04
kind: feature
files:
  - src/app/staff/cohorts/[id]/SessionsTab.tsx
  - src/app/staff/cohorts/[id]/SessionFormFields.tsx
  - src/app/staff/cohorts/[id]/session-actions.ts
  - src/server/services/scheduled-session-service.ts
  - src/app/(learner)/learn/[enrolmentId]/sessions/page.tsx
  - src/app/(learner)/dashboard/page.tsx
---

## Idea (owner's words, lightly tidied)

Staff should be able to schedule sessions from a calendar: click a day, a small
form pops up, fill in the details, and the date is already set. Learners should
see the same thing reflected: a calendar that highlights their upcoming
sessions.

## What exists today

- Staff schedule sessions from a table on the cohort's Sessions tab ("Add
  session", "Repeat weekly", and since A-11 "Edit"). The date is typed into a
  form field. There is no calendar view.
- Learners see their sessions as a list (`/learn/[enrolmentId]/sessions`) and
  the next one on the dashboard. No calendar.
- Everything behind it already exists and would be reused unchanged: create,
  repeat-weekly, edit and cancel in `scheduled-session-service.ts`, with their
  permissions, timezone handling, audit and learner emails.

So this is a new way of looking at and entering the same data, not new
session behaviour.

## Shape of the work

Staff:
- A month calendar on the cohort's Sessions tab, alongside the existing table
  (a view switch), showing each session on its day.
- Clicking an empty day opens the existing session form with that date filled
  in. Clicking a session opens it for editing.
- Days shown in the cohort's own timezone, as the form already works.

Learner:
- A month calendar of their sessions with upcoming ones highlighted, and
  cancelled ones marked. Read-only.
- The meeting link stays behind its existing visibility rule; the calendar
  must not expose it early.

## Open questions for the owner

1. Staff calendar per cohort only, or also one calendar across all the cohorts
   a staff member manages?
2. Learner calendar per course, or one calendar across everything they are
   enrolled on (probably on the dashboard)?
3. Month view only, or week view too?
4. Should the table view stay as an alternative? (Recommended: yes. A table is
   easier to scan and sort, and works better on a phone and with a screen
   reader.)

## Notes

- Accessibility matters here: a calendar grid needs keyboard navigation and
  screen-reader labels, and phase 15 tests against WCAG 2.2 AA.
- Feature-sized. Belongs in its own phase or a backlog slot, not in phase 15.

## Decisions and outcome (2026-10-04)

Owner's answers: staff calendar per cohort only; learners get one calendar
across everything they are enrolled on; month and week views; the table stays,
behind a switch.

Built:
- `src/lib/calendar.ts` — civil-date helpers (weeks start Monday).
- `src/components/calendar/SessionCalendar.tsx` — shared month/week calendar.
- `src/components/primitives/FormDialog.tsx` — the pop-up that holds the form.
- Staff: Table / Calendar switch on the cohort Sessions tab. Click a day to add
  a session on it; click a session to edit it. Without `cohorts.manage` the
  calendar is read-only and a session opens its attendance register.
- Learner: `/learn/calendar`, linked from the dashboard and My learning.
  Read-only; each session links to its course's sessions page. The meeting
  link is never passed to the calendar (D-25).

Not built: a staff calendar across all cohorts (owner chose per cohort only);
an hour-by-hour time grid in the week view (the week view lists each day's
sessions with their times instead).
