# Phase 6 — Deferred / Out-of-Scope Items

Discoveries made during plan execution that are out of scope for the plan that found them
(Scope Boundary rule — not fixed, logged for awareness only).

## From 06-01 (2026-09-10)

- **`npm test` — 12 test files fail with `Could not find a working container runtime strategy`**
  (`tests/reorder.integration.test.ts`, `tests/schema-cohort.test.ts`,
  `tests/seat-accounting.integration.test.ts`, and others that call
  `tests/support/pg.ts`'s `startTestDatabase()`). Cause: this execution environment has no Docker
  daemon available for `testcontainers`' `PostgreSqlContainer`. Pre-existing environmental gap,
  unrelated to Stripe/06-01's changes — none of the failing files touch payments code.
- **`tests/docker-email-config.test.ts` — 2 tests fail** with `docker compose --env-file
  .env.example config` erroring `AUTH_SECRET must be set`. `.env.example`'s `AUTH_SECRET=` line
  is blank by design (a real value is deployment-supplied), and this specific test's
  `docker compose config` invocation has no default for it. Pre-existing, unrelated to Stripe —
  06-01 did not touch `AUTH_SECRET`, `docker-compose.yml`, or `.env.example`.
