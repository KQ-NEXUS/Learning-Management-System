# Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance - Pattern Map

**Mapped:** 2026-09-03
**Files analyzed:** 31 (services 11, libs 2, jobs/worker 3, prisma 4, app 9, components 2, test scaffolding as noted)
**Analogs found:** 29 / 31 (2 partial — see "No Analog Found")

This phase is application logic over a finished schema. Almost every new file has a direct
in-repo analog. Planner: cite the analog file + line range in each plan's action steps.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/server/services/cohort-service.ts` | service (CRUD + publish + cancel) | CRUD / request-response | `src/server/services/course-service.ts` + `publish-service.ts` + `catalogue-guards.ts` | exact (factory) + role-match (publish) |
| `src/server/services/readiness-service.ts` *(extend)* | pure evaluator | transform | `evaluateCourseReadiness` in the same file (`readiness-service.ts:99-200`) | exact |
| `src/server/services/session-service.ts` | service (CRUD + repeat-weekly + soft-cancel) | CRUD / batch | `course-service.ts` factory + `lesson-service.ts:95-102` async `archiveData` | exact |
| `src/server/services/enrolment-service.ts` | service (state machine + reason + audit + events) | event-driven / request-response | `publish-service.ts` (`withPermission` + `requireReason` + typed refusals + audit) | role-match |
| `src/server/services/seat-accounting.ts` | utility (transaction-taking, unauthorized) | transform / DB transaction | `reorder-service.ts:228-299` (`$transaction` + `tx.$executeRaw`) + `prisma/sql/001_integrity.sql:42-55` | role-match + recipe |
| `src/server/services/attendance-service.ts` | service (mark/correct + window boundary + scoped bulk) | CRUD / event-driven | `reorder-service.ts:301-356` (scoped bulk commit + `verifyArrangement`) + `scan-system-service.ts:74-76` (`now` injection) | role-match |
| `src/server/services/attendance-component.ts` | utility (pure compute) | transform | `readiness-service.ts` (pure module, no imports) / `src/lib/positions.ts` | role-match |
| `src/server/services/domain-event-service.ts` | service (transactional outbox writer) | event-driven / pub-sub | `audit-service.ts:79-102` (`buildAuditRow` pure → `recordAudit` write) | role-match |
| `src/server/services/hold-release-system-service.ts` | service (WORKER-ONLY, unauthorized) | batch / event-driven | `src/server/services/scan-system-service.ts` (whole file — canonical) | exact |
| `src/server/services/roster-service.ts` | service (scoped read + exceptions + bounded CSV) | request-response / batch | `programme-service.ts:258-385` (`listProgrammesForIndex`, `loadProgrammeComposition`) | role-match |
| `src/server/services/cohort-scope.ts` | utility (async scope resolver) | transform | `lesson-service.ts:193-199` (`resolveCourseIdForModule` async `toScope`) + `course-service.ts:19-21` | role-match |
| `src/lib/timezone.ts` | utility (pure, unit-tested) | transform | `05-RESEARCH.md:505-536` code example + `src/lib/positions.ts` (pure lib ethic) | role-match |
| `src/lib/attendance-window.ts` | utility (pure constant + predicate) | transform | `src/lib/positions.ts` (band constants + pure predicates) | role-match |
| `src/server/jobs/queue.ts` *(modify)* | config (queue registry) | pub-sub | `SCAN_QUEUE` / `RECONCILE_QUEUE` + `enqueueScan` in the same file (`queue.ts:27-63`) | exact |
| `worker/index.ts` *(modify)* | config (worker bootstrap) | event-driven | `RECONCILE_QUEUE` wiring in the same file (`worker/index.ts:37,45-49`) | exact |
| `worker/handlers/release-expired-holds.ts` | handler (DI factory) | batch | `worker/handlers/reconcile-lesson-resources.ts` (whole file — canonical) | exact |
| `prisma/schema.prisma` *(modify)* | model | — | existing `model Cohort` (`:726-792`), `model Enrolment` (`:893-927`); self-relation → see note | exact |
| `prisma/migrations/<new>/migration.sql` | migration | — | how `001`/`002` SQL is pasted into `20260901115332_init/migration.sql` | exact |
| `prisma/sql/003_*.sql` *(only if new CHECK)* | migration companion | — | `prisma/sql/002_catalogue_integrity.sql` (header explains the paste-in + regression-test rule) | exact |
| `prisma/seed.ts` *(modify)* | seed data | — | existing cohort/session block (`prisma/seed.ts:292-408`) | exact |
| `src/app/staff/cohorts/page.tsx` | route (RSC list) | request-response | `src/app/staff/courses/page.tsx` (whole file) | exact |
| `src/app/staff/cohorts/CohortsTable.tsx` | component (list) | request-response | `src/app/staff/courses/CoursesTable.tsx` (ResourceTable config) | exact |
| `src/app/staff/cohorts/new/page.tsx` + cohort form | route + component (form) | request-response | `src/app/staff/programmes/new/page.tsx` + `ProgrammeForm.tsx` | exact |
| `src/app/staff/cohorts/[id]/page.tsx` | route (RSC detail, tabs) | request-response | `src/app/staff/courses/[id]/page.tsx` (DetailLayout + ReadinessPanel) | exact |
| `src/app/staff/cohorts/[id]/publish-actions.ts` | server actions (publish/cancel) | request-response | `src/app/staff/courses/[id]/publish-actions.ts` (whole file — canonical) | exact |
| `src/app/staff/cohorts/actions.ts` | server actions (create/edit) | request-response | `src/app/staff/programmes/actions.ts` (whole file) | exact |
| `src/app/staff/cohorts/[id]/roster/*` + attendance bulk-entry screen | route + client component | request-response / batch | `src/app/staff/courses/[id]/arrange/ArrangeClient.tsx` ("rearrange freely, save once") + `ResourceTable` | role-match |
| `src/app/staff/enrolments/*` | route (RSC list) | request-response | `src/app/staff/courses/page.tsx` + `CoursesTable.tsx` | role-match |
| `src/app/staff/layout.tsx` *(modify)* | config (nav) | — | the `NAV` array's routed entries (`layout.tsx:18-29`) | exact |
| `src/components/catalogue/*` reuse — `ReadinessPanel`, `CohortDetailActions` (new) | component | request-response | `src/components/catalogue/ReadinessPanel.tsx` (reuse as-is) + `CourseDetailActions` (analog) | exact (panel) / role-match (actions) |
| reason-capture modals (transfer / withdraw / cancel / correct-attendance) | component | request-response | `src/components/primitives/ConfirmModal.tsx` (reuse — `minReasonLength`, "action not applied") | exact |

