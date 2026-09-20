---
phase: 09-learning-delivery-progress-tracking
plan: 08
subsystem: ui
tags: [nextjs, react-server-components, tailwind, lucide-react, learner-dashboard]

# Dependency graph
requires:
  - phase: 09-learning-delivery-progress-tracking (plan 07)
    provides: loadLearnerDashboard aggregate read, LearnerDashboardCard shape, DD-5 deriveNextAction
provides:
  - "(learner) route group layout (session guard + LearnerShell mount, three-item nav)"
  - "/dashboard page rendering every LRN-01 slot"
  - "ProgressMeter, DeferredSlot, NextUpCard reusable learner presentational components"
  - "cohortTitle/timezone fields added to LearnerDashboardCard"
affects: [09-09, 09-10, 09-11, 09-12, 09-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared avatar-display helper (src/lib/avatar-display.ts) extracted from account/layout.tsx so two learner-facing shells cannot drift on initials logic"
    - "Bordered-track + adjacent-text-caption composition for --teal-fill (first real draw of the 04.1 teal progress role)"
    - "Server Component page invoked directly + renderToStaticMarkup for markup-string test assertions (tests/learner-dashboard-page.test.ts), extending the existing invoke-page-directly convention (arrange-page-route.test.ts, lesson-preview-route.test.ts) to full HTML-content checks"

key-files:
  created:
    - "src/app/(learner)/layout.tsx"
    - "src/app/(learner)/dashboard/page.tsx"
    - "src/lib/avatar-display.ts"
    - "src/components/learner/ProgressMeter.tsx"
    - "src/components/learner/DeferredSlot.tsx"
    - "src/components/learner/NextUpCard.tsx"
    - "tests/learner-dashboard-page.test.ts"
  modified:
    - "src/app/account/layout.tsx"
    - "src/server/services/enrolment-dashboard-service.ts"

key-decisions:
  - "Added cohortTitle and timezone fields to LearnerDashboardCard (09-07's return shape) since Task 3 requires heading each section with the offer/cohort title and formatting every date in the cohort's IANA zone, and neither existed on the card"
  - "NextUpCard's signature grew a required timezone prop beyond the plan's two-prop sketch, since its session variant's formatted date/time needs the cohort zone"
  - "Session mode icon rendering (MapPin/Video) is written exhaustively over the type's three variants even though deriveSessionMode (09-07) can currently only ever produce in-person or unknown, never virtual — never fabricating a virtual guess from a service that structurally cannot tell"

patterns-established:
  - "DeferredSlot's four dashboard call sites pass title + the exact UI-SPEC 6.1 copy string as separate fields, mirroring RosterTab's DeferredCell tone but as a standalone card rather than a table cell"

requirements-completed: [LRN-01]

duration: ~35min
completed: 2026-09-15
---

# Phase 9 Plan 08: Learner Shell and /dashboard Summary

**The `(learner)` route-group layout and `/dashboard` page ship LRN-01 end to end: next action, two independent progress bars, upcoming sessions, four named-gap forward slots, and an access-window warning, all reading `loadLearnerDashboard` and rendering the 04.1 design system's first real teal progress bar.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments
- `src/app/(learner)/layout.tsx`: one session guard + `LearnerShell` mount shared by `/dashboard` and the future `/learn/*` routes (DD-7), with a shared `deriveAvatarDisplay` helper extracted so `account/layout.tsx` and this layout cannot drift on initials logic
- `ProgressMeter`, `DeferredSlot`, `NextUpCard`: three token-only Server Components; `ProgressMeter` is the first component in the codebase to actually draw `--teal-fill`, always inside a bordered track with an adjacent `--teal-text` caption per UI-SPEC's contrast mitigation
- `/dashboard` page: renders one section per own ACTIVE enrolment — next action, "Your progress" (with a second independent attendance bar when a threshold applies, never merged into one composite percentage), "Upcoming sessions" (never reading/rendering a meeting link), the four named-gap slots, and the ending/ended access-window notices in `--warning` tone

## Task Commits

Each task was committed atomically:

1. **Task 1: The (learner) route group layout** - `341a8c4` (feat)
2. **Task 2: ProgressMeter, DeferredSlot and NextUpCard presentational components** - `b5fdac4` (feat)
3. **Task 3: The /dashboard page** - `6014119` (feat)

_Note: Task 3's commit also includes the required enrolment-dashboard-service.ts field addition — see Deviations below._

## Files Created/Modified
- `src/app/(learner)/layout.tsx` - session guard + LearnerShell mount, three-item nav (Dashboard/Catalogue/Account)
- `src/lib/avatar-display.ts` - shared avatar-initials derivation, imported by both learner shells
- `src/app/account/layout.tsx` - now imports the shared helper instead of defining its own copy
- `src/components/learner/ProgressMeter.tsx` - bordered teal track + adjacent caption, role=progressbar
- `src/components/learner/DeferredSlot.tsx` - muted, non-interactive named-gap card
- `src/components/learner/NextUpCard.tsx` - the four-variant DD-5 next-action card
- `src/app/(learner)/dashboard/page.tsx` - the LRN-01 dashboard
- `src/server/services/enrolment-dashboard-service.ts` - added `cohortTitle`/`timezone` to `LearnerDashboardCard`
- `tests/learner-dashboard-page.test.ts` - 10 render-markup test cases

## Decisions Made
- `deriveAvatarDisplay` moved to `src/lib/avatar-display.ts` rather than duplicated, per the plan's explicit instruction — the only edit to `account/layout.tsx` is importing it
- Dates formatted with `utcToWallParts(...).label` against each card's `timezone`, matching the existing `scheduled-session-service.ts` convention — no `toLocaleString`/`toLocaleDateString` anywhere in the new page
- Test file (`tests/learner-dashboard-page.test.ts`) invokes the Server Component page function directly (no dynamic-route params) and renders its returned element with `react-dom/server`'s `renderToStaticMarkup` under Vitest's "node" project (no jsdom) — extends the codebase's existing "invoke page directly" pattern (`arrange-page-route.test.ts`, `lesson-preview-route.test.ts`) to real markup-string assertions, since this plan's acceptance criteria need progressbar counts and link-content checks that direct-element inspection alone can't answer. `next/link` is mocked to a plain anchor (no app-router context exists in this harness).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `cohortTitle`/`timezone` to `LearnerDashboardCard`**
- **Found during:** Task 3 (the `/dashboard` page)
- **Issue:** The plan's `<interfaces>` block describes the card as carrying `cohortTitle, offerTitle`, and Task 3's action text requires heading each section with "the offer/cohort title" and formatting all session/access dates against the cohort's IANA timezone — but 09-07's actual `LearnerDashboardCard` type (verified by reading `enrolment-dashboard-service.ts` and its test file) carried neither a title nor a timezone field at all. The page could not be written as specified without one of these.
- **Fix:** Added `cohortTitle: string` and `timezone: string` to `LearnerDashboardCard`, populated from `enrolment.cohort.title` / `enrolment.cohort.timezone` (data `buildCardContext` already loads via `OwnEnrolmentSnapshot`, so no new store read was added). Matches the existing `offerTitle: r.cohort.title` naming precedent in `roster-service.ts` (same single concept, no separate "offer" entity exists).
- **Files modified:** `src/server/services/enrolment-dashboard-service.ts`
- **Verification:** `tests/enrolment-dashboard-service.test.ts` (39 cases, no whole-card equality assertions) passes unchanged; `npx tsc --noEmit` clean.
- **Committed in:** `6014119` (Task 3 commit)

**2. [Rule 3 - Blocking] Extended `NextUpCard`'s signature with a `timezone` prop**
- **Found during:** Task 2/3 (NextUpCard's `session` variant)
- **Issue:** The plan's action text sketches `NextUpCard({ action, enrolmentId })`, but the `session` variant's required copy — "{Session title} — {formatted date/time}" — cannot be produced without knowing the cohort's IANA zone, and Task 3 explicitly forbids the server's local zone.
- **Fix:** Added a required `timezone: string` prop, read only by the `session` branch, using the same `utcToWallParts(...).label` convention already established in `scheduled-session-service.ts`.
- **Files modified:** `src/components/learner/NextUpCard.tsx`, `src/app/(learner)/dashboard/page.tsx` (passes `card.timezone`)
- **Verification:** `tests/learner-dashboard-page.test.ts`'s lesson/session-variant cases pass; no raw-hex/eslint/tsc regressions.
- **Committed in:** `b5fdac4` (component) / `6014119` (call site)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking issues; both are narrow, additive field/prop extensions to an already-loaded data path, not new tables, new services, or new store reads)
**Impact on plan:** Both fixes were required for Task 3 to be completable at all as specified (a title-less section heading and un-zoned dates would themselves have been correctness bugs). No scope creep — no new database reads, no new external calls.

## Issues Encountered

- `npx next build` could not be run to completion in this worktree: Turbopack reported `Could not find the Next.js package (next/package.json)` because this worktree's `node_modules` is effectively empty (1KB, no `next`, no `stripe`) — the same pre-existing sandbox gap already documented in `STATE.md` for other plans (Docker unavailable, `stripe` module missing under `npx tsc --noEmit`). `npx tsc --noEmit`, `npx eslint`, and `npx vitest` all resolve dependencies from an ancestor `node_modules` and ran cleanly; only Turbopack's stricter workspace-root detection is affected. Not fixable via Rule 3 (package-manager installs are explicitly excluded from auto-fix) and not caused by this plan's changes — `git diff src/components/shell/LearnerShell.tsx src/app/globals.css` remains empty and no other file outside this plan's stated `files_modified` was touched. Deferred to whichever environment has a fully installed `node_modules` for this worktree.

## Known Stubs

None. The four `DeferredSlot` cards are the plan's own intentional, explicitly-labelled forward gaps (Phase 10/11/12), not undocumented stubs — each links to no route, has no data source to wire, and is called out in the plan's own `<threat_model>` (T-09-32).

## Threat Flags

None. All new surface (the `/dashboard` route, the upcoming-sessions card, the layout guard) is exactly what the plan's `<threat_model>` already covers (T-09-01, T-09-04, T-09-31, T-09-32) — no new endpoint, auth path, or schema change was introduced beyond it.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `/dashboard` is live and ready for `/learn/[enrolmentId]` (09-09) and `/learn/[enrolmentId]/sessions` (09-10+) to link into from the "Continue learning" CTA and "View all" session link, both already wired to those future route shapes.
- `LearnerDashboardCard.cohortTitle`/`.timezone` are now available to any later plan in this phase that also needs them (e.g. the lesson-list page's own course-level progress bar).
- `npx next build`'s full production-build gate remains unverified in this sandbox (see Issues Encountered) — needs confirming in an environment with a complete `node_modules` before this plan can be considered fully UAT-closed.

## Self-Check: PASSED

All 7 created files confirmed present on disk (`src/app/(learner)/layout.tsx`,
`src/app/(learner)/dashboard/page.tsx`, `src/lib/avatar-display.ts`,
`src/components/learner/ProgressMeter.tsx`, `src/components/learner/DeferredSlot.tsx`,
`src/components/learner/NextUpCard.tsx`, `tests/learner-dashboard-page.test.ts`).
All 3 task commits confirmed in `git log` (`341a8c4`, `b5fdac4`, `6014119`).

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-15*
