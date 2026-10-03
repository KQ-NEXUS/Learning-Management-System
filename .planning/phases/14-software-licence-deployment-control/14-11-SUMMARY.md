---
phase: 14-software-licence-deployment-control
plan: 11
subsystem: authorization
tags: [licence, withPermission, choke-point, restricted-state, no-state-oracle, audit, d-05, d-06, d-07, d-09, lic-05, lic-06]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-06 LICENCE_PERMISSION_EFFECT, effectForPermission, LicenceEffect; 14-06 policy LICENCE_REFUSAL_MESSAGE; 14-09 licenceService.checkWriteGate (database-backed, audits licence.restriction_enforced)"
provides:
  - "with-permission.ts: LicenceRestrictedError (extends AuthorizationError), LicenceGuardInput, LicenceGuardDecision, LicenceGuardDep, WithPermissionOptions, WithPermissionDeps.licence, optional third argument of withPermission, LicenceEffect re-export"
  - "refusal.ts: refusalMessage, isLicenceRestricted"
  - "permissions/index.ts: live withPermission bound to licenceService.checkWriteGate; re-exports LicenceRestrictedError, refusalMessage, isLicenceRestricted"
  - "tests/support/harness.ts: createTestWithPermission option licence"
affects: [14-12, 14-13, 14-15, 14-17, 14-21]

estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 2
  confidence: low
actuals:
  tokens: 14000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Guard after authorization: the licence check sits between the hasPermission denial branch and the handler, so an unauthorized or anonymous caller never reaches it and cannot use it as a state oracle"
    - "Default-block with an explicit allowlist: the effect defaults to effectForPermission(permission) (write for any unclassified string); a call site overrides with { licence, reason }"
    - "Dependency-injected guard: with-permission.ts imports only the pure effects and policy modules; the database binding lives in permissions/index.ts"

key-files:
  created:
    - src/server/permissions/refusal.ts
    - tests/licence-guard.test.ts
    - tests/licence-guard.integration.test.ts
  modified:
    - src/server/permissions/with-permission.ts
    - src/server/permissions/index.ts
    - tests/support/harness.ts
    - tests/with-permission.test.ts

key-decisions:
  - "LicenceRestrictedError overwrites message with LICENCE_REFUSAL_MESSAGE after super(permission) so the permission name and the licence state are never in the text, and extends AuthorizationError so existing instanceof catch sites keep returning results"
  - "The choke point never audits a licence refusal itself (no authorization.denied row); the guard dependency (checkWriteGate) writes the single licence.restriction_enforced row"
  - "The guard step is skipped entirely when deps.licence is absent, so existing unit harnesses and tests are byte-for-byte unchanged"

patterns-established:
  - "Integration tests build a real createWithPermission over a Testcontainers-backed createLicenceService with an injected clock and delete the audit rows they created by id"

requirements-completed: []

