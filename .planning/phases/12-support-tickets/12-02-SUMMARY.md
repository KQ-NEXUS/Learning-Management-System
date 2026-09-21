---
phase: 12-support-tickets
plan: 02
subsystem: support
tags: [tickets, rbac, privacy, lifecycle, domain-events]
requires:
  - phase: 12-support-tickets
    plan: 01
    provides: ticket aggregate schema, lifecycle rules, references, upload contract
provides:
  - Injectable support ticket service with learner/staff projections
  - Version-guarded ticket lifecycle command surface
  - Redacted support ticket domain event types
  - Safe context projection helper with opaque references
  - Service-level support-only RBAC isolation tests
affects: [12-03, 12-04, 12-05, 12-06, 12-07, 12-08, 12-09]
tech-stack:
  added: []
  patterns:
    - "Learner DTOs are distinct from staff DTOs and omit internal actor/owner identifiers"
    - "Ticket commands write audit/outbox rows through the transaction repository"
    - "Context projections expose opaque safeReference values instead of raw target ids"
key-files:
  created:
    - src/server/services/ticket-service.ts
    - src/server/services/ticket-context-service.ts
    - tests/support/ticket-harness.ts
    - tests/ticket-service.test.ts
    - tests/ticket-privacy.test.ts
    - tests/ticket-context.test.ts
    - tests/ticket-rbac.integration.test.ts
    - .planning/phases/12-support-tickets/12-02-REVIEW.md
  modified:
    - src/server/services/domain-event-service.ts
    - tests/domain-event-service.test.ts
key-decisions:
  - "Ticket messages remain the immutable chronology for public replies/internal notes; TicketEvent rows cover lifecycle/status/assignment/priority transitions, while every command now has a success AuditEvent."
  - "Context safe references are deterministic opaque hashes, not raw relation ids."
  - "The current RBAC proof is service-level and permission-choke-point based; a stricter real-Postgres role-assignment proof remains a follow-up gap."
patterns-established:
  - "Support domain events carry ids/references/recipient-owner identifiers only, never bodies, reasons, filenames, storage keys, or attachment arrays."
  - "Staff attachment DTOs enumerate safe fields and do not expose storageKey."
requirements-completed: [SUP-01, SUP-02, SUP-03, SUP-04, SUP-05]
duration: 1h 20min
completed: 2026-09-21
---

# Phase 12 Plan 02: Support Ticket Service Summary

Implemented the support ticket service core: safe learner/staff reads, lifecycle commands, redacted domain events, context projection, and RBAC isolation coverage.

## Accomplishments

- Added `createTicketService` with learner ownership reads, staff `tickets.view` reads, `tickets.manage` commands, optimistic version checks, immutable messages, lifecycle events, success audits, and minimal domain events.
- Added `createTicketContextService` for `{ kind, safeReference, href, locked }` context projection with opaque references.
- Extended `DomainEventType` with support ticket events and tests proving payloads do not include private content keys.
- Added privacy tests proving learner DTOs hide internal messages, internal attachments, staff actor ids, owner ids, raw context ids, event streams, storage keys, and filenames from internal notes.
- Ran a review pass, recorded findings in `12-02-REVIEW.md`, and fixed the critical/important code issues it found.

## Task Commits

1. `ecf2ca8` - support ticket service core and privacy/service tests.
2. `0634eec` - remaining lifecycle commands and support domain event types.
3. `23a23a2` - safe context resolver and RBAC isolation tests.
4. `2962a9d` - verification/type hardening.
5. `e7d0ba5` - code review gap closure.

## Verification

- `npx vitest run tests/ticket-lifecycle.test.ts tests/ticket-service.test.ts tests/ticket-privacy.test.ts tests/ticket-context.test.ts tests/ticket-rbac.integration.test.ts tests/domain-event-service.test.ts` - 65/65 passed.
- `npx tsc --noEmit` - passed.
- `npx vitest run tests/boundary.test.ts` - 17/17 passed.

## Deviations / Issues

- The plan asked for a real-Postgres Support Agent RBAC proof. The implemented `tests/ticket-rbac.integration.test.ts` proves the permission choke point and ticket-only grant behavior at service level, but does not seed roles/assignments in Postgres or call a Prisma-backed ticket service. This should be tightened in a follow-up if the phase gate requires real database RBAC evidence.
- `TicketEventType` does not include reply/note-specific event enum values from Plan 12-01. Replies and internal notes are immutable `TicketMessage` rows plus success `AuditEvent` rows; lifecycle/status/assignment/priority changes remain `TicketEvent` rows.

## Next Phase Readiness

The ticket aggregate service is ready for the upload, UI, queue, schedule, and reporting plans to consume. The main caveat is the real-Postgres RBAC proof gap noted above.

## Self-Check: PASSED WITH DEVIATION

- FOUND: service, context resolver, tests, review artifact, and domain event union.
- FOUND commits: `ecf2ca8`, `0634eec`, `23a23a2`, `2962a9d`, `e7d0ba5`.
- VERIFIED: focused tests, TypeScript, and boundary tests pass after review fixes.
- DEVIATION: real-Postgres RBAC proof remains service-level only.
