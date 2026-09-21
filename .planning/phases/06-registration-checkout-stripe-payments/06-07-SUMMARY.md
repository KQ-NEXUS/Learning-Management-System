---
phase: 06-registration-checkout-stripe-payments
plan: 07
subsystem: payments
tags: [stripe, checkout, consent, policy-acceptance, countdown, nextjs]

requires:
  - phase: "06-03, 06-04, 06-06"
    provides: "checkout-service.ts's initiateStripePayment/getOwnOrder/HoldExpiredError/OrderNotPayableError, the order-summary page's fact-card <dl>, POLICY_TYPE.REFUND_CANCELLATION and POLICY_VERSIONS (06-02), applyEnrolmentActivation (06-04/06-06)"
provides:
  - "Server-side REG-04 consent gate — initiateStripePayment refuses PolicyConsentRequiredError before any write when a required policy acceptance is missing"
  - "Three versioned, order-bound PolicyAcceptance rows (terms/refund-cancellation/marketing) created in the same transaction as the PaymentAttempt, idempotent per order"
  - "D-13 email-verification gate (EmailNotVerifiedError), documented defence in depth"
  - "PolicyConsentForm — three initially-unchecked consent controls gating Pay client-side, mirroring the server rule"
  - "HoldCountdown — display-only mm:ss countdown with UI-SPEC colour escalation, no navigation/submission authority"
  - "The order-summary page's four states: normal/consent, D-13 verification banner, D-04 decline/retry banner, D-10 hold-expired panel — the expired state decided server-side on every render"
affects: [06-08, 06-09]

actuals:
  tokens: 17100
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Order-bound PolicyAcceptance rows are create-only inside the same transaction as the PaymentAttempt — never find-then-update, unlike the standing profile-preference row setMarketingPreference upserts"
    - "useFormStatus-driven pending submit button (React 19), reused for the Pay/Try-again control instead of a manually tracked pending boolean"
    - "Display-only client countdown recomputed from a server-supplied expiry instant on every tick, with the server re-checking the same fact on every render and inside the pay action — the client clock never has authority"

key-files:
  created:
    - src/app/(checkout)/checkout/[orderId]/PolicyConsentForm.tsx
    - src/app/(checkout)/checkout/[orderId]/HoldCountdown.tsx
    - tests/components/checkout-summary.test.tsx
  modified:
    - src/server/services/checkout-service.ts
    - src/app/(checkout)/checkout/[orderId]/page.tsx
    - src/app/(checkout)/checkout/[orderId]/actions.ts
    - tests/checkout-service.test.ts
    - tests/checkout-hold-race.integration.test.ts
    - tests/checkout-webhook.integration.test.ts

key-decisions:
  - "initiateStripePayment's cancelUrl carries a declined=1 query marker (Rule 2 auto-fix) — Stripe's own hosted Checkout page gives the app no signal distinguishing a genuine decline from an ordinary back-out when the customer returns via cancel_url; this marker is the only way the D-04 retry banner can render at all, and it is read purely for UX (which banner to show), never trusted as a security or payment-state fact."
  - "The D-04 'Try again' control is the same Pay button, relabelled — not a second, independently-gated button. Consent must be re-affirmed on every payment attempt (the server checks it every call regardless of prior acceptance rows), so a retry naturally requires re-checking both required boxes; a separate ungated 'Try again' button would have bypassed that."
  - "Verification status exposed to the order-summary page via a new getOwnVerificationStatus(actor) export on checkout-service.ts, reusing the same User.emailVerified read initiateStripePayment's D-13 gate needs — the page cannot otherwise know whether to render the verification banner, since Actor carries no emailVerified field."
  - "Policy-text links point at /policies/terms and /policies/refund-cancellation, which do not exist as real pages yet — no CMS exists this phase (identity.ts's own comment), and building one is out of this plan's scope. Documented as a Known Stub, not silently invented as if real."

