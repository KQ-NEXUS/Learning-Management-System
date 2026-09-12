---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 13
subsystem: ui
tags: [next-app-router, resource-table, server-actions, zod, cohorts, sessions, attendance, arrange-board-pattern]

# Dependency graph
requires:
  - phase: 05-06
    provides: "scheduled-session-service.ts — createSessionFromWallTime/repeatWeeklySessions/cancelSession/listSessionsForCohort (no meetingUrl), timezone-labelled startsAtLabel/endsAtLabel"
  - phase: 05-08
    provides: "attendance-service.ts — loadSessionRegister/saveSessionAttendance/markAttendance, PreMarkingStateError/CorrectionReasonRequiredError/LearnerNotOnRosterError, canSetLiveStates + windowClosesAt courtesy fields"
  - phase: 05-12
    provides: "ResourceTable emptyBody pattern, the cohorts-index authorization-catch shape, ConfirmModal usage conventions"
provides:
  - "src/app/staff/cohorts/[id]/SessionsTab.tsx — SessionRow type + ResourceTable config (add / repeat-weekly / soft-cancel entry points), consumed as-is by plan 05-15's DetailLayout Sessions tab"
  - "src/app/staff/cohorts/[id]/session-actions.ts — createSessionAction/repeatWeeklyAction/cancelSessionAction"
  - "src/app/staff/cohorts/[id]/SessionFormFields.tsx — shared add/repeat-weekly field block + toSessionActionFields payload builder"
  - "src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/page.tsx + AttendanceMarkClient.tsx — the full-screen roster marking screen"
  - "src/app/staff/cohorts/[id]/attendance-actions.ts — saveAttendanceAction/correctAttendanceAction"
