# Phase 3: Public Identity — Registration, Verification & Secure Sessions - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 21 (new/modified)
**Analogs found:** 18 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `prisma/migrations/<ts>_verification_token_created_at/migration.sql` | migration | CRUD (schema) | `prisma/migrations/20260901152759_login_throttling/` | role-match |
| `prisma/migrations/<ts>_user_pending_email/migration.sql` | migration | CRUD (schema) | `prisma/migrations/20260901152759_login_throttling/` | role-match |
| `prisma/schema.prisma` (edit: `VerificationToken.createdAt`, `User.pendingEmail`) | model | CRUD | same file, `User`/`VerificationToken` models (lines 202-295) | exact |
| `src/server/services/registration-service.ts` | service | CRUD + event-driven (email send) | `src/server/services/auth-service.ts` | exact (pre-auth shape) |
| `src/server/services/verification-service.ts` | service | CRUD | `src/server/services/auth-service.ts` (token/session write pattern) + `staff-account-service.ts` (transaction pattern) | role-match |
| `src/server/services/password-reset-service.ts` | service | CRUD | `src/server/services/auth-service.ts` | exact |
| `src/server/services/profile-service.ts` | service | CRUD | `src/server/services/staff-account-service.ts` (DI factory + audit shape) | role-match (auth model differs — ownership, not `withPermission`) |
| `src/server/services/email-dispatch-service.ts` | service | event-driven | `src/server/services/audit-service.ts` (thin Prisma-writing sink) | role-match |
| `src/server/email/brevo-client.ts` | utility | event-driven (outbound HTTP) | `src/server/auth/password.ts` (pure, no-Prisma module under `src/server/`) | partial (no direct analog for outbound HTTP client) |
| `src/server/auth/request-cooldown.ts` | utility | request-response (pure) | `src/server/auth/lockout.ts` | exact |
| `src/app/(auth)/register/page.tsx` | component | request-response | `src/app/(auth)/signin/page.tsx` | exact |
| `src/app/(auth)/register/RegisterForm.tsx` | component | request-response | `src/app/(auth)/signin/SignInForm.tsx` | exact |
| `src/app/(auth)/register/actions.ts` | controller | request-response | `src/app/(auth)/signin/actions.ts` | exact |
| `src/app/(auth)/verify/page.tsx` | component | request-response | `src/app/(auth)/signin/page.tsx` | role-match (server component reads `?token=` instead of rendering a form) |
| `src/app/(auth)/verify/actions.ts` | controller | request-response | `src/app/(auth)/signin/actions.ts` | role-match |
| `src/app/(auth)/forgot-password/page.tsx` + `ForgotPasswordForm.tsx` | component | request-response | `src/app/(auth)/signin/page.tsx` + `SignInForm.tsx` | exact |
| `src/app/(auth)/forgot-password/actions.ts` | controller | request-response | `src/app/(auth)/signin/actions.ts` | exact |
| `src/app/(auth)/reset-password/page.tsx` + `ResetPasswordForm.tsx` | component | request-response | `src/app/(auth)/signin/page.tsx` + `SignInForm.tsx` | exact |
| `src/app/(auth)/reset-password/actions.ts` | controller | request-response | `src/app/(auth)/signin/actions.ts` | exact |
| `src/app/account/layout.tsx` | provider | request-response | `src/app/staff/layout.tsx` | role-match (ownership guard, not nav shell) |
| `src/app/account/page.tsx` + `ProfileForm.tsx` + `actions.ts` | component/controller | CRUD | `src/app/(auth)/signin/page.tsx`/`SignInForm.tsx`/`actions.ts` | role-match |
| `src/app/(auth)/signin/actions.ts` (MODIFY: `signInAction` redirect branch, D-15) | controller | request-response | itself (existing file) | exact — this IS the analog |
| `src/app/staff/layout.tsx` (MODIFY: add `isStaff` guard, D-18) | provider | request-response | itself (existing file) | exact — this IS the analog |
| `tests/registration-service.test.ts`, `verification-service.test.ts`, `password-reset-service.test.ts`, `profile-service.test.ts`, `request-cooldown.test.ts`, `brevo-client.test.ts` | test | CRUD/unit | `tests/staff-account-service.test.ts`, `tests/lockout.test.ts` | exact |

