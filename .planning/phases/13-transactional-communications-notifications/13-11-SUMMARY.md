---
phase: 13-transactional-communications-notifications
plan: 11
subsystem: communications
tags: [outbox, drain, rbac, sql, prisma, postgres, vitest, staff-alerts]

# Dependency graph
requires:
  - phase: 13-transactional-communications-notifications (Plan 07)
    provides: event-intent-mappers.ts contract (EventMapper/MapperGroup/EventIntent), buildMapperTable, domain-event-drain-service.ts (including the onEmailFailed hook point this plan binds), tests/support/drain-harness.ts
  - phase: 13-transactional-communications-notifications (Plan 08)
    provides: the enrolment-payment group's own order.exception learner mapper, which this plan's staff order.exception mapper now fans out alongside
  - phase: 13-transactional-communications-notifications (Plan 04)
    provides: email-dispatch-service.ts's sendQueued failed[] shape ({id, template, userId}) this plan's alert service consumes
  - phase: (existing) src/server/permissions/scope.ts
    provides: grantMatches/hasPermission/isGrantActive — the semantics staff-recipient-service.ts's SQL reproduces
provides:
  - "resolveStaffHolders/createStaffRecipientResolver — drain-safe SQL resolver reproducing grantMatches/isGrantActive/hasPermission, parity-tested against the real authorization core across the full grant matrix"
  - "createStaffMappers — ticket.created, ticket.assigned, ticket.escalated, order.exception, payment.reconciliation_exception, submission.created, registered in EVENT_MAPPER_GROUPS"
  - "createEmailFailureAlertService/emailFailureAlertService.notifyFailed — administrator in-product alert when an EmailDispatch reaches FAILED, wired into the drain's onEmailFailed hook"