patterns-established:
  - "A checkout Order's PolicyAcceptance rows are written inside the same transaction as its PaymentAttempt, and are create-only per order — never mutated by a later attempt against the same order."

requirements-completed: [REG-04, PAY-02]

coverage:
  - id: D1
    description: "Task 1 — initiateStripePayment extended to accept the three consent values, gates (ownership -> verification -> hold -> consent) in cheapest-first order, writes three versioned order-bound PolicyAcceptance rows in the same transaction as the PaymentAttempt, idempotent per order. EmailNotVerifiedError and PolicyConsentRequiredError exported."
    requirement: "REG-04"
    verification:
      - kind: unit
        ref: "tests/checkout-service.test.ts — 28/28 passing, including the three-row/missing-consent/declined-marketing/unverified/repeat-call cases and the declined=1 cancel_url marker case"
        status: pass
      - kind: other
        ref: "grep gates: POLICY_VERSIONS/REFUND_CANCELLATION/MARKETING/emailVerified all present, EmailNotVerifiedError and PolicyConsentRequiredError both exported"
        status: pass
    human_judgment: false
  - id: D2
    description: "Task 2 — PolicyConsentForm (three initially-unchecked, separately-labelled controls gating Pay client-side) and HoldCountdown (display-only mm:ss countdown with colour escalation, no navigation/submission authority)"
    requirement: "REG-04"
    verification:
      - kind: unit
        ref: "tests/components/checkout-summary.test.tsx — 13/13 passing, covering first-paint unchecked state, marketing-only-leaves-Pay-inert, both-required-enables-Pay, unchecking re-disables, pending/double-submit guard, and the countdown's three colour thresholds with a constant font-size class"
        status: pass
      - kind: other
        ref: "grep gates: 0 defaultChecked/checked={true}, >=1 font-mono, 0 redirect/router/submit calls in HoldCountdown, 0 raw hex in either file"
        status: pass
    human_judgment: true
    rationale: "Unit tests prove the gating logic and colour-class thresholds in jsdom, but the actual visual rendering (spacing, the inherited checkbox treatment, colour contrast) needs a human eye against the running app — covered by task 3's human-check walkthrough below."
  - id: D3
    description: "Task 3 — the order-summary page's four states (normal/consent, D-13 verification banner, D-04 decline/retry banner, D-10 hold-expired panel) and payAction's typed-refusal-to-state routing"
    requirement: "REG-04, PAY-02"
    verification:
      - kind: automated_ui
        ref: "npx next build (clean) + grep gates: each of the four UI-SPEC 6.1 copy strings appears exactly once, no DetailLayout import, >=1 holdExpiresAt reference (server-side expiry decision), 0 raw hex"
        status: pass
      - kind: unit
        ref: "tsc --noEmit clean across the whole repo after the initiateStripePayment signature change (also required fixing tests/checkout-hold-race.integration.test.ts and tests/checkout-webhook.integration.test.ts, which called the old two-argument signature)"
        status: pass
    human_judgment: true
    rationale: "next build and the grep gates prove the code compiles and the copy/structural invariants hold, but the real Stripe decline-and-retry flow, the real hold-expiry wait, and the real database PolicyAcceptance inspection all need the browser walkthrough below — see Human Verification Needed."
  - id: D4
    description: "The six-step human browser walkthrough — countdown/consent gating, decline-and-retry on the SAME order, hold expiry replacing the whole page, and the three-row PolicyAcceptance database check"
    verification: []
    human_judgment: true
    rationale: "Requires a running dev server, stripe listen --forward-to, and a real Stripe test-mode payment with the 4000 0000 0000 0002 decline card — no automated test drives Stripe's own hosted Checkout page. Docker is also unavailable in this execution sandbox (confirmed via `docker info`), so the two real-Postgres integration test files this plan had to keep compiling (tests/checkout-hold-race.integration.test.ts, tests/checkout-webhook.integration.test.ts) could not actually be run here either — same environment gate every 06-01..06-06 plan has already documented."

