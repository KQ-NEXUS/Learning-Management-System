---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 11
subsystem: api
tags: [prisma, postgres, cohorts, enrolments, attendance, testcontainers, seed]

# Dependency graph
requires:
  - phase: 05-01
    provides: "prisma/sql/003_cohort_operations.sql CHECKs (attendance_correction_has_reason, enrolment_hold_expiry_only_when_pending, cohort_hold_minutes_non_negative), tests/support/cohort-fixtures.ts and pg.ts Testcontainers harness"
  - phase: 05-05
    provides: "createCohortService factory (async toScope, archiveData override, runInTransaction), StaleOrderError, publish-service.ts publish/refusal/stale-token patterns, CohortPublishTx"
  - phase: 05-07
    provides: "enrolment state machine (VALID_TRANSITIONS/assertTransition), withdrawEnrolment/cancelEnrolment, seat-accounting.ts releaseSeat/holdsSeat, writeDomainEvent"
provides:
  - "cancelCohort — confirmation-gated bulk withdraw (ACTIVE->WITHDRAWN, PENDING_PAYMENT->CANCELLED) plus session soft-cancel plus cohort status change, all in one $transaction"
  - "CohortCancelBlockedError — refuses an already-CANCELLED cohort"
  - "applyEnrolmentExit(tx, {enrolment, toStatus, reason, actorId, now}) — the ONE shared WITHDRAWN/CANCELLED transition body, exported from enrolment-service.ts, used by withdrawEnrolment, cancelEnrolment AND cancelCohort's bulk loop"
  - "Phase-5 seed data: SLP-2026-03 (third cohort, holdMinutes:0, same programme as SLP-2026-01), 4 new demo learners, every Enrolment status populated, a live and an expired seat hold, a same-programme transfer pair, all three D-19 attendance-exception categories, one cohort (FCM-2026-02) left with zero enrolments"
affects: [05-13, 05-14, 05-15, 05-16]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared transition body pattern: a state-machine's single-row action (withdrawEnrolment) and a bulk caller (cancelCohort) both call one exported function taking an already-open tx and an already-fetched row, rather than the bulk path re-deriving VALID_TRANSITIONS/assertTransition."
    - "Narrow tx interface for a shared primitive: EnrolmentExitTxClient declares only what applyEnrolmentExit's writes need ($queryRaw/$executeRaw/enrolment.update/cohort.update/domainEvent.create), so a caller with no enrolment.create surface (cancelCohort's bulk tx) can still satisfy it without widening to the single-enrolment EnrolmentTxClient."
    - "Recompute-not-track: seed.ts derives Cohort.seatsTaken from a live COUNT of seat-holding Enrolment rows on every run, rather than hand-maintaining the number, so it can never drift from the seeded data."

key-files:
  created:
    - tests/cohort-cancel.integration.test.ts
  modified:
    - src/server/services/cohort-service.ts
    - src/server/services/enrolment-service.ts
    - tests/cohort-service.test.ts
    - prisma/seed.ts

key-decisions:
  - "applyEnrolmentExit lives in enrolment-service.ts (not cohort-service.ts) and is exported for cohort-service.ts to import — keeps the transition table in exactly one file, matching the plan's explicit grep gate (VALID_TRANSITIONS/assertTransition must appear zero times in cohort-service.ts)."
  - "CohortPublishTx (cohort-service.ts) was widened rather than adding a second tx type — publishCohort's existing tests pass a narrower fake cast through `unknown`, so widening the declared type has zero effect on already-passing tests while giving cancelCohort's transaction the enrolment/scheduledSession/$queryRaw/$executeRaw surface it needs."
  - "Per-transition audit rows are written AFTER the transaction commits (matching publishCohort's existing pattern), not inside it — audit-service.ts's recordAudit is not part of the transactional tx client contract in this codebase."
  - "The seed's third cohort (SLP-2026-03) shares programmeId with SLP-2026-01 rather than courseId with FCM-2026-02 — this lets FCM-2026-02 stay genuinely empty (roster empty-state demo) while still providing a legal transferEnrolment target for the Programme cohort's demo learners."
  - "A past ScheduledSession (\"Orientation session\") was added to SLP-2026-01 because all three pre-existing \"Live session N\" rows are scheduled in the future — the D-19 missing-register/at-risk exception categories are unreachable without at least one session whose start has already passed."

