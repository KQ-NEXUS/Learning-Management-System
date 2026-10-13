---
phase: 14-software-licence-deployment-control
plan: 09
subsystem: licensing
tags: [licence, write-gate, restriction-cutoff, compare-and-swap, clock-rollback, audit, diagnostics, d-04, d-12, d-13, d-14, d-17, lic-04, lic-05, lic-06]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-07 readRows, computeDerived, buildStatusSnapshot, createLicenceService, activation service; 14-04 deriveState, dueNoticeKeys, detectRollback, shouldAdvanceHighWater, createClockMonitor, utcHourBucket; 14-02 LicenceWriteBlockedError; 14-DECISIONS.md OQ1 option-a"
provides:
  - "licence-service.ts: checkWriteGate, assertWriteAllowed, getRestrictionCutoff, evaluateAndRecord, buildDiagnosticReport on createLicenceService and the licenceService singleton"
  - "Exports DiagnosticReport, DIAGNOSTIC_REPORT_KEYS, WriteGateDecision, EvaluationResult, EvaluationSource, EvaluationTransition"
  - "Audit actions licence.restriction_enforced, licence.state_changed, licence.verified, licence.clock_rollback"
affects: [14-10, 14-11, 14-13, 14-14, 14-15, 14-16, 14-17, 14-21]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low
actuals:
  tokens: 19500
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Gate with no allow-path write and no decision cache: every call re-reads and re-verifies; the only in-process memory (last-known-good plus degradedSince) is consulted solely when the database read itself throws, and lives in the createLicenceService closure so instances never share it"
    - "Plan then compare-and-swap: a pure planEvaluation decides the write set; db.$transaction runs a version-guarded updateMany and only the winner writes the audit rows; a loser re-reads (up to 3 attempts, touch-only writes skipped after a loss) and reports the winner's state with won false"
    - "Opportunistic transition from the gate: at most one evaluateAndRecord(REQUEST) per call, only when derived state differs from stored, errors logged and swallowed"
    - "Audit throttling: restriction enforcement coalesced per actor (or the literal system) per 60 s by an in-closure Map on the injected clock; verification audited only on outcome change"
    - "Diagnostic report built field by field against an exported ordered allow-list tuple, with a source-level test that the method never spreads a row"

key-files:
  created:
    - tests/licence-gate.integration.test.ts
    - tests/licence-evaluate.integration.test.ts
    - tests/licence-diagnostic.test.ts
  modified:
    - src/server/services/licence-service.ts

key-decisions:
  - "evaluateAndRecord reports the due noticeKeys on every call, not only for the winner or on a transition: the expiring-{60..1} bucket moves without any state change, and the notice writer (plan 14-14) dedupes on a deterministic event id, so repeating a key is harmless and a missed emit is recoverable"
  - "A loser of the version-guarded write retries (max 3 attempts) instead of returning at once, so a transition is not lost to a touch-only writer (high-water or lastVerifiedAt); after a loss only significant changes are retried, so five parallel callers still produce one version bump and one audit row"
  - "The local-failure window start (attentionSince) is kept while verification is UNAVAILABLE in every derived state, including INVALID(VALIDATION_WINDOW_EXHAUSTED), and cleared only when verification succeeds or is rejected, so the state cannot flap back into a fresh 24-hour window"
  - "A deployment that never activated has no verification to record: lastVerifiedAt and lastVerificationOutcome stay null and no licence.verified row is written; an activated deployment with no readable record is outcome FAILED (RECORD_MISSING)"
  - "The gate does not advance the high-water mark (no write on the allow path); STARTUP, SCHEDULED and REQUEST evaluations advance it under the 5-minute throttle, and a detected rollback re-baselines it to now"
  - "licence.clock_rollback uses outcome DETECTED and a failed verification uses outcome FAILED (the audit outcome column is free text)"

patterns-established:
  - "Tests simulate a lost compare-and-swap deterministically by interleaving a competing write inside a proxied transaction, instead of relying on timing"

requirements-completed: []

