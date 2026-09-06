# Deferred items — phase 04.1

Out-of-scope discoveries logged during execution. Not fixed by the owning plan.

## From plan 04.1-18

- **Pre-existing type error:** `src/app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'`.
  Surfaced by `npx.cmd tsc --noEmit`. This is a Next.js generated route/layout type
  (`node_modules/next/dist/…`) that is not resolving in this checkout. Unrelated to the
  PublishDialog / CourseDetailActions / ProgrammeDetailClient changes in plan 18. Not
  fixed — outside the plan's file scope. Owner: whichever plan touches app-router type
  generation / `next build` wiring (candidate: plan 29 combined build gate).
