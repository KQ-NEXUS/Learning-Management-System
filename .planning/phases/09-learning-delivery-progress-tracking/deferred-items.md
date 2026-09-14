# Deferred Items — Phase 09

Out-of-scope discoveries logged during plan execution, not fixed (per executor scope-boundary rule).

## 09-02

- **`npx tsc --noEmit` pre-existing failures unrelated to this plan.** Running the full-repo
  `tsc --noEmit` check surfaces ~25 pre-existing errors in `tests/payment-reconciliation.integration.test.ts`,
  `tests/paystack-webhook.integration.test.ts`, `tests/refund.integration.test.ts`,
  `tests/schema-payment-split.test.ts`, and `tests/support/cohort-fixtures.ts` — all referencing
  Prisma fields (`platformGrossActualMinor`, `gatewayFeeSchedule`, `baseAmountMinor`, `reconciledAt`,
  etc.) that do not exist on the currently-generated Prisma client in this worktree. These files were
  not touched by this plan (confirmed via `git status --short` before and after execution) and none
  of the three new modules (`lesson-sequencing.ts`, `completion-rule.ts`, `completion-engine.ts`)
  appear anywhere in the `tsc` error output. Consistent with Phase 8 (Finance Reconciliation) schema
  work in flight on a sibling branch/worktree not yet reflected in this worktree's generated Prisma
  client. Not fixed — out of scope for plan 09-02.
