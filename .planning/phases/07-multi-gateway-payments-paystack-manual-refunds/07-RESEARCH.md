# Phase 7: Multi-Gateway Payments, Learner-Paid Fees, Split Settlement, Manual Payments and Refunds — Research

**Researched:** 2026-09-12
**Domain:** Dual-currency checkout, Paystack split payments, Stripe Connect destination charges, manual payment/refund reconciliation
**Confidence:** HIGH

## Summary

A separate (non-GSD) planning process already produced a complete, self-reviewed 9-task TDD implementation plan for this phase: `docs/superpowers/plans/2026-09-11-dual-currency-fee-splitting.md`, backed by `docs/superpowers/specs/2026-09-11-dual-currency-fee-splitting-design.md`. That plan is **authoritative and should not be redesigned**. This research (1) validates every one of its 9 tasks' file/interface assumptions against the codebase as it exists today, one day after the plan's authoring date, (2) resolves a confirmed, material drift — the `worker/` directory the plan's Task 7 targets no longer exists — and (3) adds concrete Paystack/Stripe API detail the superpowers plan asserts but does not cite verbatim, so the GSD planner can write `<action>` blocks without re-deriving API shapes from memory.

The single most consequential finding: `worker/` and its `pg-boss` dependency were removed between the superpowers plan's authoring (2026-09-11) and today, replaced by Netlify Scheduled Functions (`netlify/functions/*.ts` calling into `src/server/scheduled/*-task.ts`). Task 7's `worker/handlers/reconcile-payments.ts` / `worker/index.ts` file targets must be translated to this pattern; a concrete replacement shape is given below. Every other task's file and interface assumptions were checked against the live tree and confirmed accurate — the schema has none of Task 1's proposed fields yet, `checkout-service.ts`/`checkout-webhook-system-service.ts`/the Stripe provider files/`checkout-phase-invariants.test.ts` are all in the exact shape the superpowers plan assumes, with one additional gap found: `checkout-phase-invariants.test.ts`'s provider-isolation scan today checks **only** the `"stripe"` import specifier — it does not yet know about Paystack, so Task 5's claim that this test "shows no Paystack-specific type/import outside its adapter" requires the scan itself to be extended to check a second specifier, not merely relies on an existing check.

**Primary recommendation:** Translate the superpowers plan's 9 tasks into 9 (or more, if the planner wants finer wave granularity) GSD PLAN.md files with `<action>` blocks, using this document's per-task annotations to fill in exact current-state file contents, the corrected Task 7 scheduled-function shape, and the Paystack/Stripe API field names cited below — do not re-research the domain from scratch.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Dual-price Cohort admin input | API/Backend (server action) | Browser (form) | Validation and decimal-to-minor-unit conversion must happen server-side (D-06); the form is presentational |
| Fee calculation (platform fee, gateway gross-up) | API/Backend (pure module) | — | `src/server/payments/pricing.ts` must be a pure, dependency-free calculator — no DB, no provider SDK — so it is independently testable and reusable by both providers |
| Currency→provider routing | API/Backend | — | Server-derived only (D-07); client input must never select the provider |
| Order snapshot creation | API/Backend (transaction) | Database | Must happen inside the same transaction as the seat hold (existing `startCheckout` pattern) |
| Paystack split initiation | API/Backend (isolated adapter) | External Gateway | Mirrors the existing `providers/stripe/` isolation boundary; PAY-09 requires zero leakage outside the adapter directory |
| Stripe Connect destination charge | API/Backend (isolated adapter) | External Gateway | Same PAY-09 isolation boundary, existing `providers/stripe/` directory |
| Webhook signature verification | API/Backend | — | Server-side only, raw-body HMAC; never trusted from a client redirect |
| Settlement state transition (paid/exception) | API/Backend (shared service) | Database | Single shared, provider-neutral service (`checkout-webhook-system-service.ts`) — PAY-10's single-writer invariant is enforced structurally, see Pitfall below |
| Payment reconciliation (actual vs. expected) | API/Backend (scheduled function) | Database | Off-request enrichment; Netlify Scheduled Function per the corrected Task 7 shape below |
| Manual payment confirmation | API/Backend (staff action) | Database | Permission-gated (`payments.confirm`), still routes through the one shared settlement transition |
| Refund processing | API/Backend (staff action + provider adapter) | External Gateway | Routes to the original provider's refund API; component allocation is a pure calculation |
| Learner fee breakdown display | Browser/Frontend Server (SSR) | — | Pure presentation of server-computed, already-snapshotted values; no client-side money math |
| Finance payment detail view | API/Backend (permission-scoped read) | Browser | `payments.view`-gated; expected vs. actual reconciliation display |

## User Constraints

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Deployment and settlement boundary**
- **D-01:** The product remains **one school per LMS deployment**. KQ NEXUS's platform role exists only at the provider-settlement boundary and does not add tenants, a tenant selector, or cross-school UI.
- **D-02:** KQ NEXUS owns the online provider platform/integration accounts. Each deployment supplies its one school's `PAYSTACK_SUBACCOUNT_CODE` and `STRIPE_CONNECTED_ACCOUNT_ID` through deployment-managed secret configuration. These identifiers never enter learner forms, exports, audit details, or administrator-editable fields.
- **D-03:** Paystack NGN payments use a split transaction against the school's subaccount. The per-transaction `transaction_charge` equals the snapshotted KQ platform fee plus gateway gross-up; `bearer` remains the KQ/main account so Paystack deducts its actual fee from KQ's allocation and the school receives the base price.
- **D-04:** Stripe USD payments use a Connect destination charge. `transfer_data.destination` is the school's connected account and `transfer_data.amount` equals the snapshotted base price. The KQ platform account bears Stripe's actual fee.
- **D-05:** School onboarding/capability verification happens outside the LMS. Checkout fails closed with a support route when the deployment's required school account identifier is absent or the provider reports that the account cannot receive the intended settlement.

**Price ownership and routing**
- **D-06:** A Cohort stores **two independent administrator-entered base prices**: NGN and USD. No exchange rate is stored or applied; changing one never changes the other.
- **D-07:** The learner selects the offered currency before order creation. `NGN -> PAYSTACK` and `USD -> STRIPE` are fixed server-side mappings. Client input cannot select Stripe for NGN or Paystack for USD.
- **D-08:** A published Cohort must have a positive base price for every enabled online rail. During migration, the existing `priceMinor/currency` value is copied into the matching new price field; a missing other-currency price remains absent and that rail is unavailable until an administrator supplies it.
- **D-09:** Currency and provider are immutable after Order creation. Changing currency follows Phase 6 D-06: supersede/cancel the pending order and create a fresh order and hold. It must never produce a second paid effect or active enrolment.

**Fee calculation and immutable snapshots**
- **D-10:** KQ NEXUS's platform fee is exactly **150 basis points (1.5%) of the base price**: `platformFeeMinor = roundHalfUp(baseAmountMinor * 150 / 10_000)`. It is never 1.5% of the learner total.
- **D-11:** Provider fee rules are immutable, effective-dated `GatewayFeeSchedule` records containing provider, currency, percentage basis points, fixed minor amount, optional waiver threshold, optional cap, tax basis points, rounding rule, effective-from time, and active status. Public standard rates are seed examples, not hard-coded permanent truth.
- **D-12:** The gateway gross-up is calculated so the expected provider deduction is borne by the learner. For an uncapped percentage-plus-fixed fee, `totalMinor = ceil((baseAmountMinor + platformFeeMinor + fixedMinor) / (1 - rate))`, with tax included in the configured effective rate, and `gatewayFeeEstimateMinor = totalMinor - baseAmountMinor - platformFeeMinor`. Thresholds and caps are applied before final upward rounding.
- **D-13:** Order creation snapshots `baseAmountMinor`, `platformFeeMinor`, `gatewayFeeEstimateMinor`, `amountMinor` (the learner total), `currency`, `selectedProvider`, `gatewayFeeScheduleId/version`, and `schoolSettlementExpectedMinor`. Later Cohort or fee-schedule edits never change an existing Order or receipt.
- **D-14:** PaymentAttempt snapshots the provider request allocation and later records `gatewayFeeActualMinor`, `schoolSettlementActualMinor`, `platformGrossActualMinor`, and `platformNetActualMinor` where provider evidence makes them available. Expected and actual values are never conflated.
- **D-15:** Manual payment carries the same 1.5% platform fee but has a zero gateway-fee estimate. Because no provider split occurs, authorized confirmation must record the school amount and KQ allocation/remittance evidence as part of the manual confirmation audit.

**Learner and staff experience**
- **D-16:** Offer pages show "Pay in NGN with Paystack" and "Pay in USD with Stripe" using the administrator-entered base prices. The order-summary page shows four separate rows: School fee, KQ NEXUS platform fee (1.5%), Estimated payment-processing fee, and Total charged, followed by currency/provider.
- **D-17:** The summary discloses that the provider fee is calculated from the configured expected schedule. This is especially important for Stripe because actual card-origin, payment-method, tax, and currency-conversion charges can vary; that variance affects KQ NEXUS's reconciled net, not the school's fixed base transfer or the already-charged learner total.
- **D-18:** Receipts preserve the four-line charged breakdown. Finance payment detail additionally shows expected school/KQ values, actual gateway charge and actual school/KQ settlement when reconciled, plus a visible exception if the invariant does not match.
- **D-19:** Provider/currency unavailability is explicit and recoverable. The UI does not show a selectable but doomed payment option.

**Provider events, refunds, and security**
- **D-20:** Paystack and Stripe adapters feed Phase 6's shared, provider-neutral settlement state machine. Only a signature-verified/correlated server event or authorized manual confirmation may mark an order paid.
- **D-21:** Webhook idempotency is provider plus provider-event ID. Provider-specific evidence is normalized before the shared settlement service is invoked; raw secrets and unrestricted payloads are never stored.
- **D-22:** Refunds remain capped at eligible captured value and route to the original provider. The Refund record stores the learner refund amount and component allocation across base, platform, and gateway amounts so Finance can reconcile reversals. Whether processing fees are recoverable from a provider follows the approved refund policy and provider response; the system records the actual outcome rather than assuming a fee return.
- **D-23:** A full learner refund request means the full captured learner total. A partial refund requires Finance to enter the learner-facing amount; allocation consumes refundable base and platform components according to the approved refund service rule and records any non-recoverable gateway cost as a KQ reconciliation variance. Access decisions remain separately explicit and audited.
- **D-24:** All monetary arithmetic uses integer minor units with checked overflow and deterministic rounding. No floating-point calculation is allowed in domain or provider code.

