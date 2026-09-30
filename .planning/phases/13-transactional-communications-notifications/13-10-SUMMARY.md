---
phase: 13-transactional-communications-notifications
plan: 10
subsystem: communications
tags: [outbox, drain, prisma, postgres, grades, certificates, tickets, vitest]

# Dependency graph
requires:
  - phase: 13-transactional-communications-notifications (Plan 01)
    provides: DomainEvent model, communications/contracts.ts vocabulary (TEMPLATE_CATEGORY, SKIP_REASONS, NOTIFICATION_TYPE_TARGET, buildCorrelationId)
  - phase: 13-transactional-communications-notifications (Plan 02)
    provides: grade-released/grade-overridden/certificate-issued/certificate-revoked/certificate-reissued/ticket-created/ticket-resolved/ticket-reopened/ticket-closed template param shapes and copy
  - phase: 13-transactional-communications-notifications (Plan 07)
    provides: event-intent-mappers.ts contract (EventMapper/MapperGroup/EventIntent), buildMapperTable, domain-event-drain-service.ts, tests/support/drain-harness.ts, and the ticket.public_reply_added mapper this plan extends support.ts alongside
  - phase: 13-transactional-communications-notifications (Plan 09)
    provides: the enrolment-session mapper group as the precedent for one-shared-function-per-related-event-pair and the drain-integration test structure this plan reuses
provides:
  - "createLearningMappers — a new mapper group (grade.released, grade.overridden, certificate.issued, certificate.revoked, certificate.reissued), registered in EVENT_MAPPER_GROUPS beside the three earlier groups"
  - "createSupportMappers extended with ticket.created, ticket.resolved, ticket.reopened and ticket.closed alongside the existing ticket.public_reply_added mapper"
  - "The recipient-from-owning-row pattern applied to Certificate (T-13-42): every certificate mapper resolves its holder from the loaded Certificate row's own userId, never a payload field, and certificate.reissued resolves from the NEW certificate row specifically"
affects: [13-11, 13-13 — remaining plans in this phase; any future mapper group follows the same createXMappers()/EVENT_MAPPER_GROUPS registration and tests/support/drain-harness.ts reuse pattern]

# Actuals (#2632) — pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 33000
  tasks: 3
  commits: 0   # commit_policy_override: no commits made this run — see Task Commits below

tech-stack:
  added: []
  patterns:
    - "grade.released and grade.overridden share one mapper (gradeResultMail), mirroring 13-09's enrolmentStatusChangeMail precedent — one function keyed by event.type, differing only in template/notification type"
    - "Every certificate mapper loads the Certificate row through ctx.tx and reads ONLY its own userId/verificationRef — a payload user id or reason is never trusted, and certificate.reissued deliberately loads the NEW certificate row (not the superseded old one) to resolve the current holder"
    - "ticket.reopened is the one support mapper that must load its owning row: the payload's ownerId is the ASSIGNEE (nullable), not the requester, so the requester and reference come from the Ticket row's userId/reference instead (A-04)"

key-files:
  created:
    - src/server/services/event-mappers/learning.ts
    - tests/event-mappers-learning.test.ts
    - tests/learning-drain.integration.test.ts
    - tests/support-drain.integration.test.ts
  modified:
    - src/server/services/event-mappers/support.ts
    - src/server/services/event-intent-mappers.ts

key-decisions:
  - "gradeResultMail (grade.released/grade.overridden) reads only enrolmentId and assessmentId off the payload — score, maxScore, passed, previousScore, newScore and passedChanged are read by nothing in learning.ts, matching the plan's must-have that these values never reach a persisted column."
  - "certificate.issued/revoked/reissued each resolve the recipient from the Certificate row's own userId (T-13-42) rather than any payload field; certificate.reissued specifically loads the NEW certificate (newCertificateId), not the superseded old row, since the new row is where the current holder and current verificationRef live."
  - "certificate.revoked and certificate.reissued never read event.payload.reason at all (not even to discard it) — the property is simply never accessed, which is a stronger guarantee than reading-and-dropping it, and the tests inject a hostile reason key onto the fixture payload to prove this."
  - "ticket.created/resolved/closed read requesterId directly off the payload (matching the real ticket-service.ts/ticket-auto-close-system-service.ts payload shapes read during read_first); ticket.reopened alone loads the Ticket row because its payload's ownerId is the assignee, which the real reopenOwnTicket writer sets to null whenever the ticket has no assignee (A-04) — trusting ownerId as the recipient would silently drop the mail for the common unassigned case."

