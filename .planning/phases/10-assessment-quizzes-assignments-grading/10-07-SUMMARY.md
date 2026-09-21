---
phase: 10-assessment-quizzes-assignments-grading
plan: 07
subsystem: grading
tags: [assessment, grading, cohort-scope, batch-release, authorization]
dependency-graph:
  requires:
    - src/server/services/cohort-scope.ts (enrolmentCohortScope, cohortResourceScope — reused unmodified)
    - src/server/permissions/with-permission.ts (withPermission choke point)
    - src/server/services/domain-event-service.ts (writeDomainEvent, grade.released event type)
    - src/server/services/audit-service.ts (recordAudit)
  provides:
    - src/server/services/grading-service.ts (listCohortGradingSummary, listGradingQueue, getGradingDetail, saveDraftGrade, releaseGrade, releaseGradesBatch, GradeAlreadyReleasedError, MAX_BATCH_RELEASE)
  affects:
    - plan 10-09 (grade-override-service.ts — the only path permitted to change a RELEASED grade)
    - plan 10-12 (grading queue UI — consumes listCohortGradingSummary/listGradingQueue)
    - plan 10-13 (grade-entry UI — consumes getGradingDetail/saveDraftGrade/releaseGrade/releaseGradesBatch)
tech-stack:
  added: []
  patterns:
    - "deps-injection factory + prisma-bound tail re-exports (lesson-progress-service.ts / submission-service.ts / attendance-service.ts style)"
    - "scope-resolve-from-row, never caller-asserted parent id (T-10-23 IDOR mitigation)"
    - "common-scope merge across a batch of ids, resolved once in the withPermission scope resolver, before any read/write (T-10-09)"
    - "shared per-row release body factored out so single and batch release paths cannot drift"
key-files:
  created:
    - src/server/services/grading-service.ts
    - tests/grading-service.test.ts
  modified: []
decisions:
  - "commonGradesScope merges cohortId only when every selected grade shares the exact same cohort, programmeId only when every grade shares the same programme, and courseIds as the INTERSECTION across every grade's own courseIds — this is what lets a PROGRAMME-scoped grant authorize a batch spanning several of its Cohorts while a COHORT-scoped grant can never cover more than one, without a bespoke cohort-id equality check"
  - "MAX_BATCH_RELEASE cap (200) is enforced as the very first line of the batch scope resolver, before a single grade is read, so an oversized request is refused before any database work, not just before any write"
  - "saveDraftGrade and getGradingDetail do a first hop (read the submission row to learn its enrolmentId) before calling enrolmentCohortScope — an extra query, but it is what turns an IDOR on submissionId into a denial rather than a leak (T-10-23), matching cohort-scope.ts's own two-hop precedent (sessionCohortScope)"
metrics:
  duration: "~55min"
  completed: "2026-09-15"
---

# Phase 10 Plan 07: Grading Service (ASM-05) Summary

Cohort-scoped grading queue, draft-save invisible to learners, and explicit attributed
single/batch release — all authorized through the existing `enrolmentCohortScope` resolver, with
D-06's batch release as one transaction.

## What Was Built

`src/server/services/grading-service.ts` (749 lines) — a deps-injection factory
(`createGradingService`) with a prisma-backed instance and named re-exports at the tail, following
the same shape as `lesson-progress-service.ts`/`submission-service.ts`/`attendance-service.ts`:

- **`listCohortGradingSummary(input: { cohortId })`** — one row per ASSIGNMENT-type Assessment
  reachable from the Cohort's pinned course (or its programme's member courses), with
  pending/draft/released counts. QUIZ-type assessments are excluded entirely (D-01: a quiz never
  produces a DRAFT grade a human needs to act on).
- **`listGradingQueue(input: { cohortId; assessmentId; status? })`** — READY submissions whose
  enrolment belongs to the Cohort, constrained by the enrolment's own `cohortId` (never by a
  caller-supplied list of submission ids), optionally filtered by grade status.
- **`getGradingDetail(input: { submissionId })`** — the submission, learner name, late/attempt
  facts, the current Grade (if any), the full prior-Submission history for the enrolment+assessment
  newest first (D-04), and any GradeOverride rows. Scope resolves by reading the submission row's
  own `enrolmentId` first — an IDOR on `submissionId` denies rather than leaks (T-10-23).
- **`saveDraftGrade(input: { submissionId; score; feedback })`** — upserts a `DRAFT` Grade;
  refuses with `GradeAlreadyReleasedError` on an already-RELEASED grade before any write; validates
  `score` is an integer in `[0, maxScore]`; writes NO domain event (a draft must never reach the
  outbox).
