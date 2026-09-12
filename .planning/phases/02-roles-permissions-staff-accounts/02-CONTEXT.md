# Phase 2: Roles, Permissions & Staff Accounts - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Administrators can define who can do what, where, without touching code, and every access-control change is attributable. Concretely: a role editor over the closed 36-identifier permission catalogue (with versioning and a continuity safeguard), an assignment flow binding user × role × scope, staff account lifecycle (create/invite/deactivate/reactivate), and an audit view over all of it. The underlying grant/scope matching mechanism (`withPermission`, `grantMatches`) is already proven in Phase 1 — this phase is the admin-facing UI and service layer around it, not the authorization engine itself.

</domain>

<decisions>
## Implementation Decisions

### Role editor & permission picker
- **D-01:** Permissions grouped by domain in collapsible sections (14 groups: Users, Roles, Programmes, Courses, Cohorts, Enrolments, Attendance, Payments, Assessment, Certificates, Support, Reporting, Audit, Licence), matching the comment structure already in `src/server/permissions/catalogue.ts`.
- **D-02:** New custom roles can be started as a clone of a seeded default role (Administrator/Programme Manager/Instructor/Finance-Operations/Learner) as well as from a blank slate.
- **D-03:** `licence.view`/`licence.activate` (the two `GLOBAL_ONLY_PERMISSIONS`) show visible-but-disabled with a tooltip explaining "global scope only" whenever the role/assignment being edited isn't global scope — never hidden.
- **D-04:** A live, plain-language "effective access" summary panel updates as permissions are toggled (e.g. "Can view and edit Courses; cannot manage Payments") — matches PXR §7's "effective-access preview" intent.
- **D-05:** Editing one of the 5 seeded default roles directly (not via clone) requires an extra confirmation step naming how many active assignments currently use it, before the save proceeds.
- **D-06:** Role version history (RoleVersion, RBAC-02) is exposed via a History tab on the role detail page, listing each version with what changed and its reason — reuses the `DetailLayout` tab pattern already established on Courses.
- **D-07:** Deactivating a role (`Role.active = false`) immediately makes every one of its active `Assignment` rows a non-grant (deny-by-default, no separate per-assignment revoke needed) — **Reversibility:** costly — reactivating the role does not retroactively restore the assignments' effective status without additional logic, since "deactivated role → assignments become inactive grants" is a one-directional service-layer rule, not a stored per-assignment flag. Before confirming, the UI shows how many active assignments will be affected.
- **D-08:** Role renaming is allowed at any time (`Role.name` stays `@unique`-enforced); existing `Assignment` rows are unaffected since they reference `roleId`, not name.

### Sensitive-edit reason threshold
- **D-09:** Removing **any** permission from a role's set requires a mandatory reason (not just mutation-capable ones — simplest rule, errs toward more audit trail).
- **D-10:** Adding/expanding a role's permissions never requires a reason — the reason gate applies only to reductions, matching the roadmap's literal "reason for sensitive reductions" wording.
- **D-11:** Deactivating a role requires a mandatory reason (it's an integrity action per D-07's blast radius); renaming a role does not.
- **D-12:** Reuse the existing `ConfirmModal` component (`src/components/primitives/ConfirmModal.tsx`) and its `minReasonLength`/touched/validation pattern for every reason-gated confirmation in this phase, rather than building new reason-capture UI.
- **D-13:** `minReasonLength` for role-edit and assignment-revoke reasons is **10 characters**.
- **D-14:** Revoking an `Assignment` becomes mandatory-reason this phase — the `Assignment.reason` field is already nullable in the schema, so this is a service/UI validation change only, no migration. — **Reversibility:** reversible — purely an application-layer validation rule, no schema change.
- **D-15:** Removing multiple permissions from a role in one save requires only **one shared reason** for the whole edit, not one per removed permission — the before/after permission diff itself stays fully captured in the audit event regardless.
- **D-16:** Reason text on role/assignment audit events is visible to anyone holding `audit.view` — no additional restriction layered on top.

### Assignment drawer flow
- **D-17:** Target user is found via search-as-you-type by name/email (typeahead), not a plain list picker.
- **D-18:** The scope picker is built for all four scope types (Global/Programme/Course/Cohort) now, querying the real Prisma models. Programme and Cohort pickers will simply show a "none yet" empty state until Phases 4/5 (Track B, running in parallel) seed real records — avoids rebuilding the picker later. — **Reversibility:** reversible — no rework needed when Track B lands, since the picker already queries live tables.
- **D-19:** A user's assignments render as a list of independently-revocable rows on their detail page (reuses the `DetailLayout` section pattern), reflecting RBAC-04's "union of active grants" model directly rather than inventing a "primary role" concept the schema doesn't have.
- **D-20:** Assignments are immediate-start only this phase (`Assignment.startsAt` defaults to "now"); an optional end date (`endsAt`) is supported, but scheduling a *future* start date is deferred.
- **D-21:** One scope target per assignment action — granting the same role across multiple Courses means repeating the action, not a multi-select batch-create.
- **D-22:** Creating a staff account (IAM-04) and assigning its first role happen in **one combined flow** — avoids leaving a newly created account with zero access.
- **D-23:** Assignments are immutable once created — changing scope or end-date is always revoke-old + create-new, matching the schema's `revokedAt`/`revokedById` shape and keeping the audit trail unambiguous. — **Reversibility:** costly — switching later to in-place edits would require reconciling any assignments already created under the revoke-and-recreate convention.

