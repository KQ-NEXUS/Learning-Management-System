---
phase: 14-software-licence-deployment-control
plan: 17
subsystem: licensing
tags: [licence, boundary-test, registry, ast-scan, withPermission, continuity, d-09, lic-05, lic-08, a9, a10, a11]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-06 LICENCE_PERMISSION_EFFECT and effectForPermission; 14-11 withPermission third-argument options; 14-12 assertWriteAllowed guard calls in checkout-service and registration-service; 14-10 licence-staff-service; 14-DECISIONS.md A9, A10, A11"
provides:
  - "src/server/licence/registry.ts: RegistryEntry, LICENCE_SERVICE_REGISTRY (59 entries), CONTINUITY_TAG_SNAPSHOT (3), DYNAMIC_PERMISSION_FILES (2)"
  - "tests/support/licence-write-scan.ts: scanServiceFiles, scanSource (TypeScript compiler API scan of writes, curried permission calls, guard operations, permission-layer imports)"
  - "tests/licence-enforcement-boundary.test.ts: 41-test registry-driven boundary test with a failing-input unit test for every check"
  - "Call-site overrides { licence: continuity, reason } in lesson-progress-service (enrolments.manage), staff-account-service (users.manage deactivate) and email-delivery-log-service (users.manage resend)"
affects: [14-18, 14-21]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 2
  confidence: low
actuals:
  tokens: 15000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Structural curried-call detection: a permission call site is a CallExpression that is the callee of another call with (first, function-valued resolver, optional options), independent of identifier names"
    - "Pure comparison helpers (findUnregisteredWriters, findStaleEntries, exceptionOverrides, ...) used both on the real tree and on deliberately broken inline sources so each check is proven able to fail"
    - "Options passed by name resolve through a same-file const (ACTIVATION_OPTIONS); anything unreadable is reported as unresolvedOptions and fails the test instead of counting as no override"

key-files:
  created:
    - src/server/licence/registry.ts
    - tests/support/licence-write-scan.ts
    - tests/licence-enforcement-boundary.test.ts
  modified:
    - src/server/services/lesson-progress-service.ts
    - src/server/services/staff-account-service.ts
    - src/server/services/email-delivery-log-service.ts

key-decisions:
  - "The exact-three snapshot counts effective exceptions: an override whose value differs from effectForPermission(permission). The two licence.activate overrides in licence-staff-service (continuity restating the continuity default, defence in depth for the recovery route) are a separately hard-coded, reviewed restatement list of one (file, permission) pair"
  - "course-service is not registered: it has no write call and no permission call of its own (its writes and permission calls live in resource-service, which is registered), so the plan's registered-withPermission-needs-a-permission-call rule would fail it; learner-quiz-service does not exist in the tree"
  - "Not-a-db-write and continuity classifications are backed by structure: a not-a-db-write file must not import @prisma/client or @/server/db, and a continuity file that imports the permission layer must say so in its reason"

patterns-established:
  - "A new write path, permission or service file fails tests/licence-enforcement-boundary.test.ts until it is classified in registry.ts"

requirements-completed: []

