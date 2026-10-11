---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 08
subsystem: ui
tags: [react, nextjs, unstable_rethrow, server-actions, vitest, jsdom, reliability]

requires:
  - phase: 04.1
    provides: "try/catch/finally rejection-recovery shape in the arrange and lesson-editor clients (04.1-32 gap wave)"
provides:
  - "Guarded ArrangeClient.handleRestore (try/catch/finally, in-flight ref guard, generic retryable error, failure shown on the owning board)"
  - "unstable_rethrow as the first statement of every catch in ArrangeClient (5), ProgrammeArrangeClient (3), LessonEditorClient (1) and ModuleComposer (2)"
  - "LessonEditorClient.confirmWithdraw releases the modal on success before router.push, and clears withdrawing in finally"
  - "tests/components/control-flow-helpers.ts: real Next.js redirect/notFound errors plus an unhandled-rejection capture for pass-through tests"
affects: [staff catalogue arrange screen, programme arrange screen, lesson editor, 04.1 follow-up todo]

actuals:
  tokens: 5344
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Client mutation catch blocks call unstable_rethrow(error) first, then show the generic, non-interpolating retryable error; cleanup lives in finally"
    - "Pass-through tests use the real unstable_rethrow behind a spy and capture the propagated rejection instead of only asserting a mock call"

key-files:
  created:
    - tests/components/control-flow-helpers.ts
  modified:
    - src/app/staff/courses/[id]/arrange/ArrangeClient.tsx
    - src/app/staff/courses/[id]/arrange/ModuleComposer.tsx
    - src/app/staff/programmes/[id]/arrange/ProgrammeArrangeClient.tsx
    - src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx
    - tests/components/arrange-client.test.tsx
    - tests/components/programme-arrange-client.test.tsx
    - tests/components/lesson-editor-client.test.tsx

key-decisions:
  - "handleRestore's in-flight flag is a useRef guard inside ArrangeClient, not a disabled prop, because the Restore button lives in the shared ArrangeBoard component, which this plan does not own"
  - "A resolved { ok: false } restore shows the action's own server-written message (as the sibling save, add and rename handlers do); only a rejection shows the generic 'Nothing was changed — try again' text"
  - "ModuleComposer also gets unstable_rethrow, because its catch blocks sit above handleAddModule and handleRenameModule and would otherwise swallow the redirect those handlers now rethrow"

patterns-established:
  - "Control-flow pass-through: catch (error) { unstable_rethrow(error); ...generic error... } finally { ...release busy state... }"

requirements-completed: [NFR-03, NFR-14]

coverage:
  - id: D1
    description: "A rejected, failed or successful restore of a withdrawn module or lesson leaves the arrange screen retryable and truthful (WR-01)"
    requirement: NFR-03
    verification:
      - kind: automated_ui
        ref: "tests/components/arrange-client.test.tsx#ArrangeClient — restoring a withdrawn item"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every catch block in the three clients (plus ModuleComposer) passes Next.js redirect/notFound through instead of showing a generic error (WR-02)"
    requirement: NFR-14
    verification:
      - kind: automated_ui
        ref: "tests/components/arrange-client.test.tsx#ArrangeClient — framework control flow passes through every catch"
        status: pass
      - kind: automated_ui
        ref: "tests/components/programme-arrange-client.test.tsx#ProgrammeArrangeClient — framework control flow passes through every catch"
        status: pass
      - kind: automated_ui
        ref: "tests/components/lesson-editor-client.test.tsx#LessonEditorClient withdraw — success releases the modal (WR-03) and control flow passes through (WR-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A successful lesson withdraw closes the modal even when router.push stalls (WR-03)"
    requirement: NFR-03
    verification:
      - kind: automated_ui
        ref: "tests/components/lesson-editor-client.test.tsx#closes the modal after a successful withdraw even if router.push never completes"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-10-07
status: complete
---

# Phase 15 Plan 08: Latent async-mutation warnings (04.1-REVIEW-2) Summary

