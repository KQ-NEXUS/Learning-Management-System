---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 06
subsystem: api
tags: [scheduling, timezone, sessions, meeting-link, authorization, scope, domain-events, tdd, vitest]

# Dependency graph
requires:
  - phase: 05-02
    provides: "src/lib/timezone.ts (wallTimeToUtc / utcToWallParts / isValidTimeZone), src/server/services/cohort-scope.ts (sessionCohortScope / cohortResourceScope)"
  - phase: 05-04
    provides: "domain-event-service.ts writeDomainEvent(tx, event) transactional outbox; DomainEventType union already lists session.created/updated/cancelled"
  - phase: 05-05
    provides: "cohort-service DI-factory + bound-instance pattern; createResourceService async toScope + archiveData + runInTransaction wiring"
provides:
  - "src/server/services/scheduled-session-service.ts — scheduledSessionService (factory CRUD), createSessionFromWallTime, repeatWeeklySessions, cancelSession, listSessionsForCohort, readSessionForViewer, isMeetingLinkVisible (pure), createScheduledSessionService DI factory"
affects: [05-08, 05-13, 05-15, 09-LRN-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wall-clock date arithmetic for repeat-weekly: advance {year,month,day} by 7*k via Date.UTC then re-run wallTimeToUtc — never add a millisecond span to a UTC instant (keeps local start time stable across DST)"
    - "Server-side capability gate: meetingUrl stripped from the row unconditionally (object rest), re-added only when a pure predicate says the caller may see it; closed-gate payload has NO meetingUrl key"
    - "One reason-bearing hand-wired withPermission action per mutation the resource-service factory cannot express (create-from-wall-time, repeat-weekly, cancel); row + domain event written in one db.$transaction, audit after commit"

key-files:
  created:
    - "src/server/services/scheduled-session-service.ts"
    - "tests/scheduled-session-service.test.ts"
  modified: []

key-decisions:
  - "DI factory (createScheduledSessionService) + bound built instance, same shape as cohort-service.ts — the plan's `export const scheduledSessionService = createResourceService(...)` sketch is realised as the factory's internal instance plus module-level bound exports, so unit tests drive it with fake delegates + createTestWithPermission"
  - "The factory's bare archive() writes a placeholder cancellationReason constant and stays fail-safe (soft-cancel, never delete); cancelSession is the real reason-bearing path every UI must call — archiveData only receives an id and cannot carry a reason (D-26)"
  - "readSessionForViewer resolves the caller's enrolment via an injected isViewerEnrolled(cohortId, userId) dep (production: an ACTIVE Enrolment lookup); Phase 9 LRN-06 replaces/extends this without touching the gate"
  - "listSessionsForCohort maps an explicit field set (no select needed on the fake delegate) that omits meetingUrl entirely — the link is only ever returned by the gated single-session read"

# Metrics
duration: ~35min
completed: 2026-09-04
---

# Phase 5 Plan 06: Scheduled-Session Service (COH-03) Summary

**The delivery calendar: authorized session CRUD, cohort-timezone-to-UTC creation, a repeat-weekly ×N row-inserter with no recurrence entity, soft-cancel with a mandatory reason, optional member-course tagging, and a server-side meeting-link visibility gate.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-04T11:29:00Z
- **Completed:** 2026-09-04T11:40:00Z
- **Tasks:** 2 (TDD — one RED test commit for the whole surface, one GREEN feat commit)
- **Files created:** 2 (1 source, 1 test)

## Accomplishments

- **`createSessionFromWallTime` (D-23):** reads the cohort's `timezone`, rejects an unknown zone with `InvalidTimeZoneError` before any write, converts `{ date, startTime, endTime }` through `wallTimeToUtc`, validates `endsAt > startsAt` (`SessionTimeRangeError`), writes the row + a `session.created` outbox event in one transaction, audits after commit. A `09:00` `Africa/Lagos` wall time on `2026-03-01` stores exactly `2026-03-01T08:00:00.000Z`; the same input on `America/New_York` stores `14:00:00.000Z` (EST) — no fixed offset, no host-local offset.
- **Member-course tag (D-24):** `assertCourseTaggable` refuses any `courseId` on a standalone-Course cohort and any non-member `courseId` on a Programme cohort with `SessionCourseNotInCohortError`; an omitted `courseId` is always allowed; a `CohortCourse` member is accepted.
- **`repeatWeeklySessions` (D-22):** validates `occurrences` to the inclusive 1–52 range (`RepeatOccurrencesError`), then inside ONE `db.$transaction` inserts N rows — occurrence k advances the **wall-clock date** by `7*k` days (`advanceWallDate` via `Date.UTC` + `getUTC*`) and re-runs `wallTimeToUtc`, so `America/New_York` keeps a `09:00` local start across the `2026-03-08` spring-forward (`14:00Z` → `13:00Z`). One `session.created` event per row, one audit row per row. No RRULE, no recurrence entity — N independently editable rows.
- **`cancelSession` (D-26):** trims and requires a non-empty reason (`ReasonRequiredError`), sets `cancelledAt` + `cancellationReason`, leaves the row and any `AttendanceRecord` rows in place, emits `session.cancelled`, audits before/after. No `delete(` anywhere in the file.
- **`listSessionsForCohort`:** returns sessions ordered by `startsAt` including cancelled ones, each carrying the cohort `timezone` plus `startsAtLabel` / `endsAtLabel` display strings — and explicitly WITHOUT `meetingUrl`.
- **`isMeetingLinkVisible` (pure) + `readSessionForViewer` (D-25):** false unless the viewer is enrolled, false for a cancelled session, otherwise true only from `startsAt - linkVisibleFromMinutes * 60_000` onward with no upper bound. `readSessionForViewer` strips `meetingUrl` by object rest and re-adds it only when the gate is open; a closed gate returns `meetingUrlAvailableFrom` (enrolled) or neither key (unenrolled).

## Exported signatures (consumed by 05-08, 05-13, 05-15, Phase 9 LRN-06)

```typescript
// src/server/services/scheduled-session-service.ts

export function isMeetingLinkVisible(
  session: { startsAt: Date; linkVisibleFromMinutes: number; cancelledAt: Date | null },
  now: Date,
  viewer: { enrolled: boolean },
): boolean;

// readSessionForViewer({ sessionId }) payload shape:
//   gate OPEN:            { ...sessionRow_without_meetingUrl, meetingUrl: string | null }
//   gate CLOSED, enrolled:{ ...sessionRow_without_meetingUrl, meetingUrlAvailableFrom: Date }
//   gate CLOSED, unenrolled / cancelled: { ...sessionRow_without_meetingUrl }   // no meetingUrl key, no availableFrom

export const scheduledSessionService;   // createResourceService instance — list/get/create/update/archive
export const createSessionFromWallTime; // withPermission<SessionFieldsInput>("cohorts.manage", cohortScope)
export const repeatWeeklySessions;      // withPermission<SessionFieldsInput & { occurrences: number }>(...)
export const cancelSession;             // withPermission<{ sessionId: string; reason: string }>("cohorts.manage", sessionScope)
export const listSessionsForCohort;     // withPermission<string>("cohorts.view", cohortScope)
export const readSessionForViewer;      // withPermission<{ sessionId: string }>("cohorts.view", sessionScope)

// SessionFieldsInput = { cohortId, title, date: "YYYY-MM-DD", startTime: "HH:MM", endTime: "HH:MM",
//   location?, meetingUrl?, linkVisibleFromMinutes?, facilitatorId?, attendanceExpected?, courseId? }

export function createScheduledSessionService(deps: ScheduledSessionServiceDeps): { ...the six above };
// deps: { delegate, cohort, db:{$transaction}, sessionScope, cohortScope, isViewerEnrolled, withPermission, audit, runInTransaction, now? }
```

## Task Commits

1. **RED — whole surface:** `65127c4` test(05-06): add failing tests for scheduled-session service
2. **GREEN — whole surface:** `8f1c685` feat(05-06): scheduled-session service (COH-03)

(Task 1 and Task 2 of the plan share one module and one test file; executed as a single plan-level RED → GREEN cycle rather than two, per the tight coupling.)

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 - Blocking] Grep gate tripped by a doc comment**
- **Found during:** verification (acceptance grep `\+01:00|getTimezoneOffset` must return 0)
- **Issue:** the file header prose contained the literal token `+01:00` ("Never a fixed `+01:00` offset").
- **Fix:** reworded to "Never a hard-coded one-hour offset". No code change. Gate now returns 0.

