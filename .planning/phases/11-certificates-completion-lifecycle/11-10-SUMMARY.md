---
phase: 11-certificates-completion-lifecycle
plan: 10
subsystem: certificates
tags: [certificates, completion, attendance, grading, crd-06, import-closure]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "Plan 11-07's recalculateCompletionAndIssue, flagCertificateForReview, reactToCompletionResults, and CertificateIssuanceTxClient"
provides:
  - "Lesson completion and attendance corrections now issue/re-evaluate certificates through a one-line composition-root default-parameter swap"
  - "flagCertificatesForGradeCorrection: grade overrides flag the affected certificate for review inside the same transaction, without re-deriving a completion verdict"
  - "Closure guards proving the Stripe webhook, pdf-lib, and enrolment-transitions.ts import graphs did not regress from this wiring"
affects: [11-11, 11-16]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composition-root default-parameter swap: aliasing the replacement import to the original local binding name keeps the diff to the import line + default value only, with zero call-site changes"
    - "Shared flag-write helper (flagCertificateForReview) extended with an optional context field so a second caller (grade correction) can carry extra audit/event context without a second implementation"

key-files:
  created: []
  modified:
    - src/server/services/lesson-progress-service.ts
    - src/server/services/attendance-service.ts
    - src/server/services/grade-override-service.ts
    - src/server/services/certificate-issuance-service.ts
    - tests/boundary.test.ts
    - tests/certificate-issuance-service.test.ts
    - tests/grade-override-service.test.ts
    - tests/grading-service.integration.test.ts
    - tests/learner-results.integration.test.ts

key-decisions:
  - "Imported recalculateCompletionAndIssue aliased as recalculateCompletion in both lesson-progress-service.ts and attendance-service.ts, so only the import specifier and the default-parameter value change — zero call-site edits in either file"
  - "GradeOverrideDeps.reactToGradeOverride carries an actorId the plan's literal 3-field type omitted (Rule 2) — required so the certificate audit row attributes the overriding staff member, not SYSTEM (T-11-42)"
  - "flagCertificateForReview grew an optional context field (folded into the audit row's after and the domain event payload) so flagCertificatesForGradeCorrection reuses it rather than writing a second flag implementation"
  - "liveIssuanceDeps exported from certificate-issuance-service.ts so grade-override-service.ts's composition root binds the same live audit/event writers instead of a second, independently-drifting copy"

patterns-established:
  - "A default-parameter swap at a composition root is the seam of choice for wiring a new reactive concern into an existing service without that service ever importing or knowing about the new concern"

requirements-completed: [CRD-01, CRD-02, CRD-06]

# Metrics
duration: 40min
completed: 2026-09-18
---

# Phase 11 Plan 10: Wire Completion, Attendance, and Grade Corrections into Certificates Summary

**Completing the last required lesson or correcting attendance now issues/re-evaluates a certificate through a one-line composition-root default-parameter swap; overriding a released grade flags the affected certificate for review inside the same transaction without ever calling the completion engine — and three new closure assertions prove none of this widened the Stripe webhook's or enrolment-transitions.ts's import graph.**

## Performance

