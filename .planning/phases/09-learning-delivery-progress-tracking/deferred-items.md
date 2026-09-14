# Deferred Items — Phase 9

Out-of-scope discoveries logged during plan execution, per the executor's
scope-boundary rule (only auto-fix issues directly caused by the current
task's own changes).

## 09-01 (execution date: 2026-09-14)

- **`npx tsc --noEmit` fails with pre-existing, unrelated errors** — none
  reference any file this plan touched (`prisma/schema.prisma`,
  `src/server/services/access-window.ts`, `tests/access-window.test.ts`).
  Errors:
  - `src/app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.`
  - `Cannot find module 'stripe' or its corresponding type declarations` in
    `src/server/payments/providers/stripe/{checkout-session,client,refund,webhook}.ts`
    and `tests/checkout-{hold-race,webhook}.integration.test.ts`.
  - Root cause: the `stripe` package (declared in `package.json`, pinned
    `22.6.1` per Phase 6's human-vetted legitimacy check) is not present in
    `node_modules` in this execution sandbox — confirmed absent in both the
    worktree and the main repository's `node_modules`, so this is an
    environment/install gap, not a regression introduced by this plan. This
    is the same class of sandbox limitation STATE.md already documents for
    Phase 6 (Docker/DB unavailability); here it manifests as a missing
    dependency install rather than a missing service.
  - Action: not fixed (out of scope — Rule 3 excludes package-manager
    installs from auto-fix, and this package is already declared/vetted, so
    no legitimacy checkpoint is needed either; it just needs `npm install`
    run in an environment with registry access). `src/app/layout.tsx`'s
    `LayoutProps` error is unrelated to Phase 9 entirely (Next.js 16
    App-Router typed-route global, pre-existing).

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
