# Phase 12 Pattern Map — Support Tickets

**Mapped:** 2026-09-21  
**Inputs:** `12-CONTEXT.md`, `12-RESEARCH.md`, `12-UI-SPEC.md`, live repository

## Purpose

Phase 12 is new product behavior built from established repository seams. This map tells executors which analogs to extend and which tempting shortcuts would violate existing boundaries.

## File Classification

| Planned area | New or modified files | Closest analogs | Pattern to preserve |
|---|---|---|---|
| Ticket persistence | `prisma/schema.prisma`, new migration | `ReconciliationCase`, `ReconciliationCaseEvent`, `LessonResource` | Additive Prisma model evolution; append-only product event ledger; raw migration checks/indexes where Prisma cannot express the invariant |
| Lifecycle contract | `src/server/services/ticket-lifecycle.ts` | `enrolment-transitions.ts`, `certificate-service.ts` | Pure transition/reason functions separate from Prisma; optimistic compare-and-swap at the aggregate service |
| Aggregate commands and projections | `src/server/services/ticket-service.ts` | `reconciliation-case-service.ts`, `grading-service.ts`, `certificate-service.ts` | Injectable structural store, `withPermission`, transaction-scoped state + `AuditEvent` + `DomainEvent`, separate public/staff read projections |
| Context links | `src/server/services/ticket-context-service.ts` | certificate/submission/learner access resolvers | Ticket authorization never grants target authorization; return `{ kind, safeReference, href|null, locked }` only after the target permission check |
| Ticket files | `ticket-attachment-service.ts`, storage helpers, API routes | `submission-service.ts`, lesson-resource upload routes, certificate download route | private presign → PUT → complete → READY-only authenticated download; random keys; declared/stored metadata equality; denial-parity not-found response |
| Scheduled close | `ticket-auto-close-system-service.ts`, scheduled task, Netlify function | `hold-release-system-service.ts`, `upload-cleanup-system-service.ts`, their task/function wrappers | actorless `AsSystem` service, bounded candidate set, defensive re-filter, per-row isolation, system audit, import-closure tests |
| Learner support | `(learner)/support/**`, dashboard integration | learner dashboard pages, certificate/result learner components | Server Component reads; client islands only for form/upload interaction; ownership-shaped data; explicit empty/error/denied states |
| Staff support | `staff/support/**` | reconciliation workspace/detail, grading queue, `ResourceTable`, `DetailLayout` | URL-backed tabs/filters, server-authorized reads, action-level manage checks, responsive table/card projection, accessible dialogs |
| Reporting/export | report registry/query/action/UI files | registrations/payments reports and `export-service.ts` | one normalized query drives dashboard and export; full bounded set before pagination; sensitive identity columns separately gated; no message/attachment relation in export row type |
| Navigation | learner/staff layouts | current permission-filtered shell navigation | learner Support link under authenticated shell; staff Support item gated by `tickets.view`; UI visibility is not authorization |

## Concrete Analog Notes

### Reconciliation workspace and detail

- `src/app/staff/reconciliation/page.tsx` parses URL filters in a Server Component, resolves data in parallel, and maps authentication/authorization failures to explicit surfaces.
- `ReconciliationWorkspace.tsx` demonstrates URL-backed filters, responsive desktop/mobile projections, `PageHeader`, semantic tokens, focus-managed dialogs, retained state on failure, and as-of timestamps.
- `ReconciliationCaseDetail.tsx` is the nearest chronological operational-record UI. Ticket detail must adapt the structure, not copy finance-specific labels or bulk behavior.
- Support intentionally has no bulk selection. `ResourceTable` is the preferred queue primitive where its filter/card projection contract fits.

### Private upload lifecycle

- `src/server/services/submission-service.ts` is the nearest learner-owned intent/complete authorization pattern.
- `src/server/services/storage-service.ts` owns random private keys and presigned transfer helpers. Ticket keys must use `ticket-uploads/<ticketId>/<randomUUID>` for staging and `tickets/<ticketId>/<messageId>/<randomUUID>` for final objects; filenames never enter keys.
- `src/server/services/upload-cleanup-system-service.ts` currently sweeps only lesson resources. Extend its bounded worker to cover ticket attachments or add an equivalent sibling invoked by the existing hourly wrapper.
- Download routes must return the same not-found shape for a missing row and an unauthorized row, require `READY`, set private/no-store behavior, and use attachment disposition.

