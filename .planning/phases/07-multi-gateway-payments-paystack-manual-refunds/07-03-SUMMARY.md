---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 03
subsystem: payments
tags: [typescript, vitest, money-math, integer-arithmetic, tdd]

requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-02)
    provides: "GatewayFeeSchedule Prisma model column names (percentageBps, fixedMinor, waiverThresholdMinor, capMinor, taxBps, roundingRule) that this plan's plain-value schedule fixtures mirror"
provides:
  - "src/server/payments/pricing.ts — calculateCheckoutBreakdown, calculatePlatformFeeMinor, InvalidFeeScheduleError, MoneyOverflowError; pure, dependency-free"
  - "src/server/payments/routing.ts — providerForCurrency, isSupportedCurrency, SUPPORTED_CURRENCIES, UnsupportedCurrencyError"
  - "D-25 worked example proven exactly: base 45_000_000 -> platformFee 675_000, gatewayFeeEstimate 200_000, total 45_875_000"
affects: [07-04, 07-05, 07-06, 07-07]

actuals:
  tokens: 5570
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Pure, dependency-free domain module (zero imports) for money math, isolated from Prisma/Stripe/Paystack so it is exhaustively unit-testable"
    - "Integer-only money arithmetic: multiply-then-divide with explicit half-up adjustment (n + 5_000) / 10_000, and ceil-division via (n + d - 1) / d, both integer-truncated — no floating-point division on money values"
    - "Fixed routing policy expressed as a single-argument function with no override parameter, making a client-selected provider structurally impossible rather than merely validated against"

key-files:
  created:
    - src/server/payments/pricing.ts
    - src/server/payments/routing.ts
    - tests/payment-pricing.test.ts
    - tests/payment-routing.test.ts
  modified: []

key-decisions:
  - "Negative/non-integer baseAmountMinor raises InvalidFeeScheduleError (not a third error class) — kept the error surface to exactly the two classes the plan's Task 2 code sketch exports"
  - "Test fixtures for the uncapped, waiver-threshold, and taxBps-folding cases use hand-derived exact integer expectations (e.g. base 1_000_000 -> total 1_040_610; base 500_000 with a high waiver threshold -> total 515_229; base 197_000 with platformFeeBps overridden to 0 and a 75/75 bps percentage/tax split -> total 200_000) chosen so the arithmetic is checkable by hand and pins the D-12 order of operations precisely"
  - "gatewayFeeEstimateMinor's cap clamp happens after the internal ceil-division call but overrides its result entirely when it exceeds capMinor, so the returned totalAmountMinor is always base + platformFee + capMinor with no rounding remainder — satisfies the D-12 'cap before final rounding' requirement without needing a second code path"

patterns-established:
  - "GatewayFeeScheduleValues is the plain-value contract other payments modules (checkout-service.ts in 07-04) will pass instead of a Prisma GatewayFeeSchedule row, keeping pricing.ts free of any Prisma import"

requirements-completed: [PAY-08, PAY-15, PAY-16]

coverage:
  - id: D1
    description: "Pure integer platform-fee and gateway gross-up calculator (calculateCheckoutBreakdown), reproducing the D-25 worked example exactly and enforcing D-10/D-12's order of operations (waiver before gross-up, cap before final rounding, tax folded into one effective rate)"
    requirement: "PAY-15"
    verification:
      - kind: unit
        ref: "tests/payment-pricing.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Overflow and invalid-schedule guards (MoneyOverflowError, InvalidFeeScheduleError) so out-of-range input never produces a silently wrong amount"
    requirement: "PAY-16"
    verification:
      - kind: unit
        ref: "tests/payment-pricing.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fixed currency-to-provider routing policy (providerForCurrency): NGN only to PAYSTACK, USD only to STRIPE, single-argument signature with no override, named UnsupportedCurrencyError for every other input"
    requirement: "PAY-08"
    verification:
      - kind: unit
        ref: "tests/payment-routing.test.ts"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-09-12
status: complete
---

# Phase 07 Plan 03: Payment Pricing Calculator & Currency Routing Summary

