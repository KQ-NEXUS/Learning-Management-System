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
