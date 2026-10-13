---
phase: 14-software-licence-deployment-control
plan: 07
subsystem: licensing
tags: [licence, activation, postgres, select-for-update, version-guard, anti-replay, audit, d-13, lic-01, lic-05]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-02 verifyLicence, trust set, fixtures; 14-03 LicenceState/LicenceRecord/DeploymentIdentity schema and tests/support/licence-db.ts; 14-04 deriveState and LicenceStatusSnapshot; 14-DECISIONS.md D-02 option-a, OQ1 option-a"
provides:
  - "src/server/services/licence-service.ts: LicenceDbClient, readRows, readActivationRows, computeDerived, buildStatusSnapshot, assessActivation, createLicenceService, licenceService (ensureDeploymentIdentity, getStatusSnapshot, inspect)"
  - "src/server/services/licence-activation-service.ts: createLicenceActivationService, licenceActivationService (activateLicence)"
  - "Audit actions licence.activated and licence.activation_rejected"
affects: [14-09, 14-10, 14-14, 14-15, 14-16, 14-17, 14-21]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low
actuals:
  tokens: 14760
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Lock-then-read: SELECT ... FOR UPDATE on the LicenceState singleton, then reads, then a version-guarded updateMany; a lost race throws a sentinel inside the transaction so the record insert rolls back with it"
    - "Derive-on-read: the stored raw text is re-verified in runtime mode on every status read and the derived dates come from the signed payload, never the denormalised columns"
    - "Self-heal only when absent: the singleton INSERT ... ON CONFLICT DO NOTHING runs only after a read found the row missing, so the ordinary read path writes nothing"
    - "Rejection audit written after the (empty) transaction through the plain sink; success audit inside the transaction through the in-transaction sink"

key-files:
  created:
    - src/server/services/licence-service.ts
    - src/server/services/licence-activation-service.ts
    - tests/licence-service.test.ts
    - tests/licence-activation.integration.test.ts
  modified: []

key-decisions:
  - "A CONCURRENT_CHANGE rolls back by throwing an internal sentinel out of db.$transaction and catching it outside; returning normally (as the plan text says) would commit the already-inserted LicenceRecord and leave a partial update"
  - "computeDerived rejects a stored record whose signed licenceId differs from the record's licenceId column as BAD_SIGNATURE, so swapping in a different validly signed file by SQL cannot change the state"
  - "The anti-replay rule reads the whole (tiny, append-only) register with findMany instead of licenceRecord.aggregate, so the same rows also answer the same-licenceId and older-record rules without a second query"
  - "readRows, readActivationRows and the LicenceReadClient/LicenceTxClient types are exported (plan 14-09 builds on readRows); computeDerived takes a TrustSet or a loader so a trust-set load failure maps to UNAVAILABLE"

patterns-established:
  - "Services take the audit sinks as injected deps; integration tests bind them to the test database client and never import the configured-database recordAudit singleton"

requirements-completed: [LIC-01]

