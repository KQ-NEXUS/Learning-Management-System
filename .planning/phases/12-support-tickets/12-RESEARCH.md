# Phase 12: Support Tickets - Research

**Researched:** 2026-09-21
**Domain:** Privacy-safe learner support, staff queue operations, direct private attachments, append-only ticket history, permission-rechecked contextual links, scheduled lifecycle transitions, and operational reporting on Next.js 16.3.4 / Prisma 6.19 / PostgreSQL / Netlify.
**Confidence:** HIGH for codebase integration and security boundaries; MEDIUM for the final plan split until the UI design contract fixes the responsive screen composition.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Support is a dedicated learner destination and also opens contextually from Course, Cohort, order, submission/result, and certificate surfaces.
- Categories are Account access, Payment/order, Course content, Assessment/result, Certificate, Technical problem, and Other.
- Attachments are PNG, JPEG, WebP, or PDF only; at most 3 files per ticket/reply and 10 MB per file.
- Staff resolve first; the learner may close immediately or reopen with a reason for 7 days; otherwise a scheduled transition closes the ticket.
- Staff workspace defaults to My work with Unassigned, All open, Escalated, and Recently resolved tabs.
- Agents claim unassigned tickets; `tickets.manage` holders assign/reassign; replacing an owner requires a reason.
- Priority begins Normal; staff may change it; Urgent requires a reason.
- Escalation targets General Support, Accounts, Finance, Learning & Assessment, or Technical, optionally with a named owner, and remains Escalated until accepted/claimed.
- Public replies and internal notes use separate composers. Internal notes have persistent amber **Staff only** treatment. Public replies have a recipient/message/attachment review step.
- Staff see one chronological timeline; learners receive a separately projected public-only timeline with no trace that internal content exists.
- Messages are immutable; corrections are new labeled messages.
- Operational reporting combines current backlog health and a default trailing 30-day performance window. General CSV is metadata-only and never contains message bodies or attachment names/content.

### Agent's Discretion

- Exact route names, responsive layout, queue-table arrangement, pagination, and age-bucket thresholds.
- Persistence representation for named queues and ticket transitions.
- Non-sequential ticket reference format.
- Netlify scheduled-task mechanics for seven-day automatic closure.

### Deferred

- Phase 13 owns delivery of transactional emails and in-product notifications. Phase 12 records durable, minimal domain events only.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Planning consequence |
|----|----------------------|
| SUP-01 | Own-ticket creation/read projection, reference/status, controlled category, description as the initial public message, direct private attachments, and denial-parity downloads. |
| SUP-02 | Explicit state machine, optimistic/concurrent mutation protection, assignment/priority mutations, immutable public/internal messages, attributed transition history, resolve/reopen/close rules. |
| SUP-03 | Staff services protected only by `tickets.view` / `tickets.manage`; tests must prove a custom Support Agent succeeds while finance, grading, users, and roles remain denied. |
| SUP-04 | Named queue escalation with mandatory reason, durable history, acceptance/claim semantics, minimal domain event for Phase 13, and reporting visibility. |
| SUP-05 | Context relations for User, Cohort, Course, Order, Submission, and Certificate; ticket projection exposes only a safe type/reference; the existing target route/service performs a fresh permission check. |
| SUP-06 | One normalized support query definition powers dashboard and CSV; current-backlog and 30-day flow metrics; private-message and attachment data excluded structurally. |

</phase_requirements>

## Summary

The repository already contains the support permission pair and a partial `Ticket` / `TicketMessage` / `TicketAttachment` schema, but no service, route, action, or UI exists. The schema is a scaffold rather than an executable lifecycle: it lacks the required ticket description representation, named queue, Submission/Certificate context relations, immutable transition ledger, attachment authorship/visibility derivation, and a concurrency token. The report registry deliberately marks Support unavailable, and the learner dashboard carries a `TICKETS_DEFERRED` named gap.

The correct architecture is a dedicated ticket aggregate service, not `createResourceService`. Ticket operations are stateful commands with different learner and staff authorization rules, multi-row writes, event history, audit, and domain events. Each mutation should run in a transaction and update the ticket with an expected `version` (or equivalent compare-and-swap predicate) before appending the product-facing `TicketEvent`, global `AuditEvent`, and—only for externally meaningful public lifecycle activity—a minimal `DomainEvent`.

The strongest privacy rule is structural: build separate learner and staff read projections in the service layer. Never fetch a staff-shaped timeline and filter internal notes in React. The learner projection query must select only public messages and attachments belonging to learner-visible messages; it must not return hidden counts, timestamps, author ids, filenames, or event gaps. The staff projection can merge public messages, internal notes, and `TicketEvent` rows into one chronology.

