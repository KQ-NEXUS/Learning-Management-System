# Phase 2: Roles, Permissions & Staff Accounts - Research

**Researched:** 2026-09-02
**Domain:** RBAC admin UI + service layer over an already-built authorization engine (brownfield, Next.js 16 App Router / Prisma / PostgreSQL)
**Confidence:** HIGH (all core mechanics verified by reading the actual source this session; a small number of product-language gaps are flagged LOW/ASSUMED explicitly below)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Role editor & permission picker**
- D-01: Permissions grouped by domain in collapsible sections (14 groups: Users, Roles, Programmes, Courses, Cohorts, Enrolments, Attendance, Payments, Assessment, Certificates, Support, Reporting, Audit, Licence), matching the comment structure already in `src/server/permissions/catalogue.ts`.
- D-02: New custom roles can be started as a clone of a seeded default role (Administrator/Programme Manager/Instructor/Finance-Operations/Learner) as well as from a blank slate.
- D-03: `licence.view`/`licence.activate` (the two `GLOBAL_ONLY_PERMISSIONS`) show visible-but-disabled with a tooltip explaining "global scope only" whenever the role/assignment being edited isn't global scope — never hidden.
- D-04: A live, plain-language "effective access" summary panel updates as permissions are toggled (e.g. "Can view and edit Courses; cannot manage Payments") — matches PXR §7's "effective-access preview" intent.
- D-05: Editing one of the 5 seeded default roles directly (not via clone) requires an extra confirmation step naming how many active assignments currently use it, before the save proceeds.
- D-06: Role version history (RoleVersion, RBAC-02) is exposed via a History tab on the role detail page, listing each version with what changed and its reason — reuses the `DetailLayout` tab pattern already established on Courses.
- D-07: Deactivating a role (`Role.active = false`) immediately makes every one of its active `Assignment` rows a non-grant (deny-by-default, no separate per-assignment revoke needed) — Reversibility: costly — reactivating the role does not retroactively restore the assignments' effective status without additional logic, since "deactivated role → assignments become inactive grants" is a one-directional service-layer rule, not a stored per-assignment flag. Before confirming, the UI shows how many active assignments will be affected.
- D-08: Role renaming is allowed at any time (`Role.name` stays `@unique`-enforced); existing `Assignment` rows are unaffected since they reference `roleId`, not name.

**Sensitive-edit reason threshold**
- D-09: Removing **any** permission from a role's set requires a mandatory reason (not just mutation-capable ones — simplest rule, errs toward more audit trail).
- D-10: Adding/expanding a role's permissions never requires a reason — the reason gate applies only to reductions, matching the roadmap's literal "reason for sensitive reductions" wording.
- D-11: Deactivating a role requires a mandatory reason (it's an integrity action per D-07's blast radius); renaming a role does not.
- D-12: Reuse the existing `ConfirmModal` component (`src/components/primitives/ConfirmModal.tsx`) and its `minReasonLength`/touched/validation pattern for every reason-gated confirmation in this phase, rather than building new reason-capture UI.
- D-13: `minReasonLength` for role-edit and assignment-revoke reasons is **10 characters**.
- D-14: Revoking an `Assignment` becomes mandatory-reason this phase — the `Assignment.reason` field is already nullable in the schema, so this is a service/UI validation change only, no migration. — Reversibility: reversible — purely an application-layer validation rule, no schema change.
- D-15: Removing multiple permissions from a role in one save requires only **one shared reason** for the whole edit, not one per removed permission — the before/after permission diff itself stays fully captured in the audit event regardless.
- D-16: Reason text on role/assignment audit events is visible to anyone holding `audit.view` — no additional restriction layered on top.

**Assignment drawer flow**
- D-17: Target user is found via search-as-you-type by name/email (typeahead), not a plain list picker.
- D-18: The scope picker is built for all four scope types (Global/Programme/Course/Cohort) now, querying the real Prisma models. Programme and Cohort pickers will simply show a "none yet" empty state until Phases 4/5 (Track B, running in parallel) seed real records — avoids rebuilding the picker later. — Reversibility: reversible — no rework needed when Track B lands, since the picker already queries live tables.
- D-19: A user's assignments render as a list of independently-revocable rows on their detail page (reuses the `DetailLayout` section pattern), reflecting RBAC-04's "union of active grants" model directly rather than inventing a "primary role" concept the schema doesn't have.
- D-20: Assignments are immediate-start only this phase (`Assignment.startsAt` defaults to "now"); an optional end date (`endsAt`) is supported, but scheduling a *future* start date is deferred.
- D-21: One scope target per assignment action — granting the same role across multiple Courses means repeating the action, not a multi-select batch-create.
- D-22: Creating a staff account (IAM-04) and assigning its first role happen in **one combined flow** — avoids leaving a newly created account with zero access.
- D-23: Assignments are immutable once created — changing scope or end-date is always revoke-old + create-new, matching the schema's `revokedAt`/`revokedById` shape and keeping the audit trail unambiguous. — Reversibility: costly — switching later to in-place edits would require reconciling any assignments already created under the revoke-and-recreate convention.

**Continuity safeguard (RBAC-07)**
- D-24: The zero-administrator check runs before all four of: (a) revoking an assignment that grants `roles.manage`, (b) removing `roles.manage` from a role's permission set, (c) deactivating a role that grants `roles.manage`, (d) deactivating the last user account holding it.
- D-25: The safeguard counts only **GLOBAL-scope** `roles.manage` grants — a Programme/Course/Cohort-scoped `roles.manage` holder can't manage roles outside that scope anyway, so it doesn't protect against the "system has no administrator" risk the requirement targets. — Reversibility: one-way — once services/tests are built against "global-only counts," broadening to any-scope counting later means redesigning the check's query shape and re-auditing every trigger point in D-24, not a config flip.
- D-26: The block message states the constraint plainly ("This change would leave no user with role-management access...") without naming other active administrators, to avoid leaking admin identities in an error message.
- D-27: No proactive "N active administrators" indicator this phase — the safeguard is surfaced reactively, only when a blocking action is attempted.
- D-28: No permanent "break-glass" admin account — the safeguard is purely dynamic, based on whoever currently holds an active global `roles.manage` grant.

