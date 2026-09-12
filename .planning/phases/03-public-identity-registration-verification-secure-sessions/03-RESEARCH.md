# Phase 3: Public Identity — Registration, Verification & Secure Sessions - Research

**Researched:** 2026-09-02
**Domain:** Self-service identity lifecycle (registration, email verification, password reset, profile) built on an existing hand-rolled database-session auth core; transactional email via Brevo.
**Confidence:** MEDIUM — the codebase-internal findings (schema, existing services, lint boundary, Next.js version docs) are HIGH/VERIFIED; the Brevo SDK and generic security-pattern findings are MEDIUM (official docs/GitHub, no MCP doc provider available in this environment so WebFetch/WebSearch were used directly).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Brevo is the transactional email provider wired this phase — not Postmark, despite `docs/TRACK-A-TASKS.md` Day 3 naming Postmark. User confirmed Brevo after being told the `EmailDispatch` schema is provider-agnostic. Scope is a minimal send wrapper (enough to deliver a verification/reset link), not Phase 13's full templating/dedup system.
- **D-02:** Verification links expire after **24 hours**; password-reset links expire after **1 hour**. The asymmetry is deliberate — a reset link grants account access, so it gets a tighter window than an email-ownership check.
- **D-03:** Requesting a new verification/reset email while an unexpired one exists issues a fresh `VerificationToken` and invalidates the prior unconsumed one for that identifier+purpose — only the newest link works. Reversible — an application-layer rule with no schema implication (`consumedAt` already exists).
- **D-04:** Sender identity is a generic placeholder (e.g. "Professional Training LMS <no-reply@[domain-tbd]>") — the real client brand/domain isn't locked yet. Swapping it later is a config change, not a code change.
- **D-05:** A per-address cooldown (e.g. one request per 60 seconds) rate-limits verification/reset email requests server-side, before a new `VerificationToken` is created — IAM-06 explicitly calls for testable rate controls on top of the existing sign-in lockout.
- **D-06:** Registration captures **Terms of Service + Privacy Notice only** as `PolicyAcceptance` rows (`orderId` null) — the two that gate account creation. Refund/Cancellation policy and Marketing consent move to Phase 6 checkout. Reversible.
- **D-07:** Policy versions are tracked as a hardcoded date-string constant per policy type in one config/constants file (e.g. `"2026-09-02"`), bumped manually when policy text changes. No CMS or policy-editing UI this phase.
- **D-08:** Registering with an email that already has a `PENDING_VERIFICATION` account resends verification (fresh token per D-03) rather than erroring or creating a duplicate row. The response is identical whether the account is new, already pending, or already active (IAM-06 non-enumeration) — only the internal behavior branches.
- **D-09:** A Learner can directly edit **name** and **phone** on their own profile — no re-verification needed, not identity-sensitive.
- **D-10:** Changing **email** requires re-verifying the new address via the same verification-token flow (D-01–D-03) before it takes effect, and requires re-entering the current password first (step-up confirmation, reuses `verifyPassword()`). Costly to retrofit later — must ship with the step-up check from day one.
- **D-11:** Communication preferences are a single marketing-emails on/off toggle. Transactional emails (verification, reset, order/enrolment notices) are never optional.
- **D-12:** The marketing toggle creates/updates its own `PolicyAcceptance` row (`policyType: "marketing"`, `orderId` null) when flipped from the profile page — the same mechanism Phase 6 uses at checkout, just triggered from a different screen.
- **D-13:** Every profile field/preference change (name, phone, email, marketing toggle) is recorded as an `AuditEvent` with the learner as actor, reusing the existing audit-service.ts write path.
- **D-14:** Registration, verification, reset, and profile pages match the existing `/signin` page's style exactly — the same minimal centered Tailwind card, same typography/spacing, no marketing header/footer/hero chrome. A distinct public marketing shell is deferred until Phase 4.

### Claude's Discretion

None remaining — all four discussed gray areas (email delivery, policy scope, profile/preferences, page style) reached explicit decisions above.

### Deferred Ideas (OUT OF SCOPE)

- Full REG-04 scope (Refund/Cancellation policy acceptance, order-bound marketing consent) — Phase 6 checkout, per D-06.
- Distinct public-facing visual shell (header/footer/marketing chrome) — Phase 4, once the public catalogue exists to justify it, per D-14.
- Real client sender domain/brand for transactional email — whenever that's approved; D-04's placeholder is designed to make this a config swap.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IAM-01 | Public visitor creates a Learner account with email/password, accepts required policies; duplicate active email prevented; one verification email sent. | Architecture Patterns → Registration flow; Code Examples → registration-service skeleton; Package Legitimacy Audit → Brevo. Non-enumeration shape mirrors `signIn`'s existing pattern (`src/server/services/auth-service.ts:38-42`, verified). |
| IAM-02 | Single-use, expiring email link activates the account once; expired/used tokens show a safe, recoverable path. | Architecture Patterns → Verification flow; Pitfalls → `VerificationToken` has no `createdAt`/no FK to `User`; Common Pitfalls → non-enumerating recoverable-path UI. |
| IAM-03 | Sign-in/out/lockout/session revocation already implemented; password reset is the remaining gap. | Architecture Patterns → Password-reset flow (D-02/D-03); Pitfalls → shared `signInAction` redirect target must branch for Learners; Code Examples → reset-service skeleton. |
| IAM-05 | Learner maintains approved profile fields and communication preferences within validation/consent rules. | Architecture Patterns → Profile ownership authorization (not `withPermission`); Pitfalls → email-change needs a schema addition (`pendingEmail`); D-09–D-13 already lock the field list and step-up rule. |
| IAM-06 | Enumeration/brute-force resistance, non-enumerating errors, testable rate/lock controls, no secrets in logs. | Architecture Patterns → per-address cooldown (D-05); Pitfalls → cooldown needs a timestamp field the schema currently lacks; audit redaction already covers `token`/`password`/`passwordHash` (verified, `audit-service.ts:37`). |
</phase_requirements>

## Summary

