# Phase 6 — Stripe API Coverage Decision Matrix

**Produced by:** gsd-planner (plan:pre `api-coverage` capability contribution, capId `ai-integration`)
**Detector:** external API/SDK integration confirmed — `stripe` npm SDK v22.6.1, Stripe Checkout + Webhooks
**Date:** 2026-09-09
**Reconciled:** 2026-09-10 by 06-09 (phase close-out) — see "Reconciliation (06-09)" at the bottom. Original
decision text below is preserved verbatim except where a `[06-09: ...]` annotation marks a correction; no
INTEGRATE/OPT-OUT decision changed.
**Rule:** Full API coverage by default — every capability is INTEGRATE unless explicitly opted out with a
reason.

This matrix enumerates the Stripe capability surface that is *reachable from this phase's scope*
(hosted Checkout, one-time card payment, server-verified webhook settlement). It exists so that
un-built capabilities are **decided**, not invisible. A capability marked OPT-OUT is a recorded
decision with an owner and a reason — not an oversight discovered later by a learner who
reasonably expected it to work.

Rows marked `Phase 7` are already roadmapped (PAY-03/04/05/07/08/11/13/14) and are opt-outs *for
this phase only*, not permanent product decisions.

An **Implementation** column was added during the 06-09 reconciliation pass, naming the file that
actually implements each INTEGRATE row — confirmed against the shipped code, not asserted from the
original plan text.

---

## Checkout Sessions

