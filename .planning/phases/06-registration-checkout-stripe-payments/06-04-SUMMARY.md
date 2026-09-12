---
phase: 06-registration-checkout-stripe-payments
plan: 04
subsystem: identity-checkout
tags: [checkout-intent, cookie, open-redirect, redirect-security, nextjs, server-actions, REG-02]

requires:
  - phase: "06-03"
    provides: "startCheckout and its typed refusals (CapacityExceededError, CohortClosedError, CohortNotFoundError, AlreadyEnrolledError), enrollAction, the (checkout) route-group layout guard, /checkout/[orderId]"
provides:
  - "CHECKOUT_INTENT_COOKIE / CHECKOUT_INTENT_MAX_AGE_SECONDS / checkoutReturnPathFor (src/server/auth/landing.ts) — the D-14 post-auth redirect resolver, constructed never echoed"
  - "enrollAction's anonymous branch sets the intent cookie before redirecting to /signin"
  - "signInAction consumes-and-clears the intent cookie and redirects via checkoutReturnPathFor"
  - "src/app/(checkout)/enrol/[cohortId]/page.tsx — the resumption route that actually takes the seat and creates the Order"
  - "getCohortOfferPath (checkout-service.ts) — cohort -> course-slug lookup for the refusal redirects"
affects: [06-07, 06-08, 06-09]

actuals:
  tokens: 9355
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Construct-never-echo redirect resolver: checkoutReturnPathFor builds its output from a module-owned template and a validated bare id, never from a caller-supplied string — the same shape as landingPathFor before it, now folding the D-14 detour into the same single decision point"
    - "httpOnly, sameSite=lax, secure-in-prod, single-use intent cookie spanning a multi-request identity detour (register -> email -> verify -> sign in), read-then-delete-unconditionally on the consuming response"
    - "Dynamic-import-after-DATABASE_URL integration harness (checkout-webhook.integration.test.ts's own pattern), extended here to also cover Server Actions and a Server Component page — next/headers and next/navigation mocked with a fake jar + throwing redirect()/notFound()"

key-files:
  created:
    - "src/app/(checkout)/enrol/[cohortId]/page.tsx"
    - "tests/checkout-intent.test.ts"
    - "tests/checkout-intent.integration.test.ts"
  modified:
    - "src/server/auth/landing.ts"
    - "src/app/(checkout)/actions.ts"
    - "src/app/(auth)/signin/actions.ts"
    - "src/server/services/checkout-service.ts"
    - "tests/landing.test.ts"

key-decisions:
  - "checkoutReturnPathFor validates the intent against a conservative letters-and-digits allowlist (matching a Prisma cuid's actual shape) and falls back to landingPathFor on anything else, rather than attempting to sanitise a hostile value — the destination is always constructed, never echoed, which is what makes an open redirect (T-06-20) structurally impossible on this path rather than merely validated against."
  - "getCohortOfferPath added to checkout-service.ts (Rule 2 auto-fix) — the resumption route's CapacityExceededError/CohortClosedError branches need to redirect to the cohort's own public course page, which the plan's action text asked for by name (\"the cohort's public offer page\") but never named as a concrete deliverable of an earlier plan. Falls back to the catalogue index (/courses) when no course slug can be resolved (a programme-linked cohort, or a cohort whose course is no longer publicly listed)."
  - "24-hour margin on top of HOLD_MINUTES_DEFAULT (30min) for CHECKOUT_INTENT_MAX_AGE_SECONDS — the verification email may be opened hours later from a different tab; a stale intent costs nothing beyond one wasted redirect back to the cohort's public page, since startCheckout re-derives the seat hold fresh at resumption."

patterns-established:
  - "A post-auth redirect resolver that takes a bare, allowlist-validated record id and interpolates it into a module-owned template — never a path, never a URL, never echoed from caller input — is the shape any future auth-boundary redirect in this codebase should copy."

requirements-completed: [REG-02]

