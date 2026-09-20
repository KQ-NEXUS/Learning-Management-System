---
phase: 09-learning-delivery-progress-tracking
plan: 04
subsystem: api
tags: [prisma, transactional-outbox, completion-engine, attendance, lrn-07]

# Dependency graph
requires:
  - phase: 09-02
    provides: evaluateCompletion (completion-engine.ts), parseCompletionRule (completion-rule.ts) — the pure v1 rule evaluator this plan wraps in a persistence layer
  - phase: 09-03
    provides: isCourseObligationPayload/isProgrammeObligationPayload guards (learner-access.ts) — reused for pinned-payload validation
  - phase: 05
    provides: computeAttendanceComponent (attendance-component.ts), the attendance-service.ts write path this plan hooks into, and the "attendance.changed" domain event shape
provides:
  - "recalculateCompletion(tx, { enrolmentId, now }) — the same-transaction completion persistence wrapper (create/supersede/leave-alone a CompletionRecord)"
  - "Three new closed-union DomainEventType members: lesson.completed, course.completed, programme.completed"
  - "The D-11 reactive trigger — every attendance write now recalculates completion in the same transaction"
affects: [11-certificates, 13-communications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural transaction-client types (CompletionServiceTxClient) that omit a delegate method entirely (no enrolment.update, no completionRecord.delete) to make a forbidden write a compile error, not just a documented rule"
    - "Reactive same-transaction recalculation, injected as a dependency (deps.recalculateCompletion) exactly like deps.writeEvent/deps.audit, so unit tests never need a database"

key-files:
  created:
    - src/server/services/completion-service.ts
    - tests/completion-service.test.ts
  modified:
    - src/server/services/domain-event-service.ts
    - tests/domain-event-service.test.ts
    - src/server/services/attendance-service.ts
    - tests/attendance-service.test.ts
    - .planning/phases/09-learning-delivery-progress-tracking/deferred-items.md

key-decisions:
  - "DD-6 ruling from the plan honored in code: CompletionServiceTxClient declares no enrolment.update method at all, so a compile-time boundary (not just a test) prevents this service from ever touching Enrolment.status; Phase 11 owns any future status transition."
  - "Required-lesson evidence is read from the PINNED CoursePublication/ProgrammePublication payload (DD-11), with a live-lesson withdrawnAt lookup excluding any required lesson withdrawn since pinning — the same exclusion lesson-sequencing.ts's D-17 already applies, so a withdrawn lesson can never permanently block completion."
  - "attendance-service.ts's own recomputeComponent was NOT reused directly (it is private and typed against AttendanceTxClient); completion-service.ts duplicates the same read-and-call-computeAttendanceComponent shape against its own narrower tx type, keeping the single pure calculator (attendance-component.ts) but two thin same-shape callers."
  - "The tx object passed into deps.recalculateCompletion is the exact same object attendance-service.ts's upsert wrote through (via an `as unknown as CompletionServiceTxClient` cast, not a copy) — proven by an identity-preserving test assertion and by the real-Postgres integration test passing unchanged."

patterns-established:
  - "A reactive engine hook wired as a last step inside an existing write function (writeOneRecord), not as a new top-level transaction — keeps D-11's 'no batch, no sweep' requirement mechanically true."

requirements-completed: [LRN-07]

# Metrics
duration: ~25min
completed: 2026-09-14
---

# Phase 09 Plan 04: Completion Engine Persistence Wrapper Summary

**`recalculateCompletion` (completion-service.ts) creates/supersedes `CompletionRecord` rows from 09-02's pure evaluator inside the caller's own transaction, wired as the first of D-11's two reactive triggers into `attendance-service.ts`'s write path.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-14T20:46Z (context gathering) / first commit 2026-09-14T20:50:05+01:00
- **Completed:** 2026-09-14T20:55:58+01:00
- **Tasks:** 3 completed
- **Files modified:** 5 source/test files + 1 tracking doc

## Accomplishments

- Extended the closed `DomainEventType` union with `lesson.completed`, `course.completed`, `programme.completed`, purely additively, documenting DD-13 (Phase 13 drain input only, never a Phase 9 trigger).
- Built `completion-service.ts`'s `recalculateCompletion(tx, { enrolmentId, now })`: reads evidence entirely through the caller's `tx`, evaluates one COURSE-scope rule for a standalone course-cohort, or one COURSE-scope rule per member course plus a PROGRAMME-scope rule (union of required lessons) for a programme-cohort, and creates/supersedes/leaves alone the matching `CompletionRecord` per D-10/D-12.
- Wired attendance writes (`markAttendance`/`saveSessionAttendance` via `writeOneRecord`) to call `recalculateCompletion` inside the same transaction immediately after emitting `attendance.changed` — the first of D-11's two reactive triggers, proven both at the unit level (fake tx, same-object-identity assertion) and against a real Postgres transaction (`tests/attendance-service.integration.test.ts`, 9/9 passing).

## Task Commits

Each task was committed atomically (Tasks 2 and 3 used the RED/GREEN TDD cycle):

1. **Task 1: Extend DomainEventType with the three completion events** - `b06d394` (feat)
2. **Task 2: completion-service.ts — recalculate, record, supersede**
   - RED: `e369572` (test) — 18 failing cases against a not-yet-created module
   - GREEN: `023f1f0` (feat) — all 18 passing
3. **Task 3: Wire the attendance-change recalculation trigger (D-11)**
   - RED: `ea896cc` (test) — 5 new failing cases (spy never called)
   - GREEN: `a8600d5` (feat) — all 45 attendance-service.test.ts cases passing (40 pre-existing + 5 new)

**Plan metadata:** committed separately by the orchestrator after this worktree merges (per worktree-mode instructions, this executor does not touch STATE.md/ROADMAP.md).

## Files Created/Modified

- `src/server/services/completion-service.ts` - New. `recalculateCompletion`, `CompletionServiceTxClient`, and the private course-obligation/attendance-evidence/verdict-application helpers.
- `tests/completion-service.test.ts` - New. 18 cases: course-cohort and programme-cohort scoping, idempotent re-satisfaction, supersede-then-recreate on an attendance correction, withdrawn-required-lesson exclusion, unpinned not-evaluable, unparseable-rule propagation, and the DD-6 `enrolment.update`-never-called assertion.
- `src/server/services/domain-event-service.ts` - Additive: three new `DomainEventType` members plus a DD-13 doc comment.
- `tests/domain-event-service.test.ts` - Additive: one `it.each` case covering the three new event types.
- `src/server/services/attendance-service.ts` - Additive: `recalculateCompletion` added to `AttendanceServiceDeps`, called once inside `writeOneRecord` after `attendance.changed`, live default wired at the bottom of the file via a new optional 4th parameter to `createPrismaBackedAttendanceService`.
- `tests/attendance-service.test.ts` - Additive: harness now injects a `recalculateCompletion` spy; new `describe("D-11 …")` block (5 cases) proves call count, tx identity, and the no-threshold / post-window-correction / unchanged-entry edge cases.
- `.planning/phases/09-learning-delivery-progress-tracking/deferred-items.md` - Logged two out-of-scope, non-blocking observations (see below).

## Decisions Made

- DD-6 enforced structurally, not just documented: `CompletionServiceTxClient` has no `enrolment.update` method in its type at all, so the service literally cannot compile a call to it.
- Required-lesson evidence sourced from the pinned obligation payload (DD-11) with a live `withdrawnAt` check excluding a required lesson withdrawn since pinning — mirrors `lesson-sequencing.ts`'s existing D-17 exclusion rather than inventing a new rule.
- `attendance-service.ts`'s private `recomputeComponent` was not imported/reused (it's typed against `AttendanceTxClient`, not exported); `completion-service.ts` has its own equivalent-shaped helper calling the same pure `computeAttendanceComponent`, keeping the "one pure calculator" invariant `attendance-component.ts`'s header requires while avoiding a private-function import across module boundaries.
- `createPrismaBackedAttendanceService` gained an optional 4th parameter (`recalculateCompletionDep`) defaulting to the live `completion-service.ts` export, so the existing 3-argument call in `tests/attendance-service.integration.test.ts` needed no change and still exercises the real completion-recalculation path against real Postgres.

