---
phase: 05
slug: cohorts-scheduling-enrolment-operations-attendance
status: verified
threats_open: 0
threats_total: 113
threats_closed: 113
asvs_level: 1
block_on: high
created: 2026-09-07
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Audit type: **mitigation verification** (State B — register authored at plan time,
> 16 `<threat_model>` blocks, T-05-01 … T-05-113). No prior SECURITY.md.

**Verdict: SECURED** — 113/113 threats verified (111 `mitigate`, 2 `accept`), 0 open,
no high-severity threat open. Evidence taken from implementation code, DB migrations, and
executed test suites — not plan/summary prose.

Audit test runs:
- `tests/boundary.test.ts` + 12 Phase-5 unit suites — 288/288 pass
- `tests/schema-cohort.test.ts` (Testcontainers Postgres) — 21/21 pass
- `tests/components/{cohort-roster,attendance-mark,cohort-detail-actions,cohorts-table}.test.tsx` — 26/26 pass

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| application → database | App-held invariants vs. the DB as last line | Cohort/enrolment/attendance rows, CHECK-enforced invariants |
| developer shell → live database | `prisma migrate dev` can offer a destructive reset | Migration DDL, Phase-4 seed/publication data |
| concurrent requests → shared Cohort row | Two checkouts racing for the last seat | `seatsTaken` / `capacity` |
| request process ↔ worker process | Same seat primitive called from both; only one has a session | seat counts, enrolment status |
| staff browser → Server Action → service | Untrusted field values, offer target, publish token, reasons, learner id arrays | every cohort/session/enrolment/attendance field |
| scoped grant → out-of-scope cohort | A COHORT/PROGRAMME/COURSE grant must not reach a sibling cohort's roster/attendance | learner identity, attendance, transition history |
| stored UTC instant → displayed wall time | Conversion error changes which actions are permitted | session times, marking window |
| cohort → pinned catalogue publication | The pin is the learner's frozen obligation contract | publication payload, completion rule |
| application state change → downstream event consumers | An event lost after commit is an obligation nobody fulfils (Phase 13) | `DomainEvent` outbox rows |
| server CSV output → spreadsheet application | A CSV cell can become executable in Excel/Sheets | learner names, correction reasons |
| filter parameters → exported dataset | A filter on screen but not on export leaks rows | attendance-exception rows |
| worker process → database | The worker has no session, actor, or authorization context by design | expired-hold enrolments, seat counts |
| development environment → production build | A `next dev` pass is not a production pass | caching / dynamic-rendering behaviour |

---

## Threat Register

Full per-threat evidence (file:line, grep result, test name) is in the
**Verified Threats — by area** section below. Summary:

| Area | Threat IDs | Disposition | Status |
|------|-----------|-------------|--------|
| Schema & DB constraints (05-01) | T-05-01 … T-05-05 | mitigate | closed |
| Pure building blocks (05-02, 05-03) | T-05-06 … T-05-15 | mitigate (T-05-15 accept) | closed |
| Seat accounting & outbox (05-04) | T-05-16 … T-05-22 | mitigate | closed |
| Cohort service — CRUD / publish / cancel (05-05, 05-11) | T-05-23 … T-05-30, T-05-68 … T-05-75 | mitigate | closed |
| Scheduled sessions (05-06) | T-05-31 … T-05-37 | mitigate | closed |
| Enrolment state machine (05-07) | T-05-38 … T-05-46 | mitigate | closed |
| Attendance service (05-08) | T-05-47 … T-05-54 | mitigate | closed |
| Hold-release worker (05-09) | T-05-55 … T-05-60 | mitigate | closed |
| Roster & CSV (05-10) | T-05-61 … T-05-67 | mitigate | closed |
| Cohorts index & form (05-12) | T-05-76 … T-05-82 | mitigate | closed |
| Sessions tab & attendance screen (05-13) | T-05-83 … T-05-90 | mitigate | closed |
| Roster/exceptions UI, CSV route, global list (05-14) | T-05-91 … T-05-98 | mitigate | closed |
| Cohort detail assembly (05-15) | T-05-99 … T-05-106 | mitigate (T-05-106 accept) | closed |
| Phase close / human verification (05-16) | T-05-107 … T-05-113 | mitigate | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-15 | Readiness `detail` strings name only the cohort's own fields (capacity, seat count, delivery mode, price); the caller already holds `cohorts.view` on that cohort. No cross-scope disclosure. | plan-time threat model (05-03) | 2026-09-07 |
| AR-05-02 | T-05-106 | The three new routes (`/staff/cohorts/[id]/edit`, `…/sessions/[sessionId]/attendance`, `/staff/enrolments`) all exist by wave 5 and each performs its own `withPermission`-gated authorization; `staff/layout.tsx` nav is presentation only. | plan-time threat model (05-15) | 2026-09-07 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags (WARNING — not blockers)

