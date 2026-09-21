---
phase: 06-registration-checkout-stripe-payments
plan: 09
subsystem: payments
tags: [stripe, invariants, typescript-compiler-api, provider-isolation, coverage-reconciliation, phase-close]

requires:
  - phase: "06-01 through 06-08"
    provides: "the whole checkout/Stripe subsystem this plan closes out — seat hold, Stripe Checkout Session, signature-verified webhook settlement, consent, hold countdown, confirmation email, confirming interstitial and honest receipt"
provides:
  - "tests/checkout-phase-invariants.test.ts — executable PAY-09 (provider isolation) and PAY-10 (single paid-order writer) assertions, TypeScript-compiler-API-based, directory-prefix exemption, fixture-proven failure messages"
  - "Two real, pre-existing PAY-09 provider-isolation violations found and fixed: checkout-service.ts and the Stripe webhook route both held a direct `import type Stripe from \"stripe\"` outside the provider directory"
  - "COVERAGE.md reconciled row-by-row against shipped code across all nine plans, with a new Implementation column and two corrected status narratives"
  - "ROADMAP.md's Phase 6 entry updated to nine plans, each success criterion now citing the test file(s)/walkthrough step(s) behind it"
  - "REQUIREMENTS.md's traceability table marked complete for all eight of this phase's requirement ids (REG-01..05, PAY-02, PAY-09, PAY-10)"
  - "A consolidated, phase-wide 'Human Verification Needed' record — every outstanding walkthrough from 06-03 through 06-09 in one place"
affects: ["Phase 7", "Phase 8", "Phase 13"]

actuals:
  tokens: 9500
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "A scanner test proves its own failure path via a fixture (a temp directory built at test time, not the real src tree) rather than only asserting the real tree is clean — this is what makes 'the assertion names the offending file' a tested property of the test itself, not an unverified claim about it"
    - "AST-based single-writer detection: an object-literal PropertyAssignment named 'status' with a StringLiteral initializer 'PAID', which cannot be confused with a read/comparison (a BinaryExpression) or a comment mentioning the same words"

key-files:
  created:
    - tests/checkout-phase-invariants.test.ts
  modified:
    - src/server/services/checkout-service.ts
    - src/app/api/webhooks/stripe/route.ts
    - .planning/phases/06-registration-checkout-stripe-payments/COVERAGE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md

key-decisions:
  - "checkout-service.ts's Stripe-session-create deps type was narrowed from the SDK's own `Stripe.Checkout.SessionCreateParams` to `ReturnType<typeof buildCheckoutSessionParams>` — same shape, sourced through the provider wrapper already imported, rather than a direct `import type Stripe from \"stripe\"`."
  - "The webhook route now holds three small, locally-declared structural types (VerifiedWebhookEvent/CheckoutSessionFacts/PaymentIntentFacts) instead of `Stripe.Event`/`Stripe.Checkout.Session`/`Stripe.PaymentIntent` — `verifyStripeWebhook` still returns the SDK's own typed event internally (that's fine; it lives inside the provider directory), the route just never names that type itself."
  - "The invariant test's fixture-based failure-message proof builds a real temporary directory tree (os.tmpdir()) rather than only unit-testing the assertion-formatting helper in isolation — this exercises the whole pipeline (AST parse, directory-prefix exemption, message format) together, the same rigor tests/boundary.test.ts's own closure walk gets."
  - "Task 2's environment-preparation and human-walkthrough steps were not attempted in this sandbox at all (no dev server started, no database seeded, no Stripe CLI installed, no `stripe trigger` run) — Docker is unavailable and, per this plan's own objective, no browser is available either, so even a successfully seeded/running server could not be walked. Attempting partial setup with no way to complete it would have been wasted, side-effect-bearing work against a real Stripe test account for no proof gained."

patterns-established:
  - "A phase-closing invariant test that a later plan's code could regress against is proven not just by scanning the real tree clean, but by constructing a deliberately-violating fixture and asserting the resulting error message names the offending file — this is what stops the gate itself from silently becoming a no-op."