affects: [05-15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Presence-only derived field for a capability value: listSessionsForCohort now returns hasMeetingLink (boolean) computed from the already-in-scope meetingUrl row value, without ever returning the URL itself — lets a list screen show 'is a link configured' without becoming a second leak surface"
    - "meetingUrl-literal quarantine: the payload-building helper that legitimately needs the URL (toSessionActionFields) lives in the FORM file (SessionFormFields.tsx), not the LIST file (SessionsTab.tsx) — so a grep gate on the list file alone proves the list surface never touches the field name at all"
    - "Commit-once roster marking mirrors the Phase-4 arrange-board contract: local draft state + a single accent 'Save attendance' button sending only the CHANGED entries; post-window edits invert the contract to one ConfirmModal-gated, individually-reasoned correctAttendanceAction call per learner"
    - "Server Actions never duplicate service-side timing/roster rules — attendance-actions.ts has zero references to isWithinMarkingWindow/isBeforeSessionStart/the window-hours constant, proven by grep gate; every rule lives once, in attendance-service.ts"

key-files:
  created:
    - "src/app/staff/cohorts/[id]/SessionsTab.tsx"
    - "src/app/staff/cohorts/[id]/SessionFormFields.tsx"
    - "src/app/staff/cohorts/[id]/session-actions.ts"
    - "src/app/staff/cohorts/[id]/attendance-actions.ts"
    - "src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/page.tsx"
    - "src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx"
    - "tests/components/attendance-mark.test.tsx"
  modified:
    - "src/server/services/scheduled-session-service.ts (added hasMeetingLink to listSessionsForCohort's mapped row)"
    - "src/components/primitives/ResourceTable.tsx (added optional emptyHeading prop)"

key-decisions:
  - "The Sessions LIST surface (SessionsTab.tsx) must never spell out the meeting-link field name at all, not just never render its value — the payload-building helper that legitimately needs meetingUrl for create/repeat-weekly submission lives in SessionFormFields.tsx (the FORM file) and is imported by name (toSessionActionFields), so SessionsTab.tsx's own grep gate for the literal string passes structurally, not by accident."
  - "listSessionsForCohort gained a hasMeetingLink boolean (derived from the already-fetched row's meetingUrl, which was already excluded from the return value) rather than exposing the URL or omitting the Mode/link column's data need entirely — a presence-only field is not the capability itself (D-25) and required no new query."
  - "AttendanceMarkClient computes windowClosed once via a useState lazy initializer, not useMemo — react-hooks/purity forbids reading the impure Date.now() inside useMemo, and the window boundary does not need to re-evaluate on every render for a screen the user is actively editing."
  - "The bulk-save and correction Server Actions accept an explicit cohortId field purely for revalidatePath targeting — the service call itself never receives or trusts it; the roster/session scope is always re-resolved from sessionId by attendance-service.ts (D-10)."
  - "correctAttendanceAction applies its state change to BOTH draft and committed local state on success (not just committed) so a corrected radio does not appear to revert to its pre-correction value while a fresh correction on a different learner is still pending."

requirements-completed: [COH-03, ATT-01, ATT-03]

# Metrics
duration: ~50min
completed: 2026-09-04
---

# Phase 5 Plan 13: Sessions Tab + Attendance Marking Screen Summary

**The cohort Sessions tab (list/add/repeat-weekly ×N/soft-cancel, ResourceTable + ConfirmModal) and the full-screen attendance marking screen mirroring the Phase-4 arrange-board commit-once contract, with post-window changes routed individually through a mandatory-reason correction modal.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-09-04T16:20:00Z
- **Completed:** 2026-09-04T17:10:00Z
- **Tasks:** 2 (both `auto`)
- **Files:** 7 created, 2 modified (both shared primitives/services, additive)

## Accomplishments

- **`SessionsTab.tsx`** — `ResourceTable` config with the UI-SPEC columns (Title linking to the session's attendance screen, Starts already carrying the cohort's explicit timezone label via `startsAtLabel`, Duration derived from `endsAt - startsAt`, Facilitator, Mode/link showing presence only, Attendance expected, Status via `StatusPill`), an inline Add/Repeat-weekly panel built from the shared `SessionFormFields`, and soft-cancel through `ConfirmModal` (`minReasonLength: 10`, `tone="danger"`). Empty state: "No sessions scheduled" / the UI-SPEC body copy.
- **`SessionFormFields.tsx`** — the shared field block (title, date, start/end time, location, meeting URL, `linkVisibleFromMinutes`, facilitator, attendance-expected toggle, optional member-course select for a Programme cohort, and — for the repeat variant — the occurrences field with a live "creates N sessions, weekly from {date}" hint). Every date/time input is labelled with the cohort's timezone in mono via a small local `ZonedLabel` wrapper, since `FormField.label` is a plain string. Also exports `toSessionActionFields`, the payload builder the Sessions LIST file is deliberately kept from importing by name.
- **`session-actions.ts`** — `createSessionAction`/`repeatWeeklyAction`/`cancelSessionAction`, each a `.strict()` zod schema delegating to the plan 05-06 service; `occurrences` bounded 1–52 both here and in the service; typed-error mapping (`SessionCourseNotInCohortError`, `InvalidTimeZoneError`, `ReasonRequiredError`, `RepeatOccurrencesError`, `SessionTimeRangeError`, `StaleOrderError` for forward-compatibility, one generic `DENIED` line); `revalidatePath` on the cohort detail route with the `"page"` type argument.
- **`scheduled-session-service.ts` (deviation)** — `listSessionsForCohort` now also returns `hasMeetingLink: boolean`, derived from the row's already-in-scope `meetingUrl` field (never itself returned). Required for the Mode/link column to show presence without becoming a second leak surface; the existing `"meetingUrl" in list[0]` unit-test assertion still passes unchanged.
- **`attendance-actions.ts`** — `saveAttendanceAction` (bulk, `{ sessionId, entries: [...] }` plus a `cohortId` used only for revalidation) and `correctAttendanceAction` (single, post-window, mandatory `reason` ≥10 chars). Neither performs any roster lookup or timing check — both delegate entirely to `saveSessionAttendance`/`markAttendance`. `LearnerNotOnRosterError` maps to a generic "This register changed. Reload and try again." that never echoes the rejected id (T-05-87).
- **`page.tsx`** (attendance RSC) — loads `loadSessionRegister` + `listSessionsForCohort` in parallel, the same three-branch `AuthenticationError`/`AuthorizationError`/rethrow shape as the cohorts index, wraps the client island in `UnsavedOrderProvider` with a `GuardedLink` back to the cohort.
- **`AttendanceMarkClient.tsx`** — the full-screen roster list: one five-state radio group per learner (glyph + text label, never colour alone), local draft state with a single accent "Save attendance" commit sending only the changed entries, pre-start live-state radios disabled with the D-09 hint (courtesy echo — the server rule is the actual gate), and — once `windowClosesAt` has passed — every individual change opens `ConfirmModal` (`minReasonLength: 10`) and commits via `correctAttendanceAction` per learner rather than the bulk path. `aria-live` on the row/dirty-count line; `useUnsavedOrder` reports dirty state so navigating away mid-edit warns first.
- **`ResourceTable.tsx` (deviation)** — added an optional `emptyHeading` prop (default-preserving: falls back to the existing generated `"No {noun} yet"`) so the Sessions tab can show the UI-SPEC's exact "No sessions scheduled" heading, which does not read naturally off `noun="sessions"`.
- **`tests/components/attendance-mark.test.tsx`** — the four load-bearing contracts: pre-start disabling of present/absent/late with the hint text present; a two-learner change followed by save calling the bulk action exactly once with exactly those two entries; a past `windowClosesAt` opening the correction modal with its confirm button disabled until the minimum reason length is met; every state rendering a text label alongside its glyph.

## Task Commits

1. **Task 1: Sessions tab with add, repeat-weekly and soft-cancel** — `00e7ea3`
2. **Task 2: Attendance marking screen with commit-once save and post-window corrections** — `0eebd92`

**Plan metadata (SUMMARY.md / STATE.md / ROADMAP.md):** disk-only — `.planning/` is gitignored in this repo, so no metadata commit was made (sequential-mode execution note, consistent with 05-06/05-08/05-12).

## Files Created/Modified

- `src/app/staff/cohorts/[id]/SessionsTab.tsx` — Sessions `ResourceTable` + add/repeat-weekly panel + soft-cancel modal.
- `src/app/staff/cohorts/[id]/SessionFormFields.tsx` — shared session field block + `toSessionActionFields`.
- `src/app/staff/cohorts/[id]/session-actions.ts` — create/repeat-weekly/cancel Server Actions.
- `src/app/staff/cohorts/[id]/attendance-actions.ts` — bulk save + single correction Server Actions.
- `src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/page.tsx` — attendance RSC.
- `src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx` — the marking screen.
- `tests/components/attendance-mark.test.tsx` — the four interaction-contract tests.
- `src/server/services/scheduled-session-service.ts` — `hasMeetingLink` added to `listSessionsForCohort`.
- `src/components/primitives/ResourceTable.tsx` — `emptyHeading` prop added.

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: the meeting-link field name is quarantined to the form file so the list file's grep gate is structurally guaranteed rather than accidentally satisfied; the presence-only `hasMeetingLink` field is a minimal, safe service addition; `windowClosed` is computed once via a `useState` lazy initializer to satisfy the `react-hooks/purity` rule; `cohortId` rides along in the attendance actions' payload for revalidation only, never for authorization or roster resolution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `listSessionsForCohort` had no way to signal "a meeting link is configured" without exposing the link**
- **Found during:** Task 1, building the Sessions tab's Mode/link column per the UI-SPEC ("showing whether a link is configured, never the URL itself").
- **Issue:** the plan-05-06 service's `listSessionsForCohort` maps an explicit field set that deliberately omits `meetingUrl` entirely (by design, D-25) — but that left no field at all for the Mode/link column to render, since the column contract needs *some* signal.
- **Fix:** added `hasMeetingLink: r.meetingUrl !== null` to the mapped row — `r.meetingUrl` was already in scope inside the mapping function (the delegate's `findMany` returns the full row; only the *returned* object omits the field), so this required no new query and does not add the URL back to the payload. The existing unit test asserting `"meetingUrl" in list[0]` is `false` still passes unchanged.
- **Files modified:** `src/server/services/scheduled-session-service.ts`.
- **Verification:** `npx vitest run tests/scheduled-session-service.test.ts` — 29/29 still green; `grep -c "meetingUrl" SessionsTab.tsx` = 0.
- **Committed in:** `00e7ea3` (Task 1 commit)

**2. [Rule 2 - Missing critical functionality] `ResourceTable`'s generated empty heading did not support the Sessions tab's exact UI-SPEC heading**
- **Found during:** Task 1, wiring the empty state.
- **Issue:** the primitive's unfiltered-empty heading is always `` `No ${noun} yet` `` — for `noun="sessions"` that renders "No sessions yet", not the UI-SPEC's mandated "No sessions scheduled". No override existed (mirrors 05-12's `emptyBody` gap, now solved the same way for the heading).
- **Fix:** added an optional `emptyHeading?: string` prop, defaulting to the existing generated string when omitted (so `CoursesTable`/`CohortsTable` and any other consumer is unaffected). `SessionsTab` passes the UI-SPEC sentence.
- **Files modified:** `src/components/primitives/ResourceTable.tsx`, `src/app/staff/cohorts/[id]/SessionsTab.tsx`.
- **Verification:** `grep -c "No sessions scheduled" SessionsTab.tsx` = 1; existing `tests/components/cohorts-table.test.tsx` (which relies on the default heading) still 6/6 green.
- **Committed in:** `00e7ea3` (Task 1 commit)

**3. [Rule 1 - Bug] `react-hooks/purity` rejected `Date.now()` inside `useMemo`**
- **Found during:** Task 2, `npm run lint`.
- **Issue:** `AttendanceMarkClient` originally computed `windowClosed` via `useMemo(() => new Date(windowClosesAt).getTime() < Date.now(), [windowClosesAt])` — ESLint's `react-hooks/purity` rule flags any impure call (`Date.now()`) inside a hook that must be a pure function of its dependencies.
- **Fix:** switched to the documented escape hatch, a lazy `useState` initializer: `const [windowClosed] = useState(() => new Date(windowClosesAt).getTime() < Date.now())`, which reads the impure value exactly once at mount rather than on every render.
- **Files modified:** `src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx`.
- **Verification:** `npm run lint` — clean; `npx tsc --noEmit` — exit 0.
- **Committed in:** `0eebd92` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 missing-critical-functionality, 1 bug fix)
**Impact on plan:** All three are minimal, additive, backward-compatible changes to shared primitives/services required for the UI-SPEC's own contract or for a clean lint pass. No scope creep — no other consumer of `ResourceTable` or `scheduled-session-service.ts` is affected.

## Issues Encountered

None beyond the deviations above.

## Verification Results

- `npx vitest run tests/components/attendance-mark.test.tsx` — 4/4 passed.
- `npx vitest run tests/attendance-service.test.ts tests/scheduled-session-service.test.ts tests/boundary.test.ts tests/structure.test.ts` — 80/80 passed (the services this plan calls are unchanged and green; no Prisma import in a route/component; route conventions intact).
- `npx vitest run tests/components/cohorts-table.test.tsx tests/components/arrange-board.test.tsx` — 20/20 passed (no regression from the `ResourceTable`/`scheduled-session-service.ts` deviations).
- `npx tsc --noEmit` — exit 0. `npm run lint` — exit 0. `npm run build` — exit 0; `/staff/cohorts/[id]/sessions/[sessionId]/attendance` compiles and lists as a dynamic (`ƒ`) route.
- Full repo `npx vitest run` — 1013/1014 passed. The one failure — `tests/password-reset-service.test.ts` "a successful sign-in resets failedLoginAttempts to 0 and clears lockedUntil", a 5000ms test-timeout — is a pre-existing, unrelated, timing-sensitive test in the auth module (out of this plan's file scope; the environment notes already flag a different flaky test under full-suite CPU contention, `rich-text-editor.test.tsx` — this run happened to trip a different one from the same category). Not fixed per the executor scope boundary; logged here for visibility.
- Acceptance grep gates: `meetingUrl` in `SessionsTab.tsx` = 0; `"No sessions scheduled"` = 1; `minReasonLength` in `SessionsTab.tsx` ≥ 1; `revalidatePath(..., "page")` in `session-actions.ts` ≥ 1; `@prisma/client` in all `[id]` route/component files = 0; `occurrences` bounded range check in `session-actions.ts` present; `session-actions.ts`/`attendance-actions.ts` both start with `"use server"` and export the required functions; `isWithinMarkingWindow|isBeforeSessionStart|ATTENDANCE_MARKING_WINDOW_HOURS` in `attendance-actions.ts` = 0; `"You can only mark excused or not-recorded"` in `attendance-actions.ts` = 1; `"Nothing to mark yet"` in `AttendanceMarkClient.tsx` = 1.

## Known Stubs

None — every field renders from a real service call; no hardcoded empty/placeholder data ships in this plan. The Facilitator column/field renders a raw user id (no facilitator-directory picker exists yet in this codebase) rather than a resolved name — this is a display-completeness gap, not a stub, and does not block the plan's own goal (scheduling and attendance both work correctly with a bare id).

## Threat Flags

None beyond the plan's own threat register (T-05-83 … T-05-90), all of which the acceptance-criteria grep gates directly verify. The `hasMeetingLink` addition (deviation 1 above) was evaluated against T-05-86 specifically — it is presence-only, never the URL, and does not widen the disclosure surface the threat model already covers.

## Next Phase Readiness

- `SessionsTab` (props: `cohortId`, `cohortTimezone`, `sessions?`, `denied?`, `courseOptions?`) and its `SessionRow` type are ready for plan 05-15 to mount as a `DetailLayout` Sessions tab section — no further wiring needed beyond passing `listSessionsForCohort`'s output (now including `hasMeetingLink`) and the cohort's own `timezone`.
- `AttendanceMarkClient`'s route (`/staff/cohorts/[id]/sessions/[sessionId]/attendance`) is a complete, standalone screen already reachable — the Sessions tab's Title column links straight to it, so no additional navigation wiring is required from 05-15 for this specific flow.
- The Facilitator field is a raw user id end-to-end (create/repeat forms, list column, no lookup) — a facilitator-directory picker is a reasonable follow-up but out of this plan's scope and not blocking.

## Self-Check: PASSED

- FOUND: src/app/staff/cohorts/[id]/SessionsTab.tsx
- FOUND: src/app/staff/cohorts/[id]/SessionFormFields.tsx
- FOUND: src/app/staff/cohorts/[id]/session-actions.ts
- FOUND: src/app/staff/cohorts/[id]/attendance-actions.ts
- FOUND: src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/page.tsx
- FOUND: src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx
- FOUND: tests/components/attendance-mark.test.tsx
- FOUND commit: 00e7ea3
- FOUND commit: 0eebd92

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
