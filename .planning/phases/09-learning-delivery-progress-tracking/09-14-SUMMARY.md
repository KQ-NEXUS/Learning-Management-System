---
phase: 09-learning-delivery-progress-tracking
plan: 14
subsystem: testing
tags: [vitest, testcontainers, typescript-compiler-api, human-verify]

requires:
  - phase: 09-learning-delivery-progress-tracking
    provides: every service and route built across Waves 1-8 (09-01 through 09-13)
provides:
  - Eight compiler-API architectural invariants for this phase, enforced as an executable test
  - Real-Postgres end-to-end proof of LRN-01 through LRN-07
  - Human-verified walkthrough of the learner and staff surfaces, with a real production bug found and fixed
affects: [any future phase adding a course/module/lesson to a programme cohort — the position-collision class of bug this plan fixed is worth re-checking if lesson.position semantics change again]

tech-stack:
  added: []
  patterns:
    - "Compiler-API invariant tests (tests/learning-phase-invariants.test.ts) modelled on tests/checkout-phase-invariants.test.ts, reusing tests/import-graph.ts's extracted traversal rather than a third copy"
    - "Real-Postgres integration tests via Testcontainers, one narrative journey plus isolated authorization assertions"

key-files:
  created:
    - tests/learning-phase-invariants.test.ts
    - tests/import-graph.ts
    - tests/learner-journey.integration.test.ts
  modified:
    - tests/boundary.test.ts
    - src/server/services/learner-access.ts
    - tests/learner-access.test.ts

key-decisions:
  - "Extracted tests/boundary.test.ts's import-walking helpers into tests/import-graph.ts (a plain module, not *.test.ts) rather than importing boundary.test.ts directly — a literal import of one .test.ts file from another re-executes its describe/it registrations"
  - "Task 3's human walkthrough surfaced a real production bug (module-position collision in loadLearnerPath's sequencing offset) — fixed at the root (learner-access.ts) with a TDD regression test, not worked around in the checkpoint"

patterns-established:
  - "Pattern: when a global sequencing offset combines multiple nesting levels (course, module, lesson), every level needs its own stride — collapsing two levels into one stride silently reintroduces collisions"

requirements-completed: [LRN-01, LRN-02, LRN-03, LRN-04, LRN-05, LRN-06, LRN-07]

duration: ~6h (including the human walkthrough round-trip and bug investigation)
completed: 2026-09-15
---

# Phase 09 Plan 14: Invariants, Integration Proof & Human Walkthrough Summary

**Eight architectural invariants locked in as tests, LRN-01 through LRN-07 proven against real Postgres, and a real multi-module lesson-locking bug found and fixed during the human walkthrough**

## Performance

- **Duration:** ~6h total (Tasks 1-2 automated: ~35 min; Task 3 human walkthrough plus investigation and fix: the remainder)
- **Tasks:** 3/3 complete
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `tests/learning-phase-invariants.test.ts` — 8 compiler-API tests (INV-1 through INV-8) covering pure-module import-freedom, ownership services never importing `withPermission`, DD-6's `Enrolment.status` protection, `meetingUrl` gating outside `SessionCard.tsx`, the zero-client-JS guarantee on `LessonContent`/`LessonMediaPlayer`, zero raw hex outside `globals.css`, the historical `DomainEventType` member set, and Server Action `"use server"` + no-`userId`-from-formData discipline
- `tests/learner-journey.integration.test.ts` — a real-Postgres (Testcontainers) narrative proving sequencing/lock state, idempotent double-mark, free undo + re-lock, video 90% auto-completion, attendance-gated completion with a real supersede-then-resatisfy `CompletionRecord` cycle, a direct DD-6 `Enrolment.status` read-back, the LRN-03 ownership predicate, LRN-06 meeting-link visibility, and LRN-01/T-09-01 cross-learner isolation (37 assertions)
- Full ten-step human walkthrough performed against the live dev app and real seed data, surfacing and resolving three distinct issues (below) — not rubber-stamped

## Task Commits

1. **Task 1: Phase invariants test** - `88050cd` (feat)
2. **Task 2: Real-Postgres learner journey integration test** - `491dbd9` (feat)
3. **Task 3 follow-up: module-position sequencing fix** - `f7b0564` (fix, found during the walkthrough)

**Plan metadata:** (this commit)