The approved product-wide upload design in `docs/superpowers/specs/2026-09-10-serverless-private-uploads.md` explicitly removed ClamAV/malware scanning for the Netlify deployment. For Phase 12, “unsafe files are rejected” therefore maps to a closed active-content-resistant type allow-list, 10 MB cap, declared-versus-stored MIME/size equality, random staged/final keys, private R2, READY-only access, short-lived authorized downloads with attachment disposition, and rejection of SVG/HTML/Office/archive/executable types. Do not reintroduce a scanner or represent a file as “clean.”

No new runtime dependency is required. Existing Prisma, Zod, AWS SDK, Netlify scheduled functions, Server Components, Server Actions, and Vitest patterns cover the phase.

## Recommended Architecture

### 1. Complete the ticket aggregate schema

Use closed enums for fixed product vocabulary:

- `TicketCategory`: `ACCOUNT_ACCESS`, `PAYMENT_ORDER`, `COURSE_CONTENT`, `ASSESSMENT_RESULT`, `CERTIFICATE`, `TECHNICAL_PROBLEM`, `OTHER`.
- `SupportQueue`: `GENERAL_SUPPORT`, `ACCOUNTS`, `FINANCE`, `LEARNING_ASSESSMENT`, `TECHNICAL`.
- `TicketMessageKind`: `INITIAL`, `REPLY`, `INTERNAL_NOTE`, `CORRECTION`.
- `TicketEventType`: at minimum `CREATED`, `CLAIMED`, `ASSIGNED`, `REASSIGNED`, `PRIORITY_CHANGED`, `STATUS_CHANGED`, `ESCALATED`, `ESCALATION_ACCEPTED`, `RESOLVED`, `REOPENED`, `CLOSED`, `AUTO_CLOSED`.

Extend `Ticket` with `queue`, `version`, `submissionId`, and `certificateId`. Keep one optional context relation per supported domain and validate that ticket creation accepts at most one related record. Store the initial learner description as the first PUBLIC `TicketMessage` with kind `INITIAL`; do not duplicate it as mutable text on `Ticket`.

Add append-only `TicketEvent` with explicit actor attribution, event type, reason, lifecycle/assignment/queue/priority before-and-after fields, and timestamp. Global `AuditEvent` remains mandatory for security/operations auditing, but it cannot replace `TicketEvent`: learners/staff need a ticket-specific chronology and SUP-06 needs queryable escalation counts/durations.

Make every attachment belong to exactly one message so visibility is derived from the parent message. This closes the current ambiguity from nullable `messageId`. Initial attachments belong to the `INITIAL` message; public-reply attachments are learner-visible; internal-note attachments remain staff-only.

### 2. Implement an explicit state machine

Centralize transition validation in a pure module, for example `src/server/services/ticket-lifecycle.ts`, and have every action call it. Recommended semantics:

| Command | Precondition | Result |
|---------|--------------|--------|
| Create | authenticated learner | NEW, Normal, General Support unless category routing chooses only a display/default queue |
| Claim | NEW/OPEN or unassigned | ASSIGNED to actor; if Escalated, acceptance changes it to ASSIGNED |
| Assign/reassign | open lifecycle + eligible target | ASSIGNED; reason required when replacing an existing owner |
| Public reply | not CLOSED | first staff public reply stamps `firstRespondedAt`; NEW becomes OPEN unless already ASSIGNED/ESCALATED |
| Internal note | not CLOSED | lifecycle unchanged; no external domain event |
| Escalate | open lifecycle | ESCALATED, target queue/optional owner, mandatory reason |
| Resolve | NEW/OPEN/ASSIGNED/ESCALATED | RESOLVED, `resolvedAt=now` |
| Learner reopen | RESOLVED and `now <= resolvedAt + 7d` | ASSIGNED when an owner remains, otherwise OPEN; stamp `reopenedAt`; reason required |
| Learner close | RESOLVED within grace period | CLOSED, `closedAt=now` |
| System auto-close | RESOLVED and grace elapsed | CLOSED, system-attributed event/audit |

Closed is terminal. Assignment and queue remain historical facts after resolution/closure. Avoid using status alone as the transition history.

Use `version Int @default(1)` with mutations shaped as `updateMany({ where: { id, version, ...expectedState }, data: { ..., version: { increment: 1 } } })`. A zero-row update is a friendly stale-state conflict. This protects double-claim, resolve-vs-reopen, learner-close-vs-auto-close, and simultaneous assignment without depending on UI disabling.

