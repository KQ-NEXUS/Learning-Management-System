---
status: complete
phase: 02-roles-permissions-staff-accounts
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md]
started: 2026-09-02T09:20:00Z
updated: 2026-09-02T10:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Server-side permission-set validation rejects unknown and duplicate identifiers, accepts an empty set
expected: Server-side permission-set validation rejects unknown and duplicate identifiers, accepts an empty set
result: pass
source: automated
coverage_id: D1

### 2. roleScope() is an empty resource, reachable only by a GLOBAL grant; create refuses a Course-scoped roles.manage grant
expected: roleScope() is an empty resource, reachable only by a GLOBAL grant; create refuses a Course-scoped roles.manage grant
result: pass
source: automated
coverage_id: D2

### 3. Creating a role writes one Role row, one version-1 RoleVersion row, and exactly one role.created audit event
expected: Creating a role writes one Role row, one version-1 RoleVersion row, and exactly one role.created audit event
result: pass
source: automated
coverage_id: D3

### 4. PERMISSION_GROUPS covers all 36 catalogue permissions exactly once across 14 groups, in both directions
expected: PERMISSION_GROUPS covers all 36 catalogue permissions exactly once across 14 groups, in both directions
result: pass
source: automated
coverage_id: D4

### 5. assertRoleManagementContinuity blocks any change that would leave zero active GLOBAL roles.manage holders, counting only GLOBAL-scope grants and only ACTIVE users
expected: assertRoleManagementContinuity blocks any change that would leave zero active GLOBAL roles.manage holders, counting only GLOBAL-scope grants and only ACTIVE users
result: pass
source: automated
coverage_id: D1

### 6. The continuity block message is a fixed constant that never identifies another administrator
expected: The continuity block message is a fixed constant that never identifies another administrator
result: pass
source: automated
coverage_id: D2

### 7. AuditEvent rows can now carry scopeType/scopeId, and credential-shaped fields are redacted before any row is written
expected: AuditEvent rows can now carry scopeType/scopeId, and credential-shaped fields are redacted before any row is written
result: pass
source: automated
coverage_id: D3

### 8. The audit trail is append-only across the entire src tree — no update/delete/upsert against the audit model exists anywhere, and exactly one file creates rows
expected: The audit trail is append-only across the entire src tree — no update/delete/upsert against the audit model exists anywhere, and exactly one file creates rows
result: pass
source: automated
coverage_id: D4

### 9. Editing a role always appends a new RoleVersion row (including a no-op resubmission) and never rewrites a prior one
expected: Editing a role always appends a new RoleVersion row (including a no-op resubmission) and never rewrites a prior one
result: pass
source: automated
coverage_id: D1

### 10. A stale expectedVersion is rejected with RoleVersionConflictError and performs no write
expected: A stale expectedVersion is rejected with RoleVersionConflictError and performs no write
result: pass
source: automated
coverage_id: D2

### 11. Removing a permission demands a >=10-character reason; adding one demands none; several removals in one save need only one shared reason
expected: Removing a permission demands a >=10-character reason; adding one demands none; several removals in one save need only one shared reason
result: pass
source: automated
coverage_id: D3

### 12. Removing roles.manage or deactivating a roles.manage-bearing role is blocked by the continuity guard when zero other holders would remain
expected: Removing roles.manage or deactivating a roles.manage-bearing role is blocked by the continuity guard when zero other holders would remain
result: pass
source: automated
coverage_id: D4

### 13. A seeded default role passes through identical gates to a custom role — no exemption
expected: A seeded default role passes through identical gates to a custom role — no exemption
result: pass
source: automated
coverage_id: D5

### 14. A user can hold several concurrent assignments; revoking one leaves the others byte-identical
expected: A user can hold several concurrent assignments; revoking one leaves the others byte-identical
result: pass
source: automated
coverage_id: D1

### 15. A role bundling a global-only permission cannot be assigned below global scope; the caller's own grant must reach the assignment's target scope
expected: A role bundling a global-only permission cannot be assigned below global scope; the caller's own grant must reach the assignment's target scope
result: pass
source: automated
coverage_id: D2

### 16. Revoking a GLOBAL roles.manage assignment is blocked by the continuity guard when zero other holders would remain; a COURSE-scoped assignment of the same role never triggers the check
expected: Revoking a GLOBAL roles.manage assignment is blocked by the continuity guard when zero other holders would remain; a COURSE-scoped assignment of the same role never triggers the check
result: pass
source: automated
coverage_id: D3

### 17. Both assignment audit events (create, revoke) carry the assignment's real scopeType/scopeId, never blank
expected: Both assignment audit events (create, revoke) carry the assignment's real scopeType/scopeId, never blank
result: pass
source: automated
coverage_id: D4

