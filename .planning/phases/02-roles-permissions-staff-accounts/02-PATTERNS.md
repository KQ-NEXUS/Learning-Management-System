# Phase 2: Roles, Permissions & Staff Accounts - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 25 (services, service tests, pages, and new UI components)
**Analogs found:** 25 / 25 (all have at least a role-match; several are exact carry-overs of an existing pattern)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/services/role-service.ts` | service | CRUD (hand-written create/update/deactivate, factory-shaped list/get) | `src/server/services/course-service.ts` + `src/server/services/resource-service.ts` | role-match (factory unusable for update/archive, per RESEARCH Gap #2) |
| `src/server/services/assignment-service.ts` | service | CRUD (create + revoke only, no update — D-23) | `src/server/services/course-service.ts` (wiring shape) + `src/server/services/grant-service.ts` (query shape) | role-match |
| `src/server/services/continuity-service.ts` | service | CRUD (aggregate read query used as a pre-write guard) | `src/server/services/grant-service.ts` (closest existing Assignment-aggregation query) | partial-match (net-new logic, no existing analog does this) |
| `src/server/services/staff-account-service.ts` | service | CRUD + event-driven (deactivate triggers session revocation) | `src/server/services/course-service.ts` (wiring) + `src/server/services/auth-service.ts` (`signOutAllForUser` side-effect call) | role-match |
| `src/server/services/audit-service.ts` (extend) | service | event-driven (write-only audit sink) | itself — existing file, extend `BusinessAuditEvent`/`recordAudit` in place | exact (modifying existing file) |
| `src/server/services/scope-lookup-service.ts` | service | request-response (read-only id+title lookups) | `src/server/services/resource-service.ts`'s `list`/`get` (`withPermission`-wrapped read) | role-match |
| `tests/role-service.test.ts` | test | CRUD | `tests/course-service.test.ts` + `tests/resource-service.test.ts` | role-match |
| `tests/assignment-service.test.ts` | test | CRUD | `tests/resource-service.test.ts` | role-match |
| `tests/continuity-service.test.ts` | test | CRUD (aggregate/edge-case) | `tests/scope.test.ts` (pure-function edge-case style) | partial-match |
| `tests/staff-account-service.test.ts` | test | CRUD + event-driven | `tests/resource-service.test.ts` | role-match |
| `src/app/staff/roles/page.tsx` | route (server component) | request-response | `src/app/staff/courses/page.tsx` | exact |
| `src/app/staff/roles/new/page.tsx` | route (server component) | request-response | `src/app/staff/courses/page.tsx` (list-fetch pattern reused for clone-source lookup) | role-match |
| `src/app/staff/roles/[id]/page.tsx` | route (server component) | request-response | `src/app/staff/courses/[id]/page.tsx` | exact |
| `src/app/staff/roles/RolesTable.tsx` | component | request-response | `src/app/staff/courses/CoursesTable.tsx` | exact |
| `src/app/staff/roles/RoleForm.tsx` | component | request-response | `src/components/primitives/ResourceForm.tsx` (consumer pattern; no existing consumer file exists yet, so the primitive itself is the analog) | role-match |
| `src/app/staff/roles/PermissionPicker.tsx` | component | transform (renders catalogue → grouped checkbox tree) | `src/server/permissions/catalogue.ts` (data shape) + `src/components/primitives/ResourceForm.tsx`'s `FormField` (control-wiring pattern) | partial-match (net-new UI shape) |
| `src/app/staff/roles/EffectiveAccessPreview.tsx` | component | transform (pure client-side derivation, no fetch) | none existing — closest is `catalogue.ts` domain-grouping comments (data source only) | no analog (see below) |
| `src/app/staff/users/page.tsx` | route (server component) | request-response | `src/app/staff/courses/page.tsx` | exact |
| `src/app/staff/users/[id]/page.tsx` | route (server component) | request-response | `src/app/staff/courses/[id]/page.tsx` | exact |
| `src/app/staff/users/UsersTable.tsx` | component | request-response | `src/app/staff/courses/CoursesTable.tsx` | exact |
| `src/app/staff/users/StaffAccountForm.tsx` | component | request-response | `src/components/primitives/ResourceForm.tsx` (consumer pattern) | role-match |
| `src/app/staff/users/AssignmentDrawer.tsx` | component | request-response + streaming (typeahead) | `src/components/primitives/ResourceForm.tsx` (form/control conventions) — no existing typeahead/drawer analog | partial-match (net-new interaction shape) |
| `src/app/staff/audit/page.tsx` | route (server component) | request-response | `src/app/staff/courses/page.tsx` | role-match (adds filters) |
| `src/app/staff/audit/AuditTable.tsx` | component | request-response (expand-in-place) | `src/app/staff/courses/CoursesTable.tsx` (filter/sort/column conventions) — `ResourceTable` itself does not support expand-in-place, so this is a new sibling component built to the same visual contract | partial-match |
| `src/app/staff/layout.tsx` (modify `NAV`) | config | — | itself — existing file, add Roles/Users/Audit entries following the existing `Link`/disabled-`span` pattern | exact (modifying existing file) |

## Pattern Assignments

### `src/server/services/role-service.ts` / `assignment-service.ts` / `staff-account-service.ts` (service, CRUD)

**Analog:** `src/server/services/course-service.ts` (wiring shape) + `src/server/services/resource-service.ts` (why NOT to reuse `update`/`archive`)

**Imports pattern** (`course-service.ts` lines 10-14):
```typescript
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import { recordAudit } from "@/server/services/audit-service";
import { createResourceService, type Delegate } from "./resource-service";
```

**Scope-resolver pattern** (`course-service.ts` lines 18-21 — copy this shape for `roleScope`/`assignmentTargetScope`/`userScope`):
```typescript
export function courseScope(id: string): ResourceScope {
  return { courseIds: [id] };
}
```
For Role/User, use `() => ({})` (empty `ResourceScope`) — per RESEARCH Pattern 1, this naturally forces GLOBAL-only grants since `grantMatches` returns `false` for any non-GLOBAL grant against an empty resource. For Assignment, use RESEARCH's `assignmentTargetScope` (switches on `scopeType`).

**What NOT to copy — factory `update`/`archive` (`resource-service.ts` lines 94-137):**
```typescript
const archive = withPermission<{ id: string; reason: string }>(
  permissions.edit,
  (input) => toScope(input.id),
)(async (input, ctx) => {
  const before = await delegate.findUnique({ where: { id: input.id } });
  const after = await delegate.update({
    where: { id: input.id },
    data: { status: "ARCHIVED" },   // <-- hard-coded; Role/User/Assignment have no such field/value
  });
  ...
});
```
Role uses `active: Boolean`, User uses `status: UserStatus` (no `ARCHIVED` member), Assignment has no archive concept at all (revoke via `revokedAt`/`revokedById`). Hand-write `create`/`update`/`deactivate`/`reactivate`/`revoke` per-domain instead, keeping the same `withPermission → mutate → recordAudit` skeleton the factory demonstrates for `create` (lines 77-92, safe to copy as-is for the "read before/after, audit both" idiom).

**Reusable factory `list`/`get` shape** (`resource-service.ts` lines 68-75) — safe to reuse directly or mirror exactly for Role/User reads:
```typescript
const list = withPermission<{ where?: unknown; scope?: ResourceScope }>(
  permissions.view,
  (input) => input.scope ?? {},
)(async (input) => delegate.findMany({ where: input.where }));

