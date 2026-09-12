---
phase: 5
slug: cohorts-scheduling-enrolment-operations-attendance
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-03
reconciled: 2026-09-04
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` → "Validation Architecture" (Phase Requirements → Test Map, Wave 0 Gaps).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest `^4.1.11` (unit + integration); jsdom `^29.1.1` for component tests |
| **Config file** | none checked in — vitest runs on defaults + `@vitejs/plugin-react`. Wave 0 decides whether a `vitest.config.ts` project split is needed to separate slow `*.integration.test.ts` (Testcontainers/Docker) from unit tests. |
| **Quick run command** | `npx vitest run <pattern>` (unit tests are sub-second) |
| **Full suite command** | `npm test` (`vitest run` — includes Testcontainers integration files, needs Docker) |
| **Estimated runtime** | unit ~seconds; full suite ~2–3 min (container start). Integration timeout constant `TEST_DB_TIMEOUT_MS = 180_000` (`tests/support/pg.ts:44`). |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <files touched>`
- **After every plan wave:** Run `npm test` (full suite, incl. integration — requires Docker)
- **Before `/gsd:verify-work`:** Full suite green **and** the three integration files (`seat-accounting`, `hold-release`, `enrolment-service`/`attendance-service`) explicitly passing
- **Max feedback latency:** ~5 s for unit sampling; ~180 s per wave merge

---

## Per-Task Verification Map

> Reconciled 2026-09-04 to the final 16-plan structure. Every row's test file is created by a
> Wave 0 / early-wave TDD task in the plan named in the Plan column; "❌ W0" means the file is
> authored during execution, not that it is unplanned.