### 18. The scope-target lookup is gated on roles.manage alone, projects exactly three fields, and returns an honest empty result for Programme/Cohort
expected: The scope-target lookup is gated on roles.manage alone, projects exactly three fields, and returns an honest empty result for Programme/Cohort
result: pass
source: automated
coverage_id: D5

### 19. The audit read path is gated on audit.view with an empty (GLOBAL-only) scope resolver and exposes no mutation
expected: The audit read path is gated on audit.view with an empty (GLOBAL-only) scope resolver and exposes no mutation
result: pass
source: automated
coverage_id: D1

### 20. buildAuditWhere correctly constructs actor/date-range/action filter clauses, omitting absent filters entirely
expected: buildAuditWhere correctly constructs actor/date-range/action filter clauses, omitting absent filters entirely
result: pass
source: automated
coverage_id: D2

### 21. Returned audit rows carry scopeType/scopeId, proving the view surfaces the scope Plan 02 started recording
expected: Returned audit rows carry scopeType/scopeId, proving the view surfaces the scope Plan 02 started recording
result: pass
source: automated
coverage_id: D3

### 22. Account creation and its first role assignment are one atomic transaction; a failure (duplicate email) leaves zero assignment writes
expected: Account creation and its first role assignment are one atomic transaction; a failure (duplicate email) leaves zero assignment writes
result: pass
source: automated
coverage_id: D1

### 23. The temporary password is returned exactly once and never appears in any audit entry, including after the real redaction sink processes it
expected: The temporary password is returned exactly once and never appears in any audit entry, including after the real redaction sink processes it
result: pass
source: automated
coverage_id: D2

### 24. Deactivation demands a >=10-character reason, sweeps every active session after the write commits, and is blocked by the continuity guard fired unconditionally
expected: Deactivation demands a >=10-character reason, sweeps every active session after the write commits, and is blocked by the continuity guard fired unconditionally
result: pass
source: automated
coverage_id: D3

### 25. Deactivation and reactivation touch zero Assignment rows; reactivation is a pure status flip requiring no reason
expected: Deactivation and reactivation touch zero Assignment rows; reactivation is a pure status flip requiring no reason
result: pass
source: automated
coverage_id: D4

### 26. The raw User row's passwordHash never survives into what the real audit sink persists
expected: The raw User row's passwordHash never survives into what the real audit sink persists
result: pass
source: automated
coverage_id: D5

### 27. createStaffAccountAction calls staffAccountService.create exactly once per invocation, with role and scope in the same call, and returns the temporary password without ever redirecting
expected: createStaffAccountAction calls staffAccountService.create exactly once per invocation, with role and scope in the same call, and returns the temporary password without ever redirecting
result: pass
source: automated
coverage_id: D2

### 28. StaffAccountForm never touches localStorage, sessionStorage, document.cookie, or a console call, and the success panel's temporary password comes only from the action's returned state
expected: StaffAccountForm never touches localStorage, sessionStorage, document.cookie, or a console call, and the success panel's temporary password comes only from the action's returned state
result: pass
source: automated
coverage_id: D3

### 29. Each assignment renders as an independently revocable row; AssignmentsPanel exposes no bulk-select, revoke-all, or edit-in-place control
expected: Each assignment renders as an independently revocable row; AssignmentsPanel exposes no bulk-select, revoke-all, or edit-in-place control
result: pass
source: automated
coverage_id: D1

### 30. revokeAssignmentAction, deactivateStaffAccountAction, and reactivateStaffAccountAction each pass a thrown continuity/reason error message through to the ConfirmModal's error prop unchanged
expected: revokeAssignmentAction, deactivateStaffAccountAction, and reactivateStaffAccountAction each pass a thrown continuity/reason error message through to the ConfirmModal's error prop unchanged
result: pass
source: automated
coverage_id: D2

### 31. The reactivate ConfirmModal passes tone='default' and omits minReasonLength; the revoke and deactivate modals both pass minReasonLength sourced from MIN_REASON_LENGTH
expected: The reactivate ConfirmModal passes tone='default' and omits minReasonLength; the revoke and deactivate modals both pass minReasonLength sourced from MIN_REASON_LENGTH
result: pass
source: automated
coverage_id: D3

### 32. Roles list and create-role flow
expected: |
  Open /staff/roles as an administrator. The five seeded default roles (Administrator, Programme
  Manager, Instructor, Finance/Operations, Learner) appear pinned at the top of the list, each with
  a "Default" badge. Clicking "New role" opens /staff/roles/new. The permission picker shows all 36
  permissions grouped into 14 collapsible domain sections. Ticking permissions updates a live
  plain-language summary panel. Submitting with a name and a permission subset creates the role and
  returns to the list with the new role visible.
result: pass

