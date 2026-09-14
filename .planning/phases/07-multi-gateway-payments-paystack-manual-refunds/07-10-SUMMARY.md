---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 10
subsystem: payments
tags: [finance-ui, resource-table, detail-layout, manual-payment, refunds, rbac]

# Dependency graph
requires:
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-08)
    provides: "confirmManualPayment / recordRefund — permission-gated, server-validated manual-confirmation and refund services with the ALREADY_PAID result shape and the eligible-value cap error"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-09)
    provides: "OrderBreakdownCard — the shared four-line commercial breakdown component, reused verbatim for the Finance detail's Learner charge section"
  - phase: 07-multi-gateway-payments-paystack-manual-refunds (plan 07-07)
    provides: "PaymentAttempt's four actual-settlement columns (gatewayFeeActualMinor/schoolSettlementActualMinor/platformGrossActualMinor/platformNetActualMinor) and exceptionNote, written by the reconciliation sweep"
provides:
  - "payment-read-service.ts — listPaymentsForStaff/getPaymentDetailForStaff, payments.view-scoped reads, plus the discretionary derivedSettlementState three-state view-model"
  - "/staff/payments — the ResourceTable Finance list across all three providers"
  - "/staff/payments/[orderId] — the stacked DetailLayout with Learner charge / Settlement / Manual confirmation / Refunds sections"
  - "ManualPaymentDialog.tsx, RefundDialog.tsx, actions.ts — the two PAY-03/PAY-05 dialogs and their Server Actions"
affects: [07-11, 07-12, 07-UAT]

# Actuals (#2632)
actuals:
  tokens: 28300
  tasks: 3
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "payment-read-service.ts follows the createXService(deps) / createPrismaBackedXService(client, withPermission) / built-instance-export shape every other 07-phase service (manual-payment-service.ts, refund-service.ts) already uses, keeping the read side testable with injected fakes and no Docker."
    - "derivedSettlementState lives in the service, not either page component — a three-state view-model (ESTIMATED_ONLY/RECONCILED/EXCEPTION) derived once from the latest SUCCEEDED PaymentAttempt's actual columns plus its exceptionNote, so the list row and the detail badge can never disagree about the same Order."
    - "ManualPaymentDialog/RefundDialog are self-contained trigger+dialog client components (button, open/pending/error state, and the PublishDialog-precedent dialog body all in one file) rather than a separate page-level actions wrapper, matching this plan's own files_modified list exactly."
    - "The already-paid banner (PAY-04) is rendered server-side from the page's own read, never reconstructed client-side — on an ALREADY_PAID action result the dialog closes and calls router.refresh(), letting the server-rendered page (the source of truth) show the banner."

key-files:
  created:
    - src/server/services/payment-read-service.ts
    - src/app/staff/payments/page.tsx
    - src/app/staff/payments/PaymentsTable.tsx
    - src/app/staff/payments/[orderId]/page.tsx
    - src/app/staff/payments/actions.ts
    - src/app/staff/payments/ManualPaymentDialog.tsx
    - src/app/staff/payments/RefundDialog.tsx
    - tests/payment-read-service.test.ts
    - tests/components/payment-detail.test.tsx
    - tests/staff-payments-actions.test.ts
  modified:
    - src/app/staff/layout.tsx

