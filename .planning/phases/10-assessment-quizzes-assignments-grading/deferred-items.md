# Deferred Items — Phase 10

Out-of-scope discoveries found during plan execution, logged rather than fixed
per the executor's scope boundary (only issues directly caused by the current
task's changes are auto-fixed).

## 10-02: pre-existing `npx tsc --noEmit` failure in `src/app/layout.tsx`

- **Found during:** Plan 10-02, Task 1 verification (`npx tsc --noEmit`)
- **Error:** `src/app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.`
- **Scope:** `src/app/layout.tsx` was not touched by 10-02 (`git diff HEAD -- src/app/layout.tsx`
  shows no uncommitted changes, and the file's last commit predates this plan). `LayoutProps`
  appears to be a Next.js 16 App Router generated global type (produced by `next dev`/`next build`
  type generation into `.next/types/`) that is not present/stale in this sandbox — unrelated to
  `quiz-scoring.ts`'s pure-module scoring logic.
- **Action:** Not fixed — out of scope for this plan. `src/server/services/quiz-scoring.ts` and
  `tests/quiz-scoring.test.ts` were confirmed independently error-free (isolated `vitest run`
  passes 31/31; `eslint` on `quiz-scoring.ts` reports zero errors). This project-wide `tsc --noEmit`
  gate should be re-run once `.next/types` is regenerated (e.g. by `next dev` or `next build`) in an
  environment where that step is available.

## 10-05: `tests/checkout-webhook.integration.test.ts` — 3 failures under concurrent-agent DB contention

- **Found during:** Plan 10-05, Task 3's "full node project" verification pass
  (`npx vitest run --project node --exclude "**/*.integration.test.ts"` — even with integration
  tests excluded by pattern, Vitest 4's project-level `include` still picked this one up because the
  file glob matched before the CLI `--exclude` was applied to the "node" project's own `include`).
- **Error:** `a redelivered event.id is a no-op`, `a hold already expired...routes to EXCEPTION`, and
  `a mail-provider outage still leaves the response at 200` all failed with
  `Unique constraint failed on the fields: (provider,providerEventId)` and
  `terminating connection due to administrator command` — a Postgres connection killed mid-test.
- **Scope:** `submission-service.ts`/`submission-service.test.ts` (this plan's only files) never
  import or touch `checkout-webhook-system-service.ts`, `WebhookEvent`, or any Stripe/Paystack path.
  This worktree runs against the same ephemeral test-container Postgres several other parallel
  worktree-agent processes are simultaneously migrating/writing to (confirmed via `tasklist` showing
  ~15+ concurrent `node.exe` processes during this run) — the unique-constraint collision and the
  admin-killed connection are consistent with cross-agent contention on a shared test database, not
  a defect introduced by this plan.
- **Action:** Not fixed — out of scope and not reproducible in isolation. This plan's own scoped
  verification (`npx vitest run tests/submission-service.test.ts tests/boundary.test.ts`) passes
  22/22 and 14/14 respectively with zero failures, `npx tsc --noEmit` exits 0, and
  `npx eslint src/server/services/submission-service.ts` reports zero errors — the plan's own
  `<verification>` block is fully green. Re-run the full suite once uncontended (no concurrent
  worktree-agent DB writers) to confirm this integration file is unaffected.