### 3. Separate learner and staff service projections

Recommended service seams:

- `createOwnTicket(actor, input)` and `listOwnTickets(actor)` / `getOwnTicket(actor, idOrReference)` require ownership, not staff permissions.
- `listStaffTicketQueue(input)` / `getStaffTicketDetail(input)` use `tickets.view`.
- Claim, assign, priority, escalate, public reply, internal note, resolve use `tickets.manage`.
- Learner reopen/close require ticket ownership and the RESOLVED grace-period rule.
- `listEligibleSupportAgents()` is a narrow ticket-domain directory of active users with an effective `tickets.manage` grant. It should return only safe assignment fields (id and display name), not become a general `users.view` bypass.

Treat named queues as routing labels in v1, not authorization partitions. Any effective `tickets.view` holder can see the support queue and any `tickets.manage` holder can manage it. This matches the two-permission catalogue and avoids inventing queue-administration or membership-management capability that Phase 12 did not authorize.

Support queue access should be GLOBAL for v1. The support lifecycle includes account and technical tickets that have no Course/Cohort scope; pretending a scoped grant can safely cover a mixed queue would create inconsistent omissions. Context links remain independently permission-checked.

### 4. Context links never convey authority

The ticket detail projection may return only `{ kind, safeReference, href | null, locked }`. Resolving a context card should:

1. Load the ticket under `tickets.view`.
2. Obtain only the safe reference required for display.
3. Independently check the target domain permission/scope.
4. Return an href only when that check succeeds; otherwise return the locked copy from D-18.

Opening the href still goes through the target page/service authorization. Never reuse ticket authorization as a substitute. Do not embed learner email/order totals/grades/certificate internals into the ticket payload merely because a context relation exists.

### 5. Reuse the direct private-upload lifecycle

Create ticket-specific sibling functions rather than generalizing lesson names retroactively:

- `validateTicketAttachment()` in `src/lib/upload-limits.ts` with exact allowed MIME values and 10 MB cap.
- Staged keys under `ticket-uploads/<ticketId>/<uuid>` and final keys under `tickets/<ticketId>/<uuid>`.
- Intent authorizes either the owning learner or staff with `tickets.manage`, verifies the target message and its visibility, enforces 3 READY/UPLOADING attachments per message, creates an UPLOADING row, and returns a 900-second presigned PUT.
- Completion reauthorizes, HEAD-checks exact bytes/content type, promotes, marks READY, and is idempotent.
- Download authorizes against the message projection, permits only READY, returns a 302 with `Cache-Control: private, no-store`, and maps unknown/foreign/hidden records to identical empty 404s.
- Extend stale-upload cleanup to ticket attachments or add a bounded ticket sibling called from the existing hourly scheduled function.

Next.js 16 route params are Promise-typed, and authenticated download handlers must remain request-time. Database/auth access already prevents prerendering; do not add `force-static` or `'use cache'` around ticket downloads or details.

### 6. Use both ticket events and domain events correctly

`TicketEvent` is the immutable product history. `AuditEvent` is the security trail. `DomainEvent` is the Phase 13 outbox. They serve different consumers and all relevant records should be written in the same transaction as the state change.

Add minimal domain event types such as `ticket.created`, `ticket.public_reply_added`, `ticket.assigned`, `ticket.escalated`, `ticket.resolved`, `ticket.reopened`, and `ticket.closed`. Never emit internal-note content or attachment names. Payloads should carry identifiers, recipient/owner ids, ticket reference, and event correlation only; Phase 13 loads authorized/template-safe data when dispatching.

### 7. Extend, do not duplicate, reporting

Activate the existing `support` registry entry and add support filters to the normalized report vocabulary: category, priority, queue, owner, and status. Implement one support projection in `report-query-service.ts` and use the existing complete-before-pagination export seam.

Define metrics explicitly:

- Current snapshot: Open (NEW/OPEN/ASSIGNED/ESCALATED), Unassigned, Urgent-open, Escalated-open, and age buckets.
- Trailing range: opened volume by `createdAt`, first response by `firstRespondedAt - createdAt`, resolution by `resolvedAt - createdAt`, escalation count from `TicketEvent`, and category/status/priority/queue/owner breakdowns.
- Median calculation should be a pure deterministic helper with even-cardinality tests.

The general export row must have no message relation or attachment relation at all. Identity columns follow the existing `users.view`-gated sensitive-column path. Internal notes are therefore impossible to serialize accidentally, rather than removed after a broad query.

### 8. UI integration points

