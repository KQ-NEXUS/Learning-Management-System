---
phase: 02-roles-permissions-staff-accounts
plan: 06
subsystem: auth
tags: [iam, rbac, prisma, sessions, credentials]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: assignment-service.ts assertScopeAllowed usage pattern (02-04), continuity-service.ts (02-02), role-service.ts MIN_REASON_LENGTH (02-03)
  - phase: 01-foundation
    provides: hashPassword (auth/password.ts), signOutAllForUser (auth-service.ts)
provides:
  - "staffAccountService.create: atomic User+first-Assignment transaction, D-40 temporary-password invite, duplicate-email named error"
  - "staffAccountService.deactivate/reactivate: reason-gated, session-sweeping, continuity-guarded deactivation; pure-flip reactivation touching no Assignment row"
  - "staffAccountService.search: the D-17 typeahead backend, gated on users.view"
affects: [02-07-users-list-and-create-form, 02-08-user-detail-assignments-panel]

actuals:
  tokens: 55000
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Unconditional guard-before-write (D-24d): the continuity check runs on every deactivation regardless of whether the user is known to hold roles.manage, trading a cheap extra query for a check that can never be forgotten on an edge case"
    - "Injected side effects (hash, signOutAll, now) on the service factory, mirroring assignment-service/role-service's injectable-store pattern, extended to non-store dependencies so the whole lifecycle is testable with no database and no real scrypt round"
    - "Post-transaction side effect ordering: signOutAllForUser is called only after the deactivation transaction commits, so a continuity-blocked deactivation never triggers a session sweep"

key-files:
  created:
    - src/server/services/staff-account-service.ts
    - tests/staff-account-service.test.ts

key-decisions:
  - "Checkpoint confirmed (2026-09-02): keep-assignments — deactivation leaves Assignment rows untouched, making reactivation a bare status flip. This was a confirmation of the already-recorded D-35/D-36 decision, not a re-opening of it."
  - "The account-creation transaction's first-assignment reason is a fixed literal ('Account's first assignment, granted at creation.') rather than admin-supplied — D-22 requires the write to be atomic, not that the reason itself be freeform; the combined form doesn't ask for a separate assignment reason."
  - "No optimistic-concurrency check on User.status changes (edge IAM-04/concurrency) — deliberately different from Role's version-locked edits, since two administrators racing to deactivate/reactivate the same account reach the identical end state either way."

patterns-established:
  - "Testing a redaction guarantee by running captured test-harness audit entries through the REAL buildAuditRow rather than asserting on the fake sink's raw capture — proves what production actually persists, not what a simplified test double happens to do"

requirements-completed: [IAM-04, RBAC-07, RBAC-08]

coverage:
  - id: D1
    description: "Account creation and its first role assignment are one atomic transaction; a failure (duplicate email) leaves zero assignment writes"
    requirement: "IAM-04"
    verification:
      - kind: unit
        ref: "tests/staff-account-service.test.ts#throws DuplicateStaffEmailError on a unique-constraint violation and leaves zero assignments written"
        status: pass
      - kind: unit
        ref: "tests/staff-account-service.test.ts#writes the User and the Assignment through the same transaction"
        status: pass
    human_judgment: false
  - id: D2
    description: "The temporary password is returned exactly once and never appears in any audit entry, including after the real redaction sink processes it"
    requirement: "IAM-04"
    verification:
      - kind: unit
        ref: "tests/staff-account-service.test.ts#returns a non-empty temporaryPassword not present in either audit entry"
        status: pass
    human_judgment: false
  - id: D3
    description: "Deactivation demands a >=10-character reason, sweeps every active session after the write commits, and is blocked by the continuity guard fired unconditionally"
    requirement: "IAM-04, RBAC-07"
    verification:
      - kind: unit
        ref: "tests/staff-account-service.test.ts#invokes signOutAll exactly once with the deactivated user's id, after the transaction"
        status: pass
      - kind: unit
        ref: "tests/staff-account-service.test.ts#throws ContinuityError and performs no write or session sweep when the count returns zero"
        status: pass
      - kind: unit
        ref: "tests/staff-account-service.test.ts#invokes the continuity check on every deactivation, including a user holding no roles.manage grant"
        status: pass
    human_judgment: false
  - id: D4
    description: "Deactivation and reactivation touch zero Assignment rows; reactivation is a pure status flip requiring no reason"
    requirement: "IAM-04"
    verification:
      - kind: unit
        ref: "tests/staff-account-service.test.ts#performs a full deactivate-then-reactivate cycle with zero assignment writes throughout"
        status: pass
      - kind: unit
        ref: "tests/staff-account-service.test.ts#succeeds reactivating with no reason argument"
        status: pass
    human_judgment: false
  - id: D5
    description: "The raw User row's passwordHash never survives into what the real audit sink persists"
    requirement: "RBAC-08"
    verification:
      - kind: unit
        ref: "tests/staff-account-service.test.ts#emits a deactivation audit entry whose before payload contains no password hash value once passed through the real audit sink's row builder"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-09-02
