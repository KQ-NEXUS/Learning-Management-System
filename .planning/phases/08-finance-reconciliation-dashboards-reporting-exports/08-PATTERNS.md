# Phase 8: Finance Reconciliation, Dashboards & Reporting Exports - Pattern Map

**Mapped:** 2026-09-15
**Inputs:** `08-CONTEXT.md`, `08-RESEARCH.md`, approved `08-UI-SPEC.md`
**Live analogs:** Git-tracked application source only

This map names anticipated files, not a mandatory final decomposition. The planner may merge small modules, but it should preserve the boundaries below: authorization before querying, one report definition shared by dashboard/drill-down/export, append-only reconciliation history, immutable export snapshots, and request-time reauthorization for downloads.

## File Classification

| Anticipated new/modified file | Role | Data flow | Closest tracked analog | Match |
|---|---|---|---|---|
| `prisma/schema.prisma` + Phase 8 migration | model/migration | CRUD, event ledger, batch queue | existing `AuditEvent` and `ExportJob` models in `prisma/schema.prisma` | role-match |
| `src/server/permissions/collection-scope.ts` (or equivalent) | authorization utility | request-response, transform | `src/server/permissions/with-permission.ts`; `scope.ts` | partial |
| `src/server/services/reconciliation-case-service.ts` | service | CRUD, event-driven | `src/server/services/payment-reconciliation-service.ts` | strong role-match |
| `src/server/services/report-registry.ts` | registry/config | transform | no direct analog; use research contract | none |
| `src/server/services/report-query-service.ts` | service | request-response, batch/aggregate | `src/server/services/payment-read-service.ts` | strong role-match |
| `src/server/services/csv-service.ts` | utility | transform/streaming | no safe central CSV analog | none |
| `src/server/services/export-service.ts` | service | CRUD, snapshot, request-response | `src/server/services/audit-read-service.ts` plus payment action/service split | partial |
| `src/server/services/export-worker-service.ts` | system service | batch, file-I/O, event-driven | `src/server/services/payment-reconciliation-service.ts`; `storage-service.ts` | partial |
| `src/server/services/storage-service.ts` | storage provider | file-I/O | its existing presign/private-object functions | exact extension |
| `src/server/scheduled/process-export-jobs-task.ts` | scheduled task | batch | `src/server/scheduled/reconcile-payments-task.ts` | exact role-match |
| `src/server/scheduled/expire-export-jobs-task.ts` | scheduled task | batch | `src/server/scheduled/reconcile-payments-task.ts` | exact role-match |
| `netlify/functions/process-export-jobs-background.ts` | deployment adapter | event-driven | `netlify/functions/reconcile-payments.ts` | role-match |
| `netlify/functions/expire-export-jobs.ts` | deployment adapter | scheduled | `netlify/functions/reconcile-payments.ts` | exact role-match |
| `src/app/api/staff/reports/exports/[jobId]/download/route.ts` | route | request-response | `src/app/api/lesson-resources/[id]/download/route.ts` | exact role-match |
| `src/app/staff/reconciliation/page.tsx` | server page | request-response | `src/app/staff/audit/page.tsx`; `staff/payments/page.tsx` | strong role-match |
| `src/app/staff/reconciliation/[caseId]/page.tsx` | server page/detail | request-response | `src/app/staff/payments/[orderId]/page.tsx` | strong role-match |
| reconciliation queue/detail client components and `actions.ts` | component/action | request-response, CRUD | `PaymentsTable.tsx`; `staff/payments/actions.ts` | strong role-match |
| `src/app/staff/reports/page.tsx` | server page/hub | request-response | staff resource pages; UI-SPEC trust frame | partial |
| `src/app/staff/reports/[dataset]/page.tsx` | server page | request-response, aggregate | `src/app/staff/audit/page.tsx` | role-match |
| report filters/table/export-option components and `actions.ts` | component/action | request-response, CRUD | `AuditTable.tsx`; `PaymentsTable.tsx`; payment `actions.ts` | strong role-match |
| `src/app/staff/reports/exports/page.tsx` + history component/actions | server page/component/action | request-response, CRUD | `AuditTable.tsx`; `PaymentsTable.tsx`; payment `actions.ts` | strong role-match |
| `src/app/staff/audit/page.tsx` / `AuditTable.tsx` / audit export action | page/component/action | request-response, CRUD | same files' current filter/read pattern | exact extension |
| `src/app/staff/StaffShell.tsx` | navigation component | request-response | current navigation registry in same file | exact extension |
| Phase 8 unit/component/integration/route/function tests | tests | all above | `payment-reconciliation.integration.test.ts` and neighboring focused tests | strong role-match |