- Add Support to `src/app/(learner)/layout.tsx` and replace `TICKETS_DEFERRED` in `enrolment-dashboard-service.ts` with an ownership-projected recent/open summary.
- Add Support to `src/app/staff/layout.tsx` gated by `tickets.view`.
- Reuse `ResourceTable` for the queue and `DetailLayout`/`DetailFacts`/`StatusPill` for detail facts.
- Reconciliation case detail is the closest existing chronological event/detail analog; grading queue is the closest action queue analog.
- The public/internal composer split and public-reply review dialog need a UI-SPEC before plans lock files and responsive behavior.

## Schema Migration and Deployment

This phase necessarily modifies `prisma/schema.prisma`; planning must include a migration and a blocking deployment schema step. Use a checked-in migration for the production/Neon database. `prisma db push` may be useful only for disposable test infrastructure; it must not replace the migration applied to the deployed environment.

Recommended migration safety:

- New fields begin nullable/defaulted where existing rows may exist.
- Backfill current tickets with General Support, version 1, and ticket events only if live legacy ticket rows actually exist; migration must not fabricate actor attribution.
- Change attachment `messageId` to required only after confirming/backfilling legacy rows. If legacy unattached rows exist, preserve them behind a migration note or attach them to a synthetic initial message; do not delete them.
- Add indexes for `(queue,status,priority,updatedAt)`, `(assigneeId,status,updatedAt)`, `(userId,createdAt)`, and `TicketEvent(ticketId,createdAt,id)`.

## Security Threat Model Inputs

| Threat | Severity | Required mitigation |
|--------|----------|---------------------|
| Internal note leaks through learner detail, counts, search, dashboard, export, attachment download, or error differences | CRITICAL | Separate learner query/projection; PUBLIC predicate at database boundary; no hidden counts; export type has no body fields; internal attachment returns denial-parity 404; negative tests for every surface. |
| Direct request bypasses UI and mutates a foreign ticket | CRITICAL | Ownership checks for learner commands; `withPermission` for staff commands; mutation service is the only write path; integration tests with stranger/custom Support Agent. |
| Ticket permission grants access to payment/grade/user/certificate context | HIGH | Context resolver calls the target permission/scope check; locked safe reference only; target route reauthorizes; cross-role tests. |
| Two agents claim/transition the same ticket | HIGH | Version compare-and-swap inside transaction; one event/audit/outbox row only; real-Postgres concurrency test. |
| File-type spoofing or active content | HIGH | Closed PNG/JPEG/WebP/PDF list, exact byte/MIME equality, SVG/HTML/Office/archive exclusion, private bucket, attachment disposition, READY-only authorized download. The approved deployment has no malware scanner. |
| Presigned URLs cached or replayed | HIGH | Resolve on click, short TTL, `Cache-Control: private, no-store`, random keys, never persist the URL. |
| Internal note causes external notification | HIGH | Internal-note command writes no external `DomainEvent`; test outbox remains unchanged. |
| Scheduled close overwrites a learner reopen/close | HIGH | Conditional update on RESOLVED + version/current timestamp predicate; event/audit only when one row changed. |
| Support export leaks identities without permission | HIGH | Reuse existing sensitive-column authorization; metadata-only base row; no message/attachment selects. |
| Stored message content renders markup/script | MEDIUM | Plain-text message contract, length limits, React escaped rendering, `whitespace-pre-wrap`; no rich-text HTML pipeline. |

## Pitfalls to Avoid

1. **Filtering internal notes in React.** The leak has already happened if the server sent them.
2. **Using AuditEvent as the ticket timeline.** It is a security log, not a typed product history, and is insufficient for stable support reporting.
3. **Making queue membership a new authorization system.** The current catalogue has exactly view/manage; named queues are routing labels unless a future phase explicitly adds membership administration.
4. **Letting `Ticket.status` encode both lifecycle and all assignment history.** History belongs in `TicketEvent`.
5. **Emitting message bodies in DomainEvent.** The outbox survives beyond the request and Phase 13 needs identifiers, not private conversation content.
6. **Creating a parallel CSV implementation.** Dashboard/export reconciliation depends on one normalized report projection.
7. **Reintroducing ClamAV.** The approved Netlify upload architecture removed it intentionally.
8. **Assuming UI disabled state prevents races.** Versioned conditional writes are required.
9. **Exposing the general user directory to Support Agents.** Assignment discovery must be a narrow eligible-agent projection.
10. **Caching authenticated Route Handlers.** Ticket reads/download URLs must remain request-time and no-store where redirect locations are involved.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 with Node and jsdom projects |
| Config | `vitest.config.mts` |
| Quick command | `npx vitest run tests/ticket-service.test.ts tests/ticket-lifecycle.test.ts` |
| Full command | `npm test` |
| Database proof | Testcontainers PostgreSQL via targeted `*.integration.test.ts` suites |

