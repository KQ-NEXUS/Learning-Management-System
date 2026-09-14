---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 07
subsystem: payments
tags: [paystack, stripe, reconciliation, netlify-scheduled-functions, prisma, postgres, testcontainers]

requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-04)
    provides: "The NGN Paystack tracer — PaymentAttempt.providerIntentId as the Paystack transaction reference, the AsSystem module pattern, the provider-isolation scan generalized to Paystack"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-06)
    provides: "Stripe Connect destination-charge settlement evidence (PaymentAttempt.evidence.paymentIntentId/chargeId/transferId/transferDestination), ActivateOrderAsSystemInput.settlementEvidence as the extension point"
provides:
  - "src/server/services/payment-reconciliation-service.ts — createReconcilePayments/reconcilePaymentsAsSystem, the fourth AsSystem module, idempotently enriching SUCCEEDED PaymentAttempt rows with verified provider evidence and flagging variance beyond a rounding tolerance as an exception note, never rewriting the Order or touching the Enrolment"
  - "src/server/scheduled/reconcile-payments-task.ts + netlify/functions/reconcile-payments.ts — the corrected Task 7 target from 07-RESEARCH.md's confirmed worker/pg-boss drift: a Netlify Scheduled Function (*/15 * * * *) over a pure, injectable task factory, structurally identical to release-expired-holds.ts"
  - "An actual-settlement lookup added to each provider's own client module — Paystack's fetchActualSettlement (Verify Transaction's fees + fees_split.subaccount) and Stripe's fetchActualSettlement (a single PaymentIntent retrieve expanding latest_charge.balance_transaction + latest_charge.transfer) — both narrowed to the provider-neutral ActualSettlement shape before leaving their own provider directory"
  - "buildReconciliationVarianceNote — a shared exception-note helper added to checkout-webhook-system-service.ts so the reconciliation service's variance wording never drifts from a second hand-written copy"
affects: [07-08, 07-09, 07-10]

actuals:
  tokens: 12600
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "The fourth AsSystem module (after hold-release-system-service.ts, scan-system-service.ts, checkout-webhook-system-service.ts) — an actorless, scheduled-function-only sweep, auditing actorId: null / actorType: SYSTEM, with no caller-supplied filter beyond a batch size"
    - "Two-layered idempotency for a retry-queue-less scheduled function: the candidate query excludes any row with reconciledAt already set, AND the write itself is a conditional updateMany WHERE reconciledAt IS NULL — belt-and-suspenders against a concurrent invocation, not just against a later one"
    - "A provider lookup function lives inside its own provider's client.ts and returns the plain, structurally-typed ActualSettlement shape directly — no Stripe or Paystack type crosses the adapter boundary, and no reverse import from the service back into the provider is needed either"
    - "RECONCILIATION_ROUNDING_TOLERANCE_MINOR = 1 — GatewayFeeSchedule.roundingRule is a label ('HALF_UP'), not a numeric magnitude anywhere in the schema, so a single minor-unit tolerance is the smallest defensible reading of 'the schedule's own rounding tolerance' (Claude's own discretion, CONTEXT.md's third agent-discretion bullet)"

key-files:
  created:
    - src/server/services/payment-reconciliation-service.ts
    - src/server/scheduled/reconcile-payments-task.ts
    - netlify/functions/reconcile-payments.ts
    - tests/payment-reconciliation.integration.test.ts
    - tests/reconcile-payments-task.test.ts
    - tests/netlify-reconcile-payments.test.ts
  modified:
    - src/server/payments/providers/paystack/client.ts
    - src/server/payments/providers/stripe/client.ts
    - src/server/services/checkout-webhook-system-service.ts
    - src/server/services/domain-event-service.ts
    - tests/checkout-webhook-system-service.test.ts
    - tests/boundary.test.ts

