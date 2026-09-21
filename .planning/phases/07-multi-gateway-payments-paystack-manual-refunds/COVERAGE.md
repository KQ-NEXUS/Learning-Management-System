# API Coverage — Paystack (new) & Stripe Connect (extended)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Stripe's Checkout/webhook/refund core was already integrated and audited in Phase 6
> (`06-registration-checkout-stripe-payments/COVERAGE.md`); this matrix covers only the
> capabilities Phase 7 newly touches for Stripe (Connect destination charges) plus the
> full capability surface for the genuinely new Paystack integration.

## Paystack

| capability | decision | reason |
|---|---|---|
| `initialize_transaction` (split via `subaccount`/`transaction_charge`/`bearer`) | INTEGRATE | Task 5 — the core NGN checkout path (D-03, PAY-08, PAY-17) |
| `verify_transaction` | INTEGRATE | Task 5 — required cross-check before trusting a webhook's `status` field (Pitfall 1); never settle on the webhook payload alone |
| `webhooks` (`charge.success` and related events) | INTEGRATE | Task 5 — signature-verified server-to-server settlement trigger (D-20, D-21, PAY-07) |
| `refund` | INTEGRATE | Task 7 — PAY-05/PAY-13's refund-to-original-provider requirement |
| `subaccount_management` (create/update a subaccount) | OPT-OUT | happens outside the LMS per D-05 — the deployment supplies an already-created `PAYSTACK_SUBACCOUNT_CODE` via secret config; the LMS never calls this endpoint |
| `transaction_split_api` (multi-subaccount, >1 recipient) | OPT-OUT | not needed — one school per deployment (D-01); the single-subaccount split path (`subaccount` param on Initialize Transaction) already covers this phase's entire settlement model, and Paystack's own docs cap splits at two accounts anyway |
| `customers_api` | OPT-OUT | not needed — this LMS has its own learner identity model; no Paystack Customer object is created or referenced |
| `plans_subscriptions_api` | OPT-OUT | not needed — Cohort checkout is one-time payment, not recurring billing; out of this phase's scope entirely |
| `dedicated_virtual_accounts` | OPT-OUT | not needed — checkout uses card/channel-based Initialize Transaction, not a persistent bank-transfer virtual account |
| `bulk_charges_api` | OPT-OUT | not needed — no batch/bulk billing requirement in COH-02/PAY-* |
| `transfers_recipients_api` (payout initiation, distinct from split settlement) | OPT-OUT | not needed — settlement to the school happens automatically via the split transaction; the LMS never initiates a separate payout/transfer |
| `disputes_api` | OPT-OUT | not needed this phase — no dispute-handling requirement in the phase requirement list; tracked as a plausible future-phase need, not this one |
| `terminal_pos_api` | OPT-OUT | not applicable — no point-of-sale hardware integration exists or is planned |
| `apple_pay_google_pay_channel_config` | OPT-OUT | not needed — Initialize Transaction's default `channels` (all enabled for the integration) is used unmodified; the LMS does not configure per-transaction channel restriction |

## Stripe (incremental — new capabilities this phase only)

| capability | decision | reason |
|---|---|---|
| `connect_destination_charges` (`transfer_data.destination`/`transfer_data.amount`) | INTEGRATE | Task 6 — the core USD checkout settlement path (D-04, PAY-17) |
| `connect_on_behalf_of` (cross-border settlement-merchant designation) | INTEGRATE | Task 6 — required conditionally per the platform/connected-account country pairing (RESEARCH.md Pitfall 3, Open Question 2); decided during the human credentials-setup checkpoint, not assumed either way. Recorded here as INTEGRATE rather than OPT-OUT because omitting it silently when the countries differ is exactly the failure mode this gate exists to prevent — the planner must include the country check and conditional field, not skip it |
| `refund_reverse_transfer` (`reverse_transfer` on a refund of a destination charge) | INTEGRATE | Task 7 — required to decide (not optional to build) per D-22/D-23 and Open Question 1; the planner must make Task 7's refund-service.ts pass `reverse_transfer` explicitly (`true` or `false`) per a recorded policy decision, never leave it at Stripe's implicit default by omission |
| `application_fee_amount` / Platform Pricing Tool | OPT-OUT | not used — this phase's fee model uses `transfer_data.amount` exclusively (D-04); RESEARCH.md confirms these are Stripe's two mutually exclusive fee-setting approaches and this phase commits to the `transfer_data` one |
| Connect account onboarding/creation | OPT-OUT | happens outside the LMS per D-02/D-05 — same pattern as Paystack subaccount creation; the deployment supplies an already-onboarded `STRIPE_CONNECTED_ACCOUNT_ID` via secret config |
| Stripe Billing / Subscriptions / Invoicing | OPT-OUT | not needed — one-time Checkout Session payment only, unchanged from Phase 6's model |
| Checkout Sessions core, webhook signature verification, direct (non-split) refund | *(already INTEGRATE, Phase 6)* | Out of this matrix's scope — already integrated and audited in `06-registration-checkout-stripe-payments/COVERAGE.md`; this phase only extends the session-creation params and the refund path's `reverse_transfer` behavior, both covered above |
