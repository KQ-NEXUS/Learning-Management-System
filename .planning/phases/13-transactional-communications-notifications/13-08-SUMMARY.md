---
phase: 13-transactional-communications-notifications
plan: 08
subsystem: communications
tags: [email, outbox, drain, prisma, refunds, checkout-webhook, tdd]

# Dependency graph
requires:
  - phase: 13-transactional-communications-notifications (Plan 01)
    provides: communications/contracts.ts vocabulary (TemplateId, buildCorrelationId, DOMAIN_EVENT_TYPE_LIST)
  - phase: 13-transactional-communications-notifications (Plan 02)
    provides: enrolment-confirmed / order-payment-exception / payment-failed / payment-refunded template param shapes
  - phase: 13-transactional-communications-notifications (Plan 04)
    provides: email-dispatch-service.dispatch (insert-then-send, correlationId/htmlContent left optional pending this plan)
  - phase: 13-transactional-communications-notifications (Plan 07)
    provides: event-intent-mappers.ts mapper contract, EVENT_MAPPER_GROUPS, domain-event-drain-service.ts, tests/support/drain-harness.ts
provides:
  - "createEnrolmentPaymentMappers — one shared mapper for enrolment.activated/enrolment.approved (D-07 combined mail), order.exception (illegal_transition only, A-06), payment.failed and payment.refunded (D-09), registered in EVENT_MAPPER_GROUPS"
  - "formatMinorAmount — the one deterministic, fixed-locale minor-unit currency formatter for every email/notification amount label"
  - "checkout-webhook-system-service.ts and refund-service.ts no longer send email directly; the drain is the only sender; payment.failed and payment.refunded are now durable, transactional outbox events"
  - "DispatchParams.correlationId/htmlContent are required and template is TemplateId — no caller can dispatch under a random key (COM-02)"
affects: [13-09, 13-10, 13-11 — remaining drain mapper groups can append to EVENT_MAPPER_GROUPS the same way; 13-12 delivery log reads the EmailDispatch rows this drain now produces for enrolment/payment events]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 34500
  tasks: 3
  commits: 0   # commit_policy_override: no commits made this run — see Task Commits below

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One shared mapper function for two DomainEventTypes that mean the same outcome (enrolment.activated/enrolment.approved -> enrolment-confirmed) rather than duplicating the intent-building logic"
    - "formatMinorAmount as the single amount-label formatter, fixed 'en' locale, Intl.NumberFormat currency style, one division by 100 and no other floating arithmetic"
    - "Refund/order completion writes and the payment.refunded outbox event share one $transaction so the event can never be lost for a committed refund or emitted for a rolled-back one"
    - "payment.failed written on the same transaction as the PaymentAttempt FAILED update, never on an exception path"

key-files:
  created:
    - src/server/communications/format-amount.ts
    - src/server/services/event-mappers/enrolment-payment.ts
    - tests/event-mappers-enrolment-payment.test.ts
    - tests/enrolment-payment-drain.integration.test.ts
  modified:
    - src/server/services/event-intent-mappers.ts
    - src/server/services/checkout-webhook-system-service.ts
    - src/server/services/refund-service.ts
    - src/server/services/email-dispatch-service.ts
    - tests/checkout-webhook-system-service.test.ts
    - tests/checkout-webhook.integration.test.ts
    - tests/checkout-service.test.ts
    - tests/email-dispatch-service.test.ts
    - tests/refund-service.test.ts
    - tests/refund.integration.test.ts

key-decisions:
  - "enrolment.activated and enrolment.approved share one mapper function (enrolmentConfirmed) rather than two near-duplicate ones, since both mean 'the seat is confirmed' and differ only in whether the enrolment has an order relation — exactly as the plan specified."
  - "order.paid has no mapper at all (not an empty/no-op mapper) — it processes silently through buildMapperTable's default empty-array entry, since the combined mail is triggered from the enrolment side, never the payment side, per D-07."
  - "payment.refunded's mapper loads the Refund fresh through ctx.tx (joined to order/cohort/user) rather than trusting the event payload's own copy of amount/currency, keeping the mapper the single source of truth for what reaches the template."

requirements-completed: [COM-01, COM-02]