**Test scaffolding (Wave 0, per RESEARCH "Test Framework" + "Wave 0 Gaps"):**
`tests/support/cohort-fixtures.ts` (new) ← `seedCourse` in `tests/reorder.integration.test.ts:57-80`;
`tests/seat-accounting.integration.test.ts` ← `tests/reorder.integration.test.ts:1-80` harness wiring;
`tests/schema-cohort.test.ts` ← `tests/schema-catalogue.test.ts` (whole file);
`tests/cohort-readiness.test.ts` ← `tests/readiness.test.ts`;
unit tests ← `tests/support/harness.ts` (`grant`, `createTestWithPermission`).

---

## Pattern Assignments

### `src/server/services/cohort-service.ts` (service, CRUD + publish + cancel)

**Analogs:** `src/server/services/course-service.ts` (factory), `src/server/services/publish-service.ts`
(publish op), `src/server/services/catalogue-guards.ts` (running-cohort refusal / immutability guard).

**Factory wiring** — copy `course-service.ts:23-44` verbatim, adapt names, add async scope +
`archiveData` for the CANCELLED status (D-31):

```typescript
// src/server/services/course-service.ts:23-44 — the shape to copy
export const courseService = createResourceService<CourseRecord>({
  name: "Course",
  delegate: prisma.course as unknown as Delegate<CourseRecord>,
  permissions: { view: "courses.view", create: "courses.create", edit: "courses.edit" },
  toScope: courseScope,
  withPermission,
  audit: (entry) => recordAudit({ actorId: entry.actorId, action: entry.action, /* …8 fields… */ }),
});
```

For Cohort: `permissions: { view: "cohorts.view", create: "cohorts.manage", edit: "cohorts.manage" }`
(catalogue confirmed by `prisma/seed.ts:40` — `cohorts.view/manage/publish` exist; **no new identifiers**).
`toScope: cohortResourceScope` (async — see `cohort-scope.ts` below).
`archiveData: () => ({ status: "CANCELLED" })` — the exact override mechanism at `resource-service.ts:278`
(`const data = (await config.archiveData?.(input.id)) ?? { status: "ARCHIVED" }`).
Pass `runInTransaction: (fn) => prisma.$transaction(fn)` (as `lesson-service.ts:232`,
`programme-service.ts:250`) so the bulk-withdraw on cancel (D-31) is atomic with the status write.

**Immutability guard (D-30)** — new surface, hand-written like `catalogue-guards.ts`. Model on
`catalogue-guards.ts:107-171`: an injected `Cohort`/`Enrolment` delegate, a typed error carrying
context, thrown from a guard function. Before any write that changes `courseId`/`programmeId`:
`if (await enrolmentDelegate.count({ where: { cohortId } }) > 0) throw new OfferLockedError(cohortId)`.

**Publish (D-27/D-28/D-29)** — new `withPermission("cohorts.publish", cohortResourceScope)` action,
NOT in the factory (see `publish-service.ts:1-4` "the operation the factory does not have"). Copy the
skeleton of `createPublishOperation` (`publish-service.ts:301-377`): load aggregate → `blockingFailures(evaluateCohortReadiness(agg))`
→ throw `ReadinessRefusedError` if non-empty → commit in `$transaction` with the conditional
`updateMany({ where: { id, updatedAt: expectedUpdatedAt } })` stale-check (`publish-service.ts:383-387`,
`StaleOrderError` imported from `reorder-service.ts`) → audit after commit.

**Cancel-cohort bulk-withdraw (D-31)** — inside one `$transaction`: for each ACTIVE enrolment call
`enrolment-service`'s withdraw path (or `seatAccounting.releaseSeat`) with the single shared reason,
then set `Cohort.status = "CANCELLED"`. Each `WITHDRAWN` transition audited individually.

**Typed refusals + Server-Action mapping** — mirror `publish-service.ts:76-123` (one error class per
refusal reason) and `src/app/staff/courses/[id]/publish-actions.ts:68-108` (`toFailure` → discriminated
`{ ok: false, reason }` union; authz failure collapses to one generic `DENIED` line).