affects: [13-13 — the phase's final acceptance-run plan, now unblocked]

# Actuals (#2632) — pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 34300
  tasks: 3
  commits: 7
  # Caveat: staff-recipient-service.ts, event-mappers/staff.ts, event-intent-mappers.ts
  # (registration), tests/staff-recipient-service.test.ts and
  # tests/staff-drain.integration.test.ts already existed, complete and correct, on
  # disk when this run started (an interrupted prior session's uncommitted work) —
  # this run verified, ran, and committed them rather than authoring them fresh.
  # Task 3 (email-failure-alert-service.ts and both its test files) and the
  # event-mappers-staff.test.ts / event-mappers-enrolment-payment.test.ts fix were
  # authored fresh this run. The tokens figure above is chars/4 over every file this
  # plan's commits touch, per the instruction; net-new authorship this session is
  # concentrated in Task 3 plus ~650 lines of new/fixed test code.

tech-stack:
  added: []
  patterns:
    - "Drain-safe permission resolution: one parameterised raw SQL query (User/Assignment/Role) reproduces grantMatches/isGrantActive exactly, with optional GLOBAL/COHORT/PROGRAMME/COURSE scope branches omitted (not wildcarded) when the caller's ResourceScope field is undefined — proven equal to hasPermission over loadGrantsForUser by a real-Postgres parity test across the full grant matrix rather than trusted by inspection."
    - "A shared reason-to-label allow-list (ORDER_EXCEPTION_REASON_LABELS) renders a fixed plain-language string for known codes and a generic fallback for anything else, never the raw code — the same pattern income-sensitive staff mail should use whenever a coded machine reason must reach a human without exposing internals."
    - "The email-failure alert never writes EmailDispatch (no mail about a failed email — T-13-45) and never throws (its own try/catch, belt-and-suspenders with the drain's existing onEmailFailed try/catch from Plan 07) so a broken alert can never surface as a broken drain."

key-files:
  created:
    - src/server/services/staff-recipient-service.ts
    - src/server/services/event-mappers/staff.ts
    - src/server/services/email-failure-alert-service.ts
    - tests/staff-recipient-service.test.ts
    - tests/event-mappers-staff.test.ts
    - tests/staff-drain.integration.test.ts
    - tests/email-failure-alert-service.test.ts
  modified:
    - src/server/services/event-intent-mappers.ts
    - src/server/services/domain-event-drain-service.ts
    - tests/domain-event-drain.integration.test.ts
    - tests/event-mappers-enrolment-payment.test.ts

key-decisions:
  - "Tasks 1 and 2's file set (staff-recipient-service.ts, event-mappers/staff.ts with all six mappers, tests/staff-drain.integration.test.ts) was found already complete and correct on disk from an interrupted prior session — verified against every read_first source (ticket-service.ts, checkout-webhook-system-service.ts, payment-reconciliation-service.ts, submission-service.ts, staff-templates.ts, links.ts, contracts.ts) line by line rather than re-authored, then committed as Task 1's own atomic commit plus a combined Task 1+2 mapper commit, since the six mappers live in one physical file that cannot be honestly split into a partial Task-1-only version without destructive reconstruction."
  - "Registering createStaffMappers() in EVENT_MAPPER_GROUPS made order.exception fan out to two mappers (the existing enrolment-payment learner mapper plus the new staff mapper) — this broke four pre-existing tests/event-mappers-enrolment-payment.test.ts cases whose requireOneMapper(\"order.exception\") helper asserted exactly one registrant. Fixed (Rule 1, a direct regression from this plan's own registration change) by pulling the enrolment-payment group's own mapper directly off createEnrolmentPaymentMappers() instead of the merged table, so that suite stays isolated to the learner-facing mapper regardless of what any other group registers for the same event type."
  - "tests/event-mappers-staff.test.ts enters the event-mappers/staff.ts <-> event-intent-mappers.ts module cycle from the aggregator side first (a real value import of buildMapperTable/EVENT_MAPPER_GROUPS before importing createStaffMappers) — entering from staff.ts's own side first hits a genuine TDZ (ticketCreatedStaffAlert accessed before its own module finishes initializing), matching the same reasoning tests/event-mappers-enrolment-payment.test.ts's header already documents for its own group."
  - "email-failure-alert-service.ts calls resolveStaffHolders directly (not through an injectable resolver) — the unit test fakes db.$queryRaw/notification.createMany directly rather than adding an extra indirection layer the plan's own action text never asked for."
  - "dispatchRef is exactly the last 8 characters of the dispatch id (String.slice(-8)) — verified in both the unit test (against multiple id shapes) and the real-Postgres integration test (against a real cuid)."
  - "Per this run's explicit instruction (overriding the commit_policy_override convention Plans 07-10/12 recorded — the project's standing 'never auto-commit' preference), every task in this plan was committed atomically per the standard GSD executor workflow: 7 commits total (Task 1: resolver+parity test; Task 1+2 combined: all six mappers + integration test, since the file is physically unified; a dedicated unit-test commit that also carries the Rule-1 regression fix; Task 3's RED/GREEN pair; the drain-wiring commit; and a follow-up fix for a test assertion bug this run's own review caught). No commits were made for the ~90 other pre-existing uncommitted files from Plans 01-10/12 sitting in the same working tree — those remain exactly as this run found them, untouched and unstaged, since they are out of this plan's scope."

requirements-completed: []
# COM-01/COM-03 are declared by this plan's frontmatter, but 13-13 also declares
# both and has no SUMMARY.md yet. `gsd_run query requirements.ready-ids
# .planning/phases/13-transactional-communications-notifications/13-11-PLAN.md
# COM-01,COM-03` (correct positional syntax) returned {"ready":[],"blocked":
# ["COM-01","COM-03"]} — nothing marked complete in REQUIREMENTS.md by this plan,
# consistent with 13-08/13-09/13-10/13-12's identical handling of the same shared IDs.

coverage:
  - id: D1
    description: "resolveStaffHolders returns exactly the same user set as hasPermission/isGrantActive over loadGrantsForUser across the full grant matrix (global, cohort, programme, course, wrong scope id, inactive role, revoked, expired, not-yet-started, deactivated, non-staff) — proven against a real, throwaway Testcontainers Postgres, not trusted by code inspection"
    requirement: "COM-03"
    verification:
      - kind: integration
        ref: "tests/staff-recipient-service.test.ts (real Postgres)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A cohort-scoped grant for a different cohort is absent from a cohort-scoped result while a global holder is present for every scope; boundary window instants (startsAt/endsAt at the current moment) are still active, matching isGrantActive's inclusive semantics"
    requirement: "COM-03"
    verification:
      - kind: integration
        ref: "tests/staff-recipient-service.test.ts (real Postgres)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Draining ticket.created notifies every global tickets.manage holder except the requester and a deactivated holder, with zero EmailDispatch rows (D-08, D-20)"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/event-mappers-staff.test.ts"
        status: pass
      - kind: integration
        ref: "tests/staff-drain.integration.test.ts (real Postgres)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ticket.assigned mails and notifies the payload assignee; ticket.escalated mails and notifies only the Ticket row's assigneeId when set, else notifies (no email) every global tickets.manage holder (A-03)"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/event-mappers-staff.test.ts"
        status: pass
      - kind: integration
        ref: "tests/staff-drain.integration.test.ts (real Postgres)"
        status: pass
    human_judgment: false
  - id: D5
    description: "order.exception and payment.reconciliation_exception email and notify only payments.view holders whose scope reaches the order's cohort; templateParams carry only orderReference/reasonLabel/paymentPath (or orderReference/paymentPath) — never exceptionNote, free-text reason, or provider detail; an unknown reason code renders the generic 'Payment needs review' label rather than the raw code"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/event-mappers-staff.test.ts"
        status: pass
      - kind: integration
        ref: "tests/staff-drain.integration.test.ts (real Postgres)"
        status: pass
    human_judgment: false
  - id: D6
    description: "submission.created creates an in-product notification (no email) only for submissions.view holders whose scope reaches the submission's own enrolment cohort — a grader scoped to a different cohort and a non-holder both receive nothing"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/event-mappers-staff.test.ts"
        status: pass
      - kind: integration
        ref: "tests/staff-drain.integration.test.ts (real Postgres)"
        status: pass
    human_judgment: false
  - id: D7
    description: "When an EmailDispatch reaches FAILED in Pass 2, every global audit.view holder gets exactly one staff.email_failed notification (targetType STAFF_EMAIL_LOG, params limited to template and an 8-character dispatchRef), a non-holder gets none, a second drain over the same FAILED state adds no duplicate, no EmailDispatch row is ever created by the alert, and two failures in one run raise exactly two alerts while zero failures call the service zero times"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/email-failure-alert-service.test.ts"
        status: pass
      - kind: integration
        ref: "tests/domain-event-drain.integration.test.ts (real Postgres, administrator-alert describe block)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The drain's runtime import closure (netlify/functions/drain-domain-events.ts) never reaches @/server/permissions or its submodules — the staff resolver and mappers import only Permission/ResourceScope as types"
    requirement: "COM-03"
    verification:
      - kind: integration
        ref: "tests/boundary.test.ts"
        status: pass
    human_judgment: false

# Metrics
duration: ~75min
completed: 2026-09-28
status: complete
---

# Phase 13 Plan 11: Staff Alerts, Permission-Scoped Recipients, and the Failed-Email Administrator Alert Summary

**A drain-safe SQL resolver parity-tested against the real authorization core, six staff mappers (new ticket, assignee/escalation mail, cohort-scoped payment and submission alerts with a coded-reason allow-list), and an administrator in-product alert wired into the outbox drain's Pass 2 for any email that reaches FAILED — no mail loop, no leaked recipient/body/provider detail.**

## Performance

- **Duration:** ~75 min (includes Docker Desktop cold start and several multi-minute real-Postgres test runs)
- **Tasks:** 3 (all complete)
- **Files:** 7 created, 4 modified

## Accomplishments

- **Task 1 (tracer):** `src/server/services/staff-recipient-service.ts` (`resolveStaffHolders`/`createStaffRecipientResolver`) — one parameterised raw SQL query over `User`/`Assignment`/`Role` reproducing `grantMatches`/`isGrantActive`/`hasPermission` exactly: GLOBAL always matches, a COHORT/PROGRAMME/COURSE branch is included only when the caller's `ResourceScope` actually carries that field (an absent field omits the branch rather than wildcarding it), every value bound as a parameter. `tests/staff-recipient-service.test.ts` proves parity against the real authorization core (`hasPermission` over `isGrantActive`-filtered `loadGrantsForUser`-shaped data) across the full grant matrix — global, cohort, programme, course, wrong scope id, inactive role, revoked, expired, not-yet-started, deactivated, non-staff — plus a boundary-window inclusivity case, all against a real, throwaway Testcontainers Postgres. `src/server/services/event-mappers/staff.ts` (`createStaffMappers`) maps `ticket.created` to a notification-only alert for every global `tickets.manage` holder except the requester (D-08), registered in `EVENT_MAPPER_GROUPS` via `event-intent-mappers.ts`.
- **Task 2:** The same `staff.ts` file (found already complete on disk, verified line-by-line against every real producer: `ticket-service.ts`, `checkout-webhook-system-service.ts`, `payment-reconciliation-service.ts`, `submission-service.ts`) adds `ticket.assigned` (mails/notifies the payload assignee), `ticket.escalated` (mails/notifies only the Ticket row's `assigneeId` when set — loaded fresh since the payload never carries it — else notification-only fan-out to global `tickets.manage` holders, A-03), `order.exception`/`payment.reconciliation_exception` (email+notify every `payments.view` holder whose scope reaches the order's cohort, built from named fields only through a fixed `ORDER_EXCEPTION_REASON_LABELS` allow-list — `exceptionNote`/free-text reason/provider detail are never read, T-13-75), and `submission.created` (notification-only for `submissions.view` holders scoped to the submission's own enrolment cohort, D-20). Wrote `tests/event-mappers-staff.test.ts` from scratch — pure unit coverage against a fake transaction client (fakes `$queryRaw` directly rather than hitting Postgres for the pure branching logic) covering the null-assignee escalation, an unmapped-but-string vs. a missing queue label, the unknown-reason fallback, hostile `exceptionNote`/reason keys never copied, and every missing-row edge — plus real-Postgres scenarios already present in `tests/staff-drain.integration.test.ts` (cohort-scoped grader vs. a grader scoped elsewhere, a `payments.view` holder scoped to the order's cohort vs. one scoped elsewhere vs. a non-holder, escalation with and without an assignee).
- **Task 3:** `src/server/services/email-failure-alert-service.ts` (`createEmailFailureAlertService`/`emailFailureAlertService.notifyFailed`) — written test-first (confirmed RED: `Cannot find package '@/server/services/email-failure-alert-service'` before the implementation existed, confirmed GREEN after). Resolves global `audit.view` holders with `resolveStaffHolders` and an empty scope, creates one `staff.email_failed` `Notification` per holder (`targetType STAFF_EMAIL_LOG`, `targetId`/`sourceEventId` the dispatch id, `params` limited to `template` and an 8-character `dispatchRef`) via `createMany({ skipDuplicates: true })`, never writes an `EmailDispatch` row, and never throws — a failure resolving holders or writing the notification is caught and logged internally. Wired into `domain-event-drain-service.ts`'s live singleton as `onEmailFailed: (failure) => emailFailureAlertService.notifyFailed(failure)`. `tests/email-failure-alert-service.test.ts` (9 cases, fake `db`) proves the params shape, the dedupe-intent (`skipDuplicates: true` on every call), zero-holders-yields-no-write, and both internal-failure isolation paths. `tests/domain-event-drain.integration.test.ts` gained a new real-Postgres describe block: a permanently failing send leaves the row `FAILED` and creates exactly one alert per global `audit.view` holder (none for a non-holder, none of the recipient's email address in any persisted row), a second drain adds none, two permanently failing dispatches in one run call the alert service exactly twice (`vi.spyOn`), and a run with zero failures calls it zero times.