const get = withPermission<string>(permissions.view, (id) => toScope(id))(
  async (id) => delegate.findUnique({ where: { id } }),
);
```

**Audit call pattern** (`course-service.ts` lines 33-43 — same shape, call `recordAudit` directly rather than through the factory's `audit` config option since hand-written methods don't go through `createResourceService`):
```typescript
await recordAudit({
  actorId: ctx.actor.userId,
  action: "role.updated",
  targetType: "Role",
  targetId: roleId,
  before,
  after,
  reason: reason ?? null,
  outcome: "SUCCESS",
});
```

**Session-revocation side effect** (`auth-service.ts` line 87, `signOutAllForUser`) — call this from `staff-account-service.ts`'s deactivate method, after the `User.status` transaction commits, per D-34:
```typescript
export async function signOutAllForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
```

**Error handling pattern:** No try/catch inside services — `withPermission` throws `AuthenticationError`/`AuthorizationError` for the caller (page/Server Action) to catch, exactly as `src/app/staff/courses/page.tsx` (lines 10-23) demonstrates. Domain errors (`InvalidPermissionSetError`, `ContinuityError`, `ScopeError`) are thrown as plain `Error` subclasses (see `scope.ts`'s `ScopeError`, lines 18-23, as the exact class shape to copy for any new error type).

---

### `src/server/services/continuity-service.ts` (service, CRUD aggregate guard)

**Analog:** `src/server/services/grant-service.ts` (closest existing Assignment-aggregation query; RESEARCH Pattern 4 gives the concrete query to write — no existing file does this exact check)

**Query-shape pattern to mirror** (`grant-service.ts` lines 18-33 — same `prisma.assignment.findMany`/`count` style, same `role: { active: true }` join idiom):
```typescript
const assignments = await prisma.assignment.findMany({
  where: {
    userId,
    role: { active: true },
  },
  select: { scopeType: true, scopeId: true, active: true, revokedAt: true, startsAt: true, endsAt: true, role: { select: { permissions: true } } },
});
```
Adapt to a `count()` with `scopeType: "GLOBAL"`, `role: { permissions: { has: "roles.manage" } }`, and — critically, per RESEARCH Pitfall 1 — an explicit `user: { status: "ACTIVE" }` clause that `grant-service.ts` does not need (it relies on the session boundary filtering that for the *current* actor; a continuity check queries *other* users and has no such boundary).

**Error class pattern** (`scope.ts` lines 18-23, `ScopeError`) — copy this exact shape for `ContinuityError`:
```typescript
export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}
```

---

### `src/server/services/audit-service.ts` (extend existing file)

**Analog:** itself (`src/server/services/audit-service.ts`, full file, 54 lines)

**Current signature to extend** (lines 13-24):
```typescript
export type BusinessAuditEvent = {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  outcome: string;
  correlationId?: string | null;
  ipAddress?: string | null;
};
```
Add `scopeType?: string | null` and `scopeId?: string | null`, and thread them into the `prisma.auditEvent.create({ data: {...} })` call (lines 27-40) the same way every other field is passed — per RESEARCH Pitfall 3, the `AuditEvent` model already has these columns; this is a code-only change, no migration.

---

### `tests/role-service.test.ts` / `assignment-service.test.ts` / `staff-account-service.test.ts` / `continuity-service.test.ts` (test)

**Analog:** `tests/course-service.test.ts` (pure-function unit style) and `tests/resource-service.test.ts` (mock-`Delegate`/mock-`withPermission` harness — read this session per RESEARCH, mirror its "mock `Delegate<T>`, `createWithPermission` with fixed grants, assert on captured audit entries" approach)

**Verified existing test shape** (`tests/course-service.test.ts`, full file):
```typescript
import { describe, expect, it } from "vitest";
import { courseScope } from "@/server/services/course-service";