## Pattern Assignments

### Scoped report/reconciliation read services

**Apply to:** `collection-scope.ts`, `report-query-service.ts`, reconciliation queue/detail reads, export history/filter options.

**Primary analog:** `src/server/services/payment-read-service.ts`

Imports and structural dependency injection (`payment-read-service.ts:21-27`, `188-198`):

```ts
import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";

type WithPermission = ReturnType<typeof createWithPermission>;

export type PaymentReadServiceDeps = {
  order: { /* only the delegate methods this service needs */ };
  orderScope: (orderId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
};
```

Server-side projection and permission wrapper (`payment-read-service.ts:200-228`):

```ts
const listPaymentsForStaff = deps.withPermission<Record<string, never>>(
  "payments.view",
  () => ({}),
)(async (): Promise<PaymentListRow[]> => {
  const rows = await deps.order.findMany();
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    amountMinor: row.amountMinor,
    currency: row.currency,
  }));
});

const getPaymentDetailForStaff = deps.withPermission<string>(
  "payments.view",
  (orderId) => deps.orderScope(orderId),
)(async (orderId) => {
  const row = await deps.order.findUnique({ where: { id: orderId } });
  if (!row) return null;
  // return a deliberately shaped UI projection
});
```

Prisma binding kept at the bottom (`payment-read-service.ts:298-374`): define narrow `select` objects, build the testable factory with an injected client, then bind the live `prisma` and permission dependencies once.

**Critical deviation for Phase 8:** the empty resource scope in the current payment list intentionally requires a global grant. Phase 8 must not copy that global-only list behavior for scoped reports. Extend the same authorization layer to load active grants and translate their union into a Prisma predicate *before* running aggregates, rows, filter-option queries, or snapshots.

The existing choke point resolves scope from trusted database facts and exposes active grants (`with-permission.ts:103-155`):

```ts
const actor = await deps.getActor();
if (!actor) throw new AuthenticationError();
const resource = await resolveScope(input);
const grants: Grant[] = (await deps.loadGrants(actor.userId))
  .filter((grant) => isGrantActive(grant, now()))
  .map(({ permission: p, scopeType, scopeId }) => ({ permission: p, scopeType, scopeId }));
if (!hasPermission(grants, permission, resource)) {
  throw new AuthorizationError(permission);
}
return handler(input, { actor, resource, grants });
```

Scope semantics are already centralized (`scope.ts:62-90`): GLOBAL matches all; COHORT, PROGRAMME, and COURSE match only trusted ancestry. Preserve deny-by-default behavior for empty/malformed grants.

**Pitfalls:** never fetch globally then filter in memory; never expose out-of-scope programme/cohort names as filter options; never compute totals with a broader predicate than rows; never combine NGN and USD; never return raw Prisma rows to client code.

---

### Reconciliation case lifecycle and export worker state transitions

**Apply to:** reconciliation-case service, evidence synchronization hooks, export job claim/process/fail/expire logic.

**Primary analog:** `src/server/services/payment-reconciliation-service.ts`

Use a narrow injected dependency contract (`payment-reconciliation-service.ts:140-169`) and a live binding at the bottom (`373-392`). This makes provider/storage/network behavior replaceable in unit tests without weakening the production path.

Conditional idempotent write inside a transaction (`payment-reconciliation-service.ts:306-338`):

```ts
const applied = await deps.runInTransaction(async (tx) => {
  const result = await tx.paymentAttempt.updateMany({
    where: { id: attempt.id, reconciledAt: null },
    data: { /* actual evidence and timestamp */ },
  });
  if (result.count === 0) return false;

  await deps.writeEvent(tx, {
    type: hasVariance ? "payment.reconciliation_exception" : "payment.reconciled",
    payload: { paymentAttemptId: attempt.id, orderId: attempt.orderId },
  });
  return true;
});
```