---

### `src/server/services/readiness-service.ts` (extend — pure evaluator)

**Analog:** `evaluateCourseReadiness` (`readiness-service.ts:99-200`) — same file, same shape.

**Add `evaluateCohortReadiness(input: ReadinessCohortInput): ReadinessItem[]`.** Reuse `ReadinessItem`
(`:30`), `ReadinessState` (`:20`), `blockingFailures` (`:258-260`). Item shape to copy
(`readiness-service.ts:102-117`):

```typescript
{ id: "schedule", category: "Schedule", label: "…", blocking: true,
  state: deliveryMode === "SELF_PACED" || nonCancelledSessions > 0 ? "PASS" : "FAIL" }
```

**Type changes required in this file:**
- `ReadinessCategory` (`:22-28`) — add `"Catalogue"`.
- `ReadinessItem.deferredTo` union (`:38`, currently `"Phase 5" | "Phase 10"`) — cohort items are all
  real checks (D-28), so no new value needed; confirm at plan time.
- **Retire the four Phase-5 stubs from `evaluateCourseReadiness`** (`:173-183` — `schedule`/`price`/
  `capacity`/`instructors` with `state: "NOT_YET_CHECKED", deferredTo: "Phase 5"`) and update
  `tests/readiness.test.ts:101-106` in the same task. Keep the `assessments` stub (`:188-197`,
  `deferredTo: "Phase 10"`). This is a deliberate edit to a locked test — flagged in RESEARCH Open
  Question 1.

**Blocking semantics (D-28):** `blockingFailures` (`:258`) returns items that are BOTH `state === "FAIL"`
AND `blocking === true`. Schedule / Capacity / Instructors / Catalogue → `blocking: true`. Price →
effectively always PASS. Completion → WARN-only, `blocking: false`.

**Rendering:** reuse `src/components/catalogue/ReadinessPanel.tsx` unchanged — it never evaluates
(`ReadinessPanel.tsx:8-18`), takes `ReadinessItem[]`, and already renders `NOT_YET_CHECKED` as the
distinct third state with a `•` glyph (`ReadinessPanel.tsx:50-57`). Add `"Catalogue"` to its
`CATEGORY_ORDER` (`ReadinessPanel.tsx:23-30`).

---

### `src/server/services/session-service.ts` (service, CRUD + repeat-weekly + soft-cancel)

**Analog:** `course-service.ts` factory + `lesson-service.ts:88-102` (async `archiveData`).

**Factory wiring** — same as `cohort-service.ts` above. `permissions: { view: "cohorts.view",
create: "cohorts.manage", edit: "cohorts.manage" }`. `toScope`: resolve the session's `cohortId`
then delegate to `cohortResourceScope` — exactly the two-hop pattern of `lesson-service.ts:193-199`:

```typescript
// lesson-service.ts:193-196 — resolve parent id from the row, never trust the caller
const listWithdrawnLessons = deps.withPermission<string>("courses.view", async (moduleId) => {
  const courseId = await resolveCourseIdForModule(moduleId);
  return { courseIds: courseId ? [courseId] : [] };
})(async (moduleId) => { /* … */ });
```

**Soft-cancel (D-26)** — `archiveData: async (id) => ({ cancelledAt: now(), cancellationReason: reason })`.
Fields exist (`schema.prisma:852-853`). Never a hard delete (`resource-service.ts:11-13`).

