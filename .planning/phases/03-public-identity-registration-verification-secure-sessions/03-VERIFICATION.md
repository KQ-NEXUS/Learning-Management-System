---
phase: 03-public-identity-registration-verification-secure-sessions
verified: 2026-09-03T20:00:00Z
status: human_needed
score: 4/5 roadmap success criteria fully verified (1 present + automated-tested, live external-integration behavior never observed)
behavior_unverified: 1
overrides_applied: 0
---

# Phase 3: Public Identity — Registration, Verification & Secure Sessions Verification Report

**Phase Goal:** A visitor can become a verified, securely authenticated Learner, and the system resists enumeration, brute-force, and unsafe session reuse throughout.
**Verified:** 2026-09-03T20:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A visitor can register with email/password, accept required policies, and receive exactly one verification email; duplicate active emails are rejected. (IAM-01) | ✓ VERIFIED | `registration-service.ts`'s `registerLearner` has three account-state branches (brand-new / already-pending / already-active) plus a lost-insert-race (`P2002`) fallback, all returning the frozen `REGISTRATION_ACCEPTED` object by identity, not structural clones (lines 50-54, 116-235). Validation (name/email/password-length/both-consent) runs before any store call. Two `PolicyAcceptance` rows (Terms, Privacy) are written inside the same `$transaction` as the `User` row. `tests/registration-service.test.ts` (part of the 328-test green suite) covers branch-equality, validation-before-store, consent integrity, and the race fallback. Live UAT (`03-UAT.md` tests 2, 3) independently confirmed the registration form and the "check your email" flow, including that three consecutive registrations of the same address render an identical panel. |
| 2 | A single-use, expiring verification link activates the account once; expired or used links show a safe, recoverable path without revealing unrelated account data. (IAM-02) | ✓ VERIFIED | `verification-service.ts`'s `consumeToken` uses a conditional `updateMany` compare-and-set (`consumedAt: null, expires: { gt: now() }`) inside a `$transaction` — claim and check are one atomic operation, so replay and expiry-at-exact-instant are structurally guaranteed, not merely likely (lines 107-134). `src/app/(auth)/verify/page.tsx` (read directly) has exactly two render branches — `result.ok` and everything else — with no third branch on failure cause, and renders no email/name/status on the invalid path. `ResendVerificationForm` is embedded in the invalid panel. `tests/verification-service.test.ts` pins replay, purpose isolation, invalidate-on-reissue, and the cooldown boundary. Live UAT (`03-UAT.md` tests 3, 4) independently confirmed the emailed link's success path and the tampered/expired/missing-token invalid panel, including mobile-width wrapping. |
| 3 | A registered user can sign in, sign out, reset a forgotten password, and have sessions selectively or globally revoked. (IAM-03) | ✓ VERIFIED | `auth-service.ts` `signIn`/`signOut`/`signOutAllForUser` (pre-existing Phase 1, unmodified logic, regression-tested here) — database sessions, not JWT, specifically because IAM-03 requires revocation before expiry. `password-reset-service.ts`'s `resetPassword` (read directly, lines 127-165) updates the password hash and calls `signOutAllForUser(resetUserId)` unconditionally after a successful claim, and a replay (`!claimed.ok`) calls neither. `tests/password-reset-service.test.ts` — `"consumes the token, replaces the password hash, and revokes every session"` and `"does not call signOutAll a second time on a replayed token"`, both green. Live UAT (`03-UAT.md` test 5) independently confirmed: old password refused, new password accepted, and a concurrent session in a second browser was revoked. |
| 4 | A user can maintain profile fields and communication preferences within validation and consent rules. (IAM-05) | ✓ VERIFIED | `profile-service.ts` (read directly, 349 lines) — `updateOwnProfile` is a pure ownership comparison against `actor.userId` with no target-id parameter anywhere in the service's public surface; `requestEmailChange` gates on `verifyPassword` before any write and stores the new address in `pendingEmail` (not `email`) until confirmed; `confirmEmailChange` uses `findFirst` (not the illegal `findUnique`) against the non-unique `pendingEmail` column, with a row-level single-holder guarantee (`updateMany` clearing every other row first) — this closes **G-03-6a**, a blocker found in live UAT where the confirmation link 100% crashed with `PrismaClientValidationError`; confirmed fixed by directly reading the current source, not the SUMMARY's claim. `setMarketingPreference` upserts a `PolicyAcceptance` row (`policyType: MARKETING`, `orderId: null`) and never gates transactional sends. `updateProfileAction`/`ProfileForm.tsx` (read directly) close **G-03-6b** (stale render after save — the `key={save-${state.saveCount}}` remount pattern plus `revalidatePath("/account")`) and **G-03-6c** (silent step-up failure — a distinct `STEP_UP_FAILED_ERROR` message, mapped only from that one reason). All three gap-closure fixes were independently re-verified live in a browser on 2026-09-03 per `03-VALIDATION.md`'s Manual-Only Verifications table. *Minor doc-drift note: `03-UAT.md`'s own line-40 `result:` field for test 6 still literally reads `[pending]`, not updated to `pass`, even though the file's own frontmatter/Summary block reports `pending: 0` and each of G-03-6a/b/c is individually marked `resolved` with a resolution date. This is a bookkeeping omission in one field of one document, not a functional gap — the code evidence and the gap-level resolution records agree with each other, just not with that one unedited literal.* |
| 5 | Repeated failed logins lock the account, error messages never reveal whether an email exists, and no secrets appear in logs. (IAM-06) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | **Lockout and standard non-enumeration: ✓ VERIFIED.** `signIn` (read directly) returns one `INVALID` reason for missing/unverified/wrong-password and locks on `nextFailureState`; a successful sign-in resets `failedLoginAttempts`/`lockedUntil` (regression-tested, `tests/password-reset-service.test.ts`'s lockout-reset case, part of the green 328-test suite). No `console.log`/`console.error`/`console.warn` calls exist in any of the six Phase-3 service files (grep-confirmed). Every non-enumerating response (`registerLearner`, `verifyEmail`'s resend, `requestReset`, `requestEmailChange`) is a frozen module-level object shared across branches. **The one directly-relevant sub-case is NOT independently confirmed working live.** UAT found a real, blocker-severity account-enumeration oracle (**G-03-3**): during a Brevo outage, `requestReset`'s active-account branch threw uncaught, crashing the page, while an unknown address returned the normal frozen confirmation — a live, working oracle that defeated this exact success criterion. The fix (`dispatchBestEffort`, read directly in `email-dispatch-service.ts` lines 115-125, wired at all four send call sites plus defence-in-depth `try/catch` in `register/actions.ts` and `forgot-password/actions.ts`, both read directly) is implemented, and is proven by a genuine automated regression test — not a rubber-stamp: `tests/password-reset-service.test.ts`'s `"requestReset — outage-time indistinguishability (G-03-3 regression)"` describe block (lines 216-243, read directly) drives a rejecting transport and asserts, by object identity and deep equality, that an existing ACTIVE account and an unknown address return the byte-identical frozen value, with an explicit check (`expect(...dispatched).toHaveLength(0)`) proving the transport genuinely rejected rather than silently succeeding. This test is part of the green 328-test suite. **What is missing is the live browser re-test** — deliberately invalidating `BREVO_API_KEY` and confirming `/forgot-password` renders the normal confirmation instead of the Next.js error overlay — which was offered to the project owner on 2026-09-03 per `03-UAT.md`'s `G-03-3` gap entry and explicitly `DECLINED`. This is an external-service-integration behavior (a real Brevo outage against a real dev server) that unit tests can approximate but not fully stand in for, and it is the one Phase-3 finding never observed working outside a test harness. |

