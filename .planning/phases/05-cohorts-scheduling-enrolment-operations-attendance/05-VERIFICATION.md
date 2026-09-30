---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
verified: 2026-09-29
status: passed_with_dependency
score: 10/11 requirements fully verified; COH-05 verified except notification delivery (Phase 13)
overrides_applied: 0
---

# Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance — Verification Report

**Verified:** 2026-09-29 (retroactive — the phase shipped without a VERIFICATION.md; flagged in the v1.0 milestone audit, section 5)
**Status:** passed, with one clause owned by a later phase
**Re-verification:** No — initial verification

## Method

Checked against the current code and a live re-run on 2026-09-29: 32 test files, **488/488 passed**, including nine real-Postgres (Testcontainers) suites — `attendance-service.integration` 9/9, `seat-accounting.integration` 9/9, `hold-release.integration` 14/14, `enrolment-service.integration` 11/11, `enrolment-live-index.integration` 10/10, `cohort-cancel.integration` 8/8, `cohort-lifecycle-security.integration` 12/12, `checkout-hold-race.integration` 3/3, `staff-scoped-lists.integration` 4/4. UAT: `05-UAT.md` 16/16 passed (2026-09-07). The code review's critical findings (05-REVIEW CR-01..03) are fixed in code; CR-02's residual race was closed by the security audit's F-04 (cohort row lock, 2026-09-27).

