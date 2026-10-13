---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 33
subsystem: ui
tags: [lagos-time, wat, time-element, intl, vitest, static-guard]
requires:
  - phase: 15-launch-readiness-nfr-verification-operational-cutover
    provides: "15-05 LagosTime and format-timestamp, 15-10 and 15-32 staff Lagos-time slices, 15-03 throttled certificate-check branch"
provides:
  - "Learner, checkout, notification, public catalogue and certificate-check screens render Lagos time or Lagos dates inside time elements"
  - "tests/lagos-time-guard.test.ts: whole-tree guard against UTC or locale-dependent date rendering with a one-entry reasoned allow-list"
affects: [phase-15 verification, any future UI that renders a date]
actuals:
  tokens: 26000
  tasks: 3
  commits: 0
tech-stack:
  added: []
  patterns:
    - "Rendered timestamps use <LagosTime> (or formatLagosOrDash); the public certificate check uses an Intl long-month date with timeZone LAGOS_TIME_ZONE inside a time element"
    - "Static guard scans src/app and src/components and rejects timeZone literal UTC, toLocaleDateString( and toLocaleTimeString("
key-files:
  created:
    - tests/lagos-time-guard.test.ts
  modified:
    - src/app/(public)/CohortCards.tsx
    - src/app/(public)/courses/page.tsx
    - src/app/(public)/programmes/page.tsx
    - tests/components/cohort-cards.test.tsx
    - src/app/(learner)/dashboard/page.tsx
    - tests/learner-dashboard-page.test.ts
    - src/app/(checkout)/checkout/[orderId]/page.tsx
    - src/components/learner/AssignmentSubmissionPanel.tsx
    - src/components/learner/QuizAttemptPanel.tsx
    - src/components/learner/ResultsList.tsx
    - src/components/notifications/NotificationItem.tsx
    - src/app/verify/[verificationRef]/page.tsx
key-decisions:
  - "NextUpCard.tsx left unchanged: its only date is the session variant's time in the cohort's own zone (utcToWallParts label), which ledger OQ4 excludes"
  - "Dashboard 'Assessment due' sub-line moved from whenLabel (cohort zone) to LagosTime: it is an assessment deadline, not a session; whenLabel and greetingFor are unchanged"
  - "Certificate check keeps en-GB long month but passes the LAGOS_TIME_ZONE constant (not a literal UTC), so the guard accepts it and the day is the Lagos day"
requirements-completed: []
duration: resumed session, not timed
completed: 2026-10-09
status: complete
---

# Phase 15 Plan 33: Lagos-time slice 3 Summary

**Learner, checkout, notification, public catalogue and certificate-check dates now render in Africa/Lagos inside time elements, and a whole-tree guard test fails if a UTC or locale-dependent date call comes back.**

## Performance

- **Duration:** resumed from an interrupted session; not timed
- **Completed:** 2026-10-09
- **Tasks:** 3 of 3
- **Files modified:** 12 plus 1 created (the guard test)
- **Commits:** 0 (project policy: the owner commits manually)

## Accomplishments

