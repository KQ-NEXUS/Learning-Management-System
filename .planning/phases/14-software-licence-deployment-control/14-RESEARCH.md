# Phase 14: Software Licence & Deployment Control - Research

**Researched:** 2026-10-01
**Domain:** Local Ed25519-signed licence verification, DB-backed licence state machine, server-side "restricted continuity mode" enforcement through the existing `withPermission` choke point, Phase 13 notification reuse, provider-side issuer CLI
**Confidence:** MEDIUM-HIGH (codebase facts and Node/Next behaviour verified this session; commercial-policy edges and hosting-platform behaviours are `[ASSUMED]` and listed in the Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Validation model**
- **D-01:** Local verification of a provider-signed licence file only. No provider validation service, no online check, no signed validation receipts in this phase. The licence is verified against embedded public key material at startup, on a scheduled cadence and before high-impact mutations. Revocation takes effect only through the file's own expiry. — **Reversibility:** costly — adding an online validator later adds a provider-side component and new states (offline window, receipts); the state machine and stored-state shape should be built so that can be added without a rewrite.
- **D-02:** Ed25519 signatures via Node built-in `crypto` (no new dependency). The licence carries a signing-key ID; the LMS ships a versioned public-key trust set so rotation overlaps and retired keys still verify. — **Reversibility:** one-way — the licence file format and key-ID scheme become a published contract with every issued licence; the schema needs an explicit schema-version field from day one.
- **D-03:** The licence generator is a separate provider-side CLI/script kept outside the client-deployed code path, with a provider runbook (issue, renew, replace, key rotation, compromise recovery) as a deliverable. The private signing key never exists in the LMS repo, config, backups or UI. Tests mint licences with a throwaway dev key only. — **Reversibility:** reversible — generator is independent of the LMS.
- **D-04:** Because there is no online validator, the "bounded offline-validation policy" of LIC-04 applies to local failures only: a cryptographically invalid, wrong-client, wrong-deployment or unsupported-schema licence restricts immediately; a transient failure to read or verify stored licence state keeps the last-known-good state for a bounded window (default 24 h) with an Administrator warning, then restricts. Network connectivity never affects licence state.

**Restricted-state scope**
- **D-05:** Restriction is an application-level "continuity mode", never a database-wide read-only switch.
- **D-06:** **Terminology: the post-grace state is called "restricted continuity mode", never "read-only"** (code, UI, audit, tests, contract). Existing enrolments may continue coursework, progress recording, submissions, assessment, grading and certificate issuance. Blocked: new enrolments, new checkout sessions, publishing/content changes, staff and permission changes, settings changes and other ordinary administrative mutations (planner enumerates the exact allowlist and blocklist from the service inventory). **This is an explicit PRD amendment to §18.2** (which blocks grading/certificate changes), not an incidental deviation. — **Reversibility:** costly — flipping to strict read-only touches every learner/grading write path's exemption.
- **D-07:** Always allowed in restricted state: sign-in/out, password reset, email verification and security administration (session revoke, credential rotation); payment webhooks, refunds and reversals; data export and the licence activation route; transactional email and in-product notifications (the outbox keeps draining).
- **D-08:** **Explicit PRD amendment to §19.** Payment webhooks, reconciliation, refunds, reversals and disputes remain operational in restricted continuity mode. Payments initiated before the restriction timestamp may complete and receive their recorded entitlement (no charged-but-undelivered). Creation of new checkout sessions is blocked. This replaces the §19 "Software licence interaction" row (which blocks payment confirmation, refund initiation/recording and new enrolment activation). The "initiated before" test needs a recorded payment-initiation timestamp compared to the restriction timestamp; planner defines it.
- **D-08a:** **Amendment deliverables (user-directed):** update PRD §18.2 and §19 (and the §19 test matrix row), the commercial contract, the administrator UI copy and the acceptance tests so all use the "restricted continuity mode" wording above. If any discrepancy remains, the contract controls. Plans must include the PRD edits and a wording-consistency check across UI copy and tests; the contract itself is outside the repo and owned by the user.
- **D-09:** Enforcement lives inside the `withPermission` choke point: mutating operations are default-blocked in restricted state, returning a non-sensitive "licence restricted" error; an explicit allowlist (D-06/D-07/D-08) is exempt, so new resources inherit enforcement automatically. System paths that do not run through `withPermission` (webhook handlers, scheduled tasks, system services) get an explicit guard or an explicit documented exemption. A boundary test must prove no write path is left unguarded. The UI mirrors server state (disabled controls with a reason, never the only gate). — **Reversibility:** costly — enforcement placement shapes every future mutation path.

**Policy defaults and clocks**
- **D-10:** Expiry, grace end and the renewal/support contact are signed fields inside the licence payload. Warning cadence for Administrators is a code default: 60, 30, 14, 7, 3 and 1 days before expiry, plus expiry and grace-ending notices. The deployer cannot edit grace or thresholds.
- **D-11:** Default grace is 14 calendar days of normal operation with prominent warnings, then restricted state. Expiry is an exact UTC instant displayed with the client-local date and timezone. The contract must state the same rule.
- **D-12:** Clock handling: persist a high-water mark of the maximum observed time; use monotonic time within a process; tolerate ~10 min skew; a larger backward jump raises an Administrator alert and an audit event rather than locking anyone out. Offline clock tampering is accepted as unsolvable.
- **D-13:** Deployment binding: the licence names a deployment identifier that must match a value seeded in the database at install (not hostname, MAC or container ID, so DR, scaling and migration survive). The active licence and its derived state live in the database so every Netlify function instance sees the same state. Writes to the stored last-known-good record must be atomic. — **Reversibility:** costly — the seeded deployment-ID and stored-state schema are Prisma migrations.

**Admin screen and alerts**
- **D-14:** Licence & System Status screen (under Administration, `licence.view`): state, licence ID, registered client, deployment ID, exact UTC expiry and grace end with local timezone, days remaining, last verification result; a plain-language "what works / what is blocked" list for the current state; renewal and support contact from the signed payload; activation upload for `licence.activate` holders with clear non-sensitive rejection reasons; a downloadable non-sensitive diagnostic report; shortcut to existing exports. The UI never offers create/extend/edit/replace-signature/self-reactivate (LIC-03). Never shows signing material, gateway secrets or stack traces.
- **D-15:** Alerts reuse the Phase 13 pipeline: a scheduled task evaluates state and emits deduped domain events (correlation = licence ID + state/threshold), the existing drain creates Notification rows and emails for Global holders of `licence.view`. A persistent in-app banner for Administrators is added on top. Messages carry no signing or contract detail (LIC-07).
- **D-16:** Licence checks run as a scheduled task following the existing `src/server/scheduled/*-task.ts` + Netlify scheduled function pattern (injected-deps factory, worker-runtime-closure rule enforced by `tests/boundary.test.ts`), plus startup and before-high-impact-mutation checks.
- **D-17:** Every licence activation, validation outcome, state transition, restriction enforcement and licence-related export is written to the existing audit service with actor or system actor, target licence ID, outcome, correlation ID and safe context only (LIC-06).

### Claude's Discretion
- Licence file encoding and payload field names, within D-02's schema-version/key-ID requirement.
- Exact high-impact-mutation list for pre-action checks, and the exact continuity allowlist of learner/grading/certificate actions (D-06), derived from the existing service inventory.
- Database model shape for stored licence state, high-water mark and deployment ID.
- Scheduled cadence (hourly-to-daily is acceptable since verification is local), banner placement and copy, diagnostic-report format.
- Which existing permission/audit view surfaces licence audit events (licence permissions themselves do not grant audit access per PRD §18.4).

### Deferred Ideas (OUT OF SCOPE)
- Online validation service, signed validation receipts and a manual request/response file for air-gapped installs — future phase if suspension/revocation becomes a commercial requirement (D-01 keeps the door open).
- Revocation/suspension of an issued licence before its expiry — depends on the online validator.
- Emergency-extension workflow beyond issuing a replacement signed licence — contract-dependent.
- Licence telemetry — not collected; would need a disclosure/lawful-basis review.
- Legal and contract items (ownership, no-lien data clause, export format guarantees, DPA, NDPA/GAID roles, merchant of record) — counsel review, outside the product build.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIC-01 | Verify a provider-signed licence with a public key; reject altered, expired, wrong-client, wrong-deployment or otherwise invalid licences | Compact signed-envelope format (Pattern 1), `node:crypto` Ed25519 verify measured at ~129 µs, versioned trust set, deployment-ID binding, TOFU client binding (A5), golden-vector tests |
| LIC-02 | Administration > Licence & System Status for `licence.view`, no secrets | Page under Administration nav group, reuse `DetailLayout`/`DetailFacts`, diagnostic report (Pattern 12), audit not embedded (PRD §18.4) |
| LIC-03 | Only `licence.activate` activates; UI never offers create/extend/edit/replace/self-reactivate | Activation action tagged continuity-always-allowed, two-step inspect/activate, monotonic `issuedAt` anti-replay (Pitfall 4), seed role note (Open Question 3) |
| LIC-04 | Checks at startup, on a schedule and before high-impact mutations; bounded local-failure policy | `instrumentation.ts` register (Next docs), `check-licence` scheduled task, per-write re-verification inside the guard (no per-process cache on write paths), 24 h last-known-good (Pattern 4) |
| LIC-05 | Restricted state enforced server-side and in the UI | Effect-class option on `withPermission`, explicit guards for non-`withPermission` writes, service-file registry boundary test (Enforcement Inventory), UI context mirror (Pattern 11) |
| LIC-06 | Audit activation, validation outcome, transition, restriction enforcement, export | `recordAudit`/`recordAuditInTransaction` action vocabulary `licence.*`, CAS transition so one winner audits (Pattern 5) |
| LIC-07 | Administrator notifications, deduplicated, no sensitive detail | New `licence.notice` domain event with deterministic id, mapper over `resolveStaffHolders(... "licence.view")`, new template + notification type (Pattern 8) |
| LIC-08 | Restriction preserves records and export route; never deletes | Export/download/audit-export paths classified always-allowed; no delete path in licence code; restricted-state integration test asserts row counts unchanged |
</phase_requirements>

## Summary

The licence feature is mostly new pure logic (format, verification, state derivation) plus one cross-cutting concern, enforcement, that has to be threaded through a codebase where **not every write goes through `withPermission`**. Reading the code this session: 121 literal `withPermission`/`authorize` call sites exist (AST scan), but learner paths (`getCurrentActor` in server actions), checkout, registration, export, auth, webhooks and every scheduled task write without it. Because ESLint confines `@prisma/client` to `src/server/services/**` and `src/server/db.ts`, **every database write lives in a service file**, which makes a service-file registry the right unit for the "no write path left unguarded" boundary test.

The most important design conclusion is that restriction must be a **pure function of stored signed fields plus the current instant**, re-derived on every guarded write from one primary-key row read (about 1 ms including a ~0.13 ms Ed25519 verify). That choice removes cross-instance cache staleness (Next's own caches are per-instance and uncoordinated per the self-hosting guide), removes the need for any scheduler to make restriction take effect (important because `docker-compose.yml` ships no scheduler while production scheduled work is Netlify), and makes expiry boundary tests deterministic with an injected clock. The scheduled task, startup hook and activation route then only exist to *record transitions, send alerts and refresh last-known-good*, using a compare-and-swap so exactly one instance wins each transition.

Four things in CONTEXT.md need the planner's attention: (1) the PRD/PXR contradictions are in more places than "§11.5" (PXR §11.1, §11.3, §11.4, §12.4 and PRD §18.2, LIC-05, LIC-08, §18.6, §19.4); (2) `.view`-permissioned wrappers can front writes (`authorizeCase` in `reconciliation-case-service.ts`), so permission-name defaults alone are not a safe classifier; (3) the seeded Administrator role holds `licence.activate` via `[...PERMISSIONS]`, contradicting PRD §18.4 "deliberately restricted", while restricted mode blocks role changes, creating a lock-out risk if the only activator is removed; (4) behaviour for a deployment that has never activated a licence is not decided and is a one-way commercial door (Open Question 1).

**Primary recommendation:** Build a pure `src/server/licence/` module (format, verify, state derivation, policy vocabulary, `LicenceRestrictedError`) plus one Prisma-backed `licence-service.ts`; inject a licence guard into `createWithPermission` (checked only after the permission check passes) with a per-call-site `licence` effect option, add explicit guards to the three non-`withPermission` blocked entry points (`startCheckout`, `initiateStripePayment`/`initiatePaystackPayment`, `register`), and prove coverage with a service-file registry test; keep all state transitions CAS-guarded and all alerts keyed by deterministic domain-event ids.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md (imported by CLAUDE.md):** "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before recommending any Next.js API. Done for: `instrumentation` (`01-app/03-api-reference/03-file-conventions/instrumentation.md`, `01-app/02-guides/instrumentation.md`), Server Actions (`01-app/02-guides/server-actions.md`), `proxy.md`, `layout.md`, `route.md`, `self-hosting.md`. Installed version: `"next": "16.3.4"` [VERIFIED: package.json].
- **User memory:** never auto-commit; user must explicitly ask for each commit. `.planning/config.json` pins `runtime=codex` (omit `Agent model=`, force sequential no-worktree execution in Claude Code sessions). Plans must not contain commit steps that run without an explicit user request.
- **Closed permission catalogue (36 identifiers):** no new permission identifiers; `licence.view`/`licence.activate` already exist, Global only.
- **Service-layer boundary (ESLint):** `@prisma/client` importable only under `src/server/services/**` and `src/server/db.ts` (`eslint.config.mjs`). Pure licence modules therefore live outside `services/` and must not import Prisma (precedent: `src/server/communications/contracts.ts`, asserted by `tests/boundary.test.ts` "rejects a Prisma import from src/server/communications/contracts.ts (13-13)").
- **Worker-runtime-closure rule:** every file under `netlify/functions/` has its transitive import closure scanned for `next/headers`, `@/server/permissions*` and `getCurrentActor` (`tests/boundary.test.ts`, `workerRuntimeClosure()`); the webhook route closures are scanned too. The licence service reached by webhooks/tasks must stay free of those imports.
- **Conventions (`.planning/codebase/CONVENTIONS.md`):** kebab-case files, `*.test.ts` under `tests/`, `createXService(deps)` factories with injected `now`, custom errors with `.name`, `{ok:true}|{ok:false}` results, no secrets in logs, `@/` imports only.
- **Migrations:** checked-in additive migration via `prisma migrate dev --create-only`, CHECK constraints pasted into the migration itself, applied to deployed DBs with `prisma migrate deploy`; `db push` only as an in-sync verification step (Phase 12 research/summary precedent); never `--accept-data-loss`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Signature/format/binding verification | API / Backend (pure module) | — | Needs the embedded trust set; must never run in the browser |
| Licence state derivation (time-based) | API / Backend (pure fn) | Database (stored `state` for transition detection) | Deterministic from signed dates + injected `now`; no scheduler dependency |
| Stored licence, deployment ID, high-water mark | Database / Storage | — | D-13: all instances must see one state; atomic CAS writes |
| Restriction enforcement (staff mutations) | API / Backend (`withPermission` injected guard) | — | D-09 choke point; after permission check passes |
| Restriction enforcement (checkout, registration, payment-initiation) | API / Backend (explicit guard in service) | Frontend Server (redirect with neutral notice) | These paths bypass `withPermission` |
| Payment completion rule ("initiated before") | API / Backend (webhook settlement service) | Database (`PaymentAttempt.initiatedAt`) | Actorless path, must stay free of request-only imports |
| Startup check | Frontend Server (`instrumentation.ts` register, Node runtime) | API (same service) | "once per new server instance" per Next docs |
| Scheduled check, transitions, alert events | API / Backend (Netlify scheduled function) | Database | Existing `*-task.ts` pattern; idempotent, 30 s limit |
| Alert delivery | Existing Phase 13 drain (outbox) | Browser (bell poll) | Reuse; no new delivery path |
| Admin banner | Frontend Server (staff layout) | Browser (client shell) | Layout renders per full load only; see Pitfall 8 |
| Licence & System Status page, activation, diagnostic download | Frontend Server (page + server action + route handler) | API (service) | Standard staff screen pattern |
| Licence issuance and key custody | Provider-side CLI (outside deployed path) | — | PRD §18.1: private key never in the client codebase |
| UI disabled-with-reason controls | Browser (context) | Frontend Server (state passed down) | Courtesy only; server is the gate |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node `node:crypto` (built-in) | Node 24.6.0 local; `node:22-alpine` in Dockerfile; Netlify default Node 24 | Ed25519 `crypto.verify(null, data, key, sig)`, `createPublicKey({format:'jwk'})` | D-02 locks "no new dependency". Ed25519 supported in all three runtimes [CITED: nodejs.org/api/crypto.html — JWK/Ed25519 `verify(null, ...)` example; CITED: answers.netlify.com Node 24 default thread; VERIFIED: Dockerfile line 1 `FROM node:22-alpine AS deps`] |
| zod | `^4.5.4` | Strict payload schema, upload input validation | Already the project validator [VERIFIED: package.json] |
| Prisma | `^6.19.3` | New models + migrations | Existing ORM [VERIFIED: package.json] |
| Next.js | `16.3.4` | `instrumentation.ts` register, route handler, server actions | Existing [VERIFIED: package.json] |
| vitest | `4.1.11` (`^4.1.11`) | Unit + Testcontainers integration tests | Existing; `npm test` = `vitest run --no-file-parallelism` [VERIFIED: package.json, `npx vitest --version`] |
| tsx | `^4.23.13` | Run the provider CLI without a build step | Already a dependency [VERIFIED: package.json] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:util` `parseArgs` | built-in | Provider CLI argument parsing | Avoids adding a CLI dependency |
| `@netlify/functions` | `^6.0.0` (dev) | `Config` type for the scheduled function | Same as the 9 existing functions |
| `@testcontainers/postgresql` | `^12.1.0` | Real-Postgres CAS/atomicity proof | Integration tests via `tests/support/pg.ts` (`postgres:16-alpine`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom compact envelope signed over exact bytes | JWS/JOSE library (`jose`) | New dependency, forbidden by D-02; JWS semantics are what the compact format imitates |
| Sign canonicalised JSON (RFC 8785 JCS) | Sign the exact payload bytes carried in the file | JCS needs a canonicaliser (a dependency or hand-rolled code, i.e. two implementations that can drift); signing exact bytes removes the ambiguity entirely |
| Prisma client extension intercepting all writes by model | Per-call-site effect option + service-file registry | An extension is a true default-deny net but cannot see raw SQL writes (`$queryRaw`/`$executeRaw` are used in services), adds a licence read per write op, and is not what D-09 locked. Rejected; mention only as a future defence-in-depth |
| Next `unstable_cache`/`use cache` for state | Direct PK read per write | Next's server cache is per-instance and not coordinated unless a custom handler is configured [CITED: self-hosting.md "By default, Next.js uses an in-memory cache that is not shared across instances"] |
| ECDSA P-256 | Ed25519 | Only if a FIPS requirement appears (research input); D-02 is locked to Ed25519 |

**Installation:** none. No new npm packages are required.

**Version verification:** versions above were read from `package.json` / `npx vitest --version` this session; no new registry lookups were needed because nothing is installed.

## Package Legitimacy Audit

No external packages are installed by this phase (D-02 forbids a crypto dependency; `zod`, `tsx`, Prisma, Netlify types and vitest are already in `package.json`).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

If the planner later adds any package (for example a CLI library for the provider tool), run `gsd_run query package-legitimacy check --ecosystem npm <pkg>` and gate the install behind a `checkpoint:human-verify` task.

## Architecture Patterns

### System Architecture Diagram

```
 PROVIDER SIDE (outside deployed path)                 CLIENT DEPLOYMENT
 ┌─────────────────────────────────┐
 │ provider-tools/licence-issuer   │   LMS-LIC1.<hdr>.<payload>.<sig>   ┌──────────────────────────┐
 │ keygen / issue / verify / inspect│ ───── file or paste (≤ 8 KiB) ───▶ │ Admin: Licence & System   │
 │ private key: vault/HSM only      │                                    │ Status  (licence.view)    │
 └─────────────────────────────────┘                                    │  inspect → activate       │
                                                                         │  (licence.activate)       │
   shared pure module                                                    └────────────┬─────────────┘
   src/server/licence/format.ts  (schema, signed-input builder)                       │ server action
                                                                                      ▼
                         ┌────────────────────────── licence-service.ts (Prisma) ───────────────────────────┐
                         │ activate(): verify → lock singleton row → monotonic issuedAt + client/deployment  │
                         │             check → insert LicenceRecord → CAS LicenceState → audit (same tx)       │
                         │ evaluate(now): read LicenceState+LicenceRecord → verify(raw) → deriveState()       │
                         │ transition(): UPDATE … WHERE state=$old (CAS) → audit + deterministic domain event │
                         └──────▲──────────────▲───────────────▲────────────────▲─────────────▲─────────────┘
                                │              │               │                │             │
   every write (per request)    │   startup    │   scheduled   │  banner/page   │  webhook    │
 ┌──────────────────────────┐   │ instrumentation│ check-licence│  read (layout) │  settlement │
 │ createWithPermission      │───┘  register()   │ (Netlify,    │                │  (actorless)│
 │  1 authenticate           │                  │  hourly)     │                │  PaymentAttempt
 │  2 resolve scope + grants │                  │              │                │  .initiatedAt <
 │  3 hasPermission?  ──no──▶ AuthorizationError│              │                │  restrictedAt+skew
 │  4 licence guard (write)  │──restricted──▶ LicenceRestrictedError + audit "licence.restriction_enforced"
 │  5 handler                │                  └──────┬───────┘
 └──────────────────────────┘                          ▼
 explicit guards (no withPermission): startCheckout, initiate*Payment, register        domain event licence.notice
                                                                                       id = licence:{licenceId}:{noticeKey}
                                                                                              │
                                              existing Phase 13 drain (every minute) ◀────────┘
                                              mapper → resolveStaffHolders("licence.view") → Notification + EmailDispatch
```

### Recommended Project Structure

```
src/server/licence/                 # PURE (no Prisma, no next/*, no permissions imports)
├── format.ts                       # envelope parse, zod payload schema, signed-input builder (shared with provider CLI)
├── verify.ts                       # verifyLicence(raw, {trustSet, deploymentId, registeredClientId, now}) -> result union
├── trust-set.ts                    # versioned public keys (JWK x), status active|retired|revoked; dev keys only when NODE_ENV !== "production"
├── state.ts                        # deriveState(), thresholds, restrictedAt, daysRemaining (UTC-instant arithmetic)
├── policy.ts                       # effect classes, vocabulary constants (RESTRICTED_CONTINUITY_LABEL), messages, notice keys
└── clock.ts                        # skew tolerance, monotonic-vs-wall rollback detector
src/server/services/
├── licence-service.ts              # Prisma: activate, getStatus, evaluate, transition (CAS), ensureDeploymentIdentity, diagnostics
├── licence-notice-service.ts       # emits deterministic domain events (writeDomainEventOnce)
└── event-mappers/licence.ts        # MapperGroup for "licence.notice"
src/server/scheduled/check-licence-task.ts      # createCheckLicenceTask(deps) + runCheckLicenceTask
netlify/functions/check-licence.ts              # schedule "0 * * * *" (proposal)
src/instrumentation.ts                          # register(): nodejs-only startup check (best effort, never throws)
src/app/staff/licence/{page.tsx,actions.ts,LicenceStatus.tsx,ActivateLicenceForm.tsx}
src/app/api/staff/licence/diagnostic/route.ts   # GET, licence.view, audited, no-store
provider-tools/licence-issuer/{cli.ts,README.md,RUNBOOK.md}   # excluded from Docker context
tests/support/licence-fixtures.ts               # throwaway dev keypair + mintLicence()
tests/fixtures/licence/v1/*.lic                 # golden vectors (committed, minted with the dev key)
```

### Pattern 1: Compact signed envelope, signature over exact bytes (one-way door)

**What:** The licence file is one ASCII line `LMS-LIC1.<base64url(header JSON)>.<base64url(payload JSON)>.<base64url(signature)>`. The signed input is the ASCII string `LMS-LIC1.<hdrB64>.<payloadB64>` (everything before the last dot). The verifier checks the signature over those exact bytes first and only then JSON-parses. No canonicalisation step exists to disagree about.
**When to use:** Always; this is the published contract (D-02, one-way).
**Header (signed):** `{ "alg": "Ed25519", "kid": "<key id>", "typ": "lms-licence", "v": 1 }`. Reject any header whose `alg` is not exactly `"Ed25519"` (algorithm pinned, never trusted from the file).
**Payload v1 fields (proposal, all signed):** `schemaVersion` (1), `licenceId` (unique per issued file), `issuedAt`, `notBefore`, `expiresAt`, `graceEndsAt` (ISO-8601 UTC instants with `Z`), `client {id, name}`, `deploymentId`, `timeZone` (IANA, display only), `support {renewalEmail, supportEmail, phone?, hours?}`. Optional informational additions are ignored by older verifiers (tolerant reader); a *required* new field needs `schemaVersion` 2.
**Verifier rules:** `notBefore ≤ expiresAt < graceEndsAt`; `issuedAt ≤ expiresAt`; `now + 10 min ≥ notBefore`; payload size ≤ 8 KiB total file; unsupported `schemaVersion` yields `UNSUPPORTED_SCHEMA`; `kid` absent from the trust set yields `UNKNOWN_KEY`; `kid` with status `revoked` yields `KEY_REVOKED`; `retired` keys still verify (D-02).
**Example:** see Code Examples.

### Pattern 2: Time-derived state, stored state only for transitions

`deriveState({record, now, attention})` is pure and uses UTC-instant arithmetic only (`graceEndsAt` is signed; the LMS never adds "14 days" itself, the generator does). Day counts are `Math.ceil((expiresAt - now) / 86_400_000)`; calendar/DST/leap-year behaviour then lives only in the *display* formatter. State vocabulary (distinct, per CONTEXT "Specific Ideas"): `UNLICENSED`, `ACTIVE`, `EXPIRING_SOON` (≤ 60 days), `GRACE`, `RESTRICTED_CONTINUITY`, `INVALID` (with `reasonCode`), `VALIDATION_ATTENTION`. `isRestricted = state ∈ {RESTRICTED_CONTINUITY, INVALID}`. `VALIDATION_ATTENTION` is not restricted until `attentionSince + 24 h`, after which the state becomes `INVALID` with `reasonCode = VALIDATION_WINDOW_EXHAUSTED`.

### Pattern 3: Stored state shape (Prisma, additive migration — costly door)

```prisma
// Singleton, seeded by the migration (and self-healed by the service via INSERT … ON CONFLICT DO NOTHING).
model DeploymentIdentity {
  id           String   @id @default("deployment")            // CHECK (id = 'deployment')
  deploymentId String   @unique @default(dbgenerated("gen_random_uuid()::text"))
  createdAt    DateTime @default(now())
}
// Append-only register of every successfully activated licence (supports replay detection, restored-backup diagnosis).
model LicenceRecord {
  id            String   @id @default(cuid())
  licenceId     String   @unique
  raw           String                                     // the signed file text, ≤ 8 KiB (public data, not a secret)
  keyId         String
  schemaVersion Int
  clientId      String
  issuedAt      DateTime
  expiresAt     DateTime
  graceEndsAt   DateTime
  activatedAt   DateTime @default(now())
  activatedById String?
  activatedBy   User?    @relation(fields: [activatedById], references: [id])
  @@index([issuedAt])
}
// Singleton pointer + derived/last-known-good state. One row, one atomic UPDATE.
model LicenceState {
  id                  String    @id @default("current")      // CHECK (id = 'current')
  activeRecordId      String?
  registeredClientId  String?                                 // trust-on-first-activation (A5)
  everActivated       Boolean   @default(false)
  state               String    @default("UNLICENSED")        // CHECK IN (...)
  restrictedAt        DateTime?                               // instant the current restriction began
  reasonCode          String?
  lastVerifiedAt      DateTime?
  lastVerificationOutcome String?                              // code, never free text
  lastGoodAt          DateTime?
  attentionSince      DateTime?
  highWaterAt         DateTime  @default(now())               // monotonic max observed time
  clockAlertAt        DateTime?
  version             Int       @default(0)
  updatedAt           DateTime  @updatedAt
}
```
Put every CHECK (`state` in the vocabulary, singleton ids, `version >= 0`) in the migration itself, as Phase 13 did for `EmailDispatch_status_check` [VERIFIED: migration `20260927015627_communications_notifications/migration.sql`]. `tests/support/pg.ts`' `applyMissingIntegritySql` inspects only the *first* `ADD CONSTRAINT`/`CREATE UNIQUE INDEX` name in a `prisma/sql/*.sql` companion file; a companion-only approach for multi-constraint files is unreliable, so do not rely on it.
**Deployment ID seeding:** the migration `INSERT`s the singleton (`gen_random_uuid()::text`, core in PostgreSQL ≥ 13 `[ASSUMED]`; `postgres:16-alpine` in tests, `postgres:16-alpine` in compose). `prisma/seed.ts` is a *development* seed (dev personas, `@kqnexus.test`) and is not a production install step, so seeding in the migration is the only mechanism that runs on every `migrate deploy` (Neon, Docker `migrate` service, Testcontainers). Restoring a backup restores the same ID, so DR works; copying a production DB to a second environment shares the ID (accepted: binding is to the database, not the host).

### Pattern 4: Verification cadence — what "startup / scheduled / before mutation" concretely means

| Trigger | Mechanism | Writes? |
|---------|-----------|---------|
| Before every guarded write | `licenceGuard.assertWriteAllowed()` inside `createWithPermission` (after the permission check) or an explicit guard; one PK read + `verify()` + `deriveState()`; **no per-process cache of the decision** | none on the allow path (high-water update throttled, see below) |
| Startup | `src/instrumentation.ts` `register()`; Node runtime only; wrapped in try/catch with a short timeout so it can never block boot | transition/audit only if outcome changed |
| Scheduled | `netlify/functions/check-licence.ts`, `0 * * * *` (hourly proposal); runs `evaluateAndRecord()` then emits notice events | CAS transition, high-water, last-good, events |
| Page/banner | read-only `getStatus()` (no transition side effects except throttled opportunistic transition, see Pitfall 6) | none |

Cost: Ed25519 verify measured at 128.8 µs average over 2000 iterations on Node 24.6.0 [VERIFIED: local run, scratchpad `ed.mjs`]; one PK read on a one-row table is comparable to the grant lookup `withPermission` already performs per call [VERIFIED: with-permission.ts:131 `deps.loadGrants`]. A per-process memo is therefore unnecessary on write paths and would reintroduce cross-instance staleness. A memo (≤ 5 s) is acceptable only for read-only banner/page rendering.
**High-water mark:** advance with `UPDATE … SET "highWaterAt" = GREATEST("highWaterAt", $now) WHERE "highWaterAt" < $now - interval '5 minutes'` so the allow path almost never writes. Rollback detection (D-12): `now < highWaterAt - 10 min` raises one audit event plus one `clock-rollback` notice, then re-baselines `highWaterAt = now` (prevents alert spam). Within a process, compare wall-clock delta against `performance.now()` delta to catch a mid-run jump even when the DB read is unavailable. **Evaluation uses the injected/real current time, not the high-water mark** (using it would let one forward clock error lock the system out permanently, contradicting "rather than locking anyone out").
**Last-known-good (D-04):** `verify()` returns a structured result for deterministic failures (`INVALID`, restricts immediately) and throws `LicenceUnavailableError` only for infrastructure failures (DB read error, trust set failed to load). Unavailability maps to `VALIDATION_ATTENTION`, keeps the last derived state for 24 h from `attentionSince`, emits a warning notice, then becomes `INVALID/VALIDATION_WINDOW_EXHAUSTED`.

### Pattern 5: Exactly-once transitions via compare-and-swap

`UPDATE "LicenceState" SET state=$new, restrictedAt=$t, version=version+1 WHERE id='current' AND state=$old RETURNING *` inside a transaction; only the caller that gets a row writes the `licence.state_changed` audit row (`recordAuditInTransaction`) and the notice event, so concurrent function instances cannot double-audit or double-notify. Activation takes `SELECT … FOR UPDATE` on the singleton (same advisory/row-lock discipline as `continuity-service.ts`, whose header documents "transaction-scoped advisory lock BEFORE reading current state" [VERIFIED: continuity-service.ts:14-18]).

### Pattern 6: Injected licence guard in `withPermission` (D-09)

`createWithPermission(deps)` gains an optional `licence?: { assertAllowed(effect, ctx): Promise<void> }` dependency and `withPermission(permission, resolveScope, options?)` gains an optional third argument `{ licence?: "read" | "write" | "continuity"; reason?: string }`. Default effect: permission ending in `.view` → `read`; ending in `.export` → `continuity`; anything else → `write`. The guard runs **after** `hasPermission` succeeds and **before** `handler(...)`, so an unauthorized caller always receives the identical denial regardless of licence state (no state oracle) [VERIFIED: current order in with-permission.ts lines 129-155]. The live binding is added in `src/server/permissions/index.ts` next to `createWithPermission({ getActor: getCurrentActor, loadGrants: loadGrantsForUser, audit: recordAuthorizationAudit, })`. Keeping it injected preserves the file's "free of framework imports" property and the existing `tests/with-permission.test.ts` harness style (add a `licence` fake).
**Why not permission-name defaults alone:** `.view` wrappers can front writes (`authorizeCase = deps.withPermission<string>("payments.view", findCaseScope)(async (_caseId, context) => context)` in `reconciliation-case-service.ts:329`), and one permission can cover both blocked and continuity operations (`enrolments.manage` covers add/approve/transfer *and* `overrideLessonProgress`; `users.manage` covers create, reactivate, deactivate *and* email-log resend). Hence per-call-site tags plus the registry test below.
**Error type:** define `LicenceRestrictedError` in `with-permission.ts` next to `AuthorizationError` (avoids an import cycle) and make it extend `AuthorizationError` so the ~79 files that already `catch (… instanceof AuthorizationError)` keep returning a result instead of throwing into the error boundary. Then add a shared `refusalMessage(error, fallback)` helper and update staff action catch blocks so a licence refusal never shows "Your role does not permit this action" (that text exists today in `src/app/staff/payments/actions.ts`). The existing `{ ok:false, message }` result convention is the right channel for the refusal text [CITED: server-actions.md "Constrain return values"; VERIFIED: `user-input-error.ts` header F-14d, "Actions show `message` for this class only. Any other error ... is logged and replaced by a safe fallback"].

### Pattern 7: Explicit guards and exemptions outside `withPermission`

`licenceGuard.assertWriteAllowed()` (same service function) is called at the top of `startCheckout`, `initiateStripePayment`, `initiatePaystackPayment` (inside `createCheckoutService(deps)` so tests inject it) and registration. Learner-facing copy for these is neutral ("Enrolment is temporarily unavailable. Please contact support."), never naming the licence. Everything else outside `withPermission` is registered as `continuity` or `system` with a reason string in a single `LICENCE_SERVICE_REGISTRY` (see Enforcement Inventory) and proven by the boundary test (Code Examples).

### Pattern 8: Alerts via deterministic domain-event ids (dedupe for free)

`DomainEvent.id` is `@default(cuid())` but accepts any string [VERIFIED: schema.prisma:1102]. Emit `licence.notice` with `id = "licence:" + licenceId + ":" + noticeKey` using `createMany({ skipDuplicates: true })` (a plain `create` duplicate aborts the surrounding Postgres transaction). The drain then derives `Notification.sourceEventId = event.id` and `EmailDispatch.correlationId = buildCorrelationId(event.id, holderId)`, whose uniqueness (`@@unique([recipientId, type, sourceEventId])`, `@@unique([template, correlationId])`) gives three dedupe layers with no new table. Evaluate only the *current* threshold bucket (smallest N with `daysRemaining ≤ N`), so a task that was down for a week emits one notice, not six. Notice keys: `expiring-60|30|14|7|3|1`, `expired` (grace began), `grace-ending` (3 days before grace end, proposal), `restricted`, `invalid-<reasonCode>`, `validation-attention`, `clock-rollback-<UTC hour>`.
**Required vocabulary edits (all compile-time exhaustive, so a miss is a type error):** `DomainEventType` union + `DOMAIN_EVENT_TYPE_SET` (`domain-event-service.ts`, `contracts.ts`); `NOTIFICATION_TYPES` + `NOTIFICATION_TYPE_TARGET` + `NOTIFICATION_TARGET_TYPES` (`STAFF_LICENCE`) in `contracts.ts`; `notificationHref` switch case returning `/staff/licence`; `NOTIFICATION_TEXT_BUILDERS` entry and any new `ALLOWED_PARAM_KEYS` (string-valued only; `pickSafeParams` drops non-strings); `TEMPLATE_IDS` + `TEMPLATE_CATEGORY` (`STAFF`, which is never mutable) + `STAFF_TEMPLATES`/`STAFF_SAMPLES`; a `MapperGroup` appended to `EVENT_MAPPER_GROUPS`. Existing exact-list tests (`tests/communications-contracts.test.ts`, `tests/notification-text.test.ts`, `tests/email-templates.test.ts`, `tests/event-intent-mappers.test.ts`) must be updated in the same plan.
**Recipients:** `resolveStaffHolders(ctx.tx, { permission: "licence.view", scope: {} })` (GLOBAL grants only; the type already admits `licence.view`) [VERIFIED: staff-recipient-service.ts:92-97; catalogue.ts].

### Pattern 9: Scheduled task (D-16)

Mirror `cleanup-notifications-task.ts` / `drain-domain-events-task.ts`: `createCheckLicenceTask(deps)` with injected `evaluateAndRecord`, `emitNotices`, `now`, `log`; wired singleton `runCheckLicenceTask`; `netlify/functions/check-licence.ts` exporting `createCheckLicenceHandler(run)`, `default`, and `config: { schedule: "0 * * * *" }`. Add the same three test shapes: `tests/check-licence-task.test.ts`, `tests/netlify-check-licence.test.ts` (schedule string + run-once), and a `tests/boundary.test.ts` case ("rejects a Prisma import from the check-licence Netlify scheduled function" + closure non-vacuity reaching `licence-service.ts`). Netlify limits: 30 s per run, runs only on published deploys, overlapping/missed-run behaviour is not documented, so the task must be idempotent [CITED: docs.netlify.com/build/functions/scheduled-functions/]. Add a section to `docs/deployment/netlify-scheduled-functions.md`.

### Pattern 10: Startup check

Create `src/instrumentation.ts` (project uses `src/`; the doc says place it inside `src` alongside `app`) exporting `async function register()` that returns immediately unless `process.env.NEXT_RUNTIME === 'nodejs'`, then dynamically imports the licence startup module and awaits it under a ~3 s timeout inside try/catch [CITED: node_modules/next/dist/docs/01-app/02-guides/instrumentation.md and 03-api-reference/03-file-conventions/instrumentation.md: "called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests"; runtime check pattern `process.env.NEXT_RUNTIME === 'nodejs'`]. Audit only on outcome *change* (cold starts on a serverless host would otherwise write one audit row per cold start). Whether Netlify's runtime executes `register()` on each cold start is not confirmed by documentation found `[ASSUMED]`; do not rely on it, because the guard re-verifies on every write anyway.

### Pattern 11: UI mirror (courtesy only)

Staff layout computes `{ restricted, stateLabel }` once per full render and passes a `banner` node and a `licenceRestriction` value into `StaffShell` (new optional props, as `bell` was added) which provides a small React context. `ResourceForm` and `ConfirmModal` read it and disable their submit/confirm with an `aria-describedby` reason when `licenceEffect !== "continuity"` (default `"write"`); screens whose actions are continuity (grading, certificate issuance, attendance, refunds, exports) pass `licenceEffect="continuity"`. Disabled state must be understandable without colour (PRD §18.5 accessibility row). Layouts do not re-render on soft navigation [CITED: layout.md "Layouts do not rerender."], so also render the state in each licence-sensitive page header or accept page-load staleness; server denial messaging remains authoritative. Learner shells show **no** licence text.

### Pattern 12: Admin screen, activation and diagnostics

Add `{ label: "Licence", href: "/staff/licence", group: "Administration" }` to `NAV` and `"/staff/licence": "licence.view"` to `NAV_PERMISSION` in `src/app/staff/layout.tsx`, plus an icon entry in `StaffShell` `NAV_ICONS` (existing quoted entry: `{ label: "Audit", href: "/staff/audit", group: "Administration" },`). Use `DetailLayout`/`DetailFacts`, `StatusPill`, `ConfirmModal`, `ResourceForm` primitives (exported from `src/components/primitives/index.ts`). Activation is two server actions: `inspectLicenceAction` (verify + return the *verified* preview, no persistence; show detected client/deployment/dates only after the signature verified) then `activateLicenceAction` (re-verifies from the submitted text; never trusts the preview). Input handling: accept a file (≤ 8 KiB checked via `File.size` before `.text()`) or a pasted textarea; strict zod schema; ASCII allow-list `^[A-Za-z0-9._-]+$` with newline trimming; reject others with a fixed reason code; the Server Action default 1 MB body cap is a backstop, not the control [CITED: server-actions.md "Body size limit... capped at 1MB by default"]. Rejection reasons are a closed code set mapped to fixed sentences (`BAD_FORMAT`, `UNSUPPORTED_SCHEMA`, `UNKNOWN_KEY`, `KEY_REVOKED`, `BAD_SIGNATURE`, `WRONG_DEPLOYMENT`, `WRONG_CLIENT`, `NOT_YET_VALID`, `EXPIRED`, `OLDER_THAN_ACTIVE`, `ALREADY_ACTIVE`).
**Diagnostic report:** `GET /api/staff/licence/diagnostic` returning `application/json`, `Content-Disposition: attachment`, `Cache-Control: private, no-store` (same discipline as `/api/notifications/unread`), gated by `withPermission("licence.view", …)`, audited `licence.diagnostic_downloaded`. Fields: `reportVersion`, `generatedAt`, `state`, `reasonCode`, `licenceId`, `keyId`, `schemaVersion`, `deploymentId`, `registeredClientId`, `issuedAt`/`expiresAt`/`graceEndsAt` (UTC), `lastVerifiedAt`, `lastVerificationOutcome`, `attentionSince`, `highWaterAt`, `clockSkewSeconds`, `trustSetKeyIds` (ids only), app version. Never: env vars, DB URL, stack traces, user data, raw payload of an unverified file.
**Timezone display:** the app pins `"Africa/Lagos"` for staff-facing grouping (`APP_TIMEZONE` in `notification-text.ts`; shell header literal `Africa/Lagos`) and `formatTimestamp` pins UTC to avoid hydration mismatches [VERIFIED: format-timestamp.ts header; notification-text.ts:31]. Render licence instants with a pure `formatInTimeZone(date, ianaZone)` using `Intl.DateTimeFormat` with explicit `timeZone`/`timeZoneName`, taking the zone from the signed payload `timeZone` (default display `Africa/Lagos` if the field were ever optional) and always showing the UTC instant beside it.

### Pattern 13: Provider-side issuer CLI (D-03)

`provider-tools/licence-issuer/cli.ts` run with `npx tsx` (existing dependency), commands `keygen --kid`, `issue …`, `verify <file>`, `inspect <file>`. It imports the same pure `src/server/licence/format.ts` so signer and verifier cannot drift, and is excluded from the Docker context by adding `provider-tools` to `.dockerignore` (current file excludes `docs`, `tests`, `.planning`, `design`, `reference` etc. [VERIFIED: .dockerignore]). The private key is read from a path/stdin only (PKCS#8 PEM, passphrase-protected recommended), never from the repo. Grace is a generator input defaulting to 14 × 24 h in UTC (`graceEndsAt = expiresAt + 14 d`), so the contract rule "14 calendar days" is unambiguous because arithmetic is in UTC. A source-handover note belongs in `RUNBOOK.md`: for a self-hosted client handover, ship the repository without `provider-tools/` (Open Question 6). Tests mint with `tests/support/licence-fixtures.ts` using a throwaway keypair generated per run (or one committed dev key for golden vectors).

## Enforcement Inventory

**Classification vocabulary:** `BLOCK` (blocked in restricted state), `CONTINUITY` (always allowed), `READ` (never evaluated), `SYSTEM` (actorless task/webhook, documented exemption), `GUARD` (explicit guard call).

### A. `withPermission` call sites (121 literal sites from an AST scan; dynamic-permission sites such as `resource-service` factories and `makeTerminalAction` must be flagged by the scanner)

| Permission / entry | Service files | Class | Notes |
|---|---|---|---|
| `*.view` | audit-read, payment-read, roster, ticket reads, certificate reads, course/lesson/module reads, role reads, cohort reads | READ | Default by suffix. Scanner must still list `.view` sites that perform writes; known: `authorizeCase` (`payments.view`) fronting reconciliation assign/resolve → tag `CONTINUITY` |
| `courses.create/edit/publish`, `programmes.manage/publish`, `cohorts.manage/publish` | course, module, lesson, lesson-resource, reorder, publish, programme, cohort, scheduled-session services; `/api/lesson-resources/upload-intent` | BLOCK | Content/publishing/settings. Includes cohort instructor changes and session create/update/cancel |
| `assessments.create/edit` | assessment-service | BLOCK | Authoring is content change |
| `certificates.manage` | certificate-template-service, template-asset actions | BLOCK | Template authoring is a settings change |
| `enrolments.manage` add / approve / transfer / withdraw / cancel | enrolment-service (lines 427, 518, 578, 633, 639) | BLOCK | "New enrolments"; refunds still revoke access internally via `revokeAccessForOrder` |
| `enrolments.manage` `overrideLessonProgress` | lesson-progress-service:705 | CONTINUITY `[ASSUMED]` | Progress recording; confirm (A9) |
| `users.manage` create, reactivate; `roles.manage` (assignment, role edits, scope lookup) | staff-account, assignment, role, scope-lookup | BLOCK | "Staff and permission changes" (D-06) |
| `users.manage` deactivate | staff-account-service:286 | CONTINUITY `[ASSUMED]` | Security administration (session revoke on deactivate); confirm (A10) |
| `users.manage` email-log resend | email-delivery-log-service:148 | CONTINUITY | Transactional email (D-07); would be blocked by default if untagged |
| `grades.manage` | grading-service, grade-override-service | CONTINUITY | D-06 grading |
| `certificates.issue` / `certificates.revoke` | certificate-service | CONTINUITY | D-06 certificate issuance; revoke is corrective |
| `attendance.manage` | attendance-service:467, 540 | CONTINUITY `[ASSUMED]` | Feeds completion/certificates; confirm (A9) |
| `refunds.manage` | refund-service:355; reconciliation-case-service | CONTINUITY | D-07/D-08 |
| `payments.confirm` | manual-payment-service:198 | CONTINUITY with order-created-before-restriction check `[ASSUMED]` | Manual confirmation of an offline payment already owed; Open Question 4 |
| `tickets.manage` | ticket-service:463 | CONTINUITY `[ASSUMED]` | Support continuity; confirm (A11) |
| `reports.export`, `audit.export` | export-service, audit-export-service (use `getCurrentActor` + own checks, not `withPermission`) | CONTINUITY | D-07 export; also see section C |
| `licence.activate` | new activation action | CONTINUITY, always | Recovery route; never blockable |
| `licence.view` | new page/diagnostic | READ | — |

### B. Entry points that do not use `withPermission` (service-file registry)

| Service file(s) | Class | Mechanism / reason |
|---|---|---|
| `checkout-service.ts` (`startCheckout`, `initiateStripePayment`, `initiatePaystackPayment`) | GUARD / BLOCK | New order, seat hold, provider session creation. `retireOpenPaymentAttempts` stays allowed |
| `registration-service.ts` | GUARD / BLOCK `[ASSUMED]` | New accounts are "new commercial use" in the research table ("New courses, users, enrolments"); confirm (A12). Verification, sign-in, password reset stay allowed |
| `attempt-service`, `learner-quiz-service`, `submission-service`, `lesson-progress-service` learner functions, `completion-service`, `certificate-issuance-service`, `certificate-file-service` | CONTINUITY | D-06 coursework/progress/submissions/assessment/certificates |
| `auth-service`, `session-service`, `verification-service`, `password-reset-service`, `profile-service`, `email-preference-service`, `notification-service`, `ticket-attachment-service`, learner `ticket-service` functions | CONTINUITY | D-07 identity/security/notifications; support `[ASSUMED]` |
| `export-service`, `export-read-service`, `export-download-service`, `export-worker-service`, `audit-export-service`, `audit-service` | CONTINUITY | D-07 export; audit must always write |
| `checkout-webhook-system-service` | SYSTEM with rule | Always record webhook; activation only if `attempt.initiatedAt < restrictedAt + 10 min` else existing `order.exception` path with a new coded reason (Pitfall 9) |
| `payment-reconciliation-service`, `hold-release-system-service`, `upload-cleanup-system-service`, `ticket-auto-close-system-service`, `seat-accounting` (release paths), `enrolment-transitions`, `email-dispatch-service`, `email-failure-alert-service`, `domain-event-drain-service`, `domain-event-service` | SYSTEM | Cleanup, financial reconciliation, outbox; allowed by D-07/D-08 |
| New: `licence-service`, `licence-notice-service` | LICENCE | Own the writes; classified so the registry stays complete |

### C. Route handlers and server actions

| Entry | Class |
|---|---|
| `/api/webhooks/stripe`, `/api/webhooks/paystack` | SYSTEM (never behind the write guard) |
| `/api/lesson-resources/{upload-intent, complete, [id]}` | BLOCK (via `courses.edit`) |
| `/api/ticket-attachments/{upload-intent, complete}`, `/api/notifications/*`, certificate/submission/ticket/export downloads, `/staff/cohorts/[id]/exceptions/csv` | CONTINUITY / READ |
| `(checkout)/actions.ts`, `(checkout)/checkout/[orderId]/actions.ts` | GUARD via service; neutral learner copy |
| `(auth)/*` actions | CONTINUITY (register: GUARD per A12) |
| `account/actions.ts`, `notifications/actions.ts`, learner support/lesson/assessment/submission actions | CONTINUITY |
| 33 staff action files | follow the service classification above; each action that catches `AuthorizationError` must map `LicenceRestrictedError` via the shared helper |

### D. Scheduled functions (all SYSTEM, continuity by design)

`cleanup-notifications`, `cleanup-stale-uploads`, `close-resolved-tickets`, `dispatch-export-jobs`, `drain-domain-events`, `expire-export-jobs`, `process-export-jobs-background`, `reconcile-payments`, `release-expired-holds` [VERIFIED: `netlify/functions/` listing] plus the new `check-licence`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signatures | Any custom MAC/XOR/obfuscation | `node:crypto` Ed25519 | D-02; asymmetric so the client holds no signing capability |
| Canonical JSON | A canonicaliser | Sign the exact payload bytes (Pattern 1) | Eliminates a whole bug class and a second implementation |
| Notification dedupe | A licence-specific "sent" table | Deterministic `DomainEvent.id` + existing unique constraints | Three existing dedupe layers already cover it |
| Staff recipient lookup | A new "administrators" query | `resolveStaffHolders` | Already drain-safe and parity-tested against `hasPermission` |
| Audit | A licence audit table | `recordAudit` / `recordAuditInTransaction` | Append-only, redacting sink; `tests/audit-append-only.test.ts` enforces a single creator |
| Cross-instance state cache | In-memory/`use cache` state | PK read per guarded write | Next caches are per-instance, uncoordinated |
| Time-zone display | Hand-rolled offset maths | `Intl.DateTimeFormat` with `timeZone` | `src/lib/timezone.ts` documents the hand-rolled DST caveat; display-only needs none of it |
| Write-path discovery | Manual lists in a doc | AST scan test over `src/server/services/**` | Services are the only Prisma importers (ESLint), so the scan is complete |

**Key insight:** every individually "easy" piece (a signature check, a date compare) is where licensing code usually breaks (canonicalisation, time zones, replay, check-then-act). Keep each piece pure, tiny and fixture-tested.

## Common Pitfalls

### Pitfall 1: Permission-suffix classification silently blocks or leaks
**What goes wrong:** `users.manage` resend and `enrolments.manage` progress override get blocked; a `.view` wrapper fronting a write is never evaluated.
**Why:** one permission spans several operations; `.view` is not a safe proxy for "read".
**How to avoid:** per-call-site `licence` tags for every exception, the registry test, and a snapshot test of the continuity allowlist (file, permission, reason).
**Warning signs:** a `withPermission` call whose first argument is not a string literal; a continuity action failing only in restricted-state integration tests.

### Pitfall 2: Guard before authorization becomes a state oracle
**What goes wrong:** an unauthorized caller learns the licence is restricted.
**How to avoid:** guard strictly after `hasPermission` (Pattern 6); test that an unauthorized actor gets the identical `AuthorizationError` in ACTIVE and RESTRICTED states.

### Pitfall 3: Reading `highWaterAt` as "now"
**What goes wrong:** one forward clock error persists in the DB and restricts everyone.
**How to avoid:** use it for detection and alerting only (D-12 "rather than locking anyone out").

### Pitfall 4: Replay/downgrade of an older valid licence
**What goes wrong:** the provider issues a replacement with an earlier expiry (the only revocation tool without an online validator); the client re-uploads the older, longer file.
**How to avoid:** signed `issuedAt` required; activation rejects `issuedAt` older than the greatest `LicenceRecord.issuedAt` unless the same `licenceId` (idempotent re-activation); `licenceId` unique. Tests: older-valid rejected, same-file idempotent, equal-issuedAt different id rejected `[ASSUMED]`.

### Pitfall 5: Scheduler assumed present
**What goes wrong:** `docker-compose.yml` ships postgres/minio/migrate/app only; `docs/deployment/netlify-scheduled-functions.md` says production uses Netlify Scheduled Functions. In a compose-only deployment the hourly task, the Phase 13 drain and reconciliation never run.
**How to avoid:** restriction must not depend on the task (time-derived, Pattern 2); transitions are also observed opportunistically (Pitfall 6); record the hosting question (Open Question 5).

### Pitfall 6: Writes on the read path
**What goes wrong:** opportunistic transition recording from page renders or guard denials causes write storms or errors that break reads.
**How to avoid:** CAS transition is idempotent; attempt it at most once per request, wrapped in try/catch, and only when derived state ≠ stored state; throttle high-water writes (5 min).

### Pitfall 7: Audit flooding
**What goes wrong:** one `licence.verified` audit row per cold start or per guarded write; or one `licence.restriction_enforced` row per request from a hammering client.
**How to avoid:** audit verification outcome only on change plus one daily summary from the task; audit enforcement per denial but include `permission` in `after` and consider a 1-per-actor-per-minute coalescing rule `[ASSUMED]`.

### Pitfall 8: Layout-rendered banner goes stale
**What goes wrong:** the banner reflects the state at last full render; Next layouts do not re-render on navigation [CITED: layout.md].
**How to avoid:** call `revalidatePath("/staff", "layout")` after activation (existing actions use `revalidatePath`), keep server denial text authoritative, optionally poll a small `no-store` status route like the bell does (`POLL_INTERVAL_MS = 60_000` in `NotificationBell.tsx`).

### Pitfall 9: Payment completion after restriction
**What goes wrong:** a learner paid before the cutoff, the webhook arrives after; blanket-blocking charges them without enrolment (the "charged-but-undelivered" failure D-08 forbids). The opposite mistake activates enrolments for attempts created after restriction.
**How to avoid:** compare `PaymentAttempt.initiatedAt` (exists, `@default(now())`) with the stored `restrictedAt`, with a 10-minute tolerance so a guard check at T-ε whose attempt row lands at T+ε is not mis-flagged (TOCTOU). Failures go through the existing `order.exception` mapper with a new coded reason label ("Payment received after restriction"), and refunds stay allowed so staff can resolve it. Tests: expiry exactly during an in-flight payment (before/after boundary, within tolerance).

### Pitfall 10: Lock-out of recovery
**What goes wrong:** restricted mode blocks role/permission changes; if nobody holds `licence.activate`, nobody can recover.
**How to avoid:** keep the activation route continuity-always; keep `licence.activate` on the seeded Administrator (see Open Question 3); add a test that a restricted deployment still lets an Administrator activate. Consider extending the RBAC-07 continuity safeguard to `licence.activate` `[ASSUMED]`.

### Pitfall 11: Old licence schema versions after an LMS upgrade
**What goes wrong:** dropping `schemaVersion` 1 support restricts every deployment holding a v1 licence (restricts immediately per D-04).
**How to avoid:** `SUPPORTED_SCHEMA_VERSIONS` only ever grows within a licence-term horizon; committed golden `.lic` vectors per version run in CI.

### Pitfall 12: Wording drift ("read-only")
**What goes wrong:** copy, tests or docs say "read-only" for the post-grace state (the existing PRD/PXR/REQUIREMENTS/ROADMAP all do).
**How to avoid:** one `RESTRICTED_CONTINUITY_LABEL` constant, a wording test over licence-owned files, and the amendment checklist below. Unrelated "read-only" uses elsewhere in `src` (for example `audit-read-service.ts` header "Read-only access to the audit trail") are legitimate; scope the test to licence files and licence-context doc lines.

### Pitfall 13: Migration/CHECK handling
**What goes wrong:** CHECKs placed only in a `prisma/sql` companion file are skipped by the test harness when the first constraint name already appears in a migration; `db push`-only databases miss the seeded deployment row.
**How to avoid:** CHECKs and the seed `INSERT` live in the migration; `ensureDeploymentIdentity()` self-heals with `INSERT … ON CONFLICT DO NOTHING`.

## Code Examples

> All identifiers below that do not already exist in the repo are **proposals** (`[ASSUMED]` names). Existing repo values referenced are quoted in the sections above. The Ed25519 calls were exercised in this session (`ed.mjs`).

### Verify a compact licence (pure, no Prisma)

```ts
// src/server/licence/verify.ts  (sketch)
import { createPublicKey, verify } from "node:crypto";

export function verifyEnvelope(raw: string, trust: ReadonlyMap<string, { x: string; status: "active" | "retired" | "revoked" }>) {
  const text = raw.trim();
  if (text.length === 0 || text.length > 8192 || !/^[A-Za-z0-9._-]+$/.test(text)) return { ok: false as const, code: "BAD_FORMAT" };
  const parts = text.split(".");
  if (parts.length !== 4 || parts[0] !== "LMS-LIC1") return { ok: false as const, code: "BAD_FORMAT" };
  const [prefix, hdrB64, payloadB64, sigB64] = parts;
  const header = safeJson(Buffer.from(hdrB64, "base64url").toString("utf8"));
  if (!header || header.alg !== "Ed25519" || typeof header.kid !== "string") return { ok: false as const, code: "BAD_FORMAT" };
  const key = trust.get(header.kid);
  if (!key) return { ok: false as const, code: "UNKNOWN_KEY" };
  if (key.status === "revoked") return { ok: false as const, code: "KEY_REVOKED" };
  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.x }, format: "jwk" });
  const signedInput = Buffer.from(`${prefix}.${hdrB64}.${payloadB64}`, "utf8");
  let valid = false;
  try { valid = verify(null, signedInput, publicKey, Buffer.from(sigB64, "base64url")); } catch { valid = false; }
  if (!valid) return { ok: false as const, code: "BAD_SIGNATURE" };
  return { ok: true as const, header, payloadJson: Buffer.from(payloadB64, "base64url").toString("utf8") }; // then zod-parse
}
function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }
```
Behaviour observed locally (Node 24.6.0): a short/truncated signature returns `false` rather than throwing, tampering one byte of the signed input returns `false`; keep the `try/catch` for other Node versions `[ASSUMED]`.

### Injected guard in the choke point (sketch)

```ts
// with-permission.ts (additions)
export type LicenceEffect = "read" | "write" | "continuity";
export type LicenceGuardDep = { assertAllowed(input: { effect: LicenceEffect; permission: Permission; actorId: string }): Promise<void> };
// in createWithPermission(deps: WithPermissionDeps & { licence?: LicenceGuardDep })
//   step 1-3 unchanged (authenticate, resolveScope, loadGrants, hasPermission -> AuthorizationError)
//   step 4 (new):
//     const effect = options?.licence ?? defaultEffectFor(permission);
//     if (deps.licence && effect === "write") await deps.licence.assertAllowed({ effect, permission, actorId: actor.userId });
//   step 5 unchanged: return handler(input, { actor, resource, grants });
```

### Deterministic event write (sketch)

```ts
// licence-notice-service.ts — createMany + skipDuplicates avoids aborting the tx on a duplicate id
await tx.domainEvent.createMany({
  data: [{ id: `licence:${licenceId}:${noticeKey}`, type: "licence.notice", payload: { licenceId, noticeKey }, occurredAt: now }],
  skipDuplicates: true,
});
```

### Registry-driven boundary test (sketch of the assertions)

```ts
// tests/licence-enforcement-boundary.test.ts
// 1. walk src/server/services/**/*.ts; a file "writes" if its AST has a call to
//    .create/.createMany/.update/.updateMany/.delete/.deleteMany/.upsert/$executeRaw(Unsafe),
//    or a tagged/raw SQL template matching /\b(INSERT INTO|UPDATE\s+"|DELETE FROM)\b/i
// 2. every writing file must appear in LICENCE_SERVICE_REGISTRY (kind: "withPermission" | "guard" | "continuity" | "system" | "licence", reason: string)
// 3. kind "withPermission": file contains a withPermission/authorize call; every call with a literal permission is READ-by-suffix,
//    default-blocked, or carries an explicit { licence: "continuity", reason } option; a non-literal first argument fails unless listed
// 4. kind "guard": file calls assertWriteAllowed / licence guard
// 5. snapshot of every continuity-tagged (file, permission) pair equals the reviewed allowlist (Pitfall 1)
// 6. closure checks: checkout-webhook-system-service and netlify/functions closures still free of next/headers and @/server/permissions
```
The AST scan in this session (`inv.cjs`, TypeScript compiler API, same approach `tests/import-graph.ts` already uses) enumerated 121 literal sites and demonstrates feasibility.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` | `proxy.ts` (Node runtime default) | Next 16.0.0 [CITED: proxy.md version history] | Do not use proxy for licence gating: it is a request-edge hook with no reliable DB/transaction story here and would not cover server-action internals. The service-layer guard is the gate |
| Per-request global state | `instrumentation.ts register()` once per server instance | stable since 15.0.0 [CITED: instrumentation.md version table] | Use only as a best-effort startup check |
| Online validator + receipts (research input default) | Local signed file only | CONTEXT D-01 | Removes "validator unreachable" state; keep stored-state shape extensible |

**Deprecated/outdated:** the repo's own `catalogue.ts` comment "The licence module is deferred" and the roadmap "read-only" phrasing are stale after this phase and should be updated with the wording pass.

## PRD / PXR / Planning-Doc Amendment Map (D-08a)

CONTEXT names PRD §18.2, §19 and PXR §11.5. Reading the files this session shows the contradicting text is in more places (PXR §11.5 itself contains no read-only wording). Locations [VERIFIED by reading `docs/reference/*.md`]:

| File | Line(s) | Current text (abridged) | Change to |
|---|---|---|---|
| PRD | 741 (§18.2 table row "Expired / read-only") | "Block new operational changes, including publishing, payment confirmation, new enrolment activation, grading/certificate changes, staff/permission changes and settings changes." | State name "Restricted continuity mode"; block publishing, new enrolments, new checkout sessions, staff/permission and settings changes; continue coursework, progress, submissions, assessment, grading, certificate issuance, refunds/reversals/webhooks, export, sign-in/security, licence activation |
| PRD | 752 (LIC-05), 755 (LIC-08) | "restricted/read-only state", "Read-only restrictions" | "restricted continuity mode" |
| PRD | 783 (§18.6 row "Post-expiry learner access…") | "Use read-only restriction and no deletion" | "Use restricted continuity mode and no deletion" |
| PRD | 852 (§19.4 "Software licence interaction") | blocks payment confirmation, refund initiation/recording and new enrolment activation for every method | Webhooks, reconciliation, refunds, reversals, disputes stay operational; payments initiated before the restriction timestamp complete and receive their entitlement; new checkout sessions are blocked |
| PRD | 862 (§19.5 test matrix "expired-licence restriction") | row lists the scenario | Re-word to "restricted-continuity-mode behaviour (new checkout blocked, in-flight payment completes, refund/webhook operational)" and add expiry-during-payment |
| PXR | 365 (§11.1 table row), 380-387 (§11.3 matrix incl. rows for confirm payment, attendance/grade/certificate, learner), 397 (§11.4 step 5), 469 (§12.4 row), 481 handoff mention | "Expired / read-only", blocked grading/certificate/payment/refund | Align every row with D-06/D-07/D-08 (PXR §11.3 currently says attendance, grading and certificate actions are blocked, the opposite of D-06) |
| `.planning/REQUIREMENTS.md` | 169, 172 | LIC-05/LIC-08 wording | "restricted continuity mode" |
| `.planning/ROADMAP.md` | 35, 763 | "read-only enforcement" | "restricted continuity mode enforcement" |
| `.planning/intel/requirements.md` | 600, 618 | mirrored LIC wording | same |
| `src/server/permissions/catalogue.ts` | 82-83 comment | "The licence module is deferred" | update comment |

**Also:** `docs/reference` holds `.docx` twins of the PRD and PXR; the edits above target the `.md` files and regenerating the `.docx` is a manual or user-owned step (Open Question 7). The contract is outside the repo and owned by the user.
**Wording-consistency check (test):** `tests/licence-wording.test.ts` asserting (a) licence-owned source/test/copy files contain no `/read[- ]only/i`; (b) no line in the PRD/PXR/REQUIREMENTS/ROADMAP that mentions licence/expiry also says "read-only"; (c) `RESTRICTED_CONTINUITY_LABEL` is the only definition of the phrase; (d) UI strings and notification/email text import the constant.

## Runtime State Inventory

Not a rename/migration phase (additive feature). The one rename-like activity, the wording amendment, is documentation plus string constants: Stored data none, live service config none, OS-registered state none, secrets/env none (no env var carries licence data), build artifacts none (the `provider-tools` directory is excluded from the image; add to `.dockerignore`). Netlify gains one scheduled function that must be verified on the next production deploy per the existing doc procedure.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A deployment that has never activated a licence (`UNLICENSED`) stays fully operational until the first activation, after which enforcement is permanent (`everActivated`) | Pattern 2 / Open Q 1 | One-way commercial door: otherwise every existing/dev/test DB is restricted on upgrade, or never-activate bypasses the licence |
| A2 | `gen_random_uuid()` is available as a core function (PostgreSQL ≥ 13) on every target DB (Neon, Docker 16) | Pattern 3 | Migration fails on an old server; fall back to `uuid-ossp` or app-side generation |
| A3 | Netlify's Next runtime executes `instrumentation.ts register()` per cold start | Pattern 10 | Startup check silently absent on Netlify; mitigated because writes re-verify per call |
| A4 | Default grace-ending notice = 3 days before grace end; "expiring soon" = ≤ 60 days; hourly cadence | Pattern 8/9 | Cosmetic; thresholds are code defaults (D-10) |
| A5 | "Wrong-client" is enforced by pinning `client.id` at first activation (trust on first activation) since the LMS has no other client identity | Pattern 3 | If a seeded/env client identity is wanted instead, schema changes; ask user |
| A6 | Tolerant-reader rule (ignore unknown optional payload fields, require `schemaVersion` bump for new required fields) | Pattern 1 | Format contract; one-way once issued |
| A7 | Activation rejects `issuedAt` older than the greatest recorded `issuedAt` (anti-replay) | Pitfall 4 | If the provider needs to re-issue an older-dated file, ops friction; format is one-way |
| A8 | Dev trust keys are trusted only when `NODE_ENV !== "production"` | Pattern 1 / trust-set | A self-hosted client controlling env could enable dev keys; accepted per PRD "speed bump, not a lock" |
| A9 | `attendance.manage` and staff `overrideLessonProgress` are continuity (progress recording) | Inventory A | If the user wants attendance blocked, completion for existing cohorts stalls |
| A10 | Staff deactivation (`users.manage`) is continuity as security administration; staff creation and reactivation are blocked | Inventory A | Over/under-blocking of account administration |
| A11 | Support tickets (learner and staff) remain available in restricted mode | Inventory A/B | Support loss during renewal disputes |
| A12 | New learner registration is blocked in restricted mode; sign-in/verify/reset allowed | Inventory B | If allowed, accounts accumulate with no purchasable offers; if blocked, copy must be neutral |
| A13 | Manual payment confirmation is allowed only for orders created before the restriction | Inventory A / Open Q 4 | Finance cannot clear a bank-transfer backlog after restriction if blocked outright |
| A14 | Audit denial coalescing (≤ 1 row per actor per minute) is acceptable | Pitfall 7 | Slightly less forensic volume |
| A15 | `.dockerignore` exclusion plus a runbook note is sufficient to keep `provider-tools/` out of a client handover | Pattern 13 / Open Q 6 | Source-handover could expose the generator code (never the key) |
| A16 | ASVS 4.0 chapter numbering used in the Security Domain table | Security | Cosmetic mapping |

## Open Questions

1. **What happens on a deployment with no licence ever activated?**
   - Known: no policy in CONTEXT; PRD §18.6 says show dates only after commercial approval; ROADMAP marks the phase contingent.
   - Unclear: unrestricted pilot until first activation (A1), restricted from day one, or an env/flag switch.
   - Recommendation: A1 (unrestricted until first activation, then permanent), confirmed with the user before planning the migration default; it is the only choice that does not break existing DBs/tests.
2. **Is "licence ID" per issued file or per customer lineage?**
   - Recommendation: per issued file (unique), with `issuedAt` ordering; notice dedupe keys then renew naturally on replacement.
3. **Seeded Administrator holds `licence.activate`** (`permissions: [...PERMISSIONS]` in `prisma/seed.ts:39`) versus PRD §18.4 "assigned only to deliberately restricted Administrators", and restricted mode blocks role changes.
   - Recommendation: keep both on the seeded Administrator for now (recovery safety), document the deviation, and let the client create a narrower custom role via role management before launch; decide with the user.
4. **Manual payment confirmation after restriction** (A13): confirm the "order created before restriction" rule.
5. **Hosting target:** PROJECT.md says Docker Compose self-hosted; `docs/deployment` says production uses Netlify Scheduled Functions; compose has no scheduler. Confirm where scheduled work runs; the design tolerates both (Pitfall 5) but alert delivery needs a scheduler.
6. **Provider tool location:** in-repo `provider-tools/` (recommended, shared format module, golden vectors) versus a separate provider repo. For source handover to a client, which is intended?
7. **`.docx` twins of PRD/PXR:** who regenerates them after the `.md` edits?
8. **Learner-facing copy during restriction** (neutral "temporarily unavailable"): confirm no licence wording reaches learners.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.6.0 local; Docker image `node:22-alpine`; Netlify default Node 24 | — |
| Docker daemon | Testcontainers integration tests | ✓ | server 28.3.3 | Integration tests report BLOCKED (existing failure mode in `tests/support/pg.ts`) |
| vitest | tests | ✓ | 4.1.11 | — |
| Prisma CLI | migrations | ✓ | `node_modules/.bin/prisma` | — |
| tsx | provider CLI | ✓ | `node_modules/.bin/tsx` | — |
| ESLint | boundary test | ✓ | in `node_modules/.bin` | — |
| Netlify CLI / deploy | scheduled function proof | not probed | — | Manual "Run now" verification after a production deploy (existing doc) |
| HSM/vault for the production private key | provider runbook | external | — | Provider process; out of repo |

**Missing dependencies with no fallback:** none for development and CI.
**Missing dependencies with fallback:** Netlify runtime verification is a post-deploy human step.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.11 (`test.projects`: `node`, `components`) |
| Config file | `vitest.config.mts` (node project includes `tests/**/*.test.ts`; components project `tests/components/**/*.test.tsx`) |
| Quick run command | `npx vitest run tests/licence --project node` (filter matches `tests/licence-*.test.ts`); single file e.g. `npx vitest run tests/with-permission.test.ts --project node` |
| Full suite command | `npm test` (`vitest run --no-file-parallelism`); integration files need Docker |

Baseline verified this session: `npx vitest run tests/with-permission.test.ts tests/netlify-cleanup-notifications.test.ts --project node` passed 14/14 in ~2 s.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIC-01 | altered payload, bad signature, unknown/revoked key, wrong deployment, wrong client, unsupported schema, not-yet-valid, expired all rejected; retired key still verifies; old-schema golden vectors verify | unit | `npx vitest run tests/licence-verify.test.ts --project node` | ❌ Wave 0 |
| LIC-01 | format/signed-input shared by CLI and verifier (round trip, tolerant reader) | unit | `npx vitest run tests/licence-format.test.ts --project node` | ❌ Wave 0 |
| LIC-01/04 | state derivation at exact boundaries: expiry instant, grace end, leap day 2028-02-29, Africa/Lagos date rollover, 60/30/14/7/3/1 thresholds | unit (fake `now`) | `npx vitest run tests/licence-state.test.ts --project node` | ❌ Wave 0 |
| LIC-02 | status page DTO excludes secrets; time-zone display; diagnostic report fields allow-list | unit | `npx vitest run tests/licence-status-view.test.ts --project node` | ❌ Wave 0 |
| LIC-02/03 | page and actions gated by `licence.view`/`licence.activate`; denial parity; UI offers no create/extend controls | component + unit | `npx vitest run tests/components/licence-status.test.tsx --project components` | ❌ Wave 0 |
| LIC-03 | activation rejects wrong client/deployment, older `issuedAt`, oversize/non-ASCII input, duplicate; single atomic CAS; no partial update; concurrent activation | integration (Testcontainers) | `npx vitest run tests/licence-activation.integration.test.ts --project node` | ❌ Wave 0 |
| LIC-04 | startup hook never throws/blocks; scheduled task idempotent; last-known-good 24 h then restrict; clock rollback alert without lock-out; skew tolerance 10 min | unit | `npx vitest run tests/check-licence-task.test.ts tests/licence-clock.test.ts --project node` | ❌ Wave 0 |
| LIC-04 | Netlify function schedule + run-once | unit | `npx vitest run tests/netlify-check-licence.test.ts --project node` | ❌ Wave 0 |
| LIC-05 | `withPermission` guard: write blocked/continuity allowed/read untouched; guard after authorization; restricted `ACTIVE` vs `RESTRICTED` parity for unauthorized | unit | `npx vitest run tests/with-permission.test.ts tests/licence-guard.test.ts --project node` | ✅ (with-permission) / ❌ Wave 0 |
| LIC-05 | no write path unguarded (service-file registry, call-site tags, continuity snapshot); closures stay request-API free | static | `npx vitest run tests/licence-enforcement-boundary.test.ts tests/boundary.test.ts --project node` | ❌ Wave 0 / ✅ |
| LIC-05 | restricted-state e2e: publish/enrol/checkout/role change blocked with non-sensitive error; grade/certificate/progress/export/sign-in/activate allowed | integration | `npx vitest run tests/licence-restricted.integration.test.ts --project node` | ❌ Wave 0 |
| LIC-05/08 | payment: new checkout blocked; webhook for attempt initiated before restriction activates enrolment; after (beyond tolerance) becomes exception; refund allowed; expiry during in-flight payment | integration | `npx vitest run tests/licence-payments.integration.test.ts --project node` | ❌ Wave 0 |
| LIC-06 | audit rows for activation, rejection, state change, enforcement, export-in-restricted, diagnostic download; redaction; one winner per transition across concurrent evaluators | integration | `npx vitest run tests/licence-audit.integration.test.ts --project node` | ❌ Wave 0 |
| LIC-07 | notice events dedupe (replay produces one Notification + one EmailDispatch per holder); mapper recipients are Global `licence.view` holders only; params carry no signing/contract detail; templates/notification text exhaustive | unit + integration | `npx vitest run tests/event-mappers-licence.test.ts tests/licence-drain.integration.test.ts --project node` | ❌ Wave 0 |
| LIC-07 | updated contract lists (`tests/communications-contracts.test.ts`, `tests/notification-text.test.ts`, `tests/email-templates.test.ts`, `tests/event-intent-mappers.test.ts`) | unit | `npx vitest run tests/communications-contracts.test.ts --project node` | ✅ (must be edited) |
| LIC-08 | restricted state deletes nothing (row-count snapshot), export routes remain reachable | integration | covered in `licence-restricted.integration.test.ts` | ❌ Wave 0 |
| D-08a | wording consistency (no "read-only" in licence files and licence doc lines) | static | `npx vitest run tests/licence-wording.test.ts --project node` | ❌ Wave 0 |
| D-03 | provider CLI mints a verifiable licence; refuses repo-relative private key paths; excluded from Docker context | unit/static | `npx vitest run tests/licence-issuer.test.ts --project node` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the single relevant `npx vitest run <file> --project node` (pure licence tests run in under 5 s).
- **Per wave merge:** `npx vitest run tests/licence tests/with-permission.test.ts tests/boundary.test.ts tests/communications-contracts.test.ts --project node`.
- **Phase gate:** `npm test` green (Docker required for the `*.integration.test.ts` files) before `/gsd-verify-work`; additionally `npx tsc --noEmit` and `npm run lint`.
(Reminder: this user does not auto-commit; "per task commit" means per task completion.)

### Wave 0 Gaps
- [ ] `tests/support/licence-fixtures.ts`: throwaway Ed25519 keypair, `mintLicence(overrides)`, fixed-clock helpers, trust-set injection.
- [ ] `tests/fixtures/licence/v1/*.lic`: golden vectors (valid, expired, grace, wrong deployment, tampered, retired-key, revoked-key).
- [ ] `tests/licence-*.test.ts` files listed above, plus `tests/components/licence-status.test.tsx`.
- [ ] Existing exact-list tests to extend: `communications-contracts`, `notification-text`, `email-templates`, `event-intent-mappers`, `with-permission`, `boundary` (new closure cases), `staff-layout-nav` (new nav item), `permission-groups` unaffected.
- [ ] Framework install: none.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | existing sign-in; activation requires an authenticated actor |
| V3 Session Management | no change | existing sessions; signing out stays allowed in restricted mode |
| V4 Access Control | yes | `licence.view` / `licence.activate` Global-only (`GLOBAL_ONLY_PERMISSIONS`), server-side guard after authorization, identical denial parity |
| V5 Input Validation | yes | zod-strict upload/paste schema, ASCII allow-list, size ≤ 8 KiB before reading, closed reason-code set |
| V6 Stored Cryptography | yes | `node:crypto` Ed25519 only, algorithm pinned, versioned trust set, no private key anywhere in repo/config/backups/UI |
| V7 Error Handling and Logging | yes | non-sensitive refusals, audit via `recordAudit` (redacts credential-shaped keys), no stack traces in UI/diagnostics |
| V8 Data Protection | yes | diagnostic report allow-list, `no-store`, raw licence is public data (no secrets) |
| V10 Malicious Code / tamper resistance | partial | signature + binding; no obfuscation (PRD §18.1 says contract is the primary control) |
| V12 Files and Resources | yes | licence file is parsed as text, never executed, never written to disk/object storage, strict size/charset |
| V13 API / Web Service | yes | route handler GET only, permission-gated, `Cache-Control: private, no-store`; server action CSRF origin check by framework [CITED: server-actions.md] |
| V14 Configuration | yes | trust set is code, not env; dev keys excluded in production builds (A8) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged or edited licence | Tampering / Spoofing | Ed25519 over exact bytes; payload only parsed after verification |
| Algorithm/key confusion (`alg:none`, swapped `kid`) | Spoofing | `alg` pinned to `"Ed25519"`; `kid` must exist in embedded trust set; header is inside the signed input |
| Replay/downgrade of an older valid licence | Tampering | Signed `issuedAt`, monotonic activation rule, unique `licenceId` |
| Wrong-client / wrong-deployment licence | Spoofing | DB-seeded deployment ID exact match; client pinned at first activation |
| Self-extension by an Administrator | Elevation of privilege | No create/edit UI; `licence.activate` only validates provider signatures |
| Oversized/malformed upload | Denial of service | 8 KiB cap before reading, charset allow-list, framework 1 MB body cap as backstop |
| TOCTOU between check and mutation | Tampering | Check inside the same request after authorization, restriction is monotonic in time, payment 10-minute tolerance, activation under row lock |
| Cross-instance stale state | Tampering / Repudiation | No per-process decision cache on writes; single-row DB state; CAS transitions |
| Licence-state oracle to unauthorized users | Information disclosure | Guard only after `hasPermission` passes |
| Error-message leakage (contract/signing detail) | Information disclosure | Fixed message table; notification/email params allow-listed strings |
| Audit/notification flooding | Denial of service | Deterministic ids, change-only verification audit, denial coalescing |
| Clock rollback | Tampering | High-water + monotonic comparison for detection, alert + audit, not lock-out (D-12); unsolvable offline by design |
| Private key exposure | Information disclosure | Key only in provider vault; CLI reads from outside the repo; compromise runbook (revoke `kid` in a shipped trust-set update) |

## Sources

### Primary (HIGH confidence)
- Repository files read this session: `.planning/phases/14-software-licence-deployment-control/14-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/research/phase-14-licence-commercial-research.md`, `src/server/permissions/{with-permission,index,catalogue}.ts`, `tests/boundary.test.ts`, `tests/import-graph.ts`, `tests/audit-append-only.test.ts`, `tests/support/pg.ts`, `vitest.config.mts`, `prisma/schema.prisma` (AuditEvent, DomainEvent, Order, PaymentAttempt, Refund, WebhookEvent, ExportJob, EmailDispatch, Notification), `prisma/seed.ts`, `prisma/migrations/20260927015627_communications_notifications/migration.sql`, `src/server/services/{audit-service,audit-read-service,domain-event-service,domain-event-drain-service,event-intent-mappers,staff-recipient-service,email-failure-alert-service,checkout-webhook-system-service,continuity-service,export-download-service,reconciliation-case-service}.ts`, `src/server/services/event-mappers/staff.ts`, `src/server/communications/{contracts,notification-text,links}.ts`, `src/server/email/templates/{registry,staff-templates}.ts`, `src/server/scheduled/{drain-domain-events,cleanup-notifications}-task.ts`, `netlify/functions/{drain-domain-events,cleanup-notifications}.ts`, `src/app/staff/{layout.tsx,StaffShell.tsx,audit/*}`, `src/app/(checkout)/**/actions.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/app/api/notifications/unread/route.ts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `eslint.config.mjs`, `package.json`, `docs/deployment/netlify-scheduled-functions.md`, `docs/reference/Professional-Training-LMS-{PRD,PXR}-Revision-3-Multi-Gateway-Payments.md` (PRD lines 718-863, PXR lines 349-482).
- Next.js 16.3.4 bundled docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{instrumentation,proxy,layout,route}.md`, `01-app/02-guides/{instrumentation,server-actions,self-hosting}.md`.
- Local executions: `ed.mjs` (Ed25519 JWK import, sign/verify, tamper, short signature, 128.8 µs average verify on Node 24.6.0), `inv.cjs` (TypeScript-AST inventory of 121 permission call sites), `npx vitest` baseline run.

### Secondary (MEDIUM confidence)
- https://nodejs.org/api/crypto.html (JWK/Ed25519 `createPublicKey`, `verify(null, …)` example).
- https://docs.netlify.com/build/functions/scheduled-functions/ (30 s limit, published deploys only, no payload).
- Netlify default Node 24 via https://answers.netlify.com/t/node-js-24-is-now-the-default-versions-for-builds-and-functions/164831 and https://docs.netlify.com/build/configure-builds/manage-dependencies/.

### Tertiary (LOW confidence)
- Search results about `instrumentation.ts` on serverless runtimes (cdklabs/cdk-nextjs issue 279/280, vercel/next.js issue 99160): not Netlify-specific; used only to justify not relying on `register()` alone (A3).
- `.planning/research/phase-14-licence-commercial-research.md`: external and unverified by its own header; used only as input, never as a decision.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies; versions read from `package.json`; Node Ed25519 exercised locally.
- Architecture: MEDIUM-HIGH, built from read code and the locked decisions; the guard-injection and registry-test mechanics are new designs (sketches), not existing patterns.
- Enforcement inventory: MEDIUM, inventory is exhaustive at the service-file level (ESLint-guaranteed) but several continuity/block classifications are product judgements flagged `[ASSUMED]`.
- Pitfalls: HIGH for codebase-specific ones (verified in source), MEDIUM for platform behaviour (Netlify cold start, overlapping runs).

**Research date:** 2026-10-01
**Valid until:** 2026-10-31 (stable code; revisit if Next.js is upgraded or commercial terms are approved)
