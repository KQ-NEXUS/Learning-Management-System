---
phase: 10-assessment-quizzes-assignments-grading
plan: 12
subsystem: ui
status: complete
tags: [grading, cohorts, batch, server-actions]
provides:
  - Cohort Grading tab and scoped assignment submission queues
  - Confirmed whole-selection batch release through ResourceTable
key-files:
  created:
    - src/app/staff/cohorts/[id]/GradingTab.tsx
    - src/app/staff/cohorts/[id]/grading-actions.ts
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/page.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable.tsx
    - tests/components/grading-queue-table.test.tsx
    - tests/grading-routes.test.ts
  modified:
    - src/app/staff/cohorts/[id]/page.tsx
    - tests/components/cohort-pages.test.tsx
requirements-completed: [ASM-05]
completed: 2026-09-15
---

# Plan 10-12 Summary

**Cohort graders can open assignment queues and release a whole selection in one confirmed action, with server-side cohort checks and accurate skip reporting.**

## Delivered

- Compact assignment-only summary list with the authored empty state, reached from a Cohort detail tab without a new top-level navigation entry.
- Persistent cohort/assessment scope banner and service-backed queue reads. Authorization denial does not confirm resource existence.
- Existing ResourceTable selection, native segmented status filter, mono timestamps/scores, conditional late/status pills and grade-entry row links.
- Strict nonempty/capped action schema; supplied IDs must belong to the submitted cohort's visible queues. The release service is called once with the full array, including stale already-released rows.
- Existing ConfirmModal with default tone, no mandatory reason, pending transaction feedback, error handling, selection clearing and returned skip count. Revalidation carries the refreshed table; no client follow-up refresh.

## Verification

- Queue components: 5/5; batch action boundary: 5/5, covering batch size, one call, cross-cohort rejection and authorization errors.
- Combined new component suites: 20/20; unit regression: 117 files / 1,943 tests passed.
- TypeScript, changed-file lint, worktree webpack build and integrated Turbopack build passed.
- Existing cohort-page tests: 8/9 passed after adding the sibling-tab mock; unchanged USD locale expectation remains a known baseline failure.

## Execution notes

Dependency-derived GSD wave indexing scheduled this plan with 10-09/10-10/10-11, because it depends only on 10-07; its declared frontmatter/ROADMAP wave is 5. The Grading tab is added after the existing Overview/Sessions/Roster/Exceptions tabs, preserving all existing tabs. Grade-entry targets are implemented by plan 10-13.

## Self-Check: PASSED

Implementation and tests are integrated into Khaliddev (9543877). Remaining integration/human verification belongs to 10-16/10-17.