This phase extends a self-service identity lifecycle onto an auth core that Phase 1 already built and proved on the staff sign-in path: database sessions (`Session` model, `getActorBySessionToken`), scrypt password hashing (`src/server/auth/password.ts`), login lockout (`src/server/auth/lockout.ts`), and audit-first writes (`src/server/services/audit-service.ts`). None of that needs to be rebuilt. What Phase 3 adds is four new self-service flows — registration, email verification, password reset, and profile/preferences — plus a minimal Brevo email-sending module, all following the exact code shape already established by `src/app/(auth)/signin/`.

Two things require close attention because they are not simply "more of the same pattern." First, registration/verification/reset are **pre-authentication** flows and must never be wrapped in `withPermission` (which throws `AuthenticationError` when there is no session) — the codebase's permission catalogue (`src/server/permissions/catalogue.ts`) has no "self-service" or "profile" permission, confirming these flows sit outside the RBAC system entirely; profile editing needs a much simpler "is this the caller's own record" check instead of a scope resolver. Second, the schema has two real gaps this phase must close: `VerificationToken` has no `createdAt` field (needed to enforce D-05's per-address cooldown) and `User` has no `pendingEmail` field (needed to hold the unverified new address during D-10's email-change flow). Both are small, additive migrations, not blockers, but the plan must include them explicitly — they were not called out in CONTEXT.md's canonical-refs schema summary.

**Primary recommendation:** Build four new service files (`registration-service.ts`, `verification-service.ts` covering both verify+reset token issuance/consumption, `password-reset-service.ts`, `profile-service.ts`) following the existing dependency-injected `create*Service(deps)` factory pattern (see `staff-account-service.ts`), a `src/server/email/brevo-client.ts` module (no Prisma import — API-only) plus a thin `src/server/services/email-dispatch-service.ts` if `EmailDispatch` bookkeeping is wanted (Prisma access is lint-forbidden outside `src/server/services/`), and four new route-group pages under `src/app/(auth)/` matching `/signin`'s exact visual/structural shape per D-14. Add two additive Prisma migrations (`VerificationToken.createdAt`, `User.pendingEmail`) before writing the services that depend on them.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Registration form + validation | Browser / Client (form) → API/Backend (validation) | — | HTML client validation is UX only; the server action re-validates and is the actual security boundary (matches existing `signInAction` pattern). |
| Password hashing, token generation | API / Backend | — | `src/server/auth/password.ts` and `node:crypto` — pure server-side, already established. |
| Email verification / reset token issuance & consumption | API / Backend | Database / Storage (`VerificationToken`) | Server action reads/writes `VerificationToken`; no client-side token logic. |
| Session creation/cookie | Frontend Server (SSR) | API / Backend | `cookies()` set from a Server Action, exactly as `signInAction` already does. |
| Transactional email dispatch | API / Backend | External Service (Brevo) | A thin outbound HTTP call from the server; never triggered from the client. |
| Profile self-edit authorization | API / Backend | — | Ownership check (`actor.userId === target.id`), not RBAC/`withPermission` — no permission exists in the closed catalogue for this. |
| Non-enumeration / rate limiting | API / Backend | — | Pure functions mirroring `src/server/auth/lockout.ts`'s testable style. |
| Page chrome / visual style | Browser / Client | — | D-14 locks this to the existing `/signin` Tailwind card pattern; no new design system work. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@getbrevo/brevo` | 6.0.3 (published 2026-08-10) `[VERIFIED: npm registry — npm view @getbrevo/brevo version]` | Official Brevo Node SDK — typed client for the transactional email API | Official Brevo-maintained package (`git+https://github.com/getbrevo/brevo-node.git`), 229,505 weekly downloads, package first published 2023-06-13 with 20 published versions — long-lived, actively maintained `[VERIFIED: npm registry]` |

### Supporting

None required. This phase deliberately adds no other dependency:

