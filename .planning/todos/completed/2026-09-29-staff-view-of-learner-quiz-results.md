---
created: 2026-09-29T00:00:00.000Z
title: Let staff see a learner's quiz results in the cohort views (COH-07)
area: cohorts
source: v1.0 verification catch-up / UX batch A (05-VERIFICATION.md, COH-07)
files:
  - src/app/staff/cohorts/[id]/learners/[enrolmentId]/page.tsx
  - src/app/staff/cohorts/[id]/GradingTab.tsx
---

## Problem

COH-07 requires cohort-level views of each learner's assessment results. Assignment grades are
visible through the grading queue, but quiz results are not visible to staff anywhere: quizzes
auto-release, so they never enter a grading queue, and the per-learner progress page shows
lessons and attendance only. The roster's Assessment and Completion columns were removed earlier
because they only held placeholders.

## Suggested fix

Add a "Results" section to the staff per-learner page (`learners/[enrolmentId]`) listing each
assessment's effective score, pass/fail, attempts used and release state, scoped by
`submissions.view` with F-05's assessment-course narrowing. Then re-verify COH-07.