describe("courseScope", () => {
  it("maps a course id to a course-scoped resource", () => {
    expect(courseScope("course-1")).toEqual({ courseIds: ["course-1"] });
  });
});
```
Copy this file's structure directly for `roleScope`/`assignmentTargetScope`/`userScope` unit tests (pure scope-mapping assertions), then add heavier integration-style tests (mocked Prisma delegate + `createWithPermission`) modeled on `tests/resource-service.test.ts` for the transactional/audit/continuity behaviors.

---

### `src/app/staff/roles/page.tsx`, `src/app/staff/users/page.tsx`, `src/app/staff/audit/page.tsx` (route, request-response)

**Analog:** `src/app/staff/courses/page.tsx` (full file, 26 lines)

**Full pattern to copy verbatim (list page: fetch → catch denial/auth errors → render table component):**
```typescript
import { courseService } from "@/server/services/course-service";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { CoursesTable, type CourseRow } from "./CoursesTable";

export const metadata = { title: "Courses" };

export default async function CoursesPage() {
  let courses: CourseRow[];
  try {
    courses = (await courseService.list({})) as unknown as CourseRow[];
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      return <CoursesTable denied={{ permission: "courses.view" }} />;
    }
    throw error;
  }
  return <CoursesTable rows={courses} />;
}
```
Replace `courseService`/`CoursesTable`/`"courses.view"` with `roleService`/`RolesTable`/`"roles.view"`, `staffAccountService`/`UsersTable`/`"users.view"`, or an audit-read function/`AuditTable`/`"audit.view"` respectively. `/staff/audit/page.tsx` additionally needs actor/date-range/action-type filter params (server-side, since D-31 filters are query-driven) — no existing analog has query-param filters server-side yet; extend this pattern, don't invent a new one.

---

### `src/app/staff/roles/[id]/page.tsx`, `src/app/staff/users/[id]/page.tsx` (route, request-response)

**Analog:** `src/app/staff/courses/[id]/page.tsx` (full file, 106 lines)

**Detail-page pattern to copy (fetch by id → notFound on both `null` and `AuthorizationError` → `DetailLayout` with breadcrumbs/badges/sections):**
```typescript
export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let course: Course | null;
  try {
    course = (await courseService.get(id)) as unknown as Course | null;
  } catch (error) {
    if (error instanceof AuthorizationError) {
      notFound(); // Same response as "not found" — a denial must not confirm existence.
    }
    throw error;
  }
  if (!course) notFound();

  return (
    <DetailLayout
      breadcrumbs={[{ label: "Workspace", href: "/staff/courses" }, { label: "Courses", href: "/staff/courses" }, { label: course.title }]}
      title={course.title}
      identifier={course.slug}
      badges={<StatusPill label={course.status} tone={TONE[course.status] ?? "neutral"} />}
      sections={[{ id: "overview", label: "Overview", content: <DetailFacts facts={[...]} /> }, ...]}
    />
  );
}
```
For `roles/[id]/page.tsx`: sections are `Overview` (DetailFacts: name, active, isDefault, version, assignment count), `Permissions` (embeds `RoleForm`/`PermissionPicker` inline per UI-SPEC — Permissions tab IS the edit form, not a separate read view), `History` (RoleVersion list, D-06). For `users/[id]/page.tsx`: `Overview` + `Assignments` (D-19 independently-revocable row list, empty-state reachable at zero per UI-SPEC).

---

### `src/app/staff/roles/RolesTable.tsx`, `src/app/staff/users/UsersTable.tsx` (component, request-response)

**Analog:** `src/app/staff/courses/CoursesTable.tsx` (full file, 197 lines)

**Full client-side filter/sort/state-derivation pattern to copy:**
```typescript
"use client";
import { useMemo, useState } from "react";
import { ResourceTable, StatusPill, type Column, type SortState } from "@/components/primitives";

