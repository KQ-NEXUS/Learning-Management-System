---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 08
subsystem: auth
tags: [email, brevo, vitest, gap-closure, enumeration]

# Dependency graph
requires:
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: emailDispatchService.dispatch (03-01), the four services' send call sites (03-01..03-05), tests/support/prisma-contract.ts's guardFindUnique (03-07)
provides:
  - "dispatchBestEffort — the named, opt-in, never-rejecting wrapper around emailDispatchService.dispatch, exported beside it"
  - "All four send call sites (registration, verification, password-reset, profile) survive a rejecting transport without ever changing their return value"
  - "registration-service.ts's user.created audit write now runs immediately after the transaction commits, before token issuance and before the send"
  - "Defence-in-depth try/catch around the three public auth actions (register, forgot-password, verify) so a non-send throw also cannot become an address-dependent error page"
  - "tests/email-dispatch-service.test.ts — first direct test of dispatch's FAILED-row-then-rethrow contract and of dispatchBestEffort itself"
  - "A rejecting-transport option on all four service test harnesses (sharedHarness/harness), defaulted off so no existing test changed"
affects: [Phase 13 (COM-01, exactly-once delivery) — dispatch's throw-and-record contract is unchanged and is what that phase retries against]

# Actuals (#2632)
actuals:
  tokens: 12400
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Throwing primitive + named opt-in best-effort wrapper: a function that must be retryable (dispatch) keeps throwing; every caller that wants to swallow the throw does so through one named, exported wrapper (dispatchBestEffort) rather than a bare try/catch, so every opt-out is visible at its call site and a comment-stripped grep can enforce it never regresses."
    - "Audit-before-side-effect ordering: a write that makes a committed row's existence provable (user.created) is placed immediately after the commit that creates the row, before any step (token issuance, network send) that could fail and leave the commit unaudited."
    - "Defence in depth at the action boundary: server actions that already collapse every service outcome into one designed state extend that same try/catch guarantee to an unexpected throw, so the guarantee holds even for failures the service layer does not itself anticipate."

key-files:
  created:
    - tests/email-dispatch-service.test.ts
  modified:
    - src/server/services/email-dispatch-service.ts
    - src/server/services/registration-service.ts
    - src/server/services/verification-service.ts
    - src/server/services/password-reset-service.ts
    - src/server/services/profile-service.ts
    - src/app/(auth)/register/actions.ts
    - src/app/(auth)/forgot-password/actions.ts
    - src/app/(auth)/verify/actions.ts
    - tests/registration-service.test.ts
    - tests/verification-service.test.ts
    - tests/password-reset-service.test.ts
    - tests/profile-service.test.ts

key-decisions:
  - "Followed the plan's locked design_decision verbatim: dispatch stays throwing (Phase 13 needs a retryable primitive), a new exported dispatchBestEffort is the single sanctioned opt-out, named and imported at all four call sites — not a central swallow inside dispatch, not four bare try/catch blocks."
  - "The wrapper's name is dispatchBestEffort, its result shape is { sent: boolean }, and it lives in email-dispatch-service.ts directly beside dispatch."
  - "The params shape all four services declared inline is now the exported DispatchParams type, referenced by dispatch itself and by all four services' injected dispatch dependency — a structural-only change, no behavior difference."
  - "registration-service.ts's user.created audit write was MOVED (not wrapped) to immediately after the transaction's try/catch, before issueToken and before the send — per the plan, this is a separate fix from the throw-survival fix, addressing the repudiation gap (T-03-52) independently."
  - "password-reset-service.ts's cost-symmetry comment above requestReset's issueToken call gained a sentence naming the outage-time enumeration oracle explicitly, per the plan's action text."

requirements-completed: [IAM-01, IAM-02, IAM-03, IAM-05, IAM-06]

coverage:
  - id: D1
    description: "A provider send failure on any of the four send paths (registration, verification resend, password reset request, email-change request) never reaches a framework error page — the caller returns its normal safe value instead of rejecting"
    requirement: IAM-06
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts#registerLearner — rejecting transport (G-03-3 regression) > returns the frozen accepted value, does not reject, and still writes exactly one user.created audit row"
        status: pass
      - kind: unit
        ref: "tests/verification-service.test.ts#resendVerification — rejecting transport (G-03-3 regression) > returns its single ok value and does not reject when the send rejects"
        status: pass
      - kind: unit
        ref: "tests/profile-service.test.ts#requestEmailChange — rejecting transport (G-03-3 regression) > returns the frozen accepted value and does not reject when the send rejects"
        status: pass
      - kind: unit
        ref: "tests/email-dispatch-service.test.ts#dispatchBestEffort (4 tests, including one driving the real dispatch, not a re-implementation)"
        status: pass
    human_judgment: false
  - id: D2
    description: "requestReset returns the byte-identical frozen value for an existing ACTIVE account whose send rejects and for an address that has no account at all — the outage-time enumeration oracle observed live during UAT (test 31) is closed"
    requirement: IAM-06
    verification:
      - kind: unit
        ref: "tests/password-reset-service.test.ts#requestReset — outage-time indistinguishability (G-03-3 regression) > returns the identical frozen value, by object identity and deep equality, for an existing ACTIVE account and an unknown address when dispatch rejects"
        status: pass
    human_judgment: false
  - id: D3
    description: "A registration whose verification email fails to send still leaves a committed User row with its user.created audit row beside it — no account exists unaudited"
    requirement: IAM-01
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts#registerLearner — rejecting transport (G-03-3 regression) > returns the frozen accepted value, does not reject, and still writes exactly one user.created audit row"
        status: pass
    human_judgment: false
  - id: D4
    description: "emailDispatchService.dispatch is unchanged: it still writes the FAILED row and still rethrows the original error object, now directly tested for the first time"
    verification:
      - kind: unit
        ref: "tests/email-dispatch-service.test.ts#dispatch — failure (the FAILED-row-then-rethrow contract) (3 tests)"
        status: pass
      - kind: unit
        ref: "tests/email-dispatch-service.test.ts#dispatch — success (1 test)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The three public auth actions (register, forgot-password, verify) return their single designed state even if something below them throws — defence in depth beyond the service-level fix"
    requirement: IAM-06
    verification:
      - kind: unit
        ref: "npm run build (compiles all three routes clean); comment-stripped grep gate confirms all three action files carry a catch"
        status: pass
    human_judgment: true
    rationale: "No unit test drives a real server action's throw path end to end (server actions are not directly unit-testable in this suite) — the try/catch shape was verified by direct code inspection, tsc/eslint, and a clean production build, but the actual browser-observable behavior on a genuine throw is a human-check item."
  - id: D6
    description: "Live re-test of UAT test 31 with a deliberately invalid BREVO_API_KEY: forgot-password and register must show their normal safe panels, not a stack trace, for both a real ACTIVE account and an unknown address"
    verification: []
    human_judgment: true
    rationale: "Task 1's <human-check> requires a live browser session against a real (deliberately broken) Brevo credential and a running dev server — outside what this executor session can safely perform without touching the project's real BREVO_API_KEY. Not run this session; flagged for the human UAT pass."

duration: 55min
completed: 2026-09-03
status: complete
---

# Phase 3 Plan 08: Close G-03-3 — provider send failures no longer crash or enumerate Summary

**A named `dispatchBestEffort` wrapper (beside the still-throwing `dispatch` primitive) now guards all four email send call sites, `registerLearner`'s `user.created` audit write moved to immediately after the transaction commits, and three public auth actions gained defence-in-depth catches — closing the live account-enumeration oracle UAT found in `requestReset` during a simulated Brevo outage.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 completed
- **Files modified:** 12 (4 services, 3 actions, 4 test files, 1 email-dispatch-service, minus overlap — see Files list)
- **Files created:** 1 (`tests/email-dispatch-service.test.ts`)

## Accomplishments

- Closed the blocker: a Brevo send failure on any of the four send paths (registration, resend-verification, forgot-password, email-change) no longer throws to the Next.js error overlay — each caller now routes its send through `dispatchBestEffort` and discards the result, so no caller-visible value ever depends on whether the send succeeded.
- Closed the enumeration oracle specifically: `requestReset` for an existing ACTIVE account and for an unknown address now return the byte-identical frozen `PASSWORD_RESET_ACCEPTED` object (same identity, same deep value) even when the transport rejects — pinned by a regression test driven by a genuinely rejecting fake transport, not merely inspecting the returned value.
- Closed the repudiation gap: `registerLearner`'s `user.created` audit write moved (not wrapped) to immediately after the transaction's try/catch completes, before token issuance and before the send — a committed User row now always has its audit row, regardless of what happens to the email afterward.
- Added a second layer of defence at the three public auth actions (`registerAction`, `forgotPasswordAction`, `resendVerificationAction`): each now wraps its service call in try/catch and returns its existing designed state on any throw, extending the single-state (or generic-error) guarantee to failures the service layer itself does not anticipate.
- Wrote `tests/email-dispatch-service.test.ts`, the first direct test of `dispatch`'s FAILED-row-then-rethrow contract (queued-then-failed, original error rethrown by identity, no raw error or token-shaped value stored) and of `dispatchBestEffort`'s both-arms-resolve behavior — including one test driving the wrapper against the real `dispatch` implementation, not a re-implementation of it.
- Gave all four service test harnesses (`registration-service.test.ts`, `verification-service.test.ts`, `password-reset-service.test.ts`, `profile-service.test.ts`) an opt-in `rejectDispatch` flag, defaulted off, and added one regression test per service pinning survival of a rejecting transport.
- Wired plan 07's schema-derived `guardFindUnique` contract into the three additional fake `user.findUnique` implementations this plan's `<read_first>` and Task 3 targeted (registration, verification, password-reset harnesses) — none of the three turned red (see Negative Control / Guard Wiring Result below).
- **Negative control run and confirmed** (required by `<verification>`, see below): reverting only the `requestReset` call site to a direct `await dispatch(...)` made the new outage-time indistinguishability test fail loudly with the simulated transport's rejection, proving the regression test is real and not vacuously green.

## Negative Control Result (required by `<verification>`)

Performed by hand as instructed, before finalizing:

1. Reverted only `src/server/services/password-reset-service.ts`'s `requestReset` send call from `await dispatchBestEffort(dispatch, {...})` back to the original `await dispatch({...})`.
2. Ran `npx vitest run tests/password-reset-service.test.ts`.
3. **Result: went red as expected** — 1 of 10 tests failed: `requestReset — outage-time indistinguishability (G-03-3 regression) > returns the identical frozen value, by object identity and deep equality, for an existing ACTIVE account and an unknown address when dispatch rejects`. The failure was an unhandled rejection propagating from `requestReset` itself (`SimulatedProviderOutage: simulated provider outage`, thrown from the harness's fake `dispatch`, uncaught inside `password-reset-service.ts:106`) — not a plain assertion mismatch, confirming the test genuinely exercises the throw path rather than passing regardless.
4. Restored the `dispatchBestEffort` call. Re-ran `npm test`, `npx tsc --noEmit`, `npx eslint src tests prisma`, and `npm run build`: all clean, **325/325 tests passing**.

## Guard-Wiring Result (required by `<output>`)

Task 3 wired plan 07's `guardFindUnique("User", ...)` into three additional fake `user.findUnique` implementations that did not have it before this plan: `tests/registration-service.test.ts`, `tests/verification-service.test.ts`, and `tests/password-reset-service.test.ts` (the fourth, `tests/profile-service.test.ts`, already carried the guard from plan 07). **None of the three turned any existing test red.** All three harnesses' `findUnique` calls already selected on `id` or `email`, both legal `@id`/`@unique` selectors for `User` per `prisma/schema.prisma` — so this was, as the plan anticipated, a pure addition with no test changes required. This is a second confirmation (alongside plan 07's own finding) that the bug class the guard exists to catch (`findUnique` on a non-unique column) was isolated to the one `profile-service.ts` call site plan 07 fixed, not a wider pattern across these three services.

## Exact Wrapper Name (required by `<output>`)

`dispatchBestEffort`, exported from `src/server/services/email-dispatch-service.ts` beside `dispatch`. Signature: `dispatchBestEffort(dispatchFn: (params: DispatchParams) => Promise<unknown>, params: DispatchParams): Promise<{ sent: boolean }>` — never rejects; resolves `{ sent: true }` when the wrapped call resolves, `{ sent: false }` when it rejects. `DispatchParams` is the params shape all four services previously declared inline, now exported once and referenced by `dispatch` itself and by all four services' injected `dispatch` dependency type.

## Files Created/Modified

- `src/server/services/email-dispatch-service.ts` — exported `DispatchParams` (the params shape `dispatch` and all four services share); added `dispatchBestEffort`, the named opt-in wrapper; `dispatch` itself is behaviorally byte-identical (only its inline param type was replaced with the named `DispatchParams`).
- `src/server/services/registration-service.ts` — `dispatch` dependency retyped to `DispatchParams`; the send now routes through `dispatchBestEffort`; `user.created` audit write moved to immediately after the transaction commits, before `issueToken` and before the send.
- `src/server/services/verification-service.ts` — `dispatch` dependency retyped to `DispatchParams`; `resendVerification`'s send routed through `dispatchBestEffort`.
- `src/server/services/password-reset-service.ts` — `dispatch` dependency retyped to `DispatchParams`; `requestReset`'s send routed through `dispatchBestEffort`; cost-symmetry comment extended with the outage-enumeration sentence the plan specified.
- `src/server/services/profile-service.ts` — `dispatch` dependency retyped to `DispatchParams`; `requestEmailChange`'s send routed through `dispatchBestEffort`.
- `src/app/(auth)/register/actions.ts` — `registerAction`'s service call wrapped in try/catch, returning the file's existing generic-error state (unchanged message string) on any throw.
- `src/app/(auth)/forgot-password/actions.ts` — `forgotPasswordAction`'s service call wrapped in try/catch, returning the same single success state on any throw, extending the file's existing single-state comment.
- `src/app/(auth)/verify/actions.ts` — `resendVerificationAction`'s service call wrapped in try/catch, returning the same single success state on any throw, extending the file's existing single-state comment.
- `tests/email-dispatch-service.test.ts` (new) — 7 tests: `dispatch` success (QUEUED→SENT); `dispatch` failure contract (FAILED row + failed-at stamp + described error + rethrow of the original error object; no raw error or token-shaped value stored; QUEUED row survives a failed send); `dispatchBestEffort` both arms, including one test against the real `dispatch`.
- `tests/registration-service.test.ts` — `sharedHarness` gained `rejectDispatch` option (both dispatch fakes honor it); fake `user.findUnique` wrapped with `guardFindUnique`; new regression test for a rejecting transport (frozen accepted value, no rejection, exactly one `user.created` audit row).
- `tests/verification-service.test.ts` — `harness` gained `rejectDispatch` option; fake `user.findUnique` wrapped with `guardFindUnique`; new regression test for `resendVerification` under a rejecting transport.
- `tests/password-reset-service.test.ts` — `sharedHarness` gained `rejectDispatch` option (both dispatch fakes honor it); fake `user.findUnique` wrapped with `guardFindUnique`; new outage-time indistinguishability regression test (the one the negative control targets).
- `tests/profile-service.test.ts` — `sharedHarness` gained `rejectDispatch` option (both dispatch fakes honor it); `user.findUnique` already guarded by plan 07; new regression test for `requestEmailChange` under a rejecting transport.

## Decisions Made

- Followed the plan's locked `design_decision` verbatim: kept `dispatch` throwing, added `dispatchBestEffort` as the single named opt-in wrapper beside it, rather than a central swallow inside `dispatch` or four bare try/catch blocks. Rationale recorded in the wrapper's own doc comment: Phase 13's exactly-once delivery work needs a retryable primitive, and a swallow invisible at the call site is easy to get right once and wrong the first time a fifth caller is added.
- The `user.created` audit write was moved, not wrapped — per the plan, this is a distinct fix (T-03-52, repudiation) from the throw-survival fix (T-03-50/T-03-51), addressed by reordering rather than a try/catch around the existing position.
- All four services' `dispatch` dependency type was retyped from an inline object literal to the newly exported `DispatchParams` — a structural-only change (TypeScript structural typing means this cannot itself change runtime behavior), done because the plan explicitly calls for exporting "the params shape the four services all declare inline today as a single named type."
- Each of the four rejecting-transport regression tests uses a dedicated `SimulatedProviderOutage` error subclass (one per test file, matching that file's existing style) rather than a shared plain `Error`, so a failing assertion's stack trace is unambiguous about which fake threw it.

## Deviations from Plan

None — plan executed exactly as written. The `<human-check>` item in Task 1's `<verify>` block (a live browser re-test of UAT test 31 with a deliberately invalid `BREVO_API_KEY`) was not run this session; it requires a running dev server and touching the project's real Brevo credential, which this executor session does not perform. This is not a deviation from the plan's structure — the plan itself distinguishes `<automated>` checks (all run and passing) from the one `<human-check>` — but it is an open item, flagged below and in the coverage block (D6) for the human UAT pass this plan's `<output>` section anticipates being harvested into `03-UAT.md`.

## Issues Encountered

None beyond the human-check deferral noted above. All `<automated>` verify commands across all three tasks ran and passed on the first attempt; no auto-fix, blocker, or architectural deviation was needed.

## Suggested commits

Per the standing no-commit override, nothing was committed. Working tree state reflects all changes described above. Suggested commit messages, in task order:

1. `fix(03-08): guard all four email dispatch call sites with a best-effort wrapper and fix registration audit ordering`
   - `src/server/services/email-dispatch-service.ts`
   - `src/server/services/registration-service.ts`
   - `src/server/services/verification-service.ts`
   - `src/server/services/password-reset-service.ts`
   - `src/server/services/profile-service.ts`
   - Closes the core of G-03-3: a provider send failure on any of the four send paths no longer escapes to a framework error page, and `requestReset`'s active-account-only send is no longer an enumeration oracle during a provider outage. `registerLearner`'s `user.created` audit write moves to immediately after the transaction commits.

2. `fix(03-08): catch around the three public auth actions' service calls`
   - `src/app/(auth)/register/actions.ts`
   - `src/app/(auth)/forgot-password/actions.ts`
   - `src/app/(auth)/verify/actions.ts`
   - Second layer of defence: these three actions now return their designed single/generic-error state on any throw from below, not only on a send failure.

3. `test(03-08): pin G-03-3 with a rejecting-transport regression per service and a direct test of the dispatch primitive`
   - `tests/email-dispatch-service.test.ts`
   - `tests/registration-service.test.ts`
   - `tests/verification-service.test.ts`
   - `tests/password-reset-service.test.ts`
   - `tests/profile-service.test.ts`
   - Adds the first direct test of `emailDispatchService.dispatch`'s FAILED-row-then-rethrow contract and of `dispatchBestEffort`; gives all four service harnesses an opt-in rejecting-transport flag; adds the outage-time indistinguishability regression (confirmed via negative control to genuinely pin the fix) plus three parallel regressions for registration, resend-verification, and email-change; wires plan 07's `guardFindUnique` schema contract into three more fake `findUnique` implementations.

## Next Phase Readiness

- G-03-3 is closed for every `<automated>` check in the plan: `npm test` (325/325), `npx tsc --noEmit`, `npx eslint src tests prisma`, and `npm run build` are all clean; the comment-stripped grep gate confirms zero direct `await dispatch(` calls remain in the four services and all four reference `dispatchBestEffort`; the negative control confirms the key regression test is real.
- The one open item is Task 1's `<human-check>`: a live browser re-test of UAT test 31 with a deliberately invalid `BREVO_API_KEY`, restoring the real key afterward. This should be run and its result harvested into `03-UAT.md` before this gap is marked fully closed at the UAT level, per the plan's own `<output>` instructions.
- `dispatchBestEffort` and `DispatchParams` are now available to any future call site (or future service) that needs to send an email without letting a provider outage propagate — the pattern established here (throwing primitive + named opt-in wrapper) is the one to reuse rather than reinventing a local try/catch.
- 03-UAT.md's remaining gaps beyond G-03-3 (if any, e.g. G-03-6b) are unaffected by this plan and remain open for their own gap-closure plans.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-03*

## Self-Check: PASSED

All files confirmed present on disk: `src/server/services/email-dispatch-service.ts`, `src/server/services/registration-service.ts`, `src/server/services/verification-service.ts`, `src/server/services/password-reset-service.ts`, `src/server/services/profile-service.ts`, `src/app/(auth)/register/actions.ts`, `src/app/(auth)/forgot-password/actions.ts`, `src/app/(auth)/verify/actions.ts`, `tests/email-dispatch-service.test.ts`, `tests/registration-service.test.ts`, `tests/verification-service.test.ts`, `tests/password-reset-service.test.ts`, `tests/profile-service.test.ts`, this SUMMARY.md. No commits were made BY THIS EXECUTION (per the standing no-commit override) — `git status --short` confirms every file this plan touched is still `M` (modified, uncommitted) or `??` (untracked, for the new test file). **Note:** during this session HEAD advanced by one commit (`bdb7675`, "Add comprehensive tests for registration and verification services") authored by the project owner directly, not by this executor — it appears to be the user committing prior (pre-plan-07/08) uncommitted work independently while this plan ran. All of this plan's own changes sit on top of that commit, still uncommitted, exactly as the no-commit override requires. Final `npm test` (325/325 passing), `npx tsc --noEmit`, `npx eslint src tests prisma`, and `npm run build` all re-confirmed clean after the negative control's revert-and-restore cycle.
