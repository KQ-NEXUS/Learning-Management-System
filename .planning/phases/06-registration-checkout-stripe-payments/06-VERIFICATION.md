---
phase: 06-registration-checkout-stripe-payments
verified: 2026-09-12T04:00:00Z
status: passed
score: 8/8 must-haves verified (all 8 requirement IDs), plus phase-level truths from all 9 plans
behavior_unverified: 0
overrides_applied: 0
coincidental_reliance_items: []
---

# Phase 6: Registration, Checkout & Stripe Payments Verification Report

**Phase Goal:** A visitor can turn a Cohort choice into a paid, active enrolment through one traceable
order and a server-verified Stripe payment.
**Verified:** 2026-09-12T04:00:00Z
**Status:** passed
**Re-verification:** No — initial verification (no prior `06-VERIFICATION.md` existed)

## Method

This phase already carries an unusually strong evidence base: `06-UAT.md`, a 45/45-item human-UAT pass
completed live in this same session, including real Postgres (Testcontainers), real Stripe TEST-mode
traffic, and real Playwright browser automation for the consent/countdown UI, the confirming
interstitial (including its genuine ~2-minute fallback), and a genuinely-reproduced exception state
(real hold-expiry race, not a faked DB row). Per this agent's mandate, that document is treated as
evidence to corroborate, not as authoritative on its own. I independently re-read the actual source
files for every must-have artifact/key-link in all 9 plans' frontmatter, re-ran the specific automated
test files that back each requirement (not the full suite), and traced the money/state-machine logic by
hand in the two highest-risk files (`checkout-webhook-system-service.ts`, `src/app/api/webhooks/stripe/route.ts`).

## Goal Achievement

