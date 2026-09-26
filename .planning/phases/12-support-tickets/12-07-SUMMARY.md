---
phase: 12-support-tickets
plan: 07
subsystem: support
tags: [tickets, staff-ui, rbac, optimistic-concurrency, server-actions, postgres]
requires:
  - phase: 12-support-tickets
    plan: 02
    provides: ticket service, lifecycle helpers, staff DTO
  - phase: 12-support-tickets
    plan: 03
    provides: private attachment intent/complete/download routes
  - phase: 12-support-tickets
    plan: 04
    provides: version conflict semantics proven on PostgreSQL
provides:
  - Operations > Support nav (tickets.view) and /staff/support counted, URL-backed queue
  - /staff/support/[reference] full attributed chronology with separate public and internal composers
  - Eight versioned operational actions with required-reason dialogs and conflict handling
  - QUEUE_CHANGED lifecycle event, moveQueue command, escalation-to-owner, messageId on staff sends
affects: [12-09]
tech-stack:
  added: []
  patterns:
    - "Read model as a factory (createTicketStaffQueueService) so it runs against testcontainers"
    - "Client-safe constants in src/lib/support-queue.ts so client islands never import prisma"
    - "Thin Server Actions returning a typed result (ok | validation | denied | conflict | error); no optimistic state"
key-files:
  created:
    - src/lib/support-queue.ts
    - src/server/services/ticket-staff-queue-service.ts
    - src/app/staff/support/{page.tsx,SupportWorkspace.tsx,action-result.ts}
    - src/app/staff/support/[reference]/{page.tsx,StaffTicketDetail.tsx,actions.ts}
    - src/components/support/{QueueTabs,TicketStatusPill,StaffTicketTimeline,TicketComposer,TicketActionDialog}.tsx
    - prisma/migrations/20260925120000_ticket_queue_changed_event/migration.sql
    - tests/staff-support-routes.test.ts
    - tests/staff-support-actions.test.ts
    - tests/staff-support.integration.test.ts
    - tests/ticket-staff-commands.test.ts
    - tests/components/support-workspace.test.tsx
  modified:
    - src/app/staff/layout.tsx
    - src/server/services/ticket-service.ts
    - prisma/schema.prisma
key-decisions:
  - "Queue moves are attributed chronology: added TicketEventType.QUEUE_CHANGED (additive enum migration) instead of an audit-only move."
  - "Owner takeover is a replacement: claimTicket now requires the reassignment reason when another owner exists; the UI only offers Assign to me on unowned tickets."
  - "Eligible owners = active staff with a GLOBAL assignment to an active role holding tickets.manage; the action re-validates assigneeId against that list server-side."
  - "Mutation controls hide without tickets.manage, but the service (withPermission tickets.manage) is the authority; direct invocation is denied."
requirements-completed: [SUP-02, SUP-03, SUP-04, SUP-05]
metrics:
  completed: 2026-09-25
---

# Phase 12 Plan 07: Staff support workspace Summary

Custom Support Agents get a permission-gated, URL-backed triage queue and an auditable ticket workspace where public replies (with a mandatory review step) and amber Staff-only notes are unmistakably separate, and every operational action is reasoned, versioned and server-confirmed.

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| Prerequisite: service support | 676ea48 | QUEUE_CHANGED migration, moveQueue, escalate with optional owner, messageId returned from staff sends |
| 1 queue | d958d0a | Operations > Support (tickets.view), My work default, 5 counted tabs, health filter links, filters, table + mobile cards, no bulk/checkbox |
| 2 chronology + composers | 61a243d | one ordered `<ol>`, amber Staff only notes, attributed events, Review reply dialog, locked context copy |
| 3 actions | ff37b0b | claim, assign/reassign, accept escalation, move queue, priority, escalate, resolve; conflict handling; PostgreSQL proof |

## Verification (actual results)