## Deviations from Plan

None — plan executed exactly as written. Two non-blocking observations were logged to `deferred-items.md` rather than treated as deviations:

1. The acceptance-criteria greps for `assertTransition` and `setTimeout|setInterval|cron|...` in `completion-service.ts` return 1 each, not 0 — both matches are the header doc comment's own prose stating that the module does NOT do these things (the DD-6/DD-12 record the plan's `<action>` text explicitly asked for), not executable code. Confirmed by reading both flagged lines directly.
2. `npx tsc --noEmit` still reports the same seven pre-existing, unrelated errors documented in 09-01/09-02 (`LayoutProps` in `layout.tsx`, `Cannot find module 'stripe'` — the package is absent from this worktree's `node_modules`). None reference any file this plan touched.

## Issues Encountered

None — all three tasks passed on the first GREEN attempt after RED.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- LRN-07's core evidence engine (`CompletionRecord`) now exists and self-updates reactively on every attendance write, closing the gap `.planning/codebase/CONCERNS.md` flagged for both LRN-07 and CRD-01/02.
- D-11's SECOND reactive trigger — recalculation on every `LessonProgress` write (manual mark-complete / AUTO_VIDEO threshold-crossing) — is explicitly NOT part of this plan and remains open for whichever later 09-0x plan builds the lesson-progress write path; that path must call `recalculateCompletion` the same way `attendance-service.ts` now does.
- `lesson.completed` was added to the `DomainEventType` union in this plan but is not yet emitted anywhere — the future lesson-progress write path owns that emission (fires on `LessonProgress` row creation, per this plan's Task 1 doc comment).
- Phase 11 (Certificates & Completion Lifecycle) can now read `CompletionRecord` rows as real evidence; Phase 13 (Communications) has three new event types to drain once its drain job exists.
- No blockers.

## Self-Check: PASSED

- FOUND: `src/server/services/completion-service.ts`
- FOUND: `tests/completion-service.test.ts`
- FOUND commit `b06d394`
- FOUND commit `e369572`
- FOUND commit `023f1f0`
- FOUND commit `ea896cc`
- FOUND commit `a8600d5`

---
*Phase: 09-learning-delivery-progress-tracking*
*Completed: 2026-09-14*
