---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 11
subsystem: payments
tags: [cohort, legacy-cleanup, ast-invariant, migration-deferred, documentation]

requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-05)
    provides: "The dual-price Cohort admin/readiness surfaces this plan's invariant proves nothing still reads the legacy pair behind"
provides:
  - "A third AST invariant in tests/checkout-phase-invariants.test.ts — a mechanical, build-time gate against any future legacy Cohort.priceMinor/currency read"
  - "README.md's multi-gateway payments configuration section — every env var, both webhook URLs, the reconciliation cadence, and the fee-schedule seeding pointer"
  - "An explicit, recorded deferral of the legacy-column drop, carried forward as an open item"
affects: [07-12]

actuals:
  tokens: 18000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "The invariant tracks 'Cohort-shaped' identifiers structurally (explicit Cohort-ish type annotations, a direct <x>.cohort/<x>.cohortDelegate delegate call, or propagation through .map()/.forEach()/shape-preserving array methods like .filter()) rather than via the TypeScript type checker — consistent with the file's existing two invariants, which also avoid building a full ts.Program."
    - "priceMinor is flagged on ANY property access, unconditionally — no other model in this schema has ever had a field by that name, so the narrower Cohort-shape check that currency needs would be redundant for priceMinor and is skipped, documented inline as a deliberate simplification."

key-files:
  created: []
  modified:
    - tests/checkout-phase-invariants.test.ts
    - src/server/services/cohort-service.ts
    - src/server/services/readiness-service.ts
    - src/server/services/public-catalogue-service.ts
    - tests/cohort-service.test.ts
    - tests/cohort-readiness.test.ts
    - tests/components/cohort-cards.test.tsx
    - tests/public-catalogue-service.test.ts
    - README.md

key-decisions:
  - "Task 2's checkpoint: DEFER the legacy column drop. Both evidence facts were clean (zero legacy reads under src/, 0 of 3 live Cohort rows unpriced on both rails — safe to drop technically), but the repository owner chose to leave Cohort.priceMinor/currency in place for now rather than run the irreversible drop this session. Recorded as an explicit, named deferral — not a silent default."
  - "Because the decision was defer, Task 3 performed ONLY its documentation half, exactly as the plan's own precondition specifies: no migration was created, prisma/schema.prisma and prisma/seed.ts's legacy write paths are untouched, and tests/support/cohort-fixtures.ts's legacy-write compatibility shim (already dual-price-aware since 07-02) remains as-is."
  - "The invariant flags priceMinor unconditionally (any property access, no Cohort-shape check needed) because no other model in this schema has ever declared that field name — Order/PaymentAttempt's own snapshot columns are baseAmountMinor/platformFeeMinor/gatewayFeeEstimateMinor/amountMinor. currency IS shared across several models (Order, PaymentAttempt, GatewayFeeSchedule, Refund), so it is scoped to Cohort-shaped bases only, verified by a fixture proving Order.amountMinor/Order.currency/PaymentAttempt.currency are never flagged."

patterns-established:
  - "LEGACY_COHORT_PRICE_EXEMPT_DIRS — a directory-prefix allowlist for a future compatibility shim, mirroring STRIPE_PROVIDER_DIR/PAYSTACK_PROVIDER_DIR's existing shape, currently empty (no compatibility site remains after this plan's cleanup)."

requirements-completed: [COH-02, PAY-08, PAY-14, PAY-16]

coverage:
  - id: D1
    description: "A third AST invariant mechanically proves nothing under src/ reads Cohort.priceMinor or Cohort.currency; a fixture proves it can fail and name the offending file/property, and a second fixture proves the directory-prefix exemption works"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/checkout-phase-invariants.test.ts#phase-wide invariant: no legacy Cohort price reads (COH-02, 07-11) (4 tests: real-tree check, safe-fixture non-flag, violation fixture, exemption fixture)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The two real legacy reads the invariant found (cohort-service.ts's toReadinessInput, public-catalogue-service.ts's upcomingCohorts) are removed, along with their now-dead type fields and Prisma select entries; the real-tree invariant run reports zero violations"
    requirement: "COH-02"
    verification:
      - kind: unit
        ref: "tests/checkout-phase-invariants.test.ts#nothing under src/ reads Cohort.priceMinor or Cohort.currency"
        status: pass
      - kind: unit
        ref: "tests/cohort-service.test.ts, tests/cohort-readiness.test.ts, tests/components/cohort-cards.test.tsx, tests/public-catalogue-service.test.ts (157 tests total across the affected files) — updated assertions no longer expect the removed fields"
        status: pass
    human_judgment: false
  - id: D3
    description: "The legacy-column-drop decision is explicitly recorded (defer), with both evidence counts (0 legacy reads, 0/3 unpriced Cohorts) stated as numbers, not silently assumed either way"
    human_judgment: true
    rationale: "A one-way, irreversible business/data decision requiring the repository owner's explicit choice — recorded above under key-decisions, not something a test can pass/fail on."
  - id: D4
    description: "README.md documents the full multi-gateway configuration surface: every new env var and where to get it, both webhook URLs and where each is registered, the reconcile-payments cadence, and the fee-schedule seeding pointer; .env.example (already complete from 07-01) confirmed to carry only placeholder shapes"
    requirement: "PAY-14"
    verification:
      - kind: manual_procedural
        ref: "Direct read of the added README.md section and the already-staged .env.example content this session — confirmed no credential value, only placeholder shapes (sk_test_xxx, ACCT_xxx, acct_xxx, whsec_xxx)"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-09-13
