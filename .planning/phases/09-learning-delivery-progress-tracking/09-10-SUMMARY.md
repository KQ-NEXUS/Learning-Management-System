---
phase: 09-learning-delivery-progress-tracking
plan: 10
subsystem: learning-delivery
tags: [nextjs, server-components, prisma, meeting-link-gate, sessions, attendance]

# Dependency graph
requires:
  - phase: 09-03
    provides: "learner-access.ts's getOwnActiveEnrolment (ownership-scoped enrolment resolution, denial parity)"
  - phase: 09-08
    provides: "(learner)/layout.tsx — the LearnerShell mount and route-group guard for /learn/*"
  - phase: 05 (scheduled-session-service.ts)
    provides: "isMeetingLinkVisible / linkVisibleFrom — the meeting-link visibility gate, now exported for reuse"
provides:
  - "listOwnCohortSessions(actor, enrolmentId, now) — ownership-scoped session list with the server-side meeting-link gate (LRN-06)"
  - "SessionView type: {id, title, startsAt, endsAt, location, cancelledAt, cancellationReason, mode, attendance, meetingUrl?, meetingUrlAvailableFrom?}"
  - "/learn/[enrolmentId]/sessions page — Upcoming/Past session list with cohort-timezone times and own attendance outcomes"
  - "SessionCard component — one session's rendered card, reused by the sessions page"
affects: [09-11, 09-12, phase-10-assessment-grading]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Strip-then-add-back destructure for a capability-bearing field (meetingUrl) — DD-24, mirrored from readSessionForViewer"
    - "mode derived from column presence, then the value discarded before the base view is built — never exposed via a side channel"

key-files:
  created:
    - src/server/services/learner-session-service.ts
    - src/components/learner/SessionCard.tsx
    - src/app/(learner)/learn/[enrolmentId]/sessions/page.tsx
    - tests/learner-session-service.test.ts
    - tests/learner-sessions-page.test.ts
  modified:
    - src/server/services/scheduled-session-service.ts

key-decisions:
  - "Exported linkVisibleFrom from scheduled-session-service.ts (was module-private) so learner-session-service.ts can reuse the exact same minute arithmetic per DD-23, rather than reimplementing it or inventing a duplicate pure module"
  - "SessionCard takes an isPast prop beyond the plan's two-prop (session, timezone) sketch — SessionView alone doesn't carry upcoming/past context, and UI-SPEC 7.4 requires the attendance pill to render only for past sessions"

patterns-established:
  - "The N-minutes-before copy is computed as presentation arithmetic on two already-disclosed timestamps (startsAt, meetingUrlAvailableFrom) in the component, never re-deriving the gate's own now->=opensAt decision"

requirements-completed: [LRN-06]

# Metrics
duration: 32min
completed: 2026-09-15
---

# Phase 09 Plan 10: Learner sessions view with the gated meeting link Summary

**Ownership-scoped `listOwnCohortSessions` read plus the `/learn/[enrolmentId]/sessions` page, where the meeting URL is structurally absent from the payload until `isMeetingLinkVisible`'s window opens (DD-23/DD-24, reusing Phase 5's gate unchanged).**

## Performance

- **Duration:** 32 min
- **Started:** 2026-09-15T00:48:05+01:00 (worktree base)
- **Completed:** 2026-09-15T01:19:36+01:00
- **Tasks:** 2/2 completed
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments
- `listOwnCohortSessions` returns `null` for not-found/not-mine/not-ACTIVE (identical denial parity to `getOwnActiveEnrolment`), otherwise `{ timezone, upcoming, past }` split and sorted by `endsAt`/`startsAt`.
- The meeting URL is omitted from the returned object entirely (no key at all) until the visibility window opens — proven by an `"meetingUrl" in view` substring/key-presence assertion in both the service test and a full-HTML substring check in the page test.
- `mode` ("virtual"/"in-person"/"unknown") is derived from column presence and the value is discarded before the view is built, so the mode badge itself cannot leak the URL.
- The sessions page renders cohort-timezone times, a "Join session" link only when the gate is open, the "opens N minutes before" copy otherwise, cancelled-session treatment (struck-through title, neutral pill, reason), and the caller's own attendance outcome on past sessions — using the exact tone vocabulary already established for attendance states.

## Task Commits