const columns: Column<CourseRow>[] = [
  { key: "title", header: "Title", render: (c) => c.title, subtitle: (c) => c.summary ?? "—", width: "40%", sortable: true },
  { key: "status", header: "Status", render: (c) => <StatusPill label={c.status} tone={TONE[c.status] ?? "neutral"} />, width: "14%" },
];

export function CoursesTable({ rows, denied }: { rows?: CourseRow[]; denied?: { permission: string } }) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => { /* filter + sort */ }, [rows, search, ...]);
  const state = denied
    ? ({ status: "denied", permission: denied.permission } as const)
    : visible.length > 0
      ? ({ status: "ready", rows: visible } as const)
      : ({ status: "empty", activeFilterCount, totalWithoutFilters: rows?.length } as const);

  return <ResourceTable<CourseRow> noun="courses" title="Courses" columns={columns} state={state} getRowKey={(c) => c.id} getRowHref={(c) => `/staff/courses/${c.id}`} ... />;
}
```
`RolesTable` diverges only in: (a) a pinning step before the `useMemo` sort — defaults first (D-38), then alphabetical within each group; (b) a `StatusPill tone="accent"` "Default" badge column (D-37), mirroring this file's own `certificateEnabled` → `StatusPill tone="accent"` precedent (line 47 uses plain text, but the UI-SPEC explicitly cites "the existing 'Certificate enabled' badge precedent" for the Default badge — use `StatusPill` there, not plain text). `UsersTable` diverges only in its `TONE` map: `ACTIVE`→`success`, `DEACTIVATED`→`warning`, `PENDING_VERIFICATION`→`neutral` (UI-SPEC Color section).

---

### `src/app/staff/roles/RoleForm.tsx`, `src/app/staff/users/StaffAccountForm.tsx` (component, request-response)

**Analog:** `src/components/primitives/ResourceForm.tsx` (the primitive itself — no existing consumer file exists in this codebase yet, since Courses has no create/edit form built; this primitive's own doc-comment and `FormField`/`TextInput` exports are the pattern to compose against)

**Composition pattern** (`ResourceForm.tsx` lines 44-56, 184-267 — `FormField` render-prop + `TextInput`):
```typescript
<ResourceForm title="Edit role" errors={errors} pending={pending} onSubmit={handleSubmit} submitLabel="Save role">
  <FormField name="name" label="Name" required>
    {(props) => <TextInput {...props} defaultValue={role.name} />}
  </FormField>
  {/* ...PermissionPicker embedded as a child, EffectiveAccessPreview alongside */}