**Restore on the course arrange screen now recovers from failures. Every staff catalogue mutation catch hands Next.js redirect and notFound back to the framework through `unstable_rethrow`. A successful lesson withdraw closes its modal before navigating. Each fix has a regression test that failed before the fix.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-07T14:20:45Z
- **Completed:** 2026-10-07T14:34:07Z
- **Tasks:** 2 of 2
- **Files modified:** 8 (4 source, 3 tests, 1 new test helper)

## Accomplishments

- **WR-01:** `handleRestore` now uses the sibling shape. A ref guard blocks a second click while a restore is in flight. A rejection shows "Something went wrong restoring that module/lesson. Nothing was changed — try again." on the board that owns the item and never echoes the caught value. A resolved `{ ok: false }` shows the action's own message and does not refresh. The guard is always released in `finally`.
- **WR-02:** each of the 9 catch blocks in the three clients (8 that existed before, plus the new restore catch) now binds `error` and calls `unstable_rethrow(error)` first. ModuleComposer's 2 catch blocks got the same change. A redirect or notFound thrown through an awaited action reaches the framework, and `finally` still releases the busy state.
- **WR-03:** after a successful withdraw, `confirmWithdraw` clears `withdrawing` and `withdrawOpen` before `router.push`. `withdrawing` is also cleared in `finally`, so neither a stalled push nor a rethrown redirect can leave the modal stuck on "Working…".

## Task Commits

1. **Task 1 (tracer): a rejected restore recovers with the generic retryable error.** Not committed (the owner makes commits). RED: the rejection case failed with an unhandled `socket-detail` rejection and no alert. GREEN: 6/6 passed. Tracer gate: the verify step is automated only and the mode is end-of-phase, so I re-ran it (6/6 passed) and moved on to Task 2.
2. **Task 2 (tdd): control-flow pass-through in every catch, plus the withdraw success path.** Not committed (the owner makes commits). RED: 6 failures in arrange-client, 4 in programme-arrange-client and 3 in lesson-editor-client. GREEN: all three files pass.

**Plan metadata:** not committed (the owner makes commits).

## Files Created/Modified

- `src/app/staff/courses/[id]/arrange/ArrangeClient.tsx`: guarded `handleRestore`, `unstable_rethrow` in all 5 catch blocks
- `src/app/staff/courses/[id]/arrange/ModuleComposer.tsx`: `unstable_rethrow` in both catch blocks (see deviation 1)
- `src/app/staff/programmes/[id]/arrange/ProgrammeArrangeClient.tsx`: `unstable_rethrow` in all 3 catch blocks
- `src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx`: `confirmWithdraw` releases the modal on success, clears `withdrawing` in `finally`, and calls `unstable_rethrow` first in its catch
- `tests/components/control-flow-helpers.ts` (new): builds real redirect/notFound errors via `vi.importActual("next/navigation")`, and `captureUnhandledRejection` swaps out Vitest's listener for one trigger, then restores it
- `tests/components/arrange-client.test.tsx`: 4 restore cases and 6 control-flow cases (module save, lesson save, restore, add, rename, plus an app error going through the spy)
- `tests/components/programme-arrange-client.test.tsx`: 4 control-flow cases (save, add, remove with notFound, plus an app error)
- `tests/components/lesson-editor-client.test.tsx`: stalled-push success case, redirect pass-through, and an app error that stays retryable

## Decisions Made

See key-decisions in the frontmatter. In short: the guard lives in the client because ArrangeBoard is a shared catalogue component; `{ ok: false }` follows the sibling handlers and shows the server's message; ModuleComposer was included so the add/rename rethrow is not swallowed one level up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `unstable_rethrow` added to ModuleComposer's two catch blocks**
- **Found during:** Task 2
- **Issue:** `handleAddModule` and `handleRenameModule` in ArrangeClient return their result to ModuleComposer, which awaits them inside its own bare `catch {}`. With only the plan's files changed, a rethrown redirect from add or rename would still be swallowed there and turned into "That module could not be added". WR-02 would not have been met for those two handlers.
- **Fix:** the same `catch (error) { unstable_rethrow(error); ... }` change in `ModuleComposer.tsx`. It is a feature component in the same arrange folder, not a co-worker-owned primitive. The existing `module-composer.test.tsx` still passes.
- **Files modified:** `src/app/staff/courses/[id]/arrange/ModuleComposer.tsx`
- **Verification:** the arrange-client cases "a redirect thrown through add-module reaches the framework past the composer" and "a redirect thrown through rename-module…" pass.
- **Commit:** not committed (the owner makes commits)

