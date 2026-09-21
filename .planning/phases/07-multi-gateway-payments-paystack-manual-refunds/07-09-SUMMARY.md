---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 09
subsystem: payments
tags: [react-server-components, checkout, receipts, catalogue, intl-numberformat, tailwind]

# Dependency graph
requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-04)
    provides: "Order.baseAmountMinor/platformFeeMinor/gatewayFeeEstimateMinor/amountMinor/selectedProvider (D-13 snapshot), OrderSnapshot already carrying all four values"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-05)
    provides: "PublicCohort.priceNgnMinor/priceUsdMinor, settlement-config.ts's isPaystackRailEnabled/isStripeRailEnabled presence checks"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-06)
    provides: "Order.selectedProvider snapshot ('PAYSTACK'|'STRIPE'), the currency/provider pairing the breakdown card's fifth line renders"
provides:
  - "CohortCards.tsx — zero/one/two currency-rail CTA branches, replacing the tracer's single NGN CTA, plus the D-19 unavailable-rail notice"
  - "public-catalogue-service.ts — enabledRails-folded price nulling: a priced-but-D-05-disabled rail returns byte-identical null to an unpriced rail, so the anonymous card never learns why a rail is absent"
  - "OrderBreakdownCard.tsx — the shared four-line commercial breakdown + currency/provider line + fee-variance disclosure, rendered identically by /checkout/[orderId] and /orders/[reference]"
  - "src/server/support-contact.ts — SUPPORT_CONTACT_EMAIL extracted to one shared source, reused verbatim by the receipt page and the offer card's unavailable-rail notice"
affects: [07-10, 07-11]

# Actuals (#2632)
actuals:
  tokens: 14500
  tasks: 3
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "enabledRails: () => {ngn, usd} injected into PublicCatalogueDeps, mirroring 07-05's identical cohort-service.ts precedent — a priced rail this deployment hasn't enabled (D-05, no settlement account configured) is nulled at the service layer, so the learner-facing component only ever asks 'is this price non-null,' never 'why is it absent.'"
    - "OrderBreakdownCard — one shared, pure, presentational component consumed by both /checkout/[orderId] and /orders/[reference], so the two renderings cannot independently drift (07-UI-SPEC §7.4). It performs no calculation and reads no Cohort price or GatewayFeeSchedule; every value is a prop the caller reads straight off the Order's own snapshot columns."
    - "A defensive hard-invariant guard (throw, not a fallback UI) on both pages: if any of the four D-13 snapshot fields or selectedProvider is null, the render throws rather than silently falling back — mirroring the identical guard style checkout-service.ts's initiateStripePayment already uses for the same theoretically-null-only-for-legacy-Orders case."

key-files:
  created:
    - src/components/checkout/OrderBreakdownCard.tsx
    - src/server/support-contact.ts
  modified:
    - src/app/(public)/CohortCards.tsx
    - src/server/services/public-catalogue-service.ts
    - src/app/(checkout)/checkout/[orderId]/page.tsx
    - src/app/orders/[reference]/page.tsx
    - tests/components/cohort-cards.test.tsx
    - tests/public-catalogue-service.test.ts
    - tests/components/checkout-summary.test.tsx
    - tests/components/order-confirmation.test.tsx

key-decisions:
  - "D-05 rail-unavailability is folded into the SAME null the price field already carries, not exposed as a separate boolean field on PublicCohort. A priced-but-disabled rail and an unpriced rail are indistinguishable on the wire (both `priceNgnMinor: null` / `priceUsdMinor: null`) — this is the literal 'boolean-shaped fact, never a reason string' the plan's own acceptance criteria describe, achieved with zero new fields and zero new branches in CohortCards beyond the null-check the tracer already established, rather than inventing a parallel ngnRailEnabled/usdRailEnabled shape that would need its own reason-leak audit."
  - "seatsAvailable === 0 (Full) is checked BEFORE the rail-availability branches and short-circuits them entirely — a full-and-unpriced cohort renders only 'Full,' never the unavailable-rail notice alongside it. 07-UI-SPEC §7.2 states the Full branch is 'unchanged from Phase 6... regardless of how many currency rails are priced,' which this reads as Full taking exclusive precedence, not as license to render both a capacity message and a configuration message at once."
  - "The four-line breakdown card is one new shared component (`src/components/checkout/OrderBreakdownCard.tsx`), not duplicated markup — naming/location is Claude's discretion per 07-UI-SPEC's own reservation for exact component names not locked by the design contract. Both the order-summary page and the receipt page now import the identical component and pass it nothing but Order snapshot values, so 07-UI-SPEC §7.4's 'the two renderings must be byte-identical' is enforced structurally, not just by convention."
  - "SUPPORT_CONTACT_EMAIL was a page-local const on /orders/[reference]/page.tsx before this plan. Extracted to `src/server/support-contact.ts` so CohortCards.tsx's new unavailable-rail notice (Task 1) reads the exact same value rather than re-deriving `process.env.SUPPORT_CONTACT_EMAIL ?? \"support@example.com\"` a second time — the plan's own key_links explicitly calls for this string to be 'reused verbatim rather than a second contact string.'"
  - "checkout-service.ts needed NO changes for this plan. OrderSnapshot already carried baseAmountMinor/platformFeeMinor/gatewayFeeEstimateMinor/selectedProvider from the 07-04 tracer and getOwnOrder/getOwnOrderByReference's ORDER_SELECT already includes them — this plan is a pure UI consumer of an already-complete server shape, exactly as the dispatch's own sequential_execution note anticipated."