</ResourceForm>
```
`StaffAccountForm` composes the same way but must submit account-creation + first-assignment as one `FormData` payload to one Server Action per D-22/UI-SPEC's "one atomic transaction" requirement — no existing form here demonstrates multi-entity submission; this is new composition of an existing primitive, not a new primitive.

---

### `src/app/staff/roles/PermissionPicker.tsx`, `src/app/staff/roles/EffectiveAccessPreview.tsx` (component, transform)

**Analog:** `src/server/permissions/catalogue.ts` (data source — the domain-grouping comment structure, lines 12-81) + `src/components/primitives/ResourceForm.tsx`'s `FormField` control-wiring convention

**Data source to group by (verbatim domain comments from `catalogue.ts`):**
```typescript
// Users — PRD §17.2
"users.view", "users.manage",
// Roles — PRD §17.2. roles.manage is subject to the continuity safeguard in RBAC-07.
"roles.view", "roles.manage",
// ...12 more domains through Licence
```
`PermissionPicker` must group its 14 collapsible sections by these exact comment boundaries (D-01). `isGlobalOnly()` (catalogue.ts line 105) drives the visible-but-disabled + `title="Global scope only"` tooltip for `licence.*` (D-03), reusing the `title` attribute mechanism already established at `src/app/staff/layout.tsx` line 57 (`title="Not built yet"` on disabled nav items) — this is the codebase's only existing tooltip precedent, per UI-SPEC.

`EffectiveAccessPreview` has no existing UI analog (net-new derivation component) — build it as plain markup per UI-SPEC's own note ("plain markup, no primitive dependency"), deriving grouped verb summaries client-side from the same `catalogue.ts` groupings, no server round-trip.

---

### `src/app/staff/users/AssignmentDrawer.tsx` (component, request-response + streaming)

**Analog:** `src/components/primitives/ResourceForm.tsx` (field/error/pending conventions) — no existing typeahead or slide-over drawer analog in the codebase; this is genuinely new UI shape, built by composing existing form control conventions (`FormField`, `TextInput`, `aria-invalid` styling) inside a new panel container, not a `ResourceForm` instance itself (per UI-SPEC: "likely a slide-over panel, not a full page").

Server-side, the typeahead search action follows the `withPermission`-wrapped read pattern from `scope-lookup-service.ts`/factory `get` (see Pattern 1 above), gated on `users.view` (search) and `roles.manage` (scope-target lookup, per D-41).

---

### `src/app/staff/audit/AuditTable.tsx` (component, request-response, expand-in-place)

**Analog:** `src/app/staff/courses/CoursesTable.tsx` (filter bar, column, sort, empty/loading/error conventions) — `ResourceTable` itself does not support expand-in-place rows (verified, UI-SPEC explicitly notes this), so `AuditTable` is a new sibling component that borrows `CoursesTable`'s filter-state (`useState` + `useMemo`) and `ResourceTable`'s visual skeleton/empty/error panels (copy those literal className blocks from `ResourceTable.tsx`, not re-derive them) while adding its own row-click-to-expand state (`useState<string | null>` for the single-expanded-row id, accordion-style per UI-SPEC).

---

### `src/app/staff/layout.tsx` (modify)

**Analog:** itself (existing file, lines 17-24 `NAV` array + lines 44-63 render loop)

**Exact pattern to extend:**
```typescript
const NAV = [
  { label: "Cohorts", href: null },
  { label: "Courses", href: "/staff/courses" },
  { label: "Enrolments", href: null },
  { label: "Assessment", href: null },
  { label: "Certificates", href: null },
  { label: "Support", href: null },
] as const;
```
Add `{ label: "Roles", href: "/staff/roles" }`, `{ label: "Users", href: "/staff/users" }`, `{ label: "Audit", href: "/staff/audit" }` as new linked entries (none exist even as disabled placeholders today — UI-SPEC confirms this explicitly). The render loop (lines 44-63) needs no changes — it already branches on `item.href` being non-null vs `null`.

---

## Shared Patterns

### Authorization choke point
**Source:** `src/server/permissions/with-permission.ts` (`withPermission`, `createWithPermission`)
**Apply to:** every new service function in `role-service.ts`, `assignment-service.ts`, `continuity-service.ts` (indirectly, called from within an already-wrapped handler), `staff-account-service.ts`, `scope-lookup-service.ts`
```typescript
export const deactivateStaffAccount = withPermission<{ userId: string; reason: string }>(
  "users.manage",
  () => ({}),
)(async ({ userId, reason }, ctx) => { /* ... */ });
```

### Audit-first write path
**Source:** `src/server/services/audit-service.ts` (`recordAudit`)
**Apply to:** every mutating method in the four new services — call `recordAudit` after every transaction commits, never in place of `RoleVersion` (which serves the History tab, a separate concern per RESEARCH Pattern 3).

### Reason-gated confirmation
**Source:** `src/components/primitives/ConfirmModal.tsx`
**Apply to:** `RoleForm` (permission removal, D-09; role deactivation, D-11), `AssignmentDrawer`/user detail page (revoke, D-14), `StaffAccountForm`/user detail page (deactivate, D-33) — all use `minReasonLength={10}` per D-13, `tone="danger"` for all four, `tone="default"` for reactivation (no `minReasonLength`).

### Tabbed/stacked record layout
**Source:** `src/components/primitives/DetailLayout.tsx`
**Apply to:** `roles/[id]/page.tsx` (Overview/Permissions/History), `users/[id]/page.tsx` (Overview/Assignments) — reuse `DetailFacts` for the Overview tab facts grid in both.

### List/table primitive
**Source:** `src/components/primitives/ResourceTable.tsx` (via `CoursesTable.tsx`'s consumption pattern)
**Apply to:** `RolesTable`, `UsersTable` directly; `AuditTable` borrows its visual/empty/loading/error conventions but cannot use the component itself (no expand-in-place support).

### Scope resolution
**Source:** `src/server/permissions/scope.ts` (`ResourceScope`, `grantMatches`, `assertScopeAllowed`)
**Apply to:** every new service's scope resolver; `assertScopeAllowed` specifically gates `assignment-service.create` against the `licence.*` GLOBAL_ONLY_PERMISSIONS rule (D-03/D-18).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/server/services/continuity-service.ts` | service | CRUD (aggregate guard) | No existing code performs a cross-user aggregate authorization guard; RESEARCH Pattern 4 provides the concrete query to write from scratch, grounded in `grant-service.ts`'s query idioms. |
| `src/app/staff/roles/EffectiveAccessPreview.tsx` | component | transform | No existing pure-client-derivation display component exists; build fresh per UI-SPEC's own "plain markup, no primitive dependency" guidance. |
| `src/app/staff/users/AssignmentDrawer.tsx` | component | request-response + streaming (typeahead) | No existing typeahead or slide-over/drawer UI exists in the codebase; compose from `FormField`/`TextInput` conventions, not a pre-built pattern. |
| `src/app/staff/audit/AuditTable.tsx` | component | request-response (expand-in-place) | `ResourceTable` explicitly lacks expand-in-place row support; UI-SPEC confirms this is a new sibling component modeled on, not built from, the existing table primitive. |

## Metadata

**Analog search scope:** `src/server/services/**`, `src/server/permissions/**`, `src/app/staff/**`, `src/components/primitives/**`, `tests/**`
**Files scanned:** 16 read in full this session (course-service.ts, resource-service.ts, audit-service.ts, grant-service.ts, auth-service.ts, catalogue.ts, scope.ts, with-permission.ts, ConfirmModal.tsx, DetailLayout.tsx, ResourceForm.tsx, index.ts, CoursesTable.tsx, courses/page.tsx, courses/[id]/page.tsx, staff/layout.tsx, course-service.test.ts)
**Pattern extraction date:** 2026-09-02
