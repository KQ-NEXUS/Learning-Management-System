---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 25
subsystem: authorization-testing
tags: [nfr-05, authz, bypass, server-actions, route-handlers, inventory]
status: complete

provides:
  - "Registry of every server action and route handler (145 entries: 126 actions, 19 routes) classified session-own-record, permission or public-signature"
  - "Inventory test that fails on an empty registry, a zero-file scan, or any unregistered action or route"
  - "Bypass matrix: anonymous, no-permission and wrong-session cases per entry, run against a Testcontainers Postgres, plus a payments tracer for the cohort A / cohort B adjacency pair"
  - "Deterministic evidence file evidence/authz-matrix-local.json (774 cases, 774 passed)"

requirements-completed: []

actuals:
  commits: 0

key-files:
  created:
    - tests/support/authz-registry.ts
    - tests/support/authz-inputs.ts
    - tests/support/authz-matrix.ts
    - tests/authz-inventory.test.ts
    - tests/authz-bypass-payments.integration.test.ts
    - tests/authz-bypass.integration.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/authz-matrix-local.json
---

# Plan 15-25 Summary: Direct-request authorization bypass suite

## Result

NFR-05 direct-request coverage is in place. No authorization bypass was found.

## Verification (run by the orchestrator, not the executor)

- `npx vitest run tests/authz-inventory.test.ts`: 18 passed
- `npx vitest run tests/authz-bypass-payments.integration.test.ts tests/authz-bypass.integration.test.ts`: 794 passed (Testcontainers Postgres, not Neon)
- `npx eslint` on the six new files: clean
- `npx tsc --noEmit`: clean after wave 5; the six files were not changed after that other than by this plan

Evidence: 145 entries, 774 cases, 774 passed (session-own-record 138, permission 632, public-signature 4).

## Deviations

- Two earlier executor runs were killed by rate limits and a third stalled after writing the evidence file at 20:01 without writing this SUMMARY. The orchestrator re-ran every verify command and wrote this SUMMARY. Self-Check: PASSED on the commands above; a line-by-line plan review was not repeated by a fresh executor.
- Adjacent changes from earlier plans (15-22 licence continuity override, 15-24 route variants) are covered by the registry as written.

## Owner notes

- Wrong scope and wrong record state across all scoped actions are plan 15-26; private-file headers, TTLs and webhooks are plan 15-27.
- No commits were made.