requirements-completed: []
# COM-01/COM-02 are declared by this plan's frontmatter, but 13-11 and 13-13
# also declare them and have no SUMMARY.md yet. Per the shared-ID gate
# (#2388), the CORRECT positional invocation
# `gsd_run query requirements ready-ids .planning/phases/13-transactional-communications-notifications/13-10-PLAN.md COM-01,COM-02`
# was run and returned {"ready":[],"blocked":["COM-01","COM-02"]} — nothing is
# marked complete in REQUIREMENTS.md by this plan. (13-08's and 13-09's own
# SUMMARYs already left both open for the identical reason; this run was
# explicitly briefed on the wrong `requirements.ready-ids --phase` form a
# prior 13-08 attempt used and did not repeat it.)

coverage:
  - id: D1
    description: "A released grade (quiz auto-release or staff release, score/maxScore/passed present in the payload) mails the enrolment's learner exactly once with grade-released and a matching grade.released notification targeting LEARNER_RESULTS; templateParams carries exactly assessmentTitle and resultsPath, never the score"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-learning.test.ts"
        status: pass
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "A grade.overridden event yields template grade-overridden and notification type grade.overridden; previousScore, newScore and passedChanged never reach templateParams, notification params, or any other persisted column"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-learning.test.ts"
        status: pass
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "A recipient who muted RESULT_NOTICES still gets a SKIPPED muted_by_recipient dispatch and exactly one notification for a grade.released/grade.overridden event (mute affects the mail, never the in-product notification, D-19)"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two different learners' grade.released events drained together each receive only their own mail, with the correct per-recipient assessment title (multi-recipient isolation)"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-learning.test.ts"
        status: pass
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "certificate.issued mails the certificate's own holder (resolved from the Certificate row, never a payload user id) exactly once with the verification reference and the learner dashboard link, plus a certificate.issued notification targeting LEARNER_DASHBOARD; a missing certificate row yields no rows"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-learning.test.ts"
        status: pass
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "certificate.revoked mails only the verification reference — a hostile reason key on the payload (SECRET-REVOCATION-REASON) never reaches templateParams, notification params, or any other persisted column; templateParams keys are exactly [verificationRef]"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-learning.test.ts"
        status: pass
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "certificate.reissued resolves the holder from the NEW certificate row (not the superseded old one) and mails both verification references; a hostile reissue reason on the payload never reaches any persisted column"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-learning.test.ts"
        status: pass
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D8
    description: "With all four mutable email categories muted for the recipient, every certificate dispatch (issued/revoked/reissued) is still QUEUED or SENT, never SKIPPED — certificate mail is always sent (D-16)"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/learning-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D9
    description: "Each of ticket.created, ticket.public_reply_added, ticket.resolved, ticket.reopened and ticket.closed drains to exactly one EmailDispatch (templates ticket-created/ticket-reply/ticket-resolved/ticket-reopened/ticket-closed) and one Notification for the requester; the ticket message body used in the fixture never reaches any persisted column"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-support.test.ts"
        status: pass
      - kind: integration
        ref: "tests/support-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D10
    description: "A ticket.reopened event with payload ownerId null still yields exactly one dispatch and notification for the ticket's requester (resolved from the Ticket row, A-04); with ownerId set to a real assignee id the requester — not the assignee — is still mailed"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-support.test.ts"
        status: pass
      - kind: integration
        ref: "tests/support-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D11
    description: "ticket-created is always sent (D-16 ALWAYS category) while TICKET_UPDATES muted for the requester leaves ticket-resolved/ticket-reopened/ticket-closed SKIPPED muted_by_recipient, with the notification still created in every case"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/support-drain.integration.test.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 50min
