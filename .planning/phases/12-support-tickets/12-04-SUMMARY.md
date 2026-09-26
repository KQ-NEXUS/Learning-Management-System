---
phase: 12-support-tickets
plan: 04
subsystem: support
tags: [tickets, scheduler, netlify, concurrency, compare-and-swap, postgres]
requires:
  - phase: 12-support-tickets
    plan: 02
    provides: ticket service, lifecycle deadline, TicketEvent/audit/outbox shapes
provides:
  - Bounded actorless RESOLVED-to-CLOSED sweep (closeResolvedTicketsAsSystem)
  - Hourly Netlify scheduled function close-resolved-tickets (15 * * * *)
  - Real-PostgreSQL race proof for claim/resolve/reply/reopen/close/auto-close
affects: [12-05, 12-09]
tech-stack:
  added: []
  patterns:
    - "Conditional updateMany count is the sole arbiter; events written only after count=1"
key-files:
  created:
    - src/server/services/ticket-auto-close-system-service.ts
    - src/server/scheduled/close-resolved-tickets-task.ts
    - netlify/functions/close-resolved-tickets.ts
    - tests/ticket-auto-close.test.ts
    - tests/ticket-concurrency.integration.test.ts
  modified:
    - tests/boundary.test.ts
key-decisions:
  - "Auto-close CAS predicate: id + version + status RESOLVED + resolvedAt <= now-7d; lost CAS is skipped, never retried"
  - "Audit action is ticket.auto_closed (SYSTEM actor) distinct from interactive ticket.closed; outbox type stays ticket.closed with ids only"
  - "Task file scoped to the fixed 7-day grace derived from ticketReopenDeadline (single implementation)"
metrics:
  completed: 2026-09-25
---

# Phase 12 Plan 04: Auto-close worker and race proof Summary

Actorless, bounded (50, oldest first) compare-and-swap auto-close of RESOLVED tickets after exactly seven days, wired to an hourly Netlify schedule, with real-Postgres tests proving interactive and scheduled races preserve one consistent outcome.

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1 service + unit tests | 8cd3349 (test lint fix in e83fa83) | 8 tests incl. exact-deadline, batch, CAS-skip, SYSTEM attribution, failure isolation |
| 2 task + Netlify fn + boundary | fd80bcd | boundary asserts function graph free of permissions/next/headers/current-actor and of src/app|components; non-vacuous |
| 3 real-PG concurrency | e83fa83 | 5 tests, each race repeated 4 rounds |

## Verification (actual results)

- `npx vitest run tests/ticket-auto-close.test.ts tests/boundary.test.ts`: 27/27 passed.
- `npx vitest run tests/ticket-concurrency.integration.test.ts --no-file-parallelism` with Docker (testcontainers postgres:16-alpine, real migrations): 5/5 passed, executed, not skipped.
- tsc: no errors in files touched; eslint clean on all new files.

Scenarios proven: two claims at one version (one winner, one StaleTicketVersionError, one CLAIMED event); resolve vs public reply (one winner, version 2, no cross-effects in events/messages/outbox); reopen vs auto-close at the exact deadline (one terminal result, cardinality-checked events/outbox); deterministic stale-candidate test (candidate selected, learner reopens, sweep skips, ticket stays reopened, zero AUTO_CLOSED/audit/outbox rows); learner close vs scheduler (exactly one CLOSED event, one ticket.closed outbox row, one audit row).

## Deviations from Plan

None functionally. Note: races use a start barrier plus pooled independent connections; the stale-candidate case is made deterministic by reopening between the sweep's SELECT and UPDATE.

## Deferred / Notes

- Pre-existing mismatch left untouched: ticket-service.ts UploadStatusValue (QUARANTINED/REJECTED) vs Prisma enum (ERROR).
- 12-03 skipped DB integration tests; ticket attachment intent/completion/sweep still merit a Testcontainers test (out of scope here).
- Interactive flows rely on rollback when updateVersioned CAS fails after mutate wrote events; the real-PG tests confirm the rollback leaves no duplicate rows.

## Known Stubs

None.

## Self-Check: PASSED