key-decisions:
  - "The Finance list's scope resolver is `() => ({})` (GLOBAL-grant-required), mirroring resource-service.ts's own 'list with no scope requires a GLOBAL grant' convention — there is no single Order to scope a cross-cohort list to, so the list either sees everything (a GLOBAL payments.view grant) or nothing, never a partial cohort-filtered set (no cohort-scoped Finance role exists in the seeded roles)."
  - "RefundStatus's StatusPill tone mapping (REQUESTED/PROCESSING -> neutral, COMPLETED -> success, FAILED -> danger, RECORDED_MANUALLY -> accent) is 07-10's own discretionary extension of 07-UI-SPEC §5's explicit RECORDED_MANUALLY-only guidance, following the same evaluative-outcome convention every other StatusPill in this phase uses — not a locked design-contract table."
  - "The refund's accessDecision field (RETAINED/REVOKED) has no locked UI-SPEC copy but is a required, non-optional recordRefund input (07-08) — added to RefundDialog as a plain select with self-evident labels (Rule 2: the dialog could not call the service at all without it)."
  - "The eligible-refund-value read (payment-read-service.ts) duplicates refund-service.ts's own `amountMinor - alreadyRefundedMinor` formula for DISPLAY only, rather than importing a shared pure helper — refund-service.ts computes its authoritative cap inside a locked transaction (PAY-05/D-22); this read-only display figure is informational, and the real enforcement stays exactly where 07-08 put it."

patterns-established:
  - "money(minor, currency) — the D-14 null-vs-zero rendering rule ('— (pending reconciliation)' for null, never '0', never a blank cell) implemented once in the detail page; any future settlement-figure display in this phase should reuse the same guard rather than re-deriving it."

requirements-completed: [PAY-03, PAY-04, PAY-05, PAY-13, PAY-14]

