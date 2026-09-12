---
phase: 02-roles-permissions-staff-accounts
plan: 03
subsystem: auth
tags: [rbac, prisma, react, server-actions, versioning]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: role-service.ts create/list/get (02-01), RoleForm/PermissionPicker/EffectiveAccessPreview (02-01), continuity-service.ts (02-02), audit-service.ts scope fields (02-02)
provides:
  - "roleService.update: optimistic-locked, reason-gated (reductions only), continuity-guarded role edit that always appends a RoleVersion"
  - "roleService.setActive: reason-gated deactivate/reactivate with the same continuity guard, no per-assignment backfill on reactivation"
  - "roleService.versions / roleService.assignmentCount: read-only support for the History tab and the D-05/D-07 confirmation copy"
  - "/staff/roles/[id] detail page: Overview, inline Permissions editor, History tabs"
  - "RoleForm extended with a mode='edit' path, fully controlled by RoleDetailPanels"
affects: [02-04-assignments, 02-06-staff-accounts]

actuals:
  tokens: 48000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Optimistic concurrency via a plain version-mismatch check inside the service, resolved by user checkpoint over a raw-SQL row lock"
    - "RoleForm split into a self-contained create mode (unchanged) and a fully host-controlled edit mode (errors/pending/onSubmit/selection all lifted to RoleDetailPanels) so the same picker/preview markup serves both without duplication"
    - "ConfirmModal's error prop reused as the RBAC-07 block's landing surface — no new banner component, matching D-12/ContinuityBlock exactly"

key-files:
  created:
    - src/app/staff/roles/[id]/page.tsx
    - src/app/staff/roles/RoleDetailPanels.tsx
  modified:
    - src/server/services/role-service.ts
    - src/app/staff/roles/actions.ts
    - src/app/staff/roles/RoleForm.tsx
    - tests/role-service.test.ts

key-decisions:
  - "Checkpoint resolved in Plan 02-02 (transaction-scoped continuity count) carries through unchanged here — both D-24b/D-24c call sites pass tx.assignment.count from inside the same $transaction as the write."
  - "An identical resubmission still bumps the version — no diffing to suppress a no-op edit, since RoleVersion is an append-only trail, not user-facing noise (edge RBAC-02/idempotency)."
  - "Optimistic lock compares Role.version BEFORE the reason gate or the transaction opens, so a stale edit never even reaches the point of asking for (or accepting) a reason."

patterns-established:
  - "Host-controlled form components (RoleForm's mode='edit' path) as the reuse strategy for the same fields/picker markup across create and edit screens, rather than two near-duplicate components"

requirements-completed: [RBAC-02, RBAC-03, RBAC-07, RBAC-08]

coverage:
  - id: D1
    description: "Editing a role always appends a new RoleVersion row (including a no-op resubmission) and never rewrites a prior one"
    requirement: "RBAC-02"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#writes a RoleVersion at stored version plus one on an addition-only edit"
        status: pass
      - kind: unit
        ref: "tests/role-service.test.ts#still writes a new version row on an identical resubmission (edge RBAC-02/idempotency)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A stale expectedVersion is rejected with RoleVersionConflictError and performs no write"
    requirement: "RBAC-02"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#throws RoleVersionConflictError on a stale expectedVersion and performs no write at all"
        status: pass
    human_judgment: false
  - id: D3
    description: "Removing a permission demands a >=10-character reason; adding one demands none; several removals in one save need only one shared reason"
    requirement: "RBAC-02"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#throws ReasonRequiredError when removing a permission with no reason"
        status: pass
      - kind: unit
        ref: "tests/role-service.test.ts#removes several permissions with one sufficient reason, and the audit before/after carry the full permission arrays"
        status: pass
    human_judgment: false
  - id: D4
    description: "Removing roles.manage or deactivating a roles.manage-bearing role is blocked by the continuity guard when zero other holders would remain"
    requirement: "RBAC-07"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#invokes the continuity check with a role exclusion when removing roles.manage, and throws ContinuityError with zero remaining"
        status: pass
      - kind: unit
        ref: "tests/role-service.test.ts#throws ContinuityError when deactivating a roles.manage-bearing role with zero remaining"
        status: pass
    human_judgment: false
  - id: D5
    description: "A seeded default role passes through identical gates to a custom role — no exemption"
    requirement: "RBAC-02"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#subjects a seeded default role (isDefault true) to exactly the same reason gate as a custom role"
        status: pass
    human_judgment: false
  - id: D6
    description: "The role detail page renders Overview/Permissions/History correctly, the History tab badge shows a bare version count, the Permissions tab embeds a working inline editor, and the ContinuityBlock/reason-gate ConfirmModals behave as specified in the browser"
    verification: []
    human_judgment: true
    rationale: "No browser was available this session to visually confirm rendering, tab interaction, and the two ConfirmModal flows (removal reason gate, deactivate/reactivate) end to end — service-layer logic is unit-proven, but the actual UI needs human/UAT confirmation."

