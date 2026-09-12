---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 04
subsystem: auth
tags: [password-reset, session-revocation, non-enumeration]

requires:
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: "03-01: verificationService (issueToken/consumeToken), 03-03: ResendVerificationForm shape"
provides:
  - password-reset-service.ts (requestReset, resetPassword)
  - /forgot-password and /reset-password screens
  - Genericized ResendVerificationForm (action + successMessage props) reused by /reset-password's failure panel
  - Lockout regression test for auth-service.ts's signIn (via vi.mock of @/server/db — first use of module mocking in this test suite)
affects: [03-06-PLAN]

actuals:
  tokens: 30000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "vi.mock('@/server/db', ...) to unit-test a non-DI service (auth-service.ts's signIn calls the real prisma singleton directly, no injectable store) — first use of module-level mocking in this suite."
    - "Cost-symmetric requestReset: issueToken (the DB read+transaction) runs unconditionally for every submitted address; only the final dispatch is conditional on the account being real and ACTIVE. An orphan token for a non-existent/non-active address is inert — consumeToken's apply only ever matches a User by that exact identifier."

key-files:
  created:
    - src/server/services/password-reset-service.ts
    - src/app/(auth)/forgot-password/page.tsx
    - src/app/(auth)/forgot-password/ForgotPasswordForm.tsx
    - src/app/(auth)/forgot-password/actions.ts
    - src/app/(auth)/reset-password/page.tsx
    - src/app/(auth)/reset-password/ResetPasswordForm.tsx
    - src/app/(auth)/reset-password/actions.ts
    - tests/password-reset-service.test.ts
  modified:
    - src/app/(auth)/verify/ResendVerificationForm.tsx

key-decisions:
  - "ResendVerificationForm (plan 03) was genericized with optional `action` and `successMessage` props, defaulting to its original verify-flow behavior. Without this, reset-password's failure panel reusing the component as-is would have silently issued an EMAIL_VERIFICATION token instead of a PASSWORD_RESET token when the visitor clicked 'Send new reset link' — a real functional bug the plan's own wording ('points its action at the forgot-password flow') flagged but the component's original hardcoded action would have prevented."
  - "auth-service.ts's signIn has no dependency injection — it imports the real `prisma` singleton directly. The lockout regression test uses vi.mock('@/server/db', ...) to fake the module, the first use of module-level mocking in this test suite (every other service in the codebase is DI-based)."
  - "requestReset's cost-symmetry approach: issueToken always runs (real DB read + transaction) regardless of account state; only the dispatch is conditional. Documented in a code comment explaining why an orphan token for an unknown/inactive address is safe (it can only ever match a User later created or reactivated under that exact identifier)."

patterns-established:
  - "Pattern: a reusable single-field recovery form's action and confirmation copy should be parameterized from the start, not hardcoded — a second call site with a different underlying service was foreseeable (plan 03 named this explicitly) and hardcoding would have shipped a real bug."

requirements-completed: [IAM-03, IAM-06]

coverage:
  - id: D1
    description: "requestReset issues a 1-hour token (one twenty-fourth of the verification window) and all five outcomes (active, unknown, pending, deactivated, cooldown-refused) return the identical frozen value, dispatching on exactly one."
    requirement: "IAM-03"
    verification:
      - kind: unit
        ref: "tests/password-reset-service.test.ts#requestReset — TTL, #requestReset — non-enumeration across all five outcomes"
        status: pass
    human_judgment: false
  - id: D2
    description: "resetPassword consumes the token atomically, replaces the password hash, and revokes every session for that user; a replay changes nothing and does not revoke sessions again."
    requirement: "IAM-03"
    verification:
      - kind: unit
        ref: "tests/password-reset-service.test.ts#resetPassword — happy path and session revocation"
        status: pass
    human_judgment: false
  - id: D3
    description: "A short password is rejected before the token is consumed (link stays usable); an expired or wrong-purpose token returns the same generic invalid-token value."
    requirement: "D-19, IAM-02"
    verification:
      - kind: unit
        ref: "tests/password-reset-service.test.ts#resetPassword — expiry, validation, and purpose isolation"
        status: pass
    human_judgment: false
  - id: D4
    description: "A successful sign-in still resets failedLoginAttempts to 0 and clears lockedUntil (pre-existing Phase 1 behavior, unregressed by this phase)."
    requirement: "IAM-06"
    verification:
      - kind: unit
        ref: "tests/password-reset-service.test.ts#signIn — lockout counter reset (regression, CONCERNS.md)"
        status: pass
    human_judgment: false
  - id: D5
    description: "/forgot-password and /reset-password screens render, validate, and build cleanly."
    requirement: "IAM-03"
    verification:
      - kind: other
        ref: "npx next build (/forgot-password, /reset-password routes)"
        status: pass
    human_judgment: true
    rationale: "Visual rendering and the manual live-reset-then-old-session-denied check were not run against a live browser this session."