Per-item failure isolation (`payment-reconciliation-service.ts:236-267`, `358-367`): process bounded work one record at a time; a failed external lookup leaves the record retryable and increments a safe failure count instead of poisoning the batch.

System audit occurs only after a winning conditional transition (`payment-reconciliation-service.ts:340-357`), avoiding duplicate audits/events in concurrent runs.

**Reconciliation-specific adaptation:** create a normalized current case plus append-only events for opened, evidence-changed, assigned, resolved, and reopened. Use an evidence fingerprint/version. Resolution transactions may update only investigation records and audit evidence—never Order, PaymentAttempt, Refund, or Enrolment. Contradictory evidence reopens the same case and preserves the earlier resolution.

**Export-worker adaptation:** claim oldest queued jobs deterministically in a short transaction (`FOR UPDATE SKIP LOCKED` through parameterized Prisma SQL if needed), conditionally transition to PROCESSING, serialize only immutable snapshot rows, use a deterministic object identity, and make terminal writes conditional. Platform retries must converge without duplicate objects, completion events, or audits. Include stale PROCESSING recovery.

**Model analogs:** existing `JobStatus` already has `QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `EXPIRED` (`schema.prisma:198-204`). Existing `ExportJob` stores requester, dataset, filters, status, row count, storage key, expiry, error, created/completed/downloaded times (`1504-1521`). Extend it; do not replace its lifecycle. `AuditEvent` (`420-443`) demonstrates append-only evidence fields and correlation indexes.

**Pitfalls:** do not reuse `PaymentAttempt.exceptionNote` as case workflow state; do not exclude previously reconciled evidence from resynchronization; retry creates a linked new ExportJob instead of resetting the failed row; request-time `asOf` plus filters alone cannot reproduce edited data—persist immutable row projections (or equivalent immutable facts).

---

### Report registry, query contract, and CSV serializer

**Apply to:** `report-registry.ts`, `report-query-service.ts`, `csv-service.ts`, export request/snapshot logic.

There is **no direct live analog** for a typed report registry or a centralized spreadsheet-safe CSV serializer. Use the architecture in `08-RESEARCH.md`, while retaining the service factory/binding shape above.

Each fixed registry entry should own one versioned definition:

```ts
type ReportDefinition = {
  id: ReportDataset;
  version: string;
  group: "ADMISSIONS_FINANCE" | "LEARNING_DELIVERY" | "OUTCOMES_SUPPORT";
  availability: "AVAILABLE" | "NOT_AVAILABLE_YET";
  permission: Permission;
  definition: string;
  businessDateLabel: string;
  filterSchema: ZodType;
  safeColumns: readonly ColumnDefinition[];
  sensitiveColumns: readonly ColumnDefinition[];
  // scoped aggregate/row/filter-option and drill-down mapping contracts
};
```

Registrations, payments, enrolments, and attendance are available in Phase 8. Progress, submissions, grades, completion, certificates, and support must be explicit `NOT_AVAILABLE_YET` entries until their producing phases activate authoritative data. A table existing in Prisma is not proof of operational availability.

The normalized request object—dataset/version, validated filters, scope predicate/snapshot, columns, timezone, and `asOf`—must be passed to aggregate, rows, drill-down URL, and export snapshot creation. This is the enforceable seam for D-24 parity.

CSV behavior must be centralized and tested: stable ordered headers, RFC-compatible quoting/newlines, UTF-8 policy, explicit generation/filter/as-of metadata, and spreadsheet formula-injection handling for cells beginning with `=`, `+`, `-`, or `@`. Never let each dataset build CSV with ad hoc `join(",")` calls.

**Pitfalls:** no chart/export-specific duplicate SQL; no cross-currency grand total; unknown/pending values stay null-labelled rather than zero; sensitive columns are absent by default and require current authorization, operational reason, and audit; background workers serialize snapshots rather than requery live domain tables.

---

### Staff list, filters, state rendering, and drill-down components

**Apply to:** reconciliation queue, report drill-downs, export history, audit export extension.

**Primary analogs:** `src/app/staff/payments/PaymentsTable.tsx` and `src/app/staff/audit/AuditTable.tsx`

Client boundary imports server types only (`PaymentsTable.tsx:1-13`):

```tsx
"use client";
import { ResourceTable, StatusPill, type Column, type SortState } from "@/components/primitives";
import type { PaymentListRow } from "@/server/services/payment-read-service";
```

Declarative, text-bearing columns (`PaymentsTable.tsx:63-116`) use mono/tabular money and identifiers, provider as plain text, and `StatusPill` only for actual state. The four provider options (`132-137`) naturally use the primitive's segmented treatment.

Explicit denied/ready/empty state construction (`PaymentsTable.tsx:187-207`):

```tsx
const state = denied
  ? ({ status: "denied", permission: denied.permission } as const)
  : visible.length > 0
    ? ({ status: "ready", rows: visible } as const)
    : ({ status: "empty", activeFilterCount, totalWithoutFilters: rows?.length } as const);