coverage:
  - id: D1
    description: "A paid enrolment (order.paid then enrolment.activated) yields exactly one enrolment-confirmed EmailDispatch and one enrolment.confirmed Notification; order.paid alone produces no output"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/enrolment-payment-drain.integration.test.ts"
        status: pass
      - kind: unit
        ref: "tests/event-mappers-enrolment-payment.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "A staff-approved enrolment with no order (enrolment.approved) yields the same enrolment-confirmed mail with no orderReference/amountLabel in templateParams"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-payment.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-payment-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The checkout webhook and settlement path send no email directly: orderEmailFacts/dispatchEmail, the plain-text builders and the email-dispatch-service imports are removed from checkout-webhook-system-service.ts; only the drain sends"
    requirement: "COM-02"
    verification:
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts"
        status: pass
      - kind: integration
        ref: "tests/checkout-webhook.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "An order.exception with reason illegal_transition yields one order-payment-exception mail; every other reason (duplicate_active_enrolment etc.) yields zero learner mail"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-payment.test.ts"
        status: pass
      - kind: integration
        ref: "tests/enrolment-payment-drain.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "payment.failed is written in the same transaction as the PaymentAttempt FAILED update (recordPaymentFailureAsSystem) and maps to a payment-failed mail plus payment.failed notification; illegal-transition/missing-attempt exception paths write order.exception and no payment.failed"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/checkout-webhook-system-service.test.ts"
        status: pass
      - kind: unit
        ref: "tests/event-mappers-enrolment-payment.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "A COMPLETED or RECORDED_MANUALLY refund writes the Refund status update, the Order status update and the payment.refunded event in one transaction (rollback proven by a forced event-write failure); a FAILED provider refund writes no event"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/refund-service.test.ts"
        status: pass
      - kind: integration
        ref: "tests/refund.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "DispatchParams requires correlationId and htmlContent and narrows template to TemplateId; the random-UUID fallback is gone — no remaining caller omits either field (tsc --noEmit proves this statically)"
    requirement: "COM-02"
    verification:
      - kind: unit
        ref: "tests/email-dispatch-service.test.ts"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D8
    description: "Refund reasons, provider outcomes, staff notes and exception notes never reach a persisted email/notification param; amount labels are formatted only by formatMinorAmount, never by client float arithmetic"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/event-mappers-enrolment-payment.test.ts"
        status: pass
      - kind: unit
        ref: "tests/refund-service.test.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-09-28
status: complete
---

# Phase 13 Plan 08: Enrolment/Payment Mapper Group — Combined Confirmation Mail, Direct-Send Removal, Durable Failure/Refund Events Summary

**One shared `enrolmentConfirmed` mapper turns `enrolment.activated`/`enrolment.approved` into a single combined confirmation mail (never a separate payment mail), `payment.failed` and `payment.refunded` are now written atomically with their own state transitions and mapped to their own learner mail, the checkout webhook and refund service no longer send email themselves, and `DispatchParams` can no longer be called under a random correlation key.**

## Performance

