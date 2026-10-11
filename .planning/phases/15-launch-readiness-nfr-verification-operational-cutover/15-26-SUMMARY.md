---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 26
subsystem: authorization-testing
tags: [nfr-05, authz, scope, record-state, revocation, concurrency, d-09]
status: complete

provides:
  - "Wrong-scope matrix: every RECORD-scoped registry entry (69) is called by staff holding every scopable permission only on another cohort, course or programme, and is refused, audited against the permission, and writes nothing; the same call by correctly scoped staff gets through (positive control)"
  - "Claimed-scope probes: the caller's own cohort or course id sent beside a record of another scope is still refused (20 cases), and a transfer into a cohort outside the caller's reach is refused"
  - "Collection-scope proof for the 5 COLLECTION entries: exports freeze only the rows in the caller's scope, and role grants and revocations outside the caller's reach (and above the grant ceiling) are refused"
  - "Record-state matrix: 77 cases over 56 entries that declare recordStates, each called by a fully authorised caller against a record in a disallowed state"
  - "Revocation timing and concurrency proof (15 cases): a grant, assignment, role, permission, session or account revoked between two requests is refused on the second; the end-instant boundary is pinned; no call that starts after a revocation committed succeeds or writes"
  - "Four real record-state defects found and fixed (see Deviations)"
  - "Deterministic evidence file evidence/authz-scope-state-local.json (416 cases, 416 passed)"

requirements-completed: []

actuals:
  tokens: 26700
  tasks: 3
  commits: 0

key-files:
  created:
    - tests/support/authz-scope-fixtures.ts
    - tests/authz-scope-state.integration.test.ts
    - tests/authz-revocation.integration.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/authz-scope-state-local.json
  modified:
    - tests/support/authz-registry.ts
    - src/server/services/publish-service.ts
    - src/server/services/ticket-service.ts
    - src/server/services/scheduled-session-service.ts
    - src/app/staff/courses/[id]/publish-actions.ts
    - src/app/staff/programmes/[id]/publish-actions.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/deferred-items.md
---

# Plan 15-26 Summary: Wrong scope, wrong record state, and revocation under concurrency

## Result

**No assignment-scope bypass was found.** Every scoped action and route refused staff who hold the permission only on another cohort, course or programme, wrote nothing, and left an `authorization.denied` row for the right permission. A mutation check confirmed the test would notice: with the cohort branch of `grantMatches` (`src/server/permissions/scope.ts`) temporarily made to match any cohort, 38 wrong-scope cases failed; the file was restored byte for byte.

**The record-state matrix found four real defects, all fixed in the application** (D-07: not waived, no expectation was weakened). Each lets a fully authorised caller do something to a record in a final or wrong state that the product rules or the UI say is not allowed. Two of them cross a permission boundary.

| # | Defect | Why it matters | Fix |
|---|--------|----------------|-----|
| 1 | `unarchiveCatalogueRecord` (course and programme) never checked the record was archived. Called on a **published** or listed-draft record it set it to DRAFT and unlisted. | Needs only `courses.edit` / `programmes.manage`, yet it does what `unpublish` does (which needs `courses.publish` / `programmes.publish` and refuses while a cohort is running, D-12) and delists the record (which has its own listing permission). A permission boundary bypass. | New `NotArchivedError` in `publish-service.ts`; both unarchive operations throw it unless the status is ARCHIVED; both publish-action files map it to `{ ok: false, reason: "INVALID" }`. |
| 2 | `publishCourse` / `publishProgramme` on an **ARCHIVED** record published it. | D-16: an archived record returns to DRAFT and "re-publishing is deliberate". Publishing straight from ARCHIVED lets a holder of the publish permission resurrect a record the catalogue deliberately retired, skipping the restore step. | New `ArchivedRecordError`; `createPublishOperation` throws it when the loaded record is ARCHIVED; both action files map it to `INVALID`. |
| 3 | `cancelSession` on an **already cancelled** session overwrote the original cancellation time and reason and wrote a second `session.cancelled` event (a second round of learner notifications). | Loses the original reason and re-notifies learners. `updateSession` already refused cancelled sessions with `SessionCancelledError`; cancel did not. | `scheduled-session-service.ts` now throws the same `SessionCancelledError` (already mapped by the action). |
| 4 | Staff could change priority, send a public reply and add an internal note on a **CLOSED** ticket. | The staff page says "This ticket is closed. The chronology is read-only." and hides the composer, but the server accepted all three: UI-only enforcement. A public reply also notified the learner about a closed ticket. | `ticket-service.ts`: `assertTicketNotClosed` (a `UserInputError`, which the action already shows as a validation message) in `changePriority`, `addPublicReply` and `addInternalNote`. The `moveQueue` guard already existed; its plain `Error` became a `UserInputError` so staff see the sentence instead of the generic failure line. |

