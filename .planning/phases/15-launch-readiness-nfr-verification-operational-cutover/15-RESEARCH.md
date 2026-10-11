# Phase 15: Launch Readiness — NFR Verification & Operational Cutover - Research

**Researched:** 2026-10-06
**Domain:** NFR verification and operational cutover for a Next.js 16.3.4 / React 19.2.8 / Prisma 6.19 / Neon / Netlify / Cloudflare R2 LMS (verification tooling, small hardening features, evidence)
**Confidence:** MEDIUM-HIGH (repo facts HIGH, read this session; external tool limits MEDIUM, cited from vendor pages; several owner decisions open)

Environment note: research ran on Windows 11 + Git Bash, Node v24.6.0, npm 11.5.1, Docker 28.3.3 (Docker Desktop limit 7.6 GB), 15.8 GB RAM, 8 logical CPUs, host `pg_dump` 18.0. `.env*` is permission-denied, so `.env.example` could not be read (see Assumption A1). The GSD `research-plan` seam was not used; WebSearch/WebFetch/`gh api`/`npm view` were used directly and every claim is tagged.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Where and how we test**
- **D-01:** Rehearsals run locally first (Docker Postgres, production build) so they are repeatable. The numbers that are signed off come from ONE run on a staging target: a Neon branch plus a Netlify deploy preview. Never test against the shared production Neon database. — **Reversibility:** reversible.
- **D-02:** "Expected pilot load" for NFR-02 is **150 learners and 10 staff active at once**. The PRD gives no number; this is the agreed definition. The p75 2.5s target is measured at that load. If it cannot be met, performance work is in scope.
- **D-03:** Page speed is measured with **k6** (concurrent load, timings) plus **Playwright** (real-browser time to usable primary content, the p75 measure). The repo already has `npm run test:perf` and `vitest.perf.config.mts`; the planner should check how they fit.
- **D-04:** The backup and restore rehearsal (NFR-08) uses **both** a Neon point-in-time restore on a branch **and** a dump restored into Docker, so there is a recovery route that does not depend on Neon. RPO 24h / RTO 8h; record timings.

**What counts as done**
- **D-05:** Evidence is **one report at the end** rather than a file per gate. A separate **launch checklist** file lists the owner-dependent items with a named person for each.
- **D-06:** The phase may be marked complete once everything the code and tests can prove is proven. Owner items (gateway production credentials, legal/privacy/retention approval, email sender domain, support staffing) stay on the launch checklist, and production stays closed until they are signed.
- **D-07:** A failed check that cannot be fixed in time may be covered by a **written waiver** naming who accepted the risk and when it expires. Critical security, payment, authorization and private-file failures are **never waived**.
- **D-08:** The "unassisted full journey" (discover, register, verify, pay, learn, attend, submit, grade, complete, certificate) is proven by a repeatable **automated Playwright run on seeded data plus one manual run** with no help. The 95% end-to-end reliability measure uses the automated runs.

**Security and privacy depth**
- **D-09:** The authorization bypass suite (NFR-05) covers **every server action and every private-file/download route**, driven from the existing action registry so a new action cannot be forgotten. Each is tried as the wrong user, with no permission, with the wrong scope and in the wrong record state.
- **D-10:** Add **GitHub Actions** (type check, lint, tests, `npm audit`) and **Dependabot**. There is currently no `.github/workflows`. This adds new CI files to the repo and also protects every future merge. — **Reversibility:** costly — workflow files become a shared dependency for the whole team.
- **D-11:** Extend rate limiting beyond sign-in to **register, forgot password, resend verification, public certificate check and support ticket submission**, reusing the existing approach (`src/server/auth/sign-in-throttle.ts`, `request-cooldown.ts`), with tests.
- **D-12:** NFR-11 privacy tools: a **permission-gated, audited staff tool** to export one learner's data and to **anonymise** their account. **Hard deletion stays blocked** until owners approve a retention schedule and legal-hold process (the PRD safe default). No learner self-service in this phase. — **Reversibility:** costly — anonymisation rewrites personal data in place.

**Accessibility and browsers**
- **D-13:** WCAG 2.2 AA is proven by **axe on every screen** (kept in the repeatable tests), a **keyboard-only walkthrough** of the three journeys, and **one real screen-reader pass** (NVDA or VoiceOver) with the result recorded.
- **D-14:** Browser support (current and previous major of Chrome, Edge, Firefox, Safari) is covered by **Playwright on Chromium (Chrome and Edge), Firefox and WebKit** plus **one manual check on real Safari including an iPhone**.
- **D-15:** The responsive range is **320px phone to 1920px desktop plus 200% zoom/reflow**, with no unintended horizontal scrolling on primary forms and content.

**Carried-in UI decisions**
- **D-16 (U-11, unverified sign-in):** Keep **one neutral message** for everyone. If the details match an unverified account, quietly send a fresh verification email. Nothing on screen reveals whether an account exists.
- **D-17 (U-12, dates and time zones):** Show **Lagos time with the zone label** everywhere, for staff and learners, for example "5 Oct 2026, 14:30 WAT". Learner support times currently show UTC and must change.

**Monitoring and availability**
- **D-18:** Add a **staff-only operations status page** listing failed jobs, payment exceptions and email failures from data already stored, plus a **free external uptime monitor** hitting a health endpoint. The uptime monitor measures the 99.5% target (NFR-01). No new paid service and no error-tracking vendor in this phase.

### Claude's Discretion
- Exact k6 scenarios and thresholds, the seeding scripts, and how the performance and journey tests are split between local and staging runs.
- The layout of the ops status page and the health endpoint's shape.
- How the report and launch checklist are organised, provided every PRD gate is covered.
- Runbook format and content for deployment, rollback and job recovery (NFR-12); these were not discussed in detail.

### Folded Todos
- **Phase 15 prerequisites** (`.planning/todos/pending/2026-10-05-phase-15-prerequisites-ui-review-and-licence-go-live.md`): the licence go-live items fold in. Apply four Neon migrations, including `20261001120000_licence_deployment_control`; generate the production licence signing key and add its public half to `PRODUCTION_TRUSTED_KEYS`; confirm the hourly Netlify `check-licence` function runs; regenerate the `.docx` twins of the PRD and PXR and align contract wording; manual keyboard, screen-reader, narrow-width and zoom checks of the licence screens; close Phase 14 (`human_needed`) with `/gsd-verify-work 14`.
- **Support queue filtering into SQL** (`2026-09-25-move-staff-support-queue-filtering-into-sql.md`): `getStaffQueue` reads the whole ticket table and filters in JavaScript. Fix it as part of the NFR-02 performance work. Keep the existing queue tests.
- **Latent async-mutation warnings** (`2026-09-07-close-04-1-review-2-latent-mutation-warnings.md`): three unguarded or unclean mutation handlers in `ArrangeClient.tsx`, `ProgrammeArrangeClient.tsx` and `LessonEditorClient.tsx`. Fix as part of reliability (NFR-03) and data integrity (NFR-14).

### Deferred Ideas (OUT OF SCOPE)
- Learner self-service data export and deletion requests: a later phase, after the retention policy is approved.
- A paid error-tracking service such as Sentry: revisit if the in-product ops page proves too thin.
- Hard deletion of personal data: blocked until owners approve a retention schedule and legal-hold process.
- Inline table links (cohort code, learner name) under 24px tall: still open from the UI review, low priority.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NFR-01 | Availability 99.5% monthly | Health endpoint + free external monitor (section B13); Neon plan compute-hours risk (Pitfall 1); 99.5% budget = 216 min per 30-day month |
| NFR-02 | Interactive performance p75 2.5s at pilot load | k6 background load + Playwright probe (A1, B13, C); known slow spots (A2); React `cache()` for per-request actor/grant dedupe |
| NFR-03 | Reliability / idempotency | Idempotency inventory and gaps (A7); k6/vitest concurrent webhook replay |
| NFR-04 | Security baseline | Rate limiting (A5), headers, hashing, `npm audit` currently RED (A8), CI (B16) |
| NFR-05 | Authorization + bypass tests | Action/route inventory and registry-driven bypass design (A4) |
| NFR-06 | Private files / reports | Route-by-route download audit and TTLs (A4); R2 public-access owner check |
| NFR-07 | Audit + observability | Audit coverage vs field list (A6); ops page data sources (A6); `onRequestError` structured log option |
| NFR-08 | Backup / recovery RPO 24h / RTO 8h | Neon PITR + pg_dump to Docker (B14); Neon plan retention is the key constraint |
| NFR-09 | WCAG 2.2 AA | axe via Playwright (B17); captions/accessible-media gap is UNRESOLVED (Open Question 1) |
| NFR-10 | Responsive web | Viewport/zoom scripting (B17); D-15 range stricter than PRD 360px |
| NFR-11 | Privacy / data lifecycle | PII inventory, export/anonymise design (A11) |
| NFR-12 | Browser compat + runbooks | Playwright matrix (B18); runbook inventory and gaps (A12) |
| NFR-13 | Async work states / retries | Job inventory + states (A6/A7); ops page |
| NFR-14 | Data integrity | Constraint inventory, missing unique indexes, integrity-check queries (A7) |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md and standing rules)

- CLAUDE.md imports AGENTS.md: "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before recommending any Next API. Docs consulted this session and cited inline: `01-app/01-getting-started/15-route-handlers.md`, `01-app/03-api-reference/04-functions/after.md`, `01-app/02-guides/server-actions.md`, `01-app/02-guides/data-security.md`, `01-app/03-api-reference/03-file-conventions/instrumentation.md`, `01-app/02-guides/caching-without-cache-components.md`, `01-app/02-guides/testing/playwright.md`, `01-app/01-getting-started/01-installation.md`.
- No project skills exist (`.claude/skills`, `.agents/skills` absent).
- **NO COMMITS**; research is read-only for source (only this file written). Plans must not instruct the executor to auto-commit; commits only when the owner asks, one at a time. No co-author trailers.
- Never test against shared Neon (`.env*` points at it). Only safe local DB: Docker Postgres on host port 5434 (`licence_test`), with a shell-level `DATABASE_URL` override. Temporary licence trust-set keys must be reverted before commit.
- Memory-limited dev machine: do not run the whole suite; vitest in small batches; whole-tree scan tests need `--testTimeout=60000`.
- Plan Phase 15 together with the co-worker; one owner at a time for shared UI parts (ConfirmModal, ResourceForm, StaffShell, Toaster, RowActionMenu, catalogue components).
- Licence: new write actions must be classified in the licence registry/effects (blocked by default); new permissions require product approval (catalogue header: "Adding an identifier here is a product decision" — `src/server/permissions/catalogue.ts`).
- ESLint confines `@prisma/client` to `src/server/services/**` and `src/server/db.ts` (`eslint.config.mjs`); test/e2e helpers outside `src/` may import it.

## Summary

The repo is mature (413 test files: 64 Testcontainers integration, 92 jsdom component, 257 node unit; 81 `page.tsx`, 47 `"use server"` files exporting about 131 actions, 18 route handlers). Phase 15 is mostly assembling proof harnesses (Playwright, k6, bypass inventory, integrity checks, CI) plus five small features (rate limits, ops page + health endpoint, privacy export/anonymise tool, sign-in quiet resend, Lagos-time formatter). Several things the CONTEXT assumes do not exist as stated: the "action registry" is per **service file**, not per action; the existing perf harness is one Testcontainers test, not an HTTP harness; the stub email transport discards verification tokens so an automated register-verify journey needs a capture seam; there is no scheduled-run heartbeat table.

Five findings should shape planning. (1) `npm audit --omit=dev` is RED today: 1 critical (`next` 16.2.0–16.3.5, GHSA-vcvr-r3jv-pc5j, `next/og` RCE; not used in `src/`, fix is 16.3.8) and 1 high (`source-map-js`); D-07 forbids waiving critical security, so CI cannot go green until `next` and `eslint-config-next` are bumped. (2) Every staff page render does ~15 parallel `can()`/`canAnywhere()` calls in `src/app/staff/layout.tsx`, each doing a session query and a grants query: the cheapest, highest-value NFR-02 fix is request-scoped `React.cache()` on `getCurrentActor`/`loadGrantsForUser`, but measure first. (3) NFR-09 accessible-media (captions) is an UNRESOLVED carry-forward gap from Phase 4.1 that D-13 does not cover; it needs an owner decision (build WebVTT, or time-boxed waiver plus content policy). (4) Neon Free gives only 6 h history and 100 CU-hours with scale-to-zero that cannot be disabled, while per-minute scheduled functions keep the DB awake: production on Free cannot meet RPO 24h or 99.5% availability. (5) The repo is PUBLIC on GitHub, so Actions standard runners and Dependabot are free, but workflow design must treat fork PRs as untrusted.

