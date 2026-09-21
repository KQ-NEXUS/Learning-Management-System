---
phase: 12-support-tickets
plan: 02
reviewed: 2026-09-21T21:45:52Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - src/server/services/domain-event-service.ts
  - src/server/services/ticket-context-service.ts
  - src/server/services/ticket-service.ts
  - tests/domain-event-service.test.ts
  - tests/support/ticket-harness.ts
  - tests/ticket-context.test.ts
  - tests/ticket-privacy.test.ts
  - tests/ticket-rbac.integration.test.ts
  - tests/ticket-service.test.ts
findings:
  critical: 3
  warning: 4
  info: 0
  total: 7
status: issues_found
---

# Phase 12-02: Code Review Report

**Reviewed:** 2026-09-21T21:45:52Z
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The support ticket core is not ready to ship. The submitted service still leaks internal staff/request context identifiers into learner-facing DTOs, writes live audit/outbox rows outside the ticket transaction, and leaves most lifecycle commands without audit records. Several tests assert against fakes that encode the desired result, so they miss the production boundary failures.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Learner projections expose internal actor and assignee identifiers

**File:** `src/server/services/ticket-service.ts:235`
**Issue:** `ticketSummaryDto` always includes `assigneeId` (`src/server/services/ticket-service.ts:245`) and is used by `listOwnTickets` and learner detail (`src/server/services/ticket-service.ts:341`, `src/server/services/ticket-service.ts:257`). `learnerDetailDto` also exposes every public message `authorId` (`src/server/services/ticket-service.ts:261`). The plan explicitly requires learner reads to be public-only with no internal metadata/actor-id leaks. A learner can now see staff user IDs and internal ownership changes from their ticket payload.
**Fix:**
```ts
function learnerSummaryDto(ticket: TicketRecord) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    queue: ticket.queue,
    version: ticket.version,
    context: safeContextProjection(ticket),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    firstRespondedAt: ticket.firstRespondedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
  };
}

function learnerDetailDto(ticket: TicketRecord, messages: TicketMessageRecord[]) {
  return {
    ...learnerSummaryDto(ticket),
    messages: messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt,
      attachments: message.attachments.map(attachmentDto),
    })),
  };
}
```

### CR-02: Ticket context leaks raw target IDs instead of the required safe projection

**File:** `src/server/services/ticket-service.ts:215`
**Issue:** `contextDto` returns raw relation IDs such as `courseId`, `orderId`, `submissionId`, and `certificateId` as `{ kind, id }` (`src/server/services/ticket-service.ts:215-220`), and `ticketSummaryDto` exposes that directly to learner and staff DTOs (`src/server/services/ticket-service.ts:246`). The separate context resolver also constructs `safeReference` by concatenating the raw ID (`src/server/services/ticket-context-service.ts:53`), so the locked projection still discloses internal identifiers. This violates the required `{ kind, safeReference, href, locked }` shape and the independent safe-reference boundary.
**Fix:** Replace `contextDto` with a resolver-backed projection that never includes raw IDs. The resolver should receive the relation IDs server-side, independently authorize the target, and return only `{ kind, safeReference, href, locked }`; `safeReference` should be a non-sensitive display reference or opaque derived value, not `${prefix}-${id}`.

### CR-03: Live audit and domain event writes escape the ticket transaction

**File:** `src/server/services/ticket-service.ts:717`
**Issue:** The live service injects `audit` and `writeEvent` using the root `prisma` client (`src/server/services/ticket-service.ts:724-725`) even when commands pass a transaction repository into `deps.writeEvent`. That means outbox rows and creation audits are not atomic with the ticket/message/event mutation, despite the plan requiring `Ticket + TicketEvent + AuditEvent + DomainEvent` in one transaction. On a rollback or a stale update race after a domain-event call, production can persist orphan notification rows for mutations that did not commit.
**Fix:**
```ts
export type TicketRepository = {
  // ...
  audit(event: BusinessAuditEvent): Promise<void>;
  writeDomainEvent(event: DomainEventInput): Promise<void>;
};

// In createPrismaTicketRepository(tx):
audit: (event) => recordAuditInTransaction(client as never, event),
writeDomainEvent: (event) => writeDomainEvent(client as never, event),

// In commands:
await tx.audit({...});
await tx.writeDomainEvent({...});
```