## Requirements

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **COH-01** — Cohort for one Course or one Programme; offer type immutable once enrolment begins | ✓ VERIFIED | `cohort-scope.ts` resolves exactly one offer shape. D-30 offer lock: `assertOfferMutable` throws `OfferLockedError` once any Enrolment exists, in any status, before a write changing `courseId`/`programmeId` (`cohort-service.ts:93-131`; `cohort-service.test.ts` "throws OfferLockedError when an Enrolment exists in ANY status"). |
| 2 | **COH-02** — Window, dates, time zone, capacity, independent NGN/USD prices, delivery mode, instructors, status; no FX; missing enabled-rail price blocks publish | ✓ VERIFIED | Each rail stored independently, null never coerced to 0, updating one rail never touches the other (`cohort-actions.test.ts`, `cohort-service.test.ts`). Readiness: `price-ngn`/`price-usd` are blocking only when that rail is enabled and FAIL on null or 0 (`cohort-readiness.test.ts` 45/45). DST-correct instants (`cohort-datetime`, `scheduled-session-service` "spring-forward"). Idempotent instructor assignment under concurrent races. |
| 3 | **COH-03** — Sessions with title, time, duration, location/link, facilitator, attendance expectation; link visibility follows access timing | ✓ VERIFIED | `scheduled-session-service.ts`; the meeting link is omitted entirely until `startsAt - linkVisibleFromMinutes`, and never for a cancelled session (`learner-session-service.test.ts` 14/14 — "absent one minute before the window opens"). The learner page never leaks a pre-window URL (`learner-sessions-page.test.ts` 8/8). |
| 4 | **COH-04** — Publish only when readiness passes; pass/fail items shown; permission-gated | ✓ VERIFIED | Nine documented readiness items, blocking set enforced (`cohort-readiness.test.ts`); Publish disabled with the failure count named (`cohort-detail-actions.test.tsx`). Readiness is re-read under the cohort row lock, so a change committed while publish waits is seen and refused (`cohort-lifecycle-security.integration`, F-04). |
| 5 | **COH-05** — Add/approve/transfer/withdraw/cancel with a reason; validated, audited, communicated; never duplicate active enrolments | ⚠ VERIFIED except "communicated" | Validated transitions (`enrolment-transitions.ts`); blank reasons refused; each of the five actions writes one typed DomainEvent and an actor/reason AuditEvent (`enrolment-service.integration`). Duplicate live enrolments impossible via the partial unique index (`enrolment-live-index.integration` 10/10); simultaneous transfers create one destination row. Since 2026-09-28 a live certificate also blocks exits (integration warning #4). **Open:** the domain events (`enrolment.withdrawn/cancelled/transferred`) are recorded, but nothing emails the learner yet — delivery is Phase 13 (COM-01, "every lifecycle event sends exactly one deduplicated email"). |
| 6 | **COH-06** — Capacity enforced at checkout and admin enrolment; concurrency safe; released/expired holds free seats | ✓ VERIFIED | `seat-accounting.ts` takes a `FOR UPDATE` cohort lock. Real Postgres: `seatsTaken` never exceeds capacity under concurrent attempts (`seat-accounting.integration`), expired holds release and return the seat (`hold-release.integration` 14/14), a late webhook after a sweep lands EXCEPTION with correct seat arithmetic (`checkout-hold-race.integration`), a full target rolls a transfer back atomically. |
| 7 | **COH-07** — Cohort views of learners, access, progress, attendance, assessment, completion, exceptions; filterable; no out-of-scope cohorts | ✓ VERIFIED (gap found and closed 2026-09-29) | Roster of learners with status (including Completed), access, lesson progress and attendance; Exceptions tab; Grading tab. **Added 2026-09-29:** the per-learner page has a Results section — each assessment's score, pass/fail, attempts and latest activity — read on the learner's behalf and gated by `submissions.view` over the cohort, with each result narrowed to its assessment's course (F-05) (`staff-learner-results.test.ts`, real Postgres in `learner-results.integration`). The per-learner page also now opens for COMPLETED learners. Out-of-scope cohorts are denied, never an empty roster (`roster-service.test.ts`); scoped staff reach their cohorts since integration warning #1. |
| 8 | **ATT-01** — Mark present/absent/late/excused/not-recorded; actor, time, note recorded; bulk entry cannot touch out-of-scope learners | ✓ VERIFIED | `attendance-service.ts` stamps `recordedById/recordedAt` and audits before/after; bulk save commits only changed entries in one transaction (`attendance-mark.test.tsx`); off-roster (TRANSFERRED/CANCELLED) enrolments refused (CR-01). |
| 9 | **ATT-02** — Attendance threshold as a completion rule; earned/required shown; recalculates after correction | ✓ VERIFIED | `attendance-component` computes earned vs required (e.g. 75/75 meets), `no-rule` for a null threshold and `no-sessions` rather than 0 or NaN. Marking and correction call `recalculateCompletionAndIssue` (verified in the 2026-09-25 integration report). |
| 10 | **ATT-03** — Correction after the window needs a reason; before/after and reason audited | ✓ VERIFIED | Real Postgres: 167 h after `endsAt` a change needs no reason; 169 h after, a no-reason change is refused and a reasoned one stamps correction fields; a mark plus a correction leave two AuditEvent rows with before/after and reason (`attendance-service.integration`). The boundary is exact to the millisecond (`attendance-service.test.ts`). |
| 11 | **ATT-04** — Exceptions (missing registers, at-risk, disputed/corrected) on dashboards and learner detail, filterable, with matching CSV values | ✓ VERIFIED | Cohort Exceptions tab from `loadAttendanceExceptions` (categories filterable); disputed = any record with a `correctionReason`, carrying reason, corrector and time. CSV: the Phase 8 `attendance` report dataset exports the same attendance states. Staff Overview surfaces "Attendance not marked" items. |

**Score:** 10/11 fully verified; COH-05 verified except notification delivery.

## Gaps

- **COH-05 notifications** — owned by Phase 13 (COM-01). Not a Phase 5 defect: the outbox events exist for Phase 13 to consume. REQUIREMENTS.md keeps COH-05 unticked until then.
- **COH-07 assessment view** — found during the UX pass the same day (staff could not see a learner's quiz results) and closed the same day with the per-learner Results section.

## Human verification

Already done: `05-UAT.md`, 16/16 (2026-09-07).
