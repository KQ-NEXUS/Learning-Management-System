---
phase: 14-software-licence-deployment-control
plan: 04
subsystem: licensing
tags: [licence, state-machine, clock-policy, notice-keys, pure-functions, lic-05]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-DECISIONS.md OQ1 never-activated decision (option-a) and the 14-02 licence constants (DAY_MS, SKEW_TOLERANCE_MS, UNAVAILABLE_WINDOW_MS, EXPIRY_NOTICE_DAYS, EXPIRING_SOON_DAYS, GRACE_ENDING_NOTICE_DAYS, HIGH_WATER_WRITE_THROTTLE_MS)"
provides:
  - "src/server/licence/types.ts: LICENCE_STATES, LicenceStateName, LicenceSupportContact, LicenceVerificationOutcome, LicenceStatusSnapshot"
  - "src/server/licence/state.ts: NEVER_ACTIVATED_POLICY, daysUntil, deriveState (DeriveInput, DerivedState), noticeBucket, dueNoticeKeys, isRestrictedState"
  - "src/server/licence/clock.ts: detectRollback, shouldAdvanceHighWater, createClockMonitor, utcHourBucket"
  - "Exact-boundary tests proving LIC-05 (expiry, grace end, leap day, ceiling day counts, 24 h attention window, 10 min and 5 min clock rules)"
affects: [14-06, 14-07, 14-09, 14-10, 14-13, 14-14, 14-16]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 2
  confidence: low
actuals:
  tokens: 7750
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Restriction is a pure function of signed instants plus an injected now; no scheduler, no wall-clock read inside the module (a test reads state.ts and asserts the absence of the wall-clock calls)"
    - "OQ1 policy lives in one exported constant (NEVER_ACTIVATED_POLICY) cited to the 14-DECISIONS.md section"
    - "Notice keys are produced by one pure function and report only the current bucket"

key-files:
  created:
    - src/server/licence/types.ts
    - src/server/licence/state.ts
    - src/server/licence/clock.ts
    - tests/licence-state.test.ts
    - tests/licence-clock.test.ts
  modified: []

key-decisions:
  - "OQ1 option-a implemented as NEVER_ACTIVATED_POLICY = UNRESTRICTED_UNTIL_FIRST_ACTIVATION: no record and everActivated false gives UNLICENSED, isRestricted false, restrictedAt null; once everActivated is true a missing record is INVALID/RECORD_MISSING and restricted."
  - "createClockMonitor measures each sample against the previous sample (not a fixed first baseline), so one backward step is reported once rather than on every later sample."
  - "A never-activated deployment with no record is handled before the UNAVAILABLE branch, so an unreadable licence store can never restrict a deployment that has nothing to verify (option-a: never restricted before first activation)."

patterns-established:
  - "Time-derived restrictedAt equals the signed graceEndsAt exactly, so plan 14-13's payment-initiated-before-restriction comparison uses the true instant"
  - "INVALID restrictedAt is null from deriveState; the service (14-09) stamps first observation"

requirements-completed: []

coverage:
  - id: C1
    description: "Boundary: at expiresAt the state is GRACE, 1 ms earlier EXPIRING_SOON/ACTIVE; at graceEndsAt RESTRICTED_CONTINUITY, 1 ms earlier GRACE; EXPIRING_SOON starts at exactly 60 days"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-state.test.ts Tests 1-5 (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "Precision: day counts are integer ceilings of ms over 86,400,000; underOneDay only below 24 h; leap day 2028-02-29 gives 1 day, not under one day; restrictedAt equals graceEndsAt"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-state.test.ts Tests 5-7 (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "D-04 24-hour attention window is exact (23:59:59.999 attention, 24:00:00.000 INVALID/VALIDATION_WINDOW_EXHAUSTED); deterministic rejection is INVALID immediately"
    requirement: "LIC-04"
    verification:
      - kind: unit
        ref: "tests/licence-state.test.ts D-04 attention window (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "D-12 clock rules: rollback only when high-water exceeds now by more than 10 min; high-water advances only beyond 5 min; evaluation never uses the high-water mark"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-clock.test.ts (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "D-10 notice keys: current bucket only; expired, grace-ending (<= 3 days), restricted, invalid-{code}, validation-attention-{epoch seconds}"
    requirement: "LIC-01"
    verification:
      - kind: unit
        ref: "tests/licence-state.test.ts noticeBucket and dueNoticeKeys (pass)"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 04: Licence State Machine and Clock Policy Summary

**Pure deriveState/noticeBucket/dueNoticeKeys state machine and clock policy with exact-millisecond boundary tests, carrying the OQ1 option-a decision in the single NEVER_ACTIVATED_POLICY constant.**

## Performance

- **Duration:** about 15 min
- **Completed:** 2026-10-01
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 auto; both TDD)
- **Files:** 5 created, 0 modified

## Accomplishments

- `types.ts` defines the seven-state vocabulary (mirrors the 14-03 `LicenceState_state_check`) and the `LicenceStatusSnapshot` DTO, which holds no raw licence text or signing material.
- `state.ts` derives UNLICENSED, ACTIVE, EXPIRING_SOON, GRACE, RESTRICTED_CONTINUITY, INVALID and VALIDATION_ATTENTION from the signed `expiresAt`/`graceEndsAt` and an injected `now`. Day counts are `Math.ceil(ms / 86_400_000)`; there is no timezone arithmetic. `restrictedAt` for the time-derived restriction is exactly `graceEndsAt`.
- D-04: UNAVAILABLE verification keeps `lastGoodRestricted` for exactly 24 h from `attentionSince` (null means now) and then becomes INVALID/VALIDATION_WINDOW_EXHAUSTED.
- `noticeBucket` and `dueNoticeKeys` produce all D-10 keys from one pure function and report only the current bucket.
- `clock.ts` provides `detectRollback` (strictly more than 10 min), `shouldAdvanceHighWater` (strictly more than 5 min), `createClockMonitor` and `utcHourBucket`; its header records that evaluation never uses the high-water mark (T-14-04-02).
- Tracer: a licence record flows through `deriveState` to a state, a day count and a notice key at the exact expiry boundary (`tests/licence-state.test.ts`, "tracer" test: expiring-1 at 1 ms before expiry, expired at expiry, restricted at grace end).

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): types.ts, state.ts, tests/licence-state.test.ts. Commit: none (owner policy)
2. Task 2: attention window, notice keys, clock.ts, tests/licence-clock.test.ts. Commit: none (owner policy)