coverage:
  - id: C1
    description: "D-09, LIC-05, LIC-06: a write-effect call passes before graceEndsAt minus 1 ms and is refused with LicenceRestrictedError at exactly graceEndsAt through the real database path; the handler does not run again and exactly one licence.restriction_enforced row exists with operation courses.publish"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-guard.integration.test.ts (tracer describe) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "D-09, T-14-11-01: no state oracle: an unauthorized actor gets the same AuthorizationError name and message in ACTIVE and RESTRICTED states, in blocked and allowed fake-guard harnesses and against the real database, the guard is called zero times, and no enforcement row is written; an anonymous caller gets AuthenticationError with zero guard calls"
    requirement: "LIC-06"
    verification:
      - kind: unit
        ref: "tests/licence-guard.test.ts (no state oracle describe, 2 tests) (pass)"
        status: pass
      - kind: integration
        ref: "tests/licence-guard.integration.test.ts (parity describe) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "D-05, D-06, D-07, T-14-11-03: read and continuity operations never call the guard; grades.manage, certificates.issue, refunds.manage, licence.activate and courses.view run in the restricted state; a per-call override switches either direction"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/with-permission.test.ts (licence guard describe) (pass)"
        status: pass
      - kind: integration
        ref: "tests/licence-guard.integration.test.ts (allowlist describe) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "D-09 default-block, T-14-11-02: an unclassified permission string is treated as write; no licence dependency leaves behaviour unchanged; a licence refusal writes no authorization.denied entry"
    requirement: "LIC-06"
    verification:
      - kind: unit
        ref: "tests/with-permission.test.ts (licence guard describe, 8 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "Live binding: index.ts binds checkWriteGate with operation equal to the permission and re-exports the refusal API; with-permission.ts imports no next/*, services, db or prisma specifier; refusalMessage and isLicenceRestricted behave as specified; the harness forwards licence"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-guard.test.ts (refusal helper, shared harness, live binding describes) (pass)"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 11: Restricted-State Guard in withPermission Summary

**The withPermission choke point now refuses write-effect operations in the restricted state with a fixed non-sensitive LicenceRestrictedError, strictly after authorization passes, bound to the database-backed licence gate and proven on a real Postgres including no-state-oracle parity.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-10-01
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 auto; both marked tdd)
- **Files:** 3 created, 4 modified

## Accomplishments

- Step order in `withPermission` is now: authenticate, resolve scope, load grants, `hasPermission` (denial audited, `AuthorizationError`), licence guard, handler. The guard runs only when `deps.licence` is configured, computes `options?.licence ?? effectForPermission(permission)` and calls `deps.licence.check({ permission, actorId })` only for `write`.
- `LicenceRestrictedError extends AuthorizationError` with name `LicenceRestrictedError` and the fixed `LICENCE_REFUSAL_MESSAGE`; no authorization.denied audit entry is written for it.
- `refusal.ts` provides `refusalMessage(error, deniedMessage)` and `isLicenceRestricted(error)` so actions can show the licence sentence only when the licence caused the refusal.
- `permissions/index.ts` binds `licence.check` to `licenceService.checkWriteGate({ operation: permission, actorId })` and re-exports `LicenceRestrictedError`, `refusalMessage`, `isLicenceRestricted`.
- `createTestWithPermission` accepts and forwards `licence`.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): guard step, options and LicenceRestrictedError, plus 8 unit behaviours in with-permission.test.ts and the parity cases in licence-guard.test.ts. Commit: none (owner policy)
2. Task 2: live binding, refusal helper, harness option, real-database proof (3 integration tests). Commit: none (owner policy)

TDD gate: the implementation was written before the tests (the plan's action text lists implementation first), so no separate RED run exists and no `test(...)`/`feat(...)` git commits exist (commits prohibited by owner policy). All tests passed on the first run. To guard against vacuous passes the integration allowlist test first proves the same restricted state refuses a write-effect permission, and the tracer asserts concrete database rows (count, actor, operation) rather than only return values.

## Verification Results (real output)

- `npx vitest run tests/with-permission.test.ts tests/licence-guard.test.ts tests/licence-effects.test.ts --project node`: 3 files passed, 44 tests passed.
- `npx vitest run tests/licence-guard.test.ts tests/licence-guard.integration.test.ts tests/with-permission.test.ts --project node --no-file-parallelism` (Testcontainers postgres, all migrations applied incl. 20261001120000_licence_deployment_control): 3 files passed, 31 tests passed, 0 failed.
- `npx vitest run tests/boundary.test.ts tests/licence-purity.test.ts tests/licence-effects.test.ts tests/licence-service.test.ts tests/audit-append-only.test.ts --project node`: 5 files passed, 81 tests passed (boundary and purity unaffected; no request-only import entered a worker closure).
- Existing consumers of the live permissions index (`assignment-service`, `certificates-landing-page`, `course-actions`, `grade-override-service`, `grading-routes`, `question-builder-action`, `staff-email-log-actions`, `staff-report-page-states`, `support-report` tests): 9 files passed, 96 tests passed.
- `npx tsc --noEmit`: no output, 0 errors (no new error).
- `npx eslint src/server/permissions tests/with-permission.test.ts tests/licence-guard.test.ts tests/licence-guard.integration.test.ts tests/support/harness.ts`: no output, 0 findings.
- Not run (owner policy, focused tests only): the full suite, and `tests/report-scope.integration.test.ts` / `tests/support-report.integration.test.ts` (they import the live index but were not touched by this plan).
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-11-PLAN.md LIC-05 LIC-06`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-05",
    "LIC-06"
  ],
  "total": 2
}
```

  No requirement is marked complete: both are still owned by later plans (14-13, 14-14, 14-15, 14-16, 14-17, 14-21). `requirements-completed` is therefore empty.

## Files Created/Modified

- `src/server/permissions/with-permission.ts` - LicenceRestrictedError, guard types, options, guard step, header comment
- `src/server/permissions/index.ts` - live guard binding and new re-exports
- `src/server/permissions/refusal.ts` - refusalMessage, isLicenceRestricted (new)
- `tests/support/harness.ts` - `licence` option on createTestWithPermission
- `tests/with-permission.test.ts` - 8 licence guard behaviours; existing 12 tests untouched and passing
- `tests/licence-guard.test.ts` - no-oracle parity, refusal helper, harness and static binding tests (new, 7 tests)
- `tests/licence-guard.integration.test.ts` - real-database tracer, parity and allowlist tests (new, 3 tests)

## Decisions Made

See key-decisions. The plan's authorization-before-licence ordering was kept exactly; the guard is not reachable for an anonymous or unauthorized caller.

## Deviations from Plan

### Auto-fixed Issues

None of Rules 1 to 3 applied.

### Interpretation choices (no change to the interface contract)

- The static check that `with-permission.ts` stays framework-free lives in `tests/licence-guard.test.ts` and asserts no `next/*`, `@/server/services/*`, `@/server/db` or `@prisma/*` specifier and the presence of the two pure licence imports, rather than a broader import-graph walk (the existing boundary test already covers the closure rules).
- The integration test deletes the audit rows it created by id after each test (tracked by selecting licence.* rows at set-up and tear-down), as the plan requires, instead of a blanket action-prefix delete.

**Total deviations:** 0 rule-based, 2 interpretation choices.

## Issues Encountered

None. No auth gates, no checkpoints, no Rule 4 decisions.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. Register items T-14-11-01 (parity tests, unit and real database), -02 (default-write and override tests; registry lock is plan 14-17), -03 (allowlist integration test), -05 (message equals the constant, no permission in text), -06 (one enforcement row asserted) are covered by tests. T-14-11-04 is accepted as documented (same-request check, monotonic restriction).

## Outstanding Human UAT

- None specific to this plan (no UI change). The browser proof of a refused staff write showing the licence sentence belongs to plans 14-15 and 14-21.
- Carried forward: the 14-03 migration is proven on Testcontainers only and is NOT applied to the shared database (outstanding human step, WINDOWS.md entry id 20). Until it is applied, the live `withPermission` bound here will read missing licence tables on the shared database: `checkWriteGate` falls back to its bounded last-known-good path on a read failure (allow with no history), so staff writes keep working, but the migration must be applied before this plan ships.

## Next Phase Readiness

- Plans 14-12 and 14-13 can add explicit checkout/registration guards; 14-15 and 14-17 can pass `{ licence, reason }` overrides and use `refusalMessage` in actions; the `LicenceRestrictedError` extends `AuthorizationError`, so existing action catch sites keep returning results but show the role-denial text until each is updated to call `refusalMessage` (plan 14-17).
- Broken-windows ledger: no new stub, skipped test or unrun verify, so nothing was appended to `.planning/WINDOWS.md`.

## Self-Check: PASSED

- FOUND on disk: src/server/permissions/with-permission.ts; src/server/permissions/index.ts; src/server/permissions/refusal.ts; tests/support/harness.ts; tests/with-permission.test.ts; tests/licence-guard.test.ts; tests/licence-guard.integration.test.ts; this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