- Public cohort cards, courses and programmes listings: start dates go through `LagosTime variant="date"`; a cohort starting 2026-10-05T23:30:00Z shows "6 Oct 2026" with `dateTime="2026-10-05T23:30:00.000Z"` (new day-boundary test).
- Checkout order page: the cohort date range is two `LagosTime` date elements (was `toLocaleDateString(undefined, ...)`, browser-locale dependent). Notification items: weeks-old items show a Lagos date through `LagosTime` (was `toLocaleDateString`); relative "5m ago" text kept.
- Learner panels (assignment submission, quiz attempt, results list) use `LagosTime` instead of plain-text `formatTimestamp`; the results table cell got `whitespace-nowrap` (S6). Dashboard "Your access ends" and "Assessment due" use `LagosTime`.
- Public certificate check: `formatIssuedDate` is a Lagos long-month date ("5 October 2026", numeric day) inside a `<time dateTime={ISO UTC}>` via a small `IssuedDate` helper; the four render branches (active, revoked, not_found, plan 15-03's throttled branch) are unchanged.
- `tests/lagos-time-guard.test.ts`: walks `.ts`/`.tsx` under `src/app` and `src/components`, skips comment lines, fails naming file and line. Three tests: no offenders; allow-list entries have reasons and still contain a rejected call; none of the 15-10/15-32/15-33 files is allow-listed.

## Guard offender record (Task 1)

The earlier interrupted session wrote the guard; at resume time, before the verify page was finished, the guard named exactly one offender, a file of this plan: `src/app/verify/[verificationRef]/page.tsx:41` (`timeZone: "UTC"`). No file from another plan was named. After Task 3 the offender list is empty.

Allow-list (one entry, verified to contain a real rejected call):
- `src/app/staff/reports/[dataset]/ReportDashboard.tsx` (line 79 `toLocaleDateString("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" })`): already pinned to Lagos and a deterministic locale, and the reports dashboard is not in the 15-10/15-32/15-33 files lists (confirmed by grep of the plan files).

## Task Commits

None. Per project policy no commits were made; the working tree holds all changes for the owner to commit.

## Files Created/Modified

See frontmatter `key-files`. Test files edited for date expectations only: `tests/components/cohort-cards.test.tsx` (Lagos day, time element, boundary case), `tests/learner-dashboard-page.test.ts` (the "Your access ends" assertion now expects the `<time dateTime=...>1 Oct 2026</time>` form instead of "2026-10-01"). Of the six Task 2 test files, only the dashboard test needed a change.

## Decisions Made

See `key-decisions`. In short: NextUpCard is a session-schedule surface, so it stays in the cohort zone per OQ4.

## Deviations from Plan

### Judgement calls and plan conflicts

**1. [Plan conflict] NextUpCard.tsx not converted; acceptance line "NextUpCard.tsx imports LagosTime" is not met**
- **Found during:** Task 2
- **Issue:** The plan assumed NextUpCard renders a date to convert. Its only date is the `session` variant's `utcToWallParts(action.startsAt, timezone).label`, a session time in the cohort's own zone. Must-have truth and ledger OQ4 say session schedules are not changed; converting it would contradict that.
- **Fix:** No change to `src/components/learner/NextUpCard.tsx` (file is unmodified in `git status`). It carries no rejected call, so the guard and slice check pass.
- **Owner action:** if the owner wants the acceptance line honoured literally, OQ4 would have to be reversed for next-up session times; I did not do that.

**2. [Rule 1/judgement] Dashboard "Assessment due" line moved to Lagos time**
- **Found during:** Task 2
- **Issue:** it rendered a due deadline through `whenLabel` (cohort zone). A deadline is not a session schedule, and the learner assignment panel already shows the same due date in Lagos time, so the two screens could disagree.
- **Fix:** `Due <LagosTime value={firstDue.dueAt} />`. `whenLabel` and `greetingFor` keep their timezone parameter and all session uses.
- **Files modified:** `src/app/(learner)/dashboard/page.tsx`
- **Owner action:** revert that one line if the due time is meant to stay in the cohort zone.

**3. [Rule 3 - Blocking] Guard tests timed out at vitest's default 5 s on a busy machine**
- **Fix:** both whole-tree scan tests in `tests/lagos-time-guard.test.ts` get a 60 s timeout. The scan itself is about 1 s on an idle machine.

**4. [Scope note] verify page contains plan 15-03's working-tree edits**
- The throttled branch, `rateLimitService` and `headers()` imports in `src/app/verify/[verificationRef]/page.tsx` are 15-03's uncommitted changes in the same file. I only changed `formatIssuedDate`, added `IssuedDate`, and the `LAGOS_TIME_ZONE` import. The commit for this file will contain both plans' edits unless the owner splits hunks.

No files outside the plan's `files_modified` were touched, except `tests/learner-dashboard-page.test.ts`, which the plan explicitly allows for date expectations (Task 2 action).

## Issues Encountered

None beyond the items above. No Neon, migration or seed activity was needed; all tests used mocks.

## Verification (real results)

All run from the project root:

- `npx vitest run tests/learner-dashboard-page.test.ts tests/learner-results-page.test.ts tests/components/assignment-submission-panel.test.tsx tests/components/quiz-attempt-panel.test.tsx tests/components/support-entry-points.test.tsx tests/components/notification-drawer.test.tsx`: 6 files, 84 tests passed.
- Task 2 node slice check (seven files, no `timeZone: "UTC"`, `toLocaleDateString(` or `toLocaleTimeString(` on non-comment lines): exit 0, no output.
- `npx vitest run tests/lagos-time-guard.test.ts tests/components/cohort-cards.test.tsx tests/verify-routes.test.ts tests/certificates-landing-page.test.ts`: 4 files, 39 tests passed.
- `npx vitest run tests/components/cohort-cards.test.tsx`: 1 file, 20 tests passed.
- `npx vitest run tests/unit/design-contract.test.ts --testTimeout=60000`: 1 file, 107 tests passed.
- Extra: `npx vitest run tests/components/checkout-summary.test.tsx tests/public-courses-page.test.ts`: 35 tests passed; `npx tsc --noEmit -p .`: no errors; eslint on the verify page, dashboard page and guard test: clean.
- Checkout order page, courses and programmes pages and NotificationItem have no dedicated page-render date assertions; they are covered by the guard, tsc and the neighbouring suites above, not by a rendered-output test.

## User Setup Required

None.

## Known Stubs

None.

## Next Phase Readiness

All three Lagos-time slices (15-10, 15-32, 15-33) are done in the working tree, and the whole-tree guard passes. The owner still needs to commit manually. STATE position, REQUIREMENTS checkboxes (NFR-09 spans many plans) and `state.advance-plan` are left to the orchestrator.

---
*Phase: 15-launch-readiness-nfr-verification-operational-cutover*
*Completed: 2026-10-09*

## Self-Check: PASSED

- Created and modified files exist (checked via `git status`); `tests/lagos-time-guard.test.ts` present.
- No commits were made by design, so no hashes are claimed.