- **No new hashing/crypto library** — `src/server/auth/password.ts` already provides scrypt hashing/verification; email-change step-up reuses `verifyPassword()` as CONTEXT.md D-10 specifies.
- **No form-validation library (e.g. zod)** — the existing codebase hand-rolls validation everywhere (`staff-account-service.ts`'s `MIN_REASON_LENGTH` check, `signInAction`'s manual `if (!email || !password)`) `[VERIFIED: src/app/(auth)/signin/actions.ts:17-19]`. Introducing zod here would be inconsistent with the established minimal-dependency convention (see `password.ts`'s own comment: "no dependency to audit or keep patched" `[VERIFIED: src/server/auth/password.ts:4-6]`). Recommend continuing hand-rolled validation for registration/profile forms.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@getbrevo/brevo` official SDK | Node's built-in `fetch` directly against `https://api.brevo.com/v3/smtp/email` | Zero dependency, but hand-rolls request shaping, typed errors, and retries that the SDK already provides. Given D-01 explicitly asks "verify whether Brevo needs a specific package," and the SDK is a thin, well-scoped, officially maintained wrapper, use the SDK. If the planner prefers zero-dependency, the raw REST call (documented below in Code Examples) is a fully viable substitute — pick one, not both. |
| Legacy `sib-api-v3-sdk` (Sendinblue-era) | `@getbrevo/brevo` | `sib-api-v3-sdk` is the pre-rebrand legacy package (still on npm at 8.5.0) — do not install it; `@getbrevo/brevo` is the current, actively-published successor `[VERIFIED: npm registry — both packages independently confirmed to exist]`. |

**Installation:**
```bash
npm install @getbrevo/brevo
```

**Version verification:** Ran `npm view @getbrevo/brevo version` → `6.0.3`; `npm view @getbrevo/brevo time --json` → package created 2023-06-13, 20 versions total, latest three: `5.0.4` (2026-04-10), `6.0.1` (2026-05-15), `6.0.2` (2026-07-03), `6.0.3` (2026-08-10). `[VERIFIED: npm registry]`

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@getbrevo/brevo` | npm | Package created 2023-06-13 (3+ years); **latest patch** `6.0.3` published 2026-08-10 (~3 weeks before this research date) | 229,505/week | `github.com/getbrevo/brevo-node` | `SUS` (automated reason: `"too-new"`) | **Flagged — planner must add a `checkpoint:human-verify` task before installing**, per protocol. Context for the human check: the "too-new" signal fired on the *latest patch version's* publish date, not the package's actual age — `npm view @getbrevo/brevo time` shows 20 published versions since 2023 and this is the official Brevo-maintained SDK. A human should confirm the verdict is a heuristic false-positive (recommended reading: `npm view @getbrevo/brevo repository.url` → `git+https://github.com/getbrevo/brevo-node.git`) rather than treat it as a real risk signal. |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `@getbrevo/brevo` — see disposition above; `npm view @getbrevo/brevo scripts.postinstall` returned empty (no postinstall script) `[VERIFIED: npm registry]`.

## Architecture Patterns

### System Architecture Diagram

```
Visitor (browser)
   |
   |  POST /register (form submit)
   v
Server Action: registerAction  ---------------------> registration-service.registerLearner()
   |                                                        |
   |                                                        |-- lookup User by email
   |                                                        |-- branch: new / PENDING / ACTIVE (D-08)
   |                                                        |-- create User (PENDING_VERIFICATION) + PolicyAcceptance x2 (D-06/D-07)  [transaction]
   |                                                        |-- issue VerificationToken (purpose=EMAIL_VERIFICATION, 24h, D-02)
   |                                                        |-- invalidate prior unconsumed token for identifier+purpose (D-03)
   |                                                        |-- enforce per-address cooldown (D-05) BEFORE issuing new token
   |                                                        v
   |                                              email-dispatch (src/server/services/) --> brevo-client (src/server/email/, no Prisma)
   |                                                                                              |
   |                                                                                              v
   |                                                                                     POST api.brevo.com/v3/smtp/email
   |
   |  identical "check your email" response regardless of branch (IAM-06)
   v
Visitor clicks emailed link --> GET/POST /verify?token=...
   |
   v
Server Action: verifyAction -----------------------> verification-service.consumeToken(token, purpose=EMAIL_VERIFICATION)
   |                                                        |-- lookup by token (unique)
   |                                                        |-- check consumedAt is null, expires > now
   |                                                        |-- on success: User.status = ACTIVE, emailVerified = now(), token.consumedAt = now()  [transaction]
   |                                                        |-- on expired/used: return a safe state, NOT an error page (IAM-02)
   v
redirect to /signin (success) OR render recoverable "request a new link" UI (failure)

---

Visitor (already registered) --> /forgot-password --> password-reset-service.requestReset()
   |-- non-enumerating: identical response whether email exists or not
   |-- enforce per-address cooldown (D-05)
   |-- issue VerificationToken (purpose=PASSWORD_RESET, 1h, D-02), invalidate prior (D-03)
   v
Visitor clicks link --> /reset-password?token=... --> password-reset-service.resetPassword(token, newPassword)
   |-- consumeToken(token, purpose=PASSWORD_RESET)
   |-- hashPassword(newPassword), User.update({ passwordHash })  [reuses src/server/auth/password.ts]
   |-- optionally signOutAllForUser(userId) — force re-auth on all devices after a reset

---

Signed-in Learner --> /account (first non-staff authenticated page)
   |-- getCurrentActor() -- NOT withPermission (no "profile.*" permission exists in the closed catalogue)
   |-- profile-service.updateOwnProfile(actor, fields)
   |     |-- name/phone: direct update, no re-verification (D-09)
   |     |-- email: requires verifyPassword(currentPassword) first (step-up, D-10), sets User.pendingEmail,
   |     |          issues VerificationToken(purpose=EMAIL_CHANGE, identifier=newEmail), does NOT change User.email yet
   |     |-- marketing toggle: upsert PolicyAcceptance(policyType="marketing") (D-12)
   |-- every field change --> recordAudit() (D-13)
```

### Recommended Project Structure
```
src/app/(auth)/
├── signin/                 # existing — unchanged
├── register/
│   ├── page.tsx            # matches signin's minimal centered card (D-14)
│   ├── RegisterForm.tsx
│   └── actions.ts
├── verify/
│   ├── page.tsx             # reads ?token=, renders success/expired/used state
│   └── actions.ts            # (or do the lookup directly in the Server Component)
├── forgot-password/
│   ├── page.tsx
│   ├── ForgotPasswordForm.tsx
│   └── actions.ts
└── reset-password/
    ├── page.tsx
    ├── ResetPasswordForm.tsx
    └── actions.ts

src/app/account/                  # first Learner-facing authenticated route group
├── layout.tsx                    # getCurrentActor() guard, NOT staff/layout.tsx's nav shell
├── page.tsx                      # profile + communication preferences
├── ProfileForm.tsx
└── actions.ts

src/server/services/
├── registration-service.ts
├── verification-service.ts       # shared verify+reset token issue/consume logic
├── password-reset-service.ts
├── profile-service.ts
└── email-dispatch-service.ts     # ONLY if EmailDispatch bookkeeping is wanted — Prisma access confines it here

src/server/email/
└── brevo-client.ts                # API-only wrapper, NO @prisma/client import (lint-forbidden outside services/)

src/server/auth/
└── request-cooldown.ts            # pure functions mirroring lockout.ts's isLockedOut/nextFailureState style (D-05)

prisma/migrations/
├── <ts>_verification_token_created_at/   # additive: VerificationToken.createdAt DateTime @default(now())
└── <ts>_user_pending_email/              # additive: User.pendingEmail String?
```

### Pattern 1: Pre-auth service, no `withPermission`
**What:** Registration, verification, and reset run before a session exists, so they cannot use `withPermission` (it throws `AuthenticationError` when `getActor()` returns null) `[VERIFIED: src/server/permissions/with-permission.ts:107-120]`.
**When to use:** Any operation that must succeed for an anonymous visitor.
**Example (matches the existing `auth-service.ts` shape, not `withPermission`-wrapped):**
```typescript
// src/server/services/auth-service.ts (existing, unwrapped — the pattern to follow)
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }, ... });
  if (!user || !user.passwordHash || user.status !== "ACTIVE") {
    return { ok: false, reason: "INVALID" };
  }
  // ...
}
```
`[VERIFIED: src/server/services/auth-service.ts:23-42]`

### Pattern 2: Ownership-based authorization for self-service (not RBAC)
**What:** Profile edit is authorized by `actor.userId === record.userId`, never by a permission string, because no such permission exists in the closed catalogue `[VERIFIED: src/server/permissions/catalogue.ts:12-81 — full list transcribed; no "profile" or "self" entry present]`.
**When to use:** IAM-05's profile/preferences editing exclusively.
**Example:**
```typescript
export function createProfileService(deps: { store: ProfileStore; audit: ...; hash: ...; now?: () => Date }) {
  async function updateOwnProfile(actor: Actor, input: ProfileUpdateInput) {
    // No scope resolver, no withPermission — actor.userId IS the target id.
    const current = await deps.store.user.findUnique({ where: { id: actor.userId } });
    // ... field-by-field D-09/D-10/D-11 rules ...
  }
  return { updateOwnProfile };
}
```

### Pattern 3: Non-enumerating identical response shape
**What:** Registration, verification-resend, and password-reset-request must return the exact same response text/shape regardless of internal branch (new/pending/active user; existing/nonexistent email) — the codebase already does this for sign-in.
**When to use:** IAM-06, D-08.
**Example (existing, to be mirrored):**
```typescript
// Same failure shape whether the account is missing, unverified, or the
// password is wrong — the response must not reveal which (IAM-06).
if (!user || !user.passwordHash || user.status !== "ACTIVE") {
  return { ok: false, reason: "INVALID" };
}
```
`[VERIFIED: src/server/services/auth-service.ts:38-42]`

### Pattern 4: Dependency-injected service factory + fake-store test harness
**What:** Every service in this codebase is a `create*Service(deps)` factory taking a narrow Prisma-shaped `store` interface, `audit`, and other collaborators as parameters, so tests can inject an in-memory fake instead of a real database.
**When to use:** All four new services this phase adds.
**Example:**
```typescript
// tests/staff-account-service.test.ts (existing pattern to replicate)
const store: StaffAccountStore = {
  user: {
    findUnique: vi.fn(async ({ where }) => { /* in-memory lookup */ }),
    create: vi.fn(async ({ data }) => { /* ... */ }),
    // ...
  },
  // ...
};
const service = createStaffAccountService({ store, withPermission, audit, hash, signOutAll });
```
`[VERIFIED: tests/staff-account-service.test.ts:1-60, src/server/services/staff-account-service.ts:111-119]`

### Pattern 5: Prisma import confined to `src/server/services/` — enforced by ESLint, not convention
**What:** `no-restricted-imports` bans `@prisma/client` in every file under `src/**` except `src/server/services/**/*.ts` and `src/server/db.ts`.
**Why this matters for this phase specifically:** The Brevo-sending module (`src/server/email/brevo-client.ts`) must NOT import Prisma directly. If `EmailDispatch` bookkeeping is wanted, it has to be a separate call from a `src/server/services/*.ts` file into the email module — the module itself stays a pure API client.
**Verbatim rule:**
```javascript
// eslint.config.mjs
{
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", { paths: [{ name: "@prisma/client",
      message: "Data access is confined to src/server/services/. Call a service instead — see docs/superpowers/specs/2026-09-01-track-a-foundation-design.md (D2)." }] }],
  },
},
{
  files: ["src/server/services/**/*.ts", "src/server/db.ts"],
  rules: { "no-restricted-imports": "off" },
},
```
`[VERIFIED: eslint.config.mjs:29-54]`

### Anti-Patterns to Avoid
- **Wrapping registration/verification/reset in `withPermission`:** it hard-requires an authenticated actor; these flows are pre-auth by definition (RBAC-06/NFR-05's "deny by default" does not apply here — there is no session to check).
- **Reusing `signInAction`'s hard-coded `redirect("/staff/courses")` unmodified for Learner sign-in:** see Pitfall 1 below.
- **Treating `VerificationToken.consumedAt` as meaning "clicked by the user":** D-03's invalidate-on-reissue also sets `consumedAt` on the *superseded* token, which was never clicked. If any future audit/analytics code reads `consumedAt` to mean "user completed verification," it will over-count. Consider a comment at the call site making this explicit, since the schema itself cannot express the distinction.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transactional email delivery (SMTP, retries, provider auth) | A raw `fetch`-based mail client with manual retry/backoff | `@getbrevo/brevo` SDK (or Node's `fetch` directly against the documented REST endpoint if the team wants zero new dependencies — pick one, see Alternatives Considered) | Handles auth header shape, typed error classes (`UnauthorizedError`, `TooManyRequestsError`), and the request/response contract; re-implementing this is pure risk for a "minimal send wrapper" scope. |
| Password hashing | A new hashing library (bcrypt, argon2 wrapper) | Existing `src/server/auth/password.ts` (`hashPassword`/`verifyPassword`, scrypt via `node:crypto`) | Already implemented, already meets NFR-04, already used for staff accounts — reusing it for registration and email-change step-up is explicit in D-10. |
| Random token generation | `Math.random()`-based strings | `node:crypto`'s `randomBytes` (already the pattern in `auth-service.ts:56` and `staff-account-service.ts:61`) | Cryptographically secure; matches existing 256-bit-entropy session-token precedent. |
| Session/cookie management | A new session library (iron-session, jose+JWT) despite Next.js's own docs suggesting them | Existing `Session` model + `SESSION_COOKIE`/`SESSION_TTL_DAYS` constants and `getActorBySessionToken` | IAM-03 requires selective/global revocation, which the codebase's database-session design already satisfies; introducing a stateless JWT library here would directly regress that requirement. |
| Rate limiting / cooldown | An external rate-limiting service or in-memory-only counter (breaks on multi-instance deploys) | A pure function reading `VerificationToken` rows by `identifier`+`purpose` (once `createdAt` is added — see Pitfall 2), mirroring `src/server/auth/lockout.ts`'s testable pure-function style | Matches the existing lockout pattern exactly; database-backed so it survives restarts and multiple app instances, unlike an in-process `Map`. |

**Key insight:** This phase's biggest risk is not "which library to add" (only one, `@getbrevo/brevo`, is genuinely needed) but "which existing pattern to extend correctly." Every piece of this phase already has a proven sibling implementation in Phase 1/2 code — the work is disciplined reuse, not new design.

## Common Pitfalls

### Pitfall 1: Shared `signInAction` hard-codes a staff redirect
**What goes wrong:** `src/app/(auth)/signin/actions.ts` unconditionally calls `redirect("/staff/courses")` on successful sign-in `[VERIFIED: src/app/(auth)/signin/actions.ts:41]`. A newly verified Learner signing in for the first time would be sent to a staff-only route.
**Why it happens:** `signInAction` was written when the only sign-in caller was staff (Phase 1/2 scope).
**How to avoid:** Branch the redirect on `isStaff` (or route to the Learner's own landing page, e.g. `/account`, since no Learner dashboard exists until Phase 9's LRN-01). This must be decided and implemented in this phase's plan, not deferred.
**Warning signs:** A Learner successfully authenticates and lands on `/staff/courses`.

### Pitfall 2: `staff/layout.tsx`'s guard checks authentication, not staff-ness
**What goes wrong:** If a Learner is redirected into `/staff/...` (see Pitfall 1, or by any stray link), the layout's guard passes them through — it only checks `if (!actor) redirect("/signin")`, not `actor.isStaff` `[VERIFIED: src/app/staff/layout.tsx:36-37 — "const actor = await getCurrentActor(); if (!actor) redirect(\"/signin\");"]`. The learner then hits a `withPermission`-wrapped service call and gets an unhandled `AuthorizationError`/`AuthenticationError` thrown with no `error.tsx` boundary present in the app (confirmed absent per `.planning/codebase/CONCERNS.md`), likely surfacing Next.js's default error page.
**Why it happens:** The layout comment itself says this is "convenience only... a layout guard protects rendering, not data" `[VERIFIED: src/app/staff/layout.tsx:34-35]` — it was never meant to be a full authorization gate, but nothing currently stops a Learner from reaching it.
**How to avoid:** Fix Pitfall 1 so Learners are never routed there in the first place; optionally add an `isStaff` check to `staff/layout.tsx` as defense in depth (out of this phase's explicit scope, but cheap and directly related).
**Warning signs:** A learner test account can navigate to `/staff/courses` and sees a crash/500 instead of a clean redirect.

### Pitfall 3: `VerificationToken` has no `createdAt` — D-05's cooldown needs one
**What goes wrong:** D-05 requires "a per-address cooldown (e.g. one request per 60 seconds)... before a new `VerificationToken` is created." Enforcing that requires knowing *when* the last token for that identifier+purpose was issued. The model has no such field:
```prisma
model VerificationToken {
  identifier String
  token      String    @unique
  expires    DateTime
  purpose    String
  consumedAt DateTime?

  @@unique([identifier, token])
  @@index([expires])
}
```
`[VERIFIED: prisma/schema.prisma:286-295]`
**Why it happens:** The schema was drafted in Phase 1 before the per-address cooldown requirement (D-05) existed as a decision.
**How to avoid:** Two options — (a) recommended: add an additive migration, `createdAt DateTime @default(now())`, matching the pattern used on every other model in the schema (`User`, `Session`, `Role`, etc. all have it); (b) fallback with no migration: derive an approximate issue time as `expires - <TTL for that purpose>` (24h or 1h per D-02), which works today but silently breaks if the TTL constants are ever tuned per-environment. Recommend (a).
**Warning signs:** Cooldown logic either can't be written, or is written against a computed-from-expiry approximation that a future TTL change would silently invalidate.

### Pitfall 4: `User` has no field to hold an unverified new email — D-10 needs one
**What goes wrong:** D-10 requires that changing email "requires re-verifying the new address... before it takes effect." That means the new address must be stored *somewhere* pending verification, without touching the live, unique `email` column (which is also the sign-in identifier). The `User` model has no such field:
```prisma
model User {
  id            String     @id @default(cuid())
  email         String     @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String
  phone         String?
  status        UserStatus @default(PENDING_VERIFICATION)
  ...
}
```
`[VERIFIED: prisma/schema.prisma:202-217 — full field list transcribed above, no pendingEmail present]`
**Why it happens:** The original schema only anticipated one email address per user, set once at registration; email *change* was not part of the Phase 1 design.
**How to avoid:** Add an additive migration, `pendingEmail String?`, on `User`. Flow: step-up-verified email-change request sets `pendingEmail`, issues a `VerificationToken(purpose="EMAIL_CHANGE", identifier=newEmail)`; on token consumption, look up the `User` by `pendingEmail = identifier`, then set `email = pendingEmail`, `pendingEmail = null`, `emailVerified = now()` inside one transaction. Also decide (and enforce, since `email` is `@unique`) what happens if the new address collides with another account's `email` or another pending `pendingEmail` — the registration duplicate-check logic (IAM-01) should be reused for this collision check.
**Warning signs:** No way to represent "this account is mid-email-change" without this field; attempting to reuse `VerificationToken.identifier` alone loses the link back to which existing `User` initiated the change (the token model has no `userId` foreign key).

### Pitfall 5: Non-enumeration must be response-shape identical, not merely "similar wording"
**What goes wrong:** It's easy to write three almost-identical strings ("Account created, check your email" / "Verification email resent" / "You're already registered") that differ enough to leak which branch fired.
**Why it happens:** Each branch feels like it deserves its own accurate message during development.
**How to avoid:** Return exactly one message/response object regardless of branch, exactly as `signIn`'s existing `{ ok: false, reason: "INVALID" }` collapses "missing," "unverified," and "wrong password" into one shape `[VERIFIED: src/server/services/auth-service.ts:38-42]`. Write a test asserting response equality across all three registration branches (new/pending/active), and across both branches of the password-reset request (email exists/doesn't).
**Warning signs:** Any code path in registration/reset that returns a different string, HTTP status, or timing profile depending on whether the email was found.

### Pitfall 6: Brevo `too-new` package-legitimacy signal is a false positive on this specific package
**What goes wrong:** An automated legitimacy check flags `@getbrevo/brevo` as `SUS` ("too-new") because its *latest patch* (`6.0.3`) was published only ~3 weeks before this research. Blindly trusting the automated verdict and avoiding an actively-maintained official SDK is itself a worse outcome.
**Why it happens:** The heuristic checks the newest published version's timestamp, not the package's actual first-publish date.
**How to avoid:** A human should verify via `npm view @getbrevo/brevo time` (created 2023, 20 versions) and `npm view @getbrevo/brevo repository.url` (official `getbrevo` GitHub org) before dismissing the SDK — see Package Legitimacy Audit above. This is exactly the `checkpoint:human-verify` the SUS protocol calls for.
**Warning signs:** None specific to this package's behavior — this is purely about not over-trusting a mechanical age heuristic.

## Code Examples

### Brevo — send a transactional email (SDK)
```typescript
// Source: https://github.com/getbrevo/brevo-node (official README) — [CITED]
import { BrevoClient } from '@getbrevo/brevo';

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! });

await brevo.transactionalEmails.sendTransacEmail({
  subject: "Verify your account",
  textContent: `Click to verify: ${verificationUrl}`,
  sender: { name: "Professional Training LMS", email: "no-reply@example.com" }, // D-04 placeholder
  to: [{ email: recipientEmail }],
});
```

### Brevo — error handling (SDK typed errors)
```typescript
// Source: https://github.com/getbrevo/brevo-node (official README) — [CITED]
import { BrevoError, UnauthorizedError, TooManyRequestsError } from '@getbrevo/brevo';

try {
  await brevo.transactionalEmails.sendTransacEmail({ /* ... */ });
} catch (err) {
  if (err instanceof UnauthorizedError) {
    // Invalid API key — treat as a config error, alert operators, do not retry.
  } else if (err instanceof TooManyRequestsError) {
    // Rate limited — safe to retry with backoff.
  } else if (err instanceof BrevoError) {
    // err.statusCode, err.message, err.body, err.rawResponse all available.
  }
  throw err; // Never mark the calling flow as "email sent" on failure.
}
```

### Brevo — raw REST alternative (zero-dependency option)
```typescript
// Source: https://developers.brevo.com/docs/send-a-transactional-email — [CITED]
const response = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: {
    "api-key": process.env.BREVO_API_KEY!,
    "content-type": "application/json",
    "accept": "application/json",
  },
  body: JSON.stringify({
    sender: { name: "Professional Training LMS", email: "no-reply@example.com" },
    to: [{ email: recipientEmail }],
    subject: "Verify your account",
    textContent: `Click to verify: ${verificationUrl}`,
  }),
});
if (!response.ok) {
  // 201 = success with a messageId in the body; anything else is a failure to surface, not swallow.
  throw new Error(`Brevo send failed: ${response.status}`);
}
```

### Next.js — server-action form pattern to replicate (matches existing `signin` code exactly)
```typescript
// Source: node_modules/next/dist/docs/01-app/02-guides/authentication.md (bundled with installed Next.js 16.3.4) — [CITED]
'use client'
import { useActionState } from 'react'
export default function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined)
  return (
    <form action={action}>
      {/* fields */}
      <button disabled={pending} type="submit">Sign Up</button>
    </form>
  )
}
```
This is the exact shape `src/app/(auth)/signin/SignInForm.tsx` already uses `[VERIFIED: src/app/(auth)/signin/SignInForm.tsx:1-9]` — new forms should copy that file's structure, not the doc's generic version, to satisfy D-14's visual-parity requirement.

### Token issuance with invalidate-on-reissue (D-03) — service-layer sketch
```typescript
// Sketch — not verified against a written implementation (none exists yet); follows D-02/D-03/D-05 verbatim.
async function issueToken(identifier: string, purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttlMs: number) {
  // D-05: cooldown check BEFORE creating a new token (needs VerificationToken.createdAt — Pitfall 3).
  // D-03: invalidate any prior unconsumed, unexpired token for this identifier+purpose.
  await store.verificationToken.updateMany({
    where: { identifier, purpose, consumedAt: null, expires: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  return store.verificationToken.create({
    data: { identifier, purpose, token: randomBytes(32).toString("base64url"), expires: new Date(Date.now() + ttlMs) },
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `sib-api-v3-sdk` (Sendinblue-branded Node client) | `@getbrevo/brevo` (rebranded, rewritten SDK) | Package rebrand post-2023; `@getbrevo/brevo` v6.x (current major, released ~May 2026) introduces the `BrevoClient` class-based API replacing the older `TransactionalEmailsApi`/`setApiKey` pattern from v1–v5 | Use the v6 `BrevoClient({ apiKey })` shape in new code; older tutorials/blog posts (several surfaced in search results) show the pre-v6 `TransactionalEmailsApi` pattern, which still works per the SDK's own error-handling docs but is not the class shown in the current official README. |

**Deprecated/outdated:**
- `sib-api-v3-sdk`: superseded by `@getbrevo/brevo`; do not install the legacy package.
- Auth.js Credentials-provider JWT sessions: not applicable to this codebase by explicit prior decision (no Auth.js at all) — mentioned here only because it is the default Next.js docs recommendation and must NOT be introduced; the project's hand-rolled database sessions are the correct, already-decided approach `[VERIFIED: .planning/STATE.md decisions — "No Auth.js — hand-rolled database sessions, required by IAM-03's selective/global session revocation"]`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Environment variable names `BREVO_API_KEY` and a sender-identity config (e.g. `EMAIL_SENDER_NAME`/`EMAIL_SENDER_ADDRESS`) do not already exist under different names. `.env`/`.env.example` could not be read in this research session (permission-denied on dotfiles). | Standard Stack / Code Examples | Low — purely a naming choice; if `.env.example` already reserves different names, the plan should rename to match rather than introduce a second convention. A human should check `.env.example` directly before the plan locks variable names. |
| A2 | `VerificationToken.purpose` string values `"EMAIL_VERIFICATION"`, `"PASSWORD_RESET"`, `"EMAIL_CHANGE"` are proposed conventions, not values that exist anywhere in the codebase today (grep confirmed zero references to `VerificationToken` or `EmailDispatch` outside `schema.prisma`). | Architecture Patterns, Code Examples | Low — these are free-text strings the plan is free to name; risk is only inconsistency if the planner picks different literals across files without a shared constant. |
| A3 | Post-registration/verification/reset, an unauthenticated-turned-authenticated Learner should land on `/account` (the profile page this phase builds) rather than any other route, since no Learner dashboard exists until Phase 9 (LRN-01). CONTEXT.md does not specify a redirect target. | Pitfall 1, Architecture Patterns | Medium — if the planner/user wants a different interim landing page (e.g. back to the public catalogue home once Phase 4 exists), the redirect target in `signInAction`/`registerAction`/`verifyAction` would need to change; low cost to fix since it's one `redirect()` call per action. |
| A4 | The recommended additive migrations (`VerificationToken.createdAt`, `User.pendingEmail`) are safe, backward-compatible schema changes given this project's stated migration conventions (hand-written SQL only for the three integrity rules noted at the top of `schema.prisma`; everything else is plain Prisma-managed). | Pitfalls 3 & 4 | Medium — if there's an unstated reason these fields were deliberately omitted (unlikely, but not verified with the original schema author), the plan should confirm with the user before adding migrations. |
| A5 | Package error-handling/README content fetched via `raw.githubusercontent.com/getbrevo/brevo-node/main/README.md` accurately reflects the current `6.0.3` release (WebFetch tool, not an MCP-verified doc provider — no Context7/Ref MCP tool was available in this environment). | Standard Stack, Code Examples | Low-Medium — SDK method names/class names (`BrevoClient`, `sendTransacEmail`) should be spot-checked against the installed package's TypeScript types once `npm install @getbrevo/brevo` runs, before code is written against them. |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Exact env var names for Brevo credentials and sender identity**
   - What we know: D-04 wants sender identity "trivially swappable later — one config value, not scattered string literals." A `BREVO_API_KEY` is required by the SDK/REST call.
   - What's unclear: Whether `.env.example` already reserves specific names (could not be read this session — dotfile read permission denied to the research agent).
   - Recommendation: Planner or executor should open `.env.example` directly (human-readable, not sandboxed for a human) before finalizing variable names; add any new ones there with placeholder values.

2. **Where does `EmailDispatch` bookkeeping happen this phase, if at all?**
   - What we know: D-01 explicitly scopes this phase to "a minimal send wrapper... not Phase 13's full templating/dedup system." The `EmailDispatch` model exists and is provider-agnostic (`template`, `toEmail`, `correlationId`, `status`, `providerMessageId`) `[VERIFIED: prisma/schema.prisma:1236-1251]`, with a dedup-supporting unique constraint on `(template, correlationId)`.
   - What's unclear: Whether Phase 3 should write `EmailDispatch` rows per send (for observability/NFR-07, without implementing the dedup logic Phase 13 will build) or skip the table entirely and let Phase 13 be the first writer.
   - Recommendation: Write a minimal row per send (queued → sent/failed) since the model already exists and it costs one extra service call; do not implement the dedup-on-correlationId behavior itself (that stays Phase 13's job). This keeps `src/server/services/email-dispatch-service.ts` genuinely minimal.

3. **Should `staff/layout.tsx` gain an `isStaff` check as defense-in-depth?**
   - What we know: Pitfall 2 documents that the layout currently only checks for *any* authenticated actor.
   - What's unclear: Whether this is in scope for Phase 3 (it touches existing Phase 1/2 code, not new Phase 3 code) or should be filed as a follow-up.
   - Recommendation: Fix the root cause (Pitfall 1's redirect branching) as part of this phase; treat the `isStaff` layout check as an optional, cheap hardening addition the planner can include or explicitly defer.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v24.6.0 | — |
| npm | Package install | ✓ | 11.5.1 | — |
| PostgreSQL (via `DATABASE_URL`) | Prisma/all data access | ✓ (Prisma CLI loaded `.env` and the schema successfully) | Not directly queried; Prisma client generator targets 6.19.3 per `package.json` | — |
| Prisma CLI | Migrations for the two additive schema changes (Pitfalls 3 & 4) | ✓ | 6.19.3 (`package.json` devDependency) | — |
| Brevo account + API key | Actual email sending | Not verifiable in this sandboxed research session (no network egress to a real Brevo account, `.env` unreadable) | — | Development/test can run against a mocked `brevo-client` (inject a fake `sendTransacEmail`); a human must confirm a real `BREVO_API_KEY` exists in deployment secrets before this ships to any environment that needs real delivery. |

**Missing dependencies with no fallback:** none — everything needed for local development and testing is present.
**Missing dependencies with fallback:** Brevo API key/account verification — mock the SDK/client in tests (matches the existing DI pattern), confirm real credentials exist before deployment.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 `[VERIFIED: package.json]` |
| Config file | `vitest.config.mts` (`environment: "node"`, `include: ["tests/**/*.test.ts"]`, `@` alias → `./src`) `[VERIFIED: vitest.config.mts]` |
| Quick run command | `npx vitest run tests/<new-file>.test.ts` |
| Full suite command | `npm test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IAM-01 | Registration creates PENDING_VERIFICATION user + 2 PolicyAcceptance rows + issues one token; duplicate ACTIVE email rejected with identical response shape | unit (DI fake store) | `npx vitest run tests/registration-service.test.ts` | ❌ Wave 0 |
| IAM-02 | Token valid once; expired/used token returns a safe non-throwing state | unit (DI fake store) | `npx vitest run tests/verification-service.test.ts` | ❌ Wave 0 |
| IAM-03 | Password reset: request issues 1h token (D-02), consuming it updates `passwordHash`; regression test that successful sign-in still resets `failedLoginAttempts` to 0 (already implemented per `auth-service.ts:60-63`) | unit (DI fake store) | `npx vitest run tests/password-reset-service.test.ts` | ❌ Wave 0 |
| IAM-05 | Own-record-only profile edit; name/phone update without re-verification; email change requires `verifyPassword` step-up and does not touch `User.email` until token consumed; marketing toggle upserts `PolicyAcceptance` | unit (DI fake store) | `npx vitest run tests/profile-service.test.ts` | ❌ Wave 0 |
| IAM-06 | Per-address cooldown pure functions (mirroring `lockout.test.ts`'s style); non-enumeration response-shape equality across all registration/reset branches | unit (pure functions + DI fake store) | `npx vitest run tests/request-cooldown.test.ts` | ❌ Wave 0 |
| IAM-06 | Audit redaction already covers token/password fields — regression-only, no new test required | unit | `npx vitest run tests/audit-service.test.ts` (existing) | ✅ existing |

### Sampling Rate
- **Per task commit:** run the specific new test file (`npx vitest run tests/<file>.test.ts`)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/registration-service.test.ts` — covers IAM-01
- [ ] `tests/verification-service.test.ts` — covers IAM-02
- [ ] `tests/password-reset-service.test.ts` — covers IAM-03 (remaining gap)
- [ ] `tests/profile-service.test.ts` — covers IAM-05
- [ ] `tests/request-cooldown.test.ts` — covers IAM-06 (cooldown half; lockout half already covered by existing `tests/lockout.test.ts`)
- [ ] `tests/brevo-client.test.ts` — mocked `fetch`/SDK call, asserts request shape and error propagation (no real network call in CI)
- [ ] Prisma migration + a `schema-*.test.ts` (matching the existing `tests/schema-auth.test.ts` style) asserting `VerificationToken.createdAt` and `User.pendingEmail` exist, before the services that depend on them are written
- [ ] Framework install: none — Vitest already present and configured

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing scrypt hashing (`password.ts`) reused as-is; no new authentication mechanism introduced. |
| V3 Session Management | yes | Existing database-session model (`Session`, `getActorBySessionToken`) unchanged; password reset should call `signOutAllForUser` after a successful reset (recommended, not yet locked by CONTEXT.md — flag to planner). |
| V4 Access Control | yes | Profile edit uses ownership check, not RBAC — document this explicitly as the intended, correct model (not a gap) since it's easy to mistake for a missing `withPermission` call. |
| V5 Input Validation | yes | Hand-rolled validation (matches existing convention) — email format, password minimum requirements (reuse whatever `signIn`/registration already implicitly expects; no explicit password-strength policy found in the codebase — flag as an open question if the user wants one beyond "non-empty," since `hashPassword` only rejects empty strings `[VERIFIED: src/server/auth/password.ts:36]`). |
| V6 Cryptography | yes | `node:crypto` scrypt (existing) + `randomBytes` for tokens (existing pattern) — never hand-roll a weaker token generator. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account enumeration via registration/reset response differences | Information Disclosure | Identical response shape across all branches (Pattern 3 / Pitfall 5) |
| Verification/reset token brute-forcing | Tampering / Elevation of Privilege | 256-bit `randomBytes` tokens (existing precedent), single-use (`consumedAt`), short expiry (1h reset / 24h verify per D-02) |
| Email-bombing via repeated registration/reset requests | Denial of Service | Per-address cooldown (D-05) enforced server-side before token creation |
| Token replay after use | Tampering | `consumedAt` check before honoring a token (must be enforced in `verification-service.ts`, not just relied upon at read time — check-then-act must be inside the same transaction that flips `User.status`/`passwordHash`) |
| Secrets in logs/audit (password, tokens) | Information Disclosure | Already enforced at the audit sink: `AUDIT_REDACTED_KEYS` includes `passwordHash`, `password`, `sessionToken`, `token`, `secret` `[VERIFIED: src/server/services/audit-service.ts:36-38]` — ensure any raw `console.log`/error logging in the new email/verification code never logs the raw token or Brevo API key. |
| Email-account takeover via unverified email-change | Spoofing | D-10's step-up (current-password re-entry) before initiating an email change, plus verification of the *new* address before it takes effect (Pitfall 4) |

## Sources

### Primary (HIGH confidence — codebase, read this session)
- `prisma/schema.prisma` (full file read) — `User`, `Session`, `VerificationToken`, `PolicyAcceptance`, `EmailDispatch` models
- `src/server/services/auth-service.ts`, `src/server/auth/lockout.ts`, `src/server/auth/password.ts`, `src/server/auth/current-actor.ts`
- `src/server/services/session-service.ts`, `src/server/services/staff-account-service.ts`, `src/server/services/audit-service.ts`
- `src/server/permissions/with-permission.ts`, `src/server/permissions/catalogue.ts`
- `src/app/(auth)/signin/page.tsx`, `SignInForm.tsx`, `actions.ts`
- `src/app/staff/layout.tsx`
- `eslint.config.mjs`, `package.json`, `vitest.config.mts`
- `tests/staff-account-service.test.ts`, `tests/course-service.test.ts`, `tests/structure.test.ts`, `tests/lockout.test.ts`, `tests/schema-auth.test.ts`
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `.../03-api-reference/03-file-conventions/route-groups.md` — bundled with the installed Next.js 16.3.4, per this project's own `AGENTS.md` instruction to treat as canonical for this specific version
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` §11.2 (IAM-01–06 acceptance criteria), §11.6 (REG-04)
- `docs/TRACK-A-TASKS.md` (Day 3 scope list)
- `.planning/codebase/CONCERNS.md` (no error.tsx/not-found.tsx, password-reset gap, email provider gap)

### Secondary (MEDIUM confidence — official web docs, WebFetch/WebSearch this session; no Context7/Ref MCP tool available in this environment)
- https://developers.brevo.com/docs/send-a-transactional-email — endpoint, headers, minimal request body
- https://developers.brevo.com/docs/api-key-authentication — `api-key` header auth
- https://github.com/getbrevo/brevo-node (README, via raw.githubusercontent.com) — install command, `BrevoClient` usage, typed error classes
- npm registry (`npm view @getbrevo/brevo ...`) — version, publish history, repo URL, postinstall absence

### Tertiary (LOW confidence — general WebSearch synthesis, not independently fetched from a primary source)
- OWASP Forgot Password Cheat Sheet content (via WebSearch summary, not directly fetched) — general password-reset-token best practices (single-use, short expiry, hashed storage, TLS-only delivery)
- Generic Next.js App Router auth-pattern WebSearch summary (route groups, middleware, DAL) — used only to corroborate, not override, the locally-bundled Next.js 16.3.4 docs, which are the authoritative source for this project

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for the "no new dependency except `@getbrevo/brevo`" call (verified against actual codebase conventions); MEDIUM for Brevo SDK specifics (official sources, but no MCP-verified doc tool in this environment)
- Architecture: HIGH — every pattern is grounded in code read this session, not assumed
- Pitfalls: HIGH for the four schema/redirect/layout findings (all verified by reading the actual files); MEDIUM for the generic security-pattern pitfalls (industry-standard, not codebase-specific)

**Research date:** 2026-09-02
**Valid until:** 30 days for codebase-internal findings (stable until the schema/services actually change); 14 days for the Brevo SDK specifics (fast-moving package, v6.x line still young at time of research — re-verify `npm view @getbrevo/brevo version` before implementation if this research is more than 2 weeks old)