**Repeat-weekly ×N (D-22)** — new surface. No recurrence entity. Inside one `$transaction` insert N
`ScheduledSession` rows at `startsAt + 7*k days`. Mirror the loop-in-transaction style of
`reorder-service.ts:280-282`. Recommend a small server action, not a client form (Claude's Discretion).

**Timezone (D-23)** — the create/edit action parses `{date, time}` in `Cohort.timezone` via
`src/lib/timezone.ts` `wallTimeToUtc`, stores UTC in `startsAt`/`endsAt`. Never store a fixed offset
(`05-RESEARCH.md:410` anti-pattern — `Africa/Lagos` has no DST so a naive `+01:00` would pass today's
tests and break elsewhere).

---

### `src/server/services/enrolment-service.ts` (service, state machine)

**Analog:** `publish-service.ts` — `withPermission` usage, `requireReason` (`publish-service.ts:276-280`),
typed refusals, audit-after-commit. State-machine skeleton in `05-RESEARCH.md:538-572`.

**Transition table** — hand-written app logic, no rules engine (D-16):

```typescript
const VALID_TRANSITIONS: Record<EnrolmentStatus, EnrolmentStatus[]> = {
  PENDING_PAYMENT: ["ACTIVE", "CANCELLED"],
  ACTIVE:          ["WITHDRAWN", "TRANSFERRED", "COMPLETED", "CANCELLED"],
  WITHDRAWN: [], TRANSFERRED: [], CANCELLED: [], COMPLETED: [],
};
```

Enum values confirmed at `schema.prisma:61-68`.

**Each action** (`add` D-11, `approve` D-12, `transfer` D-13, `withdraw`/`cancel` D-14) follows the
`publish-service.ts` withdraw-style shape (`05-RESEARCH.md:552-568`):
1. `withPermission("enrolments.manage", (input) => enrolmentCohortScope(input.enrolmentId))`
2. `const reason = requireReason(input.reason)` — copy `publish-service.ts:276-280` verbatim
3. `prisma.$transaction(async (tx) => { … assertTransition(); seatAccounting.takeSeat/releaseSeat(tx, …); tx.enrolment.update(…); writeDomainEvent(tx, …) })`
4. `recordAudit({ before, after, reason, outcome: "SUCCESS" })` after commit (matches `publish-service.ts:346-355`)

**Duplicate-active guard (D-15)** — do NOT pre-check. Let the partial unique index
(`prisma/sql/001_integrity.sql:15-17`) reject, catch with `isUniqueConstraintViolation` (already
duck-typed at `resource-service.ts:77-84` — `err.code === "P2002"`, no Prisma import), rethrow as
`AlreadyEnrolledError`. Server action maps it to a clean "already enrolled" result, never a 500.

**Transfer (D-13)** — target must share `courseId` or `programmeId`. Old → `TRANSFERRED` (seat
released), new `ACTIVE` in target (seat taken via `takeSeat`, capacity-checked). New enrolment records
source enrolment id (needs the `Enrolment` self-relation — schema change). Attendance/progress NOT
copied.

**Seat-hold predicate (Pitfall 3, RESEARCH Open Question 2)** — a seat is held iff
`status = 'ACTIVE'` OR (`status = 'PENDING_PAYMENT'` AND `holdExpiresAt IS NOT NULL`). `approve` calls
`takeSeat` only when no seat is currently held. Unit-test both branches.

---

### `src/server/services/seat-accounting.ts` (utility, transaction-taking, unauthorized)

**Analogs:** `reorder-service.ts:228-299` (`$transaction` + `tx.$executeRaw` idiom);
`prisma/sql/001_integrity.sql:42-55` (the blessed recipe, pasted into
`prisma/migrations/20260901115332_init/migration.sql`).

**The recipe** (`prisma/sql/001_integrity.sql:42-49`):

```sql
BEGIN;
  SELECT "seatsTaken", capacity FROM "Cohort" WHERE id = $1 FOR UPDATE;
  -- refuse if seatsTaken >= capacity
  INSERT INTO "Enrolment" (...);
  UPDATE "Cohort" SET "seatsTaken" = "seatsTaken" + 1 WHERE id = $1;
COMMIT;
```

**Tagged-template raw SQL** — copy the parameterised style of `reorder-service.ts:272-277`
(`tx.$executeRaw\`UPDATE "Module" SET … WHERE "courseId" = ${input.courseId}\``). For the lock use
`tx.$queryRaw<{ seatsTaken: number; capacity: number }[]>\`SELECT "seatsTaken", "capacity" FROM "Cohort" WHERE id = ${cohortId} FOR UPDATE\``.
NEVER `$queryRawUnsafe` with interpolation (`05-RESEARCH.md:768`).

**Signature** — `takeSeat(tx, args)` / `releaseSeat(tx, args)` take the tx client as first arg (like
every `reorder-service.ts` helper e.g. `claimCourse(tx, …)` at `:228`). Typed errors
`CapacityExceededError`, `AlreadyEnrolledError` (pattern: `reorder-service.ts:58-72`, one class per
outcome, `.name` set).

**Boundary constraint (Pitfall 6, `tests/boundary.test.ts`)** — this file MUST import only
`@/server/db` types + pure helpers. NO `@/server/permissions`, NO `cohort-scope.ts`. It is on the
worker import closure via `hold-release-system-service.ts`. Same discipline as `scan-system-service.ts:31-35`
and the `queue.ts:5-9` header.

**`releaseSeat`** — `FOR UPDATE` → `seatsTaken = GREATEST("seatsTaken" - 1, 0)` (floor at 0, D-04) →
set enrolment status.

---

### `src/server/services/attendance-service.ts` (service, mark/correct + scoped bulk)

**Analogs:** `reorder-service.ts:301-356` (scoped bulk commit + `verifyArrangement` — the "derive the
set from the DB, never trust the caller's list" rule); `scan-system-service.ts:74-76` (`now`
injection for testable time boundaries).

**Bulk mark (D-10, ATT-01)** — the learner set is derived from `Enrolment where cohortId = <scoped
cohort>`, never from a caller-supplied learner-id list. This is exactly `reorder-service.ts:263-268`'s
`verifyArrangement(existingIds, input.arrangement)` discipline — reject any id not in the
DB-resolved set (`ArrangementMismatchError` analog).

**Scope** — `withPermission("attendance.manage", (input) => sessionCohortScope(input.sessionId))`
(same two-hop resolver as `session-service.ts`). An Instructor's COHORT grant only matches when
`resource.cohortId === grant.scopeId` (`scope.ts:66-68`, D-21).

**Marking-window boundary (D-06/D-08)** — `isWithinMarkingWindow` from `src/lib/attendance-window.ts`,
computed in UTC on stored `startsAt`/`endsAt` (Pitfall 4 — timezone is display-only). Inside window:
stamp `recordedById` + `recordedAt` + optional `note`. After window: require non-empty
`correctionReason`, stamp `correctedById` + `correctedAt` (fields exist, `schema.prisma:875-881`).

**Pre-marking (D-09)** — if `now < session.startsAt` and requested state is `PRESENT|ABSENT|LATE`,
throw a typed error. Only `EXCUSED|NOT_RECORDED` allowed pre-start (Pitfall 5).

**Every mark/correction** writes an `"attendance changed"` `DomainEvent` in the same `$transaction`
(D-20) and an `AuditEvent` with before/after + reason (ATT-03). Upsert keyed on
`@@unique([sessionId, enrolmentId])` (`schema.prisma:885`).

---

### `src/server/services/attendance-component.ts` (utility, pure compute)

**Analog:** `readiness-service.ts` (pure module, zero imports); `src/lib/positions.ts` (pure math lib).

Pure function: `AttendanceRecord[]` + `attendanceThresholdPct` → `{ earnedPct, requiredPct }`.
No data access. Unit-tested exhaustively like `tests/readiness.test.ts`. Compute-on-read (RESEARCH
Open Question 5) — also included in the `"attendance changed"` `DomainEvent` payload so Phase 9/11
consume it without recomputing.

---

### `src/server/services/domain-event-service.ts` (service, transactional outbox)

**Analog:** `audit-service.ts:79-102` — `buildAuditRow` is a pure row-shaping function, `recordAudit`
is the thin `prisma.<model>.create({ data: buildAuditRow(event) })` wrapper.

`writeDomainEvent(tx, event)` — takes the tx client (written IN the same `$transaction` as the
mutation — a bare enqueue is not atomic, `queue.ts:11-18`, `05-RESEARCH.md:407-408`). New
`model DomainEvent { id, type, payload Json, occurredAt, processedAt DateTime? }` — append-only,
same ethic as `audit-service.ts:6-8`. Phase 13 adds the drain job.

---

### `src/server/services/hold-release-system-service.ts` (WORKER-ONLY, unauthorized)

**Analog:** `src/server/services/scan-system-service.ts` — the whole file is the template.

Copy the structure exactly:
- Header comment "READ THIS BEFORE FIXING THE MISSING AUTHORIZATION CHECK" (`scan-system-service.ts:1-36`).
- Every exported fn suffixed `AsSystem` (`scan-system-service.ts:150-170`).
- No caller-supplied filter — the sweep resolves its own work set:
  `WHERE status = 'PENDING_PAYMENT' AND "holdExpiresAt" < now()` (mirrors
  `findStuckPendingAsSystem` / `scan-system-service.ts:118-128`, incl. the defensive re-filter).
- Still audits: `recordAudit({ actorId: null, actorType: "SYSTEM", action: "enrolment.hold_expired", … })`
  — `SYSTEM_ACTOR_TYPE` const at `scan-system-service.ts:45`; `buildAuditRow` defaults `actorType`
  to `"USER"` (`audit-service.ts:85`) so pass `"SYSTEM"` explicitly.
- DI factory + a bound `built` instance (`scan-system-service.ts:74,141-144`).
- Each expired enrolment processed in its OWN `$transaction` with `seatAccounting.releaseSeat(tx, …)`
  → idempotent, naturally convergent (D-03, `05-RESEARCH.md:361`).
- MUST NOT import `@/server/permissions` / `next/*` (`tests/boundary.test.ts`).

---

### `src/server/services/roster-service.ts` (service, scoped read + exceptions + CSV)

**Analog:** `programme-service.ts:258-385` — `listProgrammesForIndex` and `loadProgrammeComposition`
are authorized read helpers (`withPermission("….view", …)`) that add joined counts / nested lists
the factory `list`/`get` do not. `catalogue-guards.ts:122-158` shows the narrow `select` +
`_count` shape.

- `withPermission("cohorts.view", (id) => cohortResourceScope(id))` — an Instructor only sees rosters
  of assigned cohorts (D-21).
- **Deferred columns (D-18)** — model as a discriminated union in the row type
  (`{ kind: "deferred", phase: 9 }`), NOT `?? 0` or `|| "-"` (Pitfall 7). Render with the same visual
  treatment as `ReadinessPanel.tsx:50-57`'s `NOT_YET_CHECKED`.
- **Exceptions view (D-19)** — filterable categories: missing registers, at-risk, disputed/corrected.
- **Bounded synchronous CSV** — one cohort, values match the on-screen filters (filter/CSV parity is
  the testable contract). No async export infra (Phase 8).

---

### `src/server/services/cohort-scope.ts` (utility, async scope resolver)

**Analog:** `course-service.ts:19-21` (`courseScope`), `lesson-service.ts:193-199` (async parent-id
resolution), `scope.ts:40-44` (`ResourceScope` type), `scope.ts:62-76` (`grantMatches`).

```typescript
// resolves a cohortId to ALL THREE keys so a COURSE/PROGRAMME/COHORT grant can reach it
export async function cohortResourceScope(cohortId: string): Promise<ResourceScope> {
  const c = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: { id: true, programmeId: true, courseId: true,
              cohortCourses: { select: { courseId: true } } },
  });
  return {
    cohortId: c.id,
    ...(c.programmeId ? { programmeId: c.programmeId } : {}),
    courseIds: c.courseId ? [c.courseId] : c.cohortCourses.map((cc) => cc.courseId),
  };
}
```

`resource-service.ts:96-109` already accepts `toScope: (id) => ResourceScope | Promise<ResourceScope>`
(widened in Phase 4), so this drops straight into the factory config. Lives in its own file, imported
only by request-side services (NOT the worker closure).

---

### `src/lib/timezone.ts` (utility, pure)

**Analog:** `05-RESEARCH.md:505-536` (full `wallTimeToUtc` via `Intl.DateTimeFormat` `formatToParts`);
`src/lib/positions.ts` (pure-lib project ethic — hand-rolled, no dependency).

`isValidTimeZone(tz)` via `Intl.supportedValuesOf("timeZone").includes(tz)` (Node 22.14 — verified).
`wallTimeToUtc(parts, timeZone)` / `utcToWallParts(date, timeZone)`. Document the single-pass DST-gap
caveat (`Africa/Lagos` has no DST so not a today-problem). Unit-test round-trips for `Africa/Lagos`
+ one non-zero-offset zone + invalid-zone rejection. Do NOT use `Temporal` (unstable in Node 22).

---

### `src/lib/attendance-window.ts` (utility, pure)

**Analog:** `src/lib/positions.ts` (exported band constants + pure predicates).

```typescript
export const ATTENDANCE_MARKING_WINDOW_HOURS = 168; // D-06 — project constant, not a per-cohort field
export function isWithinMarkingWindow(session: { startsAt: Date; endsAt: Date }, now: Date): boolean {
  return now >= session.startsAt && now.getTime() <= session.endsAt.getTime() + 168 * 3_600_000;
}
```

All UTC math on stored `Date` values. NO `Intl` / timezone imports in this path (Pitfall 4). Unit-test
the exact boundaries (1s before start, 1s after `endsAt + 168h`).

---

### `src/server/jobs/queue.ts` (modify — queue registry)

**Analog:** `SCAN_QUEUE` / `RECONCILE_QUEUE` constants + `enqueueScan` in the same file
(`queue.ts:27-63`).

Add `export const HOLD_SWEEP_QUEUE = "enrolment.hold-sweep";`. The sweep is scheduled, not enqueued
per-row, so an `enqueue*` helper is optional. Keep the file free of `@/server/permissions`
(`queue.ts:5-9`). Verify pg-boss retry option names against `node_modules/pg-boss/dist/index.d.ts`
at implementation time (`queue.ts:18`).

---

### `worker/index.ts` (modify — worker bootstrap)

**Analog:** the `RECONCILE_QUEUE` block in the same file (`worker/index.ts:37,45-49`):

```typescript
await boss.createQueue(RECONCILE_QUEUE);
await boss.work(RECONCILE_QUEUE, async ([job]) => {
  if (!job) throw new Error("Reconciliation handler received no job.");
  await reconcileLessonResources();
});
await boss.schedule(RECONCILE_QUEUE, "*/5 * * * *");
```

Add the identical three lines for `HOLD_SWEEP_QUEUE` calling `releaseExpiredHolds()`. Update the
final `console.info` queue list (`worker/index.ts:51`).

---

### `worker/handlers/release-expired-holds.ts` (handler, DI factory)

**Analog:** `worker/handlers/reconcile-lesson-resources.ts` — the whole file (30 lines).

Copy the shape exactly: `createReleaseExpiredHoldsHandler(deps)` factory returning an async fn, a
bound `built` instance wired to `releaseExpiredHoldsAsSystem` + `console.info`, `export const
releaseExpiredHolds = built`. Deps injected so `tests/worker-handlers.test.ts` can drive it with
fakes.

---

### `prisma/schema.prisma` (modify)

**Analog:** existing `model Cohort` (`:726-792`), `model Enrolment` (`:893-927`).

Additive only (RESEARCH: `001_integrity.sql` constraints ARE already applied — Pitfall 1, do NOT
re-create the partial unique index / capacity CHECK / XOR CHECK / date CHECK):
- `Cohort.holdMinutes Int?` `@default(30)` (D-02 — `null`/`0` = no hold).
- `Enrolment.holdExpiresAt DateTime?` + `@@index([status, holdExpiresAt])` for a cheap sweep query.
- `Enrolment` transfer self-relation: `transferredFromId String?` + named relation
  (`transferredFrom Enrolment? @relation("EnrolmentTransfer", fields: [transferredFromId], references: [id])`
  / `transferredTo Enrolment[] @relation("EnrolmentTransfer")`) — Prisma self-relation idiom.
- `model DomainEvent { id String @id @default(cuid()); type String; payload Json; occurredAt DateTime @default(now()); processedAt DateTime?; @@index([processedAt]) }`.

---

### `prisma/sql/003_*.sql` + migration (only if a new CHECK is added)

**Analog:** `prisma/sql/002_catalogue_integrity.sql` — its header records the lesson: "the manual
paste-in cannot silently go unapplied the way `001_integrity.sql`'s did."

If Phase 5 adds any raw CHECK (e.g. `holdMinutes >= 0`): (1) paste it into the generated
`migration.sql`, (2) add `tests/schema-cohort.test.ts` asserting the constraint rejects a bad row
(pattern: `tests/schema-catalogue.test.ts` — reads `migration.sql`, regex-matches the constraint
name; see `:172-180`). The Testcontainers harness auto-applies un-pasted companions
(`tests/support/pg.ts:79-97`) so tests pass while production has no constraint — Pitfall 2.

---

### `prisma/seed.ts` (modify)

**Analog:** the existing cohort/session block (`prisma/seed.ts:292-408`) — `upsert` keyed on
`code` / compound unique, `daysFromNow` helper, `findFirst`-then-`create` idempotency for sessions.

Add demo `Enrolment` rows (mix of `ACTIVE` / `PENDING_PAYMENT` with `holdExpiresAt` / `WITHDRAWN`)
and `AttendanceRecord` rows so every Phase-5 screen has populated + exception states. Set
`holdMinutes: 30` on the seeded cohorts. `attendanceThresholdPct: 75` is already on the programme
cohort (`seed.ts:313`).

---

### `src/app/staff/cohorts/**` (routes + components)

| New file | Copy from | Notes |
|----------|-----------|-------|
| `cohorts/page.tsx` | `src/app/staff/courses/page.tsx` (whole file) | try/catch → `AuthenticationError` message, `AuthorizationError` → `<CohortsTable denied={…} />`, else rethrow |
| `cohorts/CohortsTable.tsx` | `src/app/staff/courses/CoursesTable.tsx` | `ResourceTable` config — `columns`, six states baked in (`ResourceTable.tsx:6-25`) |
| `cohorts/new/page.tsx` + form | `src/app/staff/programmes/new/page.tsx` + `ProgrammeForm.tsx` | `ResourceForm` primitive; cross-field "exactly one of course or programme" error goes in the summary (`ResourceForm.tsx:11-14`) |
| `cohorts/[id]/page.tsx` | `src/app/staff/courses/[id]/page.tsx` (whole file) | `DetailLayout` tabbed (overview / sessions / roster / exceptions / readiness); run `evaluateCohortReadiness` in the page, pass output to `<ReadinessPanel items={…} />` (`courses/[id]/page.tsx:61-62,223`); denial → `notFound()` (`:52-56`) |
| `cohorts/[id]/publish-actions.ts` | `src/app/staff/courses/[id]/publish-actions.ts` (whole file) | `zod.strict()` schema, `toFailure` discriminated union, `revalidatePath` for staff + (later) learner routes |
| `cohorts/actions.ts` | `src/app/staff/programmes/actions.ts` (whole file) | `useActionState`-shaped `(_prev, form) => Result`, `fields(form)` helper, `zodErrors`, `redirect` after create |
| `cohorts/[id]/roster/*` + attendance bulk-entry | `src/app/staff/courses/[id]/arrange/ArrangeClient.tsx` | "rearrange freely, commit once" — a per-learner state control + one "save all" (D-10 / specifics §3) |
| `enrolments/*` | `src/app/staff/courses/page.tsx` + `CoursesTable.tsx` | wire the NAV placeholder |
| `src/components/catalogue/CohortDetailActions.tsx` | `src/components/catalogue/CourseDetailActions.tsx` | publish button hidden when `!can(...)` (courtesy only — the action refuses regardless) |

### `src/app/staff/layout.tsx` (modify — nav)

**Analog:** the routed entries in the `NAV` array (`layout.tsx:18-29`). Change
`{ label: "Cohorts", href: null }` → `href: "/staff/cohorts"` and
`{ label: "Enrolments", href: null }` → `href: "/staff/enrolments"`. Routed vs placeholder rendering
is already branched (`layout.tsx:58-77`).

---

## Shared Patterns

### Authorization choke point
**Source:** `src/server/permissions/with-permission.ts` (`withPermission`, `AuthenticationError`
`:33`, `AuthorizationError` `:40`), `src/server/permissions/scope.ts` (`grantMatches` `:62-76`,
`ResourceScope` `:40-44`), `src/server/permissions` `can` helper.
**Apply to:** every service mutation + read in this phase EXCEPT `seat-accounting.ts`,
`hold-release-system-service.ts`, `domain-event-service.ts`, `attendance-component.ts`,
`src/lib/*` (all pure or worker-reachable).
**Rule:** never hand-write a scope check (`course-service.ts:5-7`). Scope is always resolved from the
DB row, never caller-asserted (`resource-service.ts:96-108`). COHORT scope becomes load-bearing this
phase via `cohort-scope.ts`.

```typescript
// scope.ts:62-72 — a cohort-scoped resource needs ALL THREE keys populated
export function grantMatches(grant: Grant, resource: ResourceScope): boolean {
  if (grant.scopeType === "GLOBAL") return true;
  if (!grant.scopeId) return false;
  switch (grant.scopeType) {
    case "COHORT":    return resource.cohortId === grant.scopeId;
    case "PROGRAMME": return resource.programmeId === grant.scopeId;
    case "COURSE":    return resource.courseIds?.includes(grant.scopeId) ?? false;
  }
}
```

### Audit-first writes
**Source:** `src/server/services/audit-service.ts` — `recordAudit` (`:100-102`), `buildAuditRow`
(`:79-98`, pure), `redactForAudit` (`:56-76`, sink-level), `actorType: "SYSTEM"` for worker rows
(`:82-85`).
**Apply to:** every Cohort / session / enrolment / attendance mutation (D-32).
**Rule:** actor / before / after / reason / outcome on every mutation. The resource-service factory
does this automatically (`resource-service.ts:215-223,236-245,283-292`); new surfaces (publish,
enrolment transitions, bulk attendance) call `recordAudit` explicitly, after commit, matching
`publish-service.ts:346-355`. Audit is append-only (`tests/audit-append-only.test.ts`).

### Reason capture (mandatory-reason actions)
**Source (server):** `publish-service.ts:276-280` `requireReason` (throws `ReasonRequiredError`).
**Source (client):** `src/components/primitives/ConfirmModal.tsx` — `minReasonLength`, live counter,
focus trap, ESC suppressed while pending, "Action not applied" on failure (`ConfirmModal.tsx:5-20`).
**Apply to:** transfer, withdraw, cancel, cancel-cohort (bulk), attendance correction after the
window, staff `add`/`approve` (D-11/D-12).

### `$transaction` + `FOR UPDATE` / raw SQL
**Source:** `src/server/services/reorder-service.ts:260-299` (interactive `$transaction(async (tx) => …)`
with `tx.$executeRaw` tagged templates); `reorder-service.ts:161-164` injected `ReorderDb` so the
service is unit-testable with a fake and integration-testable with real Postgres.
**Apply to:** `seat-accounting.ts`, `enrolment-service.ts`, `attendance-service.ts` bulk write,
`cohort-service.ts` cancel + publish.
**Rule:** the array form `$transaction([...])` is legacy; use the interactive form
(`05-RESEARCH.md:610-611`). Parameterised tagged templates only — never `$queryRawUnsafe`.

### Optimistic-concurrency token
**Source:** `reorder-service.ts:58-63` `StaleOrderError`, `reorder-service.ts:83-89`
`serialiseOrderToken`/`parseOrderToken` (millisecond precision — `toISOString()` truncates and
silently never matches, `:74-82`), conditional `updateMany({ where: { id, updatedAt: expected } })`
(`reorder-service.ts:235-239`, `publish-service.ts:383-387`).
**Apply to:** cohort publish, and any session edit that races attendance marking (Pattern 7).

### Worker import-closure isolation
**Source:** `scan-system-service.ts:31-35`, `queue.ts:5-9`, `tests/boundary.test.ts`.
**Apply to:** `hold-release-system-service.ts` → `seat-accounting.ts` → `@/server/db` only. None may
import `@/server/permissions`, `@/server/permissions/*`, `next/headers`, or anything importing
`getCurrentActor`. Run `npm test -- boundary` after wiring the worker.

### Named third state (deferred / not-yet-checked)
**Source:** `readiness-service.ts:14-20` (`NOT_YET_CHECKED`), `ReadinessPanel.tsx:50-57` (`•` glyph,
`text-zinc-500`, never `✓`/`✗`).
**Apply to:** cohort readiness `Catalogue`/`Completion` items where applicable, and the roster
Progress → "· Phase 9" / Assessment → "· Phase 10" / Completion → "· Phase 11" columns (D-18). Never
`?? 0`, never blank.

### Server Action → discriminated result
**Source:** `src/app/staff/courses/[id]/publish-actions.ts` — `zod` `.strict()` schema
(`:123-130`), `toFailure(error)` mapping typed service errors to `{ ok: false, reason: "…" }`
(`:68-108`), authz failure collapses to one generic line (`:100-106`), `revalidatePath` for staff +
dynamic public routes with the required `type` arg (`:110-117`).
**Apply to:** every `src/app/staff/cohorts/**` and `enrolments/**` action.

---

## No Analog Found

| File | Role | Data Flow | Reason / fallback |
|------|------|-----------|-------------------|
| `src/lib/timezone.ts` | utility (pure) | transform | No timezone/`Intl` code anywhere in the tree. Use the `Intl.DateTimeFormat` `formatToParts` implementation in `05-RESEARCH.md:505-536`; follow `src/lib/positions.ts` for the pure-lib file structure + exhaustive unit tests. |
| `src/server/services/domain-event-service.ts` (the `DomainEvent` outbox *concept*) | service | event-driven | No outbox / event table exists yet (`AuditEvent` is the closest but is not a work queue — RESEARCH Open Question 3). The *write mechanism* copies `audit-service.ts:79-102`; the table shape is a researcher recommendation the planner confirms. `pg-boss` `send` is NOT transactional here (Prisma 6.19.3, `queue.ts:11-18`) so a bare enqueue is not an option. |

---

## Metadata

**Analog search scope:** `src/server/services/`, `src/server/permissions/`, `src/server/jobs/`,
`worker/`, `src/components/primitives/`, `src/components/catalogue/`, `src/app/staff/`, `prisma/`,
`tests/support/`.
**Files read for extraction:** `course-service.ts`, `resource-service.ts`, `readiness-service.ts`,
`publish-service.ts`, `reorder-service.ts`, `scan-system-service.ts`, `audit-service.ts`,
`catalogue-guards.ts`, `programme-service.ts`, `lesson-service.ts` (partial),
`permissions/scope.ts`, `jobs/queue.ts`, `worker/index.ts`,
`worker/handlers/reconcile-lesson-resources.ts`, `tests/support/pg.ts`, `tests/support/harness.ts`,
`tests/reorder.integration.test.ts` (partial), `tests/schema-catalogue.test.ts`,
`components/primitives/{ConfirmModal,ResourceTable,DetailLayout,ResourceForm}.tsx`,
`components/catalogue/ReadinessPanel.tsx`, `app/staff/layout.tsx`,
`app/staff/courses/{page.tsx,[id]/page.tsx,[id]/publish-actions.ts}`,
`app/staff/programmes/actions.ts`, `prisma/schema.prisma` (enums + Cohort/session/enrolment/attendance
models), `prisma/sql/001_integrity.sql`, `prisma/seed.ts` (cohort block).
**Pattern extraction date:** 2026-09-03