| Flag | File | Description |
|------|------|-------------|
| new-write-surface | `src/server/services/cohort-service.ts` | **Instructor assignment CRUD** (`assignCohortInstructor` / `removeCohortInstructor` / `loadCohortInstructor(s)`, plus `instructor-actions.ts`, `InstructorsPanel.tsx`) was added in plan 05-16 to give the readiness "Instructors" gate a writer. Not in any `<threat_model>` block. Assessment: gated `withPermission("cohorts.manage", cohortResourceScope)` (same pattern as every other cohort op), audited (`cohort.instructor_assigned` / `_removed`), idempotent, P2002/P2025 concurrency races guarded (`cohort-service.ts:588-653`). It adds a `deps.instructor.delete(...)` on the `CohortInstructor` join row — this **trips the literal `no delete(` grep gates cited for T-05-30 and T-05-72**, but the threat those gates protect (destroying learner enrolment / cohort / session / attendance history) is not affected: the delete is a reversible, audited join-table row only. **Recommendation:** add an explicit threat-register entry for instructor assignment in a future phase and narrow the T-05-30 / T-05-72 grep gates to the Cohort / Enrolment / ScheduledSession / AttendanceRecord delegates. |
| new-read-surface | `src/server/services/roster-service.ts` | `loadStaffEnrolments` (plan 05-14) — new GLOBAL-only authorized cross-cohort read. Self-flagged in 05-14-SUMMARY. Implements T-05-95's mitigation with the same deny-by-default mechanism `resource-service.ts`'s unscoped `list` uses. Informational only. |

## Follow-ups (documented, non-blocking — track into Phase 9)

1. **T-05-107 / T-05-108 live re-verification.** The 05-16 human pass could not fully exercise (a) the learner-facing meeting-link window (no LRN-06 route until Phase 9) or (b) a cohort-scoped-only staff denial via direct URL (seeded `instructor@kqnexus.test` carries a GLOBAL role). Both mitigations are present in code and proven by real-Postgres integration tests; add the live click-through re-check to the Phase 9 validation checklist and create a genuinely cohort-scoped staff test account.
2. **`attendance_correction_has_reason` NULL semantics.** Per 05-08-SUMMARY: the CHECK's second branch evaluates to SQL `NULL` (not `FALSE`) for `correctionReason: null`, so the DB only hard-rejects an empty string, not a NULL. The service-level `CorrectionReasonRequiredError` is the real guard (rejects null + blank). Worth tightening the CHECK if 05-01's constraint is ever revisited.

---

## Verified Threats — by area

### Schema & DB constraints (05-01) — T-05-01 … T-05-05

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-01 | mitigate | 4 CHECKs pasted verbatim into `prisma/migrations/20260904092220_cohort_operations/migration.sql:39-62`; `tests/schema-cohort.test.ts` asserts each name in an applied migration + rejects bad rows (21/21 green vs real PG) |
| T-05-02 | mitigate | `enrolment_hold_expiry_only_when_pending` CHECK (`migration.sql:51-53`); `releaseSeat` / `applyEnrolmentExit` always write `holdExpiresAt: null` on exit (`seat-accounting.ts:351`, `enrolment-service.ts:274`) |
| T-05-03 | mitigate | `attendance_correction_has_reason` CHECK with `length(btrim(...)) > 0` (`migration.sql:57-62`) |
| T-05-04 | mitigate | Migration generated `--create-only` then applied; `prisma migrate status` reports no drift (verified this audit) |
| T-05-05 | mitigate | `prisma/sql/003_cohort_operations.sql:13-16` explicitly lists the 4 init constraints as NOT re-created; no redeclaration present |

