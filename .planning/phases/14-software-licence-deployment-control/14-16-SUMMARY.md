---
phase: 14-software-licence-deployment-control
plan: 16
subsystem: licensing
tags: [licence, scheduled-function, netlify, instrumentation, startup-check, boundary-tests, d-16, d-15, lic-04, lic-07, a3, a4, oq5]
status: complete

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-09 licenceService.evaluateAndRecord ({ source }) returning { snapshot, transitions, noticeKeys }; 14-14 licenceNoticeService.emitNotices; 14-13 settlement service importing licence-service; 14-DECISIONS.md adopted ledger (OQ5/A3 hosting, A4 cadence)"
provides:
  - "check-licence-task.ts: CheckLicenceTaskDeps, createCheckLicenceTask(deps), and the wired singleton runCheckLicenceTask over licenceService.evaluateAndRecord, licenceNoticeService.emitNotices and console.info"
  - "netlify/functions/check-licence.ts: createCheckLicenceHandler(run), default handler, config.schedule '0 * * * *'"
  - "licence-startup-service.ts: runLicenceStartupCheck(deps) returning { status: 'ok' | 'timeout' | 'error' } (3000 ms default bound, never throws), STARTUP_CHECK_TIMEOUT_MS, and the wired runStartupLicenceCheck()"
  - "src/instrumentation.ts: register(), Node runtime only, swallow-all"
  - "docs/deployment/netlify-scheduled-functions.md: '## Licence check' with verification steps, Hosting note and Startup check"
  - "tests/boundary.test.ts: a plan 14-16 describe block (check-licence closure, pure licence modules reject Prisma, both webhook closures reach licence-service, licence services closure request-API-free)"
affects: [14-17, 14-21]

estimate:
  tokens: 65000
  raw_tokens: 65000
  tasks: 3
  confidence: low
actuals:
  tokens: 7100
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Injected-deps task factory plus Netlify scheduled function (copy of cleanup-notifications), so the existing generic netlify/functions closure scan covers the new function automatically"
    - "Race-and-swallow startup check: a throwaway timer promise raced against the work, work.catch(() => undefined) so a late rejection after a timeout is never unhandled, timer cleared in finally, logger failures swallowed"
    - "Mock-factory counter (vi.hoisted) to prove a dynamic import did not happen: the factory only runs when the mocked specifier is imported, so the count is a real not-imported proof"

key-files:
  created:
    - src/server/scheduled/check-licence-task.ts
    - netlify/functions/check-licence.ts
    - src/server/services/licence-startup-service.ts
    - src/instrumentation.ts
    - tests/check-licence-task.test.ts
    - tests/netlify-check-licence.test.ts
    - tests/licence-startup.test.ts
  modified:
    - docs/deployment/netlify-scheduled-functions.md
    - tests/boundary.test.ts

key-decisions:
  - "The scheduled task rejects on an evaluation failure (matches the cleanup-notifications template and lets Netlify show a failed run); only the startup path swallows errors"
  - "The wired singletons wrap the service methods in arrow functions rather than passing method references, so no this-binding can be lost"
  - "Startup log carries only the status and, for an error, the error name (never the message, which can hold a connection string); a throwing logger cannot fail boot"
  - "The wired singleton is a function runStartupLicenceCheck() (no deps), matching how instrumentation.ts invokes it"
  - "Boundary tests for the pure licence modules use it.each over format, verify and state (plan behaviour 3), each with an explicit 30000 ms timeout"

patterns-established:
  - "Always-off-request entry points are proven non-vacuous by asserting the closure contains the services that make the guarantee meaningful (licence-service.ts and licence-notice-service.ts for check-licence; licence-service.ts for both webhooks)"

requirements-completed: [LIC-04, LIC-07]