return <ResourceTable state={state} getRowHref={(r) => `/staff/payments/${r.id}`} />;
```

For Phase 8, filters must be URL-backed rather than the payment table's current local-only state. Copy the audit pattern (`AuditTable.tsx:132-156`):

```tsx
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const [isPending, startTransition] = useTransition();

function setParam(name: string, value: string) {
  const params = new URLSearchParams(searchParams.toString());
  value ? params.set(name, value) : params.delete(name);
  startTransition(() => {
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  });
}
```

Server page handling (`audit/page.tsx:14-60`) uses promised `searchParams` in Next.js 16, parses/validates inputs before reads, loads independent reads in `Promise.all`, returns non-revealing authentication/authorization UI, and rethrows unexpected errors.

Responsive parity (`AuditTable.tsx:292-425`): desktop semantic table above `sm`; semantic mobile card list below `sm`; both expose the same fields/evidence and wrap long identifiers. Loading uses `aria-busy`; expandable details use `aria-expanded`/`aria-controls`.

**UI-specific adaptations:**

- Reconciliation DOM order is unresolved queue, then separate-currency summaries, then full-ledger link. Bulk selection exposes assignment only—never bulk resolution.
- Report metrics are real links/buttons carrying normalized filters into matching rows; no inert chart-only data.
- Manual gateway-only values render the full `Not applicable`; online unknown actuals render pending; actual numeric zero remains `0`.
- `0` is shown only after an available query completed. Unavailable datasets render the approved neutral panel with no Refresh or Export action.
- Export history does not auto-poll. `Refresh status` preserves filters/focus and announces changed states politely.
- Long references, notes, large signed NGN/USD values, and failures wrap; no page-level horizontal scroll, including at 200% zoom.

**Pitfalls:** UI visibility is never authorization; client filtering must not be used to establish report scope or totals; denial copy must not confirm record existence; do not import a runtime Prisma-touching service into a client component; no chart library or shadcn introduction.

---

### Server Actions for assign/resolve/request/retry/rerun

**Apply to:** reconciliation and report/export `actions.ts` files.

**Analog:** `src/app/staff/payments/actions.ts`

Public action boundary (`actions.ts:1-20`, `47-83`):

```ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";

const schema = z.object({ /* identifiers and user-entered changes only */ }).strict();