## Task Commits

Each task was committed atomically per the standard GSD executor workflow (explicit instruction for this run, overriding the `commit_policy_override` convention Plans 07-10/12 recorded — see Decisions):

1. **Task 1 (resolver):** `b190ed7` — `feat(13-11): drain-safe staff recipient resolver, parity-tested (D-20, T-13-13)`
2. **Task 1+2 (mapper group, combined — see Decisions for why):** `f096907` — `feat(13-11): staff mapper group - ticket, escalation, payment and submission alerts (D-08, D-20, A-03, T-13-75)`
3. **Task 2 (dedicated unit test + regression fix):** `217b5c3` — `test(13-11): unit coverage for the staff mapper group; fix order.exception ambiguity in the enrolment-payment suite`
4. **Task 3 RED:** `084d1e8` — `test(13-11): failing unit spec for the email-failure alert service (RED, D-08, T-13-76, T-13-45)`
5. **Task 3 GREEN:** `868ca6a` — `feat(13-11): email-failure-alert-service - administrator alert on a permanently FAILED dispatch (GREEN, D-08, T-13-76, T-13-45)`
6. **Task 3 (drain wiring + integration test):** `364d080` — `feat(13-11): wire the email-failure alert into the drain's Pass 2 (D-08)`
7. **Follow-up fix (found by this run's own final verification pass):** `190be5e` — `fix(13-11): correct ticket.created fan-out count in staff mapper registration test`

**Plan metadata:** see final commit below (this file + STATE.md + ROADMAP.md + REQUIREMENTS.md).

## Files Created/Modified

- `src/server/services/staff-recipient-service.ts` — `resolveStaffHolders`/`createStaffRecipientResolver`, the drain-safe SQL resolver
- `src/server/services/event-mappers/staff.ts` — `createStaffMappers`: all six staff mappers
- `src/server/services/email-failure-alert-service.ts` — `createEmailFailureAlertService`/`emailFailureAlertService`
- `src/server/services/event-intent-mappers.ts` — registers `createStaffMappers()` in `EVENT_MAPPER_GROUPS`
- `src/server/services/domain-event-drain-service.ts` — binds the live singleton's `onEmailFailed` to `emailFailureAlertService.notifyFailed`
- `tests/staff-recipient-service.test.ts` — real-Postgres parity test
- `tests/event-mappers-staff.test.ts` — fake-tx unit tests for all six staff mappers
- `tests/staff-drain.integration.test.ts` — real-Postgres drain tests for all six staff mappers
- `tests/email-failure-alert-service.test.ts` — fake-db unit tests for the alert service
- `tests/domain-event-drain.integration.test.ts` — extended with the administrator-alert real-Postgres describe block
- `tests/event-mappers-enrolment-payment.test.ts` — fixed to isolate the learner-facing `order.exception` mapper from the new staff fan-out

## Decisions Made

See `key-decisions` in frontmatter. Most consequential: Tasks 1 and 2's mapper file was found already complete from an interrupted prior session and was verified against every real producer rather than re-authored from scratch, then committed as two commits (resolver; combined mapper group) since the six mappers cannot be honestly split by task without reconstructing a fictional partial file.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug, direct regression from this plan's own change] `order.exception` fan-out broke `tests/event-mappers-enrolment-payment.test.ts`**
- **Found during:** Task 2, running the full plan verification suite for the first time
- **Issue:** Registering `createStaffMappers()` in `EVENT_MAPPER_GROUPS` (Task 1) made `mapperTable["order.exception"]` fan out to two mappers (the pre-existing enrolment-payment learner mapper plus the new staff mapper). Four pre-existing tests in `tests/event-mappers-enrolment-payment.test.ts` used a `requireOneMapper("order.exception")` helper that asserted exactly one registrant and failed with "expected length 1 but got 2".
- **Fix:** Added `requireEnrolmentPaymentOrderExceptionMapper()`, which pulls the mapper directly off `createEnrolmentPaymentMappers()` rather than the merged table, and repointed the four call sites at it. The suite stays isolated to the learner-facing mapper regardless of what any other group registers for the same event type — the exact pattern `event-intent-mappers.ts`'s own header comment already documents as intentional for this event.
- **Files modified:** `tests/event-mappers-enrolment-payment.test.ts`
- **Verification:** `npx vitest run tests/event-mappers-enrolment-payment.test.ts` — 19/19 pass.
- **Committed in:** `217b5c3`

