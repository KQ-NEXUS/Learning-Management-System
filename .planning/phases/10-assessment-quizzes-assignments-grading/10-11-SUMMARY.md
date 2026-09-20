---
phase: 10-assessment-quizzes-assignments-grading
plan: 11
subsystem: ui
status: complete
tags: [quiz, learner, privacy, server-actions]
provides:
  - Single-page learner quiz delivery with immediate scored results
  - Server-side projection that strips in-progress answer keys
key-files:
  created:
    - src/components/learner/QuizAttemptPanel.tsx
    - src/server/services/learner-quiz-service.ts
    - src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/assessment-actions.ts
    - tests/components/quiz-attempt-panel.test.tsx
    - tests/learner-quiz-attempt-route.test.ts
    - tests/learner-quiz-service.test.ts
    - tests/quiz-attempt-view.test.ts
  modified:
    - src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx
    - src/components/catalogue/LessonContent.tsx
    - src/server/services/attempt-service.ts
requirements-completed: [ASM-01, ASM-02, ASM-07]
completed: 2026-09-15
---

# Plan 10-11 Summary

**Quiz lessons now start/resume real attempts, collect raw selections in one form, and show scored results and history without exposing in-progress answer keys.**

## Delivered

- Ownership and lesson-openability gates precede assessment reads. Strict action schemas exclude client scores/verdicts, and supplied attempt IDs must match the route's owned enrolment and linked assessment.
- Explicit snapshot projection removes correctness flags and explanations before serialization. NEVER feedback is removed server-side from terminal result payloads.
- One form with native radio/checkbox groups, answered counter, save control, submit/retry and pending feedback.
- Immediate score/percentage, success/warning verdicts, explanations and option labels; exhausted/window/expiry states and abandoned history.
- Submission saves responses before scoring, so the saved-answer retry copy is used only when persistence succeeded. Already-expired attempts return their scored result without changing the frozen record.
- QUIZ LessonContent now renders lesson prose alongside the panel; ASSIGNMENT keeps its placeholder for plan 10-14.

## Verification

- Panel: 7/7; action boundary: 11/11; owned read/privacy/order: 4/4; snapshot projection: 1/1.
- Full unit regression before the final refusal-copy case: 117 files / 1,943 tests passed.
- Integrated focused services/actions: 136 passed before that extra case; the corrected action suite passed 11/11 afterward.
- TypeScript, changed-file lint and both production compilers passed.

## Execution notes

The shared attempt-service boundary now includes optional validated enrolment disambiguation and terminal option-label projection. The panel is shorter than the estimated line-count artifact; human visual validation remains plan 10-17.

## Self-Check: PASSED

Implementation is integrated into Khaliddev (9543877), with the final refusal-copy correction in 1bb62b5. The final integrated Turbopack build passed after that correction.