## Pattern Assignments

### `src/server/services/registration-service.ts` (service, CRUD + event-driven)

**Analog:** `src/server/services/auth-service.ts`

**Imports pattern** (lines 10-17):
```typescript
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import {
  isLockedOut,
  nextFailureState,
  SESSION_TTL_DAYS,
} from "@/server/auth/lockout";
```
Use the same shape: `hashPassword` from `@/server/auth/password`, `randomBytes` for token generation, no `withPermission` import (pre-auth flow per Pattern 1 in RESEARCH.md).

**Non-enumeration / core pattern** (lines 38-42, the exact shape D-08 must replicate):
```typescript
// Same failure shape whether the account is missing, unverified, or the
// password is wrong — the response must not reveal which (IAM-06).
if (!user || !user.passwordHash || user.status !== "ACTIVE") {
  return { ok: false, reason: "INVALID" };
}
```
Registration must return one identical response object across new/PENDING/ACTIVE branches (D-08), exactly like this collapses three internal states into one external shape.

**Transaction + duplicate-constraint pattern** — copy from `staff-account-service.ts` `createInternal` (lines 181-220): wrap `user.create` + `PolicyAcceptance.create` x2 in `store.$transaction`, catch Prisma's unique-constraint error code `P2002` via the same `isUniqueConstraintError` helper (lines 362-369):
```typescript
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
```

**Token issuance with invalidate-on-reissue (D-03)** — no existing implementation; follow the RESEARCH.md sketch (`03-RESEARCH.md` "Code Examples" section), calling `updateMany` to set `consumedAt` on any prior unconsumed unexpired token for `identifier+purpose` before `create`-ing the new one, mirroring the `signIn` function's use of a single `randomBytes(32).toString("base64url")` token (auth-service.ts line 56).

---

### `src/server/services/verification-service.ts` and `password-reset-service.ts` (service, CRUD)

**Analog:** `src/server/services/auth-service.ts` (for token/session mechanics) + `staff-account-service.ts` (for `$transaction`, DI store-interface pattern)

**Session-revocation reuse for D-16** (auth-service.ts lines 80-87):
```typescript
/** Revokes every session for a user. IAM-03. */
export async function signOutAllForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
```
Call this after a successful password reset commits (D-16), same as `staff-account-service.ts`'s `deactivateInternal` calls `signOutAll(input.userId)` right after its transaction (line 293).

**DI store-interface + factory pattern** (staff-account-service.ts lines 94-119):
```typescript
export type StaffAccountStore = {
  user: {
    findUnique(args: Record<string, unknown>): Promise<StaffUserRow | null>;
    // ...
  };
  $transaction<T>(fn: (tx: StaffAccountStore) => Promise<T>): Promise<T>;
};

export function createStaffAccountService(deps: {
  store: StaffAccountStore;
  withPermission: WithPermission;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  hash: (plaintext: string) => Promise<string>;
  signOutAll: (userId: string) => Promise<number>;
  now?: () => Date;
}) { /* ... */ }
```
`verification-service.ts`/`password-reset-service.ts` should define their own narrow store types (only `verificationToken` + `user` fields needed) and a `create*Service(deps)` factory — but WITHOUT a `withPermission` dependency, since these are pre-auth (Pattern 1, RESEARCH.md). Export a default instance at the bottom of the file the same way `staff-account-service.ts` does (line 371-377):
```typescript
export const staffAccountService = createStaffAccountService({
  store: prisma as unknown as StaffAccountStore,
  withPermission,
  audit: recordAudit,
  hash: hashPassword,
  signOutAll: signOutAllForUser,
});
```

**Token-consumption transaction (check-then-act, single transaction)** — no direct analog exists; must follow the same discipline as `staff-account-service.ts`'s `deactivateInternal` (lines 270-289): look up current state, branch on idempotent already-done states (`if (current.status === "DEACTIVATED") return current;`), then perform the state flip inside `store.$transaction`. For verification-service, this means checking `consumedAt === null && expires > now` and flipping `User.status`/`emailVerified`/`token.consumedAt` inside one `$transaction` call — never split across two round trips (RESEARCH.md's "Token replay after use" threat row).

---

### `src/server/services/profile-service.ts` (service, CRUD)

