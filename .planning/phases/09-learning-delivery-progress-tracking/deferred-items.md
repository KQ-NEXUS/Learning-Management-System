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

## 09-04 (execution date: 2026-09-14)

- **`npx tsc --noEmit` pre-existing failures unrelated to this plan.** Same
  seven errors as 09-01 logged above (`LayoutProps` in `src/app/layout.tsx`,
  and `Cannot find module 'stripe'` across `src/server/payments/providers/
  stripe/*` and two Stripe integration test files) — the `stripe` package is
  still absent from `node_modules` in this worktree. None reference
  `completion-service.ts`, `attendance-service.ts`, or
  `domain-event-service.ts` (this plan's three files). Confirmed via
  `git status --short` before/after execution that this plan touched only
  those three files plus their test files. Not fixed — same out-of-scope
  reasoning as 09-01 (Rule 3 excludes package installs from auto-fix).
- **`tests/attendance-service.integration.test.ts` and `tests/completion-
  service.test.ts` acceptance-criteria greps flag prose, not code.** The
  plan's acceptance criteria ask for `grep -c "assertTransition"` and
  `grep -c "setTimeout\|setInterval\|cron\|..."` to return 0 in
  `completion-service.ts`; the actual counts are 1 each, both from the
  header doc comment's own prose describing what the module deliberately
  does NOT do ("This module does not import `assertTransition`...", "...
  it never sets a timer or a cron entry"). No executable code matches
  either pattern — confirmed by reading the two flagged lines directly.
  Not treated as a violation; noted here for verifier visibility rather
  than stripped from the documentation, since the prose is exactly the
  DD-6/DD-12 record the plan's own `<action>` text asked for.

## 09-07 (execution date: 2026-09-14)

- **`npx tsc --noEmit` pre-existing failures unrelated to this plan.** Same
  `LayoutProps` (`src/app/layout.tsx`) and `Cannot find module 'stripe'`
  errors already logged under 09-01/09-04 — the `stripe` package is still
  absent from `node_modules` in this worktree. Not fixed (Rule 3 excludes
  package installs from auto-fix).
- **Fixed as Rule 1 (bug introduced by this plan's own change):**
  `src/app/staff/cohorts/[id]/RosterTab.tsx`'s `DEFERRED_LABEL` map was typed
  `Record<9 | 10 | 11, string>`; widening `DeferredColumn.phase` to
  `9 | 10 | 11 | 12` (this plan's Task 1, additive per DD-18) made that map
  non-exhaustive, surfacing a real `tsc` error at `RosterTab.tsx(96,8)`.
  Added a `12: "not tracked yet · Phase 12"` entry — additive only, no other
  change to that file's roster rendering.

## 09-13 (execution date: 2026-09-15)

- **`npx tsc --noEmit` pre-existing failures unrelated to this plan.** Same
  `LayoutProps` (`src/app/layout.tsx`) and `Cannot find module 'stripe'`
  errors already logged under 09-01/09-04/09-07 — the `stripe` package is
  still absent from `node_modules` in this worktree. Not fixed (Rule 3
  excludes package installs from auto-fix). Confirmed none reference this
  plan's files (`roster-service.ts`, `RosterTab.tsx`, `progress-actions.ts`,
  the new `learners/[enrolmentId]/` page/panel, `learner-access.ts`).
- **`npx next build` cannot run in this sandbox at all** — Turbopack fails
  immediately with "Could not find the Next.js package (next/package.json)"
  because this worktree's `node_modules` contains no physical `next` package
  directory (confirmed: `node_modules` here holds only a `.vite` cache dir;
  `npx next --version` resolves via some external mechanism sufficient for
  the CLI banner but not for a real build, which needs the package on disk
  for Turbopack's workspace-root detection). This is an environment/install
  gap identical in kind to 09-01's missing `stripe` package, not a defect in
  this plan's code — `npx tsc --noEmit` and `npx eslint` both pass cleanly
  against every file this plan touched. Not fixed (Rule 3 excludes package
  installs from auto-fix; this is a whole-package absence, not a single
  missing dependency, so there is nothing to install without full sandbox
  network/registry access this session does not have).
- **`npx vitest run tests/cohort-actions.test.ts tests/cohort-service.test.ts
  tests/components` surfaces 4 pre-existing failing files unrelated to this
  plan** (`checkout-summary.test.tsx`, `cohort-cards.test.tsx`,
  `cohort-pages.test.tsx`, `order-confirmation.test.tsx`) — all failures are
  `Intl.NumberFormat` currency-symbol rendering mismatches (e.g. expected
  `"$500.00"`, received `"US$500.00""`), an ICU/locale difference in this
  sandbox's Node build, not a code defect. None concern rosters, progress,
  or any Phase 9 surface; confirmed by reading each failing assertion
  directly. Not fixed — out of scope for this plan (Phase 6/7 checkout and
  cohort-detail price-fact rendering, untouched by 09-13).
- A full `npx vitest run` (all ~2000 tests) was also run as an extra sanity
  check beyond the plan's own `<verification>` block: 18 pre-existing failing
  files (the `stripe` package absence above, plus real-Postgres integration
  tests that need `DATABASE_URL` — e.g. `enrolment-service.integration.test.ts`
  throwing `PrismaClientInitializationError` — consistent with STATE.md's
  already-documented Docker/DB-unavailable sandbox limitation). Zero of the
  1987 passing tests or 27 pre-existing failures touch any file this plan
  modified or created.

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
