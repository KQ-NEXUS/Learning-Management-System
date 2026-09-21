---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 06
subsystem: auth
tags: [routing, session-guard, cross-links]

requires:
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: "03-05: /account exists and renders for a signed-in Learner (redirect target)"
provides:
  - landing.ts — pure post-authentication landing-path resolver
  - signIn/getActorBySessionToken now carry the isStaff presentation hint
  - Branched signInAction redirect (staff -> /staff/courses, Learner -> /account)
  - Sign-in screen cross-links to /forgot-password and /register, plus the reset-success confirmation
  - staff/layout.tsx guard now also rejects an authenticated non-staff actor
affects: []

actuals:
  tokens: 18000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "landingPathFor(user: { isStaff?: boolean | null }): a pure function resolving the post-auth redirect, mirroring lockout.ts's style — the single place Phase 9's eventual real learner-dashboard landing-path change needs to land."
    - "isStaff threaded through as an optional Actor field end to end (signIn's select -> SignInResult -> getActorBySessionToken's select -> Actor), documented at every touch point as a presentation hint, never an authorization input — RBAC-06's authority-from-Assignment-rows invariant is untouched."

key-files:
  created:
    - src/server/auth/landing.ts
    - tests/landing.test.ts
  modified:
    - src/server/services/auth-service.ts
    - src/server/services/session-service.ts
    - src/server/permissions/with-permission.ts
    - src/app/(auth)/signin/actions.ts
    - src/app/(auth)/signin/SignInForm.tsx
    - src/app/(auth)/signin/page.tsx
    - src/app/staff/layout.tsx
    - tests/password-reset-service.test.ts (fake user fixture needed isStaff to match the widened select)

key-decisions:
  - "Actor gained isStaff as an OPTIONAL field specifically so no existing construction of an Actor anywhere in Phase 1/2 code needed to change — verified by a clean npx tsc --noEmit touching only the three files the plan named."
  - "landingPathFor treats isStaff strictly-equal-true as the only staff-routing condition; absent, null, or false all route to /account — the safer default, since misrouting a Learner to a staff route was the actual defect, while misrouting a staff member to their own account page is merely inconvenient."
  - "staff/layout.tsx's staffness check is explicitly framed as defense-in-depth in an extended (not replaced) comment — the root cause is the branched sign-in redirect; this guard only prevents a Learner who reaches the route by any other path from rendering a shell whose children would throw with no error boundary to catch it."

patterns-established:
  - "Pattern: a presentation-only flag threaded through Actor/session resolution must be documented as such at every touch point (select clause, type definition, guard) — not just once at its origin — so a future reader anywhere in the chain sees the same warning against treating it as authorization."

requirements-completed: [IAM-03, IAM-06]

coverage:
  - id: D1
    description: "landingPathFor resolves correctly for isStaff true, false, and absent/null, tested against exported path constants."
    requirement: "IAM-03"
    verification:
      - kind: unit
        ref: "tests/landing.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "signIn and getActorBySessionToken now select and expose isStaff without changing any existing null-returning condition or the non-enumerating failure shape; the pre-existing lockout-reset behavior is unregressed."
    requirement: "IAM-06"
    verification:
      - kind: unit
        ref: "npm test (full 303-test suite, including tests/password-reset-service.test.ts's lockout regression and every permission/scope/boundary test file)"
        status: pass
    human_judgment: false
  - id: D3
    description: "signInAction resolves its redirect through landingPathFor; SignInForm.tsx's existing class strings are provably untouched (diff shows zero removed className lines); the sign-in screen shows the reset-success confirmation only when the query flag is present."
    requirement: "IAM-03, D-14"
    verification:
      - kind: other
        ref: "grep (landingPathFor present, 2 occurrences), git diff (0 removed className lines), npx next build (/signin compiles)"
        status: pass
    human_judgment: false
  - id: D4
    description: "staff/layout.tsx's guard now also redirects an authenticated non-staff actor, with the diff touching only the guard and its comment (1 deleted line, within the plan's 2-line budget)."
    requirement: "IAM-06, D-18"
    verification:
      - kind: other
        ref: "git diff --numstat (1 deleted line), npx next build (/staff/* routes compile)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Manual verification: signing in as staff lands on /staff/courses, signing in as a Learner lands on /account, a signed-in Learner navigating directly to /staff/courses is redirected rather than crashing, and the reset-success confirmation renders correctly after a real reset."
    requirement: "IAM-03, D-15, D-18"
    verification: []
    human_judgment: true
    rationale: "No browser is available in this execution session to drive an actual sign-in flow end to end. All four behaviors are proven at the unit/type/build level (see D1-D4) and by direct reading of the modified control flow, but the plan explicitly asks for a live manual check, which a human should perform during UAT before this phase is considered fully verified."

