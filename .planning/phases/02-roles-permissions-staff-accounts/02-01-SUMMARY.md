---
phase: 02-roles-permissions-staff-accounts
plan: 01
subsystem: auth
tags: [rbac, prisma, react, server-actions, permissions]

requires:
  - phase: 01-foundation
    provides: withPermission choke point, resource-service factory pattern, ResourceTable/ResourceForm/DetailLayout/ConfirmModal primitives, permission catalogue
provides:
  - "role-service.ts: list/get/create for Role, gated on roles.view/roles.manage, GLOBAL-only scope"
  - "Server-side permission-set validation (validateRolePermissionSet) rejecting unknown/duplicate identifiers, accepting an empty set"
  - "/staff/roles list and /staff/roles/new create flow, wired through the tracer pattern"
  - "permission-groups.ts: 14-domain grouping + plain-language effective-access summariser (D-04), proven exhaustive against the catalogue"
  - "Roles/Users/Audit added to the staff workspace nav (Roles linked, Users/Audit as placeholders for later plans)"
affects: [02-02-continuity-and-audit, 02-03-role-editing, 02-04-assignments, 02-06-staff-accounts, 02-07-users-list]

actuals:
  tokens: 32000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Hand-written service (not createResourceService) for models whose update/archive shape differs from the generic factory's hard-coded ARCHIVED status — Role uses active:boolean instead"
    - "Injectable narrow store port (RoleStore) so the service is unit-testable without a database, mirroring the resource-service.test.ts harness idiom"
    - "Presentation-layer grouping module (src/lib/) kept dependency-free from components/services, proven exhaustive against the catalogue by its own test"

key-files:
  created:
    - src/server/services/role-service.ts
    - src/lib/permission-groups.ts
    - src/app/staff/roles/page.tsx
    - src/app/staff/roles/RolesTable.tsx
    - src/app/staff/roles/new/page.tsx
    - src/app/staff/roles/RoleForm.tsx
    - src/app/staff/roles/PermissionPicker.tsx
    - src/app/staff/roles/EffectiveAccessPreview.tsx
    - src/app/staff/roles/actions.ts
    - tests/role-service.test.ts
    - tests/permission-groups.test.ts
  modified:
    - src/app/staff/layout.tsx

key-decisions:
  - "Role is NOT routed through createResourceService — its generic archive() writes status:\"ARCHIVED\", which Role does not have (RESEARCH Pitfall 2)."
  - "roleScope() always returns an empty ResourceScope — Role/User have no cohort/programme/course parent, so this alone forces GLOBAL-only roles.manage grants without extra scope-checking code (Pattern 1)."
  - "PermissionPicker's scopeType prop exists for future reuse by the Assignment Drawer (Plan 02-04) — within this plan it always defaults to GLOBAL, since a Role definition itself has no scope; only an Assignment does."
  - "RoleForm exposes both a cloneSources prop (new/page.tsx's clone-from-default UX) and a plain initialPermissions prop, so Plan 02-03's role-edit reuse of this same component doesn't need to fake a clone-source list."

patterns-established:
  - "Domain-grouped permission picker (14 native <details> sections) as the reusable UI shape for any future permission-set editor"

requirements-completed: [RBAC-01, RBAC-03]

coverage:
  - id: D1
    description: "Server-side permission-set validation rejects unknown and duplicate identifiers, accepts an empty set"
    requirement: "RBAC-03"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#permission set validation"
        status: pass
    human_judgment: false
  - id: D2
    description: "roleScope() is an empty resource, reachable only by a GLOBAL grant; create refuses a Course-scoped roles.manage grant"
    requirement: "RBAC-03"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#refuses to create when the only grant is Course-scoped"
        status: pass
    human_judgment: false
  - id: D3
    description: "Creating a role writes one Role row, one version-1 RoleVersion row, and exactly one role.created audit event"
    requirement: "RBAC-01"
    verification:
      - kind: unit
        ref: "tests/role-service.test.ts#creates a role, writes a version-1 RoleVersion row, and captures exactly one audit entry"
        status: pass
    human_judgment: false
  - id: D4
    description: "PERMISSION_GROUPS covers all 36 catalogue permissions exactly once across 14 groups, in both directions"
    requirement: "RBAC-01"
    verification:
      - kind: unit
        ref: "tests/permission-groups.test.ts#covers every catalogue permission exactly once, in both directions"
        status: pass
    human_judgment: false
  - id: D5
    description: "/staff/roles list and /staff/roles/new create flow render correctly end to end, defaults pinned first with a Default badge, licence.* disabled with a tooltip at non-global scope"
    verification: []
    human_judgment: true
    rationale: "No browser was available this session to visually confirm rendering, badge placement, disclosure interaction, and the tooltip text — service-layer and grouping logic are unit-proven, but the actual UI needs human/UAT confirmation."

