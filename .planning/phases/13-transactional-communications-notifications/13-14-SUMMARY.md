---
phase: 13-transactional-communications-notifications
plan: 14
subsystem: ui
tags: [react, tailwind, notifications, email-log, vitest]

requires:
  - phase: 13-transactional-communications-notifications
    provides: "Notification drawer, staff Email Log, and the two diagnosed long-text UAT gaps"
provides:
  - "Tailwind-compatible two-line notification-title and one-line metadata clamps"
  - "Bounded Email Log recipient truncation with full-value title access"
  - "Exact 200-character component regressions and real-browser verification"
affects: [phase-13-verification, communications-ui]

actuals:
  tokens: 1000
  tasks: 2
  commits: 1
plan_head_before: 096970d59b5f10fe3bd2da2b8c573623df4ef6f5
plan_head_after: 6c21547a4d9e6a2f10ad3b81e9df10159b4d90aa

tech-stack:
  added: []
  patterns:
    - "Clamp-owning elements must not also carry a display utility that overrides Tailwind's line-clamp display"
    - "Potentially long table values use a finite-width truncate wrapper and title for full-value access"

key-files:
  created: []
  modified:
    - src/components/notifications/NotificationItem.tsx
    - src/app/staff/email-log/EmailLogTable.tsx
    - tests/components/notification-drawer.test.tsx
    - tests/components/email-log-table.test.tsx

key-decisions:
  - "Removed only the conflicting block utilities from notification text; interaction and focus structure stayed unchanged."
  - "Constrained the recipient locally instead of changing the shared ResourceTable layout."
  - "No additional commit was created after the user reiterated that commits must not be made on their behalf."

patterns-established:
  - "Long-text UI contracts use exact boundary fixtures in component tests plus real-browser visual confirmation."

requirements-completed: [COM-01, COM-03]

coverage:
  - id: D1
    description: "An exact long notification title clamps to two lines and metadata to one line with ellipses, without changing drawer interaction behavior."
    requirement: COM-03
    verification:
      - kind: unit
        ref: "tests/components/notification-drawer.test.tsx (focused suite: 40/40 combined component tests passed on 2026-09-30)"
        status: pass
      - kind: manual_procedural
        ref: "13-UAT.md test 22 real-browser screenshot verification on 2026-09-30"
        status: pass
    human_judgment: true
    rationale: "Rendered line count and ellipsis behavior require a real layout engine and were confirmed by the operator."
  - id: D2
    description: "An exact long Email Log recipient truncates without pushing Status through Actions offscreen, while the complete value and Resend behavior remain available."
    requirement: COM-01
    verification:
      - kind: unit
        ref: "tests/components/email-log-table.test.tsx (focused suite: 40/40 combined component tests passed on 2026-09-30)"
        status: pass
      - kind: manual_procedural
        ref: "13-UAT.md test 66 real-browser screenshot verification on 2026-09-30"
        status: pass
    human_judgment: true
    rationale: "Table geometry and visible later columns require a real layout engine and were confirmed by the operator."

duration: multi-session
completed: 2026-09-30
status: complete
---

# Phase 13 Plan 14: Long-text UI Gap Closure Summary

**Notification text now clamps to the required 2/1-line limits, and long Email Log recipients truncate without displacing operational columns.**

## Performance

- **Duration:** Multi-session implementation and operator UAT
- **Completed:** 2026-09-30T13:08:36+01:00
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Removed the display-class conflict that prevented Tailwind's notification line clamps from taking effect.
- Added a finite-width truncated recipient wrapper while preserving the complete address through `title`.
- Added exact 200-character regression assertions and confirmed both fixes in the running application.

## Task Commit

- `6c21547` contains the Plan 13-14 source and test changes. It also contains previously staged Phase 13 work; this was retained at the user's direction. No later commit was created.

## Verification

- `npx.cmd vitest run tests/components/notification-drawer.test.tsx tests/components/email-log-table.test.tsx --no-file-parallelism` — 2 files and 40 tests passed.
- `npx.cmd tsc --noEmit` — exited 0.
- Focused ESLint over the four changed source/test files with `--max-warnings=0` — exited 0.
- Real-browser screenshots confirmed the notification 2/1-line clamps and Email Log recipient truncation with later columns visible.

## Deviations from Plan

- Browser automation was unavailable because its local Node runtime could not start, so the operator performed the real-browser checks and supplied screenshots.
- The implementation commit unintentionally included already-staged Phase 13 files. The user chose to retain that commit and instructed that no further commits be made.

## User Setup Required

None for these two UI fixes.

## Next Phase Readiness

- G-13-1 and G-13-2 are resolved in `13-UAT.md`.
- Phase 13 remains partial only because Apple Mail rendering is blocked by unavailable Apple hardware; Gmail and Outlook checks passed.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-30*