**Worked acceptance example**
- **D-25:** With an administrator-entered NGN base price of `45_000_000` kobo (NGN 450,000), KQ's 1.5% fee is `675_000` kobo (NGN 6,750). Under Paystack's public Nigeria local schedule of 1.5% + NGN 100 capped at NGN 2,000, the cap applies, so the gateway gross-up is `200_000` kobo and the learner total is `45_875_000` kobo (NGN 458,750). The Paystack split sends NGN 450,000 to the school, allocates NGN 8,750 gross to KQ, deducts NGN 2,000 from KQ, and leaves KQ net NGN 6,750. If the deployment has approved educational/contract pricing, its configured schedule replaces this example without changing the formula contract.

### Claude's Discretion

- Exact names of pure calculator helper functions and view-model types, provided their input/output contracts preserve D-10 through D-14.
- Exact layout within existing design-system components, provided D-16 through D-19 are all visible and accessible.
- Whether actual provider settlement enrichment happens inline after verification or through the existing worker, provided paid activation is not delayed and reconciliation is idempotent. **Research finding: the "existing worker" no longer exists — see the Task 7 drift resolution below. This discretion area now resolves to "inline after verification, or through a Netlify Scheduled Function," not the pg-boss worker the CONTEXT.md text was written against.**

### Deferred Ideas (OUT OF SCOPE)