**2. [Rule 3 - Blocking] New shared test helper `tests/components/control-flow-helpers.ts`**
- **Found during:** Task 2
- **Issue:** a rethrow from a React event handler surfaces as an unhandled promise rejection, and Vitest fails the run on those. Proving real propagation in all three test files needed a reusable capture and genuine Next.js error objects.
- **Fix:** a small helper module that is not a test file, so the `*.test.tsx` include pattern does not pick it up.
- **Commit:** not committed (the owner makes commits)

### Interpretation notes

- The plan text says "five guarded sibling handlers". ArrangeClient actually had four (two saves, add, rename). All four, plus restore, now follow the shape.
- The plan says "the restore control is enabled again". ArrangeBoard's Restore button has no disabled state, and changing that component is outside this plan. The in-flight state is a ref guard in ArrangeClient. The tests prove a duplicate click during flight is ignored and that a retry after failure runs.

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking). **Impact:** both are needed for WR-02 to hold end to end, and the scope stays within the staff arrange feature.

## Issues Encountered

None.

## Verification

- `npx vitest run tests/components/arrange-client.test.tsx tests/components/programme-arrange-client.test.tsx tests/components/lesson-editor-client.test.tsx`: passed (12 + 7 + 8 tests)
- Related suites also run: `module-composer`, `arrange-board`, `tests/arrange-page-route.test.ts`, `tests/licence-ui-mirror-gate.test.ts`, `tests/unit/design-contract.test.ts`. Combined with the three above: 8 files, 162 tests, all passed, no unhandled errors.
- Acceptance greps: no bare `catch {` remains in the three files or in ModuleComposer. `unstable_rethrow(` counts: ArrangeClient 5 (needs 5 or more), ProgrammeArrangeClient 3 (needs 3 or more), LessonEditorClient 1 (needs 1 or more). `handleRestore` contains try, catch and finally.
- `npx tsc --noEmit`: 0 errors. `npx eslint` on the 8 touched files: clean.
- No database, network or external sends were involved (component tests only).

## Owner follow-ups

- The folded todo `.planning/todos/pending/2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` can now be closed. The plan does not tell me to move it, so it is still in `pending/`.
- Nothing is committed. The working tree changes are listed under key-files.
- Requirements: `requirements.ready-ids <plan> NFR-03,NFR-14` returned `ready: []` and `blocked: [NFR-03, NFR-14]`, because sibling Phase 15 plans that also declare them have no SUMMARY yet. So neither is marked complete in REQUIREMENTS.md. They become ready when the last plan declaring them finishes.
- Tracking: STATE.md and ROADMAP.md were updated through gsd_run (advance-plan, record-metric, add-decision, record-session, roadmap.update-plan-progress gave 6 of 33 summaries, In Progress). `state.update-progress` skipped with "phase scope is unscoped, not complete". `state.advance-plan` was called twice by mistake (6 to 7, then 7 to 8). The final "Plan: 8 of 33" matches this plan's number. That counter is the known stale, unlabelled counter noted in STATE.md, so I did not hand-edit it.

## Next Phase Readiness

The 04.1-REVIEW-2 warnings WR-01, WR-02 and WR-03 are closed. No blockers. No schema migration, so nothing to add to the Neon go-live list.

## Self-Check: PASSED

- FOUND: tests/components/control-flow-helpers.ts
- FOUND (modified): all 7 files listed under key-files.modified (`git status` shows `M`)
- Commits: none expected (the owner makes commits)
- Acceptance criteria and plan verification re-run: all pass