**Pure integer fee calculator (calculateCheckoutBreakdown) and fixed NGN/USD-to-provider routing policy, both dependency-free and proven against the D-25 worked example (45_000_000 -> 675_000 / 200_000 / 45_875_000) plus 5 other table-driven cases.**

## IMPORTANT — Commit Protocol Override for This Plan

Per this plan's `<global_constraints>` and the orchestrator's explicit instruction for this
dispatch, **no `git commit` was run for any task or for this SUMMARY**. All changes were
staged with `git add` only. The repository owner must review and commit explicitly.

**Currently staged for this plan** (verified via `git status --short` immediately before writing
this summary):

```
A  src/server/payments/pricing.ts
A  src/server/payments/routing.ts
A  tests/payment-pricing.test.ts
A  tests/payment-routing.test.ts
```

(Other unrelated files remain staged from plan 07-02, which ran immediately before this plan in
the same working tree — those were not touched, added to, or unstaged by this plan's work.)

**Suggested commit messages**, one per task, if the owner chooses to split the history instead of
squashing it into one commit for this plan:

1. `test(07-03): add failing table-driven tests for the fee calculator and routing policy`
   — `tests/payment-pricing.test.ts`, `tests/payment-routing.test.ts`
2. `feat(07-03): implement pure integer checkout fee calculator (D-10, D-12, D-25)`
   — `src/server/payments/pricing.ts`
3. `feat(07-03): implement fixed NGN/USD-to-provider routing policy (D-07)`
   — `src/server/payments/routing.ts`

Or, as a single squashed commit:

`feat(07-03): pure integer fee calculator and fixed currency routing policy`

## Performance

- **Tasks:** 3/3 completed
- **Files created:** 4 (2 source, 2 test)
- **Files modified:** 0

## Accomplishments

- `src/server/payments/pricing.ts` — zero-import, pure integer money calculator implementing D-10's platform-fee formula and D-12's gateway gross-up formula (waiver threshold, uncapped ceiling gross-up, cap clamp, tax-bps folding), with `MoneyOverflowError`/`InvalidFeeScheduleError` guards.
- `src/server/payments/routing.ts` — `providerForCurrency`, a single-argument function mapping NGN to PAYSTACK and USD to STRIPE with no override parameter, plus `isSupportedCurrency`/`SUPPORTED_CURRENCIES`/`UnsupportedCurrencyError`.
- `tests/payment-pricing.test.ts` — 23 passing cases: the D-25 anchor (exact literal expected values), half-up rounding boundary (base 99 vs 100), an uncapped gross-up case, a waiver-threshold case, a taxBps-folding case, negative/zero-boundary schedule rejections, and overflow/invalid-input guards.
- `tests/payment-routing.test.ts` — 16 passing cases: the fixed NGN/USD mapping, arity check (`providerForCurrency.length === 1`), case-sensitivity pin, and rejection of every non-NGN/USD input including `GBP`, `EUR`, `""`, and lowercase variants.
- D-25 worked example reproduced exactly: `{ baseAmountMinor: 45_000_000, platformFeeMinor: 675_000, gatewayFeeEstimateMinor: 200_000, totalAmountMinor: 45_875_000 }`, and the test suite explicitly asserts `688_125` (1.5% of the grossed-up total) never appears — proving the platform fee is computed from the base, not the total.

## Task Commits

No commits were made for this plan — see "Commit Protocol Override" above. All three tasks'
changes are staged individually and were verified green before staging:

1. **Task 1: Table-driven failing tests for the fee calculator and the routing policy** — staged, not committed (`test`). Verified RED: `npx vitest run tests/payment-pricing.test.ts tests/payment-routing.test.ts` reported `Cannot find package '@/server/payments/pricing'` and `'@/server/payments/routing'` — both target modules unresolved, zero tests collected.
2. **Task 2: Pure integer fee calculator** — staged, not committed (`feat`). Verified green: `npx vitest run tests/payment-pricing.test.ts` — 23/23 passed on first run (no debugging iterations needed; hand-derived expected values matched the implementation exactly).
3. **Task 3: Fixed currency-to-provider routing policy** — staged, not committed (`feat`). Verified green: `npx vitest run tests/payment-routing.test.ts tests/payment-pricing.test.ts` — 39/39 passed.

**Plan metadata:** not committed (see override above); this SUMMARY.md was staged with `git add` only.

## Files Created/Modified

- `src/server/payments/pricing.ts` — `calculateCheckoutBreakdown`, `calculatePlatformFeeMinor`, `PLATFORM_FEE_BPS`, `GatewayFeeScheduleValues`, `PricingInput`, `CheckoutBreakdown`, `InvalidFeeScheduleError`, `MoneyOverflowError`. Zero import statements (verified via grep).
- `src/server/payments/routing.ts` — `providerForCurrency`, `isSupportedCurrency`, `SUPPORTED_CURRENCIES`, `UnsupportedCurrencyError`; re-exports `SupportedCurrency` from `./pricing`. Imports only from `./pricing` (verified via grep — the sole `import`/`export ... from` line targets `"./pricing"`).
- `tests/payment-pricing.test.ts` — table-driven cases for the calculator, including the named D-25 row.
- `tests/payment-routing.test.ts` — the fixed mapping and every rejection case, plus an explicit `.length === 1` arity assertion.

## Decisions Made

See `key-decisions` in frontmatter. Summary: negative/non-integer `baseAmountMinor` reuses `InvalidFeeScheduleError` rather than a third error class (keeping the exported error surface to exactly the two classes the plan's code sketch names); table-driven test fixtures use hand-derived exact integers chosen for verifiable-by-hand arithmetic; the cap-clamp is applied as a post-hoc override of the internally-computed ceiling value so the final total is always exactly `base + platformFee + capMinor` with no rounding remainder, satisfying D-12 without a second code path.

## Deviations from Plan

None — plan executed exactly as specified. One addition consistent with (not deviating from)
the plan: Task 2's `<action>` explicitly requires rejecting negative `fixedMinor`/`capMinor`/
`waiverThresholdMinor` values with `InvalidFeeScheduleError`, so `tests/payment-pricing.test.ts`
includes three extra test cases (one per field) covering that requirement even though Task 1's
`<behavior>` list only named the effective-rate-at-or-above-10000 case explicitly. This is full
test coverage of an already-specified implementation requirement, not new scope.

## Issues Encountered

None. Both implementation files passed their full test suites on the first run — the D-25 anchor
and all four other table-driven cases matched hand-computed expected values exactly on the first
attempt, and `npx tsc --noEmit` produced no new diagnostics (the errors present in the repository
before this plan — stale `.next/types` generated files referencing a since-removed API route, and
`@netlify/functions` type resolution — are pre-existing and out of scope per this plan's
`files_modified` list).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `src/server/payments/pricing.ts` and `routing.ts` are ready for 07-04's `startCheckout` to import: `calculateCheckoutBreakdown` for the order-creation snapshot and `providerForCurrency` for server-side provider derivation. Neither file imports Prisma, so 07-04 can pass `GatewayFeeScheduleValues` as plain values read from the `GatewayFeeSchedule` table without this module ever seeing a Prisma type.
- No blockers. This plan's changes remain staged (not committed) per the sequential-executor's `global_constraints` — the repository owner should review the staged diff (`git diff --cached -- src/server/payments/pricing.ts src/server/payments/routing.ts tests/payment-pricing.test.ts tests/payment-routing.test.ts`) before committing, using the suggested messages above.

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-12*

## Self-Check: PASSED

- FOUND: src/server/payments/pricing.ts
- FOUND: src/server/payments/routing.ts
- FOUND: tests/payment-pricing.test.ts
- FOUND: tests/payment-routing.test.ts
- FOUND: .planning/phases/07-multi-gateway-payments-paystack-manual-refunds/07-03-SUMMARY.md
- All five files confirmed present in `git diff --cached --name-only` (staged, not committed, per this plan's global constraints).
- `git log --oneline -3` confirmed unchanged — no commit was made for this plan.
