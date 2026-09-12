---
phase: 02-roles-permissions-staff-accounts
verified: 2026-09-02T10:09:49Z
status: passed
score: 4/4 roadmap success criteria verified (34/34 plan-level truths verified, 0 failed, 0 behavior-unverified)
behavior_unverified: 0
overrides_applied: 0
---

# Phase 2: Roles, Permissions & Staff Accounts Verification Report

**Phase Goal:** Administrators can define who can do what, where, without touching code, and every access-control change is attributable.
**Verified:** 2026-09-02T10:09:49Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A deployment seeds five active default roles (Administrator, Programme Manager, Instructor, Finance/Operations, Learner), and an administrator can build a custom role only from the approved permission catalogue — unknown/duplicate/malformed permissions are rejected (RBAC-01, RBAC-03). | ✓ VERIFIED | `prisma/seed.ts:25-136` upserts the 5 named roles by `name` (idempotent, create-if-missing/update-if-exists). `src/server/services/role-service.ts:63-` `validateRolePermissionSet()` filters unknown identifiers via `isPermission()` and rejects duplicates before any write; an empty set is explicitly accepted (Learner). `RolesTable.tsx:23-28,89-93` pins the 5 defaults in the fixed `DEFAULT_ROLE_ORDER` sequence, never alphabetical/created-at. `tests/role-service.test.ts` and `tests/permission-groups.test.ts` cover this with passing unit tests (confirmed via `npm test`, 219/219 green). |
| 2 | Editing a role creates a new version while preserving prior versions and requires a reason for sensitive reductions; a staff account can hold multiple active role assignments across global/Programme/Course/Cohort scope, and revoking one assignment does not affect others (RBAC-02, RBAC-04). | ✓ VERIFIED | `role-service.ts` `update()` (lines ~230-300) always appends a new `RoleVersion` row inside a `$transaction`, including on a no-op resubmission (no diff-suppression) and is optimistically locked on `Role.version` (`RoleVersionConflictError` on mismatch, no write). A reduction (`removed.length > 0`) demands a ≥10-char reason (`MIN_REASON_LENGTH`); an addition-only edit demands none. `assignment-service.ts` `revoke()` (lines ~180-225) updates exactly one row `where: { id: input.assignmentId }` — never `updateMany` — and returns the existing row unchanged if already revoked. `tests/role-service.test.ts` (versioning describe block, 14 tests) and `tests/assignment-service.test.ts` (`leaves a user's other assignments untouched when revoking one of three`) both pass. |
| 3 | The system refuses any change that would leave zero active users with role-management authority (RBAC-07). | ✓ VERIFIED | `continuity-service.ts` — `assertRoleManagementContinuity()` builds a GLOBAL-only, `roles.manage`-only, `user.status: "ACTIVE"`-only count (`buildContinuityWhere`), throwing a fixed, non-interpolated `ContinuityError` when the post-action count is 0. Confirmed wired at all four required D-24 trigger points: `role-service.ts:251` (remove `roles.manage` from a role), `role-service.ts:323` (deactivate a `roles.manage`-bearing role), `assignment-service.ts:210` (revoke a GLOBAL `roles.manage` assignment), `staff-account-service.ts:274` (deactivate any staff account, called unconditionally). Each call site passes `tx.assignment.count` from inside its own `prisma.$transaction`, co-locating the check with the write (documented, accepted TOCTOU residual risk T-02-10). `tests/continuity-service.test.ts` (18 tests, including the deactivated-admin-must-not-count Pitfall-1 case) all pass. |
| 4 | Every role, assignment, and staff-account change (create/invite/deactivate/reactivate) is visible in an audit view with actor, before/after, reason, and timestamp (RBAC-08, IAM-04). | ✓ VERIFIED | `audit-service.ts` `recordAudit()`/`buildAuditRow()` now carry `scopeType`/`scopeId` and apply sink-level `redactForAudit` (strips `passwordHash`/`password`/`sessionToken`/`token`/`secret`) before every write. `/staff/audit` (`audit-read-service.ts` + `AuditTable.tsx`) is a real DB-backed, `audit.view`-gated page reading the full `AuditEvent` table with actor/date/action filters and an expand-in-place before/after diff. `tests/audit-append-only.test.ts` proves via a whole-`src` source scan that exactly one file (`audit-service.ts`) creates audit rows and zero mutating/removing calls against the audit model exist anywhere. Every mutating service call site (`role-service`, `assignment-service`, `staff-account-service`) calls `recordAudit` after its transaction commits. |