### Pure building blocks (05-02, 05-03) — T-05-06 … T-05-15

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-06 | mitigate | `cohort-scope.ts` resolvers take only an id; every signature reads the row (lines 84-128); no `programmeId` / `courseId` parameter anywhere; `tests/cohort-scope.test.ts` |
| T-05-07 | mitigate | `cohortResourceScope` populates `cohortId` + `programmeId` + `courseIds` for an existing row (`cohort-scope.ts:99-105`); composition test proves a COURSE grant reaches a Programme cohort |
| T-05-08 | mitigate | Missing row → `return {}` (`cohort-scope.ts:96,113,120`); deny-by-default asserted in test |
| T-05-09 | mitigate | `src/lib/attendance-window.ts` — zero imports, no `Intl`, UTC `getTime()` arithmetic only; four boundary instants pinned in `tests/attendance-window.test.ts` |
| T-05-10 | mitigate | `attendance-component.ts` zero imports; `cohort-scope.ts` not in the worker closure; `tests/boundary.test.ts` worker-closure assertion passes |
| T-05-11 | mitigate | `evaluateCohortReadiness` catalogue item FAILs unless `pin.publicationId != null && pin.targetStatus === "PUBLISHED"` (`readiness-service.ts:300-301`); `tests/cohort-readiness.test.ts` |
| T-05-12 | mitigate | capacity item FAILs when `capacity < seatsTaken` (`readiness-service.ts:368`), `blocking: true` |
| T-05-13 | mitigate | No `NOT_YET_CHECKED` / `deferredTo` in the cohort evaluator (`readiness-service.ts:294-436`); `tests/readiness.test.ts` asserts the retired Course stubs are absent |
| T-05-14 | mitigate | `readiness-service.ts` pure (zero imports); `cohort-service.publishCohort` calls `blockingFailures(evaluateCohortReadiness(...))` (`cohort-service.ts:683`); `publish-actions.ts` has zero `evaluateCohortReadiness` calls |
| T-05-15 | **accept** | AR-05-01 — `detail` strings name only the cohort's own fields; caller already holds `cohorts.view` |

### Seat accounting & outbox (05-04) — T-05-16 … T-05-22

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-16 | mitigate | `SELECT ... FOR UPDATE` on the Cohort row inside the tx (`seat-accounting.ts:134-136`), refusal before insert (`takeSeat:251-254`); `tests/seat-accounting.integration.test.ts` asserts the CHECK never fires |
| T-05-17 | mitigate | P2002 → `AlreadyEnrolledError` (`seat-accounting.ts:262-268`); no application pre-check |
| T-05-18 | mitigate | Only tagged-template `$queryRaw` / `$executeRaw` (`seat-accounting.ts:134,333,357`); no `*RawUnsafe` in file |
| T-05-19 | mitigate | `seat-accounting.ts` imports no permissions / next module; `tests/boundary.test.ts` worker-closure assertion green; worker path audits `actorType: "SYSTEM"` |
| T-05-20 | mitigate | `GREATEST("seatsTaken" - 1, 0)` in SQL under the lock (`seat-accounting.ts:357-361`), never read-then-write |
| T-05-21 | mitigate | `writeDomainEvent(tx, ...)` takes tx, never opens its own transaction (`domain-event-service.ts:88-93`) |
| T-05-22 | mitigate | `buildDomainEventRow` routes payload through `redactForAudit` at the sink (`domain-event-service.ts:77`) |

