---
phase: 02-roles-permissions-staff-accounts
plan: 04
subsystem: auth
tags: [rbac, prisma, assignments, scope]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: role-service.ts MIN_REASON_LENGTH (02-03), continuity-service.ts (02-02), audit-service.ts scope fields (02-02)
provides:
  - "assignmentService.create/revoke/listForUser: the RBAC-04 grant lifecycle, scope-enforced both ways (caller's grant vs. target scope, target scope vs. role's global-only permissions)"
  - "scopeLookupService.programmes/courses/cohorts: the minimal-projection backend for the four-scope assignment picker, honest-empty for Programme/Cohort until Phases 4/5 land"
affects: [02-06-staff-accounts, 02-08-user-detail-assignments-panel]

actuals:
  tokens: 42000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Two-directional scope enforcement on a single write: the caller's own grant must reach the assignment's target scope (assignmentTargetScope as the scope resolver), AND the role being assigned must not carry a global-only permission below global scope (assertScopeAllowed per permission) — neither check substitutes for the other"
    - "Revoke's scope resolver re-derives authority from the STORED assignment's real scope, not from anything the caller asserts in the request"
    - "Idempotent revoke-of-already-revoked (returns the existing row unchanged rather than erroring or double-writing) — matches IAM-04's analogous idempotent-deactivation edge resolved in the spec-less probe"

key-files:
  created:
    - src/server/services/assignment-service.ts
    - src/server/services/scope-lookup-service.ts
    - tests/assignment-service.test.ts
    - tests/scope-lookup-service.test.ts

key-decisions:
  - "assignmentTargetScope throws ScopeError on a non-GLOBAL type with a null scopeId rather than degrading to an empty ResourceScope — an empty scope is exactly what a GLOBAL grant reaches, so silently widening a malformed scoped request into a global one would be the privilege escalation grantMatches exists to prevent."
  - "No update method exists on assignmentService (D-23) — a scope or end-date change is always revoke-old + create-new; this is enforced by omission, not by a runtime check."
  - "scope-lookup-service returns exactly {id, label, identifier} and nothing more (D-41) — verified by an exact key-list assertion in tests, since the whole justification for roles.manage-alone access depends on the projection staying minimal."

patterns-established:
  - "Store-derived (not caller-derived) scope resolution for any future revoke/deactivate-style action that must check authority against a record's actual state rather than trusting the request"

requirements-completed: [RBAC-04, RBAC-07, RBAC-08]

coverage:
  - id: D1
    description: "A user can hold several concurrent assignments; revoking one leaves the others byte-identical"
    requirement: "RBAC-04"
    verification:
      - kind: unit
        ref: "tests/assignment-service.test.ts#leaves a user's other assignments untouched when revoking one of three"
        status: pass
    human_judgment: false
  - id: D2
    description: "A role bundling a global-only permission cannot be assigned below global scope; the caller's own grant must reach the assignment's target scope"
    requirement: "RBAC-04"
    verification:
      - kind: unit
        ref: "tests/assignment-service.test.ts#rejects a role carrying licence.activate at COURSE scope with ScopeError and performs no write"
        status: pass
      - kind: unit
        ref: "tests/assignment-service.test.ts#refuses a GLOBAL target when the only grant is Course-scoped"
        status: pass
    human_judgment: false
  - id: D3
    description: "Revoking a GLOBAL roles.manage assignment is blocked by the continuity guard when zero other holders would remain; a COURSE-scoped assignment of the same role never triggers the check"
    requirement: "RBAC-07"
    verification:
      - kind: unit
        ref: "tests/assignment-service.test.ts#invokes the continuity check for a GLOBAL roles.manage assignment and throws ContinuityError with zero remaining"
        status: pass
      - kind: unit
        ref: "tests/assignment-service.test.ts#does not invoke the continuity check for a COURSE-scoped assignment of the same role"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both assignment audit events (create, revoke) carry the assignment's real scopeType/scopeId, never blank"
    requirement: "RBAC-08"
    verification:
      - kind: unit
        ref: "tests/assignment-service.test.ts#emits one audit entry whose scopeType and scopeId equal the assignment's own"
        status: pass
    human_judgment: false
  - id: D5
    description: "The scope-target lookup is gated on roles.manage alone, projects exactly three fields, and returns an honest empty result for Programme/Cohort"
    requirement: "RBAC-04"
    verification:
      - kind: unit
        ref: "tests/scope-lookup-service.test.ts#maps a programme row to exactly the three ScopeTarget keys"
        status: pass
      - kind: unit
        ref: "tests/scope-lookup-service.test.ts#refuses when the only roles.manage grant is Course-scoped"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 04 Summary

**The RBAC-04 assignment lifecycle (create/revoke, immutable by design) with two-directional scope enforcement, plus the minimal-projection scope-target lookup backing the future four-scope picker.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 (assignment service + scope-lookup service)
- **Files modified:** 4 (all created)

## Accomplishments
- `assignment-service.ts` — `create` (caller's grant checked against the target scope; role's permissions checked against `assertScopeAllowed` per permission; immediate-start only), `revoke` (reason-gated, updates exactly one row by id, continuity-guarded at the D-24a trigger, idempotent on an already-revoked row), `listForUser`.
- `scope-lookup-service.ts` — `programmes`/`courses`/`cohorts`, each gated on `roles.manage` alone, returning exactly `{id, label, identifier}`, honestly empty for Programme/Cohort until Track B lands.
- 36 new tests across the two files, all passing without a database.

## Task Commits

None — executed directly, no `git commit`, per explicit user instruction for this session.

## Files Created/Modified
- `src/server/services/assignment-service.ts` — `assignmentTargetScope`, `AssignmentReasonRequiredError`, `create`/`revoke`/`listForUser`
- `src/server/services/scope-lookup-service.ts` — `ScopeTarget`, `SCOPE_TARGET_LIMIT`, three lookup methods
- `tests/assignment-service.test.ts` — 17 tests
- `tests/scope-lookup-service.test.ts` — 19 tests

## Decisions Made
See `key-decisions` above — all followed directly from D-13/D-14/D-18/D-19/D-20/D-21/D-23/D-24a/D-41 and RESEARCH's Pitfall 3 and Pattern 4 table row (a). No new judgment calls beyond what the plan specified.

## Deviations from Plan
None — plan executed as written.

## Issues Encountered
None.

## User Setup Required
None.

## Next Phase Readiness
- `assignmentService` and `scopeLookupService` are ready for Plan 02-08 (the Assignment Drawer UI and the User detail page's Assignments panel) to consume — no service-layer work remains for that plan beyond wiring these two into forms and a drawer component.
- `assignmentService.create`/`revoke` are also ready for Plan 02-06 to call from the combined staff-account-creation flow (D-22's atomic account+first-assignment transaction).
- No blockers.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