coverage:
  - id: C1
    description: "LIC-04 / D-16: an hourly Netlify scheduled function (0 * * * *) runs the task once per invocation; the task calls evaluateAndRecord exactly once with { source: 'SCHEDULED' }"
    requirement: "LIC-04"
    verification:
      - kind: unit
        ref: "tests/check-licence-task.test.ts, tests/netlify-check-licence.test.ts (7 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "LIC-07 / D-15: each run emits the returned notice keys once through emitNotices (skipped when none), reports created and skipped counts separately so a repeat run shows created=0 and skipped=n, and propagates an evaluation failure without emitting"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/check-licence-task.test.ts (emit, empty keys, skipped count, rejection)"
        status: pass
    human_judgment: false
  - id: C3
    description: "T-14-16-03: the log line is '[scheduled] licence check: state=<CODE> transitions=<n> notices=<n> skipped=<n>' and contains no client name, key id, licence id, deployment id or email (asserted against a snapshot carrying such values)"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/check-licence-task.test.ts (log content test with regex and absence assertions)"
        status: pass
    human_judgment: false
  - id: C4
    description: "T-14-16-01 / LIC-04: the startup check resolves ok, error or timeout and never rejects; the timeout fires at exactly 3000 ms (fake timers: not settled at 2999, settled at 3000, no timers left); a late rejection after a timeout is swallowed; only the error name is logged; a throwing logger cannot fail it"
    requirement: "LIC-04"
    verification:
      - kind: unit
        ref: "tests/licence-startup.test.ts runLicenceStartupCheck block (7 tests)"
        status: pass
    human_judgment: false
  - id: C5
    description: "T-14-16-01: register() is a no-op without importing the startup service unless NEXT_RUNTIME is 'nodejs', calls the startup check once under nodejs, and resolves even when the startup function rejects"
    requirement: "LIC-04"
    verification:
      - kind: unit
        ref: "tests/licence-startup.test.ts register() block (4 tests; mock-factory counter proves no import for edge and unset)"
        status: pass
    human_judgment: false
  - id: C6
    description: "T-14-16-02 / D-16 closure rule: the check-licence function rejects a Prisma import; its transitive closure has no next/headers, @/server/permissions or getCurrentActor and reaches licence-service.ts and licence-notice-service.ts; pure licence modules format, verify and state reject Prisma; both webhook closures stay request-API-free and now reach licence-service.ts; licence-service and licence-activation-service closures are request-API-free"
    requirement: "LIC-04"
    verification:
      - kind: unit
        ref: "tests/boundary.test.ts plan 14-16 block (7 new tests; file total 31 passed)"
        status: pass
    human_judgment: false
  - id: C7
    description: "T-14-16-05 / OQ5 and A3 accepted risk and A4 cadence: the deployment doc has a Licence check section with the hourly UTC schedule, five numbered verification steps, a Hosting note (Docker Compose ships no scheduler, restriction still applies on every guarded write, alerts and transition audit rows need this function or an external cron) and a Startup check paragraph"
    requirement: "LIC-04"
    verification:
      - kind: other
        ref: "docs/deployment/netlify-scheduled-functions.md (grep: '## Licence check', 'Docker Compose'); content review"
        status: pass
    human_judgment: true

duration: ~25min
completed: 2026-10-02
---

# Phase 14 Plan 16: Scheduled and Startup Licence Check Summary

**An hourly Netlify scheduled function (`0 * * * *`) evaluates the stored licence with `evaluateAndRecord({ source: "SCHEDULED" })` and emits the due, deduplicated notice keys while logging only a state code and counts, a best-effort `instrumentation.ts` startup check is bounded to 3 seconds and can never throw, and the boundary tests now permanently cover the new always-off-request entry points.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 7 created, 2 modified

## Accomplishments