**2. [Rule 1 - Bug, test-only, self-caught] `ticket.created` fan-out count wrong in a new registration sanity test**
- **Found during:** The final full plan-verification pass (background run), after Task 2's dedicated unit test file had already been committed
- **Issue:** A registration sanity check I added assumed only `createStaffMappers()` registers `ticket.created`, missing that `createSupportMappers()` (Plan 10) also registers it for the learner-facing confirmation mail — the real `mapperTable["ticket.created"]` fans out to two mappers, same as `order.exception`.
- **Fix:** Corrected the assertion to expect length 2 for `ticket.created` (alongside `order.exception`), length 1 for the four genuinely staff-exclusive types.
- **Files modified:** `tests/event-mappers-staff.test.ts`
- **Verification:** `npx vitest run tests/event-mappers-staff.test.ts` — 17/17 pass; `npx eslint tests/event-mappers-staff.test.ts` — 0 problems.
- **Committed in:** `190be5e`

---

**Total deviations:** 2 auto-fixed (both Rule 1, both test-only, both caused by this plan's own registration change or this plan's own test authoring — no production code was touched by either fix).
**Impact on plan:** No production behaviour changed. No scope creep — both fixes are inside files this plan's own `files_modified`/test set touches or directly regresses.

## Issues Encountered

