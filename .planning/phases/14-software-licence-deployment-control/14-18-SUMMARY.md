---
phase: 14-software-licence-deployment-control
plan: 18
subsystem: licensing
tags: [licence, server-actions, route-handlers, refusal-message, classification-gate, lic-05, d-06, d-07, d-09]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-11 refusalMessage and isLicenceRestricted from @/server/permissions, LicenceRestrictedError extends AuthorizationError; LICENCE_REFUSAL_MESSAGE from @/server/licence/policy; 14-17 registry-driven boundary test"
provides:
  - "22 blocked-class staff actions and lesson-resource routes surface the fixed licence refusal instead of a role-denial message"
  - "tests/licence-action-refusal.test.ts: tracer and behaviour tests plus the exhaustive classification gate (BLOCKED 22, CONTINUITY 12 plus 2 licence-kind, READ rule)"
affects: [14-19, 14-21]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 3
  confidence: low
actuals:
  tokens: 9000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Least-invasive refusal mapping: wrap only the message value of an existing AuthorizationError branch with refusalMessage(error, existingText); result shape, status and unrelated branches untouched"
    - "Routes check isLicenceRestricted before the identical 404 branch and answer 403 with { error: LICENCE_REFUSAL_MESSAGE }"
    - "Exhaustive file-level classification: every src/app file referencing AuthorizationError must be BLOCKED, CONTINUITY or READ, or the test fails with its path"

key-files:
  created:
    - tests/licence-action-refusal.test.ts
  modified:
    - src/app/staff/cohorts/actions.ts
    - src/app/staff/courses/actions.ts
    - src/app/staff/cohorts/[id]/enrolment-actions.ts
    - src/app/staff/cohorts/[id]/instructor-actions.ts
    - src/app/staff/cohorts/[id]/publish-actions.ts
    - src/app/staff/cohorts/[id]/session-actions.ts
    - src/app/staff/courses/[id]/arrange/actions.ts
    - src/app/staff/courses/[id]/assessments/actions.ts
    - src/app/staff/courses/[id]/assessments/question-actions.ts
    - src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts
    - src/app/staff/courses/[id]/publish-actions.ts
    - src/app/staff/programmes/actions.ts
    - src/app/staff/programmes/[id]/arrange/actions.ts
    - src/app/staff/programmes/[id]/publish-actions.ts
    - src/app/staff/certificates/templates/template-actions.ts
    - src/app/staff/certificates/templates/template-asset-actions.ts
    - src/app/staff/roles/actions.ts
    - src/app/staff/users/actions.ts
    - src/app/api/lesson-resources/route.ts
    - src/app/api/lesson-resources/upload-intent/route.ts
    - src/app/api/lesson-resources/[id]/route.ts
    - src/app/api/lesson-resources/[id]/complete/route.ts
    - tests/lesson-resource-routes.test.ts

key-decisions:
  - "The two licence-kind files that reference AuthorizationError (src/app/staff/licence/actions.ts and src/app/api/staff/licence/diagnostic/route.ts, both fronted by licence.activate, which is continuity) are classified CONTINUITY in the gate; the plan's inventory of 12 predates them"
  - "A branch that maps both AuthorizationError and AuthenticationError wraps with refusalMessage(error, text); an AuthenticationError is never a licence refusal so it still gets the original text"

patterns-established:
  - "A new staff action or route file that references AuthorizationError fails tests/licence-action-refusal.test.ts until it is classified there"

requirements-completed: []