export async function action(input: z.input<typeof schema>): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "One or more fields are missing or invalid." };
  // delegate to a service that reauthorizes from trusted rows
}
```

Expected domain/authentication failures are converted to narrow UI-safe discriminated results; unexpected errors are rethrown (`actions.ts:90-138`, `166-188`). Revalidate affected list and detail routes only after success (`38-41`, `102`).

Next.js 16 confirms Server Actions are public POST endpoints: authenticate, authorize, validate, and return only safe projections. Do not send ownership, scope, snapshot rows, or financial values from the browser when they can be reread from trusted state. Long export generation never runs inside the action; enqueue and return.

**Pitfalls:** resolution changes investigation records only; failed mutations retain form values/selection; sensitive export selection requires permitted columns plus a non-empty reason; retry preserves and links the failed job; rerun after expiry creates a new current-data snapshot, not a retry of the old immutable file.

---

### Private storage and authorized download route

**Apply to:** `storage-service.ts` export extensions and export download Route Handler.

**Analogs:** `src/server/services/storage-service.ts`; `src/app/api/lesson-resources/[id]/download/route.ts`

Storage remains environment-driven and request-agnostic (`storage-service.ts:33-63`). Build unpredictable export keys without raw filenames or user data, preserve private bucket configuration, and use AWS SDK presigning rather than custom tokens. Sanitize the response filename (`178-191`):

```ts
const safeName = (input.filename ?? "download").replace(/["\r\n]/g, "");
const command = new GetObjectCommand({
  Bucket: bucketName(),
  Key: input.key,
  ResponseContentDisposition: `attachment; filename="${safeName}"`,
  ResponseContentType: input.contentType ?? "application/octet-stream",
});
return getSignedUrl(presignClient, command, { expiresIn: configuredTtl });
```

Next.js 16 dynamic params are promises and are awaited (`download/route.ts:25-33`). After the service reauthorizes current actor, job visibility, dataset permission/scope, SUCCEEDED state, and 24-hour file expiry, redirect with no-store (`42-47`):

```ts
return new NextResponse(null, {
  status: 302,
  headers: { Location: url, "Cache-Control": "private, no-store" },
});
```

Map authentication, authorization, unavailable, and out-of-scope cases to the same non-revealing response (`route.ts:48-59`). The route must not reveal `storageKey` or a signed URL in page props/history APIs. Audit successful download authorization before returning the redirect.

**Pitfalls:** a signed URL is not the application's authorization boundary; always reauthorize on every download; do not mint a URL for expired/non-succeeded jobs; do not import request-scoped permissions into the low-level storage module.

---

### Scheduled/background adapters

**Apply to:** export process/expiry tasks and Netlify entrypoints.

**Analogs:** `src/server/scheduled/reconcile-payments-task.ts`; `netlify/functions/reconcile-payments.ts`

Keep orchestration testable and bounded (`reconcile-payments-task.ts:11-31`):

```ts
export const BATCH_SIZE = 25;
export function createTask(deps: { run: (limit: number) => Promise<Result>; log: (m: string) => void }) {
  return async function runTask(): Promise<void> {
    const result = await deps.run(BATCH_SIZE);
    deps.log(`[scheduled] processed ${result.processed}; ${result.failed} failed`);
  };
}
export const runTask = createTask({ run: runAsSystem, log: console.info });
```

Netlify wrapper remains thin and injectable (`netlify/functions/reconcile-payments.ts:1-10`):

```ts
import type { Config } from "@netlify/functions";
export function createHandler(run: () => Promise<void>) {
  return async function handler(): Promise<void> { await run(); };
}
export default createHandler(runTask);
```

Use a Netlify Background Function for actual file generation and a short scheduled dispatcher/expiry sweep. Database job state remains authoritative; public invocation must not accept arbitrary dataset/filter instructions. Do not invent the obsolete `npm run worker`/pg-boss pattern—the live repository has no such runtime.

**Package gate:** `@aws-sdk/lib-storage@3.1125.0` was marked SUS by the research legitimacy seam despite official AWS provenance. Any plan that installs it must include the required human verification checkpoint before installation.

## Shared Patterns

### Authorization and non-inference

- All pages, actions, route handlers, aggregates, filter options, snapshots, history, retry/rerun, and downloads cross a server permission boundary.
- `withPermission.ts:44-49` deliberately uses a non-enumerating authorization error. Preserve identical denial behavior whether or not a case/job/record exists.
- Audit export remains global-only unless policy changes: current `auditReadService` wraps both list and options with `audit.view` and empty scope (`audit-read-service.ts:127-183`). Require both `audit.view` and `audit.export`.
- Sensitive report columns additionally require the selected established permission (research recommends `users.view` with matching scope), explicit operational reason, and audit evidence.

### Audit and immutable history

- Business mutations audit useful domain detail; successful permission checks are not separately audited (`with-permission.ts:152-155`).
- Case events, failed export attempts, retry lineage, filter/column/scope snapshots, and expired job history remain preserved.
- Store safe UI failure codes/context separately from server diagnostics; never export stack traces, secrets, credentials, raw provider payloads, or storage keys.

### Money and trust semantics

- Keep amounts as integer minor units through queries and snapshots.
- Group by exact currency and provider; never create a cross-currency grand total.
- Expected, actual, pending/null, not-applicable, and genuine zero are distinct values.
- The server projection owns calculations and labels; components render them and never recalculate settlement.

### Error handling

- Known validation/auth/domain failures return stable safe UI results; unknown failures propagate to framework logging/error boundaries.
- Batch failures isolate one item and leave it retryable; terminal transitions are conditional and audited once.
- A failed page section never becomes zero and does not erase independently loaded sections.

### Testing

Use the real-Postgres Testcontainers pattern from `tests/payment-reconciliation.integration.test.ts:27-81`:

```ts
let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  ({ createService } = await import("@/server/services/service"));
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => { await testDb?.stop(); }, TEST_DB_TIMEOUT_MS);
afterEach(async () => {
  // delete in dependency-safe order
});
```

Dynamic import occurs only after `DATABASE_URL` targets the container so transitive Prisma singletons bind correctly. Inject all provider/storage network calls. Follow its factory dependency pattern (`159-181`) and assertions that forbidden domain rows stay byte-identical (`249-258`, `418-425`).

Phase 8 tests should cover concurrent case synchronization/reopening, resolution isolation, collection-scope unions and inference resistance, total/row/export parity, immutable snapshot replay, claim races/idempotency/stale recovery, retry lineage, CSV formula injection, current download authorization/expiry/no-store, audit redaction, mobile/desktop state parity, 200% zoom, and unusually large signed NGN/USD values.

## No Direct Analog Found

| File/capability | Reason | Planner guidance |
|---|---|---|
| `report-registry.ts` | No typed fixed-dataset registry exists | Follow `08-RESEARCH.md` Pattern 1 and make availability explicit/versioned. |
| `csv-service.ts` | No centralized spreadsheet-safe serializer exists | Centralize and adversarially test escaping and formula-prefix policy. |
| Immutable export snapshot rows | Current `ExportJob` stores filters but not frozen projections | Add normalized snapshot persistence; workers must not requery mutable domain tables. |
| Reconciliation case/event models | Current `exceptionNote` is evidence, not lifecycle/history | Add current case plus append-only child events and evidence fingerprint. |
| Collection-scope predicate helper | Existing list services are often global-only | Extend authorization using active grant unions before every query branch. |
| Streaming export upload | Existing storage service presigns lesson objects but does not stream generated CSV | Use official AWS managed upload only after the required package checkpoint, or a bounded existing SDK path proven by load test. |

## Implementation Pitfall Checklist

- [ ] No second payment state machine; cases observe evidence only.
- [ ] No resolution write touches Order, PaymentAttempt, Refund, or Enrolment.
- [ ] New contradictory evidence can reopen a resolved case.
- [ ] Aggregates, rows, filters, drill-down URLs, and snapshots share one normalized request and scope predicate.
- [ ] Snapshot rows are immutable at export request time.
- [ ] Retry creates a linked job; rerun creates a new request-time snapshot.
- [ ] Download rechecks current authorization and returns private/no-store redirect only after success.
- [ ] Safe CSV columns are stable/versioned; sensitive columns require permission, reason, and audit.
- [ ] NGN and USD never merge.
- [ ] Manual gateway-only values are `Not applicable`, not zero/pending.
- [ ] Unavailable datasets are not shown as zero.
- [ ] No automatic dashboard/history polling; explicit refresh preserves URL filters.
- [ ] No shadcn, new chart library, raw hex, or runtime server-service import in client bundles.
- [ ] No public function accepts arbitrary export instructions.
- [ ] Any `@aws-sdk/lib-storage` installation stops at the legitimacy checkpoint first.

## Metadata

**Analog search scope:** `src/server/services`, `src/server/permissions`, `src/app/staff`, `src/app/api`, `src/components/primitives`, `src/server/scheduled`, `netlify/functions`, `tests`, and `prisma/schema.prisma`.

**Strong analog families:** 5 (service projection/auth, transactional system processing, staff URL/state UI, private download, scheduled adapter).

**Tracked-source gate:** every named live analog was verified through `git ls-files`; ignored/runtime/plugin mirrors were not used.

**Next.js source of truth checked:** installed Next.js 16.3.4 Server Actions and Route Handlers guides. Dynamic route params are promises; actions remain public POST boundaries; handlers are uncached by default.