duration: 30min
completed: 2026-09-02
status: complete
---

# Phase 3: Public Identity — Registration, Verification & Secure Sessions Summary (Plan 06)

**Fixes the last routing defect: a branched, tested landing-path resolver replaces signInAction's hard-coded staff redirect, and the staff layout gains a defense-in-depth staffness guard**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3
- **Files modified:** 2 created, 7 modified

## Accomplishments
- `landingPathFor` is a pure, tested function — no more hard-coded `/staff/courses` redirect that would have stranded every first Learner sign-in
- `isStaff` threaded end to end as an explicitly-documented presentation hint (never an authorization input) through `signIn`, `getActorBySessionToken`, and `Actor` itself, with zero breakage to any existing Phase 1/2 code
- `staff/layout.tsx` now redirects a signed-in Learner instead of letting them render a shell whose children would throw with no error boundary to catch it
- Sign-in screen now connects to `/forgot-password` and `/register`, and shows the reset-success confirmation — closing the loop the other five plans in this phase opened

## Task Commits

No commits — per the developer's standing instruction, all code written and verified directly.

## Files Created/Modified
- `src/server/auth/landing.ts` — `STAFF_LANDING_PATH`, `LEARNER_LANDING_PATH`, `landingPathFor`
- `src/server/services/auth-service.ts` — `isStaff` added to `signIn`'s select and the success arm of `SignInResult`
- `src/server/services/session-service.ts` — `isStaff` added to `getActorBySessionToken`'s select and returned actor
- `src/server/permissions/with-permission.ts` — `Actor` gained an optional `isStaff` field
- `src/app/(auth)/signin/actions.ts` — redirect now resolved through `landingPathFor`
- `src/app/(auth)/signin/SignInForm.tsx` — added "Forgot your password?" and "New here? Create an account" links (no existing lines touched)
- `src/app/(auth)/signin/page.tsx` — reads the `reset=1` query flag, renders the password-updated confirmation
- `src/app/staff/layout.tsx` — guard now also redirects a non-staff authenticated actor
- `tests/landing.test.ts` — 4 tests
- `tests/password-reset-service.test.ts` — fake auth-user fixture updated with `isStaff` to match the widened `signIn` select

## Manual Verification Results

**Not performed live — no browser available in this execution session.** Recorded as coverage item D5 (`human_judgment: true`) rather than silently skipped or fabricated. What IS confirmed, at the unit/type/build level:
- `landingPathFor({isStaff:true})` → `/staff/courses`; `landingPathFor({isStaff:false})`, `landingPathFor({})`, `landingPathFor({isStaff:null})` → `/account` (all asserted in `tests/landing.test.ts`).
- `signInAction`'s only redirect call site is `redirect(landingPathFor(result))` — read directly in the modified source, so the branch is structurally guaranteed to route on the sign-in result's real `isStaff` value.
- `staff/layout.tsx`'s guard now has two sequential `redirect` calls — null actor, then non-staff actor — read directly in the modified source.
- **A human should complete the live check during UAT**: sign in as staff and confirm `/staff/courses` loads; sign in as a Learner and confirm `/account` loads; while signed in as that Learner, navigate directly to `/staff/courses` and confirm a redirect rather than a crash; complete a real password reset and confirm the sign-in screen shows the confirmation.

## Confirmation: No `SignInForm.tsx` Class String Was Modified

`git diff -- 'src/app/(auth)/signin/SignInForm.tsx' | grep -c '^-.*className'` returned `0` — every existing `className` line survived untouched; only two new `<Link>` elements with new class strings were added.

## Decisions Made

- `Actor.isStaff` made optional (not required) specifically to avoid touching any other Phase 1/2 file that constructs an `Actor` literal — confirmed by a clean `tsc --noEmit` limited to the three files the plan named.
- `landingPathFor`'s absent/null/false-all-route-to-Learner default, matching the plan's explicit "safer default" reasoning (misrouting a Learner to staff was the real defect; the reverse is merely inconvenient).

## Deviations from Plan

None — plan executed exactly as written. The one incidental change beyond the plan's named files (`tests/password-reset-service.test.ts`'s fake user fixture gaining `isStaff`) was required to keep that file's `vi.mock`-based fake in sync with `auth-service.ts`'s widened `select`, not a deviation from the plan's intent.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

This was the last plan in Phase 3. All 6 plans are complete: registration, verification, password reset, profile/account, and now the routing fix connecting them all. The phase's success criteria (IAM-01, IAM-02, IAM-03, IAM-05, IAM-06) are implemented and unit-tested; the coverage items marked `human_judgment: true` across all six plans' summaries should be exercised together in a single UAT pass before the phase is marked complete.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-02*
