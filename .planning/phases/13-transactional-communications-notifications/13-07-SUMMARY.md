---
phase: 13-transactional-communications-notifications
plan: 07
subsystem: communications
tags: [outbox, drain, prisma, postgres, skip-locked, netlify-scheduled-functions, vitest, tdd]

# Dependency graph
requires:
  - phase: 13-transactional-communications-notifications (Plan 01)
    provides: DomainEvent.attempts/lastError, EmailDispatch retry columns, Notification/EmailPreference models, communications/contracts.ts vocabulary (EMAIL_STATUS, EMAIL_CATEGORY, MUTABLE_EMAIL_CATEGORIES, TEMPLATE_CATEGORY, SKIP_REASONS, MAX_EVENT_ATTEMPTS, DOMAIN_EVENT_TYPE_LIST, buildCorrelationId)
  - phase: 13-transactional-communications-notifications (Plan 02)
    provides: TEMPLATE_REGISTRY/renderEmail, ticket-reply template params shape
  - phase: 13-transactional-communications-notifications (Plan 04)
    provides: emailDispatchService.sendQueued (Pass 2 send/retry/backoff), createPrismaEmailDispatchStore
  - phase: 13-transactional-communications-notifications (Plan 05)
    provides: learnerTicketPath, notification target-type vocabulary
provides:
  - "event-intent-mappers.ts — DrainEvent/MapperContext/EventIntent/EventMapper/MapperGroup types, MalformedEventError, requireString, buildMapperTable (exhaustive over DOMAIN_EVENT_TYPE_LIST), EVENT_MAPPER_GROUPS"
  - "event-mappers/support.ts — createSupportMappers with the ticket.public_reply_added mapper (D-07 tracer slice)"
  - "domain-event-drain-service.ts — createDomainEventDrainService/domainEventDrainService (processEvents Pass 1, drain = Pass 1 + Pass 2), decideEmailDisposition, safeErrorSummary"
  - "drain-domain-events-task.ts / netlify/functions/drain-domain-events.ts — the every-minute scheduled drain, on-demand invocable via runDrainDomainEventsTask"
  - "tests/support/drain-harness.ts — startDrainHarness/seedVerifiedLearner/seedStaffUser/writeEvent, the shared fixture later Phase 13 drain plans reuse"
affects: [13-08, 13-09, 13-10, 13-11 — each appends a MapperGroup to EVENT_MAPPER_GROUPS and reuses drain-harness.ts; 13-12 delivery log reads EmailDispatch rows this drain writes]

actuals:
  tokens: 14900
  tasks: 3
  commits: 0   # commit_policy_override: no commits made this run — see Task Commits below

tech-stack:
  added: []
  patterns:
    - "One event per own transaction with FOR UPDATE SKIP LOCKED LIMIT 1 (never a batch claim in one long transaction) so a poison event only ever rolls back itself"
    - "createMany({ skipDuplicates: true }) for both EmailDispatch and Notification fan-out rows — a duplicate under either unique constraint is dropped, never aborts the transaction"
    - "Poison-event bookkeeping (attempts++, lastError, processed-with-error at MAX_EVENT_ATTEMPTS) runs in a SEPARATE small transaction after the event's own transaction has already rolled back, never nested inside it"
    - "decideEmailDisposition and safeErrorSummary are pure, exported, directly unit-testable functions — the only place recipient-state/mute gating and error-summary redaction are decided"

key-files:
  created:
    - src/server/services/event-intent-mappers.ts
    - src/server/services/event-mappers/support.ts
    - src/server/services/domain-event-drain-service.ts
    - src/server/scheduled/drain-domain-events-task.ts
    - netlify/functions/drain-domain-events.ts
    - tests/support/drain-harness.ts
    - tests/domain-event-drain.integration.test.ts
    - tests/domain-event-drain-service.test.ts
    - tests/event-intent-mappers.test.ts
    - tests/drain-domain-events-task.test.ts
    - tests/netlify-drain-domain-events.test.ts
  modified:
    - tests/boundary.test.ts

