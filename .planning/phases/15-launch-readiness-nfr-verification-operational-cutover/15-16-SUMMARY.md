---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 16
subsystem: privacy
tags: [nfr-11, d-12, anonymisation, privacy-manage, permissions, audit, licence, prisma]
status: complete

requires:
  - phase: 15-01
    provides: 15-DECISIONS.md privacy decision (option-a, privacy.manage, retention parameters)
  - phase: 15-04
    provides: audit-coverage guard (REQUIRED_AUDIT_ACTIONS) and request correlation ids
  - phase: 15-12
    provides: grade and completion uniqueness migration (partial indexes kept intact)
provides:
  - "Permission privacy.manage: closed catalogue, Global only, licence write, group 'privacy' in permission-groups.ts, listed under the 'settings' blocked item of the restricted-mode screen"
  - "User.anonymisedAt and User.anonymisedById (nullable) and migration 20261007120000_user_anonymisation"
  - "privacy-anonymise-service.ts: ANONYMISE_POLICY, AnonymiseNotAllowedError, AnonymiseConflictError, createPrivacyAnonymiseService, privacyAnonymiseService.anonymiseLearner({ userId, reason })"
  - "Audit action privacy.learner_anonymised (hashes only), required by tests/audit-coverage.test.ts"
  - "tests/privacy-no-hard-delete.test.ts: static guard over every privacy-*.ts service"
affects: [15-21 privacy export, 15-22 staff privacy screens, 15-31 launch checklist]

requirements-completed: []

actuals:
  tokens: 12000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Compare-and-set anonymisation: updateMany where anonymisedAt IS NULL, count must be 1, else a conflict error"
    - "One generic refusal error for short reason, unknown id, staff target and already-anonymised target (no oracle)"
    - "Audit before/after hold SHA-256 hashes and status only; the old email and name never reach the audit log"

key-files:
  created:
    - src/server/services/privacy-anonymise-service.ts
    - prisma/migrations/20261007120000_user_anonymisation/migration.sql
    - tests/privacy-anonymise.integration.test.ts
    - tests/privacy-no-hard-delete.test.ts
  modified:
    - src/server/permissions/catalogue.ts
    - src/server/licence/effects.ts
    - src/lib/permission-groups.ts
    - src/server/licence/registry.ts
    - prisma/schema.prisma
    - tests/audit-coverage.test.ts
    - tests/licence-effects.test.ts
    - tests/permissions.test.ts
    - tests/permission-groups.test.ts
    - tests/licence-restricted.integration.test.ts
    - tests/communications-invariants.test.ts

key-decisions:
  - "Owner decision applied exactly (15-DECISIONS.md, option-a): permission identifier privacy.manage, Global only, anonymise is a licence write; the retention parameters are the accepted conservative default"
  - "The lost race of two concurrent anonymise calls surfaces as AnonymiseConflictError (so plan 15-22 can show the reload copy); every other refusal is the single generic AnonymiseNotAllowedError"
  - "A learner who holds any role assignment is treated as staff and refused, in addition to the isStaff flag"
  - "Verification tokens are removed by the old address, the pending address and the user id; sign-in throttle rows by the old address (case-insensitive)"
  - "getPrivacyRecord is NOT in this service: plan 15-22 owns it in privacy-read-service.ts, so the plan's provides line for it is stale"

patterns-established:
  - "Phase 13 invariants that forbid deleting Notification and EmailPreference rows now carry one reviewed exception for privacy-anonymise-service.ts"

duration: about 1 h 40 min wall clock (most of it Docker and Testcontainers waits)
completed: 2026-10-09
---

# Phase 15 Plan 16: Learner Anonymisation Service (D-12, NFR-11) Summary

**Staff holding the new Global-only `privacy.manage` permission can anonymise one learner account in place: the User row is rewritten (never deleted), every session is revoked, four kinds of ancillary rows are removed, every retained record is untouched, and one audit row stores SHA-256 hashes instead of the old email and name.**

## Accomplishments