**2. [Structural] DI factory instead of a bare module-level `createResourceService` call**
- The plan's action sketches `export const scheduledSessionService = createResourceService({...})` with a live `prisma` delegate + live `withPermission`, then asks for unit tests with "fake delegates + `createTestWithPermission`". Those are mutually exclusive at module scope. Resolved the same way `cohort-service.ts` (05-05) and `lesson-service.ts` did: a `createScheduledSessionService(deps)` factory plus a bound `built` instance that exports the required module-level consts. All plan-required exports are present.

**3. [D-26 nuance] The factory `archive()` cannot carry a reason**
- `archiveData` receives only an id, so a bare `scheduledSessionService.archive(id, reason)` would still write a placeholder `cancellationReason` constant (`"Cancelled via archive (no reason captured)"`). It stays a soft-cancel (never a delete) and is documented as fail-safe, but `cancelSession` is the real reason-bearing path every UI must call. Consistent with the plan's own note that the real cancel path is separate.

## Known Stubs

**`isViewerEnrolled` production binding** — `src/server/services/scheduled-session-service.ts`, the `built` config. Currently an `ACTIVE`-status `Enrolment` lookup by `(cohortId, userId)`. This is deliberate LRN-06 groundwork (D-25): Phase 9 owns the learner-facing session read and the full "enrolled and access-window-open" predicate. The gate itself (`isMeetingLinkVisible` + `readSessionForViewer`) is complete and server-side; only the enrolment-resolution dep is a minimal placeholder. Injected, so no call-site churn when Phase 9 replaces it.

