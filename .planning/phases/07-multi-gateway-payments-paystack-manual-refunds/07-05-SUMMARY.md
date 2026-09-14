---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 05
subsystem: catalogue
tags: [cohort-admin, dual-currency, zod, prisma, readiness, react-server-components]

# Dependency graph
requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-02)
    provides: "Cohort.priceNgnMinor/priceUsdMinor columns, D-06/D-08 legacy backfill"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-04)
    provides: "startCheckout's currency-carrying read of priceNgnMinor/priceUsdMinor, the tracer proving the read path"
provides:
  - "CohortForm.tsx — two independent NGN/USD base-price FormFields, neither required, replacing the single priceMinor/currency pair"
  - "actions.ts — decimal-string-parsed, nullable priceNgnMinor/priceUsdMinor zod fields; legacy priceMinor/currency mirrored for the transitional period"
  - "evaluateCohortReadiness — price-ngn/price-usd per-rail ReadinessItems, blocking only for a rail this deployment has enabled"
  - "settlement-config.ts — isPaystackRailEnabled/isStripeRailEnabled presence checks (D-02/D-05), the enabledRails source"
  - "Cohort detail Overview tab — two independent 'NGN price'/'USD price' facts, 'Not set' for an unpriced rail"
affects: [07-06-stripe-connect-adapter, 07-09-dual-currency-cohort-cards, 07-11-legacy-column-removal]

# Actuals (#2632)
actuals:
  tokens: 14100
  tasks: 3
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Regex-gated decimal-string parsing (minorUnitPriceField) at the Server Action boundary: /^\\d+$/ validated before any Number() coercion, so Number(value) * 100 never appears anywhere in the module (D-24, T-07-25)"
    - "enabledRails: () => {ngn,usd} injected into CohortServiceDeps rather than read inline — keeps readiness-service.ts pure/data-access-free while letting cohort-service.ts (the caller) derive deployment-enabled-rail facts from settlement-config.ts's presence checks"
    - "Legacy priceMinor/currency NOT-NULL columns kept alive by a small legacyPriceFields() shim in actions.ts, mirroring whichever dual-price rail is set — removed by 07-11, not before"

key-files:
  created:
    - tests/components/cohort-form.test.tsx
  modified:
    - src/app/staff/cohorts/CohortForm.tsx
    - src/app/staff/cohorts/actions.ts
    - src/app/staff/cohorts/[id]/page.tsx
    - src/app/staff/cohorts/[id]/edit/page.tsx
    - src/server/services/readiness-service.ts
    - src/server/services/cohort-service.ts
    - src/server/payments/settlement-config.ts
    - tests/cohort-service.test.ts
    - tests/cohort-actions.test.ts
    - tests/cohort-readiness.test.ts
    - tests/components/cohort-pages.test.tsx
    - tests/cohort-cancel.integration.test.ts
    - tests/cohort-lifecycle-security.integration.test.ts

key-decisions:
  - "Resolved a conflict between this plan's own Task 1/2 prose ('major-unit... decimal-string parsing... 450000.00 produces exactly 45000000 minor units') and Task 3's explicit UI mechanics ('identical control shape... type=number min=0 step=1') plus 07-UI-SPEC.md §6.1's locked copy ('Whole integer minor units... e.g. 45000000 for ₦450,000.00') — the two describe incompatible field semantics (major-unit decimal entry with an implicit x100 shift vs. direct minor-unit integer entry). Followed Task 3 + the locked UI-SPEC copy + the pre-existing codebase-wide convention (T-05-77: money entered as integer minor units, never a float/decimal call) as authoritative, since they are internally consistent with each other and with every other money field in this codebase, while the Task 1/2 prose is not consistent with either. Implemented `minorUnitPriceField` as a regex-gated (`/^\\d+$/`) direct-integer parser — no `Number(value) * 100` anywhere, satisfying the letter of the D-24/T-07-25 prohibition even though the specific '450000.00 → 45000000' example is not reproduced. Documented as a deviation below."
  - "enabledRails derived from settlement-config.ts's PAYSTACK_SUBACCOUNT_CODE/STRIPE_CONNECTED_ACCOUNT_ID presence (D-02/D-05 — 'the deployment's required school account identifier is absent'), added as two new non-throwing presence-check exports (isPaystackRailEnabled/isStripeRailEnabled) alongside the existing throwing accessors."
  - "A Cohort with neither price field submitted (new create, or genuinely never priced) writes the legacy priceMinor/currency shim as 0/NGN — arbitrary but harmless, since nothing reads the legacy pair as a commercial signal once startCheckout (07-04) reads priceNgnMinor/priceUsdMinor directly."
  - "toReadinessInput (cohort-service.ts) gained an enabledRails parameter rather than reading settlement-config.ts internally, keeping the pure/data-access-free contract in readiness-service.ts's own header comment intact — the caller (cohort-service.ts) is where deployment configuration is read, exactly as the plan's Task 2 action text specifies."

