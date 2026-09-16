---
phase: 10
slug: assessment-quizzes-assignments-grading
status: awaiting-human
nyquist_compliant: false
wave_0_complete: true
created: 2026-09-15
updated: 2026-09-16
---

# Phase 10 - Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Vitest ^4.1.11 |
| Config | vitest.config.mts; node and components projects; isolated process workers for node, thread workers for components |
| Quick command | `npx vitest run tests/quiz-scoring.test.ts`; substitute the relevant module |
| Full command | `npm.cmd test -- --maxWorkers=1 --testTimeout=30000` (Windows); package script is `vitest run --no-file-parallelism` |
| Measured full runtime | 953.36 seconds (15 minutes 53.36 seconds); full run, including all integration fixtures |

## Sampling Rate

- After each task commit: relevant service, route or component suite from the map.
- After each wave merge: full suite, including real PostgreSQL and MinIO integration fixtures.
- Before human verification: full tests, TypeScript, repository lint and production build must pass.
- Feedback latency: the eleven architecture checks took 3.38 seconds; measured full-run latency is 953.36 seconds.

## Per-Task Verification Map

50 rows, one per task. Requirements and threats are the containing plan's register; secure behavior summarizes the protection those tasks deliver together. Commands come from the task verify block and reference the actual shipped filenames. Plans 01-16 have completed summaries; historical success is distinguished from the final run. Wave numbers follow dependencies (plan 16 is Wave 5).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|---|---|---|---|
| 10-01-1 | 01 | 1 | ASM-01, ASM-02, ASM-04, ASM-05, ASM-06 | T-10-06, T-10-07 | Additive schema; row-derived scope; staged-key domain separation | schema / type / lint / build | `npx prisma validate` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-01-2 | 01 | 1 | ASM-01, ASM-02, ASM-04, ASM-05, ASM-06 | T-10-06, T-10-07 | Additive schema; row-derived scope; staged-key domain separation | schema / type / lint / build | `npx prisma migrate status` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-01-3 | 01 | 1 | ASM-01, ASM-02, ASM-04, ASM-05, ASM-06 | T-10-06, T-10-07 | Additive schema; row-derived scope; staged-key domain separation | unit / AST | `npx vitest run tests/assessment-scope.test.ts tests/submission-storage-keys.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-02-1 | 02 | 1 | ASM-02 | T-10-01, T-10-08, T-10-12 | Snapshot-only objective scoring; no caller verdict | unit / AST | `npx vitest run tests/quiz-scoring.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-02-2 | 02 | 1 | ASM-02 | T-10-01, T-10-08, T-10-12 | Snapshot-only objective scoring; no caller verdict | unit / AST | `npx vitest run tests/quiz-scoring.test.ts tests/boundary.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-03-1 | 03 | 2 | ASM-01, ASM-03 | T-10-07, T-10-13, T-10-14, T-10-15 | Validated authoring; deny incomplete publish and sibling scope | unit / AST | `npx vitest run tests/assessment-readiness.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-03-2 | 03 | 2 | ASM-01, ASM-03 | T-10-07, T-10-13, T-10-14, T-10-15 | Validated authoring; deny incomplete publish and sibling scope | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-03-3 | 03 | 2 | ASM-01, ASM-03 | T-10-07, T-10-13, T-10-14, T-10-15 | Validated authoring; deny incomplete publish and sibling scope | unit / AST | `npx vitest run tests/assessment-service.test.ts tests/assessment-readiness.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-04-1 | 04 | 2 | ASM-01, ASM-02 | T-10-02, T-10-08, T-10-11, T-10-16, T-10-17 | Owner-derived attempt start; frozen questions and no answer key | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-04-2 | 04 | 2 | ASM-01, ASM-02 | T-10-02, T-10-08, T-10-11, T-10-16, T-10-17 | Owner-derived attempt start; frozen questions and no answer key | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-04-3 | 04 | 2 | ASM-01, ASM-02 | T-10-02, T-10-08, T-10-11, T-10-16, T-10-17 | Owner-derived attempt start; frozen questions and no answer key | unit / AST | `npx vitest run tests/attempt-service.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-05-1 | 05 | 2 | ASM-03, ASM-04 | T-10-02, T-10-06, T-10-18, T-10-19, T-10-20 | Owner-derived uploads; server-enforced file constraints | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-05-2 | 05 | 2 | ASM-03, ASM-04 | T-10-02, T-10-06, T-10-18, T-10-19, T-10-20 | Owner-derived uploads; server-enforced file constraints | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-05-3 | 05 | 2 | ASM-03, ASM-04 | T-10-02, T-10-06, T-10-18, T-10-19, T-10-20 | Owner-derived uploads; server-enforced file constraints | unit / AST | `npx vitest run tests/submission-service.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-06-1 | 06 | 3 | ASM-02, ASM-07 | T-10-01, T-10-08, T-10-21, T-10-11, T-10-22 | Atomic attempt result, auto-release and expiry | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-06-2 | 06 | 3 | ASM-02, ASM-07 | T-10-01, T-10-08, T-10-21, T-10-11, T-10-22 | Atomic attempt result, auto-release and expiry | unit / AST | `npx vitest run tests/attempt-service.test.ts tests/quiz-scoring.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-06-3 | 06 | 3 | ASM-02, ASM-07 | T-10-01, T-10-08, T-10-21, T-10-11, T-10-22 | Atomic attempt result, auto-release and expiry | PostgreSQL / MinIO integration | `npx vitest run tests/attempt-service.integration.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-07-1 | 07 | 3 | ASM-05 | T-10-03, T-10-09, T-10-04, T-10-05, T-10-23, T-10-24 | Cohort-scoped grading; immutable released scores; atomic batch | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-07-2 | 07 | 3 | ASM-05 | T-10-03, T-10-09, T-10-04, T-10-05, T-10-23, T-10-24 | Cohort-scoped grading; immutable released scores; atomic batch | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-07-3 | 07 | 3 | ASM-05 | T-10-03, T-10-09, T-10-04, T-10-05, T-10-23, T-10-24 | Cohort-scoped grading; immutable released scores; atomic batch | unit / AST | `npx vitest run tests/grading-service.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-08-1 | 08 | 3 | ASM-01, ASM-03 | T-10-07, T-10-13, T-10-14, T-10-25 | Authorized server actions; shared draft readiness | schema / type / lint / build | `npx tsc --noEmit && npx eslint "src/app/staff/courses/[id]/assessments" src/components/catalogue/CourseDetailActions.tsx` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-08-2 | 08 | 3 | ASM-01, ASM-03 | T-10-07, T-10-13, T-10-14, T-10-25 | Authorized server actions; shared draft readiness | schema / type / lint / build | `npx tsc --noEmit && npx eslint "src/app/staff/courses/[id]/assessments" src/components/catalogue/AssessmentFormFields.tsx` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-08-3 | 08 | 3 | ASM-01, ASM-03 | T-10-07, T-10-13, T-10-14, T-10-25 | Authorized server actions; shared draft readiness | unit / AST | `npx vitest run tests/assessment-staff-routes.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-09-1 | 09 | 4 | ASM-06, ASM-07 | T-10-05, T-10-26, T-10-04, T-10-02, T-10-03, T-10-27 | Released-only corrections with reason; learner draft exclusion | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-09-2 | 09 | 4 | ASM-06, ASM-07 | T-10-05, T-10-26, T-10-04, T-10-02, T-10-03, T-10-27 | Released-only corrections with reason; learner draft exclusion | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-09-3 | 09 | 4 | ASM-06, ASM-07 | T-10-05, T-10-26, T-10-04, T-10-02, T-10-03, T-10-27 | Released-only corrections with reason; learner draft exclusion | unit / AST | `npx vitest run tests/grade-override-service.test.ts tests/learner-results-service.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-10-1 | 10 | 4 | ASM-01 | T-10-07, T-10-28, T-10-22 | Accessible question reorder and validated staff settings | schema / type / lint / build | `npx tsc --noEmit && npx eslint src/components/catalogue/QuestionBuilder.tsx` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-10-2 | 10 | 4 | ASM-01 | T-10-07, T-10-28, T-10-22 | Accessible question reorder and validated staff settings | schema / type / lint / build | `npx tsc --noEmit && npx next build` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-10-3 | 10 | 4 | ASM-01 | T-10-07, T-10-28, T-10-22 | Accessible question reorder and validated staff settings | route / component | `npx vitest run --project components tests/components/question-builder.test.tsx` | Yes | Passed; final tests/type/lint/build green |
| 10-11-1 | 11 | 4 | ASM-01, ASM-02, ASM-07 | T-10-22, T-10-01, T-10-02, T-10-29 | Actor-derived quiz action; no pre-submit correct answers | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-11-2 | 11 | 4 | ASM-01, ASM-02, ASM-07 | T-10-22, T-10-01, T-10-02, T-10-29 | Actor-derived quiz action; no pre-submit correct answers | schema / type / lint / build | `npx tsc --noEmit && npx next build` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-11-3 | 11 | 4 | ASM-01, ASM-02, ASM-07 | T-10-22, T-10-01, T-10-02, T-10-29 | Actor-derived quiz action; no pre-submit correct answers | route / component | `npx vitest run tests/learner-quiz-attempt-route.test.ts && npx vitest run --project components tests/components/quiz-attempt-panel.test.tsx` | Yes | Passed; final tests/type/lint/build green |
| 10-12-1 | 12 | 4 | ASM-05 | T-10-03, T-10-09, T-10-30, T-10-24, T-10-31 | Cohort-bound queue and transaction-long batch state | schema / type / lint / build | `npx tsc --noEmit && npx eslint "src/app/staff/cohorts/[id]"` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-12-2 | 12 | 4 | ASM-05 | T-10-03, T-10-09, T-10-30, T-10-24, T-10-31 | Cohort-bound queue and transaction-long batch state | schema / type / lint / build | `npx tsc --noEmit && npx next build` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-12-3 | 12 | 4 | ASM-05 | T-10-03, T-10-09, T-10-30, T-10-24, T-10-31 | Cohort-bound queue and transaction-long batch state | route / component | `npx vitest run tests/grading-routes.test.ts && npx vitest run --project components tests/components/grading-queue-table.test.tsx` | Yes | Passed; final tests/type/lint/build green |
| 10-13-1 | 13 | 5 | ASM-05, ASM-06 | T-10-05, T-10-26, T-10-03, T-10-23, T-10-20, T-10-32 | Authorized draft save before release; released-only override | schema / type / lint / build | `npx tsc --noEmit && npx eslint "src/app/staff/cohorts/[id]/grading"` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-13-2 | 13 | 5 | ASM-05, ASM-06 | T-10-05, T-10-26, T-10-03, T-10-23, T-10-20, T-10-32 | Authorized draft save before release; released-only override | schema / type / lint / build | `npx tsc --noEmit && npx next build` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-13-3 | 13 | 5 | ASM-05, ASM-06 | T-10-05, T-10-26, T-10-03, T-10-23, T-10-20, T-10-32 | Authorized draft save before release; released-only override | route / component | `npx vitest run tests/grade-entry-routes.test.ts && npx vitest run --project components tests/components/grade-entry-client.test.tsx` | Yes | Passed; final tests/type/lint/build green |
| 10-14-1 | 14 | 5 | ASM-03, ASM-04 | T-10-19, T-10-33, T-10-02, T-10-18, T-10-34 | Verified upload receipt; learner ownership and cutoff | schema / type / lint / build | `npx tsc --noEmit` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-14-2 | 14 | 5 | ASM-03, ASM-04 | T-10-19, T-10-33, T-10-02, T-10-18, T-10-34 | Verified upload receipt; learner ownership and cutoff | schema / type / lint / build | `npx tsc --noEmit && npx next build` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-14-3 | 14 | 5 | ASM-03, ASM-04 | T-10-19, T-10-33, T-10-02, T-10-18, T-10-34 | Verified upload receipt; learner ownership and cutoff | route / component | `npx vitest run tests/learner-submission-route.test.ts && npx vitest run --project components tests/components/assignment-submission-panel.test.tsx` | Yes | Passed; final tests/type/lint/build green |
| 10-15-1 | 15 | 5 | ASM-07 | T-10-04, T-10-02, T-10-35, T-10-27 | Owner-scoped obligations and released results only | schema / type / lint / build | `npx tsc --noEmit && npx next build` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-15-2 | 15 | 5 | ASM-07 | T-10-04, T-10-02, T-10-35, T-10-27 | Owner-scoped obligations and released results only | schema / type / lint / build | `npx tsc --noEmit && npx next build` | N/A (tool gate) | Passed; final tests/type/lint/build green |
| 10-15-3 | 15 | 5 | ASM-07 | T-10-04, T-10-02, T-10-35, T-10-27 | Owner-scoped obligations and released results only | unit / AST | `npx vitest run tests/learner-results-page.test.ts tests/enrolment-dashboard-service.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-16-1 | 16 | 5 | ASM-04, ASM-05, ASM-06, ASM-07 | T-10-19, T-10-03, T-10-09, T-10-04, T-10-05 | Real PostgreSQL/MinIO persistence and security regressions | PostgreSQL / MinIO integration | `npx vitest run tests/submission-service.integration.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-16-2 | 16 | 5 | ASM-04, ASM-05, ASM-06, ASM-07 | T-10-19, T-10-03, T-10-09, T-10-04, T-10-05 | Real PostgreSQL/MinIO persistence and security regressions | PostgreSQL / MinIO integration | `npx vitest run tests/grading-service.integration.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-16-3 | 16 | 5 | ASM-04, ASM-05, ASM-06, ASM-07 | T-10-19, T-10-03, T-10-09, T-10-04, T-10-05 | Real PostgreSQL/MinIO persistence and security regressions | PostgreSQL / MinIO integration | `npx vitest run tests/learner-results.integration.test.ts` | Yes | Passed; final tests/type/lint/build green |
| 10-17-1 | 17 | 6 | ASM-01, ASM-02, ASM-03, ASM-04, ASM-05, ASM-06, ASM-07 | T-10-17, T-10-05, T-10-02, T-10-07, T-10-36, T-10-37 | Executable architecture boundaries; complete gates; explicit human evidence | unit / AST | `npx vitest run tests/assessment-phase-invariants.test.ts` | Yes | Passed: 11/11 |
| 10-17-2 | 17 | 6 | ASM-01, ASM-02, ASM-03, ASM-04, ASM-05, ASM-06, ASM-07 | T-10-17, T-10-05, T-10-02, T-10-07, T-10-36, T-10-37 | Executable architecture boundaries; complete gates; explicit human evidence | schema / type / lint / build | `npm test` | N/A (tool gate) | Passed automated gates |
| 10-17-3 | 17 | 6 | ASM-01, ASM-02, ASM-03, ASM-04, ASM-05, ASM-06, ASM-07 | T-10-17, T-10-05, T-10-02, T-10-07, T-10-36, T-10-37 | Executable architecture boundaries; complete gates; explicit human evidence | human | `Manual: walkthrough steps 1-30` | N/A (human) | Pending observations |

## Wave 0 Requirements

- [x] tests/quiz-scoring.test.ts - plan 10-02; resolved partial-credit MULTI_CHOICE scoring.
- [x] tests/assessment-service.test.ts - plan 10-03; ASM-01 and ASM-03.
- [x] tests/attempt-service.integration.test.ts - plan 10-06; real PostgreSQL attempt evidence.
- [x] tests/submission-service.integration.test.ts - plan 10-16; PostgreSQL and MinIO verified receipts.
- [x] tests/grading-service.integration.test.ts - plan 10-16; cohort scope, draft visibility and batch release.
- [x] tests/grade-override-service.test.ts - plan 10-09; released-only correction and mandatory reason.
- [x] tests/learner-results.integration.test.ts - plan 10-16; RELEASED-only learner reads.
- [x] prisma/migrations/20260915124116_add_attempt_grading_method/migration.sql - plan 10-01; additive AttemptGradingMethod migration.
- [x] Existing Vitest and Docker fixtures reused; no framework installation needed.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Long assessment titles and question prompts | ASM-01, ASM-02 | Real viewport wrapping and alignment | Step 28: author long title/prompt; inspect narrow and wide views, sticky counter and option alignment. |
| Multi-paragraph feedback wrapping and scrolling | ASM-05, ASM-07 | Actual card overflow and page width | Step 29: release several paragraphs; inspect staff grade entry and learner results for wrapping, scrolling and unchanged page width. |
| Large batch pending state | ASM-05 | Perceived responsiveness over a real transaction | Step 30: select many draft grades; confirm pending feedback lasts throughout the transaction and every selected row resolves. |
| Real-world MULTI_CHOICE labels and file-type chips | ASM-01, ASM-03 | Real content length and viewport fit | During steps 3 and 12, use long option labels and several allowed types; check keyboard focus, wrapping and readability on a narrow viewport. |

All four remain pending explicit human observations. Task 10-17-3 requires observations for all thirty walkthrough steps, including security steps 8, 20 and 25.

## Automated Gate Results

- Architecture: 11/11 passed, 3.38 seconds.
- Focused baseline component corrections: 81/81 passed, 76.11 seconds.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` exited 0.
- Full tests: 188/188 files passed; 2,614 tests passed, zero failures, one existing skipped audit-table 360 px reflow manual gate; 953.36 seconds. Report: .planning/phase10-final-tests.json. An earlier mixed-thread run exited before producing a report and is not counted as passing. Its upload happy-path case also exceeded the default five-second budget; the fresh full run passed all eleven upload cases (happy path 755 ms). The fresh run preserves node process isolation and allows 30 seconds per external-system case.
- Repository lint: 0 errors, 12 warnings across 495 files.
- Final production build: passed; Turbopack compiled in 25.2 seconds, TypeScript finished in 59 seconds, and all 29 static pages generated.

