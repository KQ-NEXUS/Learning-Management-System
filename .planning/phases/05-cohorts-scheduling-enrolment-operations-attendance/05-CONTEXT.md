# Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning
**Track:** B — Content & Delivery (parallel-eligible with Phases 2–3; depends on Phase 4)

<domain>
## Phase Boundary

Staff can stand up and run a real delivery calendar: create a Cohort against exactly one
Course **or** one Programme, set its enrolment window / dates / timezone / capacity / price /
currency / delivery mode / instructors, schedule sessions, publish it behind readiness checks,
run the enrolment lifecycle (add / approve / transfer / withdraw / cancel) safely under
concurrency, and mark & correct attendance — with a scoped cohort-level roster and an
attendance-exceptions view.

**In scope (COH-01 → COH-07, ATT-01 → ATT-04):**
- Cohort authoring: one-offer target (Course XOR Programme), immutable once any enrolment exists;
  window/dates/timezone/capacity/price/currency/delivery-mode/instructors; bound to a **published**
  Course/Programme snapshot via the Phase-4 publication pins.
- Scheduled sessions: title, date/time (entered in the cohort timezone, stored UTC), duration,
  location / meeting link with visibility window, facilitator, attendance expectation; a
  "repeat weekly ×N" convenience that just creates N rows.
- Cohort publish gated on the readiness evaluator — this phase fills the five slots the Phase-4
  evaluator reserved as `NOT_YET_CHECKED` / `deferredTo: "Phase 5"` (Schedule, Price, Capacity,
  Instructors, Completion) plus a Catalogue slot.
- Capacity enforcement under concurrency (COH-06): a `PENDING_PAYMENT` enrolment holds a seat;
  per-cohort hold TTL; a worker job releases expired holds.
- Enrolment lifecycle (COH-05): mechanism only — validated state transitions, mandatory reason,
  audit, no-duplicate-active guard. **No business-approval / policy engine** (PRD §15.3(4)).
- Cohort roster (COH-07): real columns now, explicit named-gap columns for Phase 9/10/11 systems.
- Attendance (ATT-01..04): mark present/absent/late/excused/not-recorded; a per-project marking
  window after which changes require a correction reason; pre-marking limited to EXCUSED /
  NOT_RECORDED; attendance-component computation + "attendance changed" event; exceptions view
  with bounded CSV.

**Explicitly NOT in scope:**
- Checkout / payment / order creation (Phase 6) — this phase defines the seat-hold contract and
  the shared seat-accounting helper that Phase 6 calls.
- Manual payment confirmation and refunds (Phase 7) — "approve" here is the enrolment-side
  transition only; Phase 7 calls it.
- Async / large CSV export infrastructure with queued/processing/retry states (Phase 8) — a
  bounded synchronous one-cohort CSV is fine here.
- Learning-delivery progress tracking and the completion-rule engine (Phase 9 / Phase 11) —
  this phase renders those as named gaps and emits events the future engine subscribes to.
- Assessment authoring / grading (Phase 10).
- Transactional emails (Phase 13) — this phase emits domain events / records intent.
- Cross-offer transfer and COH-01's "approved migration path" for changing a cohort's offer
  after enrolment (deferred).
</domain>

<decisions>
## Implementation Decisions

### Seat holds & capacity (COH-06)
- **D-01:** A `PENDING_PAYMENT` enrolment **holds a seat** — `seatsTaken` is incremented inside
  the same `SELECT … FOR UPDATE` transaction on the `Cohort` row that an `ACTIVE` enrolment uses.
  No separate `Reservation` / `SeatReservation` table — the schema's `seatsTaken` and the
  `PENDING_PAYMENT` status were designed for exactly this (`prisma/schema.prisma:744-748`,
  `prisma/sql/001_integrity.sql` §3).
- **D-02:** Hold TTL is **per-cohort**, new nullable `Cohort` field (recommended name
  `holdMinutes` / `seatHoldMinutes`), **default 30 minutes**. `null` or `0` = no hold; the seat
  is only taken when the enrolment goes `ACTIVE`.