key-decisions:
  - "Poison bookkeeping and its audit write happen OUTSIDE the failed event's own transaction (a closure-captured event id plus a second small $transaction), since the original transaction has already rolled back by the time the failure is caught — there is no live transaction left to write into"
  - "The Task 2 acceptance criterion naming ENROLMENT_STATUS/enrolment-withdrawn and payment-failed specifically is proven at the decideEmailDisposition unit level (which takes a category, not a template id) rather than through a full mapper-driven integration flow, because no mapper for enrolment.withdrawn or payment.failed exists yet in this plan's scope (later plans add them) — the integration-level muted-recipient proof instead uses the one live mapper (ticket.public_reply_added, category TICKET_UPDATES), which exercises the identical disposition logic end to end against real Postgres"
  - "The poison-mapper and unknown-type integration tests override the 'order.created' entry of a freshly built mapper table (a real DomainEventType that maps to zero intents in production) rather than inventing a new event type, since DomainEventType is a closed union — this keeps the test's poison trigger inside the real type system with zero production-code changes"
  - "writeEvent's read-back queries by exact (type, occurredAt) match inside the same transaction that wrote the row, rather than 'most recent by id' — deterministic even when a test seeds many same-type events in a tight loop, as long as each call passes a distinct occurredAt"

requirements-completed: [COM-01, COM-02]

coverage:
  - id: D1
    description: "A ticket.public_reply_added event drains into exactly one QUEUED-then-SENT EmailDispatch (correlationId = event id, allow-listed templateParams) and one ticket.reply Notification, exactly once across replay and reset-and-redrain, and exactly once per event across two concurrent drain runs on 10 events"
    requirement: "COM-02"
    verification:
      - kind: integration
        ref: "tests/domain-event-drain.integration.test.ts (tracer describe block, 4 tests, real Testcontainers Postgres)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A mapper failure rolls back only that event; attempts increment across separate drain runs; the third failure marks processed-with-error with a safe (name/code only) lastError and exactly one SYSTEM domain_event.poisoned audit entry carrying only type+attempts; a 4th run leaves it untouched; a good event in the same run as a poison event still commits; an event whose type is outside DOMAIN_EVENT_TYPE_LIST follows the identical path"
    requirement: "COM-02"
    verification:
      - kind: integration
        ref: "tests/domain-event-drain.integration.test.ts (poison events describe block, 2 tests, real Postgres)"
        status: pass
      - kind: unit
        ref: "tests/domain-event-drain-service.test.ts#safeErrorSummary"
        status: pass
    human_judgment: false
  - id: D3
    description: "Recipient-state and mute gating: a DEACTIVATED recipient gets a SKIPPED recipient_deactivated dispatch and no notification; a PENDING_VERIFICATION/unverified recipient gets SKIPPED email_unverified and no notification; a missing user yields no rows and the event still processes; a recipient muted for the intent's mutable category gets a SKIPPED muted_by_recipient dispatch but the notification is still created; decideEmailDisposition is table-tested across all 7 EMAIL_CATEGORY values x DEACTIVATED/unverified/muted/unmuted states"
    requirement: "COM-02"
    verification:
      - kind: integration
        ref: "tests/domain-event-drain.integration.test.ts (recipient state and mute gating describe block, 4 tests, real Postgres)"
        status: pass
      - kind: unit
        ref: "tests/domain-event-drain-service.test.ts#decideEmailDisposition (24 table-driven cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "buildMapperTable is exhaustive over every DOMAIN_EVENT_TYPE_LIST member (empty array for an unregistered type, exactly one mapper for ticket.public_reply_added); requireString throws MalformedEventError for a missing/non-string/empty field"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-intent-mappers.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The drain is a scheduled task wrapped by an every-minute Netlify function, invocable on demand, following the release-expired-holds pattern; its runtime import closure has no request-only API and non-vacuously reaches the drain and dispatch services; the file is rejected for a Prisma import like the other scheduled functions"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/drain-domain-events-task.test.ts"
        status: pass
      - kind: unit
        ref: "tests/netlify-drain-domain-events.test.ts"
        status: pass
      - kind: unit
        ref: "tests/boundary.test.ts (2 new drain-specific assertions plus the pre-existing generic worker-closure scan)"
        status: pass
    human_judgment: false

duration: 95min
completed: 2026-09-27
status: complete
---

# Phase 13 Plan 07: Outbox Drain — Two-Pass Engine, Poison Handling, Recipient Gating Summary

**A per-event-transaction `FOR UPDATE SKIP LOCKED` drain that turns unprocessed `DomainEvent` rows into deduplicated `EmailDispatch`/`Notification` rows exactly once via `createMany({ skipDuplicates: true })`, gates every intent through `decideEmailDisposition` (deactivated/unverified/muted), isolates and audits poison events after 3 attempts, sends strictly after commit through the existing `sendQueued`, and proves the whole spine end to end on `ticket.public_reply_added` against real Postgres.**

## Performance