### Recorded implementation adjustments

DD-15 permits erased Actor type imports, matching the existing Phase 9 gate. Wave 4 supports an enrolment disambiguation hint validated against the actor's ACTIVE owned set; the invariant protects that derivation rather than banning a supported parameter. Grade-write gates use lexical guard ordering plus behavioral tests, and reserve GradeOverride creation to the override service. Prisma has no installed public AST parser, so the schema gate scans declaration tokens with comments excluded; migration suites exercise actual DDL.

The final gate also exposed regressions: currency assertions assumed a US locale; readiness assertions omitted the deliberately added Grading category; enrolment scope reads escaped the injected Prisma client. These were corrected and remain subject to the complete regression run.

## Validation Sign-Off

- [x] Every automated task's final verification is green. Task 10-17-3 is an explicit blocking human exception, not an automated test.
- [x] Sampling continuity: no three consecutive tasks lack automated verification.
- [x] Wave 0 covers all research MISSING references.
- [x] No watch-mode commands.
- [x] Full feedback latency measured and recorded: 953.36 seconds.
- [x] Full suite, TypeScript, lint and build green.
- [ ] Human walkthrough and all four UI observations recorded.
- [ ] nyquist_compliant may be set true only after the outstanding evidence is resolved.

**Approval:** Automated gates passed 2026-09-16; human observations pending.