## Files Created/Modified
- `tests/learning-phase-invariants.test.ts` - the 8 architectural invariants
- `tests/import-graph.ts` - extracted import-walking traversal, shared by `boundary.test.ts` and the new invariants file
- `tests/boundary.test.ts` - re-exports its traversal from `import-graph.ts` instead of a second copy; its own 14 tests unchanged
- `tests/learner-journey.integration.test.ts` - the real-Postgres end-to-end proof
- `src/server/services/learner-access.ts` - `MODULE_POSITION_STRIDE` added; `loadLearnerPath`'s flattening now offsets by module index as well as course index
- `tests/learner-access.test.ts` - regression test for the module-position collision, using ids deliberately chosen to sort the wrong way

## Decisions Made
See `key-decisions` above. The most consequential: Task 3's checkpoint is designed to catch exactly what automated fixture-based tests structurally cannot (per its own `<what-built>` framing) — it did, on the first real multi-module course it was pointed at.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tests/boundary.test.ts` describe/it re-execution when imported directly**
- **Found during:** Task 1
- **Issue:** The plan's literal instruction was to import `boundary.test.ts`'s helpers directly if exported. Doing so re-executes that file's own `describe`/`it` registrations inside the new test file's run (14 extra tests leaking in).
- **Fix:** Extracted the traversal into `tests/import-graph.ts` (a plain module, not matching the `*.test.ts` glob); both spec files import from it.
- **Verification:** `tests/boundary.test.ts` still passes all 14 of its own tests unchanged; `tests/learning-phase-invariants.test.ts` runs exactly 8 tests, no leakage.
- **Committed in:** `88050cd`