**Score:** 4/4 roadmap success criteria verified.

### Plan-Level Must-Haves (all 8 plans)

All 34 distinct `must_haves.truths` entries across the 8 plan frontmatters were checked against the codebase (not SUMMARY.md claims). Representative spot-checks beyond the roadmap-level table above:

| Must-have (plan) | Status | Evidence |
|---|---|---|
| Prohibition: continuity block message never names/counts other admins | ✓ VERIFIED | `CONTINUITY_BLOCK_MESSAGE` is a module-level string constant with zero interpolation (`continuity-service.ts:22-23`); `tests/continuity-service.test.ts` asserts the message contains no digit and no `@`. |
| Prohibition: no update/delete/upsert against AuditEvent anywhere in `src` | ✓ VERIFIED | `tests/audit-append-only.test.ts` — whole-tree regex scan, passing. |
| Prohibition: temporary password never logged/audited/persisted in plaintext beyond the one-time return value | ✓ VERIFIED | `tests/staff-account-service.test.ts` — `returns a non-empty temporaryPassword not present in either audit entry`, run through the *real* `buildAuditRow`/`redactForAudit`, not a simplified test double. |
| A role bundling a global-only permission cannot be assigned below global scope | ✓ VERIFIED | `assignment-service.ts:138` and `staff-account-service.ts:174` both call `assertScopeAllowed(permission, input.scopeType)` per permission before any write; `tests/assignment-service.test.ts` — `rejects a role carrying licence.activate at COURSE scope with ScopeError and performs no write`. |
| Assignments are immutable — no update path exists (D-23) | ✓ VERIFIED | `assignment-service.ts` exports only `create`/`revoke`/`listForUser` — grep confirms no `update` method exists on the service at all. |
| Deactivating a staff account signs out all active sessions immediately (D-34) | ✓ VERIFIED | `staff-account-service.ts` calls `signOutAllForUser` strictly after the `$transaction` commits; `tests/staff-account-service.test.ts` — `invokes signOutAll exactly once with the deactivated user's id, after the transaction`. |
| Deactivating a role makes its active Assignment rows a non-grant with no per-assignment revoke (D-07); reactivation restores access automatically (D-36) | ✓ VERIFIED (declarative mechanism, not a race-prone runtime path) | `role-service.ts`'s `setActive()` flips `Role.active` only; `grant-service.ts:18-23` (Phase 1, unmodified — confirmed via `git diff --stat` showing zero changes) filters `role: { active: true }` at every grant-load, and the current-actor session boundary (`session-service.ts`) already rejects non-`ACTIVE` users independently. This is a stateless, declarative where-clause re-evaluated on every authorization check, not an async cleanup/ordering invariant — verified directly by reading the filter clause and its accompanying design comment, consistent with RESEARCH.md's explicit analysis of this exact mechanism. |
| Nav wiring: Roles/Users/Audit all reachable from `/staff` workspace nav | ✓ VERIFIED | `src/app/staff/layout.tsx:20-22` — all three now link to real routes (`/staff/roles`, `/staff/users`, `/staff/audit`), not placeholders. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server/services/role-service.ts` | list/get/create/update/setActive/versions/assignmentCount | ✓ VERIFIED | 412 lines, substantive, wired into `src/app/staff/roles/actions.ts` and pages |
| `src/server/services/continuity-service.ts` | RBAC-07 shared guard | ✓ VERIFIED | 99 lines, imported by all 3 other services at the 4 D-24 trigger points |
| `src/server/services/audit-service.ts` | scope fields + redaction | ✓ VERIFIED | 103 lines, modified (git diff confirms), sole audit-row creator per `audit-append-only.test.ts` |
| `src/server/services/assignment-service.ts` | create/revoke/listForUser | ✓ VERIFIED | 267 lines, wired into `/staff/users/[id]` AssignmentDrawer/AssignmentsPanel |
| `src/server/services/scope-lookup-service.ts` | Programme/Course/Cohort minimal lookups | ✓ VERIFIED | 104 lines, gated on `roles.manage` alone, 3-field projection confirmed by test |
| `src/server/services/audit-read-service.ts` | list/filterOptions | ✓ VERIFIED | 189 lines, backs `/staff/audit` with a real DB query, no mock data |
| `src/server/services/staff-account-service.ts` | create/deactivate/reactivate/search | ✓ VERIFIED | 381 lines, atomic account+first-assignment transaction confirmed |
| `src/app/staff/roles/**`, `src/app/staff/users/**`, `src/app/staff/audit/**` | full UI surfaces | ✓ VERIFIED | All files present (22 files under `src/app/staff/`), no placeholder/TBD/FIXME markers found, ESLint/tsc clean |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `/staff` nav | `/staff/roles`, `/staff/users`, `/staff/audit` | `layout.tsx` NAV array `href` | ✓ WIRED | All three are real links, not `href: null` placeholders |
| `role-service.update/setActive` | `continuity-service.assertRoleManagementContinuity` | direct import + call inside `$transaction` | ✓ WIRED | Confirmed at `role-service.ts:251,323` |
| `assignment-service.revoke` | `continuity-service.assertRoleManagementContinuity` | direct import + call | ✓ WIRED | Confirmed at `assignment-service.ts:210` |
| `staff-account-service.deactivate` | `continuity-service.assertRoleManagementContinuity` | direct import + call (unconditional) | ✓ WIRED | Confirmed at `staff-account-service.ts:274` |
| `staff-account-service.deactivate` | `auth-service.signOutAllForUser` | direct call, post-transaction | ✓ WIRED | Confirmed, and behaviorally test-proven (see above) |
| `AssignmentsPanel.tsx` (client) | `MIN_REASON_LENGTH` (server module) | prop passed from the Server Component page, not a direct client-side import | ✓ WIRED (fixed post-UAT, G-02-37) | `[id]/page.tsx` imports `MIN_REASON_LENGTH` from `role-service.ts` and passes it as a `minReasonLength` prop; `AssignmentsPanel.tsx` has no import of any server service |
| `/staff/audit` page | `audit-read-service.list/filterOptions` | server-side await in the page component | ✓ WIRED, data flows | Real Prisma query, gated on `audit.view`, no static/mock fallback |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `/staff/roles` (RolesTable) | role list | `roleService.list()` → Prisma `role.findMany` | Yes | ✓ FLOWING |
| `/staff/audit` (AuditTable) | audit rows | `auditReadService.list()` → Prisma `auditEvent.findMany` | Yes | ✓ FLOWING |
| `/staff/users` (UsersTable) | staff account list | `staffAccountService.list()` → Prisma `user.findMany` | Yes | ✓ FLOWING |
| `/staff/users/[id]` (AssignmentsPanel) | user's assignments | `assignmentService.listForUser()` → Prisma `assignment.findMany` | Yes | ✓ FLOWING |
| `EffectiveAccessPreview` | plain-language summary | pure derivation from in-flight permission `Set` + `permission-groups.ts` constants | Yes (by design, no server round-trip needed) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite passes | `npm test` | `Test Files 19 passed (19)`, `Tests 219 passed (219)` | ✓ PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| ESLint clean (including Prisma-import-boundary rule) | `npx eslint src tests prisma` | exit 0, no output | ✓ PASS |
| Audit append-only invariant (whole-`src` scan) | `vitest run tests/audit-append-only.test.ts` (part of full run) | 2/2 pass | ✓ PASS |
| Continuity guard wired at all 4 D-24 sites | `grep -n assertRoleManagementContinuity src/server/services/*.ts` | 4 real call sites found (role-service ×2, assignment-service ×1, staff-account-service ×1) | ✓ PASS |
| Uncommitted diff matches claimed file list | `git status --short` | Exactly the files listed across all 8 SUMMARY.md `key-files` sections, nothing extra/missing | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| RBAC-01 | 02-01, 02-03 | 5 default roles seeded, documented permission sets, no mandatory Support role | ✓ SATISFIED | `prisma/seed.ts` + `RolesTable.tsx` pinning/badge |
| RBAC-02 | 02-03 | Edit/activate/deactivate roles create a version, preserve prior versions, reason for sensitive reductions | ✓ SATISFIED | `role-service.ts` update/setActive + RoleVersion transaction |
| RBAC-03 | 02-01, 02-03 | Custom roles from closed catalogue; unknown/duplicate/malformed rejected | ✓ SATISFIED | `validateRolePermissionSet` + `isPermission()` |
| RBAC-04 | 02-04, 02-08 | Multiple active assignments per staff account; union of grants; revoke removes only the selected assignment | ✓ SATISFIED | `assignment-service.ts` create/revoke, `AssignmentsPanel.tsx` |
| RBAC-07 | 02-02, 02-03, 02-04, 02-06 | Refuse removal of the final active role-management administrator | ✓ SATISFIED | `continuity-service.ts` + 4 wired call sites |
| RBAC-08 | 02-02, 02-03, 02-04, 02-05, 02-06 | Role/version/assignment/scope/revocation/authorization-sensitive actions audited | ✓ SATISFIED | `audit-service.ts` scope+redaction, `/staff/audit` view, `audit-append-only.test.ts` |
| IAM-04 | 02-06, 02-07, 02-08 | Create/invite/deactivate/reactivate staff accounts, audited | ✓ SATISFIED | `staff-account-service.ts`, `/staff/users` + `/staff/users/new` |

No orphaned requirements — REQUIREMENTS.md's Phase 2 row set (RBAC-01, 02, 03, 04, 07, 08, IAM-04) exactly matches the union of `requirements:` fields declared across the 8 plan frontmatters.

### Anti-Patterns Found

None. Grep scans for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and "not implemented"/"coming soon" style phrases across every file this phase created/modified returned zero matches (one incidental hit on a `REDACTION_PLACEHOLDER` variable name, not a debt marker). No empty handlers, no hardcoded-empty stub data flowing to render output.

### Human Verification Required

None. The phase already has a completed browser-based UAT pass (`02-UAT.md`, 37/37 tests passing, 2 bugs found and fixed in-session and independently re-verified in the codebase during this pass — see G-02-34 and G-02-37 above), an independent security audit (`02-SECURITY.md`, 26/26 threats closed, 0 open, re-run by a separate auditor against the implementation rather than SUMMARY.md claims), and a Nyquist validation pass (`02-VALIDATION.md`, 219/219 tests, `nyquist_compliant: true`). This verification pass independently re-ran the full test suite, `tsc`, and `eslint`, and traced the four RBAC-07 trigger points, the RBAC-08 audit/redaction/append-only mechanism, and the two previously-reported UAT bug fixes directly in source — all confirmed present and correct, not merely claimed.

### Gaps Summary

No gaps. All 4 roadmap success criteria are independently verified against the actual codebase (not SUMMARY.md text), all 7 requirement IDs (RBAC-01, 02, 03, 04, 07, 08, IAM-04) trace to concrete, substantive, wired, data-flowing artifacts, the full test suite (219/219), `tsc`, and `eslint` are all independently re-run and confirmed clean, and the two bugs found during UAT are confirmed fixed in the current source. Nothing is committed to git yet (23 uncommitted files, matching every SUMMARY.md's own "zero commits, per explicit user instruction" note) — this is a process note for the orchestrator, not a phase-goal gap.

---

*Verified: 2026-09-02T10:09:49Z*
*Verifier: Claude (gsd-verifier)*