**Analog:** `src/server/services/staff-account-service.ts` (DI shape + audit calls), but authorization model differs

**Ownership check instead of `withPermission`** — no existing analog for this specific shape (the codebase has no self-service permission), but the DI-factory shape and per-field audit-call pattern still apply. Follow `staff-account-service.ts`'s pattern of "look up current row, compute `after`, call `audit()` with before/after" (lines 297-308) for each of D-09 (name/phone), D-10 (email step-up), D-12 (marketing toggle):
```typescript
await audit({
  actorId: ctx.actor.userId,
  action: "user.deactivated",
  targetType: "User",
  targetId: input.userId,
  before: current,
  after,
  reason,
  scopeType: "GLOBAL",
  scopeId: null,
  outcome: "SUCCESS",
});
```
Use action names like `"user.profile_updated"`, `"user.email_change_requested"`, `"user.marketing_preference_updated"` (D-13). Reuse `verifyPassword` from `src/server/auth/password.ts` (lines 63-96) for the D-10 step-up check before initiating an email change.

---

### `src/server/email/brevo-client.ts` (utility, event-driven)

**Analog:** `src/server/auth/password.ts` — closest structural match for "a pure, side-effect-scoped module directly under `src/server/` with NO Prisma import, documented with a header comment explaining the design rationale."

**Header-comment convention to copy** (password.ts lines 1-12):
```typescript
/**
 * Password hashing.
 *
 * PRD NFR-04 requires secure password hashing. This uses scrypt from Node's
 * standard library — memory-hard, in the platform, and no dependency to audit
 * or keep patched.
 * ...
 */
```
`brevo-client.ts` should open with an equivalent comment explaining D-01's scope (minimal send wrapper, not Phase 13's templating/dedup system) and D-04 (sender identity as one config value). No `@prisma/client` import — this file lives outside `src/server/services/**`, where ESLint's `no-restricted-imports` rule forbids it (`eslint.config.mjs:29-54`, cited in RESEARCH.md Pattern 5). Any `EmailDispatch` bookkeeping happens from a separate `src/server/services/email-dispatch-service.ts` caller, never inside this file.

**SDK usage** — from RESEARCH.md Code Examples (no codebase analog exists yet, first email-sending code in this repo):
```typescript
import { BrevoClient } from '@getbrevo/brevo';
const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! });
await brevo.transactionalEmails.sendTransacEmail({ /* ... */ });
```

---

### `src/server/auth/request-cooldown.ts` (utility, request-response)

**Analog:** `src/server/auth/lockout.ts` (full file — copy its exact style)

**Full pattern to replicate** (lockout.ts, complete):
```typescript
/**
 * Login throttling rules (PRD IAM-06).
 *
 * Pure functions so the policy is testable without a database, and so the
 * thresholds live in one place rather than being scattered through the
 * sign-in path.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export function isLockedOut(
  user: { lockedUntil: Date | null },
  now: Date = new Date(),
): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

export function nextFailureState(
  currentFailures: number,
  now: Date = new Date(),
): { failedLoginAttempts: number; lockedUntil: Date | null } {
  const failedLoginAttempts = currentFailures + 1;
  const lockedUntil =
    failedLoginAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
      : null;
  return { failedLoginAttempts, lockedUntil };
}
```
`request-cooldown.ts` should export a `COOLDOWN_SECONDS` constant (D-05: e.g. 60) and a pure `isInCooldown(lastIssuedAt: Date | null, now: Date = new Date()): boolean` function taking the *value read from `VerificationToken.createdAt`* (Pitfall 3) rather than a live database query — same "pure function, inject `now`" testability as `isLockedOut`.

---

### `src/app/(auth)/register/*`, `forgot-password/*`, `reset-password/*` (component + controller, request-response)

**Analog:** `src/app/(auth)/signin/page.tsx`, `SignInForm.tsx`, `actions.ts` (all three, verbatim structural pattern per D-14)

**Page shape to copy exactly** (`signin/page.tsx`, full file):
```tsx
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-zinc-600">
          Staff and learner access to the training portal.
        </p>
      </div>
      <SignInForm />
    </main>
  );
}
```
Every new auth page (register, verify, forgot-password, reset-password) reuses this exact `<main>` wrapper, `max-w-sm`, spacing (`gap-6`, `px-6`), and heading typography (`text-xl font-semibold tracking-tight` + `text-sm text-zinc-600` subhead). Only the title/copy/child-form component changes.

