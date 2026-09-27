---
phase: 12-support-tickets
plan: 01
subsystem: support
tags: [prisma, postgres, tickets, lifecycle, uploads, tdd]
requires:
  - phase: foundation
    provides: authenticated users, audit actors, private storage, and existing ticket persistence
provides:
  - Complete support-ticket aggregate with queues, contexts, append-only events, and optimistic versioning
  - Pure lifecycle rules for resolution, learner close/reopen, assignment, escalation, and priority reasons
  - Non-sequential KQT ticket references and a closed four-MIME ticket upload contract
affects: [12-02, 12-03, 12-04, 12-05, 12-06, 12-07, 12-08, 12-09]
tech-stack:
  added: []
  patterns:
    - "Ticket state rules live in a framework-free module with a closed transition table"
    - "Ticket references use an injected clock and UUID source for deterministic tests"
    - "Attachment visibility is inherited only through a required TicketMessage parent"
key-files:
  created:
    - prisma/migrations/20260921163500_support_ticket_lifecycle/migration.sql
    - src/server/services/ticket-lifecycle.ts
    - src/server/services/ticket-reference.ts
    - tests/ticket-lifecycle.test.ts
    - tests/ticket-reference.test.ts
  modified:
    - prisma/schema.prisma
    - src/lib/upload-limits.ts
key-decisions:
  - "CLOSED is terminal; RESOLVED may reopen only through the inclusive seven-day learner window and with a non-empty reason"
  - "Ticket attachments accept only PNG, JPEG, WebP, and PDF, with three files per message and ten MiB per file"
patterns-established:
  - "Future ticket commands consume an expected version and record attributed TicketEvent rows"
  - "Public replies change NEW to OPEN but preserve ASSIGNED and ESCALATED states"
requirements-completed: [SUP-01, SUP-02, SUP-04, SUP-05]
duration: 27min
completed: 2026-09-21
---

# Phase 12 Plan 01: Support Ticket Domain Foundation Summary

**An additive Prisma ticket aggregate, synchronized live schema, and tested framework-free lifecycle/reference/upload contracts now underpin every later support workflow.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-09-21T16:45:31Z
- **Completed:** 2026-09-21T17:11:50Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Extended tickets with controlled categories and queues, five optional context types guarded by an at-most-one check, optimistic versioning, required message-owned attachments, and an append-only attributed event ledger.
- Proved the deployed database and generated client match the committed migration without accepting data loss: the approved `npx prisma db push` reported the schema already in sync, migration status reported all 17 migrations applied, and a read-only metadata query found `TicketEvent` plus all four required Ticket columns.
- Added deterministic lifecycle, reference, and ticket-file rules with 26 focused tests plus the 17-test repository boundary suite.

## Task Commits

Each implementation unit was committed atomically:

1. **Task 1: Extend the ticket aggregate schema and generate an additive migration** - `8f45a10` (feat)
2. **Task 2: Prove the live schema is synchronized** - verification-only gate; no source change
3. **Task 3 RED: Add failing ticket contract tests** - `0d7c77c` (test)
4. **Task 3 GREEN: Implement lifecycle, reference, and upload contracts** - `263aeb4` (feat)

## Files Created/Modified

- `prisma/schema.prisma` - Closed support enums and complete ticket aggregate relations, versioning, contexts, messages, attachments, and events.
- `prisma/migrations/20260921163500_support_ticket_lifecycle/migration.sql` - Additive migration with legacy-attachment preservation and raw context-cardinality/positive-size checks.
- `src/server/services/ticket-lifecycle.ts` - Pure transition table, seven-day learner boundary, reply status behavior, and mandatory-reason guards.
- `src/server/services/ticket-reference.ts` - `KQT-YYYYMMDD-XXXXXXXX` generation and calendar-aware validation.
- `src/lib/upload-limits.ts` - Ticket-specific count, size, MIME allow-list, and validator without widening existing lesson or certificate rules.
- `tests/ticket-lifecycle.test.ts` - Lifecycle, reason, reply-state, and upload-contract coverage.
- `tests/ticket-reference.test.ts` - Format, uniqueness, deterministic dependency injection, and malformed-reference coverage.

## Decisions Made

- The reopen window is inclusive at exactly `resolvedAt + 7 days`; one millisecond later is rejected.
- Assignment reasons are mandatory only when replacing an existing owner; a first claim/assignment needs no replacement reason.
- Ticket MIME validation is a separate narrow contract rather than reusing the broader lesson `FILE` or `IMAGE` allow-lists.

## Verification

- `npx prisma validate` - passed.
- Approved external `npx prisma db push` without `--accept-data-loss` - exited 0 and reported the database already in sync.
- External `npx prisma migrate status` - exited 0, found 17 migrations, and reported the schema up to date.
- Prisma Client generation - completed successfully after synchronization.
- Read-only live database inspection - `TicketEvent` count 1 and required `Ticket` column count 4.
- `npx tsc --noEmit` - passed.
- `npx vitest run tests/ticket-lifecycle.test.ts tests/ticket-reference.test.ts tests/boundary.test.ts` - 43/43 passed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Prisma database access inside the restricted Windows sandbox failed with TLS P1011 / `No credentials are available in the security package`. The orchestrator ran the exact approved non-destructive synchronization and status commands outside that sandbox. The final direct metadata query was also read-only and passed outside the sandbox. No database mutation was repeated during continuation.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

- The schema, generated client, transition rules, reference format, and upload constants are ready for ticket services and learner/staff projections in later Phase 12 plans.
- No blockers remain.

## Self-Check: PASSED

- FOUND: all seven planned created/modified files.
- FOUND commits: `8f45a10`, `0d7c77c`, `263aeb4`.
- No tracked file deletions occurred in plan commits.

---
*Phase: 12-support-tickets*
*Completed: 2026-09-21*
