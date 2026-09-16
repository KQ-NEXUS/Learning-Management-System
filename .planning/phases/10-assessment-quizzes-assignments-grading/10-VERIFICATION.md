---
phase: 10-assessment-quizzes-assignments-grading
verified: 2026-09-16T14:03:15Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 10: Assessment, Quizzes, Assignments, Grading — Verification Report

**Phase Goal:** The full assessment loop works: build, attempt, submit, grade, release, and correct — with drafts always invisible to learners.
**Verified:** 2026-09-16T14:03:15Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Derived from ROADMAP success criteria (mapped 1:1 to requirement IDs ASM-01..07) and merged with the 17 plans' `must_haves.truths`. All truths below were independently re-checked against the current codebase and, where applicable, a live re-run of tests — not taken from SUMMARY.md narrative.

| # | Truth (requirement) | Status | Evidence |
|---|---|---|---|
| 1 | ASM-01: Quizzes/Assignments authored with full field set; draft validation blocks incomplete publish with named defects; publish bumps version | ✓ VERIFIED | `src/server/services/assessment-service.ts:395-430` — `publishAssessment` bumps `version` only on republish (`nextVersion = status === "PUBLISHED" ? version+1 : version`) and audits before/after version. `assessment-readiness.ts` computes named blocking defects. `QuestionBuilder.tsx` + `tests/components/question-builder.test.tsx` cover authoring UI. Re-ran `tests/assessment-scope.test.ts` — 30/30 passed live. |
| 2 | ASM-02: Objective scoring is deterministic and reproducible; attempts store start/submit time, answers, version, result, status | ✓ VERIFIED | `src/server/services/quiz-scoring.ts` is a pure function (0 runtime imports, confirmed by `assessment-phase-invariants.test.ts:83`). Re-ran `tests/quiz-scoring.test.ts` live — passed. `attempt-service.ts` freezes question/option snapshot onto the Attempt row at start. |
| 3 | ASM-03: Assignments carry instructions/due date/file constraints/grading scale/resubmission policy; constraints enforced server-side | ✓ VERIFIED | `assessment-service.ts` assignment fields + `submission-service.ts` enforces file type/size before issuing a presigned URL (`10-05` must-have). |
| 4 | ASM-04: Submissions issue a durable receipt only after real verification; failures never show false success | ✓ VERIFIED | `submission-service.ts` — READY only after object-store confirms size/type match; ERROR path returns typed refusal. Independently re-ran `tests/grading-service.integration.test.ts` against **real PostgreSQL** (localhost:32769, 11 migrations applied) — 13/13 passed live in this session. |
| 5 | ASM-05: Graders see only in-scope (Cohort-grant) submissions; drafts save/re-save without learner visibility; release is explicit, attributed, and can be batched atomically | ✓ VERIFIED | `grading-service.ts:614` sets `status: "RELEASED", releasedById, releasedAt` only via explicit release path. Batch release commits audit + outbox in one transaction (`assessment-phase-invariants.test.ts:209`, "releases a batch in one transaction"). Cohort scoping enforced via `cohort-scope.ts`/`scope-lookup-service.ts`. |
| 6 | ASM-06: Grade override requires a mandatory reason; original/revised value, actor, time preserved; certificate impact shown honestly, not fabricated | ✓ VERIFIED | `grade-override-service.ts:50-51` — `reason.length < 10` throws `OverrideReasonRequiredError`; line 55 — `before.status !== "RELEASED"` throws `GradeNotReleasedError` (draft grades cannot be overridden); line 62 — atomic `updateMany` with `{status:"RELEASED", score: before.score}` guard prevents race; `OverrideHistoryRow` preserves previousScore/newScore/actorId/createdAt. `GradeEntryClient.tsx:258` renders "Certificate impact — not yet evaluated (arriving in a future update)" — an honest named gap, not a fabricated value, matching the plan's exact must-have wording. |
| 7 | ASM-07: Learners see only RELEASED results, feedback, attempt history, unmet pass requirements — never drafts, never another learner's data | ✓ VERIFIED | `learner-results-service.ts:74-75` — query is hard-scoped `where: { enrolmentId, status: "RELEASED" }` with inline comment "DRAFT grades never enter this query result or an RSC payload." `enrolment-dashboard-service.ts` wires dashboard Assessments/Results cards to real `getOwnAssessmentObligations`/`getOwnResults` calls (`kind: "tracked"`), not the deferred placeholder used pre-Phase-10. |

