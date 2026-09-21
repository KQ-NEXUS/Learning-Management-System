# Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-03
**Phase:** 5-cohorts-scheduling-enrolment-operations-attendance
**Areas discussed:** Seat holds for unpaid enrolments, Attendance marking window, Staff enrolment actions, Roster real-now vs named-gaps (all resolved by recommendation)

---

## Gray-area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Seat holds for unpaid enrolments (COH-06) | Does a PENDING_PAYMENT enrolment hold a seat, and for how long? Sets the Phase 6 checkout contract. | — |
| Attendance marking window (ATT-01/03) | What is "the normal marking window" that ATT-03 references but never defines? Pre-marking? | — |
| Staff enrolment actions (COH-05) | Comp seats with no payment? What does "transfer" move? Does progress/attendance carry across? | — |
| Roster: real now vs named gaps (COH-07, ATT-02/04) | Show enrolment + attendance for real and defer Progress/Assessment/Completion as named gaps, or hold the roster? | — |

**User's choice:** "recommend the best options based on the plan" — deferred all four areas to Claude's recommendation.
**Notes:** User asked for grounded recommendations rather than an interactive walk-through.

---

## Recommendations presented (single approval gate)

| Option | Description | Selected |
|--------|-------------|----------|
| Approve all | Write CONTEXT.md with all four recommendations + discretion decisions + deferred list as stated. | ✓ |
| Approve with changes | Adjust specific points (30-min hold / 7-day window / transfer scope). | |
| Discuss some areas properly | Open one or more areas for interactive discussion. | |

**User's choice:** Approve all.

**Recommendations locked (see CONTEXT.md D-01…D-32 for detail):**

### Seat holds (COH-06)
A `PENDING_PAYMENT` enrolment holds a seat via the schema's `seatsTaken` + `SELECT … FOR UPDATE`
recipe (no separate Reservation table). Per-cohort hold TTL, default 30 min (0/null = seat on
payment only). A pg-boss job releases expired holds → `CANCELLED` "hold expired". One shared
seat-accounting helper that Phase 6 checkout also calls. Proven against real Postgres
(Testcontainers).

### Attendance marking window (ATT-01/03)
Normal marking from session start until 7 days after session end (`ATTENDANCE_MARKING_WINDOW_HOURS
= 168` constant). After the window: mandatory `correctionReason` + `correctedBy/At`. Pre-marking
allowed only as EXCUSED / NOT_RECORDED.

### Staff enrolment actions (COH-05)
Mechanism only, no policy engine (per PRD §15.3(4) "do not automate approval logic"). Add
(direct ACTIVE comp, or PENDING_PAYMENT + hold); Approve (PENDING_PAYMENT → ACTIVE, no payment
record); Transfer (same-offer cohorts only, seat released/taken, attendance/progress do NOT carry
across, no auto-refund); Withdraw/Cancel (reason mandatory, seat released, event emitted, no
auto-refund). Partial unique index is the duplicate guard.

### Roster & exceptions (COH-07, ATT-02/04)
Roster ships now with real columns (identity, enrolment status + history, access window,
attendance %); Progress/Assessment/Completion render as an explicit "not yet · Phase N" third
state. Exceptions view built real (missing registers / at-risk / disputed-corrected) with a
bounded synchronous CSV. Phase 5 stores the attendance component + emits an "attendance changed"
event; the completion verdict + recalc is the Phase 9/11 engine.

---

## Claude's Discretion

- Exact new field names (`holdMinutes` vs `seatHoldMinutes`, etc.).
- Home of the seat-accounting helper (new service vs shared `seat-accounting.ts`).
- Wave / plan breakdown.
- Shape of the "attendance changed" domain event and the dispatch mechanism (in-process emitter
  vs outbox row) — research to recommend, consistent with Phase-4 worker/queue patterns.
- Roster column order and filter set.
- Whether "repeat weekly ×N" is a server action or a small client form.

## Deferred Ideas

- Waitlist / waiting list for full cohorts.
- Cross-offer transfer + COH-01's "approved migration path" for changing a cohort's offer after
  enrolment.
- Session recurrence entity (RRULE-style) — Phase 5 ships a "repeat weekly ×N" row-inserter only.
- Automated refund / credit on withdrawal or transfer (Phase 7/8 + business policy).
- Self-paced access-duration model (PRD §15.3(1) — decision required before Phase 9).
- Per-cohort attendance marking window (Phase 5 uses a project constant).