coverage:
  - id: D1
    description: "checkoutReturnPathFor + CHECKOUT_INTENT_COOKIE/CHECKOUT_INTENT_MAX_AGE_SECONDS (src/server/auth/landing.ts) — constructs /enrol/{id} from a validated cuid, staff always routes to STAFF_LANDING_PATH regardless of intent, hostile inputs fall back to landingPathFor, landingPathFor itself byte-identical to its pre-task form"
    requirement: "REG-02"
    verification:
      - kind: unit
        ref: "tests/landing.test.ts — 20/20 passing, including 5+ hostile-input rejection cases (//, scheme separator, encoded slash, newline, overlong) and the single-leading-slash/no-// invariant"
        status: pass
      - kind: other
        ref: "grep gates: landingPathFor export count 1, body byte-identical (confirmed via diff review, not touched by the edit)"
        status: pass
    human_judgment: false
  - id: D2
    description: "enrollAction's anonymous branch sets the intent cookie (httpOnly/sameSite=lax/secure-in-prod/path=/, CHECKOUT_INTENT_MAX_AGE_SECONDS) before redirecting to /signin; signInAction reads-then-unconditionally-deletes the cookie and redirects via checkoutReturnPathFor instead of landingPathFor directly; failed sign-in leaves the cookie untouched; registerAction/resendVerificationAction untouched"
    requirement: "REG-02"
    verification:
      - kind: unit
        ref: "tests/checkout-intent.test.ts — 9/9 passing, driving both actions with a fake cookie jar and a throwing redirect() mock"
        status: pass
      - kind: other
        ref: "grep gates: CHECKOUT_INTENT_COOKIE count>=2 on signin/actions.ts (3, read+delete+import), httpOnly:true count 1 on checkout/actions.ts, zero returnTo/redirect_uri/next= on either file, empty git diff on register/actions.ts and verify/actions.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "src/app/(checkout)/enrol/[cohortId]/page.tsx — the resumption route: resolves the actor, calls startCheckout, redirects to /checkout/{orderId}; CohortNotFoundError -> notFound(); CapacityExceededError/CohortClosedError -> the cohort's public offer page via the new getCohortOfferPath. force-dynamic, top-level await before any streaming boundary. No rendered <Link> anywhere targets /enrol/"
    requirement: "REG-02"
    verification:
      - kind: unit
        ref: "npx next build clean; grep gates (force-dynamic count 1, zero href-carrying /enrol/ references across src/)"
        status: pass
      - kind: integration
        ref: "tests/checkout-intent.integration.test.ts — 4 cases written (full round trip with a second-sign-in single-use assertion, no-intent unchanged, filled-cohort redirect with zero Orders created, non-existent cohort id -> 404) driving the real Server Actions and the real page function against Testcontainers Postgres"
        status: unknown
    human_judgment: true
    rationale: "Docker is unavailable in this execution sandbox (same environment gate 06-01/06-02/06-03 documented) — the integration suite reports BLOCKED at startTestDatabase()'s container-start step, not a test failure. tsc and next build are both clean; the test file's own logic could not be exercised end to end here. A human or CI environment with Docker must run tests/checkout-intent.integration.test.ts before REG-02's real-Postgres proof is complete."
  - id: D4
    description: "The full browser walkthrough — Enroll while signed out, register, open a real verification email in a new tab, sign in, land on the order summary for the originally-selected cohort at its original price, sign out and back in and land on /account"
    verification: []
    human_judgment: true
    rationale: "Requires a human to click through the flow in a real browser with a real emailed verification link — no automated test opens an actual email. See Human Verification Needed below."

duration: ~105min
completed: 2026-09-10
status: complete
---

# Phase 6 Plan 4: The Checkout-Intent Detour Summary

**A cohort selected while signed out now survives the entire register -> verify-email -> sign-in round trip via a single-use, httpOnly cookie that stores nothing but a bare cohort id, so the post-auth redirect the cookie feeds can never become an open redirect no matter what the cookie's value is set to.**