TDD gate: RED was run first for Task 1 (the state test failed at import, `state.ts` absent, "no tests"); GREEN followed. No `test(...)`/`feat(...)` git commits exist because commits are prohibited by owner policy.

## Verification Results (real output)

- `npx vitest run tests/licence-state.test.ts tests/licence-clock.test.ts tests/licence-purity.test.ts --project node`: 3 files passed, 55 tests passed, 0 failed (1.84 s). The purity test enumerates the directory and covers the three new files.
- `npx tsc --noEmit`: exit 0, no output (0 errors; no new error).
- `npx eslint` on `types.ts`, `state.ts`, `clock.ts`, `tests/licence-state.test.ts`, `tests/licence-clock.test.ts`: exit 0, no output.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-04-PLAN.md LIC-01 LIC-04 LIC-05`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-01",
    "LIC-04",
    "LIC-05"
  ],
  "total": 3
}
```

  No requirement was marked complete (all three are blocked; later plans in the phase still carry them).

## Files Created/Modified

- `src/server/licence/types.ts` - state vocabulary and status snapshot DTO
- `src/server/licence/state.ts` - deriveState, daysUntil, noticeBucket, dueNoticeKeys, isRestrictedState, NEVER_ACTIVATED_POLICY
- `src/server/licence/clock.ts` - rollback detection, high-water throttle, monotonic monitor, UTC hour bucket
- `tests/licence-state.test.ts` - boundary, OQ1, attention, bucket, key and purity-of-clock tests
- `tests/licence-clock.test.ts` - clock policy tests

## Decisions Made

See key-decisions. Only the chosen OQ1 option (option-a) is implemented; the plan's option-b/c/d inputs (`pilotEndsAt`, `enforcementEnabled`) were not added because the owner chose option-a and unused inputs would be dead, untested surface.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Never-activated deployment with an unreadable licence store stays UNLICENSED**
- **Found during:** Task 2 (implementing the UNAVAILABLE branch)
- **Issue:** The plan applies the UNAVAILABLE branch to every deployment. For a deployment with no record and `everActivated` false, 24 hours of transient failure would flip it to INVALID/restricted, contradicting the owner's OQ1 option-a ("never restricted" before first activation).
- **Fix:** In `deriveState`, `record === null && !everActivated` returns the policy result (UNLICENSED, unrestricted) before the UNAVAILABLE branch; REJECTED is still evaluated first, as the plan specifies. A test covers it (`attentionSince` three days old, still UNLICENSED).
- **Files modified:** src/server/licence/state.ts, tests/licence-state.test.ts
- **Commit:** none (owner policy)

### Interpretation choices (no behaviour change to the plan's listed tests)

- `createClockMonitor` measures against the previous sample rather than the first sample, because the plan text allows either and this reports one step once. If plan 14-09 needs a fixed baseline it can call `sample()` on a fresh monitor.
- VALIDATION_ATTENTION returns null day counts and a null `reasonCode`; the service can carry the last known figures from stored state.

**Total deviations:** 1 auto-fixed (Rule 2). **Impact:** keeps the code faithful to the recorded owner decision; no other plan is affected.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None. The files are pure and add no endpoints, auth paths or file access. Register items T-14-04-02 (current clock only, header comment and test), T-14-04-03 (24 h boundary tests), T-14-04-04 (exact 1 ms boundary, leap-day and restrictedAt tests) and T-14-04-05 (snapshot DTO allow-list) are covered; T-14-04-01 remains an accepted residual risk by design.

## Next Phase Readiness

- Plans 14-06 (view model), 14-07, 14-09 (service) and 14-10 can import `deriveState`, `dueNoticeKeys`, `LicenceStatusSnapshot` and the clock helpers with the interface contract unchanged from the plan.
- Broken-windows ledger: no new stub, skipped test or unrun verify was introduced, so nothing was appended to `.planning/WINDOWS.md`.
- Carried forward: the 14-03 Task 2 database apply remains an outstanding human step (WINDOWS.md entry id 20); this plan does not depend on the live database.

## Self-Check: PASSED

- FOUND on disk: src/server/licence/types.ts; src/server/licence/state.ts; src/server/licence/clock.ts; tests/licence-state.test.ts; tests/licence-clock.test.ts.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