patterns-established:
  - "minorUnitPriceField(fieldLabel) (actions.ts) — the shape a future money-minor-unit form field should reuse: regex-gate the raw string to /^\\d+$/ before any Number() call, field-scoped ctx.addIssue on failure, z.NEVER short-circuit."

requirements-completed: [COH-02]

coverage:
  - id: D1
    description: "An administrator enters an independent NGN price and an independent USD price; saving one leaves the other byte-identical, no conversion or derived value exists anywhere in the path (D-06)"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/cohort-readiness.test.ts#evaluateCohortReadiness — Price (D-06/D-08, 07-05) > updating one price never changes the other — no conversion exists anywhere in this evaluator"
        status: pass
      - kind: unit
        ref: "tests/cohort-service.test.ts#updateCohort — the D-30 offer-lock wrapper > an update that omits priceNgnMinor leaves the stored NGN price byte-identical while writing the submitted USD price (D-06)"
        status: pass
      - kind: unit
        ref: "tests/cohort-actions.test.ts > updating only the USD price leaves the create/update payload's NGN price present and unaltered from what was submitted (no cross-rail conversion)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Neither price field is required by CohortForm — a Cohort may legitimately sell on one rail only; publication readiness, not form validation, blocks a missing enabled-rail price (D-08)"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/components/cohort-form.test.tsx#CohortForm — dual-price fields > carries no required attribute on either price field — a Cohort may sell on one rail only (D-08)"
        status: pass
      - kind: unit
        ref: "tests/cohort-actions.test.ts > permits both price fields blank — neither rail is required (D-08); writes the 0/NGN legacy placeholder"
        status: pass
    human_judgment: false
  - id: D3
    description: "Publication readiness reports price-ngn ('NGN price set (Paystack)') and price-usd ('USD price set (Stripe)') as two independent items, replacing the single 'price' item; each blocks only when this deployment has enabled that rail (D-08)"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/cohort-readiness.test.ts#evaluateCohortReadiness — item shape > emits exactly the nine documented ids in order, with no item id price remaining"
        status: pass
      - kind: unit
        ref: "tests/cohort-readiness.test.ts#evaluateCohortReadiness — Price (D-06/D-08, 07-05) > with NGN priced and only the NGN rail enabled, price-usd is present but non-blocking, so publication is not blocked on price"
        status: pass
      - kind: unit
        ref: "tests/cohort-service.test.ts#publishCohort — permission-, readiness- and token-gated > throws CohortReadinessRefusedError when an enabled rail has no price, but never blocks on a disabled rail's missing price (D-08)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Decimal-string parsing at the Server Action boundary converts submitted minor-unit strings to integers; a negative or non-integer value is rejected with a field-scoped error; Number(value) * 100 never appears anywhere in the module (D-24)"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/cohort-actions.test.ts > rejects a negative NGN price with a field-scoped error and writes nothing"
        status: pass
      - kind: unit
        ref: "tests/cohort-actions.test.ts > rejects a non-integer USD minor-unit value with a field-scoped error and writes nothing"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Cohort detail Overview tab renders 'NGN price' and 'USD price' as two independent facts, each showing the formatted amount or 'Not set' — never an empty cell, never 0 standing in for an unpriced rail"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/components/cohort-pages.test.tsx > renders 'Not set' for both price facts when neither rail is priced — never an empty cell, never 0"
        status: pass
      - kind: unit
        ref: "tests/components/cohort-pages.test.tsx > renders the formatted amount for a priced rail and 'Not set' for the unpriced rail"
        status: pass
    human_judgment: false
  - id: D6
    description: "A Cohort priced on one rail only renders one PASS and one FAIL readiness item independently, and the form never forces the missing field (UI-SPEC §8 partial-state row)"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/components/cohort-pages.test.tsx > wires two independent per-rail readiness items into the ReadinessPanel — one PASS, one FAIL, form validation never involved"
        status: pass
      - kind: unit
        ref: "tests/components/cohort-form.test.tsx#CohortForm — dual-price fields > pre-fills each price field from its own stored value on edit; a null rail pre-fills blank, never 0"
        status: pass
    human_judgment: false

