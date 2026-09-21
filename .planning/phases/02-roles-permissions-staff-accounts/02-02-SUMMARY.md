---
phase: 02-roles-permissions-staff-accounts
plan: 02
subsystem: auth
tags: [rbac, audit, security, prisma]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: role-service.ts (Plan 02-01), the withPermission/audit conventions from Phase 1
provides:
  - "continuity-service.ts: the one shared RBAC-07 guard (assertRoleManagementContinuity) every later D-24 trigger site imports"
  - "audit-service.ts: scope-carrying BusinessAuditEvent, sink-level credential redaction (redactForAudit), pure buildAuditRow"
  - "A source-scanning test proving the audit trail is append-only across the whole of src, not just by convention"
affects: [02-03-role-editing, 02-04-assignments, 02-06-staff-accounts]

actuals:
  tokens: 22000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Injectable count function (ContinuityCount) so a caller's own prisma.$transaction can co-locate the continuity check with the write it guards, without a raw SQL lock"
    - "Sink-level redaction (redactForAudit inside buildAuditRow) rather than per-call-site redaction, so a future service passing a whole User row cannot forget to scrub it"
    - "Source-scanning invariant test (audit-append-only.test.ts) built from string-concatenated parts so the test cannot self-match its own forbidden pattern"

key-files:
  created:
    - src/server/services/continuity-service.ts
    - tests/continuity-service.test.ts
    - tests/audit-service.test.ts
    - tests/audit-append-only.test.ts
  modified:
    - src/server/services/audit-service.ts

key-decisions:
  - "Checkpoint resolved: transaction-scoped count only, not a row-level lock (SELECT ... FOR UPDATE) — matches D-27's reactive framing, costs nothing extra since the versioning write already needs a transaction, and keeps the check unit-testable without a database. The residual READ COMMITTED race is accepted and recorded as T-02-10 (low severity)."
  - "buildContinuityWhere always constrains scopeType to GLOBAL (D-25) and independently requires the joined user's status to be ACTIVE — the clause with no precedent anywhere else in the codebase, since loadGrantsForUser's safety comes from the current-actor session boundary, which does not apply when counting other users (RESEARCH Pitfall 1)."
  - "CONTINUITY_BLOCK_MESSAGE is a module-level constant with zero template interpolation, so no administrator identity can ever reach it — enforced by a test asserting the message contains no digit and no at-sign."
  - "Redaction lives inside buildAuditRow (the sink), not at any call site — the same reasoning as the continuity guard: a rule that must be remembered per-caller eventually gets forgotten."

patterns-established:
  - "Source-scanning invariant tests (in the spirit of structure.test.ts/boundary.test.ts) extended to enforce a security property (append-only) across the whole src tree, not just a single module"

requirements-completed: [RBAC-07, RBAC-08]

coverage:
  - id: D1
    description: "assertRoleManagementContinuity blocks any change that would leave zero active GLOBAL roles.manage holders, counting only GLOBAL-scope grants and only ACTIVE users"
    requirement: "RBAC-07"
    verification:
      - kind: unit
        ref: "tests/continuity-service.test.ts#requires the joined user's status to be ACTIVE"
        status: pass
      - kind: unit
        ref: "tests/continuity-service.test.ts#constrains scopeType to GLOBAL (D-25)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The continuity block message is a fixed constant that never identifies another administrator"
    requirement: "RBAC-07"
    verification:
      - kind: unit
        ref: "tests/continuity-service.test.ts#carries a message with no digits and no at-sign"
        status: pass
    human_judgment: false
  - id: D3
    description: "AuditEvent rows can now carry scopeType/scopeId, and credential-shaped fields are redacted before any row is written"
    requirement: "RBAC-08"
    verification:
      - kind: unit
        ref: "tests/audit-service.test.ts#redacts a passwordHash key in before"
        status: pass
      - kind: unit
        ref: "tests/audit-service.test.ts#threads scopeType and scopeId onto the row unchanged"
        status: pass
    human_judgment: false
  - id: D4
    description: "The audit trail is append-only across the entire src tree — no update/delete/upsert against the audit model exists anywhere, and exactly one file creates rows"
    requirement: "RBAC-08"
    verification:
      - kind: unit
        ref: "tests/audit-append-only.test.ts#contains no mutating or removing call against the audit model anywhere in src"
        status: pass
      - kind: unit
        ref: "tests/audit-append-only.test.ts#has exactly one file in src that creates audit rows"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 02 Summary

**RBAC-07 continuity safeguard (transaction-scoped, GLOBAL-only, deactivated-admin-proof) and the RBAC-08 audit scope/redaction fix, both shared by every remaining plan in this phase.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (1 checkpoint decision + 2 implementation tasks)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `continuity-service.ts` — the single shared RBAC-07 guard: `buildContinuityWhere` (pure, GLOBAL-only, ACTIVE-user-only) and `assertRoleManagementContinuity` (injectable count function, simulates the post-action state).
- `audit-service.ts` extended with `scopeType`/`scopeId` on `BusinessAuditEvent`, a pure `buildAuditRow`, and sink-level `redactForAudit` covering `passwordHash`, `password`, `sessionToken`, `token`, `secret` — cycle-safe, array- and nested-object-aware.
- A new source-scanning test (`audit-append-only.test.ts`) proves the append-only property across all of `src`, not just this one file, and proves exactly one file creates audit rows.

## Task Commits

None — executed directly, no `git commit`, per explicit user instruction for this session.

## Files Created/Modified
- `src/server/services/continuity-service.ts` — RBAC-07 continuity guard
- `src/server/services/audit-service.ts` — scope fields, `buildAuditRow`, `redactForAudit`, `AUDIT_REDACTED_KEYS`
- `tests/continuity-service.test.ts` — 18 tests, no database
- `tests/audit-service.test.ts` — 11 tests, no database
- `tests/audit-append-only.test.ts` — source-scan invariant, 2 tests

## Decisions Made
- **Checkpoint resolved by user:** transaction-scoped count, not row-level locking (see `key-decisions` above).
- Everything else followed the plan's action text directly — no further judgment calls needed.

## Deviations from Plan
None — plan executed as written.

## Issues Encountered
None.

## User Setup Required
None.

## Next Phase Readiness
- `assertRoleManagementContinuity` and the extended `recordAudit`/`buildAuditRow` are ready for Plan 02-03 (role editing/deactivation), Plan 02-04 (assignment revoke), and Plan 02-06 (staff-account deactivation) — all four D-24 trigger points now have one proven guard to import rather than four independent implementations.
- No blockers.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