- **Duration:** ~35 min (this resume session — a prior executor completed the implementation across all 3 tasks but stalled transitioning from `tsc` to `eslint` verification; this session independently re-verified every acceptance criterion against the actual file contents, not the prior session's own claim, before writing this Summary)
- **Started:** 2026-09-28 (resume)
- **Completed:** 2026-09-28
- **Tasks:** 3 (all complete, all independently re-verified)
- **Files:** 4 created, 10 modified

## Accomplishments

- **Task 1 (tracer):** `src/server/communications/format-amount.ts` exports `formatMinorAmount(amountMinor, currency)` — divides the integer minor-unit value by 100 once and formats with `Intl.NumberFormat("en", { style: "currency", currency })`, never the server's own default locale. `src/server/services/event-mappers/enrolment-payment.ts` exports `createEnrolmentPaymentMappers()`: `enrolmentConfirmed` handles both `enrolment.activated` and `enrolment.approved` with one function — loads the enrolment (userId, cohort title, optional order) through `ctx.tx`, returns `[]` when the enrolment no longer exists, otherwise one intent (`enrolment-confirmed` email with `cohortTitle`, optional `orderReference`/`amountLabel`, `enrolmentPath`; `enrolment.confirmed` notification targeting `LEARNER_ENROLMENT`). `orderExceptionLearnerMail` returns an intent only for `reason === "illegal_transition"` (`order-payment-exception` email, `order.payment_exception` notification); every other reason returns `[]`. `order.paid` has no mapper — it processes silently through the exhaustive table's default empty entry. Registered in `EVENT_MAPPER_GROUPS` beside `createSupportMappers()`. `tests/event-mappers-enrolment-payment.test.ts` and `tests/enrolment-payment-drain.integration.test.ts` (real Postgres, via the shared `drain-harness.ts`) prove: exactly one combined mail per paid/approved enrolment, no `orderReference`/`amountLabel` for a no-order approval, zero learner mail for `duplicate_active_enrolment` and exactly one for `illegal_transition`, allow-listed params only (a hostile extra payload key never appears in a persisted row), and the missing-enrolment edge case.
- **Task 2 (TDD):** `checkout-webhook-system-service.ts` no longer imports anything from `email-dispatch-service`: `dispatchBestEffort`, `emailDispatchService`, `DispatchParams`, the `OrderEmailFacts` export, `orderEmailFacts`/`dispatchEmail` on `SettlementDeps` and the live `settlementDeps` binding, the post-commit email block, the two plain-text builder functions and `formatMinorAmount`'s old inline copy are all gone. Every `writeDomainEvent` call, audit call and seat-accounting path is untouched, so the settlement outcome, seat count and audit trail are unchanged. `email-dispatch-service.ts`'s `DispatchParams` now requires `correlationId: string` and `htmlContent: string` and types `template: TemplateId` (no longer a plain string); the random-UUID fallback for a missing `correlationId` is deleted. Tests updated: `tests/checkout-webhook-system-service.test.ts` and `tests/checkout-service.test.ts` drop the dispatch harness/`orderEmailFacts`/`dispatchEmail` deps entirely and assert the same events are still written; `tests/checkout-webhook.integration.test.ts` asserts zero `EmailDispatch` rows immediately after settlement and exactly one `enrolment-confirmed` (success) or `order-payment-exception` (illegal transition) row after running the real drain; `tests/email-dispatch-service.test.ts` updated so every dispatch call passes `correlationId`/`htmlContent` explicitly.
- **Task 3 (TDD):** `createRecordPaymentFailureAsSystem` writes a `payment.failed` `writeDomainEvent` (payload `orderId`, `paymentAttemptId`, `provider` — never `input.failureReason`) inside the same transaction as the PaymentAttempt's `FAILED` update, after the update and before the transaction returns; the `payment_attempt_not_found` and `illegal_payment_transition` exception paths still write only `order.exception` and no `payment.failed`. `refund-service.ts`'s `RefundTxClient` gained `refund.update`, `order.update` and a `domainEvent.create` surface (structurally satisfying `DomainEventTxClient`); the completion writes (previously two separate top-level calls) now run inside one `deps.db.$transaction`: the Refund row is updated to its final status, the Order status is updated only when not `FAILED` (unchanged full/partial rule), and — only when not `FAILED` — `payment.refunded` is written with `orderId`/`refundId`/`amountMinor`/`currency`/`status`. `createPrismaBackedRefundService` binds the new tx members to the real Prisma delegates; the audit call stays after commit exactly as before. `enrolment-payment.ts` gained `paymentFailedLearnerMail` (loads the order fresh, `payment-failed` email + `payment.failed` notification) and `paymentRefundedLearnerMail` (loads the Refund fresh joined to order/cohort/user, `payment-refunded` email with `amountLabel` + `payment.refunded` notification) — neither ever copies a refund reason, provider outcome, or failure reason into a persisted param. Tests: `tests/refund-service.test.ts` fakes moved to the tx-based shape plus new FAILED-provider-no-event and event-throws-rolls-back cases; `tests/refund.integration.test.ts` adds a real-Postgres case asserting the Refund/Order/event commit together and a forced event failure leaves all three rolled back; `tests/event-mappers-enrolment-payment.test.ts` extended for both new mappers, including a hostile-refund-reason-never-in-params assertion.

## Task Commits

**No commits were made in this run** — the project owner's standing rule requires an explicit ask for each commit (`commit_policy_override`, reiterated for this run). All three tasks below are complete and independently re-verified in the working tree; hashes are `uncommitted`.

1. **Task 1: Tracer — a paid enrolment produces one combined confirmation mail and notification through the drain** - `uncommitted` (`feat(13-08): add formatMinorAmount, createEnrolmentPaymentMappers, register the group, and prove the combined-mail tracer end to end`) — completed by a prior session (stalled during the transition to eslint verification, not during this task); independently re-verified in this session by reading the actual file contents against every acceptance criterion and re-running its test scope as part of the combined suite below.
2. **Task 2: Remove the direct checkout sends and require a correlation key on every dispatch** - `uncommitted` (`test(13-08): update checkout-webhook/checkout-service/email-dispatch tests for the removed direct send and required correlationId/htmlContent` + `feat(13-08): remove the direct email path from checkout-webhook-system-service.ts and require correlationId/htmlContent on DispatchParams`) — completed by the prior session; independently re-verified.
3. **Task 3: Emit payment.failed and payment.refunded and map both to learner mail** - `uncommitted` (`test(13-08): add failing tests for payment.failed/payment.refunded transactional emission and rollback` + `feat(13-08): write payment.failed on the FAILED transition and payment.refunded in the refund completion transaction, add both mappers`) — completed by the prior session; independently re-verified.

**Plan metadata:** not committed (see above).

_Note: TDD tasks (2, 3) were executed in RED→GREEN order in the working tree by the prior session; this session did not re-run the RED/GREEN sequence (no code was rewritten) but did independently confirm GREEN — the full plan verification suite below — before writing this Summary._

## Files Created/Modified

- `src/server/communications/format-amount.ts` - `formatMinorAmount`, the one deterministic minor-unit currency formatter (Task 1)
- `src/server/services/event-mappers/enrolment-payment.ts` - `createEnrolmentPaymentMappers`: `enrolmentConfirmed`, `orderExceptionLearnerMail` (Task 1), `paymentFailedLearnerMail`, `paymentRefundedLearnerMail` (Task 3)
- `src/server/services/event-intent-mappers.ts` - registers `createEnrolmentPaymentMappers()` in `EVENT_MAPPER_GROUPS` beside `createSupportMappers()` (Task 1)
- `src/server/services/checkout-webhook-system-service.ts` - direct email path fully removed (Task 2); `payment.failed` written on the FAILED transition (Task 3)
- `src/server/services/refund-service.ts` - completion writes (Refund/Order/`payment.refunded`) moved into one transaction (Task 3)
- `src/server/services/email-dispatch-service.ts` - `DispatchParams.correlationId`/`htmlContent` required, `template: TemplateId`, random-UUID fallback removed (Task 2)
- `tests/event-mappers-enrolment-payment.test.ts` - new; unit tests for every mapper in the group plus `formatMinorAmount` (Tasks 1, 3)
- `tests/enrolment-payment-drain.integration.test.ts` - new; real-Postgres drain tests for the combined mail and exception mail (Task 1)
- `tests/checkout-webhook-system-service.test.ts` - dispatch harness/assertions replaced with event-only assertions (Task 2); `payment.failed` settlement assertion added (Task 3)
- `tests/checkout-webhook.integration.test.ts` - dispatch assertions changed to zero-rows-before/one-row-after-drain (Task 2)
- `tests/checkout-service.test.ts` - `orderEmailFacts`/`dispatchEmail` removed from `SettlementDeps` construction (Task 2)
- `tests/email-dispatch-service.test.ts` - every dispatch call now passes `correlationId`/`htmlContent` (Task 2)
- `tests/refund-service.test.ts` - fakes moved to the tx-based shape; FAILED-no-event and rollback-on-event-throw cases added (Task 3)
- `tests/refund.integration.test.ts` - real-Postgres atomic-commit and rollback cases added (Task 3)

## Decisions Made

See `key-decisions` above. Most consequential: `enrolment.activated`/`enrolment.approved` share one mapper function rather than two near-duplicates, and `order.paid` deliberately has no mapper at all (relying on the exhaustive table's default empty entry) rather than an explicit no-op mapper, since the combined mail is triggered from the enrolment side only (D-07).

## Deviations from Plan

None found. This session's independent re-verification (reading every file listed in `files_modified`, not trusting the prior session's or the orchestrator's own summary) confirmed all `must_haves.truths`, all three tasks' `<acceptance_criteria>`, and the plan's top-level `<verification>` block are genuinely met by what is on disk — no gap required a fix.

One discrepancy from the resume brief is worth recording precisely: the brief reported "1 pre-existing warning in email-dispatch-service.ts line 404 ('now' unused)" from the orchestrator's own eslint pass. Re-running `npx eslint` against every file this plan touches in this session found that same warning plus two more: `tests/email-dispatch-service.test.ts:102` (`now` destructured but unused in the `requeueForResend` mock) and `tests/refund-service.test.ts:258` (`_reason` from a destructure-to-omit pattern in an unrelated "field validation" test). Both additional warnings sit in functions/test blocks this plan's own task actions never touch (Task 2's edit to `tests/email-dispatch-service.test.ts` only changes dispatch-call assertions elsewhere in the file; Task 3's edit to `tests/refund-service.test.ts` only changes the tx-based fakes, not the pre-existing field-validation test) — `git diff` shows the `_reason` line as unchanged context, and the `requeueForResend` mock predates this plan's Task 2 scope. Per the scope boundary rule (fix only what this plan's task actions directly caused), neither was fixed here; all three are lint warnings, not errors, and do not affect correctness, security, or the plan's `<verify>` commands (`npx eslint` reports `0 errors, 3 warnings`, not a failure). Logged to the broken-windows ledger below.

## Issues Encountered

- A prior executor session stalled (killed for the account rate limit) transitioning from `tsc --noEmit` to `eslint` verification, immediately after completing all 3 implementation tasks. This session did not redo any implementation — it independently re-read every file the plan declares (`format-amount.ts`, `enrolment-payment.ts`, `event-intent-mappers.ts`, `checkout-webhook-system-service.ts`, `refund-service.ts`, `email-dispatch-service.ts`) against the plan's `<behavior>`/`<acceptance_criteria>` line by line, re-ran `npx tsc --noEmit` (clean), `npx eslint` (0 errors, 3 warnings — one more than the orchestrator's brief expected, all pre-existing per above), the local scratch-Postgres migration check (`127.0.0.1:55432`, never Neon), and the full combined verification suite (10 files, 211 tests, all passed) before concluding the plan is genuinely complete and writing this Summary.
- No git commits were made in this session per the project owner's standing "never auto-commit" rule (`commit_policy_override`). All work is present and verified in the working tree only (`git status --porcelain` shows the expected modified/untracked files for this plan; no new commits exist for Phase 13 anywhere).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 08 is functionally complete: the enrolment/payment mapper group is registered and proven end to end, the checkout webhook and refund service send no email themselves, and `payment.failed`/`payment.refunded` are durable, transactional outbox events mapped to their own learner mail.
- Plans 09-11 can continue appending their own `MapperGroup` to `EVENT_MAPPER_GROUPS` and reusing `tests/support/drain-harness.ts` exactly as this plan did.
- Plan 12 (delivery log) can read the `EmailDispatch` rows the enrolment/payment mappers now produce.
- **Blocker for the project owner, not for the next phase:** nothing in Phase 13 (Plans 01-08) is committed to git. The owner should review the working-tree diff and explicitly request commits (per their standing rule) before further plans in this phase are executed, so `git log`/`git diff` continue to reflect an accurate audit trail.