### 33. Role detail page — Overview, Permissions editor, History
expected: |
  Open a role's detail page. Overview shows name, status, default flag, version, and active
  assignment count. The Permissions tab is a live inline editor (not read-only) seeded with the
  role's current permissions. Removing a permission and saving opens a "Remove permission(s)?"
  confirmation demanding a 10+ character reason; adding a permission saves with no confirmation.
  The History tab lists every version newest-first with a bare version-count badge.
result: pass

### 34. Audit view — filters and expand-in-place diff
expected: |
  Open /staff/audit. Rows from every resource type appear (including Course events from Phase 1),
  newest first. Changing the actor, action, or date filters re-queries the list via the URL.
  Clicking a row expands it in place to show scope, reason, and a field-level before/after diff;
  opening a second row collapses the first. No row offers any edit, delete, or export control.
result: pass
notes: "Initially hit a React key-prop error (see resolved gap G-02-34), fixed in-session, re-verified by user after the fix — now passes."

### 35. Staff accounts list
expected: |
  Open /staff/users. Every staff account appears with name, email, and a status pill (ACTIVE shows
  green/success, DEACTIVATED shows amber/warning, PENDING_VERIFICATION shows neutral gray). Long
  names or emails wrap onto a second line rather than being cut off with an ellipsis.
result: pass

### 36. Combined create-account-and-assign-role form
expected: |
  Open /staff/users/new. Fill in a name, email, pick a role, leave scope as Global, and submit. The
  form is replaced by a success panel showing the new account's name/email and a one-time temporary
  password with a working Copy button and a note that it is shown only once. Switching scope to
  Programme shows a search-and-pick target field.
result: pass
notes: "Test text originally assumed an empty Programme table (locked 'none yet' copy would show); dev seed data actually includes one real Programme ('Safety Leadership Programme'), so the search-and-select picker correctly found and offered it — this is the working non-empty case of the same D-18 picker, not a bug. Main create-and-assign flow (name/email/role/Global scope, temp-password success screen) confirmed working."

### 37. User detail page and assignment drawer
expected: |
  Open a staff account's detail page. Overview shows name/email/status/created date. The Assignments
  tab lists every role grant as its own row with a Revoke button; revoking one demands a 10+
  character reason and removes only that grant. Clicking "Assign role" opens a slide-over drawer;
  typing part of a name or email shows matching accounts after a short pause, picking one locks it
  in, and picking a role plus Global scope enables "Assign role" to save a new grant.
result: pass
notes: "Initially hit a next/headers-in-client-bundle build error (see resolved gap G-02-37), fixed in-session, re-verified by user after the fix — now passes."

## Summary

total: 37
passed: 37
issues: 0
pending: 0
skipped: 0
blocked: 0

Note: 2 issues were found and resolved during this session (G-02-34, G-02-37 — both fixed in-session and re-verified by the user), so the final tally shows 0 open issues even though 2 were reported along the way.

## Gaps

- gap_id: G-02-34
  truth: "Clicking a row expands it in place to show scope, reason, and a field-level before/after diff"
  status: resolved
  reason: "User reported: React console error overlay, 'Each child in a list should have a unique key prop', AuditTable.tsx:262"
  severity: major
  test: 34
  root_cause: "The row map returned a bare <>...</> fragment without a key for each row, instead of a keyed Fragment."
  artifacts:
    - path: "src/app/staff/audit/AuditTable.tsx"
      issue: "Missing key prop on the per-row Fragment returned from rows.map()"
  missing: []
  resolved_by: "Direct fix applied in-session — Fragment import + key={row.id}"
  resolved_at: 2026-09-02
  reverified_by_user: true

- gap_id: G-02-37
  truth: "The user detail page (and everything it renders, including its client components) builds and runs without error"
  status: resolved
  reason: "User reported: Next.js build error — next/headers imported into a Client Component bundle, traced through AssignmentsPanel.tsx"
  severity: blocker
  test: 37
  root_cause: "AssignmentsPanel.tsx (\"use client\") imported MIN_REASON_LENGTH directly from role-service.ts, whose import chain reaches next/headers via current-actor.ts — a server-only API cannot be bundled into a client component."
  artifacts:
    - path: "src/app/staff/users/AssignmentsPanel.tsx"
      issue: "Direct value import of a server-service constant into a \"use client\" file"
    - path: "src/app/staff/users/[id]/page.tsx"
      issue: "Did not pass minReasonLength as a prop to its two client children (now fixed)"
  missing: []
  resolved_by: "Direct fix applied in-session — MIN_REASON_LENGTH imported only in the Server Component page, passed down as a minReasonLength prop to AssignmentsPanel and AccountStatusControl"
  resolved_at: 2026-09-02
  reverified_by_user: true