- **Docker was initially not running** (`docker info` failed — `com.docker.service` was `Stopped`). Started Docker Desktop programmatically (`Start-Process`) and polled `docker info` until ready (~20s) before any test ran; every `<precondition>` (Docker running for `tests/support/pg.ts`) was met before its task began. No blocker to report.
- **Nothing in Phase 13 was committed before this run** (Plans 01-10 and 12 all recorded a `commit_policy_override` — "no commits made this run"). This run's instructions explicitly overrode that convention for this specific plan, so all of Tasks 1-3's own files were committed per the standard GSD executor workflow; the ~90 other pre-existing uncommitted files from Plans 01-10/12 were left exactly as found, untouched.
- **A real ESM module-cycle TDZ** (`event-mappers/staff.ts` <-> `event-intent-mappers.ts`, both directions eagerly evaluate at module scope) surfaced when `tests/event-mappers-staff.test.ts` first imported `createStaffMappers` directly — `ReferenceError: Cannot access 'ticketCreatedStaffAlert' before initialization`. Resolved by entering the cycle from the aggregator side first (a real value import of `buildMapperTable`/`EVENT_MAPPER_GROUPS`), matching the same pattern `tests/event-mappers-enrolment-payment.test.ts`'s header already documents.

## User Setup Required

None — no external service configuration required. No new npm dependency was added.