**Audit view (RBAC-08)**
- D-29: The audit log lives on a dedicated `/staff/audit` page (not only per-record History tabs).
- D-30: The page shows the full `AuditEvent` table across every resource type from day one, not just Phase 2's role/assignment/staff-account events — `AuditEvent` is already a shared table Phase 1's resource-service factory writes to (Course create/edit/archive already produce rows), so scoping the view down now would mean rework once later phases add more audited resources. — Reversibility: reversible — a resource-type filter narrows the same underlying query; nothing about this choice blocks scoping down later.
- D-31: V1 filters: actor, date range, action/event type. Filtering to one target record is reached via that record's own History tab (D-06/D-19 pattern) rather than a top-level filter.
- D-32: Each row is a compact `ResourceTable`-style line (actor, action, target, time) that expands in place to show the full before/after diff and reason — keeps the list scannable despite variable diff shapes across action types.

**Deactivate/reactivate staff account (IAM-04)**
- D-33: Deactivating a staff `User` account requires a mandatory reason via `ConfirmModal`, consistent with D-11/D-14.
- D-34: Deactivation immediately signs out all of the user's active sessions, calling the existing `signOutAllForUser` (already built in Phase 1) — access is revoked the moment the account is deactivated, not whenever a session cookie happens to expire (up to 7 days later per `SESSION_TTL_DAYS`).
- D-35: A deactivated user's existing `Assignment` rows are left untouched — no per-assignment revoke events. Deny-by-default already denies a deactivated account regardless of its assignments (matches Phase 1's `withPermission` pattern), so this avoids audit noise from mass-revoking assignments that were never actually the problem.
- D-36: Reactivation is a pure account-status flip — since assignments were never revoked (D-35), the account automatically regains exactly the access it had before deactivation, with no manual re-assignment step. — Reversibility: one-way — this decision and D-35 are coupled; switching later to "reactivation requires re-assignment" would need D-35 to change first (assignments would have to actually be revoked on deactivation for that model to make sense).

**Default-role visibility (RBAC-01)**
- D-37: The 5 seeded default roles show a "Default" badge in the roles list, distinguishing them from custom (including cloned-from-default, per D-02) roles.
- D-38: Default roles are pinned at the top of the roles list, above custom roles.
- D-39: Default roles follow the same renaming rule as any role (D-08) — no exemption. Renaming one is still "editing a default role directly," so D-05's extra confirmation (naming affected active assignments) still applies.

### Claude's Discretion

None remaining — all previously-open gray areas (audit view, deactivate/reactivate UX, default-role visibility) were resolved in a follow-up discussion round on 2026-09-02.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within Phase 2's scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RBAC-01 | 5 active default roles seeded; custom roles built only from the approved catalogue, unknown/duplicate/malformed permissions rejected | Seed already implemented (`prisma/seed.ts:25-136`, verified) — this phase's job is the admin UI/service layer, not re-seeding. See "RBAC-03 validation" pattern below. |
| RBAC-02 | Editing a role creates a new version, preserves prior versions, requires a reason for sensitive reductions | `RoleVersion` model verified (`prisma/schema.prisma:344-359`). Concrete transactional write pattern given below. |
| RBAC-03 | Custom roles created only from the closed catalogue; unknown/malformed/duplicate/missing-field/invalid-version-or-state permissions rejected | `isPermission()` guard verified (`catalogue.ts:92-94`). Validation is application-layer over a `String[]` column, not a JSON-schema column — see Gap #1. |
| RBAC-04 | Multiple active assignments per user across scopes; revocation removes only the selected assignment | `Assignment` model verified (`schema.prisma:363-385`); union-of-grants mechanism already proven in `scope.ts`/`with-permission.ts` (Phase 1). This phase adds the assignment CRUD service and UI only. |
| RBAC-07 | Refuse a change that leaves zero active role-management administrators | No existing code — new continuity-check query designed and verified against real query surfaces below (grant-service.ts, schema.prisma). |
| RBAC-08 | Every role/assignment/staff-account change audited with actor, before/after, reason, timestamp | `AuditEvent` model and `recordAudit()` verified (`schema.prisma:391-414`, `audit-service.ts:26-41`). Gap: `recordAudit()` currently drops `scopeType`/`scopeId` — see Gap #4. |
| IAM-04 | Authorized staff create/invite/deactivate/reactivate staff accounts, audited | No existing staff-account service — new `staff-account-service.ts` needed, mechanics given below. "Invite" mechanics are ambiguous given no email sender exists yet — flagged as Open Question. |
</phase_requirements>

## Summary

Phase 2 is not new-technology research — it is a codebase-archaeology and mechanics-design task. Every piece of infrastructure this phase needs already exists and was read in full this session: the `withPermission` choke point, the `hasPermission`/`grantMatches` scope engine, the closed 36-identifier permission catalogue, the `Role`/`RoleVersion`/`Assignment`/`User`/`AuditEvent` Prisma models, the `recordAudit()` write path, and the four UI primitives (`ResourceTable`, `ResourceForm`, `DetailLayout`, `ConfirmModal`). The five default roles and their `RoleVersion` rows are *already seeded* by `prisma/seed.ts`. No new npm package is needed for this phase.

The real work is: (1) building `role-service.ts`, `assignment-service.ts`, and `staff-account-service.ts` that follow `course-service.ts`'s wiring pattern (permission + scope + `recordAudit`, no authorization logic of its own) while diverging from `createResourceService`'s generic `update`/`archive` methods, which do not fit Role/Assignment/User's actual field shapes (Gap #2 below); (2) a net-new "continuity safeguard" query that has no existing analog in the codebase and must deliberately re-derive account-active-ness that `loadGrantsForUser` gets for free from the session boundary (Gap #3 below, the most important finding in this document); (3) extending `recordAudit()`/`BusinessAuditEvent` to actually carry `scopeType`/`scopeId`, which RBAC-08 explicitly requires but the current audit write path silently drops (Gap #4).