| Capability | Decision | Plan | Reason | Implementation |
|---|---|---|---|---|
| `checkout.sessions.create` (mode: `payment`) | **INTEGRATE** | 06-03 | The core money-moving call. D-01 locks hosted Checkout. | `src/server/services/checkout-service.ts` (`initiateStripePayment`) calling `getStripe().checkout.sessions.create` |
| Request-level `idempotencyKey` option | **INTEGRATE** | 06-03 | REG-03 — a retried "Pay" submission must not create a second Stripe charge. Keyed on `PaymentAttempt.idempotencyKey`. | `src/server/services/checkout-service.ts` (`initiateStripePayment`'s second argument to `sessions.create`) |
| `client_reference_id` + `metadata` correlation | **INTEGRATE** | 06-03 | The webhook's primary lookup key back to `Order.id`; belt-and-suspenders `metadata.orderId`/`enrolmentId`. | `src/server/payments/providers/stripe/checkout-session.ts` (`buildCheckoutSessionParams`) |
| Inline `price_data` (no Product/Price objects) | **INTEGRATE** | 06-03 | D-07 — amount and currency always derive server-side from `Cohort.amountMinor`/`Cohort.currency` at Order-creation time. | `src/server/payments/providers/stripe/checkout-session.ts` |
| `payment_method_types: ["card"]` | **INTEGRATE** | 06-03 | D-03 — card only at launch. | `src/server/payments/providers/stripe/checkout-session.ts` |
| `success_url` / `cancel_url` | **INTEGRATE** | 06-03 | D-05 interstitial and D-04 return-to-summary. Neither URL is ever trusted as proof of payment (PAY-10). | `src/server/services/checkout-service.ts` (`initiateStripePayment` builds both URLs; `cancelUrl` also carries the `declined=1` UX marker, 06-07) |
| `checkout.sessions.retrieve` (server-side reconcile fallback) | OPT-OUT | — | No slow-webhook fallback in v1. D-05's interstitial polls the app's own DB. If added later it MUST route through the same `activateOrderAsSystem` path, never a shortcut that skips signature verification (06-RESEARCH.md Anti-Patterns). | — |
| `checkout.sessions.expire` (programmatic expiry) | OPT-OUT | — | Abandonment is owned by Phase 5's hold-expiry worker (D-06). Expiring the Stripe session adds a second clock with no product benefit. | — |
| `checkout.sessions.list` | OPT-OUT | — | No listing surface in this phase; `PaymentAttempt` rows are the app-side index. Phase 8 reconciliation may revisit. | — |
| Embedded Checkout (`ui_mode: "embedded"`) | OPT-OUT | — | D-01 locks hosted redirect. Listed in 06-CONTEXT.md Deferred Ideas. | — |
| Customer creation / `customer_email` prefill | OPT-OUT | — | No `stripeCustomerId` column exists and none is needed for a one-time single-seat purchase. Adding it would create a second identity store. | — |
| `setup_future_usage` / saved cards | OPT-OUT | — | Explicitly prohibited this phase — see prohibition P-06-07. One-time payments only; card reuse would need its own consent step. | — |
| Promotion codes / coupons (`allow_promotion_codes`) | OPT-OUT | — | The `Order` schema has no discount, coupon or adjusted-amount concept. Enabling it would let Stripe charge an amount the Order row cannot represent. | — |
| Stripe Tax (`automatic_tax`) | OPT-OUT | — | No tax model in the schema (`Order` carries a single `amountMinor`). Out of scope for v1 per PRD §19.1. | — |
| Shipping / billing address collection | OPT-OUT | — | Digital training enrolment; no physical fulfilment and no address field on `Order`. | — |

**[06-09] OPT-OUT rows spot-checked:** `checkout.sessions.retrieve`/`.expire`/`.list`, embedded
Checkout (`ui_mode`), customer/`customer_email`, `setup_future_usage`, `allow_promotion_codes`,
`automatic_tax`, and shipping/billing address collection — a source grep across `src/` confirms
none of these fields or calls exist anywhere outside a comment in
`checkout-session.ts` that names `checkout.sessions.list` for the reason it is NOT called. No
row silently became an integration.

## Webhooks & Events

| Capability | Decision | Plan | Reason | Implementation |
|---|---|---|---|---|
| `stripe.webhooks.constructEvent` (signature verification) | **INTEGRATE** | 06-03, 06-06 | PAY-10's whole requirement. Never hand-rolled — timing-safe compare + tolerance window + versioned scheme. | `src/server/payments/providers/stripe/webhook.ts` (`verifyStripeWebhook`) — the sole call site in the repository |
| `checkout.session.completed` handling | **INTEGRATE** | 06-03, 06-06 | The only event permitted to move an Order to `PAID`. | `src/app/api/webhooks/stripe/route.ts` dispatches to `src/server/services/checkout-webhook-system-service.ts` (`activateOrderAsSystem`) |
| `checkout.session.expired` handling | **INTEGRATE** | 06-06 | PAY-02 bookkeeping — moves an unpaid `PaymentAttempt` to `CANCELLED` so the payment state machine is complete. | `src/app/api/webhooks/stripe/route.ts` -> `checkout-webhook-system-service.ts` (`recordSessionExpiredAsSystem`) |
| `payment_intent.payment_failed` handling | **INTEGRATE** | 06-06 | PAY-02 `FAILED` state + `failedAt`/`failureReason`. Bookkeeping only — D-04's retry UX is handled inside Stripe's own hosted page. | `src/app/api/webhooks/stripe/route.ts` -> `checkout-webhook-system-service.ts` (`recordPaymentFailureAsSystem`) |
| Event idempotency via `event.id` | **INTEGRATE** | 06-03, 06-06 | Insert-first against `WebhookEvent.@@unique([provider, providerEventId])`. Stripe delivery is at-least-once by contract. | `src/server/services/checkout-webhook-system-service.ts` (`recordWebhookEventOrSkip`) |
| `stripe.webhooks.constructEventAsync` | OPT-OUT | — | Edge-runtime variant. This route runs on the Node default runtime like every other route in the codebase (`clamscan`, `@aws-sdk/*` already require it). | — |
| Webhook Endpoints API (create/update endpoints programmatically) | OPT-OUT | — | The endpoint is registered once per environment. Captured as `user_setup` in 06-01 rather than as app code that would need its own credentials scope. | — |
| `events.list` / `events.retrieve` (manual replay) | OPT-OUT | — | Stripe's own 3-day retry plus the `WebhookEvent` table cover redelivery. A replay tool belongs with Phase 8 reconciliation. | — |
| Thin payloads / `event.data.previous_attributes` | OPT-OUT | — | Full payloads are stored in `WebhookEvent.payload`; no diff-based processing in this phase. | — |
| Dispute / chargeback events (`charge.dispute.*`) | OPT-OUT | Phase 7/8 | PAY-05/PAY-13 refunds and PAY-06/PAY-12 reconciliation own this. No `Dispute` surface exists yet. | — |

**[06-09] PAY-09 provider isolation for this whole table is now mechanically enforced, not just
plan-reviewed:** `tests/checkout-phase-invariants.test.ts` (new this plan) asserts no file outside
`src/server/payments/providers/stripe/` imports the `stripe` package or names one of its types, and
that exactly one module (`checkout-webhook-system-service.ts`) writes `Order.status = "PAID"`. Both
pass against the current tree. During this reconciliation pass the scan also caught two real,
pre-existing violations — `checkout-service.ts` and `route.ts` both held a direct
`import type Stripe from "stripe"` for narrow type annotations — fixed in this plan (see
06-09-SUMMARY.md Deviations) rather than left as a gap the new test would otherwise have reported
red on its very first run.

## Payments, Refunds & Money Movement

| Capability | Decision | Plan | Reason | Implementation |
|---|---|---|---|---|
| Currency: `Cohort.currency` passed through verbatim (lowercased) | **INTEGRATE** | 06-01, 06-03 | D-07. **[06-09: gate resolved]** Seeded cohorts are NGN; Stripe NGN support is account-dependent (06-RESEARCH.md Pitfall 5). 06-01's real test-mode probe against this deployment's Stripe account (country USA) **succeeded** (`cs_test_a1g4O2Gqw4jgzPiKt95SPxu8WFhuNRwn1XhWTStcZnIiBY0s36xZImzfYV`, 2026-09-10) — the currency gate is closed, no workaround or repricing was needed, and none was added. | `src/server/payments/providers/stripe/checkout-session.ts` (`currency: args.currency.toLowerCase()`) |
| Direct `paymentIntents.create` / `.confirm` | OPT-OUT | — | Hosted Checkout owns the PaymentIntent lifecycle (D-01). Talking to both APIs would create two sources of truth for one payment. | — |
| `refunds.create` | OPT-OUT | Phase 7 | PAY-05/PAY-13. The `Refund` model already exists and stays unpopulated this phase. | — |
| Payouts / Balance / Balance Transactions | OPT-OUT | Phase 8 | PAY-06/PAY-12 reconciliation scope. | — |
| Stripe Connect (multi-account, destination charges) | OPT-OUT | — | Single-provider, single-merchant deployment. No revenue-split or marketplace concept anywhere in the PRD. | — |
| Subscriptions / Billing / Invoices | OPT-OUT | — | The commercial model is a one-time single-seat cohort purchase. `Order` has no recurrence field. | — |
| Stripe-hosted invoices/receipts | OPT-OUT | — | D-17 — the app's own `/orders/[reference]` page is the receipt. A second receipt surface would drift from the app's record. | `src/app/orders/[reference]/page.tsx` (06-08) is the sole receipt surface, confirmed |
| Wallets (Apple Pay / Google Pay / Link) | OPT-OUT | — | D-03 — deferred config toggle, no schema change needed to enable later. | — |
| Radar custom fraud rules | OPT-OUT | — | Stripe's default Radar protection applies without integration. Custom rules need production traffic data that does not exist. | — |

## Tooling & Operations

| Capability | Decision | Plan | Reason | Implementation |
|---|---|---|---|---|
| Pinned exact SDK version (no `^` range) | **INTEGRATE** | 06-01 | The SDK ships weekly to track Stripe API version bumps. Same discipline already applied to `@tiptap/extensions@3.31.0`. | `package.json` — `"stripe": "22.6.1"`, confirmed exact (no caret/tilde) |
| Stripe CLI `stripe listen --forward-to` for local webhook delivery | **INTEGRATE** | 06-01, 06-09 | The only practical way to exercise the webhook path locally and at the phase-close walkthrough. | **[06-09: not yet exercised]** No application file — an operational practice, documented in `06-USER-SETUP.md`. The Stripe CLI is not installed in either this execution sandbox or the 06-01 sandbox (`command -v stripe` empty both times); `stripe listen` has not actually been run yet. Still the correct decision — see Reconciliation below for why this is an outstanding human step, not a reversed decision. |
| `stripe trigger checkout.session.completed` | **INTEGRATE** | 06-09 | Phase-close end-to-end verification. | **[06-09: not yet exercised]** Same gate as the row above — no Stripe CLI, no dev server, and no browser are available in this execution sandbox. This synthetic trigger (and the `WebhookEvent`-row proof it is meant to produce) is carried into the consolidated human walkthrough in 06-09-SUMMARY.md rather than fabricated as having run. |
| Stripe API version pinning (`apiVersion` in the client) | **INTEGRATE** | 06-01 | Prevents a future SDK upgrade silently changing event payload shapes the webhook parses. | `src/server/payments/providers/stripe/client.ts` — `STRIPE_API_VERSION = "2026-08-26.dahlia"`, passed explicitly to the `Stripe` constructor |
| Stripe Dashboard-managed webhook secret rotation | OPT-OUT | — | Operational, not code. Recorded as `user_setup` (env var) rather than an in-app rotation mechanism. | — |
| Stripe SDK telemetry | OPT-OUT | — | Left at SDK default; no product need to configure it either way. | — |

---

## Rollup

| Bucket | INTEGRATE | OPT-OUT |
|---|---|---|
| Checkout Sessions | 6 | 9 |
| Webhooks & Events | 5 | 5 |
| Payments & Money Movement | 1 | 9 |
| Tooling & Operations | 4 | 2 |
| **Total** | **16** | **25** |

**No capability in this matrix is undecided.** Every OPT-OUT carries a reason and, where the
capability is roadmapped, the phase that owns it.

---

## Reconciliation (06-09)

Performed 2026-09-10 as part of phase close-out, walking every row above against the code that
actually shipped across all nine plans (06-01 through 06-09), not just this plan's own three files.

**INTEGRATE rows:** all 16 correspond to code that exists, each now named in the new
**Implementation** column above. Two rows needed a correction to their status narrative rather than
their decision:

1. **Currency passthrough (Checkout Sessions... actually Payments & Money Movement table)** — the
   row's own text described the NGN gate as still open ("06-01 probes a real test-mode NGN session
   before the tracer runs"). 06-01 already ran that probe and it **succeeded**
   (`cs_test_a1g4O2Gqw4jgzPiKt95SPxu8WFhuNRwn1XhWTStcZnIiBY0s36xZImzfYV`), so the matrix's own words
   were stale relative to its own SUMMARY. Corrected to state the resolved outcome. The decision
   itself (INTEGRATE) did not change.
2. **`stripe listen` / `stripe trigger` (Tooling & Operations)** — both remain the correct
   INTEGRATE decision (there is no other practical way to exercise the webhook path locally), but
   neither has actually been exercised yet in any sandboxed execution of this phase (06-01 through
   06-09 all independently hit the same missing-CLI/no-Docker/no-browser environment gate). Rather
   than silently treating "the decision is INTEGRATE" as "the step happened," both rows are now
   marked `[06-09: not yet exercised]` and folded into the consolidated human walkthrough in
   06-09-SUMMARY.md.

**OPT-OUT rows:** every row was checked against a source grep across `src/` for its own
characteristic field/method name (`sessions.retrieve`, `sessions.expire`, `sessions.list`,
`ui_mode`, `customer_email`, `setup_future_usage`, `allow_promotion_codes`, `automatic_tax`,
`shipping_address_collection`, direct `paymentIntents.create`/`.confirm`, `refunds.create`,
`constructEventAsync`, webhook-endpoint creation calls, `events.list`/`events.retrieve`). The only
match found was a comment inside `checkout-session.ts` that names `checkout.sessions.list` while
explaining why it is deliberately NOT called — confirming the decision, not contradicting it. No
OPT-OUT capability was found silently implemented.

**PAY-09 provider isolation** — the plan-review-time promise this whole matrix rests on ("no
Stripe type or import escapes `src/server/payments/providers/stripe/`") is, as of this
reconciliation, an executable assertion (`tests/checkout-phase-invariants.test.ts`) rather than a
per-plan code-review checkpoint. Writing that scan surfaced two real violations inherited from
earlier plans — see the Webhooks & Events table's `[06-09]` note and 06-09-SUMMARY.md's Deviations
section.