- `check-licence-task.ts` follows the `cleanup-notifications-task.ts` template: `createCheckLicenceTask(deps)` evaluates, calls `emitNotices` only when `noticeKeys` is non-empty, and logs one line (`state`, `transitions`, `notices` = created count, `skipped`). `runCheckLicenceTask` wires `licenceService.evaluateAndRecord`, `licenceNoticeService.emitNotices` and `console.info`. The header records the closure rule and the log rule.
- `netlify/functions/check-licence.ts` is the cleanup-notifications function with a relative import of the task, `createCheckLicenceHandler(run)`, a default export and `config.schedule = "0 * * * *"`. The existing generic `workerRuntimeClosure()` scan in `tests/boundary.test.ts` picks it up automatically.
- `licence-startup-service.ts`: `runLicenceStartupCheck` races evaluation (source `STARTUP`) plus notice emission against a timer (3000 ms default), always resolves a status object, clears the timer, logs `status` and, for an error, only the error name, and writes no audit row. `runStartupLicenceCheck()` wires it to the real services.
- `src/instrumentation.ts`: `register()` returns immediately unless `process.env.NEXT_RUNTIME === "nodejs"`, then dynamically imports the startup service inside a try and catch that swallows everything. The header cites the Next.js instrumentation guide and records assumption A3 (the guarded-write check does not depend on this hook).
- `docs/deployment/netlify-scheduled-functions.md`: new `## Licence check` section with five verification steps (including checking **Last verification** on **Licence & System Status**, a label confirmed in `src/server/licence/view-model.ts`), a Hosting note and a Startup check paragraph; uses the term restricted continuity mode.
- `tests/boundary.test.ts`: a new describe block (plan 14-16), no existing test edited, each new test with a 30000 ms timeout.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): task, function, two test files. Commit: none (owner policy)
2. Task 2: startup service, `instrumentation.ts`, test file. Commit: none (owner policy)
3. Task 3: boundary additions and deployment doc. Commit: none (owner policy)

TDD gate: tests were written first for Tasks 1 and 2 and run RED before any implementation (Task 1: both files failed to resolve their imports, "Tests no tests"; Task 2: 4 failed, 7 skipped because `@/instrumentation` and the startup module did not exist), then GREEN. No `test(...)` or `feat(...)` git commits exist because commits are prohibited by owner policy. Task 3's boundary tests assert properties that already held after plans 14-09 and 14-13, so they passed on first run (they are guards, not new behaviour); non-vacuity is asserted inside the tests (the closures must contain licence-service.ts and licence-notice-service.ts).

## Tracer gate

Task 1 is `type="tracer"` without a `gate` attribute. Workflow flags: `workflow._auto_chain_active` false; `workflow.auto_advance` and `workflow.human_verify_mode` keys not present (defaults apply: interactive, end-of-phase). The `<verify>` is automated-only, so it was re-run end to end after implementation: 2 files, 7 tests passed. Tracer verified, expansion proceeded to Tasks 2 and 3.

