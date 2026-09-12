---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 02
subsystem: auth
tags: [non-enumeration, registration]

requires:
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: "03-01: verificationService (issueToken/consumeToken/resendVerification), registrationService tracer, /register and /verify screens"
provides:
  - Three-branch registerLearner (brand-new / already-pending / already-active) collapsed behind one frozen response value
  - Lost-insert-race (P2002) handling that falls through to the resend branch
  - Server-side validation (name/email/password/consent) before any store call
  - Finished /register screen with hint copy, cross-link and success panel
affects: [03-03-PLAN, 03-04-PLAN]

actuals:
  tokens: 24000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Frozen module-level response objects (REGISTRATION_ACCEPTED, REGISTRATION_INVALID_INPUT) returned by object identity, not structural equality, across every branch — pinned by a same-reference test."
    - "Cost symmetry: the expensive hash runs unconditionally before the branch decision so no branch is measurably cheaper than another."

key-files:
  created: []
  modified:
    - src/server/services/registration-service.ts
    - src/app/(auth)/register/actions.ts
    - src/app/(auth)/register/RegisterForm.tsx
    - tests/registration-service.test.ts

key-decisions:
  - "REGISTRATION_ACCEPTED and REGISTRATION_INVALID_INPUT are frozen module-level constants, asserted by object-identity (toBe, not toEqual) across all four outcomes (new/pending/active/lost-race) in the non-enumeration test block."
  - "The lost-insert-race test bypasses the fake store's transaction-rollback simulation for that one test only (store.$transaction overridden to not roll back) — the winner's commit is a separate, already-completed transaction in reality and must not be undone when our own transaction fails; using the shared rollback-simulating $transaction here would have incorrectly erased the winner's row."
  - "Email input's autoComplete changed from 'username' (plan 01's tracer copy-paste from /signin) to 'email' — registration is not a login form, and Task 2 explicitly named this correction."

patterns-established:
  - "Pattern: any future branch that returns a plausible-but-distinct copy of an enumeration-sensitive response value must fail the object-identity test, not just a deep-equality test — cheap protection against silent re-introduction of a fourth near-identical literal."

requirements-completed: [IAM-01, IAM-06]

coverage:
  - id: D1
    description: "The three account-state branches (brand-new, already-pending, already-active) and the lost-insert-race fallback all return the exact same frozen success value."
    requirement: "IAM-01"
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts#non-enumeration: response indistinguishability and cost symmetry"
        status: pass
    human_judgment: false
  - id: D2
    description: "The password hash runs the same number of times on the brand-new branch as on the already-active branch, closing the timing side channel."
    requirement: "IAM-06"
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts#hashes the password the same number of times"
        status: pass
    human_judgment: false
  - id: D3
    description: "Validation (name, email, password length, both consent flags) runs before any store call."
    requirement: "IAM-01"
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts#validation runs before any store call"
        status: pass
    human_judgment: false
  - id: D4
    description: "Consent is recorded only when affirmatively given — a false consent flag creates zero PolicyAcceptance rows, and no checkbox renders defaulted-on."
    requirement: "IAM-01"
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts#consent integrity"
        status: pass
    human_judgment: false
  - id: D5
    description: "The register screen renders the hint, both consent checkboxes, the cross-link, and validates server-side with the exact copy strings."
    requirement: "IAM-01"
    verification:
      - kind: unit
        ref: "grep assertions in this plan's verify block (container class, MIN_PASSWORD_LENGTH import)"
        status: pass
    human_judgment: true
    rationale: "Visual rendering and the manual three-submission identical-panel check were not run against a live browser this session."

duration: 40min
completed: 2026-09-02
status: complete
---

# Phase 3: Public Identity — Registration, Verification & Secure Sessions Summary (Plan 02)

**Registration completeness: three account-state branches collapsed behind one frozen response, cost-symmetric hashing, and race-safe duplicate handling**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3
- **Files modified:** 4 (1 service, 3 auth screen files)

## Accomplishments
- `registerLearner` now handles all three account states (brand-new, already-pending, already-active) plus a lost-insert-race fallback, all returning the exact same frozen object
- Cost-symmetric hashing closes the timing side channel between the create branch and the no-op branches
- Register screen finished: 10-character password hint bound to the shared constant, both consent checkboxes, "Already have an account? Sign in" cross-link, exact validation copy

## Task Commits

No commits — per the developer's standing instruction for this phase, all code was written directly and verified with tests only.

## Files Created/Modified
- `src/server/services/registration-service.ts` — three-branch `registerLearner`, `REGISTRATION_ACCEPTED`/`REGISTRATION_INVALID_INPUT` frozen constants, `isUniqueConstraintError`, `resendForPending` helper
- `src/app/(auth)/register/actions.ts` — server-side validation guards with exact copy, service-result handling
- `src/app/(auth)/register/RegisterForm.tsx` — `minLength` bound to `MIN_PASSWORD_LENGTH`, `autoComplete="email"` correction
- `tests/registration-service.test.ts` — rewritten with branch-by-branch, non-enumeration, cost-symmetry and consent-integrity coverage (19 tests)

## Final `RegistrationResult` Shape

```ts
export type RegistrationResult = { ok: true } | { ok: false; reason: "INVALID_INPUT" };
export const REGISTRATION_ACCEPTED: RegistrationResult = Object.freeze({ ok: true });
export const REGISTRATION_INVALID_INPUT: RegistrationResult = Object.freeze({ ok: false, reason: "INVALID_INPUT" });
```

Both are exported module-level singletons — every success path (`toBe`, not `toEqual`) returns the exact same `REGISTRATION_ACCEPTED` reference.

## Audit Action Strings

- `user.created` — brand-new branch only, once
- `user.verification_resent` — already-pending branch and the lost-race fallback, once each time either fires
- (Already-active branch writes no account-mutating audit event, per plan.)

## Decisions Made

- Object-identity (not just deep-equality) assertions on the shared response value — a stronger guarantee than the plan's literal wording required, chosen because a future refactor could return a structurally-identical-but-freshly-constructed object and still pass a `toEqual` check while having silently reintroduced per-branch construction.
- The lost-race test needed the fake store's `$transaction` rollback-simulation disabled for that one test (see Decisions in frontmatter) — real Prisma transactions from two different connections don't interact this way, so the fake's generic rollback was the wrong tool for this specific scenario.

## Deviations from Plan

None — plan executed as written, aside from the test-harness adjustment noted above (transaction rollback bypass for the race test), which is a test-authoring detail, not a deviation from the plan's specified behavior.

## Issues Encountered

None.

## User Setup Required

None — no new external service configuration required.

## Next Phase Readiness

Plan 03 (verify-link recovery form) and plan 04 (password reset) both depend on `verificationService.resendVerification`/`issueToken`/`consumeToken`, which are unchanged by this plan. No blockers.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-02*