- Automatic NGN/USD foreign-exchange conversion.
- Learner-selected gateway independent of currency.
- Multi-school tenant management or a KQ cross-school operator dashboard inside this LMS.
- Dynamic card-origin pricing before Stripe Checkout; the exact card-origin fee is not reliably known at order creation.
- Administrator editing of provider credentials, school account identifiers, or fee schedules through the LMS.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COH-02 | Enrolment window, dates, timezone, capacity, independent NGN/USD prices, delivery mode, instructors, status; no FX; missing enabled-rail pricing blocks publication | Task 1 (Cohort dual-price columns), Task 3 (form/readiness), confirmed against live `cohort-service.ts`/`readiness-service.ts`/`CohortForm.tsx` below |
| PAY-03 | Staff with `payments.confirm` can confirm manual payment; amount/currency/date/channel/reference/evidence/reason required; one audit + one enrolment effect | Task 7 (`manual-payment-service.ts`); permission already exists in catalogue (confirmed) |
| PAY-04 | Duplicate/conflicting online-manual confirmation prevented; second success shows existing transaction + corrective path | Task 7 lifecycle tests; existing `PAYMENT_VALID_TRANSITIONS` empty-terminal-list pattern in `checkout-webhook-system-service.ts` extends directly |
| PAY-05 | Staff with `refunds.manage` records/initiates refunds; amount capped at eligible paid value | Task 7 (`refund-service.ts`); permission already exists |
| PAY-07 | Delayed/duplicated/out-of-order gateway notifications handled safely; ambiguous cases become a visible exception | Existing `WebhookEvent` model + `recordWebhookEventOrSkip` idempotency pattern, extended to Paystack in Task 5 |
| PAY-08 | NGN routes only to Paystack, USD only to Stripe; manual shown only when configured; no client pairing; no FX | Task 2 (`providerForCurrency`), Task 4 (server-derived routing) |
| PAY-11 | Payment initiation/confirmation/failure/cancellation/refund/reconciliation idempotent across methods | Task 7; `WebhookEvent.@@unique([provider, providerEventId])` (confirmed in schema) generalizes to Paystack for free |
| PAY-13 | Refund routes to original provider or records controlled manual outcome; capped at eligible paid value; auditable | Task 7 refund-service.ts; see Paystack Refund API and Stripe `reverse_transfer` findings below |
| PAY-14 | Gateway credentials/webhook secrets stay server-side only | D-02; existing `.env`-based `STRIPE_WEBHOOK_SECRET`/`PAYSTACK_SECRET_KEY` pattern |
| PAY-15 | KQ's 1.5% fee is exactly 1.5% of base, integer minor units, never of grossed total | Task 2 (`calculateCheckoutBreakdown`); D-10 |
| PAY-16 | Gateway gross-up calculated from an explicit versioned fee schedule; snapshot reproducible after config changes | Task 1 (`GatewayFeeSchedule`), Task 2, D-11/D-12/D-13 |
| PAY-17 | Provider-native split settlement; school gets base price; KQ gets platform allocation and bears actual gateway charge; expected-vs-actual reconcilable | Task 5 (Paystack split), Task 6 (Stripe destination charge), Task 7 (reconciliation) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- `AGENTS.md` (loaded via `CLAUDE.md`) states this is a customized Next.js fork with breaking changes from upstream Next.js — **read the relevant guide under `node_modules/next/dist/docs/` before writing any framework-touching code** (route handlers, server actions, scheduled-function wiring). This applies directly to Task 4/5/6/8's route and server-action edits, and to the corrected Task 7 Netlify Function wiring.
- The AGENTS.md block is regenerated by `next dev` (`node_modules/next/dist/server/lib/generate-agent-files.js`) — do not treat its removal from a diff as a real change; committing it keeps the tree clean, matching upstream Phase 6 practice.
- User memory: **never auto-commit** — every commit must be explicitly requested by the user, even mid-workflow. All 9 GSD plans for this phase must leave commits to be created only on explicit user instruction (mirrors the superpowers plan's own "Do not run `git commit`" global constraint, which the planner should carry forward verbatim into each PLAN.md rather than silently drop).

## Task-by-Task Drift Reconciliation

The superpowers plan's 9 tasks are carried forward verbatim below (not reproduced task text — see the source at `docs/superpowers/plans/2026-09-11-dual-currency-fee-splitting.md`), each annotated with what this research confirmed or corrected against the current tree.

### Task 1 — Additive dual-price and financial-snapshot schema
**Status: CONFIRMED, no drift.**

Read `prisma/schema.prisma` in full this session `[VERIFIED: prisma/schema.prisma:729-801,1227-1351]`. Confirmed:
- `Cohort` today has only `priceMinor Int` and `currency String @default("NGN")` (lines 759-760) — no `priceNgnMinor`/`priceUsdMinor` exist yet. Task 1's additive columns are genuinely new.
- No `GatewayFeeSchedule` model exists anywhere in the schema. Genuinely new.
- `Order` (lines 1227-1260) has `amountMinor`, `currency`, `status`, `selectedProvider`, `idempotencyKey`, `correlationId` — none of `baseAmountMinor`, `platformFeeMinor`, `gatewayFeeEstimateMinor`, `gatewayFeeScheduleId/Version`, `schoolSettlementExpectedMinor` exist. Genuinely new, additive.
- `PaymentAttempt` (lines 1264-1305) has no actual-settlement fields (`gatewayFeeActualMinor`, `schoolSettlementActualMinor`, `platformGrossActualMinor`, `platformNetActualMinor`). Genuinely new.
- `Refund` (lines 1309-1333) has only `amountMinor`/`currency`/`provider`/`providerRef`/`reason`/`approverRef`/`accessDecision`/`status` — no base/platform/gateway component-allocation fields. Genuinely new.
- Migration directory naming convention confirmed: `prisma/migrations/YYYYMMDDHHMMSS_snake_case_name/migration.sql` (8 existing migrations follow this exact pattern) `[VERIFIED: prisma/migrations directory listing]`. The plan's proposed `20260911120000_dual_currency_split_settlement` name fits.
- `PaymentStatus` enum already includes `PENDING_MANUAL_REVIEW` (schema.prisma:141-148) — reserved for this phase, not yet used by any code path. `RefundStatus` enum already includes `RECORDED_MANUALLY` (lines 160-166) for the manual-refund outcome D-22/D-23 describe. Both enums need no schema change for Tasks 5-7 to use them.

### Task 2 — Integer fee calculator and routing policy
**Status: CONFIRMED, no drift.** No `src/server/payments/pricing.ts` or `routing.ts` exist yet (only `.gitkeep` and the Stripe subdirectory are present under `src/server/payments/providers/`, and no files at all exist directly under `src/server/payments/`). Genuinely new, pure, dependency-free modules as the plan describes.

### Task 3 — Cohort administration and publication readiness
**Status: CONFIRMED, no drift.**
- `src/app/staff/cohorts/CohortForm.tsx` today renders `priceMinor`/`currency` as a single price field pair (confirmed via grep: lines 59-60, 299-326) `[VERIFIED: src/app/staff/cohorts/CohortForm.tsx:59-60,299-326]`.
- `src/app/staff/cohorts/actions.ts` validates `priceMinor`/`currency` with `z.coerce`/length(3) (lines 62-69, 128-129, 193-194) `[VERIFIED: src/app/staff/cohorts/actions.ts:62-69,128-129,193-194]`.
- `src/server/services/readiness-service.ts`'s `ReadinessCohortInput` type carries `priceMinor: number; currency: string | null` (lines 268-269) and the price check (lines 350-364) is a single currency+non-negative-price test `[VERIFIED: src/server/services/readiness-service.ts:262-269,350-364]`. This is exactly the single-price shape Task 3 needs to replace with "positive price for every enabled online rail" (D-08).

### Task 4 — Snapshot price/fees/currency/provider at Order creation
**Status: CONFIRMED, no drift — one signature gap flagged.**

Read `src/server/services/checkout-service.ts` in full this session `[VERIFIED: src/server/services/checkout-service.ts:266-351]`. `startCheckout(actor: Actor, cohortId: string): Promise<{ orderId: string }>` today takes **no currency parameter** — it reads `cohort.priceMinor`/`cohort.currency` directly (lines 275-278, 307-308) and writes them straight onto the new `Order` row with no provider derivation and no fee calculation. This confirms Task 4's proposed new signature `startCheckout(actor, cohortId, currency)` is the exact, minimal change needed — nothing else in the transaction shape (the `lockOpenCohort` → `tx.enrolment.findFirst` supersede check → `tx.order.create` → `takeSeat` → `writeDomainEvent` sequence) needs restructuring, only the data computed before `tx.order.create` changes.

`getOwnOrder`/`getOwnOrderByReference`/`getOwnVerificationStatus`/`getCohortOfferPath` (all confirmed present) must be preserved unchanged — Task 4's file list already only touches `startCheckout` and the two page/action files that call it.

### Task 5 — Provider-neutral initiation interface + Paystack split payments
**Status: CONFIRMED for files; ONE MATERIAL GAP found in the invariant test's current capability.**

Read `tests/checkout-phase-invariants.test.ts` in full this session `[VERIFIED: tests/checkout-phase-invariants.test.ts:1-271]`. Its provider-isolation scan (`findProviderIsolationViolations`, lines 89-100) does exactly one check today: `if (specifier === "stripe")` (line 94) against every source file outside `STRIPE_PROVIDER_DIR = path.join("server", "payments", "providers", "stripe")` (line 30). **It has no knowledge of Paystack at all** — there is no `PAYSTACK_PROVIDER_DIR` constant, no second specifier check, and no fixture test for a Paystack violation.

This means Task 5 Step 4's claim "provider-isolation tests show no Paystack-specific type/import outside its adapter and webhook route" is **not yet true of the existing test** — the superpowers plan's Step 1 ("Write failing adapter, isolation, and webhook tests") must include *extending this shared invariants file* to add a second directory constant (e.g. `PAYSTACK_PROVIDER_DIR`) and a second specifier check (there is no Paystack npm package to check against — see the API research below; the isolation concern here is narrower: no *custom Paystack request/response TypeScript type* defined inside `providers/paystack/` should be imported from outside it). The GSD planner should have Task 5's plan generalize `findProviderIsolationViolations` to accept a list of `{ dir, specifiers }` pairs (Stripe's `"stripe"` plus Paystack's own internal type-module specifier(s)) rather than add a parallel, duplicate scan function — duplicating the walk function is exactly the kind of drift this file's own header comment warns against.

`assertSinglePaidOrderWriter` (lines 154-169) is a **hard structural gate**: exactly one file in `src/` may contain an object-literal `status: "PAID"` property assignment, and it must be `src/server/services/checkout-webhook-system-service.ts` `[VERIFIED: tests/checkout-phase-invariants.test.ts:151-169, quoted constant \`const SETTLEMENT_SERVICE_SUFFIX = "src/server/services/checkout-webhook-system-service.ts"\`]`. This means: the new `src/app/api/webhooks/paystack/route.ts` webhook route, `manual-payment-service.ts`, and `payment-reconciliation-service.ts` (all Task 5/7 new files) **must never themselves write `status: "PAID"`** — every one of them must call into the (generalized, provider-neutral) settlement transition inside `checkout-webhook-system-service.ts`. The superpowers plan's Task 7 Step 3 ("Keep `activateOrderAsSystem` as the only online paid transition") already states this correctly in prose; this research confirms it is also a mechanically enforced, pre-existing test gate, not just a design intention — the planner should cite this test by name in Task 5 and Task 7's `must_haves`/`acceptance_criteria`.

`src/server/payments/providers/` today contains only `stripe/` (three files) and a root `.gitkeep` `[VERIFIED: directory listing]` — `providers/paystack/` and `src/app/api/webhooks/paystack/route.ts` are genuinely new, no existing file to reconcile against.

**Paystack API research (fills the gap the superpowers plan asserts but does not cite verbatim):**

**Confidence note:** `paystack.com/docs/payments/split-payments/` itself returned HTTP 403 to every direct fetch attempt this session (both the researcher subagent's and a follow-up direct attempt), and `web.archive.org` is blocked at the tool level in this environment. The facts below were nonetheless **directly fetched and read in full**, not just search-synthesized, from Paystack's own official documentation source repository: `https://raw.githubusercontent.com/PaystackHQ/documentation/master/receiving-payments/split-payments.md` (the exact GitHub-mirrored source of the `paystack.com/docs/payments/split-payments/` page — confirmed by content match, fetched via `curl` after `WebSearch` located the mirror, full 67-line file read this session). This upgrades this subsection from the researcher subagent's original MEDIUM confidence (WebSearch-synthesized) to HIGH — every field name and behavior below is a direct quote/paraphrase of the canonical doc, not a secondary summary.

- Split-a-transaction-with-one-subaccount shape, `[CITED: github.com/PaystackHQ/documentation, receiving-payments/split-payments.md, fetched directly, mirrors paystack.com/docs/payments/split-payments/]`: pass `subaccount: "SUB_ACCOUNTCODE"` alongside the normal transaction-initialization parameters (confirmed exact curl example: `POST https://api.paystack.co/transaction/initialize` with `reference`, `amount`, `email`, `subaccount` in the JSON body). This is the single-subaccount split path (not the separate Transaction Split API / "multi-split" feature for >1 subaccount, which this phase does not need — one school per deployment, D-01).
- Subaccount creation returns `subaccount_code` and `account_name`, `[CITED: same source]`: "When a subaccount is created, the `subaccount_code` and the `account_name` is returned." Confirms D-02's `PAYSTACK_SUBACCOUNT_CODE` is exactly this returned `subaccount_code` value, supplied outside the LMS (D-05) via deployment secrets.
- Default split is by percentage, set at subaccount-creation time, `[CITED: same source]`: "Payments are split on Paystack by percentage i.e. 20% going to main account and the rest going to subaccount. These parameters are required when creating the subaccount." Confirms the subaccount's own `percentage_charge` is a creation-time value the LMS never sets or edits (D-05).
- `transaction_charge` (integer, subunit of the currency — kobo for NGN), `[CITED: same source]`: "there are instances where you will rather collect a flat fee per payment. To do this, pass a parameter called `transaction_charge = 1000 //amount in kobo`." This overrides the subaccount's creation-time percentage split for that one transaction. This is exactly D-03's mechanism: the subaccount's own `percentage_charge` (set at subaccount-creation time, outside the LMS per D-05) is overridden per-transaction by the computed `platformFeeMinor + gatewayFeeEstimateMinor` value.
- `bearer` (string enum `"account" | "subaccount"`, default `"account"`), `[CITED: same source]`: "You can use which party bears the Paystack charges when making a split payment... By default, the charges are borne by the main account. To change this to the subaccount, pass a parameter `bearer: "subaccount"` on initializing a transaction." **Only these two values are documented anywhere in this canonical source** — no third option exists. D-03 wants the default (`bearer: "account"`, i.e. KQ's main account bears Paystack's actual fee) — the adapter should pass it explicitly rather than rely on the default, for auditability and forward-compatibility if Paystack ever changes its own default.
- Current limitation, `[CITED: same source]`: "At the moment, payments can only be split across two accounts" — confirms the one-subaccount-per-transaction model is Paystack's only supported shape for this use case; no future-proofing needed for N-way splits.
- Initialize Transaction request fields relevant to this phase, `[CITED: paystack.com/docs/api/transaction/ (via search-verified secondary source, not fetched directly — see Sources)]`: `email` (required), `amount` (required, integer, kobo), `currency` (optional, defaults to integration currency — must be passed explicitly as `"NGN"` for defense in depth per D-07), `reference` (optional — the adapter should pass the `Order.reference` explicitly, mirroring Stripe's `client_reference_id` correlation pattern, rather than let Paystack generate one), `callback_url`, `metadata`, `channels` (array — the plan does not need to set this; Paystack defaults to all enabled channels for the integration).
- Webhook signature verification, `[CITED: paystack.com/docs/payments/webhooks/, via search-verified secondary sources]`: Paystack signs the raw event body with **HMAC-SHA512** (not SHA-256) keyed by the account's secret key, delivered in the `x-paystack-signature` request header. Verification must (a) read the raw request body as text before any JSON parsing — exactly the discipline `verifyStripeWebhook` already applies (`req.text()` first, never re-parsed) — (b) compute `HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)` and (c) compare to the header value in constant time (Node's `crypto.timingSafeEqual`, not `===`). Best practice per the same sources: verify the signature, return `200` promptly, *then* independently call the Verify Transaction endpoint (`GET https://api.paystack.co/transaction/verify/:reference`) before trusting `status === "success"` from the webhook payload alone — mirroring this codebase's existing "the webhook is signature-verified, but the *content* of what to trust is narrowly allow-listed before persistence" discipline (D-21).
- Transaction verification response gotcha, `[CITED: github.com/PaystackHQ/documentation, receiving-payments/verifying-the-transaction.md, fetched directly]`: "check for `data.status==='success'` not `status=='success'`. The first checks for if the actual transaction was successful while the second checks if the API call was successful." This is a real, named pitfall to carry into the adapter's response-parsing code and into the Common Pitfalls section below.
- Refund API, `[CITED: paystack.com/docs/api/refund/, via search-verified secondary source]`: `POST https://api.paystack.co/refund` with `transaction` (reference or numeric id, required), `amount` (optional, minor units, omit for full refund, "cannot be more than the original transaction amount"), `currency`, `merchant_note`. This is what `refund-service.ts` (Task 7) should call for a Paystack-provider Refund. No `reverse_transfer`-equivalent parameter was found in Paystack's refund API in the sources checked — for a split transaction, whether/how Paystack automatically reverses the subaccount's portion of a refund was **not confirmed by any source fetched this session**; treat this as an open question requiring a direct provider-support confirmation or a Paystack sandbox refund-of-a-split-transaction test before Task 7's Paystack refund path ships (see Open Questions).
- Subaccount creation, `[CITED: paystack.com/docs/api/subaccount/, via search-verified secondary source]`: `POST https://api.paystack.co/subaccount` with `business_name`, `settlement_bank` (bank code), `account_number`, `percentage_charge` (required). This happens **outside the LMS per D-05** — confirms the superpowers plan correctly scopes subaccount creation out of any GSD task; the LMS only ever reads `PAYSTACK_SUBACCOUNT_CODE` from deployment secrets and never calls this endpoint.
- No official Paystack Node.js SDK is a project dependency today `[VERIFIED: package.json — grep for /paystack/i on dependencies+devDependencies returned no matches]`, and the superpowers plan's own Tech Stack line names "Paystack HTTPS API" (not an SDK). This confirms `providers/paystack/client.ts` should be a raw `fetch()`-based wrapper (Node 20+/Next 16's runtime has global `fetch`), not an npm package — **no package-legitimacy audit is needed for this phase's Paystack integration** since no new payment-gateway package is being installed.

### Task 6 — Stripe Checkout → USD Connect destination charges
**Status: CONFIRMED for files; real API detail added; one cross-border gotcha flagged.**

Read `src/server/payments/providers/stripe/checkout-session.ts` in full this session `[VERIFIED: src/server/payments/providers/stripe/checkout-session.ts:21-55]`. `buildCheckoutSessionParams` today builds `mode: "payment"`, `line_items[0].price_data.unit_amount: args.amountMinor`, `client_reference_id`, `metadata`, `payment_intent_data.metadata` — **no `transfer_data` field exists yet**. This confirms Task 6's described change ("extend the existing pure builder input with `schoolSettlementMinor` and `connectedAccountId`") is additive to an existing, unmodified-since-Phase-6 function — no restructuring needed beyond adding the two new args and one new object key.

Read `src/server/payments/providers/stripe/webhook.ts` in full `[VERIFIED: src/server/payments/providers/stripe/webhook.ts:1-45]` and `src/app/api/webhooks/stripe/route.ts` in full `[VERIFIED: src/app/api/webhooks/stripe/route.ts:1-135]`. Confirmed the route reads raw body via `req.text()` before signature verification (line 55), never re-parses, and correlates via `client_reference_id`/`payment_intent_data.metadata.orderId` exactly as the plan assumes. Task 6's only route change is adding the destination-transfer fields to the session-creation params passed through `checkout-service.ts`'s existing `deps.stripe.checkout.sessions.create()` call site — the webhook route itself needs no structural change beyond whatever new evidence fields Task 7's reconciliation wants captured.

**Stripe Connect destination-charge API research (fetched directly, full text):**

- Exact Checkout Session fields, `[CITED: docs.stripe.com/connect/destination-charges, fetched directly]`: `payment_intent_data[transfer_data][destination]` = the connected account ID (`STRIPE_CONNECTED_ACCOUNT_ID`) and `payment_intent_data[transfer_data][amount]` = a positive integer, "the amount of the charge to be transferred to the `transfer_data[destination]`" — confirming D-04/Task 6's `transfer_data.amount === order.baseAmountMinor` is exactly the documented parameter, not an approximation.
- Fund flow confirmed by Stripe's own worked example (10 USD charge, 8.77 USD `transfer_data[amount]`, 0.59 USD Stripe fee): "charge `amount` (10.00 USD) is added to the platform account's balance. The `transfer_data[amount]` (8.77 USD) is subtracted from the platform account's balance and added to the connected account's pending balance... a net amount of 0.64 USD[] remains in the platform account's pending balance." This is the precise mechanism behind D-04's "KQ platform account bears Stripe's actual fee."
- **Cross-border gotcha not mentioned in the superpowers plan**, `[CITED: docs.stripe.com/connect/destination-charges]`: "With certain exceptions, if your platform and a connected account aren't in the same region, you must specify the connected account as the settlement merchant using the `on_behalf_of` parameter on the... Checkout Session." If KQ NEXUS's Stripe platform account and the school's `STRIPE_CONNECTED_ACCOUNT_ID` are registered in different countries (plausible: KQ NEXUS platform account country vs. a Nigeria- or other-jurisdiction school on the USD/Stripe rail), the destination charge **may require `payment_intent_data[on_behalf_of]` in addition to `transfer_data[destination]`**, or it will fail. Setting `on_behalf_of` also changes whose statement descriptor and settlement currency apply (documented in the same source). The superpowers plan's Task 6 does not mention `on_behalf_of` at all. **The planner should add a checkpoint to confirm the platform-account/connected-account country relationship during the human credentials-setup gate (see below) before deciding whether `on_behalf_of` is required** — this is not knowable without the actual Stripe test-mode connected account.
- **Refund mechanics gap not in the superpowers plan**, `[CITED: docs.stripe.com/connect/destination-charges]`: "When refunding a charge that has a `transfer_data[destination]`, by default the destination account keeps the funds that were transferred to it, leaving the platform account to cover the negative balance from the refund. To pull back the funds from the connected account to cover the refund, set the `reverse_transfer` parameter to `true`." This is directly relevant to Task 7's `refund-service.ts` and D-22/D-23: **a decision is needed on whether Stripe refunds in this phase pass `reverse_transfer: true`** (pull the base-price transfer back from the school) or `false`/omitted (KQ's platform account absorbs the negative balance and the school keeps its settled base price). CONTEXT.md does not resolve this explicitly. This is flagged as an open question below — it materially changes what "component allocation" (D-22) means for a Stripe refund's `schoolSettlement` component. A related `refund_application_fee` parameter exists for the `application_fee_amount` approach but is **not applicable** here since Task 6 uses `transfer_data[amount]`, not `application_fee_amount` (confirmed: the superpowers design doc's D-04/`transfer_data.amount = baseAmountMinor` model matches Stripe's "in-house pricing rules... `transfer_data[amount]` parameter" path, not the Platform Pricing Tool / `application_fee_amount` path — these are documented as mutually exclusive fee-setting approaches).
- Test-mode setup requirement, `[CITED: docs.stripe.com/connect/destination-charges + test-card table, fetched directly]`: needs (1) a Stripe test-mode connected account (created via the Stripe Dashboard or Connect onboarding in test mode) to obtain a test `STRIPE_CONNECTED_ACCOUNT_ID` (format `acct_...`), and (2) the standard Stripe test cards (`4242424242424242` success, `4000000000009995` decline, etc. — same table Phase 6 already used for the non-split flow). This mirrors Phase 6's 06-01 human package-legitimacy + credentials gate exactly, and the same `stripe` npm package (already pinned at `22.6.1` and human-approved per STATE.md) is reused — **no new package-legitimacy audit is needed for Stripe in this phase**, only a new credentials artifact (`STRIPE_CONNECTED_ACCOUNT_ID`) requiring the same kind of human-in-the-loop setup checkpoint 06-01 used for the Stripe secret/webhook keys.