## Performance
- **Duration:** ~105min (includes reading 06-RESEARCH.md/06-CONTEXT.md/06-PATTERNS.md and every read_first source file in full before writing code)
- **Started:** ~2026-09-10T05:20:00Z (approx.)
- **Completed:** ~2026-09-10T07:05:00Z (approx.)
- **Tasks:** 3 (all `tdd="true"`, all auto)
- **Files touched:** 8 (3 created, 5 modified)

## Accomplishments
- **Task 1:** `CHECKOUT_INTENT_COOKIE`, `CHECKOUT_INTENT_MAX_AGE_SECONDS` (derived from `HOLD_MINUTES_DEFAULT` + a 24h margin), and `checkoutReturnPathFor` added to `src/server/auth/landing.ts`, additively — `landingPathFor`/`STAFF_LANDING_PATH`/`LEARNER_LANDING_PATH` left exactly as they were. `checkoutReturnPathFor` validates its `cohortIntent` argument against a conservative letters-and-digits allowlist and constructs `/enrol/{id}` from a module-owned template; any hostile input (protocol-relative `//`, a scheme separator, an encoded slash, a newline, an overlong value, or any of slash/colon/backslash/dot/percent/whitespace) falls back to `landingPathFor`. 20 unit tests, all passing.
- **Task 2:** `enrollAction`'s anonymous branch now sets the intent cookie (same flag set `signInAction`'s session cookie already used) before redirecting to `/signin`; the authenticated branch is untouched. `signInAction` reads the intent cookie, deletes it unconditionally, and redirects via `checkoutReturnPathFor` — the single decision point, `landingPathFor` no longer called directly from this file. A failed sign-in leaves the cookie untouched so a mistyped password doesn't cost the visitor their selection. 9 new unit tests against a fake cookie jar, all passing.
- **Task 3:** `src/app/(checkout)/enrol/[cohortId]/page.tsx` — the one page an intent-cookie redirect ever targets, and the one page in the app whose GET has a side effect (it takes the seat hold and creates the Order, exactly like `enrollAction`). The file header documents the three properties that make this safe: unreachable except via a server-issued `redirect()`, no rendered `<Link>` may ever target it (grep-gated), and plan 06-03's supersede rule bounds a repeat visit to net seat delta zero. `CohortNotFoundError` -> `notFound()`; `CapacityExceededError`/`CohortClosedError` -> the cohort's own public course page via the new `getCohortOfferPath` lookup (Rule 2 auto-fix), falling back to `/courses` when no slug can be resolved. `tests/checkout-intent.integration.test.ts` walks the genuine round trip against real Postgres — Enroll signed-out, register, consume the verification token via `verificationService.verifyEmail` directly, sign in, follow the resumption route, assert the created Order's `cohortId`/`amountMinor`/`currency` match the originally selected cohort — plus three negative cases (no intent, a cohort that filled up in the meantime, a non-existent cohort id).

## Human Verification Needed

From task 3's `<human-check>`, run with the dev server running, signed out and cookies cleared:

1. Open a course detail page with an open cohort and click "Enroll now". Confirm you land on the sign-in screen.
2. Register a brand-new account from there. Confirm you get the "check your email" state.
3. Open the verification link from the email in a NEW browser tab, then follow "Continue to sign in".
4. Sign in. Confirm you land on the order-summary page for the cohort you originally clicked — same course, same date range, same price — and not on /account.
5. Sign out and sign back in. Confirm you land on /account this time, not back in checkout.

## Task Commits
1. **Task 1 (TDD): The intent cookie contract and the return-path resolver**
   - `27f98b2` — feat: checkout-intent cookie constants and checkoutReturnPathFor
   - `9d125e5` — test: checkoutReturnPathFor hostile-input and behavior coverage
2. **Task 2 (TDD): Set the intent on an anonymous Enroll, consume it on sign-in**
   - `6a017fd` — feat: set checkout-intent cookie on anonymous Enroll, consume on sign-in
   - `194ce18` — test: cookie flags and consume-and-clear ordering for checkout intent