### Continuity safeguard (RBAC-07)
- **D-24:** The zero-administrator check runs before all four of: (a) revoking an assignment that grants `roles.manage`, (b) removing `roles.manage` from a role's permission set, (c) deactivating a role that grants `roles.manage`, (d) deactivating the last user account holding it.
- **D-25:** The safeguard counts only **GLOBAL-scope** `roles.manage` grants — a Programme/Course/Cohort-scoped `roles.manage` holder can't manage roles outside that scope anyway, so it doesn't protect against the "system has no administrator" risk the requirement targets. — **Reversibility:** one-way — once services/tests are built against "global-only counts," broadening to any-scope counting later means redesigning the check's query shape and re-auditing every trigger point in D-24, not a config flip.
- **D-26:** The block message states the constraint plainly ("This change would leave no user with role-management access...") without naming other active administrators, to avoid leaking admin identities in an error message.
- **D-27:** No proactive "N active administrators" indicator this phase — the safeguard is surfaced reactively, only when a blocking action is attempted.
- **D-28:** No permanent "break-glass" admin account — the safeguard is purely dynamic, based on whoever currently holds an active global `roles.manage` grant.

### Audit view (RBAC-08)
- **D-29:** The audit log lives on a dedicated `/staff/audit` page (not only per-record History tabs).
- **D-30:** The page shows the full `AuditEvent` table across every resource type from day one, not just Phase 2's role/assignment/staff-account events — `AuditEvent` is already a shared table Phase 1's resource-service factory writes to (Course create/edit/archive already produce rows), so scoping the view down now would mean rework once later phases add more audited resources. — **Reversibility:** reversible — a resource-type filter narrows the same underlying query; nothing about this choice blocks scoping down later.
- **D-31:** V1 filters: actor, date range, action/event type. Filtering to one target record is reached via that record's own History tab (D-06/D-19 pattern) rather than a top-level filter.
- **D-32:** Each row is a compact `ResourceTable`-style line (actor, action, target, time) that expands in place to show the full before/after diff and reason — keeps the list scannable despite variable diff shapes across action types.

### Deactivate/reactivate staff account (IAM-04)
- **D-33:** Deactivating a staff `User` account requires a mandatory reason via `ConfirmModal`, consistent with D-11/D-14.
- **D-34:** Deactivation immediately signs out all of the user's active sessions, calling the existing `signOutAllForUser` (already built in Phase 1) — access is revoked the moment the account is deactivated, not whenever a session cookie happens to expire (up to 7 days later per `SESSION_TTL_DAYS`).
- **D-35:** A deactivated user's existing `Assignment` rows are left untouched — no per-assignment revoke events. Deny-by-default already denies a deactivated account regardless of its assignments (matches Phase 1's `withPermission` pattern), so this avoids audit noise from mass-revoking assignments that were never actually the problem.
- **D-36:** Reactivation is a pure account-status flip — since assignments were never revoked (D-35), the account automatically regains exactly the access it had before deactivation, with no manual re-assignment step. — **Reversibility:** one-way — this decision and D-35 are coupled; switching later to "reactivation requires re-assignment" would need D-35 to change first (assignments would have to actually be revoked on deactivation for that model to make sense).

### Default-role visibility (RBAC-01)
- **D-37:** The 5 seeded default roles show a "Default" badge in the roles list, distinguishing them from custom (including cloned-from-default, per D-02) roles.
- **D-38:** Default roles are pinned at the top of the roles list, above custom roles.
- **D-39:** Default roles follow the same renaming rule as any role (D-08) — no exemption. Renaming one is still "editing a default role directly," so D-05's extra confirmation (naming affected active assignments) still applies.

### Staff-account invite mechanics (IAM-04) & scope-lookup permission
*(Resolved 2026-09-02, after research surfaced these as open questions — see `02-RESEARCH.md`.)*
- **D-40:** "Inviting" a staff account means the admin sets/generates a temporary password directly at creation time (shown once), relayed to the new hire out-of-band (Slack, verbally, etc.). No email-link flow. Phase 13 (Transactional Communications, ~11 phases away) is where real email-based invites eventually get added on top of this — this decision doesn't need to be revisited then, just extended. — **Reversibility:** reversible — Phase 13 can add an invite email atop the same account-creation contract without changing this phase's data model.
- **D-41:** The assignment drawer's Programme/Cohort scope-target lookup (D-18) requires only `roles.manage` — not `programmes.view`/`cohorts.view` as well. Picking a scope target for a new assignment is not the same as viewing that record's content, and the picker shows minimal fields (name/id) only.

