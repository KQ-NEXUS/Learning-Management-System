# Phase 7: Multi-Gateway Payments, Learner-Paid Fees, Split Settlement, Manual Payments and Refunds - Context

**Gathered:** 2026-09-11
**Status:** Approved for planning

<domain>
## Phase Boundary

Phase 7 migrates Phase 6's single-price, Stripe-direct-charge tracer into the approved production commerce model. Each LMS deployment still serves one school. Administrators enter separate NGN and USD base prices for each Cohort. NGN online orders use Paystack; USD online orders use Stripe; the LMS never converts between the two. The learner bears the school base price, KQ NEXUS's 1.5% platform fee, and the configured expected gateway charge. Provider-native split settlement preserves the school's base price and allocates KQ NEXUS's share. This phase also delivers the already-roadmapped manual-confirmation, duplicate/conflict, refund, secret-handling, and provider-event behavior.

Tenant provisioning, tenant selection, cross-school reporting, a KQ operator workspace, and automatic foreign-exchange conversion remain out of scope.

</domain>

<decisions>
## Implementation Decisions

### Deployment and settlement boundary

- **D-01:** The product remains **one school per LMS deployment**. KQ NEXUS's platform role exists only at the provider-settlement boundary and does not add tenants, a tenant selector, or cross-school UI.
- **D-02:** KQ NEXUS owns the online provider platform/integration accounts. Each deployment supplies its one school's `PAYSTACK_SUBACCOUNT_CODE` and `STRIPE_CONNECTED_ACCOUNT_ID` through deployment-managed secret configuration. These identifiers never enter learner forms, exports, audit details, or administrator-editable fields.
- **D-03:** Paystack NGN payments use a split transaction against the school's subaccount. The per-transaction `transaction_charge` equals the snapshotted KQ platform fee plus gateway gross-up; `bearer` remains the KQ/main account so Paystack deducts its actual fee from KQ's allocation and the school receives the base price.
- **D-04:** Stripe USD payments use a Connect destination charge. `transfer_data.destination` is the school's connected account and `transfer_data.amount` equals the snapshotted base price. The KQ platform account bears Stripe's actual fee.
- **D-05:** School onboarding/capability verification happens outside the LMS. Checkout fails closed with a support route when the deployment's required school account identifier is absent or the provider reports that the account cannot receive the intended settlement.

### Price ownership and routing

- **D-06:** A Cohort stores **two independent administrator-entered base prices**: NGN and USD. No exchange rate is stored or applied; changing one never changes the other.
- **D-07:** The learner selects the offered currency before order creation. `NGN -> PAYSTACK` and `USD -> STRIPE` are fixed server-side mappings. Client input cannot select Stripe for NGN or Paystack for USD.
- **D-08:** A published Cohort must have a positive base price for every enabled online rail. During migration, the existing `priceMinor/currency` value is copied into the matching new price field; a missing other-currency price remains absent and that rail is unavailable until an administrator supplies it.
- **D-09:** Currency and provider are immutable after Order creation. Changing currency follows Phase 6 D-06: supersede/cancel the pending order and create a fresh order and hold. It must never produce a second paid effect or active enrolment.

### Fee calculation and immutable snapshots

- **D-10:** KQ NEXUS's platform fee is exactly **150 basis points (1.5%) of the base price**: `platformFeeMinor = roundHalfUp(baseAmountMinor * 150 / 10_000)`. It is never 1.5% of the learner total.
- **D-11:** Provider fee rules are immutable, effective-dated `GatewayFeeSchedule` records containing provider, currency, percentage basis points, fixed minor amount, optional waiver threshold, optional cap, tax basis points, rounding rule, effective-from time, and active status. Public standard rates are seed examples, not hard-coded permanent truth.
- **D-12:** The gateway gross-up is calculated so the expected provider deduction is borne by the learner. For an uncapped percentage-plus-fixed fee, `totalMinor = ceil((baseAmountMinor + platformFeeMinor + fixedMinor) / (1 - rate))`, with tax included in the configured effective rate, and `gatewayFeeEstimateMinor = totalMinor - baseAmountMinor - platformFeeMinor`. Thresholds and caps are applied before final upward rounding.
- **D-13:** Order creation snapshots `baseAmountMinor`, `platformFeeMinor`, `gatewayFeeEstimateMinor`, `amountMinor` (the learner total), `currency`, `selectedProvider`, `gatewayFeeScheduleId/version`, and `schoolSettlementExpectedMinor`. Later Cohort or fee-schedule edits never change an existing Order or receipt.
- **D-14:** PaymentAttempt snapshots the provider request allocation and later records `gatewayFeeActualMinor`, `schoolSettlementActualMinor`, `platformGrossActualMinor`, and `platformNetActualMinor` where provider evidence makes them available. Expected and actual values are never conflated.
- **D-15:** Manual payment carries the same 1.5% platform fee but has a zero gateway-fee estimate. Because no provider split occurs, authorized confirmation must record the school amount and KQ allocation/remittance evidence as part of the manual confirmation audit.

