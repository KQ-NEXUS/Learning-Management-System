# Phase 14: Software Licence & Deployment Control - Pattern Map

**Mapped:** 2026-10-01
**Files analyzed:** 40 new or modified (grouped below)
**Analogs found:** 36 / 40 (4 have no direct analog)
**Tracked-source gate:** every analog path below was read from the working tree; `git ls-files` confirmed tracking for the four load-bearing ones (`cleanup-notifications-task.ts`, `netlify/functions/cleanup-notifications.ts`, `with-permission.ts`, `tests/support/pg.ts`). No `.gsd/capabilities` mirrors are used.

## Next.js 16.3.4 guide references (AGENTS.md rule)

Read these under `node_modules/next/dist/docs/` before writing the matching file. Do not rely on training data.

| File | Guide |
|------|-------|
| `src/instrumentation.ts` | `01-app/03-api-reference/03-file-conventions/instrumentation.md`, `01-app/02-guides/instrumentation.md` |
| `src/app/staff/licence/actions.ts` (server actions, 1 MB body cap, return-value rules) | `01-app/02-guides/server-actions.md` |
| `src/app/api/staff/licence/diagnostic/route.ts` | `01-app/03-api-reference/03-file-conventions/route.md` |
| `src/app/staff/layout.tsx` (banner; layouts do not re-render on soft nav) | `01-app/03-api-reference/03-file-conventions/layout.md` |
| Do NOT gate via `proxy.ts` | `01-app/03-api-reference/03-file-conventions/proxy.md` (research: rejected) |
| Caching note (no `unstable_cache` for state) | `01-app/02-guides/self-hosting.md` |

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/server/licence/format.ts` | utility (pure) | transform | `src/server/communications/contracts.ts` (Prisma-free pure module) | role-match |
| `src/server/licence/verify.ts` | utility (pure) | transform | `src/server/permissions/scope.ts` (pure rules) | partial |
| `src/server/licence/trust-set.ts`, `state.ts`, `policy.ts`, `clock.ts` | utility/config | transform | `src/server/communications/contracts.ts` + `src/server/communications/notification-text.ts` | role-match |
| `src/server/services/licence-service.ts` | service | CRUD + CAS + audit-in-tx | `src/server/services/continuity-service.ts` (lock-then-read, audit in tx) | role-match |
| `src/server/services/licence-notice-service.ts` | service | event-driven | `src/server/services/domain-event-service.ts` | exact |
| `src/server/services/event-mappers/licence.ts` | mapper | event-driven | `src/server/services/event-mappers/staff.ts` | exact |
| `src/server/scheduled/check-licence-task.ts` | scheduled task | batch | `src/server/scheduled/cleanup-notifications-task.ts` | exact |
| `netlify/functions/check-licence.ts` | scheduled fn | batch | `netlify/functions/cleanup-notifications.ts` | exact |
| `src/instrumentation.ts` | startup hook | request-response | none (Next doc only) | none |
| `src/server/permissions/with-permission.ts` (modify) | middleware/choke point | request-response | itself | exact |
| `src/server/permissions/index.ts` (modify) | provider/wiring | request-response | itself | exact |
| `src/server/services/checkout-service.ts` (modify: guard) | service | CRUD | itself (`createCheckoutService(deps)` injected deps) | exact |
| `src/server/services/registration-service.ts` (modify: guard) | service | CRUD | `checkout-service.ts` | role-match |
| `src/server/services/checkout-webhook-system-service.ts` (modify: initiatedAt rule) | service (system) | event-driven | itself | exact |
| `src/server/services/email-delivery-log-service.ts` etc. (add `{licence:"continuity"}` tags) | service | CRUD | itself line 148 | exact |
| `src/server/services/domain-event-service.ts`, `communications/contracts.ts`, `notification-text.ts`, `communications/links.ts`, `email/templates/{registry,staff-templates}.ts`, `event-intent-mappers.ts` (modify: vocabularies) | contracts | event-driven | Phase 13 staff entries in same files | exact |
| `prisma/schema.prisma` + new migration | model/migration | CRUD | `prisma/migrations/20260927015627_communications_notifications/migration.sql` | exact |
| `src/app/staff/licence/page.tsx`, `loading.tsx` | page (RSC) | request-response | `src/app/staff/email-log/page.tsx` + `loading.tsx` | exact |
| `src/app/staff/licence/actions.ts` | server action | request-response | `src/app/staff/audit/actions.ts` | exact |
| `src/app/staff/licence/LicenceStatus.tsx`, `ActivateLicenceForm.tsx` | component | request-response | `src/app/staff/email-log/EmailLogTable.tsx` (DetailLayout), `src/app/staff/reconciliation/ReconciliationWorkspace.tsx` (form + ConfirmModal) | role-match |
| `src/app/api/staff/licence/diagnostic/route.ts` | route handler | request-response (download) | `src/app/api/notifications/unread/route.ts` | exact |
| `src/components/licence/{LicenceBanner,LicenceRefusalNote,LicenceRestrictionProvider}.tsx` | component | request-response | `src/components/notifications/NotificationBell.tsx` (shell slot) | role-match |
| `src/app/staff/layout.tsx`, `StaffShell.tsx` (modify: NAV, banner prop, icon) | layout | request-response | themselves (`bell` prop precedent) | exact |
| `ResourceForm`, `ConfirmModal` (modify: read licence context) | component | request-response | themselves | exact |
| `src/app/(checkout)/**/actions.ts`, `(auth)/register` (neutral refusal) | server action | request-response | existing `CheckoutNotice` style | role-match |
| `provider-tools/licence-issuer/{cli.ts,README.md,RUNBOOK.md}` | CLI | file-I/O | none in repo (use `tsx`, `node:util parseArgs`) | none |
| `.dockerignore` (modify) | config | n/a | itself | exact |
| `docs/deployment/netlify-scheduled-functions.md` (modify) | doc | n/a | itself | exact |
| PRD/PXR/REQUIREMENTS/ROADMAP/catalogue.ts comment edits | doc | n/a | amendment map in RESEARCH | exact |
| `tests/support/licence-fixtures.ts` | test support | transform | `tests/support/drain-harness.ts` | role-match |
| `tests/licence-{verify,format,state,clock,guard,wording,issuer,status-view}.test.ts` | test (unit) | transform | `tests/with-permission.test.ts`, `tests/cleanup-notifications-task.test.ts` | role-match |
| `tests/check-licence-task.test.ts`, `tests/netlify-check-licence.test.ts` | test | batch | `tests/cleanup-notifications-task.test.ts`, `tests/netlify-cleanup-notifications.test.ts` | exact |
| `tests/boundary.test.ts` (modify), `tests/licence-enforcement-boundary.test.ts` | test (static) | transform | `tests/boundary.test.ts` + `tests/import-graph.ts` | exact / role-match |
| `tests/event-mappers-licence.test.ts`, `tests/licence-drain.integration.test.ts` | test | event-driven | `tests/event-mappers-staff.test.ts`, `tests/staff-drain.integration.test.ts` | exact |
| `tests/licence-{activation,restricted,payments,audit}.integration.test.ts` | test (integration) | CRUD | `tests/staff-drain.integration.test.ts` + `tests/support/pg.ts` | exact |
| `tests/components/licence-status.test.tsx` | test (component) | request-response | existing `tests/components/*` | role-match |
| `tests/staff-layout-nav.test.ts`, `communications-contracts`, `notification-text`, `email-templates`, `event-intent-mappers` tests (modify) | test | n/a | themselves | exact |

## Pattern Assignments

### `src/server/scheduled/check-licence-task.ts` (scheduled task, batch)

**Analog:** `src/server/scheduled/cleanup-notifications-task.ts` (lines 1-45)

Header comment records the closure rule; imports ONLY a service (never `next/headers`, `@/server/permissions*`, `getCurrentActor`):
```typescript
import { notificationService } from "@/server/services/notification-service";
export type CleanupNotificationsTaskDeps = {
  archiveReadOlderThan: (cutoff: Date, limit: number) => Promise<number>;
  log: (message: string) => void;
  now?: () => Date;
};
export function createCleanupNotificationsTask(deps: CleanupNotificationsTaskDeps) {
  const now = deps.now ?? (() => new Date());
  return async function runCleanupNotificationsTask(): Promise<void> { /* ... deps.log(`[scheduled] ...`) */ };
}
export const runCleanupNotificationsTask = createCleanupNotificationsTask({
  archiveReadOlderThan: notificationService.archiveReadOlderThan,
  log: (message) => console.info(message),
});
```
Apply: `createCheckLicenceTask({ evaluateAndRecord, emitNotices, log, now })`, wired singleton `runCheckLicenceTask` over `licence-service` and `licence-notice-service`. Log lines carry state code only, never licence text. A thrown DB error propagates (tested at line 42-51 of the task test).

### `netlify/functions/check-licence.ts` (scheduled fn)

**Analog:** `netlify/functions/cleanup-notifications.ts` (lines 1-14). Copy verbatim; relative import of the task (not `@/`), `createCheckLicenceHandler(run)`, default export, `config: Config = { schedule: "0 * * * *" }`. Add a section to `docs/deployment/netlify-scheduled-functions.md`.

### `src/server/permissions/with-permission.ts` (modify: licence guard, D-09)

**Analog:** itself. Insertion point is between the `hasPermission` check (lines 139-150) and `return handler(...)` (line 155). Existing shape to extend:
```typescript
export function createWithPermission(deps: WithPermissionDeps) {
  const now = deps.now ?? (() => new Date());
  return function withPermission<TInput>(permission: Permission, resolveScope: ScopeResolver<TInput>) {
    return function wrap<TOutput>(handler: Handler<TInput, TOutput>) {
      return async function authorized(input: TInput): Promise<TOutput> {
        ...
        if (!hasPermission(grants, permission, resource)) { await deps.audit({...}); throw new AuthorizationError(permission); }
        return handler(input, { actor, resource, grants });
```
Rules to copy from the file's own conventions:
- Add `licence?: LicenceGuardDep` to `WithPermissionDeps` (line 72-80) so the file stays framework-free and the `now?` injection style is preserved.
- Add optional third arg `options?: { licence?: LicenceEffect; reason?: string }` to `withPermission(...)`.
- Define `LicenceRestrictedError extends AuthorizationError` next to `AuthorizationError` (lines 40-50): fixed non-sensitive message, `.name = "LicenceRestrictedError"`. Extending keeps the ~79 existing `instanceof AuthorizationError` catches returning results.
- Guard runs strictly after the denial branch (no state oracle), only when `effect === "write"`.
- Live binding goes in `src/server/permissions/index.ts` lines 17-21 (`createWithPermission({ getActor, loadGrants, audit })`) as a fourth dep `licence: licenceGuard`; also re-export `LicenceRestrictedError` next to line 64.

**Test analog:** `tests/with-permission.test.ts` lines 1-42: `harness({grants, actor})` builds `createWithPermission({ getActor, loadGrants, audit, now: () => NOW })` with fakes. Add a `licence` fake and cases: write blocked, continuity allowed, read untouched, unauthorized caller gets identical `AuthorizationError` in ACTIVE and RESTRICTED.

### `src/server/services/licence-notice-service.ts` (service, event-driven)

**Analog:** `src/server/services/domain-event-service.ts` lines 124-164. Existing `writeDomainEvent(tx, event)` uses `tx.domainEvent.create`; `buildDomainEventRow` runs `redactForAudit` on payload. The research requires deterministic ids with `createMany({ skipDuplicates: true })`, so add a sibling `writeDomainEventOnce` here (structural `DomainEventTxClient` type extended with `createMany`) rather than hand-rolling in the licence service:
```typescript
export async function writeDomainEvent(tx: DomainEventTxClient, event: DomainEventInput): Promise<void> {
  await tx.domainEvent.create({ data: buildDomainEventRow(event) });
}
```
Also: add `"licence.notice"` to the `DomainEventType` union (line 31) and `DOMAIN_EVENT_TYPE_SET` in `contracts.ts`. Id: `licence:${licenceId}:${noticeKey}`.

### `src/server/services/event-mappers/licence.ts` (mapper)

**Analog:** `src/server/services/event-mappers/staff.ts` lines 15-24 (imports), 69-90 (`ticketCreatedStaffAlert`), 320-329 (`createStaffMappers`):
```typescript
import { requireString, type EventMapper, type MapperGroup } from "@/server/services/event-intent-mappers";
import { buildCorrelationId } from "@/server/communications/contracts";
import { resolveStaffHolders } from "@/server/services/staff-recipient-service";
const m: EventMapper = async (event, ctx) => {
  const holderIds = await resolveStaffHolders(ctx.tx, { permission: "tickets.manage", scope: {} });
  return holderIds.map((holderId) => ({
    recipientUserId: holderId,
    email: { template: "...", params: {...}, correlationId: buildCorrelationId(event.id, holderId) },
    notification: { type: "staff.x" as const, targetType: "STAFF_X" as const, targetId, params: {...} },
  }));
};
export function createStaffMappers(): MapperGroup { return { "ticket.created": m }; }
```
Apply with `permission: "licence.view"`, `scope: {}`, `createLicenceMappers()` appended to `EVENT_MAPPER_GROUPS`. Copy the fixed allow-list idea from `ORDER_EXCEPTION_REASON_LABELS` (lines 38-57): map `noticeKey`/reason code to fixed labels, unknown code to a generic label, never read free text (T-13-03). Email on some notices, notification on all, per UI-SPEC notice table. Import rule: `staff-recipient-service` imports TYPES only from permissions; keep it that way.

**Test analogs:** `tests/event-mappers-staff.test.ts`, `tests/staff-drain.integration.test.ts` (uses `startDrainHarness`, `seedStaffUser`, `writeEvent` from `tests/support/drain-harness.ts`). Update exact-list tests: `communications-contracts`, `notification-text`, `email-templates`, `event-intent-mappers`.

### `src/server/services/licence-service.ts` (service, CRUD + CAS)

**Analog:** `src/server/services/continuity-service.ts` (header lines 14-18: transaction-scoped advisory lock before reading current state); audit pattern from `audit-service.ts`:
```typescript
export async function recordAudit(event: BusinessAuditEvent): Promise<void> { await prisma.auditEvent.create({ data: buildAuditRow(event) }); }
export async function recordAuditInTransaction(tx: Pick<Prisma.TransactionClient, "auditEvent">, event: BusinessAuditEvent): Promise<void> {...}
```
`BusinessAuditEvent` fields (lines 21-41): `actorId`, `actorType?: "SYSTEM"`, `action`, `targetType`, `targetId`, `before`, `after`, `reason`, `outcome`, `correlationId`. Use `actorType: "SYSTEM"` for task/startup rows; `targetType: "LICENCE"`, `targetId: licenceId`; actions `licence.activated|activation_rejected|state_changed|restriction_enforced|diagnostic_downloaded|verified`. Only the CAS winner audits (`recordAuditInTransaction`). `tests/audit-append-only.test.ts` enforces a single audit creator, so never call `prisma.auditEvent.create` directly. Only `src/server/services/**` may import `@prisma/client` (ESLint). This file is reachable from webhooks and the Netlify closure, so it must not import `next/headers`, `@/server/permissions*` or `getCurrentActor`; the actor comes in as an argument, as `startCheckout(actor: Actor, ...)` does.

### Prisma models and migration

**Analog:** `prisma/migrations/20260927015627_communications_notifications/migration.sql` (CHECK constraints such as `EmailDispatch_status_check` pasted into the migration itself). Follow Pattern 3 in RESEARCH. Put CHECKs and the singleton seed `INSERT` in the migration, not `prisma/sql`. Create with `prisma migrate dev --create-only`; never `--accept-data-loss`. Test DB path `tests/support/pg.ts` lines 105-130 runs real `prisma migrate deploy` against `postgres:16-alpine`, so the seed row appears in every integration test automatically. Note `applyMissingIntegritySql` only reads the first constraint name of a `prisma/sql` companion (do not rely on companions).

### `src/app/staff/licence/page.tsx` + `loading.tsx` (RSC page)

**Analog:** `src/app/staff/email-log/page.tsx` lines 1-60. Pattern: `export const metadata = { title: "..." }`; `try { service call } catch`; `AuthenticationError` returns a session-ended paragraph (or `SessionEnded` from `@/components/shell/SessionEnded`, as `audit/page.tsx` does); `AuthorizationError` renders the table/layout with `denied={{ permission: "licence.view" }}` (same response whether or not data exists); other errors render `error={{ message: "..." }}` with the UI-SPEC load-error copy. Compute `canActivate = await can("licence.activate", {})` and `canViewReports = await can("reports.view", {})` for the rail (like `canManageUsers`). Use `DetailLayout mode="stacked"` (examples: `src/app/staff/certificates/issued/[id]/page.tsx`).

### `src/app/staff/licence/actions.ts` (server actions)

**Analog:** `src/app/staff/audit/actions.ts` lines 1-40:
```typescript
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
const requestSchema = z.object({...}).strict();
export type XActionResult = { ok: true; ... } | { ok: false; message: string };
export async function xAction(input: unknown): Promise<XActionResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "..." };
  try { ...; revalidatePath("/staff/...", "page"); return { ok: true, ... }; }
  catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) return { ok: false, message: "..." };
    console.error("... failed", error);
    return { ok: false, message: "..." };
  }
}
```
Apply: `inspectLicenceAction` (verify, no persistence) and `activateLicenceAction` (re-verify, `revalidatePath("/staff", "layout")`). Strict zod, ASCII allow-list, 8 KiB cap, closed rejection-code set mapped to the UI-SPEC sentences. Important divergence: check `LicenceRestrictedError` BEFORE the generic `AuthorizationError` branch (it subclasses it) and use the shared `refusalMessage` helper, never the "not authorised" text. The activation call itself is tagged continuity so it works when restricted.

### `src/app/api/staff/licence/diagnostic/route.ts` (route handler)

**Analog:** `src/app/api/notifications/unread/route.ts` lines 1-26: `const NO_STORE = { "Cache-Control": "private, no-store" } as const;`, no `dynamic`/`revalidate` export, `NextResponse.json(..., { status, headers: NO_STORE })` including the 401. Apply: GET only, authorize through `withPermission("licence.view", () => ({}))` (read effect), add `Content-Disposition: attachment; filename="licence-diagnostic-{id|not-activated}-{YYYYMMDD}.json"`, audit `licence.diagnostic_downloaded`, allow-listed fields only.

### `src/app/staff/layout.tsx` and `StaffShell.tsx` (modify)

**Analog:** themselves.
- `layout.tsx` line 23-38: add `{ label: "Licence", href: "/staff/licence", group: "Administration" }`; line 41-57: add `"/staff/licence": "licence.view"` to `NAV_PERMISSION`.
- Lines 95-106: bell precedent. Compute banner inside a try/catch that falls back to no banner (a DB blip must not remove chrome), only for `can("licence.view", {})`; pass `banner={...}` into `<StaffShell ... bell={bell}>` (line 123).
- `StaffShell.tsx`: add `banner?: ReactNode` next to `bell?` (line 73-74), icon `KeyRound` in `NAV_ICONS` (line 41), render the strip between `<header>` (line 296) and `<main>` (line 333) without touching `main`. Provide the licence-restriction context here.
- Test: `tests/staff-layout-nav.test.ts` mocks `@/server/permissions` (`can`, `canAnywhere`), `StaffShell`, `NotificationBell`, `notification-service`; the new layout imports (licence service) must be mocked the same way.

### Checkout / registration guards (modify)

**Analog:** `src/server/services/checkout-service.ts`: `createCheckoutService(deps)` at line 426 with `now` injected; `startCheckout(actor, cohortId, currency)` line 438, `initiateStripePayment` line 795, `initiatePaystackPayment` line 873. Add `licence?: { assertWriteAllowed(): Promise<void> }` to `CheckoutServiceDeps` (line 310), call it first in those three functions, bind the real one in `createPrismaBackedCheckoutService` (line 994). Throw a distinct error mapped by `(checkout)/actions.ts` to the neutral learner copy. Do not guard `retireOpenPaymentAttempts`.

### `checkout-webhook-system-service.ts` (modify: D-08 initiated-before rule)

**Analog:** itself (header lines 1-60: WEBHOOK-ONLY settlement, guarded by PaymentAttempt status). `PaymentAttempt.initiatedAt` exists (`@default(now())`). Compare to `LicenceState.restrictedAt` with 10-minute tolerance; a failing comparison goes through the existing `order.exception` path with a new coded reason (add to `ORDER_EXCEPTION_REASON_LABELS` in `event-mappers/staff.ts`). Stripe/Paystack routes under `src/app/api/webhooks/{stripe,paystack}/route.ts` stay outside the write guard; their closures are scanned by `boundary.test.ts` (`webhookRuntimeClosure`, `paystackWebhookRuntimeClosure`, lines 45-65), so the service must keep importing nothing request-only (licence reads via `licence-service` only).

### Exports (audit-export / export-service)

No code change beyond classification; they authorise via `getCurrentActor` + own checks, not `withPermission`, so they are registry-class `continuity`. Add the `licence.*` export audit only if licence data becomes an export subject (diagnostic download covers LIC-06).

### `tests/licence-enforcement-boundary.test.ts` (static)

**Analog:** `tests/boundary.test.ts` + `tests/import-graph.ts` (`runtimeImports`, `runtimeClosureFrom`, TypeScript compiler API). Copy the helper style (`readdirSync` + closure) and add the AST walk from RESEARCH "Registry-driven boundary test". Registry constant `LICENCE_SERVICE_REGISTRY` lives in `src/server/licence/policy.ts` (the UI works/blocked lists render from it).

**Modify `tests/boundary.test.ts`**: append, mirroring lines 319-331, a case:
```typescript
const closure = runtimeClosureFrom([path.resolve(process.cwd(), "netlify/functions/check-licence.ts")]);
expect(findRequestOnlyOffenders(closure)).toEqual([]);
expect(closure.map((f) => f.replace(/\\/g, "/")).some((f) => f.endsWith("src/server/services/licence-service.ts"))).toBe(true);
```
plus `expect(await lintAs("src/server/licence/format.ts")).toHaveLength(1)` (pure modules reject Prisma, same as line 311-313). `workerRuntimeClosure()` (lines 26-35) picks up the new function automatically.

### `tests/check-licence-task.test.ts`, `tests/netlify-check-licence.test.ts`

**Analogs:** `tests/cleanup-notifications-task.test.ts` (fixed `now`, `vi.fn` deps, assert single call + log message + rejects on DB failure) and `tests/netlify-cleanup-notifications.test.ts` (`config.schedule` string, `createXHandler(run)` calls `run` once). Copy both shapes directly.

### Integration tests (`tests/licence-*.integration.test.ts`)

**Analog:** `tests/staff-drain.integration.test.ts` lines 1-50 and `tests/support/pg.ts` lines 105-130:
```typescript
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
let testDb: TestDatabase;
beforeAll(async () => { testDb = await startTestDatabase(); }, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await testDb?.stop(); }, TEST_DB_TIMEOUT_MS);
afterEach(async () => { await testDb.prisma.<model>.deleteMany(); ... });   // FK-safe order; scope users by email suffix
```
Use unique references (`KQO-...-${Date.now()}-${n}`), and `startDrainHarness(db)` from `tests/support/drain-harness.ts` for the licence notice drain test. File header documents the Docker prerequisite (BLOCKED, never a silent pass); copy it. Remember to clean the new `LicenceState`/`LicenceRecord` rows between tests but keep the seeded singleton `DeploymentIdentity` row (reset `LicenceState` to defaults instead of deleting the singletons).

### `tests/support/licence-fixtures.ts`

**Analog:** `tests/support/drain-harness.ts` (exported helpers `seedStaffUser`, `writeEvent`, header comment explaining env set in harness not in tests). Provide throwaway Ed25519 keypair, `mintLicence(overrides)` built from the same `format.ts` the CLI uses, fixed-clock helpers, trust-set injection. Golden vectors in `tests/fixtures/licence/v1/*.lic`.

### UI components (`LicenceStatus`, `ActivateLicenceForm`, `LicenceBanner`, `LicenceRefusalNote`)

**Analogs:** `src/app/staff/email-log/EmailLogTable.tsx` (DetailLayout with `denied`/`error` props), `src/app/staff/reconciliation/ReconciliationWorkspace.tsx` (action + ConfirmModal), `NotificationBell` (shell slot). Primitives from `@/components/primitives` and `@/components/primitives/controls` (BTN, BTN_PRIMARY, FIELD, TEXTAREA, NOTE*, SECTION_TITLE). No new tokens or CSS (UI-SPEC). Date formatting via pure `Intl.DateTimeFormat` with explicit `timeZone`, `en-GB`; fallback `Africa/Lagos` (`APP_TIMEZONE` in `notification-text.ts` line 31). All copy from `policy.ts` constants; `RESTRICTED_CONTINUITY_LABEL` is the single phrase owner.

## Shared Patterns

### Choke-point denial ordering
**Source:** `with-permission.ts` lines 112-155. **Apply to:** every licence guard. Authenticate, resolve scope, check grants, deny identically, only then evaluate licence state.

### Closure rule (actorless runtimes)
**Source:** `tests/boundary.test.ts` lines 26-65, 319-331. **Apply to:** `licence-service`, `licence-notice-service`, `check-licence-task`, `netlify/functions/check-licence.ts`, webhook settlement. No `next/headers`, `@/server/permissions*`, `getCurrentActor`. Pure licence modules also Prisma-free.

### Injected-deps factory
**Source:** `cleanup-notifications-task.ts` lines 23-44; `createCheckoutService(deps)`; `createWithPermission(deps)`. **Apply to:** all new services: `createLicenceService(deps)` with `now` injected, singleton wired at bottom.

### Audit-first, redacting, append-only sink
**Source:** `audit-service.ts` lines 21-41, 101-111. **Apply to:** all `licence.*` events; safe context only; correlation id; `actorType: "SYSTEM"` for tasks.

### Result-object action errors
**Source:** `src/app/staff/audit/actions.ts` lines 12-40. **Apply to:** licence actions; add `LicenceRestrictedError` branch ahead of the `AuthorizationError` branch in every staff action catch (~79 files catch it today).

### No-store session-scoped responses
**Source:** `src/app/api/notifications/unread/route.ts` line 12. **Apply to:** diagnostic route and any banner status poll.

### Denial parity in pages
**Source:** `email-log/page.tsx` lines 41-48. **Apply to:** licence page; same denied response regardless of state.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/instrumentation.ts` | startup hook | request-response | No instrumentation file exists; follow the Next 16.3.4 guide (`NEXT_RUNTIME === 'nodejs'`, dynamic import, try/catch, ~3 s timeout) |
| `src/server/licence/verify.ts` (Ed25519) | pure crypto | transform | No crypto-verification code exists; use RESEARCH Code Examples (`node:crypto`, `createPublicKey` JWK, `verify(null, ...)`) |
| `provider-tools/licence-issuer/cli.ts` | CLI | file-I/O | No CLI in repo; `tsx` + `node:util parseArgs`, imports the same `format.ts` |
| `tests/licence-enforcement-boundary.test.ts` registry walk | static test | transform | Only partial analog (`import-graph.ts` AST helper); the service-file write scan is new |

## Metadata

**Analog search scope:** `src/server/{permissions,scheduled,services,services/event-mappers,communications}`, `netlify/functions`, `src/app/staff`, `src/app/api`, `src/app/(checkout)`, `tests`, `tests/support`, `prisma/migrations`.
**Files read:** about 22 (plus CONTEXT, RESEARCH, UI-SPEC). Project conventions in `.planning/codebase/{ARCHITECTURE,CONVENTIONS,STRUCTURE,TESTING}.md` were not re-read; RESEARCH already distils them (kebab-case files, `*.test.ts` under `tests/`, `createXService(deps)`, `@/` imports, `{ok}` results).
**Pattern extraction date:** 2026-10-01