| Req | Behaviour | Test Type | Automated Command | Plan (authors test) |
|-----|-----------|-----------|-------------------|---------------------|
| COH-06 / D-05 | 2 concurrent `takeSeat` on capacity-1 → exactly one wins; `seatsTaken` never exceeds `capacity`; CHECK never fires | integration (real Postgres) | `npx vitest run tests/seat-accounting.integration.test.ts` | 05-04 |
| COH-05 / D-15 | Re-enrol after `WITHDRAWN` succeeds; second `ACTIVE` for same (user,cohort) → `AlreadyEnrolledError`, not P2002/500 | integration | `npx vitest run tests/seat-accounting.integration.test.ts` | 05-04 |
| COH-06 / D-04 | `releaseSeat` decrements under `FOR UPDATE`, floors at 0 | integration | `npx vitest run tests/seat-accounting.integration.test.ts` | 05-04 |
| COH-06 / D-03 | `releaseExpiredHolds()` cancels only `PENDING_PAYMENT` past `holdExpiresAt`, decrements seats, idempotent on re-run | integration | `npx vitest run tests/hold-release.integration.test.ts` | 05-09 |
| COH-01 / D-30 | Cannot change `courseId`/`programmeId` once any `Enrolment` exists | unit + integration | `npx vitest run tests/cohort-service.test.ts` | 05-05 |
| COH-01 (DB) | XOR CHECK rejects a cohort with both/neither offer | schema test | `npx vitest run tests/schema-cohort.test.ts` | 05-01 |
| COH-02 (DB) | date-order CHECK rejects `endsAt < startsAt` | schema test | `npx vitest run tests/schema-cohort.test.ts` | 05-01 |
| COH-03 / D-22 | "repeat weekly ×N" inserts exactly N rows at +7-day steps | unit | `npx vitest run tests/scheduled-session-service.test.ts` | 05-06 |
| COH-03 / D-23 | `wallTimeToUtc` round-trips for `Africa/Lagos` + one non-UTC+0 zone; invalid zone rejected | unit (pure) | `npx vitest run tests/timezone.test.ts` | 05-02 |
| COH-03 / D-26 | session soft-cancel sets `cancelledAt` + `cancellationReason`, never deletes | unit | `npx vitest run tests/scheduled-session-service.test.ts` | 05-06 |
| COH-04 / D-28,D-29 | `evaluateCohortReadiness` — each slot PASS/FAIL/WARN per D-28 rules; `blockingFailures` blocks publish; Catalogue slot FAIL unless pinned to PUBLISHED | unit (pure) | `npx vitest run tests/cohort-readiness.test.ts` | 05-03 |
| COH-05 / D-11–14,D-16 | each transition validated; illegal transition rejected; reason mandatory; audit + domain event written | unit | `npx vitest run tests/enrolment-service.test.ts` | 05-07 |
| COH-05 / D-13 | transfer: source → `TRANSFERRED` (seat released), target `ACTIVE` (seat taken, capacity-checked), linked, attendance NOT copied | integration | `npx vitest run tests/enrolment-service.integration.test.ts` | 05-07 |
| COH-07 / D-21 | Instructor scoped to assigned cohorts only; out-of-scope cohort → denied (not filtered) | unit (`with-permission` harness) | `npx vitest run tests/roster-service.test.ts` | 05-10 |
| COH-07 / D-18 | deferred columns render as third state, never 0/blank | component | `npx vitest run tests/components/cohort-roster.test.tsx` | 05-14 |
| ATT-01 / D-07 | mark stamps `recordedById`/`recordedAt`; bulk write touches only roster enrolments | unit + integration | `npx vitest run tests/attendance-service.test.ts` | 05-08 |
| ATT-01 / D-10 | bulk mark cannot write an `AttendanceRecord` for a non-enrolled / out-of-scope learner | integration | `npx vitest run tests/attendance-service.integration.test.ts` | 05-08 |
| ATT-03 / D-06,D-08 | inside window: no reason; after `endsAt + 168h`: empty `correctionReason` rejected, stamps `correctedById`/`correctedAt`; before/after in `AuditEvent` | unit (window boundary) + integration | `npx vitest run tests/attendance-window.test.ts` + `tests/attendance-service.integration.test.ts` | 05-02 / 05-08 |
| ATT-01 / D-09 | pre-start mark of `PRESENT`/`ABSENT`/`LATE` rejected; `EXCUSED`/`NOT_RECORDED` allowed | unit | `npx vitest run tests/attendance-service.test.ts` | 05-08 |
| ATT-02 / D-20 | attendance component (earned vs required %) computed correctly from records + threshold; `"attendance changed"` event emitted on every mark/correction | unit (pure) + integration (event row) | `npx vitest run tests/attendance-component.test.ts` | 05-02 / 05-08 |
| ATT-04 / D-19 | exception categories correct; CSV values == on-screen filtered values | unit | `npx vitest run tests/roster-service.test.ts` | 05-10 |
| D-32 (boundary) | worker runtime closure does not import `@/server/permissions` / `next/headers` after adding the hold-sweep | existing test, re-run | `npx vitest run tests/boundary.test.ts` | 05-09 (re-run; file exists) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/support/cohort-fixtures.ts` — `seedCohort` / `seedEnrolment` / `seedSession` helpers (mirror `tests/reorder.integration.test.ts:59` `seedCourse`)
- [ ] `tests/seat-accounting.integration.test.ts` — COH-06/D-04/D-05, COH-05/D-15
- [ ] `tests/hold-release.integration.test.ts` — COH-06/D-03
- [ ] `tests/schema-cohort.test.ts` — DB CHECK/index regression (pattern: `tests/schema-catalogue.test.ts`); **required** if Phase 5 adds any raw-SQL constraint
- [ ] `tests/timezone.test.ts`, `tests/attendance-window.test.ts` — pure unit, no infra
- [ ] `tests/cohort-readiness.test.ts`, `tests/cohort-service.test.ts`, `tests/scheduled-session-service.test.ts`, `tests/enrolment-service.test.ts`, `tests/attendance-service.test.ts`, `tests/attendance-component.test.ts`, `tests/cohort-scope.test.ts`, `tests/roster-service.test.ts` — unit with fake delegates + `createTestWithPermission` (`tests/support/harness.ts`)
- [ ] `tests/enrolment-service.integration.test.ts`, `tests/attendance-service.integration.test.ts` — real-Postgres transition/scoping proofs
- [ ] Decide (Wave 0): add `vitest.config.ts` project split so unit tests run without Docker
- [ ] Update `tests/readiness.test.ts:101-106` when the Course-evaluator `deferredTo: "Phase 5"` stubs are removed

*Existing infrastructure (`tests/support/pg.ts` Testcontainers harness, `tests/support/harness.ts` permission harness) covers the mechanics; the files above are the phase-specific stubs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cohort publish dialog + persistent readiness panel render/refresh | COH-04 | Reuses the Phase-4 shared panel/dialog UI; visual parity check | Open a draft cohort with a failing slot → panel shows FAIL, publish disabled; fix the slot → panel refreshes to PASS, publish enabled |
| Meeting-link visibility window | COH-03 / D-25 | Time-dependent UI gate best confirmed against the running app | As an enrolled learner, view a session >`linkVisibleFromMinutes` out → link hidden; inside window → link shown; as an unenrolled user → always hidden |
| Bulk attendance "save all" screen | ATT-01 | Arrange-board-style commit-once interaction | Mark a full roster, change several states, "save all" → one commit, all records stamped |
| Cohort-cancel bulk-withdraw confirmation | D-31 | High-impact confirm modal + shared reason | Cancel a cohort with active enrolments → confirmation requires a reason; each resulting `WITHDRAWN` transition appears in audit |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — every plan task carries `<verify><automated>`; Wave 0 test files are authored by the TDD tasks in the plans named in the map above
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — the 12 phase-specific test files in "Wave 0 Requirements" are each a task in plans 05-01/05-02/05-06/05-07/05-08/05-09/05-10
- [x] No watch-mode flags
- [x] Feedback latency < 180s per wave / < 5s per task — `npm run build` / full `npm test` used only on the wave-5 assembly plan (05-15) and the phase-close gate (05-16); leaf plans use scoped `npx vitest run`
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-04 (plan-checker revision pass). `wave_0_complete` flips to `true` during execution once the Wave 0 test files land and run red-then-green.