### Task 7 — Settlement normalization, reconciliation, manual payments, refunds
**Status: MATERIAL DRIFT CONFIRMED AND RESOLVED (worker → Netlify Scheduled Function). All other files in this task confirmed as genuinely new (none exist yet).**

**The drift, confirmed on the filesystem this session:**
- `worker/` does not exist anywhere in the repository `[VERIFIED: \`ls worker\` → "No such file or directory"]`.
- No `worker` npm script exists in `package.json` `[VERIFIED: package.json scripts object — only postinstall, dev, build, start, docker:up, lint, test, db:seed, db:migrate, db:studio]`.
- `pg-boss` is not a dependency `[VERIFIED: package.json dependencies+devDependencies — no pg-boss entry]`.
- `netlify/functions/` contains exactly two scheduled functions today: `release-expired-holds.ts` and `cleanup-stale-uploads.ts` `[VERIFIED: \`ls netlify/functions\`]`, each a thin wrapper around a pure task factory in `src/server/scheduled/`.

**The confirmed replacement pattern**, read in full this session `[VERIFIED: netlify/functions/release-expired-holds.ts:1-14, src/server/scheduled/release-expired-holds-task.ts:1-26]`:

```ts
// netlify/functions/release-expired-holds.ts — the thin handler, verbatim structure
import type { Config } from "@netlify/functions";
import { runReleaseExpiredHoldsTask } from "../../src/server/scheduled/release-expired-holds-task";

export function createReleaseExpiredHoldsHandler(run: () => Promise<void>) {
  return async function releaseExpiredHolds(): Promise<void> {
    await run();
  };
}

export default createReleaseExpiredHoldsHandler(runReleaseExpiredHoldsTask);

export const config: Config = {
  schedule: "*/5 * * * *",
};
```

```ts
// src/server/scheduled/release-expired-holds-task.ts — the pure, injectable task factory, verbatim structure
import { releaseExpiredHoldsAsSystem } from "@/server/services/hold-release-system-service";

export const HOLD_SWEEP_BATCH_SIZE = 25;

export type ReleaseExpiredHoldsTaskDeps = {
  releaseExpiredHolds: (batchLimit: number) => Promise<{ released: number; failed: number }>;
  log: (message: string) => void;
};

export function createReleaseExpiredHoldsTask(deps: ReleaseExpiredHoldsTaskDeps) {
  return async function runReleaseExpiredHoldsTask(): Promise<void> {
    const result = await deps.releaseExpiredHolds(HOLD_SWEEP_BATCH_SIZE);
    deps.log(`[scheduled] released ${result.released} expired seat holds; ${result.failed} failed`);
  };
}

export const runReleaseExpiredHoldsTask = createReleaseExpiredHoldsTask({
  releaseExpiredHolds: releaseExpiredHoldsAsSystem,
  log: (message) => console.info(message),
});
```

**Resolution — Task 7's file targets should become:**
- Create `src/server/scheduled/reconcile-payments-task.ts` (replaces `worker/handlers/reconcile-payments.ts`) — a `createReconcilePaymentsTask(deps)` factory following the exact `deps`-injection/pure-function shape above, calling into the new `payment-reconciliation-service.ts`'s exported enrichment function with an injected batch size, matching `HOLD_SWEEP_BATCH_SIZE`'s naming convention (e.g. `RECONCILE_PAYMENTS_BATCH_SIZE`).
- Create `netlify/functions/reconcile-payments.ts` (replaces the `worker/index.ts` modification) — a thin default-export handler identical in shape to `release-expired-holds.ts`, with its own `Config.schedule` cron string. **Recommended cadence:** every 15-30 minutes is reasonable for fee/settlement reconciliation (less urgent than the 5-minute hold sweep, since D-14/D-18 already treat "actual" fields as legitimately null until evidence arrives) — this is Claude's-discretion territory per CONTEXT.md's third bullet, not a locked decision.
- **Interface implication of this change vs. pg-boss**: Netlify Scheduled Functions are cron-invoked, stateless, and receive no work-queue payload — unlike a pg-boss handler that might process one job with retry/backoff semantics per invocation, this scheduled function must itself query the database for "PaymentAttempts needing reconciliation" (e.g. `SUCCEEDED` attempts where `gatewayFeeActualMinor IS NULL`) and process a bounded batch per invocation, exactly mirroring `release-expired-holds-task.ts`'s own `HOLD_SWEEP_BATCH_SIZE`-bounded-batch pattern. No retry queue exists — a failed enrichment attempt simply gets picked up again on the next scheduled invocation, which is safe *only if* the enrichment write is idempotent (it must be, per D-14/D-21's existing idempotency requirements, so this is not a new constraint, just a different failure-recovery mechanism than pg-boss would have provided).
- This also resolves the "Whether actual provider settlement enrichment happens inline after verification or through the existing worker" Claude's-discretion bullet in CONTEXT.md: "the existing worker" must be read as "the existing Netlify Scheduled Function pattern."

