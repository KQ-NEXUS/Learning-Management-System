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
affects: [any future phase adding a course/module/lesson to a programme cohort — flattenSequencingLessons-shaped code (learner-access.ts, lesson-progress-service.ts) must keep using a running index, never a synthesised stride, if this walk is ever touched again]

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
    - src/server/services/lesson-progress-service.ts
    - tests/learner-access.test.ts
    - tests/lesson-progress-service.test.ts

key-decisions:
  - "Extracted tests/boundary.test.ts's import-walking helpers into tests/import-graph.ts (a plain module, not *.test.ts) rather than importing boundary.test.ts directly — a literal import of one .test.ts file from another re-executes its describe/it registrations"
  - "Task 3's human walkthrough surfaced a real production bug (module-position collision in loadLearnerPath's sequencing offset). First fix (a second numeric stride) was itself reviewed and found to only move the collision boundary, not remove it — final fix uses a plain running index, which is collision-free by construction since both flattening walks already visit lessons in correct order"
  - "The same collision bug existed a second time, duplicated in lesson-progress-service.ts's flattenSequencingLessons (backing the Undo re-lock count) — missed by the first fix entirely; found by re-auditing for the same pattern after the code review flagged the stride approach as fragile"

patterns-established:
  - "Pattern: when a nested loop already visits items in the correct final order, use a running index for a downstream flat-array sort key — never synthesise one from per-level strides. A stride is a live assumption (per-level max count) that nothing enforces; a running index has no assumption to violate"

requirements-completed: [LRN-01, LRN-02, LRN-03, LRN-04, LRN-05, LRN-06, LRN-07]

duration: ~6h (including the human walkthrough round-trip and bug investigation)
completed: 2026-09-15
---

# Phase 09 Plan 14: Invariants, Integration Proof & Human Walkthrough Summary

**Eight architectural invariants locked in as tests, LRN-01 through LRN-07 proven against real Postgres, and a real multi-module lesson-locking bug found and fixed during the human walkthrough**

## Performance

- **Duration:** ~7h total (Tasks 1-2 automated: ~35 min; Task 3 human walkthrough, investigation, fix, and a code-review follow-up fix: the remainder)
- **Tasks:** 3/3 complete
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments
- `tests/learning-phase-invariants.test.ts` — 8 compiler-API tests (INV-1 through INV-8) covering pure-module import-freedom, ownership services never importing `withPermission`, DD-6's `Enrolment.status` protection, `meetingUrl` gating outside `SessionCard.tsx`, the zero-client-JS guarantee on `LessonContent`/`LessonMediaPlayer`, zero raw hex outside `globals.css`, the historical `DomainEventType` member set, and Server Action `"use server"` + no-`userId`-from-formData discipline
- `tests/learner-journey.integration.test.ts` — a real-Postgres (Testcontainers) narrative proving sequencing/lock state, idempotent double-mark, free undo + re-lock, video 90% auto-completion, attendance-gated completion with a real supersede-then-resatisfy `CompletionRecord` cycle, a direct DD-6 `Enrolment.status` read-back, the LRN-03 ownership predicate, LRN-06 meeting-link visibility, and LRN-01/T-09-01 cross-learner isolation (37 assertions)
- Full ten-step human walkthrough performed against the live dev app and real seed data, surfacing and resolving three distinct issues (below) — not rubber-stamped

## Task Commits

1. **Task 1: Phase invariants test** - `88050cd` (feat)
2. **Task 2: Real-Postgres learner journey integration test** - `491dbd9` (feat)
3. **Task 3 follow-up: module-position sequencing fix (stride-based, first pass)** - `f7b0564` (fix, found during the walkthrough)
4. **Task 3 follow-up: collision-proof running-index fix (final)** - `f947047` (fix, found via code review of commit 3)

**Plan metadata:** (this commit)