coverage:
  - id: C1
    description: "LIC-05 UI side, T-14-18-03: cohort create and course create return LICENCE_REFUSAL_MESSAGE through their own { ok:false, errors:[], message } shape for a LicenceRestrictedError; AuthorizationError and AuthenticationError keep the original role text"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-action-refusal.test.ts (tracer: 6 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "Representative behaviour per file shape: enrolment action ({ok,message}), role action ({errors:[form]}), template action (DENIED_MESSAGE constant) return the licence refusal for LicenceRestrictedError and their existing text otherwise"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-action-refusal.test.ts (behaviour: enrolment, role, template) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "T-14-18-01: the four lesson-resource routes answer a LicenceRestrictedError with 403 and { error: LICENCE_REFUSAL_MESSAGE }; every genuine AuthorizationError or AuthenticationError keeps the identical empty 404"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-action-refusal.test.ts (behaviour: lesson-resource routes, 4 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "T-14-18-03, T-14-18-04: all 22 blocked files use the helper (18 actions import and call refusalMessage once per authorization branch; 4 routes use isLicenceRestricted, LICENCE_REFUSAL_MESSAGE and status 403); every src/app file referencing AuthorizationError is BLOCKED, CONTINUITY or READ"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-action-refusal.test.ts (gate: 31 tests incl. classifier-can-fail checks) (pass); mutation check below"
        status: pass
    human_judgment: false
  - id: C5
    description: "T-14-18-02: the refusal text is the fixed constant and never contains the role-denial wording"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-action-refusal.test.ts (tracer: refusal text never contains 'Your role does not permit') (pass)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-10-02
status: complete
---

# Phase 14 Plan 18: Blocked Actions Surface the Licence Refusal Summary

**The 18 blocked-class staff server actions now show the fixed licence refusal sentence (through their own existing result shapes) instead of "Your role does not permit ...", the four lesson-resource routes answer it with 403 while every genuine denial keeps the identical 404, and an exhaustive classification test stops any unclassified action file from slipping in.**

## Performance

- **Duration:** about 35 min
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 1 created, 23 modified (22 source files plus 1 existing test mock)

## Accomplishments

- Next.js 16 docs read first (AGENTS.md): `server-actions.md` (a `"use server"` file exports only async functions, so no helper is exported from any action file; none was added) and `route.md` (route handler signatures unchanged).
- Tracer: `createCohortAction` and `createCourseAction` return `{ ok: false, errors: [], message: LICENCE_REFUSAL_MESSAGE }` for a `LicenceRestrictedError` and the original text for `AuthorizationError` and `AuthenticationError`.
- 18 action files: import extended with `refusalMessage`, and the message value in each existing authorization branch wrapped as `refusalMessage(error, "<existing text>")` (every branch, 30 call sites in total; the `users/actions.ts` deactivate wrap is safe because deactivation is continuity). No result type, status, branch order or export changed.
- 4 routes (`route.ts`, `upload-intent`, `[id]`, `[id]/complete`): `permissions.isLicenceRestricted(err)` checked before the unchanged 404 branch, returning `NextResponse.json({ error: LICENCE_REFUSAL_MESSAGE }, { status: 403 })`.
- `tests/licence-action-refusal.test.ts` (60 tests): tracer, behaviour (enrolment, role, template, all four routes), per-file call-count-equals-branch-count checks, and the gate (22 blocked files, classification of the whole `src/app` tree, plus unit tests proving the classifier and helper check can fail).
- Authorization order untouched: every edit is at the catch site, after the service (and its `withPermission` guard) already threw, so only an authorized caller can ever receive the refusal (T-14-18-01).

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): test file (tracer, gate) and the cohort and course create edits. Commit: none (owner policy)
2. Task 2: nine cohort and course group files and the enrolment behaviour tests. Commit: none (owner policy)
3. Task 3: seven action files, four routes, role, template and route behaviour tests, full file run. Commit: none (owner policy)

TDD gate: no `test(...)`/`feat(...)` commits exist (commits prohibited by owner policy). RED was observed on disk before the tracer edits: the two LicenceRestricted tracer tests failed with the role-denial text received, the other four passed. A mutation check at the end (programmes/actions.ts with `refusalMessage` removed, `[id]/route.ts` with `status: 403` changed to 410) failed 4 tests for the right reasons (route behaviour, per-file wrap count, two gate cases); both files were restored byte-identical (`cmp`) and the file re-ran 60 of 60.

## Verification Results (real output)

- `npx vitest run tests/licence-action-refusal.test.ts --project node -t "tracer:"` (Task 1 verify): 6 passed, 27 skipped.
- `npx vitest run tests/licence-action-refusal.test.ts --project node -t "tracer:|behaviour:"` (Task 2 verify, before Task 3 existed): 18 passed, 27 skipped.
- `npx vitest run tests/licence-action-refusal.test.ts --project node` (Task 3): 1 file, 60 tests passed.
- Existing tests of the edited actions and routes, `--project node`: `lesson-resource-routes, assessment-staff-routes, cohort-actions, course-actions, enrolment-live-certificate-action, lesson-save-action, question-builder-action, staff-users-actions, template-asset-actions, grade-entry-routes, licence-action-refusal, with-permission`: 12 files, 181 tests passed.
- Component tests that reference the edited action paths, `--project components` (18 files: arrange-client, assignment-drawer, assignments-panel, certificate-settings-form, certificate-template-editor, cohort-detail-actions, cohort-form, cohort-roster, course-detail-actions, course-form, lesson-content, lesson-editor-client, programme-arrange-client, programme-detail-client, programme-form, role-detail-panels, staff-account-form, upload-panel): 18 files, 129 tests passed.
- `npx vitest run tests/boundary.test.ts --project node` (alone): 1 file, 31 tests passed.
- `npx vitest run tests/licence-enforcement-boundary.test.ts tests/licence-purity.test.ts tests/licence-action-refusal.test.ts tests/with-permission.test.ts --project node`: 4 files, 149 tests passed.
- `npx tsc --noEmit`: no output, 0 errors (no new error).
- `npx eslint` on the 22 source files and the 2 test files: no output, 0 findings.
- Acceptance greps (covered by the gate tests): every one of the 18 action files contains `refusalMessage(`; the four routes each contain `LICENCE_REFUSAL_MESSAGE` and `status: 403`.
- Not run (owner policy, focused tests only): the full suite and any Testcontainers integration file; this plan adds no database behaviour. No prisma command or DATABASE_URL access was used.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-18-PLAN.md LIC-05`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-05"
  ],
  "total": 1
}
```

  No requirement is marked complete: LIC-05 is still owned by later plans (14-19 to 14-21: UI mirror, documentation and the restricted-state proof). `requirements-completed` is empty.

## Files Created/Modified

- `tests/licence-action-refusal.test.ts` - tracer, behaviour and classification gate tests (new, 60 tests)
- The 22 source files listed in `key-files.modified` - message wraps (18 actions) and 403 refusal branch (4 routes)
- `tests/lesson-resource-routes.test.ts` - the existing `@/server/permissions` mock gained `isLicenceRestricted` (see deviations)

## Decisions Made

See key-decisions. Message mapping follows the plan exactly: only the message value changes; shapes, wording for genuine denial and unrelated branches are preserved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing route test mock lacked `isLicenceRestricted`**
- **Found during:** Task 3 (running `tests/lesson-resource-routes.test.ts` after the route edits)
- **Issue:** that test replaces `@/server/permissions` with a factory exporting only the error classes and `withPermission`; the new `permissions.isLicenceRestricted(err)` call in the routes made 8 existing tests throw "No isLicenceRestricted export is defined on the mock".
- **Fix:** added a local `LicenceRestrictedError extends AuthorizationError` and `isLicenceRestricted` to that mock (3 lines); the existing assertions are unchanged and pass.
- **Files modified:** `tests/lesson-resource-routes.test.ts`
- **Commit:** none (owner policy)

**2. [Rule 1 - Bug in plan inventory] The CONTINUITY list of 12 was incomplete**
- **Found during:** Task 1 (scanning `src/app` for `AuthorizationError`)
- **Issue:** two files added by plans 14-10 to 14-15, `src/app/staff/licence/actions.ts` and `src/app/api/staff/licence/diagnostic/route.ts`, reference `AuthorizationError` but are in neither the BLOCKED nor the 12-file CONTINUITY list, so the exhaustive classification test the plan requires could not pass.
- **Fix:** classified both as CONTINUITY in the test (`LICENCE_CONTINUITY_FILES`, hard-coded and separately commented). Both go through `licenceStaffService`, which wraps every call in `licence.activate`, continuity by effect, so neither ever receives a `LicenceRestrictedError`. `licence/actions.ts` already used `refusalMessage` from plan 14-15. The test still asserts exactly 12 in `CONTINUITY_ACTION_FILES`.
- **Files modified:** `tests/licence-action-refusal.test.ts`
- **Commit:** none (owner policy)

### Interpretation choices (flag for owner review)

- **The `GET /api/lesson-resources` list route** is in the plan's blocked list and was edited as specified, although a read does not throw the refusal in practice; the 403 branch is unreachable for it today and harmless. Left as the plan says.
- **Test-only mock of `withPermission`.** The route behaviour tests replace only the `withPermission` wrapper of `@/server/permissions` (real error classes and real refusal helpers stay), and fully mock `storage-service` and `lesson-resource-service`, because the real modules load the AWS SDK and made the first dynamic import exceed the 5 s default timeout (observed once, then fixed by the mocks, not by a longer timeout).
- **Per-file count check added beyond the plan:** each action file's `refusalMessage(` call count must equal its `instanceof AuthorizationError` branch count, so a branch added later without the wrap fails.

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1 plan-inventory gap), 3 interpretation notes. **Impact:** none to any source contract; no action result type or export changed.

