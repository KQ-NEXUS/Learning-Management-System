---
phase: 14-software-licence-deployment-control
plan: 21
subsystem: licensing
tags: [licence, integration-test, testcontainers, restricted-continuity-mode, permission-matrix, audit, lic-05, lic-06, lic-08]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-06 LICENCE_PERMISSION_EFFECT; 14-07 activation service; 14-09 licence service (checkWriteGate, evaluateAndRecord, assertWriteAllowed, buildDiagnosticReport); 14-11 createWithPermission licence guard and LicenceRestrictedError; 14-15 createLicenceStaffService; 14-DECISIONS.md (D-02 option-a, OQ1 option-a, OQ3 adopted default)"
provides:
  - "tests/support/licence-flow.ts: activateAt, serviceAt, guardedWithPermission, snapshotTableCounts plus makeClock, mintAt, activationAt, auditSink, resetLicenceFlow, spyHandler, FLOW_KEY and FLOW_TRUST_SET"
  - "tests/licence-restricted.integration.test.ts (90 tests): all 37 permissions across the grace boundary through the real choke point and database-backed guard, parity, explicit guard, dynamic default, never-activated, recovery by activation, data preservation, database-writable check and a static no-deletion scan"
  - "tests/licence-audit.integration.test.ts (12 tests): the seven LIC-06 audit row classes, single-winner transition, enforcement coalescing, redaction over every licence.* row and audit-access separation"
affects: []

estimate:
  tokens: 65000
  raw_tokens: 65000
  tasks: 3
  confidence: low
actuals:
  tokens: 15000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "One real createLicenceService instance behind the guard so the per-actor enforcement coalescing (A14) behaves as in a running process"
    - "A destructive handler (creates a user, deletes all enrolments) behind every write-class permission, so a guard that failed open would change the row counts and fail the preservation test"
    - "Static AST scan that exempts only a same-file in-memory Map or Set receiver from the delete rule, with a fixture self-test proving prisma delete, deleteMany and raw TRUNCATE are flagged"

key-files:
  created:
    - tests/support/licence-flow.ts
    - tests/licence-restricted.integration.test.ts
    - tests/licence-audit.integration.test.ts
  modified: []

key-decisions:
  - "No production code changed: no end-to-end test exposed a defect in plans 14-01 to 14-20"
  - "The no-deletion scan exempts a delete call whose receiver is a same-file new Map, Set, WeakMap or WeakSet const; licence-service.ts:647 is enforcementAudited.delete(actor), the in-memory coalescing map, not a data deletion"
  - "OQ3 proof uses grants equal to the full PERMISSIONS spread (the seeded Administrator shape) and demonstrates licence.activate recovers a restricted deployment; the PRD 18.4 deviation stays documented in 14-DECISIONS.md"

patterns-established:
  - "A permission added to the catalogue is covered automatically by the it.each matrices and fails if it lacks a classification (Object.hasOwn check on LICENCE_PERMISSION_EFFECT)"

requirements-completed: [LIC-05, LIC-06, LIC-08]