### Transactional audit and future notifications

- `src/server/services/domain-event-service.ts` contains a closed union and sink-level redaction. Add only `ticket.created`, `ticket.public_reply_added`, `ticket.assigned`, `ticket.escalated`, `ticket.resolved`, `ticket.reopened`, and `ticket.closed`.
- Domain-event payloads carry identifiers, ticket reference, and recipient/owner ids only. They never carry message bodies, reasons, filenames, or attachment metadata.
- `TicketEvent` is the product chronology and reporting ledger. `AuditEvent` is the security record. `DomainEvent` is the Phase 13 outbox. One cannot substitute for another.

### Next.js 16.3.4 boundaries

Before editing routes or actions, executors must read the repository-local docs under `node_modules/next/dist/docs/01-app/`, especially `01-getting-started/05-server-and-client-components.md`, `01-getting-started/15-route-handlers.md`, `02-guides/forms.md`, and `03-api-reference/03-file-conventions/dynamic-routes.md`. Route `params` and `searchParams` are asynchronous in the current repository patterns.

## Shared Patterns

- Authorize before shaping data: services enforce ownership or named permissions and return projection-specific values that UI code can render without redaction.
- Keep state mutation, chronology, security audit, and the minimal notification outbox event in one transaction.
- Use server-rendered reads with small client islands for forms, uploads, filters, and dialogs.
- Preserve the repository's injectable-store seams for unit tests and add real PostgreSQL integration coverage where locking or compare-and-swap behavior matters.
- Read the repository-local Next.js documentation named above before changing route handlers, Server Components, actions, or dynamic route parameters.

## No Analog Found

None. Phase 12 composes established persistence, authorization, upload, scheduled-worker, workspace, reporting, and navigation patterns; it does not introduce a novel framework primitive.

## Data Flow

```text
learner/staff route
  → server ownership or withPermission read
  → learner projection OR staff projection
  → client island receives already-safe data

server action
  → parse/validate input
  → ticket aggregate command
  → version-guarded ticket update
  → TicketEvent + AuditEvent + minimal DomainEvent in same transaction
  → revalidate/refresh

attachment client
  → authorized intent
  → direct private object PUT
  → authorized completion with metadata equality
  → READY-only authorized download
```

## Non-Negotiable Landmines

1. Never fetch a staff timeline and filter it in React. The learner query must never select internal rows or their attachment metadata.
2. Never infer target-record access from ticket access. Every context link performs the target domain's current permission/scope check.
3. Never use `updatedAt` alone as a concurrency guard. Every command consumes an expected `version` and increments it through `updateMany`.
4. Never emit internal-note bodies, public message bodies, reasons, or filenames into `DomainEvent`.
5. Never serialize a broad Ticket include and delete sensitive properties afterward. Reporting/export types must structurally omit message and attachment relations.
6. Never add malware-scanner copy or a “clean” state. The approved serverless design uses a closed type allow-list, byte/MIME/size equality, private storage and safe downloads.
7. Never let the scheduled function import request/session authorization modules. The actorless service must own a fixed bounded predicate and audit as SYSTEM.
8. Never use `db push --accept-data-loss`. Generate an additive migration, apply it, then run the workflow-mandated blocking `npx prisma db push` only as an in-sync verification step.

## Test Analogs

| Proof needed | Existing style to follow |
|---|---|
| Injectable aggregate unit tests | `reconciliation-case-service.test.ts`, `certificate-service.test.ts` |
| Real PostgreSQL concurrency | `certificate-concurrency.integration.test.ts`, `reconciliation-case.integration.test.ts` |
| Permission/scope denial | `with-permission.test.ts`, `report-scope.integration.test.ts` |
| Authenticated private download | `certificate-download-route.test.ts`, `submission-download-route` tests |
| Queue/detail component states | `components/ReconciliationWorkspace.test.tsx`, `components/grading-queue-table.test.tsx` |
| Learner dashboard widening | `enrolment-dashboard-service.test.ts`, `learner-dashboard-page.test.ts` |
| Report/export reconciliation | `report-registry.test.ts`, `components/Reports.test.tsx`, report integration tests |
| Scheduled import closure | `boundary.test.ts`, upload cleanup and hold-release tests |