**Primary recommendation:** Sequence as (0) bump `next`/fix audit, add `.github` CI, seed + Playwright/k6 scaffolding and Wave-0 spikes; (1) hardening features + registry-driven bypass suite + integrity checks; (2) a11y/responsive/browser sweeps and the carried-in UI items (U-11, U-12); (3) local rehearsal of everything; (4) ONE staging run on Neon branch + Netlify preview; (5) report + launch checklist. Prove with code what code can prove; everything about plans, credentials, policy and real devices goes on the owner checklist.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Health endpoint | API / Backend (route handler) | Database (SELECT 1) | Public, no secrets, no caching; Route Handlers are uncached by default (`15-route-handlers.md`) |
| Ops status page | Frontend Server (RSC page, staff-gated) | Database (existing tables) | Reads stored state; permission via `withPermission`/`can` |
| Rate limiting (register, forgot, resend, cert check, ticket) | API / Backend (service layer) | Database (`LoginThrottle` table) | Serverless-safe because state is in Postgres, not memory |
| Quiet verification resend (D-16) | API / Backend (`after()` in the action) | Email transport | Must not change response time or message |
| Lagos time formatter (D-17) | Shared pure module (`src/lib`) | Browser/Server render | Must be byte-identical server vs client (hydration) |
| Privacy export / anonymise | API / Backend (service + staff action) | Database, Object storage | Audited, permission-gated write action; licence-registry classified |
| Authorization bypass suite | Test tier (vitest + real Postgres) | Static AST inventory | Server actions are public POST endpoints (`server-actions.md:78`) |
| Perf load | External (k6 in Docker) | Browser (Playwright probe) | Load from outside the server; real browser for time-to-usable |
| Availability measure | External uptime monitor | Health endpoint | Must be independent of the app |
| Backups/restore | Database host (Neon PITR) + Docker dump | Object storage (R2) | Files referenced by DB rows must be recoverable too |
| CI / Dependabot | Repo (GitHub) | — | New shared dependency (D-10, costly reversibility) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | 1.63.0 (npm; GitHub release v1.63.0, 2026-09-04) | E2E journey, a11y sweeps, browser matrix, time-to-usable probe | Next docs recommend it (`01-app/02-guides/testing/playwright.md`); runs Chromium, Firefox, WebKit [VERIFIED: npm view + gh api] |
| `@axe-core/playwright` | 4.13.0 (2026-08-11) | axe inside Playwright | Depends on `axe-core ~4.13.0`, which matches the installed `axe-core` 4.13.0 so no duplicate copy [VERIFIED: npm view; `npm ls axe-core`] |
| k6 (Grafana, Go binary) | v2.3.0 (2026-09-21) via Docker `grafana/k6` | Concurrent load, per-route p75 thresholds | Do NOT `npm install k6` (the npm `k6` package is a 2017 placeholder, not the tool) [VERIFIED: gh api repos/grafana/k6/releases/latest; npm view k6] |
| GitHub Actions + Dependabot | n/a | CI and dependency PRs | Free standard runners on PUBLIC repo (`gh repo view`: visibility PUBLIC) [CITED: docs.github.com billing page] |
| Neon branching + `neonctl` | neonctl 8.0.11 via `npx` only | Staging branch, PITR branch | Never installed in repo |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/k6` | 2.3.0 | Types for k6 scripts | Optional; only if k6 scripts are TypeScript-checked by `tsc` (tsconfig includes `**/*.ts`). SUS "too-new" flag, DefinitelyTyped repo |
| `postgres:<neon-major>-alpine` Docker image | match Neon major | `pg_dump`/`pg_restore` without host version mismatch | Host `pg_dump` is 18.0; a v18 dump may not restore into 16 |
| Existing `testcontainers` / `@testcontainers/postgresql` ^12.1.0 | present | Real Postgres for integration, bypass and integrity tests | Already the repo harness (`tests/support/pg.ts`) |
| Existing `typescript` compiler API | present | AST inventory of actions/routes/pages | Same technique as `tests/support/licence-write-scan.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| k6 in Docker | k6 native install (choco/winget) | Host install is light but Docker is already running; Docker needs `host.docker.internal` and `MSYS_NO_PATHCONV=1` for Git Bash volume paths |
| `.spec.ts` Playwright specs | vitest browser mode | D-03/D-08/D-14 require Playwright; vitest `include` is `tests/**/*.test.ts` so `e2e/**/*.spec.ts` does not collide |
| UptimeRobot free | Better Stack free | UptimeRobot: 50 monitors, 5-min interval, "Good for hobby and non-profit projects" wording; Better Stack: 10 monitors, Slack/email alerts [CITED: vendor pricing pages]. Commercial-use terms: owner to confirm |

**Installation (devDependencies only, executor step; research did not install):**
```bash
npm install -D @playwright/test@1.63.0 @axe-core/playwright@4.13.0
npx playwright install chromium firefox webkit   # downloads ~650 MB; Windows: %USERPROFILE%\AppData\Local\ms-playwright
```
k6 (Windows, Docker): `docker run --rm -i -v "$PWD/perf:/perf" -e BASE_URL=http://host.docker.internal:3000 grafana/k6 run /perf/learner.js` (Git Bash: prefix `MSYS_NO_PATHCONV=1`).