## Next Phase Readiness

- **Plan 13-11 is functionally complete.** All three tasks' `<acceptance_criteria>` and the plan-level `<verification>` command pass: `npx vitest run tests/staff-recipient-service.test.ts tests/event-mappers-staff.test.ts tests/staff-drain.integration.test.ts tests/email-failure-alert-service.test.ts tests/domain-event-drain.integration.test.ts tests/boundary.test.ts --no-file-parallelism` — 6 files, 72 tests, all pass (real Postgres via Testcontainers for the integration files). `npx tsc --noEmit` — clean.
- **Plan 13-13 (the last unexecuted plan in this phase) is now unblocked.** Its `depends_on: ["13-06", "13-11", "13-12"]` are all satisfied — 13-06 and 13-12 already had `SUMMARY.md` on disk before this run, and this run produces 13-11's. `gsd_run query init.execute-phase 13` should now list only `13-13-PLAN.md` under `incomplete_plans`/`runnable_plans`.
- **COM-01/COM-03 remain open in REQUIREMENTS.md** — 13-13 also declares both and has no `SUMMARY.md` yet (`requirements.ready-ids` returned `blocked` for both, correct positional syntax). They will flip to complete once 13-13 finishes.

## Known Stubs

None. Every mapper resolves real rows through `ctx.tx` and writes real `EmailDispatch`/`Notification` rows through the existing drain machinery; the alert service writes real `Notification` rows and nothing else.

## Threat Flags

None beyond the plan's own threat model. T-13-13 (elevation of privilege via a drifted resolver), T-13-46 (SQL injection via unparameterised scope values), T-13-75 (exceptionNote/reason/provider detail disclosure), T-13-45 (a mail loop from the failed-email alert), T-13-76 (failed-email alert content disclosure), T-13-44 (alert flood, accepted, bounded by the Pass-2 batch size) and T-13-48 (duplicate staff mail on a producer re-emit, accepted per A-11) are all covered by the tests referenced in `coverage` above. No new network endpoint, auth path, or schema change was introduced — every write goes through the pre-existing `EmailDispatch`/`Notification` tables via the pre-existing drain.

## Verification

- `npx vitest run tests/staff-recipient-service.test.ts tests/event-mappers-staff.test.ts tests/staff-drain.integration.test.ts tests/email-failure-alert-service.test.ts tests/domain-event-drain.integration.test.ts tests/boundary.test.ts --no-file-parallelism` — 6 files, 72 tests, all pass (real, throwaway Testcontainers Postgres for the integration files).
- `npx vitest run tests/event-mappers-enrolment-payment.test.ts` — 19/19 pass (the Rule-1 regression fix, re-confirmed standalone).
- `npx tsc --noEmit` — clean.
- `npx eslint` on every plan-touched file — 0 errors, 0 warnings.
- `gsd_run query requirements.ready-ids .planning/phases/13-transactional-communications-notifications/13-11-PLAN.md COM-01,COM-03` — correct positional syntax, returned `blocked` for both; REQUIREMENTS.md left untouched for COM-01/COM-03.

## Self-Check: PASSED

- All 7 created files and the 4 modified files exist on disk.
- All 7 commit hashes above (`b190ed7`, `f096907`, `217b5c3`, `084d1e8`, `868ca6a`, `364d080`, `190be5e`) exist in `git log --oneline --all`.
- `npx tsc --noEmit` re-run at the end of this session: clean.
- The full plan verification suite (6 files, 72 tests) was re-run in this session against a real, throwaway Testcontainers Postgres and passed.
- `gsd_run query requirements.ready-ids` was run with the correct positional syntax and returned `blocked` for both COM-01 and COM-03; REQUIREMENTS.md was left untouched for both.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-28*
