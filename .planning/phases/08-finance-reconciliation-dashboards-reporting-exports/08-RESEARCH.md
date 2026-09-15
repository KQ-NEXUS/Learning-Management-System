# Phase 8: Finance Reconciliation, Dashboards & Reporting Exports - Research

**Researched:** 2026-09-15
**Domain:** Multi-provider financial reconciliation, scope-safe operational reporting, and asynchronous CSV exports
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Reconciliation workspace
- **D-01:** The reconciliation landing view is exception-first: unresolved exceptions appear before summary totals and access to the complete transaction ledger.
- **D-02:** An exception may be resolved only with a standard resolution-reason category and a required case-specific note. The original exception, evidence, and resolution history remain preserved.
- **D-03:** Exceptions begin in a shared queue and may optionally be assigned to a permitted Finance user. Bulk assignment is allowed; bulk resolution is not.
- **D-04:** Use one reconciliation queue with quick tabs for All, Stripe, Paystack, and Manual. Every row identifies provider and currency.
- **D-05:** An exception opens on a dedicated detail page extending the established payment-detail pattern. It brings together the order, learner, provider references, expected and actual amounts, payment history, assignment, notes, and resolution controls.
- **D-06:** Queue priority is risk category first, then age. Captured-money problems (for example, money received without enrolment) precede settlement differences and missing provider data; the oldest record appears first within each category.
- **D-07:** Resolving an exception closes the investigation only. It must not silently change payment, enrolment, refund, expected-fee, or settlement records; corrective work uses the appropriate operational workflow and is linked in history.
- **D-08:** Materially contradictory provider evidence automatically reopens a resolved exception, retaining its previous resolution and identifying the evidence that caused reopening. — **Reversibility:** costly — changing this later alters the exception lifecycle and audit interpretation.
- **D-09:** Reconciliation visibility requires both the relevant permission and matching resource scope. Globally authorized Finance administrators may see all records; scoped staff may see only permitted programmes/cohorts.
- **D-10:** Manual payments show their confirmation amount, staff actor, reference, and evidence. Gateway-only fields display `Not applicable`, never zero and never a misleading pending value.

### Operational dashboards
- **D-11:** Provide one central Reports hub grouped into Admissions & Finance, Learning Delivery, and Outcomes & Support. Each of the ten required reporting areas has a dedicated dashboard with filters and a drill-down table.
- **D-12:** The Reports hub displays a concise set of trusted headline counts, separate financial totals by currency, last-refreshed/as-of information, and links to detailed dashboards. It is not a single page containing every detailed chart.
- **D-13:** Clicking a metric or chart segment opens the matching filtered records and preserves the originating date, programme, cohort, permission scope, and other applicable filters.
- **D-14:** Dashboards distinguish a genuine checked zero from unavailable data. Use `0` only when the query ran and no matching records exist; show `Not available yet` when the underlying capability or data collection is not operational.

### CSV export journey
- **D-15:** Staff request `Export CSV` from a dashboard using its current filters. A central Export History page shows all jobs the requester is permitted to see.
- **D-16:** Every export is an asynchronous background job, even when small enough to complete quickly. All jobs follow the same Queued → Processing → Succeeded/Failed → Expired lifecycle and are audited. — **Reversibility:** costly — the job/status contract becomes shared by all export producers and consumers.
- **D-17:** A successful CSV is downloadable for 24 hours. Job history remains after file expiry, and staff may rerun the export using the recorded configuration.
- **D-18:** Retry preserves the failed job and its safe error context, then creates a new linked attempt using the same dataset and frozen filter snapshot. It does not reset or overwrite the failed record.

### Reporting and trust rules
- **D-19:** Each dashboard date range uses the relevant business-event date and labels that basis explicitly: for example, confirmation date for payments, registration date for registrations, session date for attendance, and issue date for certificates.
- **D-20:** Filters and the `as of` timestamp are frozen when an export request is submitted. Background processing must reproduce that request-time dataset rather than including later changes. — **Reversibility:** costly — this determines export query and snapshot semantics across every dataset.
- **D-21:** CSVs use a stable, safe column set by default. Including a permitted sensitive field requires additional authorization, an explicit operational reason, and an audit record of the choice.
- **D-22:** Dashboards load when opened and refresh only through an explicit Refresh action. The interface shows last-refreshed and as-of times, and refresh preserves active filters.
- **D-23:** Carry forward the Phase 7 currency rule: NGN and USD totals remain separate. No dashboard, reconciliation total, or export invents an exchange rate or combines monetary totals across currencies.
- **D-24:** Dashboard totals, drill-down rows, and exports must use the same permission scope, filters, definitions, and as-of semantics so totals reconcile or expose an explicit timing explanation.