### Requirements to Test Map

| Requirement | Critical automated proof | Proposed test file |
|-------------|--------------------------|--------------------|
| SUP-01 | owner create/list/detail; stranger denial parity; reference/status; category validation | `tests/ticket-service.test.ts`, `tests/ticket-access.integration.test.ts` |
| SUP-01 | 3-file/10 MB/MIME limits; intent/complete idempotency; READY-only owner download | `tests/ticket-attachment-service.test.ts`, `tests/ticket-attachment-download-route.test.ts` |
| SUP-02 | state transition table, reasons, first-response timestamps, immutable messages, version conflicts | `tests/ticket-lifecycle.test.ts`, `tests/ticket-service.test.ts` |
| SUP-02 | learner projection contains no internal bodies, metadata, counts, attachment names, or event gaps | `tests/ticket-privacy.test.ts` |
| SUP-03 | custom Support Agent can view/manage tickets and remains denied roles/users/payments/grades | `tests/ticket-rbac.integration.test.ts` |
| SUP-04 | escalation queue/optional owner/reason/history; accept/claim; minimal domain event | `tests/ticket-service.test.ts` |
| SUP-05 | locked safe reference when target permission denied; permitted target opens through fresh authorization | `tests/ticket-context.test.ts`, existing domain route tests |
| SUP-06 | metric definitions, medians, filters, dashboard/export row reconciliation, no private content | `tests/support-report.test.ts`, `tests/support-report.integration.test.ts` |
| D-04 | learner reopen within 7 days; rejection after; bounded system auto-close; close/reopen race | `tests/ticket-auto-close.test.ts`, `tests/ticket-concurrency.integration.test.ts` |
| UI decisions | separate composers, amber Staff only, public review, responsive queue/detail states | `tests/components/support-workspace.test.tsx`, `tests/components/learner-support.test.tsx` |

### Sampling

- After each service/schema task: run the targeted Node tests for that aggregate.
- After each UI task: run the relevant jsdom component test plus its service test.
- After each wave: `npm test` and `npm run lint`.
- Before phase verification: full suite, production build, Prisma validation/generation, migration applied to disposable PostgreSQL, and targeted real-Postgres concurrency/privacy suites.

### Wave 0 Gaps

- All Phase 12 ticket test files listed above are new.
- Existing Vitest, jsdom, Testcontainers, storage mocks, and route-test helpers are sufficient; no framework installation is needed.
- Seed data must include a learner with tickets, a second learner, a custom Support Agent with only ticket permissions, a manager, and target records the Support Agent is both allowed and denied to open.

## Sources

### Primary — direct repository sources

- `.planning/phases/12-support-tickets/12-CONTEXT.md`
- `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md`
- `prisma/schema.prisma`
- `src/server/permissions/catalogue.ts`, `src/server/permissions/with-permission.ts`, `src/server/permissions/collection-scope.ts`
- `src/server/services/audit-service.ts`, `src/server/services/domain-event-service.ts`
- `src/server/services/submission-service.ts`, `src/server/services/storage-service.ts`, `src/server/services/upload-cleanup-system-service.ts`
- `src/server/services/report-registry.ts`, `src/server/services/report-query-service.ts`
- `src/server/services/enrolment-dashboard-service.ts`
- `src/app/staff/layout.tsx`, `src/app/(learner)/layout.tsx`
- `src/app/staff/reconciliation/[caseId]/ReconciliationCaseDetail.tsx`, `src/app/staff/cohorts/[id]/grading/[assessmentId]/page.tsx`
- `src/app/api/submissions/[submissionId]/download/route.ts`
- `netlify/functions/cleanup-stale-uploads.ts`, `docs/deployment/netlify-scheduled-functions.md`
- `docs/superpowers/specs/2026-09-10-serverless-private-uploads.md`
- `package.json`, `vitest.config.mts`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`

## Metadata

- Architecture/integration confidence: HIGH — traced to current source and existing patterns.
- Security/privacy confidence: HIGH — controls map directly to requirement boundaries and negative test seams.
- Attachment safety confidence: MEDIUM-HIGH — matches the approved no-scanner deployment design; residual malware risk is an explicitly accepted consequence of that architecture, not silently claimed closed.
- UI composition confidence: MEDIUM — interaction decisions are locked, but the required UI-SPEC has not yet been generated.

**Valid until:** 2026-10-21, unless the ticket context or upload architecture changes first.