- **Duration:** ~95 min
- **Started:** 2026-09-27 (session start)
- **Completed:** 2026-09-27
- **Tasks:** 3 (all complete)
- **Files:** 11 created, 1 modified

## Accomplishments

- **Task 1 (tracer):** `event-intent-mappers.ts` defines the mapper contract (`DrainEvent`, `MapperContext` typed with `Prisma.TransactionClient`, `EventIntent`, `EventMapper`, `MapperGroup`, `MalformedEventError`, `requireString`) and `buildMapperTable`, exhaustive over every `DOMAIN_EVENT_TYPE_LIST` member. `event-mappers/support.ts` registers the one live mapper this plan proves end to end: `ticket.public_reply_added` -> one `ticket-reply` email (allow-listed to `reference`/`ticketPath`) and one `ticket.reply` notification, never copying `ticketId` into any persisted row. `domain-event-drain-service.ts`'s `processEvents` claims one unprocessed event at a time inside its own transaction (`FOR UPDATE SKIP LOCKED LIMIT 1`), runs every registered mapper, writes fan-out rows with `createMany({ skipDuplicates: true })`, and sets `processedAt` — all before that transaction commits; `drain` runs `processEvents` then delegates to the injected `sendQueued` (Plan 04's Pass 2), so sending only ever starts after every Pass 1 transaction for the call has already committed. `tests/support/drain-harness.ts` is the shared fixture (`startDrainHarness`, `seedVerifiedLearner`, `seedStaffUser`, `writeEvent`) every later Phase 13 drain test will reuse. The tracer integration test proves: one drain -> one SENT dispatch + one notification; replay and reset-then-redrain -> still exactly one of each, no second send; two concurrent `drain()` calls over 10 events -> exactly one dispatch and one notification per event — all against a real Testcontainers Postgres.
- **Task 2 (TDD):** Extended `domain-event-drain-service.ts` with the exported pure helpers `decideEmailDisposition` (mapper-skip > DEACTIVATED > unverified-non-AUTH > muted-mutable-category > QUEUED) and `safeErrorSummary` (error name plus an optional code, never the message), and wired both into the Pass 1 transaction: muted categories are loaded once per event with a single `emailPreference` query; QUEUED rows carry `templateParams`, SKIPPED rows carry `skipReason` and null `templateParams`; a `Notification` is written only for an ACTIVE recipient with no mapper skip reason. Poison handling captures the claimed event id via a closure variable, and on any transaction failure records the attempt (increment, `safeErrorSummary`) in a SEPARATE small transaction — the original transaction has already rolled back — marking `processedAt` and firing exactly one `domain_event.poisoned` SYSTEM audit entry (type + attempts only, no payload) once `attempts` reaches `MAX_EVENT_ATTEMPTS`; a failure while recording the failure is caught and logged without touching the run. An unknown event type (not in `mapperTable`) throws `MalformedEventError` and takes the identical path. `domain-event-drain-service.test.ts` table-tests `decideEmailDisposition` across all 7 `EMAIL_CATEGORY` values (DEACTIVATED-always-skipped, AUTH-reaches-unverified, non-AUTH-skips-unverified, mutable-categories-muted/unmuted, ALWAYS/AUTH/STAFF-ignore-mute) plus `safeErrorSummary`'s error-name/code/no-message/non-Error-fallback behavior (24 + 5 cases). The integration test's poison describe block runs a throwing mapper (overriding the real, always-empty `order.created` slot of a fresh mapper table) across 4 sequential drain calls, asserting attempts 1/2/3-then-processed-with-one-audit-call/4th-untouched, a good event alongside it still committing, and a bogus (out-of-union) event type following the same path; its recipient-gating block proves DEACTIVATED, PENDING_VERIFICATION-unverified, missing-user, and TICKET_UPDATES-muted (SKIPPED dispatch, notification still created) directly against real Postgres rows.
- **Task 3 (TDD):** `drain-domain-events-task.ts` mirrors `release-expired-holds-task.ts` exactly (`DRAIN_EVENT_BATCH_SIZE`/`DRAIN_SEND_BATCH_SIZE = 25`, `createDrainDomainEventsTask`, `runDrainDomainEventsTask` wired to `domainEventDrainService.drain` and `console.info`). `netlify/functions/drain-domain-events.ts` mirrors `release-expired-holds.ts` (`createDrainDomainEventsHandler`, default export, `config.schedule = "* * * * *"`). `event-intent-mappers.test.ts` asserts the exhaustive table and `requireString`'s `MalformedEventError` behavior; `drain-domain-events-task.test.ts`/`netlify-drain-domain-events.test.ts` mirror the hold-release test analogs. `tests/boundary.test.ts` gained a named `drainDomainEventsRuntimeClosure()` plus three assertions: rejects a Prisma import from the new Netlify function (matching the existing convention for the other three scheduled functions), the closure carries no request-only offenders, and — non-vacuously — reaches both `domain-event-drain-service.ts` and `email-dispatch-service.ts`. The pre-existing generic `workerRuntimeClosure()` scan (which auto-discovers every file under `netlify/functions/`) also now covers the new function with zero code change of its own.