1. **Task 1: learner-session-service.ts — ownership-scoped session list with the link gate** - `421cd33` (feat)
2. **Task 2: SessionCard and the sessions page** - `b59a972` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/server/services/learner-session-service.ts` - `listOwnCohortSessions`; injected-deps + live-singleton convention; imports `isMeetingLinkVisible`/`linkVisibleFrom` rather than reimplementing them
- `src/server/services/scheduled-session-service.ts` - `linkVisibleFrom` changed from module-private to exported (no behavior change)
- `src/components/learner/SessionCard.tsx` - one session's card: title, cohort-timezone date/time, location, gated meeting-link affordance, cancelled/attendance pills
- `src/app/(learner)/learn/[enrolmentId]/sessions/page.tsx` - the LRN-06 route: actor resolution, `notFound()` on denial, Upcoming/Past groups, empty state
- `tests/learner-session-service.test.ts` - 14 cases: denial parity, split/sort, visibility-window boundary (before/after), cancelled-inside-window, mode derivation (virtual/in-person/unknown), attendance ownership
- `tests/learner-sessions-page.test.ts` - 8 cases: redirect, notFound, empty state, pre-window/in-window meeting-link rendering, cancellation, attendance pill, Upcoming/Past grouping

## Decisions Made
- Exported `linkVisibleFrom` from `scheduled-session-service.ts` (Rule 3 auto-fix — the plan's own read_first pointed at this function for reuse, but it was not exported). This is the minimal change satisfying DD-23's "import, never reimplement" ruling without introducing the fallback `src/lib/session-visibility.ts` pure module, since `tests/boundary.test.ts` does not walk `learner-session-service.ts`'s import closure (it is never a route/webhook/scheduled-function entrypoint) — the DD-23 fallback condition was not triggered.
- Added `isPast: boolean` to `SessionCardProps` (Rule 3 auto-fix, same precedent as `NextUpCard`'s documented `timezone` prop addition) — `SessionView` has no upcoming/past flag of its own, and the attendance `StatusPill` must render only in the Past group per UI-SPEC 7.4.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `linkVisibleFrom` from `scheduled-session-service.ts`**
- **Found during:** Task 1
- **Issue:** The plan's DD-23 ruling and read_first both require `linkVisibleFrom` for the "opens in N minutes" data (`meetingUrlAvailableFrom`), but the function was module-private (no `export` keyword) at the time the plan was written.
- **Fix:** Added `export` to the existing function, with a doc-comment note pointing at 09-10/DD-23 as the reason. No logic change.
- **Files modified:** `src/server/services/scheduled-session-service.ts`
- **Verification:** `npx vitest run tests/learner-session-service.test.ts tests/boundary.test.ts` green; `grep -c "linkVisibleFromMinutes \* 60" src/server/services/learner-session-service.ts` returns 0.
- **Committed in:** `421cd33` (Task 1 commit)

**2. [Rule 3 - Blocking] Added `isPast` prop to `SessionCard`**
- **Found during:** Task 2
- **Issue:** The plan's action text describes `SessionCard` as taking "one `SessionView` plus the cohort `timezone`", but UI-SPEC 7.4 requires the attendance pill to render only for past sessions, and `SessionView` carries no upcoming/past flag — the page, not the card, knows which group a session is in.
- **Fix:** Added a third required prop, `isPast: boolean`, set by the page from which group (`upcoming`/`past`) it is rendering.
- **Files modified:** `src/components/learner/SessionCard.tsx`, `src/app/(learner)/learn/[enrolmentId]/sessions/page.tsx`
- **Verification:** `tests/learner-sessions-page.test.ts`'s "a past session renders the correct attendance pill label" and "groups sessions under Upcoming and Past headings" cases pass; the pill does not render on an otherwise-identical upcoming fixture.
- **Committed in:** `b59a972` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both are minimal, additive changes needed to satisfy the plan's own stated behavior; neither is an architectural change. No scope creep.

## Issues Encountered

`npx next build` could not be run to completion in this worktree: Turbopack reports `Could not find the Next.js package (next/package.json)` because this worktree's `node_modules` is effectively empty — the same pre-existing sandbox gap already documented in `09-08-SUMMARY.md` and `09-13-SUMMARY.md` for this same phase (Docker unavailable, `stripe` module missing under `npx tsc --noEmit` are the same class of gap). `npx tsc --noEmit` shows zero errors attributable to any file this plan touched (the only errors present — `stripe` module resolution, `LayoutProps` in `src/app/layout.tsx` — are pre-existing and unrelated, confirmed via `git status`/`grep` scoping before this plan started). `npx eslint` on all five touched/created files passes with zero output. `npx vitest run tests/learner-session-service.test.ts tests/learner-sessions-page.test.ts tests/boundary.test.ts tests/cohort-service.test.ts tests/attendance-window.test.ts` — 99/99 passing. Not fixable via Rule 3 (package-manager installs are explicitly excluded from auto-fix) and not caused by this plan's changes. Deferred to whichever environment has a fully installed `node_modules` for this worktree — the acceptance criterion "`npx next build` completes without error" could not be verified in this session.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

LRN-06 is shipped: the sessions read path and page are in place, reusing Phase 5's meeting-link gate unchanged. `SessionView`'s shape (`mode`, `attendance`, gated `meetingUrl`) is available for any later phase needing the same session data (e.g. a future "session detail" or notification surface). The one outstanding item is the `npx next build` verification gap documented above — recommend running it in a fully-installed environment before the phase's overall UAT closes, consistent with 09-08/09-13's identical outstanding item.

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-15*
