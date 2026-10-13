---
phase: 13-transactional-communications-notifications
plan: 09
subsystem: communications
tags: [outbox, drain, prisma, postgres, jsonb, coalescing, cohort-cancellation, vitest]

# Dependency graph
requires:
  - phase: 13-transactional-communications-notifications (Plan 01)
    provides: DomainEvent model, communications/contracts.ts vocabulary (TEMPLATE_CATEGORY, SKIP_REASONS, NOTIFICATION_TYPE_TARGET, buildCorrelationId)
  - phase: 13-transactional-communications-notifications (Plan 02)
    provides: enrolment-withdrawn/enrolment-cancelled/enrolment-transferred/session-updated/session-cancelled/cohort-cancelled template param shapes and copy
  - phase: 13-transactional-communications-notifications (Plan 07)
    provides: event-intent-mappers.ts contract (EventMapper/MapperGroup/EventIntent), buildMapperTable, domain-event-drain-service.ts, tests/support/drain-harness.ts
  - phase: 13-transactional-communications-notifications (Plan 08)
    provides: the enrolment-payment mapper group as the precedent for this plan's group shape and registration pattern
provides:
  - "createEnrolmentSessionMappers — mappers for enrolment.withdrawn, enrolment.cancelled, enrolment.transferred, session.cancelled, session.updated and cohort.cancelled, registered in EVENT_MAPPER_GROUPS beside the earlier two groups"
  - "The cohort-cancellation precedence pair (hasCohortCancellationPeer / findSupersededEnrolmentIds) — same cohortId/actorId/reason within a 60-second window, queried via parameterised Prisma.sql tagged templates over the DomainEvent JSONB payload"
  - "The session.updated coalescing/supersession pair (isSessionCancelled / hasNewerUnprocessedSessionUpdate) proving D-12's 'collapse to the latest, cancellation always wins' rule against a real drain claim order"
  - "skip reasons superseded_by_cohort_cancellation, superseded_by_session_cancellation and coalesced_into_later_update now have live producers wired into the drain"
affects: [13-10, 13-11, 13-13 — remaining/verification plans in this phase; any future mapper group follows the same createXMappers()/EVENT_MAPPER_GROUPS registration and tests/support/drain-harness.ts reuse pattern]

# Actuals (#2632) — pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 19000
  tasks: 3
  commits: 0   # commit_policy_override: no commits made this run — see Task Commits below

tech-stack:
  added: []
  patterns:
    - "One shared mapper function for the two DomainEventTypes that mean the same outcome (enrolment.withdrawn/enrolment.cancelled -> 'this enrolment's access has ended'), mirroring 13-08's enrolmentConfirmed precedent"
    - "Cohort-cancellation precedence is symmetric and bidirectional: the per-enrolment mapper checks forward (does a cohort.cancelled peer exist within 60s AFTER me?) and the cohort mapper checks backward (which enrolment events fall within 60s BEFORE me?) using the same cohortId/actorId/reason identity, so either event can be drained first with the same outcome"
    - "session.updated coalescing relies on the drain's own oldest-first FOR UPDATE SKIP LOCKED claim order rather than any bespoke sequencing: 'is there a still-unprocessed newer event for this session' is sufficient to make the last-drained event in a batch win"
    - "Every cross-event lookup (cohort-cancellation window, session-cancellation existence, newer-pending-update) is a parameterised Prisma.sql tagged template over the DomainEvent JSONB payload (payload->>'field' = ${value}) — never string concatenation (T-13-40)"

key-files:
  created:
    - src/server/services/event-mappers/enrolment-session.ts
    - tests/event-mappers-enrolment-session.test.ts
    - tests/enrolment-session-drain.integration.test.ts
  modified:
    - src/server/services/event-intent-mappers.ts