## Verification (run by the executor)

| Command | Result |
|---------|--------|
| `npx vitest run tests/authz-scope-state.integration.test.ts --no-file-parallelism --testTimeout=60000` | 1 file passed, 413 tests passed, 100 skipped (see below), 514 s, Testcontainers Postgres |
| `npx vitest run tests/authz-revocation.integration.test.ts --no-file-parallelism --testTimeout=60000` | 1 file passed, 15 tests passed, 70 s |
| `npx vitest run tests/authz-inventory.test.ts` | 18 passed |
| `npx vitest run tests/publish-service.test.ts tests/ticket-service.test.ts tests/ticket-staff-commands.test.ts tests/scheduled-session-service.test.ts tests/ticket-phase-invariants.test.ts tests/ticket-lifecycle.test.ts` | 118 passed, 1 failed (`ticket-phase-invariants` nav wiring: pre-existing, already in `deferred-items.md` from 15-21) |
| `npx vitest run tests/publish.integration.test.ts tests/ticket-rbac.integration.test.ts tests/ticket-concurrency.integration.test.ts tests/ticket-access.integration.test.ts --no-file-parallelism` | 26 passed |
| `npx vitest run tests/captions-authoring.integration.test.ts tests/cohort-lifecycle-security.integration.test.ts tests/cohort-service.test.ts tests/components/course-detail-actions.test.tsx tests/enrolment-session-drain.integration.test.ts tests/staff-support-actions.test.ts --no-file-parallelism` | 109 passed |
| `npx eslint` on the three new test files, the registry and the fixtures | clean |
| `npx tsc --noEmit` | clean |

The 100 skipped tests are the claimed-scope variants that do not apply to an entry (they only make sense where a second record id rides along with the cohort or course id); they are skipped by the test itself, not counted as cases.

## Evidence

`evidence/authz-scope-state-local.json`: **416 cases, 416 passed**; 74 scoped entries (69 RECORD, 5 COLLECTION); 56 stateful entries with 77 state cases; 101 distinct entries in total.

| Kind | Cases |
|------|-------|
| tracer (cancelEnrolmentAction: wrong cohort, right cohort, cancelled enrolment) | 3 |
| wrong scope (3 scoped personas x 69 entries, plus route variants) | 216 |
| wrong scope, claimed own cohort or course beside another scope's record | 20 |
| wrong scope, target outside the caller's reach (transfer into another cohort) | 1 |
| right scope (positive control, fresh database each) | 69 |
| collection scope | 30 |
| record state | 77 |

## What each section proves