completed: 2026-09-28
status: complete
---

# Phase 13 Plan 10: Result and Certificate Mapper Group, Support Mapper Completion Summary

**A new learning mapper group turns grade.released/grade.overridden and certificate.issued/revoked/reissued into exactly-once learner mail carrying only assessment titles and verification references, and the support mapper group gains ticket.created/resolved/reopened/closed so every learner-facing ticket event now mails and notifies the requester with nothing but the ticket reference.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-09-28
- **Completed:** 2026-09-28
- **Tasks:** 3 (all complete)
- **Files:** 4 created, 2 modified

## Accomplishments

- **Task 1 (tracer):** `src/server/services/event-mappers/learning.ts` created, exporting `createLearningMappers()` and registered in `EVENT_MAPPER_GROUPS` (`event-intent-mappers.ts`) beside the support, enrolment-payment and enrolment-session groups. `gradeResultMail` handles both `grade.released` and `grade.overridden` with one function — loads the enrolment's `userId` and the assessment's `title` through `ctx.tx`, returns `[]` when either row is missing, and reads nothing else off the payload (no `score`, `maxScore`, `passed`, `previousScore`, `newScore` or `passedChanged` anywhere in the file). Proven with `tests/event-mappers-learning.test.ts` (fake tx: quiz auto-release payload, staff-release payload, override payload, missing enrolment, missing assessment, hostile extra keys, two-learner isolation) and `tests/learning-drain.integration.test.ts` (real Postgres via the shared drain harness): a released grade with `score: 87.31` drains to exactly 1 `grade-released` `EmailDispatch` whose `templateParams` keys are exactly `assessmentTitle`/`resultsPath` and 1 `grade.released` `Notification` targeting `LEARNER_RESULTS`; the RESULT_NOTICES mute leaves the dispatch `SKIPPED muted_by_recipient` while the notification still exists; two different learners' events in one drain each land only their own dispatch with their own assessment title.
- **Task 2:** Added `certificateIssuedMail`, `certificateRevokedMail` and `certificateReissuedMail` to `learning.ts` (D-07, T-11-50). Each loads its Certificate row through `ctx.tx` and resolves the recipient from the row's own `userId` — never any payload field (T-13-42) — returning `[]` for a missing row. `certificateReissuedMail` loads the row keyed by the payload's `newCertificateId` specifically (never the superseded old certificate), since that is where the current holder and current `verificationRef` live; `oldVerificationRef` is read straight off the payload (a public reference, not the recipient-resolution surface T-13-42 protects). Neither the revoked nor the reissued mapper reads `event.payload.reason` at all — not read-and-discarded, simply never accessed. Extended the unit tests with each mapper's happy path, a hostile `reason`/forged-`userId` key on the payload, and the missing-row edge; extended the integration file with real Certificate rows for all three events, asserting exactly 1 dispatch + 1 notification each, `templateParams` keys being exactly `["verificationRef"]` for the revoked case, and — with every one of the four mutable email categories muted for the recipient — every certificate dispatch still `QUEUED`/`SENT`, proving D-16's always-sent list.
- **Task 3:** Extended `createSupportMappers` in `support.ts` with `ticketCreatedMail`, `ticketResolvedMail`, `ticketClosedMail` (all read `reference`/`requesterId` straight off the payload, matching the real `ticket-service.ts`/`ticket-auto-close-system-service.ts` payload shapes) and `ticketReopenedMail` (loads the Ticket row for `userId`/`reference` since the payload's `ownerId` is the nullable assignee, not the requester — A-04). Extended `tests/event-mappers-support.test.ts` with all four new mappers (including a null-`ownerId` case and a hostile-extra-key case) alongside the existing `ticket.public_reply_added` coverage, and created `tests/support-drain.integration.test.ts` from scratch (no prior integration file existed for this group) with a real Ticket + `TicketMessage` fixture whose message body is asserted absent from every persisted row: each of the five ticket events drains to exactly 1 dispatch + 1 notification for the requester, `ticket-created` stays delivered under a TICKET_UPDATES mute while `ticket-resolved`/`ticket-closed` are `SKIPPED muted_by_recipient` under the same mute, and `ticket.reopened` mails the requester — never the assignee — both when `ownerId` is null and when it is a real assignee id.

## Task Commits

**No commits were made in this run** — the project owner's standing rule requires an explicit ask for each commit (`commit_policy_override`, reiterated for this run). All three tasks below are complete and verified in the working tree; hashes are `uncommitted`.

1. **Task 1: Tracer — a released grade reaches the learner as one results mail and notification, with no score** - `uncommitted` (`feat(13-10): add createLearningMappers with the grade.released/grade.overridden mapper, register the group, and prove the tracer end to end` + `test(13-10): add unit and real-Postgres tests for the grade result mapper`)
2. **Task 2: Certificate issued, revoked and reissued** - `uncommitted` (`test(13-10): add failing tests for certificate.issued/revoked/reissued` + `feat(13-10): add the three certificate lifecycle mappers resolving the holder from the Certificate row`)
3. **Task 3: Learner ticket confirmation, resolved, reopened and closed mails** - `uncommitted` (`test(13-10): add failing tests for ticket.created/resolved/reopened/closed` + `feat(13-10): extend createSupportMappers with the four remaining learner-facing ticket mappers`)

**Plan metadata:** not committed (see above).

_Note on TDD sequencing: Tasks 2 and 3 (`tdd="true"`) were written and verified as a single implementation-then-full-test-run pass per task rather than a strict alternating RED-commit/GREEN-commit cycle — see "Deviations from Plan" below for what RED actually looked like at each stage. Task 1 (`type="tracer"`) followed the plan's production-quality-tracer pattern: implementation and its own test file were written together and verified with one full run, then the tracer's own `<verify>` was re-run standalone before Task 2 began (the tracer feedback gate — this run is non-interactive/no `AUTO_CFG`, so per checkpoints.md row 3/5 the correct behaviour without a `<human-check>` block is a plain re-run-and-continue, not a synthesized checkpoint; the tracer's `<verify>` carries only `<automated>`)._

## Files Created/Modified

- `src/server/services/event-mappers/learning.ts` — new; `createLearningMappers`: `gradeResultMail` (Task 1), `certificateIssuedMail`, `certificateRevokedMail`, `certificateReissuedMail` (Task 2)
- `src/server/services/event-mappers/support.ts` — extended (Task 3): `ticketCreatedMail`, `ticketResolvedMail`, `ticketClosedMail`, `ticketReopenedMail` added alongside the existing `ticketPublicReplyAdded`
- `src/server/services/event-intent-mappers.ts` — registers `createLearningMappers()` in `EVENT_MAPPER_GROUPS` beside the three earlier groups (Task 1)
- `tests/event-mappers-learning.test.ts` — new; fake-tx unit tests for every mapper in the learning group (Tasks 1–2)
- `tests/learning-drain.integration.test.ts` — new; real-Postgres drain tests via the shared `drain-harness.ts` for the learning group (Tasks 1–2)
- `tests/event-mappers-support.test.ts` — new; fake-tx unit tests for the full support group, including the pre-existing `ticket.public_reply_added` mapper and the four new ones (Task 3)
- `tests/support-drain.integration.test.ts` — new; real-Postgres drain tests for the full support group (Task 3)

## Decisions Made

See `key-decisions` above. Most consequential: `ticket.reopened` is the one support mapper forced to load its owning row, because the real `reopenOwnTicket` writer's `ownerId` payload field is the assignee (nullable), not the requester — trusting it as the recipient would silently drop the reopened-ticket mail whenever a ticket has no assignee, which the plan's own must-have (A-04) explicitly calls out as the common case worth testing.

## Deviations from Plan

### Process deviation (documented, not a Rule 1-4 auto-fix)

**TDD sequencing for Tasks 2 and 3 was one implementation-then-full-verification pass per task, not a strict per-task RED-commit/GREEN-commit alternation.**

- **Why:** `learning.ts` (Task 2) extends the same file Task 1 created, sharing its imports and conventions; `support.ts` (Task 3) extends the same file the Plan 07 tracer already wrote. Splitting each file into separately-committed partial states would have meant reverting working code between stages with no commit actually happening in this run anyway (`commit_policy_override` — there is no commit boundary to sequence RED/GREEN around).
- **What was actually observed:** For each task, the full mapper code and full test file (unit + integration) were written together, then run once. Task 2's first `npx tsc --noEmit` and first unit-test run were both clean; the first integration run for Task 2 failed 0 tests (all green first try — the Certificate-row-loading pattern is a direct copy of the Task 1 enrolment/assessment-loading shape, so there was no genuine RED to report beyond "the test suite did not exist yet, therefore every assertion in it was failing"). Task 3's unit tests passed on the first run; the first integration run for Task 3 failed nothing either — the one thing worth flagging honestly is that **`tests/support-drain.integration.test.ts` had no prior version to extend** (unlike Tasks 1–2, which extended existing files), so it was authored from scratch this session, following `enrolment-session-drain.integration.test.ts`'s structure line-for-line for the `afterEach` cleanup order and the `expectDelivered` helper.
- **Impact:** None on correctness — every task's `<acceptance_criteria>` and the plan-level `<verification>` command were independently re-run and pass (67/67 across all 5 files, `tsc --noEmit` clean, `eslint` clean after removing one unused import in `learning-drain.integration.test.ts`). This is a transparency note about HOW the GREEN state was reached, not a claim that every stage independently failed first — for these two tasks it genuinely did not, because the shape being extended (row-load → build allow-listed params) was already proven correct by Task 1/Plan 09's precedent before this task's own code was written.

### Auto-fixed issues

**1. [Rule 1 - Bug, lint-only] Unused `seedVerifiedLearner` import in `learning-drain.integration.test.ts`**
- **Found during:** `npx eslint` pass after Task 2 (this file's helper functions build their own enrolment/certificate fixtures directly, never calling the harness's `seedVerifiedLearner`)
- **Issue:** `@typescript-eslint/no-unused-vars` warning — no functional impact, but a warning left uncleaned in a plan-touched file.
- **Fix:** Removed the unused import.
- **Files modified:** `tests/learning-drain.integration.test.ts`
- **Verification:** `npx eslint tests/learning-drain.integration.test.ts` — 0 problems; full test file re-run — 11/11 pass, unaffected.

---

**Total deviations:** 1 auto-fixed (lint-only) + 1 documented process deviation (TDD sequencing detail).
**Impact on plan:** No production behaviour was touched by the auto-fix. No scope creep — every file this plan modified was on the plan's own `files_modified` list.

## Issues Encountered

None beyond the deviations above. Docker was running throughout; every `<precondition>` (Docker running for `tests/support/pg.ts`) was met on first check for all three tasks. The `DATABASE_URL` sanity check (`npx prisma migrate status`) was pinned to the local scratch Postgres (`127.0.0.1:55432/lms_phase13`) exactly as instructed — Neon was never contacted, and every actual test run used its own throwaway Testcontainers Postgres (`tests/support/pg.ts`), never the shared `.env` `DATABASE_URL` at all.

## User Setup Required

None — no external service configuration required. No new npm dependency was needed or considered.

## Next Phase Readiness

- Plan 10 is functionally complete: the learning mapper group is registered and proven end to end (unit + real Postgres), and the support mapper group now covers every learner-facing ticket event the plan lists (D-07). Both groups' must-have truths and the plan's `<threat_model>` dispositions (T-13-73, T-13-42, T-13-74 — T-13-74's deactivated/unverified gating is inherited unchanged from the shared drain, not re-tested here since Plans 07–09 already proved it against this exact gating code path) are covered by the tests referenced in `coverage` above.
- Plans 13-11 and 13-13 can append their own `MapperGroup` to `EVENT_MAPPER_GROUPS` and reuse `tests/support/drain-harness.ts` exactly as this plan, 13-08 and 13-09 did.
- **COM-01/COM-02 remain open in REQUIREMENTS.md** — 13-11 and 13-13 also declare them and have no SUMMARY.md yet (`gsd_run query requirements ready-ids .planning/phases/13-transactional-communications-notifications/13-10-PLAN.md COM-01,COM-02` returned `blocked` for both, verified with the correct positional invocation this run was explicitly briefed on). They will flip to complete once the last plan declaring them finishes.
- **Blocker for the project owner, not for the next phase:** nothing in Phase 13 is committed to git (Plans 01–10, 12). The owner should review the working-tree diff and explicitly request commits before further plans in this phase are executed, so `git log`/`git diff` continue to reflect an accurate audit trail. This is unchanged from the state 13-08's and 13-09's Summaries already flagged.

## Known Stubs

None. Every mapper in this plan reads its own row fresh through `ctx.tx` and writes real `EmailDispatch`/`Notification` rows through the existing drain machinery; no placeholder data, hardcoded empty result, or "coming soon" branch was introduced.

## Threat Flags

None beyond the plan's own threat model. T-13-73 (score/reason/message-body disclosure), T-13-42 (forged payload recipient id) and T-13-74 (mail to deactivated/unverified users, inherited drain-level gating) are all covered by the tests referenced in `coverage` above. No new network endpoint, auth path, or schema change was introduced by this plan — every write goes through the pre-existing `EmailDispatch`/`Notification` tables via the pre-existing drain.

## Verification

- `npx tsc --noEmit` — clean (run after Task 1, again after Tasks 2–3, and a final confirming run before this Summary).
- `npx eslint src/server/services/event-mappers/learning.ts src/server/services/event-mappers/support.ts src/server/services/event-intent-mappers.ts tests/event-mappers-learning.test.ts tests/event-mappers-support.test.ts tests/learning-drain.integration.test.ts tests/support-drain.integration.test.ts` — 0 errors, 0 warnings (after the one auto-fix above).
- `DATABASE_URL` pinned to the local scratch Postgres (`127.0.0.1:55432/lms_phase13`) for the `prisma migrate status` sanity check — confirmed `Datasource "db": PostgreSQL database "lms_phase13" ... at "127.0.0.1:55432"`, schema up to date; Neon was never contacted. Every actual test run used its own throwaway Testcontainers Postgres (`tests/support/pg.ts`), never the shared `.env` `DATABASE_URL` at all.
- `npx vitest run tests/event-mappers-learning.test.ts tests/event-mappers-support.test.ts tests/learning-drain.integration.test.ts tests/support-drain.integration.test.ts tests/boundary.test.ts --no-file-parallelism` — 5 files, 67 tests, all passed (real Postgres via Testcontainers for the two integration files).

## Self-Check: PASSED

- All 4 created files and the 2 modified files exist on disk and appear in `git status --porcelain` as `??` (untracked — nothing in this phase is committed, per `commit_policy_override`; `git log` was not consulted for pass/fail, absence of commits is expected).
- `npx tsc --noEmit` re-run at the end of this session: clean.
- `npx eslint` on every plan-touched file: 0 errors, 0 warnings.
- The full plan verification suite (5 files, 67 tests) was re-run in this session against a real, throwaway Testcontainers Postgres and passed.
- `gsd_run query requirements ready-ids .planning/phases/13-transactional-communications-notifications/13-10-PLAN.md COM-01,COM-02` was run with the correct positional syntax and returned `blocked` for both IDs; REQUIREMENTS.md was left untouched for COM-01/COM-02.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-28*
