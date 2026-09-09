---
phase: 06-registration-checkout-stripe-payments
plan: 02
subsystem: payments
tags: [domain-events, policy-consent, enrolment-state-machine, public-catalogue, stripe-checkout-prep]

requires:
  - phase: 05-cohorts-scheduling-enrolment-operations-attendance
    provides: "seat-accounting.ts primitives (holdsSeat/claimSeat/lockOpenCohort/updateCurrentEnrolment), the enrolment state machine (approveEnrolment, VALID_TRANSITIONS), and the PUBLIC_VISIBILITY_WHERE-gated public catalogue read path this plan extends"
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: "POLICY_TYPE/POLICY_VERSIONS shape and the PolicyAcceptance orderId-nullable pattern this plan adds a new policy type to"
provides:
  - "Four new DomainEventType literals (order.created, order.paid, order.exception, enrolment.activated) so checkout mutations can type-check against the closed outbox union"
  - "POLICY_TYPE.REFUND_CANCELLATION and its POLICY_VERSIONS entry, additive to the existing string-column PolicyAcceptance model, no schema migration"
  - "applyEnrolmentActivation — the extracted PENDING_PAYMENT -> ACTIVE transition body, callable by both the permission-gated staff approveEnrolment and an actorless webhook caller (plan 06-03)"
  - "PublicCohort extended with id, endsAt, deliveryMode, priceMinor, currency, seatsAvailable through the single PUBLIC_VISIBILITY_WHERE-gated read path"
affects: [06-03, 06-04, phase-7-paystack-manual-payments, phase-8-reconciliation, phase-13-email-drain]