- **Scoped entries covered: 74.** The three wrong-scope people (`staffCohortB`, `staffCourseB`, `staffProgrammeZ`) each hold **every** cohort-scopable permission at their scope, so a refusal can only be the scope. Every refusal is checked for: refused, an `authorization.denied` row for the caller naming the entry's permission (unless the registry says the entry authorizes without the audited choke point), no change to any table except the audit trail (before/after digest of every table), and no record id in the answer.
- **Positive controls.** The correctly scoped person (cohort A, course A or programme A, by the record's level) gets no denial row and a non-denial answer on a freshly reset database. Two entries need a different person, each documented in `POSITIVE_OVERRIDES`: a transfer needs both cohorts, so staff scoped to the course move the enrolment to a sibling cohort of the same course (and a separate case proves staff scoped to the source cohort only are refused a transfer into a cohort they do not manage); creating an assessment is Global-only (see Observations). For three routes whose 404 means both "denied" and "nothing to serve", the right person must get the same status as Global staff on identical records.
- **Collection entries (5).** Exports: staff scoped to cohort A, course A, cohort B, course B and a programme with no cohorts, and Global staff, each request the enrolments export and the reconciliation refund export; the frozen snapshot holds exactly the rows in scope (A sees only A, B only B, the empty programme nothing, Global both) and the recorded scope is LIMITED for every scoped caller. The sensitive-columns hint returns only column keys. Role grants: staff scoped to a cohort cannot grant at Global scope, on another cohort, or on a course; a delegate holding only `roles.manage` cannot hand out a role carrying a permission they lack (grant ceiling); each is refused with nothing created, and the same staff succeed on their own cohort. Revocations follow the same pattern against the assignment's real stored scope.
- **Record states: 56 entries, 77 cases.** Cancelled or completed cohort (enrolment add and approve, publish, cancel), cancelled or withdrawn enrolment (approve, cancel, withdraw, transfer, lesson progress override, certificate issue, learner lesson, quiz and submission actions), cancelled session (cancel, update, attendance save and correct), paid, refunded, cancelled and unpaid orders (manual payment, refund, learner pay), revoked and superseded certificates, closed ticket (nine staff commands and the learner reply, close and reopen), archived course and programme, released and draft grades, resolved reconciliation case, archived template, submitted quiz attempt, expired, failed and succeeded exports, not-ready uploads (409), anonymised account. Each is refused with its domain message and writes nothing, and the caller is never given an authorization denial.
- **Deliberate idempotent repeats (5), each requiring zero writes:** manual payment on a PAID or REFUNDED order answers `ALREADY_PAID` (PAY-04), releasing a released grade, resolving a resolved reconciliation case, deactivating a deactivated account. They are marked `idempotent` in `STATE_CASES` with the reason, and the test fails if any of them writes.
- **Revocation (15 cases).** Five ways a grant stops working (end instant passed, assignment revoked, assignment switched off, role deactivated, role stripped of the permission) and three ways a session stops (revoked, expired, account deactivated), each refused on the very next request, with the unauthenticated denial row (no actor) for the session cases. The request-scoped caches from plan 15-09 do not break this.

## End-instant rule (plan wording differs from the code)

The plan's truth says a grant whose end instant equals the request time is treated as ended. The code does not: `isGrantActive` ends a grant only when `endsAt < now`, so **a grant is still in force AT its end instant and ended one millisecond later**; the start instant is likewise inclusive (`startsAt > now` is the not-yet-started test). The test asserts the rule as the code defines it, with a fixed clock through the same `createWithPermission` factory the live check is built from (one millisecond before, at, one millisecond after, a day after). This is **not a finding**: access is never allowed after the stated end, only at the very instant of it. If the owner prefers an exclusive end, the change is `<=` in `isGrantActive`, and the boundary test then needs the one expectation flipped.

Concurrency: calls started after the end are all refused (a read and a write that creates nothing). In a 30-call burst racing a revocation, every call that **starts after the revocation committed** is refused and none wrote a row (calls already in flight before the commit may succeed, as the plan allows); a 16-call burst racing a session revocation behaves the same.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unarchive worked on a record that was not archived (defect 1)**
- **Found during:** Task 2 (record states)
- **Fix:** `NotArchivedError` guard in both unarchive operations and the two action mappings.
- **Files modified:** `src/server/services/publish-service.ts`, `src/app/staff/courses/[id]/publish-actions.ts`, `src/app/staff/programmes/[id]/publish-actions.ts`

**2. [Rule 1 - Bug] Publishing an archived course or programme succeeded (defect 2)**
- **Found during:** Task 2
- **Fix:** `ArchivedRecordError` in `createPublishOperation`, mapped in both action files.
- **Files modified:** same three files.

**3. [Rule 1 - Bug] A session could be cancelled twice (defect 3)**
- **Found during:** Task 2
- **Fix:** refuse a cancelled session with `SessionCancelledError` before the transaction.
- **Files modified:** `src/server/services/scheduled-session-service.ts`

**4. [Rule 1 - Bug] A closed ticket accepted staff priority, reply and note changes (defect 4)**
- **Found during:** Task 2
- **Fix:** `assertTicketNotClosed` in three commands; `moveQueue`'s plain `Error` became a `UserInputError`.
- **Files modified:** `src/server/services/ticket-service.ts`

**5. [Rule 3 - Blocking] The registry file is outside the plan's file list**
- `tests/support/authz-registry.ts` gained `recordStates` on 56 entries (and its doc comment now describes the field). The field and the plan's key link (`filters ACTION_REGISTRY and ROUTE_REGISTRY by scope and recordStates`) were provided for exactly this by 15-25, and the 15-25 inventory test still passes (18). `tests/support/authz-inputs.ts` and `authz-matrix.ts` were not edited, as the plan requires.
- **Files modified:** `tests/support/authz-registry.ts`

**6. [Scope] `.planning/.../deferred-items.md` gained three rows** (record-state gaps left for an owner decision, `assessments.create` being Global-only, the per-download denial audit row on the certificate route). Each is described in Observations.

Commit: none (project rule: nothing is committed by the executor). `actuals.commits: 0`.

### Not adjusted, on purpose

- `reissueCertificateAction` has no state case: a revoked certificate may legitimately be reissued once the learner completes again, and for a superseded one the completion check refuses first, so the state is not what the refusal isolates.
- Further states answer success today (see Observations). No document states a rule for them, so they are not declared and behaviour was not changed.

## Observations (not bypasses; owner decisions, recorded in `deferred-items.md`)

- Staff are not refused for: a new session on a CANCELLED or COMPLETED cohort; editing a CANCELLED cohort; publishing an ARCHIVED assessment (it goes straight to PUBLISHED, unlike a course); a repeat archive of a course, programme, assessment or template; withdrawing a withdrawn lesson, saving a withdrawn lesson, renaming a withdrawn module, restoring a module that is not withdrawn. Each answered success on a fresh database; the write effect of the last four was not analysed.
- `assessments.create` is effectively Global-only: the resource service's create resolves its scope to `{}`, so course-scoped staff cannot create an assessment for their own course. It fails safe.
- A learner downloading their own certificate writes an `authorization.denied` audit row for the staff probe every time.
- Pre-existing, not touched: `tests/ticket-phase-invariants.test.ts` nav wiring (15-21 row), and the known `/staff/reconciliation/[caseId]` Postgres 42P18 defect (15-19 row; this plan calls the reconciliation actions directly and never opens that page).

## Limitations

- Two routes (`GET /api/lesson-resources/[id]/captions`, `GET /api/certificates/[id]/download`) answer 404 for "nothing to serve" as well as for a denial, and the test environment has no object store, so their positive control proves parity with Global staff (same status on identical records), not a 302.
- The claimed-scope variant applies where a second record id rides along with the cohort or course id: 20 of the action x scope pairs. For entries that take only a cohort or course id, claiming another scope is just a legitimate request for that scope.
- Several state refusals carry a generic domain message (the learner support, attempt and certificate-issue messages do not name the state); they are refused with no writes and no authorization denial, which is the assertion, but the cause is not pinned by text.

## Owner to-dos

1. Decide the rule for each row in the 15-26 observation list in `deferred-items.md`; add the guard and a `recordStates` / `STATE_CASES` pair for each "refuse".
2. Decide whether course-scoped staff should be able to create assessments for their own course (one-line scope change in `assessment-service.ts`).
3. Decide whether the end instant should be exclusive (`<=` in `isGrantActive`); today a grant holds at its end instant and ends one millisecond later.
4. Review and commit the working-tree changes (the four fixes touch `publish-service.ts`, both publish-action files, `scheduled-session-service.ts`, `ticket-service.ts`). No migration, no schema change, nothing for the Neon go-live list.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; the four fixes only add refusals.

## Self-Check: PASSED

Re-verified against the commands above: the scope-state matrix (413 passed, evidence 416 = 416), the revocation file (15 passed), the inventory test (18 passed), lint and type-check clean, and the related unit and integration suites. A line-by-line plan review was done by the executor against the plan's three tasks and four truths: tracer (Task 1), scope and state matrix with evidence (Task 2), revocation with four behaviours as separate `it` blocks (Task 3). Task 3 is marked `tdd="true"`, but it adds tests over behaviour that already exists and changes no source, so there was no failing RED to commit; no commits were made at all (project rule), so no test/feat gate commits exist.
