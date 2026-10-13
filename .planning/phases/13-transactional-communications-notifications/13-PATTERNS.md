# Phase 13: Transactional Communications & Notifications - Pattern Map

**Mapped:** 2026-09-27
**Files analyzed:** 20
**Analogs found:** 18 / 20
All analog paths verified git-tracked.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/server/scheduled/drain-domain-events-task.ts` | scheduled task | batch | `src/server/scheduled/release-expired-holds-task.ts` | exact |
| `src/server/scheduled/cleanup-notifications-task.ts` | scheduled task | batch | same | exact |
| `netlify/functions/drain-domain-events.ts`, `cleanup-notifications.ts` | wrapper | batch | `netlify/functions/release-expired-holds.ts` | exact |
| `src/server/services/domain-event-drain-service.ts` | service | batch/event-driven | `export-worker-service.ts` (claimQueued) + `hold-release-system-service.ts` (per-row tx, SYSTEM audit) | role-match |
| `src/server/services/event-intent-mappers.ts` | utility | transform | none (pure exhaustive Record over `DomainEventType`) | no analog |
| `src/server/services/email-dispatch-service.ts` (modify) | service | CRUD | itself (injectable store pattern) | exact |
| `src/server/email/brevo-client.ts` (modify) | transport | request-response | itself | exact |
| `src/server/email/sender.ts`, `templates/layout.ts`, `templates/registry.ts` | config/utility | transform | `brevo-client.ts` (env sender) | partial |
| `src/server/services/notification-service.ts`, `notification-access-service.ts` | service | CRUD | `audit-read-service.ts` (deps-injected `withPermission`) | role-match |
| `src/app/api/notifications/unread/route.ts` (poll) | route | request-response | `src/app/api/certificates/[id]/download/route.ts` | role-match |
| `src/app/staff/email-log/page.tsx` + `actions.ts` | page + actions | CRUD | `src/app/staff/audit/page.tsx`, `audit/actions.ts` | exact |
| `src/app/staff/layout.tsx`, `StaffShell.tsx` (modify) | layout | request-response | itself | exact |
| `src/app/(learner)/layout.tsx`, `account/layout.tsx` (modify) | layout | request-response | itself (`rightSlot`) | exact |
| `src/components/notifications/*` | component | event-driven | `src/components/shell/LearnerAccountSlot.tsx`, `src/components/support/TicketActionDialog.tsx` | role-match |
| `prisma/schema.prisma` + migration | migration | CRUD | latest `prisma/migrations/20260925120000_ticket_queue_changed_event` | role-match |
| tests | test | - | `tests/release-expired-holds-task.test.ts`, `netlify-release-expired-holds.test.ts`, `email-dispatch-service.test.ts`, `brevo-client.test.ts` | exact |

## Pattern Assignments

### Scheduled tasks (`release-expired-holds-task.ts`, whole file)
```ts
export const HOLD_SWEEP_BATCH_SIZE = 25;
export type ReleaseExpiredHoldsTaskDeps = {
  releaseExpiredHolds: (batchLimit: number) => Promise<{ released: number; failed: number }>;
  log: (message: string) => void;
};
export function createReleaseExpiredHoldsTask(deps: ReleaseExpiredHoldsTaskDeps) {
  return async function runReleaseExpiredHoldsTask(): Promise<void> {
    const result = await deps.releaseExpiredHolds(HOLD_SWEEP_BATCH_SIZE);
    deps.log(`[scheduled] released ${result.released} ...`);
  };
}
export const runReleaseExpiredHoldsTask = createReleaseExpiredHoldsTask({
  releaseExpiredHolds: releaseExpiredHoldsAsSystem,
  log: (message) => console.info(message),
});
```
Copy for drain and cleanup tasks. Task imports only services (closure walked by `tests/boundary.test.ts`).

### Netlify wrapper (`netlify/functions/release-expired-holds.ts`)
```ts
import type { Config } from "@netlify/functions";
import { runReleaseExpiredHoldsTask } from "../../src/server/scheduled/release-expired-holds-task";
export function createReleaseExpiredHoldsHandler(run: () => Promise<void>) {
  return async function releaseExpiredHolds(): Promise<void> { await run(); };
}
export default createReleaseExpiredHoldsHandler(runReleaseExpiredHoldsTask);
export const config: Config = { schedule: "*/5 * * * *" };
```
Drain uses `"* * * * *"` (or `*/2`); cleanup daily. Test analog `tests/netlify-release-expired-holds.test.ts` asserts `config.schedule`, default is function, handler runs task once.

### Drain service: claim + per-row tx + SYSTEM audit
Claim (`src/server/services/export-worker-service.ts` lines 53-72), but run it inside each event's own `$transaction` with `LIMIT 1` (RESEARCH Pattern 2):
```ts
const rows = await tx.$queryRaw<Claimed[]>`
  SELECT "id" FROM "ExportJob" WHERE "status" = 'QUEUED'
  ORDER BY "createdAt" ASC, "id" ASC
  FOR UPDATE SKIP LOCKED LIMIT ${bounded(limit)}`;