### the agent's Discretion
- Exact visual styling, chart types, responsive layout, pagination sizes, filter-control arrangement, and the technical threshold/batch size used by workers may follow established project patterns.
- The planner may define the initial controlled list of reconciliation risk and resolution categories, provided it preserves the priority and audit semantics above.

### Deferred Ideas (OUT OF SCOPE)

### Reviewed Todos (not folded)
- `2026-09-14-fix-07-review-manual-payment-race-and-idempotency.md` — reviewed and confirmed implemented in Phase 7; it adds no remaining Phase 8 work.
- `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` — unrelated Phase 4.1 UI hardening; remains outside the Finance/reporting phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAY-06 | Payment and refund reconciliation views and CSV exports are available; totals reconcile to transaction rows for the same filters; manual and gateway records are distinguishable; exports are permission-protected. | Durable case lifecycle, one scoped query contract, provider/currency partitions, immutable export snapshot. |
| PAY-12 | Provider, currency, base price, platform fee, estimated/actual gateway fee, learner total, school settlement, KQ NEXUS gross/net, transaction/reference, payment state, and safe exception context are exposed to authorized Finance/Operations users with provider-filtered reconciliation/export views. | Extend the existing payment projection and detail pattern; represent manual gateway fields as not applicable. |
| RPT-01 | Fixed operational dashboards exist for registrations, payments, enrolments, attendance, progress, submissions, grades, completion, certificates, and support; each states metric definition, filter context, last-refreshed time, and empty/error behavior. | Typed report registry with explicit operational availability and business-date semantics. |
| RPT-02 | The requesting user's permissions and scope apply to every dashboard, aggregate, drill-down, and export; out-of-scope data cannot be inferred through totals, filters, identifiers, downloads, or direct requests. | Collection-aware authorization builds Prisma predicates before querying and reauthorizes downloads. |
| RPT-03 | CSV export is provided for the defined operational datasets, with stable column definitions, applied filters, generation time, and a row-level reconciliation path. | Versioned dataset definitions shared by dashboards/drill-downs/exports plus a centralized CSV serializer. |
| RPT-04 | Large exports process asynchronously with queued, processing, succeeded, failed, expired, and retry states; users can leave the screen, see job state later, retry safely, and download only via time-limited authorized access. | Extend `ExportJob`, claim jobs safely, stream private uploads, expire objects after 24 hours, and preserve linked attempts. |
| RPT-05 | An authorized, filterable audit view and export exists for security and sensitive business actions; audit records are append-only, include correlation data, and redact secrets while preserving investigative value. | Reuse the global-only audit read boundary; define safe metadata columns and separately authorized evidence columns. |
</phase_requirements>

## Summary

Phase 8 should add two durable control planes rather than stretching the current payment and export records beyond their meanings: a reconciliation-case ledger for investigation lifecycle, and a typed reporting/export registry that owns dataset definitions, filters, scope rules, columns, and business dates. The existing payment settlement sweep is a strong evidence producer, but its single `exceptionNote` and one-time `reconciledAt` update cannot preserve assignment, resolution history, or reopening. [VERIFIED: `src/server/services/payment-reconciliation-service.ts:126-285`; `prisma/schema.prisma:1311-1362`]

The central trust invariant is structural: dashboard totals, drill-down rows, and request-time export snapshots must be produced by the same normalized dataset request and scope predicate. A timestamp alone cannot reproduce mutable request-time data later; persist the immutable row projection (or equivalent versioned facts) when the job is requested, then let the background processor only serialize that snapshot. [ASSUMED] This is the smallest design that directly satisfies D-20 without introducing full event-sourced reporting.