### Cohort service — CRUD, publish, cancel (05-05, 05-11) — T-05-23 … T-05-30, T-05-68 … T-05-75

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-23 | mitigate | Every op gated via `createResourceService` permissions + `toScope: cohortResourceScope`; `updateCohort` / `publishCohort` / `cancelCohort` use `withPermission(..., (i) => deps.toScope(i.cohortId))` (`cohort-service.ts:477-483,500,671,753`) |
| T-05-24 | mitigate | `publishCohort` gated `"cohorts.publish"` (`cohort-service.ts:671`) — single occurrence; `tests/cohort-service.test.ts` denial for manage-only |
| T-05-25 | mitigate | `assertOfferMutable` counts `enrolment.count({ where: { cohortId } })` — no status filter (`cohort-service.ts:120-126`); tested for WITHDRAWN row |
| T-05-26 | mitigate | `NoPublishedOfferError` thrown before readiness (`cohort-service.ts:679`) + blocking catalogue item; pin written inside the publish `$transaction` (`cohort-service.ts:692-704`) |
| T-05-27 | mitigate | Conditional `cohort.updateMany({ where: { id, updatedAt: expectedUpdatedAt, ... } })` → `StaleOrderError` on `count === 0` (`cohort-service.ts:693-705`) |
| T-05-28 | mitigate | `AuthorizationError` from the choke point unmodified; `actions.ts:170` collapses to one generic `DENIED` line |
| T-05-29 | mitigate | `recordAudit` after commit with before/after status + `cohort.published` outbox row inside the tx (`cohort-service.ts:707-727`) |
| T-05-30 | mitigate (see flag) | `archiveData: () => ({ status: "CANCELLED" })` (`cohort-service.ts:486`); no `delete` on Cohort / Enrolment / Session. NB: a `deps.instructor.delete` for the `CohortInstructor` join row was added in 05-16 — see Unregistered Flags |
| T-05-68 | mitigate | `cancelCohort` gated `"cohorts.manage"` + `cohortResourceScope` (`cohort-service.ts:753`); `requireCancelReason` enforces ≥10 trimmed chars (`cohort-service.ts:202-210`) |
| T-05-69 | mitigate | Per-enrolment + per-session + per-cohort audit rows in a loop after commit (`cohort-service.ts:821-854`); `tests/cohort-cancel.integration.test.ts` case 2 |
| T-05-70 | mitigate | All withdrawals + session cancels + status write in one `deps.db.$transaction` (`cohort-service.ts:765-817`); integration case 4 |
| T-05-71 | mitigate | `cancelCohort` imports & calls `applyEnrolmentExit` from `enrolment-service.ts` (`cohort-service.ts:49,784`); no `VALID_TRANSITIONS` / `assertTransition` in `cohort-service.ts` (grep confirmed) |
| T-05-72 | mitigate (see flag) | Soft-cancel only for enrolments / sessions / cohort; integration case 1 unchanged row counts, case 6 attendance survives. Same instructor-join `delete` caveat as T-05-30 |
| T-05-73 | mitigate | Conditional `updateMany` with `updatedAt` → `StaleOrderError` (`cohort-service.ts:805-809`) |
| T-05-74 | mitigate | Seed emails `@kqnexus.test`; `prisma/seed.ts` idempotent, invoked via `npm run db:seed` |
| T-05-75 | mitigate | `seed.ts` recomputes `seatsTaken` from a live seat-holder `COUNT` each run |