key-decisions:
  - "enrolment.withdrawn and enrolment.cancelled share one mapper function (enrolmentStatusChangeMail), exactly like 13-08's enrolmentConfirmed precedent for enrolment.activated/enrolment.approved — both mean 'this enrolment's access has ended' and differ only in template/notification type."
  - "The cohort-cancellation supersession check for enrolment.withdrawn/cancelled queries forward from the enrolment event's own occurredAt (looking for a cohort.cancelled peer up to 60s AFTER it), while the cohort.cancelled mapper queries backward (looking for enrolment events up to 60s BEFORE it) — both rows already exist by the time either is claimed (same cancelCohort transaction wrote them together), so which one the drain processes first never changes the outcome."
  - "session.updated's 'is this coalesced' check is framed as 'does a newer, still-unprocessed session.updated exist for this session' (occurredAt greater, or equal occurredAt with a greater id as a deterministic tie-break) rather than tracking a separate 'latest event' pointer — this composes correctly with the drain's own oldest-first claim order with no extra bookkeeping."
  - "cohort.cancelled resolves its affected users by finding the per-enrolment DomainEvent rows in the window and looking up their current userId via the enrolment table, then de-duplicating by userId before building intents — structurally impossible to double-mail a user even if two of their own enrolments were both swept into the same window (not something the platform allows today, but the dedup costs nothing and removes the assumption)."

requirements-completed: []
# COM-01/COM-02 are declared by this plan's frontmatter, but 13-10, 13-11 and
# 13-13 also declare them and have no SUMMARY.md yet. Per the shared-ID gate
# (#2388), `gsd_run query requirements ready-ids <this-plan-path> COM-01,COM-02`
# was run and returned {"ready":[],"blocked":["COM-01","COM-02"]} — nothing is
# marked complete in REQUIREMENTS.md by this plan. The correct positional
# invocation was used (see the known-defect note this run was briefed on);
# 13-08's SUMMARY already correctly left both open for the same reason.

coverage:
  - id: D1
    description: "A staff withdrawal or cancellation of a single enrolment (no cohort cancellation) mails the learner exactly once with enrolment-withdrawn/enrolment-cancelled and the matching notification; the staff reason never reaches any persisted column"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-session.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "A recipient who muted ENROLMENT_STATUS still gets a SKIPPED muted_by_recipient dispatch and exactly one notification (mute affects the mail, never the in-product notification)"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "enrolment.transferred mails the source enrolment's learner exactly once, naming both cohort titles and linking to the target enrolment"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-session.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "session.cancelled mails every learner with an ACTIVE enrolment in that cohort at drain time, once each, and nobody else (a WITHDRAWN learner gets nothing); the cancellation reason never reaches any persisted column"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-session.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Several pending session.updated events for one session, drained together, collapse into exactly one mail per ACTIVE learner carrying the session's latest details read at drain time; the older events leave SKIPPED coalesced_into_later_update rows"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-session.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "session.cancelled always sends and supersedes a pending session.updated for the same session — the update leaves a SKIPPED superseded_by_session_cancellation row and the cancellation mail goes out normally"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-session.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "A real cancelCohort of a cohort with 2 ACTIVE and 1 PENDING_PAYMENT enrolments (plus a learner who withdrew two days earlier) mails only the 3 affected learners once each with cohort-cancelled; the 3 per-enrolment withdrawn/cancelled events are recorded SKIPPED superseded_by_cohort_cancellation with zero QUEUED/SENT rows among them, the earlier-withdrawn learner gets nothing, and a second drain adds no new rows"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts (real cancelCohort service, tests/cohort-cancel.integration.test.ts harness pattern)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The 60-second cohort-cancellation precedence window is a real boundary: 59 seconds before/after supersedes, 61 seconds does not; a different actor or a different reason within the window is neither superseded nor swept into the cohort mail"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D9
    description: "Every cross-event lookup (cohort-cancellation window, session-cancellation existence, newer-pending-update) uses parameterised Prisma.sql tagged templates over the DomainEvent JSONB payload — no payload text is ever concatenated into SQL, and no reason string reaches any persisted email/notification param"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-session.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-session-drain.integration.test.ts"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false

# Metrics
duration: 70min
completed: 2026-09-28
status: complete
---

# Phase 13 Plan 09: Enrolment-Session Mapper Group — Coalescing, Cohort-Cancellation Precedence Summary

**One mapper group turns enrolment.withdrawn/cancelled/transferred, session.cancelled/updated and cohort.cancelled into exactly-once learner mail, with session.updated collapsing several pending events into the session's latest details and a cohort cancellation always winning over its own per-enrolment fan-out via a real, boundary-tested 60-second precedence window.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-09-28
- **Completed:** 2026-09-28
- **Tasks:** 3 (all complete)
- **Files:** 3 created, 1 modified

