# Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance - Research

**Researched:** 2026-09-03
**Domain:** Delivery operations — cohort authoring, session scheduling, enrolment state machine, seat concurrency, attendance marking/correction
**Confidence:** HIGH (all findings grounded in this repo's code + checked-in migrations; framework docs read from `node_modules/next/dist/docs/`)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Copied verbatim from `05-CONTEXT.md` `<decisions>`. The planner MUST honour every one.

**Seat holds & capacity (COH-06)**
- **D-01:** A `PENDING_PAYMENT` enrolment **holds a seat** — `seatsTaken` is incremented inside the same `SELECT … FOR UPDATE` transaction on the `Cohort` row that an `ACTIVE` enrolment uses. No separate `Reservation`/`SeatReservation` table.
- **D-02:** Hold TTL is **per-cohort**, new nullable `Cohort` field (recommended name `holdMinutes`/`seatHoldMinutes`), **default 30 minutes**. `null` or `0` = no hold; the seat is only taken when the enrolment goes `ACTIVE`.
- **D-03:** A **pg-boss worker job** (reuse the Phase-4 `worker/` service + Docker stack) sweeps expired holds: `PENDING_PAYMENT` enrolments older than the hold window → status `CANCELLED`, reason `"hold expired"`, `seatsTaken` decremented under `FOR UPDATE`. Idempotent; bounded retry.
- **D-04:** Phase 5 builds one **shared seat-accounting helper** (take-seat: `FOR UPDATE` → refuse if `seatsTaken >= capacity` → insert enrolment → increment; release-seat: `FOR UPDATE` → decrement, floor at 0). **Phase 6 checkout calls the same helper.**
- **D-05:** Highest-risk mechanism — prove against a **real Postgres** (reuse Phase 4's Testcontainers harness): two concurrent take-seat transactions on a capacity-1 cohort → exactly one succeeds; the `cohort_capacity_not_exceeded` CHECK is the backstop, not the primary guard.

**Attendance marking window (ATT-01 / ATT-03)**
- **D-06:** "Normal" marking runs from a session's scheduled **start** until **7 days after it ends**. Project constant `ATTENDANCE_MARKING_WINDOW_HOURS = 168` for Phase 5; promote to a per-cohort field only on request.
- **D-07:** Inside the window: staff mark/change freely; each write stamps `recordedById` + `recordedAt` + optional `note`.
- **D-08:** After the window: the same action **requires a non-empty `correctionReason`** and stamps `correctedById` + `correctedAt`. Before/after state + reason stay in audit history (ATT-03).
- **D-09:** **Pre-marking** (before start time) is allowed but restricted to `EXCUSED` or `NOT_RECORDED`. `PRESENT`/`ABSENT`/`LATE` require the session start to have passed.
- **D-10:** Bulk marking for a session must not touch out-of-scope learners — the operation is scoped to the cohort's roster via `withPermission` + cohort scope.

**Staff enrolment actions (COH-05) — mechanism, not policy**
- **D-11:** **Add** — straight to `ACTIVE` (comp/corporate/scholarship; `orderId` null; mandatory reason; takes a seat via D-04) or `PENDING_PAYMENT` with a hold.
- **D-12:** **Approve** — `PENDING_PAYMENT` → `ACTIVE` with no payment record (mandatory reason, audited). Phase 7's manual-payment path calls this transition later.
- **D-13:** **Transfer** — different Cohort of the **same offer only** (same `courseId`, or same `programmeId`). Old → `TRANSFERRED` (seat released), new `ACTIVE` in target (seat taken, capacity-checked); both audited and linked (new enrolment records the source enrolment id); mandatory reason. **Attendance and progress do NOT carry across.** Cross-offer transfer deferred.
- **D-14:** **Withdraw / Cancel** — `WITHDRAWN` (access already started) vs `CANCELLED` (before access, or administrative void). Both: mandatory reason, seat released, audited, domain event emitted for Phase-13 email. **No automated refund or credit.**
- **D-15:** The partial unique index `enrolment_one_active_per_learner_cohort` is the hard guard against duplicate active enrolments — application code must surface its violation as a clean "already enrolled" result, not a 500.
- **D-16:** No approval workflow, no policy/rules engine.

**Cohort roster & attendance exceptions (COH-07, ATT-02 / ATT-04)**
- **D-17:** Roster ships now with **real** columns: learner identity, enrolment status + transition history, access window, attendance (earned vs required %, per-session states, exception flags), instructor assignment.
- **D-18:** Columns whose engines don't exist yet render as an **explicit third state** (never blank, never a fake zero): Progress → "not tracked yet · Phase 9", Assessment → "· Phase 10", Completion/certificate → "· Phase 11".
- **D-19:** **Attendance exceptions view** (ATT-04) built for real: missing registers, at-risk, disputed/corrected. Filterable; **bounded synchronous CSV** of one cohort's exceptions matching the on-screen filters.
- **D-20:** **ATT-02** — Phase 5 computes and stores/exposes the **attendance component** only (earned vs required, from `attendanceThresholdPct`), and emits an `"attendance changed"` domain event on every mark/correction. The overall completion verdict belongs to the Phase 9/11 engine.
- **D-21:** Scoping — an Instructor sees only rosters of Cohorts they are assigned to (`CohortInstructor`); a learner detail never exposes out-of-scope Cohorts.

**Sessions & scheduling (COH-03)**
- **D-22:** Sessions created one at a time, plus a **"repeat weekly ×N"** convenience that inserts N `ScheduledSession` rows — no recurrence entity / RRULE.
- **D-23:** Session date/time entered in the **Cohort's `timezone`**, stored UTC in `ScheduledSession.startsAt`/`endsAt`. The UI shows the cohort timezone explicitly.
- **D-24:** A Programme-cohort session **may optionally** be tagged to a member Course (`ScheduledSession.courseId` already nullable).
- **D-25:** Meeting-link visibility follows `linkVisibleFromMinutes` (default 60) and enrolment — hidden before the window and from unenrolled users.
- **D-26:** Sessions **soft-cancel** via `cancelledAt` + `cancellationReason` — never hard-deleted.

**Cohort publish readiness (COH-04)**
- **D-27:** Cohort publish reuses the pure four-state evaluator (`src/server/services/readiness-service.ts`) and the persistent-panel + dialog-summary UI from Phase 4. Gated on `cohorts.publish` in matching scope + all blocking items PASS.
- **D-28:** The five reserved slots become real checks:
  - **Schedule** — PASS if `deliveryMode = SELF_PACED` **or** ≥1 non-cancelled session; FAIL otherwise. WARN if a session falls outside the cohort's start/end dates.
  - **Price** — PASS if `priceMinor >= 0` and `currency` set (0 is a legal free cohort).
  - **Capacity** — PASS if `capacity > 0` and `capacity >= seatsTaken`; FAIL if `capacity < 1`.
  - **Instructors** — PASS if `deliveryMode = SELF_PACED` **or** ≥1 `CohortInstructor`; FAIL for `INSTRUCTOR_LED`/`BLENDED` with none.
  - **Completion** — PASS if the pinned Course/Programme publication carries a completion rule; WARN if `attendanceThresholdPct` is set while `deliveryMode = SELF_PACED`.
- **D-29:** New **Catalogue** slot — PASS if the Cohort is pinned to a **published** Course/Programme publication (via `coursePublicationId`/`programmePublicationId`), FAIL if it points at a live/draft record or nothing.

**Cohort lifecycle & immutability**
- **D-30:** `courseId`/`programmeId` (the offer target) is **locked once any `Enrolment` row exists** for the Cohort, in any status.
- **D-31:** Cancelling a Cohort that has active enrolments requires confirmation and a **bulk-withdraw with a single shared reason** (each resulting `WITHDRAWN` transition audited). A Cohort is never hard-deleted — it moves to `CANCELLED` with a reason.
- **D-32:** All Cohort/session/enrolment/attendance mutations route through `withPermission` and are written audit-first via the resource-service factory pattern; no code outside `src/server/services/` imports `@prisma/client`.

### Claude's Discretion

The user approved all recommendations without interactive discussion ("recommend the best options based on the plan" → "Approve all"). Latitude on: exact new field names; whether the seat-accounting helper lives in a new `cohort-service`/`enrolment-service` or a shared `seat-accounting.ts`; the wave/plan breakdown; the shape of the "attendance changed" domain event and how events are dispatched (in-process emitter vs lightweight outbox row) — research should recommend, consistent with the Phase-4 worker/queue patterns; the roster table's column order and filter set; whether the "repeat weekly ×N" helper is a server action or a small client form. None of these change the locked decisions.

### Deferred Ideas (OUT OF SCOPE)

- **Waitlist / waiting list** when a Cohort is at capacity.
- **Cross-offer transfer** and COH-01's **"approved migration path"** for changing a Cohort's Course/Programme target after enrolment has begun — treat as cancel + new enrolment for now.
- **Session recurrence entity** (RRULE-style) — Phase 5 ships a "repeat weekly ×N" row-inserter only.
- **Automated refund / credit** on withdrawal or transfer.
- **Self-paced access-duration model** (PRD §15.3(1)) — needs a business decision **before Phase 9**; flag it at Phase 5 close.
- **Per-cohort attendance marking window** — Phase 5 uses a project constant `ATTENDANCE_MARKING_WINDOW_HOURS = 168`.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COH-01 | Cohort for exactly one Course XOR one Programme; offer type immutable after enrolment begins | XOR already enforced by DB CHECK `cohort_targets_exactly_one_offer` (`prisma/migrations/20260901115332_init/migration.sql:1226`). Immutability (D-30) = app guard: block `courseId`/`programmeId` change when `Enrolment.count({where:{cohortId}}) > 0`. Cohort authoring via `createResourceService` (`src/server/services/resource-service.ts:188`). |
| COH-02 | Enrolment window / dates / timezone / capacity / price / currency / delivery mode / instructors; date & capacity conflicts block publication | All fields already on `model Cohort` (`prisma/schema.prisma:726-795`). Date ordering enforced by DB CHECK `cohort_dates_ordered` (`...init/migration.sql:1279`). Capacity CHECK `cohort_capacity_not_exceeded` (`:1254`). Publication-blocking = readiness evaluator (D-28). |
| COH-03 | Scheduled sessions with title/date-time/duration/location/link/facilitator/attendance expectation; link visibility follows enrolment + timing | `model ScheduledSession` (`prisma/schema.prisma:836-866`) already has every field incl. `meetingUrl`, `linkVisibleFromMinutes @default(60)`, `facilitatorId`, `attendanceExpected`, `cancelledAt`. Duration = `endsAt - startsAt` (no duration column). New: session CRUD service + "repeat weekly ×N" + timezone helper. |
| COH-04 | Publish only when catalogue/schedule/pricing/instructor/capacity/completion pass; pass/fail shown; permission-gated | Extend `readiness-service.ts` with `evaluateCohortReadiness` (currently only Course/Programme evaluators exist — the "Phase 5" stubs are on the *Course* evaluator, `readiness-service.ts:173-183`). Reuse `blockingFailures` (`:258`), the Phase-4 panel + publish dialog. Gate on `cohorts.publish` via `withPermission`. |
| COH-05 | Add / approve / transfer / withdraw / cancel with reason; validated, audited, communicated, no duplicate active | `EnrolmentStatus` enum has every needed state (`prisma/schema.prisma:61`: PENDING_PAYMENT, ACTIVE, COMPLETED, WITHDRAWN, TRANSFERRED, CANCELLED). Duplicate-active guard = partial unique index (D-15). State machine + reason capture = new `enrolment-service`. Transition history = `AuditEvent` rows (`audit-service.ts`). |
| COH-06 | Capacity enforced during checkout AND admin enrolment; concurrent attempts cannot exceed; released/expired reservations free up | Seat-accounting helper (D-04) + `SELECT … FOR UPDATE` recipe documented in `prisma/sql/001_integrity.sql:43-48` and pasted into `...init/migration.sql:1243-1248`. Hold-release worker job (D-03). Prove concurrency vs real Postgres (D-05). |
| COH-07 | Cohort-level views of learners/access/progress/attendance/assessment/completion/exceptions; filter + learner detail without out-of-scope Cohorts | Roster = new read service + `ResourceTable` primitive. Scoping via `withPermission` + async cohort scope resolution (COHORT scope in `scope.ts:16,67`). Third-state columns reuse Phase-4 `NOT_YET_CHECKED` treatment (D-18). |
| ATT-01 | Mark present/absent/late/excused/not-recorded; each change records actor/time/state/note; bulk cannot affect out-of-scope | `model AttendanceRecord` (`prisma/schema.prisma:868-887`): `state` (`AttendanceState` enum `:91`), `note`, `recordedById`, `recordedAt @default(now())`, `@@unique([sessionId, enrolmentId])`. Bulk = roster-scoped write (D-10). |
| ATT-02 | Attendance threshold as Course/Programme completion rule; learner + staff see earned/required; completion recalculates after correction | `Cohort.attendanceThresholdPct Int?` (`prisma/schema.prisma:757`). Phase 5 computes the **component** only (D-20) + emits `"attendance changed"` event; Phase 9/11 own the verdict. |
| ATT-03 | Correction after normal window requires mandatory reason; before/after + reason stay in audit history, reflected consistently | `AttendanceRecord.correctedById` / `correctedAt` / `correctionReason` (`prisma/schema.prisma:879-881`) hold the **latest** correction only — full before/after history must come from `AuditEvent` rows. Window = `ATTENDANCE_MARKING_WINDOW_HOURS` constant (D-06). |
| ATT-04 | Attendance exceptions to staff dashboards + learner detail; filterable with matching CSV values (SHOULD) | Exception categories (D-19). Bounded synchronous CSV (async infra is Phase 8). Filter/CSV parity is the testable contract. |
</phase_requirements>

---

## Summary

Phase 5 is almost entirely **application logic over a schema that is already complete**. Every table, column, enum, foreign key and integrity constraint this phase needs already exists in `prisma/schema.prisma` and — critically — **the `prisma/sql/001_integrity.sql` constraints ARE applied**: they were pasted verbatim into `prisma/migrations/20260901115332_init/migration.sql` (lines 1202-1295), including the one-active-enrolment partial unique index, the Course-XOR-Programme CHECK, the capacity CHECK, and the date-ordering CHECK. The CONTEXT.md open question 1 ("STACK.md lists only two migrations") was based on a stale STACK.md; the working tree has four migrations and the integrity SQL is in the first one. `tests/support/pg.ts:70-90` confirms this in code ("both `001_integrity.sql` and `002_catalogue_integrity.sql` are already pasted into `migration.sql`").

The schema work Phase 5 *does* need is small and additive: a nullable `Cohort` hold-TTL field (D-02), an `Enrolment` self-relation for transfer linkage (D-13), a nullable `Enrolment.holdExpiresAt` column + index to make the sweep query cheap and idempotent (D-03), and a `DomainEvent` outbox table for the `"attendance changed"` and enrolment/session events. Any new raw-SQL constraint must be pasted into its migration **and** covered by a `tests/schema-*.test.ts` regression test — this is the explicit lesson of `prisma/sql/002_catalogue_integrity.sql`, whose header records that 001 "silently went unapplied" once before.

The mechanisms carry all the risk: the seat-accounting `SELECT … FOR UPDATE` transaction (must be proven against real Postgres via the Phase-4 Testcontainers harness, D-05), the enrolment state machine, the attendance marking-window boundary, and the worker hold-sweep job. The established repo patterns cover every one of these — `reorder-service.ts` for `tx.$executeRaw` inside `$transaction`, `scan-system-service.ts` for the worker-only unauthorized module, `queue.ts` + `worker/index.ts` for pg-boss registration, `tests/reorder.integration.test.ts` for the Testcontainers concurrency proof. Do not invent new infrastructure.

**Primary recommendation:** Build a standalone `src/server/services/seat-accounting.ts` (transaction-taking, no `@/server/permissions` import so the worker can reach it), a `DomainEvent` outbox written in the same transaction as each mutation, a `hold-release-system-service.ts` mirroring `scan-system-service.ts` driven by a scheduled pg-boss queue in `worker/index.ts`, an `evaluateCohortReadiness` function added to `readiness-service.ts`, and a hand-rolled `src/lib/timezone.ts` using `Intl` (Node 22.14, no timezone library in the tree, project ethic is minimal deps). Wrap every mutation in `withPermission` + the resource-service factory; resolve COHORT scope asynchronously from the Cohort row.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cohort / session authoring CRUD | API / Backend (`src/server/services/`) | Frontend Server (RSC pages under `src/app/staff/`) | `@prisma/client` is ESLint-confined to `src/server/services/` + `src/server/db.ts` (`tests/boundary.test.ts`). |
| Cohort publish readiness evaluation | Pure module (`readiness-service.ts`) | API (server action refusal), Frontend Server (panel render) | D-27: one evaluator, three call sites, no data/UI/auth imports. Mirrors Phase 4. |
| Seat accounting (take/release) | API / Backend — DB transaction (`seat-accounting.ts`) | Worker (hold sweep), Phase 6 checkout | D-04: standalone transaction-taking function callable from request context AND the worker process. |
| Capacity race safety | Database (`SELECT … FOR UPDATE` on `Cohort` row + CHECK backstop) | API | D-01/D-05: row lock serialises; CHECK `cohort_capacity_not_exceeded` is the backstop only. |
| Duplicate-active-enrolment prevention | Database (partial unique index) | API (surfaces P2002 as clean result) | D-15: the index is the guard; app code translates the violation. |
| Enrolment state machine + reason capture + audit | API / Backend (`enrolment-service.ts`) | — | D-16: staff holding the permission perform the action; system validates transition, captures reason, audits, emits event. |
| Attendance marking + correction-window boundary | API / Backend (`attendance-service.ts`) | Frontend Server (bulk-entry roster screen) | D-06..D-10: window math + pre-marking restriction + scope enforcement are all server-side. |
| Attendance component computation | API / Backend | — | D-20: Phase 5 computes/stores the component; verdict is Phase 9/11. |
| Domain event dispatch | Database (outbox row, same txn) | Worker (drain to email/subscribers, Phase 13) | constraints §43: async work must be queued/observable/idempotent. Outbox = transactional; a bare enqueue is not (`queue.ts` header). |
| Hold-expiry sweep | Worker (`worker/` + pg-boss schedule) | Backend (`hold-release-system-service.ts`) | D-03: reuse the Phase-4 worker + Docker stack. |
| Timezone wall-clock ↔ UTC conversion | Shared lib (`src/lib/timezone.ts`, pure) | Frontend Server (form parsing), API | D-23: entered in cohort tz, stored UTC. Pure function, testable, no data access. |
| Roster / exceptions read + CSV | API / Backend (read service) + Frontend Server | — | COH-07 / ATT-04: scoped reads, bounded synchronous CSV. |
| Cohort scope resolution (cohortId → programmeId + courseIds) | API / Backend (async `toScope`) | — | `scope.ts` `grantMatches` needs `resource.programmeId` / `courseIds` populated for a COURSE/PROGRAMME grant to reach a cohort-scoped resource. |

---

## Standard Stack

**No new runtime dependencies are required or recommended for Phase 5.** Everything needed is already in `package.json` (verified `C:/Users/disuk/Learning-Management-System/package.json`).

### Core (already installed — versions verified against the lockfile / `package.json`)

| Library | Version (installed) | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| `@prisma/client` / `prisma` | `^6.19.3` | ORM, migrations, interactive `$transaction`, `$queryRaw`/`$executeRaw` for `FOR UPDATE` | Already the project ORM. Interactive transactions with raw SQL are used today in `reorder-service.ts:272`. |
| `pg-boss` | `^12.29.0` | Postgres-backed job queue for the hold-expiry sweep | Already the worker queue (`worker/index.ts`, `src/server/jobs/queue.ts`). ESM-only, named `PgBoss` export, `createQueue` before `send`/`work` (`queue.ts:22-24`). |
| `next` | `16.3.4` | Server Actions for staff mutations, RSC for staff pages | Locked stack version (STATE.md). **Read `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` and `.../02-guides/server-actions.md` before writing any action** (AGENTS.md mandate). |
| `zod` | `^4.5.4` | Input validation on every server action (dates, enums, reason strings, capacity ints) | Project-wide validation lib. Zod 4 — `z.iso.datetime()` / `z.enum()` / `z.coerce.number()`. |
| `react` / `react-dom` | `19.2.8` | `useActionState` / `useFormStatus` for the six render states | Established in the Phase-4 staff screens. |
| `@testcontainers/postgresql` / `testcontainers` | `^12.1.0` (dev) | Real-Postgres proof of the capacity race (D-05) and the partial unique index (D-15) | The D-32 harness — `tests/support/pg.ts`, used by `tests/reorder.integration.test.ts`, `tests/publish.integration.test.ts`. |
| `vitest` | `^4.1.11` (dev) | Unit + integration tests | Project test runner (`npm test` → `vitest run`). |

### Supporting (already installed)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `@hello-pangea/dnd` `^18.0.1` | Drag reorder | Only if the session list needs manual ordering — sessions are date-ordered, so probably **not needed**. |
| `sanitize-html` `^2.17.7` | HTML sanitisation | Only if session descriptions accept rich text — recommend plain text for Phase 5. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `src/lib/timezone.ts` with `Intl` | `@date-fns/tz` or `luxon` (both `[ASSUMED]` — not verified, not in tree) | A library removes the DST-gap edge-case burden, but adds a dependency the project has consistently avoided (it hand-rolls sessions, password hashing, `src/lib/positions.ts`). Node 22.14's `Intl.DateTimeFormat` + `Intl.supportedValuesOf('timeZone')` cover the single conversion this phase needs. **Recommend hand-rolled.** |
| `DomainEvent` outbox table | In-process `EventEmitter` | An in-process emitter cannot reach the worker process (separate `tsx` process, `worker/index.ts`), and loses events on crash. `queue.ts`'s header explicitly documents that a non-transactional enqueue loses jobs on a crash between the row commit and the `send`. An outbox row written **in the same `$transaction`** as the mutation is the idempotent/observable pattern constraints §43 requires. |
| pg-boss `send` for the "attendance changed" event | Outbox row + a drain job | Same reasoning — the outbox keeps the event atomic with the state change; Phase 13 adds the drain. |
| New `Reservation` table for seat holds | `seatsTaken` + `PENDING_PAYMENT` status | **Forbidden by D-01.** The schema was designed for this (`prisma/schema.prisma:744-748` comment). |

**Installation:** none.

**Version verification performed:**
- `package.json` read directly — `@prisma/client ^6.19.3`, `pg-boss ^12.29.0`, `next 16.3.4`, `zod ^4.5.4`, `@testcontainers/postgresql ^12.1.0`, `vitest ^4.1.11`. [VERIFIED: repo package.json]
- Node runtime: `node --version` → `v22.14.0` [VERIFIED: local shell]. `Intl.DateTimeFormat` with `timeZone`, `formatToParts`, and `Intl.supportedValuesOf('timeZone')` are all available in Node 22. `Temporal` is **not** stable in Node 22 — do not use it. [VERIFIED: Node release notes, training knowledge cross-checked with runtime version]
- `tsconfig.json` `target: ES2017` [VERIFIED: repo] — affects downlevel syntax only, not runtime Intl availability.

---

## Package Legitimacy Audit

Phase 5 installs **no external packages**. All libraries in the Standard Stack are already present in `package.json` and were vetted during earlier phases. slopcheck was not run because there is nothing new to check.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — no new packages) | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

If the planner or discuss-phase decides to add a timezone library (`@date-fns/tz`, `luxon`, etc.) against this research's recommendation, that package MUST go through the Package Legitimacy Gate and be gated behind a `checkpoint:human-verify` task before install. This research tags any such name `[ASSUMED]`.

---

## Architecture Patterns

### System Architecture Diagram

```
STAFF (browser)                          WORKER PROCESS (tsx worker/index.ts)
  │                                         │
  │ Server Action (src/app/staff/…)         │ pg-boss scheduled queue "enrolment.hold-sweep"
  ▼                                         ▼  (*/N * * * *)
withPermission(perm, resolveScope) ───┐   hold-release-system-service.ts  (NO withPermission —
  │  denial → AuditEvent               │     mirrors scan-system-service.ts; audits actorType:SYSTEM)
  ▼                                    │     │
service layer (src/server/services/)  │     │ for each PENDING_PAYMENT enrolment with
  │   cohort-service / session-service │     │ holdExpiresAt < now():
  │   enrolment-service / attendance-svc     ▼
  ▼                                          seat-accounting.releaseSeat(tx, …)
prisma.$transaction(async tx => {            │  BEGIN
  ── SELECT "seatsTaken","capacity"          │   SELECT … FOR UPDATE (Cohort row)
       FROM "Cohort" WHERE id=$1 FOR UPDATE  │   status → CANCELLED, reason "hold expired"
  ── refuse if seatsTaken >= capacity        │   seatsTaken = max(seatsTaken-1, 0)
  ── INSERT "Enrolment" (…)                  │   INSERT "DomainEvent" (enrolment.cancelled)
       └─ P2002 on partial-unique  ──────────┼──▶ translate → AlreadyEnrolledError (not 500)
  ── UPDATE "Cohort" SET seatsTaken += 1     │  COMMIT
  ── INSERT "DomainEvent" (…same txn…)       │
  ── INSERT "AuditEvent"  (…same txn or after…)
})                                           
  │                                          
  ▼                                          
CHECK cohort_capacity_not_exceeded  ◀── backstop only; must never be the thing that fires
  │
  ▼
DomainEvent rows (outbox, append-only)  ──▶  Phase 13 drain job → email
                                        ──▶  Phase 9/11 completion engine reads attendance component

READINESS (publish path, D-27):
  cohort row + sessions + instructors + pins ──▶ evaluateCohortReadiness()  [pure]
                                                   │
       ┌───────────────────────────────────────────┴─── persistent panel (staff cohort page)
       └─── server-action refusal: blockingFailures(items).length > 0 → refuse publish

TIMEZONE (D-23):
  form: {date, time} + cohort.timezone ──▶ src/lib/timezone.ts wallTimeToUtc() ──▶ startsAt/endsAt (UTC)
  display: startsAt (UTC) + cohort.timezone ──▶ utcToWallParts() ──▶ rendered with tz label
```

### Recommended Project Structure

```
src/server/services/
├── cohort-service.ts               # createResourceService<Cohort> + publish + cancel + immutability guard (D-30/D-31)
├── cohort-readiness-*.ts (or extend readiness-service.ts)   # evaluateCohortReadiness (D-28/D-29)
├── session-service.ts              # createResourceService<ScheduledSession> + repeat-weekly + soft-cancel (D-22/D-26)
├── enrolment-service.ts            # state machine: add/approve/transfer/withdraw/cancel (D-11..D-16), wraps seat-accounting
├── seat-accounting.ts              # takeSeat(tx,…) / releaseSeat(tx,…) — NO @/server/permissions import (D-04)
├── attendance-service.ts           # mark/correct + window boundary + pre-marking rule + component compute (D-06..D-10, D-20)
├── attendance-component.ts         # pure: earned vs required % from AttendanceRecord[] + attendanceThresholdPct
├── domain-event-service.ts         # writeDomainEvent(tx, …) — outbox insert, append-only
├── hold-release-system-service.ts  # WORKER-ONLY, unauthorized, mirrors scan-system-service.ts (D-03)
├── roster-service.ts               # COH-07 scoped read + exceptions + bounded CSV (D-17..D-19, ATT-04)
└── cohort-scope.ts                 # async cohortId → { cohortId, programmeId, courseIds } for withPermission toScope

src/lib/
├── timezone.ts                     # Intl-based wall-clock ↔ UTC (D-23), pure, unit-tested
└── attendance-window.ts            # ATTENDANCE_MARKING_WINDOW_HOURS + isWithinMarkingWindow(session, now) (D-06)

src/server/jobs/queue.ts            # add HOLD_SWEEP_QUEUE constant + enqueue helper (follow SCAN_QUEUE pattern)
worker/
├── index.ts                        # register hold-sweep queue + boss.schedule(...) + boss.work(...)
└── handlers/release-expired-holds.ts   # createReleaseExpiredHoldsHandler({ … }) factory, mirrors reconcile-lesson-resources.ts

src/app/staff/
├── cohorts/…                       # list / [id] detail (tabs: overview, sessions, roster, exceptions) / new / publish-actions.ts
└── enrolments/…                    # wire the NAV placeholder (src/app/staff/layout.tsx:24)

prisma/
├── schema.prisma                   # + Cohort.holdMinutes, Enrolment.holdExpiresAt, Enrolment transfer self-relation, model DomainEvent
├── migrations/<new>/migration.sql  # the generated migration + any pasted raw SQL
└── sql/003_*.sql (if new CHECKs)   # companion file, AND a tests/schema-cohort.test.ts regression test
```

### Pattern 1: Resource-service factory for CRUD (Cohort, Session)

**What:** `createResourceService` gives list/get/create/update/archive with authorization, scoping, and audit "for free" (`src/server/services/resource-service.ts:188`). `course-service.ts` is the 40-line reference.
**When to use:** Cohort and ScheduledSession authoring.
**Key mechanics:**
- `toScope` may return a `Promise` (`resource-service.ts:96-109`) — use this for the async cohort-scope resolution.
- `archiveData` overrides the archive write — for Cohort use `{ status: "CANCELLED" }` (D-31), for Session use `{ cancelledAt: <now>, cancellationReason: <reason> }` (D-26).
- `runInTransaction: (fn) => prisma.$transaction(fn)` is passed by `lesson-service.ts:232`, `programme-service.ts:250` — wire it for any archive that must be atomic with sibling writes.
- Publish is **not** in the factory — it is separate surface (see `publish-service.ts:1` "The operation the resource-service factory does not have: publish"). Cohort publish is a new `withPermission("cohorts.publish", cohortScope)` action.

```typescript
// Source: src/server/services/course-service.ts:20 (verbatim shape, adapt names)
export const cohortService = createResourceService<CohortRecord>({
  name: "Cohort",
  delegate: prisma.cohort as unknown as Delegate<CohortRecord>,
  permissions: { view: "cohorts.view", create: "cohorts.manage", edit: "cohorts.manage" },
  toScope: cohortResourceScope, // async — reads programmeId/courseId off the row
  withPermission,
  audit: (entry) => recordAudit({ /* … */ }),
  archiveData: () => ({ status: "CANCELLED" }),
});
```

### Pattern 2: `SELECT … FOR UPDATE` seat accounting inside `$transaction`

**What:** Row-lock the `Cohort` row, check capacity, insert the enrolment, bump `seatsTaken` — all in one interactive transaction. The lock serialises concurrent checkouts; counting-then-inserting loses the race (`prisma/sql/001_integrity.sql:49-52`).
**When to use:** every path that creates an `ACTIVE` or `PENDING_PAYMENT` enrolment (staff add, staff approve if the seat was not already held, transfer-in, Phase 6 checkout).
**Example:**

```typescript
// Source: recipe from prisma/sql/001_integrity.sql:43-48 (pasted into
//   prisma/migrations/20260901115332_init/migration.sql:1243-1248);
//   $executeRaw-in-$transaction idiom from src/server/services/reorder-service.ts:272
export class CapacityExceededError extends Error { /* carries cohortId */ }
export class AlreadyEnrolledError extends Error { /* carries userId, cohortId */ }

/** Standalone — takes the tx client, imports NO @/server/permissions (so the
 *  worker runtime closure can reach it — see tests/boundary.test.ts). */
export async function takeSeat(
  tx: PrismaTxClient,
  args: { cohortId: string; enrolment: EnrolmentCreateData },
): Promise<{ id: string }> {
  const [row] = await tx.$queryRaw<{ seatsTaken: number; capacity: number }[]>`
    SELECT "seatsTaken", "capacity" FROM "Cohort" WHERE id = ${args.cohortId} FOR UPDATE
  `;
  if (!row) throw new CohortNotFoundError(args.cohortId);
  if (row.seatsTaken >= row.capacity) throw new CapacityExceededError(args.cohortId);

  let created: { id: string };
  try {
    created = await tx.enrolment.create({ data: args.enrolment, select: { id: true } });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new AlreadyEnrolledError(/* … */); // D-15
    throw err;
  }
  await tx.cohort.update({ where: { id: args.cohortId }, data: { seatsTaken: { increment: 1 } } });
  return created;
}
```

- Reuse `isUniqueConstraintViolation` — it is already exported/duck-typed in `resource-service.ts:77` (checks `err.code === "P2002"` without importing the Prisma client).
- `releaseSeat` mirrors this: `FOR UPDATE` → `seatsTaken = GREATEST("seatsTaken" - 1, 0)` → set enrolment status. Floor at 0 (D-04).
- **Only take a seat once per enrolment.** "Approve" (D-12) on an enrolment that was created `PENDING_PAYMENT` *with a hold* already holds its seat — approving just flips status to `ACTIVE`, no second increment. "Approve" on a `PENDING_PAYMENT` enrolment created with **no** hold (`Cohort.holdMinutes` null/0) must take the seat now. Track this with an explicit rule keyed on whether `holdExpiresAt` was set at creation.

### Pattern 3: Worker-only unauthorized service (hold sweep, D-03)

**What:** A module that deliberately does **not** route through `withPermission`, because a worker process has no request/session. `src/server/services/scan-system-service.ts:1-40` is the canonical example and its header is required reading.
**Constraints enforced by `tests/boundary.test.ts:135-160` ("keeps the worker runtime import closure away from request-only APIs"):**
- The transitive import closure of `worker/**` must not import `next/headers`, `@/server/permissions`, `@/server/permissions/*`, or anything importing `getCurrentActor`.
- Therefore `hold-release-system-service.ts` → `seat-accounting.ts` → `@/server/db` is fine; none of those may import the permission layer.
**Controls that make it safe (copy the discipline):**
1. Name every exported function `…AsSystem`.
2. Take **no** caller-supplied filter — the sweep resolves its own work set (`WHERE status = 'PENDING_PAYMENT' AND "holdExpiresAt" < now()`).
3. Still audit — `recordAudit({ actorId: null, actorType: "SYSTEM", action: "enrolment.hold_expired", … })` (`audit-service.ts:25`, `buildAuditRow` defaults `actorType` to `"USER"`; pass `"SYSTEM"` explicitly).

### Pattern 4: pg-boss queue registration + schedule

**What:** Register the queue in both `src/server/jobs/queue.ts` (constant + optional enqueue helper) and `worker/index.ts` (`createQueue` → `work` → `schedule`).
**Example:**

```typescript
// Source: worker/index.ts:34-51 + src/server/jobs/queue.ts:22-24
await boss.createQueue(HOLD_SWEEP_QUEUE);
await boss.work(HOLD_SWEEP_QUEUE, async ([job]) => {
  if (!job) throw new Error("hold-sweep handler received no job");
  await releaseExpiredHolds();           // idempotent — see below
});
await boss.schedule(HOLD_SWEEP_QUEUE, "*/5 * * * *");   // cron; matches the RECONCILE_QUEUE cadence
```

- **Idempotency (D-03):** `releaseExpiredHolds` re-reads the work set each run and processes each enrolment in its **own** `$transaction` with `FOR UPDATE`; a row already flipped out of `PENDING_PAYMENT` by a previous run (or by the learner completing checkout) simply is not in the set. No job-level dedupe key needed because the operation is naturally convergent.
- **Bounded retry:** pg-boss retries are configured per queue/job (`retryLimit`, `retryBackoff`, `retryDelay`). Set a small `retryLimit` (e.g. 3) with `retryBackoff: true` when registering — matches constraints §43 "bounded retries". Verify the exact option names against `node_modules/pg-boss/dist/index.d.ts` at implementation time (the `queue.ts` header notes the team verifies pg-boss API against the installed `.d.ts`).
- **pg-boss schema note:** pg-boss installs its own `pgboss` schema at start time, **not** via a Prisma migration (`tests/support/pg.ts:20-24`). An integration test that exercises the worker must start pg-boss itself first. The hold-sweep *logic* test does not need pg-boss — test `releaseExpiredHolds` directly against a Testcontainers DB (like `worker-handlers.test.ts` tests handlers with fakes).

### Pattern 5: Extend the readiness evaluator (D-27, D-28, D-29)

**What:** Add `evaluateCohortReadiness(input: ReadinessCohortInput): ReadinessItem[]` to `src/server/services/readiness-service.ts`. It stays pure (no imports). Reuse `ReadinessItem`, `ReadinessState`, `blockingFailures` (`readiness-service.ts:20,30,258`).
**Required type changes in `readiness-service.ts`:**
- `ReadinessCategory` — add `"Catalogue"` (currently `"Content" | "Schedule" | "Price" | "Capacity" | "Instructors" | "Completion"`, `:22`).
- The `deferredTo` union (`:38`, currently `"Phase 5" | "Phase 10"`) — the cohort evaluator's items are all real checks (D-28), so it likely needs no new `deferredTo` values. Confirm during planning.
**The Course-evaluator stubs must be reconciled:** `readiness-service.ts:173-183` currently emits `schedule` / `price` / `capacity` / `instructors` items with `state: "NOT_YET_CHECKED", deferredTo: "Phase 5"` **on the Course readiness panel**, and `tests/readiness.test.ts:101-106` locks that. A Course does not have one schedule/price/capacity — these only make sense per-Cohort. **Recommendation:** remove those four stub items from `evaluateCourseReadiness` and update `readiness.test.ts:101-106` accordingly; the cohort readiness panel (new) is where Schedule/Price/Capacity/Instructors live. Flag this as a small breaking change to a locked test — see Open Questions.
**Blocking semantics:** `blockingFailures` returns only items that are both `state === "FAIL"` **and** `blocking === true` (`:258`). Decide which cohort items block publish — from D-28: Schedule, Capacity, Instructors, and Catalogue (D-29) are FAIL-capable and should block; Price is effectively always PASS; Completion is WARN-only.

### Pattern 6: Async COHORT scope resolution

**What:** `scope.ts` `grantMatches` (`src/server/permissions/scope.ts:62-76`) matches a COHORT grant on `resource.cohortId === grant.scopeId`, a PROGRAMME grant on `resource.programmeId`, a COURSE grant on `resource.courseIds.includes(...)`. For a Course/Programme-scoped staff member to reach a cohort-scoped operation, the `ResourceScope` passed to `withPermission` must carry **all three**.
**Implementation:** a `cohortResourceScope(cohortId)` async function that reads:

```typescript
// pseudo — one findUnique
const c = await prisma.cohort.findUnique({
  where: { id: cohortId },
  select: { id: true, programmeId: true, courseId: true,
            cohortCourses: { select: { courseId: true } } },
});
return {
  cohortId: c.id,
  ...(c.programmeId ? { programmeId: c.programmeId } : {}),
  courseIds: c.courseId ? [c.courseId] : c.cohortCourses.map(cc => cc.courseId),
};
```

This must live in a service (Prisma boundary) but must **not** import `@/server/permissions` if it will ever be reachable from the worker closure — put it in its own `cohort-scope.ts` and import it into the request-side services only. The resource-service factory already accepts `toScope: (id) => ResourceScope | Promise<ResourceScope>` (`resource-service.ts:109`), so this drops in directly.
**Attendance / roster scope (D-10, D-21):** the same resolver. An Instructor is granted COHORT scope on the cohorts they teach (`CohortInstructor`); `grantMatches` then only lets them through for `resource.cohortId` values matching their grant. Bulk attendance writes must derive the learner set from `Enrolment where cohortId = <scoped cohort>` — never from a caller-supplied learner-id list (D-10).

### Pattern 7: Optimistic-concurrency token for cohort/session edits

`publish-service.ts` and `reorder-service.ts` guard multi-user edits with a conditional `updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data: { updatedAt: now } })` and throw `StaleOrderError` when `count === 0` (`reorder-service.ts:235-239`, exported from `reorder-service.ts`). Reuse `StaleOrderError` for cohort/session edits that need it (e.g. editing a session while attendance is being marked). Not every edit needs it — apply where a lost update is materially harmful.

### Anti-Patterns to Avoid

- **Counting enrolments to check capacity.** `SELECT count(*) … then INSERT` loses the race — both transactions read the same count (`001_integrity.sql:50-52`). Always `SELECT "seatsTaken" … FOR UPDATE`.
- **Letting the CHECK constraint be the capacity guard.** `cohort_capacity_not_exceeded` throws a raw Postgres error and a 500. It is the backstop; the `FOR UPDATE` refusal is the guard (D-05). If the CHECK ever fires in a test, the primary mechanism is broken.
- **A plain `@@unique([userId, cohortId])` on Enrolment.** Wrong — it would block re-enrolment after withdrawal (`prisma/schema.prisma:922-924` comment). The partial index `WHERE status = 'ACTIVE'` is correct and already applied.
- **Re-implementing authorization or audit in a service.** `course-service.ts:5` — "A service that re-implements any of them is doing it wrong." Route through `withPermission` + the factory.
- **`@prisma/client` outside `src/server/services/`.** ESLint-enforced, `tests/boundary.test.ts`. Also blocks the worker closure from importing `@/server/permissions`.
- **An in-process `EventEmitter` for domain events.** Cannot reach the worker; loses events on crash. Use the outbox.
- **Enqueuing a job in the same breath as a DB write and assuming atomicity.** `queue.ts:11-18` — pg-boss's `fromPrisma` adapter needs Prisma v7+; this project pins 6.19.3, so the enqueue is **not** transactional. Write the outbox row inside the transaction; drain separately.
- **Hard-deleting a Cohort or Session.** D-26 / D-31 — soft-cancel only (`cancelledAt`, `status: "CANCELLED"`). Project-wide (`resource-service.ts:11-13`).
- **Storing session times in local time or a fixed offset.** D-23 — parse in `Cohort.timezone`, store UTC. `Africa/Lagos` (UTC+1, no DST) is the seed default (`prisma/schema.prisma:735`) so a naive `+01:00` would pass today's tests and silently break for any other zone.
- **Carrying attendance/progress across a transfer.** D-13 — history stays on the prior (`TRANSFERRED`) enrolment.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Row-level concurrency for capacity | A mutex, an advisory-lock wrapper, a retry loop on the CHECK error | `SELECT … FOR UPDATE` on the `Cohort` row inside `prisma.$transaction` | The recipe is written and blessed (`001_integrity.sql:43-48`); Postgres row locks are the correct primitive. |
| Duplicate-active-enrolment prevention | An app-level "does an active enrolment exist?" pre-check | The partial unique index (already applied) + translate `P2002` | A pre-check is itself a race. The index is atomic. `isUniqueConstraintViolation` helper already exists (`resource-service.ts:77`). |
| CRUD + authz + scope + audit for Cohort/Session | Bespoke service methods | `createResourceService` (`resource-service.ts:188`) | One implementation, no chance to forget the scope check or audit row. |
| Publish + readiness gating | A new publish flow | Extend `readiness-service.ts` + reuse the Phase-4 panel/dialog + a `withPermission("cohorts.publish")` action | D-27. The evaluator, panel, and `blockingFailures` are done. |
| Job queue / scheduling for the hold sweep | `setInterval` in the app process, a cron container | pg-boss `boss.schedule()` in `worker/index.ts` | Already the project's queue; survives restarts; observable. `setInterval` in Next.js is per-instance and dies on redeploy. |
| Audit trail / transition history | A custom `EnrolmentTransition` table | `AuditEvent` rows via `recordAudit` (`audit-service.ts`) | RBAC-08 audit already carries actor/before/after/reason/outcome/time. The roster "transition history" column reads from `AuditEvent`. (A dedicated table is only worth it if the roster needs high-volume history queries — defer.) |
| Redaction of secrets in audit payloads | Per-call-site scrubbing | `redactForAudit` in the audit sink (`audit-service.ts:52`) | Sink-level rule can't be forgotten. |
| Timezone conversion | Manual offset tables, `Date` string parsing hacks | `src/lib/timezone.ts` using `Intl.DateTimeFormat` + `Intl.supportedValuesOf('timeZone')` (Node 22.14) | One well-known ~15-line `wallTimeToUtc` via `formatToParts`. A library is also fine but against project ethic. |
| Optimistic concurrency on edits | Version integers, `SELECT then compare` | Conditional `updateMany({ where: { id, updatedAt }, … })` + `StaleOrderError` | Established (`reorder-service.ts:233-239`); the compare-in-app version is itself a race. |
| Six render states per screen | Ad-hoc loading/error JSX | `ResourceTable` / `ResourceForm` / `DetailLayout` / `ConfirmModal` primitives | They bake in loading/empty/populated/validation-error/permission-denied/recoverable-failure. |
| Reason-capture + high-impact confirm (transfer, withdraw, cancel, correct attendance) | A bespoke modal | `ConfirmModal` (`src/components/primitives/ConfirmModal.tsx:20`) — `minReasonLength`, focus trap, "action not applied" on failure | Purpose-built for exactly ATT-03 / COH-05 style actions (`ConfirmModal.tsx:6-11`). |

**Key insight:** This phase's schema and infrastructure are done. The value is in wiring the state machine and concurrency correctly on top of primitives that already exist. Almost every "how do I…" has a concrete answer in `src/server/services/` or `tests/`.

---

## Runtime State Inventory

Phase 5 is **not** a rename/refactor phase, but it does introduce schema changes and a scheduled job, so the equivalent "what exists at runtime beyond the code" check matters.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `prisma/seed.ts` already creates 2 Cohorts (`SLP-2026-01`, `FCM-2026-02`), 1 `CohortInstructor` per cohort, 3 `ScheduledSession` per cohort, `attendanceThresholdPct: 75` on the programme cohort (`prisma/seed.ts:292-405`). No `Enrolment` / `AttendanceRecord` rows seeded yet. | Extend `seed.ts` with demo enrolments (mix of `ACTIVE` / `PENDING_PAYMENT` / `WITHDRAWN`) and attendance records so every Phase-5 screen has populated + exception states. New nullable columns get sensible seed values (`holdMinutes: 30`). |
| Live service config | pg-boss `pgboss` schema is created at worker start, **not** by a Prisma migration (`tests/support/pg.ts:20-24`). Adding a new queue does not require a migration; `boss.createQueue()` is idempotent. Existing queues: `lesson-resource.scan`, `lesson-resource.reconcile` (`src/server/jobs/queue.ts:30-33`). | Add `HOLD_SWEEP_QUEUE` constant + register in `worker/index.ts`. No migration. Existing Docker `worker` service (`docker-compose.yml`) picks it up on redeploy — no compose change needed (worker already has `DATABASE_URL`). |
| OS-registered state | None. No cron entries, no systemd units — scheduling is pg-boss `boss.schedule()` inside the worker process. | None. |
| Secrets / env vars | Worker service in `docker-compose.yml` has `DATABASE_URL`, `POSTGRES_*`, `MINIO_*`, `CLAMAV_*`. The hold sweep needs only `DATABASE_URL` (already present). No new secrets. | None — verified `docker-compose.yml` `worker:` block. |
| Build artifacts / installed packages | New Prisma schema changes require `prisma generate` (runs in `postinstall` / build). `prisma migrate deploy` must run on deploy (the Testcontainers harness runs it; production deploy runbook must too). | Plan a migration task; note "run `prisma migrate deploy` on deploy" in the phase summary. `tests/support/pg.ts` auto-applies checked-in migrations, so integration tests stay honest. |

**Nothing found in category "OS-registered state":** None — verified there are no cron/systemd/Task Scheduler entries; all scheduling is in-process via pg-boss.

---

## Common Pitfalls

### Pitfall 1: Assuming `prisma/sql/001_integrity.sql` is not applied
**What goes wrong:** Phase 5 writes a migration to "add" the one-active-enrolment index / capacity CHECK / XOR CHECK — which then fails with "relation already exists" or duplicates the constraint.
**Why it happens:** CONTEXT.md open question 1 quotes a stale STACK.md listing only 2 migrations. The working tree has **4** migrations and `001_integrity.sql` was pasted verbatim into `20260901115332_init/migration.sql` at lines 1202-1295 (all 6 sections: partial unique index, XOR CHECK, capacity CHECK, money CHECKs, date-order CHECK, assignment-scope CHECK). `tests/support/pg.ts:70-90` states this in code.
**How to avoid:** Do **not** re-create these. Verify once at plan time: `grep -n "enrolment_one_active_per_learner_cohort\|cohort_capacity_not_exceeded" prisma/migrations/*/migration.sql`. Phase 5's migration adds only new columns/tables.
**Warning signs:** A plan task titled "apply integrity constraints" or "run 001_integrity.sql".

### Pitfall 2: A new raw-SQL CHECK constraint that never gets applied
**What goes wrong:** If Phase 5 adds e.g. a `holdMinutes >= 0` CHECK or an attendance-correction-coherence CHECK as a `prisma/sql/003_*.sql` companion, and it is not pasted into the generated `migration.sql`, it silently does nothing in every environment except the Testcontainers harness (which auto-applies un-pasted companions, `tests/support/pg.ts:82-90`) — so tests pass and production has no constraint.
**Why it happens:** This exact thing happened with `001_integrity.sql` — recorded in `prisma/sql/002_catalogue_integrity.sql:8-13`: "the manual paste-in cannot silently go unapplied the way `001_integrity.sql`'s did."
**How to avoid:** For any new raw SQL: (1) paste it into the migration's `migration.sql`, (2) add a `tests/schema-cohort.test.ts` regression test that asserts the constraint rejects a bad row (the pattern `002` introduced — `tests/schema-catalogue.test.ts`). The Testcontainers harness's marker check (`/ADD CONSTRAINT (\w+)|CREATE UNIQUE INDEX (\w+)/`, `pg.ts:84`) will skip a companion it finds named in a migration, so pasting it in is what makes the test meaningful.
**Warning signs:** A `prisma/sql/*.sql` file with no matching assertion in `tests/schema-*.test.ts`.

### Pitfall 3: Double-counting a seat on "approve"
**What goes wrong:** A `PENDING_PAYMENT` enrolment that already holds a seat (created with a hold) gets its seat incremented again when staff "approve" it → `seatsTaken` drifts above real occupancy → cohort looks full when it isn't, or the CHECK fires.
**Why it happens:** D-11 allows a `PENDING_PAYMENT` enrolment *with* a hold (seat taken) and D-12's "approve" transitions it to `ACTIVE`. If approve blindly calls `takeSeat`, it double-counts. Conversely, an enrolment created with **no** hold (`holdMinutes` null/0, D-02) has **not** taken a seat and approve **must** take one.
**How to avoid:** Make "does this enrolment currently hold a seat?" explicit and unambiguous — recommend: a seat is held iff `status = 'PENDING_PAYMENT' AND holdExpiresAt IS NOT NULL` OR `status = 'ACTIVE'`. `approve` reads that; only calls `takeSeat` when no seat is held. Cover with a unit test per branch.
**Warning signs:** `seatsTaken` != `count(enrolments where status in (ACTIVE, PENDING_PAYMENT with live hold))` in an integration test.

### Pitfall 4: The attendance marking window boundary is computed from the wrong instant
**What goes wrong:** Corrections are allowed/blocked at the wrong time, or the window is off by the cohort's UTC offset.
**Why it happens:** `ScheduledSession.startsAt` / `endsAt` are stored UTC (D-23). The window is "start … endsAt + 168h" (D-06). If any code compares against a wall-clock-reconstructed time instead of the stored UTC instant, it drifts by the offset.
**How to avoid:** Do all window math in UTC on the stored `Date` values: `isWithinMarkingWindow = now >= session.startsAt && now <= addHours(session.endsAt, 168)`. Timezone is a **display** concern only. Put this in `src/lib/attendance-window.ts` as a pure function and unit-test the exact boundaries (1s before start, 1s after `endsAt+168h`).
**Warning signs:** `Intl` or `timezone` imports in the window-check code path.

### Pitfall 5: Pre-marking leaks PRESENT/ABSENT before a session happens
**What goes wrong:** Staff mark everyone PRESENT the day before, or a bulk default writes PRESENT rows.
**Why it happens:** D-09 restricts pre-start marking to `EXCUSED` / `NOT_RECORDED`. `AttendanceRecord.state` defaults to `NOT_RECORDED` (`prisma/schema.prisma:872`) which is fine; the risk is the mark action not enforcing the restriction.
**How to avoid:** In `attendance-service`, if `now < session.startsAt` and the requested state is `PRESENT | ABSENT | LATE`, reject with a typed error. Unit-test it.
**Warning signs:** No branch on `session.startsAt` in the mark path.

### Pitfall 6: Worker import closure pulls in `@/server/permissions`
**What goes wrong:** `tests/boundary.test.ts`'s "keeps the worker runtime import closure away from request-only APIs" fails, or worse the worker throws on the first job because `getCurrentActor` reads a cookie that isn't there.
**Why it happens:** `hold-release-system-service.ts` → `seat-accounting.ts` → (accidentally) something that imports `withPermission` or `cohort-scope.ts`.
**How to avoid:** `seat-accounting.ts` imports only `@/server/db` types and pure helpers. Keep `cohort-scope.ts` (which is request-side authz plumbing) out of the seat-accounting and system-service files. Run `npm test -- boundary` after wiring the worker.
**Warning signs:** `tests/boundary.test.ts` failing on the worker-closure assertion.

### Pitfall 7: Roster "third state" rendered as 0% or blank
**What goes wrong:** Progress / Assessment / Completion columns show `0%` (reads as "failing") or empty (reads as "no data / bug") instead of "not tracked yet · Phase 9".
**Why it happens:** D-18 requires the same discipline as the Phase-4 readiness `NOT_YET_CHECKED` third state. Easy to let a `?? 0` creep in.
**How to avoid:** Model those columns as a discriminated union (`{ kind: "deferred", phase: 9 }`) in the roster row type, render a visually distinct pill. No numeric fallback.
**Warning signs:** `?? 0` or `|| "-"` on a progress/assessment/completion field.

### Pitfall 8: `Next.js 16.3.4` server-action / caching assumptions from training data
**What goes wrong:** Stale patterns — wrong `revalidatePath` semantics, missing `"use server"` placement, assuming pages cache when they don't (Phase 4 hit exactly this — STATE.md line 8: "force-dynamic public routes" follow-up fix).
**Why it happens:** AGENTS.md is explicit: "This is NOT the Next.js you know… APIs, conventions, and file structure may all differ from your training data."
**How to avoid:** Read `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`, `.../09-revalidating.md`, and `.../02-guides/server-actions.md` before writing staff mutations. Follow how Phase-4 staff actions are structured (`src/app/staff/courses/[id]/publish-actions.ts`).
**Warning signs:** Any server action written without opening the docs; copying a Next 13/14 pattern.

---

## Code Examples

### Timezone: wall-clock in a named zone → UTC instant (D-23)

```typescript
// Source: standard Intl.DateTimeFormat formatToParts technique; Node 22.14
//   verified to expose Intl.supportedValuesOf('timeZone').
// src/lib/timezone.ts  — PURE, no data access, unit-tested.

export function isValidTimeZone(tz: string): boolean {
  return Intl.supportedValuesOf("timeZone").includes(tz);
}

/** Given wall-clock components as entered in `timeZone`, return the UTC Date. */
export function wallTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  // Interpret the wall time as if it were UTC, then correct by the zone's
  // offset at that instant.
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const tzAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = tzAsUtc - asUtc;           // ms the zone is ahead of UTC
  return new Date(asUtc - offset);
}
```

- **DST edge case:** for a "spring-forward" gap or "fall-back" overlap the single-pass offset can be an hour off. `Africa/Lagos` (the seed default, `schema.prisma:735`) has no DST, so this is not a today-problem — but document the limitation and, if a DST zone is ever configured, either iterate the offset correction twice or accept the standard "use the offset before the transition" convention. This is the one place a library (`@date-fns/tz`, `[ASSUMED]`) would remove a footgun.

### Enrolment state machine skeleton (D-11..D-16)

```typescript
// Source: withPermission usage from src/server/services/publish-service.ts:304;
//   transition validation is app logic (D-16 — no rules engine).
const VALID_TRANSITIONS: Record<EnrolmentStatus, EnrolmentStatus[]> = {
  PENDING_PAYMENT: ["ACTIVE", "CANCELLED"],           // approve / cancel / hold-expire
  ACTIVE:          ["WITHDRAWN", "TRANSFERRED", "COMPLETED", "CANCELLED"],
  WITHDRAWN:       [],                                 // terminal
  TRANSFERRED:     [],                                 // terminal
  CANCELLED:       [],                                 // terminal
  COMPLETED:       [],                                 // Phase 9/11 owns this
};

export const withdrawEnrolment = withPermission<{ enrolmentId: string; reason: string }>(
  "enrolments.manage",
  (input) => enrolmentCohortScope(input.enrolmentId),   // async → { cohortId, programmeId?, courseIds }
)(async (input, ctx) => {
  const reason = requireReason(input.reason);           // reuse the publish-service pattern
  return prisma.$transaction(async (tx) => {
    const e = await tx.enrolment.findUniqueOrThrow({ where: { id: input.enrolmentId } });
    assertTransition(e.status, "WITHDRAWN");
    await releaseSeat(tx, { cohortId: e.cohortId, enrolmentId: e.id, toStatus: "WITHDRAWN" });
    await tx.enrolment.update({ where: { id: e.id }, data: { status: "WITHDRAWN", withdrawnAt: new Date(), reason } });
    await writeDomainEvent(tx, { type: "enrolment.withdrawn", enrolmentId: e.id, cohortId: e.cohortId, actorId: ctx.actor.userId });
    return e.id;
  }).then(async (id) => {
    await recordAudit({ actorId: ctx.actor.userId, action: "enrolment.withdrawn", targetType: "Enrolment", targetId: id, before: { status: "ACTIVE" }, after: { status: "WITHDRAWN" }, reason, outcome: "SUCCESS" });
    return { id };
  });
});
```

- `requireReason` is a 3-line helper already written in `publish-service.ts:276`.
- Whether the audit write goes inside or just after the `$transaction` follows the repo's existing mix (`publish-service.ts` audits after commit; `resource-service.ts` audits after the update). Recommend: outbox row inside the txn (must be atomic), audit row after commit (matches `publish-service.ts`).

### Testcontainers concurrency proof (D-05)

```typescript
// Source: tests/reorder.integration.test.ts:148-159 (harness wiring) verbatim pattern.
import { startTestDatabase, TEST_DB_TIMEOUT_MS } from "./support/pg";

it("two concurrent take-seat txns on a capacity-1 cohort — exactly one wins", async () => {
  const cohortId = await seedCohort(testDb.prisma, { capacity: 1, seatsTaken: 0 });

  const results = await Promise.allSettled([
    testDb.prisma.$transaction((tx) => takeSeat(tx, { cohortId, enrolment: enr("user-a") })),
    testDb.prisma.$transaction((tx) => takeSeat(tx, { cohortId, enrolment: enr("user-b") })),
  ]);

  const ok = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  expect(ok).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CapacityExceededError);

  const cohort = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
  expect(cohort.seatsTaken).toBe(1);            // never 2 — the CHECK never had to fire
});

it("re-enrolling after withdrawal is allowed; a second ACTIVE is rejected as AlreadyEnrolledError", async () => {
  // proves the partial unique index WHERE status='ACTIVE' + the P2002 translation (D-15)
});
```

- **PREREQUISITE: Docker must be running.** If not, `beforeAll` fails with a container-start error — that is the expected failure mode, not a code bug (`tests/support/pg.ts:36-40`). CI must have Docker.

---

## State of the Art

| Old Approach | Current Approach (this repo) | Where |
|--------------|------------------------------|-------|
| `prisma.$transaction([...])` array form for multi-write | Interactive `$transaction(async (tx) => …)` with `tx.$queryRaw` / `tx.$executeRaw` for locks | `reorder-service.ts:260`, `publish-service.ts:382` |
| Next.js `getServerSideProps` / API routes | App Router RSC + Server Actions (`"use server"`) | all `src/app/staff/**` |
| `EventEmitter` / in-memory pub-sub | Transactional outbox row + pg-boss drain | recommended here; `queue.ts` header explains why |
| Auth.js / NextAuth | Hand-rolled DB sessions (`getCurrentActor`) | STATE.md decision; `src/server/auth/` |
| `moment-timezone` | `Intl.DateTimeFormat` + `Intl.supportedValuesOf` (Node 20+) | recommended `src/lib/timezone.ts` |

**Deprecated / not available:**
- **`Temporal`** — not stable in Node 22.14. Do not use.
- **pg-boss `fromPrisma` transactional enqueue** — needs Prisma v7+ / `@prisma/adapter-pg`; project pins 6.19.3 (`queue.ts:11-13`).
- **The four `deferredTo: "Phase 5"` stub items on `evaluateCourseReadiness`** (`readiness-service.ts:173-183`) — this phase makes them real, on a new *cohort* evaluator, and should retire them from the course evaluator.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@date-fns/tz` / `luxon` are the names of viable timezone libraries if the team rejects the hand-rolled helper | Standard Stack / Alternatives | Low — they are only mentioned as alternatives; the primary recommendation adds no package. Any such package must pass the Package Legitimacy Gate + a `checkpoint:human-verify` before install. |
| A2 | pg-boss v12 exposes `retryLimit` / `retryBackoff` / `retryDelay` options for bounded retry on `send`/`work`/`schedule` | Pattern 4 | Low — the exact option names must be verified against `node_modules/pg-boss/dist/index.d.ts` at implementation time (the repo already follows this "verify against the installed .d.ts" discipline, `queue.ts:24-26`). The *concept* of bounded retry in pg-boss is certain. |
| A3 | Removing the four Phase-5 stub items from `evaluateCourseReadiness` + updating `tests/readiness.test.ts:101-106` is acceptable | Pattern 5 / Open Questions | Medium — it edits a locked test. If the team wants the course panel to keep showing "cohort readiness lives elsewhere now", the items stay but change wording. Either way it is a deliberate planner decision, flagged below. |
| A4 | Enrolment "transition history" for the roster (D-17) can be served from `AuditEvent` rows rather than a dedicated table | Don't Hand-Roll | Low-Medium — fine for pilot volumes; if the roster needs fast per-learner history at scale, a dedicated `EnrolmentTransition` table may be added later. Not a Phase-5 blocker. |
| A5 | The recommended new columns (`Cohort.holdMinutes`, `Enrolment.holdExpiresAt`, `Enrolment` transfer self-relation, `DomainEvent` table) are the right shape | Standard Stack / Structure | Medium — names are Claude's Discretion (D-02 explicitly). The *need* for a hold-TTL field and transfer linkage is locked (D-02, D-13); `holdExpiresAt` and `DomainEvent` are researcher recommendations the planner can adjust. |
| A6 | A single-pass `Intl` offset correction is adequate because `Africa/Lagos` has no DST | Code Examples | Low today (seed default is `Africa/Lagos`, UTC+1, no DST). Becomes Medium if a DST zone is configured — documented as a known limitation. |

**Confirmation needed before execution:** A3 (touches a locked test), A5 (new schema shape — mostly discretion but worth a nod).

---

## Open Questions (RESOLVED)

> All five questions were resolved at planning time (2026-09-03). Each recommendation below
> is adopted and implemented by a Phase-5 plan — resolution stated inline after each item.
> Assumptions Log A3 (editing the Phase-4-locked `tests/readiness.test.ts`) and A5 are
> confirmed: A3 is explicitly sanctioned here and scoped into plan 05-03 Task 1 (the stub
> removal and the locked-test edit happen in the same task); A5 falls inside locked
> decisions D-02/D-13 and needs no separate sign-off.

1. **Course-evaluator Phase-5 stubs (`readiness-service.ts:173-183`, locked by `tests/readiness.test.ts:101-106`).**
   - What we know: D-28 says "the five reserved slots become real checks"; those slots are currently rendered on the *Course* readiness panel as `NOT_YET_CHECKED` / `deferredTo: "Phase 5"`. Schedule/Price/Capacity/Instructors are per-Cohort properties, not per-Course.
   - What's unclear: whether Phase 5 removes them from the course evaluator (and edits the locked test) or repurposes them.
   - Recommendation: add a new `evaluateCohortReadiness`; **remove** `schedule`/`price`/`capacity`/`instructors` from `evaluateCourseReadiness` and update `readiness.test.ts` in the same task; keep `assessments` (`deferredTo: "Phase 10"`, `:188`) untouched.
   - **RESOLVED:** adopted — plan 05-03 Task 1 removes the four Course stubs and updates the locked `tests/readiness.test.ts:101-106` in the same task (A3 confirmed).

2. **"Approve" on a hold-less `PENDING_PAYMENT` enrolment — does it take a seat?**
   - What we know: D-11 allows creating `PENDING_PAYMENT` with a hold (seat taken) *or* with no hold when `holdMinutes` is null/0 (seat not taken until ACTIVE, D-02). D-12's approve → ACTIVE.
   - What's unclear: the exact "does this enrolment hold a seat right now?" predicate.
   - Recommendation: seat-held iff `status='ACTIVE'` OR (`status='PENDING_PAYMENT'` AND `holdExpiresAt IS NOT NULL`). `approve` calls `takeSeat` only when not already held. Unit-test both branches (Pitfall 3).
   - **RESOLVED:** adopted — plans 05-04 (`seat-accounting.ts` `holdsSeat` predicate) and 05-07 (`approve` no-double-count test).

3. **`DomainEvent` outbox vs. writing directly to `EmailDispatch` intent rows.**
   - What we know: `model EmailDispatch` already exists (STATE.md concern list); D-14/D-20 say "emit a domain event". Phase 13 owns email.
   - What's unclear: whether Phase 5 writes a generic `DomainEvent` or an `EmailDispatch`-shaped "pending" row.
   - Recommendation: generic append-only `DomainEvent` (type, payload JSON, `occurredAt`, `processedAt` nullable). It serves Phase 9/11 (attendance component) and Phase 13 (email) and Phase 11 (certificate re-eval) without coupling Phase 5 to the email model. Confirm with the planner that a new table is acceptable vs. reusing `AuditEvent` with a marker (not recommended — audit is not a work queue).
   - **RESOLVED:** adopted — new `model DomainEvent` added in plan 05-01, write path in plan 05-04 (`domain-event-service.ts`).

4. **Does the hold-sweep need its own integration test with pg-boss running, or is a direct `releaseExpiredHolds()` test against Testcontainers enough?**
   - What we know: `worker-handlers.test.ts` tests handlers with fakes; pg-boss schema needs manual start in a container (`pg.ts:20-24`).
   - Recommendation: test `releaseExpiredHolds()` logic directly against a Testcontainers DB (idempotency, seat decrement, floor-at-0, only-expired-rows). Do **not** stand up pg-boss in the test — the schedule wiring in `worker/index.ts` is thin and covered by the `structure`/`boundary` tests plus manual verification.
   - **RESOLVED:** adopted — plan 05-09: `tests/hold-release.integration.test.ts` (direct Testcontainers) + `tests/worker-handlers.test.ts` (faked); pg-boss observed manually in 05-16.

5. **Attendance component storage — a column or computed on read?**
   - What we know: D-20 says Phase 5 "computes and stores/exposes the attendance component".
   - What's unclear: persist on `Enrolment` (e.g. `attendanceEarnedPct`, `attendanceRequiredPct`) or compute from `AttendanceRecord[]` each read.
   - Recommendation: compute on read for the roster/exceptions views (cheap at pilot scale, always correct after a correction), **and** include the computed value in the `"attendance changed"` `DomainEvent` payload so Phase 9/11 can consume it without recomputing. Persist only if a dashboard later needs cross-cohort aggregation (defer).
   - **RESOLVED:** adopted — compute-on-read in plan 05-02 (`attendance-component.ts`, pure) consumed by 05-10 roster; value included in the `attendance.changed` event payload (05-08). No persisted column.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v22.14.0 | — |
| PostgreSQL 16 | all persistence, `FOR UPDATE`, CHECK constraints | ✓ (dev: Neon; prod: `docker-compose.yml` `postgres:16-alpine`) | 16 | — |
| Docker | Testcontainers integration tests (D-05, D-15) | ✓ assumed on dev/CI; `@testcontainers/postgresql ^12.1.0` installed | — | **None** — without Docker the concurrency proof cannot run; `beforeAll` fails loudly (by design, `pg.ts:36-40`). CI must provide Docker. |
| pg-boss | hold-sweep job | ✓ `^12.29.0` installed, worker service in compose | 12.29.0 | — |
| `next` docs (`node_modules/next/dist/docs/`) | AGENTS.md mandate before writing Next.js code | ✓ present (`01-app`, `02-pages`, `03-architecture`, `04-community`) | 16.3.4 | — |
| Timezone data (`Intl` / ICU) | `src/lib/timezone.ts` (D-23) | ✓ Node 22 ships full ICU; `Intl.supportedValuesOf('timeZone')` works | — | — |
| Email provider | D-14 domain event → email | ✗ not wired (STATE.md concern) | — | **Fallback in scope:** Phase 5 only emits the `DomainEvent`; actual send is Phase 13. No blocker. |
| Completion-rule engine | ATT-02 verdict | ✗ not built (STATE.md concern) | — | **Fallback in scope:** Phase 5 computes the attendance *component* + emits the event (D-20); verdict is Phase 9/11. No blocker. |

**Missing dependencies with no fallback:** Docker for the D-05 / D-15 integration tests — must be present in CI and on the implementer's machine.
**Missing dependencies with fallback:** email provider, completion engine — both explicitly out of scope for Phase 5 and handled by the event-emission design.

---

## Validation Architecture

`.planning/config.json` has no `workflow.nyquist_validation` key → **validation is enabled**. Test runner: `vitest` (`npm test` → `vitest run`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^4.1.11` (unit + integration); jsdom `^29.1.1` for component tests |
| Config file | none checked in — vitest picks up `vitest.config.*` if added; today tests run on defaults + `@vitejs/plugin-react`. **Wave 0:** confirm whether a `vitest.config.ts` is needed to separate the slow Testcontainers suite (`*.integration.test.ts`) from unit tests. |
| Quick run command | `npm test -- <file>` or `npx vitest run <pattern>` |
| Full suite command | `npm test` (`vitest run`) |
| Integration timeout constant | `TEST_DB_TIMEOUT_MS = 180_000` from `tests/support/pg.ts:44` — every `beforeAll`/`afterAll` in an integration file must pass it |

### Phase Requirements → Test Map

| Req | Behaviour | Test Type | Automated Command | File Exists? |
|-----|-----------|-----------|-------------------|-------------|
| COH-06 / D-05 | 2 concurrent `takeSeat` on capacity-1 → exactly one wins; `seatsTaken` never exceeds `capacity`; CHECK never fires | **integration (real Postgres)** | `npx vitest run tests/seat-accounting.integration.test.ts` | ❌ Wave 0 |
| COH-05 / D-15 | Re-enrol after `WITHDRAWN` succeeds; second `ACTIVE` for same (user,cohort) → `AlreadyEnrolledError`, not P2002/500 | **integration** | same file | ❌ Wave 0 |
| COH-06 / D-04 | `releaseSeat` decrements under `FOR UPDATE`, floors at 0 | integration | same file | ❌ Wave 0 |
| COH-06 / D-03 | `releaseExpiredHolds()` cancels only `PENDING_PAYMENT` past `holdExpiresAt`, decrements seats, is idempotent on re-run | **integration** | `npx vitest run tests/hold-release.integration.test.ts` | ❌ Wave 0 |
| COH-01 / D-30 | Cannot change `courseId`/`programmeId` once any `Enrolment` exists | unit (fake delegate) + integration | `npx vitest run tests/cohort-service.test.ts` | ❌ Wave 0 |
| COH-01 (DB) | XOR CHECK rejects a cohort with both/neither offer | integration / schema test | `npx vitest run tests/schema-cohort.test.ts` | ❌ Wave 0 (pattern: `tests/schema-catalogue.test.ts`) |
| COH-02 (DB) | date-order CHECK rejects `endsAt < startsAt` | schema test | same file | ❌ Wave 0 |
| COH-03 / D-22 | "repeat weekly ×N" inserts exactly N rows at +7-day steps | unit | `npx vitest run tests/session-service.test.ts` | ❌ Wave 0 |
| COH-03 / D-23 | `wallTimeToUtc` round-trips for `Africa/Lagos` and at least one non-UTC+0 zone; invalid zone rejected | unit (pure) | `npx vitest run tests/timezone.test.ts` | ❌ Wave 0 |
| COH-03 / D-26 | session soft-cancel sets `cancelledAt` + `cancellationReason`, never deletes | unit | `tests/session-service.test.ts` | ❌ Wave 0 |
| COH-04 / D-28-29 | `evaluateCohortReadiness` — each slot's PASS/FAIL/WARN per the D-28 rules; `blockingFailures` blocks publish | unit (pure) | `npx vitest run tests/cohort-readiness.test.ts` | ❌ Wave 0 (pattern: `tests/readiness.test.ts`) |
| COH-05 / D-11-14 | each transition validated; illegal transition rejected; reason mandatory; audit + domain event written | unit | `npx vitest run tests/enrolment-service.test.ts` | ❌ Wave 0 |
| COH-05 / D-13 | transfer: source → `TRANSFERRED` (seat released), target `ACTIVE` (seat taken, capacity-checked), linked, attendance NOT copied | integration | `tests/enrolment-service.integration.test.ts` | ❌ Wave 0 |
| COH-07 / D-21 | Instructor scoped to assigned cohorts only; out-of-scope cohort → denied (not filtered) | unit (`with-permission` harness) | `npx vitest run tests/roster-service.test.ts` | ❌ Wave 0 |
| COH-07 / D-18 | deferred columns render as third state, never 0/blank | component | `tests/components/…` | ❌ Wave 0 |
| ATT-01 / D-07 | mark stamps `recordedById`/`recordedAt`; bulk write touches only roster enrolments | unit + integration | `npx vitest run tests/attendance-service.test.ts` | ❌ Wave 0 |
| ATT-01 / D-10 | bulk mark cannot write an `AttendanceRecord` for a non-enrolled / out-of-scope learner | integration | `tests/attendance-service.integration.test.ts` | ❌ Wave 0 |
| ATT-03 / D-06,D-08 | inside window: no reason needed; after `endsAt + 168h`: empty `correctionReason` rejected, stamps `correctedById`/`correctedAt`; before/after in `AuditEvent` | unit (window boundary) + integration | `tests/attendance-service*.test.ts` + `tests/attendance-window.test.ts` | ❌ Wave 0 |
| ATT-01 / D-09 | pre-start mark of `PRESENT`/`ABSENT`/`LATE` rejected; `EXCUSED`/`NOT_RECORDED` allowed | unit | `tests/attendance-service.test.ts` | ❌ Wave 0 |
| ATT-02 / D-20 | attendance component (earned vs required %) computed correctly from records + threshold; `"attendance changed"` event emitted on every mark/correction | unit (pure compute) + integration (event row) | `npx vitest run tests/attendance-component.test.ts` | ❌ Wave 0 |
| ATT-04 / D-19 | exception categories correct; CSV values == on-screen filtered values | unit | `tests/roster-service.test.ts` | ❌ Wave 0 |
| D-32 (boundary) | worker runtime closure does not import `@/server/permissions` / `next/headers` after adding the hold-sweep | existing test, re-run | `npx vitest run tests/boundary.test.ts` | ✅ exists — must stay green |

### Sampling Rate
- **Per task commit:** `npx vitest run <the files touched>` (unit tests are sub-second).
- **Per wave merge:** `npm test` (full suite) — includes the Testcontainers integration files; requires Docker, ~2-3 min for container start.
- **Phase gate:** full suite green + the three integration files (`seat-accounting`, `hold-release`, `enrolment-service` / `attendance-service`) explicitly passing before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/support/` — a `seedCohort` / `seedEnrolment` / `seedSession` helper (mirror `tests/reorder.integration.test.ts:59` `seedCourse`), likely in a new `tests/support/cohort-fixtures.ts`.
- [ ] `tests/seat-accounting.integration.test.ts` — covers COH-06/D-04/D-05, COH-05/D-15.
- [ ] `tests/hold-release.integration.test.ts` — covers COH-06/D-03.
- [ ] `tests/schema-cohort.test.ts` — covers the DB CHECK/index behaviour (pattern: `tests/schema-catalogue.test.ts`) — **required** if Phase 5 adds any raw-SQL constraint (Pitfall 2).
- [ ] `tests/timezone.test.ts`, `tests/attendance-window.test.ts` — pure unit, no infra.
- [ ] `tests/cohort-readiness.test.ts`, `tests/cohort-service.test.ts`, `tests/session-service.test.ts`, `tests/enrolment-service.test.ts`, `tests/attendance-service.test.ts`, `tests/attendance-component.test.ts`, `tests/roster-service.test.ts` — unit with fake delegates + the `createTestWithPermission` harness (`tests/support/harness.ts`).
- [ ] Decide (Wave 0): whether to add `vitest.config.ts` with a project split so `npm test` can run fast unit tests without Docker and a separate command runs `*.integration.test.ts`. Currently there is no config file and integration tests run inline with `npm test`.
- [ ] Update `tests/readiness.test.ts:101-106` when the Course-evaluator stubs are removed (Open Question 1).

---

## Security Domain

`security_enforcement` is not set in `.planning/config.json` → **enabled**.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control (this repo) |
|---------------|---------|------------------------------|
| V1 Architecture | yes | Service-layer Prisma boundary (`tests/boundary.test.ts`); worker-closure isolation from request APIs. |
| V4 Access Control | **yes — central** | Every mutation through `withPermission` (`src/server/permissions/with-permission.ts`); COHORT/COURSE/PROGRAMME scope resolved from the DB row, never caller-asserted (`with-permission.ts:127-129`); deny-by-default (`scope.ts:83-91`); denials audited (RBAC-08). Instructor roster scoping (D-21). Bulk attendance scoped to roster, not a caller list (D-10). |
| V5 Input Validation | yes | `zod` on every server action — dates, `EnrolmentStatus`/`AttendanceState` enums, capacity ≥ 1, `priceMinor` ≥ 0, `currency`, reason length, timezone string validated against `Intl.supportedValuesOf`. Money is integer minor units (PROJECT.md constraint). |
| V7 Error Handling & Logging | yes | Typed refusals → specific messages, never raw stack traces (`publish-service.ts:76-123` pattern); `AuthorizationError` does not reveal resource existence (`with-permission.ts:44-48`); audit redaction at the sink (`audit-service.ts:52`). |
| V8 Data Protection | yes | Meeting links hidden before `linkVisibleFromMinutes` and from unenrolled users (D-25 / LRN-06 groundwork). CSV export bounded, permission-gated, excludes secrets (constraints §7). |
| V11 Business Logic | **yes — central** | Capacity cannot be exceeded under concurrency (`FOR UPDATE` + CHECK backstop). No duplicate active enrolment (partial unique index). State-machine transitions validated (no illegal jumps). Idempotent hold-sweep + bounded retry (constraints §43). Attendance correction window + mandatory reason (ATT-03). |
| V6 Cryptography | no | No new crypto in this phase. |
| V2 Authentication / V3 Session | no (unchanged) | Sessions are hand-rolled and already built (Phase 1/3). |

### Known Threat Patterns for this stack (Next.js Server Actions + Prisma + Postgres + pg-boss)

| Pattern | STRIDE | Standard Mitigation (this repo) |
|---------|--------|--------------------------------|
| Oversell / capacity race via concurrent checkout | Tampering / DoS-of-business | `SELECT … FOR UPDATE` on the `Cohort` row inside `$transaction`; `cohort_capacity_not_exceeded` CHECK backstop; proven vs real Postgres (D-05). |
| Duplicate active enrolment on request replay | Tampering | Partial unique index `enrolment_one_active_per_learner_cohort`; app translates `P2002` → `AlreadyEnrolledError` (D-15). |
| Illegal enrolment state jump (e.g. `WITHDRAWN` → `ACTIVE` without re-enrol) | Tampering | Explicit `VALID_TRANSITIONS` table; `assertTransition` before every write (D-16). |
| Scoped staff acting outside assignment (Instructor marks attendance for a cohort they don't teach) | Elevation of Privilege | `withPermission` + DB-resolved COHORT scope; `grantMatches` denies a COHORT grant whose `scopeId` ≠ `resource.cohortId` (`scope.ts:67-68`); bulk ops derive the learner set from the scoped cohort's roster (D-10, D-21). |
| Meeting-link disclosure to unenrolled users / before window | Information Disclosure | Server-side gate on `linkVisibleFromMinutes` + enrolment status before returning `meetingUrl` (D-25). Never send `meetingUrl` in a list payload. |
| SQL injection via raw `$queryRaw` in seat accounting | Tampering | Use tagged-template `$queryRaw`/`$executeRaw` (parameterised) exactly as `reorder-service.ts:272` — never `$queryRawUnsafe` with interpolation. |
| Worker process minting a god-actor to bypass authz | Elevation of Privilege | No synthetic GLOBAL actor — a named, unauthorized, filter-less `…AsSystem` module with `actorType: "SYSTEM"` audit rows (`scan-system-service.ts:1-40` pattern). |
| Attendance correction to rewrite history silently | Repudiation | `correctedById`/`correctedAt`/`correctionReason` stamped; full before/after in append-only `AuditEvent` (ATT-03); audit table has no update/delete path (`tests/audit-append-only.test.ts`). |
| Unbounded / retrying hold-sweep hammering the DB | DoS | pg-boss `retryLimit` + `retryBackoff` (bounded); scheduled cadence, not a tight loop; each row in its own short transaction. |
| CSV export leaking out-of-scope rows via totals/filters | Information Disclosure | Export runs the same scoped query as the on-screen view; RPT-02 principle; bounded to one cohort (D-19). |
| Cohort published against a draft/unpublished Course/Programme | Tampering / business logic | New Catalogue readiness slot (D-29) — FAIL unless pinned to a `PUBLISHED` publication row. |

---

## Sources

### Primary (HIGH confidence — read directly this session)
- `prisma/schema.prisma` — Cohort/CohortCourse/CohortInstructor/ScheduledSession/AttendanceRecord/Enrolment models + all enums (lines 40-100, 720-975).
- `prisma/migrations/20260901115332_init/migration.sql:1202-1295` — confirms `001_integrity.sql` is applied (partial unique index, XOR/capacity/date/scope CHECKs).
- `prisma/migrations/` (all 4) + `prisma/sql/001_integrity.sql`, `prisma/sql/002_catalogue_integrity.sql` — migration state, the "silently unapplied" lesson.
- `src/server/services/resource-service.ts` — the CRUD factory, async `toScope`, `runInTransaction`, `isUniqueConstraintViolation`, `PositionContentionError`.
- `src/server/services/readiness-service.ts` — evaluator, `ReadinessItem`/`ReadinessState`/`ReadinessCategory`, `blockingFailures`, the Phase-5 stubs at `:173-183`.
- `src/server/services/publish-service.ts` — publish operation pattern, `withPermission` usage, `requireReason`, `StaleOrderError`, typed refusals, `createPrismaBackedPublishService` test-wiring pattern.
- `src/server/services/reorder-service.ts:230-405` — `$transaction` + `tx.$executeRaw` idiom, conditional-`updateMany` optimistic concurrency.
- `src/server/services/catalogue-guards.ts` — running-cohort guard, injected delegate pattern, `RunningCohortError`.
- `src/server/services/scan-system-service.ts:1-60` — the worker-only unauthorized module pattern (mirror for the hold sweep).
- `src/server/services/audit-service.ts` — `recordAudit`, `buildAuditRow`, `actorType: "SYSTEM"`, `redactForAudit`.
- `src/server/permissions/with-permission.ts`, `scope.ts`, `catalogue.ts` — authz choke point, `grantMatches` for COHORT/COURSE/PROGRAMME, closed permission catalogue (`cohorts.*`, `enrolments.*`, `attendance.*` all present, lines 33-44).
- `src/server/jobs/queue.ts`, `worker/index.ts`, `worker/handlers/*.ts` — pg-boss registration, `createQueue`/`work`/`schedule`, handler factory pattern, non-transactional-enqueue caveat.
- `tests/support/pg.ts` — Testcontainers harness, `TEST_DB_TIMEOUT_MS`, auto-apply of un-pasted SQL companions, pg-boss schema note.
- `tests/support/harness.ts` — `grant()` / `createTestWithPermission()`.
- `tests/reorder.integration.test.ts` — the real-Postgres concurrency-proof pattern to copy for D-05.
- `tests/boundary.test.ts` — the worker-runtime-closure isolation rule (`:135-160`).
- `tests/worker-handlers.test.ts`, `tests/readiness.test.ts` — unit patterns to mirror.
- `docker-compose.yml` — `worker` service already has `DATABASE_URL`; no compose change needed.
- `src/app/staff/layout.tsx:24` — `Cohorts` / `Enrolments` NAV placeholders (`href: null`) to wire.
- `prisma/seed.ts:292-405` — existing cohort/session/instructor seed data.
- `.planning/intel/constraints.md` §§ PXR 2.1 / 3 / 6 / 8, PRD §15.3(4) — scoped-control behaviour, six render states, readiness "named gaps not silent passes", integrity-action modal standard, "do not automate approval logic".
- `.planning/intel/requirements.md` — COH-04..07, ATT-01..04 acceptance criteria.
- `package.json`, `node --version` (v22.14.0), `tsconfig.json` (`target: ES2017`), `node_modules/next/dist/docs/` inventory.

### Secondary (MEDIUM confidence)
- Node 22 `Intl` / `Temporal` availability — training knowledge cross-checked against the confirmed runtime version (v22.14.0). `Intl.supportedValuesOf` and `Intl.DateTimeFormat` timeZone support are certain in Node 22; `Temporal` instability in Node 22 is well-established.

### Tertiary (LOW confidence — flagged, not relied on)
- pg-boss v12 exact retry-option names (`retryLimit` etc.) — verify against `node_modules/pg-boss/dist/index.d.ts` at implementation time.
- `@date-fns/tz` / `luxon` as timezone-library names — `[ASSUMED]`, mentioned only as alternatives the primary recommendation avoids.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every library read from `package.json` and used elsewhere in the repo.
- Architecture / patterns: HIGH — each pattern is an existing file in this repo cited by path:line.
- Migration state (open question 1): HIGH — resolved by reading the actual migration SQL; `001_integrity.sql` IS applied.
- Pitfalls: HIGH — derived from repo code, comments, and the Phase-4 follow-up-fix history in STATE.md.
- Timezone approach: MEDIUM — hand-rolled `Intl` is sound for `Africa/Lagos`; DST zones carry a documented single-pass-offset caveat.
- pg-boss retry specifics: MEDIUM — concept certain, option names to verify.

**Research date:** 2026-09-03
**Valid until:** ~2026-10-03 for the ecosystem/version findings; the repo-grounded findings (schema, migrations, service patterns) are valid until those files change — re-check `readiness-service.ts`, `resource-service.ts`, and `prisma/migrations/` if Phase 2/3/4 branches merge more work first.