**Score:** 4/5 roadmap success criteria fully verified; 1 present, code-correct, and automated-regression-tested but not live-verified.

### Plan-Level Must-Haves — Representative Spot-Checks (beyond the roadmap table above)

| Must-have (plan) | Status | Evidence |
|---|---|---|
| User.email's unique constraint is the race-safety mechanism for two simultaneous registrations (03-02) | ✓ VERIFIED | `registration-service.ts`'s `isUniqueConstraintError` catches `P2002` from the `$transaction` and falls through to `resendForPending` + `REGISTRATION_ACCEPTED` — identical to the winner's response. |
| The password hash runs the same number of times on the brand-new branch as on the already-active branch (03-02, cost symmetry) | ✓ VERIFIED | `hash(input.password)` (line 135) executes unconditionally before the branch decision, so every post-validation arm — including the discarding ones — pays the same dominant cost. `tests/registration-service.test.ts#hashes the password the same number of times` is green. |
| Two additive schema columns exist and the live database is migrated (03-01) | ✓ VERIFIED | `prisma/schema.prisma:213` (`User.pendingEmail`), `:299` (`VerificationToken.createdAt`); `prisma/migrations/20260902190232_identity_token_created_at_and_pending_email/migration.sql` contains both `ALTER TABLE` statements; `npx prisma migrate status` reports "Database schema is up to date!" against the live Neon Postgres instance. |
| requestReset issues a 1-hour token, one-twenty-fourth of the 24-hour verification window (03-04, D-02) | ✓ VERIFIED | `src/lib/identity.ts` defines `VERIFICATION_TOKEN_TTL_MS`/`PASSWORD_RESET_TOKEN_TTL_MS`; `password-reset-service.ts` passes `PASSWORD_RESET_TOKEN_TTL_MS` into `issueToken`. |
| A newly authenticated Learner lands on /account; a staff member still lands on /staff/courses (03-06, D-15) | ✓ VERIFIED | `landing.ts`'s pure `landingPathFor` (read directly); `signin/actions.ts` calls `redirect(landingPathFor(result))` where `result.isStaff` flows from `signIn`'s Prisma `select`. `tests/landing.test.ts` covers `true`/`false`/absent/`null`. Live UAT test 7 confirmed both destinations. |
| The staff layout guard rejects an authenticated non-staff actor without crashing (03-06/03-09, D-18, G-03-7) | ✓ VERIFIED | `staff/layout.tsx:45-47` (read directly): `if (!actor) redirect("/signin"); if (!actor.isStaff) redirect(LEARNER_LANDING_PATH);` — resolved through the shared `landing.ts` constant, not a literal, closing **G-03-7**. `tests/landing.test.ts`'s source-level regression (reads `staff/layout.tsx` as text) pins that the non-staff branch imports and uses `LEARNER_LANDING_PATH` and never a `"/signin"` literal, while the unauthenticated branch's literal is pinned unchanged. Live-reverified 2026-09-03 per `03-VALIDATION.md`. |
| isStaff remains a presentation hint only — never an authorization input (03-06, IAM-06) | ✓ VERIFIED | Every protected write path in this phase (`profile-service.ts`) authorizes via `actor.userId` ownership; every staff-only path continues to resolve through `withPermission`/`Assignment` rows (unmodified by this phase, confirmed via the file not appearing in any Phase-3 `files_modified` list except the guard itself). |
| No secrets appear in logs (IAM-06) | ✓ VERIFIED | Zero `console.log`/`console.error`/`console.warn` calls across all six Phase-3 service files (grep-confirmed). `brevo-client.ts`'s `describeBrevoFailure` explicitly never logs the raw error itself, "it could carry the recipient address or request body" (source comment, read directly), and `emailDispatchService.dispatch`'s `FAILED` row stores only the described string, never the raw token or request body. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/identity.ts` | shared TOKEN_PURPOSE/TTL/policy constants | ✓ VERIFIED | 38 lines, imported by all five services |
| `src/server/auth/request-cooldown.ts` | pure per-address cooldown predicate | ✓ VERIFIED | 30 lines, used by `verification-service.ts`'s `issueToken` |
| `src/server/email/brevo-client.ts` | outbound transport, no Prisma import | ✓ VERIFIED | 82 lines, `sendTransactionalEmail`/`describeBrevoFailure`, confined per `eslint.config.mjs` boundary rule (eslint clean) |
| `src/server/services/email-dispatch-service.ts` | throwing `dispatch` + opt-in `dispatchBestEffort` | ✓ VERIFIED | 131 lines, both exported and directly tested in `tests/email-dispatch-service.test.ts` |
| `src/server/services/registration-service.ts` | three-branch `registerLearner` | ✓ VERIFIED | 246 lines, wired into `register/actions.ts` |
| `src/server/services/verification-service.ts` | issueToken/consumeToken/verifyEmail/resendVerification | ✓ VERIFIED | 202 lines, wired into `/verify` and reused by password-reset/profile |
| `src/server/services/password-reset-service.ts` | requestReset/resetPassword | ✓ VERIFIED | 176 lines, wired into `/forgot-password` and `/reset-password` |
| `src/server/services/profile-service.ts` | ownership-authorized profile/preference editing | ✓ VERIFIED | 349 lines, wired into `/account` |
| `src/server/auth/landing.ts` | pure post-auth landing-path resolver | ✓ VERIFIED | 16 lines, wired into `signin/actions.ts` and `staff/layout.tsx` |
| `src/app/(auth)/register/**`, `/verify/**`, `/forgot-password/**`, `/reset-password/**`, `/confirm-email-change/**` | full auth-adjacent public UI | ✓ VERIFIED | All files present, no placeholder/TBD/FIXME markers found (grep-confirmed across all 32 phase files) |
| `src/app/account/**` | first Learner-facing authenticated route | ✓ VERIFIED | 4 files, ownership-only guard, no `withPermission` (deliberate, documented) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Emailed link `?token=` param | `/verify` `searchParams` → `verificationService.verifyEmail` | direct await in the Server Component | ✓ WIRED | Confirmed by direct read; absent/array/empty falls through to the invalid state without calling the service |
| `ResendVerificationForm` | `resendVerificationAction` → `verificationService.resendVerification` → `issueToken` cooldown | same entry point registration's already-pending branch uses | ✓ WIRED | One shared entry point, confirmed by direct read of both call sites |
| `dispatch` throw | `dispatchBestEffort` (the only place the throw stops) | named, opt-in wrapper, imported by name at every call site | ✓ WIRED | Confirmed at all four sites: `registration-service.ts:225`, `verification-service.ts:182`, `password-reset-service.ts:106`, `profile-service.ts:231` |
| `requestReset`'s ACTIVE-account branch | `dispatch` | the only one of five outcomes that sends | ✓ WIRED, and now non-crashing | Confirmed by direct read; regression-tested with a rejecting transport |
| `updateOwnProfile`'s returned saved profile | `ProfileForm.tsx`'s rendered fields | `useActionState` state echoed back, keyed on `saveCount` for remount | ✓ WIRED | Confirmed by direct read; addresses React 19's uncontrolled-form-reset behavior specifically, not just `revalidatePath` alone |
| `staff/layout.tsx`'s non-staff branch | `LEARNER_LANDING_PATH` | direct import from `landing.ts` | ✓ WIRED | Confirmed by direct read and by `tests/landing.test.ts`'s source-level regression |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `/verify` page | verification result | `verificationService.verifyEmail(token)` → Prisma `updateMany`/`findFirst` inside `$transaction` | Yes | ✓ FLOWING |
| `/account` page | profile snapshot | `profileService.getOwnProfile(actor)` → Prisma `findUnique` + `policyAcceptance.findFirst` | Yes | ✓ FLOWING |
| `ProfileForm` post-save fields | saved name/phone | `updateOwnProfile`'s returned `after` row, echoed through action state | Yes | ✓ FLOWING |
| `/confirm-email-change` page | confirmation result | `profileService.confirmEmailChange(token)` → Prisma `findFirst`/`update` inside `$transaction` | Yes | ✓ FLOWING |
| `EmailDispatch` FAILED row | `error` string | `describeBrevoFailure(error)` inside `dispatch`'s catch block | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite passes | `npm test` | `Test Files 29 passed (29)`, `Tests 328 passed (328)` | ✓ PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| ESLint clean (`src tests prisma`) | `npx eslint src tests prisma` | exit 0, no output | ✓ PASS |
| Production build succeeds, all 17 routes compile including every Phase-3 route | `npm run build` | `Compiled successfully`, `/account`, `/confirm-email-change`, `/forgot-password`, `/register`, `/reset-password`, `/signin`, `/verify` all listed | ✓ PASS |
| G-03-3 outage-time indistinguishability, single named test | `npx vitest run tests/password-reset-service.test.ts` (describe block read directly, lines 216-243) | Drives a rejecting transport; asserts `activeResult === unknownResult === PASSWORD_RESET_ACCEPTED` by identity and deep equality, and `dispatched.length === 0` for both, proving the transport genuinely rejected | ✓ PASS (automated) — live browser equivalent DECLINED, see truth 5 above |
| Prisma migration state matches schema | `npx prisma migrate status` | "Database schema is up to date!" against the live Neon instance | ✓ PASS |
| No secrets logged | `grep console\.\(log\|error\|warn\)` across the 6 Phase-3 service files | zero matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| IAM-01 | 03-01, 03-02, 03-08 | Registration, policy acceptance, duplicate-active rejection, one verification email | ✓ SATISFIED | `registration-service.ts`, `tests/registration-service.test.ts`, live UAT tests 2-3 |
| IAM-02 | 03-01, 03-03, 03-08 | Single-use expiring verification link, safe recoverable failure path | ✓ SATISFIED | `verification-service.ts`, `tests/verification-service.test.ts`, live UAT tests 3-4 |
| IAM-03 | 03-04, 03-06, 03-08, 03-09 | Sign-in/out, password reset, selective/global session revocation | ✓ SATISFIED | `password-reset-service.ts`, `auth-service.ts` (regression-tested), `landing.ts`, live UAT tests 5, 7 |
| IAM-05 | 03-05, 03-07, 03-08, 03-09 | Profile fields and communication preferences within validation/consent | ✓ SATISFIED | `profile-service.ts`, gap closures G-03-6a/6b/6c all fixed and live-reverified |
| IAM-06 | 03-01 through 03-09 (cross-cutting) | Enumeration/brute-force resistance, non-enumerating errors, no secrets logged | ⚠️ PARTIALLY SATISFIED — SEE HUMAN VERIFICATION | Lockout, standard non-enumeration, and log hygiene are code-verified and test-green throughout. The one live-observed blocker (G-03-3, a real account-enumeration oracle during a provider outage) is fixed and automated-regression-tested with a confirmed negative control, but the live re-test was explicitly declined — this is the specific gap in an otherwise-satisfied requirement. |

No orphaned requirements — REQUIREMENTS.md's Phase 3 row set (IAM-01, 02, 03, 05, 06) exactly matches the phase's declared requirement IDs and the union of `requirements:` fields across all 10 plan frontmatters. *Note: REQUIREMENTS.md's own checkbox column (lines 14-19) still shows these five as unchecked/"Pending" in its Traceability table — that document has not yet been updated to reflect this phase's completion. This is an orchestrator/documentation bookkeeping item outside this report's write scope (per the task's explicit instruction not to modify STATE.md/ROADMAP.md), flagged here so it is not silently missed.*

### Anti-Patterns Found

None. Grep scans for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and "not implemented"/"coming soon"/"not available" style phrases across all 32 files this phase created or modified returned zero matches. No `console.log`-only implementations, no empty handlers, no hardcoded-empty stub data flowing to render output. No debt markers of any kind.

### Human Verification Required

1 item, carried forward directly from `03-UAT.md`'s own honest record rather than newly discovered here.

### 1. Brevo-outage non-enumeration, live in a browser (G-03-3)

**Test:** With a deliberately invalid `BREVO_API_KEY` set, submit `/forgot-password` for a real ACTIVE account and, separately, for an address with no account. Also exercise `/register` and `/verify`'s resend form under the same broken key.
**Expected:** Every path renders the normal safe confirmation panel — never a stack trace or the Next.js error overlay — and the response is visually indistinguishable between the real and the unknown address.
**Why human:** This is a live external-service-integration failure mode (a real Brevo API rejection reaching a real running Next.js server), the exact class of behavior Step 8 always routes to a human — a unit test can drive a rejecting transport at the service layer (and does, with a confirmed negative control), but it cannot fully stand in for observing the actual browser response during a real provider outage. This was a blocker-severity defect UAT found live once already; the fix is implemented and automated-tested, but was explicitly never re-confirmed working outside a test harness. The re-test was offered to the project owner on 2026-09-03 and declined (`03-UAT.md`, `G-03-3`, `live_verification: DECLINED`).

### Gaps Summary

No functional gaps. All 5 roadmap success criteria trace to concrete, substantive, wired, data-flowing code, independently re-read from source rather than taken from SUMMARY.md claims. The full automated suite (328/328), `tsc`, `eslint`, and `next build` are all independently re-run here and pass. Four of the five UAT-found defects (G-03-6a, G-03-6b, G-03-6c, G-03-7) are fixed in source, automated-regression-tested, and were re-verified live in a browser on 2026-09-03.

**One item is deliberately not certified `passed`:** G-03-3 was a blocker-severity, live-observed account-enumeration oracle. The fix is real — `dispatchBestEffort` is correctly implemented and wired at all four send call sites, defence-in-depth `try/catch` wraps the three public auth actions, and a genuine automated regression test (not a rubber stamp — it drives an actual rejecting transport and asserts both object identity and that zero sends were recorded) passes as part of the green 328-test suite. But the live browser re-test that would confirm this specific fix under a real Brevo outage was offered to the project owner and explicitly declined. Marking this `passed` would erase that fact from the record; marking it `gaps_found` would misrepresent strong, genuine automated evidence as absent. `human_needed` is the honest middle ground the verification framework provides for exactly this situation, and it is the status this report uses.

A minor documentation-only inconsistency is noted but not treated as a gap: `03-UAT.md`'s own test-6 `result:` field still literally reads `[pending]` even though the file's Summary block and each individual gap record (G-03-6a/b/c) show the underlying work as resolved and live-reverified.

---

*Verified: 2026-09-03T20:00:00Z*
*Verifier: Claude (gsd-verifier)*