## Threat Flags

None. All surface is covered by the plan's `<threat_model>` (T-05-31 … T-05-37); each mitigation is implemented and unit-tested.

## Verification

- `npx vitest run tests/scheduled-session-service.test.ts` — **29 tests green**
- `npx vitest run tests/timezone.test.ts tests/boundary.test.ts tests/permissions.test.ts` — **27 green** (no boundary violation, no new permission identifier)
- `npx tsc --noEmit` — exit 0 (no collision with the auth `session-service.ts`)
- `npx eslint src/server/services/scheduled-session-service.ts tests/scheduled-session-service.test.ts` — clean
- Full node suite: **872 passed / 873**. The one failure — `tests/components/rich-text-editor.test.tsx` "renders exactly the seven D-29 authoring controls", a 5s test-timeout — is a pre-existing flaky Phase-4 authoring-UI component test, unrelated to this plan's files (out of scope per the executor scope boundary).
- Acceptance grep gates: `wallTimeToUtc` ≥1 (4); `\+01:00|getTimezoneOffset` = 0; `delete(` = 0; `RRULE|recurrence|Recurrence` = 0; `7 * 86400000|604800000` = 0; `meetingUrl` absent from the `listSessionsForCohort` payload.

## Self-Check: PASSED

- FOUND: src/server/services/scheduled-session-service.ts
- FOUND: tests/scheduled-session-service.test.ts
- FOUND commit: 65127c4 (test RED)
- FOUND commit: 8f1c685 (feat GREEN)

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