coverage:
  - id: C1
    description: "LIC-05 boundary: with an injected clock a stored licence is allowed at graceEndsAt minus 1 ms and blocked at exactly graceEndsAt; getRestrictionCutoff reports restrictedAt equal to graceEndsAt exactly; separate instances over one database agree"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-gate.integration.test.ts (tracer describe, 4 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "LIC-04, D-13, T-14-09-01: no per-process allow cache; editing the stored raw text blocks the same instance and a second instance immediately with the verification reason code; no write on the allow path"
    requirement: "LIC-04"
    verification:
      - kind: integration
        ref: "tests/licence-gate.integration.test.ts (tracer allow-path test and verification-failure describe) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "D-04, T-14-09-03: a state read failure keeps the last-known-good decision for exactly 24 hours (1 ms earlier still last-known-good, exactly 24 hours blocked with VALIDATION_WINDOW_EXHAUSTED), allows with no history, recovery restarts the window, and getRestrictionCutoff fails open"
    requirement: "LIC-04"
    verification:
      - kind: integration
        ref: "tests/licence-gate.integration.test.ts (read failure describe, 4 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "LIC-06, A14, T-14-09-04: licence.restriction_enforced is written once per actor per minute (boundary at 59,999 ms and 60,000 ms), the system actor is a separate key, and an audit failure never changes the decision"
    requirement: "LIC-06"
    verification:
      - kind: integration
        ref: "tests/licence-gate.integration.test.ts (coalescing describe, 3 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "LIC-05 concurrency, T-14-09-07: five parallel evaluations produce exactly one winner, one licence.state_changed row (actorType SYSTEM) and one version increment; a deterministically lost compare-and-swap reports won false and writes no audit row"
    requirement: "LIC-05"
    verification:
      - kind: integration
        ref: "tests/licence-evaluate.integration.test.ts (transitions describe and lost-write describe) (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "D-04: the attention window (23 hours unchanged, 24 hours INVALID with VALIDATION_WINDOW_EXHAUSTED and restrictedAt set, no flapping, recovery to the time-derived state clearing attentionSince)"
    requirement: "LIC-04"
    verification:
      - kind: integration
        ref: "tests/licence-evaluate.integration.test.ts (24-hour local-failure window describe, 2 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C7
    description: "D-12, P4, T-14-09-05: a rollback is detected only above 10 minutes (exactly 10 minutes tolerated, plus 1 ms reported once), writes one licence.clock_rollback row, sets clockAlertAt, re-baselines the mark, returns the clock-rollback-{UTC hour} key, never changes the licence state, never blocks the gate; the in-process monotonic comparison reports a step the stored mark cannot"
    requirement: "LIC-04"
    verification:
      - kind: integration
        ref: "tests/licence-evaluate.integration.test.ts (clock rollback describe, 3 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C8
    description: "LIC-06, Pitfall 7: the high-water mark advances only beyond 5 minutes and never backwards; licence.verified is written only on an outcome change; REQUEST writes nothing when nothing changed; SCHEDULED and STARTUP refresh lastVerifiedAt and lastGoodAt without an audit row; a never-activated deployment records no verification"
    requirement: "LIC-06"
    verification:
      - kind: integration
        ref: "tests/licence-evaluate.integration.test.ts (high-water, verification outcome and source semantics describes, 5 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C9
    description: "D-14, T-14-09-06: the diagnostic report has exactly the allow-listed keys in order, UTC ISO instants and key ids only, and the serialized report contains no raw text, signature, header, payload segment, canary database URL, password or secret word, stack marker, client name or support contact"
    requirement: "LIC-04"
    verification:
      - kind: integration
        ref: "tests/licence-diagnostic.test.ts (7 tests) (pass)"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 09: Write Gate, Restriction Cutoff, Evaluation and Diagnostics Summary

**The licence service now enforces and records: a per-write gate that re-verifies the stored licence from the database on every call (allowed at graceEndsAt minus 1 ms, blocked at exactly graceEndsAt, bounded to 24 hours on a read failure), a fail-open restriction cutoff, version-guarded compare-and-swap transitions with exactly one audit winner, exact clock-rollback and attention-window handling, and a field-by-field diagnostic report, all proven on a real Postgres.**

## Performance

- **Duration:** about 40 min
- **Completed:** 2026-10-01
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 3 created, 1 modified

## Accomplishments

- `checkWriteGate` reads the singleton, re-verifies the stored text with the injected trust set loader and derives the state at the injected instant on every call. It writes nothing on the allow path. When the derived state differs from the stored one it makes one swallowed `evaluateAndRecord({ source: "REQUEST" })` attempt (Pitfall 6). When blocked it writes one `licence.restriction_enforced` row (outcome DENIED, `after` holding operation, state and reasonCode), coalesced to one per actor per 60 seconds, with the system actor as its own key.
- Read failure (D-04): the first failure of a streak starts `degradedSince`; below 24 hours the last-known-good decision stands (allow when there is none); at exactly 24 hours the gate blocks with state INVALID and reasonCode VALIDATION_WINDOW_EXHAUSTED; a successful read ends the streak. The memory lives in the `createLicenceService` closure, so test instances never share it.
- `assertWriteAllowed` throws the existing neutral `LicenceWriteBlockedError`. `getRestrictionCutoff` returns `{ restricted, restrictedAt }` with `restrictedAt` equal to `graceEndsAt` exactly for time-derived restriction, the stored stamp or the current instant otherwise, and fails open on a read error.
- `evaluateAndRecord` plans the write set (state, reasonCode, restrictedAt, attentionSince, verification fields, high-water, clockAlertAt), then commits it through a version-guarded `updateMany` inside `db.$transaction`. Only the winner writes `licence.state_changed`, `licence.verified` (only when the outcome differs from the stored one) and `licence.clock_rollback` through `recordAuditInTransaction` with actorType SYSTEM, targetType LICENCE, scope GLOBAL and the correlation id. A loser re-reads and reports the winner's state with `won: false`.
- Notice keys come from `dueNoticeKeys` over the new state plus `clock-rollback-{UTC hour}` when a rollback was detected. A rollback re-baselines the high-water mark and never changes the licence state.
- `buildDiagnosticReport` builds the nineteen allow-listed members one by one and exports `DIAGNOSTIC_REPORT_KEYS` and `DiagnosticReport`.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): gate, enforcement audit, assertWriteAllowed, cutoff, read-failure window, plus the first 15 integration tests. Commit: none (owner policy)
2. Task 2: evaluateAndRecord with compare-and-swap, attention, rollback, high-water, verification audit, notice keys, plus 15 integration tests. Commit: none (owner policy)
3. Task 3: buildDiagnosticReport and DIAGNOSTIC_REPORT_KEYS, plus 7 tests. Commit: none (owner policy)

