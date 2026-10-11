# Phase 15: Launch Readiness - Pattern Map

**Mapped:** 2026-10-06
**Files analyzed:** 22 (new + modified)
**Analogs found:** 16 / 22

All analog paths below were checked with `git ls-files` (tracked source).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/auth/rate-limit.ts` (new) | utility/service | request-response, DB counter | `src/server/auth/sign-in-throttle.ts` | exact |
| `src/app/(auth)/register/actions.ts`, `forgot-password/actions.ts`, `verify/actions.ts`, `signin/actions.ts` (mod, D-11/D-16) | server action | request-response | `src/app/staff/payments/actions.ts` (zod + error mapping) + existing signin throttle wiring | exact |
| `src/app/verify/[verificationRef]/page.tsx` (mod, 4th neutral throttled branch) | page | request-response | itself + `src/app/staff/email-log/page.tsx` branch style | role-match |
| `src/server/services/ops-status-service.ts` (new) | service | CRUD read | `src/server/services/email-delivery-log-service.ts` | exact |
| `src/server/services/privacy-export-service.ts` (new) | service | batch/file | `src/server/services/export-service.ts` + `email-delivery-log-service.ts` DI shape | role-match |
| `src/server/services/privacy-anonymise-service.ts` (new) | service | CRUD write, audited | `email-delivery-log-service.ts` (`resendInternal` reason-gated write) + `audit-service.ts` | role-match |
| `src/app/staff/operations/page.tsx` (new) | page (RSC) | request-response | `src/app/staff/email-log/page.tsx` | exact |
| privacy staff tool page/actions under `src/app/staff/users/...` (new) | page + server action | request-response | `src/app/staff/email-log/page.tsx`, `src/app/staff/payments/actions.ts` | exact |
| `src/app/staff/layout.tsx` (mod, nav entry) | config | - | lines 30-45 nav array | exact (co-worker owned) |
| `src/app/api/health/route.ts` (new) | route | request-response | `src/app/api/staff/licence/diagnostic/route.ts` | role-match |
| `src/server/permissions/catalogue.ts` + `src/server/licence/registry.ts` (mod) | config | - | existing entries | exact |
| `src/lib/format-lagos.ts` (new, D-17) | utility | transform | `src/lib/format-timestamp.ts` | exact |
| `scripts/load/seed-load.ts`, `scripts/ops/integrity-checks.ts` (new) | script | batch | `prisma/seed.ts`; task DI from `src/server/scheduled/release-expired-holds-task.ts` | partial |
| `tests/support/authz-registry.ts` (new) | test data | - | `src/server/licence/registry.ts` | exact |
| `tests/authz-inventory.test.ts` (new) | test (AST scan) | - | `tests/licence-enforcement-boundary.test.ts` + `tests/support/licence-write-scan.ts` | exact |
| `tests/authz-bypass.integration.test.ts`, rate-limit/privacy integration tests | test (real PG) | - | `tests/support/pg.ts` harness | exact |
| `tests/rate-limit.test.ts` | unit test | - | `tests/sign-in-throttle.test.ts` | exact |
| `.github/workflows/ci.yml`, `.github/dependabot.yml` | config | - | none | no analog |
| `e2e/**` (Playwright config, specs, support) | test | - | none (Playwright not installed); `tests/support/axe.ts` for rule options only | no analog |
| `perf/*.js` (k6) | test | - | none; `vitest.perf.config.mts` is the only perf harness | no analog |
| `docs/runbooks/*.md` | docs | - | `docs/deployment/netlify-scheduled-functions.md` | partial |
| `15-LAUNCH-REPORT.md`, `15-LAUNCH-CHECKLIST.md` | planning docs | - | none | no analog |

## Pattern Assignments

### `src/server/auth/rate-limit.ts` (generalised limiter)
**Analog:** `src/server/auth/sign-in-throttle.ts`
- Lines 21-36: frozen limits + key builder (`ip:`, `ip-email:` prefixes; fall back to address, never a shared "unknown" bucket). New keys should be namespaced per action, e.g. `register:ip:<ip>`, `cert-check:ip:<ip>`, `ticket:user:<userId>`.
- Lines 42-48 `isThrottled(keys, rows, now)` pure predicate - copy shape.
- Lines 56-65 `clientIpFrom(headers)` - reuse, do not re-implement.
- Lines 67-74 narrow `ThrottleStore` type (DI slice of Prisma) - reuse.
- Lines 80-90 atomic upsert, reuse the `LoginThrottle` table:
```ts
await store.$executeRaw`
  INSERT INTO "LoginThrottle" ("key", "email", "failures", "windowStartedAt", "updatedAt")
  VALUES (${k.key}, ${k.email}, 1, ${now}, ${now})
  ON CONFLICT ("key") DO UPDATE SET
    "failures" = CASE WHEN "LoginThrottle"."windowStartedAt" <= ${since} THEN 1 ELSE "LoginThrottle"."failures" + 1 END, ...
```
- No in-memory Map (serverless). `REQUEST_COOLDOWN_MS` in `request-cooldown.ts` stays as the per-address cooldown.
- Test: mirror `tests/sign-in-throttle.test.ts`.

### Auth server actions (D-11, D-16)
**Analog:** `src/app/staff/payments/actions.ts`
- Line 1 `"use server";`, header comment declaring "Every export here is a public POST endpoint".
- Lines 18-21 imports: `revalidatePath` from `next/cache`, `z` from `zod`, `AuthenticationError, AuthorizationError` from `@/server/permissions`.
- Lines 48-60: zod schema with `.trim().min().max()` enforced server-side.
- D-16: use `after()` from `next/server` (check `node_modules/next/dist/docs/` `after.md`) to resend verification after the response; return the same neutral state.

### `src/server/services/ops-status-service.ts` and privacy services
**Analog:** `src/server/services/email-delivery-log-service.ts`
- Line 18 `import { withPermission } from "@/server/permissions";`
- Lines 130-169: factory `createXService(deps: { store; withPermission; ... })`, read wrapped with `authorize<Filter>("audit.view", () => ({}))(async (filter) => ...)`, capped `take:`.
- Write with reason gate and licence option (lines 148-161):
```ts
authorize<{...; reason: string}>("users.manage", () => ({}),
  { licence: "continuity", reason: "..." })(async (input, ctx) => {
  if (input.reason.trim().length < MIN_REASON) throw new NotAllowedError(); // same generic error, no oracle
  ...ctx.actor.userId...
});
```
  Anonymise is a write: do NOT mark it continuity; use default write effect and add a `withPermission` entry in `src/server/licence/registry.ts`.
- Lines 171-175: singleton export `export const xService = createXService({ store: prisma as unknown as XStore, withPermission, ... })`.
- Audit: `recordAuditInTransaction` from `src/server/services/audit-service.ts` inside the anonymise transaction (redacts `password`, `token`, etc.).
- Privacy export: reuse `ExportJob` pipeline (`export-service.ts`, `export-worker-service.ts`, `export-download-service.ts`) rather than a new job system.

### `src/app/staff/operations/page.tsx` and privacy tool page
**Analog:** `src/app/staff/email-log/page.tsx`
- Lines 1-6 imports + `export const metadata = { title: "..." }`.
- Lines 11-16 async page with `searchParams: Promise<Record<...>>` and `await searchParams`.
- Lines 20-24 allow-list filter values (unknown -> no filter).
- Lines 31-55 error mapping:
```tsx
} catch (error) {
  if (error instanceof AuthenticationError) return <p className="text-sm">Your session has ended. Sign in again.</p>;
  if (error instanceof AuthorizationError) return <Table denied={{ permission: "audit.view" }} ... />;
  return <Table error={{ message: "Couldn't load ... Reload the page; ..." }} ... />;
}
```
- Nav: add one item to the array in `src/app/staff/layout.tsx` lines 30-45, e.g. `{ label: "Operations", href: "/staff/operations", group: "Operations" }` (coordinate with co-worker, single owner).
- Row actions: `RowActionMenu`; forms: shared `ResourceForm`; spacing/colour must pass `tests/unit/design-contract.test.ts`.

### `src/app/api/health/route.ts`
**Analog:** `src/app/api/staff/licence/diagnostic/route.ts`
- Lines 22-26: `import { NextResponse } from "next/server"`; `const NO_STORE = { "Cache-Control": "private, no-store" }` - health must never be cached.
- Lines 40-50: `export async function GET(): Promise<Response>` in try/catch; fixed error body, no stack; log only error name.
- Health is public: no permission call, return minimal JSON (`{ status: "ok" }`, optional cheap `SELECT 1`), no data leakage.

### `src/lib/format-lagos.ts` (D-17)
**Analog:** `src/lib/format-timestamp.ts` lines 45-56:
```ts
export function formatDateTimeShort(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC",
  }).format(date);
}
```
Copy with `timeZone: "Africa/Lagos"` and append a literal ` WAT` suffix (do not rely on ICU `timeZoneName`, which varies by runtime and breaks hydration - see header lines 1-11). Keep pure module, no imports. Swap callers such as `src/app/(learner)/support/[reference]/LearnerTicketDetail.tsx:61` and `src/components/support/ticket-labels.tsx:40-44`. Test alongside `tests/timezone.test.ts`.

### `tests/support/authz-registry.ts` + `tests/authz-inventory.test.ts` (D-09)
**Analog:** `src/server/licence/registry.ts` lines 1-60: pure data, imports nothing, header documenting kinds, typed `RegistryEntry { file; kind; reason }`, repo-relative forward-slash paths, `readonly` array. Inventory test copies the structure of `tests/licence-enforcement-boundary.test.ts` (fail on unregistered, stale, misclassified) and reuses AST helpers in `tests/support/licence-write-scan.ts`. Targets: 47 `"use server"` files + the 16 `route.ts` handlers under `src/app/api/`. Whole-tree scans need `--testTimeout=60000`.

### Integration tests (bypass matrix, rate limit, privacy)
**Analog:** `tests/support/pg.ts` lines 1-40: Testcontainers Postgres, `TEST_DB_TIMEOUT_MS = 300_000` passed to `beforeAll`/`afterAll`, migrations applied as production. Requires Docker; never `.env`.

### `scripts/load/seed-load.ts`, `scripts/ops/integrity-checks.ts`
**Analog:** `prisma/seed.ts` (data shapes, password `Passw0rd!dev`) and `hashToken` from `src/server/auth/token-hash.ts` for session rows. Must refuse to run unless `DATABASE_URL` host is localhost/127.0.0.1 or allow-listed staging. Use DI + log pattern from `src/server/scheduled/release-expired-holds-task.ts` (`createXTask(deps)` + `log` dep) so the integrity checks can also feed `ops-status-service`.

## Shared Patterns

- **Authorization:** `withPermission(permission, scopeFn, opts?)` via service factories (email-delivery-log-service.ts 130-169). Pages catch `AuthenticationError`/`AuthorizationError` (email-log/page.tsx 37-44). Routes: 401 no session, empty 404 on deny (diagnostic route header lines 16-19).
- **New permissions:** add to `src/server/permissions/catalogue.ts` and classify each new writing service in `src/server/licence/registry.ts`, or the boundary test fails.
- **Audit:** `recordAudit` / `recordAuditInTransaction` from `src/server/services/audit-service.ts`.
- **Neutral responses:** identical messages/timings regardless of account existence (sign-in-throttle.ts 1-19 rationale).
- **No caching for private/health responses:** `Cache-Control: private, no-store`.
- **Next.js:** read `node_modules/next/dist/docs/` before using `after`, `cache`, route handlers.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `.github/workflows/ci.yml`, `.github/dependabot.yml` | config | No `.github/` exists; use RESEARCH.md structure |
| `e2e/playwright.config.ts`, `e2e/*.spec.ts`, `e2e/support/*`, `e2e/screens.manifest.ts` | test | Playwright not installed; only axe option precedent in `tests/support/axe.ts` |
| `perf/*.js` (k6) | test | No k6 scripts; review `vitest.perf.config.mts` / `npm run test:perf` |
| `docs/runbooks/*.md` | docs | Only `docs/deployment/netlify-scheduled-functions.md` as tone/format reference |
| `15-LAUNCH-REPORT.md`, `15-LAUNCH-CHECKLIST.md` | planning | New artefacts per D-05 |

## Metadata
**Analog search scope:** `src/server/auth`, `src/server/services`, `src/server/licence`, `src/server/scheduled`, `src/app/staff`, `src/app/api`, `src/lib`, `tests/support`, `tests/`
**Files scanned:** ~120
**Pattern extraction date:** 2026-10-06