coverage:
  - id: C1
    description: "D-09, T-14-17-01: every service file with a database write has exactly one registry entry; no stale or duplicate entry; every entry has a reason; an extra unregistered writing inline file makes the completeness check return it"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts (D-09 completeness describe, 7 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "D-09, T-14-17-03: the structural scanner distinguishes writes, curried permission calls (string, identifier and property resolvers, options literal or same-file const), non-curried calls, guard operations and runtime permission-layer imports; a non-literal permission is allowed only in the two reviewed dynamic files"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts (scanner, options-by-name and withPermission files describes, 17 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "Pitfall 1, T-14-17-02: exactly three effective exceptions exist (lesson-progress-service enrolments.manage, staff-account-service users.manage, email-delivery-log-service users.manage), asserted against a hard-coded list, the registry snapshot (file, permission, reason) and the source reason; one reviewed restatement (licence-staff-service licence.activate) is pinned"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts (Pitfall 1 describe, 6 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "A9, A10, A11, D-07: effective effects show attendance.manage and the staff progress override as continuity, staff deactivation continuity with creation and reactivation write, tickets.manage continuity, email resend continuity, enrolment writes blocked"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts (shows the adopted ledger in the effective effects) (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "D-09 guard files: checkout-service.ts contains assertWriteAllowed for checkout.start, checkout.initiate_stripe and checkout.initiate_paystack, registration-service.ts for registration, and the registered operations equal the scanned ones"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts (licence guard files tracer describe) (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "D-07, D-08, T-14-07-06: system services never import the permission layer; continuity services that do must state it; exactly three licence-kind files; reconciliation-case-service documented as read-fronted (payments.view); licence-staff-service is the only runtime importer of licence-activation-service and wraps both entry points in licence.activate"
    requirement: "LIC-08"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts (read-fronted, system/continuity/licence and importer guard describes, 8 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C7
    description: "The service layer is the complete database surface: no file outside src/server/services and src/server/db.ts imports @prisma/client or @/server/db at runtime (the premise of a service-file registry)"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-enforcement-boundary.test.ts (holds because only the service layer reaches the database) (pass)"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-10-02
status: complete
---

# Phase 14 Plan 17: Registry-Driven Enforcement Boundary Test Summary

**A permanent AST-scan test proves every one of the 56 service files that write to the database is classified (guard, withPermission, continuity, system, licence or not-a-db-write) with a reason, locks the three mixed-permission call-site overrides in an exact snapshot, and shows that licence activation is reachable only through the licence.activate wrapper.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-10-02
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 auto; both marked tdd)
- **Files:** 3 created, 3 modified (6 production or test files)

## Accomplishments

- `tests/support/licence-write-scan.ts`: `scanSource(path, text)` and `scanServiceFiles()` walk `src/server/services` (115 files, 56 writers on 2026-10-02) with the TypeScript compiler API and report `writes`, `permissionCalls` (with `permission`, `override`, `reason`, `unresolvedOptions`, `line`), `guardOperations` and `importsPermissionLayer`. Permission sites are detected structurally (a call that is the callee of another call, taking permission, a function-valued resolver and optional options), not by identifier name, so the destructured `authorize`, `deps.withPermission` and `withPermission` shapes are all found. 119 sites in the real tree.
- `src/server/licence/registry.ts`: 59 reasoned entries (2 guard, 25 withPermission, 11 system, 17 continuity, 3 licence, 1 not-a-db-write), the three-row `CONTINUITY_TAG_SNAPSHOT`, and `DYNAMIC_PERMISSION_FILES` for resource-service and publish-service (the only files with a non-literal permission). The file imports nothing, so the licence purity test is untouched.
- Three one-line call-site overrides added: `lesson-progress-service.ts` (`enrolments.manage`, A9), `staff-account-service.ts` (`users.manage` deactivation, A10) and `email-delivery-log-service.ts` (`users.manage` resend, D-07). No other behaviour in those files changed.
- The boundary test (41 tests) covers completeness, structure per kind, the exact snapshot, the adopted ledger as effective effects (A9, A10, A11), read-fronted writes, system and continuity exemptions, the importer guard and the service-layer-is-the-only-database-surface premise.

## Findings from the scan (unguarded or unclassified paths)

- Unregistered writing files found: **none**. All 56 writers were already named by the research inventory; each was classified from sections A to D and read against the code, not guessed.
- Scan false negative found and fixed in the scanner (T-14-17-03 in action): `licence-staff-service.ts` passes its options as a same-file const (`ACTIVATION_OPTIONS`, `as const`), a shape the first scanner draft (object-literal third argument only) silently skipped, so its two `licence.activate` permission calls were invisible. The scanner now accepts any third argument, resolves a same-file const to its object literal, and reports anything unreadable as `unresolvedOptions` (the test requires none).
- That fix surfaced a plan-versus-reality difference: five call-site overrides exist in the real tree, not three. The two in `licence-staff-service.ts` restate the permission's own default (`licence.activate` is already continuity in `LICENCE_PERMISSION_EFFECT`), so they are not exceptions. See deviations.
- Classification facts worth knowing: `email-delivery-log-service.ts` performs no write itself (it delegates to `email-dispatch-service`) yet carries the resend override, so it is registered as withPermission although the scan does not list it as a writer. `scope-lookup-service.ts` has write-default `roles.manage` read lookups and no write; it is intentionally unregistered and stays blocked in restricted mode as the research inventory states (section A).

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): scanner, registry skeleton and the unit tests plus guard-file tests; the registry was written complete at once, which the tracer tests tolerate. Commit: none (owner policy)
2. Task 2: complete classification, three call-site overrides, snapshot, importer guard and the exhaustive tests. Commit: none (owner policy)

TDD gate: no separate RED run and no `test(...)`/`feat(...)` commits exist (commits are prohibited by owner policy). To guard against vacuous passes I ran a mutation check: with the lesson-progress override removed, the seat-accounting registry entry removed and a temporary unregistered writing service file added, 6 tests failed for the right reasons (unregistered writers, exact snapshot, registry snapshot reason, adopted ledger, named-service inventory); all three mutations were reverted and diffed identical to the backups before the final run. The temporary file was deleted.

## Verification Results (real output)

- `npx vitest run tests/licence-enforcement-boundary.test.ts --project node`: 1 file, 41 tests passed.
- `npx vitest run tests/licence-enforcement-boundary.test.ts tests/lesson-progress-service.test.ts tests/staff-account-service.test.ts tests/email-delivery-log-service.test.ts tests/with-permission.test.ts --project node`: 5 files, 172 tests passed (the existing tests of the three edited services pass unchanged, proving the third argument changes nothing when no licence guard is configured).
- `npx vitest run tests/boundary.test.ts --project node` (alone): 1 file, 31 tests passed.
- `npx vitest run tests/licence-purity.test.ts tests/licence-effects.test.ts tests/licence-staff-service.test.ts tests/staff-email-log-actions.test.ts --project node`: 4 files, 60 tests passed.
- `npx tsc --noEmit`: no output, 0 errors (no new error), run after the service edits and again after the final test file.
- `npx eslint` on the six touched files: no output, 0 findings.
- Acceptance greps: registry contains `checkout.start`, `checkout.initiate_stripe`, `checkout.initiate_paystack` and `registration`; the three service files each contain `licence: "continuity"`; the test hard-codes the snapshot with `enrolments.manage`, `users.manage` and the three file names.
- Not run (owner policy, focused tests only): the full suite and any Testcontainers integration file; this plan adds no database behaviour.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-17-PLAN.md LIC-05 LIC-08`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-05",
    "LIC-08"
  ],
  "total": 2
}
```

  No requirement is marked complete: both are still owned by later plans (14-18 to 14-21: notice and status surfaces, UI mirror, documentation and the restricted-state proof). `requirements-completed` is empty.

## Files Created/Modified

- `src/server/licence/registry.ts` - registry, snapshot and dynamic-permission list (new)
- `tests/support/licence-write-scan.ts` - AST scan helper (new)
- `tests/licence-enforcement-boundary.test.ts` - registry-driven boundary test (new, 41 tests)
- `src/server/services/lesson-progress-service.ts` - continuity override on overrideLessonProgress
- `src/server/services/staff-account-service.ts` - continuity override on deactivateInternal
- `src/server/services/email-delivery-log-service.ts` - continuity override on resendInternal

## Decisions Made

See key-decisions. The registry classification follows the research inventory and the adopted ledger exactly (A9, A10, A11 visible as effective-effect assertions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scanner missed permission calls whose options are passed by name**
- **Found during:** Task 2 (first full scan, comparing 117 detected sites against a 119-site survey)
- **Issue:** the first scanner draft required an object-literal third argument, so the two `licence.activate` calls in `licence-staff-service.ts` (options passed as the const `ACTIVATION_OPTIONS`) were not detected: a false negative of exactly the kind T-14-17-03 names.
- **Fix:** any third argument now counts; a same-file const resolving to an object literal is read; anything else sets `unresolvedOptions`, which the test requires to be false. Added `unresolvedOptions` to the permission-call record (an additive field on the interface contract; no member renamed or removed).
- **Files modified:** `tests/support/licence-write-scan.ts`, `tests/licence-enforcement-boundary.test.ts`
- **Commit:** none (owner policy)

### Interpretation choices (flag for owner review)

- **Exact-three snapshot versus five real overrides.** The plan says exactly three call-site overrides exist. The scan shows three that change an effect plus two in `licence-staff-service.ts` that restate the continuity default. I did not remove the two restatements (they pin the recovery route as never blockable even if the effect map were edited, T-14-06-03, and that file is outside this plan's file list). The snapshot therefore asserts exactly three effective exceptions plus one separately hard-coded reviewed restatement pair, so any new override of either kind still fails the test. If the owner prefers literally three overrides in the tree, deleting `ACTIVATION_OPTIONS` from `licence-staff-service.ts` and the `REVIEWED_RESTATEMENTS` line from the test is a two-line change.
- **course-service and learner-quiz-service not registered.** The plan lists both. `learner-quiz-service.ts` does not exist in the tree (a stale name) and `course-service.ts` has no write and no permission call of its own (they are in the registered `resource-service.ts` factory), so registering it as withPermission would fail the plan's own default-block rule that every withPermission file has a permission call. `session-service` and `hold-release-system-service` do exist, do not write by the scan, and are registered as continuity and system as the plan names them.
- **Registered non-writers.** `email-delivery-log-service` (withPermission), `hold-release-system-service` and `session-service` are registered although the scan does not list them as writers. The completeness test only requires writers to be registered and entries to exist.
- **Added checks beyond the plan:** a not-a-db-write file may not import a database module, the "only services reach the database" premise test, the effective-effect assertions for A9, A10 and A11, and unit tests that make each check return an offender for a deliberately broken input.

**Total deviations:** 1 rule-based (Rule 1), 4 interpretation notes. **Impact:** the interface contract gained one additive field; no other contract change.

## Issues Encountered

None blocking. No auth gates, no checkpoints, no Rule 4 decisions. The scan works at file granularity: a registered withPermission file could in principle add an unwrapped write function without the test noticing (the file is already classified). The completeness test guarantees the file is reviewed once; per-function enforcement remains the job of the choke-point integration tests (14-11, 14-21). This limit is accepted by the plan's design (the service file is the unit).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change: tests, a pure data module and three options arguments. Register items T-14-17-01 (completeness, stale, premise tests with mutation proof), -02 (exact snapshot in test, registry and source), -03 (structural detection, const-options resolution, unresolved flag, dynamic-file list), -04 (importer guard) are covered by tests; -05 is accepted as documented.

## Outstanding Human UAT

- None specific to this plan (no UI or runtime change).
- Carried forward: the 14-03 migration is proven on Testcontainers only and is NOT applied to the shared database (outstanding human step, WINDOWS.md entry id 20). This plan used no database.
- Broken-windows ledger: no new stub, skipped test or unrun verify, so nothing was appended to `.planning/WINDOWS.md`.

## Next Phase Readiness

- Any later plan that adds a service file, write path or permission must classify it in `registry.ts` or this test fails; plan 14-21 can cite this test as the D-09 "no unguarded write path" evidence.
- If the owner redirects A9, A10 or A11, the change is one effect-map or override edit plus the matching hard-coded snapshot line and the effective-effect assertion.

## Self-Check: PASSED

- FOUND on disk: src/server/licence/registry.ts (contains checkout.start, checkout.initiate_stripe, checkout.initiate_paystack, registration); tests/support/licence-write-scan.ts (exports scanServiceFiles and scanSource); tests/licence-enforcement-boundary.test.ts; the three edited services (each contains `licence: "continuity"`); this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run. No prisma command or DATABASE_URL access was used.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-02*
