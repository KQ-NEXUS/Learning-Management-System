---
phase: 10-assessment-quizzes-assignments-grading
plan: 09
subsystem: services
status: complete
tags: [grades, overrides, ownership, results]
provides:
  - Released-only audited grade correction with append-only history
  - Owned learner results and ordered outstanding assessment obligations
key-files:
  created:
    - src/server/services/grade-override-service.ts
    - src/server/services/learner-results-service.ts
    - tests/grade-override-service.test.ts
    - tests/learner-results-service.test.ts
  modified:
    - src/server/services/attempt-service.ts
    - src/server/services/submission-service.ts
requirements-completed: [ASM-06, ASM-07]
completed: 2026-09-15
---

# Plan 10-09 Summary

**Staff corrections preserve the original score and attribution; learners receive owned, released results without draft scores or staff email addresses.**

## Delivered

- Cohort-scoped `grades.manage` authorization, released-only correction, trimmed mandatory reason, integer score validation, recomputed pass verdict and unconditional `grade.overridden` event.
- Compare-and-set updates reject stale concurrent corrections before history/event/audit writes.
- Learner results query RELEASED grades in the database. Quiz effective scores use corrected grade values for HIGHEST/LATEST/AVERAGE; assignment history preserves receipts and late flags.
- Outstanding obligations follow pinned course/lesson order. Empty and unowned reads return empty arrays.
- Optional enrolment IDs disambiguate multiple owned enrolments and are matched only within the authenticated actor's ACTIVE enrolments.

## Verification

- Override and learner-results tests: 21 cases, including zero-write refusals, stale correction, draft invisibility, ownership, aggregation, feedback and attribution.
- Wave 4 unit regression: 117 files / 1,943 tests passed.
- Integrated focused server regression: 12 files / 136 tests passed before the final quiz refusal-copy case was added; that action suite subsequently passed 11/11.
- TypeScript, changed-file lint, worktree webpack build and integrated Turbopack build passed.

## Carry-forward

Certificate/completion impact remains the named Phase 11 event-consumer dependency. Results page composition is plan 10-15; staff override UI is plan 10-13. Global ASM-06/ASM-07 completion is not asserted by this service closeout.

## Self-Check: PASSED

Implementation is integrated into Khaliddev (9543877). Full-suite infrastructure and locale limitations are recorded in deferred-items.md.