### Additional defects reproduced and fixed

- Fixed True/False options registered as draggable without drag handles; now explicitly disabled, verified by eight component cases (96549af).
- A stale draft save could downgrade a concurrently released grade; a PostgreSQL regression reproduced the score and status corruption. The update now atomically requires DRAFT, translating a lost race into GradeAlreadyReleasedError. Forty grading/invariant checks passed (e1e7aff).
- Upload start chose the first covering enrolment rather than the enrolment displayed on the assignment page. The actor-owned selector now reaches the existing ACTIVE-set resolver; foreign selectors are refused. Fifty-five service/action/invariant cases and nine submission-panel cases passed (e68338b).

## Human checkpoint readiness

The separate local lms_phase10_uat database has all three quiz question types, a PDF-only assignment with past due date and open hard cutoff, linked assessment lessons, pinned course/programme publications, open learner access windows, an Administrator with all required permissions, two named enrolled learners, and twenty extra local-file-backed draft grades. The real learner-access and owner-scoped assignment services confirmed both lesson links are open and the draft count is 20. The remote development database was inspected read-only and was not changed.

The thirty-step instructions and observation table are in 10-17-WALKTHROUGH.md. No walkthrough step or visual backstop is counted as passed; nyquist_compliant remains false while that evidence is outstanding.