patterns-established:
  - "OrderBreakdownCardProps { baseAmountMinor, platformFeeMinor, gatewayFeeEstimateMinor, amountMinor, currency, provider } — the shape any future third learner-facing money surface (e.g. an order-history list row) should accept if it ever needs the same four-line breakdown, rather than re-deriving the row markup."

requirements-completed: [PAY-08, PAY-15, PAY-16, PAY-17]

coverage:
  - id: D1
    description: "The offer/cohort card renders exactly one CTA per available currency rail (zero/one/two), never a disabled-looking option for a rail the learner cannot actually pay on — a priced-but-D-05-disabled rail is indistinguishable from an unpriced one, and the unavailable-rail notice never conflates with the unrelated 'Full' capacity state"
    requirement: "PAY-08"
    verification:
      - kind: unit
        ref: "tests/components/cohort-cards.test.tsx#07-09: zero/one/two currency-rail branches (all 8 new cases)"
        status: pass
      - kind: unit
        ref: "tests/public-catalogue-service.test.ts#07-09: D-05 rail enablement folded into the price, never leaked as a reason (all 4 new cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The order-summary page shows the four-row commercial breakdown (School fee / KQ NEXUS platform fee (1.5%) / Estimated payment-processing fee / Total charged), the currency/provider line, and the fee-variance disclosure — verbatim copy, muted (never warning-toned), the three component rows summing exactly to the total, positioned before the policy checkboxes and after the Cohort/Dates/Mode facts"
    requirement: "PAY-16"
    verification:
      - kind: unit
        ref: "tests/components/checkout-summary.test.tsx#OrderBreakdownCard (6 cases) and #CheckoutOrderPage — breakdown card (07-09 D-16/D-17) (7 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The receipt renders the identical four-line breakdown read from the Order's own immutable snapshot columns — a later Cohort price edit or GatewayFeeSchedule edit leaves every rendered figure unchanged, and the page imports nothing from pricing.ts"
    requirement: "PAY-17"
    verification:
      - kind: unit
        ref: "tests/components/order-confirmation.test.tsx#OrderReceiptPage — breakdown (07-09 D-16/D-18) (4 cases, including the mutate-between-renders proofs)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No provider credential, subaccount code, or connected-account id appears in any learner-facing page's rendered output"
    requirement: "PAY-08"
    verification:
      - kind: unit
        ref: "tests/components/checkout-summary.test.tsx#CheckoutOrderPage — breakdown card > renders no provider secret or account identifier anywhere on the page (T-07-12)"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-09-13
status: complete
---

# Phase 07 Plan 09: Learner-Facing Fee Breakdown and Dual-Currency Offer Cards Summary

**The offer card now offers a currency, never a gateway (zero/one/two-rail CTA branches with a D-05 unavailable-rail notice); the order-summary and receipt pages both render the identical four-line commercial breakdown — School fee, KQ NEXUS platform fee (1.5%), Estimated payment-processing fee, Total charged, plus the currency/provider line and fee-variance disclosure — from one shared `OrderBreakdownCard` component reading straight off the Order's own immutable D-13 snapshot.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 completed
- **Files modified:** 10 (2 created, 8 modified)

## Accomplishments

