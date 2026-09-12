---
phase: 02-roles-permissions-staff-accounts
plan: 07
subsystem: ui
tags: [rbac, react, nextjs, server-actions, iam]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: staffAccountService.list/create (02-06), scopeLookupService (02-04), roleService.list (02-01)
provides:
  - "/staff/users list page and UsersTable, reachable from the nav alongside Roles and Audit"
  - "/staff/users/new: the combined create-account-and-assign-role form, one submission, one transaction, one-time temporary password display"
affects: [02-08-user-detail-assignments-panel]

actuals:
  tokens: 40000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "One-time-secret display pattern: a Server Action returns a plaintext value in its state object (never a redirect, never a URL param) and the client component renders a copy-to-clipboard success panel in place of the form — reusable for any future one-time-credential flow"
    - "Client-side scope-target lookup via a dedicated Server Action (searchScopeTargetsAction) called from a useEffect keyed on scopeType+query, rather than fetching all targets upfront"

key-files:
  created:
    - src/app/staff/users/page.tsx
    - src/app/staff/users/UsersTable.tsx
    - src/app/staff/users/new/page.tsx
    - src/app/staff/users/StaffAccountForm.tsx
    - src/app/staff/users/actions.ts
  modified:
    - src/app/staff/layout.tsx

key-decisions:
  - "The scope-target select becomes a disabled, empty, still-required <select> (rather than hidden) when a lookup returns zero targets — a hidden required form control blocks native browser form submission entirely in most browsers; disabled achieves the same 'cannot submit a non-global scope with no real target' outcome without that failure mode."
  - "Submit-button 'stays disabled until valid' from the plan's action text is implemented via native HTML `required` attributes on the role and scope-target selects, not a JS-tracked canSubmit boolean wired into ResourceForm — the primitive has no prop for externally disabling its internal submit button, and native required/disabled achieves the same behavioral guarantee with less code, consistent with RoleForm's precedent of not implementing that pattern either."

patterns-established:
  - "One-time-secret display panel (create-success state replacing the form entirely, rendered from the action's own returned state, never persisted client-side) as the template for any future credential-on-screen-once requirement"

requirements-completed: [IAM-04]

coverage:
  - id: D1
    description: "Users appears as a live nav link alongside Roles and Audit, listing every staff account with locked status tones and no truncation"
    verification: []
    human_judgment: true
    rationale: "No browser was available this session to visually confirm the list rendering, tone mapping, and nav link — same caveat as every UI-facing plan this session."
  - id: D2
    description: "createStaffAccountAction calls staffAccountService.create exactly once per invocation, with role and scope in the same call, and returns the temporary password without ever redirecting"
    verification:
      - kind: unit
        ref: "manual code inspection — actions.ts calls staffAccountService.create() a single time inside its try block, returns created state, contains no redirect() call"
        status: pass
    human_judgment: false
  - id: D3
    description: "StaffAccountForm never touches localStorage, sessionStorage, document.cookie, or a console call, and the success panel's temporary password comes only from the action's returned state"
    verification:
      - kind: unit
        ref: "manual code inspection — grep for localStorage/sessionStorage/cookie/console across StaffAccountForm.tsx returns no matches"
        status: pass
    human_judgment: false
  - id: D4
    description: "The combined form's create-and-assign flow, temporary-password display, copy button, and the two locked Programme/Cohort empty-state strings render and behave correctly end to end in a browser"
    verification: []
    human_judgment: true
    rationale: "Same browser-unavailable caveat as D1 — service-layer logic (Plan 06) is unit-proven, but the actual form interaction, scope-target search-as-you-type, and success-panel rendering need human/UAT confirmation."

duration: ~35min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 07 Summary