duration: ~95min
completed: 2026-09-12
status: complete
---

# Phase 7 Plan 05: Dual-Price Cohort Administration and Per-Rail Publication Readiness Summary

**Cohort administration moved from one price+currency field to two independent NGN/USD base prices, with `evaluateCohortReadiness` replacing the single "Price" gate with `price-ngn`/`price-usd` items that block publication only for a rail this deployment has enabled (D-06/D-08), all validated through a decimal-string, never-floating-point parser at the Server Action boundary.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3/3 completed
- **Files modified:** 14 (1 created, 13 modified)

## Accomplishments

- `CohortForm.tsx`'s single `priceMinor`/`currency` `FormField` pair is replaced by two independent, non-`required` fields — "NGN base price" and "USD base price" — each with the exact UI-SPEC §6.1 hint copy, plus a section note stating no currency conversion happens between them. The `Currency` field no longer renders at all.
- `actions.ts` validates each dual-price rail with a new `minorUnitPriceField` helper: the raw FormData string is regex-gated to `/^\d+$/` before any numeric coercion, rejecting a negative value or a decimal point with a field-scoped error keyed to the exact field the administrator typed in — `Number(value) * 100` never appears anywhere in the module. The legacy `priceMinor`/`currency` NOT-NULL columns are still written on every create/update via a small `legacyPriceFields` shim (mirrors whichever rail is set; `0`/`NGN` when neither is), keeping every Phase 6 surface still reading the legacy pair compiling until 07-11 removes it.
- `cohort-service.ts` threads `priceNgnMinor`/`priceUsdMinor` straight through `create`/`update` (an omitted key leaves that rail untouched at the Prisma layer; an explicit `null` clears it — two different, distinguishable requests), and widens `CohortAggregateRow`/`CohortRecord` with the two new nullable columns. A new `enabledRails: () => {ngn, usd}` dependency (backed by `settlement-config.ts`'s new `isPaystackRailEnabled`/`isStripeRailEnabled` presence checks) is threaded into every `toReadinessInput` call site.
- `readiness-service.ts`'s `evaluateCohortReadiness` replaces the single `price` item with `price-ngn` ("NGN price set (Paystack)") and `price-usd` ("USD price set (Stripe)"), each `category: "Price"`, PASSing only for a positive integer price and `blocking` only when `enabledRails` says this deployment has turned that rail on — the function's own header comment (previously "effectively always PASS") is corrected to describe the real per-rail gate. `blockingFailures()` is unchanged, so the on-screen panel and `publishCohort`'s server-side refusal still agree by construction.
- The Cohort detail Overview tab's single "Price" fact becomes two independent facts, "NGN price" and "USD price," each rendering the formatted `Intl.NumberFormat` amount or the literal "Not set" for a null rail — never an empty cell, never `0`. `[id]/edit/page.tsx` passes both stored prices into the form's initial values.
- New dedicated `tests/components/cohort-form.test.tsx` (real `@testing-library/react` render, following `course-form.test.tsx`'s precedent) proves the field labels, hint copy, absent `required` attribute, absent `Currency` field, and per-rail blank/pre-filled behaviour — coverage `tests/components/cohort-pages.test.tsx` structurally cannot provide, since that file mocks `CohortForm` away for its two async-Server-Component page tests.

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`. Stage with `git add` and report a suggested commit message in the SUMMARY."), **no commits were made**. All changes are staged with `git add` only, task by task:

1. **Task 1: Failing service, action and readiness tests for two independent prices** — staged: `tests/cohort-service.test.ts`, `tests/cohort-actions.test.ts`, `tests/cohort-readiness.test.ts`.
   - Suggested message: `test(07-05): add dual-price service, action and readiness cases`
2. **Task 2: Dual-price service, validation and per-rail publication readiness** — staged: `src/server/services/cohort-service.ts`, `src/server/services/readiness-service.ts`, `src/app/staff/cohorts/actions.ts`, `src/server/payments/settlement-config.ts`, plus two direct, unavoidable compile/behavior fixes in files outside this plan's own `<files>` list — `tests/cohort-cancel.integration.test.ts`, `tests/cohort-lifecycle-security.integration.test.ts` (Rule 3, see Deviations) — and `.planning/phases/07-multi-gateway-payments-paystack-manual-refunds/deferred-items.md` + `.planning/WINDOWS.md` (documenting a pre-existing, unrelated test-assertion bug this plan's readiness change surfaced).
   - Suggested message: `feat(07-05): validate and store two independent Cohort base prices with per-rail readiness`
3. **Task 3: Dual-price Cohort form and Overview facts** — staged: `src/app/staff/cohorts/CohortForm.tsx`, `src/app/staff/cohorts/[id]/page.tsx`, `src/app/staff/cohorts/[id]/edit/page.tsx`, `tests/components/cohort-pages.test.tsx`, `tests/components/cohort-form.test.tsx` (new).
   - Suggested message: `feat(07-05): render dual-price Cohort form fields and Overview facts`

**Plan metadata:** not committed (per constraint) — `07-05-SUMMARY.md` is ready for the repository owner to commit.

## Files Created/Modified

- `src/app/staff/cohorts/CohortForm.tsx` — two independent NGN/USD price `FormField`s, section note, `Values` type update, `Currency` field removed
- `src/app/staff/cohorts/actions.ts` — `minorUnitPriceField`, `legacyPriceFields`, dual-price zod schema fields
- `src/app/staff/cohorts/[id]/page.tsx` — two "NGN price"/"USD price" `DetailFacts` rows
- `src/app/staff/cohorts/[id]/edit/page.tsx` — passes both stored prices into `CohortForm`'s initial values
- `src/server/services/readiness-service.ts` — `price-ngn`/`price-usd` `ReadinessItem`s, widened `ReadinessCohortInput`
- `src/server/services/cohort-service.ts` — `enabledRails` dependency, widened `CohortRecord`/`CohortAggregateRow`, `toReadinessInput` signature change
- `src/server/payments/settlement-config.ts` — `isPaystackRailEnabled`/`isStripeRailEnabled`
- `tests/cohort-service.test.ts` — dual-price create/update/readiness-aggregate/publish cases
- `tests/cohort-actions.test.ts` — decimal-string parsing, legacy-mirroring, one-rail-blank cases
- `tests/cohort-readiness.test.ts` — `price-ngn`/`price-usd` per-rail cases replacing the single `price` describe block
- `tests/components/cohort-pages.test.tsx` — Overview fact and readiness-wiring cases
- `tests/components/cohort-form.test.tsx` — new, real-render CohortForm field/label/hint/required/pre-fill proof
- `tests/cohort-cancel.integration.test.ts`, `tests/cohort-lifecycle-security.integration.test.ts` — added the new required `enabledRails` dependency (Rule 3, direct compile/behavior fallout)

## Decisions Made

See `key-decisions` in frontmatter. The one genuinely load-bearing interpretive call: **this plan's own Task 1/2 prose describes a major-unit-decimal-to-minor-unit conversion ("450000.00 produces exactly 45000000 minor units") that is irreconcilable with Task 3's explicit UI mechanics and 07-UI-SPEC.md §6.1's locked copy, both of which describe direct minor-unit integer entry identical to the field being replaced.** Followed Task 3 + the locked UI-SPEC + the pre-existing T-05-77 codebase convention as authoritative (internally consistent with every other money field in this codebase); implemented a regex-gated direct-integer parser satisfying the letter of "never `Number(value) * 100`" without reproducing the specific x100 worked example, which does not apply under this design. Full reasoning trail in `key-decisions`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/Internal inconsistency] Resolved the major-unit-vs-minor-unit field semantics conflict between Task 1/2 prose and Task 3 + UI-SPEC**
- **Found during:** Task 2, before writing `minorUnitPriceField`
- **Issue:** Task 1's `<behavior>` and Task 2's `<action>` describe a decimal-string parse that converts a major-unit amount ("450000.00") into a ×100 minor-unit integer ("45000000"), and a `<threat_model>` entry (T-07-25) explicitly names "major-unit to minor-unit conversion" as this plan's own scope. Task 3's `<action>` and `<behavior>`, and 07-UI-SPEC.md §6.1's locked copy, both unambiguously describe the *replaced* field's own shape (`type=number step=1`, "Whole integer minor units... e.g. 45000000 for ₦450,000.00") — i.e., the administrator types the minor-unit integer directly, with no ×100 step anywhere. These two descriptions cannot both be implemented in the same field.
- **Fix:** Implemented direct minor-unit integer entry (matching Task 3 + UI-SPEC + the pre-existing codebase convention), validated by a regex-gated (`/^\d+$/`) parser that rejects any decimal point or negative sign before ever calling `Number()` — satisfying the D-24/T-07-25 prohibition on `Number(value) * 100` literally, since no such multiplication exists anywhere in the module.
- **Files modified:** `src/app/staff/cohorts/actions.ts`, `src/app/staff/cohorts/CohortForm.tsx`, `tests/cohort-actions.test.ts`
- **Verification:** `tests/cohort-actions.test.ts`'s decimal-string cases pass; `tests/components/cohort-form.test.tsx` confirms the field renders with the exact UI-SPEC hint text and `step=1`/no-decimal control shape.
- **Committed in:** not committed — staged (see Task Commits)

**2. [Rule 3 - Blocking] `tests/cohort-cancel.integration.test.ts` and `tests/cohort-lifecycle-security.integration.test.ts` needed the new `enabledRails` dependency to keep compiling and (for the latter) to keep passing**
- **Found during:** Task 2, `npx tsc --noEmit` (project-wide) and a real-Postgres run of both files
- **Issue:** Widening `CohortServiceDeps` with a required `enabledRails` field broke both files' own `createCohortService(...)` call sites (compile error). Beyond the compile fix, `cohort-lifecycle-security.integration.test.ts`'s one `publishCohort`-driving test seeds a cohort via the shared `seedCohortFixture` fixture, whose legacy-price default (`priceNgnMinor: 0`) is not a *positive* price — with both rails defaulted to `enabled: true`, the pre-transaction readiness refusal now fires before the test's own paused-transaction gate ever opens, hanging the test until Vitest's default 5000ms timeout.
- **Fix:** Added `enabledRails: () => ({ ngn: true, usd: true })` to `cohort-cancel.integration.test.ts` (never exercises readiness, so any value works) and `enabledRails: () => ({ ngn: false, usd: false })` to `cohort-lifecycle-security.integration.test.ts` (its scenarios are about lifecycle/concurrency, not pricing — disabling both rails restores the pre-07-05 "Price is effectively always PASS" behavior this file's fixtures were written against).
- **Files modified:** `tests/cohort-cancel.integration.test.ts`, `tests/cohort-lifecycle-security.integration.test.ts`
- **Verification:** Both files run against real Postgres (Docker available this session). `cohort-cancel.integration.test.ts`: 8/8 pass. `cohort-lifecycle-security.integration.test.ts`: 7/9 pass — the remaining 2 failures are a pre-existing, unrelated bug (see Issues Encountered), not caused by this fix.
- **Committed in:** not committed — staged (see Task Commits)

---

**Total deviations:** 2 auto-fixed (1 internal-plan-inconsistency resolution, 1 blocking-compile/behavior fallout in files outside this plan's own scope). **Impact on plan:** Both necessary to ship a mechanically coherent design and to keep the project-wide `tsc --noEmit` and real-Postgres gates green. No scope creep — no new application-facing behavior beyond what Tasks 1–3 already specify.

## Issues Encountered

- **`tests/cohort-lifecycle-security.integration.test.ts`'s "cannot overwrite CANCELLED/COMPLETED after a stale readiness read" (2 cases) fails against real Postgres for a reason unrelated to this plan.** Traced the exact code path: `publishCohort`'s in-transaction `assertCohortOpen(input.cohortId, freshRow.status)` call throws `CohortClosedError` unconditionally, before any readiness re-evaluation and before the conditional `updateMany` that would throw `StaleOrderError` — and this call's position and behavior are byte-for-byte unchanged by this plan (confirmed via `git diff HEAD -- src/server/services/cohort-service.ts`). The test's own assertion (`toBeInstanceOf(StaleOrderError)`) would have failed identically on `HEAD`, before any Phase 7 plan ran. Logged in `deferred-items.md` and `.planning/WINDOWS.md` (entry 15, kind `deviation`) rather than fixed, per the SCOPE BOUNDARY rule — this plan's own `enabledRails: () => ({ngn:false,usd:false})` fix was necessary only to stop the test from *hanging* (a symptom this plan's readiness change introduced via the fixture's default `priceNgnMinor: 0`); the underlying assertion mismatch is a pre-existing, independent bug for a future plan touching `publishCohort`'s CR-02 transaction body to resolve.
- **`npx vitest run` intermittently reported a worker-pool startup timeout on the first attempt for `tests/components/cohort-pages.test.tsx`** (`[vitest-pool]: Failed to start forks worker`) — re-running immediately succeeded (9/9 pass). Consistent with the sandbox-resource-contention flakiness prior Phase 7 plans' summaries already documented; not a code issue.

## User Setup Required

None — no external service configuration required. `PAYSTACK_SUBACCOUNT_CODE`/`STRIPE_CONNECTED_ACCOUNT_ID` (read by the new `isPaystackRailEnabled`/`isStripeRailEnabled` presence checks) were already provisioned by plan 07-01.

## Next Phase Readiness

- Administrators can now enter two independent base prices per Cohort and see two independent per-rail readiness results — 07-06 (Stripe Connect adapter) and 07-09 (dual-currency Cohort cards) can build outward from this administration surface.
- Per this dispatch's own scope restriction ("Do NOT update STATE.md or ROADMAP.md"), and by extension `REQUIREMENTS.md`, none of the three state files were touched — the frontmatter's `requirements-completed: [COH-02]` and this SUMMARY's `coverage` block are ready for the orchestrator to consume when it consolidates state after this wave.
- `deferred-items.md` and `.planning/WINDOWS.md` now carry one new entry each documenting the pre-existing `cohort-lifecycle-security.integration.test.ts` bug this plan's readiness change surfaced but did not cause — a future plan touching `publishCohort`'s CR-02 transaction body should resolve it.
- All changes are staged (`git add`) but **not committed** per this plan's global constraint — the repository owner should review the staged diff and commit using the suggested per-task messages above (or a squashed equivalent).

## Known Stubs

None — every field, fact, and readiness item this plan touches is fully wired to real data; no placeholder text, no mock UI, no hardcoded empty state.

## Self-Check: PASSED

All files claimed as created/modified were verified present on disk:
`src/app/staff/cohorts/CohortForm.tsx`, `src/app/staff/cohorts/actions.ts`,
`src/app/staff/cohorts/[id]/page.tsx`, `src/app/staff/cohorts/[id]/edit/page.tsx`,
`src/server/services/readiness-service.ts`, `src/server/services/cohort-service.ts`,
`src/server/payments/settlement-config.ts`, `tests/cohort-service.test.ts`,
`tests/cohort-actions.test.ts`, `tests/cohort-readiness.test.ts`,
`tests/components/cohort-pages.test.tsx`, `tests/components/cohort-form.test.tsx`,
`tests/cohort-cancel.integration.test.ts`, `tests/cohort-lifecycle-security.integration.test.ts`,
`.planning/phases/07-multi-gateway-payments-paystack-manual-refunds/deferred-items.md`.
All test counts cited above were independently re-run and confirmed (148/148 unit tests across
the six primary files; 8/8 and 7/9 for the two real-Postgres integration files, the 2 failures
being the documented pre-existing bug). No commit hashes to verify — per this plan's
`<global_constraints>`, every change is staged with `git add` and never committed.

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-12*