patterns-established:
  - "A bulk mutation over a state machine calls the machine's shared per-row function inside its own transaction loop; it never re-checks the transition table itself."

requirements-completed: [COH-05, COH-07]

# Metrics
duration: ~35min
completed: 2026-09-04
---

# Phase 5 Plan 11: Cohort Cancellation & Phase-5 Seed Data Summary

**`cancelCohort` — an atomic, per-learner-audited bulk withdraw plus session soft-cancel plus status change — sharing its transition body with the single-enrolment withdraw/cancel actions via a new `applyEnrolmentExit` primitive, plus a `prisma/seed.ts` extension giving every Phase-5 screen real populated and exception states.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-09-04
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- `cancelCohort` (COH-05/D-31): reason ≥10 trimmed chars, refuses an already-`CANCELLED` cohort, withdraws every `ACTIVE` enrolment and cancels every `PENDING_PAYMENT` one under the shared reason, soft-cancels every open `ScheduledSession` (never a delete, D-26), and claims the cohort with a conditional `updateMany` → `StaleOrderError` on a lost race — all inside one `$transaction`.
- Extracted `applyEnrolmentExit(tx, {enrolment, toStatus, reason, actorId, now})` from `enrolment-service.ts`'s `makeTerminalAction` so `withdrawEnrolment`, `cancelEnrolment` and `cancelCohort`'s bulk loop share one transition body — the transition table (`VALID_TRANSITIONS`/`assertTransition`) exists in exactly one file, proven by a zero-count grep gate against `cohort-service.ts`.
- Per-transition audit rows: one per affected enrolment, one per cancelled session, one for the cohort — never a single batch row (D-31, T-05-69) — plus one `DomainEvent` per affected enrolment and one `cohort.cancelled`, all written inside the transaction (events) or immediately after commit (audit).
- Real-Postgres proof (`tests/cohort-cancel.integration.test.ts`, 7 cases): mixed roster (withdraw/cancel/terminal-untouched/session-soft-cancel/seat-zero/no-deletion), per-transition audit count, outbox count, stale-token atomicity, idempotence guard (`CohortCancelBlockedError`), attendance-record survival, and an authorization boundary.
- `prisma/seed.ts` now produces every `EnrolmentStatus` (`ACTIVE`, `PENDING_PAYMENT` ×2 — one live hold, one expired — `WITHDRAWN`, `TRANSFERRED`), all three D-19 attendance-exception categories (missing register, at-risk, disputed/corrected), a `holdMinutes: 0` cohort, and one cohort left with zero enrolments — verified idempotent (`npm run db:seed` twice, identical row counts) and every acceptance-criteria query holds against the dev database.

## Task Commits

1. **Task 1: cancelCohort — atomic bulk withdraw, session cancellation and status change** - `a5a7b49` (feat)
2. **Task 2: Real-Postgres cancellation proof** - `b42cfd6` (test)
3. **Task 3: Phase-5 seed data with populated and exception states** - `a8fd13e` (feat)

_No plan-metadata commit required by this execution mode (sequential, direct-to-branch); SUMMARY.md/STATE.md/ROADMAP.md are disk-only per the phase's `.planning/`-is-gitignored convention._

## Files Created/Modified