## Files Created/Modified
- `tests/learning-phase-invariants.test.ts` - the 8 architectural invariants
- `tests/import-graph.ts` - extracted import-walking traversal, shared by `boundary.test.ts` and the new invariants file
- `tests/boundary.test.ts` - re-exports its traversal from `import-graph.ts` instead of a second copy; its own 14 tests unchanged
- `tests/learner-journey.integration.test.ts` - the real-Postgres end-to-end proof; fixture later changed to module-local lesson positions (see deviation 3)
- `src/server/services/learner-access.ts` - `loadLearnerPath`'s flattening now uses a plain running index instead of a synthesised per-level stride
- `src/server/services/lesson-progress-service.ts` - `flattenSequencingLessons` (backing `countLessonsRelockedBy`/Undo) fixed the same way — it had the identical original bug, undetected by the first fix
- `tests/learner-access.test.ts` - two regression tests: the original module-collision case, and a 1001-lesson case proving no stride-sized boundary remains
- `tests/lesson-progress-service.test.ts` - regression test for `countLessonsRelockedBy` across a module-local position reset

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
- **First fix (superseded by deviation 3):** added a second `MODULE_POSITION_STRIDE` and offset by module index in addition to course index. Confirmed RED against the old code, GREEN after — but this fix itself was a stride, and a code review of it (deviation 3) found it only moved the collision boundary rather than removing it.
- **Committed in:** `f7b0564` (superseded, kept in history — see deviation 3 for the final fix)

**3. [Code-review finding, addressed before considering the fix robust] Stride-based fix only moved the collision boundary; duplicate occurrence in `lesson-progress-service.ts` missed entirely**
- **Found during:** review of commit `f7b0564`, after Task 3's checkpoint had already been recorded as a qualified close-out
- **Issue A:** `moduleIndex * MODULE_POSITION_STRIDE + lesson.position` (STRIDE = 1,000) still collides — a module with ≥ 1,000 lessons reproduces the exact original bug at a further-out boundary, with no enforced per-module lesson-count limit protecting the assumption.
- **Issue B:** `lesson-progress-service.ts`'s `flattenSequencingLessons` (which backs `countLessonsRelockedBy` — the Undo feature's "N lessons will re-lock" disclosure) is a second, independent copy of the identical flattening logic, carrying the *original* course-index-only bug. The first fix touched only `learner-access.ts` and never audited for a duplicate.
- **Root cause common to both:** synthesising a sort key from per-level strides encodes an assumed maximum count at each level. Both flattening loops already iterate courses → modules → lessons in the exact correct final order (each level pre-sorted by `loadCourseEntryFromPin`), so no synthesis is needed at all.
- **Fix:** replaced both stride computations with a plain incrementing counter (`globalPosition++` / equivalent) over the existing nested loop in both `learner-access.ts` and `lesson-progress-service.ts` — collision-free by construction, no count assumption to violate.
- **Coverage gap also closed:** `tests/learner-journey.integration.test.ts`'s fixture deliberately used globally-increasing lesson positions (0,1,2,3) specifically to *avoid* the module-local-reset collision, with a comment mischaracterizing the collision as a "live authoring gap outside this test's scope." It is not an edge case — every real published course resets lesson position per module (confirmed against production seed data). Changed the fixture to module-local positions (module A: 0,1; module B: 0,1) so the real-Postgres suite independently exercises the same defect class the unit regression does.
- **Verification (TDD, three separate regressions):**
  - `tests/learner-access.test.ts` — a module with 1,001 lessons, chosen specifically to break any fixed 1,000-lesson-per-module stride. Confirmed RED against the stride fix, GREEN after the running-index fix.
  - `tests/lesson-progress-service.test.ts` — `countLessonsRelockedBy` across a hand-built two-module path with position resets. Confirmed RED by temporarily reverting the fix via `git stash`, GREEN after restoring it.
  - `tests/learner-journey.integration.test.ts` — confirmed RED against the *original* (pre-`f7b0564`) course-index-only bug by temporarily reintroducing that exact formula and re-running against real Postgres (Testcontainers) — the existing "lesson 2 unlocks after lesson 1" assertion failed exactly as predicted; confirmed GREEN after restoring the real fix.
  - Full re-run after all fixes: 470/470 unit/component tests (23 files) + 2/2 real-Postgres integration tests, `tsc --noEmit` and `eslint` clean on every touched file.
- **Committed in:** `f947047`

---