**Primary recommendation:** Do not try to force Role, Assignment, or User mutations through `createResourceService`'s generic `update()`/`archive()` — hand-write `role-service.ts`, `assignment-service.ts`, `staff-account-service.ts` using the *same pattern* (`withPermission` wrap → resolve scope → mutate in a `prisma.$transaction` → `recordAudit` with before/after) that `course-service.ts` demonstrates, but with the extra transactional steps (RoleVersion insert, continuity check, session revocation) each domain actually needs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Role definition CRUD + versioning | API/Backend | Database | `RoleVersion` insert + `Role` update must be one transaction; no client-side authority over version numbers |
| Permission-set validation (catalogue closure, duplicates) | API/Backend | — | Must be re-validated server-side even though the picker UI only offers catalogue values — a scripted/direct request must not bypass it (RBAC-06 precedent) |
| Assignment create/revoke | API/Backend | Database | Scope match (`grantMatches`) and `assertScopeAllowed` are pure functions but must run server-side against the real target resource, not client-asserted scope |
| Continuity safeguard (RBAC-07) | API/Backend | Database | A single aggregate query against `Assignment`/`Role`/`User`; must run inside the same transaction as the mutating write to close the TOCTOU window as far as practical |
| Staff account lifecycle (create/invite/deactivate/reactivate) | API/Backend | Database | Deactivation must synchronously call `signOutAllForUser` (already server-side) |
| Audit event read view (`/staff/audit`) | API/Backend | Browser/Client | Backend owns permission-gated querying and filtering; browser owns the expand-in-place row rendering (`ResourceTable` pattern) |
| Scope picker (Programme/Course/Cohort lookup for assignment drawer) | API/Backend | Browser/Client | Prisma import boundary (ESLint rule) forces the lookup through a service even though it is read-only; browser owns the typeahead/empty-state rendering |
| "Effective access" plain-language preview (D-04) | Browser/Client | — | Pure derivation from the in-flight permission selection plus the statically-importable `catalogue.ts` constants — no new server round-trip needed, and no authority (server still re-validates on save) |
| Session revocation on deactivation | API/Backend | — | `signOutAllForUser` already exists server-side (`auth-service.ts:81-87`) |

## Standard Stack

### Core

No new dependencies. This phase is built entirely on packages already pinned in `package.json` (read this session):

| Library | Version | Purpose | Why Standard (for this codebase) |
|---------|---------|---------|--------------|
| `next` | 16.3.4 | App Router, Server Actions, Server Components | Locked project-wide (`PROJECT.md` Key Decisions) |
| `@prisma/client` / `prisma` | ^6.19.3 | ORM, migrations | Locked project-wide; import confined to `src/server/services/**` by ESLint rule (verified `eslint.config.mjs:29-54`) |
| `react` / `react-dom` | 19.2.8 | UI primitives, client components | Locked project-wide |
| `vitest` | ^4.1.11 | Unit tests | Locked project-wide; config verified at `vitest.config.mts` |

### Supporting

None new. `tsx` (`^4.23.13`) already runs `prisma/seed.ts`; no additional runner needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled runtime validation (`isPermission`, manual duplicate/empty checks) | `zod` or similar schema library | Codebase has **zero** validation-library dependencies today (`package.json` `dependencies` lists only `@prisma/client`, `next`, `react`, `react-dom`) and all existing validation (`catalogue.ts:92-94`'s `isPermission`, `ConfirmModal.tsx`'s reason-length check) is hand-rolled. Introducing `zod` for this phase alone would be the one inconsistent corner of the codebase. Recommend continuing hand-rolled validation for the permission-set / role-shape checks RBAC-03 requires. |
| `createResourceService`'s generic `update`/`archive` | Hand-written service methods per domain | See Gap #2 — the generic methods assume a `status` string field that Role/Assignment/User do not have in that shape. |

**Installation:** none required.

## Package Legitimacy Audit

**Not applicable this phase** — no new external packages are introduced. All functionality is built on dependencies already present and verified in `package.json` (read this session). No `npm view`/registry check was needed since no new package name is being proposed.

## Architecture Patterns

### System Architecture Diagram

```
Staff browser (role editor / assignment drawer / audit page)
        │
        │ 1. Server Action submit (form data: permission list, scope, reason)
        ▼
Server Action (src/app/staff/**/actions.ts)  ─── same shape as signin/actions.ts
        │
        │ 2. calls exactly one service function
        ▼
role-service.ts / assignment-service.ts / staff-account-service.ts
        │
        │ 3. wrapped in withPermission(permission, resolveScope)
        ▼                                   │
   [DENY] ──► AuthorizationError            │ [ALLOW]
                                             ▼
                              4. Continuity check (RBAC-07 triggers only)
                                 count active GLOBAL roles.manage grants,
                                 excluding the row about to change
                                             │
                                   [0 remain] ──► ContinuityError, no write
                                             │ [>0 remain, or not a trigger]
                                             ▼
                              5. prisma.$transaction([
                                   domain write (Role/Assignment/User update),
                                   RoleVersion insert (role edits only),
                                 ])
                                             │
                                             ▼
                              6. recordAudit({ actor, action, targetType,
                                   targetId, before, after, reason, scopeType,
                                   scopeId, outcome: "SUCCESS" })
                                             │
                                             ▼
                                     AuditEvent row (read by /staff/audit
                                     AND by the record's own History tab)
```

### Recommended Project Structure

```
src/server/services/
├── role-service.ts            # NEW — list/get reuse factory shape; create/update/
│                               #        deactivate/reactivate are hand-written (Gap #2)
├── assignment-service.ts       # NEW — create/revoke only (assignments are immutable, D-23)
├── staff-account-service.ts    # NEW — create/invite/deactivate/reactivate (IAM-04)
├── continuity-service.ts        # NEW — single exported check, called from the 3 files above
├── audit-service.ts             # EXISTING — extend BusinessAuditEvent + recordAudit (Gap #4)
├── scope-lookup-service.ts       # NEW — thin Programme/Cohort id+title lookups for the
│                               #        assignment scope picker (D-18); Course already
│                               #        has courseService.list()
├── grant-service.ts             # EXISTING — read-only, do not modify for this phase
└── course-service.ts            # EXISTING — the pattern to copy, not to extend

src/app/staff/
├── roles/
│   ├── page.tsx                 # list, pinned defaults first (D-38) + "Default" badge (D-37)
│   ├── new/page.tsx              # blank-slate or clone-from-default (D-02)
│   ├── [id]/page.tsx              # DetailLayout: Overview / Permissions / History tabs (D-06)
│   └── RolesTable.tsx, RoleForm.tsx, PermissionPicker.tsx, EffectiveAccessPreview.tsx
├── users/
│   ├── page.tsx                  # staff account list
│   ├── [id]/page.tsx               # DetailLayout: Overview / Assignments (D-19) tabs
│   └── UsersTable.tsx, StaffAccountForm.tsx, AssignmentDrawer.tsx
└── audit/
    └── page.tsx, AuditTable.tsx    # D-29..D-32
```

