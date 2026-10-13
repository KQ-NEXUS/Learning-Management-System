---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 06
subsystem: infra
tags: [health-check, uptime, observability, instrumentation, nextjs, prisma, testcontainers]

requires: []
provides:
  - "GET|HEAD /api/health: 200 {\"status\":\"ok\"} or 503 {\"status\":\"degraded\"}, Cache-Control no-store, no input, no session"
  - "src/server/services/health-service.ts: createHealthService, healthService.pingDatabase(timeoutMs) (SELECT 1 raced against a timer, never throws)"
  - "src/instrumentation.ts onRequestError: one PII-free JSON line per server error ({event:request_error, routePath, routeType, method, errorName, digest})"
affects: [15-30, 15-31, ops page, launch checklist, uptime monitor setup]

actuals:
  tokens: 5200
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Injected-client health probe: Promise.race of the query against a cleared timer, mapped to a boolean"
    - "onRequestError logs the route template and error name/digest only, typed with Instrumentation.onRequestError from next"

key-files:
  created:
    - src/server/services/health-service.ts
    - src/app/api/health/route.ts
    - tests/health-route.test.ts
    - tests/health-service.integration.test.ts
    - tests/instrumentation-request-error.test.ts
  modified:
    - src/instrumentation.ts

key-decisions:
  - "Health body is one of two fixed values; the service does not report why a ping failed, and the route logs only the error name on an unexpected exception"
  - "No route segment config on /api/health (Route Handlers are uncached by default, cacheComponents is off); Cache-Control no-store is the explicit second layer, and a test gate forbids dynamic/revalidate/fetchCache/use cache in the file"
  - "onRequestError keeps a digest from non-Error throwables (Next sometimes throws plain objects with a digest) but reads no other field of them"

patterns-established:
  - "Public probe routes: fixed body, no-store, service-only database access, error name only in logs"

requirements-completed: [NFR-01, NFR-07]

coverage:
  - id: D1
    description: "/api/health answers ok (200) or degraded (503) with a fixed body and no-store; HEAD mirrors the status with an empty body; no error text, stack, version or host leaks"
    requirement: NFR-01
    verification:
      - kind: unit
        ref: "tests/health-route.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "pingDatabase returns true against a real Postgres, false on rejection, synchronous throw, a never-resolving query, and a real pg_sleep(3) query past the 2 second bound"
    requirement: NFR-01
    verification:
      - kind: integration
        ref: "tests/health-service.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "onRequestError writes exactly one JSON line per server error with route template, route type, method, error name and digest only; never the concrete path, query string, message, headers or cookies; never throws; register unchanged"
    requirement: NFR-07
    verification:
      - kind: unit
        ref: "tests/instrumentation-request-error.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "NFR-01 availability is measured by an external uptime monitor polling /api/health every 5 minutes on staging and production (216 min/30-day month, 223.2 min/31-day month)"
    requirement: NFR-01
    verification: []
    human_judgment: true
    rationale: "Monitor account and targets are configured by the owner in plans 15-30 and 15-31; no automated test can prove a month of availability"

duration: 12min
completed: 2026-10-07
status: complete
---

# Phase 15 Plan 06: Health Endpoint and Request-Error Logging Summary

**Public uncached `/api/health` (bounded `SELECT 1`, fixed ok/degraded body) for the external uptime monitor, plus an `onRequestError` hook that writes one PII-free JSON line per server error to the host log.**

## Performance

- **Duration:** about 12 min
- **Started:** 2026-10-07T14:04:48Z
- **Completed:** 2026-10-07T14:16:00Z
- **Tasks:** 2 of 2
- **Files:** 5 created, 1 modified

## Accomplishments

- `GET /api/health` returns `200 {"status":"ok"}` when `SELECT 1` completes within 2 seconds, otherwise `503 {"status":"degraded"}`; `HEAD` returns the same status with no body. Every response carries `Cache-Control: no-store`. The route imports only the health service, never `@prisma/client` or `@/server/db`.
- `createHealthService({ client })` / `healthService.pingDatabase(timeoutMs)` races the query against a timer, clears the timer, falls back to 2000 ms for a non-positive or non-finite bound, and never throws (rejection, synchronous throw and timeout all map to `false`).
- `onRequestError` in `src/instrumentation.ts` logs `{"event":"request_error","routePath":...,"routeType":...,"method":...,"errorName":...,"digest":...}` with `console.error`. It uses `UnknownError` for values that are not `Error` instances and swallows any failure, including a throwing `console.error`. `register()` is unchanged.