- **D-03:** A **pg-boss worker job** (reuse the Phase-4 `worker/` service + Docker stack) sweeps
  expired holds: `PENDING_PAYMENT` enrolments older than the hold window → status `CANCELLED`,
  reason `"hold expired"`, `seatsTaken` decremented under `FOR UPDATE`. Idempotent; bounded retry.
- **D-04:** Phase 5 builds one **shared seat-accounting helper** (take-seat: `FOR UPDATE` →
  refuse if `seatsTaken >= capacity` → insert enrolment → increment; release-seat: `FOR UPDATE`
  → decrement, floor at 0). **Phase 6 checkout calls the same helper** — it is not re-implemented.
- **D-05:** This is the highest-risk mechanism in the phase and must be proven against a **real
  Postgres** (reuse Phase 4's Testcontainers harness): two concurrent take-seat transactions on
  a capacity-1 cohort → exactly one succeeds; the `cohort_capacity_not_exceeded` CHECK is the
  backstop, not the primary guard.

### Attendance marking window (ATT-01 / ATT-03)
- **D-06:** "Normal" marking runs from a session's scheduled **start** until **7 days after it
  ends**. Implement as a project constant `ATTENDANCE_MARKING_WINDOW_HOURS = 168` for Phase 5;
  promote to a per-cohort field only if the user later asks.
- **D-07:** Inside the window: staff mark/change freely; each write stamps `recordedById` +
  `recordedAt` + optional `note` (`AttendanceRecord` fields already exist).
- **D-08:** After the window: the same action **requires a non-empty `correctionReason`** and
  stamps `correctedById` + `correctedAt` (fields already exist). Before/after state + reason stay
  in audit history (ATT-03).
- **D-09:** **Pre-marking** (before a session's start time) is allowed but restricted to
  `EXCUSED` or `NOT_RECORDED`. `PRESENT` / `ABSENT` / `LATE` require the session start to have
  passed.
- **D-10:** Bulk marking for a session must not touch out-of-scope learners (ATT-01) — the
  operation is scoped to the cohort's roster via `withPermission` + cohort scope.

### Staff enrolment actions (COH-05) — mechanism, not policy
- **D-11:** **Add** — staff create an enrolment directly, either straight to `ACTIVE`
  (comp / corporate / scholarship; `orderId` null; mandatory reason; takes a seat via D-04) or
  `PENDING_PAYMENT` with a hold.
- **D-12:** **Approve** — transition a `PENDING_PAYMENT` enrolment to `ACTIVE` with no payment
  record (mandatory reason, audited). Phase 7's manual-payment path calls this transition later.
- **D-13:** **Transfer** — moves an enrolment to a **different Cohort of the same offer only**
  (same `courseId`, or same `programmeId`). Old enrolment → `TRANSFERRED` (seat released), new
  `ACTIVE` enrolment in the target (seat taken, capacity-checked via D-04); both audited and
  linked (the new enrolment records the source enrolment id); mandatory reason. **Attendance and
  progress do NOT carry across** — history stays on the prior enrolment. Cross-offer transfer is
  out of scope (deferred).
- **D-14:** **Withdraw / Cancel** — `WITHDRAWN` (access already started) vs `CANCELLED` (before
  access, or administrative void). Both: mandatory reason, seat released, audited, a domain event
  emitted for the Phase-13 email. **No automated refund or credit** (PRD §15.3(4)).
- **D-15:** The partial unique index `enrolment_one_active_per_learner_cohort`
  (`prisma/sql/001_integrity.sql` §1) is the hard guard against duplicate active enrolments —
  application code must surface its violation as a clean "already enrolled" result, not a 500.
- **D-16:** No approval workflow, no policy/rules engine. Staff holding `enrolments.manage` in
  scope perform the action; the system validates the transition, captures the reason, writes the
  audit event, emits the notification event, and never creates a duplicate active enrolment.

### Cohort roster & attendance exceptions (COH-07, ATT-02 / ATT-04)
- **D-17:** The roster ships now with **real** columns: learner identity, enrolment status +
  transition history, access window, attendance (earned vs required %, per-session states,
  exception flags), instructor assignment.
- **D-18:** Columns whose engines don't exist yet render as an **explicit third state** (same
  discipline as the Phase-4 readiness panel's `NOT_YET_CHECKED`), never blank and never a fake
  zero: **Progress → "not tracked yet · Phase 9"**, **Assessment → "· Phase 10"**,
  **Completion / certificate → "· Phase 11"**.
- **D-19:** **Attendance exceptions view** (ATT-04) is built for real: missing registers (past
  sessions with `NOT_RECORDED` rows), at-risk (below `attendanceThresholdPct` with sessions
  remaining), disputed/corrected (rows carrying `correctionReason`). Filterable; **bounded
  synchronous CSV** of one cohort's exceptions with values that match the on-screen filters
  (async export infra is Phase 8).
- **D-20:** **ATT-02** — Phase 5 computes and stores/exposes the **attendance component** only
  (earned vs required, from `attendanceThresholdPct`), and emits an `"attendance changed"`
  domain event on every mark/correction. The overall completion verdict and its
  recalculation-on-correction belong to the Phase 9 / Phase 11 completion engine, which
  subscribes to that event.
- **D-21:** Scoping (COH-07): an Instructor sees only the rosters of Cohorts they are assigned
  to (`CohortInstructor`); opening a learner detail never exposes out-of-scope Cohorts.

### Sessions & scheduling (COH-03)
- **D-22:** Sessions are created one at a time, plus a **"repeat weekly ×N"** convenience that
  simply inserts N `ScheduledSession` rows — **no recurrence entity / RRULE** (deferred).
- **D-23:** Session date/time is entered in the **Cohort's `timezone`** and stored UTC in
  `ScheduledSession.startsAt` / `endsAt` (both `DateTime`). The UI shows the cohort timezone
  explicitly.
- **D-24:** A Programme-cohort session **may optionally** be tagged to a member Course
  (`ScheduledSession.courseId` is already nullable).
- **D-25:** Meeting-link visibility follows `linkVisibleFromMinutes` (default 60) and enrolment
  — hidden before the window and from unenrolled users (LRN-06 groundwork; the schema field
  exists).
- **D-26:** Sessions **soft-cancel** via `cancelledAt` + `cancellationReason` (fields exist) —
  never hard-deleted.

### Cohort publish readiness (COH-04)
- **D-27:** Cohort publish reuses the pure four-state evaluator
  (`src/server/services/readiness-service.ts`) and the persistent-panel + dialog-summary UI from
  Phase 4. Publish is gated on `cohorts.publish` in matching scope + all blocking items PASS.
- **D-28:** The five reserved slots become real checks:
  - **Schedule** — PASS if `deliveryMode = SELF_PACED` **or** ≥1 non-cancelled session exists;
    FAIL otherwise. WARN if a session falls outside the cohort's start/end dates.
  - **Price** — PASS if `priceMinor >= 0` and `currency` set (0 is a legal free cohort).
  - **Capacity** — PASS if `capacity > 0` and `capacity >= seatsTaken`; FAIL if `capacity < 1`.
  - **Instructors** — PASS if `deliveryMode = SELF_PACED` **or** ≥1 `CohortInstructor`; FAIL for
    `INSTRUCTOR_LED` / `BLENDED` with none.
  - **Completion** — PASS if the pinned Course/Programme publication carries a completion rule;
    WARN if `attendanceThresholdPct` is set while `deliveryMode = SELF_PACED`.
- **D-29:** New **Catalogue** slot — PASS if the Cohort is pinned to a **published**
  Course/Programme publication (via `coursePublicationId` / `programmePublicationId`), FAIL if it
  points at a live/draft record or nothing.

### Cohort lifecycle & immutability
- **D-30:** `courseId` / `programmeId` (the offer target) is **locked once any `Enrolment` row
  exists** for the Cohort, in any status. Changing the offer afterward is unsupported in Phase 5
  (COH-01's "approved migration path" is deferred).
- **D-31:** Cancelling a Cohort that has active enrolments requires confirmation and a
  **bulk-withdraw with a single shared reason** (each resulting `WITHDRAWN` transition audited).
  A Cohort is never hard-deleted — it moves to `CANCELLED` with a reason.
- **D-32:** All Cohort / session / enrolment / attendance mutations route through
  `withPermission` and are written audit-first via the resource-service factory pattern; no code
  outside `src/server/services/` imports `@prisma/client`.

### Claude's Discretion
The user approved all recommendations without opening any area for interactive discussion
("recommend the best options based on the plan" → "Approve all"). The planner and researcher
have latitude on: exact new field names (`holdMinutes` vs `seatHoldMinutes`, etc.); whether the
seat-accounting helper lives in a new `cohort-service` / `enrolment-service` or a shared
`seat-accounting.ts`; the wave/plan breakdown; the precise shape of the "attendance changed"
domain event and how events are dispatched (in-process emitter vs a lightweight outbox row) —
research should recommend, consistent with the Phase-4 worker/queue patterns; the roster table's
column order and filter set; whether the "repeat weekly ×N" helper is a server action or a small
client form. None of these change the locked decisions above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

> Note: the PRD / PXR Revision 3 documents cited across `.planning/` as
> `docs/reference/Professional-Training-LMS-{PRD,PXR}-Revision-3-*.md` are **not present in the
> working tree** on this branch. The authorities that ARE available are the `.planning/` intel
> and requirements files below — treat them as the requirement source of record for this phase.

### Requirements & product intent
- `.planning/REQUIREMENTS.md` — COH-01…COH-07 (lines 47–53), ATT-01…ATT-04 (lines 92–95); the
  requirement→phase table (lines 213–223).
- `.planning/intel/requirements.md` — acceptance criteria for COH-05 (line 168), COH-06
  (line 175), ATT-02 (lines 306–307), ATT-03 (line 312), ATT-04 (line 319).
- `.planning/intel/constraints.md` — §83: PRD §15.3 "decisions-required" list, incl. item (4)
  **"refund/cancellation/transfer/withdrawal policy — do not automate approval logic"** and
  item (1) self-paced access-duration (a business decision still open); §63: readiness-checklist
  categories and the "named gaps rather than silently assumed pass" rule; §43: async work must
  be queued/observable/idempotent with bounded retries + idempotency keys on effectful ops;
  §33: the Cohort/Enrolment state-machine vocabulary.
- `.planning/ROADMAP.md` §"Phase 5" (lines 114–128) — goal, requirements, success criteria,
  track & dependency flags.
- `.planning/PROJECT.md` — locked constraints (money = integer minor units, archive-only,
  `@prisma/client` boundary, closed permission catalogue), Key Decisions table.

### Carried forward from Phase 4
- `.planning/phases/04-catalogue-authoring-programmes-courses-modules-lessons/04-CONTEXT.md` —
  D-04/D-05/D-06 (publish snapshots obligations; Cohort pins a publication; publish dialog lists
  affected running Cohorts), D-25/D-26/D-27 (the four-state readiness evaluator, the "not yet
  checked — Phase 5" third state, one shared evaluator + panel), D-32 (Testcontainers for
  DB-semantics tests).
- `.planning/phases/04-.../04-15-SUMMARY.md` — Phase 4 completion state; the worker + Docker
  stack that the hold-release job reuses.

### Code to build on
- `prisma/schema.prisma` — `enum DeliveryMode` (47), `enum CohortStatus` (53),
  `enum EnrolmentStatus` (61), `enum AttendanceState` (91); `model Cohort` (726, incl.
  `seatsTaken`/`capacity` 744–748, publication pins 768–769, `attendanceThresholdPct` 757),
  `model CohortCourse` (797, `contentSnapshot` + `coursePublicationId`),
  `model CohortInstructor` (824), `model ScheduledSession` (836, `meetingUrl` +
  `linkVisibleFromMinutes`, `cancelledAt`), `model AttendanceRecord` (868, `recordedBy/At` vs
  `correctedBy/At/correctionReason`, `@@unique([sessionId, enrolmentId])`),
  `model Enrolment` (893, `status` + `accessStartsAt/EndsAt` + `withdrawnAt` + `reason`).
- `prisma/sql/001_integrity.sql` — §1 one-active-enrolment partial unique index; §2 Cohort
  Course-XOR-Programme CHECK; §3 capacity CHECK + the canonical `SELECT … FOR UPDATE`
  take-seat recipe; §5 cohort date-ordering CHECK. **Research must verify these are actually
  applied in a migration** (STACK.md lists only `20260901115332_init` and
  `20260901152759_login_throttling`).
- `src/server/services/readiness-service.ts` — the pure four-state evaluator; extend its Cohort
  input path (Schedule/Price/Capacity/Instructors/Completion slots already stubbed as
  `NOT_YET_CHECKED` / `deferredTo: "Phase 5"`).
- `src/server/services/resource-service.ts` + `course-service.ts` — the CRUD factory
  (list/get/create/update/archive with authorization, scoping, audit); async-scope support was
  widened in Phase 4 (04-03). Cohort / enrolment / session / attendance services build on this.
- `src/server/services/publish-service.ts` + `publication.ts` — the shared publish operation and
  the publication-record read path the Cohort pins to.
- `src/server/permissions/with-permission.ts` + `catalogue.ts` — the authorization choke point;
  `cohorts.view/manage/publish`, `enrolments.view/manage`, `attendance.view/manage` already
  exist in the closed catalogue (lines 34–44). **No new permission identifiers.**
- `src/server/permissions/scope.ts` — GLOBAL → PROGRAMME → COURSE → COHORT scoping; COHORT scope
  becomes load-bearing this phase (Instructor rosters, attendance).
- `src/components/primitives/` — `ResourceTable` (roster, session list, enrolment list),
  `ResourceForm` (cohort/session forms), `DetailLayout` (cohort detail with tabs),
  `ConfirmModal` (cancel-cohort, correct-attendance, transfer). Reason-capture + high-impact
  confirmation patterns are established here.
- `worker/` + `docker-compose.yml` — the pg-boss worker service (added Phase 4, 04-10) that runs
  the hold-release sweep job.
- `src/app/staff/layout.tsx` — the `NAV` array has a `{ label: "Cohorts", href: null }` and
  `{ label: "Enrolments", href: null }` placeholder; this phase wires them.
- `prisma/seed.ts` — already seeds two Cohorts (`SLP-2026-01`, `FCM-2026-02`), a
  `CohortInstructor`, and 3 `ScheduledSession`s per cohort — extend for enrolment / attendance
  demo data.

### Framework
- `AGENTS.md` / `node_modules/next/dist/docs/` — **mandatory** per `AGENTS.md`; live Next.js is
  16.3.4 and differs from training data. Read the relevant guide before writing code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createResourceService`** — gives Cohort / Session / Enrolment services list/get/create/
  update/archive with authorization, scoping and audit for free; Phase-4 widened it to accept an
  async database-resolved scope, which Cohort-scoped resources need.
- **`readiness-service.ts`** — pure evaluator; the Cohort path already exists with the five
  Phase-5 slots stubbed. Extend, don't replace.
- **`with-permission` + `scope.ts`** — COHORT scope type already modelled; the Instructor
  roster/attendance views are its first real consumers.
- **`ResourceTable` / `ResourceForm` / `DetailLayout` / `ConfirmModal`** — the staff workspace
  runs on these; reason-capture and high-impact confirm modals are already established (audit,
  role picker, publish dialog).
- **Testcontainers Postgres harness** (Phase 4, `04-05`) — the proving ground for the capacity
  race and the one-active-enrolment index.
- **pg-boss worker + Docker stack** (Phase 4, `04-10`) — host for the hold-release job.
- **`prisma/sql/001_integrity.sql`** — the XOR / capacity / date-order / one-active-enrolment
  constraints are already written; the phase applies + relies on them.

### Established Patterns
- **Authorization is never hand-written** — everything routes through `withPermission`; a
  service that re-implements a scope check is wrong.
- **`@prisma/client` only in `src/server/services/`** — ESLint-enforced, `tests/boundary.test.ts`.
- **Audit-first writes** — actor / before-after / reason / outcome on every mutation, via the
  factory.
- **Archive / cancel, never delete** — project-wide; Cohort → `CANCELLED`, session →
  `cancelledAt`, module/lesson → `withdrawnAt`.
- **Named gaps, not silent passes** — the readiness evaluator's `NOT_YET_CHECKED` third state
  and `deferredTo` field; the roster reuses the same idea for Phase 9/10/11 columns.
- **Idempotency + FOR UPDATE on effectful, race-prone ops** — the capacity path is the canonical
  case (`001_integrity.sql` §3).
- **Six render states** on every screen (loading / empty / populated / validation error /
  permission denied / recoverable failure) — the primitives bake these in.

### Integration Points
- **`Cohort` already carries the publication pins** (`coursePublicationId` /
  `programmePublicationId`, Phase 4) — Cohort authoring sets them from the target's latest
  published snapshot; per-course pins for a Programme cohort live on `CohortCourse`.
- **Phase 6 checkout** will call this phase's seat-accounting helper — design it as a standalone,
  transaction-taking function, not a private method of an enrolment service.
- **Phase 7** calls this phase's `approve` enrolment transition after confirming a manual payment.
- **Phase 9 / 11** completion engine subscribes to the `"attendance changed"` event and reads
  the stored attendance component.
- **Phase 13** email dispatch consumes the enrolment / session-change domain events this phase
  emits.
- **Staff nav** — `src/app/staff/layout.tsx` `NAV` has `Cohorts` and `Enrolments` as
  `href: null` placeholders to wire.

</code_context>

<specifics>
## Specific Ideas

- The publish dialog's Cohort-affecting behaviour from Phase 4 (D-06) is the mental model for the
  reverse direction here: when a Cohort is being published, its readiness panel and dialog
  summary use the **one shared evaluator + one shared panel component**.
- The cohort roster should reuse the Phase-4 "distinct third state" visual treatment for the
  Phase 9/10/11 columns — visually different from both a pass and a fail, reading as
  "not yet checked — Phase N".
- Attendance bulk entry for a session should be a single screen listing the roster with a state
  control per learner and one "save all" commit, mirroring the arrange-board "save order" pattern
  (rearrange freely, commit once).
- Reason capture on transfer / withdraw / cancel / late-correction uses the same
  `ConfirmModal` + mandatory-reason pattern as role changes and the publish dialog.

</specifics>

<deferred>
## Deferred Ideas

- **Waitlist / waiting list** when a Cohort is at capacity — not in the COH requirement set;
  its own future slice.
- **Cross-offer transfer** and COH-01's **"approved migration path"** for changing a Cohort's
  Course/Programme target after enrolment has begun — needs a business-policy decision; treat as
  cancel + new enrolment for now.
- **Session recurrence entity** (RRULE-style) — Phase 5 ships a "repeat weekly ×N" row-inserter
  only.
- **Automated refund / credit** on withdrawal or transfer — PRD §15.3(4) says do not automate
  approval logic; Finance handles this in Phase 7 / 8 against approved policy.
- **Self-paced access-duration model** (PRD §15.3(1) — decision required) — whether `SELF_PACED`
  delivery should even use the dated-Cohort shape or an access-window-from-enrolment model.
  Needs a business decision **before Phase 9**; flag it at Phase 5 close.
- **Per-cohort attendance marking window** — Phase 5 uses a project constant
  (`ATTENDANCE_MARKING_WINDOW_HOURS = 168`); promote to a `Cohort` field only on request.

</deferred>

---

*Phase: 5-Cohorts, Scheduling, Enrolment Operations & Attendance*
*Context gathered: 2026-09-03*