duration: ~55min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 03 Summary

**Full role lifecycle — versioned edits with an optimistic lock, reason-gated reductions, continuity-guarded deactivation, and a role detail page with inline Permissions editing and version History.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 (service layer + detail page)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `roleService.update`/`setActive`/`versions`/`assignmentCount` added — every edit path validated, optimistically locked, reason-gated, and continuity-guarded before it writes anything.
- `/staff/roles/[id]` renders Overview/Permissions/History via `DetailLayout`, matching the Courses detail-page precedent (`notFound()` on both missing and denied).
- `RoleDetailPanels.tsx` — `RolePermissionsPanel` (inline edit form + removal-reason `ConfirmModal`) and `RoleActivationControl` (deactivate/reactivate `ConfirmModal`), both reusing `ConfirmModal`'s existing `error` slot for the RBAC-07 block.
- 14 new tests added to `tests/role-service.test.ts` (versioning describe block), all passing alongside the existing 10.

## Task Commits

None — executed directly, no `git commit`, per explicit user instruction for this session.

## Files Created/Modified
- `src/server/services/role-service.ts` — `update`, `setActive`, `versions`, `assignmentCount`, `MIN_REASON_LENGTH`, `RoleVersionConflictError`, `ReasonRequiredError`
- `src/app/staff/roles/actions.ts` — `updateRoleAction`, `setRoleActiveAction`
- `src/app/staff/roles/RoleForm.tsx` — added a host-controlled `mode="edit"` path (see Deviations)
- `src/app/staff/roles/[id]/page.tsx` — role detail route
- `src/app/staff/roles/RoleDetailPanels.tsx` — `RolePermissionsPanel`, `RoleActivationControl`
- `tests/role-service.test.ts` — 14 new tests in a `role versioning` describe block

## Decisions Made
- See `key-decisions` above. All followed directly from 02-CONTEXT.md's D-05 through D-39 and 02-RESEARCH.md's Pattern 3/4 and Pitfalls 1/2/4 — no new judgment calls beyond what the plan specified.

## Deviations from Plan

### Auto-fixed Issues

**1. RoleForm.tsx required a change not listed in this plan's `files_modified`**
- **Found during:** Task 2 (role detail page)
- **Issue:** The plan's action text says RoleDetailPanels "mounts the existing RoleForm seeded with the role's current name, description and permissions" and "intercepts submit" to gate a removal through a `ConfirmModal` — but Plan 01's `RoleForm` only accepted a `cloneSources`/`initialPermissions` prop and unconditionally drove its own `useActionState(createRoleAction, ...)` internally. There was no way to seed a role's `name`/`description`, route submission to `updateRoleAction` instead, or let a parent intercept submit before it reached the server — the component as it existed could not do what Task 2 required.
- **Fix:** Added an optional `mode`/`role`/`errors`/`pending`/`onSubmit`/`selected`/`onSelectionChange` prop set to `RoleForm`. Default (`mode="create"`, no new props passed) preserves Plan 01's exact original behavior unchanged — the create page (`new/page.tsx`) needed no changes at all. `mode="edit"` makes `RoleForm` fully host-controlled: `RoleDetailPanels` now owns errors, pending state, the selection `Set`, and the submit handler, letting it intercept a permission reduction and route it through its `ConfirmModal` before (or instead of) calling `updateRoleAction`.
- **Files modified:** `src/app/staff/roles/RoleForm.tsx` (not listed in this plan's frontmatter `files_modified`).
- **Verification:** `npx tsc --noEmit` and `npx eslint src tests prisma` both exit 0; `npm test` (146/146) confirms the create flow's existing behavior and tests are unaffected.
- **Impact:** Necessary to implement Task 2 as specified; no scope creep — the create-mode code path is byte-for-byte the same logic as before, just reached through a conditional rather than being the only path.

---

**Total deviations:** 1 auto-fixed (a plan-completeness gap, not a plan-checker miss — the file was genuinely required and just absent from the frontmatter list).
**Impact on plan:** Necessary for correctness; no scope creep beyond what Task 2 explicitly asked for.

## Issues Encountered
- A `.filter((p) => !permissions.includes(p))` call in `roleService.update` initially failed `tsc` because `permissions` (typed `Permission[]`) rejected a plain `string` argument from `current.permissions` (typed `string[]`). Fixed by comparing against a `Set<string>` instead of relying on array-type covariance for `.includes()`.

## User Setup Required
None.

## Next Phase Readiness
- `role-service.ts` now exposes the full lifecycle (`list`, `get`, `create`, `update`, `setActive`, `versions`, `assignmentCount`) that Plan 02-04 (assignments) and Plan 02-06 (staff accounts) can build against — both already plan to import `MIN_REASON_LENGTH` from this file per 02-RESEARCH.md.
- Not yet verified in a browser — flagged as `human_judgment: true` (D6) for UAT, same caveat as Plan 01.
- No blockers.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