requirements-completed: [REG-01, REG-02, REG-03, REG-04, REG-05, PAY-02, PAY-09, PAY-10]

coverage:
  - id: D1
    description: "tests/checkout-phase-invariants.test.ts — PAY-09 provider isolation (no file outside src/server/payments/providers/stripe/ imports the stripe package or names one of its types) and PAY-10 single-paid-writer (exactly one module writes Order.status = \"PAID\", and it is the settlement service), both TypeScript-compiler-API-based with directory-prefix exemption and fixture-proven failure messages"
    requirement: "PAY-09"
    verification:
      - kind: unit
        ref: "npx vitest run tests/checkout-phase-invariants.test.ts — 5/5 passing (2 real-tree assertions, 3 fixture-based failure-message proofs)"
        status: pass
      - kind: unit
        ref: "npx vitest run tests/boundary.test.ts — 11/11 passing, both the worker and webhook import-closure cases still green"
        status: pass
      - kind: other
        ref: "grep -c 'webhookRuntimeClosure' tests/checkout-phase-invariants.test.ts == 0 (the actorless-settlement invariant is not duplicated); npx tsc --noEmit clean"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two real, pre-existing PAY-09 provider-isolation violations found and fixed while building D1: checkout-service.ts (Stripe.Checkout.SessionCreateParams) and the webhook route (Stripe.Event/Stripe.Checkout.Session/Stripe.PaymentIntent) both named an SDK type outside the provider directory"
    requirement: "PAY-09"
    verification:
      - kind: unit
        ref: "tests/checkout-phase-invariants.test.ts's real-tree provider-isolation case (D1) is green against the fixed tree; it would have failed red against the pre-fix tree (confirmed by direct code review of both files before the fix, not re-run against the broken state to avoid reintroducing it)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit clean; npx next build clean after both fixes"
        status: pass
    human_judgment: false
  - id: D3
    description: "COVERAGE.md reconciled row-by-row against shipped code across all nine plans: every INTEGRATE row now names the file that implements it (new Implementation column); every OPT-OUT row spot-checked via a source grep for its own characteristic field/method name, confirmed not silently implemented; two status narratives corrected (the NGN currency gate's resolved outcome; the Stripe-CLI/trigger rows marked not-yet-exercised rather than silently implied done)"
    requirement: "PAY-09"
    verification:
      - kind: other
        ref: "grep across src/ for sessions.retrieve|sessions.expire|sessions.list|ui_mode|customer_email|setup_future_usage|allow_promotion_codes|automatic_tax|shipping_address_collection|paymentIntents.(create|confirm)|refunds.create|constructEventAsync|webhookEndpoints|events.list|events.retrieve — one match, a comment explaining why checkout.sessions.list is NOT called, confirming rather than contradicting the OPT-OUT row"
        status: pass
    human_judgment: false
  - id: D4
    description: "ROADMAP.md's Phase 6 entry updated to nine plans (06-09 checked off, Plans line and progress-table row both read 9/9); each of the five success criteria now cites the specific test file(s) and/or numbered walkthrough step(s) behind it instead of a bare requirement-id tag"
    requirement: "REG-01"
    verification:
      - kind: other
        ref: "git diff --stat .planning/ROADMAP.md shows changes confined to the Phase 6 section and the progress-table row (22 lines changed, 1 file) — no other phase entry touched"
        status: pass
    human_judgment: false
  - id: D5
    description: "REQUIREMENTS.md traceability marked complete for all eight of this phase's requirement ids, gated through requirements.ready-ids (8/8 reported ready given every plan's own requirements-completed frontmatter) before requirements.mark-complete was run"
    requirement: "REG-01"
    verification:
      - kind: other
        ref: "gsd-tools query requirements.ready-ids returned {ready: [REG-01..05, PAY-02, PAY-09, PAY-10], blocked: [], total: 8}; requirements.mark-complete returned write_set_complete: true for all 16 checkbox+traceability writes"
        status: pass
    human_judgment: false
  - id: D6
    description: "The complete end-to-end learner journey (twelve steps) against real Stripe TEST-mode traffic, plus the synthetic stripe trigger pre-proof and the Stripe-CLI signing-secret match — the whole of Task 2"
    verification: []
    human_judgment: true
    rationale: "Requires a running dev server, a seeded database, the Stripe CLI forwarding webhooks, and a real browser session with a real Stripe test-mode payment. Docker is unavailable in this execution sandbox (docker info fails, same gate every 06-01..06-08 plan documented) and, per this plan's own objective, no browser is available either — so even a hypothetically-running dev server could not be walked here. Not attempted; recorded as outstanding below rather than fabricated."