- **`releaseGrade(input: { gradeId })`** — sets `RELEASED`, `releasedById`, `releasedAt` inside one
  transaction; writes one `grade.released` event with a `releasedBy: "STAFF"` marker (distinguishing
  it from plan 10-06's `SYSTEM_AUTO` quiz auto-release); writes one `grade.released` audit row. A
  second release on an already-RELEASED grade is a no-op — no duplicate event, no duplicate audit
  row.
- **`releaseGradesBatch(input: { gradeIds: string[] })`** (D-06) — ONE server action over an array
  of ids, executed inside ONE `prisma.$transaction`. Authorization resolves the COMMON scope across
  every supplied grade id BEFORE any read; a selection spanning cohorts the actor's grant does not
  cover rejects the WHOLE batch with `AuthorizationError` (T-10-09) — verified by a unit case
  asserting no grade's status changed. Inside the transaction, non-DRAFT ids are SKIPPED (not
  thrown on), never double-released. Capped at `MAX_BATCH_RELEASE` (200), enforced before a single
  grade is read (T-10-24). The per-grade release write is factored into `releaseOneGrade`, shared by
  `releaseGrade` and `releaseGradesBatch` so the two paths cannot drift.

`tests/grading-service.test.ts` (581 lines, 16 tests) — an in-memory staged-commit fake harness
driving the real `createCohortScopeResolvers` and the real `writeDomainEvent`, covering: COHORT-
and PROGRAMME-scope allow/deny (thrown `AuthorizationError`, never a filtered result), Cohort-scope
queue isolation, QUIZ exclusion from the summary, draft invisibility (zero domain events), the
RELEASED-grade refusal on the draft-save path, score-bounds validation, single-release attribution
and no-op-on-repeat, and D-06 batch semantics (full release, partial skip, all-or-nothing cross-
cohort denial, the `MAX_BATCH_RELEASE` refusal, and exactly-one-transaction).

## Verification

- `npx tsc --noEmit` — 0 errors (one pre-existing, unrelated error in `src/app/layout.tsx` was
  present before this plan and is out of scope; confirmed via `git status` showing that file
  untouched)
- `npx eslint src/server/services/grading-service.ts tests/grading-service.test.ts` — 0 errors, 0
  warnings
- `npx vitest run tests/grading-service.test.ts tests/cohort-scope.test.ts tests/boundary.test.ts` —
  38/38 passed
- `npx vitest run --exclude "**/*.integration.test.ts"` — all suites pass except four PRE-EXISTING,
  unrelated component-test failures (see Deviations) not touched by this plan
- Full `npx vitest run` (including Docker-backed integration tests) — no failures attributable to
  this plan; several integration tests skip/fail on `Can't reach database server` (Docker
  unavailable in this sandbox), matching the pre-existing, already-documented gap in `STATE.md`
- Acceptance-criteria greps: `enrolmentCohortScope` count 7 (>= 2 required); forbidden-permission
  grep (`grades.release`/`grades.batch_release`/`assessments.view`) count 0; `MAX_BATCH_RELEASE`
  constant present and enforced; `releasedBy` marker value `"STAFF"` present; `releaseGradesBatch`
  contains exactly one `runInTransaction` call wrapping its whole loop

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing critical functionality, or blocking issues were found; the plan's task
actions were implemented as specified.

### Task grouping

Tasks 1 and 2 (`grading-service.ts`'s reads/draft-save and its release/batch-release) were written
and committed together in a single commit (`4dd1518`) because they are the same file built as one
coherent unit — the shared `releaseOneGrade` helper and the `commonGradesScope` resolver Task 2
needs are most naturally authored alongside Task 1's scope-resolution helpers rather than as an
artificially split diff. Task 3 (the test file) remains its own commit (`109f12c`) as planned.

### Out-of-scope observations (not fixed, logged only)

Four pre-existing component-test failures were observed in `tests/components/order-confirmation.test.tsx`,
`checkout-summary.test.tsx`, `cohort-cards.test.tsx`, and `cohort-pages.test.tsx` — all concern
currency/price formatting in Phase 6/9 checkout and cohort-catalogue components, unrelated to this
plan's `grading-service.ts`/`grading-service.test.ts` files. Confirmed pre-existing (not introduced
by this plan) since neither touched file is imported by any of the failing components or their
tests. Left unfixed per the deviation-rules scope boundary ("only auto-fix issues directly caused
by the current task's changes"); logged to `.planning/phases/10-assessment-quizzes-assignments-grading/deferred-items.md`
if that file exists, otherwise noted here for the orchestrator's awareness.

## Known Stubs

None. Every exported function is a real, database-backed (or fake-backed, in the test harness)
implementation — no hardcoded empty values or placeholder UI wiring in this plan's scope (this
plan produces no UI, only the service layer plan 10-12/10-13 will consume).

## Threat Flags

None — every mutation and read in this file maps directly to a `mitigate` disposition already
documented in the plan's own `<threat_model>` (T-10-03, T-10-09, T-10-04, T-10-05, T-10-23,
T-10-24). No new network endpoint, auth path, file-access pattern, or schema change was introduced
beyond what that register already covers.

## Self-Check: PASSED

- FOUND: src/server/services/grading-service.ts
- FOUND: tests/grading-service.test.ts
- FOUND commit 4dd1518 (Task 1+2: reads, draft-save, release, batch-release)
- FOUND commit 109f12c (Task 3: tests)