**All other Task 7 files confirmed genuinely new** `[VERIFIED: find on src/server/services for *manual*/*refund*/*reconcil* → no matches; find on src/app/staff for *payment* → no matches]`: `payment-reconciliation-service.ts`, `manual-payment-service.ts`, `refund-service.ts` do not exist yet, matching the plan's "Create" designation for all three.

`checkout-webhook-system-service.ts` was read in full this session `[VERIFIED: src/server/services/checkout-webhook-system-service.ts:1-1007]`. Confirmed structurally provider-neutral already: `ActivateOrderAsSystemInput` takes `{ orderId, providerIntentId, amountMinor, currency, eventId }` with no Stripe-specific type anywhere in the file (it deliberately avoids importing `stripe`, per its own header comment and the file's presence outside `providers/stripe/`). `activateOrderAsSystem`'s mismatch guard compares `order.amountMinor !== input.amountMinor || order.currency.toUpperCase() !== input.currency.toUpperCase()` (lines 463-465) — this already handles a Paystack event's currency string the same way it handles Stripe's lowercase `session.currency`. Task 7's planned extension (recording actual settlement/fee fields, wiring in Paystack evidence, and adding manual-confirmation and refund entry points) is additive to this file's existing shape, not a rewrite. The `PAYMENT_VALID_TRANSITIONS` empty-terminal-state table (lines 165-172) already reserves `PENDING_MANUAL_REVIEW` in its type union (currently unused/unreachable) — Task 7 can wire a real transition into it for PAY-04's "duplicate/conflicting confirmation" exception path if the planner decides manual review needs a distinct state, though D-15's manual-confirmation prose does not explicitly require this state to be used (a direct `PENDING → SUCCEEDED` manual-confirmation transition, audited under a distinct action name, is also PAY-03-compliant — flagged as Claude's discretion, not a locked requirement).

### Task 8 — Learner breakdown, receipts, Finance evidence
**Status: CONFIRMED, no drift.** All "Modify" targets (`enrol/[cohortId]/page.tsx`, `checkout/[orderId]/page.tsx`, `PolicyConsentForm.tsx`, `orders/[reference]/page.tsx`) confirmed to exist `[VERIFIED: directory listing of src/app/(checkout)]`. All "Create" targets (`src/app/staff/payments/page.tsx`, `src/app/staff/payments/[orderId]/page.tsx`) confirmed absent `[VERIFIED: find on src/app/staff for *payment* → no matches]` — genuinely new staff surface, consistent with `payments.view` being an existing-but-unused permission today.

### Task 9 — Remove legacy commercial reads, full test-mode acceptance
**Status: CONFIRMED, no drift** — this task's Step 1 (extend `checkout-phase-invariants.test.ts` with a legacy-reference invariant) is additive to the same file whose current shape was fully read and verified above (Task 5's annotation). The file's existing AST-walk pattern (`ts.isPropertyAssignment` / `ts.isStringLiteral` checks, never regex) is the correct model to extend for a third invariant checking for `.priceMinor`/`.currency` reads on a `Cohort`-typed value outside an explicitly allow-listed compatibility-fallback site — the planner should have this task's `<action>` follow the same AST-based, not regex-based, discipline the existing two invariants use, per the file's own stated rationale (a regex would false-positive on a comment).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` | `22.6.1` (pinned, already installed and human-approved per STATE.md Phase 6 P01) | Stripe SDK — Checkout Sessions, webhook verification | Already the project's locked Stripe integration; Task 6 only extends usage, no version change |
| Paystack HTTPS API (no SDK) | N/A — raw `fetch()` | Split-payment transaction initialization, verification, refunds | No official first-party Node SDK exists in this project's dependency tree `[VERIFIED: package.json — no paystack-* package]`; the superpowers plan's own Tech Stack line specifies "Paystack HTTPS API," matching the existing `brevo-client.ts`-style thin-wrapper convention for other external providers, minus the SDK layer |
| `zod` | `^4.5.4` (already installed) | Server-action input validation for the dual-price Cohort form and manual-payment/refund staff forms | Already the project's locked validation library |
| `@prisma/client` / `prisma` | `^6.19.3` (already installed) | Schema, migrations, transactional writes | Already locked |
| `vitest` | `^4.1.11` (already installed) | Test runner for all new unit/integration tests | Already locked; `npm test` = `vitest run --no-file-parallelism` |
| `@netlify/functions` | `^6.0.0` (already installed) | Scheduled Function type (`Config`) for the corrected Task 7 reconciliation job | Already locked and in active use by the two existing scheduled functions |

### Supporting
None beyond the above — this phase adds no new npm dependencies. Both provider integrations (Paystack via raw fetch, Stripe via the already-pinned SDK) reuse existing project infrastructure.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `fetch()` for Paystack | An unofficial `paystack-node`/similar community SDK package | Adds a new external dependency requiring a full package-legitimacy audit (age, downloads, source repo) for marginal convenience over a handful of documented REST calls; the project's own established pattern (see `brevo-client.ts`) is to keep a thin, audited wrapper rather than pull in a wrapper library for a small API surface |
| Netlify Scheduled Function for reconciliation | Reviving a pg-boss-style worker process | Would reintroduce a dependency and process-management model the codebase has already migrated away from (confirmed removed between Phase 6 and today); fighting the current infrastructure direction for no stated benefit |

**Installation:** No new packages required.

**Version verification performed this session:**
```
$ node -e "console.log(require('./package.json').dependencies.stripe)"
22.6.1
```
`[VERIFIED: package.json — read directly]`. No `npm view` registry check was performed for `stripe` since it is already an installed, previously-human-approved pin (per STATE.md's Phase 6 P01 note) — re-verifying an already-approved, unchanged pin is out of scope for this research.

## Package Legitimacy Audit

**No new external packages are installed by this phase.** Both provider integrations reuse already-approved/already-installed infrastructure:
- Stripe: `stripe@22.6.1`, already pinned and human-approved (STATE.md, Phase 6 P01: "stripe pinned exact at 22.6.1 after human npmjs.com legitimacy approval").
- Paystack: no package — a raw-`fetch()` HTTPS client under `src/server/payments/providers/paystack/client.ts`, following the existing `brevo-client.ts` thin-wrapper convention.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| *(none — no new packages)* | — | — | — | — | — | N/A |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

If, during planning or execution, someone proposes adding a third-party Paystack SDK package instead of the raw-fetch client recommended above, the planner **must** run the full Package Legitimacy Gate protocol against that specific package name before approving it — this audit's "no new packages" conclusion applies only to the raw-fetch approach this research recommends.

## Architecture Patterns

### System Architecture Diagram

```
Learner browser
   │
   │ 1. selects NGN or USD price on offer page (D-16)
   ▼
enrol/[cohortId]/page.tsx ──(server action)──▶ actions.ts: startCheckout(actor, cohortId, currency)
   │                                                  │
   │                                                  ▼
   │                                    checkout-service.ts (transaction):
   │                                      lockOpenCohort → read Cohort dual price
   │                                      → providerForCurrency(currency)      [pricing.ts / routing.ts, Task 2]
   │                                      → calculateCheckoutBreakdown(...)    [pricing.ts, Task 2]
   │                                      → supersede any existing PENDING_PAYMENT hold
   │                                      → Order.create (full commercial snapshot, D-13)
   │                                      → takeSeat (seat-accounting.ts, unchanged)
   ▼
checkout/[orderId]/page.tsx (shows 4-line breakdown, D-16/D-17)
   │
   │ 2. learner accepts consent, clicks Pay
   ▼
initiate{Stripe,Paystack}Payment ──▶ providers/{stripe,paystack}/*.ts (isolated adapters, PAY-09)
   │                                     Stripe: Checkout Session w/ transfer_data.{destination,amount} (Task 6)
   │                                     Paystack: Initialize Transaction w/ subaccount, transaction_charge, bearer (Task 5)
   ▼
External gateway (Stripe-hosted page / Paystack-hosted page)
   │
   │ 3. gateway sends signature-verified server-to-server webhook (never trusts browser redirect, PAY-10)
   ▼
src/app/api/webhooks/{stripe,paystack}/route.ts
   │  verify signature (raw body, HMAC) → recordWebhookEventOrSkip (idempotent by provider+eventId, PAY-07/PAY-11)
   ▼
checkout-webhook-system-service.ts: activateOrderAsSystem (the ONE writer of Order.status="PAID", PAY-10,
                                     mechanically enforced by tests/checkout-phase-invariants.test.ts)
   │  → applyEnrolmentActivation (enrolment-transitions.ts, unchanged)
   │  → Order → PAID, PaymentAttempt → SUCCEEDED
   ▼
Confirmation email (dispatchBestEffort) + receipt at /orders/[reference] (Task 8, preserves snapshot forever, D-18)

                              (asynchronous, off the request path)
netlify/functions/reconcile-payments.ts (cron) ──▶ src/server/scheduled/reconcile-payments-task.ts
   │  queries SUCCEEDED PaymentAttempts missing actual-settlement fields (bounded batch)
   ▼
payment-reconciliation-service.ts: fetch actual fee/settlement evidence from provider,
   idempotently enrich PaymentAttempt.{gatewayFeeActualMinor, schoolSettlementActualMinor,
   platformGrossActualMinor, platformNetActualMinor}; flag a reconciliation exception on variance (D-14/D-18)

                              (staff-initiated, permission-gated)
staff/payments/[orderId]/page.tsx ──(payments.confirm)──▶ manual-payment-service.ts ──▶ checkout-webhook-system-service.ts
staff/payments/[orderId]/page.tsx ──(refunds.manage)───▶ refund-service.ts ──▶ provider refund API (Paystack /refund, Stripe reverse_transfer)
```

### Recommended Project Structure
```
src/server/payments/
├── pricing.ts                          # Task 2 — pure fee calculator (no DB, no provider SDK)
├── routing.ts                          # Task 2 — providerForCurrency
├── payment-provider.ts                 # Task 5 — PaymentProviderAdapter interface
└── providers/
    ├── stripe/                         # existing, extended in Task 6
    │   ├── client.ts
    │   ├── checkout-session.ts
    │   └── webhook.ts
    └── paystack/                       # new, Task 5
        ├── client.ts                   # raw-fetch HTTPS wrapper, mirrors brevo-client.ts convention
        ├── initialize.ts               # builds Initialize Transaction request params
        └── webhook.ts                  # HMAC-SHA512 signature verification

src/server/services/
├── checkout-service.ts                 # extended, Task 4 (+currency param, snapshot)
├── checkout-webhook-system-service.ts  # extended, Task 7 (the ONE PAID writer, enforced by test)
├── payment-reconciliation-service.ts   # new, Task 7
├── manual-payment-service.ts           # new, Task 7
└── refund-service.ts                   # new, Task 7

src/server/scheduled/
└── reconcile-payments-task.ts          # new, corrected Task 7 target (was worker/handlers/reconcile-payments.ts)

netlify/functions/
└── reconcile-payments.ts               # new, corrected Task 7 target (was a worker/index.ts modification)

src/app/api/webhooks/
├── stripe/route.ts                     # existing, unchanged structurally
└── paystack/route.ts                   # new, Task 5

src/app/staff/payments/
├── page.tsx                            # new, Task 8 — Finance list view
└── [orderId]/page.tsx                  # new, Task 8 — Finance detail + manual confirm/refund actions
```

### Pattern 1: Provider isolation via directory-prefix exemption
**What:** A single, generalized `findProviderIsolationViolations` scan (in `tests/checkout-phase-invariants.test.ts`) checks that no source file outside a provider's own directory imports that provider's SDK or internal types.
**When to use:** Every new payment-provider integration in this codebase (already applied to Stripe; Task 5 must extend it to Paystack).
**Example:**
```ts
// Source: tests/checkout-phase-invariants.test.ts (existing, read this session)
const STRIPE_PROVIDER_DIR = path.join("server", "payments", "providers", "stripe");
// Task 5 must add an equivalent PAYSTACK_PROVIDER_DIR and extend the specifier
// check — do not write a second, parallel scan function.
```

### Pattern 2: Single shared, provider-neutral settlement writer
**What:** Exactly one module (`checkout-webhook-system-service.ts`) is permitted to write `Order.status = "PAID"`, enforced by an AST-based test (`assertSinglePaidOrderWriter`). Every provider's webhook route and every staff-initiated confirmation path (manual payment) must call into this module's exported settlement function rather than writing the status transition itself.
**When to use:** Task 5 (Paystack webhook route), Task 7 (manual-payment-service.ts).
**Example:**
```ts
// Source: src/server/services/checkout-webhook-system-service.ts (existing, read this session)
export function activateOrderAsSystem(
  input: ActivateOrderAsSystemInput,
): Promise<{ outcome: "ACTIVATED" | "EXCEPTION" }> { /* ... */ }
```

### Pattern 3: Pure task factory + thin scheduled-function handler
**What:** Business logic lives in an injectable, dependency-free factory under `src/server/scheduled/`; the Netlify Function itself is a near-empty default export wiring that factory to a cron `Config.schedule`.
**When to use:** Task 7's reconciliation job (corrected target — see Task 7 drift resolution above).
**Example:** see the verbatim `release-expired-holds.ts` / `release-expired-holds-task.ts` pair quoted in the Task 7 section above.

### Anti-Patterns to Avoid
- **A second `Order.status = "PAID"` write site:** Any new manual-confirmation or reconciliation code path that writes the paid status directly (instead of calling `activateOrderAsSystem`) will fail the existing, mechanically-enforced `assertSinglePaidOrderWriter` test — this is not a style preference, it is a hard CI gate.
- **A parallel provider-isolation scan function for Paystack:** Duplicating `findProviderIsolationViolations` instead of generalizing it recreates the exact "two copies, one silently stops being maintained" problem this file's own header comment warns against for the actorless-settlement invariant.
- **Reviving a pg-boss/long-running worker process for reconciliation:** The codebase has already migrated off this model; introducing it back for one new job fights the current infrastructure direction.
- **Trusting a Paystack webhook's `status` field without a Verify Transaction API cross-check:** the official docs explicitly warn about confusing "the API call succeeded" with "the transaction succeeded" (`data.status==='success'` vs `status=='success'`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe webhook signature verification | A manual HMAC comparison against `Stripe-Signature` | `getStripe().webhooks.constructEvent(rawBody, signature, secret)` (already wrapped in `verifyStripeWebhook`) | Already correctly implemented; getting the timestamp-tolerance window and `v1=`/`v0=` versioned scheme right by hand is a known footgun, per the existing file's own header comment |
| Paystack webhook signature verification | A naive string comparison | Node's built-in `crypto.createHmac("sha512", secret).update(rawBody).digest("hex")` compared via `crypto.timingSafeEqual` | HMAC-SHA512 (not SHA-256) is Paystack-specific and easy to get wrong by copying a generic webhook-verification snippet; must be timing-safe |
| Money/fee-percentage arithmetic | Any floating-point calculation (`price * 0.015`) | Integer minor-unit arithmetic with `roundHalfUp`/`ceil` per D-10/D-12/D-24 | Floating-point rounding errors compound at scale and are explicitly forbidden by D-24 |
| Idempotent webhook processing | A second dedupe table/flag alongside `WebhookEvent` | The existing `WebhookEvent.@@unique([provider, providerEventId])` constraint + insert-before-process pattern | Already correct for Stripe; Task 5 reuses it unmodified for Paystack (the model is already provider-generic) |
| Paystack HTTPS client | A pulled-in community SDK package | A thin, project-owned `fetch()` wrapper under `providers/paystack/client.ts` | No official first-party SDK exists; a thin wrapper avoids a package-legitimacy audit and matches the existing `brevo-client.ts` convention |

**Key insight:** This codebase already has every hard-won pattern this phase needs (provider isolation, single settlement writer, idempotent webhook dedup, pure calculator modules) proven once for Stripe/Phase 6 — Phase 7's job is disciplined replication of those patterns for a second provider and two new business capabilities (manual payment, refund), not invention of new patterns.

## Runtime State Inventory

Not applicable — this is a greenfield feature-addition phase (new columns, new services, new routes), not a rename/refactor/migration-of-identity phase. The one schema migration involved (Task 1) is purely additive (new nullable columns, new tables) with a documented backfill step, and Task 9's cleanup migration (dropping legacy `Cohort.priceMinor`/`currency`) is a standard "remove now-unused column after all reads migrated" operation, not a rename requiring the 5-category runtime-state audit. No stored data, live service config, OS-registered state, secrets, or build artifacts carry the *old* schema's identity in a way this phase renames — it only adds fields and later drops now-redundant ones.

## Common Pitfalls

### Pitfall 1: Confusing Paystack API-call success with transaction success
**What goes wrong:** Code checks `status === "success"` (the top-level API response wrapper) instead of `data.status === "success"` (the actual transaction outcome) and marks a payment successful when only the HTTP call succeeded.
**Why it happens:** Paystack's response envelope nests the real transaction status one level down; this is easy to miss when copying from memory rather than the docs.
**How to avoid:** The adapter and webhook code must explicitly check the nested `data.status` field, exactly as the official docs warn `[CITED: github.com/PaystackHQ/documentation, verifying-the-transaction.md]`.
**Warning signs:** A "successful" Paystack payment that never appears in the Paystack dashboard, or an order marked PAID with no corresponding real charge.

### Pitfall 2: A second `Order.status = "PAID"` writer introduced by the Paystack route or manual-payment service
**What goes wrong:** A developer implements the Paystack webhook route or `manual-payment-service.ts` by pattern-matching the Stripe webhook route's overall shape but writes `status: "PAID"` directly in the new file instead of calling `activateOrderAsSystem`.
**Why it happens:** The Stripe webhook route itself never writes `PAID` directly either (it calls the shared service) — but this is easy to miss if only skimming the route file's control flow rather than tracing the call into `checkout-webhook-system-service.ts`.
**How to avoid:** Every new payment-settlement code path must call the shared, generalized settlement service; `tests/checkout-phase-invariants.test.ts`'s `assertSinglePaidOrderWriter` will fail the build otherwise (confirmed this test exists and is currently green with exactly one writer).
**Warning signs:** `npm test` failure naming a new file in the "PAY-10 single-paid-writer invariant violated" error.

### Pitfall 3: Stripe cross-border destination charge silently requires `on_behalf_of`
**What goes wrong:** A destination charge to a connected account in a different Stripe-supported country than the platform account fails or behaves unexpectedly (wrong statement descriptor, wrong settlement currency) because `on_behalf_of` was never set.
**Why it happens:** The superpowers plan's Task 6 does not mention `on_behalf_of` at all, and the failure mode is not always a hard error — it can be a silent behavioral difference (wrong statement descriptor) rather than an exception.
**How to avoid:** Confirm the actual country registered on both the KQ NEXUS Stripe platform account and the test-mode `STRIPE_CONNECTED_ACCOUNT_ID` during the human credentials-setup checkpoint before writing Task 6's adapter code; add `payment_intent_data.on_behalf_of` if they differ.
**Warning signs:** A test-mode Checkout Session succeeds but the resulting charge's settlement currency or statement descriptor doesn't match D-04's expectation.

### Pitfall 4: Refund reversal semantics differ by provider and are not specified in CONTEXT.md
**What goes wrong:** A Stripe refund of a destination charge defaults to leaving the connected account's transferred funds untouched (platform absorbs the negative balance) unless `reverse_transfer: true` is explicitly passed — and no equivalent parameter/behavior was confirmed for a Paystack split-transaction refund in the sources checked this session.
**Why it happens:** D-22/D-23 describe the *learner-facing* refund amount and component allocation in detail but do not specify which side (KQ platform balance vs. school settlement) absorbs a refunded base-price component for either provider.
**How to avoid:** Treat this as an explicit open question requiring either a locked decision from the user/CONTEXT.md update, or an explicit default (e.g. "always reverse the school transfer for a full refund, never for a partial refund") documented in the refund-service.ts design before Task 7 is planned in detail.
**Warning signs:** A refund that leaves the school over-paid relative to a cancelled enrolment, discovered only during reconciliation.

### Pitfall 5: Generalizing the provider-isolation test by copy-pasting a second scan function
**What goes wrong:** Task 5 adds a `findPaystackProviderIsolationViolations` function that duplicates `findProviderIsolationViolations`'s file-walk logic instead of parameterizing the existing one.
**Why it happens:** It is the path of least resistance when under time pressure to make Task 5's tests pass without touching Task 5-unrelated Stripe test code.
**How to avoid:** Generalize the existing function to accept a list of `{ dir, specifiers }` and iterate — the file's own header comment explicitly warns against exactly this class of duplication for a different invariant in the same file (the actorless-settlement one), and the same reasoning applies here.
**Warning signs:** Two near-identical functions in `tests/checkout-phase-invariants.test.ts` that diverge in subtle ways over time.

## Code Examples

### Paystack Initialize Transaction (split, single subaccount) — request shape
```ts
// Field names and semantics per paystack.com/docs/payments/split-payments/ (CITED, fetched via search-verified summary)
// and paystack.com/docs/api/transaction/ (CITED, via search-verified secondary source — not fetched directly).
type PaystackInitializeTransactionRequest = {
  email: string;               // required
  amount: number;               // required, integer, kobo (learner total, order.amountMinor)
  currency: "NGN";               // pass explicitly — do not rely on integration default (D-07 defense in depth)
  reference: string;             // pass Order.reference explicitly, mirrors Stripe's client_reference_id pattern
  subaccount: string;            // PAYSTACK_SUBACCOUNT_CODE (D-02, D-03)
  transaction_charge: number;    // platformFeeMinor + gatewayFeeEstimateMinor (D-03)
  bearer: "account";              // explicit, matches D-03's "KQ/main account bears Paystack's actual fee"
  callback_url?: string;
  metadata?: Record<string, unknown>;
};
```

### Paystack webhook signature verification — mechanics
```ts
// Source: paystack.com/docs/payments/webhooks/ (CITED, via search-verified secondary sources) —
// mirrors the raw-body-first discipline of the existing verifyStripeWebhook (VERIFIED read this session).
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyPaystackSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
```

### Stripe Connect destination charge — Checkout Session fields
```ts
// Source: docs.stripe.com/connect/destination-charges (CITED, fetched directly).
// Extends the EXISTING buildCheckoutSessionParams (VERIFIED read this session,
// src/server/payments/providers/stripe/checkout-session.ts:21-55) with two new args.
payment_intent_data: {
  metadata: { orderId: args.orderId, enrolmentId: args.enrolmentId }, // existing, unchanged
  transfer_data: {
    destination: args.connectedAccountId,   // STRIPE_CONNECTED_ACCOUNT_ID (D-02, D-04)
    amount: args.schoolSettlementMinor,     // order.baseAmountMinor (D-04) — NOT the learner total
  },
  // on_behalf_of: args.connectedAccountId, // ADD ONLY IF platform/connected-account countries differ — see Pitfall 3
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| pg-boss worker process (`worker/`) for off-request jobs | Netlify Scheduled Functions (`netlify/functions/*.ts` + `src/server/scheduled/*-task.ts`) | Between 2026-09-11 (superpowers plan authored) and 2026-09-12 (today) — landed via a separate infrastructure track that merged into `develop` alongside Phase 6 | Task 7's `worker/handlers/reconcile-payments.ts`/`worker/index.ts` targets must become `src/server/scheduled/reconcile-payments-task.ts` + `netlify/functions/reconcile-payments.ts` |
| Single-price `Cohort.priceMinor`/`currency` | Dual `priceNgnMinor`/`priceUsdMinor` (Task 1, additive) | This phase | Every Cohort admin/readiness/checkout read of the legacy fields must migrate; Task 9 removes the legacy columns only after all reads migrate |

**Deprecated/outdated:** The superpowers plan's own Tech Stack line still lists "pg-boss worker" — this is now stale relative to the current tree and should not be carried into the GSD PLAN.md files' tech-stack framing; use "Netlify Scheduled Functions" instead.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Paystack Initialize Transaction request field names (`email`, `amount`, `currency`, `reference`, `callback_url`, `metadata`, `channels`) as summarized from a search-verified secondary source, not fetched directly from `paystack.com/docs/api/transaction/` (which returned HTTP 403 to direct fetch this session) | Task 5 API research, Code Examples | Low-medium — field names are widely and consistently corroborated across multiple independent secondary sources (SDK docs, blog walkthroughs) in the search results, but a direct-fetch confirmation against the primary source was not obtained this session |
| A2 | Paystack Refund API field names (`transaction`, `amount`, `currency`, `merchant_note`) — same 403-blocked-direct-fetch situation as A1 | Task 5/7 API research | Low-medium — same corroboration caveat as A1 |
| A3 | Paystack subaccount creation field names (`business_name`, `settlement_bank`, `account_number`, `percentage_charge`) — same situation | Task 5 API research | Low — this happens outside the LMS per D-05, so it is informational context only, not something GSD-generated code calls |
| A4 | Whether Paystack automatically reverses a split transaction's subaccount allocation on refund, or requires a separate mechanism (no Stripe-`reverse_transfer`-equivalent parameter was found in any source consulted this session) | Task 5 API research, Pitfall 4 | Medium — directly affects whether `refund-service.ts`'s Paystack path needs additional logic to correct the school's settlement after a refund; must be resolved via a sandbox test or direct Paystack support confirmation before Task 7 implementation |
| A5 | Recommended reconciliation cadence (every 15-30 minutes) for the corrected Task 7 Netlify Scheduled Function | Task 7 drift resolution | Low — explicitly framed as a discretionary recommendation, not a locked requirement; CONTEXT.md leaves this to Claude's discretion |
| A6 | Whether `payment_intent_data.on_behalf_of` will actually be required for this deployment's specific KQ NEXUS/school country pairing | Task 6, Pitfall 3 | Medium — cannot be resolved without the actual test-mode connected account; flagged as a checkpoint, not assumed either way |

## Open Questions

1. **Does a Stripe refund of a destination charge reverse the school's transfer by default in this phase's design, and what is the equivalent for a Paystack split refund?**
   - What we know: Stripe's `reverse_transfer` parameter exists and defaults to `false` (platform absorbs the negative balance); no equivalent Paystack parameter was found in sources consulted this session.
   - What's unclear: CONTEXT.md's D-22/D-23 describe the learner-facing refund and component allocation but not which side (KQ vs. school) bears a refunded base-price component for either provider, nor whether Paystack requires a manual corrective transfer for a refunded split transaction.
   - Recommendation: Surface this to the user as a locked decision before Task 7's refund-service.ts is planned in detail — this is a business-policy question (who absorbs a refunded base price), not a technical one, and belongs in a CONTEXT.md amendment or a discuss-phase follow-up rather than an assumed default.

2. **Does this deployment's Stripe platform account and school connected account share a country, or does the destination charge need `on_behalf_of`?**
   - What we know: Stripe's docs describe "certain exceptions" requiring `on_behalf_of` for cross-region platform/connected-account pairs.
   - What's unclear: The actual country registered on the (not-yet-created) test-mode `STRIPE_CONNECTED_ACCOUNT_ID`.
   - Recommendation: Resolve during the human credentials-setup checkpoint for Task 6 (mirroring 06-01's pattern) — create the test-mode connected account first, check its country against the platform account, then decide.

3. **Should the reconciliation Netlify Function's cron cadence be tighter or looser than the recommended 15-30 minutes?**
   - What we know: The hold-release sweep runs every 5 minutes; reconciliation is explicitly lower-urgency per D-14/D-18 (actual values are legitimately null until evidence arrives).
   - What's unclear: Any operational SLA for "how stale can Finance's actual-vs-expected view be" — not specified in CONTEXT.md.
   - Recommendation: Leave as Claude's discretion per CONTEXT.md's own framing; the planner can pick a cadence and document it in the PLAN.md's frontmatter rationale.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `stripe` npm package | Task 6 (extends existing Checkout Session usage) | Yes | `22.6.1` (pinned, already human-approved) | — |
| Stripe test-mode connected account (`STRIPE_CONNECTED_ACCOUNT_ID`) | Task 6 | No — must be created | — | None; this is a hard human-setup gate, mirroring Phase 6's 06-01 pattern |
| Paystack test-mode secret key + subaccount (`PAYSTACK_SECRET_KEY`, `PAYSTACK_SUBACCOUNT_CODE`) | Task 5 | No — must be created | — | None; hard human-setup gate |
| Docker (for real-Postgres integration tests) | Tasks 4-9's `.integration.test.ts` files | Unconfirmed in this research session — STATE.md records it as unavailable throughout Phase 6's execution sandbox | — | Same Docker-BLOCKED status Phase 6 recorded repeatedly (see STATE.md Blockers/Concerns) is very likely to recur for this phase's own new integration tests; the planner should carry forward the same "unit-level proof now, real-Postgres proof pending a Docker-enabled environment" caveat Phase 6 used throughout |

**Missing dependencies with no fallback:**
- `STRIPE_CONNECTED_ACCOUNT_ID` (test-mode) and `PAYSTACK_SECRET_KEY`/`PAYSTACK_SUBACCOUNT_CODE` (test-mode) must be provisioned by a human before Tasks 5/6 can be executed against real provider test-mode endpoints; both are `checkpoint:human-verify`-gated setup steps, not something research or planning can substitute for.

**Missing dependencies with fallback:**
- None beyond the above — Docker's unavailability has an established fallback already used throughout Phase 6 (unit-level proof, integration tests marked Docker-BLOCKED pending a Docker-enabled environment).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.11` |
| Config file | `vitest.config.mts` (root) |
| Quick run command | `npx vitest run <file1> <file2> ...` (the superpowers plan's own per-task focused commands) |
| Full suite command | `npm test` (= `vitest run --no-file-parallelism`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COH-02 | Dual NGN/USD price validation, publish blocked on missing enabled-rail price | unit | `npx vitest run tests/cohort-service.test.ts tests/cohort-readiness.test.ts` | Existing files, extended — Task 3 |
| PAY-08 | NGN→Paystack, USD→Stripe server-derived routing; client cannot override | unit | `npx vitest run tests/payment-routing.test.ts` | ❌ Wave 0 — Task 2 creates it |
| PAY-15 | 1.5% platform fee exact, integer, of base not total | unit | `npx vitest run tests/payment-pricing.test.ts` | ❌ Wave 0 — Task 2 creates it |
| PAY-16 | Gateway gross-up from versioned schedule, reproducible after config change | unit + integration | `npx vitest run tests/payment-pricing.test.ts tests/schema-payment-split.test.ts` | ❌ Wave 0 — Tasks 1/2 create them |
| PAY-09 (regression, generalized to Paystack) | No Paystack-specific type/import outside its adapter directory | unit (AST scan) | `npx vitest run tests/checkout-phase-invariants.test.ts` | Existing file, **must be extended** — see Task 5 gap above |
| PAY-10 | Exactly one module writes `Order.status="PAID"`, and it's the settlement service | unit (AST scan) | `npx vitest run tests/checkout-phase-invariants.test.ts` | Existing file, already covers this — no change needed for this specific invariant |
| PAY-07 / PAY-11 | Idempotent webhook processing, no duplicate paid effect | integration | `npx vitest run tests/paystack-webhook.integration.test.ts tests/checkout-webhook-system-service.test.ts` | ❌ Wave 0 (paystack) / existing extended (system-service) — Task 5/7 |
| PAY-03 / PAY-04 | Manual confirmation, one audit + one enrolment effect, duplicate rejected | integration | `npx vitest run tests/manual-payment.integration.test.ts` | ❌ Wave 0 — Task 7 creates it |
| PAY-05 / PAY-13 | Refund capped at eligible value, routes to original provider, auditable | integration | `npx vitest run tests/refund.integration.test.ts` | ❌ Wave 0 — Task 7 creates it |
| PAY-17 | Provider-native split settlement, expected-vs-actual reconcilable | integration | `npx vitest run tests/payment-reconciliation.integration.test.ts` | ❌ Wave 0 — Task 7 creates it |

### Sampling Rate
- **Per task commit:** the superpowers plan's own per-task focused `npx vitest run <files>` commands (already specified per task).
- **Per wave merge:** `npm test` (full suite).
- **Phase gate:** Full suite green before `/gsd-verify-work`; additionally `npm run lint` and `npm run build` per Task 9 Step 3.

### Wave 0 Gaps
- [ ] `tests/schema-payment-split.test.ts` — new, Task 1
- [ ] `tests/payment-pricing.test.ts` — new, Task 2
- [ ] `tests/payment-routing.test.ts` — new, Task 2
- [ ] `tests/paystack-provider.test.ts` — new, Task 5
- [ ] `tests/paystack-webhook.integration.test.ts` — new, Task 5
- [ ] `tests/payment-reconciliation.integration.test.ts` — new, Task 7
- [ ] `tests/manual-payment.integration.test.ts` — new, Task 7
- [ ] `tests/refund.integration.test.ts` — new, Task 7
- [ ] `tests/components/payment-detail.test.tsx` — new, Task 8
- [ ] `tests/checkout-phase-invariants.test.ts` provider-isolation scan generalization for Paystack — extension of an existing file, Task 5 (see gap analysis above)
- [ ] Framework install: none — Vitest is already fully configured; no new test infrastructure needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (webhooks are unauthenticated-by-design, verified via HMAC signature instead; staff actions reuse existing session auth) | N/A — see V4 |
| V3 Session Management | No new surface | Existing session infrastructure, unchanged |
| V4 Access Control | Yes | Existing `withPermission`/`payments.confirm`/`payments.view`/`refunds.manage` permission wrapper for all staff-facing Task 7/8 actions; the actorless-webhook settlement path deliberately bypasses this by design (documented `AsSystem` module pattern, already proven for Stripe) |
| V5 Input Validation | Yes | Zod schemas for manual-payment/refund staff forms; server-side integer-minor-unit parsing for all money fields (never `Number(value) * 100`, per Task 3's existing decimal-string-parsing discipline) |
| V6 Cryptography | Yes | HMAC-SHA512 (Paystack) / Stripe SDK's own HMAC-SHA256-based `constructEvent` (Stripe) for webhook signature verification — never hand-rolled, never a `===` comparison instead of `timingSafeEqual` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged webhook payload claiming a payment succeeded | Spoofing | Raw-body HMAC signature verification before any processing (both providers); reject with no writes on invalid signature |
| Webhook replay to double-activate an enrolment | Repudiation / Tampering | `WebhookEvent.@@unique([provider, providerEventId])` insert-before-process idempotency guard (existing, generalizes to Paystack unmodified) |
| Client-supplied amount/provider/fee-component override at checkout | Tampering | Server-side-only computation inside the checkout transaction; client fields for these are ignored/rejected (D-13, already the existing `startCheckout` pattern) |
| Staff-side privilege escalation via manual-payment or refund actions | Elevation of Privilege | Existing `payments.confirm`/`refunds.manage` permission catalogue entries (confirmed present), enforced via `withPermission` on every new staff action |
| Secret leakage of `PAYSTACK_SECRET_KEY`/`STRIPE_CONNECTED_ACCOUNT_ID`/webhook secrets into logs, audit details, or the browser | Information Disclosure | D-02/D-14/PAY-14 — server-side-only env vars, narrowed/allow-listed evidence objects before persistence (existing `evidence` field pattern in `PaymentAttempt`, already proven for Stripe) |
| Timing attack on webhook signature comparison | Information Disclosure (side-channel) | `crypto.timingSafeEqual` for the Paystack HMAC comparison (Stripe's SDK already handles this internally for `constructEvent`) |

## Sources

### Primary (HIGH confidence)
- `prisma/schema.prisma` — read directly, full file, this session.
- `src/server/services/checkout-service.ts` — read directly, full file, this session.
- `src/server/services/checkout-webhook-system-service.ts` — read directly, full file, this session.
- `src/server/services/seat-accounting.ts` — read directly, full file, this session.
- `src/server/services/readiness-service.ts` — grepped for relevant sections, this session.
- `src/server/payments/providers/stripe/checkout-session.ts` — read directly, full file, this session.
- `src/server/payments/providers/stripe/webhook.ts` — read directly, full file, this session.
- `src/app/api/webhooks/stripe/route.ts` — read directly, full file, this session.
- `tests/checkout-phase-invariants.test.ts` — read directly, full file, this session.
- `netlify/functions/release-expired-holds.ts`, `netlify/functions/cleanup-stale-uploads.ts` — read directly, this session.
- `src/server/scheduled/release-expired-holds-task.ts` — read directly, this session.
- `package.json` — read via `node -e` dump, this session.
- `docs.stripe.com/connect/destination-charges` — fetched directly, full content, this session.
- `github.com/PaystackHQ/documentation` (raw markdown, `receiving-payments/split-payments.md` and `receiving-payments/verifying-the-transaction.md`) — fetched directly, this session. `split-payments.md` is the exact canonical source `paystack.com/docs/payments/split-payments/` mirrors (confirmed by content match); this resolves the user's explicit request to include that URL's documentation.

### Secondary (MEDIUM confidence)
- Paystack webhook signature mechanics (`paystack.com/docs/payments/webhooks/`) — WebSearch-synthesized from multiple corroborating secondary sources (hookdeck.com, mctaba.com, blog.bitsrc.io); direct WebFetch of the primary page was not attempted after the 403 pattern on other `paystack.com/docs/*` pages.
- Paystack Initialize Transaction / Refund / Subaccount API field names (`paystack.com/docs/api/transaction/`, `/refund/`, `/subaccount/`) — WebSearch-synthesized; direct WebFetch returned HTTP 403 on the transaction endpoint.

### Tertiary (LOW confidence)
- None used as a basis for a claim without at least one corroborating secondary or primary source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all existing pins reused.
- Architecture/drift reconciliation: HIGH — every file claim was checked against the live tree this session (Read/Bash/Grep), not assumed.
- Stripe API detail: HIGH — fetched directly from `docs.stripe.com` this session.
- Paystack API detail: MIXED — Split Payments mechanics (`subaccount`, `transaction_charge`, `bearer`, the two-account limit) is HIGH, fetched directly this session via Paystack's own GitHub-mirrored documentation source (`github.com/PaystackHQ/documentation/receiving-payments/split-payments.md`), the confirmed canonical source of `paystack.com/docs/payments/split-payments/` (which itself 403s to direct fetch). Transaction Verification's `data.status` pitfall is also HIGH (same direct-fetch method). Webhook signature mechanics and the Initialize Transaction/Refund/Subaccount API field names remain MEDIUM — `paystack.com/docs/*` blocked direct WebFetch (HTTP 403) for those specific pages and no GitHub mirror was located/fetched for them this session; field names are consistently corroborated across multiple independent secondary sources but not confirmed against a primary source's live content.
- Pitfalls: HIGH for the two structurally-enforced ones (single-writer, provider isolation — both read from the actual enforcing test file); MEDIUM for the Paystack-refund-of-split-transaction behavior (Assumption A4, genuinely unresolved).

**Research date:** 2026-09-12
**Valid until:** 30 days for the codebase-drift findings (stable once Phase 7 planning starts); 7 days for the Paystack API field-name claims tagged MEDIUM confidence, given the direct-fetch access issue — the planner or executor should attempt a direct authenticated/sandboxed confirmation (e.g. a real Paystack test-mode API call) before treating those field names as final.