coverage:
  - id: C1
    description: "LIC-01: a provider-signed licence activates in one locked transaction; the shared snapshot reads ACTIVE and one licence.activated audit row exists with no raw/signature/header"
    requirement: "LIC-01"
    verification:
      - kind: integration
        ref: "tests/licence-activation.integration.test.ts (tracer describe, 2 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "LIC-01: BAD_FORMAT, BAD_SIGNATURE, UNKNOWN_KEY, KEY_REVOKED, UNSUPPORTED_SCHEMA, WRONG_DEPLOYMENT, NOT_YET_VALID, EXPIRED, WRONG_CLIENT, OLDER_THAN_ACTIVE, ALREADY_ACTIVE, CONCURRENT_CHANGE each returned as a closed code with no record, state or activated-audit change and one closed-code rejection audit row"
    requirement: "LIC-01"
    verification:
      - kind: integration
        ref: "tests/licence-activation.integration.test.ts (every rejection rule, 12 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "LIC-05, T-14-07-04: concurrent activations serialize (same file: one ok plus ALREADY_ACTIVE; different files: final active is the newer, version equals ok count); a lost version-guarded write rolls back the record insert"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-activation.integration.test.ts (concurrency describe and rollback test) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "D-13, T-14-07-03: raw-text edits are detected on every read (INVALID, restricted); date-only edits do not change the result; missing singleton rows are recreated; injected clock drives activation and restriction time"
    requirement: "LIC-01"
    verification:
      - kind: integration
        ref: "tests/licence-activation.integration.test.ts (tamper, self-heal, clock tests) and tests/licence-service.test.ts computeDerived tests (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "D-01: neither service reaches next/*, @/server/permissions* or getCurrentActor in its runtime closure"
    requirement: "LIC-03"
    verification:
      - kind: unit
        ref: "tests/licence-service.test.ts (closure describe, 2 tests) and tests/boundary.test.ts (pass)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 07: Licence Service and Activation Transaction Summary

**Closure-safe licence service (database-derived status, deployment identity self-heal, activation assessment) and an atomic activation transaction that locks the LicenceState singleton with SELECT ... FOR UPDATE, applies a version-guarded update and writes the licence.activated audit row together with the record, proven on a real Postgres including parallel activation, replay, client pinning and raw-text tamper detection.**

## Performance

- **Duration:** about 35 min
- **Completed:** 2026-10-01
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 4 created, 0 modified

## Accomplishments

- `licence-service.ts`: `readRows` reads the singleton state, its active record and the deployment identity from the database on every call (no per-process cache, D-13) and recreates a missing singleton with `INSERT ... ON CONFLICT DO NOTHING`, only after a read found it absent. `computeDerived` re-verifies the stored raw text with `verifyLicence` in runtime mode and feeds `deriveState` the signed payload dates; a rejection becomes INVALID, a thrown `LicenceUnavailableError` becomes VALIDATION_ATTENTION. `buildStatusSnapshot` copies only the `LicenceStatusSnapshot` allow-list (no raw). `assessActivation` orders the checks verifier (activate mode, deployment, pinned client A5, notBefore), EXPIRED, ALREADY_ACTIVE, OLDER_THAN_ACTIVE (older record or issuedAt not strictly newer, A7). `createLicenceService` exposes `ensureDeploymentIdentity`, `getStatusSnapshot`, `inspect`; `licenceService` is wired to `prisma` and `recordAudit`.
- `licence-activation-service.ts`: `activateLicence` runs one `db.$transaction` (15 s timeout): lock the singleton `FOR UPDATE`, read rows plus the register history, assess, insert the `LicenceRecord` (with `activatedById`), derive the new state, `licenceState.updateMany` where `version` equals the version read (count 0 rolls everything back and returns CONCURRENT_CHANGE), write `licence.activated` in the same transaction, then read the committed rows back and return the snapshot. A rejection returns before any write and then writes one `licence.activation_rejected` row with only `{ code }` and `targetId` null.
- Tracer proven first: one valid licence activates, snapshot reads ACTIVE, one `licence.activated` audit row with actor, LICENCE target and SUCCESS, no raw/signature/header key or value in the row.
- All twelve codes asserted at the service level; every rejection test compares the whole LicenceState row (including version and updatedAt) and the licence and audit counts before and after.
- Concurrency: same file in parallel gives exactly one ok plus ALREADY_ACTIVE, one record, one activated row, version 1; different files in parallel end on the newer licence with version equal to the ok count and no CONCURRENT_CHANGE.
- A real-database rollback proof forces `updateMany` to report 0 through a proxied transaction: the already-inserted record is rolled back, state is unchanged, no activated row, one CONCURRENT_CHANGE rejection row.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): both services, closure and snapshot tests, tracer integration tests. Commit: none (owner policy)
2. Task 2: rejection path, rejection audit, replay and pinning, inspect-never-writes, fake-db CONCURRENT_CHANGE. Commit: none (owner policy)
3. Task 3: parallel, tamper, self-heal and clock tests. Commit: none (owner policy)

TDD gate: the services were written before their tests (the plan's own task order lists implementation before test authoring), so no separate RED run exists; all tests passed on the first run. No `test(...)` or `feat(...)` git commits exist because commits are prohibited by owner policy. To guard against vacuous passes, the tamper, rollback and parallel tests assert concrete database state (row counts, version, activeRecordId) rather than only return codes.

## Verification Results (real output)

- `npx vitest run tests/licence-service.test.ts tests/licence-activation.integration.test.ts --project node --no-file-parallelism`: 2 files passed, 34 tests passed, 0 failed (46.7 s; Testcontainers postgres:16-alpine, all 23 migrations applied including `20261001120000_licence_deployment_control`).
- `npx vitest run tests/boundary.test.ts tests/audit-append-only.test.ts --project node`: 2 files passed, 26 tests passed (the single-audit-creator rule still holds; the services create no audit rows directly).
- `npx tsc --noEmit`: no output, 0 errors (no new error).
- `npx eslint` on the two service files and two test files: no output, 0 findings.
- Acceptance: `licence-activation-service.ts` contains the literal `FOR UPDATE` (line 88 plus the header). Every code literal (BAD_FORMAT, BAD_SIGNATURE, UNKNOWN_KEY, KEY_REVOKED, UNSUPPORTED_SCHEMA, WRONG_DEPLOYMENT, WRONG_CLIENT, NOT_YET_VALID, EXPIRED, OLDER_THAN_ACTIVE, ALREADY_ACTIVE, CONCURRENT_CHANGE) appears in `tests/licence-activation.integration.test.ts`.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-07-PLAN.md LIC-01 LIC-03 LIC-06`, output verbatim:

```
{
  "ready": [
    "LIC-01"
  ],
  "blocked": [
    "LIC-03",
    "LIC-06"
  ],
  "total": 3
}
```

  Only LIC-01 is marked complete. LIC-03 (permission wrapper, plan 14-15, guard test 14-17) and LIC-06 (enforcement and diagnostic audit, plan 14-09) stay open.

## Files Created/Modified

- `src/server/services/licence-service.ts` - status snapshot, identity, assessment, derivation
- `src/server/services/licence-activation-service.ts` - locked, version-guarded activation transaction
- `tests/licence-service.test.ts` - closure and pure-helper tests (13 tests)
- `tests/licence-activation.integration.test.ts` - real-Postgres activation, rejection, replay, concurrency, tamper, self-heal and clock tests (21 tests)

## Decisions Made

See key-decisions. The audit sinks are injected (`audit`, `auditInTransaction`) so the integration tests write audit rows through the real redacting sink bound to the Testcontainers client and never touch the configured-database `recordAudit` singleton.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Returning normally on a lost version-guarded update would commit a partial activation**
- **Found during:** Task 1 design (before writing the code)
- **Issue:** The plan says a count of zero "returns CONCURRENT_CHANGE and rolls back by returning before any further write". By then the `LicenceRecord` has already been inserted inside the transaction (the state update needs its id for the foreign key), so returning normally commits the record without the state update, breaking the "commit or roll back together" truth (T-14-07-04).
- **Fix:** an internal `ConcurrentChangeSignal` is thrown out of the transaction callback (Prisma rolls back) and caught outside, which then writes the CONCURRENT_CHANGE rejection row. A real-database test (proxied `updateMany` returning 0) asserts zero records, unchanged state and no activated audit row afterwards.
- **Files modified:** src/server/services/licence-activation-service.ts, tests/licence-activation.integration.test.ts
- **Commit:** none (owner policy)

**2. [Rule 2 - Missing critical functionality] A stored record could be swapped for a different validly signed file**
- **Found during:** Task 3 (tamper design)
- **Issue:** Re-verifying `record.raw` proves only that the text is signed; an attacker with SQL access could replace the raw text with another validly signed licence for the same deployment (for example one with a later expiry) and the derived state would follow it.
- **Fix:** `computeDerived` rejects a verified licence whose signed `licenceId` differs from the record's `licenceId` column as BAD_SIGNATURE (INVALID, restricted), reusing an existing closed code rather than adding one. Covered by a unit test.
- **Files modified:** src/server/services/licence-service.ts, tests/licence-service.test.ts
- **Commit:** none (owner policy)

### Interpretation choices (no behaviour change to the plan's listed tests)

- `readRows` and the singleton self-heal run the INSERT only when the row is absent (a `findUnique` comes first), so a status read never writes in the normal case; the plan allowed the INSERT unconditionally. Test 4 (delete both rows, read) proves the self-heal.
- `assessActivation` returns `{ ok: true, licence, preview }` (the verified licence is needed for the insert); `inspect` returns only the preview, matching the interface contract.
- `computeDerived` returns the derived state plus `verification` and `verified` (structurally a `DerivedState`, so `dueNoticeKeys` accepts it); `buildStatusSnapshot` takes that evaluation as its second argument.
- Task 2 Test 6 (fake database) is placed in the integration file so the rejection-code literals grep finds CONCURRENT_CHANGE there. "Writes no audit row" is implemented as: no `licence.activated` row (the in-transaction sink is never called) while one `licence.activation_rejected` row with code CONCURRENT_CHANGE is written, as Task 2 Action also requires.
- The anti-replay data comes from `licenceRecord.findMany` (id, licenceId, issuedAt) rather than `aggregate`; the register is append-only and holds a handful of rows ever.
- `activatedById` is set to the actor on the `LicenceRecord` insert (schema attribution column); the actor therefore must be an existing user, which the permission-wrapped caller in plan 14-15 guarantees.

**Total deviations:** 2 (1 Rule 1, 1 Rule 2). **Impact:** none breaks the interface contract; the exports and signatures named in the plan are unchanged, with `readRows`, `readActivationRows` and the client types additionally exported.

## Issues Encountered

None beyond the deviations above. All 34 tests passed on the first run.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change: the services read and write only the three tables from plan 14-03 and the audit sink. Register items T-14-07-01 through T-14-07-05 and T-14-07-07 are covered by tests (forgery codes, replay, tamper, concurrency, no raw in audit or snapshot, client pinning). T-14-07-06 (activation callable without permission) is by design not enforced here: the service performs no authorization and imports no permission code, and the only caller will be the permission-wrapped staff service in plan 14-15 with the importer guard test in plan 14-17.

## Next Phase Readiness

- Plan 14-09 can extend `createLicenceService` with `evaluateAndRecord`, `checkWriteGate`, `assertWriteAllowed`, `getRestrictionCutoff` and `buildDiagnosticReport` using the exported `readRows`, `computeDerived` (accepts a trust-set loader) and `buildStatusSnapshot`.
- Plan 14-15 wraps `licenceActivationService.activateLicence({ actorId, raw, correlationId })` and `licenceService.inspect(raw)` with `licence.activate`; plan 14-10 reads `licenceService.getStatusSnapshot()`.
- Carried forward: the 14-03 Task 2 migration apply to the shared database remains an outstanding human step (WINDOWS.md entry id 20). This plan used Testcontainers only and never connected to the configured DATABASE_URL.
- Broken-windows ledger: no new stub, skipped test or unrun verify was introduced, so nothing was appended to `.planning/WINDOWS.md`.

## Self-Check: PASSED

- FOUND on disk: src/server/services/licence-service.ts; src/server/services/licence-activation-service.ts; tests/licence-service.test.ts; tests/licence-activation.integration.test.ts.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