### Claude's Discretion
None remaining — all previously-open gray areas (audit view, deactivate/reactivate UX, default-role visibility, invite mechanics, scope-lookup permission) are resolved (see above).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product authority
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` §17.2 — permission catalogue domains; §7.1 — default-role editability; §15.3 / §1.3 — decision/approval gates referenced during discussion
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` §7, §8 — administration screen spec: role editor, sensitive-permission warning, effective-access preview, integrity-action confirmation pattern (source of D-04, D-05, D-09..D-16)

### Requirements
- `.planning/REQUIREMENTS.md` — RBAC-01, RBAC-02, RBAC-03, RBAC-04, RBAC-07, RBAC-08, IAM-04 (full acceptance criteria)
- `.planning/PROJECT.md` — Key Decisions table (no-Auth.js, Next.js 16.3.4, two-track parallel development) — background, not re-decided here

### Existing code (source of truth for D-01 through D-28)
- `src/server/permissions/catalogue.ts` — the 36-identifier `PERMISSIONS` tuple, `GLOBAL_ONLY_PERMISSIONS`, domain grouping (D-01, D-03)
- `prisma/schema.prisma` — `Role` (lines ~318-341: `version`, `isDefault`, `permissions: String[]`), `RoleVersion`, `Assignment` (lines ~363-385: `scopeType`, `scopeId`, `startsAt`/`endsAt`, `reason`, `revokedAt`/`revokedById`), `User` (lines ~202-222) — grounds D-02, D-05 through D-08, D-14, D-18 through D-23
- `src/components/primitives/ConfirmModal.tsx` — reason/`minReasonLength`/touched validation pattern to reuse (D-12, D-13)
- `src/components/primitives/DetailLayout.tsx` — tab/section pattern to reuse for role version history and per-user assignment lists (D-06, D-19)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md` — Phase 1 authorization mechanism and known gaps (no request-scoped grant cache, noted as a Phase-1-inherited concern, not this phase's problem to solve)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfirmModal` (`src/components/primitives/ConfirmModal.tsx`): reason-gated confirmation with `minReasonLength`, touched/validation state — reused for every sensitive edit in this phase (role permission removal, role deactivation, assignment revoke, staff-account deactivation).
- `signOutAllForUser` (`src/server/services/auth-service.ts`, built in Phase 1): global session revocation — called on staff-account deactivation (D-34).
- `AuditEvent` model (`prisma/schema.prisma`): already written to by Phase 1's resource-service factory — the `/staff/audit` page (D-29/D-30) reads this table directly, no new audit-storage mechanism needed.
- `DetailLayout` (`src/components/primitives/DetailLayout.tsx`): tab/section/breadcrumb pattern already proven on the Courses detail page — reused for role version history and per-user assignment lists.
- `ResourceTable`/`ResourceForm` (`src/components/primitives/`): list/CRUD primitives already proven on Courses — the natural base for the roles list and role edit form.
- Resource-service factory (`src/server/services/resource-service.ts`) and `withPermission` (`src/server/permissions/with-permission.ts`): the authorization/audit choke point this phase's role/assignment/staff-account services build on, per Phase 1.

### Established Patterns
- Deny-by-default, server-enforced authorization (RBAC-06, already proven) — every new service in this phase must go through the same `withPermission` pattern, not a new one.
- No hard deletes — archive/deactivate only (`Role.active`, `User.deactivatedAt`), consistent with D-07's deactivation-not-deletion model.
- Audit-first write path (`AuditEvent`) — every sensitive action in this phase (role edit, deactivate, assignment create/revoke, staff account lifecycle) writes an audit event with actor/target/before-after/reason/time, per RBAC-08.

### Integration Points
- Role/assignment services sit alongside `course-service.ts` in `src/server/services/`, following its documented role as "the template to copy" (delegate + permissions + scope, no authorization logic of its own).
- The assignment scope picker queries `Programme`/`Course`/`Cohort` tables directly (D-18) — Course has real seeded data today; Programme/Cohort tables exist in the schema but are empty until Phases 4/5 (Track B) land.

</code_context>

<specifics>
## Specific Ideas

- "Effective access" preview panel should read as plain language ("Can view and edit Courses; cannot manage Payments"), not a raw permission-string dump (D-04).
- Block messages for the continuity safeguard should be blunt about the rule but not name other admins (D-26).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 2's scope. (The three items under "Claude's Discretion" above are in-scope requirements the user chose not to personally decide, not out-of-scope ideas — they are the planner's/executor's call, not deferred to a future phase.)

</deferred>

---

*Phase: 2-Roles, Permissions & Staff Accounts*
*Context gathered: 2026-09-02*