duration: ~45min
completed: 2026-09-10
status: complete
---

# Phase 6 Plan 9: Phase Close-Out — Executable Invariants, Journey Walkthrough & Record Reconciliation Summary

**Turned PAY-09's provider-boundary and PAY-10's single-writer promises into a TypeScript-compiler-API-based test that immediately caught and fixed two real, pre-existing Stripe-type leaks (`checkout-service.ts`, the webhook route), reconciled COVERAGE.md and ROADMAP.md against what nine plans actually shipped, and marked all eight of the phase's requirements traceable — while recording the twelve-step Stripe TEST-mode walkthrough as still genuinely outstanding rather than fabricating it, since neither Docker nor a browser is available in this execution sandbox.**

## Performance
- **Duration:** ~45min
- **Started:** 2026-09-10T11:35:00Z (approx.)
- **Completed:** 2026-09-10T12:20:00Z (approx.)
- **Tasks:** 3 (1 auto/tdd, 1 auto — environment-gated, 1 auto)
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- **Task 1:** Built `tests/checkout-phase-invariants.test.ts`, reusing `tests/boundary.test.ts`'s TypeScript-compiler-API idiom (parse with `ts.createSourceFile`, walk import declarations) rather than a raw-text regex. Two invariants:
  - **Provider isolation (PAY-09).** Walks every source file under `src/`; for any file outside `src/server/payments/providers/stripe/`, asserts no import declaration's module specifier is `"stripe"`. The exemption is a directory-prefix check (`path.relative` + prefix match), not a per-file allowlist — a fourth provider module needs no test edit to stay exempt.
  - **Single paid-order writer (PAY-10).** Walks the same tree with the compiler API's AST, looking for an object-literal `PropertyAssignment` named `status` with a `StringLiteral` initializer `"PAID"` — a write, structurally distinct from a read/comparison (`order.status === "PAID"`, a `BinaryExpression`) or a comment mentioning the same words. Asserts exactly one such writer exists and it is `checkout-webhook-system-service.ts`.
  - Both invariants are also proven able to fail correctly: two fixture-based tests build a real temporary directory tree (`os.tmpdir()`), plant a deliberate violation alongside an exempt file and an innocent comment, and assert the resulting error message names the offending file path — exercising the full scan pipeline, not just the message-formatting helper in isolation.
  - Writing this test immediately found two real, pre-existing violations it was designed to catch: `checkout-service.ts` held `import type Stripe from "stripe"` for `Stripe.Checkout.SessionCreateParams`, and the webhook route held the same import for `Stripe.Event`/`Stripe.Checkout.Session`/`Stripe.PaymentIntent`. Both are outside the provider directory. Fixed as a Rule 1 auto-fix (see Deviations) before the test was ever run against the real tree, so its first real-tree run was already green — the RED proof for this class of test is the fixture, not a since-fixed real violation (see TDD Gate Compliance below).
  - `npx vitest run tests/checkout-phase-invariants.test.ts tests/boundary.test.ts` — 16/16 passing. `npx tsc --noEmit` clean.