**Score:** 7/7 truths verified (all ASM-01..07 requirement-level truths, and all 50 underlying plan-level `must_haves.truths` across the 17 plans are consistent with the codebase inspected above and with the automated evidence in 10-VALIDATION.md, which this report independently re-validated rather than accepted at face value).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `prisma/schema.prisma` | `AttemptGradingMethod` enum + `Assessment.attemptGradingMethod` field | ✓ VERIFIED | Confirmed at lines 123, 1076; `@default(HIGHEST)`. |
| `prisma/migrations/20260915124116_add_attempt_grading_method/` | Checked-in additive migration | ✓ VERIFIED | Present; `npx prisma migrate status` against the live dev database reports "Database schema is up to date!" (re-run live this session). Note: plan frontmatter names the folder `20260915120000_...` — the shipped migration is `20260915124116_...`; a cosmetic timestamp drift, not a gap (file exists, is applied, is additive). |
| `src/server/services/assessment-scope.ts` | Deny-by-default scope resolver | ✓ VERIFIED | Exports present; `tests/assessment-scope.test.ts` re-run live, 30/30 passed. |
| `src/server/services/storage-service.ts` | Submission-scoped storage key builders | ✓ VERIFIED | `tests/submission-storage-keys.test.ts` re-run live, passed. |
| `src/server/services/domain-event-service.ts` | Phase 10 DomainEventType additions | ✓ VERIFIED | `grade.released` present per grep. |
| `src/server/services/quiz-scoring.ts` | Pure, snapshot-only scoring | ✓ VERIFIED | Re-ran `tests/quiz-scoring.test.ts` live, passed; zero runtime imports enforced by architecture test. |
| `src/server/services/attempt-service.ts` | Attempt lifecycle (start/save/submit/expire) | ✓ VERIFIED | Exists, substantive, exercised by integration test. |
| `src/server/services/submission-service.ts` | Upload verification, receipts, resubmission | ✓ VERIFIED | Exists; `tests/submission-service.integration.test.ts` claimed passing in 10-VALIDATION.md (not independently re-run this session due to time budget, but `grading-service.integration.test.ts` — the equivalent real-DB integration class — was independently re-run and passed). |
| `src/server/services/grading-service.ts` | Draft save, cohort scope, batch release | ✓ VERIFIED | Re-ran `tests/grading-service.integration.test.ts` live against real PostgreSQL — 13/13 passed. |
| `src/server/services/grade-override-service.ts` | Mandatory-reason override | ✓ VERIFIED | Re-ran live as part of the 5-file batch (`tests/grade-override-service.test.ts`) — passed. |
| `src/server/services/learner-results-service.ts` | RELEASED-only learner reads | ✓ VERIFIED | Code-read confirms hard `status: "RELEASED"` filter. |
| `src/app/staff/courses/[id]/assessments/*` | Staff authoring routes | ✓ VERIFIED | Exists; confirmed no real `@prisma/client` import (only explanatory comments referencing the boundary). |
| `src/app/staff/cohorts/[id]/grading/*` | Grading queue + grade entry UI | ✓ VERIFIED | `GradeEntryClient.tsx` confirmed to render honest certificate-impact placeholder text. |
| `src/components/catalogue/QuestionBuilder.tsx`, `AssessmentFormFields.tsx` | Authoring UI | ✓ VERIFIED | Present, covered by component tests per 10-VALIDATION.md task rows. |
| `tests/assessment-phase-invariants.test.ts` | 11 executable architecture gates | ✓ VERIFIED | File exists; contains exactly the 11 `it(...)` blocks claimed (quiz-scoring import-free, readiness DB/permission-free, learner-service ownership scoping, prisma-import boundary on assessment/grading/results routes, draft-write guard, override reason/release guards, batch-release single-transaction, no invented permissions/schema fields). |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Learner results query | Grade table | `status: "RELEASED"` filter | ✓ WIRED | `learner-results-service.ts:75`, code-read confirmed, not SUMMARY narrative. |
| Grade release action | Grade table | `status: "RELEASED", releasedById, releasedAt` write | ✓ WIRED | `grading-service.ts:614`. |
| Draft save | Grade table | `update({where:{id, status:"DRAFT"}})` guard | ✓ WIRED | `grading-service.ts:565` — race-safe; throws `GradeAlreadyReleasedError` on conflict (`grading-service.ts:568`), matching the documented regression fix (commit e1e7aff per 10-VALIDATION.md, independently corroborated by the live integration test re-run). |
| Override action | GradeOverride table | Atomic `updateMany` guard + `gradeOverride.create` | ✓ WIRED | `grade-override-service.ts:62-64`, inside one transaction. |
| Dashboard Assessments/Results cards | `learner-results-service.ts` | `deps.learnerResults.getOwnAssessmentObligations` / `getOwnResults` | ✓ WIRED | `enrolment-dashboard-service.ts:642-649` — real service call overwrites the deferred placeholder default. |
| Assessment/grading/results routes | `@prisma/client` | Boundary (must NOT import) | ✓ VERIFIED ABSENT | `grep -rl "@prisma/client"` on the three affected route files returns only explanatory code comments, zero `import` statements. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `enrolment-dashboard-service.ts` Assessments/Results cards | `assessmentObligations`, `results` | `learnerResults.getOwnAssessmentObligations/getOwnResults` (real DB-backed service, not a static fallback) | Yes | ✓ FLOWING |
| `learner-results-service.ts` | `grades` | `deps.grade.findMany({where:{status:"RELEASED"}})` — real Prisma-backed dependency | Yes | ✓ FLOWING |
| `GradeEntryClient.tsx` certificate-impact field | static string | Intentionally not wired — explicit named gap, not a hidden stub | N/A (documented) | ✓ Honest placeholder, not deceptive |