### Learner and staff experience

- **D-16:** Offer pages show “Pay in NGN with Paystack” and “Pay in USD with Stripe” using the administrator-entered base prices. The order-summary page shows four separate rows: School fee, KQ NEXUS platform fee (1.5%), Estimated payment-processing fee, and Total charged, followed by currency/provider.
- **D-17:** The summary discloses that the provider fee is calculated from the configured expected schedule. This is especially important for Stripe because actual card-origin, payment-method, tax, and currency-conversion charges can vary; that variance affects KQ NEXUS's reconciled net, not the school's fixed base transfer or the already-charged learner total.
- **D-18:** Receipts preserve the four-line charged breakdown. Finance payment detail additionally shows expected school/KQ values, actual gateway charge and actual school/KQ settlement when reconciled, plus a visible exception if the invariant does not match.
- **D-19:** Provider/currency unavailability is explicit and recoverable. The UI does not show a selectable but doomed payment option.

### Provider events, refunds, and security

- **D-20:** Paystack and Stripe adapters feed Phase 6's shared, provider-neutral settlement state machine. Only a signature-verified/correlated server event or authorized manual confirmation may mark an order paid.
- **D-21:** Webhook idempotency is provider plus provider-event ID. Provider-specific evidence is normalized before the shared settlement service is invoked; raw secrets and unrestricted payloads are never stored.
- **D-22:** Refunds remain capped at eligible captured value and route to the original provider. The Refund record stores the learner refund amount and component allocation across base, platform, and gateway amounts so Finance can reconcile reversals. Whether processing fees are recoverable from a provider follows the approved refund policy and provider response; the system records the actual outcome rather than assuming a fee return.
- **D-23:** A full learner refund request means the full captured learner total. A partial refund requires Finance to enter the learner-facing amount; allocation consumes refundable base and platform components according to the approved refund service rule and records any non-recoverable gateway cost as a KQ reconciliation variance. Access decisions remain separately explicit and audited.
- **D-24:** All monetary arithmetic uses integer minor units with checked overflow and deterministic rounding. No floating-point calculation is allowed in domain or provider code.

### Worked acceptance example

- **D-25:** With an administrator-entered NGN base price of `45_000_000` kobo (NGN 450,000), KQ's 1.5% fee is `675_000` kobo (NGN 6,750). Under Paystack's public Nigeria local schedule of 1.5% + NGN 100 capped at NGN 2,000, the cap applies, so the gateway gross-up is `200_000` kobo and the learner total is `45_875_000` kobo (NGN 458,750). The Paystack split sends NGN 450,000 to the school, allocates NGN 8,750 gross to KQ, deducts NGN 2,000 from KQ, and leaves KQ net NGN 6,750. If the deployment has approved educational/contract pricing, its configured schedule replaces this example without changing the formula contract.

### Agent discretion

- Exact names of pure calculator helper functions and view-model types, provided their input/output contracts preserve D-10 through D-14.
- Exact layout within existing design-system components, provided D-16 through D-19 are all visible and accessible.
- Whether actual provider settlement enrichment happens inline after verification or through the existing worker, provided paid activation is not delayed and reconciliation is idempotent.

</decisions>

<canonical_refs>
## Canonical References

- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` Revision 4, especially Sections 11.4 and 19.
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` Revision 4 checkout contract in Section 12.0.
- `.planning/REQUIREMENTS.md` COH-02, PAY-03 through PAY-05, PAY-07 through PAY-17.
- `.planning/phases/06-registration-checkout-stripe-payments/06-CONTEXT.md` for the existing hold, checkout, Stripe Checkout, and server-verified settlement behavior being migrated.
- `prisma/schema.prisma` for Cohort, Order, PaymentAttempt, Refund, WebhookEvent, PaymentProvider, and the shared payment states.
- `src/server/services/checkout-service.ts`, `src/server/services/checkout-webhook-system-service.ts`, and `src/server/services/seat-accounting.ts` for existing transactional and idempotency boundaries.
- `src/server/payments/providers/stripe/checkout-session.ts` and `src/server/payments/providers/stripe/webhook.ts` for the provider isolation pattern.
- Paystack official Split Payments and Transaction API documentation for `subaccount`, `transaction_charge`, and `bearer`.
- Stripe official Connect destination-charge documentation for `transfer_data.destination` and fixed `transfer_data.amount`.

</canonical_refs>

<deferred>
## Deferred Ideas

- Automatic NGN/USD foreign-exchange conversion.
- Learner-selected gateway independent of currency.
- Multi-school tenant management or a KQ cross-school operator dashboard inside this LMS.
- Dynamic card-origin pricing before Stripe Checkout; the exact card-origin fee is not reliably known at order creation.
- Administrator editing of provider credentials, school account identifiers, or fee schedules through the LMS.

</deferred>

---

*Phase: 7 - Multi-Gateway Payments, Learner-Paid Fees, Split Settlement, Manual Payments and Refunds*
*Context approved: 2026-09-11*