**Total deviations:** 3 (1 auto-fixed per Rule 3, 1 real bug found and fixed via TDD during the human checkpoint — later superseded by a more robust fix after code review, 1 code-review finding that closed both the remaining collision boundary and a coverage gap)
**Impact on plan:** Deviations 2 and 3 are the most significant finding of this entire phase — they affect LRN-02's core lock/unlock guarantee for any course with more than one module, and the Undo feature's re-lock count. The first fix attempt (deviation 2) would have shipped a narrower version of the same defect class had it not been reviewed; the final fix (deviation 3) removes the defect class by construction rather than by a wider assumed bound.

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
| 7 | Sessions page — meeting-link gate | **PASS, developer-confirmed.** After clearing the stale `.next` cache: all four sessions render; future sessions correctly show no join link plus the 60-minute opening-window notice; the one past session shows its link. The live opening transition was then independently confirmed using a throwaway seed session (`ScheduledSession` id `cmu2iy9mr0001ulxwgbg7na3z`, created 2026-09-15, deleted after use): no link before the 60-minute window opened, link present after — watched in real time in the browser. Page-source string inspection specifically remains unverified (blocked by browser policy), but the rendered behavior is now fully confirmed. |
| 8 | Cross-learner access | **PASS, developer-confirmed** — a second learner navigating to the first's `/learn/{enrolmentId}` receives a 404, never a permissions message. |
| 9 | Staff override + audit | **PASS, developer-confirmed** (after publishing the pins) — empty reason refused, valid reason succeeds and appears in audit history. |
| 10 | Unresolved long-text/location wrapping | **Pending, not verified** — no realistic long-form location/cancellation-reason content exists in seed data; recorded per UI-SPEC section 8 as an outstanding planner assumption, not a verified fit. |

**Backstops A, B and C** each carry an explicit human-needed escalation (seed-data/content gaps, not code defects) rather than a silent pass, per UI-SPEC section 8's status vocabulary.

**Sign-off status:** the developer initially confirmed only steps 6, 8 and 9, declining unqualified approval pending independent re-verification of the sequencing fix (step 1) and the session-link opening transition (step 7). They then, in order: (1) code-reviewed the fix directly and found two further issues, documented in Deviation 3 above; (2) independently ran 186 focused tests, both real-Postgres integration tests, and a clean `tsc`/`eslint` pass on the final fix themselves; (3) reloaded Tunde's dashboard in the browser and confirmed step 1 — "Next up" shows exactly one action ("Lesson 1.2" in "Module 1"); (4) confirmed Backstop B (overflow) against the real "1 of 10 required lessons complete" aggregate caption, which fits without overflow; (5) watched a throwaway seed session's meeting link transition from absent to present in real time, confirming step 7 fully except for page-source string inspection (blocked by browser policy). Steps 1, 6, 7, 8 and 9 are now developer-confirmed PASS. Remaining open items: the content-dependent backstops (long-title wrap, video auto-completion/offline resilience, long-form-text wrapping — steps 2-5 and 10), all blocked by seed-data gaps rather than code defects; and a UI-SPEC conformance gap in `ProgressMeter.tsx` found incidentally during this walkthrough (caption position and missing percentage figure — deferred, tracked in `STATE.md`, not part of this plan's scope).

**Note on database side effects:** the walkthrough left Tunde Bello's first lesson marked complete via a staff-override test, and an earlier manual video-completion test was undone. This is dev/seed data, not production, and reflects real testing activity — no action taken to revert it.

## User Setup Required
None - no external service configuration required for the code changes. Separately (not required, but recommended): publish "Workplace Safety Essentials" and "Incident Investigation" to Amara's cohort (March) the same way, and consider seeding one long-title lesson and one small real video file, to close the three remaining human-needed backstops in a future session.

## Next Phase Readiness
All 14 plans are executed and every automated gate is green, including the real bug the human checkpoint was designed to catch — found, fixed, then further hardened after a code review found the first fix was itself fragile (a second occurrence of the same bug class in `lesson-progress-service.ts`, and a stride boundary that could still collide at scale). The final fix is collision-free by construction, not by an assumed bound, and is proven at three levels: two unit regressions and one real-Postgres integration regression, each independently confirmed RED-then-GREEN — and the developer independently reproduced the final test run themselves.

The developer has now personally confirmed steps 1, 6, 7, 8 and 9 in the browser, including watching the sequencing fix and the session meeting-link transition render correctly in real time. This is a **fully human-verified close-out for everything code-related**; the remaining open items are exclusively content/seed-data gaps outside this plan's scope (Backstops A/C, step 10 — no long lesson title, no real video file, no realistic long-form copy in seed data) plus one incidentally-discovered UI-SPEC conformance gap in `ProgressMeter.tsx` (caption position and missing percentage figure), deferred by explicit user decision and tracked in `STATE.md` for a future pass.

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-15*
