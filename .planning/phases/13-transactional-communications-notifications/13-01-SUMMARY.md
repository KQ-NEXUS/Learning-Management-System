---
phase: 13-transactional-communications-notifications
plan: 01
subsystem: database
tags: [prisma, postgres, outbox, notifications, email, vitest]

requires:
  - phase: 05-12
    provides: DomainEvent outbox, EmailDispatch table, closed DomainEventType union
provides:
  - Additive migration 20260927015627_communications_notifications (retry columns, Notification, EmailPreference, three CHECK constraints)
  - DomainEventType extended with payment.failed and payment.refunded
  - src/server/communications/contracts.ts, the single shared communications vocabulary
affects: [13-02 .. 13-13 all communications plans]

actuals:
  tokens: 14500
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Persisted vocabulary lives in one pure module with Record<Union, ...> exhaustiveness"
    - "String status column guarded by a SQL CHECK constraint rather than a Prisma enum"

key-files:
  created:
    - prisma/migrations/20260927015627_communications_notifications/migration.sql
    - src/server/communications/contracts.ts
    - tests/communications-contracts.test.ts
  modified:
    - prisma/schema.prisma
    - src/server/services/domain-event-service.ts
    - tests/domain-event-service.test.ts

key-decisions:
  - "DOMAIN_EVENT_TYPE_LIST is derived from a Record<DomainEventType, true> so a missing union member is a compile error"
  - "Contracts test parses the union from source to assert list/union parity"

requirements-completed: [COM-01, COM-02, COM-03, COM-04]

coverage:
  - id: D1
    description: "Additive schema: DomainEvent attempts/lastError, EmailDispatch retry columns and index, Notification and EmailPreference models, three CHECK constraints"
    requirement: "COM-02"
    verification:
      - kind: integration
        ref: "npx prisma validate && migrate status && db push (scratch DB: already in sync)"
        status: pass
    human_judgment: false
  - id: D2
    description: "DomainEventType gains payment.failed and payment.refunded"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/domain-event-service.test.ts#type-checks and redacts the payload for the Phase 13 payment outcome event"
        status: pass
      - kind: unit
        ref: "tests/learning-phase-invariants.test.ts (union pin)"
        status: pass
    human_judgment: false
  - id: D3
    description: "contracts.ts shared vocabulary (27 templates, 27 notification types, categories, backoff, buildCorrelationId)"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/communications-contracts.test.ts"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-27
status: complete
---

# Phase 13 Plan 01: Schema and Shared Communications Vocabulary Summary

**Additive Prisma migration (retry state, Notification, EmailPreference, CHECK constraints) plus a pure, exhaustive contracts module and two new outbox event types, applied and verified on a scratch Postgres.**

## Performance

- **Duration:** about 20 min
- **Completed:** 2026-09-27
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified, plus the new migration directory)

## Accomplishments
- DomainEvent gains `attempts` and `lastError`; EmailDispatch gains `attempts`, `lastAttemptAt`, `nextAttemptAt`, `skipReason`, `templateParams`, `resentCount` and a `(status, nextAttemptAt)` index; the `(template, correlationId)` unique is untouched.
- New `Notification` (unique per recipient, type, source event; cursor and unread indexes; no delete path) and `EmailPreference` (composite id) models, with User back-relations.
- Migration appends CHECK constraints: DomainEvent attempts >= 0, EmailDispatch attempts >= 0, EmailDispatch status IN the five values. No DROP or DELETE.
- `contracts.ts` exports the full vocabulary and imports only a type.
- Live scratch DB and generated client in sync; `tsc --noEmit` clean.

## Task Commits

No commits were made (owner standing rule). Suggested messages, hash `uncommitted`:

1. **Task 1: schema columns/models and migration** - `uncommitted` - `feat(13-01): add communications schema and additive migration`
2. **Task 2: [BLOCKING] schema sync gate** - `uncommitted` - no file change of its own (verification only); folded into Task 1
3. **Task 3: DomainEventType and contracts (TDD)** - `uncommitted` - `test(13-01): add failing communications contract tests` then `feat(13-01): extend DomainEventType and add communications contracts`

**RED observed:** `tests/communications-contracts.test.ts` failed at import because `@/server/communications/contracts` did not exist. GREEN followed after implementation.

## Files Created/Modified
- `prisma/schema.prisma` - additive columns, Notification, EmailPreference
- `prisma/migrations/20260927015627_communications_notifications/migration.sql` - generated SQL plus CHECK trailer
- `src/server/communications/contracts.ts` - shared vocabulary and `buildCorrelationId`
- `src/server/services/domain-event-service.ts` - two new union members
- `tests/communications-contracts.test.ts` - vocabulary, parity and purity tests
- `tests/domain-event-service.test.ts` - payment.failed/refunded redaction cases

## Decisions Made
- Followed plan as specified. DOMAIN_EVENT_TYPE_LIST is built from a `Record<DomainEventType, true>` for compile-time exhaustiveness (38 members).

## Deviations from Plan

None - plan executed exactly as written. (Two test-authoring fixes during GREEN, both in my own new test: the header comment mentioned the banned import strings, and the union parser initially stopped at a semicolon inside a comment. Not deviations from the plan.)

## Issues Encountered
- None blocking. Note the Task 2 `db push` and `migrate dev` ran against the scratch database only, per the database override.

## Verification
- `prisma validate`, `migrate status` (19 migrations, up to date), `db push` (already in sync, no destructive prompt), `generate`, `tsc --noEmit`: pass.
- `vitest run` communications-contracts, domain-event-service, learning-phase-invariants, boundary, permissions: 5 files, 77 tests pass (permission catalogue unchanged).

## Follow-ups for the owner
- **Apply the new migration `20260927015627_communications_notifications` to the shared Neon database.** It was intentionally not applied there in this run.
- Commit the uncommitted work when ready (no commits were created).

## Known Stubs
None.

## Threat Flags
None beyond the plan's threat model.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plans 02 onward can import `@/server/communications/contracts` and use the new columns and models.

## Self-Check: PASSED
- All created files exist on disk and appear in `git status --porcelain` (migration dir, contracts.ts, communications-contracts.test.ts; modified schema, domain-event-service.ts, domain-event-service.test.ts).
- Absence of commits is expected under the owner's no-commit rule.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-27*