## Accomplishments

- **Task 1 (tracer):** `src/server/services/event-mappers/enrolment-session.ts` created, exporting `createEnrolmentSessionMappers()` and registered in `EVENT_MAPPER_GROUPS` (`event-intent-mappers.ts`) beside the support and enrolment-payment groups. `enrolmentStatusChangeMail` handles both `enrolment.withdrawn` and `enrolment.cancelled` with one function — loads the enrolment's `userId`/cohort title through `ctx.tx`, returns `[]` when the enrolment no longer exists, otherwise one intent (matching template/notification type, `cohortTitle`-only params, `LEARNER_DASHBOARD` notification targeting the enrolment id). The staff reason is never read at this stage. Proven with `tests/event-mappers-enrolment-session.test.ts` (fake tx: withdrawn, cancelled, missing enrolment, hostile-reason-never-leaked) and `tests/enrolment-session-drain.integration.test.ts` (real Postgres via the shared drain harness): exactly one `enrolment-withdrawn` dispatch + notification for a withdrawal, one `enrolment-cancelled` pair for a cancellation, a muted-`ENROLMENT_STATUS` recipient getting a `SKIPPED muted_by_recipient` dispatch but still one notification, and the missing-enrolment edge case.
- **Task 2:** Added `enrolmentTransferredMail` (loads the source enrolment and the target cohort, mails the source learner once with both cohort titles and the target enrolment's path/notification), `sessionCancelledMail` (fans out to every enrolment with `status: "ACTIVE"` in the payload's `cohortId` at drain time, correlationId suffixed per-recipient so the `(template, correlationId)` unique constraint never collides across a fan-out), and `sessionUpdatedMail` (reads the session's *current* title/start/end/location from the database, never the payload — Pitfall 5). Two new cross-event lookups back `sessionUpdatedMail`'s D-12 rule, both parameterised `Prisma.sql` tagged templates over `DomainEvent`: `isSessionCancelled` (the session row's own `cancelledAt`, OR any `session.cancelled` `DomainEvent` for the same session — checked first, since cancellation always wins) and `hasNewerUnprocessedSessionUpdate` (`processedAt IS NULL` and a later `occurredAt`, or equal `occurredAt` with a greater `id` as a tie-break — checked second). Extended both test files: unit coverage for the transfer mapper, session-cancelled fan-out (with a withdrawn learner excluded), session-updated's location-conditional params, the coalescing/supersession precedence order, and the zero-active-enrolments edge; the integration file proves — against real Postgres — a 3-ACTIVE/1-WITHDRAWN cohort's `session.cancelled` mailing exactly the three actives, three pending `session.updated` events for one session collapsing to one `QUEUED` mail per learner with two `SKIPPED coalesced_into_later_update` rows each (the session row mutated mid-sequence to prove "latest details read at drain time"), and an update-then-cancellation sequence leaving the update `SKIPPED superseded_by_session_cancellation` while the cancellation sends normally.
- **Task 3:** Added `cohortCancelledMail` and the bidirectional cohort-cancellation precedence pair. `findSupersededEnrolmentIds` (used by `cohortCancelledMail`) finds the `enrolment.withdrawn`/`enrolment.cancelled` `DomainEvent` rows with the same `cohortId`/`actorId`/`reason` recorded within 60 seconds up to the cohort event's own `occurredAt`, resolves their distinct users via the enrolment table, and returns one `cohort-cancelled` intent per user (correlationId suffixed per-recipient, same fan-out-safety pattern as Task 2). `hasCohortCancellationPeer` (added to `enrolmentStatusChangeMail` from Task 1) checks the mirror direction — does a `cohort.cancelled` event with the same identity exist within 60 seconds *after* this enrolment event — and when true, the mail becomes `skipReason: superseded_by_cohort_cancellation` with no notification. Both queries are parameterised `Prisma.sql` tagged templates comparing `payload->>'field'` as bound parameters, never concatenated (T-13-40); the reason string is read only inside these comparisons and never copied into any email/notification param. Extended the unit tests with the 60-second identity/window boundaries expressed as call-count/parameter assertions on a mocked `$queryRaw`, and extended the integration file with: four real-Postgres boundary cases (59s superseded, 61s not superseded, different-actor-not-superseded, different-reason-not-superseded) and — the plan's headline scenario — a run of the **real** `cancelCohort` service (built the same way `tests/cohort-cancel.integration.test.ts` does, proving genuine event shapes, not a hand-simulated approximation) against a cohort with 2 ACTIVE + 1 PENDING_PAYMENT enrolments plus a learner who withdrew two days earlier: exactly 3 `cohort-cancelled` dispatches (one per affected learner), the 3 per-enrolment events left `SKIPPED superseded_by_cohort_cancellation` with zero `QUEUED`/`SENT` rows among them, the earlier-withdrawn learner receiving nothing, and a second drain adding no new rows.

## Task Commits

**No commits were made in this run** — the project owner's standing rule requires an explicit ask for each commit (`commit_policy_override`, reiterated for this run). All three tasks below are complete and verified in the working tree; hashes are `uncommitted`.

1. **Task 1: Tracer — a staff withdrawal reaches the learner as one enrolment-withdrawn mail and notification** - `uncommitted` (`feat(13-09): add createEnrolmentSessionMappers with the enrolment.withdrawn/enrolment.cancelled mapper, register the group, and prove the tracer end to end` + `test(13-09): add unit and real-Postgres tests for the withdrawn/cancelled mapper`)
2. **Task 2: Transfers, session cancellations and session updates with coalescing** - `uncommitted` (`test(13-09): add failing tests for enrolment.transferred, session.cancelled and session.updated coalescing/supersession` + `feat(13-09): add enrolmentTransferredMail, sessionCancelledMail, sessionUpdatedMail and the D-12 coalescing/supersession lookups`)
3. **Task 3: Cohort cancellation — one mail per affected learner and per-enrolment precedence** - `uncommitted` (`test(13-09): add failing tests for cohort.cancelled precedence, the 60-second window boundaries, and the real cancelCohort scenario` + `feat(13-09): add cohortCancelledMail and the bidirectional cohort-cancellation precedence check`)

**Plan metadata:** not committed (see above).

_Note on TDD sequencing: Tasks 2 and 3 (`tdd="true"`) were verified GREEN as a single implementation pass rather than strict alternating RED-commit/GREEN-commit cycles per task — see "Deviations from Plan" below for why and what was actually observed at each stage._

## Files Created/Modified

- `src/server/services/event-mappers/enrolment-session.ts` — `createEnrolmentSessionMappers`: `enrolmentStatusChangeMail` (Task 1, extended Task 3), `enrolmentTransferredMail`, `sessionCancelledMail`, `sessionUpdatedMail` (Task 2), `cohortCancelledMail` (Task 3), plus the four shared cross-event lookup helpers
- `src/server/services/event-intent-mappers.ts` — registers `createEnrolmentSessionMappers()` in `EVENT_MAPPER_GROUPS` beside `createSupportMappers()`/`createEnrolmentPaymentMappers()` (Task 1)
- `tests/event-mappers-enrolment-session.test.ts` — new; fake-tx unit tests for every mapper in the group, including the cohort-cancellation window/identity assertions against a mocked `$queryRaw` (Tasks 1–3)
- `tests/enrolment-session-drain.integration.test.ts` — new; real-Postgres drain tests via the shared `drain-harness.ts`, plus a real `cancelCohort` service harness mirroring `tests/cohort-cancel.integration.test.ts` (Tasks 1–3)

## Decisions Made

See `key-decisions` above. Most consequential: the cohort-cancellation precedence check is genuinely bidirectional (forward from the enrolment mapper, backward from the cohort mapper) so drain order between the sibling events never matters, since both rows are written in the same `cancelCohort` transaction before either is ever claimed.

## Deviations from Plan

### Process deviation (documented, not a Rule 1-4 auto-fix)

**TDD sequencing for Tasks 2 and 3 was collapsed into one implementation pass rather than strict per-task RED-commit/GREEN-commit alternation.**

- **Why:** `enrolment-session.ts` is one cohesive module where Task 2's session-mapper helpers and Task 3's cohort-cancellation helpers share the same file, the same `EventIntent`/`SkipReason` shapes, and (for the withdrawn/cancelled mapper) the exact same function that Task 1 wrote and Task 3 extends in place. Splitting the file into three separately-committed partial states would have meant temporarily reverting working code between commits with no commit actually happening in this run anyway (`commit_policy_override` — there is no commit boundary to sequence against).
- **What was actually observed:** The full mapper file (all three tasks' behaviour) and the full test suite (all three tasks' scenarios) were written together, then run once: `npx tsc --noEmit` was clean on the first pass after fixing one real bug (a `import type { Prisma }` that needed to be a value import to call `Prisma.sql` — a Rule 3 blocking-issue auto-fix, see below), and the unit suite failed exactly one assertion on the first run (a test's own wrong expectation about how many times a short-circuited `$queryRaw` mock would be called — the mapper code was correct, the test assertion was not; fixed in the test, re-ran, GREEN). The integration suite failed 8 of 15 on the first real-Postgres run, for two genuine reasons caught immediately: (1) several assertions expected dispatch `status: "QUEUED"` but the harness's `drain()` call runs Pass 2 (send) in the same call, so a successfully "sent" stub mail is `SENT` by the time the assertion runs — fixed by accepting either status everywhere delivery (not skip) is being asserted; (2) the real-`cancelCohort` scenario's audit call used a literal string as `actorId`, violating `AuditEvent`'s real foreign key to `User` — fixed by seeding a real actor user, mirroring `tests/cohort-cancel.integration.test.ts`'s own convention. Both are Rule 1 (bug in the test, not the mapper) fixes, applied and re-verified before this Summary was written.
- **Impact:** None on correctness — every task's `<acceptance_criteria>` and the plan-level `<verification>` command were independently re-run and pass. This is a transparency note about HOW the GREEN state was reached, not a claim that RED never happened: RED did happen (the two failures above), it was just discovered by running the full suite once rather than task-by-task.

### Auto-fixed issues

**1. [Rule 3 - Blocking] `Prisma` imported as type-only but used as a value**
- **Found during:** Task 1 (first `tsc --noEmit` after writing the file)
- **Issue:** `import type { Prisma } from "@prisma/client"` cannot be used to call `Prisma.sql(...)` at runtime — a type-only import erases at compile time.
- **Fix:** Changed to a value import (`import { Prisma } from "@prisma/client"`), matching `domain-event-drain-service.ts`'s own precedent (`import { Prisma, type PrismaClient } from "@prisma/client"`) — `Prisma` still provides the `Prisma.TransactionClient` type via its namespace.
- **Files modified:** `src/server/services/event-mappers/enrolment-session.ts`
- **Verification:** `npx tsc --noEmit` clean.

**2. [Rule 1 - Bug, in a test] Dispatch status assertions expected `QUEUED`, drain also sends**
- **Found during:** first integration-suite run (7 of 8 failures)
- **Issue:** `harness.drainService.drain({ events, sends })` runs Pass 1 (claim/map) AND Pass 2 (send) in one call; a successfully delivered stub mail transitions `QUEUED → SENT` before the test's assertion ever reads the row.
- **Fix:** Added an `expectDelivered(status)` helper accepting `"QUEUED" | "SENT"` and used it everywhere a test asserts "this mail actually goes out" (as opposed to "this mail is skipped").
- **Files modified:** `tests/enrolment-session-drain.integration.test.ts`
- **Verification:** full integration file green.

**3. [Rule 1 - Bug, in a test] Real `cancelCohort`'s audit call used a non-existent `actorId`**
- **Found during:** first integration-suite run (the real-`cancelCohort` test)
- **Issue:** `AuditEvent.actorId` has a real foreign key to `User`; the test passed a literal string (`"staff-real-cancel"`) instead of a seeded user id.
- **Fix:** Seeded a real actor user (`seedVerifiedLearner`, mirroring `tests/cohort-cancel.integration.test.ts`'s own `actorId = (await seedLearnerFixture(...)).userId` convention) and passed its id.
- **Files modified:** `tests/enrolment-session-drain.integration.test.ts`
- **Verification:** the real-`cancelCohort` test passes.

---

**Total deviations:** 3 auto-fixed (1 blocking import, 2 test-only bugs) + 1 documented process deviation (TDD sequencing).
**Impact on plan:** None of the three auto-fixes touched behaviour the plan specified — two were test bugs found by running the tests, one was a compile-time import correction. No scope creep; no production code outside `enrolment-session.ts`/`event-intent-mappers.ts` was touched.

## Issues Encountered

None beyond the deviations above. Docker was running throughout; every `<precondition>` (Docker running for `tests/support/pg.ts`) was met on first check for all three tasks.

## User Setup Required

None — no external service configuration required. No new npm dependency was needed or considered.

## Next Phase Readiness

- Plan 09 is functionally complete: the enrolment-session mapper group is registered and proven end to end (unit + real Postgres, including a real `cancelCohort` run), and the phase's coalescing/precedence rules (D-07, D-11, D-12, Pitfall 4) all have passing tests at both layers.
- Plans 13-10 and 13-11 can append their own `MapperGroup` to `EVENT_MAPPER_GROUPS` and reuse `tests/support/drain-harness.ts` exactly as this plan and 13-08 did.
- **COM-01/COM-02 remain open in REQUIREMENTS.md** — 13-10, 13-11 and 13-13 also declare them and have no SUMMARY.md yet (`gsd_run query requirements ready-ids` returned `blocked` for both; verified with the correct positional invocation). They will flip to complete once the last plan declaring them finishes.
- **Blocker for the project owner, not for the next phase:** nothing in Phase 13 is committed to git (Plans 01–09, 12). The owner should review the working-tree diff and explicitly request commits before further plans in this phase are executed, so `git log`/`git diff` continue to reflect an accurate audit trail. This is unchanged from the state 13-08's Summary already flagged.

## Known Stubs

None. Every mapper in this plan reads its own row fresh through `ctx.tx` (or the DomainEvent table via parameterised raw SQL) and writes real `EmailDispatch`/`Notification` rows through the existing drain machinery; no placeholder data, hardcoded empty result, or "coming soon" branch was introduced. `session.updated` has genuinely no production writer (A-01, by design — proven only with synthetic outbox events in the integration test) and no session-edit mutation was added to create one, exactly as the plan's assumption specifies.

## Threat Flags

None beyond the plan's own threat model. T-13-72 (reason disclosure), T-13-40 (raw-SQL tampering), T-13-38 (over-broad recipient resolution) and T-13-39 (duplicate cohort-cancellation mail) are all covered by the tests referenced in `coverage` above. T-13-41 (poison ordering between coalesced events, accepted risk per the plan) is unchanged by this session — no poison-audit/administrator-alert mechanism was added here, matching the plan's own disposition of "accept, defer to Plan 11".

## Verification

- `npx tsc --noEmit` — clean (run at the end of Task 1's fix, again after Tasks 2–3, and a final confirming run before this Summary).
- `npx eslint src/server/services/event-mappers/enrolment-session.ts src/server/services/event-intent-mappers.ts tests/event-mappers-enrolment-session.test.ts tests/enrolment-session-drain.integration.test.ts` — 0 errors, 0 warnings.
- `DATABASE_URL` pinned to the local scratch Postgres (`127.0.0.1:55432/lms_phase13`) for the `prisma migrate status` sanity check — confirmed `Datasource "db": PostgreSQL database "lms_phase13" ... at "127.0.0.1:55432"`, schema up to date; Neon was never contacted. Every actual test run used its own throwaway Testcontainers Postgres (`tests/support/pg.ts`), never the shared `.env` `DATABASE_URL` at all.
- `npx vitest run tests/event-mappers-enrolment-session.test.ts tests/enrolment-session-drain.integration.test.ts tests/cohort-cancel.integration.test.ts tests/boundary.test.ts --no-file-parallelism` — 4 files, 66 tests, all passed (real Postgres via Testcontainers for the two integration files).

## Self-Check: PASSED

- All 3 created files and the 1 modified file exist on disk and appear in `git status --porcelain` as `??` (untracked — nothing in this phase is committed, per `commit_policy_override`; `git log` was not consulted for pass/fail, absence of commits is expected).
- `npx tsc --noEmit` re-run at the end of this session: clean.
- `npx eslint` on every plan-touched file: 0 errors, 0 warnings.
- The full plan verification suite (4 files, 66 tests) was re-run in this session against a real, throwaway Testcontainers Postgres and passed.
- `gsd_run query requirements ready-ids .planning/phases/13-transactional-communications-notifications/13-09-PLAN.md COM-01,COM-02` was run with the correct positional syntax and returned `blocked` for both IDs; REQUIREMENTS.md was left untouched for COM-01/COM-02.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-28*