```
Per-row try/catch, failure counted and logged, loop continues; audit after commit (`hold-release-system-service.ts` ~160-190):
```ts
await deps.audit({ actorId: null, actorType: SYSTEM_ACTOR_TYPE, action: "...", targetType: "Enrolment",
  targetId: row.id, outcome: "SUCCESS", reason: "...", before: {...}, after: {...} });
...
} catch (err) { if (err instanceof StaleEnrolmentError) continue; failed += 1; console.error(`[...] failed ...`, err); }
```
Poison-event audit (D-04) reuses this system-actor audit shape. Use `skipDuplicates` for dispatch/notification inserts (Pitfall 1).

### `email-dispatch-service.ts` (modify)
Keep the factory shape: `createEmailDispatchService({ store, send, describeFailure, now })` with a narrow `EmailDispatchStore` type, exported singleton `emailDispatchService`, and `dispatchBestEffort(dispatchFn, params)`. Replace `correlationId: randomUUID()` (the dispatch row create) with a caller-supplied stable key; add `enqueue` (idempotent), `sendQueued` (backoff, attempts), `resend` (audited). Extend `DispatchParams` (currently `template,toEmail,userId,subject,textContent`) with `htmlContent`, `correlationId`, `category`. Extend `EmailDispatchRow` with attempts/nextAttemptAt/skipReason. Keep the `error` column = `describeFailure(error)` only.

### `brevo-client.ts` (modify)
Existing pieces to keep: `buildTransactionalEmailPayload`, `describeBrevoFailure` (uses `Brevo.BadRequestError`, `BrevoTimeoutError`, `BrevoError`) and add `classifyBrevoFailure` next to it. Replace the fallback defaults (COM-04/D-14):
```ts
const senderName = process.env.EMAIL_SENDER_NAME ?? "Professional Training LMS";   // remove ?? fallback, throw
const senderAddress = process.env.EMAIL_SENDER_ADDRESS ?? "no-reply@example.com";  // remove ?? fallback, throw
if (!apiKey) throw new Error("BREVO_API_KEY is not configured.");                 // fail-loud style to copy
```
Add `htmlContent`, `replyTo` to payload type (verify field names in `node_modules/@getbrevo/brevo` types first, A2). Must not import `@prisma/client`.

### Notification / access / delivery-log services
Analog `src/server/services/audit-read-service.ts`: deps-injected `withPermission`, narrow store type, then singleton.
```ts
export function createAuditReadService(deps: { store: AuditReadStore; withPermission: WithPermission }) {
  const { store, withPermission: authorize } = deps;
  const listInternal = authorize<AuditFilter>("audit.view", () => ({}))(async (filter) => { ... });
```
Delivery log: `authorize("audit.view", () => ({}))` for list is GLOBAL-only per that file's header; Resend gated separately (`users.manage` suggested, RESEARCH Open Q5; planner confirm). Notification ownership methods do NOT use `withPermission`; they use `getCurrentActor` + `where recipientId = actor.userId`.

### Poll route (`src/app/api/notifications/unread/route.ts`)
Analog `src/app/api/certificates/[id]/download/route.ts`: denial-parity (empty 404 for every non-success, no caching export, private headers, no `force-static`). For the poll, unauthenticated returns 401 empty and success sets `Cache-Control: private, no-store`. Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before coding (AGENTS.md).

### Staff delivery log page + actions
Analog `src/app/staff/audit/page.tsx`: async Server Component with `searchParams: Promise<...>`, `export const metadata = { title: "Audit" }`, service call in try/catch catching `AuthorizationError`/`AuthenticationError`, table component beside page (`AuditTable.tsx`). Actions analog `src/app/staff/audit/actions.ts`:
```ts
"use server";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
const requestSchema = z.object({ ... }).strict();
export type XActionResult = { ok: true; ... } | { ok: false; message: string };
export async function requestAuditExportAction(input: unknown): Promise<...> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "..." };
  try { ...; revalidatePath("/staff/...", "page"); return { ok: true, ... }; }
  catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) return { ok: false, message: "You are not authorised ..." };
    console.error("...", error); return { ok: false, message: "..." };
  }
}
```
Resend schema: reason `min(10)`. Add nav entry to `NAV` and `NAV_PERMISSION` in `src/app/staff/layout.tsx` (e.g. `"/staff/email-log": "audit.view"`).

### Layout mounts (bell)
`src/app/staff/layout.tsx`: server layout does `getCurrentActor()`, then `<StaffShell nav={visibleNav} identity={identity} signOut={signOut}>`. Add a `bell` prop (server-rendered initial count) to `StaffShell` (client) header band.
`src/app/(learner)/layout.tsx` (lines ~40-52) and `account/layout.tsx`:
```tsx
const rightSlot = <LearnerAccountSlot display={display} signOut={signOutAction} />;
return <LearnerShell nav={NAV} homeHref="/dashboard" rightSlot={rightSlot}>{children}</LearnerShell>;
```
Add the bell into `rightSlot` in BOTH layouts (Pitfall 11); count fetched in server layout, passed as prop.

### Drawer components
Analogs: `src/components/shell/LearnerAccountSlot.tsx` (header slot) and `src/components/support/TicketActionDialog.tsx` (dialog/focus behavior). Not read in detail; planner/executor should read both plus `13-UI-SPEC.md`. Use semantic tokens from `src/app/globals.css` only.

### Migration
Hand-written SQL folder under `prisma/migrations/`, latest `20260925120000_ticket_queue_changed_event`. `EmailDispatch.status` stays free `String` (add SKIPPED). Add `(status, nextAttemptAt)` index.

## Shared Patterns

- **Import boundary:** `@prisma/client` only in `src/server/services/**` and `src/server/db.ts` (`tests/boundary.test.ts`).
- **System actor:** `actorId: null, actorType: "SYSTEM"` for drain/cleanup/poison audits.
- **Denial parity:** empty 404 / single "No longer available" outcome (certificate download route).
- **Action results:** `{ ok: true } | { ok: false; message }` with zod `.strict()` and Authentication/Authorization catch.
- **Injectable deps for testability:** every service is `createX(deps)` + singleton; tests inject fakes.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `event-intent-mappers.ts` | transform | No existing event consumer; build as exhaustive `Record<DomainEventType, Mapper>` (RESEARCH catalogue table) |
| `templates/layout.ts`, `registry.ts` | utility | No HTML email exists; only plain-text `textContent` today |

## Metadata
**Scope:** `src/server/scheduled`, `netlify/functions`, `src/server/services`, `src/server/email`, `src/app/staff`, `src/app/api`, layouts, `tests`.
**Not deeply read (executor must read first):** `LearnerAccountSlot.tsx`, `TicketActionDialog.tsx`, `StaffShell.tsx`, `account/layout.tsx`.
**Extracted:** 2026-09-27
