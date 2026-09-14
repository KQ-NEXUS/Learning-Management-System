---
created: 2026-09-07T15:00:00.000Z
title: Close the 3 latent async-mutation warnings from 04.1-REVIEW-2
area: ui
source: 04.1-VERIFICATION-2.md (new_warnings_from_review_2) / 04.1-REVIEW-2.md
files:
  - src/app/staff/courses/[id]/arrange/ArrangeClient.tsx
  - src/app/staff/programmes/[id]/arrange/ProgrammeArrangeClient.tsx
  - src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx
---

## Problem

Phase 04.1 verification PASSED (`04.1-VERIFICATION-2.md`, 2026-09-07). The
gap-closure wave (04.1-32…35) closed every blocking gap and regression. A
follow-up code review (`04.1-REVIEW-2.md`) then surfaced three **latent,
non-blocking** issues that were explicitly recorded as "recommend tracking for a
follow-up" rather than fixed in that wave. They are captured here so they are not
lost.

None is a capability regression versus pre-phase behaviour; none gates any phase.

### WR-01 — `ArrangeClient.handleRestore` still an unguarded mutation
`handleRestore` (~l.201-204) is `await restoreItemAction(...)` with a silent
`if (res.ok)` fall-through — the same ambiguous-mutation class as CR-01, but it
was **not** in the original gap list and was **not** modified by the 04.1-32
wave, so its behaviour is identical to before Phase 04.1. On a rejected action
the restore control can strand. Fix: wrap in the same `try/catch/finally` +
generic non-interpolating retryable error the five sibling handlers now use.

### WR-02 — bare `catch {}` blocks would swallow framework control-flow throws
The seven `catch {}` blocks added to `ArrangeClient` / `ProgrammeArrangeClient` /
`LessonEditorClient` in the gap wave are bare. If any awaited action ever calls
`redirect()` / `notFound()`, the `NEXT_REDIRECT` / `NEXT_NOT_FOUND` throw would
be swallowed. Latent only — none of `saveModuleOrderAction`,
`saveLessonArrangementAction`, `saveProgrammeCourseOrderAction`, `addCourseAction`,
`removeCourseAction`, `withdrawLessonAction` calls `redirect()`/`notFound()`
today. Fix: add an `isNextControlFlowError(e) → rethrow` guard as hardening.

### WR-03 — `LessonEditorClient.confirmWithdraw` success path never clears modal state
`confirmWithdraw` success path (~l.52-56) returns without clearing
`withdrawing` / `withdrawOpen`, relying on navigation unmount. A stalled
`router.push` leaves the modal on "Working…" with ESC suppressed. Pre-existing,
not modified by the wave. Fix: clear the flags before/independent of the push, or
add a timeout fallback.

## Suggested approach

One small `fix(04.1-followup)` commit touching the three client components:
apply the established `try/catch/finally` shape to `handleRestore`, add the
control-flow-rethrow guard to the shared catch blocks, and clear modal state on
the withdraw success path. Extend `arrange-client.test.tsx` /
`programme-arrange-client.test.tsx` / `lesson-editor-client.test.tsx` with the
matching rejection-recovery / control-flow-passthrough cases.

## Not included

- NFR-09 accessible media / captions — owned by Phase 15 (`04.1-CAPTIONS-SCOPE.md`).
- The Phase 5 staff-UI design-system sweep — its own todo
  (`2026-09-07-sweep-phase-5-staff-ui-onto-the-04-1-design-system.md`).