- `src/server/services/enrolment-service.ts` — added `EnrolmentExitTxClient` and exported `applyEnrolmentExit`; `makeTerminalAction` now delegates to it instead of inlining `assertTransition`/`releaseSeat`/`writeDomainEvent`.
- `src/server/services/cohort-service.ts` — added `cancelCohort`, `CohortCancelBlockedError`, `ScheduledSessionCancelRow`, `requireCancelReason`; widened `CohortPublishTx` to cover the enrolment/session/raw-SQL surface `cancelCohort`'s transaction needs.
- `tests/cohort-service.test.ts` — new `cancelCohort` describe block: reason validation, already-cancelled block, authorization, mixed-roster happy path (withdraw/cancel/terminal-untouched/sessions/seats/audit/events), mid-loop atomicity via a staged-commit fake `$transaction`, stale-token refusal.
- `tests/cohort-cancel.integration.test.ts` (new) — the 7 real-Postgres cases listed above.
- `prisma/seed.ts` — `holdMinutes: 30` reasserted on the two existing cohorts; new `SLP-2026-03` cohort (`holdMinutes: 0`); 4 new demo learners (`learner4`–`learner7@kqnexus.test`); 7 demo `Enrolment` rows across `SLP-2026-01`/`SLP-2026-03` covering every status; a new past `ScheduledSession` ("Orientation session") backing 3 `AttendanceRecord` rows (missing register / at-risk / disputed-corrected); `seatsTaken` recomputed from a live seat-holder count on every run.

## Decisions Made

See `key-decisions` in frontmatter. In brief: the shared transition body lives in `enrolment-service.ts` (single source of truth for the state machine); `CohortPublishTx` was widened rather than duplicated; audit rows are written after commit to match the existing `publishCohort` convention; the seed's new cohort shares a *programme* (not the masterclass course) with `SLP-2026-01` so `FCM-2026-02` can stay genuinely empty; a new past session was required because every pre-existing session in the seed was in the future.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Seed needed a past `ScheduledSession` to make the D-19 attendance-exception categories reachable**
- **Found during:** Task 3
- **Issue:** The plan's action text calls for a "PAST session left entirely NOT_RECORDED" and an at-risk learner "while a future session remains," but every pre-existing `ScheduledSession` row in `prisma/seed.ts` (`Live session 1/2/3`, `daysFromNow(14 + s*7)`) is scheduled in the future. Without a past session, neither exception category has any data to render.
- **Fix:** Added one new `ScheduledSession` ("Orientation session", `daysFromNow(-3)`) to `programmeCohort`, idempotently (`findFirst`-then-`create`), and hung the missing-register/at-risk/disputed-corrected `AttendanceRecord` rows off it.
- **Files modified:** `prisma/seed.ts`
- **Verification:** `npm run db:seed` run twice with identical counts; a direct query confirmed one `NOT_RECORDED`, one `ABSENT` (at-risk, threshold 75%, 3 future sessions remain), and one corrected row with a non-empty `correctionReason`.
- **Committed in:** `a8fd13e` (Task 3 commit)

**2. [Rule 2 - Missing Critical] A fourth cohort constraint required resolving a tension the plan's action text didn't fully spell out**
- **Found during:** Task 3
- **Issue:** The plan asks for (a) a third cohort demonstrating the hold-less branch, (b) a same-offer `TRANSFERRED` pair, (c) an at-risk learner specifically on the `attendanceThresholdPct: 75` Programme cohort (`SLP-2026-01`), and (d) one cohort left with zero enrolments — but a `TRANSFERRED` pair leaves BOTH cohorts non-empty (the source retains a `TRANSFERRED` row, the target gets a new `ACTIVE` row), and the at-risk requirement forces `SLP-2026-01` to have enrolments. Naively pairing the new cohort with `FCM-2026-02` (masterclass) for the transfer would leave no cohort empty at all.
- **Fix:** Made the new third cohort (`SLP-2026-03`) share `programmeId` with `SLP-2026-01` (not `courseId` with `FCM-2026-02`), so the transfer and every other new demo row live on `SLP-2026-01`/`SLP-2026-03`, and `FCM-2026-02` needs no changes at all — it satisfies "one seeded cohort with no enrolments" by simply being left alone.
- **Files modified:** `prisma/seed.ts`
- **Verification:** Direct query after seeding: `FCM-2026-02` has 0 enrolments; `SLP-2026-01`/`SLP-2026-03` each have `seatsTaken` equal to their seat-holding enrolment count.
- **Committed in:** `a8fd13e` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 — missing critical functionality needed to satisfy the plan's own acceptance criteria).
**Impact on plan:** Both were necessary to make the plan's stated seed acceptance criteria actually reachable; no scope creep beyond that. No architectural change, no new dependency, no schema change.

## Issues Encountered