### Pattern 1: Service methods that CAN reuse `createResourceService` as-is

**What:** `list` and `get` are pure permission+scope-gated reads with no domain-specific side effects. Role, Assignment, and User can use the factory's `list`/`get` directly (or a hand-rolled equivalent with the identical shape) because those two operations have no versioning/continuity/session concerns.

**Example (verified factory signature, `resource-service.ts:68-76`):**
```typescript
// Source: src/server/services/resource-service.ts (read this session)
const list = withPermission<{ where?: unknown; scope?: ResourceScope }>(
  permissions.view,
  (input) => input.scope ?? {},
)(async (input) => delegate.findMany({ where: input.where }));

const get = withPermission<string>(permissions.view, (id) => toScope(id))(
  async (id) => delegate.findUnique({ where: { id } }),
);
```
`toScope` for Role and User should be `() => ({})` — an empty `ResourceScope` — because Role and User rows carry no `cohortId`/`programmeId`/`courseIds` and `grantMatches` (`scope.ts:62-76`, verified) returns `false` for any non-GLOBAL grant against an empty resource. This means routing Role/User reads through an empty `toScope` **naturally forces GLOBAL-only `roles.manage`/`users.manage` grants to succeed** — no extra code needed to enforce "role management is inherently global."

### Pattern 2: Service methods that CANNOT reuse `createResourceService`'s `update`/`archive`

**What goes wrong if you try:** `resource-service.ts`'s `archive()` hard-codes `data: { status: "ARCHIVED" }` (verified `resource-service.ts:121-124`). Role uses `active: Boolean` (verified `schema.prisma:322`), User uses `status: UserStatus` with values `PENDING_VERIFICATION | ACTIVE | DEACTIVATED` (verified `schema.prisma:28-32`, quoted below) — neither has an `"ARCHIVED"` state. Assignment has no "archive" concept at all — it is revoked (`revokedAt`/`revokedById`, verified `schema.prisma:375-376`), and per D-23 is otherwise immutable (no `update` operation exists at all).

Verbatim schema excerpt (verified, `schema.prisma:28-32`):
```
enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  DEACTIVATED
}
```

**What to do instead:** hand-write `deactivate`/`reactivate`/`revoke` methods in the new service files that follow the *same wrapping pattern* as the factory (`withPermission` → mutate → `recordAudit`) but write the fields that actually exist on each model:

```typescript
// Illustrative pattern for staff-account-service.ts — NOT existing code.
// Grounded in: with-permission.ts (withPermission signature, verified),
// auth-service.ts:81-87 (signOutAllForUser, verified),
// audit-service.ts:26-41 (recordAudit, verified),
// schema.prisma:202-243 (User model, verified).
export const deactivateStaffAccount = withPermission<{
  userId: string;
  reason: string;
}>("users.manage", () => ({}))(async ({ userId, reason }, ctx) => {
  await assertRoleManagementContinuity({ excludeUserId: userId }); // Gap #3 — only when this user holds roles.manage

  const before = await prisma.user.findUnique({ where: { id: userId } });
  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        status: "DEACTIVATED",
        deactivatedAt: new Date(),
        deactivatedById: ctx.actor.userId,
      },
    });
    return updated;
  });

  await signOutAllForUser(userId); // D-34
  await recordAudit({
    actorId: ctx.actor.userId,
    action: "user.deactivated",
    targetType: "User",
    targetId: userId,
    before,
    after,
    reason,
    outcome: "SUCCESS",
  });
  return after;
});
```

### Pattern 3: RBAC-02 role-edit versioning transaction

**Verified inputs:**
- `Role` model: `id`, `name` (`@unique`), `description?`, `active`, `version` (default 1), `isDefault`, `permissions: String[]` — `schema.prisma:318-341`.
- `RoleVersion` model: `id`, `roleId`, `version`, `name`, `description?`, `permissions: String[]`, `active`, `reason?`, `createdById?`, `createdAt`, with `@@unique([roleId, version])` — `schema.prisma:344-359`.
- Seed already writes version 1 rows for all 5 defaults via `prisma.roleVersion.upsert` keyed on `roleId_version` (verified `prisma/seed.ts:123-135`), so the unique-key shape (`roleId_version`) to use in `where` clauses is confirmed working.

**Concrete write shape (illustrative, grounded in the above, not existing code):**
```typescript
// role-service.ts — illustrative pattern.
async function writeRoleEdit(
  roleId: string,
  patch: { name?: string; description?: string | null; permissions?: string[]; active?: boolean },
  reason: string | null,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.role.findUniqueOrThrow({ where: { id: roleId } });
    const nextVersion = before.version + 1;

    const after = await tx.role.update({
      where: { id: roleId },
      data: { ...patch, version: nextVersion },
    });

    await tx.roleVersion.create({
      data: {
        roleId,
        version: nextVersion,
        name: after.name,
        description: after.description,
        permissions: after.permissions,
        active: after.active,
        reason,          // D-09/D-15: only present when a permission was removed or the role deactivated
        createdById: actorId,
      },
    });

    return { before, after };
  });
}
```
`recordAudit()` is called **separately, after** this transaction commits, with the same `before`/`after` — `RoleVersion` (product history, read via the History tab) and `AuditEvent` (security/compliance audit, read via `/staff/audit`) are two different tables serving two different UI surfaces (D-06 vs D-29); both must be written on every role edit, not one in place of the other.

### Pattern 4: RBAC-07 continuity safeguard — the actual query