### Scheduled sessions (05-06) — T-05-31 … T-05-37

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-31 | mitigate | `readSessionForViewer` strips `meetingUrl` by object-rest, re-adds only when `isMeetingLinkVisible` true (`scheduled-session-service.ts:614-635`); `listSessionsForCohort` returns an explicit field set without `meetingUrl` (reads `r.meetingUrl` only to derive a `hasMeetingLink` boolean, line 606); `tests/scheduled-session-service.test.ts` boundary instants |
| T-05-32 | mitigate | `createSessionFromWallTime` / `repeatWeeklySessions` / `cancelSession` all `withPermission("cohorts.manage", sessionScope\|cohortScope)` (lines 409,455,521) |
| T-05-33 | mitigate | `assertCourseTaggable` → `SessionCourseNotInCohortError` against cohort `courseId` / `CohortCourse` members (`scheduled-session-service.ts:362-380`) |
| T-05-34 | mitigate | `toUtcRange` converts via `parseCohortDateTime(dateTime, cohort.timezone)` (`scheduled-session-service.ts:200-219`); `src/lib/cohort-datetime.ts` uses the cohort zone with DST sampling, no fixed offset, no `getTimezoneOffset`. NB: implementation uses `parseCohortDateTime` rather than the plan-named `wallTimeToUtc` — an equivalent (stronger DST-safe) helper |
| T-05-35 | mitigate | `cancelSession` requires a trimmed reason (`ReasonRequiredError`), sets `cancelledAt` / `cancellationReason`, leaves rows; no `delete(` in file |
| T-05-36 | mitigate | `occurrences` validated to inclusive 1–52 before the tx (`scheduled-session-service.ts:460-466`) |
| T-05-37 | mitigate | All N `create`s in one `db.$transaction` (`scheduled-session-service.ts:477-499`) |

### Enrolment state machine (05-07) — T-05-38 … T-05-46

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-38 | mitigate | Explicit `VALID_TRANSITIONS` table with empty terminal allow-lists (`enrolment-service.ts:84-94`); `assertTransition` before every write (lines 260,421,591); unit + integration |
| T-05-39 | mitigate | All five actions `withPermission("enrolments.manage", enrolmentScope\|cohortScope)` (lines 330,411,491,544) |
| T-05-40 | mitigate | `transferEnrolment` authorizes BOTH source and target (`cohortScope`, lines 544-549) + same-offer check → `CrossOfferTransferError` (lines 572-583) |
| T-05-41 | mitigate | `approveEnrolment` consults `holdsSeat(e)` before `claimSeat` (`enrolment-service.ts:426-431`); integration case 5/6 |
| T-05-42 | mitigate | No `findFirst` on status ACTIVE (grep confirmed); P2002 → `AlreadyEnrolledError` is the only guard |
| T-05-43 | mitigate | `requireReason` on all five (lines 332,413,494,550); `recordAudit` after commit before/after; `tests/audit-append-only.test.ts` |
| T-05-44 | mitigate | `writeDomainEvent` inside the same `$transaction` as the status write (all five paths); integration asserts one row per action |
| T-05-45 | mitigate | Header states PRD §15.3(4); no `refund` / `credit` write in file (only header prose — grep confirmed) |
| T-05-46 | mitigate | `transferEnrolment` release + take in ONE `$transaction` (`enrolment-service.ts:585-630`); full-target `takeSeat` throws and rolls back — integration atomicity case |

### Attendance service (05-08) — T-05-47 … T-05-54

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-47 | mitigate | `saveSessionAttendance` derives roster from `enrolment.findMany({ where: { cohortId: session.cohortId } })`; every submitted id validated + duplicates rejected BEFORE the tx (`attendance-service.ts:501-521`); integration "writes zero rows" |
| T-05-48 | mitigate | `withPermission("attendance.manage", sessionCohortScope)` (`attendance-service.ts:430,494`); `createPrismaBackedAttendanceService` binds its own scope resolvers to the injected client; integration asserts sibling-cohort denial with `AuthorizationError` (not filtered) |
| T-05-49 | mitigate | `CorrectionReasonRequiredError` in `assertMarkAllowed` (line 300); `correctedById` / `correctedAt` / `correctionReason` stamped without touching `recordedBy*` (lines 368-370); DB CHECK backstop; integration case 7 |
| T-05-50 | mitigate | `LIVE_STATES` (PRESENT/ABSENT/LATE) rejected when `timing.beforeStart` (`attendance-service.ts:297-299`) |
| T-05-51 | mitigate | `timingFor` uses only `isBeforeSessionStart` / `isWithinMarkingWindow` (pure UTC); no `Intl` / timezone import on the path |
| T-05-52 | mitigate | `writeOneRecord` emits exactly one `attendance.changed` per changed record inside the tx (`attendance-service.ts:380-392`) |
| T-05-53 | mitigate | `upsert` keyed on `sessionId_enrolmentId` (`attendance-service.ts:372-376`) |
| T-05-54 | mitigate | `loadSessionRegister` gated `"attendance.view"` + `sessionCohortScope`, filtered by `session.cohortId` (`attendance-service.ts:597-612`) |