duration: 50min
completed: 2026-09-02
status: complete
---

# Phase 3: Public Identity — Registration, Verification & Secure Sessions Summary (Plan 04)

**Password reset closes IAM-03's remaining gap: non-enumerating request, atomic single-use completion, and global session revocation — plus a genericized recovery form and the first module-mocked regression test in this suite**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3
- **Files modified:** 7 created, 1 modified

## Accomplishments
- `password-reset-service.ts` closes the last IAM-03 gap: 1-hour single-use reset tokens, atomic claim-and-rehash, and immediate global session revocation (D-16) on success
- `/forgot-password` and `/reset-password` screens both build cleanly and match `/signin`'s exact visual pattern
- Caught and fixed a real bug before it shipped: reusing plan 03's `ResendVerificationForm` unmodified on `/reset-password`'s failure panel would have issued verification tokens instead of reset tokens — genericized the component instead
- First use of `vi.mock()` in this test suite, needed because `auth-service.ts`'s `signIn` has no dependency injection

## Task Commits

No commits — per the developer's standing instruction, all code written and verified directly.

## Files Created/Modified
- `src/server/services/password-reset-service.ts` — `requestReset`, `resetPassword`, `PASSWORD_RESET_ACCEPTED`/`RESET_ACCEPTED`/`RESET_INVALID_INPUT`/`RESET_INVALID_TOKEN`
- `src/app/(auth)/forgot-password/{page.tsx,ForgotPasswordForm.tsx,actions.ts}`
- `src/app/(auth)/reset-password/{page.tsx,ResetPasswordForm.tsx,actions.ts}`
- `src/app/(auth)/verify/ResendVerificationForm.tsx` — added `action`/`successMessage` props (backward-compatible defaults)
- `tests/password-reset-service.test.ts` — 9 tests including the `vi.mock`-based lockout regression

## `resetPassword` Result Shape

```ts
export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "INVALID_INPUT" }
  | { ok: false; reason: "INVALID_TOKEN" };
```

`resetPasswordAction` collapses both failure reasons into one generic message ("Something went wrong. Nothing was saved — try again.") except the password-length case, which gets its own message ("Use a password of at least 10 characters.") since that's an input-shape error safe to distinguish (matches the same pattern as registration's validation).

## Reset-Success Redirect

On success, `resetPasswordAction` calls `redirect("/signin?reset=1")`. **Plan 06 should render a confirmation ("Password updated. Sign in with your new password.") on `/signin` when the `reset` query parameter equals `"1"`.**

## `requestReset` Cost-Symmetry Approach

`issueToken` (the DB read + transaction) runs unconditionally for every submitted address that passes validation, regardless of whether an account exists or is active. Only the final `dispatch` call is conditional on the account being real and `ACTIVE`. This is documented in a code comment in `password-reset-service.ts`. An orphan `VerificationToken` row issued for an unknown or non-active address is inert: `consumeToken`'s `apply` callback only ever matches a `User` by that exact identifier, so it can never affect any account other than one later created or reactivated under that same address — the same reasoning already applies to registration's brand-new-account tokens.

## Decisions Made

- Genericized `ResendVerificationForm` with `action`/`successMessage` props rather than forking a second copy of the component for `/reset-password` — see key-decisions in frontmatter for the bug this prevented.
- Used `vi.mock("@/server/db", ...)` for the lockout regression test since `auth-service.ts` has no DI — the first module-level mock in this test suite; documented as such in the test file with a comment.

## Deviations from Plan

### Auto-fixed Issues

**1. ResendVerificationForm hardcoded action would have shipped a real bug**
- **Found during:** Task 3 (reset-password screen)
- **Issue:** Plan 03's `ResendVerificationForm` hardcoded `resendVerificationAction` internally. The plan's own Task 3 text says the reset-password failure panel should reuse this component but "point its action at the forgot-password flow" — impossible with the original hardcoded signature. Reusing it as written would have silently sent verification links instead of reset links from the reset-password recovery form.
- **Fix:** Added optional `action` and `successMessage` props to `ResendVerificationForm`, defaulting to the original verify-flow behavior (backward compatible, no change to plan 03's `/verify` usage).
- **Files modified:** `src/app/(auth)/verify/ResendVerificationForm.tsx`, `src/app/(auth)/reset-password/page.tsx`
- **Verification:** `npx tsc --noEmit` and `npx next build` both clean; the `/reset-password` failure panel now passes `forgotPasswordAction` explicitly.

---

**Total deviations:** 1 (a necessary component API extension, not scope creep — it was required for the plan's own stated intent to work at all).

## Issues Encountered

None beyond the ResendVerificationForm gap above.

## User Setup Required

None.

## Next Phase Readiness

Plan 06 (post-auth routing) should render the `?reset=1` confirmation copy on `/signin` and fix the `signInAction` redirect bug (D-15) — neither of which this plan touched.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-02*