status: complete
---

# Phase 2: Roles, Permissions & Staff Accounts — Plan 06 Summary

**The last service-layer requirement in the phase: atomic staff-account creation with a first assignment, reason-gated deactivation with immediate session revocation and the continuity guard, and pure-flip reactivation.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2 (creation + deactivate/reactivate), plus one confirmed checkpoint
- **Files modified:** 2 (both created)

## Accomplishments
- `staffAccountService.create` — one `$transaction` for the User insert and its first Assignment, `assertScopeAllowed` checked per role permission, a D-40 temporary password generated/hashed and returned exactly once, `DuplicateStaffEmailError` on a unique-constraint hit.
- `staffAccountService.deactivate`/`reactivate` — reason gate (deactivation only), unconditional continuity check at D-24d, `signOutAllForUser` called strictly after the transaction commits, zero Assignment rows touched either direction, idempotent on repeat calls.
- `staffAccountService.search` — the D-17 typeahead, gated on `users.view`, capped at 10 rows, four-field projection.
- 25 new tests, including one that runs a captured audit entry through the real `buildAuditRow` to prove the redaction guarantee holds in production, not just in a simplified fake.

## Task Commits

None — executed directly, no `git commit`, per explicit user instruction for this session.

## Files Created/Modified
- `src/server/services/staff-account-service.ts` — `userScope`, `DuplicateStaffEmailError`, `StaffAccountReasonRequiredError`, `generateTemporaryPassword`, `search`/`list`/`get`/`create`/`deactivate`/`reactivate`
- `tests/staff-account-service.test.ts` — 25 tests, no database

## Decisions Made
- **Checkpoint confirmed by user:** `keep-assignments` (D-35/D-36 coupling stands as recorded).
- See `key-decisions` above for the two additional judgment calls made while implementing (fixed first-assignment reason literal, no optimistic lock on status changes) — both directly follow from the plan's own action text, not new departures.

## Deviations from Plan

### Auto-fixed Issues

**1. A test's fake hash function misrepresented real hash behavior, causing a false test failure**
- **Found during:** Task 1 verification (`npx vitest run tests/staff-account-service.test.ts`)
- **Issue:** The initial fake `hash` function returned `` `hashed:${plaintext}` ``, which literally embeds the plaintext temporary password as a substring. A real scrypt hash never does this. The test asserting "no audit entry contains the plaintext password" then failed — not because the service leaked the password, but because the *test double* manufactured a hash containing it.
- **Fix:** Changed the fake to `` `fake-hash-${plaintext.length}-${plaintext.split("").reverse().join("")}` `` — deterministic and testable, but does not contain the original plaintext as a literal substring, matching how a real hash actually behaves.
- **Files modified:** `tests/staff-account-service.test.ts` (not a source-file change).
- **Verification:** `npx vitest run tests/staff-account-service.test.ts` — 25/25 pass after the fix.
- **Impact:** Test-harness fidelity fix only; no production code changed, no scope creep.

---

**Total deviations:** 1 auto-fixed (a test-double fidelity issue caught by the test it was meant to support).
**Impact on plan:** None on production behavior — the service's actual redaction guarantee was never in question; only the test's simulation of a hash function needed correcting.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None.

## Next Phase Readiness
- `staffAccountService` is ready for Plan 02-07 (Users list + combined create-and-assign form) and Plan 02-08 (User detail page, Assignments panel) to build their UI directly against.
- No blockers.

---
*Phase: 02-roles-permissions-staff-accounts*
*Completed: 2026-09-02*
