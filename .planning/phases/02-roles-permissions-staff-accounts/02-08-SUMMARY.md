---
phase: 02-roles-permissions-staff-accounts
plan: 08
subsystem: ui
tags: [rbac, iam, react, nextjs, server-actions]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: assignmentService.create/revoke/listForUser (02-04), staffAccountService.get/deactivate/reactivate/search (02-06), searchScopeTargetsAction (02-07)
provides:
  - "/staff/users/[id]: Overview + Assignments detail page, deactivate/reactivate controls"
  - "AssignmentsPanel: independently-revocable assignment rows, no bulk affordance, revoked-history section"
  - "AssignmentDrawer: user typeahead + four-scope picker, the last new UI surface in Phase 2"
affects: []

actuals:
  tokens: 50000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Hand-rolled dialog/drawer container (no existing primitive covers a slide-over) mirroring ConfirmModal's focus-trap and ESC-suppressed-while-pending rules rather than importing them, since a drawer and a confirmation are different interaction shapes"
    - "Debounced typeahead via setTimeout inside a useEffect, with the loading/error/pending state resets happening inside the timeout callback (not the effect body) to satisfy react-hooks/set-state-in-effect"

key-files:
  created:
    - src/app/staff/users/[id]/page.tsx
    - src/app/staff/users/AssignmentsPanel.tsx
    - src/app/staff/users/AssignmentDrawer.tsx
  modified:
    - src/app/staff/users/actions.ts

key-decisions:
  - "AssignmentsPanel renders active and revoked assignments as two visually distinct lists (active rows revocable, revoked rows muted with their revocation date/reason) rather than a single mixed list — makes the immutable-audit-trail nature of D-23 visible rather than just enforced."
  - "The drawer's user-search results and scope-target 'no targets available' select both use the same disabled-select pattern established in Plan 07's StaffAccountForm, for consistency and to avoid the hidden-required-field submission bug found there."

patterns-established:
  - "Panel/drawer container as a distinct interaction primitive from ConfirmModal — same accessibility rules (role=dialog, focus trap, ESC handling), different shape (persistent, side-anchored, no reason field of its own)"

requirements-completed: [RBAC-04, IAM-04]

coverage:
  - id: D1
    description: "Each assignment renders as an independently revocable row; AssignmentsPanel exposes no bulk-select, revoke-all, or edit-in-place control"
    requirement: "RBAC-04"
    verification:
      - kind: unit
        ref: "manual code inspection — AssignmentsPanel.tsx's revoke button submits exactly one assignment.id per call, no checkbox or select-all state exists in the component"
        status: pass
    human_judgment: false
  - id: D2
    description: "revokeAssignmentAction, deactivateStaffAccountAction, and reactivateStaffAccountAction each pass a thrown continuity/reason error message through to the ConfirmModal's error prop unchanged"
    requirement: "RBAC-04, IAM-04"
    verification:
      - kind: unit
        ref: "manual code inspection — actions.ts's catch blocks return error.message verbatim with no string concatenation or interpolation for ContinuityError/AssignmentReasonRequiredError/StaffAccountReasonRequiredError"
        status: pass
    human_judgment: false
  - id: D3
    description: "The reactivate ConfirmModal passes tone='default' and omits minReasonLength; the revoke and deactivate modals both pass minReasonLength sourced from MIN_REASON_LENGTH"
    requirement: "IAM-04"
    verification:
      - kind: unit
        ref: "manual code inspection — AssignmentsPanel.tsx's AccountStatusControl conditionally omits minReasonLength only on the isActive=false branch"
        status: pass
    human_judgment: false
  - id: D4
    description: "The full detail page, assignments panel, and drawer render correctly, the typeahead debounces and shows the correct empty/loading/error states, and a real assignment can be created and revoked end to end in a browser"
    verification: []
    human_judgment: true
    rationale: "No browser was available this session — same caveat as every UI plan across this phase. Service-layer logic (Plans 02/04/06) is unit-proven; the actual interaction (drawer open/close, focus trap, debounce timing, scope-target search-as-you-type) needs human/UAT confirmation."