- **Permission (option-a).** `privacy.manage` is in the closed catalogue and in `GLOBAL_ONLY_PERMISSIONS`. It is classified `write` in `LICENCE_PERMISSION_EFFECT`, grouped as `privacy` in `permission-groups.ts` (label "Privacy"), and added to the restricted-mode "settings" blocked item so the works/blocked screen tells the truth. The seeded Administrator role gets it through the existing full `PERMISSIONS` spread.
- **Schema.** `User.anonymisedAt` and `User.anonymisedById`, both nullable. The migration holds only two `ALTER TABLE ... ADD COLUMN` statements.
- **Service.** `anonymiseLearner({ userId, reason })` runs through `withPermission("privacy.manage", () => ({}))` (Global scope only). It trims the reason (minimum 20 characters), then in one transaction: loads the user, refuses staff (flag or any assignment), unknown and already-anonymised accounts, runs the guarded `updateMany`, revokes all sessions, deletes the policy's ancillary rows, and writes `privacy.learner_anonymised` with actor, target, reason, outcome, correlationId, GLOBAL scope, `before { emailSha256, nameSha256 }` and `after { status, anonymisedAt }`.
- **Policy constant.** `ANONYMISE_POLICY` has 7 changes, 4 removals and 14 kept items, copied from 15-DECISIONS.md. Plan 15-22 renders it.
- **Licence registry.** `privacy-anonymise-service.ts` is registered as `withPermission`; the boundary test passes (41 cases).
- **Local database.** Migration applied to the local Docker database through the guard; `migrate status` says "Database schema is up to date!"; client regenerated.

## Task Commits

None. The owner commits explicitly; everything is left uncommitted and nothing is staged.

1. Task 1 (tracer): permission, schema, migration, service, registry, integration test. Tracer gate: the integration test was re-run end to end after the fix below and passed before the expansion work.
2. Task 2: refusals, concurrency, licence restriction, no-hard-delete guard, permission test updates.
3. Task 3: local migration deploy, status, generate, tsc.

## Verification run (this session)