- **`CohortCards.tsx`** replaces the 07-04 tracer's single "Pay in NGN with Paystack" CTA with the full 07-UI-SPEC §7.2 branch set: both rails priced renders two CTAs (side by side ≥640px, stacked below, via the same `flex-col sm:flex-row` container class the card's other responsive elements already use); exactly one rail priced renders a single CTA in the position the old one occupied, with no empty second slot; neither rail priced (or D-05-disabled) renders no CTA and the `--warning-surface` "Payment is temporarily unavailable for this cohort. Contact support to enrol." notice with a `mailto:` link built from the shared `SUPPORT_CONTACT_EMAIL`; `seatsAvailable === 0` is checked first and always wins with the unchanged "Full" label, never combined with the notice. A null rail renders no price at all, never a formatted zero.
- **`public-catalogue-service.ts`** guards §7.2's "no selectable but doomed payment option" (D-19) at the source: a new `enabledRails` dependency (mirroring 07-05's identical `cohort-service.ts` precedent, bound in production to `settlement-config.ts`'s `isPaystackRailEnabled`/`isStripeRailEnabled`) nulls out a priced rail this deployment hasn't enabled — indistinguishable on the wire from an unpriced rail, so the anonymous card never learns *why* a rail is absent, only *that* it is. `PublicCohort` still carries no `seatsTaken`, `capacity`, or provider-configuration detail.
- **`OrderBreakdownCard.tsx`** (new, `src/components/checkout/`) — the one shared, pure, presentational four-line breakdown component both `/checkout/[orderId]` and `/orders/[reference]` now render. It performs no calculation and reads no Cohort price or `GatewayFeeSchedule`; every value is a prop the caller reads straight off the Order's own D-13 snapshot columns (`baseAmountMinor`/`platformFeeMinor`/`gatewayFeeEstimateMinor`/`amountMinor`/`currency`/`selectedProvider`, all of which already existed on `OrderSnapshot` from the 07-04 tracer — no `checkout-service.ts` change was needed for this plan). Renders the four §6.1-verbatim row labels, a 1px divider before "Total charged" (Label weight, both label and amount), the "{Currency} via {Provider}" line, and the fee-variance disclosure in muted (never warning) text.
- **The order-summary page** moves the single "Price" fact out of the Cohort/Dates/Mode grid into the new breakdown card, positioned immediately below the fact grid and above the verification/decline banners — the last thing the learner reads before the policy checkboxes (D-16). The hold countdown, verification banner, decline banner, and hold-expired panel are all unchanged, proven by dedicated regression cases against the real page.
- **The receipt page** replaces the single "Amount" fact the same way, in the same position, reading the identical `OrderBreakdownCard` from the Order's own snapshot columns — proven immutable against both a mutated Cohort price and a hypothetically-edited `GatewayFeeSchedule` via mutate-between-renders test cases, plus a source-scan assertion that the page imports nothing from `pricing.ts` and calls no `calculateCheckoutBreakdown`. The existing Order reference/Cohort/Payment-pill/Enrolment-pill facts, and the Phase 6 exception sub-state, are unchanged.
- Both pages carry a defensive hard-invariant guard: if any of the four snapshot fields or `selectedProvider` is null (theoretically possible only for a pre-Phase-7 legacy Order), the page throws rather than silently rendering a broken or misleading breakdown — mirroring `checkout-service.ts`'s own existing guard style for the identical never-null-in-practice case.

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`. Stage with `git add` and report a suggested commit message in the SUMMARY."), **no commits were made**. All changes are staged with `git add` only, task by task:

1. **Task 1: Offer-card currency rails — zero, one and two, with the unavailable-rail notice** — staged: `src/server/services/public-catalogue-service.ts`, `src/app/(public)/CohortCards.tsx`, `src/server/support-contact.ts` (new), `tests/components/cohort-cards.test.tsx`, `tests/public-catalogue-service.test.ts`.
   - Suggested message: `feat(07-09): render dual-currency offer-card CTAs with the D-05/D-19 unavailable-rail notice`
2. **Task 2: The four-line breakdown card and the fee-variance disclosure on the order summary** — staged: `src/components/checkout/OrderBreakdownCard.tsx` (new), `src/app/(checkout)/checkout/[orderId]/page.tsx`, `tests/components/checkout-summary.test.tsx`.
   - Suggested message: `feat(07-09): disclose the four-line commercial breakdown before checkout consent`
3. **Task 3: The permanent receipt breakdown, read from the Order's own snapshot** — staged: `src/app/orders/[reference]/page.tsx`, `tests/components/order-confirmation.test.tsx`.
   - Suggested message: `feat(07-09): render the immutable receipt breakdown from the shared OrderBreakdownCard`

**Plan metadata:** not committed (per constraint); `07-09-SUMMARY.md` staged with `git add` only.

## Files Created/Modified

- `src/components/checkout/OrderBreakdownCard.tsx` — new shared four-line breakdown component
- `src/server/support-contact.ts` — new, `SUPPORT_CONTACT_EMAIL` extracted from `/orders/[reference]/page.tsx`
- `src/app/(public)/CohortCards.tsx` — zero/one/two-rail CTA branches, unavailable-rail notice
- `src/server/services/public-catalogue-service.ts` — `enabledRails` dependency, D-05 price nulling
- `src/app/(checkout)/checkout/[orderId]/page.tsx` — Price fact replaced by `OrderBreakdownCard`, hard-invariant guard
- `src/app/orders/[reference]/page.tsx` — Amount fact replaced by the same `OrderBreakdownCard`, extended header comment, hard-invariant guard
- `tests/components/cohort-cards.test.tsx` — 8 new cases for the rail branches, plus one pre-existing legacy-field test updated to the dual-rail shape
- `tests/public-catalogue-service.test.ts` — 4 new cases for the D-05 enablement fold
- `tests/components/checkout-summary.test.tsx` — new `OrderBreakdownCard` describe block (6 cases) and a new `CheckoutOrderPage` describe block (7 cases, including the Phase 6 regression proofs)
- `tests/components/order-confirmation.test.tsx` — fixture widened with the four snapshot fields, 4 new breakdown/D-18 cases
- `tests/components/cohort-detail-actions.test.tsx` — checked per Task 3's own instruction; carries no assertion tied to the single-price offer display, so no change was needed

## Decisions Made

See `key-decisions` in frontmatter. The two genuinely interpretive calls:

1. **D-05 rail-unavailability folds into the same `null` the price field already carries, rather than a separate boolean field.** A priced-but-disabled rail and an unpriced rail are byte-identical on `PublicCohort` — this is the literal reading of the plan's "the card receives a boolean-shaped fact, never a reason string," achieved with zero new fields and zero new branches in `CohortCards` beyond the null-check the tracer already established.
2. **`seatsAvailable === 0` is checked before, and short-circuits, the rail-availability branches.** A full-and-unpriced cohort renders only "Full" — never the unavailable-rail notice alongside it — reading 07-UI-SPEC §7.2's "unchanged from Phase 6... regardless of how many currency rails are priced" as exclusive precedence, not simultaneous rendering of two independent messages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A pre-existing `cohort-cards.test.tsx` case exercised the legacy `priceMinor`/`currency` fields the component no longer reads**
- **Found during:** Task 1, first `vitest run` after replacing the tracer's price display
- **Issue:** "shows the date range, delivery mode as plain text, and the formatted price" set `priceMinor: 25000, currency: "USD"` but left the fixture's default `priceNgnMinor: 45_000_000` in place — once `CohortCards` reads only `priceNgnMinor`/`priceUsdMinor` (this plan's own explicit instruction: "Replace the legacy `formatPrice(cohort.priceMinor, cohort.currency)` display"), the test asserted `$250.00` but the card correctly rendered the NGN price instead.
- **Fix:** Updated the fixture to set `priceNgnMinor: null, priceUsdMinor: 25000`, matching the dual-rail shape every other case in the file already uses.
- **Files modified:** `tests/components/cohort-cards.test.tsx`
- **Verification:** `npx vitest run tests/components/cohort-cards.test.tsx` — 35/35 pass.
- **Committed in:** not committed — staged (see Task Commits)

**2. [Rule 2 - Missing Critical] Both pages needed a hard-invariant guard for the theoretically-null D-13 snapshot fields**
- **Found during:** Task 2, wiring `OrderBreakdownCard`'s required (non-nullable) props against `OrderSnapshot`'s nullable `baseAmountMinor`/`platformFeeMinor`/`gatewayFeeEstimateMinor`/`selectedProvider` types
- **Issue:** `OrderSnapshot`'s own doc comment states these four fields are null only for a pre-Phase-7 legacy Order — never for one this codebase's `startCheckout` created — but TypeScript still types them as nullable, and neither page had a runtime check before this plan.
- **Fix:** Added a narrow, TypeScript-narrowing `if (...=== null) throw new Error(...)` guard on both pages, immediately before the breakdown is rendered — mirroring the identical guard style `checkout-service.ts`'s own `initiateStripePayment` already uses for the same theoretically-unreachable case, rather than inventing a silent fallback UI for a state that should never occur on a live Order.
- **Files modified:** `src/app/(checkout)/checkout/[orderId]/page.tsx`, `src/app/orders/[reference]/page.tsx`
- **Verification:** `npx tsc --noEmit` clean (the guard is what lets TypeScript narrow the nullable fields to non-null before they're passed to `OrderBreakdownCard`'s required props); full test suite for both pages green.
- **Committed in:** not committed — staged (see Task Commits)

---

**Total deviations:** 2 auto-fixed (1 bug fix to a stale test, 1 missing-critical defensive guard). **Impact on plan:** Both necessary and small in scope — no new application-facing behavior beyond what Tasks 1–3 already specify, no scope creep.

## Issues Encountered

- **Sandbox vitest worker-pool startup flakiness (pre-existing, documented in 07-04/07-05's own summaries):** the default-parallelism `npx vitest run <file>` invocation twice reported `[vitest-pool]: Failed to start forks worker ... Timeout waiting for worker to respond` with zero tests run, for `tests/components/checkout-summary.test.tsx` specifically. Re-running with `--no-file-parallelism` (the project's own `npm test` script's flag) succeeded immediately both times. Not a code issue — every test file in this plan's scope was independently confirmed green via the serialized flag, and the final combined run (`tests/components/cohort-cards.test.tsx tests/components/checkout-summary.test.tsx tests/components/order-confirmation.test.tsx tests/components/cohort-detail-actions.test.tsx tests/public-catalogue-service.test.ts tests/checkout-service.test.ts`, 122 tests) passed in full.

## User Setup Required

None — no new external service configuration required. This plan reads only values already provisioned by 07-01/07-05/07-06 (`PAYSTACK_SUBACCOUNT_CODE`, `STRIPE_CONNECTED_ACCOUNT_ID`, `SUPPORT_CONTACT_EMAIL`).

## Next Phase Readiness

- The learner-facing surface for both currency rails is complete: the offer card, order-summary breakdown, and permanent receipt all honestly disclose what is charged, before and after payment.
- `OrderBreakdownCard`'s prop shape (`baseAmountMinor`/`platformFeeMinor`/`gatewayFeeEstimateMinor`/`amountMinor`/`currency`/`provider`) is ready for 07-10 (Finance detail, §7.6) to reuse or mirror for the staff-facing "Learner charge" section, which the UI-SPEC states is "the Finance-facing rendering of the exact same immutable snapshot the learner's own receipt shows."
- `src/server/support-contact.ts` is ready for any future learner-facing surface needing the same support contact, without re-deriving the env-var/fallback pattern a third time.
- Per this dispatch's own scope restriction ("Do NOT update STATE.md or ROADMAP.md"), and by extension `REQUIREMENTS.md`, none of the three state files were touched — the frontmatter's `requirements-completed: [PAY-08, PAY-15, PAY-16, PAY-17]` and this SUMMARY's `coverage` block are ready for the orchestrator to consume when it consolidates state after this wave.
- All changes are staged (`git add`) but **not committed** per this plan's global constraint — the repository owner should review the staged diff and commit using the suggested per-task messages above (or a squashed equivalent).

## Known Stubs

None — every card, row, and notice this plan renders is wired to real Order/Cohort/settlement-config data; no placeholder text, no mock UI, no hardcoded empty state standing in for unfinished work.

## Self-Check: PASSED

All 11 claimed created/modified files verified present on disk: `src/components/checkout/OrderBreakdownCard.tsx`,
`src/server/support-contact.ts`, `src/app/(public)/CohortCards.tsx`, `src/server/services/public-catalogue-service.ts`,
`src/app/(checkout)/checkout/[orderId]/page.tsx`, `src/app/orders/[reference]/page.tsx`,
`tests/components/cohort-cards.test.tsx`, `tests/public-catalogue-service.test.ts`,
`tests/components/checkout-summary.test.tsx`, `tests/components/order-confirmation.test.tsx`, and this SUMMARY itself.
No commit hashes to verify — per this plan's `<global_constraints>`, every change is staged with `git add` and never
committed. Verified via `git status --short`: all ten source/test files plus this SUMMARY show a clean staged status.
Full targeted verification (`npx tsc --noEmit && npx vitest run --no-file-parallelism tests/components/cohort-cards.test.tsx
tests/components/checkout-summary.test.tsx tests/components/order-confirmation.test.tsx
tests/components/cohort-detail-actions.test.tsx tests/public-catalogue-service.test.ts tests/checkout-service.test.ts`)
passed in full: 122/122 tests, zero `tsc` diagnostics.

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-13*
