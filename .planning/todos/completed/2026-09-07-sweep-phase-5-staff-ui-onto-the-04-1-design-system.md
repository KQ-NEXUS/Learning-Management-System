---
created: 2026-09-07T12:48:32.747Z
title: Sweep Phase 5 staff UI onto the 04.1 design system
area: ui
files:
  - src/app/staff/cohorts/page.tsx
  - src/app/staff/cohorts/CohortsTable.tsx
  - src/app/staff/cohorts/CohortForm.tsx
  - src/app/staff/cohorts/new/page.tsx
  - src/app/staff/cohorts/[id]/page.tsx
  - src/app/staff/cohorts/[id]/edit/page.tsx
  - src/app/staff/cohorts/[id]/SessionsTab.tsx
  - src/app/staff/cohorts/[id]/RosterTab.tsx
  - src/app/staff/cohorts/[id]/ExceptionsTab.tsx
  - src/app/staff/cohorts/[id]/InstructorsPanel.tsx
  - src/app/staff/cohorts/[id]/SessionFormFields.tsx
  - src/app/staff/cohorts/[id]/EnrolmentActionModals.tsx
  - src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/page.tsx
  - src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx
  - src/app/staff/enrolments/EnrolmentsTable.tsx
  - src/components/catalogue/CohortDetailActions.tsx
  - tests/unit/design-contract.test.ts
---

## Resolution (2026-09-07)

Done. Swept all 17 files: raw `zinc-*` neutrals → semantic tokens
(`text-foreground` / `text-muted-foreground` / `bg-surface` / `bg-surface-2` /
`border-border` / `border-input-border`), arbitrary `text-[10px]` / `text-xs` /
`text-lg` → the 4-size scale (`text-[11px]` micro, `text-sm` body, `text-[25px]`
h1), `font-medium` (500, retired) → `font-semibold`, off-grid spacing
(`px-2.5` `py-1.5` `gap-1.5` `gap-0.5` `gap-3` `py-2.5` `gap-5` `py-10` `p-5`
`mb-3` `mt-0.5`) snapped to the 4/8/16/24/32/48 grid, controls/cards given
`rounded-md` / `rounded-xl` + `shadow-xs`, modal scrim `bg-zinc-900/40` →
`bg-foreground/40`, and button class-strings unified to the canonical
`BTN` / `BTN_PRIMARY` used across the swept catalogue/staff surfaces. No layout,
copy, route, authorization or action-contract changes.

Added `staff-cohorts-scheduling` group (17 files) to
`tests/unit/design-contract.test.ts` `GROUPS` + `EXPECTED_GROUPS`. Full suite
green (101 design-contract, 226 component tests, tsc + eslint clean).

**Item 3 (walkthrough) done** — drove the running dev server (Neon dev DB,
`admin@kqnexus.test`) through `/staff/cohorts`, cohort detail (all four tabs),
`/staff/cohorts/new`, `/staff/cohorts/[id]/edit`, and attendance marking at
360 / 768 / 1024 / 1440px via playwright-cli. All surfaces sit correctly on the
navy staff shell, tinted StatusPills, canonical `BTN`/`BTN_PRIMARY`, mono figures
with tz labels; no horizontal scroll at 360; mobile card fallback works.

One regression found + fixed: the "Cancel cohort" button in `CohortDetailActions`
rendered ink-black instead of danger-red — routing it through `${BTN} text-danger`
left the destructive colour to Tailwind source order against BTN's own
`text-foreground`/`border-input-border`, which lost. Fixed with a dedicated
`BTN_DANGER` constant.

### Follow-ups — all now done (2026-09-07)

- **`CourseDetailActions.tsx` sibling bug** — its "Archive" / "List publicly"
  buttons had the identical `${BTN} text-danger` / `text-accent` construct and
  also rendered ink in the app. Fixed with dedicated `BTN_DANGER` / `BTN_ACCENT`
  constants. Browser-confirmed "Archive" now paints `#b42318`. (commit `fix(04.1)`)
- **`CohortForm` timezone hydration mismatch** — `Intl.supportedValuesOf("timeZone")`
  returns a different list Node↔Chromium, so building the `<option>`s at module
  load bailed hydration to a client render every time. Now a fixed 5-zone set
  renders on the server + hydrating client, with the full IANA list swapped in
  client-side via `useSyncExternalStore` (`react-hooks/set-state-in-effect`
  forbids the `useEffect`+`setState` form). Browser-confirmed: 0 console errors,
  418 options, correct value selected.