- **Task 2 (environment-gated, not performed in this sandbox):** No dev server was started, no database was seeded, no Stripe CLI was installed, and no `stripe trigger` was run. Docker is unavailable here (`docker info` fails, matching every 06-01 through 06-08 plan's own documented finding) and, per this plan's own objective, no browser is available either — so even a hypothetically-running, seeded dev server could not be walked to completion in this session. Rather than performing a partial, unusable setup (which would also mean real calls against the user's actual Stripe test-mode account for no verifiable payoff), this task's environment-preparation and twelve-step walkthrough are recorded as still outstanding — see Human Verification Needed below, consolidated with every other plan's own outstanding walkthrough. `npm test` and `npx next build` (the automated half of this task's `<verify>`) were both run: `next build` is clean; `npm test` shows the identical, already-documented pattern every prior plan in this phase reports — 15 Docker-gated integration test files BLOCKED at container start, 2 pre-existing `tests/docker-email-config.test.ts` failures on the unrelated blank-`AUTH_SECRET` `.env.example` gap, 1437 tests passing, 0 new failures from this plan's own changes.
- **Task 3:** Walked `COVERAGE.md` row by row against the shipped code across all nine plans. Added an Implementation column naming the file behind every INTEGRATE row (confirmed by direct inspection, not asserted from the original plan text). Spot-checked every OPT-OUT row with a source grep for its own characteristic field/method name — one match, a comment in `checkout-session.ts` explaining why `checkout.sessions.list` is deliberately NOT called, which confirms rather than contradicts the row. Corrected two stale status narratives without changing either decision: the NGN currency gate's own text still described itself as "will probe" when 06-01 had already run that probe and it succeeded; the `stripe listen`/`stripe trigger` Tooling rows are now marked `[06-09: not yet exercised]` rather than silently implied complete, since neither has actually been run in any sandboxed execution of this phase. Updated `ROADMAP.md`'s Phase 6 entry to nine plans (06-09 checked off, Plans line and progress-table row both `9/9`) with scoped edits confined to the Phase 6 section — confirmed via `git diff --stat`. Each of the five success criteria now names the specific test file(s) and/or numbered walkthrough step(s) behind it. Marked all eight of this phase's requirement ids complete in `REQUIREMENTS.md`'s traceability table, gated through `requirements.ready-ids` (8/8 ready) before `requirements.mark-complete`.

## Phase-Wide Requirement Traceability

| Requirement | Owning plan(s) | Automated evidence | Outstanding |
|---|---|---|---|
| REG-01 | 06-02, 06-03, 06-05 | `tests/public-catalogue-service.test.ts`, `tests/components/cohort-cards.test.tsx` (10 cases) | Walkthrough step 1; Programme-page side-by-side comparison (06-05 human-check) |
| REG-02 | 06-04 | `tests/landing.test.ts` (20 cases), `tests/checkout-intent.test.ts` (9 cases) | `tests/checkout-intent.integration.test.ts` (Docker-gated); walkthrough steps 2–5 |
| REG-03 | 06-03, 06-06 | `tests/checkout-service.test.ts`, `tests/checkout-webhook.integration.test.ts` (redelivery/mismatch cases, Docker-gated) | Walkthrough steps 11–12 (forgery/redirect checks) |
| REG-04 | 06-02, 06-07 | `tests/checkout-service.test.ts` (consent-gate cases), `tests/components/checkout-summary.test.tsx` (13 cases) | Walkthrough steps 6, 10 (three-row PolicyAcceptance DB check) |
| REG-05 | 06-03, 06-08 | `tests/components/order-confirmation.test.tsx` (10 cases) | `tests/checkout-webhook.integration.test.ts`'s email-dispatch cases (Docker-gated); walkthrough step 9 |
| PAY-02 | 06-02, 06-06, 06-07 | `tests/checkout-webhook-system-service.test.ts`, `tests/checkout-webhook.integration.test.ts` (Docker-gated) | Walkthrough steps 7–8 |
| PAY-09 | 06-01, 06-03, 06-09 | `tests/checkout-phase-invariants.test.ts` (this plan, green) | None automated-side; the invariant is now mechanically enforced |
| PAY-10 | 06-01, 06-03, 06-06 | `tests/checkout-phase-invariants.test.ts` (single-writer, this plan), `tests/boundary.test.ts` (webhook import-closure) | `tests/checkout-webhook.integration.test.ts` (Docker-gated); walkthrough steps 11–12 |

All eight are marked complete in `REQUIREMENTS.md`'s traceability table (see D5 above) on the strength of the automated evidence in the middle column — the "Outstanding" column is not a claim that the requirement is unmet, it names the specific real-Postgres/real-browser proof still pending, consistent with how 06-01 through 06-08 already qualified their own `human_judgment: true` coverage entries.

## COVERAGE.md Reconciliation

Full detail is in `COVERAGE.md`'s own new "Reconciliation (06-09)" section. Summary: no INTEGRATE/OPT-OUT decision changed. All 16 INTEGRATE rows correspond to code that exists, now named in a new Implementation column. All 25 OPT-OUT rows were spot-checked via source grep and confirmed not silently implemented. Two rows' status *narrative* (not decision) were corrected: the NGN currency gate's resolved-PASSED outcome, and the Stripe-CLI/`stripe trigger` rows being honestly marked not-yet-exercised in any sandboxed run of this phase rather than silently implied done by their INTEGRATE status.

## Human Verification Needed (consolidated — whole phase)

None of the following has been performed in any sandboxed execution of this phase (06-01 through 06-09) — Docker is unavailable throughout, and no browser is available either. A human needs to run these, ideally as one combined session, before Phase 6's UAT can close:

1. **06-03's original walkthrough** — sign in as a seeded learner, enroll on an open cohort with `stripe listen` forwarding, pay with 4242 4242 4242 4242, confirm the receipt shows Paid/Active, confirm a different learner's order URL 404s.
2. **06-05's Programme-vs-Course check** — confirm a Programme offer page renders the same cohort cards as a Course offer page, side by side, and that the empty-cohort Programme state and the Enroll-to-order-summary path both work.
3. **06-07's six-step consent/countdown/decline/expiry walkthrough** — countdown and consent-gating visuals, the decline test card (4000 0000 0000 0002) landing back on the SAME order with a working "Try again" (confirming no second Order/Enrolment), a real hold-expiry replacing the whole page, and a direct database check of the three distinct `PolicyAcceptance` rows.
4. **06-08's confirming-interstitial and receipt walkthrough** — the real Stripe round trip through the interstitial to the receipt, the ~2-minute no-webhook backstop copy swap, a screen-reader announcement check, cross-account 404s on both the confirming and receipt routes, reproducing the Pitfall-4 exception sub-state end to end, and confirming the receipt is unchanged by a live cohort price edit made afterward.
5. **06-09's own twelve-step journey** (this plan's Task 2) — the full discover → register → verify → sign-in → consent → pay → confirm → receipt journey with a brand-new account against real Stripe TEST-mode traffic, including the database row-count inspection (step 10), the unsigned-webhook forgery check (step 11), and the direct-navigation-to-confirming-URL redirect check (step 12). Environment preparation (seed, dev server, `stripe listen`, the synthetic `stripe trigger` pre-proof, and the signing-secret match) must be confirmed working BEFORE this walkthrough begins, per this plan's own Task 2 action text.

