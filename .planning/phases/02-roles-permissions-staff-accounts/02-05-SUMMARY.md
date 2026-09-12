---
phase: 02-roles-permissions-staff-accounts
plan: 05
subsystem: auth
tags: [rbac, audit, react, nextjs, server-components]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: audit-service.ts scope fields + redaction (02-02), the audit-append-only invariant test (02-02)
provides:
  - "auditReadService.list/filterOptions: permission-gated, filterable read path over the full AuditEvent table"
  - "/staff/audit: the first server-side query-param-filtered page in this codebase, with an expand-in-place AuditTable"
affects: [02-06-staff-accounts]

actuals:
  tokens: 30000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Server-side query-param filtering (useRouter/usePathname/useSearchParams pushing to the URL, re-fetched by the Server Component) — the first page in this codebase to filter this way rather than over an already-fetched client-side array"
    - "AuditTable as ResourceTable's sibling, not its consumer — expand-in-place accordion state (single nullable id) plus a client-computed changed-fields-only diff"

key-files:
  created:
    - src/server/services/audit-read-service.ts
    - src/app/staff/audit/page.tsx
    - src/app/staff/audit/AuditTable.tsx
    - tests/audit-read-service.test.ts
  modified:
    - src/app/staff/layout.tsx

key-decisions:
  - "AuditReadStore's findMany/findFirst are typed loosely (Record<string, unknown> args, a RawAuditEventRow return) rather than precisely per Prisma call shape (select vs include vary per use), with a targeted cast at the filterOptions call sites — pragmatic given Prisma's polymorphic query shapes, consistent with existing prisma-as-unknown-as-Store casts elsewhere in the codebase."
  - "The audit view shows the full table across every resource type (D-30) from day one — filterOptions surfaces every distinct action and actor that has ever appeared, including Phase 1's Course events, with no Phase-2-only scoping."

patterns-established:
  - "Query-param-driven server filtering as the pattern for any future page needing filters over a dataset too large to fetch and filter client-side"

requirements-completed: [RBAC-08]

coverage:
  - id: D1
    description: "The audit read path is gated on audit.view with an empty (GLOBAL-only) scope resolver and exposes no mutation"
    requirement: "RBAC-08"
    verification:
      - kind: unit
        ref: "tests/audit-read-service.test.ts#refuses list when the only audit.view grant is Cohort-scoped"
        status: pass
      - kind: unit
        ref: "tests/audit-append-only.test.ts#has exactly one file in src that creates audit rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildAuditWhere correctly constructs actor/date-range/action filter clauses, omitting absent filters entirely"
    requirement: "RBAC-08"
    verification:
      - kind: unit
        ref: "tests/audit-read-service.test.ts#returns an object with no keys for an empty filter"
        status: pass
      - kind: unit
        ref: "tests/audit-read-service.test.ts#sets both bounds when both from and to are supplied"
        status: pass
    human_judgment: false
  - id: D3
    description: "Returned rows carry scopeType/scopeId, proving the view surfaces the scope Plan 02 started recording"
    requirement: "RBAC-08"
    verification:
      - kind: unit
        ref: "tests/audit-read-service.test.ts#returns rows carrying scopeType and scopeId"
        status: pass
    human_judgment: false
  - id: D4
    description: "/staff/audit renders correctly, filters actually re-query the server, expand-in-place shows a correct field-level diff, and no mutating control exists anywhere in the view"
    verification: []
    human_judgment: true
    rationale: "No browser was available this session to visually confirm the query-param filter round-trip, the accordion expand behavior, and the diff rendering — service-layer logic is unit-proven, but the UI needs human/UAT confirmation, same caveat as Plans 01 and 03."

duration: ~30min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 05 Summary

**The audit trail made visible: a permission-gated, filterable read service and a `/staff/audit` page with expand-in-place, field-level diffs — the first server-side query-param-filtered page in this codebase.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2 (read service + page/table)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `audit-read-service.ts` — `list` and `filterOptions`, both gated on `audit.view` at GLOBAL scope, with a pure `buildAuditWhere` covering actor/date-range/action filters.
- `/staff/audit` — a Server Component reading filters from `searchParams`, defensively parsing dates into a validation message rather than silently dropping bad input.
- `AuditTable.tsx` — a `ResourceTable` sibling with accordion expand-in-place (one row open at a time), a client-computed changed-fields-only diff, and query-param-driven filters via `useRouter`/`useSearchParams`.
- Nav's Audit placeholder is now a real link.

## Task Commits

None — executed directly, no `git commit`, per explicit user instruction for this session.

## Files Created/Modified
- `src/server/services/audit-read-service.ts` — `list`, `filterOptions`, `buildAuditWhere`, `AUDIT_PAGE_LIMIT`
- `src/app/staff/audit/page.tsx` — audit route, date-filter parsing
- `src/app/staff/audit/AuditTable.tsx` — expand-in-place table, filter bar
- `tests/audit-read-service.test.ts` — 12 tests, no database
- `src/app/staff/layout.tsx` — Audit NAV entry now links to `/staff/audit`

## Decisions Made
See `key-decisions` above — both followed directly from D-30/D-31/D-32 and the pragmatic-typing call on `AuditReadStore`.

## Deviations from Plan

### Auto-fixed Issues

**1. [ESLint react-hooks/error-boundaries] JSX constructed inside a try block**
- **Found during:** Task 2 verification (`npx eslint src tests prisma`)
- **Issue:** The initial `page.tsx` returned `<AuditTable ... />` directly inside the `try` block's success path. ESLint's `react-hooks/error-boundaries` rule flags this because React doesn't render JSX synchronously, so a rendering error wouldn't actually be caught by that `try/catch`.
- **Fix:** Restructured to assign `rows`/`filterOptions` inside `try` (data-fetching only) and moved the `<AuditTable ... />` return to after the `try/catch` block, matching the existing `courses/page.tsx` precedent exactly.
- **Files modified:** `src/app/staff/audit/page.tsx`.
- **Verification:** `npx eslint src tests prisma` now exits 0; `npm test` (158/158) unaffected.

---

**Total deviations:** 1 auto-fixed (a lint-caught structural issue, not a logic bug).
**Impact on plan:** No scope creep — a mechanical fix to match an existing, already-established pattern in this codebase.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None.

## Next Phase Readiness
- `auditReadService` is available for any later phase that wants to link into a filtered audit view (e.g. deep-linking from a record's own History tab, though D-31 keeps that out of this phase's own scope).
- Not yet verified in a browser — flagged as `human_judgment: true` (D4) for UAT.
- No blockers.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