## Known Stubs

None. Every mapper in this plan reads its own row fresh through `ctx.tx` and writes real `EmailDispatch`/`Notification` rows through the existing drain machinery; no placeholder data, hardcoded empty result, or "coming soon" branch was introduced.

## Threat Flags

None beyond the plan's own threat model. T-13-69 (duplicate confirmation), T-13-36 (lost `payment.refunded` event), T-13-70 (refund reason/provider outcome disclosure) and T-13-37 (amount shown to the wrong recipient) are all covered by the tests referenced in `coverage` above; T-13-71 (crash between provider refund and database write) remains an accepted risk per the plan, unchanged by this session.

## Verification

- `npx tsc --noEmit` — clean (re-run this session).
- `npx eslint` on every file this plan touches — 0 errors, 3 warnings (all pre-existing, see Deviations above; the plan's own `<verify>` commands do not fail on eslint warnings).
- `DATABASE_URL` pinned to the local scratch Postgres (`127.0.0.1:55432/lms_phase13`) for the `prisma migrate status` check — confirmed `Datasource "db": PostgreSQL database "lms_phase13" ... at "127.0.0.1:55432"`, schema up to date; Neon was never contacted.
- `npx vitest run tests/event-mappers-enrolment-payment.test.ts tests/enrolment-payment-drain.integration.test.ts tests/checkout-webhook-system-service.test.ts tests/checkout-webhook.integration.test.ts tests/checkout-service.test.ts tests/email-dispatch-service.test.ts tests/refund-service.test.ts tests/refund.integration.test.ts tests/boundary.test.ts tests/staff-payments-actions.test.ts --no-file-parallelism` — 10 files, 211 tests, all passed (run this session, real Postgres via Testcontainers for the two integration files).

## Self-Check: PASSED

- All 4 created files and the 10 modified files exist on disk and appear in `git status --porcelain` as `??` (untracked, new) or `M` (tracked, modified) — no commits exist for this plan (`git log` not consulted for pass/fail per `commit_policy_override`; absence of commits is expected, not a failure).
- `npx tsc --noEmit` re-run this session: clean.
- `npx eslint` re-run this session on every plan-touched file: 0 errors, 3 warnings (documented above).
- The full plan verification suite (10 files, 211 tests) was actually re-run in this session against the local scratch Postgres and passed.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-28*