| Command | Result |
|---------|--------|
| `npx prisma validate` | valid |
| `npx tsx scripts/ops/assert-local-db.ts` | "database target is local (localhost)", exit 0 |
| `npx prisma migrate deploy` (local DB) | 20261007120000_user_anonymisation applied |
| `npx prisma migrate status` (local DB) | "Database schema is up to date!" |
| `npx prisma generate` | client exposes `anonymisedAt` |
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run tests/privacy-anonymise.integration.test.ts --no-file-parallelism` | 11 passed (first run 10 of 11, see Deviations) |
| `npx vitest run tests/privacy-no-hard-delete.test.ts tests/audit-coverage.test.ts tests/licence-effects.test.ts tests/permissions.test.ts tests/permission-groups.test.ts --testTimeout=60000` | 5 files, 56 passed |
| `npx vitest run tests/licence-enforcement-boundary.test.ts --testTimeout=60000` | 41 passed |
| `npx vitest run tests/licence-restricted.integration.test.ts --no-file-parallelism` | 92 passed (38 permissions, 14 write) |
| `npx vitest run tests/communications-invariants.test.ts tests/certificate-phase-invariants.test.ts tests/assessment-staff-routes.test.ts tests/licence-wording.test.ts tests/licence-ui-mirror-gate.test.ts` | 5 files, 74 passed |
| `npx vitest run tests/components/role-detail-panels.test.tsx tests/unit/design-contract.test.ts tests/assignment-service.test.ts tests/role-service.test.ts` | passed (run together with the failing communications file first; 159 of 161 passed, the 2 failures were fixed, see Deviations) |
| `npx eslint` on all touched source and test files | clean |

What the integration test proves: the User fields after anonymisation, both sessions revoked and the replayed token no longer resolving, sign-in with the old address failing, the five policy tables emptied for that learner while a bystander's rows survive, 14 retained row types identical before and after (orders, payment attempts, refunds, enrolments, attendance, submissions, grades, completion records, certificates with the printed name, tickets and messages, policy acceptances, an earlier audit event, learner number), one audit row whose before, after and reason contain no old email, pending email or name, a 19 character reason refused and 20 accepted, staff by flag and by assignment refused, unknown id refused, a repeat call refused with one audit row, two concurrent calls giving one success and one audit row, denial without the permission (and with the permission at a narrower scope) with an `authorization.denied` row, and refusal as a write in the restricted licence state while the same call a millisecond earlier succeeds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in my test] Sign-in attempt re-created a throttle row**
- **Found during:** Task 1 tracer run
- **Issue:** The test checked the old address's throttle rows were gone after it had made a failed sign-in with that address, which writes a new counter row.
- **Fix:** Moved the sign-in check after the throttle assertion.
- **Files modified:** tests/privacy-anonymise.integration.test.ts

**2. [Rule 3 - Blocking] Phase 13 invariants contradicted the owner's decision**
- **Found during:** Task 2 (searching tests that enumerate the catalogue and scan for deletes)
- **Issue:** `tests/communications-invariants.test.ts` pinned the catalogue at 37 and forbade any `notification.deleteMany` or `emailPreference.deleteMany` in `src`. The approved permission and the approved policy ("REMOVES: email preferences, in-app notifications") both break those.
- **Fix:** Expectation-only edits: 38 permissions with a comment naming `privacy.manage`, and one reviewed exception limited to `privacy-anonymise-service.ts` and only the `notification` and `emailPreference` delegates. `emailDispatch` and `domainEvent` stay fully protected.
- **Files modified:** tests/communications-invariants.test.ts

**3. [Rule 3 - Blocking] Other tests pinned the catalogue counts**
- **Fix:** Expectation-only updates in tests/permissions.test.ts (38; three global-only; privacy.manage global-only), tests/permission-groups.test.ts (15 groups), tests/licence-effects.test.ts (14 write; privacy.manage in the write list) and tests/licence-restricted.integration.test.ts (38 permissions, 14 write; allowed stays 24).

**4. [Rule 2 - Missing critical] Restricted-mode screen list**
- **Issue:** `tests/licence-effects.test.ts` requires every write permission to appear in exactly one blocked item. Without a change, the licence status screen would not mention anonymisation.
- **Fix:** Added `privacy.manage` to the existing "settings" blocked item in `RESTRICTED_CAPABILITIES`; the pinned wording is unchanged.
- **Files modified:** src/server/licence/effects.ts

**Total deviations:** 4 auto-fixed, no scope change, no architectural change.

## Issues Encountered

- Docker is slow here: each Testcontainers run of the privacy integration file took about 3 to 4.5 minutes. No start failures this time, and no containers were left behind (only the local `learning-management-system-postgres-1` is running, as before).
- The plan text says `service exports getPrivacyRecord`. It is owned by plan 15-22 (`privacy-read-service.ts`), so it was not added here.

## Threat Flags

None beyond the plan's register. T-15-16-01 to 06 are mitigated and tested as described above. Residual note: SHA-256 of an email is guessable by anyone who already holds a list of candidate addresses; the plan prescribes this form and the audit log is staff-only.

## Neon go-live list

| Item | Why |
|------|-----|
| Migration `20261007120000_user_anonymisation` (two nullable columns on "User") | Additive; apply with `prisma migrate deploy` on the direct connection string |
| Re-run the seed, or add `privacy.manage` to the Administrator role on the roles screen | The seed rewrites default role permissions; an existing Administrator role does not have the new permission until then |

## Observations for the owner

- **Not covered by the decision (left unchanged, kept):** the email delivery log (`EmailDispatch.toEmail`, `error`) and the `Session` rows' IP and user agent. Sessions are revoked, not deleted, so IP and user agent stay. Ticket message text and attachments are kept as the decision says. If the owner wants the delivery-log address anonymised too, that is a decision for the launch checklist (plan 15-31).
- The audit log is never rewritten, so the old email and name that earlier events already contain (for example `user.email_changed`) remain there. This follows P3 and the decision.
- Hard deletion remains impossible from this code and is guarded by `tests/privacy-no-hard-delete.test.ts`.
- Exporting one learner's data (plan 15-21) must carry its own `{ licence: "continuity" }` override at the call site; `privacy.manage` itself is classified write.

## Tracking

- `requirements.ready-ids <plan> NFR-11` returned 0 ready: NFR-11 is also declared by plans 15-01 (done), 15-21, 15-22 and 15-31, which have no SUMMARY yet. REQUIREMENTS.md was not marked.
- State commands run as listed in the final report; nothing was hand-edited in STATE.md.

## Self-Check: PASSED

- Created files exist: src/server/services/privacy-anonymise-service.ts, prisma/migrations/20261007120000_user_anonymisation/migration.sql, tests/privacy-anonymise.integration.test.ts, tests/privacy-no-hard-delete.test.ts (all checked on disk).
- Acceptance criteria: migration contains only ADD COLUMN lines (no DROP, no UPDATE); the service exports `ANONYMISE_POLICY` and contains `privacy.learner_anonymised`; the integration test asserts the old email text is absent from before, after and reason; `registry.ts` contains `privacy-anonymise-service.ts`; `audit-coverage.test.ts` lists `privacy.learner_anonymised`; the concurrency case asserts exactly one success and one audit row; `migrate status` prints "Database schema is up to date!"; no command used `db push` or `accept-data-loss`.
- No commits were made and nothing is staged.