duration: ~45min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 01 Summary

**Role creation wired end-to-end (service → Server Action → route → RolesTable → RoleForm → 14-group PermissionPicker → live EffectiveAccessPreview), proving the tracer pattern every later Phase 2 plan builds on.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 (tracer + expansion)
- **Files modified:** 12 (10 created, 2 modified)

## Accomplishments
- `role-service.ts` — hand-written `list`/`get`/`create`, catalogue-closed permission validation, one `$transaction` writing both the `Role` row and its version-1 `RoleVersion` row, followed by a `role.created` audit event.
- `/staff/roles` and `/staff/roles/new` render through the same primitives (`ResourceTable`, `ResourceForm`, `FormField`, `TextInput`) already proven on Courses.
- `permission-groups.ts` groups all 36 catalogue identifiers into the 14 domains from the catalogue's own comments, with a plain-language effective-access summariser (D-04) and a clone-from-default selector (D-02).
- Default roles pin first with a "Default" badge (D-37/D-38); the two `licence.*` identifiers render disabled with a "Global scope only" tooltip whenever a non-GLOBAL `scopeType` is passed (D-03) — currently unexercised by this plan's own screens since role definitions are inherently global, but ready for the Assignment Drawer (Plan 02-04) to reuse unmodified.
- Workspace nav gained Roles (linked), Users and Audit (placeholders for Plans 02-06/07 and 02-05).

## Task Commits

None — this run was executed directly, without spawning `gsd-executor` and without any `git commit`, per explicit user instruction for this session. All changes are on disk, uncommitted.

## Files Created/Modified
- `src/server/services/role-service.ts` — Role list/get/create, permission-set validation, versioning transaction
- `src/lib/permission-groups.ts` — 14-domain grouping + effective-access summariser
- `src/app/staff/roles/page.tsx` — Roles list route
- `src/app/staff/roles/RolesTable.tsx` — list table, default-pinning, Default badge
- `src/app/staff/roles/new/page.tsx` — create route, clone-source fetch
- `src/app/staff/roles/RoleForm.tsx` — create form composing the picker + preview
- `src/app/staff/roles/PermissionPicker.tsx` — 14 collapsible domain groups, global-only disabled state
- `src/app/staff/roles/EffectiveAccessPreview.tsx` — live plain-language access summary
- `src/app/staff/roles/actions.ts` — `createRoleAction` Server Action
- `tests/role-service.test.ts` — service-layer coverage, no database
- `tests/permission-groups.test.ts` — grouping exhaustiveness + summariser coverage
- `src/app/staff/layout.tsx` — NAV gains Roles/Users/Audit entries

## Decisions Made
- Did not route Role through `createResourceService` (RESEARCH Pitfall 2) — hand-wrote the wrapping pattern instead.
- `PermissionPicker`'s `scopeType` prop is built now, generically, for the Assignment Drawer to reuse later, even though this plan's own usage never varies it from the default.

## Deviations from Plan
None — plan executed as written. Both tasks' `<action>` specs were followed directly; no auto-fixes were needed.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- `role-service.ts`, `permission-groups.ts`, and the create-flow UI are ready for Plan 02-02 (continuity safeguard + audit scope fields) and Plan 02-03 (role editing/versioning/history/deactivation, which will reuse `RoleForm` via its `initialPermissions` prop).
- No blockers. Not yet verified in a browser — flagged as `human_judgment: true` (D5) for UAT.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