status: complete
---

# Phase 07 Plan 11: Legacy-Reference Invariant, Deferred Column Drop, and Deployment Configuration Docs Summary

**A build-time AST invariant now mechanically proves nothing reads the legacy Cohort.priceMinor/currency pair — it found and closed two real, previously-undetected reads — while the irreversible column drop itself was explicitly deferred by the repository owner, and README.md now documents the phase's full multi-gateway deployment configuration.**

## Performance

- **Duration:** ~50 min (executed inline, in the orchestrator's own context, because Task 2 is a `checkpoint:decision`)
- **Tasks:** 3/3 completed
- **Files modified:** 9

## Accomplishments

- **Task 1 — the invariant, and what it found.** Added a third AST-based invariant to `tests/checkout-phase-invariants.test.ts`, following the file's existing structural-tracking discipline (no full `ts.Program`/type-checker, consistent with the two pre-existing invariants). Running it against the real tree immediately found two genuine, previously-unnoticed legacy reads:
  - `cohort-service.ts`'s `toReadinessInput` read `row.priceMinor`/`row.currency` off a `CohortAggregateRow` and threaded them into `ReadinessCohortInput` — dead data, since `readiness-service.ts`'s own header comment already said its Price checks read only `priceNgnMinor`/`priceUsdMinor`. Removed the Prisma select entries, the type fields, and the read.
  - `public-catalogue-service.ts`'s `upcomingCohorts` read `row.priceMinor`/`row.currency` inside a `rows.filter(...).map(...)` chain and exposed them on the public `PublicCohort` shape — never consumed downstream (`CohortCards.tsx` already renders only `priceNgnMinor`/`priceUsdMinor`). Removed the same way.
  - Fixing the invariant's own propagation logic to see through the `.filter().map()` chain (an array-shape-preserving method recursion, deliberately excluding `.map()`/`.reduce()` from that specific recursion since those can change the element shape — see Deviations) was necessary to catch the second violation at all; without it the invariant silently missed a real read.
  - Four supporting tests: the real-tree check itself, a fixture proving `Order.amountMinor`/`Order.currency`/`PaymentAttempt.currency` are never flagged, a fixture proving the invariant names the offending file and property when a violation is deliberately introduced, and a fixture proving the directory-prefix exemption mechanism (currently unused — no compatibility site remains).
  - Updated four test files whose fixtures/assertions still constructed or expected the now-removed fields.
- **Task 2 — the checkpoint.** Presented both required evidence facts to the repository owner in plain language (zero legacy reads under `src/`; 0 of 3 live Cohort rows have both price rails unset). The repository owner chose **defer** — leave the legacy columns in place for now. This is a real, named decision, not a default: the technical evidence supported dropping safely, but the business call to actually do it belongs to the repository owner, and they deferred it.
- **Task 3 — documentation, migration skipped per the deferral.** Per Task 3's own `<precondition>`, only the documentation half ran. Added a "Multi-gateway payments (Paystack + Stripe Connect)" section to `README.md`: every new environment variable and exactly where in each provider's dashboard to find it, both webhook URLs (`/api/webhooks/paystack`, `/api/webhooks/stripe`) and where each is registered, the `reconcile-payments` Netlify Scheduled Function's 15-minute cadence, and a pointer to `prisma/seed.ts` as where a real deployment configures its own `GatewayFeeSchedule` rates rather than editing the seeded worked-example rates in place. Confirmed `.env.example` (already fully documented in 07-01) carries only placeholder shapes for every credential.

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`."), **no commits were made**. All changes are staged with `git add` only:

1. **Task 1: Legacy-reference invariant and the last remaining legacy reads** — staged: `tests/checkout-phase-invariants.test.ts`, `src/server/services/cohort-service.ts`, `src/server/services/readiness-service.ts`, `src/server/services/public-catalogue-service.ts`, `tests/cohort-service.test.ts`, `tests/cohort-readiness.test.ts`, `tests/components/cohort-cards.test.tsx`, `tests/public-catalogue-service.test.ts`.
   - Suggested message: `test(07-11): add the legacy Cohort-price AST invariant and close the two reads it found`
2. **Task 2: checkpoint decision** — no files changed; the decision (defer) is recorded in this SUMMARY.
3. **Task 3: deployment configuration documentation (migration skipped — deferred)** — staged: `README.md`.
   - Suggested message: `docs(07-11): document the multi-gateway deployment configuration; defer the legacy-column drop`

**Plan metadata:** not committed (per constraint); `07-11-SUMMARY.md` staged with `git add` only.

## Files Created/Modified

- `tests/checkout-phase-invariants.test.ts` — third invariant (`findLegacyCohortPriceReads`/`assertNoLegacyCohortPriceReads`) plus four tests
- `src/server/services/cohort-service.ts` — removed `priceMinor`/`currency` from `CohortAggregateRow`, `AGGREGATE_SELECT`, and `toReadinessInput`'s return value
- `src/server/services/readiness-service.ts` — removed the now-fully-dead `priceMinor`/`currency` fields from `ReadinessCohortInput`
- `src/server/services/public-catalogue-service.ts` — removed `priceMinor`/`currency` from `PublicCohort`, the Prisma select, and the row-mapping
- `tests/cohort-service.test.ts`, `tests/cohort-readiness.test.ts`, `tests/components/cohort-cards.test.tsx`, `tests/public-catalogue-service.test.ts` — fixtures/assertions updated to match the removed fields
- `README.md` — new "Multi-gateway payments (Paystack + Stripe Connect)" section

## Decisions Made

See `key-decisions` in frontmatter. The load-bearing one: **the legacy-column drop is explicitly deferred**, not dropped. `Cohort.priceMinor`/`Cohort.currency` remain in `prisma/schema.prisma`, `cohort-service.ts`'s create/update path, and `prisma/seed.ts` exactly as they were before this plan — only the two genuine *reads* found by the new invariant were removed, since those were dead code regardless of the drop decision (nothing consumed the values they carried).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The invariant's array-chain propagation initially missed a real violation**
- **Found during:** Task 1, first real-tree run
- **Issue:** The initial `.map()`-only propagation logic correctly flagged `cohort-service.ts`'s violation (a directly-typed `CohortAggregateRow` parameter) but missed `public-catalogue-service.ts`'s `rows.filter(...).map(...)` chain — the `.map()` callback's receiver was the intermediate `.filter()` call result, not the `rows` identifier directly, so cohort-shapedness wasn't propagated through it.
- **Fix:** Added a small set of array-shape-preserving methods (`filter`, `sort`, `slice`, `reverse`, `flat`) that the cohort-shape check recurses through when tracing a call chain's base — deliberately excluding `map`/`flatMap`/`reduce`, which can transform the element shape entirely and are already handled by their own explicit, sound parameter-level propagation.
- **Files modified:** `tests/checkout-phase-invariants.test.ts`
- **Verification:** Re-running the real-tree check after the fix correctly reported all 4 violations (2 files × `priceMinor`/`currency` each) before the source fixes; after the source fixes, it reports zero.

**2. [Rule 2 - Missing Critical] Two genuine, previously-undetected legacy reads found and removed — not declared in the plan's own `files_modified` list**
- **Found during:** Task 1, running the new invariant against the real tree (its explicit purpose)
- **Issue:** The plan's frontmatter only listed `tests/checkout-phase-invariants.test.ts` and `tests/support/cohort-fixtures.ts` as files this plan touches, but Task 1's own action text says to "run it against the real tree and fix whatever it finds" — the invariant found two real application-code reads (`cohort-service.ts`, `readiness-service.ts`, `public-catalogue-service.ts`) that the plan could not have enumerated in advance without already knowing the invariant's result.
- **Fix:** Removed the two reads and their now-dead type fields/select entries; updated four dependent test files whose fixtures/assertions expected the removed shape.
- **Files modified:** `src/server/services/cohort-service.ts`, `src/server/services/readiness-service.ts`, `src/server/services/public-catalogue-service.ts`, `tests/cohort-service.test.ts`, `tests/cohort-readiness.test.ts`, `tests/components/cohort-cards.test.tsx`, `tests/public-catalogue-service.test.ts`
- **Verification:** `npx tsc --noEmit` clean; 157/157 tests pass across the invariant file and all four affected test files.

---

**Total deviations:** 2 auto-fixed (1 bug in the invariant's own logic, caught by its own real-tree run before it could ship silently incomplete; 1 missing-critical fix that IS this task's stated purpose, just not pre-enumerable in the plan's frontmatter). **Impact:** No scope creep — both fixes are exactly what Task 1's own action text asked for ("run it against the real tree and fix whatever it finds").

## Issues Encountered

None beyond the invariant-logic bug documented above, caught and fixed within Task 1 before the checkpoint.

## User Setup Required

None — no new environment variable or external service; this plan only documents variables 07-01 already introduced.

**Carried-forward item (not a blocker, an explicit deferral):** `Cohort.priceMinor`/`Cohort.currency` remain in the schema, unused by any application code (mechanically enforced). A future phase or maintenance task can run the guarded cleanup migration this plan's Task 3 would have created — re-verify the two evidence facts (zero reads, zero unpriced-both-rails Cohorts) are still true before dropping, since new Cohort rows may exist by then.

## Next Phase Readiness

- 07-12 (final acceptance) can proceed — the legacy-reference invariant is a permanent addition to the phase-wide invariant suite it will re-run.
- No blockers. All changes staged (`git add`) but **not committed** per this plan's global constraint.

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-13*