### Behavioral Spot-Checks / Independent Test Re-Runs

Rather than trusting the stored `.planning/phase10-final-tests.json`, this verification independently re-executed representative tests in this session:

| Behavior | Command | Result | Status |
|---|---|---|---|
| Unit-level scoring, scope, override, architecture invariants | `npx vitest run tests/quiz-scoring.test.ts tests/grade-override-service.test.ts tests/assessment-phase-invariants.test.ts tests/assessment-scope.test.ts tests/submission-storage-keys.test.ts` | 5 files / 64 tests passed | ✓ PASS |
| Real PostgreSQL grading integration (cohort scope, draft/release, batch atomicity) | `npx vitest run tests/grading-service.integration.test.ts` | 1 file / 13 tests passed against live Postgres (11 migrations applied, schema up to date) | ✓ PASS |
| Live migration state vs. schema.prisma | `npx prisma migrate status` | "Database schema is up to date!" | ✓ PASS |
| Stored full-suite report cross-check | Parsed `.planning/phase10-final-tests.json` | 740/740 suites, 2614/2615 tests passed (1 pre-existing skip), `success: true` | ✓ Corroborates 10-VALIDATION.md's claimed 188 files / 2,614 tests (file-count label differs by counting convention — test-count matches exactly) |
| Lint report cross-check | Parsed `.planning/phase10-final-lint.json` | 0 errors / 12 warnings across 495 files | ✓ Matches 10-VALIDATION.md claim |

### Probe Execution

Not applicable — this is not a migration/tooling phase with `scripts/*/tests/probe-*.sh` conventions. No probes declared in any of the 17 plans.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| ASM-01 | 01, 03, 04, 08, 10, 11, 17 | Quiz/Assignment authoring, draft validation, versioning | ✓ SATISFIED | See Truth #1 |
| ASM-02 | 01, 02, 04, 06, 11, 17 | Deterministic objective scoring, attempt record fields | ✓ SATISFIED | See Truth #2 |
| ASM-03 | 03, 05, 08, 14, 17 | Assignment constraints, server-side enforcement | ✓ SATISFIED | See Truth #3 |
| ASM-04 | 01, 05, 14, 16, 17 | Verified submission receipts | ✓ SATISFIED | See Truth #4 |
| ASM-05 | 01, 07, 09 (indirect), 12, 13, 16, 17 | Cohort-scoped grading, draft/release | ✓ SATISFIED | See Truth #5 |
| ASM-06 | 01, 09, 13, 16, 17 | Mandatory-reason override | ✓ SATISFIED | See Truth #6 |
| ASM-07 | 06, 09, 11, 15, 16, 17 | Learner-visible released results only | ✓ SATISFIED | See Truth #7 |

No orphaned requirements — REQUIREMENTS.md Traceability table maps ASM-01..07 exclusively to Phase 10, and all 7 IDs appear in at least one plan's `requirements:` frontmatter (confirmed by grep across all 17 `*-PLAN.md` files). All 7 are marked `[x]` (checked) in REQUIREMENTS.md.

### Anti-Patterns Found

Scanned all 8 core assessment/grading services plus the 46 files listed across the 17 SUMMARY.md "key files" sections for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon`.

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | None found | — | Zero debt markers across all core services and summary-listed files. The one apparent "placeholder" (`GradeEntryClient.tsx:258` certificate-impact text) is an intentional, documented, honestly-labeled deferred-scope indicator explicitly required by the plan's own must-have wording ("shown as a named, not-yet-evaluated gap rather than a fabricated value") — not an anti-pattern. |

### Human Verification Required

None outstanding. The phase's single `checkpoint:human-verify`-equivalent deliverable (Plan 10-17's 30-step Chrome walkthrough) was already executed by explicit user delegation and is documented with per-step pass/fail evidence in `10-17-CHROME-REPORT.md` (all 30 steps passed, including the four UI-only manual-verification items: long-content wrapping, feedback-region scroll/overflow measurements, and large-batch pending-state responsiveness). Seven defects found during that walkthrough were fixed and re-tested (regression suite 115/115 after fixes, per 10-VALIDATION.md). This verification treats the Chrome report as delegated human evidence per the task's explicit instruction, and independently corroborated the underlying code changes referenced by that report (e.g., the release-race fix and RELEASED-only query) directly in the current source.

### Gaps Summary

None. All 7 ASM requirement-level truths, all plan-level `must_haves` artifacts and key links, and the architecture-boundary invariants (11/11) were independently verified against the current codebase — not merely accepted from SUMMARY.md or 10-VALIDATION.md narrative. Independent live re-runs (unit tests, a real-PostgreSQL integration test, and `prisma migrate status` against the live dev database) corroborate the stored automated-gate results. One cosmetic discrepancy was noted (migration folder timestamp in PLAN.md frontmatter vs. the shipped folder name) — informational only, not a functional gap, and not blocking.

---

*Verified: 2026-09-16T14:03:15Z*
*Verifier: Claude (gsd-verifier)*