coverage:
  - id: C1
    description: "LIC-05: through the real createWithPermission with the real database-backed guard, the 13 write-class permissions are refused with LicenceRestrictedError (also an AuthorizationError, handler never run) at exactly graceEndsAt and run at graceEndsAt minus 1 ms; the 14 read and 10 continuity permissions run in both states; 13 refused and 24 allowed asserted"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-restricted.integration.test.ts tracer describe: 74 per-permission cases plus the same-licence boundary pair (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "LIC-05 parity: an actor with no grant gets an identical AuthorizationError (name and message) in both states for all 37 permissions and never a LicenceRestrictedError, with no enforcement row naming them; unauthenticated callers get AuthenticationError in both states"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-restricted.integration.test.ts parity describe (2 tests, pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "LIC-05: assertWriteAllowed for checkout.start and registration resolves at G minus 1 ms and rejects with LicenceWriteBlockedError at G; a permission outside the catalogue is refused at G (dynamic default write); a never-activated deployment runs every permission (OQ1 option-a)"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-restricted.integration.test.ts explicit guard (2), dynamic default (1), never activated (1) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "D-07 and PRD 18.1 recovery: in restricted state an actor with the full permission spread activates a renewal through the staff service and the write class runs again (13 refused before, 13 ran after); an actor without licence.activate and a licence.view-only actor are refused with AuthorizationError and nothing changes; a tampered stored licence restricts at once and activation recovers it"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-restricted.integration.test.ts recovery by activation describe (4 tests, pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "LIC-08 and D-05: row counts of every application table (at least six populated, including User, Cohort, Enrolment, Order, PaymentAttempt, Notification) are identical after a restricted period with 39 refused destructive write attempts and every continuity and read call; the database stays writable (insert, update, audit append, read-only settings off); no licence module contains a delete, deleteMany, DELETE FROM or TRUNCATE on any table"
    requirement: "LIC-08"
    verification:
      - kind: integration
        ref: "tests/licence-restricted.integration.test.ts data preservation (2) and no-deletion scan (2) (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "LIC-06 and D-17: audit rows exist with the expected action, actor or SYSTEM actor, targetType LICENCE, scope, outcome and correlation for licence.activated, licence.activation_rejected, licence.restriction_enforced, licence.diagnostic_downloaded, licence.state_changed, licence.verified and licence.clock_rollback; three parallel evaluators plus two parallel gate calls produce exactly one state_changed row and a GRACE final state; 20 refused calls by one actor coalesce to one enforcement row"
    requirement: "LIC-06"
    verification:
      - kind: integration
        ref: "tests/licence-audit.integration.test.ts (7 event-class tests, single-winner, coalescing; pass)"
        status: pass
    human_judgment: false
  - id: C7
    description: "LIC-06 redaction and PRD 18.4: across every licence.* audit row (all seven classes produced by one scenario) before, after and reason contain no minted text, forged text, header, payload or signature segment, public or private key material, the words password or secret, and no row has a null targetType; licence and audit permissions are separate groups and neither pair authorizes the other"
    requirement: "LIC-06"
    verification:
      - kind: integration
        ref: "tests/licence-audit.integration.test.ts redaction (1) and audit access separation (2) (pass)"
        status: pass
    human_judgment: false

duration: ~95min
completed: 2026-10-02
status: complete
---

# Phase 14 Plan 21: End-to-End Enforcement, Recovery, Preservation and Audit Proof Summary

**The assembled licence system is proven on a real Postgres: across all 37 permissions exactly the 13 write-class ones flip at the graceEndsAt boundary through the real choke point, a restricted deployment recovers by activation, nothing is deleted or locked at database level, and every licence event class is audited without licence text or key material. No production code needed to change.**

## Performance

- **Duration:** about 95 min, most of it Testcontainers runs under machine load
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 3 created, 0 modified (tests only)

## Accomplishments

- Tracer (Task 1): `tests/licence-restricted.integration.test.ts` iterates `PERMISSIONS` with `it.each` for the ACTIVE pass (G minus 1 ms) and the restricted pass (G), each case also asserting the permission is classified (a new unclassified permission fails the matrix). An aggregate case on one stored licence asserts 37 allowed before G, then exactly 13 refused (equal to the write-class set) and 24 allowed at G, and that refused handlers never ran. Parity, unauthenticated, explicit-guard (`checkout.start`, `registration`), dynamic-default (an uncatalogued permission string is refused) and never-activated (OQ1 option-a, all 37 run) cases complete the six behaviours.
- Task 2: recovery through the real `createLicenceStaffService` over the real guard (the full permission spread activates a renewal in restricted state, then the write class runs; `licence.activate` is continuity so it is never blocked); refusal for an actor without `licence.activate` and for a `licence.view`-only actor; invalid-state recovery after tampering with the stored signature; data preservation with a populated graph (User, Cohort, Enrolment, Order, PaymentAttempt, Notification, Module, Lesson, LessonProgress, ScheduledSession, AttendanceRecord, Certificate, staff User, Role and Assignment) where every write-class handler is destructive so a guard that failed open would change the counts; database-writable proof (insert, update, audit append, `default_transaction_read_only` and `transaction_read_only` both off); static no-deletion scan with a fixture self-test.
- Task 3: `tests/licence-audit.integration.test.ts` asserts each of the seven LIC-06 row classes (action, actorId or SYSTEM actor, targetType LICENCE, targetId, scope GLOBAL, outcome, correlation, before and after), single-winner transitions under parallel load (3 evaluators plus 2 REQUEST gate calls: one `licence.state_changed` row, final state GRACE, version incremented once), enforcement coalescing (20 refusals by one actor give one row, a second actor a second), a redaction sweep over one scenario that produces all seven classes, and audit-access separation (licence and audit groups are disjoint and `hasPermission` shows neither pair authorizes the other).
- `tests/support/licence-flow.ts` exports `activateAt`, `serviceAt`, `guardedWithPermission`, `snapshotTableCounts` (names read from information_schema, migrations table and excluded names skipped) plus `makeClock`, `mintAt`, `activationAt`, `auditSink`, `resetLicenceFlow`, `spyHandler`, `FLOW_KEY` and `FLOW_TRUST_SET`. `guardedWithPermission` shares one `createLicenceService` instance across the guard calls (the plan sketch built a new service per call, which would have defeated the A14 coalescing the audit test proves).

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): `tests/support/licence-flow.ts` and the matrix half of `tests/licence-restricted.integration.test.ts`. Commit: none (owner policy)
2. Task 2: recovery, data preservation, database-writable and no-deletion scan in the same file. Commit: none (owner policy)
3. Task 3: `tests/licence-audit.integration.test.ts`. Commit: none (owner policy)

TDD gate: no `test(...)` or `feat(...)` commits exist (commits prohibited by owner policy). This plan adds tests over already-built behaviour, so there is no RED-then-GREEN implementation step and no production change; every new test passed on first execution against the existing code. Non-vacuity is argued, not mutation-tested: exact counts (13 and 24), the destructive handlers, the scenario-must-produce-each-action assertions and the scanner fixture self-test make a regression observable. Tracer gate: the auto-chain flag is false and the tracer `<verify>` is automated-only; the tracer file passed end to end (82 of 82) before Tasks 2 and 3 were added.

## Verification Results (real output)

- Task 1 verify, `npx vitest run tests/licence-restricted.integration.test.ts --project node --no-file-parallelism` (tracer content only): 1 file, 82 tests passed (a first attempt failed in `beforeAll` with Docker "HTTP code 500 container not running", a daemon flake under load, nothing in the tests; the retry passed).
- Same file after Task 2: 90 tests passed in 199 s under load.
- `npx vitest run tests/licence-audit.integration.test.ts --project node --no-file-parallelism`: 12 passed (first attempt again hit Docker "HTTP code 500 server error" at container start, retry passed in 128 s).
- Plan gate, `npx vitest run tests/licence-audit.integration.test.ts tests/licence-restricted.integration.test.ts --project node --no-file-parallelism` (final run after the last edit): 2 files, 102 tests passed, exit 0, 180 s under load. No `--testTimeout` override was needed for these integration files (hooks use the 300 s Testcontainers timeout).
- Whole-tree scan files that could pick up the new files, run alone with `--testTimeout=60000` (applied preemptively, not because they timed out): `licence-wording`, `licence-purity`, `licence-vocabulary`, `licence-enforcement-boundary`, `audit-append-only`, `boundary` gave 152 passed and 1 failed on the first run (see Deviation 2), then `licence-wording`, `licence-ui-mirror-gate`, `licence-purity`, `licence-staff-access`, `licence-action-refusal`, `no-malware-runtime` gave 141 passed after the fix.
- `npx tsc --noEmit`: no output, 0 errors (before and after). No new error.
- `npx eslint tests/support/licence-flow.ts tests/licence-restricted.integration.test.ts tests/licence-audit.integration.test.ts`: exit 0, no findings.
- Testcontainers only: the harness deploys migrations to a throwaway `postgres:16-alpine` container (datasource logged as localhost on a random port, database "test"); no command was run against the configured DATABASE_URL and the shared database was never contacted. The 14-03 migration remains unapplied there.
- Not run (owner policy): the full suite (the orchestrator runs it) and the manual-only items (Netlify "Run now" after a production deploy, provider key custody review, regeneration of the PRD and PXR docx twins).

## Files Created/Modified

See key-files. Tests only; no production file changed.

## Decisions Made

See key-decisions. Everything else follows the plan's behaviours, including OQ3 (visible in the recovery test titles and comments) and OQ1 option-a (the never-activated case asserts "every permission runs", matching 14-DECISIONS.md).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan premise] "Zero property calls named delete" cannot hold literally**
- **Found during:** Task 2 (preparing the static scan)
- **Issue:** `src/server/services/licence-service.ts:647` is `enforcementAudited.delete(actor)`, a `Map.delete` that expires entries of the in-memory per-actor coalescing map (A14). It is a property call named `delete` but not a data deletion, so a literal zero-count assertion over the listed files would fail on correct code. Evidence: `grep -rnE "\.(delete|deleteMany)\(|TRUNCATE|DELETE FROM" src/server/licence src/server/services/licence-*.ts` returns only that line.
- **Fix:** the scan resolves the receiver and exempts only a same-file const initialised with `new Map`, `new Set`, `new WeakMap` or `new WeakSet`; every other `delete` or `deleteMany` property call, and any string or template text holding `DELETE FROM` or `TRUNCATE`, counts. A fixture self-test proves a Map is exempt while `tx.user.delete`, `prisma.enrolment.deleteMany`, a raw `TRUNCATE` and a raw `DELETE FROM` are flagged. The strictness is unchanged for anything that can touch a database, and the scan asserts it covers at least 15 files so it cannot pass vacuously.
- **Files modified:** `tests/licence-restricted.integration.test.ts`
- **Commit:** none (owner policy). Ledger: WINDOWS (deviation).

**2. [Rule 1 - Defect in this plan's own test caught by the 14-20 wording check] Retired post-grace wording in new test text**
- **Found during:** final cross-check of whole-tree scan tests
- **Issue:** the title and a comment in `tests/licence-restricted.integration.test.ts` used the retired two-word wording the 14-20 `licence-owned:` check bans (lines 523 and 603).
- **Fix:** reworded to "write lock" in the title and comment; the assertions are unchanged. `tests/licence-wording.test.ts` then passed (35 of 35).
- **Files modified:** `tests/licence-restricted.integration.test.ts`
- **Commit:** none (owner policy)

### Interpretation choices (flag for owner review)

- **One service instance behind the guard:** the plan's helper sketch calls `serviceAt(...)` inside `check`, which would create a fresh service per call and make the A14 coalescing unobservable. `guardedWithPermission` builds one service per helper call (overridable with `service`), as a running process does.
- **Recording the audit sink:** the plan says to use the application's `recordAudit`; that is bound to the application's own prisma singleton, so the "audit keeps appending" case uses `recordAuditInTransaction(testDb.prisma, ...)`, which shares `buildAuditRow` with `recordAudit` (the plan's Task 3 action already prescribes this equivalent).
- **Tamper target:** the "invalid" cases tamper a middle character of the signature segment of the stored text (`parts[3]` of `LMS-LIC1.header.payload.signature`) so the result is a signature failure; the existing 14-09 tests tamper `parts[2]` (the payload segment) and accept BAD_SIGNATURE or BAD_FORMAT. Both reach INVALID.
- **Restricted-period clock for preservation:** one hour after graceEndsAt, so the stored state has crossed into RESTRICTED_CONTINUITY by derivation, not only at the instant.

**Total deviations:** 2 auto-fixed (both Rule 1), 4 interpretation notes. **Impact:** none breaks a contract; no production symbol was added or changed.

## Issues Encountered

- Docker flake under machine load on two of the first attempts (container start returned HTTP 500); both retried once without any change and passed. If a later full-suite run shows the same container-start error, treat it as an environment flake, not a defect.
- No auth gates, no Rule 4 architectural decisions, no production defects found.

## Known Stubs

None.

## Threat Flags

None. Tests only; no endpoint, auth path, file access pattern or schema. Threat register: T-14-21-01 mitigated (matrix over all 37 permissions at G minus 1 ms and G, plus the dynamic default); T-14-21-02 mitigated (recovery while restricted through the real guard, plus invalid-state recovery); T-14-21-03 mitigated (row-count preservation with destructive handlers, static no-deletion scan, database-writable check); T-14-21-04 mitigated (seven audit classes and the single-winner test); T-14-21-05 mitigated (redaction sweep over every `licence.*` row); T-14-21-06 accepted (OQ3 adopted default, recovery benefit demonstrated).

## Outstanding Human Steps

Unchanged from earlier plans and out of this plan's scope: apply the 14-03 migration to the shared database, Netlify "Run now" after a production deploy, provider key custody review, regeneration of the PRD and PXR docx twins (OQ7), contract wording alignment.