## Task Commits

No commits were made in this run — the project owner's standing rule requires an explicit ask for each commit, reiterated for this run (`commit_policy_override`). All three tasks are complete and verified in the working tree; hashes are `uncommitted`.

1. **Task 1: Tracer — event-intent-mappers, support mapper group, domain-event-drain-service, drain-harness, integration test** - `uncommitted` (`feat(13-07): add the outbox drain, the mapper composition seam, and the ticket-reply tracer`)
2. **Task 2: Poison events, recipient state and mute preferences at drain time** - `uncommitted` (`test(13-07): add failing tests for decideEmailDisposition/safeErrorSummary and poison/recipient-gating scenarios` then `feat(13-07): add decideEmailDisposition, safeErrorSummary and poison-event bookkeeping`)
3. **Task 3: Scheduled task, Netlify wrapper, exhaustive mapper table and import-closure guard** - `uncommitted` (`test(13-07): add failing tests for the drain scheduled task, its Netlify wrapper, and the mapper-table exhaustiveness` then `feat(13-07): add drain-domain-events-task, its Netlify wrapper, and the two closure guards`)

**RED observed, Task 2:** Before `decideEmailDisposition`/`safeErrorSummary` existed on `domain-event-drain-service.ts`, `tests/domain-event-drain-service.test.ts` failed at import (`Module has no exported member`). Before poison bookkeeping existed, the poison-events integration cases failed with the throwing mapper's error propagating uncaught out of `processEvents` (transaction rejection, not an assertion) and with `auditSpy` never called. GREEN followed once both were implemented.

**RED observed, Task 3:** Before `drain-domain-events-task.ts`/`netlify/functions/drain-domain-events.ts` existed, `tests/drain-domain-events-task.test.ts` and `tests/netlify-drain-domain-events.test.ts` failed at module-not-found import; the two new `tests/boundary.test.ts` cases failed because `netlify/functions/drain-domain-events.ts` did not exist yet (`lintAs` threw on a missing file / `drainDomainEventsRuntimeClosure()` had no entrypoint to walk). GREEN followed once both files were implemented.

Per `commit_policy_override`, no intermediate `test(...)`/`feat(...)` commits were created for either TDD task despite both being `tdd="true"` — the RED-then-GREEN sequence was followed in the working tree (failing state observed and reported above, then the implementation change made) without the usual commit boundary between the two.

## TDD Gate Compliance

No `test(...)`/`feat(...)`/`refactor(...)` commits exist for Task 2 or Task 3, per the owner's standing no-commit rule (`commit_policy_override`) — this is a deliberate, instructed deviation from the gate-commit protocol, not an oversight. The RED-then-GREEN observation for each is documented above in lieu of separate commits.

## Files Created/Modified

- `src/server/services/event-intent-mappers.ts` — mapper contract types, `MalformedEventError`, `requireString`, `buildMapperTable`, `EVENT_MAPPER_GROUPS`
- `src/server/services/event-mappers/support.ts` — `createSupportMappers` (ticket.public_reply_added)
- `src/server/services/domain-event-drain-service.ts` — `createDomainEventDrainService`/`domainEventDrainService` (`processEvents`, `drain`), `decideEmailDisposition`, `safeErrorSummary`
- `src/server/scheduled/drain-domain-events-task.ts` — `createDrainDomainEventsTask`, `runDrainDomainEventsTask`, `DRAIN_EVENT_BATCH_SIZE`, `DRAIN_SEND_BATCH_SIZE`
- `netlify/functions/drain-domain-events.ts` — every-minute scheduled wrapper, `createDrainDomainEventsHandler`
- `tests/support/drain-harness.ts` — `startDrainHarness`, `seedVerifiedLearner`, `seedStaffUser`, `writeEvent`
- `tests/domain-event-drain.integration.test.ts`, `tests/domain-event-drain-service.test.ts`, `tests/event-intent-mappers.test.ts`, `tests/drain-domain-events-task.test.ts`, `tests/netlify-drain-domain-events.test.ts` — new test files
- `tests/boundary.test.ts` — added `drainDomainEventsRuntimeClosure()` and 2 new assertions (lint rejection + closure worker-safety/non-vacuousness)