**Version verification:** versions above were checked this session with `npm view`, `gh api`, and `gsd-tools query package-legitimacy check`. `axe-core` registry latest is 4.14.0 (published 2026-10-05) but `@axe-core/playwright@4.13.0` pins `~4.13.0`; do not let Dependabot raise `axe-core` alone.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@playwright/test` | npm | years (latest published 2026-09-04) | 86M/wk | github.com/microsoft/playwright | OK | Approved |
| `@axe-core/playwright` | npm | years (latest 2026-08-11) | 15.6M/wk | github.com/dequelabs/axe-core-npm | OK | Approved |
| `axe-core` (existing dep) | npm | years (latest 2026-10-05) | 91M/wk | github.com/dequelabs/axe-core | SUS (`too-new`: newest version only) | Already installed at 4.13.0; no action; do not auto-bump |
| `@types/k6` | npm | DefinitelyTyped (latest 2026-09-29) | 2.1M/wk | github.com/DefinitelyTyped | SUS (`too-new`) | Optional; planner adds `checkpoint:human-verify` before installing |
| `k6` (npm) | npm | 2017 placeholder | 204k/wk | github.com/loadimpact/k6 | OK by seam, but WRONG tool | Do NOT install; k6 is the Go binary/Docker image |
| `neonctl` | npm | 8.0.11 published 2026-10-06 | 389k/wk | github.com/neondatabase/neon-pkgs | SUS (`too-new`: newest version) | Use via `npx` only, never a dependency; `checkpoint:human-verify` before first run |

**Packages removed due to SLOP verdict:** none.
**Packages flagged SUS:** `axe-core` (existing), `@types/k6`, `neonctl` — all are `too-new` flags on a freshly published latest version of long-standing packages from known orgs; no `postinstall` scripts (seam reported `postinstall: null`). Ecosystem: all npm, verified on the npm registry. Package names above were discovered via official docs (Next Playwright guide, Playwright docs, Neon docs) and the seam, not via search-only.

## Architecture Patterns

### System Architecture Diagram

```
                      LOCAL REHEARSAL (repeatable)                       STAGING (one signed run)
 seed-load script ──► Docker Postgres :5434 (licence_test-style throwaway)   Neon branch (from seeded base, NOT prod)
        │                    ▲                                                   ▲
        │              next build && next start (NODE_ENV=production)           Netlify deploy preview (env scoped to
        │                    ▲            │                                      deploy-preview context)
 k6 (Docker) ── 150 learner VUs + 10 staff VUs ──► HTTP ◄── Playwright probe (Chromium, 30+ samples/view)
 (cookie = seeded Session rows)                       │          records time-to-usable per core view
                                                      ├─► /api/health (DB ping) ◄── external uptime monitor (5 min)
 Playwright journey (Chromium/Firefox/WebKit) ────────┤
   register → verify(email capture) → pay(signed webhook) → learn → attend → submit → grade → certificate
                                                      │
 vitest + Testcontainers: bypass matrix (registry-driven), concurrency replays, integrity SQL checks
                                                      │
 scheduled tasks run via helper (tsx imports src/server/scheduled/*-task.ts) because Netlify scheduled
 functions do NOT run on deploy previews (docs.netlify.com scheduled-functions)
                                                      ▼
                       evidence JSON/CSV ──► ONE launch report + launch checklist (owners)
```

### Recommended Project Structure
```
.github/workflows/ci.yml            # lint+tsc | unit+component | integration (sharded) | audit
.github/dependabot.yml
e2e/                                # Playwright (outside tests/ so vitest globs ignore it)
  playwright.config.ts   support/{auth,seed-ids,email-capture,run-task,a11y}.ts
  journey.spec.ts  a11y-screens.spec.ts  responsive.spec.ts  perf-probe.spec.ts  screens.manifest.ts
perf/                               # k6 scripts: learner.js staff.js webhook-replay.js thresholds.js
scripts/load/seed-load.ts           # 150 learners + 10 staff + sessions (never run against .env)
scripts/ops/integrity-checks.ts     # read-only SQL assertions (also surfaced on ops page)
src/app/api/health/route.ts
src/app/staff/operations/page.tsx   # ops status page (nav entry = StaffShell/layout co-worker collision)
src/server/services/ops-status-service.ts  privacy-export-service.ts  privacy-anonymise-service.ts
src/server/auth/rate-limit.ts       # generalised, reuses LoginThrottle table
src/lib/format-lagos.ts             # D-17 single formatter
docs/runbooks/{deployment,rollback,job-recovery,restore}.md
.planning/phases/15-.../15-LAUNCH-REPORT.md  15-LAUNCH-CHECKLIST.md
```

### Pattern 1: Static inventory + behavioural matrix (D-09)
**What:** A pure-data registry (like `src/server/licence/registry.ts`) listing every `"use server"` export and every `route.ts` handler with its authorization class, plus an AST test that fails on unregistered or stale entries; then a real-Postgres matrix test iterates the registry.
**When:** NFR-05. **Why:** the existing registry is per service file (`RegistryKind = "withPermission" | "guard" | "continuity" | "system" | "licence" | "not-a-db-write"`), so it cannot enumerate actions; reuse its pattern and the AST tooling in `tests/support/licence-write-scan.ts` (verified: it finds permission call sites structurally).
**Example (shape):**
```typescript
// tests/support/authz-registry.ts  (pure data)
export type AuthzClass = "public" | "own-record" | { permission: string; scope: "GLOBAL"|"COLLECTION"|"RECORD" };
export const AUTHZ_REGISTRY = [
  { file: "src/app/staff/payments/actions.ts", export: "confirmManualPaymentAction",
    class: { permission: "payments.confirm", scope: "RECORD" },
    fixture: "paymentOrderFixture", states: ["PENDING","PAID"] },
] as const;
// tests/authz-inventory.test.ts: ts compiler API lists exported async fns of every file whose
// first statement is "use server" (47 files, ~131 exports) + every route.ts verb; fails on diff.
```

### Pattern 2: Request-scoped dedupe with React `cache()`
**What:** wrap `getActorBySessionToken` and `loadGrantsForUser` so one request reads session and grants once. Next documents this: "wrap your data access with the React `cache` function to deduplicate requests within a single render pass" (`02-guides/caching-without-cache-components.md:266`; example import at `01-getting-started/06-fetching-data.md:551`).
**Constraint:** request-scoped only; never a cross-request cache, or revocation (IAM-03/RBAC) stops being immediate. Measure first (Pitfall 4).

### Pattern 3: Quiet resend after the response (D-16)
**What:** `signIn` returns `{ ok:false, reason:"INVALID", unverified:true }` only when the password matches a `PENDING_VERIFICATION` account; the action calls `after(() => verificationService.resendVerification(email))` and returns the same neutral state. `after` runs after the response, available in Server Functions (`after.md`: "can be used in ... Server Functions"); Netlify's adapter supports `next/after` [CITED: Netlify Next.js overview, MEDIUM]. Verify the real password hash (not the decoy) so timing equals a matching-active account; keep `recordFailure` so guessing stays throttled; the 60 s `REQUEST_COOLDOWN_MS` already bounds mail volume.

### Pattern 4: Time-to-usable probe (D-03)
Navigate with `waitUntil:"commit"`, wait for the view's primary-content locator, read `performance.now()` in the page (relative to navigation start). Report p50/p75/p95 over 30+ samples per view while k6 holds background load. LCP/INP recorded as supporting data in Chromium only.

### Anti-Patterns to Avoid
- Calling the shared Neon DB from any script (`.env*`). Seed/load scripts must refuse to run unless `DATABASE_URL` host is `localhost`/`127.0.0.1` or a name on an explicit staging allow-list.
- A process-memory rate limiter (serverless instances do not share memory); use the DB table.
- Caching `/api/health` or computing availability from the app itself.
- Waiving critical audit findings (D-07). Hand-editing `.next` or committing `test-results/`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Load generation | Custom node loop | k6 with per-route thresholds | Percentiles, ramping, exit codes on threshold failure [CITED: grafana.com thresholds docs] |
| Real-browser timing/matrix | Puppeteer scripts | Playwright projects | Three engines, channels `chrome`/`msedge` [CITED: playwright.dev/docs/browsers] |
| Accessibility rules | Custom contrast/label checks | `@axe-core/playwright` tags `wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa` | Verified locally: `axe.getRules(["wcag22aa"])` returns `["target-size"]`; 70 rules across the A/AA tags |
| Rate-limit store | In-memory Map / new service | Existing `LoginThrottle` table + atomic upsert in `sign-in-throttle.ts` | Already concurrency-safe SQL (`INSERT ... ON CONFLICT DO UPDATE`) |
| Private file access | Proxying bytes | Existing presign helpers in `storage-service.ts` | Keys are `prefix/<id>/<randomUUID()>`, 60 s TTL for FILE/IMAGE |
| Uptime/availability | Self-hosted pinger | External free monitor | Must be independent of the system under test |
| Webhook signing in tests | New crypto | Pattern in gitignored `_tmp-uat-webhook.mjs` (HMAC-SHA512 `x-paystack-signature`) promoted into `e2e/support` | Prior art exists |
| Backup tooling | Custom scripts | Neon PITR branch + `pg_dump -Fc` / `pg_restore` | Vendor-documented flow |
| Data export packaging | New job system | Existing `ExportJob`/`ExportSnapshotRow` + `dispatch/process/expire-export-jobs` | RPT-04 states, TTL download already built |

**Key insight:** this phase should add very little new infrastructure; almost every NFR has an existing mechanism that needs inventory, a gap closed, and repeatable proof.

## A. Repo findings by area (read this session)

### A1. Performance harness
- `package.json`: `"test:perf": "vitest run --config vitest.perf.config.mts"`. `vitest.perf.config.mts` includes only `tests/**/*.perf.test.ts`, `fileParallelism: false`. The only matching file is `tests/export-snapshot-load.perf.test.ts` (25,000-row export persisted in under 10 s; near-25-MiB row). It is a Testcontainers service-level budget, NOT an HTTP/page benchmark. Keep it as the export budget; k6/Playwright live in separate dirs and scripts (`test:load`, `test:e2e`). The main vitest config excludes `*.perf.test.ts`.
- Seeding: `prisma/seed.ts` (1,345 lines) seeds 4 staff, 7 learners, a Programme of two Courses, a standalone Course, cohorts, sessions; password `"Passw0rd!dev"`. Not enough for D-02. Need `scripts/load/seed-load.ts`: precompute ONE scrypt hash and reuse it (hashing 160 accounts at N=131072 is slow), create 150 learners + 10 staff + enrolments + **`Session` rows with `sessionToken = sha256(rawToken)`** (`hashToken` in `src/server/auth/token-hash.ts`) so k6 authenticates with cookie `lms.session=<raw>`.
- k6 cannot easily POST Server Actions (needs `Next-Action` ids). So k6 = read-heavy page loads + route handlers + signed webhook replays; writes are exercised by the Playwright journey. A sign-in burst can be a separate optional scenario that replays the no-JS form POST (hidden `$ACTION_*` inputs) — spike it [ASSUMED].
- Load model [ASSUMED proposal, within Claude's discretion]: ramp 0→150 learner VUs over 2 min, hold 10 min, think time 5–15 s, journey dashboard → `/learn` → course home → lesson → lesson → results → sessions → `/support`; 10 staff VUs over `/staff` → cohorts → cohort → grading queue → `/staff/support` → `/staff/payments`. About 20–25 page loads/s plus RSC/asset requests.
- Windows: k6 via Docker Desktop reaches the host app at `host.docker.internal`; Docker memory cap 7.6 GB; host has 8 logical CPUs, so a laptop run is CPU-contended (load generator, Next server, Postgres, Chromium on one box). That is why D-01 signs off only the staging run.

### A2. Core authenticated views (from `find src/app -name page.tsx`, 81 pages, 39 dynamic)
- Learner/public/auth: `/dashboard`, `/learn`, `/learn/[enrolmentId]`, `/learn/[enrolmentId]/lessons/[lessonId]`, `/learn/[enrolmentId]/results`, `/learn/[enrolmentId]/sessions`, `/learn/calendar`, `/support`, `/support/new`, `/support/[reference]`, `/account`, `/notifications`, `/orders/[reference]`, `/checkout/[orderId]`, `/enrol/[cohortId]`, public `/courses`, `/programmes`, `/courses/[slug]`, `/verify-certificate`, `/verify/[verificationRef]`, auth pages.
- Staff: `/staff`, `/staff/cohorts`, `/staff/cohorts/[id]`, grading queue/detail, attendance, `/staff/enrolments`, `/staff/payments`, `/staff/reconciliation`, `/staff/support`, `/staff/reports`, `/staff/users`, `/staff/audit`, `/staff/certificates`, `/staff/courses/**`, `/staff/licence`.
- **Slow-spot candidates (code-verified):**
  1. `src/app/staff/layout.tsx` runs `Promise.all(NAV.map(... can(permission, {}) | canAnywhere(permission)))` over 16 nav items plus `can("licence.view")`, `can("licence.activate")`, profile, unread count, licence snapshot, temp-password check. Each `can()` calls `getCurrentActor()` (session+user query, `session-service.ts`) and `loadGrantsForUser()` (assignment query, `grant-service.ts`). Roughly 35–40 queries before any page content on every full staff page load. `.planning/codebase/CONCERNS.md` ("N+1 grant loading") named this; it is real and unmitigated.
  2. `getStaffQueue` (`ticket-staff-queue-service.ts`): `client.ticket.findMany` with no `where/take/orderBy`, then JS filter/sort/count; pure `buildQueueView` exists.
  3. `listPaymentsForStaff` (`payment-read-service.ts`): `order.findMany({ where: { cohort: cohortWhere } })` with `paymentAttempts` and no `take` → unbounded `/staff/payments`.
  4. `learner-access.ts`: `hasActiveEnrolmentCoveringCourse` loops `cohort.findUnique` + `cohortCourse.findFirst` per active enrolment; `canOpenLessonAsLearner` loops `loadLearnerPath` per active enrolment (hit by every lesson-resource download).
  5. Prisma client has no pool settings (`src/server/db.ts`: `new PrismaClient({ log })`); default pool per instance × many Netlify instances → Neon connection pressure. Neon pooled host (`-pooler`) accepts up to 10,000 client connections [CITED: neon.com/docs/connect/connection-pooling]; Neon says Prisma CLI migrations need the direct connection [CITED: neon.com/docs/guides/prisma]. `schema.prisma` datasource has only `url = env("DATABASE_URL")` (no `directUrl`).
  6. scrypt cost: `password.ts` N=131072, r=8, p=1 (about 128 MiB per hash, `maxmem` 256 MiB); fine steady state (sessions last `SESSION_TTL_DAYS = 7`) but a cohort-start sign-in burst is CPU/memory heavy; sign-in also pays a decoy hash for unknown users.
- Cheapest evidence-first method (no app change): run Postgres with `pg_stat_statements` (`-c shared_preload_libraries=pg_stat_statements`), `SELECT pg_stat_statements_reset()`, load ONE page, read `calls` per query; compare to a budget (e.g. staff page ≤ 12 statements). Then decide on `cache()`, pagination, SQL filtering.

### A3. Playwright and axe today
- Playwright is NOT installed. axe-core 4.13.0 only used via `tests/support/axe.ts` (`axeViolations(container)`: jsdom, rules `"color-contrast": { enabled: false }, region: { enabled: false }`) by 5 component tests (`email-log-table`, `email-preferences-panel`, `learner-support`, `notification-drawer`, `support-workspace`). Colour contrast and landmarks are therefore NOT currently proven anywhere automated. The 2026-10-05 31-screen axe audit used ad-hoc CDP scripts in the session scratchpad; the owner decided NOT to keep them (`UI-FIX-IMPLEMENTATION-PLAN.md`, T13), so D-13 creates the repeatable version.
- Design-contract tests (`tests/unit/design-contract.test.ts`) read source class strings via the TS parser; they constrain spacing/type classes only, so adding `data-*` attributes is safe.
- `tsconfig.json` includes `**/*.ts` and `**/*.mts`, and `eslint` lints the whole repo: `e2e/` and `perf/` files are typechecked/linted; add `@playwright/test` before they land and ignore `playwright-report/`, `test-results/` in `.gitignore`.
- Email capture seam (REQUIRED for D-08): `EMAIL_TRANSPORT=stub` returns only `{ providerMessageId: \`stub:${randomUUID()}\` }` (`src/server/email/brevo-client.ts:102-104`) and raw verify/reset tokens are hashed in the DB (`hashToken`) and exist only in the email. So the automated register→verify step cannot read the link. Options: (a) add `baseUrl` env override to `new BrevoClient({ apiKey })` (the SDK type has `baseUrl?: core.Supplier<string>`, seen in `node_modules/@getbrevo/brevo/dist/cjs/BaseClient.d.ts`) and run a tiny local HTTP mock that records payloads; (b) a capture transport (riskier: a mode that writes tokens somewhere). Recommend (a). Spike in Wave 0.
- WebKit pitfalls: sign-in sets `secure: process.env.NODE_ENV === "production"` cookies (`signin/actions.ts`); Playwright issue #43115 reports Secure cookies dropped over http for `127.0.0.1`/loopback while the `localhost` hostname works, and issue #39380 reports WebKit dropping `localhost` cookies during `storageState` restoration [CITED: github.com/microsoft/playwright issues, search results]. Use `http://localhost:3000` (never 127.0.0.1); for WebKit sign in through the UI per spec instead of `storageState`; if still failing, front the app with a local TLS proxy (Caddy `tls internal`).
- Playwright 1.63 requires Node 22/24/26, Windows 11+ [CITED: playwright.dev/docs/intro]; browser binaries about 281 MB chromium / 187 MB firefox / 180 MB webkit [CITED: browsers doc]. Run `workers: 1` locally; WebKit and Firefox only for journey/a11y/responsive, Chromium for timing.

### A4. Server actions, routes, bypass suite
- Registry facts [VERIFIED: `src/server/licence/registry.ts`]: `export type RegistryKind = | "withPermission" | "guard" | "continuity" | "system" | "licence" | "not-a-db-write";` per **service file** (about 65 entries, `const S = "src/server/services/";`). Boundary tests: `tests/licence-enforcement-boundary.test.ts` (writes found by `tests/support/licence-write-scan.ts`), `tests/licence-ui-mirror-gate.test.ts` (ConfirmModal classification via TS compiler API). Neither enumerates actions.
- Inventory: 47 files start with `"use server"` (131 `export async function`/`export const` matches). Actions are thin: zod-parse then call a service guarded by `withPermission` (e.g. `src/app/staff/payments/actions.ts` header: "Every export here is a public POST endpoint"). Learner actions use `getCurrentActor()` then own-record predicates (e.g. `createTicketAction`). Pre-auth actions: signIn/register/forgot/reset/verify.
- Next facts [CITED: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:78-85`, `data-security.md:281`]: an action "is reachable to anyone who can send the same POST"; CSRF Origin-vs-Host check; encrypted action ids; "even if a Server Action ... is not imported elsewhere ... it can still be called externally". Multi-instance deployments should set a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (`server-actions.md:85`); not seen anywhere in `src`: put on the Netlify env checklist [ASSUMED relevance].
- Driving tests: call the exported action function in vitest with `next/headers` mocked to a seeded session cookie (existing `tests/*-actions.test.ts` mock style). Actions are plain async functions, so this equals the POST path after the framework gate.
- Matrix per action (generated from registry): personas = anonymous, learner-other (wrong user), staff-no-permission, staff-wrong-scope (cohort-scoped grant on another cohort), staff-right + record-state variants (e.g. ARCHIVED/CANCELLED/PAID). Expect: `AuthenticationError`/`AuthorizationError` (or the action's mapped `{ok:false}`), no DB write, and an `authorization.denied` audit row for denials. About 131 × 5 = 650 cases; run against ONE Testcontainers DB and a shared fixture set to stay under minutes. The `withPermission` mechanism itself is already unit tested; the new value is per-action wiring (right permission string, scope resolver on the real record).
- Route inventory (all `route.ts` under `src/app`, 18 files):
  | Route | Verb | Authorization (as read) |
  |---|---|---|
  | `api/certificates/[id]/download` | GET | staff `certificates.view` else learner own (`getOwnCertificateForDownload`); all denials 404; 302 + `Cache-Control: private, no-store`; presign TTL `downloadTtlFor("FILE")` = 60 s |
  | `api/lesson-resources/[id]/download` | GET | staff `courses.view` else active enrolment; 404 on denial; 409 upload pending; TTL 60 s FILE/IMAGE, **14,400 s VIDEO** |
  | `api/submissions/[submissionId]/download` | GET | `getGradingDetail` (`submissions.view`, scoped from the submission's enrolment); 404 |
  | `api/ticket-attachments/[attachmentId]/download` | GET | service returns NotFound for no actor/non-READY/unauthorised; TTL "FILE" 60 s |
  | `api/staff/reports/exports/[jobId]/download` | GET | `exportDownloadService.getDownloadUrl` rechecks grants and expiry; TTL `EXPORT_DOWNLOAD_TTL_SECONDS` default 60 (clamped 30–120) |
  | `api/staff/licence/diagnostic` | GET | `licence.view` (Global only); 401/404; audited |
  | `staff/cohorts/[id]/exceptions/csv` | GET | `attendance.view`; returns 403 (inconsistent with the 404 denial-parity used elsewhere; decide and pin in a test) |
  | `api/lesson-resources` (GET), `/upload-intent`, `/[id]/complete`, `/[id]` (DELETE) | mixed | `withPermission`/`AuthenticationError` in files |
  | `api/ticket-attachments/upload-intent`, `/complete` | POST | actor in service |
  | `api/notifications`, `/unread`, `/preferences` | GET | `getCurrentActor` (own data) |
  | `api/webhooks/stripe`, `/paystack` | POST | public; signature verification (`verifyStripeWebhook` / `verifyPaystackWebhook`) |
  Also: `api/.../process-export-jobs-background` Netlify function checks `x-export-dispatch-secret` with `timingSafeEqual`, POST only, `{}` body, else 404.
- NFR-06 evidence: storage keys are `lessons/<lessonId>/<randomUUID()>`, `submissions/<enrolmentId>/<assessmentId>/<randomUUID()>`, `ticket-uploads/<ticketId>/<randomUUID()>` etc. (`storage-service.ts:73-158`) — unpredictable. Docker compose sets `mc anonymous set none` on the bucket. Production R2 bucket public-access setting is an OWNER check. VIDEO 4 h URL lifetime is a documented design (D-36) — owner to accept explicitly as "short-lived" or lower it.
- Routes with unprotected bodies (webhooks) belong to the registry as `public-signature` with tests: bad signature → 400/401 no write; replay → `WebhookEvent` unique `(provider, providerEventId)`.

### A5. Rate limiting
- State is in Postgres: `model LoginThrottle { key String @id; email String?; failures Int; windowStartedAt DateTime; ... @@index([email]) }` (`schema.prisma:422`), updated by atomic raw SQL `INSERT ... ON CONFLICT ("key") DO UPDATE` in `recordFailure` (`sign-in-throttle.ts`). Correct on serverless (no memory state). Verbatim limits: `export const THROTTLE_WINDOW_MINUTES = 15;` `export const THROTTLE_LIMITS = Object.freeze({ perIpAndEmail: 5, perIp: 20 });`. IP comes only from `x-nf-client-connection-ip` or the header named by `TRUSTED_CLIENT_IP_HEADER` (`clientIpFrom`); null falls back to address-only keys.
- `request-cooldown.ts`: `export const REQUEST_COOLDOWN_MS = 60_000;` pure `isInCooldown(lastIssuedAt, now)`. Used by `issueToken` in `verification-service.ts` (per identifier+purpose, from `VerificationToken.createdAt`); `resendVerification`/`requestReset` already return one neutral value. So resend/forgot are already per-address cooled down but have NO per-IP limit.
- Code paths for D-11: `src/app/(auth)/register/actions.ts` → `registrationService.registerLearner`; `forgot-password/actions.ts` → `passwordResetService.requestReset`; `verify/actions.ts` → `verificationService.resendVerification`; public certificate check is a GET page `src/app/verify/[verificationRef]/page.tsx` → `verifyCertificateByRef` (page documents "Exactly three render branches" — a throttled response needs a deliberate 4th neutral branch + design-contract check); ticket creation is authenticated (`createTicketAction` → `createOwnTicket`), so key it by `userId`, not IP.
- Recommended approach: generalise to `rate-limit.ts` with scoped keys (`reg:ip:<ip>`, `reset:ip:<ip>`, `resend:ip:<ip>`, `verify-cert:ip:<ip>`, `ticket:user:<id>`) in the same table, a `recordAttempt` (count every request, not only failures) beside `recordFailure`, pure `isRateLimited(keys, rows, now, limits)` like `isThrottled`, tests in the style of `tests/sign-in-throttle.test.ts` plus one real-Postgres concurrency test. Return the same neutral state shape the actions already use.
- **Pitfall:** per-IP limits must be generous: mobile carriers/NAT put many learners behind one IP (all 150 k6 VUs on staging share one IP too). Use strict per-address/per-user limits and loose per-IP limits (e.g. 60 per 15 min), plus a documented staging override via env only in non-production [numbers ASSUMED].
- Housekeeping gap (NFR-11): nothing purges `LoginThrottle` rows (only `deleteMany` in `clearAddressKeys`), expired `Session` rows, or consumed `VerificationToken` rows. `Session.ipAddress/userAgent` columns appear unused.

### A6. Audit and observability
- Audit sink: `src/server/services/audit-service.ts` (`recordAudit`, `recordAuditInTransaction`, redaction of keys `passwordHash`, `password`, `sessionToken`, `token`, `secret`). Model `AuditEvent { actorId, actorType, action, targetType, targetId, scopeType, scopeId, before, after, reason, outcome, correlationId, ipAddress, createdAt }` — covers time/actor/target/action/outcome/correlation/context. 48 service files import the audit functions; about 100 distinct action strings (enrolment.*, payment.*, refund.*, grade.*, certificate.*, export.*, licence.*, user.*, role.*, authorization.denied, domain_event.poisoned, email.resent, ...).
- Gaps vs NFR-07 (all by grep of `action:` strings and imports): no audit rows for sign-in success/failure/throttled, sign-out, rate-limit hits, certificate download/verification, webhook signature failures (those go to `WebhookEvent.status`), or privacy export/anonymise (new). `correlationId` is populated in only a few paths (`checkout-service` randomUUID, mappers via `buildCorrelationId`); most rows leave it null. Audit append-only is application-level (no DB trigger/REVOKE found in migrations/sql) — optional hardening: `REVOKE UPDATE, DELETE` or a trigger.
- Failure observability exists but is scattered: email failures notify `audit.view` holders in-product (`email-failure-alert-service.ts`) and are listed at `/staff/email-log` (`audit.view`); domain event poison is audited (`domain_event.poisoned`); reconciliation cases at `/staff/reconciliation`.
- Ops page data sources (D-18, no new tables):
  - Failed jobs: `ExportJob.status = FAILED` with `error/errorCode/errorMessage`; stuck `QUEUED/PROCESSING` older than N min; `DomainEvent` with `attempts > 0` and `processedAt` null (retrying) or `processedAt` and `lastError` both set (poison); oldest unprocessed `DomainEvent.occurredAt` (drain staleness); `EmailDispatch.status IN ('FAILED')`, `attempts`, `nextAttemptAt`, stale `SENDING` (`STALE_SENDING_MS = 10 * 60 * 1000`).
  - Payment exceptions: `Order.status = EXCEPTION`; `PaymentAttempt.status IN (PENDING_MANUAL_REVIEW, FAILED)` and `PROCESSING` older than N; `WebhookEvent.status IN (EXCEPTION, SIGNATURE_INVALID)` and `RECEIVED` older than N; `ReconciliationCase.status IN (OPEN, REOPENED)` by `risk`; `Refund.status = FAILED`.
  - Verbatim enums [VERIFIED: schema.prisma]: `enum JobStatus { QUEUED PROCESSING SUCCEEDED FAILED EXPIRED }`; `enum WebhookStatus { RECEIVED PROCESSED DUPLICATE SIGNATURE_INVALID EXCEPTION }`; `enum OrderStatus { PENDING PAID FAILED CANCELLED REFUNDED PARTIALLY_REFUNDED EXCEPTION }`; `enum PaymentStatus { PENDING PROCESSING SUCCEEDED FAILED CANCELLED PENDING_MANUAL_REVIEW }`; `enum RefundStatus { REQUESTED PROCESSING COMPLETED FAILED RECORDED_MANUALLY }`; `enum ReconciliationCaseStatus { OPEN RESOLVED REOPENED }`. Constants: `MAX_SEND_ATTEMPTS = 5`, `MAX_EVENT_ATTEMPTS = 3`.
  - NOT available: whether a scheduled function RAN. There is no job-run heartbeat table; tasks only `console.log("[scheduled] ...")`. Use staleness signals instead (oldest unprocessed event, oldest QUEUED export, `LicenceState.lastVerifiedAt`, last `EmailDispatch.lastAttemptAt`). If the owner wants true heartbeats, it is a schema migration (Open Question 6).
  - Permission: reuse `audit.view` (Global) as the gate (same as the email log) to avoid a new permission, which per `catalogue.ts` is a product decision.
- Job inventory [VERIFIED: `netlify/functions/*.ts` `schedule:` lines]: `check-licence` `"0 * * * *"`; `cleanup-notifications` `"0 3 * * *"`; `cleanup-stale-uploads` `"0 * * * *"`; `close-resolved-tickets` `"15 * * * *"`; `dispatch-export-jobs` `"* * * * *"`; `drain-domain-events` `"* * * * *"`; `expire-export-jobs` `"*/15 * * * *"`; `reconcile-payments` `"*/15 * * * *"`; `release-expired-holds` `"*/5 * * * *"`; `process-export-jobs-background` is `{ background: true }` (POST with secret). `docs/deployment/netlify-scheduled-functions.md` documents only 3 (release-expired-holds, cleanup-stale-uploads, check-licence); the other 6 scheduled jobs have NO runbook. Netlify: scheduled functions have a 30-second limit, run in UTC, and "won't trigger" on deploy previews or branch deploys; "Run now" and `netlify functions:invoke` exist [CITED: docs.netlify.com/build/functions/scheduled-functions].
- Error-rate: Next's `instrumentation.ts` may export `onRequestError(err, request, context)` (`03-file-conventions/instrumentation.md:36-70`); the repo's `src/instrumentation.ts` exports only `register`. A structured, PII-free `console.error(JSON.stringify({route, routeType, digest}))` satisfies "error-rate visible in host logs" without a vendor [recommendation].

### A7. Idempotency and integrity (NFR-03/13/14)
| Flow | Existing guard (verified in schema/code) | Tests that prove it | Gap |
|---|---|---|---|
| Payments | `Order.idempotencyKey @unique`, `PaymentAttempt.idempotencyKey @unique`, `WebhookEvent @@unique([provider, providerEventId])`, `FOR UPDATE` in `checkout-webhook-system-service.ts` and `refund-service.ts` | `checkout-webhook.integration`, `paystack-webhook.integration`, `checkout-hold-race.integration`, `payment-reconciliation.integration` | No true concurrent same-event replay (Promise.all count 0 in webhook tests): add k6/vitest 10× concurrent replay |
| Enrolment activation | Partial unique index (migration `20260919120000_enrolment_one_live_per_learner_cohort`), `FOR UPDATE` in `enrolment-service.ts`, `seat-accounting.ts` | `enrolment-live-index`, `enrolment-service.integration` (3 Promise.all) | — |
| Submissions / attempts | `@@unique([assessmentId, enrolmentId, attemptNumber])` on Attempt and Submission, `receiptId @unique` | `submission-service.integration` (1 concurrent case) | `attempt-service.integration` has no concurrency/replay case |
| Grading | NO unique constraint on `Grade` (only indexes); `grading-service.ts` does `findFirst({ submissionId })` then write, no `FOR UPDATE` | `grading-service.integration` (no concurrency) | Concurrent double-grade could create two rows [ASSUMED until a two-caller test is run] |
| Completion | `CompletionRecord` only `@@index([enrolmentId, scope])`; `applyVerdict` is find-then-create (`completion-service.ts:383`) | learner-journey sequential double-mark | Candidate partial unique index `(enrolmentId, scope, COALESCE(courseId,'')) WHERE supersededAt IS NULL`; verify with a concurrency test first [ASSUMED] |
| Certificate issuance | partial unique one ACTIVE per enrolment+scope; `supersedesId @unique`; `verificationRef @unique` | `certificate-concurrency.integration` (2 cases) | — |
| Notification dispatch | `EmailDispatch @@unique([template, correlationId])`; `Notification @@unique([recipientId, type, sourceEventId])`; drain uses `FOR UPDATE` | drain integrations, `notification-service.integration` | — |
| Export creation | `ExportJob.idempotencyKey @unique`, `ExportSnapshotRow @@unique([jobId, ordinal])`, `FOR UPDATE` in worker | `export-service.integration` (8 idempotency refs), `export-worker.integration` | — |
| Credentials | see certificates; `Account` unused | — | — |
- Reconciliation checks beyond payments do not exist. Recommend `scripts/ops/integrity-checks.ts`: read-only SQL returning violating rows, run in CI against the seed and surfaced on the ops page: PAID order without SUCCEEDED attempt; ACTIVE enrolment whose order is unpaid; more than one live enrolment per learner+cohort; more than one open CompletionRecord per (enrolment, scope, course); more than one Grade per submission; ACTIVE certificate without completion; enrolment counts above cohort capacity; DomainEvent backlog age.
- Folded todo 1 (support queue): keep `buildQueueView` as a pure oracle and add a differential test comparing the SQL version with it on a seeded set; existing `staff-support.integration.test.ts` and queue unit tests stay. Tab counts via `groupBy`; text search `contains` with `mode: "insensitive"` on reference/subject/user name/email (needs index review); ordering is priority rank then `updatedAt` then reference (priority is an enum: order via SQL CASE or a computed rank).
- Folded todo 2: one small change set in `ArrangeClient.tsx`, `ProgrammeArrangeClient.tsx`, `LessonEditorClient.tsx`: `handleRestore` try/catch/finally; add an `isNextControlFlowError` rethrow guard to the 7 bare `catch {}`; clear `withdrawing/withdrawOpen` on the success path; extend `arrange-client.test.tsx`, `programme-arrange-client.test.tsx`, `lesson-editor-client.test.tsx`. Co-worker owns shared primitives but these three are feature clients; confirm no overlap.

### A8. Security baseline
- Hashing: scrypt N=131072, r=8, p=1, 16-byte salt, 64-byte key, parameters stored in the hash (`password.ts`); timing-safe compare; malformed hash fails closed.
- Sessions: DB sessions, token stored as SHA-256 (`token-hash.ts`); cookie `SESSION_COOKIE = "lms.session"`, `SESSION_TTL_DAYS = 7`, `httpOnly`, `sameSite: "lax"`, `secure` in production (`signin/actions.ts`).
- Headers (`next.config.ts`): CSP `"frame-ancestors 'none'; object-src 'none'; base-uri 'self'"` (deliberately no `script-src`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `Permissions-Policy`, `poweredByHeader: false`. No `proxy.ts`/`middleware.ts` exists. A nonce-based `script-src` is a separate decision (documented in the file), not in scope.
- Input validation: zod 4 in actions (strict objects, `.strict()` on payment actions).
- Secrets: env-driven (`process.env.*` list: STRIPE_*, PAYSTACK_*, S3_*, BREVO_API_KEY, EXPORT_DISPATCH_SECRET, TRUSTED_CLIENT_IP_HEADER, EMAIL_*, APP_BASE_URL, SUPPORT_CONTACT_EMAIL, EXPORT_DOWNLOAD_TTL_SECONDS, APP_VERSION). `docker-compose.yml` still passes `AUTH_SECRET`/`AUTH_URL` which no `src` file reads (stale; check in runbook). `.env.example` unreadable here (A1).
- **Dependency scanning [VERIFIED: ran `npm audit --omit=dev` this session]:** `next 16.2.0 - 16.3.5 — Severity: critical — Next.js: Remote Code Execution in next/og ImageResponse — GHSA-vcvr-r3jv-pc5j — fix ... next@16.3.8` and `source-map-js 1.0.0 - 1.2.1 — Severity: high ... fix available via npm audit fix`; metadata `{"info":0,"low":0,"moderate":0,"high":1,"critical":1,"total":2}`. `grep` found no `next/og`/`ImageResponse` use in `src`, so exploitability is low, but the gate is red and D-07 bars waiving critical. `next` and `eslint-config-next` are exact-pinned `16.3.4` in package.json; `npm view next@16.3.8` confirms the version exists. AGENTS.md rule: read `node_modules/next/dist/docs/01-app/02-guides/upgrading/` before the bump; run the Next-touching tests in batches afterward.
- Dependabot must respect pins: `tests/aws-sdk-lockfile.test.ts` requires `@aws-sdk/lib-storage` exactly `3.1125.0` and siblings `^3.1125.0`; `stripe 22.6.1` and `@tiptap/extensions 3.31.0`, `pdf-lib 1.17.1`, `@pdf-lib/fontkit 1.1.1` are exact. Add `ignore` for those and for majors of `next`, `react`, `react-dom`, `prisma`/`@prisma/client`, `typescript`; use `cooldown`.

### A9. Dates and time zones (D-17)
- Central module `src/lib/format-timestamp.ts`: `formatTimestamp`, `formatDateOnly`, `formatDateShort`, `formatDateTimeShort`, all `en-GB` with `timeZone: "UTC"` (comment: deterministic server/client to avoid hydration mismatch). Call sites: 45 `formatTimestamp`, 10 `formatDateShort`, 5 `formatDateTimeShort`, 1 `formatDateOnly` across 22 files. Plus 52 ad-hoc `Intl.DateTimeFormat`/`toLocale*String` uses outside `src/lib`, 20 of them `timeZone: "UTC"`. Learner support UTC: `src/components/support/ticket-labels.tsx:40-44` renders `{text} UTC`; `src/app/(learner)/support/[reference]/LearnerTicketDetail.tsx:61` is UTC. Cohort-local formatting (`utcToWallParts` in `src/lib/timezone.ts`, `cohort-datetime.ts`) is used on dashboards and session pages. The licence module has its own display formatters on purpose (purity tests).
- **Verified locally (Node 24.6):** `new Intl.DateTimeFormat("en-GB", {timeZone:"Africa/Lagos", ..., timeZoneName:"short"})` prints `5 Oct 2026, 14:30 GMT+1`, NOT "WAT"; `en-NG` prints `WAT`. Browser ICU data differ, so DO NOT rely on `timeZoneName`. Recommended: one `formatLagos(date)` = `en-GB`, `timeZone: "Africa/Lagos"`, `day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", hourCycle:"h23"` plus a literal `" WAT"` (Africa/Lagos has no DST; `timezone.ts` already notes this). Output `5 Oct 2026, 14:30 WAT` exactly as D-17 shows.
- Tests pinning current formats (to update): `tests/components/support-workspace.test.tsx` (lines 97 and 155 expect "UTC"), `tests/components/cohort-cards.test.tsx` (builds the expected string with UTC), `tests/notification-text.test.ts` (Lagos calendar-day grouping, likely unaffected), `tests/report-registry.test.ts`, `tests/certificates-landing-page.test.ts`, `tests/timezone.test.ts`, calendar tests. Find all with `grep -rn "UTC" tests` before editing.
- Ambiguity for the planner/owner (Open Question 4): D-17 says Lagos everywhere, but cohort pages deliberately show the cohort's own zone (default `Africa/Lagos`). Recommendation: staff/learner audit-style timestamps → Lagos+WAT; session schedules stay in the cohort zone with its label.
- Collision: touches about 22+ files including components the co-worker edits; do it as one mechanical pass with a single owner.

### A10. Unverified sign-in (D-16)
- Path: `signInAction` (`src/app/(auth)/signin/actions.ts`) → `auth-service.signIn`. The branch `if (!user || !user.passwordHash || user.status !== "ACTIVE")` verifies a decoy hash, records a failure, returns `INVALID`. `UserStatus` is `PENDING_VERIFICATION | ACTIVE | DEACTIVATED`. Neutral message today: "Those details do not match an account." (pinned by `tests/components/signin-form.test.tsx`: `toContain("do not match")`).
- Hook: in that branch, when `user?.status === "PENDING_VERIFICATION" && user.passwordHash`, verify against the REAL hash (equal cost to the decoy), and only if it matches return `unverified: true`; the action runs `after(() => verificationService.resendVerification(email))`. Never resend on a wrong password (prevents mail-bombing someone else's inbox). The existing cooldown (60 s) plus D-11 per-IP limit bound volume. Tests: service unit (same result shape for unknown/pending/wrong), integration (one email queued after response, none for wrong password), response equality. `tests/identity-security.integration.test.ts` already covers sign-in; extend it.
- Open point: passwordless "contested registration" accounts have `passwordHash = null` (F-11); they stay on the decoy path.

### A11. Privacy tools (D-12 / NFR-11)
- Personal-data inventory [VERIFIED: schema.prisma]: `User` (`email`, `name`, `phone`, `passwordHash`, `pendingEmail`, `learnerNumber`, `emailVerified`, `failedLoginAttempts`, `lockedUntil`, deactivation fields), `Account` (provider tokens, unused), `Session` (`ipAddress`, `userAgent`), `LoginThrottle` (`key` holds IP/email, `email`), `VerificationToken` (`identifier` = email), `PolicyAcceptance` (consent evidence), `EmailDispatch` (`toEmail`, `error`), `Notification`, `EmailPreference`, `Ticket`/`TicketMessage.body`/`TicketAttachment` (free text, files), `Submission` (files), `Certificate.learnerName` (snapshot; public verification shows the display name), `AuditEvent` (`ipAddress`, `before/after` JSON may contain email/name), `ExportJob`/`ExportSnapshotRow.data` (CSV snapshots), `Order`/`PaymentAttempt`/`Refund` (financial records; reference the user id), `Enrolment`, `Grade`, `AttendanceRecord`.
- Retain (legal/financial/integrity): orders, payment attempts, refunds, webhook events, audit events, certificates (and verification), grades/completion. Anonymise in place on the `User` row: `name` → placeholder, `email` → `anonymised-<id>@invalid.example`-style unique value, `phone/pendingEmail` → null, `passwordHash` → null, `status` → `DEACTIVATED`, revoke all sessions, delete `Account`, `EmailPreference`, `Notification`, `VerificationToken` by identifier, `LoginThrottle` by email. Questions needing owner policy: `Certificate.learnerName` (keep = credential stays verifiable but name persists; change = credential no longer matches the person), ticket bodies/attachments, submissions, `learnerNumber`, and audit `before/after` JSON (append-only; do not rewrite). Make the policy choices explicit parameters in the tool and in the launch checklist, default = most conservative (retain records, anonymise identity fields, no deletion).
- Export tool: reuse `ExportJob` states and TTL download; add a learner-subject dataset (single-user, multi-table) rather than a report dataset (`REPORT_DATASETS` are collection reports with `scopePolicy`). Output must exclude `passwordHash`, token hashes, internal staff-only ticket messages (`visibility INTERNAL`), and other users' data. Async via existing job mechanism with `idempotencyKey`.
- Permissions: catalogue is closed (`PERMISSIONS` tuple; adding is "a product decision" requiring approval). Options: (a) approve new `privacy.manage` (Global-only via `GLOBAL_ONLY_PERMISSIONS`, like `licence.*`) — requires catalogue, `LICENCE_PERMISSION_EFFECT` classification (write), `permission-groups.ts` UI grouping, role seed/default roles decision, and tests; (b) reuse `users.manage` (+ `audit.export` for export). Recommend (a) as the least-privilege answer but flag as Open Question 5 (needs the approval path).
- Licence interplay: the new actions are writes → default effect "write" → blocked in restricted mode; that is acceptable for anonymise; export of a person's own data arguably should be continuity (LIC-08: "permitted export/data-access route"). Decide per action and register in `effects.ts`/registry tests.
- Nothing in the code does hard deletion; keep it that way (a test asserting no `delete`/`deleteMany` on User in the new services).

### A12. Runbooks and go-live (NFR-12)
- Existing: only `docs/deployment/netlify-scheduled-functions.md` and `provider-tools/licence-issuer/{README,RUNBOOK}.md`. README still says "Deploy on Vercel" (stale boilerplate). No deployment, rollback, job-recovery, restore, incident or secret-rotation runbook. No `netlify.toml` in the repo (build settings live in the Netlify UI): runbook must record the build command, Node version and env scoping.
- Production target: `UAT-FIXES-AND-ADDITIONS.md` "Before production": "Production runs on Netlify with a Neon database; the Docker stack is for local testing only." `docker-compose.yml`'s header says the client self-hosts. Conflicting; treat Netlify+Neon+R2 as primary and confirm (Open Question 8). The Docker app service has no `healthcheck` and ships no scheduler (doc "Hosting note").
- Runbooks to write (docs-only, human-verified): deploy and migrate order (migrations first, using the Neon DIRECT connection string for `prisma migrate deploy`), rollback (Netlify "publish previous deploy"; migrations are forward-only, so rollback = restore-or-compat plan; stale open tabs may hit missing Server Actions after a deploy [ASSUMED]), job recovery per job (re-run via Netlify "Run now" / helper script; poison events: `domain_event.poisoned`; failed exports: Retry in Export History; failed emails: resend from email log; stuck webhook: reconciliation), restore, secret rotation, incident route.
- Go-live items (from the prerequisites todo and UAT doc): apply FOUR Neon migrations (`20261001120000_licence_deployment_control`, plus `20261003120000_mark_pre_notification_event_backlog_processed` which must run BEFORE the email sender first runs in production, `20261004120000_user_password_is_temporary`, `20261004150000_learner_numbers`); production licence key into `PRODUCTION_TRUSTED_KEYS` (`src/server/licence/trust-set.ts`, a code release) then activate one real licence; confirm `check-licence` runs; regenerate `.docx` twins (gitignored `*.docx` and `docs/reference/*.md`); manual a11y checks of licence screens; `/gsd-verify-work 14`; seed re-run if seeded before 2026-09-20; `SUPPORT_CONTACT_EMAIL` set on Netlify; learner number pattern decision; staff override for pre-A-01 quiz passers. All are OWNER items.

## B. External tooling (current as of 2026-10-06)

### B13. k6, p75, availability
- k6 v2.3.0 [VERIFIED gh api]. v2.0 changes relevant here [CITED: GitHub releases page]: module path `go.k6.io/k6/v2`; percentiles outside 0–100 fail parsing; Docker image no longer auto-starts the HTTP API (irrelevant to CLI runs). Threshold syntax [CITED: grafana.com thresholds]: `http_req_duration: ["p(75)<2500"]`, tagged sub-metrics `'http_req_duration{page:dashboard}': ['p(75)<2500']`, `abortOnFail` with `delayAbortEval`; failing thresholds exit non-zero.
- Auth: the app has NO auth library (custom DB sessions, not Auth.js — `auth-service.ts` header). Cookie is `lms.session`. Seed Session rows and pass the cookie (`http.cookieJar().set(...)` or `headers: { Cookie }`); tag every request with `page:<name>`. Staff and learner VUs use different token pools.
- Measurement split: k6 gives server-side document timings and error rate under load; **Playwright** gives time-to-usable-primary-content (the NFR-02 p75). Use `data-primary-content` (or equally stable role/`data-testid`) on the main container of each core view; add it once in the shared page headers/shells only after co-worker agreement, otherwise locate by role/heading per view in the spec. Network profile: PRD says "supported network profile" but never defines one; propose a Chromium CDP throttle ("regular 4G") for the signed staging run [ASSUMED; Open Question 3].
- Statistics: at least 30 samples per view for p75; report p50/p75/p95; run order randomised; discard the first warm-up request but also report cold-start separately on staging (Netlify cold starts, Neon scale-to-zero resume).
- Availability: 99.5% of a 30-day month allows 216 minutes of downtime (0.5% × 43,200); 31 days = 223.2 minutes. Health endpoint: `GET /api/health` route handler (uncached by default per `15-route-handlers.md` "Route Handlers are not cached by default"), returns `200 {"status":"ok"}` after a `SELECT 1` with a 2 s timeout, `503 {"status":"degraded"}` otherwise, headers `Cache-Control: no-store`; no version, no secrets, no stack. Do not add to staff nav; no auth. Keep detail on the ops page. Monitors: UptimeRobot free = 50 monitors, 5-min interval, email alerts, 1 status page, 3-month retention, "Good for hobby and non-profit projects" [CITED]; Better Stack free = 10 monitors, email/Slack alerts, 1 status page [CITED]. A GitHub Actions cron (min 5 min, best-effort) is a free secondary check [ASSUMED]. Owner chooses and owns the monitor account (launch checklist).

### B14. Neon backup, PITR, dump
- Plan facts [CITED: neon.com/docs/introduction/plans and /pricing]: Free = history "6 hours", 10 branches, 100 CU-hours/project/month, scale-to-zero after 5 min that "cannot be turned off", 1 GB/project; Launch = history up to 7 days, scale-to-zero configurable, `$0.106/CU-hour`; Scale = up to 30 days, 25 branches.
- **Implication for NFR-01/NFR-08 (Pitfall 1):** per-minute schedules (`drain-domain-events`, `dispatch-export-jobs`) keep compute awake; always-on 0.25 CU is about 182 CU-hours/month (0.25 × 730) [arithmetic; assumes 0.25 CU minimum, ASSUMED] against 100 on Free. A 6-hour history window also cannot satisfy "RPO 24h" by itself. Production needs a paid plan (or a daily external `pg_dump`). Which plan production uses is unknown (Open Question 2).
- PITR safely: `neonctl branches create --name restore-rehearsal --parent <branch>@<RFC3339 timestamp>` creates a NEW branch at that time without altering the source [CITED: neon.com/docs/reference/cli-branches]; in-place `branches restore` rewrites a root branch and auto-creates `<branch>_old_<timestamp>` [CITED: neon.com/docs/guides/branch-restore] — do NOT rehearse in place on production. Time travel assist can check data first. Connection strings stay stable on restore.
- Dump route [CITED: neon.com/docs/manage/backup-pg-dump]: use the UNPOOLED connection string; `pg_dump -Fc -v -d "<url>" -f x.dump`; `pg_restore -v -d "<url>" x.dump`; client major version should match the server. Host `pg_dump` is 18.0 here; run dump and restore from `postgres:<neon-major>-alpine` containers (`docker run --rm postgres:16-alpine pg_dump ...`) and restore into a matching throwaway container. The existing Docker DB is `postgres:16-alpine` on port 5434; do not restore into `licence_test` — use a fresh container/port.
- Evidence to record (script it, write JSON): timestamps for start/end of each step, dump size, restore duration, row counts for key tables before/after, one integrity-checks run on the restored DB, one smoke login against the restored DB. RTO = (restore finished + app pointed + smoke passes) − incident start; RPO = incident time − latest restorable point. Object storage: DB rows reference R2 keys (certificates, submissions, lesson files); Cloudflare R2 has no native object versioning (search result, MEDIUM) so a bucket-level backup/lock route is an owner/ops decision (Open Question 7). Restore rehearsal is incomplete without a statement about files.

### B15. Netlify previews on a Neon branch (D-01)
- Env vars are scoped per deploy context (`production`, `deploy-preview`, `branch-deploy`); UI/CLI scoping must include "Builds" for build-time access; `CONTEXT`, `DEPLOY_PRIME_URL`, `URL` are read-only provided variables [CITED: docs.netlify.com env variables]. Set `DATABASE_URL`, `APP_BASE_URL`, `S3_*` (a SEPARATE staging bucket), `STRIPE_*`/`PAYSTACK_*` TEST keys, `EXPORT_DISPATCH_SECRET`, `EMAIL_TRANSPORT`, only in the deploy-preview scope; production values must not be inherited. `process.env.DEPLOY_PRIME_URL` and `URL` already appear in `src`.
- Scheduled functions do not run on previews (30-second limit, UTC). The staging run must therefore execute tasks itself: a helper that imports `src/server/scheduled/*-task.ts` with `DATABASE_URL` set to the staging Neon branch (never prod), or Netlify "Run now". Stage-journey steps depending on drain/dispatch jobs (emails, notifications, export jobs) call the helper between steps.
- Neon branch for staging: create from a seeded BASE branch, not from production once real learner data exists (privacy). Neon guides show a GitHub Actions flow that creates a branch per preview and deletes it on PR close [CITED: neon.com/guides/preview-deploys-netlify]; for a single signed run, create the branch manually.
- Cost/safety: Netlify credit plans — Free = 300 credits/month hard limit, site pauses when exhausted; costs include 10 credits/GB-hour functions compute, 2 credits per 10,000 web requests, 20 credits/GB bandwidth; "Deploy previews: Free (not metered)" refers to deploy operations; usage appears to be team-pooled [CITED: docs.netlify.com credit-based pricing; pooling INFERRED]. A 150-VU run could burn a large share of a month's credits and could pause production if the team shares the pool: ramp a 10% pilot run first, check the usage page, keep static assets out of the load (k6 requests documents only), or use a separate team/site for staging [rough estimate ASSUMED]. Open Question 2.
- Prisma + Neon pooled URL: use the `-pooler` host for the app and the direct host for migrations [CITED]. Neon docs say `pgbouncer=true` is no longer needed; Prisma community guidance still sets `connection_limit=1` on serverless (search results, MEDIUM) — spike `connection_limit` under the staging load and record the effect.

### B16. GitHub Actions and Dependabot (D-10)
- Public repo (`KQ-NEXUS/Learning-Management-System`, default branch `main`, working branch `develop`): standard hosted runners free [CITED]. Do not use `pull_request_target`; no secrets for fork PRs.
- Node: Dockerfile uses `node:22-alpine`; local is 24.6; Playwright 1.63 supports 22/24/26; `@types/node` is `^20`. Use Node 22 in CI to match the shipping image [recommendation].
- No Postgres service container is needed: integration tests start Postgres through Testcontainers (`tests/support/pg.ts`), and Docker is preinstalled on GitHub's Ubuntu runners [ASSUMED]. Jobs:
  1. `static`: `npm ci` (postinstall runs `prisma generate`), `npm run lint`, `npx tsc --noEmit`.
  2. `unit`: `npx vitest run --project node --exclude "**/*.integration.test.ts"` and `--project components`; whole-tree scan tests with `--testTimeout=60000`.
  3. `integration`: matrix shard `--shard=${{ matrix.n }}/4` over `**/*.integration.test.ts` (64 files, each starting a container; keep `--no-file-parallelism`).
  4. `audit`: `npm audit --omit=dev --audit-level=high`.
  5. `e2e` (nightly/manual, not per PR): build, seed, Playwright Chromium.
- Dependabot (`.github/dependabot.yml`, version 2): ecosystems `npm`, `github-actions`, `docker` (Dockerfile) and `docker-compose` (compose file) [CITED: docs.github.com dependabot options]; weekly/monthly, `open-pull-requests-limit`, `groups`, `cooldown` (default-days 3, semver-major-days 7), `ignore` for the pins in A8. CI will be RED on day one until `next` is bumped (ordering).

### B17. Accessibility proof
- Use `@axe-core/playwright` 4.13.0 (shares installed axe-core). Tags: `["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]`. In the repo's axe 4.13.0 the only WCAG 2.2 AA-tagged rule is `target-size` (2.5.8) [VERIFIED: ran `axe.getRules(["wcag22aa"])` locally], disabled by default in the rule docs ("disabled by default, until WCAG 2.2 is more widely adopted" [CITED: axe rule-descriptions]); tag selection should run it — confirm in a Wave-0 spike with a deliberately small button [ASSUMED]. Expect it to flag the already-known sub-24px inline table links (CONTEXT Deferred item) → decide: fix the links or waive `target-size` per element with expiry (not a "critical security" item, so D-07 waiver allowed).
- Colour contrast and landmark (`region`) rules run in a real browser (disabled in the jsdom helper). Run each screen in light state at 1440 and 390 widths, plus key error and empty states (failed sign-in, empty New course form).
- Screens manifest: `e2e/screens.manifest.ts` listing route templates + persona + seeded params for all 81 `page.tsx`; a vitest scan (AST/glob like the bypass inventory) fails when a `page.tsx` is missing from the manifest, so new pages cannot be forgotten. Baseline list from the 2026-10-05 audit: 31 screens.
- Responsive/zoom scripting: viewports 320×640, 360, 390×844, 768, 1024, 1280, 1920×1080 per primary page/form; assert `document.documentElement.scrollWidth <= clientWidth` (deliberate data tables excepted via an allow-list). 200% zoom of a 1280×720 window = 640×360 CSS px viewport; WCAG reflow (1.4.10) = 320 CSS px wide [emulation approach ASSUMED, standard practice]. PRD §15.3 default minimum is 360 px; D-15 is stricter.
- Keyboard walkthrough: Playwright `page.keyboard.press("Tab")` scripted for the three journeys (public/learner/staff), asserting a visible focus ring (`:focus-visible` outline computed style non-zero), focus order, no keyboard trap, modal focus return (ConfirmModal, RowActionMenu), skip link (`SkipLink.tsx` exists), and error focus (`use-focus-on-error.ts`).
- Screen reader (manual, owner): NVDA (free, Windows) with Firefox or Chrome for desktop; VoiceOver on iPhone Safari for mobile. Checklist (concise): landmarks and headings navigation; form labels and error announcement (sign-in failure alert, register errors); modal open/close focus and announcement; Toaster region announces; data table headers and row actions menu; lesson page media controls; quiz and assignment submission; certificate verify page results. Record tester, device, versions, date, pass/fail per item. [checklist content ASSUMED, standard]
- **Accessible media (NFR-09) — unresolved:** `04.1-CAPTIONS-SCOPE.md` records "accept video-without-captions as a known NFR-09 gap, carried to Phase 15"; there is no caption/transcript field on `Lesson`/`LessonResource` and the VIDEO allow-list is `video/mp4` and `video/webm` only. The player no longer emits an empty `<track>`. D-13 does not cover it. Needs Open Question 1.

### B18. Browser matrix
- Playwright projects: `chromium` (bundled), `chrome` (`channel: "chrome"`), `edge` (`channel: "msedge"`), `firefox`, `webkit` [CITED: playwright.dev/docs/browsers]. Branded channels need Chrome/Edge installed on the machine (Edge ships with Windows 11). Playwright WebKit is "derived from the latest WebKit main branch" and "doesn't work with the branded version of Safari" — it is not Safari (D-14's manual real-Safari + iPhone check stays).
- "Previous major" cannot be pinned with Playwright's bundled builds (they track latest). Evidence for N-1: Next 16 supported-browser floor "Chrome 111+, Edge 111+, Firefox 111+, Safari 16.4+" [VERIFIED: `node_modules/next/dist/docs/01-app/01-getting-started/01-installation.md:57-60`]; state in the report that N and N-1 sit far above this floor, test N in CI, and let the manual pass record Safari/iPhone versions. Real previous-major runs need a device service or old installs (owner/optional).
- Windows: WebKit is available on Windows builds of Playwright [CITED: intro page: "Chromium, WebKit and Firefox on Windows, Linux and macOS"]. Cookie pitfalls in A3.

## C. Risks to p75 2.5s and the cheapest first evidence

| Risk | Likelihood | Evidence-first check |
|---|---|---|
| Staff layout query fan-out (35–40 queries per page) | High | `pg_stat_statements` count for `/staff`; then `React.cache()` on actor+grants |
| Prisma pool × Netlify instances × Neon connections | Medium | Netlify staging run at 10% then 100%; Neon connection count; compare pooled URL with `connection_limit=1..5` |
| Netlify cold starts + Neon scale-to-zero resume | Medium | Playwright probe: first vs subsequent sample after idle; scheduled functions every minute keep Neon warm but not every function instance |
| scrypt sign-in burst (128 MiB/CPU per hash) | Medium | Separate burst scenario: 150 sign-ins in 60 s; watch function memory/timeouts |
| Unbounded lists (`/staff/payments`, support queue) | Medium (grows with data) | Seed 5,000 orders / 2,000 tickets and time them |
| Learner lesson-page loops (`learner-access.ts`) | Low–Medium | statement count on a lesson route |
| Load generator contention on the laptop | High for local runs | Treat local numbers as relative; only staging counts |
| Netlify credits exhaustion pausing production | Medium | 10% pilot run, usage page, separate team/site |

## Common Pitfalls

### Pitfall 1: Neon plan cannot meet RPO or availability
**What goes wrong:** Free plan history is 6 h and compute is capped (100 CU-hours) with unstoppable scale-to-zero; per-minute scheduled jobs keep it awake and exhaust the quota; the DB then suspends.
**Avoid:** Confirm the production plan (owner); require Launch or a daily external dump before signing NFR-01/NFR-08. **Warning:** Neon console shows compute quota used.

### Pitfall 2: CI red on day one
`npm audit` critical on `next`. Bump to 16.3.8 (and `eslint-config-next`), `npm audit fix` for `source-map-js`, then batch-run the Next-touching tests. Do this before enabling the audit gate.

### Pitfall 3: Registry misunderstanding
The licence registry is per service file; planning "drive from the registry" literally yields nothing. Build the action/route inventory (Pattern 1) and cross-reference service registry entries.

### Pitfall 4: Caching authorization data
`React.cache()` is per request; a module-level or `unstable_cache` cache would make revoked sessions/grants linger. Add a test that a second request after revocation is denied.

### Pitfall 5: "WAT" label
`en-GB` gives `GMT+1`. Use the literal suffix (A9). Also never format with local time on the server (hydration mismatch, error #418 noted in `format-timestamp.ts`).

### Pitfall 6: Rate limits that punish shared IPs
All 150 VUs (and real NAT'd learners) share an IP. Loose per-IP, strict per-address; staging override via non-production env only; test that a throttled response is neutral.

### Pitfall 7: Account enumeration via D-16
Do not resend on wrong password; verify the real hash; send via `after()`; identical response body/status/time class.

### Pitfall 8: Stub email loses tokens
See A3. Without a capture seam the automated journey must skip verification, which weakens D-08's "unassisted" claim.

### Pitfall 9: Scheduled functions do not run on previews
Staging jobs must be invoked by helper or "Run now"; otherwise emails, notifications, export jobs and reconciliation silently never happen and the staging journey stalls.

### Pitfall 10: Public repo
Workflow files, Dependabot config and any perf/seed scripts are public. No credentials, no real hostnames of the production DB; default seed password `Passw0rd!dev` must never exist on a reachable production-like target.

### Pitfall 11: Seeds/scripts hitting the wrong DB
Add a hard guard at the top of every seed/load/restore script (refuse unless host is localhost/127.0.0.1 or allow-listed staging branch host).

### Pitfall 12: Whole-suite memory
Never run all 413 test files locally; CI shards integration tests; local runs use file lists.

## Code Examples

### Playwright projects and time-to-usable probe
```typescript
// e2e/playwright.config.ts  (Source: playwright.dev/docs/browsers; Next playwright guide)
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", workers: 1, retries: 0,
  use: { baseURL: "http://localhost:3000" },   // localhost, not 127.0.0.1 (Secure cookies, WebKit)
  webServer: { command: "npm run start", url: "http://localhost:3000/api/health", reuseExistingServer: true },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "chrome",   use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "edge",     use: { ...devices["Desktop Edge"],   channel: "msedge" } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
    { name: "webkit",   use: { ...devices["Desktop Safari"] } },
  ],
});

// time-to-usable (Chromium only)
await page.goto(url, { waitUntil: "commit" });
await page.locator('[data-primary-content]').first().waitFor();
const ms = await page.evaluate(() => performance.now());
```

### k6 thresholds with cookie auth
```javascript
// perf/learner.js  (Source: grafana.com/docs/k6/latest/using-k6/thresholds/)
import http from "k6/http"; import { check, sleep } from "k6";
export const options = {
  scenarios: { learners: { executor: "ramping-vus", stages: [
    { duration: "2m", target: 150 }, { duration: "10m", target: 150 }, { duration: "30s", target: 0 } ] } },
  thresholds: {
    "http_req_duration{page:dashboard}": ["p(75)<2500"],
    "http_req_failed": ["rate<0.01"],
  },
};
export default function () {
  const token = TOKENS[__VU % TOKENS.length];            // raw tokens from seed-load output
  const res = http.get(`${__ENV.BASE_URL}/dashboard`, { headers: { Cookie: `lms.session=${token}` }, tags: { page: "dashboard" } });
  check(res, { "200": (r) => r.status === 200 });
  sleep(5 + Math.random() * 10);
}
```

### Route handler: health
```typescript
// src/app/api/health/route.ts  (Source: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md)
export async function GET() {
  const ok = await pingDatabaseWithTimeout(2000);        // service-layer helper; no Prisma import here
  return Response.json({ status: ok ? "ok" : "degraded" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
```

### Quiet resend after response
```typescript
// Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md
import { after } from "next/server";
// in signInAction, when result.reason === "INVALID" && result.unverified:
after(() => verificationService.resendVerification(email));  // same neutral state is returned
```

### Atomic attempt counter (extends existing SQL)
```sql
-- same shape as recordFailure in src/server/auth/sign-in-throttle.ts
INSERT INTO "LoginThrottle" ("key","email","failures","windowStartedAt","updatedAt") VALUES ($1,$2,1,$3,$3)
ON CONFLICT ("key") DO UPDATE SET
 "failures" = CASE WHEN "LoginThrottle"."windowStartedAt" <= $4 THEN 1 ELSE "LoginThrottle"."failures"+1 END,
 "windowStartedAt" = CASE WHEN "LoginThrottle"."windowStartedAt" <= $4 THEN $3 ELSE "LoginThrottle"."windowStartedAt" END,
 "updatedAt" = $3;
```

### axe in Playwright
```typescript
// Source: playwright.dev/docs/accessibility-testing (tags extended with wcag22aa)
const results = await new AxeBuilder({ page })
  .withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze();
expect(results.violations).toEqual([]);
```

### Dependabot
```yaml
# Source: docs.github.com dependabot options reference
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly }
    cooldown: { default-days: 3, semver-major-days: 7 }
    ignore:
      - dependency-name: "@aws-sdk/*"      # exact pin enforced by tests/aws-sdk-lockfile.test.ts
      - dependency-name: "next"
        update-types: ["version-update:semver-major"]
  - { package-ecosystem: github-actions, directory: "/", schedule: { interval: monthly } }
  - { package-ecosystem: docker, directory: "/", schedule: { interval: weekly } }
  - { package-ecosystem: docker-compose, directory: "/", schedule: { interval: monthly } }
```

### Restore rehearsal commands (PowerShell/Git Bash note: use `MSYS_NO_PATHCONV=1` for volume paths)
```bash
neonctl branches create --name restore-rehearsal --parent <branch>@2026-10-06T08:00:00Z   # PITR as NEW branch
docker run --rm -v "$PWD/dumps:/d" postgres:16-alpine pg_dump -Fc -v -d "<UNPOOLED_URL>" -f /d/lms.dump
docker run -d --name restore-test -e POSTGRES_PASSWORD=x -p 5440:5432 postgres:16-alpine
docker run --rm -v "$PWD/dumps:/d" postgres:16-alpine pg_restore -v -d "postgresql://postgres:x@host.docker.internal:5440/postgres" /d/lms.dump
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Next `middleware.ts` | `proxy.ts` (Next 16) | Next 16 | Repo has neither; do not introduce one for rate limiting; keep it in services |
| `pgbouncer=true` mandatory with Prisma on Neon | Neon pooler no longer requires it (still often set for Prisma) | 2024+ | Spike and record |
| k6 1.x | k6 2.x (module path `go.k6.io/k6/v2`) | May 2026 | Docker image tag `grafana/k6` follows latest; pin tag in scripts |
| WCAG 2.1 axe tags | `wcag22aa` tag (one rule: `target-size`) | axe 4.5+ | Automated coverage of 2.2 is thin; manual walkthrough carries the rest |
| Netlify seat/limit plans | Credit-based plans, Free = 300 credits hard limit | 2025 | Load-test cost/pausing risk |

**Deprecated/outdated:** README "Deploy on Vercel"; docker-compose `AUTH_SECRET`/`AUTH_URL` (unused); `User.failedLoginAttempts`/`lockedUntil` columns (replaced by device throttling, F-14b).

## Runtime State Inventory

Not a rename/refactor phase. Closest items: anonymisation (A11) rewrites stored data in place (data migration vs code edit: both needed for the tool; the tool is code, executions are data operations audited per learner); formatter change (A9) is code only; `Session`/`LoginThrottle` purge is a new scheduled data cleanup.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | yes | v24.6.0 (CI/Docker 22) | — |
| npm | install, audit | yes | 11.5.1 | — |
| Docker Desktop | Testcontainers, k6, restore | yes | 28.3.3, 7.6 GB limit, `postgres:16-alpine` on host 5434 | — |
| k6 native | load | no | — | `grafana/k6` image (no host install) |
| Playwright browsers | e2e | no (package not installed) | install 1.63.0 | Chrome/Edge channels use machine browsers |
| Host `pg_dump` | dumps | yes | 18.0 | Use matching Docker image (preferred) |
| `gh` CLI | repo/CI checks | yes | authenticated | — |
| `neonctl` | Neon branches | no | 8.0.11 available via npx | Neon console UI |
| `.env.example` | env inventory | unreadable (permission) | — | `grep process.env` list in A8 |
| Real Safari / iPhone | D-14 | no | — | OWNER manual check |
| NVDA / VoiceOver | D-13 | NVDA installable (free) on this machine | — | OWNER manual pass |
| Neon project plan / PG major | B14 | unknown | — | Open Questions 2 |

**Missing with no fallback:** real Safari/iPhone and screen-reader sessions (human only), Neon account access for the staging branch (owner).
**Missing with fallback:** k6 (Docker), neonctl (npx).

## Validation Architecture

(`workflow.nyquist_validation` absent in `.planning/config.json` → enabled.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.11 (projects `node`, `components`; separate perf config); Playwright 1.63.0 (new); k6 2.3.0 (new, Docker) |
| Config files | `vitest.config.mts`, `vitest.perf.config.mts`, `e2e/playwright.config.ts` (Wave 0), `perf/*.js` (Wave 0) |
| Quick run command | `npx vitest run --project node tests/<file>.test.ts` (one file/small batch) |
| Full suite command | CI only (sharded). Locally: `npm test` is `vitest run --no-file-parallelism` — do NOT run whole tree on the dev machine |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NFR-01 | Health endpoint 200/503, no-store, no secrets; monitor configured | unit/route + human | `npx vitest run tests/health-route.test.ts` | Wave 0 (owner: monitor account) |
| NFR-02 | p75 ≤ 2.5s per core view under 150+10 load | k6 + Playwright | `docker run ... grafana/k6 run perf/learner.js`; `npx playwright test perf-probe --project=chromium` | Wave 0 |
| NFR-03 | Concurrent replay: webhook, enrolment, submission, grade, completion, export, notification | integration | `npx vitest run tests/<flow>-concurrency.integration.test.ts` | partial (certificate, enrolment, export exist); grading/attempt/completion Wave 0 |
| NFR-04 | Rate limits (register, forgot, resend, cert check, ticket) neutral + enforced; audit gate; headers | unit + integration; CI | `npx vitest run tests/rate-limit.test.ts tests/rate-limit.integration.test.ts`; `npm audit --omit=dev --audit-level=high` | Wave 0; audit currently RED |
| NFR-05 | Registry-driven bypass matrix over all actions/routes | integration + AST | `npx vitest run tests/authz-inventory.test.ts tests/authz-bypass.integration.test.ts --testTimeout=60000` | Wave 0 |
| NFR-06 | Download routes: denial parity, `private, no-store`, TTL ≤ documented, unsigned object GET refused | unit (route) + MinIO integration | `npx vitest run tests/*download-route.test.ts tests/authz-private-files.integration.test.ts` | route tests exist; MinIO check Wave 0; R2 public access OWNER |
| NFR-07 | Audit rows for new events; ops page data; correlation ids | unit/integration | `npx vitest run tests/ops-status-service.test.ts tests/audit-service.test.ts` | partial; ops Wave 0 |
| NFR-08 | Restore rehearsal evidence (RPO/RTO) | scripted manual rehearsal + integrity run | `npx tsx scripts/ops/integrity-checks.ts` on restored DB | Wave 0; Neon access OWNER |
| NFR-09 | axe WCAG 2.2 AA on every screen + keyboard walkthrough; captions decision | Playwright; manual SR | `npx playwright test a11y-screens --project=chromium` | Wave 0; SR pass OWNER; captions OPEN |
| NFR-10 | No horizontal scroll 320–1920 + 200% | Playwright | `npx playwright test responsive` | Wave 0 |
| NFR-11 | Export one learner; anonymise; no hard delete; audited; permission-gated | unit + integration | `npx vitest run tests/privacy-export.integration.test.ts tests/privacy-anonymise.integration.test.ts` | Wave 0; retention approval OWNER |
| NFR-12 | Browser matrix passes journey smoke; runbooks exist | Playwright; docs review | `npx playwright test journey-smoke` (all projects) | Wave 0; real Safari/iPhone OWNER |
| NFR-13 | States/retry bounds visible: export, email, events | existing integration + ops page test | `npx vitest run tests/export-worker.integration.test.ts tests/domain-event-drain.integration.test.ts` | exist |
| NFR-14 | Integrity SQL checks return zero rows on seed and after journey; added unique indexes (if needed) | integration | `npx tsx scripts/ops/integrity-checks.ts`; `npx vitest run tests/integrity-checks.integration.test.ts` | Wave 0 |
| D-08 | Automated full journey ≥95% over repeated runs | Playwright | `npx playwright test journey --repeat-each=20` | Wave 0 |
| D-16 | Neutral sign-in + quiet resend | unit + integration + component | `npx vitest run tests/identity-security.integration.test.ts tests/components/signin-form.test.tsx` | extend |
| D-17 | Lagos formatter and updated pinned tests | unit | `npx vitest run tests/format-lagos.test.ts tests/components/support-workspace.test.tsx` | Wave 0 / update |
| Folded | Support queue SQL parity; three client handlers | unit + integration | `npx vitest run tests/ticket-staff-queue*.test.ts tests/staff-support.integration.test.ts tests/components/arrange-client.test.tsx` | exist; extend |

### Sampling Rate
- **Per task commit (owner-gated, no auto-commit):** the single affected test file(s) with `npx vitest run <file>`; type check `npx tsc --noEmit` once per wave, not per task (memory).
- **Per wave merge:** CI jobs (static, unit, integration shards).
- **Phase gate:** CI green + one staging run evidence + manual items signed on the checklist before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `@playwright/test`, `@axe-core/playwright`, `e2e/playwright.config.ts`, browser install
- [ ] `scripts/load/seed-load.ts` (150+10, sessions, host guard) and `perf/*.js`
- [ ] Email capture seam (Brevo `baseUrl` env + local mock) — spike including WebKit sign-in
- [ ] `tests/support/authz-registry.ts`, `tests/authz-inventory.test.ts`, `tests/authz-bypass.integration.test.ts`
- [ ] `tests/support` helper to run scheduled tasks against a given `DATABASE_URL`
- [ ] `.github/workflows/ci.yml`, `.github/dependabot.yml`, bump `next` to 16.3.8
- [ ] `src/server/auth/rate-limit.ts` tests, `format-lagos` tests
- [ ] `scripts/ops/integrity-checks.ts` + test
- [ ] `.gitignore`: `playwright-report/`, `test-results/`, `dumps/`, `perf/results/`

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | scrypt hashing (existing), device throttling + new rate limits, neutral errors, token single use |
| V3 Session Management | yes | DB sessions, hashed tokens, httpOnly/secure/lax cookie, revocation; anonymise must revoke sessions |
| V4 Access Control | yes | `withPermission` choke point; registry-driven bypass tests; ops page `audit.view` Global; privacy tool permission |
| V5 Input Validation | yes | zod strict schemas; health endpoint takes no input; ops filters validated |
| V6 Cryptography | yes | Node `crypto` only (scrypt, SHA-256, HMAC, timingSafeEqual); no hand-rolled primitives |
| V7 Errors/Logging | yes | PII-free structured logs; audit with correlation; no stack in health/diagnostic responses |
| V8 Data Protection | yes | export excludes secrets/internal notes; anonymise in place; short-lived download URLs |
| V12 Files | yes | random keys, presigned short TTL, private bucket |
| V14 Config | yes | headers present; CI audit; Dependabot cooldown; pinned actions |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential stuffing / mail bombing via register, forgot, resend, sign-in resend | DoS / Spoofing | per-address cooldown + DB-backed per-IP/user rate limits; resend only on matching password |
| Account enumeration through response, timing or throttle | Info disclosure | one neutral message; same hash cost; `after()` for side effects |
| Direct Server Action POST / forced browsing of download routes | Elevation | server-side `withPermission`/predicates, 404 parity, bypass matrix |
| Mass export of personal data via privacy tool | Info disclosure | permission + audit + reason + job TTL; single-subject scope; no bulk mode |
| Anonymise wrong person or irreversible misuse | Tampering | confirm step, reason, target id re-check, audit before/after hashes, dry-run preview |
| Ops page leaking payment/email detail | Info disclosure | staff-only, global permission, show ids/templates not recipients/bodies/provider errors |
| Public health endpoint abuse/recon | Info disclosure / DoS | static tiny body, no version/stack, DB ping bounded by timeout; platform-level protection |
| Workflow/CI compromise (public repo, fork PRs) | Tampering | `pull_request` only, least-privilege `permissions:`, no secrets on forks, pin actions by SHA via Dependabot |
| Load/seed scripts pointed at production | Tampering / Info | host allow-list guard; default seed password never on real hosts |
| Staging copy of real learner data | Info disclosure | branch from seeded base, not from production once real data exists |
| Webhook replay/forgery | Spoofing | signature check + unique event id (existing); concurrent replay test |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.env.example` contents unknown (permission denied); env inventory derived from `process.env` grep only | A8 | Missing variable in runbooks |
| A2 | Proposed load shape (ramp 2 min, hold 10 min, think time 5–15 s) and journey mix | A1 | Under/over-states D-02 load |
| A3 | "Regular 4G" network profile for NFR-02 (PRD names a "supported network profile" without defining it) | B13 | Sign-off number not accepted by owner |
| A4 | Completion/grading concurrency duplicates are possible (no unique/lock seen) | A7 | Wasted migration, or missed integrity bug |
| A5 | Always-on Neon compute about 182 CU-hours/month (0.25 CU minimum) | B14 | Free plan might survive; conclusion on plan unchanged because of 6 h history |
| A6 | Netlify credit cost estimate for a 150-VU run, and team-level pooling | B15 | Underestimate of risk to production site |
| A7 | GitHub Ubuntu runners have Docker for Testcontainers and enough RAM for sharded integration runs | B16 | CI shape changes (service container, fewer shards) |
| A8 | axe `wcag22aa` tag selection runs the disabled-by-default `target-size` rule | B17 | Gap in 2.2 coverage; spike confirms |
| A9 | 200% zoom emulated by halving viewport CSS size; reflow = 320 px | B17 | Weaker evidence than real zoom; acceptable? |
| A10 | NVDA/VoiceOver checklist content | B17 | Incomplete manual pass |
| A11 | Post-deploy stale-tab Server Action failures and the need for `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | A4/A12 | Runbook omits a known deploy-skew cause |
| A12 | k6 can replay the no-JS sign-in form via hidden `$ACTION_*` inputs | A1 | Sign-in burst needs Playwright instead |
| A13 | Per-IP limit numbers (e.g. 60 per 15 min) | A5 | Real users throttled, or abuse unbounded |
| A14 | R2 has no native versioning (secondary source) | B14 | Backup advice wrong; owner verifies in Cloudflare docs |
| A15 | Netlify supports `next/after` (adapter statement from search summary) | Pattern 3 | Quiet resend not delivered; fallback = await with fixed-time padding or queue via outbox |
| A16 | Netlify synchronous function timeout (not retrieved) | A2 | Heavy pages may hit limits |
| A17 | Dependabot `docker-compose` ecosystem support and `cooldown` option exist as documented | B16 | Config rejected by GitHub |
| A18 | `x-nf-client-connection-ip` is the real client IP on Netlify (existing code assumption) | A5 | Throttle keys wrong |

## Open Questions (RESOLVED)

All eleven questions are resolved for planning: each is either answered by a blocking owner gate in plan 15-01 (recorded in 15-DECISIONS.md, with every outcome already planned) or adopted at a stated default in the 15-DECISIONS.md "Adopted assumptions ledger" with the plan that depends on it and how to redirect it.

1. **NFR-09 accessible media (captions).** What we know: carried to Phase 15, no data model, D-13 silent. Unclear: build narrow WebVTT/transcript support (schema migration, new upload type, staff authoring), or waive with expiry and require transcripts in lesson body for pilot videos. Recommendation: owner decides before planning; code-provable parts (embedded video alternatives, axe) cannot close it alone. Not waivable if it is judged a critical accessibility failure by owner policy; D-07 only names security/payment/authz/private-file as never-waived. **RESOLVED (planning):** plan 15-01 Task 1 is a blocking-human gate whose answer is recorded under 15-DECISIONS.md "NFR-09 accessible media decision" before any caption code runs. Both outcomes are fully planned: option-a or option-c builds captions (plans 15-23 and 15-24, each gated by a precondition on that decision); option-b records a named, time-boxed D-07 waiver with a transcript content rule, which plan 15-31 copies into the launch checklist.
2. **Production Neon plan, Netlify plan/team sharing, and Neon PG major.** Drives RPO, availability, load-test safety and `pg_dump` image. Recommendation: owner confirms before the staging run; require Launch (or daily dump) in the checklist. **RESOLVED:** ledger row OQ2 in 15-DECISIONS.md; the owner supplies the facts at plan 15-29's checkpoint, the staging run is plan 15-30, and plan 15-31's checklist requires the Neon Launch plan or a daily external dump before NFR-01 and NFR-08 are signed.
3. **Network profile and sample size for the NFR-02 sign-off, and whether the p75 includes cold starts.** Recommendation: agree "regular 4G", ≥30 samples/view, report warm and cold separately. **RESOLVED:** ledger row OQ3 adopts that recommendation; implemented by plan 15-18 (probe method) and signed in plan 15-30.
4. **D-17 scope:** Lagos everywhere versus cohort-zone session schedules. **RESOLVED:** ledger row OQ4 and UI-SPEC S6: session schedules and calendars keep the cohort's own zone with its label; every other rendered date-time is Lagos time with " WAT". Implemented by plan 15-05 (formatter and LagosTime) and the three Lagos-time slices, plans 15-10, 15-32 and 15-33 (15-33 adds the whole-tree guard).
5. **New permission for privacy tool** (`privacy.manage` Global-only) versus reuse; catalogue changes need the approval path. **RESOLVED (planning):** plan 15-01 Task 2 is a blocking-human gate recorded under 15-DECISIONS.md "Privacy tool permission and retention decision"; plan 15-16 applies exactly the recorded identifier, and plans 15-21 and 15-22 read it.
6. **Heartbeat table for scheduled jobs** (schema change) versus staleness signals only (D-18 says existing data). **RESOLVED:** ledger row OQ6 adopts staleness signals only, with "Not tracked" where no stored signal exists; plan 15-13.
7. **Object storage backup/restore and R2 public-access confirmation** (owner/ops). **RESOLVED:** ledger rows OQ7 and A14 make them owner checks on the launch checklist; plan 15-31.
8. **Production hosting statement:** Netlify+Neon (UAT doc) versus self-hosted Docker (compose header); affects runbooks and the missing scheduler/healthcheck on Docker. **RESOLVED:** ledger row OQ8 adopts Netlify plus Neon plus R2 as the production target with Docker Compose local only; runbooks in plan 15-11 are written for Netlify with a Docker note.
9. **Retention choices for anonymisation:** certificate `learnerName`, ticket bodies, submissions, audit JSON. **RESOLVED (planning):** decided at the same plan 15-01 Task 2 gate (the conservative keep-list is the proposed default; hard deletion is never an option per D-12); plan 15-16 encodes the answer in one policy constant and plan 15-22 renders it.
10. **Waiver policy for `target-size` on known small inline links** (fix versus time-boxed waiver). **RESOLVED:** ledger row OQ10: the links stay deferred per CONTEXT; if axe flags them, plan 15-19 records them as waiver candidates and plan 15-31 records a time-boxed D-07 waiver.
11. **Co-worker agreement** on `data-primary-content` hook and nav entry for the ops page (StaffShell/layout are shared). **RESOLVED:** 15-DECISIONS.md "Shared UI ownership" (written by plan 15-01 Task 3) has one row per shared file or file group, starting "pending"; every editing task carries a precondition on its row (page content wrappers for plan 15-18, src/app/staff/layout.tsx for plans 15-13 and 15-22, and the other rows for plans 15-05, 15-10, 15-19, 15-20, 15-23, 15-24, 15-32 and 15-33) and halts until the owner records "agreed".

## Ordering constraints and collisions (for plan sequencing)

1. Wave 0 (blocking): bump `next`/audit fix → CI + Dependabot; install Playwright; seed-load script with host guard; email-capture and WebKit-cookie spikes; authz registry scaffolding; React `cache()`/query-count baseline measurement; confirm Open Questions 1, 2, 5.
2. Wave 1 (independent hardening, parallelisable by file): rate-limit helper → its tests → wire into 5 entry points; D-16 sign-in hook (touches `auth-service.ts`, `signin/actions.ts`); health endpoint; integrity-checks script; ops-status service → page; privacy services; D-17 formatter (mechanical, many files, single owner).
3. Wave 2: registry-driven bypass suite (needs rate-limit and privacy actions registered first so they are covered); concurrency/replay tests; a11y manifest + axe sweeps; responsive/zoom; keyboard walkthrough; folded todos (queue SQL, three clients).
4. Wave 3: local rehearsal of everything with the production build on Docker Postgres (k6 + Playwright probe), fix performance items found; runbooks; restore rehearsal (local dump route can run here; Neon PITR needs owner access).
5. Wave 4 (last): ONE staging run (Neon branch + Netlify preview, helper-run jobs, 10% pilot first), then report + launch checklist. Anything after changes code → rerun evidence.
- **Hard dependencies:** seed data before perf/journey/a11y; rate-limit helper before D-11 tests; registry before CI wiring of the bypass suite; `next` bump before audit gate; Open Question 1 before NFR-09 planning; Neon access before restore sign-off.
- **Co-worker collisions:** `StaffShell.tsx` / `src/app/staff/layout.tsx` (nav item for ops page, `cache()` for `can()`), `Toaster`, `ConfirmModal`, `ResourceForm`, `RowActionMenu`, `PageHeader`/`LearnerPageHeader` (primary-content hook), `ticket-labels.tsx` and ~22 date-format call sites, `LearnerShell`. Agree one owner per file per wave; ask before touching shared primitives; D-17 and a11y fixes are the likeliest merge-conflict generators.

## Evidence the code can prove vs what needs a human

| Proven by code/tests | Needs an owner/human |
|---|---|
| Bypass matrix, rate limits, integrity checks, concurrency replays, audit rows, formatter, health endpoint, axe, responsive, keyboard script, journey automation, browser matrix (engines), k6/Playwright timings on staging | Neon plan/PITR retention, monitor account, R2 public-access setting, backup of files, payment gateway production credentials, sender domain, legal/privacy/retention approval, real Safari/iPhone, NVDA/VoiceOver pass, manual unassisted journey, support staffing, licence key issuing, `.docx` regeneration, usability scripts (PRD §14.2 80% task success), waiver signatures |

## Sources

### Primary (HIGH confidence)
- Repo files read this session (paths cited inline): `src/server/**`, `src/app/**`, `prisma/schema.prisma`, `netlify/functions/*.ts`, `tests/**`, `package.json`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `.planning/**`, `docs/reference/...PRD...md` §12–15.
- `node_modules/next/dist/docs/01-app/**` (files listed in Project Constraints).
- Commands run: `npm audit --omit=dev`, `npm view`, `gh api repos/{grafana/k6,microsoft/playwright,dequelabs/*}/releases/latest`, `gsd-tools query package-legitimacy check`, local `node` Intl and axe probes.

### Secondary (MEDIUM confidence)
- neon.com docs: plans, pricing, branch-restore, connection-pooling, guides/prisma, manage/backup-pg-dump, reference/cli-branches.
- docs.netlify.com: environment variables, scheduled functions, credit-based pricing.
- playwright.dev: browsers, accessibility-testing, intro. grafana.com k6 thresholds; github releases.
- docs.github.com: Actions billing, Dependabot options. uptimerobot.com and betterstack.com pricing pages.
- axe-core GitHub API.md and rule-descriptions.md.

### Tertiary (LOW confidence, marked ASSUMED where used)
- WebSearch summaries: Playwright WebKit secure-cookie issues (#43115, #39380), Netlify `next/after`, R2 versioning, Neon+Prisma `pgbouncer` guidance.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against registry/GitHub this session.
- Architecture/repo facts: HIGH — read from source; a few concurrency conclusions are ASSUMED until tests run.
- Pitfalls: MEDIUM-HIGH — Neon/Netlify limits cited from vendor pages that may change; WebKit cookie behaviour from issue trackers.
- Owner-dependent items: LOW until Open Questions answered.

**Research date:** 2026-10-06
**Valid until:** 2026-10-20 for vendor limits and tool versions (fast-moving); repo facts valid until the next merge to `develop`.