**Form shape to copy exactly** (`SignInForm.tsx`, full file — use as literal template):
```tsx
"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, INITIAL);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      {state.error && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email address</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```
Copy the exact `useActionState` wiring, `role="alert"` error box classes, label/input classes, and disabled-during-pending button pattern for `RegisterForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`.

**Server action shape to copy exactly** (`actions.ts`, full file):
```typescript
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/server/services/auth-service";
import { SESSION_COOKIE, SESSION_TTL_DAYS } from "@/server/auth/lockout";

export type SignInState = { error: string | null };

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email address and password." };
  }

  const result = await signIn(email, password);

  if (!result.ok) {
    return {
      error:
        result.reason === "LOCKED"
          ? "Too many attempts. Try again in 15 minutes."
          : "Those details do not match an account.",
    };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });

  redirect("/staff/courses");
}
```
Every new action file: `"use server"` directive, `_prev`/`formData` signature matching `useActionState`, manual `String(formData.get(...) ?? "")` extraction (no zod, per RESEARCH.md Standard Stack), an `{ error: string | null }` state type, and `redirect()` on success. Registration/reset actions return the SAME response shape across all internal branches (D-08/Pitfall 5) — do not let per-branch messages leak into this state type.

---

### `src/app/(auth)/signin/actions.ts` — MODIFY for D-15

**This is its own analog** — the file to change. Current unconditional redirect (line 41):
```typescript
redirect("/staff/courses");
```
must branch on `actor.isStaff` (`signIn`'s return type/`prisma.user` select would need `isStaff` added to the `select` clause in `auth-service.ts`'s `signIn`, lines 29-35, since it is not currently selected) — Learner branch redirects to `/account` (A3 in RESEARCH.md), staff branch keeps `/staff/courses`.

---

### `src/app/staff/layout.tsx` — MODIFY for D-18

**This is its own analog** — the file to change. Current guard (lines 36-37):
```typescript
const actor = await getCurrentActor();
if (!actor) redirect("/signin");
```
Add `if (!actor.isStaff) redirect("/signin");` (or a distinct "not authorized" redirect) alongside the existing null check, per D-18/Pitfall 2. Comment above already frames this as "convenience only... a layout guard protects rendering, not data (RBAC-06)" (line 34-35) — preserve that framing in the added line's comment.

---

### `src/app/account/layout.tsx` (provider, request-response)

**Analog:** `src/app/staff/layout.tsx` — for the guard-and-redirect shape, NOT the nav shell (no `Assignment`-based nav exists for a Learner)

**Guard pattern to copy** (staff/layout.tsx lines 34-37):
```typescript
// Convenience only. The server action's own check is the security —
// a layout guard protects rendering, not data (RBAC-06).
const actor = await getCurrentActor();
if (!actor) redirect("/signin");
```
`account/layout.tsx` reuses this exact two-line guard (via `getCurrentActor()` from `src/server/auth/current-actor.ts`) but renders a much simpler shell — no `NAV` array, no sidebar — since RESEARCH.md's Architecture notes explicitly call this "distinct from `staff/layout.tsx`'s permission-gated pattern, since a Learner has no `Assignment`-based grants to check, just 'is this their own record'."

---

## Shared Patterns

### Non-enumerating identical response shape (IAM-06, D-08)
**Source:** `src/server/services/auth-service.ts:38-42`
**Apply to:** `registration-service.ts`, `password-reset-service.ts` (request-reset branch), any resend-verification path
```typescript
if (!user || !user.passwordHash || user.status !== "ACTIVE") {
  return { ok: false, reason: "INVALID" };
}
```
Collapse all internal branches into one external response value/message. Write an equality test across branches (Pitfall 5 in RESEARCH.md).