### Hold-release worker (05-09) — T-05-55 … T-05-60

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-55 | mitigate | `releaseExpiredHoldsAsSystem` — `AsSystem` suffix, no caller filter, work set resolved internally from `status` + `holdExpiresAt`, audits `actorId: null` / `actorType: "SYSTEM"` (`hold-release-system-service.ts:127-199`) |
| T-05-56 | mitigate | File imports only `@/server/db`, `audit-service`, `seat-accounting`, `domain-event-service` (lines 53-63); `tests/boundary.test.ts` worker-closure assertion green (verified this audit) |
| T-05-57 | mitigate | Work-set predicate + defensive re-filter both require non-null `holdExpiresAt < cutoff` (`hold-release-system-service.ts:131-149`); `releaseSeat` floors at 0; integration case 3 |
| T-05-58 | mitigate | Convergent work set re-read each run; per-row `runInTransaction` + `FOR UPDATE` inside `releaseSeat`; integration case 5 zero-effect second run |
| T-05-59 | mitigate | `boss.createQueue(HOLD_SWEEP_QUEUE, { retryLimit: 3, retryBackoff: true })` (`worker/index.ts:42-45`); `DEFAULT_BATCH_LIMIT = 200`; per-row failures caught / counted (`hold-release-system-service.ts:188-196`) |
| T-05-60 | mitigate | `actorType: "SYSTEM"`, action `"enrolment.hold_expired"`, reason `"hold expired"` (`hold-release-system-service.ts:175-185`); integration case 7 |

### Roster & CSV (05-10) — T-05-61 … T-05-67

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-61 | mitigate | `loadCohortRoster` / `loadAttendanceExceptions` gated `withPermission("<perm>.view", cohortResourceScope)` (`roster-service.ts:614,687`); `tests/roster-service.test.ts` asserts `AuthorizationError` not `[]` |
| T-05-62 | mitigate | Choke-point `AuthorizationError` unmodified; no denial→filtered path in the service |
| T-05-63 | mitigate | `exceptionsToCsv(rows)` pure, no query, one line per supplied row (`roster-service.ts:475-481`); parity test |
| T-05-64 | mitigate | `escapeCsvCell` prefixes leading `= + - @` with `'` and RFC-4180 quotes comma / quote / newline (`roster-service.ts:438-443`); unit-tested |
| T-05-65 | mitigate | `loadAttendanceExceptions` throws `MissingCohortIdError` on empty id, bounded to one cohort (`roster-service.ts:691`) |
| T-05-66 | mitigate | `progress` / `assessment` / `completion` typed `DeferredColumn` only (`roster-service.ts:55,91-93`); no `?? 0` (grep `RosterTab.tsx` = 0); `tests/components/cohort-roster.test.tsx` |
| T-05-67 | mitigate | Transition history read from `auditEvent.findMany({ where: { targetType: "Enrolment" } })` (`roster-service.ts:624`); no `EnrolmentTransition` model in `schema.prisma` |