- **Duration:** ~40 min (plus one ~17 min full-suite `npm test` run consumed by this sandbox's lack of Docker/testcontainers, not by plan work)
- **Started:** 2026-09-18T14:25Z (session start)
- **Completed:** 2026-09-18T15:09Z
- **Tasks:** 3/3
- **Files modified:** 9

## Accomplishments
- `lesson-progress-service.ts` and `attendance-service.ts` each swap their `recalculateCompletionDep` default from the bare completion engine to `certificate-issuance-service.ts`'s `recalculateCompletionAndIssue`, imported aliased to the original local name — no call site in either file changed.
- `flagCertificatesForGradeCorrection` (certificate-issuance-service.ts) flags the enrolment's `ACTIVE` certificate's `reviewFlaggedAt`, reverts a `COMPLETED` enrolment to `ACTIVE` via `assertTransition`, and never touches `status`/`verificationRef`/`issuedAt`/`storageKey` — reusing `flagCertificateForReview` rather than a second flag-write implementation.
- `grade-override-service.ts`'s `overrideGrade` calls the new `reactToGradeOverride` dependency inside its existing transaction, immediately after `writeEvent` and before the final `gradeOverride.findMany` read, so a rollback of the grade update rolls back the flag with it.
- `tests/boundary.test.ts` gained three permanent closure assertions: the Stripe webhook's closure stays free of the permission choke point and the PDF/certificate stack; `pdf-lib` has exactly one importer under `src/` (set equality); `enrolment-transitions.ts`'s own closure stays free of `next/*` and the permission choke point.

## Task Commits

Each task was committed atomically:

1. **Task 1: Swap the composition-root dependency in lesson-progress and attendance** - `84fd385` (feat)
2. **Task 2: The grade-correction hook — flag, never re-derive** - `e24da2c` (feat)
3. **Task 3: Import-closure guard for the new wiring** - `89b738a` (test)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `src/server/services/lesson-progress-service.ts` - `recalculateCompletionDep` default swapped to the certificate-aware wrapper (aliased import), plus a one-line comment citing D-03/CRD-06
- `src/server/services/attendance-service.ts` - identical swap
- `src/server/services/certificate-issuance-service.ts` - `flagCertificatesForGradeCorrection` (new export), `FlagCertificateForReviewArgs.context` (new optional field, folded into the audit `after` and event payload), `liveIssuanceDeps` now exported
- `src/server/services/grade-override-service.ts` - `GradeOverrideDeps.reactToGradeOverride` (new required dep, includes `actorId`), call site inside `overrideGrade`'s transaction, live composition-root binding, corrected header comment
- `tests/boundary.test.ts` - three new closure assertions (webhook/PDF, pdf-lib single-importer, enrolment-transitions.ts isolation)
- `tests/certificate-issuance-service.test.ts` - new `"grade correction"` describe block, 9 cases covering all plan behaviors (including a transactional-rollback case beyond the plan's literal 8)
- `tests/grade-override-service.test.ts` - fakes updated with `reactToGradeOverride`; new case asserting its call args; existing guard-failure cases extended to assert it is not called
- `tests/grading-service.integration.test.ts`, `tests/learner-results.integration.test.ts` - added a no-op `reactToGradeOverride` fake to keep compiling against the new required dep slot (out of scope for either file's own behavior)

## Decisions Made
- Aliased `recalculateCompletionAndIssue as recalculateCompletion` on import in both `lesson-progress-service.ts` and `attendance-service.ts`, so the default-parameter line's text is unchanged and the plan's `grep -c "recalculateCompletionAndIssue" ... returns 1` criterion is satisfied by the import line alone.
- Extended `GradeOverrideDeps.reactToGradeOverride`'s args with a required `actorId: string` beyond the plan's literal 3-field (`enrolmentId`/`assessmentId`/`passedChanged`) signature — see Deviations.
- Extended `FlagCertificateForReviewArgs` with an optional `context?: Record<string, unknown>` field (folded into the audit row's `after` and the domain event's payload) so `assessmentId`/`passedChanged` ride along as context without a second flag-write implementation, matching the plan's explicit "share, do not duplicate" instruction.
- Exported `liveIssuanceDeps` from `certificate-issuance-service.ts` so `grade-override-service.ts`'s composition root reuses the same live audit/event writers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `actorId` to `reactToGradeOverride`'s injected args**
- **Found during:** Task 2
- **Issue:** The plan's literal dependency-slot signature (`(tx, args: { enrolmentId; assessmentId; passedChanged }) => Promise<void>`) has no way to carry the overriding staff member's identity into the certificate audit row. Without it, the only options were to hardcode `SYSTEM_ACTOR_TYPE` (explicitly forbidden — "not `SYSTEM`, because a human requested this correction") or fabricate an actor, neither of which satisfies T-11-42's repudiation mitigation ("A flag with no attributable actor").
- **Fix:** Added a required `actorId: string` field to the dependency's args type; `overrideGrade`'s call site passes `ctx.actor.userId` (already in scope inside the transaction closure).
- **Files modified:** `src/server/services/grade-override-service.ts`
- **Verification:** `tests/grade-override-service.test.ts`'s new case asserts `reactToGradeOverride` is called with `actorId: "user-1"`; `tests/certificate-issuance-service.test.ts`'s "grade correction" case 8 asserts the resulting audit row's `actorId` matches and `actorType` is `undefined` (not `SYSTEM`).
- **Committed in:** `e24da2c` (Task 2 commit)

**2. [Rule 3 - Blocking] Fixed two real-Postgres integration test files that construct `GradeOverrideDeps` directly**
- **Found during:** Task 2 (post-implementation `tsc --noEmit`)
- **Issue:** `tests/grading-service.integration.test.ts` and `tests/learner-results.integration.test.ts` each build a `GradeOverrideDeps` object literal; adding the new required `reactToGradeOverride` slot broke `tsc` for both.
- **Fix:** Added a no-op `reactToGradeOverride: async () => {}` fake to each — the certificate-flag hook is out of scope for either file's own behavior (grading correctness / learner-visible results respectively).
- **Files modified:** `tests/grading-service.integration.test.ts`, `tests/learner-results.integration.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0. Both files are real-Postgres integration suites gated on Docker/testcontainers, which this sandbox does not have (see Issues Encountered) — their own test bodies were not re-run against a live database this session, matching the same pre-existing gap documented for every other testcontainers-based suite in this repo.
- **Committed in:** `e24da2c` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical / Rule 2, 1 blocking / Rule 3)
**Impact on plan:** Both auto-fixes were necessary for correctness (an attributable actor on the certificate audit trail) and for the repository to keep compiling. No scope creep — nothing outside plan 11-10's three files-of-record and its two forced-touch integration test files was changed.

## Issues Encountered

- `npm test`'s full suite ran once mid-session and reported `25 failed | 173 passed (198)` test files / `1 failed | 2557 passed | 208 skipped (2766)` tests. Every visible failure was `Error: Could not find a working container runtime strategy` (testcontainers/Docker unavailable in this sandbox) across files unrelated to this plan (`publish.integration.test.ts`, `refund.integration.test.ts`, `reorder.integration.test.ts`, `schema-cohort.test.ts`, `schema-payment-split.test.ts`, `seat-accounting.integration.test.ts`, `submission-service.integration.test.ts`, and others), plus one `docker-email-config.test.ts` case that shells out to `docker compose` directly and times out. This matches the extensive pre-existing "Docker-BLOCKED" gap already documented throughout `STATE.md` for prior phases (06, 09, 10) — not a regression introduced by this plan. None of plan 11-10's own files (`lesson-progress-service.ts`, `attendance-service.ts`, `grade-override-service.ts`, `certificate-issuance-service.ts`, `boundary.test.ts`) appeared among the failures; all targeted runs of those files (individually and combined) were green, and `npx tsc --noEmit` exits 0 against the full repository.
- The two integration test files this plan was forced to touch (`grading-service.integration.test.ts`, `learner-results.integration.test.ts`) are themselves testcontainers-gated and could not be exercised against a live Postgres in this sandbox for the same reason — their fakes keep the repository compiling and their own pre-existing test bodies are otherwise unchanged by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CRD-01, CRD-02, and CRD-06 are now fully wired end to end: issuance triggers from lesson completion and attendance correction, and review-flagging triggers from completion supersession (plan 11-07) and grade correction (this plan).
- Plan 11-11 (staff-triggered manual issuance) can proceed — `issueCertificateForEnrolmentLive` and `liveIssuanceDeps` are both exported and stable.
- Plan 11-16's real-Postgres integration run is the right place to exercise `tests/grading-service.integration.test.ts` and `tests/learner-results.integration.test.ts` (and every other testcontainers-gated suite) against a live database in a Docker-enabled environment — none of that ran here.
- No blockers for downstream phases from this plan's own scope.

## Self-Check: PASSED

All key files present on disk and all four commits (`84fd385`, `e24da2c`, `89b738a`, `285ab7b`) found in `git log --oneline --all`.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