## Next.js documentation read before writing instrumentation

Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md` and `01-app/02-guides/instrumentation.md`. Applied: file at `src/instrumentation.ts` (project uses `src/`), `register` is called once per new server instance and must complete before the server is ready (hence the 3 s bound and swallow-all), Node-only code is imported dynamically inside a `NEXT_RUNTIME === "nodejs"` guard. No route handler was added in this plan (the scheduled function is a Netlify function, not a Next route).

## Verification Results (real output)

- `npx vitest run tests/check-licence-task.test.ts tests/netlify-check-licence.test.ts --project node`: 2 files, 7 passed.
- `npx vitest run tests/licence-startup.test.ts --project node`: 1 file, 11 passed.
- `npx vitest run tests/boundary.test.ts --project node` (run alone): 1 file, 31 passed (24 pre-existing plus 7 new), 16.04 s, no timeout.
- `npx vitest run tests/licence-purity.test.ts --project node`: 1 file, 26 passed.
- Final combined re-run of the three new unit files: 3 files, 18 passed.
- `npx tsc --noEmit`: no output, exit 0, 0 errors (no new error).
- `npx eslint` over `check-licence-task.ts`, `check-licence.ts`, `licence-startup-service.ts`, `instrumentation.ts`, the three new test files and `tests/boundary.test.ts`: no output, 0 findings.
- Acceptance greps: `schedule: "0 * * * *"` present at `netlify/functions/check-licence.ts:13`; `check-licence-task.ts` imports `licenceNoticeService` and `licenceService` from `@/server/services/`; `src/instrumentation.ts` contains `NEXT_RUNTIME` and `"nodejs"`; the doc contains `## Licence check` (line 26) and `Docker Compose` (line 40); `tests/boundary.test.ts` contains `netlify/functions/check-licence.ts` and `src/server/services/licence-notice-service.ts`.
- No integration (Testcontainers) test was part of this plan and none was run; no database command was issued, and the shared DATABASE_URL was never read or used.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-16-PLAN.md LIC-04 LIC-07`, output verbatim:

```
{
  "ready": [
    "LIC-04",
    "LIC-07"
  ],
  "blocked": [],
  "total": 2
}
```

  Cross-check: no later plan (14-17 to 14-21) lists LIC-04 or LIC-07 in its `requirements` frontmatter; 14-16 is the last plan for both.

## Files Created/Modified

- `src/server/scheduled/check-licence-task.ts` - task factory and wired singleton
- `netlify/functions/check-licence.ts` - hourly scheduled function
- `src/server/services/licence-startup-service.ts` - bounded best-effort startup check
- `src/instrumentation.ts` - Next.js `register()` hook
- `tests/check-licence-task.test.ts` - 5 tests (emit, empty keys, skipped count, rejection, log content)
- `tests/netlify-check-licence.test.ts` - 2 tests
- `tests/licence-startup.test.ts` - 11 tests (7 startup, 4 register)
- `tests/boundary.test.ts` - 7 added tests
- `docs/deployment/netlify-scheduled-functions.md` - Licence check section

## Decisions Made

See key-decisions. Adopted-ledger items OQ5/A3 and A4 are implemented as written and stay visible: hourly UTC cadence, 60-day expiring-soon and 3-day grace-ending are code defaults (owned by plans 14-04 and 14-09); the design never relies on `register()` running on a cold start.

## Deviations from Plan

None - plan executed as written, with these small, non-behavioural choices recorded for transparency: the plan's `now?` dependency is declared on `CheckLicenceTaskDeps` per the interface contract but is unused by the task (the notice service and evaluation own their own clocks); boundary Test 3 is expressed as `it.each` over the three module names; extra tests beyond the plan's list were added (skipped-count reporting, late rejection after a timeout, throwing logger, emission failure at startup, `NEXT_RUNTIME` unset).

## Issues Encountered

None blocking. The first draft of the register() tests used a mock factory that also ran when the file statically imported the startup module, which would have made the "not imported" assertion vacuous; it was corrected before the first GREEN run by loading the real module with `vi.importActual` so the factory counter is a genuine proof.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-14-16-01 to T-14-16-05 are all covered above; T-14-16-05 is the documented accepted risk).

## Human steps outstanding (carried, not created here)

- The 14-03 migration is still proven on Testcontainers only and not applied to the shared database; the first scheduled run against a database without it would fail at the read (the task rejects, startup reports status error).
- Netlify behaviour (Scheduled badge, hourly next-run, Run now, log prefix) is documented but not verified remotely, per the owner's rule against invoking Netlify functions.

## Next Phase Readiness

Plan 14-17 (continuity classification) and 14-21 (acceptance) can rely on: the scheduled path (`runCheckLicenceTask`), the startup path (`runStartupLicenceCheck`), the permanent closure guards for both webhooks and the licence services, and the hosting note in the deployment doc.

## Self-Check: PASSED

Files verified on disk (see the self-check command output recorded below the handlers). Commits: none by owner policy.