### Cohorts index & form (05-12) — T-05-76 … T-05-82

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-76 | mitigate | `createCohortAction` / `updateCohortAction` delegate to `cohortService.create` / `updateCohort` (`cohorts/actions.ts:208,241`), both `withPermission`-gated on `cohorts.manage` with DB scope |
| T-05-77 | mitigate | `baseSchema`: `capacity` int ≥1, `priceMinor` int ≥0, `timezone` `.refine(isValidTimeZone)`, dates coerced + ordered via `superRefine` (`cohorts/actions.ts:44-103`); no `parseFloat` / `toFixed` |
| T-05-78 | mitigate | `superRefine` XOR on courseId / programmeId (`actions.ts:80-88`); `cohort_targets_exactly_one_offer` DB CHECK is the backstop |
| T-05-79 | mitigate | `updateCohort` calls `assertOfferMutable` when the offer differs (`cohort-service.ts:508-516`); `OfferLockedError` mapped to UI copy (`actions.ts:152-159`) |
| T-05-80 | mitigate | `AuthorizationError` / `AuthenticationError` → one generic line (`actions.ts:170-176`); component test asserts no code / count in denied output |
| T-05-81 | mitigate | `StaleOrderError` mapped (`actions.ts:161`); `updateCohort` performs `deps.delegate.update({ where: { id, updatedAt: expectedUpdatedAt } })` + P2025→`StaleOrderError` (`cohort-service.ts:520-530`) |
| T-05-82 | mitigate | No `@prisma/client` / `@/server/db` import in any Phase-5 route / component (grep over `src/app/staff` = 0 Phase-5 hits); `tests/boundary.test.ts` green |

### Sessions tab & attendance screen (05-13) — T-05-83 … T-05-90

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-83 | mitigate | `saveAttendanceAction` does no roster resolution, delegates to `saveSessionAttendance`; `cohortId` in schema used only for `revalidatePath` (`attendance-actions.ts:92-122`); no timing / roster logic in file |
| T-05-84 | mitigate | `PreMarkingStateError` raised server-side in the service; action maps it to copy (`attendance-actions.ts:47-54`) |
| T-05-85 | mitigate | `correctAttendanceAction` requires `reason` min 10 (`attendance-actions.ts:135`), delegates to `markAttendance` which enforces the reason regardless of entry path; DB CHECK backs it |
| T-05-86 | mitigate | `grep meetingUrl src/app/staff/cohorts/[id]/SessionsTab.tsx` = 0; `listSessionsForCohort` omits the field |
| T-05-87 | mitigate | `LearnerNotOnRosterError` → generic "This register changed. Reload and try again." with no id (`attendance-actions.ts:58-62`) |
| T-05-88 | mitigate | Every action delegates to a `withPermission`-gated service (`attendance.manage` / `cohorts.manage`) with DB-resolved session scope |
| T-05-89 | mitigate | Actions submit date / time strings; conversion server-side with the cohort timezone (`session-actions.ts` header + `scheduled-session-service.toUtcRange`) |
| T-05-90 | mitigate | `repeatWeeklySchema.occurrences` bounded 1–52 (`session-actions.ts:117-126`) AND in `repeatWeeklySessions` (`scheduled-session-service.ts:460-466`) |

### Roster/exceptions UI, CSV route, global enrolments (05-14) — T-05-91 … T-05-98

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-91 | mitigate | `exceptions/csv/route.ts` calls the same `loadAttendanceExceptions({ cohortId, categories, search })` once + `exceptionsToCsv` once; no `.filter` / `.slice` in file (grep = 0) |
| T-05-92 | mitigate | `Cache-Control: no-store` on both the 200 and the 403 response (`route.ts:60,67`) |
| T-05-93 | mitigate | Generic 403 body; `filename` built only inside the try, after auth succeeds (`route.ts:49-62`) |
| T-05-94 | mitigate | Route does no string assembly; escaping lives in `exceptionsToCsv` (05-10), unit-tested |
| T-05-95 | mitigate | `loadStaffEnrolments` gated `withPermission("enrolments.view", () => ({}))` — empty scope, GLOBAL-only via `grantMatches` (`roster-service.ts:551-554`) |
| T-05-96 | mitigate | `RosterRowView` deferred columns are `DeferredColumn` only; grep `?? 0 \| \|\| 0 \| \|\| "-" \| as unknown as number` `RosterTab.tsx` = 0; `tests/components/cohort-roster.test.tsx` asserts no `0%` |
| T-05-97 | mitigate | All 5 enrolment actions use `reasonSchema` (min 10) and delegate to the service's `assertTransition` (`enrolment-actions.ts:112-116`); failure renders as "Action not applied" |
| T-05-98 | mitigate | Roster Learner cell is plain text — no learner-detail route exists, so no cross-cohort aggregation is rendered (05-14 key-decisions; `cohort-roster.test.tsx`) |