- `npx vitest run` on the 10 affected unit/component files: 111/111 passed (workspace component tests 28, routes 8, actions 7, staff commands 5, plus existing ticket/layout/boundary suites).
- Real PostgreSQL (Docker testcontainers, real migrations including the new one): `tests/staff-support.integration.test.ts` 3/3 passed, executed not skipped. Also re-ran `ticket-concurrency`, `ticket-rbac` and `ticket-learner-reply` integration suites: 11/11 passed after my service changes.
- `npx tsc --noEmit`: clean. `eslint` clean on every file I created or edited, except `ticket-service.ts` which still carries its pre-existing `no-explicit-any` errors from 12-02 (I added none; not fixed).
- NOT done: the plan's manual narrow/desktop keyboard walkthrough was not performed (no browser). Keyboard behavior (arrow-key tabs, Escape, focus trap, Tab cycling) is covered only by jsdom tests. No automated axe run. Responsive behavior is verified structurally (table `hidden lg:table`, card list `lg:hidden`), not visually.
- Focus-trap Tab wrap is implemented but not asserted in a test; long-content wrapping relies on `break-words [overflow-wrap:anywhere]` classes, not a layout assertion.

## Deviations from Plan

**1. [Rule 3 - Blocking] Staff list/count/assignee operations did not exist in ticket-service.** The plan says to use them; only `listStaffTickets` existed (no learner identity, counts or owner options). Added `ticket-staff-queue-service.ts` (queue view, eligible owners, workspace with resolved names). Filtering, sorting, counting and paging happen in memory over all tickets, not in SQL. Fine at current volume; needs a DB-side query if ticket counts grow large. Commit d958d0a / ff37b0b.

**2. [Rule 2/3 - Missing critical functionality] No move-queue command or queue event existed**, yet "move queue" is one of the eight required actions with audit attribution (D-15). Added enum value `QUEUE_CHANGED` (additive migration `20260925120000_ticket_queue_changed_event`), `moveQueue`, and escalation with an optional owner. I judged an enum value additive rather than an architectural (Rule 4) change; flagging it for review. Commit 676ea48.

**3. [Rule 2] Owner takeover bypassed the reassignment-reason rule.** `claimTicket` overwrote an existing owner with no reason. It now throws the reassignment-reason error in that case. Behavior change to an existing command; existing suites still pass. Commit ff37b0b.

**4. [Rule 2] Eligible-owner validation** added in the assign/escalate actions (service `assignTicket` does not check that the target can manage tickets).

**5. File-layout deviations.** No `src/app/staff/support/actions.ts` was created (no queue-level action needed; a `"use server"` file also cannot export the shared helper). Shared result mapping lives in `src/app/staff/support/action-result.ts`. `TicketStatusPill.tsx` re-exports the existing status pill and adds a priority pill. Added tests `staff-support-actions`, `staff-support.integration` and `ticket-staff-commands` beyond the two listed test files. Resolve requires a resolution note at the action layer (the service treats it as optional).

## Known Stubs

None. Attachments from the staff composers use the existing 12-03 intent/complete routes unchanged (post-send upload with per-file retry). That path has no new real-DB test from me; the 12-03 attachment service remains without a real-DB test.

## Deferred / Notes

- Public reply attachments upload after the message is sent (message first, files second), mirroring the learner flow; a partial failure leaves the reply sent with retry/remove on failed files.
- "Reopen reason" (staff reopen of a resolved ticket) is not part of the eight plan actions and was not built.
- Composer clears after the server confirms and `router.refresh()` is started in a transition; it does not wait for the refreshed chronology to paint.

## Threat Flags

None beyond the plan's threat model. T-12-01 (separate composers, Staff only, mandatory review), T-12-02 (tickets.manage checked in the service; read-only actor denied, proven on PostgreSQL), T-12-04 (no optimistic mutation; conflict requires explicit resubmit), T-12-07 (reasons enforced; attributed chronology incl. new QUEUE_CHANGED) are each implemented and tested.

## Self-Check: PASSED

Created files and commits 676ea48, d958d0a, 61a243d, ff37b0b verified present.