## Warnings

### WR-01: Lifecycle commands are not audited, and replies/notes do not append TicketEvent rows

**File:** `src/server/services/ticket-service.ts:366`
**Issue:** `mutateStaffTicket`/`mutateOwnTicket` centralize all commands (`src/server/services/ticket-service.ts:366-395`), but neither writes a success audit, and the individual commands from `claimTicket` through `closeOwnTicket` do not call `deps.audit` either (`src/server/services/ticket-service.ts:397-609`). Public replies and internal notes only create `TicketMessage` rows (`src/server/services/ticket-service.ts:447-467`), leaving no `TicketEvent` attribution for those commands. This misses the plan's "every command is attributed and audited" requirement and weakens repudiation controls.
**Fix:** Add a command metadata layer that records a success audit for every lifecycle operation inside the same transaction, and add explicit event types/rows for public replies and internal notes or otherwise document and test why message rows are the authoritative event for those commands.

### WR-02: Staff detail returns broad attachment records including storage keys

**File:** `src/server/services/ticket-service.ts:681`
**Issue:** Staff message loading uses `include: { attachments: true }` (`src/server/services/ticket-service.ts:681-684`), and `staffDetailDto` returns the full `message` object in the timeline (`src/server/services/ticket-service.ts:275-279`). Because `TicketAttachmentRecord` contains `storageKey` (`src/server/services/ticket-service.ts:88`), staff API consumers receive raw object-store keys instead of a deliberately shaped attachment DTO. This contradicts the plan's "avoid broad include; enumerate safe fields" instruction and risks coupling future UI/API code to storage internals.
**Fix:** Select only the staff-safe attachment fields and map messages/events into explicit staff DTOs rather than returning repository records.

### WR-03: Reference collision retry does not actually retry unique constraint failures

**File:** `src/server/services/ticket-service.ts:306`
**Issue:** `createOwnTicket` loops three times while `ticket` is null (`src/server/services/ticket-service.ts:306-311`), but `tx.createTicket` throws on a unique `reference` collision in the Prisma implementation (`src/server/services/ticket-service.ts:646`). The first collision aborts the transaction instead of continuing to the next generated reference.
**Fix:** Catch only the known Prisma unique-constraint error for the `reference` field inside the retry loop, continue to the next generated value, and rethrow all other errors.

### WR-04: RBAC/context tests do not exercise the production service boundaries they claim to prove

**File:** `tests/ticket-rbac.integration.test.ts:6`
**Issue:** The "integration" RBAC test only calls `createWithPermission` with in-memory grants (`tests/ticket-rbac.integration.test.ts:6-15`) and never creates a custom role/assignment in Postgres or calls the ticket service. The context tests similarly inject an `authorize` fake that always returns `/staff/${kind}/${id}` (`tests/ticket-context.test.ts:14-24`) and assert raw-id `safeReference` values (`tests/ticket-context.test.ts:5-10`). These tests would pass even though the service leaks raw context IDs and never verifies target-domain authorization against real services.
**Fix:** Add real service-level tests for `listStaffTickets`/commands using actual role assignments, and context resolver tests that call the real target authorization adapters and assert locked projections do not include raw IDs.

## Declined to judge

- UI/API wiring for these services was not in the changed-file set.
- I did not judge Phase 13 drain behavior beyond the outbox row contract changed here.
- I did not run the test suite during this read-only review; findings are from static diff and call-path inspection.
- I did not evaluate unrelated planning artifacts already dirty in the working tree.

## Verdict

Ready to merge? **No.** The implementation needs fixes for learner privacy shaping and transactional audit/outbox writes before it can safely become the support-ticket core.

---

_Reviewed: 2026-09-21T21:45:52Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