3. **Task 3 (TDD): The resumption route and a real register-verify-signin round trip**
   - `f69bb60` — feat: the /enrol/[cohortId] post-auth resumption route
   - `c7c94a3` — test: real-Postgres register -> verify -> sign-in -> order round trip

**Plan metadata:** committed alongside this SUMMARY (see final commit hash in the repo log — `docs(06-04): complete ... plan`).

## Files Created/Modified
- `src/server/auth/landing.ts` — `CHECKOUT_INTENT_COOKIE`, `CHECKOUT_INTENT_MAX_AGE_SECONDS`, `checkoutReturnPathFor`
- `src/app/(checkout)/actions.ts` — `enrollAction`'s anonymous branch sets the intent cookie
- `src/app/(auth)/signin/actions.ts` — consumes-and-clears the intent cookie, redirects via `checkoutReturnPathFor`
- `src/server/services/checkout-service.ts` — `getCohortOfferPath` (Rule 2 auto-fix)
- `src/app/(checkout)/enrol/[cohortId]/page.tsx` — the resumption route
- `tests/landing.test.ts` — `checkoutReturnPathFor` unit coverage
- `tests/checkout-intent.test.ts` — action-level cookie-flag/consume-and-clear unit coverage
- `tests/checkout-intent.integration.test.ts` — real-Postgres round trip