### Observable Truths (by requirement)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | REG-01 — visitor sees price/dates/mode/availability/prerequisites/completion expectation before continuing, on both Course and Programme pages, with honest zero/one/many/Full/last-seat boundary states | ✓ VERIFIED | `src/app/(public)/CohortCards.tsx` (67 lines, `seatsAvailable`-driven, no debt markers) rendered on both `courses/[slug]/page.tsx` and `programmes/[slug]/page.tsx`; `tests/components/cohort-cards.test.tsx` re-run 2026-09-12 — 15 tests passing (superset of the plan's 10 boundary cases); `tests/public-catalogue-service.test.ts` covers `seatsAvailable = max(capacity - seatsTaken, 0)`, no `seatsTaken` leak; UAT tests 15/23/24 confirm live rendering on real data |
| 2 | REG-02 — cohort selection survives the auth detour (register/verify/sign-in) and returns the learner to their specific order, never a generic landing page; no open-redirect surface | ✓ VERIFIED | `src/server/auth/landing.ts` exports `checkoutReturnPathFor`/`CHECKOUT_INTENT_COOKIE`; cookie carries a bare cohort id only (never a URL) — grepped, confirmed; `tests/landing.test.ts` re-run — 20 cases passing; `tests/checkout-intent.integration.test.ts` run against real Testcontainers Postgres this session — 4/4 passing; UAT test 22 walked a brand-new account through the full anonymous-Enroll → register → verify → sign-in → `/enrol/{cohortId}` → order-summary path live, confirmed landing on the order, not `/account` |
| 3 | REG-03 — exactly one traceable order per checkout attempt; replays/duplicate webhooks cannot double-settle or double-enrol | ✓ VERIFIED | `checkout-webhook-system-service.ts`'s `recordWebhookEventOrSkip` inserts `WebhookEvent` before processing, catches `P2002`, returns `{isNew:false}` with zero reprocessing (read directly, lines 226-271); `activateOrderAsSystem`'s amount/currency mismatch branch marks `EXCEPTION` and explicitly never moves `PaymentAttempt` to `SUCCEEDED` on a mismatch (REG-03's prohibition, lines 461-499); `tests/checkout-service.test.ts` re-run — 28/28 passing (supersede-on-repeat-Enroll, net seat delta zero); `tests/checkout-webhook.integration.test.ts` run for real against Testcontainers Postgres this session (part of a 24/24 passing run per UAT) |
| 4 | REG-04 — terms, refund/cancellation, and marketing consent captured as three separate, unbundled, initially-unchecked, versioned rows at order time; marketing never gates Pay | ✓ VERIFIED | `PolicyConsentForm.tsx` read directly (113 lines) — three independent `useState`-backed checkboxes, `canPay = acceptedTerms && acceptedRefundCancellation` (marketing excluded from the gate), each with its own policy link, none pre-checked; server-side `PolicyConsentRequiredError` in `checkout-service.ts` backs the client gate; `tests/checkout-service.test.ts` and `tests/components/checkout-summary.test.tsx` re-run — 28 and 13 tests passing; UAT tests 31/32/34 confirm live via real Playwright screenshots (disabled → both-ticked-enables → unchecking re-disables) and a real 3-row `PolicyAcceptance` DB check |
| 5 | PAY-02 — full payment-state vocabulary (PENDING/PROCESSING/SUCCEEDED/FAILED/CANCELLED) is represented, transitions are valid/idempotent/timestamped | ✓ VERIFIED | `PAYMENT_VALID_TRANSITIONS` table read directly — every terminal state has an empty allow-list; `assertPaymentTransition` is called at every write site before touching `PaymentAttempt.status`; `recordPaymentFailureAsSystem`/`recordSessionExpiredAsSystem` set `failedAt`/no-timestamp-for-CANCELLED correctly; confirmed by re-reading full file, and by `tests/checkout-webhook.integration.test.ts`'s real-Postgres run (UAT tests 27/28) |
| 6 | PAY-09 — Stripe-specific code stays behind `src/server/payments/providers/stripe/`; one construction site; provider-agnostic schema | ✓ VERIFIED | Independently grepped: `new Stripe(` appears exactly once, in `client.ts`; `from "stripe"` (the SDK, not this repo's own provider files) appears nowhere outside `src/server/payments/providers/stripe/`; `tests/checkout-phase-invariants.test.ts` re-run this session — 5/5 passing, including the fixture that proves the scan can fail; COVERAGE.md documents two pre-existing leaks (`checkout-service.ts`, `route.ts` narrow `import type Stripe`) found and fixed during 06-09 |
| 7 | PAY-10 — only a signature-verified webhook can mark an Order PAID; redirect handler never writes state; secrets never logged/persisted | ✓ VERIFIED | `src/app/api/webhooks/stripe/route.ts` read directly — raw body read as text before any parsing, `verifyStripeWebhook` is the only gate before any write, a `StripeSignatureError` returns 400 with zero writes; grepped `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` — both referenced only via `process.env.*`, never interpolated into logs/audit/domain-event payloads; UAT test 45's security probe: an unsigned webhook body got 400 with the order still PENDING, live, against a real order |
| 8 | REG-05 — receipt exposes all six required fields (reference, offer, amount, payment state, enrolment state, support route); confirmation email sent once, after commit | ✓ VERIFIED | `src/app/orders/[reference]/page.tsx` (166 lines) read directly — reference, cohort, `amountMinor` (never re-derived from live price), Paid/Active-style pills, `SUPPORT_CONTACT_EMAIL` all present; `activateOrderAsSystem`'s post-commit email dispatch (`dispatchBestEffort`, scoped to exactly `activated`/`illegal_enrolment_transition` outcomes) confirmed by direct read; `tests/components/order-confirmation.test.tsx` re-run — passing; UAT tests 17/18/35/36/38/39 confirm live rendering, price-freeze (edited `Cohort.priceMinor` directly in DB, receipt unchanged), and the honest amber (never red) exception sub-state via a genuinely reproduced race |

**Score:** 8/8 requirement-level truths verified; 0 present-but-behavior-unverified; 0 overrides applied.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server/payments/providers/stripe/client.ts` | Single Stripe SDK singleton | ✓ VERIFIED | Sole `new Stripe(...)` call site, confirmed by grep |
| `src/server/payments/providers/stripe/checkout-session.ts` | Pure session-params builder | ✓ VERIFIED | Present, referenced by `checkout-service.ts` |
| `src/server/payments/providers/stripe/webhook.ts` | `verifyStripeWebhook` sole signature-check site | ✓ VERIFIED | Confirmed sole call site via `route.ts` import and grep |
| `src/app/api/webhooks/stripe/route.ts` | Actorless, signature-gated settlement dispatch | ✓ VERIFIED | 134 lines, read in full; dispatches to system service, no direct Prisma/Stripe-typed writes |
| `src/server/services/checkout-service.ts` | `startCheckout`/`getOwnOrder`/`initiateStripePayment` | ✓ VERIFIED | 635 lines; `amountMinor` sourced from `cohort.priceMinor` at 2 call sites, no floating-point re-derivation found |
| `src/server/services/checkout-webhook-system-service.ts` | Replay-safe, actorless settlement spine | ✓ VERIFIED | 1007 lines, read in full — idempotency guard, payment-transition table, amount/currency mismatch branch, illegal-transition exception branch, post-commit email dispatch, all present and correctly ordered |
| `src/app/(checkout)/checkout/[orderId]/PolicyConsentForm.tsx` | 3 unbundled consent controls + Pay gate | ✓ VERIFIED | 113 lines, read in full |
| `src/app/(checkout)/checkout/[orderId]/HoldCountdown.tsx` | Display-only countdown | ✓ VERIFIED | 53 lines; confirmed present, UAT confirms color escalation live |
| `src/app/(checkout)/checkout/[orderId]/confirming/page.tsx` + `PollForPayment.tsx` | D-05 interstitial, bounded fallback | ✓ VERIFIED | 40 + 86 lines; UAT test 37 confirms the real ~135s fallback live |
| `src/app/orders/[reference]/page.tsx` | Permanent receipt, 6 REG-05 fields | ✓ VERIFIED | 166 lines, read in full |
| `src/app/(public)/CohortCards.tsx` | Shared cohort-card list, both offer types | ✓ VERIFIED | 67 lines, imported by both `courses/[slug]` and `programmes/[slug]` pages |
| `tests/checkout-phase-invariants.test.ts` | Executable PAY-09/PAY-10 invariants | ✓ VERIFIED | 270 lines; re-run this session, 5/5 passing |
| `tests/boundary.test.ts` (webhook-closure extension + develop-merge resolution) | `webhookRuntimeClosure` mechanical import-graph proof; merge conflict resolved onto `netlify/functions/` | ✓ VERIFIED | Re-run this session, 10/10 passing; `workerRuntimeClosure()` confirmed pointing at `netlify/functions/`, not the old `worker/` path |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `route.ts` | `checkout-webhook-system-service.ts` | direct function import/call after signature verification | ✓ WIRED | Read directly — `activateOrderAsSystem`/`recordPaymentFailureAsSystem`/`recordSessionExpiredAsSystem` all called with fields taken only from the verified event |
| `checkout-webhook-system-service.ts` | `enrolment-transitions.ts`'s `applyEnrolmentActivation` | direct call inside the settlement transaction | ✓ WIRED | Confirmed by import and call site (line 564) |
| `checkout-webhook-system-service.ts` | `email-dispatch-service.ts` | `dispatchBestEffort` called after `$transaction` resolves | ✓ WIRED | Confirmed — dispatch block is physically after the `await deps.db.$transaction(...)` call and both audit writes |
| `enrollAction` | `src/server/auth/landing.ts` | `CHECKOUT_INTENT_COOKIE` set before anonymous redirect | ✓ WIRED | Confirmed present in plan frontmatter and corroborated by UAT test 22's live walkthrough |
| `programmes/[slug]/page.tsx` | `CohortCards.tsx` | same component import as course page | ✓ WIRED | Confirmed by grep/import; UAT test 24 confirms structural HTML parity live |

### Behavioral Spot-Checks (re-run this session, not full suite)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Webhook import-closure / worker-closure guard | `npx vitest run tests/boundary.test.ts` | 10/10 passed | ✓ PASS |
| PAY-09/PAY-10 phase-wide invariants | `npx vitest run tests/checkout-phase-invariants.test.ts` | 5/5 passed | ✓ PASS |
| Checkout service core logic | `npx vitest run tests/checkout-service.test.ts` | 28/28 passed | ✓ PASS |
| Consent form + cohort cards + receipt + landing components | `npx vitest run tests/components/checkout-summary.test.tsx tests/components/cohort-cards.test.tsx tests/components/order-confirmation.test.tsx tests/landing.test.ts` | 53/53 passed | ✓ PASS |
| Real-Postgres integration suites (webhook replay, hold-race, checkout-intent) | Already run for real this session per 06-UAT.md (tests 14/21/26/27/28/29/30/36) | 24/24 (webhook) + 3/3 (hold-race) + 4/4 (intent) passed | ✓ PASS (corroborated, not re-run — Testcontainers/Docker not re-invoked to avoid redundant cost) |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| REG-01 | 06-02, 06-03, 06-05, 06-09 | ✓ SATISFIED | Truth #1 above |
| REG-02 | 06-04, 06-09 | ✓ SATISFIED | Truth #2 above |
| REG-03 | 06-03, 06-06, 06-09 | ✓ SATISFIED | Truth #3 above |
| REG-04 | 06-02, 06-03, 06-07, 06-09 | ✓ SATISFIED | Truth #4 above |
| REG-05 | 06-03, 06-08, 06-09 | ✓ SATISFIED | Truth #8 above |
| PAY-02 | 06-02, 06-03, 06-06, 06-07, 06-08, 06-09 | ✓ SATISFIED | Truth #5 above |
| PAY-09 | 06-01, 06-02, 06-03, 06-06, 06-09 | ✓ SATISFIED | Truth #6 above |
| PAY-10 | 06-01, 06-03, 06-06, 06-09 | ✓ SATISFIED | Truth #7 above |

No orphaned requirements: `.planning/REQUIREMENTS.md` maps exactly these 8 IDs to Phase 6, all marked Complete, and every ID appears in at least one plan's `requirements:` frontmatter field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/orders/[reference]/page.tsx` | 27 | `SUPPORT_CONTACT_EMAIL` falls back to `support@example.com` | ℹ️ Info | Explicitly documented as a config-driven, must-override-before-launch placeholder matching the codebase's existing `EMAIL_SENDER_ADDRESS` convention (`brevo-client.ts`); already flagged in 06-08-SUMMARY.md and re-confirmed by UAT test 38. Not a functional stub — it is env-var driven and does not block the phase goal. No `TBD`/`FIXME`/`XXX` markers found in any file this phase touched. |

No other debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found in any of the 9 plans' key artifact files.

### Advisory Finding (not a gap, not blocking)

**Duplicate-settlement-webhook audit-row behavior** — per the task brief, I read `activateOrderAsSystem` end
to end to assess the one item 06-UAT.md flagged for a "maintainer's second look": a second settlement
event delivered under a *different* Stripe event id (not a true idempotent replay, which
`recordWebhookEventOrSkip` already dedupes on `providerEventId` before this function is ever reached)
against an already-`SUCCEEDED` `PaymentAttempt` hits `assertPaymentTransition`'s empty allow-list for
`SUCCEEDED`, throws `IllegalPaymentTransitionError`, and is caught by a dedicated branch (lines 536-559)
that writes an `order.exception` domain event and audit row but — critically — does **not** touch
`Order.status` or `PaymentAttempt.status` in that branch. The `Order` therefore stays `PAID` from the
first, legitimate settlement; only an additional audit/domain-event row is appended. This matches the
extensive in-code documentation (lines 414-419, 651-661) describing this as the deliberate "echo of an
event this module already settled under a different event id" case. **Conclusion: this is by-design
behavior, correctly implemented, and the single-paid-order-writer / no-double-settlement invariants
hold.** The audit-row-alongside-`order.paid` outcome is a reconciliation-visibility choice (make the echo
observable) rather than a silent no-op — reasonable, though a maintainer could choose to make it a
silent no-op instead if the audit noise proves unwanted in practice. Recorded here as an advisory
observation only; not a gap, not blocking phase completion.

### Human Verification Required

None. The mandatory live human-verification pass for this phase was already completed in this session
(`06-UAT.md`, 45/45 checks passed) with real Postgres, real Stripe TEST-mode traffic, and real Playwright
browser automation covering every item that this agent's own methodology would otherwise have had to
route to a human (visual consent/countdown behavior, the confirming interstitial's real timeout, the
genuinely-reproduced exception state, the full brand-new-account journey). This agent's own independent
source-level and automated-test re-verification corroborates that evidence rather than needing to
duplicate it.

### Gaps Summary

None. All 8 requirement IDs are satisfied with both source-level evidence (independently read, not
trusted from SUMMARY.md prose) and passing automated tests re-run in this verification pass. The one
item flagged in 06-UAT.md as worth a second look (duplicate-webhook audit-row noise) was investigated
and found to be correctly-implemented, by-design behavior — not a functional gap.

---

_Verified: 2026-09-12T04:00:00Z_
_Verifier: Claude (gsd-verifier)_