**2. [Real production bug, found via Task 3's human walkthrough] Module-position collision in `loadLearnerPath`'s global sequencing offset**
- **Found during:** Task 3, step 1 (dashboard "Next up" showed no action despite a real accessible incomplete lesson) and step 2/3 investigation
- **Issue:** `loadLearnerPath` flattened a course's lessons into one global sequence via `courseIndex * COURSE_POSITION_STRIDE + lesson.position`, but `lesson.position` is module-LOCAL — every module's own lessons restart at 0. Any course with more than one module (i.e. nearly every real course) collided module-1-position-0 with module-2-position-0 in the global walk. `evaluateLessonSequencing`'s position-then-id tiebreak then sorted the colliding lessons by lesson id string, which can and did put a later module's lesson ahead of an earlier module's incomplete required blocker — showing it as unlocked when it should have been locked, and hiding the true next action.
- **Why automated tests missed it:** every existing fixture in `tests/learner-access.test.ts` used either a single module per course, or sequential test ids (`"lesson-1"`/`"lesson-2"`) that happen to sort correctly regardless of the collision. The real seed data's cuid-generated ids do not have that luck.
- **Fix:** Added `MODULE_POSITION_STRIDE` and offset by the module's index within `courseEntry.modules` (already sorted by pinned position) in addition to `courseIndex`, in `src/server/services/learner-access.ts`.
- **Verification (TDD):** New regression test in `tests/learner-access.test.ts` uses lesson ids chosen to sort the wrong way on purpose — confirmed RED against the old code (`expected false to be true`), confirmed GREEN after the fix. Re-ran the full affected suite (184 tests across `learner-access`, `enrolment-dashboard-service`, `lesson-progress-service`, `learning-phase-invariants`, `boundary`, `learner-lesson-page`, `learner-lesson-list-page`, `video-watch-tracker`) plus the real-Postgres integration test (2/2) — all green. Re-verified directly against Tunde Bello's live dev-database enrolment: `nextAction` now correctly resolves to the true next required lesson instead of `{kind:"none"}`.
- **Committed in:** `f7b0564`

---

**Total deviations:** 2 (1 auto-fixed per Rule 3, 1 real bug found and fixed via TDD during the human checkpoint)
**Impact on plan:** The second item is the most significant finding of this entire phase — it affects LRN-02's core lock/unlock guarantee for any course with more than one module. Caught exactly where the plan intended it to be caught (the human walkthrough), not shipped silently.

## Issues Encountered

Beyond the bug above, the human walkthrough surfaced two **environment/data** issues that are not Phase 9 code defects, both traced to root cause and resolved before completing the walkthrough:

1. **Stale `.next` build cache** (`.next/BUILD_ID` dated Sep 10, predating the `sessions/page.tsx` (09-10) and staff `learners/[enrolmentId]/page.tsx` (09-13) routes added Sep 14-15). Caused two false 404s on otherwise-correct, otherwise-valid URLs. Resolved by deleting `.next` and restarting `npm run dev`.
2. **No cohort in this dev database had ever been published/pinned** (`coursePublicationId`/`programmePublicationId` null on every cohort — a Phase 4/5 seed-data gap, not a Phase 9 regression). Resolved by publishing both courses in Tunde's programme ("Workplace Safety Essentials" and "Incident Investigation") through the real staff publish workflow (`/staff/courses/{id}`) and migrating his cohort. Amara's cohort (March) was not offered by either course's migration dialog and remains unpinned — logged as an outstanding data-health item, out of scope for this plan to chase further.

## Human Walkthrough — Per-Step Outcome

| # | Step | Outcome |
|---|------|---------|
| 1 | `/dashboard` — Next up card, progress bar styling | **Fix applied, verified by automated tests + a direct data check by the executor; NOT independently re-confirmed by the developer in the browser.** The developer's own observation (no action shown) was made *before* the sequencing fix and has not been re-checked against the fixed code. Progress-bar visual styling was never checked at all. Recorded as outstanding human verification, not a pass. |
| 2 | Backstop A — long-title wrap | **Human-needed escalation** — no lesson with a long title exists anywhere in the seed data; cannot be exercised without adding a fixture. |
| 3 | Backstop B — overflow at highest lesson count | **Human-needed escalation** — the plan's "14 of 14" was illustrative; the actual highest course has 7 lessons, but the developer reported the needed fixture still isn't present for a clean check. |
| 4 | Video lesson auto-completion | **Human-needed escalation** — the accessible VIDEO lesson has no uploaded video file; cannot exercise real playback/scrub-to-90%. |
| 5 | Backstop C — offline resilience during video | **Human-needed escalation** — same root cause as step 4. |
| 6 | Undo re-lock disclosure | **PASS, developer-confirmed** — inline "re-lock N lesson(s)" disclosure, no modal, later lessons correctly show locked afterward. |
| 7 | Sessions page — meeting-link gate | **Partially confirmed.** Developer-confirmed: after clearing the stale `.next` cache, all four sessions render; future sessions correctly show no join link plus the 60-minute opening-window notice; the one past session shows its link. **Not verified:** page-source string inspection was blocked by browser policy, and the developer did not observe the actual window-opening transition (link absent → present) in real time — recorded as outstanding, not a pass, for that specific sub-claim. |
| 8 | Cross-learner access | **PASS, developer-confirmed** — a second learner navigating to the first's `/learn/{enrolmentId}` receives a 404, never a permissions message. |
| 9 | Staff override + audit | **PASS, developer-confirmed** (after publishing the pins) — empty reason refused, valid reason succeeds and appears in audit history. |
| 10 | Unresolved long-text/location wrapping | **Pending, not verified** — no realistic long-form location/cancellation-reason content exists in seed data; recorded per UI-SPEC section 8 as an outstanding planner assumption, not a verified fit. |

**Backstops A, B and C** each carry an explicit human-needed escalation (seed-data/content gaps, not code defects) rather than a silent pass, per UI-SPEC section 8's status vocabulary.

**Sign-off status:** the developer reviewed this table and confirmed steps 6, 8 and 9 match their own observation, but explicitly declined to give unqualified "approved" for the checkpoint as a whole — they have not independently re-verified the sequencing fix (step 1) or the session-link opening transition (step 7) themselves, and noted they cannot confirm the reported code fix or test results without reviewing them personally. This is recorded as a **qualified close-out**: automated verification is complete and independently reproducible (all commits, tests, and the bug fix are in the repository history for review), but full human UAT sign-off on steps 1 and 7 remains outstanding.

**Note on database side effects:** the walkthrough left Tunde Bello's first lesson marked complete via a staff-override test, and an earlier manual video-completion test was undone. This is dev/seed data, not production, and reflects real testing activity — no action taken to revert it.

## User Setup Required
None - no external service configuration required for the code changes. Separately (not required, but recommended): publish "Workplace Safety Essentials" and "Incident Investigation" to Amara's cohort (March) the same way, and consider seeding one long-title lesson and one small real video file, to close the three remaining human-needed backstops in a future session.

## Next Phase Readiness
All 14 plans are executed and every automated gate is green, including the one real bug the human checkpoint was designed to catch — found and fixed at its root, with a TDD regression test. That said, this is a **qualified close-out**, not a fully signed-off UAT: the developer has not personally re-verified the sequencing fix (step 1) or the session-link opening transition (step 7) in the browser, and said so explicitly rather than rubber-stamping. Recommended before treating Phase 9 as fully human-verified: the developer independently reloads Tunde's dashboard to confirm "Next up" now shows the correct lesson, and watches a session's join link appear in real time as its window opens. The three backstop escalations and the one pending item remain seed-data/content gaps outside this plan's scope to fix, not open code defects.

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-15*