## Decisions Made
- **`checkoutReturnPathFor` constructs, never echoes** (T-06-20) — a bare cohort id is validated against a conservative letters-and-digits allowlist and interpolated into a module-owned `/enrol/{id}` template; anything that fails the check falls back to `landingPathFor`, never a sanitised version of the hostile input. This is what makes the post-auth redirect structurally incapable of becoming an open redirect, not merely validated against known bad patterns.
- **`getCohortOfferPath` added to `checkout-service.ts`** (Rule 2 auto-fix) — the resumption route's typed-refusal branches need to redirect to "the cohort's public offer page" per the plan's own action text, but no earlier plan named this lookup as a deliverable. Falls back to `/courses` when the cohort has no resolvable course slug (a programme-linked cohort, or an unlisted course).
- **24-hour margin on `CHECKOUT_INTENT_MAX_AGE_SECONDS`** — stated inline rather than left as a bare number: `HOLD_MINUTES_DEFAULT` (30min) plus 24h, generous enough to survive an email opened the next day, costing nothing beyond one wasted redirect since the seat hold itself is re-derived fresh at resumption.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `getCohortOfferPath`**
- **Found during:** Task 3, while writing the resumption route's typed-refusal translation.
- **Issue:** The plan's action text says `CapacityExceededError`/`CohortClosedError` must redirect to "the cohort's public offer page," but no prior plan (06-03 included) exposed a cohort -> course-slug lookup, and `enrollAction`'s existing translation just redirects everything to the generic `/courses` index.
- **Fix:** Added `getCohortOfferPath(cohortId)` to `checkout-service.ts` — a standalone, non-transactional lookup returning `/courses/{slug}` when the cohort's course can be resolved, `/courses` otherwise. Wired into the new page only; `enrollAction`'s own translation (06-03's, unchanged by this plan) is untouched.
- **Files modified:** `src/server/services/checkout-service.ts`
- **Verification:** Covered indirectly by the integration test's "filled cohort" negative case (`resumeTarget.startsWith("/courses/")`).
- **Commit:** `f69bb60`

### Noted, Not Fixed — Acceptance-Criteria Grep-Count Mismatch

**2. `grep -c 'checkoutReturnPathFor'` on `signin/actions.ts` and `grep -c 'startCheckout'` on the new page both return 2, not the plan's literal "returns 1"**
- **Found during:** Task 2's and Task 3's acceptance-criteria verification loops.
- **Issue:** Both counts are the unavoidable sum of one `import` line plus one call-site line — the exact same idiom the pre-existing file already used for `landingPathFor` (`import { landingPathFor } ...` then `redirect(landingPathFor(result))`), which itself greps to 2 in the original, unmodified file (confirmed via `git show`). The plan's own `<interfaces>` block specifies this exact pattern as the one to follow for the new symbol.
- **Fix attempted:** Considered an aliased import (`import { checkoutReturnPathFor as x }`) purely to make the literal grep count hit 1, but rejected it — it would obscure the call site's readability to satisfy a grep count that the plan's own template pattern cannot satisfy either, and after 2 fix-attempt-limit considerations (per this workflow's own rule) the natural, established-idiom code was kept.
- **Files affected:** `src/app/(auth)/signin/actions.ts`, `src/app/(checkout)/enrol/[cohortId]/page.tsx`
- **Verification:** The semantic invariant the count was checking for — `checkoutReturnPathFor`/`startCheckout` is the single call-site decision point, not duplicated logic — holds; confirmed by direct code review and the passing test suites.
- **Commits:** `6a017fd`, `f69bb60`

**Total deviations:** 1 auto-fixed (Rule 2), 1 noted-not-fixed (acceptance-criteria wording vs. established codebase idiom, no functional impact). **Impact:** Neither affects REG-02's correctness or the T-06-20 open-redirect mitigation; both are documented rather than silently glossed over.

## Issues Encountered

- **Docker unavailable in this execution sandbox** (same environment gate 06-01/06-02/06-03 documented) — `tests/checkout-intent.integration.test.ts`'s 4 cases all report BLOCKED with a container-start error at `startTestDatabase()`, before the file's own dynamic-import/module-binding logic ever runs. `npx tsc --noEmit` and `npx next build` are both clean; the 3 unit test files (`tests/landing.test.ts`, `tests/checkout-intent.test.ts`) pass 29/29 combined. A human or CI environment with Docker must run this file before REG-02's real-Postgres proof is complete.
- **`npm test` (full suite) — 14 test files fail, 2 individual tests fail, all pre-existing/environment-caused and unrelated to this plan's changes:** 12 files (including this plan's own new integration test) fail with the identical "Could not find a working container runtime strategy" (no Docker daemon), matching 06-01/06-02/06-03's own documented finding exactly. `tests/docker-email-config.test.ts` (2 tests) fails on the pre-existing blank-`AUTH_SECRET` `.env.example` gap noted in `.planning/STATE.md`'s Blockers/Concerns before this plan started. 1383 tests pass, including all of this plan's own unit coverage (29/29) and every pre-existing test this plan's changes touch (`tests/landing.test.ts`'s original 4 cases, the staff-layout-guard regression cases).

## Known Stubs

None. This plan's deliverables are complete and wired end to end; only their real-Postgres and browser proof remain outstanding (documented above, not silently dropped).

## User Setup Required

None. No new package installed, no new environment variable introduced by this plan.

## Next Phase Readiness

Wave 3 siblings 06-05 and 06-06 do not depend on this plan and are not blocked by it. Wave 4's 06-07 depends on 06-03 + 06-04 + 06-06 — this plan's REG-02 deliverables (the intent cookie, `checkoutReturnPathFor`, the resumption route) are complete and committed, satisfying its share of that dependency. Two caveats carry forward, matching the pattern already established by 06-01/06-02/06-03: (1) `tests/checkout-intent.integration.test.ts` needs to actually run once Docker is available — this sandbox could only prove it type-checks and builds, not that the round trip behaves correctly against a real database; and (2) the human browser walkthrough (Human Verification Needed above) is still outstanding and should be run before this phase's end-of-phase UAT closes, alongside 06-03's own still-outstanding walkthrough.

## Self-Check: PASSED
- All 3 created files verified present on disk (`src/app/(checkout)/enrol/[cohortId]/page.tsx`, `tests/checkout-intent.test.ts`, `tests/checkout-intent.integration.test.ts`), plus this SUMMARY.md.
- All 6 task commits (`27f98b2`, `9d125e5`, `6a017fd`, `194ce18`, `f69bb60`, `c7c94a3`) verified present in `git log`.

---
*Phase: 06-registration-checkout-stripe-payments*
*Completed: 2026-09-10*