### Audit-first write path (D-13)
**Source:** `src/server/services/audit-service.ts` (`recordAudit`, `redactForAudit`, `AUDIT_REDACTED_KEYS`) and `src/server/services/staff-account-service.ts` (call-site shape, lines 222-232, 297-308)
**Apply to:** `registration-service.ts` (user.created), `verification-service.ts` (user.verified), `password-reset-service.ts` (user.password_reset), `profile-service.ts` (every field/preference change)
```typescript
await audit({
  actorId: ctx.actor.userId, // for pre-auth flows, use the newly-created/affected user's id since there is no session-authenticated actor yet
  action: "user.created",
  targetType: "User",
  targetId: created.user.id,
  after: created.user,
  reason: null,
  scopeType: "GLOBAL",
  scopeId: null,
  outcome: "SUCCESS",
});
```
`redactForAudit` already strips `passwordHash`/`password`/`sessionToken`/`token`/`secret` at the sink (`audit-service.ts:36-38`) — safe to pass whole `User`/`VerificationToken` rows as `before`/`after` without hand-redacting.

### Session revocation on password reset (D-16)
**Source:** `src/server/services/auth-service.ts:80-87` (`signOutAllForUser`), called from `staff-account-service.ts:293` as precedent
**Apply to:** `password-reset-service.ts`, after the password-update transaction commits.

### Pre-auth service = no `withPermission` (Pattern 1, RESEARCH.md)
**Source:** `src/server/services/auth-service.ts` (entire file — no `withPermission` import anywhere)
**Apply to:** `registration-service.ts`, `verification-service.ts`, `password-reset-service.ts` — never wrap these in `withPermission`, which throws `AuthenticationError` when there is no session (`src/server/permissions/with-permission.ts:107-120`).

### Prisma confined to `src/server/services/**` (ESLint-enforced)
**Source:** `eslint.config.mjs:29-54`
**Apply to:** `src/server/email/brevo-client.ts` and `src/server/auth/request-cooldown.ts` must not import `@prisma/client`. `request-cooldown.ts`'s cooldown check should take a `lastIssuedAt: Date | null` parameter (looked up by the calling service) rather than querying Prisma itself, matching `lockout.ts`'s `isLockedOut(user: { lockedUntil })` pure-function shape.

### DI service-factory + fake-store test harness
**Source:** `src/server/services/staff-account-service.ts:94-119, 371-377` and `tests/staff-account-service.test.ts`
**Apply to:** All four new services this phase adds — narrow Prisma-shaped `store` type, `create*Service(deps)` factory, default instance exported wired to real `prisma`, tests inject an in-memory fake `store`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/server/email/brevo-client.ts` | utility | event-driven (outbound HTTP to a third-party API) | No existing codebase module makes an outbound third-party HTTP call — this is the first. Follow RESEARCH.md's Code Examples section (SDK usage + typed-error handling) directly; structural conventions borrowed from `password.ts` (header comment, no-Prisma import) as noted above. |
| `src/server/services/email-dispatch-service.ts` | service | event-driven | No prior `EmailDispatch`-writing code exists (model unused since Phase 1). Structurally it's a thin Prisma-writing sink — closest shape is `audit-service.ts`'s `recordAudit` (single-purpose `create` call, no `$transaction`, no `withPermission`) but the domain (queued→sent/failed status transitions) has no precedent; build directly from D-17/RESEARCH.md Open Question 2 guidance. |
| `src/app/(auth)/verify/page.tsx` (server-component token-read branch: expired/used/success states) | component | request-response | `signin/page.tsx` has no multi-state rendering (success/expired/used) — it is a single static form. Use its wrapper/typography classes but design the three-state branching fresh, following IAM-02's "safe, recoverable path" requirement (RESEARCH.md Pitfall re: non-throwing states). |

## Metadata

**Analog search scope:** `src/server/services/`, `src/server/auth/`, `src/app/(auth)/signin/`, `src/app/staff/`, `tests/`, `prisma/schema.prisma`, `prisma/migrations/`, `eslint.config.mjs`
**Files scanned:** `auth-service.ts`, `lockout.ts`, `password.ts`, `current-actor.ts`, `staff-account-service.ts`, `audit-service.ts`, `staff/layout.tsx`, `signin/page.tsx`, `signin/SignInForm.tsx`, `signin/actions.ts`, `schema.prisma` (User/Session/VerificationToken/PolicyAcceptance/EmailDispatch models), `tests/lockout.test.ts`
**Pattern extraction date:** 2026-09-02