## Issues Encountered

None blocking. No auth gates, no checkpoints, no Rule 4 decisions. A file-level gate cannot prove a branch is reached at runtime; behaviour is proven for the representative set (cohort create, course create, enrolment, role, template, upload-intent and the other three routes) and the call-count check covers the remaining actions, as the plan specifies.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change: message-value wraps and a 403 branch after the existing authorization. Register items T-14-18-01 (route tests assert both the 403 for authorized callers and the identical empty 404 for denials), -02 (test compares to the constant and rejects the role wording), -03 (22-file gate and per-file wrap count) and -04 (exhaustive classification test with failing-input unit tests and a mutation check) are covered by tests.

## Outstanding Human UAT

- Browser-only: with the deployment in restricted continuity mode, submit a blocked action from the staff UI (create cohort, create course, edit a lesson, create a role, upload a lesson resource) and confirm the form shows "This action is unavailable while the deployment is in restricted continuity mode. Ask an administrator to check the licence status." and never "Your role does not permit ...". Not run here (no browser, no restricted deployment against a database).
- Carried forward: the 14-03 migration is proven on Testcontainers only and is NOT applied to the shared database (outstanding human step, WINDOWS.md entry id 20). This plan used no database.
- Broken-windows ledger: no new stub, skipped test or unrun verify, so nothing was appended to `.planning/WINDOWS.md`.

## Next Phase Readiness

- Plan 14-19 (UI mirror) can rely on server refusals already carrying the fixed sentence; plan 14-21 can cite `tests/licence-action-refusal.test.ts` as the LIC-05 UI-side evidence.
- Any new staff action or route referencing `AuthorizationError` must be classified in this test or it fails.

## Self-Check: PASSED

- FOUND on disk: tests/licence-action-refusal.test.ts (60 tests passing), the 22 edited source files (gate test asserts each uses the helper), tests/lesson-resource-routes.test.ts mock edit, this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run. No prisma command or DATABASE_URL access was used.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-02*