key-decisions:
  - "RECONCILIATION_ROUNDING_TOLERANCE_MINOR is a fixed 1 minor unit, not derived from GatewayFeeSchedule.roundingRule's string label — the schema carries no numeric rounding magnitude, so any nonzero interpretation is Claude's own discretion; documented in the service's own header comment rather than silently assumed."
  - "DomainEventType (domain-event-service.ts) is a closed union and did not include either new event type this plan needs (payment.reconciled, payment.reconciliation_exception) — extended it (Rule 3, blocking) since the reconciliation service could not compile or write its outbox row otherwise. Not in this plan's declared files_modified list, but unavoidable."
  - "The candidate query filters provider IN (PAYSTACK, STRIPE) explicitly, excluding MANUAL — 07-08 (manual payments) has not landed yet and MANUAL settlements have no provider API to verify against; this keeps a future MANUAL SUCCEEDED row invisible to this sweep rather than crashing it."
  - "Each provider's fetchActualSettlement throws (never returns a partial/zero-filled result) when the provider has not yet reported a needed figure — the reconciliation service's per-row try/catch treats a throw as a failed lookup, leaving reconciledAt NULL for the next scheduled invocation to retry (D-14's 'NULL never means zero' extended to 'an unresolved lookup never means zero' too)."

patterns-established:
  - "A provider-neutral ActualSettlement = { gatewayFeeActualMinor, schoolSettlementActualMinor, platformGrossActualMinor } shape, with platformNetActualMinor always derived by the consuming service in integer arithmetic, never returned by a provider lookup (D-24) — the pattern a future third provider's reconciliation lookup would follow."

requirements-completed: [PAY-07, PAY-11, PAY-17]

coverage:
  - id: D1
    description: "A sweep over a SUCCEEDED PaymentAttempt (Paystack or Stripe) with verified provider evidence writes gatewayFeeActualMinor/schoolSettlementActualMinor/platformGrossActualMinor/platformNetActualMinor/reconciledAt, with platformNetActualMinor computed as gross - fee in integer arithmetic; before any sweep, all four columns and reconciledAt read NULL"
    requirement: "PAY-17"
    verification:
      - kind: integration
        ref: "tests/payment-reconciliation.integration.test.ts#reconcilePayments — real Postgres > directly after settlement, all four actual-settlement columns and reconciledAt read NULL"
        status: pass
      - kind: integration
        ref: "tests/payment-reconciliation.integration.test.ts#reconcilePayments — real Postgres > a sweep over a SUCCEEDED Paystack attempt with verified evidence writes all four actual columns and reconciledAt, with platformNetActualMinor = gross - fee"
        status: pass
      - kind: integration
        ref: "tests/payment-reconciliation.integration.test.ts#reconcilePayments — real Postgres > a sweep over a SUCCEEDED Stripe attempt with verified evidence writes all four actual columns and reconciledAt"
        status: pass
    human_judgment: false
  - id: D2
    description: "Reconciliation is idempotent under an infrastructure with no retry queue: a second sweep over an already-reconciled attempt writes nothing new, changes no stored value, and emits no second audit event or provider lookup call"
    requirement: "PAY-11"
    verification:
      - kind: integration
        ref: "tests/payment-reconciliation.integration.test.ts#reconcilePayments — real Postgres > a second sweep over an already-reconciled attempt writes nothing new, changes no stored value, and emits no second audit event"
        status: pass
    human_judgment: false
  - id: D3
    description: "An attempt whose provider lookup fails is left entirely untouched (reconciledAt stays NULL for the next scheduled invocation to retry); the sweep respects an arbitrary batchLimit and returns { reconciled, failed } counts"
    requirement: "PAY-07"
    verification:
      - kind: integration
        ref: "tests/payment-reconciliation.integration.test.ts#reconcilePayments — real Postgres > an attempt whose provider lookup fails is left entirely untouched — reconciledAt stays NULL for the next invocation to retry"
        status: pass
      - kind: integration
        ref: "tests/payment-reconciliation.integration.test.ts#reconcilePayments — real Postgres > respects an arbitrary batchLimit and returns {reconciled, failed} counts, leaving the remainder for a later invocation"
        status: pass
    human_judgment: false
  - id: D4
    description: "A variance beyond the rounding tolerance is flagged with an exception note naming both figures, the Order's commercial columns and status (PAID) stay byte-identical, and the Enrolment is untouched — the historical Order is never rewritten"
    requirement: "PAY-07"
    verification:
      - kind: integration
        ref: "tests/payment-reconciliation.integration.test.ts#reconcilePayments — real Postgres > an actual school settlement beyond the rounding tolerance is flagged with an exception note naming both figures, and the Order's commercial columns stay byte-identical; Order.status stays PAID and the Enrolment is untouched"
        status: pass
    human_judgment: false
  - id: D5
    description: "The reconciliation sweep runs on a Netlify Scheduled Function (cron */15 * * * *) over a thin, injectable task factory — no worker process, no queue dependency — actorless and structurally identical to release-expired-holds.ts, with its import closure proven free of the permission choke point and the request-scoped actor getter"
    requirement: "PAY-11"
    verification:
      - kind: unit
        ref: "tests/reconcile-payments-task.test.ts (2 tests)"
        status: pass
      - kind: unit
        ref: "tests/netlify-reconcile-payments.test.ts (2 tests)"
        status: pass
      - kind: unit
        ref: "tests/boundary.test.ts#service-layer boundary > rejects a Prisma import from the reconcile-payments Netlify scheduled function (07-07) / keeps the scheduled-function runtime import closure away from request-only APIs / the scheduled-function closure actually reaches the reconciliation service"
        status: pass
    human_judgment: false
  - id: D6
    description: "payment-reconciliation-service.ts contains no object-literal paid-status assignment and does not import applyEnrolmentActivation; no Stripe or Paystack type crosses out of its own provider directory (the generalized isolation scan and single-paid-writer scan both stay clean)"
    requirement: "PAY-17"
    verification:
      - kind: unit
        ref: "tests/checkout-phase-invariants.test.ts#phase-wide invariant: single paid-order writer (PAY-10) / provider isolation (PAY-09)"
        status: pass
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts#activateOrderAsSystem — never writes the four actual-settlement columns (07-07, D-14)"
        status: pass
    human_judgment: false