**A working Users screen: the staff-accounts list and a combined create-account-plus-first-role form that shows its one-time temporary password on screen and nowhere else.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (list page + combined create form)
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments
- `/staff/users` — `UsersTable` with the locked status-tone mapping (ACTIVE→success, DEACTIVATED→warning, PENDING_VERIFICATION→neutral), search/status filters, no truncation on name/email.
- `/staff/users/new` — `StaffAccountForm` composing name/email/temporary-password/role/scope-type/scope-target/end-date fields, submitting everything in one `createStaffAccountAction` call.
- The success state replaces the form with a panel showing the new account's name/email and a copy-to-clipboard temporary password, with an explicit "shown only once" note — rendered purely from the action's returned state, never persisted client-side.
- `searchScopeTargetsAction` wires the drawer-style scope-target lookup to `scopeLookupService`, showing the exact D-18 locked empty-state copy for Programme/Cohort scope.
- Users NAV entry now links to `/staff/users`.

## Task Commits

None — executed directly, no `git commit`, per explicit user instruction for this session.

## Files Created/Modified
- `src/app/staff/users/page.tsx` — list route
- `src/app/staff/users/UsersTable.tsx` — list table, tone map
- `src/app/staff/users/new/page.tsx` — create route, role list fetch
- `src/app/staff/users/StaffAccountForm.tsx` — combined form, scope lookup, success panel
- `src/app/staff/users/actions.ts` — `createStaffAccountAction`, `searchScopeTargetsAction`
- `src/app/staff/layout.tsx` — Users NAV entry now links to `/staff/users`

## Decisions Made
See `key-decisions` above — the disabled-vs-hidden select choice and the native-required-attribute submit-gating choice were both judgment calls made during implementation, not pre-specified in the plan text at that level of detail, but consistent with its stated intent ("the button stays disabled until... all present").

## Deviations from Plan

### Auto-fixed Issues

**1. [ESLint react-hooks/set-state-in-effect] Synchronous setState calls inside a useEffect's early-return branch**
- **Found during:** Task 2 verification (`npx eslint src tests prisma`)
- **Issue:** The scope-target lookup `useEffect` called `setScopeTargets([])` and `setScopeId("")` synchronously in its `scopeType === "GLOBAL"` early-return branch. ESLint's `react-hooks/set-state-in-effect` rule flags this as a cascading-render risk — effects should synchronize with external systems, not perform state resets that belong in the event handler that caused the state change.
- **Fix:** Moved the reset logic into the `scopeType` `<select>`'s own `onChange` handler (a real user action), and simplified the effect to just `if (scopeType === "GLOBAL") return;` before performing its one job — calling the lookup action when scopeType/scopeQuery actually change.
- **Files modified:** `src/app/staff/users/StaffAccountForm.tsx`.
- **Verification:** `npx eslint src tests prisma` exits 0; `npm test` (219/219) unaffected.

**2. Duplicate `name` attributes and a non-functional disabled submit button, found and fixed during authoring (not by a tool)**
- **Found during:** Task 2 authoring, before running any verify command
- **Issue:** The first draft added hidden `<input type="hidden" name="roleId">`/`name="scopeType"`/`name="scopeId"` inputs alongside `<select>` elements that already carried those same `name`s via `FormField`'s render-prop wiring — `FormData.getAll` would have collected duplicate values. It also included a `<button type="submit" disabled={!canSubmit} hidden>` that did nothing, since ResourceForm's own internal submit button is what a user actually clicks.
- **Fix:** Removed the duplicate hidden inputs entirely (the visible selects already carry the correct `name`s) and removed the dead hidden button; replaced the intended "stays disabled until valid" behavior with native `required` attributes on the role and scope-target selects instead.
- **Files modified:** `src/app/staff/users/StaffAccountForm.tsx`.
- **Verification:** `npx tsc --noEmit` exits 0.

---

**Total deviations:** 2 auto-fixed (one lint-caught, one self-caught during authoring) — both structural corrections, no scope creep.
**Impact on plan:** None on the plan's intent; both fixes make the form actually work as specified rather than changing what it does.

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None.

## Next Phase Readiness
- Plan 02-08 (User detail page, Assignments panel) can build directly on `staffAccountService.get`/`deactivate`/`reactivate` (Plan 06) and `assignmentService`/`scopeLookupService` (Plan 04) — no further service-layer work needed.
- Not yet verified in a browser — flagged as `human_judgment: true` (D1, D4) for UAT, same caveat as every UI plan this session.
- No blockers.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