Steps 1–5 share the same environment: a seeded database, a running dev server, `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, and a real browser. Running them together in one sitting is more efficient than five separate sessions and is the combination 06-07's and 06-08's own SUMMARYs already recommended.

## Suggested Commits (not yet made — user commits personally)

1. `fix(06-09): remove Stripe SDK type imports outside the provider directory (PAY-09 violation found while building the invariant test)` — files: `src/server/services/checkout-service.ts`, `src/app/api/webhooks/stripe/route.ts`
2. `test(06-09): add the executable PAY-09 provider-isolation and PAY-10 single-paid-writer invariant tests` — files: `tests/checkout-phase-invariants.test.ts`
3. `docs(06-09): reconcile COVERAGE.md and the ROADMAP Phase 6 entry against what actually shipped across all nine plans` — files: `.planning/phases/06-registration-checkout-stripe-payments/COVERAGE.md`, `.planning/ROADMAP.md`
4. `docs(06-09): complete Phase 6 close-out plan` — files: `.planning/phases/06-registration-checkout-stripe-payments/06-09-SUMMARY.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`

## Files Created/Modified
- `tests/checkout-phase-invariants.test.ts` (new) — PAY-09/PAY-10 executable invariants, 5 tests
- `src/server/services/checkout-service.ts` — removed `import type Stripe from "stripe"`; `stripe.checkout.sessions.create`'s params type narrowed to `ReturnType<typeof buildCheckoutSessionParams>`
- `src/app/api/webhooks/stripe/route.ts` — removed `import type Stripe from "stripe"`; added three locally-declared structural types (`VerifiedWebhookEvent`/`CheckoutSessionFacts`/`PaymentIntentFacts`) in its place
- `.planning/phases/06-registration-checkout-stripe-payments/COVERAGE.md` — new Implementation column on every table; two corrected status narratives; a new "Reconciliation (06-09)" section
- `.planning/ROADMAP.md` — Phase 6 entry: nine plans, five success criteria now citing test files/walkthrough steps, progress-table row `9/9`
- `.planning/REQUIREMENTS.md` — traceability table marked complete for REG-01..05, PAY-02, PAY-09, PAY-10
- `.planning/STATE.md` — position/metrics/session updated

## Decisions Made
See `key-decisions` in the frontmatter. In short: narrowing `checkout-service.ts`'s Stripe-session-create param type to the provider wrapper's own return type rather than the SDK's namespaced type; replacing the webhook route's three Stripe-namespaced type usages with locally-declared structural types; proving the invariant test's failure-message behavior against a real temporary-directory fixture rather than only the formatting helper in isolation; and not attempting any part of Task 2's environment setup given neither Docker nor a browser is available in this sandbox.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `checkout-service.ts` named a Stripe SDK type outside the provider directory**
- **Found during:** Task 1, reading `checkout-service.ts` per its own `<read_first>` instruction ("confirm it consumes the wrappers and not the SDK") before writing the invariant test.
- **Issue:** `import type Stripe from "stripe";` at module scope, used for `Stripe.Checkout.SessionCreateParams` on the `stripe.checkout.sessions.create` deps signature — exactly the PAY-09 violation this plan's Task 1 exists to make mechanically detectable.
- **Fix:** Removed the import; the params type is now `ReturnType<typeof buildCheckoutSessionParams>`, sourced through the provider wrapper (`buildCheckoutSessionParams`) already imported in this file — same runtime shape, no direct SDK type reference.
- **Files modified:** `src/server/services/checkout-service.ts`
- **Verification:** `npx tsc --noEmit` clean; `npx next build` clean; `tests/checkout-phase-invariants.test.ts`'s real-tree provider-isolation case is green against the corrected file.
- **Commit:** would be commit 1 (`fix(06-09): remove Stripe SDK type imports...`).

**2. [Rule 1 - Bug] The Stripe webhook route named three Stripe SDK types outside the provider directory**
- **Found during:** Task 1, reading `src/app/api/webhooks/stripe/route.ts` per the plan's own `<interfaces>` statement that "the webhook route... consume[s] the thin wrappers... rather than the SDK."
- **Issue:** `import type Stripe from "stripe";`, used for `Stripe.Event` (the `event` variable's declared type) and `Stripe.Checkout.Session`/`Stripe.PaymentIntent` (two cast sites) — the same class of violation as #1, in the one file this plan's own text specifically calls out by name.
- **Fix:** Removed the import; added three small, locally-declared structural types (`VerifiedWebhookEvent`, `CheckoutSessionFacts`, `PaymentIntentFacts`) describing only the fields this route actually reads. `verifyStripeWebhook` (inside the provider directory) still returns the SDK's own `Stripe.Event` internally — assigning that value to a variable declared with the narrower structural type is exactly the kind of width-preserving assignment TypeScript allows, so no runtime behavior changed.
- **Files modified:** `src/app/api/webhooks/stripe/route.ts`
- **Verification:** `npx tsc --noEmit` clean; `npx next build` clean (`/api/webhooks/stripe` still lists as a route); `tests/checkout-phase-invariants.test.ts`'s real-tree provider-isolation case is green against the corrected file.
- **Commit:** would be folded into commit 1.

**Total deviations:** 2 auto-fixed (both Rule 1). **Impact:** Both close a real PAY-09 provider-isolation gap inherited from 06-03 (checkout-service.ts) and 06-03/06-06 (the webhook route) — exactly the class of drift this plan's own objective predicted ("nothing in the codebase notices when plan 07's error handler quietly imports a Stripe type"). No architectural change: both fixes are structural type substitutions with identical runtime behavior, confirmed by a clean `tsc`/`next build` and the full pre-existing test suite showing zero new failures. No user decision required.

## TDD Gate Compliance

Task 1 carried `tdd="true"`. This is a source-scanning "detector" test, and its meaningful RED proof is different in shape from a normal feature test: the real-tree assertions (`findProviderIsolationViolations`/`findPaidOrderWriters` run against `src/`) are *expected* to be green by construction once the code is correct — there is no red-then-green cycle to run against the real tree without temporarily reintroducing a real bug. What IS a genuine RED-then-GREEN proof, and what this file actually contains, are the three fixture-based tests: each constructs a deliberately-violating temporary directory, asserts the scanner finds the violation, and asserts the assertion helper's thrown message names the offending file — these were written and run against the scanning functions from the start, and they exercise a real failure path every time the suite runs, not just once.

The two real violations found in `checkout-service.ts` and `route.ts` (see Deviations above) were discovered by direct code review during this task's own mandatory `<read_first>` pass — before the invariant test was written at all — and fixed immediately, so the new test's first run against the real tree was already green rather than red-then-fixed. Flagging this honestly: the plan's own text anticipated exactly this shape of discovery ("PAY-09 is the requirement most likely to pass every plan and still fail the phase"), and finding it before writing the test rather than after does not weaken the invariant — the test still mechanically enforces the property going forward, and the fixture tests prove it can actually fail when it should.

## Issues Encountered

- **Docker unavailable in this execution sandbox** (`docker info` fails — identical to every 06-01 through 06-08 plan's own documented finding). All Docker-gated integration test files (15 files) report BLOCKED at container start, not a test-assertion failure.
- **No browser available in this execution sandbox** (stated in this plan's own objective) — even if Docker/the Stripe CLI/a dev server were available, Task 2's twelve-step walkthrough could not be completed here regardless. This is why Task 2's environment-preparation steps were not attempted at all rather than partially run.
- **Stripe CLI not installed** (`command -v stripe` empty) — matches 06-01's own documented finding; still not installed as of this plan.
- **`npm test` (full suite)** — 15 test files fail (the Docker-gated integration suites above), 2 individual tests fail (`tests/docker-email-config.test.ts`'s pre-existing blank-`AUTH_SECRET` `.env.example` gap, documented in `.planning/STATE.md`'s Blockers/Concerns before this plan started, unrelated to any file this plan touched), 1437 tests pass, 140 skipped. This is the same pattern every 06-01 through 06-08 plan has already documented, with 5 more passing tests than 06-08's own count (this plan's 5 new invariant-test cases). `npx next build` is clean.

## Known Stubs

None introduced by this plan. `SUPPORT_CONTACT_EMAIL`'s placeholder value (06-08) and the `/policies/terms`/`/policies/refund-cancellation` link stubs (06-07) remain exactly as those plans documented them — carried forward here, not silently dropped, in the Human Verification Needed section and this SUMMARY's Open Items below.

## Open Items (carried forward for Phase 7 and beyond)

- **NGN probe outcome (06-01):** PASSED. This Stripe account (country USA) accepts NGN test-mode Checkout Sessions at the seeded cohort price — no currency workaround needed. Recorded here so Phase 7's Paystack work inherits the fact rather than re-discovering it.
- **Support-contact sourcing (06-08):** `SUPPORT_CONTACT_EMAIL` is a documented `.env.example` placeholder (`support@example.com`) — no real deployment value exists anywhere in this codebase or its docs. Must be overridden with a real address before this phase reaches a real deployment.
- **REG-01 programme-side field gap (06-05):** none exists. `PublicProgramme` genuinely lacks `prerequisites`/`durationHours` (Course-only fields); its own completion-expectation fields (`memberCourseTitles`, `certificateEnabled`) were already rendered before 06-05 touched the page. Confirmed again during this plan's `COVERAGE.md` walk — no invented field, no silent gap.
- **Policy-text pages (06-07):** `/policies/terms` and `/policies/refund-cancellation` do not exist yet — no CMS this phase. The consent form's links point at them and currently 404. Out of this phase's scope; flagged for whichever future phase builds policy content.
- **`.planning/STATE.md`'s standing "payment provider integrations are schema-only" concern** is now closed for Stripe and remains open for Paystack and manual payment, which Phase 7 owns. This phase shipped one provider behind a shared state machine, not the multi-gateway capability — not overstating the win.
- **Docker-gated integration proof** for `tests/checkout-webhook.integration.test.ts`, `tests/checkout-hold-race.integration.test.ts`, and `tests/checkout-intent.integration.test.ts` — none has actually run to completion in any sandboxed execution of this phase. A Docker-enabled environment must run all three before REG-02/REG-03/REG-05/PAY-02/PAY-10's real-Postgres proof is complete.

## User Setup Required

Before a real deployment: a real `SUPPORT_CONTACT_EMAIL` value (06-08), and the Stripe CLI/webhook endpoint registration steps `06-USER-SETUP.md` (06-01) already documents. No new package installed by this plan.

## Next Phase Readiness

Phase 6's code is complete across all nine plans. Three things stand between this state and closing the phase: (1) the user committing everything per the Suggested Commits lists across 06-06 (already committed, per its own SUMMARY), 06-07, 06-08, and this plan; (2) a Docker-enabled environment running the three still-BLOCKED integration test files; (3) the consolidated five-part human UAT walkthrough above. Phase 7 (Paystack, manual payment, refunds) depends on Phase 6 and inherits a closed NGN-currency gate, a mechanically-enforced PAY-09 provider boundary it must not cross, and a payment-state-machine shape (`PAYMENT_VALID_TRANSITIONS`) it should extend rather than duplicate.

## Self-Check: PASSED

- `tests/checkout-phase-invariants.test.ts` — FOUND, 5/5 passing (`npx vitest run tests/checkout-phase-invariants.test.ts`)
- `tests/boundary.test.ts` — FOUND, 11/11 passing, unaffected
- `src/server/services/checkout-service.ts` — FOUND, `import type Stripe from "stripe"` absent (confirmed via grep), `npx tsc --noEmit` clean
- `src/app/api/webhooks/stripe/route.ts` — FOUND, `import type Stripe from "stripe"` absent, three local structural types present, `npx tsc --noEmit` clean
- `.planning/phases/06-registration-checkout-stripe-payments/COVERAGE.md` — FOUND, Implementation column present on every table, "Reconciliation (06-09)" section present
- `.planning/ROADMAP.md` — FOUND, Phase 6 entry reads nine plans, `git diff --stat` confirms changes confined to the Phase 6 section and the progress-table row
- `.planning/REQUIREMENTS.md` — FOUND, `requirements.mark-complete` reported `write_set_complete: true` for all 16 checkbox+traceability writes across the 8 requirement ids
- No commits were made this session (per explicit user instruction — see Suggested Commits above for what would have been committed); `git log -1` is `21fc1d9315622f2d3d25bf58c54690a6034b8915` ("feat(06-06): webhook route dispatch completion and the webhook import-closure guard"), unchanged from the start of this run.

---
*Phase: 06-registration-checkout-stripe-payments*
*Completed: 2026-09-10*