coverage:
  - id: D1
    description: "Finance staff holding payments.view see Paystack, Stripe and manual records in one list, distinguishable by provider (plain text, never a StatusPill), with the learner charge, payment state and settlement state per row; a caller without payments.view gets the standard denied panel and the service performs no read that could confirm a record exists"
    requirement: "PAY-14"
    verification:
      - kind: unit
        ref: "tests/payment-read-service.test.ts#listPaymentsForStaff — permission gating (RBAC-06) / row shape (07-UI-SPEC §7.5) (7 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The discretionary three-state settlement derivation (Estimated only / Reconciled / Exception) is correct for the all-null, reconciled-with-no-exception, and exception cases"
    verification:
      - kind: unit
        ref: "tests/payment-read-service.test.ts#derivedSettlementState — the three-state table (07-UI-SPEC §7.5) (4 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Finance detail pairs expected against actual settlement, renders '— (pending reconciliation)' (never 0) for every unresolved actual, renders the reconciliation-exception banner in warning (never danger) tone above the Settlement section, and denies a non-payments.view caller with no facts"
    requirement: "PAY-04"
    verification:
      - kind: unit
        ref: "tests/components/payment-detail.test.tsx#PaymentDetailPage — sections and D-14 null-vs-zero (07-UI-SPEC §7.6) (4 tests), #PaymentDetailPage — RBAC-06 (3 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The manual-confirmation action renders only while payments.confirm is held and the Order is not already PAID; against a PAID Order it renders the 'This order is already paid' banner with the existing transaction inline and no confirm affordance — a duplicate/conflicting attempt is never silent"
    requirement: "PAY-04"
    verification:
      - kind: unit
        ref: "tests/components/payment-detail.test.tsx#PaymentDetailPage — manual confirmation (PAY-03, PAY-04) (3 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "ManualPaymentDialog/RefundDialog collect the required structured fields plus a >=10-character reason gating confirm, disable confirm while pending (ConfirmModal's pending contract), and render the verbatim 'Action not applied' failure copy; RefundDialog states the remaining eligible amount above the amount field before submit"
    requirement: "PAY-03"
    verification:
      - kind: unit
        ref: "tests/components/payment-detail.test.tsx#ManualPaymentDialog (4 tests), #RefundDialog (3 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Both Server Actions refuse a direct POST from a caller lacking the matching permission with zero writes, regardless of whether the button ever rendered; a refund above the eligible cap is refused with the eligible figure named in the message"
    requirement: "PAY-05"
    verification:
      - kind: unit
        ref: "tests/staff-payments-actions.test.ts#confirmManualPaymentAction / #recordRefundAction (12 tests, including the direct-post-refusal and eligible-figure-named cases)"
        status: pass
    human_judgment: false
  - id: D7
    description: "No gateway credential, subaccount code or connected-account id renders on any staff payments screen; the existing confirm-modal and publish-dialog component tests still pass unchanged"
    requirement: "PAY-14"
    verification:
      - kind: unit
        ref: "tests/components/confirm-modal.test.tsx, tests/components/publish-dialog.test.tsx (unchanged, both pass)"
        status: pass
      - kind: other
        ref: "Source review: payment-read-service.ts selects only { id, reference, currency, amountMinor, status, selectedProvider, cohort.title, user.{name,email}, paymentAttempts actuals } — no PaymentAttempt.evidence, subaccount, or connected-account field is selected or rendered anywhere in this plan's files"
        status: pass
    human_judgment: false
  - id: D8
    description: "The reconciliation-exception banner body stays legible at a very small or very large variance value — a rendered check with a real large-magnitude formatted value"
    verification: []
    human_judgment: true
    rationale: "07-UI-SPEC §8 records this as a backstop with no explicit rendered evidence required at authoring time; the banner's own copy does not state the variance inline (it points to the Settlement section's mono/tabular-nums fields), so a human visual check at a real large-magnitude value is the verification this plan's own <verification> section names as outstanding, carried into 07-UAT.md."
  - id: D9
    description: "The ManualPaymentDialog evidence/note field's 2000-character textarea ceiling is a planner assumption (07-UI-SPEC §8 unresolved), not a verified fit against the real PAY-03 requirement's intent"
    verification: []
    human_judgment: true
    rationale: "Neither 07-CONTEXT.md nor the source implementation plan specifies a maximum length or control type for this field; this plan's own action text requires the assumption be surfaced for confirmation or override at UAT rather than treated as decided."

duration: ~70min
completed: 2026-09-13
status: complete
---

# Phase 07 Plan 10: Finance Payments List, Detail, and the Manual-Confirmation/Refund Dialogs Summary

**The Finance-facing `/staff/payments` list and `/staff/payments/[orderId]` detail render across all three providers with a discretionary expected-vs-actual settlement view, and the two PublishDialog-precedent dialogs (`ManualPaymentDialog`, `RefundDialog`) drive 07-08's `confirmManualPayment`/`recordRefund` services through permission-gated Server Actions that refuse a direct POST regardless of what the page ever rendered.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3/3 completed
- **Files modified:** 11 (10 created, 1 modified)

## Accomplishments

- **`payment-read-service.ts`** — `listPaymentsForStaff()` (GLOBAL-grant `payments.view`) and `getPaymentDetailForStaff(orderId)` (`payments.view` in the Order's cohort scope, via `orderCohortScope`), plus the exported pure `derivedSettlementState(actuals)`: "Estimated only" while every actual field on the latest SUCCEEDED `PaymentAttempt` is null (D-14), "Exception" once actuals are present with a reconciliation `exceptionNote` (07-07), "Reconciled" otherwise. The detail read also computes `eligibleRefundMinor` (learner total minus every non-FAILED recorded refund, floored at 0, and forced to 0 when nothing was ever captured) for the Refund button's own gating, and resolves refund-actor names via a best-effort supplementary `User` lookup (never the authorization gate).
- **`/staff/payments`** — a `ResourceTable<PaymentRow>` with the §7.5 columns (Order/Learner/Amount/Provider/Payment/Settlement), Provider rendered as plain text (never a `StatusPill`), a search filter over learner name/email/order reference, a `select` Status filter, and a 4-option Provider filter that segments automatically through `ResourceTable`'s existing `<=4` threshold. No `onCreate`; `emptyBody` overridden with the §6 copy verbatim. The staff nav gained one `{ label: "Payments", href: "/staff/payments" }` entry after "Enrolments".
- **`/staff/payments/[orderId]`** — `DetailLayout` in `mode="stacked"`, four sections in §7.6's order. "Learner charge" reuses `OrderBreakdownCard` (07-09) against the Order's own D-13 snapshot — never a second, independently computed figure. "Settlement" renders the expected/actual pairs with every unresolved actual rendered as the literal `"— (pending reconciliation)"` (never `"0"`, D-14), and the reconciliation-exception banner in warning (not danger) tone above the section when `settlementState === "EXCEPTION"`. "Manual confirmation" renders `ManualPaymentDialog`'s trigger only while `payments.confirm` is held and the Order is not `PAID`; against a `PAID` Order it renders the "This order is already paid" banner with the existing transaction's provider/date/reference inline and no confirm affordance (PAY-04). "Refunds" lists existing refunds (reference, amount, `RefundStatus` pill, actor, date — no placeholder text when empty) and renders `RefundDialog`'s trigger only while `refunds.manage` is held and eligible captured value remains. A denied caller gets the identical `DetailLayout` denied panel with no facts; a hard-invariant guard throws (mirroring 07-09's own `OrderBreakdownCard` callers) rather than silently rendering if the D-13 snapshot is somehow missing.
- **`ManualPaymentDialog.tsx`/`RefundDialog.tsx`** — built on the `PublishDialog.tsx` precedent (structured fields + `MIN_REASON = 10`, the same focus-trap/ESC/return-focus behaviour reused verbatim, never a bare `ConfirmModal`). `ManualPaymentDialog` collects amount, currency, date, channel, reference, and a 2000-character-max evidence/note `<textarea>` (the planner assumption 07-UI-SPEC §8 flags as unresolved — implemented and commented at the field, repeated here rather than silently decided). `RefundDialog` renders the "Up to {eligible remaining amount} can be refunded." hint above the amount field, uses `tone="danger"`, and collects the required `accessDecision` (RETAINED/REVOKED — a Rule 2 addition; `recordRefund` cannot be called without it and 07-UI-SPEC has no locked copy for it). Both disable confirm while pending and render the verbatim "Action not applied" failure copy.
- **`actions.ts`** — `confirmManualPaymentAction`/`recordRefundAction`, both zod-validating every field server-side and delegating straight to `confirmManualPayment`/`recordRefund` (07-08), which re-resolve the Order's scope and refuse a direct POST from an unauthorized caller regardless of whether either dialog's button ever rendered (RBAC-06). `ManualConfirmActionResult`'s `ALREADY_PAID` branch carries the existing attempt's facts back to the dialog, which closes itself and calls `router.refresh()` — the server-rendered page, not the dialog, is what shows the PAY-04 banner.

## Task Commits

Per this plan's `<global_constraints>` ("Never run `git commit`."), **no commits were made**. All changes are staged with `git add` only, task by task:

1. **Task 1: Permission-scoped payments read service and the Finance list** — staged: `src/server/services/payment-read-service.ts` (new), `src/app/staff/payments/page.tsx` (new), `src/app/staff/payments/PaymentsTable.tsx` (new), `src/app/staff/layout.tsx`, `tests/payment-read-service.test.ts` (new).
   - Suggested message: `feat(07-10): add the payments.view-scoped Finance payments read service and list`
2. **Task 2: Finance payment detail — expected versus actual, and the exception banner** — staged: `src/app/staff/payments/[orderId]/page.tsx` (new), `src/server/services/payment-read-service.ts` (detail read, same file as Task 1), `tests/components/payment-detail.test.tsx` (new).
   - Suggested message: `feat(07-10): render the Finance detail's expected-vs-actual settlement and reconciliation-exception banner`
3. **Task 3: Manual-confirmation and refund dialogs with their PAY-04 guard** — staged: `src/app/staff/payments/ManualPaymentDialog.tsx` (new), `src/app/staff/payments/RefundDialog.tsx` (new), `src/app/staff/payments/actions.ts` (new), `src/app/staff/payments/[orderId]/page.tsx` (dialog wiring, same file as Task 2), `tests/staff-payments-actions.test.ts` (new), `tests/components/payment-detail.test.tsx` (dialog cases, same file as Task 2).
   - Suggested message: `feat(07-10): wire ManualPaymentDialog/RefundDialog to confirmManualPayment/recordRefund with the PAY-04 already-paid guard`

**Plan metadata:** not committed (per constraint); `07-10-SUMMARY.md` staged with `git add` only.

## Files Created/Modified

- `src/server/services/payment-read-service.ts` — `listPaymentsForStaff`, `getPaymentDetailForStaff`, `derivedSettlementState`, `PaymentListRow`, `PaymentDetailResult`, and their Prisma-backed bindings
- `src/app/staff/payments/page.tsx` — the Finance list's Server Component entry, `payments.view`-scoped
- `src/app/staff/payments/PaymentsTable.tsx` — the `ResourceTable<PaymentRow>` client component (columns, filters, sort, denied/empty states)
- `src/app/staff/payments/[orderId]/page.tsx` — the stacked `DetailLayout` with all four sections, the hard-invariant guard, and the `can()`-gated dialog wiring
- `src/app/staff/payments/actions.ts` — `confirmManualPaymentAction`, `recordRefundAction`
- `src/app/staff/payments/ManualPaymentDialog.tsx` — the PAY-03 trigger+dialog client component
- `src/app/staff/payments/RefundDialog.tsx` — the PAY-05 trigger+dialog client component
- `src/app/staff/layout.tsx` — one new `StaffNavItem`, "Payments", after "Enrolments"
- `tests/payment-read-service.test.ts` — permission gating, settlement-state derivation table, list/detail row shape, eligible-refund-value cap, and the staff-nav source-scan assertion (22 tests)
- `tests/components/payment-detail.test.tsx` — the detail page's RBAC-06/sections/D-14/manual-confirmation/refunds cases plus both dialogs' render/gating/pending/failure cases (21 tests)
- `tests/staff-payments-actions.test.ts` — direct-post permission refusals, malformed-input refusals, the ALREADY_PAID mapping, and the eligible-figure-named cap refusal (12 tests)

## Decisions Made

See `key-decisions` in frontmatter. The two genuinely interpretive calls:

1. **The Finance list's scope is GLOBAL-required (`() => ({})`), not per-cohort.** There is no single Order to scope a cross-provider, cross-cohort list read to — mirroring `resource-service.ts`'s own documented "list with no scope requires a GLOBAL grant" convention for exactly this shape.
2. **RefundStatus's tone mapping beyond `RECORDED_MANUALLY` is this plan's own discretionary extension**, following the same evaluative-outcome convention every other `StatusPill` in this phase already uses (success/danger/neutral for outcome, accent reserved for the one categorical distinction 07-UI-SPEC §5 names explicitly).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `RefundDialog` needed an `accessDecision` field with no locked UI-SPEC copy**
- **Found during:** Task 3, wiring `RefundDialog`'s fields against `recordRefund`'s required (non-optional) `accessDecision: "RETAINED" | "REVOKED"` input
- **Issue:** 07-UI-SPEC §6.1 lists `RefundDialog`'s fields as amount hint + reason only; without an access-decision control the dialog could never call `recordRefund` at all — a required server input with no client-side way to supply it.
- **Fix:** Added a plain `<select>` labelled "Access after refund" with two self-evident options ("Learner keeps enrolment access" / "Revoke enrolment access"), defaulting to `RETAINED`.
- **Files modified:** `src/app/staff/payments/RefundDialog.tsx`
- **Verification:** `tests/components/payment-detail.test.tsx#RefundDialog` — the dialog renders and submits successfully with this field present; `tsc --noEmit` clean.

---

**Total deviations:** 1 auto-fixed (missing-critical, a required field the service could not be called without). **Impact on plan:** Small and structurally necessary — no scope creep beyond what `recordRefund`'s own existing (07-08) required input already implied.

## Issues Encountered

- **Locale-dependent currency formatting in the sandbox's `Intl.NumberFormat` default locale** surfaced a test assertion that expected the `₦` symbol literally but received `"NGN"` instead — not a code defect (the component correctly formats currency; only the specific glyph is locale-dependent in this Node/jsdom environment). Fixed by relaxing the assertion to match the sentence shape and the formatted `100,000.00` figure rather than one specific currency symbol.
- **`vi.mock` factory hoisting in `tests/staff-payments-actions.test.ts`**: a first pass declared the mocked error classes as plain top-level `class` statements referenced inside `vi.mock(...)` factories — `vi.mock` calls are hoisted above all other top-level statements (including `class` declarations), so the classes were accessed before their own initializers ran (TDZ). Fixed by moving every class into the `vi.hoisted(() => {...})` block and referencing `mocks.ClassName` (a property access evaluated lazily, when the factory actually runs) from inside each `vi.mock` factory, rather than a destructured top-level binding.

## User Setup Required

None — this plan reads no new environment variable and introduces no new external service dependency. It calls only 07-08's already-provisioned `confirmManualPayment`/`recordRefund` and 07-07's already-populated `PaymentAttempt` actual-settlement columns.

**Outstanding human verification** (carried into `07-UAT.md`, per this plan's own `<verification>` section):
1. The reconciliation-exception banner's rendered legibility at a very large variance magnitude — 07-UI-SPEC §8 records this as a backstop with no explicit rendered evidence at authoring time.
2. The `ManualPaymentDialog` evidence/note field's 2000-character `<textarea>` ceiling is a planner assumption (07-UI-SPEC §8 unresolved) — confirm or override before treating the number as decided.

## Next Phase Readiness

- Finance can now see every payment across all three providers, drill into a single Order's expected-vs-actual settlement, and safely confirm a manual payment or record a refund — the last piece of PAY-03/PAY-04/PAY-05's staff-facing surface for this phase.
- `payment-read-service.ts`'s `PaymentDetailResult`/`PaymentListRow` shapes are ready for a future Phase 8 (RPT-01 onward) reconciliation/finance dashboard to reuse or extend, per 07-UI-SPEC §0.2's explicit deferral of CSV export/reconciliation dashboards to that phase.
- No blockers. All changes staged (`git add`) but **not committed** per this plan's global constraint — the repository owner should review the staged diff and commit using the suggested per-task messages above (or a squashed equivalent).

## Known Stubs

None — every screen and dialog this plan builds is wired to real `payments.view`/`payments.confirm`/`refunds.manage`-gated reads and services, not mock UI or placeholder data. The two outstanding human-verification items above are explicitly deferred-by-design (a rendered visual check and a planner assumption pending UAT confirmation), not unfinished application logic.

## Self-Check: PASSED

All 11 created/modified files verified present on disk: `src/server/services/payment-read-service.ts`,
`src/app/staff/payments/page.tsx`, `src/app/staff/payments/PaymentsTable.tsx`,
`src/app/staff/payments/[orderId]/page.tsx`, `src/app/staff/payments/actions.ts`,
`src/app/staff/payments/ManualPaymentDialog.tsx`, `src/app/staff/payments/RefundDialog.tsx`,
`src/app/staff/layout.tsx`, `tests/payment-read-service.test.ts`, `tests/components/payment-detail.test.tsx`,
`tests/staff-payments-actions.test.ts`, and this SUMMARY itself. No commit hashes to verify — per this
plan's `<global_constraints>`, every change is staged with `git add` and never committed. Verified via
`git status --short`: all eleven files show a clean staged `A ` or `M ` status.

Full targeted verification (`npx tsc --noEmit && npx vitest run tests/components/payment-detail.test.tsx
tests/payment-read-service.test.ts tests/staff-payments-actions.test.ts tests/components/confirm-modal.test.tsx
tests/components/publish-dialog.test.tsx`) passed in full: 71/71 tests, zero `tsc` diagnostics (pre-existing,
unrelated `.next`/`netlify/functions` type errors excluded — neither touched by this plan).
`tests/boundary.test.ts` and `tests/checkout-phase-invariants.test.ts` (20/20) confirmed no regression.

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-13*