actuals:
  tokens: 5588
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Module-scope transition-body extraction (applyEnrolmentExit's shape) reused a second time for applyEnrolmentActivation — the established convention for sharing a state-machine transition between a withPermission-gated staff action and an unauthorized system caller"
    - "Distinct domain-event literal per actor class (enrolment.approved vs enrolment.activated) so the outbox can always tell a staff override apart from a webhook-triggered activation"

key-files:
  created:
    - tests/identity.test.ts
  modified:
    - src/server/services/domain-event-service.ts
    - src/lib/identity.ts
    - src/server/services/enrolment-service.ts
    - src/server/services/public-catalogue-service.ts
    - tests/domain-event-service.test.ts
    - tests/enrolment-service.test.ts
    - tests/public-catalogue-service.test.ts

key-decisions:
  - "Created a new tests/identity.test.ts rather than extending tests/identity-security.integration.test.ts — the latter is a real-Postgres integration suite for auth/lockout/reset flows, not a fit for a plain constant-shape unit test; the plan explicitly allowed either option."
  - "EnrolmentActivationTxClient omits enrolment.create/findUnique as specified in the plan's interfaces section; applyEnrolmentActivation casts to SeatTxClient once via a local seatTx binding (tx as unknown as SeatTxClient) before calling claimSeat/lockOpenCohort/updateCurrentEnrolment, the same structural-cast idiom applyEnrolmentExit uses for releaseSeat."
  - "REFUND_CANCELLATION policy version stamped 2026-09-09 (today, when the new policy type was authored) rather than reusing the 2026-09-02 date the three existing entries share — it is a distinct policy text with its own version history from day one."

patterns-established:
  - "A second precedent (after applyEnrolmentExit) for extracting a withPermission-wrapped action's transaction body into a module-scope export so an actorless caller can reuse the exact same transition logic without importing the permission choke point."

requirements-completed: [REG-01, REG-04, PAY-02, PAY-09]

coverage:
  - id: D1
    description: "DomainEventType extended with order.created, order.paid, order.exception, enrolment.activated; the closed union still rejects an unknown literal at compile time."
    requirement: "PAY-02"
    verification:
      - kind: unit
        ref: "tests/domain-event-service.test.ts — buildDomainEventRow type-checks and redacts payloads for all four new event types"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (whole project, clean)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POLICY_TYPE.REFUND_CANCELLATION and its POLICY_VERSIONS entry added; POLICY_TYPE.MARKETING left unchanged so checkout's marketing checkbox reuses the same key as the profile toggle."
    requirement: "REG-04"
    verification:
      - kind: unit
        ref: "tests/identity.test.ts — asserts the new constant, its version format, and that MARKETING is untouched"
        status: pass
    human_judgment: false
  - id: D3
    description: "applyEnrolmentActivation extracted from approveEnrolment's transaction body; approveEnrolment now calls it inside its existing withPermission-gated $transaction, staff-path behaviour proven unchanged by the pre-existing suite."
    requirement: "PAY-02"
    verification:
      - kind: unit
        ref: "tests/enrolment-service.test.ts — applyEnrolmentActivation direct cases (live-hold no-claim, hold-less claim, CANCELLED throws IllegalTransitionError, actorId-driven event-type branch) plus all pre-existing approveEnrolment cases, 65/65 passing"
        status: pass
      - kind: other
        ref: "grep -vE comment-stripped withPermission count in enrolment-service.ts stayed at 10 before/after this task"
        status: pass
    human_judgment: false
  - id: D4
    description: "PublicCohort extended with id, endsAt, deliveryMode, priceMinor, currency, seatsAvailable (derived, floored at 0); no second cohort query path, no getPublicCohortById export."
    requirement: "REG-01"
    verification:
      - kind: unit
        ref: "tests/public-catalogue-service.test.ts — derived-availability, floor-at-zero, over-subscribed, and no-occupancy-leak (Object.keys) cases, 13/13 passing"
        status: pass
      - kind: other
        ref: "grep -vE comment-stripped findMany( count in public-catalogue-service.ts stayed at 3; getPublicCohortById count 0"
        status: pass
    human_judgment: false

duration: ~70min
completed: 2026-09-09
status: complete
---

# Phase 6 Plan 2: Shared-Module Prep for Checkout Summary

**Opened the closed DomainEventType union, added the refund/cancellation policy type, extracted an actorless-callable enrolment-activation transition, and extended the public cohort payload with commerce fields — all four blockers plan 06-03's checkout tracer would otherwise hit at compile time or an authorization dead end.**

## Performance
- **Duration:** ~70min
- **Started:** 2026-09-09T11:25:00Z (approx.)
- **Completed:** 2026-09-09T12:38:00Z
- **Tasks:** 3
- **Files modified:** 8 (1 created, 7 modified)

## Accomplishments
- `DomainEventType` now accepts `order.created`, `order.paid`, `order.exception`, `enrolment.activated` while still rejecting any literal outside the union at compile time — verified with a `@ts-expect-error` type-level guard already in the test file.
- `POLICY_TYPE.REFUND_CANCELLATION` and its `POLICY_VERSIONS` entry exist, additive to the existing plain-string `PolicyAcceptance.policyType` column — no Prisma migration. `POLICY_TYPE.MARKETING` is untouched so checkout's marketing checkbox and the profile-page toggle stay one source of truth.
- `applyEnrolmentActivation(tx, { enrolment, reason, actorId, now })` is now a module-scope export mirroring `applyEnrolmentExit`'s extraction shape exactly: same `assertTransition` guard, same `holdsSeat`/`claimSeat`/`lockOpenCohort` seat decision, same `updateCurrentEnrolment` conditional write. `approveEnrolment` calls it inside its existing `withPermission`-gated `$transaction` with zero behaviour change for the staff path. `actorId: string | null` lets a future webhook call it with no actor; it emits `enrolment.activated` when `actorId` is `null` and `enrolment.approved` when it's a string, so the outbox always distinguishes a system-triggered activation from a staff override.
- `PublicCohort` now carries `id`, `endsAt`, `deliveryMode`, `priceMinor`, `currency`, and a derived `seatsAvailable` (`capacity - seatsTaken`, floored at 0) through the single `PUBLIC_VISIBILITY_WHERE`-gated `upcomingCohorts()` select — no second cohort query path, no `getPublicCohortById` export, raw `seatsTaken`/`capacity` never present on the anonymous payload.

## Task Commits
1. **Task 1: Open the closed union and add the refund/cancellation policy type** - `d76e8eb` (feat)
2. **Task 2: Extract applyEnrolmentActivation so an actorless caller can perform the activation** - `2330b58` (feat)
3. **Task 3: Extend PublicCohort with the commerce fields REG-01 requires** - `d34412d` (feat)

**Plan metadata:** commit hash recorded after this summary is committed.

## Files Created/Modified
- `src/server/services/domain-event-service.ts` - `DomainEventType` union extended with the four checkout event literals plus a rationale comment for `enrolment.activated`'s distinctness from `enrolment.approved`
- `src/lib/identity.ts` - `POLICY_TYPE.REFUND_CANCELLATION` and its `POLICY_VERSIONS` entry added
- `src/server/services/enrolment-service.ts` - `applyEnrolmentActivation` + `EnrolmentActivationTxClient` extracted; `approveEnrolment` rewritten to call the extraction
- `src/server/services/public-catalogue-service.ts` - `PublicCohort` type and `upcomingCohorts()` select extended with the six new commerce fields
- `tests/domain-event-service.test.ts` - cases for the four new event-type literals
- `tests/identity.test.ts` - new file; cases for `REFUND_CANCELLATION` and the unchanged `MARKETING` key
- `tests/enrolment-service.test.ts` - direct unit cases against `applyEnrolmentActivation` covering both seat-claim branches, the illegal-transition throw, and the actorId-driven event-type branch
- `tests/public-catalogue-service.test.ts` - derived-availability, floor-at-zero, over-subscribed, and no-occupancy-leak cases

## Decisions Made
- Created `tests/identity.test.ts` as a new file rather than extending `tests/identity-security.integration.test.ts` (a real-Postgres integration suite for auth/lockout/reset flows, not a fit for a plain constant-shape check) — the plan's action explicitly allowed either option.
- `applyEnrolmentActivation` casts its narrow `EnrolmentActivationTxClient` to `SeatTxClient` once via a local `seatTx` binding before calling `claimSeat`/`lockOpenCohort`/`updateCurrentEnrolment`, rather than casting at each call site — same "structural, cast via unknown" idiom `applyEnrolmentExit` uses for `releaseSeat`, applied more than once here since the extracted body touches three seat-accounting functions instead of one.
- `REFUND_CANCELLATION`'s `POLICY_VERSIONS` entry is stamped `2026-09-09` (today) rather than reusing the existing entries' `2026-09-02` — it's a distinct policy text with its own version history starting now, not a retroactive backdate.

## Deviations from Plan
None - plan executed exactly as written. All three tasks' `<behavior>` and `<acceptance_criteria>` items were verified directly (grep counts, `tsc --noEmit`, targeted `vitest run`) and all passed on the first attempt; no Rule 1-4 fixes were needed.

## Issues Encountered
Running the plan's overall `npm test` verification step surfaced 12 failing test files and 2 failing tests, all pre-existing and unrelated to this plan's changes: every `*.integration.test.ts` file fails with "Could not find a working container runtime strategy" because the Docker Desktop daemon is not running in this sandbox (`docker info` confirms the CLI is present but the daemon socket is unreachable), and `tests/docker-email-config.test.ts` fails because `.env.example` has no `AUTH_SECRET` set for `docker compose config` to interpolate. Neither failure mode touches `domain-event-service.ts`, `identity.ts`, `enrolment-service.ts`, or `public-catalogue-service.ts` — the four plan-scoped `<verify>` commands (`tsc --noEmit` plus the four targeted `vitest run` invocations named in the plan's `<verification>` block) all ran and passed. 1337 tests passed, 116 skipped (mostly inside the container-blocked integration files), 0 unit-level regressions.

## User Setup Required
None - no external service configuration required. (This plan installs no new package and touches no schema; the `stripe` package-legitimacy checkpoint RESEARCH.md flags belongs to a later plan in this phase.)

## Next Phase Readiness
All four shared-module blockers plan 06-03's checkout tracer would hit are now closed: the outbox union accepts checkout event types, the refund/cancellation policy type exists, the enrolment-activation transition is callable without a session actor, and the public cohort payload carries the commerce fields a cohort card and an Enroll button need. Ready for 06-03 (wave 2, depends on 06-01 + 06-02).

## Known Stubs
None.

## Self-Check: PASSED

Verified all four modified/created source and test files exist on disk, and all three task commit hashes (`d76e8eb`, `2330b58`, `d34412d`) are present in `git log --oneline`.

---
*Phase: 06-registration-checkout-stripe-payments*
*Completed: 2026-09-09*