None beyond the two items above, both resolved as documented.

## User Setup Required

None — no external service configuration required. `npm run db:seed` was run twice against the reachable dev Neon Postgres per this session's environment notes, confirming idempotency and every acceptance-criteria query.

## Known Stubs

None. `cancelCohort` is fully wired end-to-end at the service layer (no UI action calls it yet — that is 05-15's job per the phase's wave plan, consistent with `cancelCohort` being exported and ready for that plan to consume).

## Threat Flags

None beyond the plan's own `<threat_model>` (T-05-68..T-05-75), all of which the grep gates and the unit/integration tests directly verify:
- T-05-68 (elevation of privilege) — `withPermission("cohorts.manage", cohortResourceScope)` + mandatory 10-char reason; proven by the "requires cohorts.manage" unit and integration tests.
- T-05-69 (repudiation / batch audit) — per-transition audit rows; proven by both the unit test's audit-count assertions and integration case 2.
- T-05-70 (partial-apply tampering) — single `$transaction`; proven by the unit test's staged-commit mid-loop failure case and integration case 4 (stale token).
- T-05-71 (duplicated state machine) — `applyEnrolmentExit` shared; proven by the `grep -c "VALID_TRANSITIONS\|assertTransition" src/server/services/cohort-service.ts` == 0 gate.
- T-05-72 (hard-delete) — soft-cancel only; proven by the `grep -c "delete(\|deleteMany("` == 0 gate and integration case 1's unchanged row counts / case 6's surviving attendance.
- T-05-73 (concurrent-edit loss) — conditional `updateMany` → `StaleOrderError`; proven by the unit and integration stale-token tests.
- T-05-74 (seeded accounts reaching non-dev) — all seeded emails are `@kqnexus.test`; seeding only runs via `npm run db:seed`.
- T-05-75 (seeded `seatsTaken` drift) — recomputed live from a `COUNT` query on every seed run, never hand-maintained.

## Next Phase Readiness

- `cancelCohort` and `CohortCancelBlockedError` are exported from `src/server/services/cohort-service.ts`, ready for 05-15's cohort-detail-page cancel action (UI-SPEC line 160's `ConfirmModal tone="danger"`, `minReasonLength: 10`).
- `applyEnrolmentExit`'s signature — `applyEnrolmentExit(tx, { enrolment: EnrolmentRow, toStatus: "WITHDRAWN" | "CANCELLED", reason: string, actorId: string, now: Date })`, returning `{ id, before, toStatus }` — is available to any future plan that needs the same shared transition body.
- Seeded cohort codes and demo learner emails for 05-12 through 05-16 to verify against:
  - `SLP-2026-01` (Programme cohort, `attendanceThresholdPct: 75`, `holdMinutes: 30`) — populated roster with every enrolment status except a hold-less pending payment, plus the three D-19 attendance-exception categories.
  - `SLP-2026-03` (Programme cohort, `holdMinutes: 0`, same programme as `SLP-2026-01`) — the transfer target plus a hold-less `PENDING_PAYMENT` demo row.
  - `FCM-2026-02` (standalone-Course cohort) — deliberately zero enrolments, the roster empty-state demo.
  - Demo learner emails: `learner1@kqnexus.test` (WITHDRAWN on SLP-2026-01), `learner2@kqnexus.test` (TRANSFERRED source on SLP-2026-01 / ACTIVE target on SLP-2026-03), `learner3@kqnexus.test` (ACTIVE, missing-register), `learner4@kqnexus.test` (ACTIVE, disputed/corrected attendance), `learner5@kqnexus.test` (ACTIVE, at-risk), `learner6@kqnexus.test` (PENDING_PAYMENT, live/future hold), `learner7@kqnexus.test` (PENDING_PAYMENT past/expired hold on SLP-2026-01, and a hold-less PENDING_PAYMENT on SLP-2026-03). All share the dev password `Passw0rd!dev`.
- No blockers for 05-13/05-14/05-15/05-16.

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*

## Self-Check: PASSED

All created/modified files verified present; all three task commits (`a5a7b49`, `b42cfd6`, `a8fd13e`) verified in `git log`.