TDD gate: the service code was written before its tests (the plan's own action text lists implementation first), so no separate RED run exists and no `test(...)` or `feat(...)` git commits exist because commits are prohibited by owner policy. Task 1 and Task 3 tests passed on the first run. Three Task 2 tests failed on the first run, and all three were wrong test expectations (a throttled high-water write bumping the version at the 23-hour step, and two audit-row counts that assumed a state change which had not happened at an ACTIVE-to-ACTIVE evaluation); the service behaved correctly and the expectations were corrected. To guard against vacuous passes the tests assert concrete database state (version, state columns, audit row counts and bodies) rather than only return values, and the concurrency case is backed by a deterministic lost-write test that interleaves a competing write inside a proxied transaction.

## Verification Results (real output)

- `npx vitest run tests/licence-gate.integration.test.ts tests/licence-evaluate.integration.test.ts tests/licence-diagnostic.test.ts tests/licence-activation.integration.test.ts --project node --no-file-parallelism`: 4 files passed, 58 tests passed, 0 failed (gate 15, evaluate 15, diagnostic 7, activation 21; Testcontainers postgres:16-alpine, all 24 migrations applied). The 14-07 activation file was re-run because `createLicenceService` was changed.
- `npx vitest run tests/licence-service.test.ts tests/boundary.test.ts tests/licence-purity.test.ts tests/audit-append-only.test.ts --project node`: 4 files passed, 63 tests passed (the closure rule still holds: `licence-service.ts` reaches no `next/*`, permission layer or `getCurrentActor`; no direct audit-row creation outside the audit sink).
- `npx tsc --noEmit`: no output, 0 errors (no new error). One error appeared once in `tests/licence-evaluate.integration.test.ts` (an untyped `args` in a test proxy) and was fixed before the final run.
- `npx eslint` on `src/server/services/licence-service.ts` and the three test files: no output, 0 findings.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-09-PLAN.md LIC-04 LIC-05 LIC-06`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-04",
    "LIC-05",
    "LIC-06"
  ],
  "total": 3
}
```

  No requirement is marked complete: all three are still owned by later plans (the permission-wrapper, scheduled-task, startup, notice and restricted-state proof plans 14-11, 14-13, 14-14, 14-15, 14-16, 14-17 and 14-21). `requirements-completed` is therefore empty.

## Files Created/Modified

- `src/server/services/licence-service.ts` - gate, enforcement audit, cutoff, evaluateAndRecord, diagnostic report, new types and `DIAGNOSTIC_REPORT_KEYS`
- `tests/licence-gate.integration.test.ts` - real-Postgres boundary, coalescing, never-activated, assert, read-failure and tamper tests (15 tests)
- `tests/licence-evaluate.integration.test.ts` - transitions, concurrency, lost write, attention window, rollback, high-water, verification audit and source semantics (15 tests)
- `tests/licence-diagnostic.test.ts` - allow-list, leak, never-activated, trust-set failure and skew tests (7 tests)

## Decisions Made

See key-decisions. `LicenceServiceDeps` gained optional `auditInTransaction` (defaults to `recordAuditInTransaction`, which writes through the transaction client it is handed), `monotonicNow` (defaults to `performance.now`) and `log` (defaults to logging only the error name). The existing 14-07 call sites pass `{ db, trustSet, audit, now }` and are unaffected.

## Deviations from Plan

### Auto-fixed Issues

None of Rules 1 to 3 applied: no bug, missing critical piece or blocker was found in prior work.

### Interpretation choices (no change to the plan's listed behaviours or the interface contract)

- The loser of a lost compare-and-swap retries up to three times rather than returning immediately, and skips touch-only writes after a loss. The plan said a zero count returns the winner's snapshot with won false and no audit; this still holds, but without the retry a legitimately needed transition could be lost to a concurrent high-water or lastVerifiedAt write until the next hourly run.
- `noticeKeys` is returned on every call (including for losers and when nothing was written) instead of only for the winner. Plans 14-14 and 14-16 emit through a deterministic event id and are explicitly idempotent, and the expiring-bucket keys have no state transition to hang on.
- The never-activated deployment has no verification outcome (nothing to verify), so the plan's "SCHEDULED updates lastVerifiedAt every call" applies to deployments that hold or held a licence.
- The high-water mark is not advanced by `checkWriteGate` (the plan's "no write on the allow path" and Research Pattern 4 both ask for a write-free allow path); it advances in the three evaluation sources under the 5-minute throttle.
- Test 4 of Task 1 (never-activated deployment) asserts the OQ1 option-a outcome, `{ allowed: true }`, per 14-DECISIONS.md.

**Total deviations:** 0 rule-based, 5 interpretation choices. **Impact:** none breaks the interface contract; exports and signatures named in the plan are unchanged.

## Issues Encountered

Three first-run test failures in `tests/licence-evaluate.integration.test.ts`, all wrong expectations in the new tests (see TDD gate above); fixed with no service change. No auth gates, no checkpoints, no Rule 4 decisions.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change: the service reads and writes the three tables from plan 14-03 and the audit sink only. Register items T-14-09-01 (no allow cache, cross-instance tamper test), -03 (24-hour boundary tests), -04 (coalescing and audit-on-change), -06 (allow-list, leak and no-spread tests) and -07 (winner-only audit, lost-write test) are covered by tests. T-14-09-02 is covered by the monotonic restriction time and the exact `restrictedAt` reported to plan 14-13. T-14-09-05 is accepted as documented (offline clock tampering is detected, audited, alerted and never locks anyone out).

## Next Phase Readiness

- Plan 14-11 injects `checkWriteGate` or `assertWriteAllowed` into `withPermission`; plan 14-13 reads `getRestrictionCutoff().restrictedAt` (stable for time-derived restriction, current instant for a newly observed INVALID); plans 14-14 and 14-16 consume `evaluateAndRecord({ source })` results (`snapshot`, `transitions`, `noticeKeys`); plan 14-10 and the diagnostic route use `buildDiagnosticReport` and `DIAGNOSTIC_REPORT_KEYS`.
- Carried forward: the 14-03 Task 2 migration apply to the shared database remains an outstanding human step (WINDOWS.md entry id 20). This plan used Testcontainers only and never connected to the configured DATABASE_URL.
- Broken-windows ledger: no new stub, skipped test or unrun verify was introduced, so nothing was appended to `.planning/WINDOWS.md`.

## Self-Check: PASSED

- FOUND on disk: src/server/services/licence-service.ts; tests/licence-gate.integration.test.ts; tests/licence-evaluate.integration.test.ts; tests/licence-diagnostic.test.ts; this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