## Task Commits

1. **Task 1: Tracer: /api/health pings the database through the service** (not committed; the owner commits explicitly)
2. **Task 2: onRequestError writes one PII-free JSON line per server error** (TDD: RED run showed 6 failing and 2 passing before the implementation, then GREEN; not committed, the owner commits explicitly)

## Files Created/Modified

- `src/server/services/health-service.ts`: the bounded database ping with an injected client
- `src/app/api/health/route.ts`: public `GET`/`HEAD` health endpoint
- `src/instrumentation.ts`: adds the `onRequestError` export and header documentation; `register` body untouched
- `tests/health-route.test.ts`: 10 tests (status/body/header mapping, no-leak, log shape, file gates against Prisma imports and caching config)
- `tests/health-service.integration.test.ts`: 5 tests on Testcontainers Postgres (real ok, rejecting, synchronously throwing, hanging, and a real `pg_sleep(3)` past the bound)
- `tests/instrumentation-request-error.test.ts`: 8 tests (line shape, PII exclusions, non-Error throwables, never-throws, register guard unchanged)

## Verification

- `npx vitest run tests/health-route.test.ts tests/instrumentation-request-error.test.ts`: 2 files, 18 passed
- `npx vitest run tests/health-service.integration.test.ts --no-file-parallelism`: 1 file, 5 passed (Testcontainers; `DATABASE_URL` set to the local throwaway URL, never the `.env` Neon database)
- Tracer gate (end-of-phase mode, automated verify only): re-ran Task 1 verify, which passed, then expanded to Task 2
- Whole-tree scan tests that new route and service files could affect: `boundary`, `licence-enforcement-boundary`, `licence-action-refusal`, `licence-purity`, `audit-append-only`, `communications-invariants`, `licence-ui-mirror-gate`: 7 files, 181 passed
- `npx tsc --noEmit`: exit 0. `npx eslint` on all six touched files: exit 0
- Acceptance greps: `route.ts` contains `no-store` and exports `GET` and `HEAD`; `src/instrumentation.ts` exports `register` (with its `NEXT_RUNTIME` guard) and `onRequestError`

## Decisions Made

- The health service does not log ping failures. The monitor reports the outage, and keeping the probe silent avoids a log line every 5 minutes during an incident. The route logs only the error name if the service ever throws.
- `onRequestError` is declared as `export const onRequestError: Instrumentation.onRequestError = async (...)` so its signature is checked against this Next.js version's own type (`node_modules/next/dist/server/instrumentation/types.d.ts`).

## Deviations from Plan

None. The plan was executed as written. The integration test adds two cases beyond the plan (a client that throws synchronously, and a real `pg_sleep(3)` query that outlasts the 2 second bound), and the route test adds file gates. These add coverage and change no behaviour.

**Total deviations:** 0.

## Issues Encountered

- The first `tsc` run flagged an implicit `any` in a test spy callback. Typing the spy as `MockInstance<typeof console.error>` in both unit tests fixed it.

## Notes for Later Plans

- Plans 15-30 and 15-31: point the external uptime monitor (owner's account, 5-minute interval) at `https://<host>/api/health` on staging and production. `HEAD` is supported for monitors that prefer it.
- Netlify function logs will show `request_error` lines. Counting them per route template gives the NFR-07 error-rate signal.
- No schema migration in this plan (nothing to add to the Neon go-live list).

## Tracking Notes

- `requirements.ready-ids <plan> NFR-01,NFR-07` reported both IDs as blocked, because sibling plans 15-01, 15-03, 15-04, 15-13, 15-29, 15-30 and 15-31 also declare them and have no SUMMARY yet. Neither ID was marked complete in REQUIREMENTS.md.
- `state.update-progress` skipped with "phase scope is unscoped, not complete", so the STATE.md Progress field was left unchanged. STATE.md was not hand-edited. `state.advance-plan`, `state.record-metric`, `state.add-decision`, `state.record-session` and `roadmap.update-plan-progress` (5 of 33 summaries) succeeded.

## User Setup Required

None for this plan. The monitor account is set up in 15-30/15-31.

## Self-Check: PASSED

- FOUND: src/server/services/health-service.ts
- FOUND: src/app/api/health/route.ts
- FOUND: src/instrumentation.ts (modified)
- FOUND: tests/health-route.test.ts
- FOUND: tests/health-service.integration.test.ts
- FOUND: tests/instrumentation-request-error.test.ts
- Commits: none, by owner rule (not committed; the owner commits explicitly)