### Cohort detail assembly (05-15) — T-05-99 … T-05-106

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-99 | mitigate | `publishCohortAction` → `publishCohort` (runs `blockingFailures(evaluateCohortReadiness(...))` server-side); `grep evaluateCohortReadiness publish-actions.ts` = 0; dialog disable is documented courtesy echo (`CohortDetailActions.tsx:236-239`) |
| T-05-100 | mitigate | Services gated `cohorts.publish` / `cohorts.manage` with DB scope; hidden buttons courtesy only (`CohortDetailActions.tsx:136,145,158`) |
| T-05-101 | mitigate | `page.tsx:96-98` — `AuthorizationError` → `notFound()`, identical to a missing cohort |
| T-05-102 | mitigate | `expectedUpdatedAt` carried as ISO string, parsed with full precision (`publish-actions.ts:136-139`); service does conditional `updateMany` |
| T-05-103 | mitigate | `page.tsx:106` — exactly one `evaluateCohortReadiness` call feeds both `ReadinessPanel` and `CohortDetailActions`; none in the action; service re-evaluates for the gate |
| T-05-104 | mitigate | `ConfirmModal tone="danger" minReasonLength={10}` with description stating `activeEnrolmentCount` (`CohortDetailActions.tsx:182-200`); `tests/components/cohort-detail-actions.test.tsx` |
| T-05-105 | mitigate | Each tab loaded in its own try / catch, mapped to `DetailSection.error` on `AuthorizationError` (`page.tsx:111-216,334-355`) |
| T-05-106 | **accept** | AR-05-02 — all three new routes exist by wave 5 and self-authorize; nav is presentation only |

### Phase close / human verification (05-16) — T-05-107 … T-05-113

| ID | Disposition | Evidence |
|----|-------------|----------|
| T-05-107 | mitigate | Code gate present & unit-tested: `listSessionsForCohort` omits `meetingUrl`, `readSessionForViewer` boundary-instant tests, `SessionsTab` grep = 0. Live learner-view re-check deferred to Phase 9 (LRN-06) — no learner-facing route exists yet, so no live leak surface. See Follow-up 1 |
| T-05-108 | mitigate | `tests/attendance-service.integration.test.ts` asserts a COHORT-scoped grant on a sibling cohort is DENIED with `AuthorizationError` (real Postgres, not filtered); `cohort-scope.test.ts` deny-by-default. Live denial with a genuinely cohort-scoped staff account not re-run in 05-16 (seeded `instructor@` has a GLOBAL role) — see Follow-up 1 |
| T-05-109 | mitigate | 05-16 checkpoint step 5 verified live: 4 separate per-enrolment audit rows (not batched) + 1 `cohort.cancelled` + 4 `session.cancelled` |
| T-05-110 | mitigate | 05-16 step 6 verified live: worker log `released 1 expired seat holds`, enrolment Cancelled / reason "hold expired" / SYSTEM actor. Deploy note: worker service must run |
| T-05-111 | mitigate | 05-16 step 7 verified live: on-screen count == CSV row count for unfiltered (6/6) and filtered (3/3) |
| T-05-112 | mitigate | 05-16 Task 1: `npm run build` + `npm run docker:up` production stack run pass; worker `queues ready` line confirmed |
| T-05-113 | mitigate | 05-16 summary "Decision required before Phase 9" (self-paced access-duration) + "Other deferred items" list recorded |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-07 | 113 | 113 | 0 | gsd-security-auditor (mitigation-verification, State B) |

---

## Sign-Off

- [x] All threats have a disposition (111 mitigate / 2 accept / 0 transfer)
- [x] Accepted risks documented in Accepted Risks Log (AR-05-01, AR-05-02)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter
- [ ] Unregistered instructor-assignment write surface added to a future threat register
- [ ] Follow-ups 1–2 tracked into Phase 9 validation

**Approval:** verified 2026-09-07