- **`design-contract.test.ts` now grades colour conflicts** — it only checked
  size / weight / spacing, which is why both button bugs slipped past CI. Added:
  (a) UPPER_CASE const resolution so `${BTN}` is inlined into the class string,
  (b) `checkColorConflicts` — flags ≥2 unconditional `text-`/`bg-`/`border-`
  colour utilities of different roles in one class list (variant-prefixed
  overrides like `hover:text-danger` are fine). 4 new fixtures; all 65 graded
  files still pass.

## Problem

Phase 04.1 rolled the approved modern design system across every user-facing
surface — but its mockup and locked scope (D-01..D-26) were frozen against a
pre-Phase-5 route inventory (29 routes: 18 `/staff/*` + 6 auth + 4 public + 1
account). The `/staff/cohorts/**` and `/staff/enrolments` routes were built
during Phase 5, *after* that inventory, so no 04.1 plan (01–35) lists any of
them in `files_modified` and none are exercised by the redesign.

Current state of these ~16 files:

- **Inherited for free:** they render under `staff/layout.tsx` (the restyled navy
  shell) and consume the restyled primitives (`ResourceTable`, `StatusPill`,
  `ConfirmModal`, `DetailLayout` from `@/components/primitives`), so tables,
  pills, and dialogs already look right.
- **Not converted:** their bespoke body markup still uses ~75 raw legacy-neutral
  Tailwind classes — `text-zinc-500` (×15), `border-zinc-300` (×13),
  `border-zinc-200` (×9), `text-zinc-900/800/700/600/400`, `bg-zinc-50` (×5),
  `bg-zinc-100` — plus ~12 arbitrary `text-[Npx]` sizes, instead of the semantic
  tokens 04.1 established: `text-foreground`, `text-muted-foreground`,
  `bg-surface` / `bg-surface-2`, `border-border`, `border-input-border`, and the
  type scale (`text-sm` / `text-base` / etc.). Heaviest: `AttendanceMarkClient.tsx`
  (20), `CohortDetailActions.tsx` (9), `InstructorsPanel.tsx` (8),
  `attendance/page.tsx` (7), `SessionsTab.tsx` (7), `ExceptionsTab.tsx` (6).
- **No CI guard:** `tests/unit/design-contract.test.ts` (expanded to 65 graded
  files across 10 groups by plan 04.1-35) grades zero cohort / enrolment /
  attendance files, so nothing catches a future off-role edit on these surfaces.

Discovered 2026-09-07 while executing the 04.1 gap-closure wave (plans 32–35);
`04.1-UAT.md` acknowledges the gap only as an unchecked "spot-check (post-mockup,
Phase 5)" line rather than covered scope.

## Solution

Scope this as a small gap phase (candidate `04.2`, or fold into a Phase 5 UI
cleanup) that:

1. Token sweep of the ~16 files — replace every raw `zinc-*` neutral and
   arbitrary `text-[Npx]` with the semantic token / type-scale equivalent 04.1
   used elsewhere. No layout, copy, capability, route, authorization, or action
   contract changes — purely the styling vocabulary. Honor the same D-01..D-26
   decisions and the two locked exceptions (D-21 auth `gap-5`, D-23 learner
   header `14px/28px`) — neither applies here.
2. Add a `staff-cohorts` (or `staff-scheduling`) describe group + file manifest
   to `design-contract.test.ts`, wiring the Phase 5 staff files into the same
   `GROUPS` → `gradeFile` → per-file `it()` machinery, and extend
   `EXPECTED_GROUPS` so the anti-vacuity / anti-stale fixtures cover them.
3. Human spot-check of `/staff/cohorts`, `/staff/cohorts/[id]` (all four tabs),
   `/staff/cohorts/new`, `/staff/cohorts/[id]/edit`, and the attendance-marking
   screen at 360 / 768 / 1024 / 1440px — the same rows the 04.1 walkthrough uses.

Estimate: ~1 focused plan for the sweep + test manifest, plus the walkthrough.
No schema or server changes.