duration: ~95min
completed: 2026-09-10
status: complete
---

# Phase 6 Plan 7: Consent, Verification Gate, Hold Countdown & Decline Retry Summary

**Turned the tracer's bare order summary into REG-04's real review-and-consent step: three separately-versioned PolicyAcceptance rows written server-side in the same transaction as the PaymentAttempt, a consent gate and a D-13 verification gate that refuse a direct POST before any write, a display-only countdown with no authority over the hold, and the D-04/D-10 decline-retry and hold-expired states.**

## Performance
- **Duration:** ~95min
- **Started:** ~2026-09-10T08:15:00Z (approx.)
- **Completed:** ~2026-09-10T09:50:00Z (approx.)
- **Tasks:** 3
- **Files touched:** 9 (3 created, 6 modified)

## Accomplishments

- **Task 1:** `initiateStripePayment` (`checkout-service.ts`) now takes the three consent values alongside the order id and gates in cheapest-first order: ownership (existing `getOwnOrder`), then a fresh `User.emailVerified` read (`EmailNotVerifiedError` — D-13 defence in depth, documented as unreachable through the normal sign-in flow today per the plan's own planner finding), then the authoritative hold check (`HoldExpiredError`, unchanged), then consent (`PolicyConsentRequiredError` unless both terms and refund-cancellation are affirmative). On success, the `PaymentAttempt` create and three `PolicyAcceptance` creates (terms, refund-cancellation, marketing) now happen inside one `deps.db.$transaction` call — moved out of the previous non-transactional `deps.paymentAttempt.create` — so a Stripe failure afterwards cannot leave consent recorded for a payment that never started, and consent can never be missing for an attempt that did. The write is idempotent per order (checked via `policyAcceptance.findMany` inside the same transaction) so D-04's retry path never produces six rows. Marketing always gets an explicit `accepted: true/false` row, using the same `POLICY_TYPE.MARKETING` key `profile-service.ts`'s `setMarketingPreference` already writes. Also exported `getOwnVerificationStatus(actor)` (Rule 2 auto-fix — see Deviations) so the order-summary page can render the D-13 banner without duplicating the `User` read.
- **Task 2:** `PolicyConsentForm.tsx` — three separately-labelled, initially-unchecked controls (terms and refund-cancellation each carrying a link to their policy text; marketing never gates Pay) using the inherited 16×16px/1.5px-border auth-shell checkbox treatment verbatim, plus a `useFormStatus`-driven submit button showing the pending treatment and disabled while in flight. `HoldCountdown.tsx` — a display-only client countdown, recomputed from `Date.now()` against a server-supplied `holdExpiresAt` prop on every one-second tick (never decremented from a stored counter), rendering at the Label type size in mono with colour-only urgency escalation (`--foreground` > 5:00, `--warning` 5:00–1:00, `--danger` < 1:00) and issuing no redirect, navigation, or submission of any kind.
- **Task 3:** The order-summary page now renders all four states UI-SPEC 7.2 specifies. The hold-expired panel is decided by a server-side check on every render (enrolment status/`holdExpiresAt` against `new Date()`), never by the client countdown — when triggered, it replaces the entire page body (summary card and Pay button do not render). The D-13 verification banner renders from a fresh `getOwnVerificationStatus` read, with Pay forced inert beneath it via `PolicyConsentForm`'s new `forceDisabled` prop. The D-04 decline/retry banner renders when the learner returns from Stripe's hosted page carrying a `declined=1` query marker (see Deviations) — mutually exclusive with the verification banner — and its "Try again" affordance is the same Pay button, relabelled, re-entering `payAction` for the identical Order (no second Order, no second hold; consent must still be re-affirmed). `payAction` (`actions.ts`) now reads the three consent checkboxes from `FormData` and translates each typed refusal to its state: `HoldExpiredError`/`EmailNotVerifiedError`/`PolicyConsentRequiredError` all redirect back to the same order-summary page (which decides which state to show from its own server reads), `OrderNotPayableError` redirects to the receipt page via a fresh `getOwnOrder` lookup for the reference, `OrderNotFoundError` redirects to `/courses`.
- All copy matches UI-SPEC 6.1 verbatim (verified by grep gates on `page.tsx`, each of the four strings appearing exactly once).
- `tsc --noEmit` clean across the whole repository, `npx next build` clean, all task-level `<verify>` commands pass.

## Suggested Commits (not yet made — user commits personally)

1. `test(06-07): add failing tests for the REG-04 consent gate, D-13 verification gate, and order-bound PolicyAcceptance recording` — files: `tests/checkout-service.test.ts`
2. `feat(06-07): record three versioned order-bound policy acceptances and gate Pay server-side` — files: `src/server/services/checkout-service.ts`
3. `fix(06-07): keep the real-Postgres checkout integration harnesses compiling against the extended initiateStripePayment signature` — files: `tests/checkout-hold-race.integration.test.ts`, `tests/checkout-webhook.integration.test.ts`
4. `feat(06-07): policy consent controls and the display-only hold countdown` — files: `src/app/(checkout)/checkout/[orderId]/PolicyConsentForm.tsx`, `src/app/(checkout)/checkout/[orderId]/HoldCountdown.tsx`
5. `test(06-07): component tests for consent gating and countdown urgency escalation` — files: `tests/components/checkout-summary.test.tsx`
6. `feat(06-07): wire the order-summary page's four states and payAction's typed-refusal routing` — files: `src/app/(checkout)/checkout/[orderId]/page.tsx`, `src/app/(checkout)/checkout/[orderId]/actions.ts`
7. `docs(06-07): complete Consent, Verification Gate, Hold Countdown & Decline Retry plan` — files: `.planning/phases/06-registration-checkout-stripe-payments/06-07-SUMMARY.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`

## Files Created/Modified
- `src/server/services/checkout-service.ts` — `EmailNotVerifiedError`, `PolicyConsentRequiredError`, `getOwnVerificationStatus`; `initiateStripePayment` extended with consent params, the verification/consent gates, and the transactional PaymentAttempt+PolicyAcceptance write
- `src/app/(checkout)/checkout/[orderId]/PolicyConsentForm.tsx` — three consent controls + Pay/Try-again submit (new)
- `src/app/(checkout)/checkout/[orderId]/HoldCountdown.tsx` — display-only countdown (new)
- `src/app/(checkout)/checkout/[orderId]/page.tsx` — the four states, server-decided hold-expiry
- `src/app/(checkout)/checkout/[orderId]/actions.ts` — consent passthrough, typed-refusal-to-state routing
- `tests/checkout-service.test.ts` — 8 new cases (28 total) plus a `user`/`policyAcceptance`/`paymentAttempt` tx-scoped fake harness extension
- `tests/components/checkout-summary.test.tsx` — 13 new cases (new file)
- `tests/checkout-hold-race.integration.test.ts` — updated to the 3-arg `initiateStripePayment` signature, `user` dep binding, verified-learner fixture override (compile-compat fix, Docker-blocked in this sandbox)
- `tests/checkout-webhook.integration.test.ts` — same compile-compat fix (Docker-blocked in this sandbox)

## Decisions Made

See `key-decisions` in the frontmatter for the four load-bearing ones (the `declined=1` cancel_url marker, the relabelled-not-duplicated Try-again button, `getOwnVerificationStatus`, and the policy-link stub). All are also documented inline as code comments at their exact call sites.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `cancelUrl` needed a `declined=1` marker for D-04's retry banner to exist at all**
- **Found during:** Task 3, while wiring the decline/retry banner.
- **Issue:** Stripe's own hosted Checkout page does not tell the app *why* a customer left when they land back at `cancel_url` (declined-then-gave-up vs. an ordinary back-out) — the plan's task 3 text assumes the page can detect "the learner returns from a declined payment" but nothing in task 1's `initiateStripePayment` (which builds `cancelUrl`) provided that signal.
- **Fix:** Appended a `?declined=1` query marker to `cancelUrl` inside `initiateStripePayment` (task 1's file). The order-summary page reads it purely for which banner to render — never trusted as a security or payment-state fact, and never checked by `payAction` itself.
- **Files modified:** `src/server/services/checkout-service.ts`, `src/app/(checkout)/checkout/[orderId]/page.tsx`
- **Verification:** New unit case in `tests/checkout-service.test.ts` asserting the exact `cancel_url` value; manual reasoning documented inline.
- **Commit:** would be folded into commit 2 (`feat(06-07): record three versioned order-bound policy acceptances...`).

**2. [Rule 2 - Missing critical functionality] `getOwnVerificationStatus` — the page had no way to know whether to render the D-13 banner**
- **Found during:** Task 3, while wiring the verification banner.
- **Issue:** `Actor` carries only `userId`/`isStaff` (per the plan's own interfaces note). Task 1 added a `User.emailVerified` read internal to `initiateStripePayment`, but the order-summary page needs the same fact to decide whether to render the banner at all — the plan's task 3 text assumes this is available without specifying where it comes from.
- **Fix:** Exported `getOwnVerificationStatus(actor): Promise<{ verified: boolean; email: string }>` from `checkout-service.ts`, reusing the same `deps.user.findUnique` binding task 1 already added.
- **Files modified:** `src/server/services/checkout-service.ts`, `src/app/(checkout)/checkout/[orderId]/page.tsx`
- **Verification:** Two new unit cases in `tests/checkout-service.test.ts`.
- **Commit:** would be folded into commit 2.

**3. [Rule 3 - Blocking issue] Extending `initiateStripePayment`'s signature broke two existing real-Postgres integration test files**
- **Found during:** Running `tsc --noEmit` after task 1's changes.
- **Issue:** `tests/checkout-hold-race.integration.test.ts` and `tests/checkout-webhook.integration.test.ts` (built by earlier plans in this phase) called the old two-argument `initiateStripePayment(actor, orderId)` and built a `createCheckoutService` deps object with no `user` binding and a `paymentAttempt.create` that moved into the transaction — both now fail to compile.
- **Fix:** Added the third consent argument (a shared `FULL_CONSENT` constant) to every call site, added a `user.findUnique` deps binding reading the real Prisma `User` table, removed the now-unused `paymentAttempt.create` binding, and set `emailVerified: new Date()` on every `seedLearnerFixture` call in both files so the D-13 gate does not newly block these fixtures once Docker is available to actually run them.
- **Files modified:** `tests/checkout-hold-race.integration.test.ts`, `tests/checkout-webhook.integration.test.ts`
- **Verification:** `tsc --noEmit` is clean across the whole repository. The two files themselves remain BLOCKED in this sandbox (Docker unavailable — `docker info` fails), same as every 06-01..06-06 plan already documented; a human/CI environment with Docker must actually run them to prove the runtime behavior, not just the compile.
- **Commit:** would be its own commit (commit 3 above), separate from task 1's feature commit, since it touches files outside this plan's own `files_modified` list.

**Total deviations:** 3 auto-fixed (2 Rule 2, 1 Rule 3). **Impact:** All three close real gaps the plan's own task text assumed away (a decline signal that doesn't exist by default, a verification fact the page has no other way to reach) or that this plan's own signature change would otherwise have silently broken (two pre-existing integration test files). No architectural change; no user decision required.

## Human Verification Needed

With the dev server running, `stripe listen` forwarding, and signed in as a seeded verified learner:
1. Enroll on an open cohort. Confirm the summary page shows the countdown at the top of the order card, counting down in mm:ss, and three unchecked checkboxes.
2. Confirm Pay is not usable. Tick only the marketing box — confirm Pay is still not usable. Tick both required boxes — confirm Pay becomes usable.
3. Watch the countdown cross the five-minute and one-minute thresholds (or seed a cohort with a short holdMinutes). Confirm the colour changes and the text size does not.
4. Pay with the decline test card 4000 0000 0000 0002, then return to the app. Confirm you land back on the SAME order summary with the "Your card was declined" banner and a "Try again" control — and confirm in the database that no second Order and no second Enrolment were created.
5. Let a hold expire (seed a cohort with holdMinutes 1, wait, and let the sweep run). Reload the summary page. Confirm the whole page is replaced by "Your seat hold has expired" with a working "Back to cohort" link.
6. Confirm three PolicyAcceptance rows exist for a successful order, with three distinct policyType values, three version strings, and the order id on each.

## Issues Encountered

- **Docker unavailable in this execution sandbox** (`docker info` fails — same gate every 06-01..06-06 plan documented). `tests/checkout-hold-race.integration.test.ts` and `tests/checkout-webhook.integration.test.ts` were updated to compile against this plan's changes but could not actually be run here; both report BLOCKED with a container-start error when Docker is unavailable, not a test-assertion failure.
- **`npm test` (full suite)** — consistent with 06-01 through 06-06's documented finding, the Docker-dependent integration test files (11+ files, matching the prior count) and `tests/docker-email-config.test.ts` (pre-existing `AUTH_SECRET` validation gap, unrelated to this plan) are expected to fail in this sandbox for the same pre-existing environment reasons; this plan's own new/modified test files (`tests/checkout-service.test.ts`, `tests/components/checkout-summary.test.tsx`) pass in isolation, as does `tsc --noEmit` and `npx next build` across the whole repository.

## Known Stubs

- **`/policies/terms` and `/policies/refund-cancellation`** — `PolicyConsentForm.tsx`'s required-consent labels link to these paths per UI-SPEC 7.2's "each label carrying an inline link to the relevant policy document text," but neither page exists yet — there is no CMS this phase (`src/lib/identity.ts`'s own comment: "bumped by hand when policy text changes; there is no CMS this phase"). Building real policy-text pages was not in this plan's task scope. The link element exists and is tested (`tests/components/checkout-summary.test.tsx`); the destination currently 404s.
- **`/checkout/{orderId}/confirming`** — still not built (plan 06-08's D-05 interstitial, inherited stub from 06-03, unaffected by this plan).

None of these block this plan's own `<done>` criteria — each is an explicitly scoped later-phase or out-of-plan gap, not a silently dropped requirement.

## User Setup Required

None. No new package installed, no new environment variable introduced by this plan.

## Next Phase Readiness

This closes Wave 4. Wave 5 (06-08, the confirming interstitial and receipt-page polish) depends on 06-06 and 06-07 — both are now complete. Two caveats carry forward: (1) the two real-Postgres integration test files this plan touched need to actually run once Docker is available, to prove the D-13 fixture change and the extended `initiateStripePayment` signature behave correctly against a real database — this sandbox could only prove they compile; (2) the human browser walkthrough above (identical in shape to 06-03's own outstanding walkthrough) is still needed before this phase's end-of-phase UAT closes, and should ideally be run as one combined session covering both plans' outstanding items together.

## Self-Check: PASSED
- All 5 created/modified source files verified present on disk (`checkout-service.ts`, `PolicyConsentForm.tsx`, `HoldCountdown.tsx`, `page.tsx`, `actions.ts`).
- All 4 modified/created test files verified present on disk (`checkout-service.test.ts`, `checkout-summary.test.tsx`, `checkout-hold-race.integration.test.ts`, `checkout-webhook.integration.test.ts`).
- No commits were made this session (per explicit user instruction — see Suggested Commits above for what would have been committed); `git log -1` is unchanged from the start of this run.

---
*Phase: 06-registration-checkout-stripe-payments*
*Completed: 2026-09-10*