This is genuinely new logic; nothing in the codebase does this today. The critical, non-obvious correctness requirement (verified by reading `grant-service.ts` and `session-service.ts` together this session — see Common Pitfalls #1) is that **the check must independently filter on `user.status === "ACTIVE"`**, because nothing else in the write path does that for you when you're counting *other* users.

```typescript
// continuity-service.ts — illustrative, grounded in schema.prisma:363-385 (Assignment),
// schema.prisma:202-243 (User), schema.prisma:318-341 (Role), catalogue.ts (roles.manage
// identifier, verified present at catalogue.ts:20).
export class ContinuityError extends Error {
  constructor() {
    super("This change would leave no user with role-management access. Choose a different action.");
    this.name = "ContinuityError";
  }
}

type ContinuityExclusion =
  | { kind: "assignment"; assignmentId: string }
  | { kind: "role"; roleId: string }
  | { kind: "user"; userId: string };

export async function assertRoleManagementContinuity(
  exclude: ContinuityExclusion,
  now: Date = new Date(),
): Promise<void> {
  const where: Prisma.AssignmentWhereInput = {
    scopeType: "GLOBAL",                 // D-25: GLOBAL-scope grants only
    active: true,
    revokedAt: null,
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    role: { active: true, permissions: { has: "roles.manage" } },
    user: { status: "ACTIVE" },          // see Pitfall #1 — NOT implied by anything else here
  };

  if (exclude.kind === "assignment") where.id = { not: exclude.assignmentId };
  if (exclude.kind === "role") where.roleId = { not: exclude.roleId };
  if (exclude.kind === "user") where.userId = { not: exclude.userId };

  const remaining = await prisma.assignment.count({ where });
  if (remaining === 0) throw new ContinuityError();
}
```

**The four call sites (D-24), all before the write commits:**
| Trigger | Exclusion passed |
|---|---|
| (a) Revoking an assignment that grants `roles.manage` | `{ kind: "assignment", assignmentId }` — only call the check when the assignment being revoked is itself GLOBAL-scoped and grants `roles.manage`; skip otherwise |
| (b) Removing `roles.manage` from a role's permission set | `{ kind: "role", roleId }` — only call when `roles.manage` is present in `before.permissions` and absent from the new set |
| (c) Deactivating a role that grants `roles.manage` | `{ kind: "role", roleId }` — only call when `roles.manage` is in the role's current permission set |
| (d) Deactivating the last user account holding it | `{ kind: "user", userId }` — call unconditionally on every staff deactivation (cheap query; simplest to always run rather than pre-checking whether the user even holds `roles.manage`) |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Permission-string validation | A second permission list/regex | `isPermission()` from `catalogue.ts` (verified, line 92-94) | Single source of truth for the closed catalogue; already the compile-time `Permission` type source |
| Scope-vs-permission compatibility (licence.* global-only rule) | A new "is this scope allowed" check for role/assignment forms | `assertScopeAllowed()` from `scope.ts` (verified, line 111-117) | Already implements the exact GLOBAL_ONLY_PERMISSIONS rule this phase's D-03/D-18 depend on |
| Reason-gated confirmation UI (length counter, focus trap, ESC handling) | A new modal per action | `ConfirmModal` (verified, `ConfirmModal.tsx`), per D-12 | Already implements the exact `minReasonLength`/touched pattern D-13 specifies |
| Tabbed record layout (role History tab, user Assignments tab) | New tab component | `DetailLayout` (verified, `DetailLayout.tsx`), per D-06/D-19 | Already implements roving-tabindex keyboard pattern and per-section error isolation |
| Audit trail storage | A parallel "RBAC audit" table | `AuditEvent` model + `recordAudit()` (verified, both read this session) | Already shared by Phase 1's resource-service factory; RBAC-08's audit page (D-30) is explicitly designed to read this one table across all resource types |

**Key insight:** almost everything this phase needs to *reuse* is a pure function or a dumb component with no domain knowledge (`isPermission`, `assertScopeAllowed`, `grantMatches`, `ConfirmModal`, `DetailLayout`). The only genuinely new logic is the continuity-check aggregate query and the versioning transaction — both are small, and both are specified concretely above.

## Common Pitfalls

### Pitfall 1: Continuity check silently counts deactivated administrators
**What goes wrong:** If the continuity query only checks `Assignment.active = true` (mirroring `loadGrantsForUser`'s filter, verified `grant-service.ts:18-33`) without also joining `User` and requiring `status: "ACTIVE"`, a deactivated administrator's still-`active: true` assignment (per D-35 — deactivation deliberately leaves assignments untouched) will incorrectly count as "another active administrator," letting the last *actually reachable* administrator be removed.
**Why it happens:** `loadGrantsForUser` doesn't need to check `user.status` itself because by the time it runs, `withPermission` has already called `getCurrentActor()` → `getActorBySessionToken()`, which returns `null` for any non-`ACTIVE` user (verified `session-service.ts:31`) — so the actor-authentication boundary does that filtering for the *current user* automatically. The continuity check has no such boundary: it deliberately queries *other* users, so nothing filters deactivated accounts for it unless the query says so explicitly.
**How to avoid:** always include `user: { status: "ACTIVE" }` in the continuity-check `where` clause (see Pattern 4 above).
**Warning signs:** a test where "the only other admin is deactivated" passes the safeguard when it should block.

### Pitfall 2: Reusing the generic factory's `update`/`archive` for Role/Assignment/User
**What goes wrong:** `resource-service.ts`'s `archive()` writes `{ status: "ARCHIVED" }` (verified, line 123) — this throws or silently corrupts data against Role (`active: Boolean`) and User (`status: UserStatus` with no `ARCHIVED` value, verified `schema.prisma:28-32`). Assignment has no `status`/`active`-as-archive concept at all.
**Why it happens:** the factory was built and proven against Course, which has a `PublicationStatus` enum including `ARCHIVED`. It was never designed to generalize past that shape — this is flagged as a known fragility in `.planning/codebase/CONCERNS.md` ("Resource service factory assumptions," read this session).
**How to avoid:** use the factory only for `list`/`get` on Role/User; hand-write `create`/`update`/`deactivate`/`reactivate`/`revoke` per Pattern 2/3 above.
**Warning signs:** a Prisma error about an invalid enum value, or (worse) a successful write that sets a nonsensical `status` string that then silently fails every subsequent `grant-service` query.

### Pitfall 3: `recordAudit()` currently drops scope
**What goes wrong:** `BusinessAuditEvent` (verified `audit-service.ts:13-24`) has no `scopeType`/`scopeId` fields, even though the `AuditEvent` model has both (verified `schema.prisma:398-399`) and RBAC-08 explicitly requires "actor, target, before/after, scope, reason, timestamp, correlation." Every role/assignment audit event written via the current `recordAudit()` signature will have `scopeType`/`scopeId` as `null`, which is silently wrong for a Programme/Course/Cohort-scoped assignment revoke.
**Why it happens:** the only caller today (`course-service.ts`) never has a meaningful scope to report (Courses aren't scoped resources in the same sense), so the gap was invisible in Phase 1.
**How to avoid:** extend `BusinessAuditEvent` and `recordAudit()` to accept and write `scopeType`/`scopeId`, and pass them from `assignment-service.ts` (the assignment's own scope) on every assignment audit event. This is a code change to an existing shared file, not a schema migration — the columns already exist.
**Warning signs:** the audit view (D-29) shows every assignment-scope change with an empty/blank scope column.

### Pitfall 4: Skipping the reason gate for default-role edits
**What goes wrong:** D-39 explicitly says default roles get **no exemption** from D-05/D-09/D-11's reason-gating — a common shortcut ("it's a seeded system role, no need to confirm") would violate this directly.
**How to avoid:** route every role mutation, default or custom, through the same `role-service.ts` functions; do not special-case `isDefault` anywhere except the D-05 "extra confirmation naming affected assignments" and the D-37/D-38 list-rendering badge/pin.

### Pitfall 5: TOCTOU race on the continuity check
**What goes wrong:** two concurrent requests could each read "1 other administrator remains" and both proceed, leaving zero.
**How to avoid:** run the continuity `count()` and the mutating write inside the same `prisma.$transaction` (Postgres's default `READ COMMITTED` isolation won't fully eliminate the race under true concurrency, but co-locating them in one transaction closes the largest part of the window with no added complexity). D-27 explicitly scopes this safeguard as reactive-only, not proactively locked, so a fully serializable guarantee is out of scope for this phase — but the free transactional wrapping is still worth doing since Pattern 3/4 already require a transaction for the versioning write.
**Warning signs:** none observable without a concurrency test; flag as a known, accepted limitation per D-27 rather than something to solve fully this phase.

### Pitfall 6: Treating "role permissions stored as JSON" (RBAC-03 wording) as a schema gap
**What goes wrong:** RBAC-03's acceptance text says permissions are "stored as schema-validated JSON," but the actual column is `permissions String[]` (verified `schema.prisma:332`), a native Postgres array, not a `Json` column. Reading this literally could send someone toward an unnecessary migration.
**How to avoid:** the requirement's intent (closed-catalogue validation, duplicate/unknown rejection) is fully satisfiable at the application layer against the existing `String[]` column using `isPermission()` plus a manual duplicate check — no schema change. The phase description itself confirms this: "this phase is building services + UI on top of an existing schema, not designing the schema."

## Code Examples

### Validating a permission set before writing to `Role.permissions` (RBAC-03)
```typescript
// Illustrative — grounded in catalogue.ts's isPermission (verified, line 92-94).
import { isPermission, isGlobalOnly, type Permission } from "@/server/permissions/catalogue";
import { assertScopeAllowed } from "@/server/permissions/scope";

export class InvalidPermissionSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPermissionSetError";
  }
}

export function validateRolePermissionSet(input: string[]): Permission[] {
  const unknown = input.filter((p) => !isPermission(p));
  if (unknown.length > 0) {
    throw new InvalidPermissionSetError(`Unknown permission(s): ${unknown.join(", ")}`);
  }
  const deduped = new Set(input);
  if (deduped.size !== input.length) {
    throw new InvalidPermissionSetError("Duplicate permissions in submitted set.");
  }
  return input as Permission[]; // safe: every entry passed isPermission
}
```
Note: an **empty** set must remain valid — the seeded Learner role has `permissions: []` (verified `prisma/seed.ts:79`) — so do not add a "non-empty" check.

### Assignment scope resolver, mirroring `courseScope` (RBAC-04/RBAC-05)
```typescript
// Illustrative — mirrors the verified courseScope pattern (course-service.ts:19-21).
import type { ResourceScope } from "@/server/permissions/scope";

type ScopeType = "GLOBAL" | "PROGRAMME" | "COURSE" | "COHORT"; // verified enum, schema.prisma:34-39

export function assignmentTargetScope(scopeType: ScopeType, scopeId: string | null): ResourceScope {
  switch (scopeType) {
    case "GLOBAL": return {};
    case "PROGRAMME": return { programmeId: scopeId! };
    case "COURSE": return { courseIds: [scopeId!] };
    case "COHORT": return { cohortId: scopeId! };
  }
}
```
This is the scope a caller's own `roles.manage` grant must match to be allowed to create/revoke an assignment at that target scope — i.e., a Programme-scoped `roles.manage` holder can grant/revoke roles within their Programme but not globally, which is exactly the boundary D-25's reasoning describes.

### Role reactivation requires zero extra code (clarifies a confusing decision note)
Verified mechanic: `loadGrantsForUser` filters `role: { active: true }` at query time (verified `grant-service.ts:22`), not via a stored per-assignment flag. This means flipping `Role.active` back to `true` **automatically** restores every previously-active `Assignment`'s effective grant on the very next authorization check — no backfill, no per-assignment write, no migration. D-07's "Reversibility: costly" annotation describes the cost of later *abandoning this live-join design* in favor of a stored-per-assignment-flag alternative, not the cost of clicking "reactivate" on a role — reactivation itself is a one-field flip.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Invite" (IAM-04) mechanics: since no email-sending provider is wired yet (`EmailDispatch` model exists but unused, per `.planning/codebase/CONCERNS.md`, read this session), staff account creation this phase most likely sets an initial password directly (admin-set or generated) rather than dispatching a real invite email/link — actual "invitation" UX is deferred alongside Phase 13's email work. | IAM-04 requirements support, staff-account-service design | If wrong, the planner may build a token-based invite flow that has no way to actually reach the invitee (no email sender), wasting a wave; or under-build if a token/link flow was actually expected this phase. Needs explicit user/planner decision before task-writing. |
| A2 | `users.manage`/`users.view` permission checks for staff-account operations should use an empty `toScope(() => ({}))`, i.e., staff-account management is GLOBAL-only in practice — the catalogue does not mark these `GLOBAL_ONLY_PERMISSIONS` (only `licence.*` are, verified `catalogue.ts:100-103`), so a Programme-scoped `users.manage` grant is technically assignable but would never match an empty-scope User resource and would therefore be a no-op grant. | Architecture Patterns, Pattern 1 | Low risk — worst case is a confusing "why does this scoped grant never work" support question; not a security hole (deny-by-default still holds). Worth a planner note/UI warning similar to D-03's `licence.*` treatment, but not blocking. |
| A3 | The continuity check's transaction-isolation gap (Pitfall 5) is an accepted limitation per D-27's "reactive only" framing, not something this phase must close with row-level locking (`SELECT ... FOR UPDATE`) the way `Cohort.seatsTaken` does (verified pattern exists at `schema.prisma:591-595` for a different concern). | Common Pitfalls #5 | If the user actually wants a hard guarantee here, a `SELECT ... FOR UPDATE`-style lock on the relevant Assignment rows would be needed; low likelihood given the decision's explicit "reactive, not proactive" framing, but confirm before considering the phase done from a security-audit perspective. |

## Open Questions

1. **What does "invite" actually do without an email sender?**
   - What we know: D-22 requires create-account + first-role-assignment as one combined flow; IAM-04's acceptance text says "create or invite"; no email dispatch logic exists yet (Phase 13 blocker, confirmed in `STATE.md` and `.planning/codebase/CONCERNS.md`).
   - What's unclear: whether "invite" this phase means (a) admin sets a password directly and communicates it out-of-band (mirrors `prisma/seed.ts`'s `DEV_PASSWORD` + `hashPassword` pattern, verified), (b) a `VerificationToken` row is created with a purpose like `"invite"` but the resulting link is only ever surfaced in the UI for the admin to copy/share manually (no actual email send), or (c) staff-account creation this phase is fully separate from any "activate your account" flow and simply creates an `ACTIVE` user with an admin-set password.
   - Recommendation: confirm with the user before planning; (a) or (c) requires the least new code and doesn't presuppose Phase 3's password-reset/verification work landing first. (b) is a reasonable middle ground that produces forward-compatible data (`VerificationToken.purpose`) without requiring email infrastructure.

2. **Should the scope picker's Programme/Cohort lookups be gated by `programmes.view`/`cohorts.view`, or by the caller's `roles.manage` alone?**
   - What we know: D-18 says the picker "queries the real Prisma models" and shows "none yet" empty states for Programme/Cohort until Phase 4/5.
   - What's unclear: whether a user who can manage role assignments but lacks `programmes.view`/`cohorts.view` should be able to browse the Programme/Cohort dropdown at all (arguably yes, since they need *some* way to pick a valid target even without full view rights on that domain).
   - Recommendation: gate the lookup on `roles.manage` at GLOBAL scope only (matching the "assignment creation is inherently a global-administrative action unless scoped to grant into a specific sub-tree" framing already implicit in D-25), returning only `id`+`title`/`code` (no other fields), which is a low-sensitivity payload either way.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Dev/build runtime | ✓ (checked this session) | v24.6.0 | — |
| npm | Package management | ✓ (checked this session) | 11.5.1 | — |
| Prisma CLI | Migrations/seed | ✓ (checked this session, `npx prisma --version` ran) | matches `^6.19.3` pin | — |
| PostgreSQL (via `DATABASE_URL`) | All service-layer reads/writes | Not independently re-verified this session | — | Relying on Phase 1 evidence (84 passing tests, seed script exists and is documented as runnable) — no new observation made; if the dev DB is unreachable, this is a pre-existing Phase 1 environment concern, not new to Phase 2 |

No missing dependencies with no fallback. No new external services are introduced by this phase.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.11 (verified `package.json`) |
| Config file | `vitest.config.mts` (verified: `environment: "node"`, `include: ["tests/**/*.test.ts"]`, alias `@` → `src`) |
| Quick run command | `npm test` (== `vitest run`, verified `package.json` scripts) |
| Full suite command | `npm test` (same — no separate "quick" vs "full" split configured today) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RBAC-01 | Role list surfaces 5 defaults with `isDefault` true, pinned/badged | unit | `vitest run tests/role-service.test.ts` | ❌ Wave 0 |
| RBAC-02 | Editing a role's permissions creates a new `RoleVersion` row and preserves the prior one | unit | `vitest run tests/role-service.test.ts -t versioning` | ❌ Wave 0 |
| RBAC-03 | Unknown/duplicate permission strings rejected before write | unit | `vitest run tests/role-service.test.ts -t validation` | ❌ Wave 0 |
| RBAC-04 | Revoking one assignment does not affect a user's other active assignments | unit | `vitest run tests/assignment-service.test.ts` | ❌ Wave 0 |
| RBAC-07 | Last-administrator block at all 4 D-24 trigger points; deactivated admin does not count (Pitfall 1) | unit | `vitest run tests/continuity-service.test.ts` | ❌ Wave 0 |
| RBAC-08 | Every role/assignment/staff-account mutation writes an `AuditEvent` with before/after/reason/scope | unit | `vitest run tests/audit-service.test.ts` | ❌ Wave 0 (extend existing `audit-service.ts` coverage) |
| IAM-04 | Deactivation calls `signOutAllForUser`; reactivation restores access with no re-assignment | unit | `vitest run tests/staff-account-service.test.ts` | ❌ Wave 0 |

Existing tests already cover the *mechanism* this phase depends on but not this phase's new services: `tests/resource-service.test.ts`, `tests/with-permission.test.ts`, `tests/scope.test.ts`, `tests/permissions.test.ts` (all verified present, read `resource-service.test.ts` this session as the harness pattern to copy).

### Sampling Rate

- **Per task commit:** `vitest run tests/<new-file>.test.ts` (targeted)
- **Per wave merge:** `npm test` (full suite — currently ~10 files, fast)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/role-service.test.ts` — covers RBAC-01, RBAC-02, RBAC-03
- [ ] `tests/assignment-service.test.ts` — covers RBAC-04
- [ ] `tests/continuity-service.test.ts` — covers RBAC-07 (all 4 D-24 triggers + Pitfall 1's deactivated-admin case)
- [ ] `tests/staff-account-service.test.ts` — covers IAM-04
- [ ] Extend `tests/audit-service.test.ts` (or create if it doesn't already isolate `recordAudit`) — covers RBAC-08's scope-field gap (Pitfall 3)
- [ ] No new framework install needed — Vitest harness pattern to copy is `tests/resource-service.test.ts` (mock `Delegate<T>`, `createWithPermission` with fixed grants, assert on captured audit entries)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Partial | Staff account creation reuses existing `hashPassword` (Phase 1, not re-verified this session); no new auth mechanism introduced |
| V3 Session Management | Yes | `signOutAllForUser` (verified `auth-service.ts:81-87`) on deactivation (D-34) |
| V4 Access Control | Yes — core of this phase | `withPermission` + `hasPermission`/`grantMatches` (verified, both files read in full) for every role/assignment/staff-account mutation and read; continuity safeguard as a defense-in-depth control against self-inflicted lockout |
| V5 Input Validation | Yes | `isPermission()` catalogue closure (verified), duplicate-permission rejection, `assertScopeAllowed` for global-only permissions, `ConfirmModal`'s reason-length gate |
| V6 Cryptography | No | Not touched this phase (password hashing unchanged) |
| V7 Error Handling & Logging | Yes | Append-only `AuditEvent` (verified: `audit-service.ts` exposes no update/delete path); denial responses must not leak whether a record exists (existing `AuthorizationError` pattern, verified `with-permission.ts:40-50`) — reuse for Role/User 403s exactly as `DetailLayout`'s `denied` state already does for Courses |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-submitted permission list bypasses catalogue closure | Tampering / Elevation of Privilege | Server-side `isPermission()` re-validation on every write — never trust the picker UI's own constraint |
| Assignment created at a scope the permission forbids (e.g. a role bundling `licence.activate` assigned at Course scope) | Elevation of Privilege | `assertScopeAllowed()` (verified, already exists) called from `assignment-service.create` before the write |
| Self-inflicted lockout (zero role-management administrators) | Denial of Service (against the system's own operators) | The RBAC-07 continuity safeguard itself (Pattern 4) |
| Audit trail tampering/deletion | Repudiation | `AuditEvent` has no update/delete code path anywhere in the codebase (verified) — do not add one for this phase (e.g. do not add an "edit reason after the fact" feature) |
| Staff/user-search typeahead (D-17) used to enumerate accounts by unauthorized staff | Information Disclosure | Gate the typeahead query behind `users.view` via `withPermission`, exactly like every other read in this codebase — do not build it as an unauthenticated or permission-less autocomplete endpoint |
| Continuity-check error message naming other administrators | Information Disclosure | D-26 explicitly forbids naming other admins in the block message — implement the generic message text given in D-26/Pattern 4's `ContinuityError`, never interpolate a name/email into it |

## Sources

### Primary (HIGH confidence — read in full this session)
- `src/server/services/course-service.ts` — the template pattern to copy
- `src/server/services/resource-service.ts` — generic factory, its `update`/`archive` limitations
- `src/server/services/grant-service.ts` — grant-loading mechanics, the exact filter gap behind Pitfall 1
- `src/server/services/audit-service.ts` — `recordAudit()` current signature, the scope-field gap
- `src/server/services/auth-service.ts`, `src/server/services/session-service.ts`, `src/server/auth/current-actor.ts`, `src/server/auth/lockout.ts` — session/actor boundary, `signOutAllForUser`
- `src/server/permissions/with-permission.ts`, `src/server/permissions/scope.ts`, `src/server/permissions/catalogue.ts`, `src/server/permissions/index.ts` — the authorization choke point in full
- `prisma/schema.prisma` (full file, 1252 lines) — `Role` (318-341), `RoleVersion` (344-359), `Assignment` (363-385), `User` (202-243), `AuditEvent` (391-414), `Session` (269-283), `Programme` (420-448), `Cohort` (573-622)
- `prisma/seed.ts` — confirms the 5 default roles + `RoleVersion` version-1 rows are already seeded, exact permission sets per role
- `src/components/primitives/ConfirmModal.tsx`, `DetailLayout.tsx`, `ResourceForm.tsx`, `index.ts` — reusable UI primitive contracts
- `src/app/staff/courses/*.tsx`, `src/app/staff/layout.tsx`, `src/app/(auth)/signin/actions.ts` — end-to-end Server Action + page wiring pattern
- `tests/course-service.test.ts`, `tests/resource-service.test.ts`, `tests/schema-auth.test.ts` — existing test-harness patterns to copy
- `eslint.config.mjs`, `package.json`, `vitest.config.mts` — dependency/version/tooling ground truth
- `.planning/codebase/CONCERNS.md`, `.planning/codebase/CONVENTIONS.md` — independently-produced brownfield audit confirming the resource-service fragility and no-validation-library convention
- `.planning/phases/02-roles-permissions-staff-accounts/02-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/PROJECT.md` — locked decisions and requirement acceptance criteria
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` (grepped for "invite" this session) — confirms no more specific invite mechanics are specified than "create or invite"

### Secondary (MEDIUM confidence)
None used — no web/official-docs lookup was needed for this phase; it is entirely a codebase-internal design task with no new external library surface.

### Tertiary (LOW confidence)
- A1 (invite mechanics) and A2 (staff-account scope) in the Assumptions Log — training-knowledge inference from the absence of an email sender, not confirmed against any document this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all versions read directly from `package.json`
- Architecture: HIGH — every referenced file/line was read this session; the two genuinely new pieces (continuity check, versioning transaction) are grounded in verified schema shapes
- Pitfalls: HIGH — all 6 are derived from direct code-reading contradictions/gaps (e.g. Pitfall 1 and 3 are concrete, reproducible gaps in existing files), not speculation
- IAM-04 "invite" mechanics: LOW — flagged explicitly as Assumption A1 / Open Question 1, needs user confirmation before planning locks the staff-account-creation flow

**Research date:** 2026-09-02
**Valid until:** No expiry driver — this is a brownfield internal-mechanics research doc, not tied to a moving external API/library version. Re-research only if the underlying Phase 1 files (`with-permission.ts`, `resource-service.ts`, `schema.prisma`) change before Phase 2 planning executes.
