---
phase: 11-certificates-completion-lifecycle
plan: 17
subsystem: learner-dashboard
tags: [gap-closure, uat-test-10, completed-enrolment, certificates, learner-access, dashboard]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "11-13 CertificateColumn on the dashboard card; 11-16 UAT walkthrough that diagnosed the gap"
provides:
  - "learner-access.listOwnDashboardEnrolments: ACTIVE then COMPLETED own enrolments (read-side only)"
  - "loadLearnerPath(actor, id, { includeCompleted }) opt-in; default stays ACTIVE-only"
  - "assertLessonOpenable refuses a COMPLETED path (defence in depth)"
  - "LearnerDashboardCard.enrolmentStatus and a COMPLETED-aware card build carrying the certificate column"
affects: [11-18 (dashboard page must hide Assessments/Results slots on a COMPLETED card), verify-work]

key-files:
  modified:
    - src/server/services/learner-access.ts
    - src/server/services/enrolment-dashboard-service.ts
    - tests/learner-access.test.ts
    - tests/enrolment-dashboard-service.test.ts
    - tests/certificate-slot.test.ts

key-decisions:
  - "G-01: a COMPLETED enrolment is VISIBLE but NOT OPERABLE. Only the dashboard read path opts in (includeCompleted); lesson pages, progress/quiz/results services and hasActiveEnrolmentCoveringCourse keep ACTIVE-only behaviour."
  - "Widened by calling store.enrolment.findMany once per status rather than widening the structural LearnerAccessStore type, so every existing fake store still compiles."
  - "COMPLETED refusal in assertLessonOpenable reuses reason 'access-window-closed' and compares === 'COMPLETED' (never !== 'ACTIVE') so hand-built paths without a status keep opening lessons and the exhaustive LessonNotOpenableError mapping is untouched."
  - "A COMPLETED card skips learnerResults reads and always has nextAction { kind: 'complete' }."

requirements-completed: []
requirements-reopen: [CRD-03]

duration: ~25min
completed: 2026-09-19
---

# Phase 11 Plan 17: COMPLETED enrolments visible on the learner dashboard Summary

**The learner dashboard now lists COMPLETED enrolments (the status certificate issuance itself writes) with their certificate column, while a COMPLETED enrolment stays unusable for lesson content and every write (decision G-01).**

## Root cause closed

UAT test 10 (BLOCKER): issuance moves an enrolment to COMPLETED (D-05), but `listOwnActiveEnrolments` filtered `status: "ACTIVE"`. The card hosting `CertificateSlot` therefore vanished exactly when a certificate became ACTIVE. Every dashboard fixture used the default ACTIVE status, which is why unit tests missed it.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 | fc3b895 | `resolveOwnEnrolment(actor, id, allowedStatuses)` refactor; `getOwnActiveEnrolment` is now a wrapper over `["ACTIVE"]`; new `listOwnDashboardEnrolments`; `loadLearnerPath` `includeCompleted` option; `assertLessonOpenable` COMPLETED refusal |
| 2 | e4658e9 | `EnrolmentDashboardLearnerAccess` now takes `listOwnDashboardEnrolments`; `LearnerDashboardCard.enrolmentStatus`; COMPLETED cards get `nextAction: complete`, skip the two `learnerResults` reads, and still compute real progress |

## Regression verification (fails before, passes after)

- Task 1: wrote the tests first and ran them against the unmodified service: 3 failed (`listOwnDashboardEnrolments` missing, `includeCompleted` returned null, COMPLETED assert-refusal test), the pre-existing 37 passed. After implementing: 40/40.
- Task 2: with the new tests in place, temporarily restored the pre-change `enrolment-dashboard-service.ts` (`git checkout -- <file>` on that one file, working copy saved first and restored after) and ran the suite: 8 failed, 46 passed. The UAT-test-10 case failed with zero cards, as specified. After restoring the fix: all green.

## Verification run

- `npx vitest run` over learner-access, enrolment-dashboard-service, learner-lesson-list-page, learner-lesson-page, learner-lesson-actions, learner-results-service, learner-dashboard-page, certificate-slot, boundary, certificate-phase-invariants: 10 files, 200 tests, all passed (run through PowerShell).
- `npx tsc --noEmit`: clean.
- `git diff package.json package-lock.json`: empty (T-11-SC).
- No Postgres/MinIO integration tests exist for this plan's surface, and none were run; the proof is service-level with in-memory fakes (the repo's convention for these two services). The live Prisma binding of `listOwnDashboardEnrolments` (two `findMany` calls with an equality `status`) was not exercised against a real database, and no browser walkthrough was done here.

## Threat model coverage

- T-11-70 (IDOR via includeCompleted): the widened resolver keeps `enrolment.userId !== actor.userId` and the identical `null`; test compares a stranger's COMPLETED id with a missing id via `toStrictEqual`.
- T-11-71 (COMPLETED used to operate): `assertLessonOpenable` refuses a COMPLETED path; `hasActiveEnrolmentCoveringCourse` untouched and pinned false by a dedicated test; the default `loadLearnerPath` still returns null for COMPLETED (tested, including `{}`).
- T-11-72: no write path can obtain a COMPLETED path (only the dashboard passes `includeCompleted`).
- T-11-73: enrolment ids fed to the batched certificate/completion queries come only from `listOwnDashboardEnrolments`; test proves another learner's COMPLETED enrolment and certificate never surface. The batches are still read exactly once (spy-asserted).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tests/certificate-slot.test.ts fake used the removed dependency key**
- **Found during:** Task 2 verification (`tsc` and the certificate-slot suite failed)
- **Issue:** `makeLearnerAccess` in that file built an `EnrolmentDashboardLearnerAccess` with `listOwnActiveEnrolments`, which the plan replaces with `listOwnDashboardEnrolments`. The file was not in the plan's `files_modified`.
- **Fix:** renamed the one key in the fake. No behaviour change.
- **Files modified:** tests/certificate-slot.test.ts
- **Commit:** e4658e9

**2. [Test scope note] hasActiveEnrolmentCoveringCourse COMPLETED case already partly covered**
- An existing test already looped over COMPLETED among other statuses. Added the dedicated, named G-01 pin as the plan asked; not a behavioural deviation.

## Known Stubs / Open follow-ups

- The dashboard page still renders the Assessments and Results slots for a COMPLETED card (they show `base`'s deferred constants until plan 11-18 hides them). Plan 11-18 owns that page change; this plan deliberately did not touch the page.
- Product question, unresolved and out of scope: whether a COMPLETED learner should be able to review lessons/results. Currently they cannot (G-01, matches Phase 9's stated rule).
- Not fixed here: CRD-03 stays reopened until the other diagnosed gaps (PDF orientation, etc.) and the page work in 11-18 land.

## Threat Flags

None. No new endpoints, auth paths or schema changes; the read widening is ownership-scoped.

## Self-Check: PASSED

- src/server/services/learner-access.ts, src/server/services/enrolment-dashboard-service.ts, tests/learner-access.test.ts, tests/enrolment-dashboard-service.test.ts, tests/certificate-slot.test.ts: present and modified.
- Commits fc3b895 and e4658e9 exist on branch Khaliddev.