The project has no long-running worker script or pg-boss queue; recurring work is currently implemented as Netlify Scheduled Functions. [VERIFIED: `package.json:5-16`; `netlify/functions/reconcile-payments.ts:1-18`] Netlify Scheduled Functions are limited to 30 seconds, while Background Functions run asynchronously for up to 15 minutes and retry failures automatically. [CITED: https://docs.netlify.com/build/functions/configuration/#synchronous-function-limits] [CITED: https://docs.netlify.com/build/functions/background-functions/]

**Primary recommendation:** Plan a scoped reconciliation-case ledger, a single typed report registry, transactional immutable export snapshots, and an idempotent Netlify background export processor backed by the existing private S3-compatible storage.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reconciliation detection/lifecycle | API / Backend | Database | Services interpret payment/refund evidence; normalized case/event tables preserve lifecycle. |
| Scope-safe aggregates and drill-downs | API / Backend | Database | Authorization must become a database predicate before counts, rows, or filter values are selected. |
| Reports/reconciliation UI | Frontend Server (SSR) | Browser / Client | Server Components load trusted projections; client controls only navigation/filter state. |
| Export request/snapshot | API / Backend | Database | Server validates dataset/columns/reason and freezes request-time rows transactionally. |
| Export generation | API / Backend | Database / Storage | Background execution claims jobs, serializes immutable rows, and uploads private objects. |
| Authorized download | API / Backend | Storage | Route Handler rechecks current authorization before minting a short-lived signed URL. |
| Audit export | API / Backend | Database / Storage | Global audit permissions, redaction, frozen evidence, and private delivery remain server-side. |

## Project Constraints (from AGENTS.md)

- Treat the installed Next.js version as authoritative because its APIs and conventions may differ from training knowledge.
- Read the relevant local guide under `node_modules/next/dist/docs/` before implementing Next.js behavior.
- Heed deprecation notices.
- Do not remove the generated Next.js agent-rule block; `next dev` recreates it. [VERIFIED: `AGENTS.md:1-11`]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.3.4 | Staff pages, Server Actions, Route Handlers | Already pinned; keep finance reads server-side and treat actions/handlers as public endpoints requiring authorization. [VERIFIED: `package.json:31`; `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:76-93`] |
| React | 19.2.8 | Interactive filters/tables | Existing application UI runtime. [VERIFIED: `package.json:37-38`] |
| Prisma Client | 6.19.3 | Transactional persistence and scoped reporting queries | Existing DAL; parameterized raw SQL may be used only where safe queue claiming/insert-select cannot be expressed adequately. [VERIFIED: `package.json:19`; CITED: https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries] |
| Zod | 4.5.4 | Dataset/filter/column/reason validation | Existing validation library; Server Actions and Route Handlers must validate untrusted arguments. [VERIFIED: `package.json:42`; `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:76-93`] |
| AWS SDK S3 + presigner | 3.1125.0 | Private export object storage and signed GETs | Existing private-object and presigned-download integration. [VERIFIED: `package.json:17-18`; `src/server/services/storage-service.ts:1-119`] |
| Vitest | 4.1.11 | Node/jsdom unit, integration, and component tests | Existing multi-project test infrastructure. [VERIFIED: `package.json:51`; `vitest.config.ts:1-34`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@netlify/functions` | 6.0.0 | Scheduled dispatch/expiry and background generation entrypoints | Keep deploy-native jobs consistent with the existing reconciliation schedule. [VERIFIED: `package.json:45`; `netlify/functions/reconcile-payments.ts:1-18`] |
| `@aws-sdk/lib-storage` | 3.1125.0 | Managed streaming/multipart upload | Use for generated CSVs too large to buffer safely; official AWS utility supports streams and multipart concurrency. [CITED: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/] |
| PostgreSQL | 16 (Docker image) | Row snapshots, job ledger, transactional claiming | Existing datastore. `SKIP LOCKED` is appropriate for multiple consumers of a queue-like table. [VERIFIED: `docker-compose.yml:3-4`; CITED: https://www.postgresql.org/docs/16/sql-select.html] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Immutable row snapshot | Requery mutable tables using only `asOf` | Requerying cannot reconstruct values later edited or deleted; it does not satisfy D-20. |
| Netlify Background Function | Scheduled Function alone | Scheduled functions have a 30-second limit and are unsafe for genuinely large exports. [CITED: https://docs.netlify.com/build/functions/configuration/#synchronous-function-limits] |
| Managed multipart upload | Buffer entire CSV then `PutObject` | Simpler but memory grows with export size and contradicts the large-export requirement. |
| Centralized collection scope gate | Fetch globally and filter in memory | Leaks totals/filter identifiers and wastes memory; violates RPT-02. |

**Installation:**

```bash
npm install @aws-sdk/lib-storage@3.1125.0
```

Do not upgrade Next.js, Prisma, or the AWS SDK family as part of this phase; keep the change focused and keep AWS package versions aligned. [VERIFIED: `package.json:17-42`]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@aws-sdk/lib-storage` | npm | created 2020 | ~7.59M/week at research time | `github.com/aws/aws-sdk-js-v3` | SUS from automated seam (`too-new`, despite established metadata) | Flagged — planner must add a human verification checkpoint before installation |

Registry verification found version `3.1125.0` published 2026-09-02 and no `postinstall` script; the package is documented by AWS, but the mandatory legitimacy seam returned SUS, so its checkpoint cannot be waived. [VERIFIED: npm registry; CITED: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/]

**Packages removed due to SLOP verdict:** none.
**Packages flagged as suspicious [SUS]:** `@aws-sdk/lib-storage`.

## Architecture Patterns

### System Architecture Diagram

```text
Staff URL filters / Refresh
          |
          v
Server Component / Server Action / Route Handler
          |
          v
authenticate + permission + current grant scopes + Zod filters
          |
          v
Typed Dataset Registry ---- unavailable capability? ----> "Not available yet"
          | available
          v
Normalized Report Request (dataset + scope predicate + filters + asOf)
       /             |                         \
      v              v                          v
 aggregate       drill-down rows       transactional export request
                                            |
                                  ExportJob + immutable snapshot rows
                                            |
                              claim with locking / background function
                                            |
                              central CSV serializer -> private S3 object
                                            |
                              authorized download route -> signed GET

Provider/webhook/manual/refund evidence
          |
          v
reconciliation detector -> current case + append-only case events
          |
          v
scoped exception queue/detail -> assign/resolve/reopen + audit
```

### Recommended Project Structure

```text
src/server/services/
├── report-registry.ts              # fixed dataset contracts and availability
├── report-query-service.ts         # normalized scoped aggregate/row query
├── reconciliation-case-service.ts # case detection, assignment, resolution, reopen
├── export-service.ts               # request, retry, history, download authorization
├── export-worker-service.ts        # claim, serialize, upload, finish/fail
└── csv-service.ts                  # stable spreadsheet-safe serialization
src/server/scheduled/
├── process-export-jobs-task.ts
└── expire-export-jobs-task.ts
src/app/staff/
├── reports/                        # hub, fixed dataset pages, export history
└── reconciliation/                 # queue and case detail
netlify/functions/
├── process-export-jobs-background.ts
└── expire-export-jobs.ts
```

Paths above are recommendations, not verified existing paths. [ASSUMED]

### Pattern 1: One normalized report contract

Define each dataset once: identifier/version, group/label, availability, definition, business-date field/label, domain permission, scope relation, Zod filter schema, safe and sensitive columns, aggregate/query mapper, and drill-down URL builder. Dashboard totals and rows call this contract directly; export request materializes the same row projection. [ASSUMED]

This prevents three subtly different implementations of “payments in date range” and gives D-24 a testable seam. Money projections must stay in integer minor units and group by the exact currency values present rather than convert or sum across currencies. The existing Order and PaymentAttempt records already retain expected and actual fee/settlement components. [VERIFIED: `prisma/schema.prisma:1264-1362`]

### Pattern 2: Collection-aware authorization before query

Extend the centralized permission boundary with a collection read helper that authenticates, obtains active grants for the requested permission, converts trusted `GLOBAL`, `PROGRAMME`, `COURSE`, and `COHORT` grants into a Prisma predicate, and applies it to aggregates, rows, filter options, and export snapshots. The exact scope values are: `"GLOBAL" | "PROGRAMME" | "COURSE" | "COHORT"`. [VERIFIED: `src/server/auth/scope.ts:1-13`]

Do not call the current global payment list and filter its result: `payment-read-service` currently requests `payments.view` with an empty resource, which intentionally requires a global grant. [VERIFIED: `src/server/services/payment-read-service.ts:113-184`; `src/server/auth/with-permission.ts:42-93`] Build the new helper inside the same authorization layer and integration-test unions of multiple grants.

### Pattern 3: Case state plus append-only history

Add a normalized current case record for efficient queue reads and a child event ledger for opened, evidence-changed, assigned, resolved, and reopened transitions. Store a deterministic evidence fingerprint/version. When new materially contradictory evidence differs from the last resolved fingerprint, reopen the same case and append the cause; never erase the prior resolution. [ASSUMED]

The current settlement sweep only selects successful online attempts whose `reconciledAt` is null, so it will not detect later contradictory evidence after a completed reconciliation without an additional resync trigger/path. [VERIFIED: `src/server/services/payment-reconciliation-service.ts:126-148`] Resolution transactions must update only investigation records and audit evidence, never Order, PaymentAttempt, Refund, or Enrolment business state.

### Pattern 4: Immutable request-time export snapshot

In one transaction: authorize and normalize filters; establish `asOf`; query/materialize authorized row projections; create the queued job with dataset version, filter/scope/column snapshots and row count; then audit the request. The worker reads immutable snapshot rows, not live domain tables. [ASSUMED]

Extend `ExportJob` rather than replace it. Its current exact lifecycle type is `"QUEUED"`, `"PROCESSING"`, `"SUCCEEDED"`, `"FAILED"`, `"EXPIRED"`; its stored fields already include `dataset`, `filters`, `status`, `rowCount`, `storageKey`, `expiresAt`, `error`, `createdAt`, `completedAt`, and `downloadedAt`. [VERIFIED: `prisma/schema.prisma:198-204`; `prisma/schema.prisma:1504-1521`] Add dataset version, `asOf`, scope/column snapshots, sensitive reason, started time, linked retry relation, and safe structured failure data. A retry is a new `QUEUED` job linked to the failed job, not a new enum status.

### Pattern 5: Idempotent job claim and terminal writes

Claim oldest queued jobs with deterministic ordering and `FOR UPDATE SKIP LOCKED` in a short transaction, moving each to processing exactly once. PostgreSQL documents that `SKIP LOCKED` is appropriate for queue-like tables with multiple consumers. [CITED: https://www.postgresql.org/docs/16/sql-select.html] Parameterize any Prisma raw SQL and never interpolate user input. [CITED: https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries]

Automatic background retries require convergent behavior: conditional state transitions, a deterministic object destination/version, no duplicate completion audit event, and recovery of stale `PROCESSING` jobs. Netlify retries failed Background Functions after one and two minutes. [CITED: https://docs.netlify.com/build/functions/background-functions/]

### Pattern 6: Reauthorize every download

Store files under private unpredictable export keys, but do not treat the key as authorization. The download Route Handler must load the current actor, verify job visibility/ownership plus current dataset export and domain permissions/scope, reject expired or non-succeeded jobs, audit success, then redirect to a very short-lived signed GET with `private, no-store`. This mirrors the existing lesson download route and storage signing behavior. [VERIFIED: `src/app/api/staff/lessons/[lessonId]/download/route.ts:1-75`; `src/server/services/storage-service.ts:71-119`]

### Anti-Patterns to Avoid

- **Timestamp-only snapshots:** an `asOf` predicate cannot recover overwritten mutable values.
- **Separate dashboard/export SQL:** definitions drift and row totals stop reconciling.
- **Post-query scope filtering:** leaks aggregate counts, identifiers, filter options, and memory.
- **Using `exceptionNote` as workflow state:** it cannot retain assignment, standardized resolution, or reopen history.
- **Treating manual fee fields as zero:** present them as `Not applicable` per D-10.
- **Combining NGN and USD:** group and display/export independently; never invent FX.
- **Resetting a failed job on retry:** create a linked attempt and preserve safe failure context.
- **Long work inside Server Actions:** actions are request mutations and may execute sequentially per client; enqueue and return. [VERIFIED: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:76-93`]
- **Caching financial reads implicitly:** this project has not enabled `cacheComponents`; load on navigation and refresh explicitly. [VERIFIED: `next.config.ts:1-7`; `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md:31-73`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart/stream upload | Custom S3 part orchestration | `@aws-sdk/lib-storage` after legitimacy checkpoint | Handles streams, multipart concurrency, and part sizing. [CITED: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/] |
| Download cryptography | Custom signed tokens/URLs | Existing AWS SigV4 presigner | Existing private storage already centralizes expiry and response headers. |
| Ad hoc CSV escaping | String joins in each dataset | One tested CSV serializer | Quotes, delimiters, newlines, and spreadsheet formulas are cross-dataset risks. |
| Parallel consumer locking | In-memory mutex | PostgreSQL row locking and conditional transitions | Multiple deployed workers do not share process memory. |
| Scope checks in components | Hidden buttons/menus | Central server authorization + DB predicate | UI visibility is not access control. |
| Reporting snapshot from database backups | Custom point-in-time database restore | Transactional projection snapshot | Restore-level machinery is disproportionate to per-request exports. |

**Key insight:** Phase 8 is a data-trust phase; centralize definitions, authorization, serialization, and lifecycle transitions so every consumer inherits the same invariants.

## Common Pitfalls

### Pitfall 1: “As of” means query time, not reproducibility
**What goes wrong:** the worker runs later and includes edits that occurred after request.
**Why it happens:** only filters and a timestamp are frozen.
**How to avoid:** persist immutable request-time row projections (or equivalent immutable fact versions) before queuing.
**Warning signs:** rerunning the same job ID produces different CSV bytes or row counts.

### Pitfall 2: Scoped staff receive global aggregates
**What goes wrong:** rows are filtered but totals or filter options reveal other cohorts.
**Why it happens:** current list services often use an empty resource scope, which is global-only, while reports need collection unions.
**How to avoid:** translate active grants to a database predicate used by every query branch.
**Warning signs:** scoped totals differ from the sum of visible rows; out-of-scope programme names appear in selectors.

### Pitfall 3: Resolved exceptions never reopen
**What goes wrong:** later provider evidence contradicts a closed case but the one-time reconciliation sweep ignores it.
**Why it happens:** `reconciledAt` excludes the payment from future sweeps.
**How to avoid:** call evidence-to-case synchronization from webhook, reconciliation, refund, and manual confirmation paths; compare evidence fingerprints.
**Warning signs:** provider actuals change while case status/history does not.

### Pitfall 4: Background retry duplicates effects
**What goes wrong:** duplicate file writes, completion events, or attempts appear after platform retries.
**Why it happens:** success/failure transitions are unconditional.
**How to avoid:** conditional status updates, deterministic output identity, unique event/idempotency keys, and stale-claim recovery.
**Warning signs:** one job has multiple completion audits or object versions.

### Pitfall 5: Spreadsheet formula injection
**What goes wrong:** a cell beginning with `=`, `+`, `-`, or `@` executes as a spreadsheet formula when opened.
**Why it happens:** RFC-style quoting alone is not a universal spreadsheet mitigation.
**How to avoid:** centralize a documented spreadsheet-safe cell policy and test formula prefixes, separators, quotes, and line breaks. [CITED: https://owasp.org/www-community/attacks/CSV_Injection]
**Warning signs:** learner/provider text opens as a formula in Excel or Sheets.

### Pitfall 6: “Not implemented” appears as zero
**What goes wrong:** future-domain dashboards falsely claim no progress/submissions/certificates/support data.
**Why it happens:** schema table existence is mistaken for an operational data-producing capability.
**How to avoid:** use an explicit typed availability registry and expose `Not available yet` until the owning phase activates the dataset. [ASSUMED]
**Warning signs:** a dashboard says zero before its producing workflow has shipped.

### Pitfall 7: Private object URL becomes a bearer capability
**What goes wrong:** a copied/stale URL bypasses current scope or permission changes.
**Why it happens:** authorization happens only when the job is created.
**How to avoid:** reauthorize on each download, mint a short TTL only after success, and keep the response no-store.
**Warning signs:** a revoked user can still obtain a fresh URL.

## Code Examples

### Server Action boundary

```typescript
// Source: local Next.js 16 guide, node_modules/next/dist/docs/01-app/02-guides/server-actions.md
'use server'

export async function requestExport(input: unknown) {
  // Authenticate, authorize current scope, and validate input before mutation.
  // Persist the frozen request/snapshot and return the job identity promptly.
}
```

Next.js explicitly treats Server Actions as public HTTP endpoints and requires authentication, authorization, input validation, and safe return values. [VERIFIED: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:76-93`]

### Route Handler shape

```typescript
// Source: local Next.js 16 guide, node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params
  // Reauthorize job visibility and current scope, then redirect to signed GET.
}
```

Route Handlers are not cached by default and dynamic route `params` are promises in the installed guide. [VERIFIED: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:49-52`; `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:191-197`]

### Queue claim SQL concept

```sql
-- Source: PostgreSQL 16 SELECT locking documentation
SELECT id
FROM "ExportJob"
WHERE status = 'QUEUED'
ORDER BY "createdAt", id
FOR UPDATE SKIP LOCKED
LIMIT $1;
```

`"QUEUED"` is an exact project `JobStatus` value. [VERIFIED: `prisma/schema.prisma:198-204`] The executor must parameterize the limit/query through Prisma and transition claimed rows in the same transaction.

## State of the Art

| Old/Current Approach | Phase 8 Approach | Impact |
|----------------------|------------------|--------|
| Scheduled settlement sweep writes actuals and `exceptionNote` | Evidence synchronization opens/reopens normalized cases with history | Makes assignment, resolution, reopening, and audit durable. |
| Global payment list with client-side table filters | Collection-aware DB-scoped report/reconciliation queries | Supports scoped staff without inference leaks. |
| Synchronous small roster CSV | Uniform async job lifecycle and private object delivery | One predictable export UX, including large datasets. |
| Filters stored on `ExportJob`, worker could requery live state | Immutable request-time projection plus versioned dataset definition | Makes D-20 reproducible and D-24 testable. |
| Scheduled Function for short recurring sweep | Background Function for large generation; scheduled dispatch/expiry | Fits Netlify's 30-second scheduled and 15-minute background limits. |

**Deprecated/outdated for this phase:**
- A proposed `npm run worker`/pg-boss architecture does not match the live repository; no such script or dependency exists. [VERIFIED: `package.json:5-53`]
- Upgrading to latest Prisma 7 or latest Next 16 patch is not a Phase 8 requirement and would expand risk.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Persisting request-time row projections is acceptable storage overhead and can complete within the synchronous request budget for bounded export sizes. | Architecture Pattern 4 | Very large snapshots may require chunked snapshot capture rather than one request transaction. |
| A2 | A static operational-availability registry will remain the activation authority for later Phase 9–12 report datasets. | Pitfall 6 | Premature activation could display misleading zeros; delayed activation could hide valid data. |
| A3 | Sensitive learner identity columns should require the dataset permission plus matching `users.view`; no new permission key is needed. | Security / Open Questions | Product may require a dedicated sensitive-export permission. |
| A4 | Netlify Background Functions are the intended production execution environment for export generation. | Summary / Architecture | Another deployment target would need a different dispatcher while retaining the DB job contract. |

## Open Questions

1. **What maximum row count/size may be snapshotted synchronously?**
   - What we know: generation must always be async, and the request-time dataset must be exact.
   - What's unclear: the expected largest dataset and acceptable export-request latency.
   - Recommendation: plan a load-test checkpoint and a hard safe bound; if the bound is exceeded, snapshot in a database-side chunk protocol that keeps a fixed cutoff/version rather than silently requerying mutable rows.

2. **Which existing permission is the additional sensitive-column gate?**
   - What we know: `reports.view`, `reports.export`, `audit.view`, `audit.export`, and `users.view` exist. [VERIFIED: `src/server/auth/permissions/catalogue.ts:1-109`]
   - What's unclear: whether product policy accepts `users.view` or requires a new explicit permission.
   - Recommendation: use `users.view` with matching scope unless product owners explicitly add a dedicated permission; always require and audit the operational reason.

3. **How is a Background Function invoked in the deployed Netlify topology?**
   - What we know: Background Functions return 202 and may run 15 minutes; current project scheduled work is a Scheduled Function.
   - What's unclear: whether dispatch should be HTTP invocation from a scheduled dispatcher or another deploy hook.
   - Recommendation: keep DB `ExportJob` authoritative, add a thin scheduled dispatcher and deployment smoke test, and ensure invocation cannot accept arbitrary dataset instructions from the public network.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/tests/functions | ✓ | 24.6.0 | — |
| npm | Dependency/test commands | ✓ | 11.5.1 | — |
| Docker | PostgreSQL/MinIO integration tests | ✓ | 28.3.3 | Set required Compose environment first. |
| Docker Compose | Local services | ✓ | 2.39.2 | — |
| PostgreSQL container | Integration tests | Not confirmed in this shell | image 16-alpine | `docker compose` currently requires `POSTGRES_PASSWORD`; configure local test env. |
| S3-compatible storage | Export end-to-end | Configured in Compose, not direct shell | MinIO image from Compose | Run app through Compose or set the `.env.example` S3/MinIO values locally. |
| Netlify CLI | Local function emulation | ✗ | — | Unit/integration-test service/task wrappers; hosted preview is required for the final background-function smoke test. |

**Missing dependencies with no fallback:** none for planning/unit implementation; a deployed Netlify environment is required for the final production-like background execution smoke test.

**Missing dependencies with fallback:** direct-shell PostgreSQL/MinIO configuration and Netlify CLI, as described above.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11, node and jsdom projects; Testcontainers 12.1.0 for PostgreSQL integration |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/<target>.test.ts` |
| Full suite command | `npm test` |

Existing integration tests dynamically point Prisma at a Testcontainers PostgreSQL database before importing DB-dependent modules. [VERIFIED: `tests/payment-reconciliation.integration.test.ts:1-66`]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAY-06 | Filtered reconciliation totals equal rows; providers/manual distinct; scoped export | integration + component | `npx vitest run tests/reconciliation-case.integration.test.ts tests/components/ReconciliationWorkspace.test.tsx` | ❌ Wave 0 |
| PAY-12 | Finance projection exposes expected/actual/provider/currency fields and safe exception context | unit + integration | `npx vitest run tests/payment-report-service.test.ts tests/reconciliation-case.integration.test.ts` | ❌ Wave 0 |
| RPT-01 | Ten fixed definitions, availability, business dates, refresh/empty/error states | unit + component | `npx vitest run tests/report-registry.test.ts tests/components/Reports.test.tsx` | ❌ Wave 0 |
| RPT-02 | Scope applies to totals, rows, filters, identifiers, exports, direct download | integration + route | `npx vitest run tests/report-scope.integration.test.ts tests/export-download-route.test.ts` | ❌ Wave 0 |
| RPT-03 | Stable columns, filter metadata, generation time, row reconciliation, safe cells | unit + integration | `npx vitest run tests/csv-service.test.ts tests/export-service.integration.test.ts` | ❌ Wave 0 |
| RPT-04 | Claim/idempotency/retry/expiry/authorized short-lived download | integration + function | `npx vitest run tests/export-worker.integration.test.ts tests/netlify-export-functions.test.ts tests/export-download-route.test.ts` | ❌ Wave 0 |
| RPT-05 | Filtered append-only redacted audit export with correlation | unit + integration | `npx vitest run tests/audit-export-service.test.ts tests/audit-append-only.integration.test.ts` | partial; export test ❌ |

### Sampling Rate

- **Per task commit:** run the new targeted test file(s), generally under 30 seconds.
- **Per wave merge:** run all Phase 8 targeted tests plus existing payment reconciliation, permission/scope, audit, storage, and function-boundary tests.
- **Phase gate:** `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, PostgreSQL/MinIO integration tests, and deployed Background Function smoke test must pass.

### Wave 0 Gaps

- [ ] `tests/reconciliation-case-service.test.ts` and `tests/reconciliation-case.integration.test.ts` — lifecycle, history, reopen, assignment, resolution isolation.
- [ ] `tests/report-registry.test.ts` and `tests/report-scope.integration.test.ts` — fixed definitions, availability, scope unions, totals/rows/filter parity.
- [ ] `tests/csv-service.test.ts` — stable columns and spreadsheet-safe serialization.
- [ ] `tests/export-service.integration.test.ts` and `tests/export-worker.integration.test.ts` — immutable snapshot, claim races, retry lineage, expiry, idempotency.
- [ ] `tests/export-download-route.test.ts` — current authorization, expiry, ownership/scope, no-store redirect.
- [ ] `tests/audit-export-service.test.ts` — safe/sensitive columns, reason, redaction, correlation.
- [ ] `tests/netlify-export-functions.test.ts` — thin wrapper scheduling/background boundaries.
- [ ] `tests/components/ReconciliationWorkspace.test.tsx`, `tests/components/Reports.test.tsx`, and `tests/components/ExportHistory.test.tsx` — required states and interactions.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing session/current-actor resolution at every action, page service, and route. |
| V3 Session Management | yes | Recheck the current session and grants when requesting, retrying, resolving, assigning, and downloading. |
| V4 Access Control | yes | Central permission boundary plus database-level collection predicate; audit export remains global-only unless policy changes. |
| V5 Input Validation | yes | Zod-validate dataset IDs, filters, columns, case reason/note, sort/page, and job IDs; parameterize raw SQL. |
| V6 Cryptography | yes | Existing AWS SDK SigV4 presigning; never implement custom download signatures. |

The existing audit service intentionally calls `withPermission("audit.view", () => ({}))`, which requires a global grant through the current scope matcher. [VERIFIED: `src/server/services/audit-read-service.ts:50-104`; `src/server/auth/with-permission.ts:42-93`] Preserve that boundary for audit export by requiring both global `audit.view` and `audit.export`; do not accidentally widen audit data to resource scopes.

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Aggregate/filter-option inference | Information disclosure | Apply current grant predicate in SQL to totals, rows, filters, export snapshot, and history. |
| Export/download IDOR | Elevation / disclosure | Reauthorize job and current dataset scope on every direct request; return non-revealing denial. |
| Stale authorization | Elevation | Do not authorize only at job creation; recheck retry/history/download. |
| CSV formula injection | Tampering | Central spreadsheet-safe serializer and adversarial cell tests. [CITED: https://owasp.org/www-community/attacks/CSV_Injection] |
| Raw SQL injection | Tampering | Prisma tagged templates/parameters; never `$queryRawUnsafe` with user input. [CITED: https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries] |
| Duplicate/background replay | Tampering | Idempotent conditional transitions, row locking, deterministic evidence/output identity. |
| Sensitive error/evidence leakage | Information disclosure | Store safe failure codes for UI; server-only diagnostics; default safe columns, explicit reason and authorization for sensitive data. |
| Cross-currency false total | Integrity | Group NGN/USD independently in query, UI, and CSV. |

## Sources

### Primary (HIGH confidence)

- Live repository: Prisma schema, package manifest, auth/scope services, payment reconciliation/read services, audit service, storage/download route, Netlify functions, UIs, and tests cited inline.
- Installed Next.js 16.3.4 guides: Route Handlers, Server Actions, authentication, data fetching, and caching.
- [Netlify Background Functions](https://docs.netlify.com/build/functions/background-functions/) — execution, response, retry behavior.
- [Netlify Function Limits](https://docs.netlify.com/build/functions/configuration/#synchronous-function-limits) — scheduled/background duration limits.
- [PostgreSQL 16 SELECT](https://www.postgresql.org/docs/16/sql-select.html) — locking and `SKIP LOCKED` queue use.
- [Prisma v6 Raw Queries](https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries) — parameterized raw SQL and transactions.
- [AWS SDK v3 lib-storage](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/) — managed upload.
- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) — formula injection risk and mitigation caveats.

### Secondary (MEDIUM confidence)

- npm registry metadata for installed and proposed package versions, publication dates, downloads, repository, and scripts.

### Tertiary (LOW confidence)

- Assumptions listed explicitly in the Assumptions Log; no training-only package recommendation is presented as verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pinned versions and existing patterns were read from the live repository; proposed package has official AWS documentation and mandatory SUS checkpoint.
- Architecture: HIGH — grounded in current schema/services/auth/storage/functions plus locked D-01–D-24; request-time materialization capacity remains an explicit assumption.
- Pitfalls: HIGH — derived from observed one-time reconciliation, current global list boundary, async retry semantics, official security documentation, and locked trust rules.

**Research date:** 2026-09-15
**Valid until:** 2026-10-15 for repository architecture; recheck Netlify/AWS operational limits and package versions before installation/deployment.