## Decisions Made

See `key-decisions` above. Most consequential: poison bookkeeping runs in a deliberately SEPARATE transaction from the event's own (which has already rolled back by the time the failure is caught), and the plan's ENROLMENT_STATUS/payment-failed acceptance wording is proven at the `decideEmailDisposition` unit level (category-driven, template-agnostic) rather than forcing a fabricated integration-level mapper for templates that have no real mapper until later plans.

## Deviations from Plan

None — plan executed as written. The three items in `key-decisions` above are engineering choices the plan left to discretion (transaction boundary for failure bookkeeping, which event type to safely repurpose as a test-only poison trigger, exact-match vs. latest-by-id read-back in the shared test fixture), not deviations from anything the plan specified.

## Issues Encountered

None. Docker was running throughout; both `<precondition>`-carrying tasks (Task 1, Task 2) confirmed their real-Postgres tests actually ran against a genuine Testcontainers `postgres:16-alpine` container (not BLOCKED) — the integration test's own startup log line confirms `Datasource "db": PostgreSQL database "test", schema "public" at "localhost:<container-port>"`, distinct from both the local scratch database and the (never-contacted) shared Neon database.

## User Setup Required

None — no external service configuration required. `netlify/functions/drain-domain-events.ts` follows the same deployment convention as the existing `release-expired-holds`/`reconcile-payments`/`close-resolved-tickets`/`cleanup-notifications` scheduled functions; no new environment variable is introduced.

## Known Stubs

None. Every intent the support mapper produces is written through the real `EmailDispatch`/`Notification` tables; no placeholder data, hardcoded empty result, or "coming soon" branch was introduced. `onEmailFailed` is an optional, currently-unused dependency hook reserved for a later plan's D-08 "alert Administrators on FAILED email" — it is exercised as a no-op when absent and is not itself a stub (no code path depends on it doing anything yet).

## Threat Flags

None beyond the plan's own threat model. T-13-67 (duplicate/replayed sends), T-13-12 (poison event DoS), T-13-68/T-13-32 (payload/error information disclosure), and T-13-35 (recipient state at send) are all covered by the tests listed in `coverage` above.

## Next Phase Readiness

- Plans 08-11 can append their own `MapperGroup` to `EVENT_MAPPER_GROUPS` (event-intent-mappers.ts) and reuse `tests/support/drain-harness.ts` (including the as-yet-unused-in-this-plan `seedStaffUser`) without touching the drain service itself.
- Plan 12 (delivery log) can read the `EmailDispatch` rows this drain and Plan 04's `sendQueued` produce.
- Commit the uncommitted work when ready (no commits were created, per the owner's standing no-auto-commit rule).

## Verification

- `npx vitest run tests/domain-event-drain.integration.test.ts tests/domain-event-drain-service.test.ts tests/event-intent-mappers.test.ts tests/drain-domain-events-task.test.ts tests/netlify-drain-domain-events.test.ts tests/boundary.test.ts --no-file-parallelism`: 6 files, 74 tests, all passed (run twice, identical result) — real-Postgres integration tests via Testcontainers `postgres:16-alpine`, all 19 checked-in migrations applied, confirmed by the run's own log line.
- `npx tsc --noEmit`: clean.
- `npx eslint` on every created/modified file: clean (0 errors, 0 warnings after two minor unused-parameter fixes).
- The scratch-database override was honored throughout: every ad hoc Prisma command in this session was prefixed with the scratch `DATABASE_URL` at `127.0.0.1:55432`; the shared Neon database was never contacted for a read or write. Testcontainers-based integration tests started and used their own throwaway container, independent of both.

## Self-Check: PASSED

- All 11 created files and the 1 modified file exist on disk and appear in `git status --porcelain` as `??` (untracked, new files) or tracked-modified (`tests/boundary.test.ts`) — consistent with every prior Phase 13 plan's uncommitted state under the owner's no-auto-commit rule.
- Absence of commits is expected and is not a Self-Check failure (`commit_policy_override`).
- All 74 tests referenced above were actually run in this session (twice, for the full plan verification command) and passed; `tsc --noEmit` and `eslint` were actually run and passed.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-27*