duration: ~45min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 08 Summary

**The phase's final surface: a staff-account detail page with independently-revocable assignment rows and an assignment drawer with user typeahead and a four-scope target picker — where every service guarantee built across this phase (sibling assignments untouched, reasons demanded, the last-administrator block, sessions swept) becomes visible.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 (detail page + drawer)
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `/staff/users/[id]` — Overview (`DetailFacts`) and Assignments (badge = real active count, including zero) tabs; `notFound()` on both missing and denied.
- `AssignmentsPanel` — active assignments as individually-revocable rows, revoked assignments shown separately with their date/reason, an empty-state panel with an Assign CTA when there are zero active grants.
- `AccountStatusControl` — deactivate (reason-gated, session-sweep + kept-assignments copy) and reactivate (non-destructive, no-reassignment copy) `ConfirmModal`s.
- `AssignmentDrawer` — hand-built slide-over (no existing primitive covers this shape), debounced user typeahead, 4-scope-type picker reusing `searchScopeTargetsAction` from Plan 07, honest empty states for Programme/Cohort.
- `actions.ts` extended with `revokeAssignmentAction`, `deactivateStaffAccountAction`, `reactivateStaffAccountAction`, `searchStaffUsersAction`, `createAssignmentAction`.

## Task Commits

None — executed directly, no `git commit`, per explicit user instruction for this session. This closes out all 8 plans of Phase 2 with zero commits made throughout, per that same standing instruction.

## Files Created/Modified
- `src/app/staff/users/[id]/page.tsx` — detail route
- `src/app/staff/users/AssignmentsPanel.tsx` — `AssignmentsPanel`, `AccountStatusControl`
- `src/app/staff/users/AssignmentDrawer.tsx` — `AssignmentDrawer`
- `src/app/staff/users/actions.ts` — 5 new Server Actions

## Decisions Made
See `key-decisions` above — both were implementation-level judgment calls consistent with the plan's stated intent and Plan 07's established patterns, not new departures from CONTEXT.md's decisions.

## Deviations from Plan

### Auto-fixed Issues

**1. [ESLint react-hooks/set-state-in-effect] Synchronous setState call in the typeahead debounce effect**
- **Found during:** Task 2 verification (`npx eslint src tests prisma`)
- **Issue:** Same pattern as Plan 07's fix — `setUserSearchError(null)` was called synchronously in the debounce `useEffect`'s body, before the `setTimeout` callback, triggering the same cascading-render lint rule.
- **Fix:** Moved `setUserSearchError(null)` inside the `setTimeout` callback, alongside the other state updates for that search attempt, so the effect body itself performs no synchronous `setState`.
- **Files modified:** `src/app/staff/users/AssignmentDrawer.tsx`.
- **Verification:** `npx eslint src tests prisma` exits 0; `npm test` (219/219) unaffected.

---

**Total deviations:** 1 auto-fixed (the same lint pattern already seen and fixed in Plan 07 — recognized immediately).
**Impact on plan:** None — a structural fix with no behavioral change.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None.

## Next Phase Readiness
- **Phase 2 is now feature-complete across all 8 plans.** All 7 requirements (RBAC-01, RBAC-02, RBAC-03, RBAC-04, RBAC-07, RBAC-08, IAM-04) have both service-layer unit coverage and a corresponding UI surface.
- 219 tests pass across 19 files; `tsc`/`eslint` are clean project-wide.
- **Not yet verified in a browser anywhere in this phase** — every UI-facing plan (01, 03, 05, 07, 08) carries a `human_judgment: true` coverage item for visual/interaction confirmation. A UAT pass in a real browser is the natural next step before considering Phase 2 fully done, not just code-complete.
- **Nothing has been committed to git across all 8 plans**, per the user's explicit instruction for this session — everything is on disk, uncommitted, ready for the user's own review and commit decision.
- No blockers for Phase 3 (Public Identity) or Phase 4 (Catalogue Authoring), which can proceed independently per the roadmap's parallel-track structure.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