duration: ~95min
completed: 2026-09-13
status: complete
---

# Phase 07 Plan 07: Settlement Normalization & Idempotent Actual-Settlement Reconciliation Summary

**An idempotent Netlify Scheduled Function (`*/15 * * * *`) enriches SUCCEEDED PaymentAttempt rows with verified Paystack/Stripe evidence — writing the four actual-settlement columns and flagging a rounding-tolerance variance as an exception note — without ever rewriting the historical Order, touching the Enrolment, or reviving the removed pg-boss worker.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3/3 completed
- **Files modified:** 12 (6 created, 6 modified)

## Accomplishments

- **`payment-reconciliation-service.ts`** — the fourth `AsSystem` module (`createReconcilePayments`/`reconcilePaymentsAsSystem`), selecting `SUCCEEDED` `PaymentAttempt` rows with `reconciledAt IS NULL`, scoped to `provider IN (PAYSTACK, STRIPE)` (a future 07-08 `MANUAL` row is invisible to this query, not a crash). Each row's actual figures come from an injected provider lookup; `platformNetActualMinor = platformGrossActualMinor - gatewayFeeActualMinor` is always derived here, in integer arithmetic, never returned by a provider lookup (D-24). Idempotency is two-layered: the candidate query already excludes a reconciled row, and the write itself is a conditional `updateMany WHERE reconciledAt IS NULL` — belt-and-suspenders against a concurrent invocation. A failed lookup leaves the row completely untouched (`reconciledAt` stays NULL) so the next scheduled invocation is the retry — no second dedupe mechanism was added on top. A variance beyond `RECONCILIATION_ROUNDING_TOLERANCE_MINOR` (1 minor unit — see Decisions) writes an `exceptionNote` naming both figures and emits a `payment.reconciliation_exception` domain event/audit row instead of the ordinary `payment.reconciled` pair; it never touches `Order.status`, the Order's commercial snapshot columns, or the Enrolment.
- **Provider lookups added to each adapter's own client module** — `providers/paystack/client.ts` gained `fetchActualSettlement(reference)`, reading `fees`/`fees_split.subaccount` off an independent Verify Transaction call (extending `PaystackVerifiedTransaction` with a narrow `fees_split` field) and throwing rather than returning a zero-filled result when Paystack has not yet reported them. `providers/stripe/client.ts` gained `fetchActualSettlement(paymentIntentId)`, a single `paymentIntents.retrieve` expanding `latest_charge.balance_transaction` (Stripe's real fee) and `latest_charge.transfer` (the amount actually moved to the connected account), throwing `StripeActualSettlementUnavailableError` when any piece isn't resolvable yet. Both return the plain, provider-neutral `ActualSettlement` shape directly — no Stripe or Paystack type leaves its own directory, proven by the existing generalized `checkout-phase-invariants.test.ts` isolation scan.
- **`reconcile-payments-task.ts` + `netlify/functions/reconcile-payments.ts`** — the corrected Task 7 target 07-RESEARCH.md identified (the `worker/`/`pg-boss` directory this plan's source design named no longer exists): structurally identical to `release-expired-holds-task.ts`/`release-expired-holds.ts` — an exported `RECONCILE_PAYMENTS_BATCH_SIZE` (25), a deps type, a factory, a bound runner, and a thin handler with `Config.schedule`. Cadence is `*/15 * * * *`, Claude's own discretion under CONTEXT.md's third agent-discretion bullet and 07-RESEARCH.md's Assumption A5 (reconciliation is lower-urgency than the 5-minute hold sweep since D-14/D-18 already treat a NULL actual value as normal for a fresh payment) — the rationale is recorded in the function's own header comment.
- **`buildReconciliationVarianceNote`** — a small pure helper added to `checkout-webhook-system-service.ts` so the reconciliation service's exception-note wording (naming both the actual and expected figures for one commercial component) never drifts from a second hand-written copy, per the plan's own suggestion to extend that file only for a shared helper.
- **Real-Postgres proof, not BLOCKED:** Docker was available. `tests/payment-reconciliation.integration.test.ts` (new, 8 tests) proves every case in the plan's `<behavior>` list against a real Testcontainers Postgres, including both a Paystack-evidence and a Stripe-evidence case, idempotency (byte-identical row snapshot across a second sweep, zero extra lookup calls, zero extra audit events), a failed-lookup case (row left byte-identical, `reconciledAt` still NULL), a variance case (exception note naming both figures, Order and Enrolment both byte-identical, `Order.status` still `PAID`), and a `batchLimit` case (exactly the limit reconciled, the remainder left for a later invocation). The provider lookup is injected in every case — no test performs a real Paystack or Stripe network call.
- **Regression guard added:** `tests/checkout-webhook-system-service.test.ts` gained a case asserting a successful settlement's `PaymentAttempt` write never even mentions the four actual-settlement keys (not merely that they're `null`) — the regression this plan's own D-14 discipline most needs guarding against is a future edit writing an estimate into an actual column at webhook time.

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`."), **no commits were made**. All changes are staged with `git add` only, task by task:

1. **Task 1 (TDD RED): failing reconciliation tests — idempotency, null-before-evidence, and variance** — staged as part of the combined `tests/payment-reconciliation.integration.test.ts` (new) / `tests/checkout-webhook-system-service.test.ts` changes below (implemented together with Task 2 rather than as a strict two-commit RED-then-GREEN sequence — see Deviations/Process note, mirroring 07-06's own recorded precedent for the same reason: staging, not committing, is this plan's only recorded artifact).
   - Suggested message: `test(07-07): add failing reconciliation idempotency, null-before-evidence, and variance tests`
2. **Task 2: idempotent actual-settlement reconciliation service** — staged: `src/server/services/payment-reconciliation-service.ts` (new), `src/server/payments/providers/paystack/client.ts`, `src/server/payments/providers/stripe/client.ts`, `src/server/services/checkout-webhook-system-service.ts`, `src/server/services/domain-event-service.ts` (necessary deviation — see below), `tests/payment-reconciliation.integration.test.ts`, `tests/checkout-webhook-system-service.test.ts`.
   - Suggested message: `feat(07-07): enrich settled payments with verified actual-settlement evidence, idempotently`
3. **Task 3: scheduled reconciliation runner on the Netlify Scheduled Function pattern** — staged: `src/server/scheduled/reconcile-payments-task.ts` (new), `netlify/functions/reconcile-payments.ts` (new), `tests/reconcile-payments-task.test.ts` (new), `tests/netlify-reconcile-payments.test.ts` (new), `tests/boundary.test.ts`.
   - Suggested message: `feat(07-07): run the reconciliation sweep on a Netlify Scheduled Function`

**Plan metadata:** not committed (per constraint); `07-07-SUMMARY.md` staged with `git add` only.

## Files Created/Modified

- `src/server/services/payment-reconciliation-service.ts` — `createReconcilePayments`, `reconcilePaymentsAsSystem`, `ActualSettlement`, `RECONCILIATION_ROUNDING_TOLERANCE_MINOR`, `MissingReconciliationCorrelationError`
- `src/server/scheduled/reconcile-payments-task.ts` — `RECONCILE_PAYMENTS_BATCH_SIZE`, `ReconcilePaymentsTaskDeps`, `createReconcilePaymentsTask`, `runReconcilePaymentsTask`
- `netlify/functions/reconcile-payments.ts` — `createReconcilePaymentsHandler`, default handler, `config` (`*/15 * * * *`)
- `src/server/payments/providers/paystack/client.ts` — `PaystackVerifiedTransaction.fees_split`, `fetchActualSettlement`
- `src/server/payments/providers/stripe/client.ts` — `fetchActualSettlement`, `StripeActualSettlementUnavailableError`
- `src/server/services/checkout-webhook-system-service.ts` — `buildReconciliationVarianceNote`
- `src/server/services/domain-event-service.ts` — `DomainEventType` gained `payment.reconciled`/`payment.reconciliation_exception` (deviation — see below)
- `tests/payment-reconciliation.integration.test.ts` — real-Postgres idempotency, null-before-evidence, variance, and batch-limit proofs (new, 8 tests)
- `tests/reconcile-payments-task.test.ts` — scheduled-task factory unit tests (new, 2 tests)
- `tests/netlify-reconcile-payments.test.ts` — Netlify handler/config unit tests (new, 2 tests)
- `tests/checkout-webhook-system-service.test.ts` — the four-actual-columns-untouched regression case (1 new test)
- `tests/boundary.test.ts` — Prisma-import rejection and non-vacuous closure-reaches-service assertions for `reconcile-payments.ts` (2 new tests)

## Decisions Made

See `key-decisions` in frontmatter. The two genuinely interpretive calls:

1. **`RECONCILIATION_ROUNDING_TOLERANCE_MINOR` is a fixed 1 minor unit.** The plan's own text asks for "the schedule's own rounding tolerance," but `GatewayFeeSchedule.roundingRule` is a string label (`"HALF_UP"`, `"CEIL"`) with no numeric magnitude anywhere in the schema or `pricing.ts`. The only rounding this codebase's own gross-up formula (`ceilDiv`) can introduce against an exact fractional value is a single minor-unit step, so one minor unit is the smallest defensible reading — recorded in the service's own header comment as Claude's discretion (CONTEXT.md's third agent-discretion bullet) rather than silently assumed.
2. **The candidate query explicitly scopes to `provider IN (PAYSTACK, STRIPE)`**, excluding `MANUAL`. 07-08 (manual payments/refunds) has not landed yet in this phase's execution order, so no `MANUAL` `PaymentAttempt` can exist today — but scoping the query now (rather than after 07-08 lands) means a future `MANUAL` `SUCCEEDED` row is simply invisible to this sweep, not a lookup-failure/crash, since there is no provider API to verify a manual confirmation against.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `DomainEventType` (domain-event-service.ts) needed two new members, though the file was not in this plan's declared `<files>` list**
- **Found during:** Task 2
- **Issue:** `DomainEventType` is a closed union — a string outside it is a compile error by design. The reconciliation service's own `<action>` text requires it to "emit a domain event" on both the ordinary and variance paths, but neither `payment.reconciled` nor `payment.reconciliation_exception` existed in the union, and `writeDomainEvent`'s signature is typed against exactly this union.
- **Fix:** Added `payment.reconciled` and `payment.reconciliation_exception` to `DomainEventType`, with a comment explaining the ordinary-vs-variance distinction (mirroring the existing `enrolment.approved` vs `enrolment.activated` comment's own precedent for why the distinction matters to a future drain job).
- **Files modified:** `src/server/services/domain-event-service.ts`
- **Verification:** `npx tsc --noEmit` clean (module-scoped); `tests/payment-reconciliation.integration.test.ts` (8/8, real Postgres) proves both event types are written correctly by inspecting the resulting `AuditEvent`/`PaymentAttempt` rows.

**2. [Process note, not a deviation] Tasks 1 and 2 were implemented together rather than as a strict two-commit RED-then-GREEN sequence**
- Because staging (not committing) is this plan's only recorded artifact, and the plan's own verification gates for Task 1 (a RED run naming the missing module) and Task 2 (a GREEN run) were both confirmed in sequence during this session, the net effect was achieved but the staged diff reflects the final GREEN state rather than a separately staged RED-only snapshot. No test assertion in `tests/payment-reconciliation.integration.test.ts` was weakened to make this pass — every case in Task 1's `<behavior>` list has a corresponding, currently-passing assertion.

---

**Total deviations:** 1 auto-fixed (blocking, compile-necessity), 1 process note. **Impact on plan:** The one fix was an unavoidable, direct consequence of Task 2's own requirement to emit a domain event on both reconciliation outcomes — no scope creep, no new application-facing behavior beyond what the plan's three tasks already specified.

## Issues Encountered

- **Test isolation within `tests/payment-reconciliation.integration.test.ts`:** because `reconcilePayments`'s candidate query deliberately takes no caller-supplied filter (an actorless sweep, by design — the same property the plan itself requires), a row one test case deliberately leaves un-reconciled (the provider-lookup-failure case) would otherwise leak into a later case's candidate set within the same shared Testcontainers Postgres and inflate its `{ reconciled, failed }` counts. Resolved with an `afterEach` hook that wipes every table this file seeds, in dependency-safe order (`domainEvent` → `auditEvent` → `enrolment` → `paymentAttempt` → `order` → `cohort` → `course` → `user`), between every case — not a deviation from the plan, just the isolation discipline a filter-less sweep's own test suite needs.
- Docker was available throughout this session (confirmed via `docker ps` before Task 1), so `tests/payment-reconciliation.integration.test.ts` is not BLOCKED — all 8 cases ran to completion against real Postgres and are green.

## User Setup Required

None — this plan reads no new environment variable and introduces no new external service dependency. It calls Paystack's Verify Transaction endpoint and Stripe's PaymentIntent retrieve endpoint through the same `PAYSTACK_SECRET_KEY`/`STRIPE_SECRET_KEY` credentials 07-01/07-04/07-06 already provisioned.

**Outstanding human verification** (carried into `07-UAT.md`): a real Paystack test-mode split transaction and a real Stripe test-mode destination charge, each left to settle long enough for the provider to report final fee/settlement figures, then a manual invocation of the reconciliation sweep against them to confirm the actual columns populate correctly from a live provider response (as opposed to this plan's injected-fake proof). Not attempted in this sandbox — no live provider evidence exists yet, since 07-06's own outstanding human verification (a real Stripe destination charge) has not been performed either.

## Next Phase Readiness

- 07-08 (manual payments/refunds) can extend `payment-reconciliation-service.ts`'s candidate query to include `MANUAL` once it defines what "actual settlement" means for a manually-confirmed payment (there is no provider API to verify against, so this will need its own resolution path, not a `lookupPaystackActualSettlement`-shaped injected dependency).
- 07-09/07-10 (Finance payment-detail views, PAY-13 refunds) can read `PaymentAttempt.gatewayFeeActualMinor`/`schoolSettlementActualMinor`/`platformGrossActualMinor`/`platformNetActualMinor`/`reconciledAt`/`exceptionNote` exactly as D-18 specifies — expected-vs-actual and the exception flag are both now populated by this sweep, not merely schema placeholders.
- No blockers. All changes staged (`git add`) but **not committed** per this plan's global constraint — the repository owner should review the staged diff and commit using the suggested per-task messages above (or a squashed equivalent) before continuing to 07-08.

## Known Stubs

None — every layer this plan touches (the reconciliation service, both provider lookups, the scheduled-function pair) is fully wired against real logic, not a placeholder. The one deliberately deferred piece is the human-only real-provider verification noted above, which is outside this plan's automatable scope by design (07-01/07-06's own precedent for the same kind of deferral).

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 12 created/modified files verified present on disk, plus this SUMMARY
itself: `src/server/services/payment-reconciliation-service.ts`,
`src/server/scheduled/reconcile-payments-task.ts`,
`netlify/functions/reconcile-payments.ts`,
`src/server/payments/providers/{paystack,stripe}/client.ts`,
`src/server/services/checkout-webhook-system-service.ts`,
`src/server/services/domain-event-service.ts`,
`tests/payment-reconciliation.integration.test.ts`,
`tests/reconcile-payments-task.test.ts`, `tests/netlify-reconcile-payments.test.ts`,
`tests/checkout-webhook-system-service.test.ts`, `tests/boundary.test.ts`.
No commit hashes to verify — per this plan's `<global_constraints>`, every
change is staged with `git add` and never committed. Verified via
`git status --short`: all twelve files plus this SUMMARY show a clean
staged `A ` or `M ` (no unstaged remainder).
