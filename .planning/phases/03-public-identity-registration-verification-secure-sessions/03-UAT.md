---
status: complete
phase: 03-public-identity-registration-verification-secure-sessions
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md, 03-06-SUMMARY.md
started: 2026-09-02T23:00:10Z
updated: 2026-09-03T18:29:30Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Stop any running dev server. Run the database migrations, then start the app fresh with `npm run dev`. The server boots with no errors, migrations complete, and http://localhost:3000/register loads.
result: pass

### 2. Register Screen Renders and Validates
expected: http://localhost:3000/register shows the password hint, both consent checkboxes, and a cross-link to sign-in. Submitting with a weak password or without ticking the required consent is rejected with a message, and the page does not crash.
result: pass
note: "Initially reported as missing; on re-check the hint ('At least 10 characters.') is present under the password field."

### 3. Register, Receive the Email, Activate the Account
expected: Registering a brand-new email address shows a confirmation panel. One verification email actually arrives in that inbox. Clicking its link lands on /verify and reports the account is now active. Submitting the SAME email a second and third time returns a visually identical panel — no hint that the address is already taken.
result: pass
note: \"(a) email arrived, (b) link activated the account, (c) repeat registrations returned the identical Check-your-email panel\"

### 4. Invalid Verification Link — One Panel, Readable on Mobile
expected: Open /verify with a tampered, expired, or missing token (e.g. http://localhost:3000/verify?token=nonsense). One 'invalid link' panel appears with a working resend form embedded in it. Narrow the browser to a phone width (~320px): the longest message text wraps inside the card without overflowing or being cut off.
result: pass

### 5. Forgot Password, Reset, Old Session Denied
expected: From /forgot-password, request a reset for a real account — the same confirmation appears whether or not the address exists. The reset email arrives; its link opens /reset-password and accepts a new password. Afterwards: the new password signs in, the old one does not, and any other browser already signed in as that user is signed out.
result: pass
note: \"identical response for existing and unknown address; old password refused; new password accepted; concurrent session in a second browser was revoked\"

### 6. Account Page — Edit Profile and Change Email
expected: Signed in as a Learner, /account loads. Name and phone can be edited and saved without re-entering a password. Changing the email address asks for the current password first, then sends a confirmation to the NEW address; the account email only changes after that confirmation link is opened.
result: pass
history: "First run 2026-09-02 FAILED - surfaced G-03-6a (PrismaClientValidationError on the confirmation link, blocker), G-03-6b (stale render after save) and G-03-6c (step-up failure reported as a generic error). Reported verbatim: 'it saves but i have to reload to show the newly saved also Something went wrong. Nothing was saved - try again. when i try to change email'."
note: "Re-verified live in a browser 2026-09-03 after gap-closure plans 03-07 and 03-09: profile save renders without a manual reload, a failed step-up now names the password, and email-change confirmation completes. All three gaps marked resolved."

### 7. Post-Sign-In Routing and Staff Route Guard
expected: Signing in as a staff user lands on /staff/courses. Signing in as a Learner lands on /account. A signed-in Learner typing /staff/courses directly is redirected away rather than seeing an error page or staff data.
result: pass
note: "staff lands on /staff/courses, learner lands on /account, and a signed-in Learner hitting /staff/courses is redirected away with no staff data and no crash. Destination of that redirect is wrong - see G-03-7."

### 8. A brand-new email registers, receives one verification email via Brevo, and the emailed link activates the account — proven end to end.
expected: A brand-new email registers, receives one verification email via Brevo, and the emailed link activates the account — proven end to end.
result: pass
source: automated
coverage_id: D1 (03-01-SUMMARY.md)
verified_by: tests/registration-service.test.ts#end-to-end: register then verify activates the account

### 9. Token consumption is atomic (conditional compare-and-set); replay after use returns not-valid; a token is expired exactly at its expires instant, not one tick after.
expected: Token consumption is atomic (conditional compare-and-set); replay after use returns not-valid; a token is expired exactly at its expires instant, not one tick after.
result: pass
source: automated
coverage_id: D2 (03-01-SUMMARY.md)
verified_by: tests/verification-service.test.ts#consumeToken

### 10. Per-address cooldown blocks a second request inside 60 seconds and allows one exactly at the boundary; reissue past the cooldown invalidates the prior token.
expected: Per-address cooldown blocks a second request inside 60 seconds and allows one exactly at the boundary; reissue past the cooldown invalidates the prior token.
result: pass
source: automated
coverage_id: D3 (03-01-SUMMARY.md)
verified_by: tests/request-cooldown.test.ts, tests/verification-service.test.ts#issueToken

### 11. Two additive schema columns (VerificationToken.createdAt, User.pendingEmail) exist and the live database is migrated.
expected: Two additive schema columns (VerificationToken.createdAt, User.pendingEmail) exist and the live database is migrated.
result: pass
source: automated
coverage_id: D4 (03-01-SUMMARY.md)
verified_by: tests/schema-identity.test.ts; npx prisma migrate status

### 12. The three account-state branches (brand-new, already-pending, already-active) and the lost-insert-race fallback all return the exact same frozen success value.
expected: The three account-state branches (brand-new, already-pending, already-active) and the lost-insert-race fallback all return the exact same frozen success value.
result: pass
source: automated
coverage_id: D1 (03-02-SUMMARY.md)
verified_by: tests/registration-service.test.ts#non-enumeration: response indistinguishability and cost symmetry

### 13. The password hash runs the same number of times on the brand-new branch as on the already-active branch, closing the timing side channel.
expected: The password hash runs the same number of times on the brand-new branch as on the already-active branch, closing the timing side channel.
result: pass
source: automated
coverage_id: D2 (03-02-SUMMARY.md)
verified_by: tests/registration-service.test.ts#hashes the password the same number of times

### 14. Validation (name, email, password length, both consent flags) runs before any store call.
expected: Validation (name, email, password length, both consent flags) runs before any store call.
result: pass
source: automated
coverage_id: D3 (03-02-SUMMARY.md)
verified_by: tests/registration-service.test.ts#validation runs before any store call

### 15. Consent is recorded only when affirmatively given — a false consent flag creates zero PolicyAcceptance rows, and no checkbox renders defaulted-on.
expected: Consent is recorded only when affirmatively given — a false consent flag creates zero PolicyAcceptance rows, and no checkbox renders defaulted-on.
result: pass
source: automated
coverage_id: D4 (03-02-SUMMARY.md)
verified_by: tests/registration-service.test.ts#consent integrity

### 16. Every way a verification link can fail (expired, used, wrong-purpose, unknown, malformed, absent) renders one identical invalid panel with an embedded, working resend form.
expected: Every way a verification link can fail (expired, used, wrong-purpose, unknown, malformed, absent) renders one identical invalid panel with an embedded, working resend form.
result: pass
source: automated
coverage_id: D1 (03-03-SUMMARY.md)
verified_by: src/app/(auth)/verify/page.tsx has exactly two rendered branches (build + tsc clean); tests/verification-service.test.ts#verifyEmail — non-disclosure; npx next build (/verify route compiles)

### 17. The resend control returns the same confirmation regardless of account state or cooldown, and only dispatches on the pending-and-past-cooldown case.
expected: The resend control returns the same confirmation regardless of account state or cooldown, and only dispatches on the pending-and-past-cooldown case.
result: pass
source: automated
coverage_id: D2 (03-03-SUMMARY.md)
verified_by: tests/verification-service.test.ts#resendVerification — returns the exact same object identity

### 18. Token replay, purpose isolation, invalidate-on-reissue, and the cooldown boundary are each pinned by a test.
expected: Token replay, purpose isolation, invalidate-on-reissue, and the cooldown boundary are each pinned by a test.
result: pass
source: automated
coverage_id: D3 (03-03-SUMMARY.md)
verified_by: tests/verification-service.test.ts#consumeToken — lifecycle regression coverage, #issueToken — invalidate-on-reissue regression coverage

### 19. requestReset issues a 1-hour token (one twenty-fourth of the verification window) and all five outcomes (active, unknown, pending, deactivated, cooldown-refused) return the identical frozen value, dispatching on exactly one.
expected: requestReset issues a 1-hour token (one twenty-fourth of the verification window) and all five outcomes (active, unknown, pending, deactivated, cooldown-refused) return the identical frozen value, dispatching on exactly one.
result: pass
source: automated
coverage_id: D1 (03-04-SUMMARY.md)
verified_by: tests/password-reset-service.test.ts#requestReset — TTL, #requestReset — non-enumeration across all five outcomes

### 20. resetPassword consumes the token atomically, replaces the password hash, and revokes every session for that user; a replay changes nothing and does not revoke sessions again.
expected: resetPassword consumes the token atomically, replaces the password hash, and revokes every session for that user; a replay changes nothing and does not revoke sessions again.
result: pass
source: automated
coverage_id: D2 (03-04-SUMMARY.md)
verified_by: tests/password-reset-service.test.ts#resetPassword — happy path and session revocation

### 21. A short password is rejected before the token is consumed (link stays usable); an expired or wrong-purpose token returns the same generic invalid-token value.
expected: A short password is rejected before the token is consumed (link stays usable); an expired or wrong-purpose token returns the same generic invalid-token value.
result: pass
source: automated
coverage_id: D3 (03-04-SUMMARY.md)
verified_by: tests/password-reset-service.test.ts#resetPassword — expiry, validation, and purpose isolation

### 22. A successful sign-in still resets failedLoginAttempts to 0 and clears lockedUntil (pre-existing Phase 1 behavior, unregressed by this phase).
expected: A successful sign-in still resets failedLoginAttempts to 0 and clears lockedUntil (pre-existing Phase 1 behavior, unregressed by this phase).
result: pass
source: automated
coverage_id: D4 (03-04-SUMMARY.md)
verified_by: tests/password-reset-service.test.ts#signIn — lockout counter reset (regression, CONCERNS.md)

### 23. A Learner edits their own name and phone directly with no step-up; no entry point accepts a target user id, so authorization is a pure ownership comparison.
expected: A Learner edits their own name and phone directly with no step-up; no entry point accepts a target user id, so authorization is a pure ownership comparison.
result: pass
source: automated
coverage_id: D1 (03-05-SUMMARY.md)
verified_by: tests/profile-service.test.ts#updateOwnProfile

### 24. An email change requires the current password before anything is written; a wrong password writes nothing; the collision, same-address, and happy-path outcomes are indistinguishable.
expected: An email change requires the current password before anything is written; a wrong password writes nothing; the collision, same-address, and happy-path outcomes are indistinguishable.
result: pass
source: automated
coverage_id: D2 (03-05-SUMMARY.md)
verified_by: tests/profile-service.test.ts#requestEmailChange

### 25. Confirming the email change swaps pendingEmail into email atomically; a replay changes nothing; a collision arising between request and confirmation is refused cleanly inside the transaction.
expected: Confirming the email change swaps pendingEmail into email atomically; a replay changes nothing; a collision arising between request and confirmation is refused cleanly inside the transaction.
result: pass
source: automated
coverage_id: D3 (03-05-SUMMARY.md)
verified_by: tests/profile-service.test.ts#confirmEmailChange

### 26. The marketing preference is a single on/off toggle backed by a PolicyAcceptance row (updated, never deleted, on opt-out); transactional email is never gated on it.
expected: The marketing preference is a single on/off toggle backed by a PolicyAcceptance row (updated, never deleted, on opt-out); transactional email is never gated on it.
result: pass
source: automated
coverage_id: D4 (03-05-SUMMARY.md)
verified_by: tests/profile-service.test.ts#setMarketingPreference, #getOwnProfile

### 27. landingPathFor resolves correctly for isStaff true, false, and absent/null, tested against exported path constants.
expected: landingPathFor resolves correctly for isStaff true, false, and absent/null, tested against exported path constants.
result: pass
source: automated
coverage_id: D1 (03-06-SUMMARY.md)
verified_by: tests/landing.test.ts

### 28. signIn and getActorBySessionToken now select and expose isStaff without changing any existing null-returning condition or the non-enumerating failure shape; the pre-existing lockout-reset behavior is unregressed.
expected: signIn and getActorBySessionToken now select and expose isStaff without changing any existing null-returning condition or the non-enumerating failure shape; the pre-existing lockout-reset behavior is unregressed.
result: pass
source: automated
coverage_id: D2 (03-06-SUMMARY.md)
verified_by: npm test (full 303-test suite, including tests/password-reset-service.test.ts's lockout regression and every permission/scope/boundary test file)

### 29. signInAction resolves its redirect through landingPathFor; SignInForm.tsx's existing class strings are provably untouched (diff shows zero removed className lines); the sign-in screen shows the reset-success confirmation only when the query flag is present.
expected: signInAction resolves its redirect through landingPathFor; SignInForm.tsx's existing class strings are provably untouched (diff shows zero removed className lines); the sign-in screen shows the reset-success confirmation only when the query flag is present.
result: pass
source: automated
coverage_id: D3 (03-06-SUMMARY.md)
verified_by: grep (landingPathFor present, 2 occurrences), git diff (0 removed className lines), npx next build (/signin compiles)

### 30. staff/layout.tsx's guard now also redirects an authenticated non-staff actor, with the diff touching only the guard and its comment (1 deleted line, within the plan's 2-line budget).
expected: staff/layout.tsx's guard now also redirects an authenticated non-staff actor, with the diff touching only the guard and its comment (1 deleted line, within the plan's 2-line budget).
result: pass
source: automated
coverage_id: D4 (03-06-SUMMARY.md)
verified_by: git diff --numstat (1 deleted line), npx next build (/staff/* routes compile)
### 31. Any Email Send When the Provider Rejects the Send
expected: If Brevo refuses the send (bad key, outage, blocked recipient), every send path (register, resend verification, forgot password, email change) shows the normal safe confirmation - never a stack trace - and the response stays indistinguishable between an existing and a non-existing address.
result: fixed_not_live_verified
reported: "Runtime BrevoError 401 Key not found surfaced on src/app/(auth)/register/page.tsx and again on src/app/(auth)/forgot-password/page.tsx"
severity: blocker
source: observed-during-uat

## Summary

total: 31
passed: 30
issues: 0
fixed_not_live_verified: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-03-3
  truth: "A failed provider send must never surface a stack trace, and must never make an existing account distinguishable from a non-existing one (IAM-06)"
  status: fixed_not_live_verified
  resolved_by: 03-08-PLAN.md
  resolved_at: 2026-09-03
  live_verification: DECLINED
  live_verification_note: "Fix implemented and covered by automated regression (tests/email-dispatch-service.test.ts, plus a rejecting-transport indistinguishability test in tests/password-reset-service.test.ts whose negative control was confirmed to go red before the fix). The live browser re-test - deliberately invalidating BREVO_API_KEY and confirming /forgot-password renders the normal confirmation instead of the Next.js error overlay - was offered on 2026-09-03 and the project owner chose to skip it. This remains the one Phase 3 finding never observed working in a real browser."
  reason: "Observed during UAT on two separate pages. All four dispatch call sites are unguarded, so any provider failure throws to the Next.js error overlay. The password-reset path is the serious one: requestReset only dispatches when `user && user.status === ACTIVE`, so during a provider outage an existing active account CRASHES the page while an unknown address returns the normal frozen confirmation - a direct account-enumeration oracle that defeats the non-enumeration design the same function documents at length for timing symmetry. Registration additionally commits the User row before dispatching and writes its user.created audit record after, so a send failure leaves a PENDING_VERIFICATION user with no audit trail."
  severity: blocker
  root_cause: \"No dispatch call site catches a provider send failure; the password-reset path additionally dispatches only inside the `user && ACTIVE` branch, so the throw is observable only for real accounts."
  test: 31
  artifacts:
    - path: "src/server/services/password-reset-service.ts"
      issue: "line 105: await dispatch(...) inside the `user && ACTIVE` branch is uncaught - a throw here is observable only for real accounts (enumeration oracle)"
    - path: "src/server/services/registration-service.ts"
      issue: "line 210: await dispatch(...) uncaught; the user.created audit write at ~line 220 is skipped on send failure, leaving a committed User with no audit row"
    - path: "src/server/services/verification-service.ts"
      issue: "line 187: await dispatch(...) uncaught in the resend path"
    - path: "src/server/services/profile-service.ts"
      issue: "line 214: await dispatch(...) uncaught in the email-change path"
    - path: "src/app/(auth)/register/actions.ts"
      issue: "registerAction has no try/catch around the service call"
    - path: "src/app/(auth)/forgot-password/actions.ts"
      issue: "the forgot-password action has no try/catch around the service call"
  missing:
    - "Catch send failures at each dispatch call site (or centrally in emailDispatchService.dispatch) so the FAILED row is recorded and the caller continues"
    - "Ensure the registration audit write happens whether or not the send succeeds"
    - "Add a regression test asserting requestReset returns the identical frozen value for an existing ACTIVE account when dispatch rejects"

- gap_id: G-03-6a
  truth: "Confirming an email change activates the new address"
  status: resolved
  resolved_by: 03-07-PLAN.md
  resolved_at: 2026-09-03
  reason: "PrismaClientValidationError at profile-service.ts:241 - tx.user.findUnique({ where: { pendingEmail } }) is invalid because User.pendingEmail is not @unique in prisma/schema.prisma (line 213). The email-change confirmation is completely non-functional; every learner who follows the confirmation link gets a server crash. The same file already uses findFirst correctly for non-unique lookups at lines 195 and 248 - line 241 is the outlier. tests/profile-service.test.ts did not catch it because its hand-written fake store types findUnique as accepting pendingEmail (line 37), so the mock encodes the bug rather than the Prisma contract."
  severity: blocker
  root_cause: \"findUnique is used against User.pendingEmail, which carries no @unique in prisma/schema.prisma:213; Prisma rejects the argument at runtime."
  test: 6
  artifacts:
    - path: "src/server/services/profile-service.ts"
      issue: "line 241: findUnique on the non-unique pendingEmail column - must be findFirst"
    - path: "tests/profile-service.test.ts"
      issue: "line 37: the fake store accepts a pendingEmail findUnique, hiding the schema mismatch from the suite"
  missing:
    - "Change line 241 to tx.user.findFirst({ where: { pendingEmail: row.identifier } })"
    - "Either mark pendingEmail @unique in the schema (with a migration) or keep findFirst - decide which the design wants"
    - "Tighten the test fake so findUnique rejects non-unique selectors, and add a confirmEmailChange regression test that would fail against the real Prisma contract"

- gap_id: G-03-6b
  truth: "After saving a profile field, the page shows the saved value without a manual reload"
  status: resolved
  resolved_by: 03-09-PLAN.md
  resolved_at: 2026-09-03
  reason: "User reported: it saves but i have to reload to show the newly saved. The write succeeds but the rendered value is stale, so the learner cannot tell the save worked and is likely to resubmit."
  severity: major
  root_cause: \"updateProfileAction does not revalidate the /account route after a successful write, so the rendered server component keeps the pre-save values."
  test: 6
  artifacts:
    - path: "src/app/account/ProfileForm.tsx"
      issue: "no revalidation/optimistic update after a successful updateProfileAction"
    - path: "src/app/account/actions.ts"
      issue: "updateProfileAction returns saved:true without revalidatePath for /account"
  missing: []

- gap_id: G-03-6c
  truth: "A learner who mistypes their current password during an email change is told the password was wrong"
  status: resolved
  resolved_by: 03-09-PLAN.md
  resolved_at: 2026-09-03
  reason: "requestEmailChange collapses a failed step-up into the same GENERIC_ERROR as any other failure ('Something went wrong. Nothing was saved - try again.'). The stated rationale is avoiding a password oracle for a stolen session, but an attacker holding the session can test passwords on the sign-in form anyway, so the protection is weak while the cost to the legitimate owner is a dead end. Observed live during UAT: the user could not tell why the change was refused."
  severity: minor
  root_cause: \"requestEmailChangeAction maps the step-up failure result onto the shared GENERIC_ERROR constant, discarding the distinguishable cause."
  test: 6
  artifacts:
    - path: "src/app/account/actions.ts"
      issue: "requestEmailChangeAction maps EMAIL_CHANGE_STEP_UP_FAILED to GENERIC_ERROR"
  missing: []

- gap_id: G-03-7
  truth: "A signed-in Learner who hits a staff route is sent somewhere that makes sense for a signed-in user"
  status: resolved
  resolved_by: 03-09-PLAN.md
  resolved_at: 2026-09-03
  reason: "src/app/staff/layout.tsx:41 redirects a non-staff actor to /signin. The actor is authenticated, so a sign-in page reads as an unexpected sign-out; the learner re-authenticates, lands on /account, and never learns why. The correct target is LEARNER_LANDING_PATH from src/server/auth/landing.ts, which exists specifically so redirect targets are not hardcoded and allowed to drift (its own header comment says so). Security behaviour is correct - no staff data rendered, no crash - so this is a destination defect, not a guard failure."
  severity: minor
  root_cause: \"The non-staff branch of the staff layout guard hardcodes /signin instead of resolving through landingPathFor/LEARNER_LANDING_PATH."
  test: 7
  artifacts:
    - path: "src/app/staff/layout.tsx"
      issue: "line 41: redirect(\"/signin\") for an authenticated non-staff actor; should be redirect(LEARNER_LANDING_PATH)"
  missing:
    - "Use landingPathFor(actor) (or LEARNER_LANDING_PATH) for the non-staff branch"
