# Deferred / Out-of-Scope Items

## From plan 04.1-22 execution

- **`src/app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'`**
  - Discovered running `npx tsc --noEmit` during plan 22 verification.
  - `layout.tsx` was not modified by plan 22. `LayoutProps` is a Next.js
    generated global type that only exists once `.next/types` is populated by
    `next dev` / `next build`; a fresh git worktree has no `.next/types`.
  - Not caused by this plan's changes. Left for whoever owns the type-check
    gate / build environment setup (likely the capstone plan 29 or CI config).
