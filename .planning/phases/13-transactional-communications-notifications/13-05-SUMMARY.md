---
phase: 13-transactional-communications-notifications
plan: 05
subsystem: notifications
tags: [notifications, authorization, security, cron, netlify-scheduled-functions, prisma, postgres, vitest]

requires:
  - phase: 13-01
    provides: Notification model, NOTIFICATION_TARGET_TYPES/NotificationType vocabulary in src/server/communications/contracts.ts
  - phase: 13-03
    provides: notificationService (unreadCount/list/markRead/markAllRead), notifications server actions file
provides:
  - "src/server/communications/links.ts — pure, validated relative-path builders for all ten notification target types plus notificationHref"
  - "createNotificationAccessService/notificationAccessService.resolveOpen — re-checks the destination's own access rule server-side for all ten targets and returns one indistinguishable unavailable outcome on any denial"
  - "openNotificationAction — the server action the drawer calls to open a notification safely"
  - "notificationService.archiveReadOlderThan — bounded, id-subset archive-only update"
  - "cleanup-notifications-task.ts / netlify/functions/cleanup-notifications.ts — daily scheduled 90-day archive job, mirroring release-expired-holds-task.ts exactly"
affects: [13-06 bell/drawer UI (calls openNotificationAction), any future phase adding an eleventh notification target type]

actuals:
  tokens: 17900
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Every notification link is rebuilt fresh at open time from (targetType, targetId, params) through one pure, throw-on-hostile-segment module — never read from a stored URL (T-13-62)"
    - "resolveOpen's ownership lookup (recipientId equal to caller) IS the T-13-61 gate; a per-target resolver map (Partial<Record<NotificationTargetType, resolver>>) decides only whether the row's own target is still accessible, and any resolver throw is treated identically to an explicit false"
    - "A resolver reuses the destination page's own exported call directly wherever that call already accepts an explicit Actor (getOwnOrderByReference, loadLearnerPath) or is itself the exact withPermission-wrapped gate the page renders behind (getStaffTicketWorkspace, getPaymentDetailForStaff, getGradingDetail, can) — structurally closing drift between a notification link and its destination's authorization, rather than re-deriving the rule"

key-files:
  created:
    - src/server/communications/links.ts
    - src/server/services/notification-access-service.ts
    - src/server/scheduled/cleanup-notifications-task.ts
    - netlify/functions/cleanup-notifications.ts
    - tests/communication-links.test.ts
    - tests/notification-access-service.test.ts
    - tests/notification-access.integration.test.ts
    - tests/cleanup-notifications-task.test.ts
    - tests/netlify-cleanup-notifications.test.ts
  modified:
    - src/app/notifications/actions.ts
    - src/server/services/notification-service.ts
    - tests/notification-service.integration.test.ts

key-decisions:
  - "LEARNER_TICKET's resolver queries prisma.ticket directly (userId equals actor, reference matches) rather than calling the live getOwnTicketByReference export, because that export resolves its own actor from the request session internally and cannot accept the already-resolved Actor resolveOpen already has; the query mirrors ticket-service.ts's findOwnByReference predicate exactly"
  - "STAFF_TICKET/STAFF_PAYMENT/STAFF_SUBMISSION resolvers call the live withPermission-wrapped page functions (getStaffTicketWorkspace/getPaymentDetailForStaff/getGradingDetail) directly and let a thrown AuthenticationError/AuthorizationError/NotFoundError propagate — resolveOpen's own catch already treats any resolver rejection as denied, so no resolver needs its own try/catch"
  - "STAFF_SUBMISSION additionally repeats the grade-entry page's own T-09-44-style membership check (detail.cohortId/detail.assessment.id against the notification's stored params.cohortId/params.assessmentId) so a submission resolved under a broader grant can never be linked as belonging to the wrong cohort or assessment"
  - "archiveReadOlderThan selects a bounded id subset first, then updates only that subset in one statement (matching the plan's 'no long lock' instruction) rather than a single unbounded UPDATE...WHERE with an implicit row cap"
  - "The integration test's STAFF_PAYMENT case builds a testDb.prisma-bound getPaymentDetailForStaff via createPaymentReadService + createCohortScopeResolvers + createTestWithPermission, deliberately NOT createPrismaBackedPaymentReadService's live singleton wiring, whose orderScope is hardcoded to the app's own prisma import rather than the injected client — using it here would have made the test's authorization check quietly query the wrong database in any environment without this session's DATABASE_URL override"

patterns-established:
  - "Pattern: a request-scoped notification-access resolver factory takes the minimal destination-page dependency (a lookup function or a can-shaped permission check) so unit tests supply fakes and the live singleton binds the app's real exports — no resolver re-implements authorization logic the destination page doesn't already enforce"

requirements-completed: [COM-03]

coverage:
  - id: D1
    description: "Tracer: opening a learner ticket notification checks ownership server-side, marks it read, and returns a validated relative href; the identical outcome for missing/foreign/deleted/denied"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/communication-links.test.ts (all builders + notificationHref for all ten target types + hostile-segment rejection)"
        status: pass
      - kind: unit
        ref: "tests/notification-access-service.test.ts#notificationAccessService.resolveOpen — generic gate"
        status: pass
      - kind: integration
        ref: "tests/notification-access.integration.test.ts — real Postgres, two users, learner ticket ownership"
        status: pass
    human_judgment: false
  - id: D2
    description: "All ten notification targets (LEARNER_DASHBOARD/ORDER/ENROLMENT/RESULTS/SESSIONS/TICKET, STAFF_TICKET/PAYMENT/SUBMISSION/EMAIL_LOG) gated by the exact rule their destination page enforces, with cross-role denial parity"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/notification-access-service.test.ts — one allowed and one denied case per target type, plus cross-role denial parity"
        status: pass
      - kind: integration
        ref: "tests/notification-access.integration.test.ts — LEARNER_ORDER, LEARNER_ENROLMENT (ACTIVE vs WITHDRAWN), STAFF_PAYMENT (payments.view held vs lacking) against real Postgres"
        status: pass
    human_judgment: false
  - id: D3
    description: "Scheduled 90-day archive of read notifications: exact-cutoff boundary, unread rows never touched, already-archived rows untouched, no row ever deleted, daily Netlify schedule, worker-safe import closure"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/cleanup-notifications-task.test.ts (cutoff arithmetic against a fixed clock, single call, log message)"
        status: pass
      - kind: unit
        ref: "tests/netlify-cleanup-notifications.test.ts (daily cron, single run per invocation)"
        status: pass
      - kind: integration
        ref: "tests/notification-service.integration.test.ts#archiveReadOlderThan — real Postgres exact-cutoff/before/after/unread/already-archived cases, unchanged row count"
        status: pass
      - kind: unit
        ref: "tests/boundary.test.ts — Netlify scheduled-function closure scan (auto-discovers netlify/functions/*, no code change needed there)"
        status: pass
    human_judgment: false

duration: ~90min
completed: 2026-09-27
status: complete
---

# Phase 13 Plan 05: Notification Link Safety and Scheduled Retention Summary

**A single validated link-builder module plus a ten-target access-resolution service that re-checks every destination's own authorization before returning a notification link, and a daily scheduled job that archives (never deletes) notifications read more than 90 days ago.**

## Performance

- **Duration:** ~90 min (start time not separately recorded; estimated from session scope)
- **Completed:** 2026-09-27
- **Tasks:** 3
- **Files:** 9 created, 3 modified

## Accomplishments
- `links.ts`: pure builders for every internal notification/email path (`DASHBOARD_PATH`, `EMAIL_LOG_PATH`, `orderPath`, `enrolmentPath`, `resultsPath`, `sessionsPath`, `learnerTicketPath`, `staffTicketPath`, `staffPaymentPath`, `staffSubmissionPath`) and `notificationHref`, which maps all ten `NOTIFICATION_TARGET_TYPES` to the right builder. Every segment is validated against `[A-Za-z0-9_-]+`; a slash, `..`, colon, whitespace, or empty segment throws.
- `notification-access-service.ts`: `createNotificationAccessService`/`resolveOpen` loads the notification scoped by `recipientId`, runs the row's target-type resolver (any thrown error treated as denial), marks the row read in every found-row outcome, and returns `{status:"ok", href}` or the identical `{status:"unavailable"}`. Ten resolver factories: `createLearnerTicketResolver`, `createAlwaysAllowedResolver` (LEARNER_DASHBOARD), `createOwnRecordResolver` (LEARNER_ORDER/ENROLMENT/RESULTS/SESSIONS, reusing `getOwnOrderByReference`/`loadLearnerPath` directly), `createStaffTicketResolver`, `createStaffPaymentResolver`, `createStaffSubmissionResolver` (with the T-09-44-style cohort/assessment membership check), `createStaffEmailLogResolver`.
- `src/app/notifications/actions.ts` gains `openNotificationAction`: zod-validated bounded id, resolves the actor, calls `resolveOpen`, returns `{ok:true, href}` / `{ok:true, unavailable:true}` / a single generic failure message — never a distinct reason.
- `notification-service.ts` gains `archiveReadOlderThan(cutoff, limit)`: selects a bounded id subset of unarchived read rows at or before the cutoff, then updates only that subset — no delete anywhere.
- `cleanup-notifications-task.ts` (constants `NOTIFICATION_ARCHIVE_DAYS=90`, `CLEANUP_BATCH_SIZE=500`) and `netlify/functions/cleanup-notifications.ts` (daily `0 3 * * *` cron) mirror `release-expired-holds-task.ts`/`release-expired-holds.ts` exactly; `tests/boundary.test.ts`'s existing worker-closure scan auto-discovered the new function and confirmed no `next/headers`/permission-layer/`getCurrentActor` import reaches it.
- 180 tests pass across the plan's full verification scope (`communication-links`, `notification-access-service`, `notification-access.integration`, `notification-service.integration`, `cleanup-notifications-task`, `netlify-cleanup-notifications`, `boundary`); `tsc --noEmit` and `eslint` both clean on every touched file.

## Task Commits

No commits were made (owner standing rule — see `commit_policy_override`). Suggested messages, hash `uncommitted`:

1. **Task 1: Tracer — learner ticket notification link safety** - `uncommitted` - `feat(13-05): add validated link builders and the LEARNER_TICKET notification access resolver`
2. **Task 2: The remaining seven target resolvers (TDD)** - `uncommitted` - `test(13-05): add failing tests for the remaining seven notification access resolvers` then `feat(13-05): add LEARNER_ORDER/ENROLMENT/RESULTS/SESSIONS/DASHBOARD and STAFF_TICKET/PAYMENT/SUBMISSION/EMAIL_LOG resolvers`
3. **Task 3: Scheduled 90-day archive of read notifications (TDD)** - `uncommitted` - `test(13-05): add failing tests for the notification archive task` then `feat(13-05): add archiveReadOlderThan and the daily cleanup-notifications scheduled task`

**RED observed, Task 2:** before the seven additional resolver factories existed, the new target-specific and cross-role tests in `tests/notification-access-service.test.ts` failed at missing-export import errors (`createAlwaysAllowedResolver`, `createOwnRecordResolver`, etc. not found). GREEN followed once all seven were added and wired into the live singleton.

**RED observed, Task 3:** before `cleanup-notifications-task.ts`/`netlify/functions/cleanup-notifications.ts`/`archiveReadOlderThan` existed, `tests/cleanup-notifications-task.test.ts` and `tests/netlify-cleanup-notifications.test.ts` failed at module-not-found import, and the two new cases in `tests/notification-service.integration.test.ts` failed with `TypeError: service.archiveReadOlderThan is not a function`. GREEN followed once all three were implemented.

## Files Created/Modified
- `src/server/communications/links.ts` — validated relative-path builders + `notificationHref`
- `src/server/services/notification-access-service.ts` — `resolveOpen`, ten resolver factories, the live `notificationAccessService` singleton
- `src/server/scheduled/cleanup-notifications-task.ts` — `createCleanupNotificationsTask`, `runCleanupNotificationsTask`, `NOTIFICATION_ARCHIVE_DAYS`, `CLEANUP_BATCH_SIZE`
- `netlify/functions/cleanup-notifications.ts` — daily scheduled wrapper, `createCleanupNotificationsHandler`
- `src/app/notifications/actions.ts` — added `openNotificationAction`
- `src/server/services/notification-service.ts` — added `archiveReadOlderThan`
- `tests/communication-links.test.ts`, `tests/notification-access-service.test.ts`, `tests/notification-access.integration.test.ts`, `tests/cleanup-notifications-task.test.ts`, `tests/netlify-cleanup-notifications.test.ts` — new test files
- `tests/notification-service.integration.test.ts` — extended with `archiveReadOlderThan` real-Postgres cases

## Decisions Made
See `key-decisions` above. Most consequential: reusing the destination page's own live export directly wherever it already accepts an explicit `Actor` (order/enrolment targets), versus querying the database directly for the ticket target (whose live export self-resolves its actor from the session and cannot be reused as-is) — both approaches structurally tie the notification check to the same rule the destination enforces, chosen per what each destination's own function signature allows.

## Deviations from Plan

None — plan executed as written. Two implementation-level choices are recorded as key-decisions above (the LEARNER_TICKET direct-query approach, and the STAFF_PAYMENT integration test's from-scratch `testDb.prisma`-bound service construction) because they are real, if minor, engineering decisions the plan left to discretion — not deviations from anything the plan specified.

## Issues Encountered
- `createPrismaBackedPaymentReadService`'s `orderScope` parameter is hardcoded to the app's live `orderCohortScope` (bound to the app's own `prisma` import) rather than being derived from the `client` argument it otherwise threads through consistently. This is a pre-existing, minor testability gap in `payment-read-service.ts` (not a file this plan modifies) — worked around in the integration test by calling the more general `createPaymentReadService` factory directly with a `testDb.prisma`-bound `orderScope`. Not fixed here (out of this plan's file scope); flagging for anyone who later needs to unit/integration-test `getPaymentDetailForStaff`'s live wiring against an injected database.

## User Setup Required
None — no external service configuration required. `netlify/functions/cleanup-notifications.ts` follows the same deployment convention as the existing `release-expired-holds`/`reconcile-payments`/`close-resolved-tickets` scheduled functions; no new environment variable is introduced.

## Known Stubs
None. Every resolver is wired to a real destination-page call or a real database query; no placeholder data, hardcoded empty result, or "coming soon" branch was introduced.

## Threat Flags
None beyond the plan's own threat model. T-13-61, T-13-02, T-13-62, T-13-26 and T-13-27 are all covered by the tests listed in `coverage` above.

## Next Phase Readiness
- Plan 06 (bell/drawer UI) can call `openNotificationAction` exactly as specified in this plan's `must_haves.artifacts`.
- Any future notification target type must add both a `links.ts` builder/`notificationHref` branch and a `notification-access-service.ts` resolver — `notificationHref`'s `switch` is exhaustive over `NotificationTargetType` (a `never` check), so an unhandled new target type is a compile error, not a silent runtime gap.
- The scheduled cleanup job is registered with Netlify's schedule config (`0 3 * * *`) the same way the three existing scheduled functions are; no additional deployment step is needed beyond what those already require.
- Commit the uncommitted work when ready (no commits were created, per the owner's standing no-auto-commit rule).

## Verification
- `npx vitest run tests/communication-links.test.ts tests/notification-access-service.test.ts tests/notification-access.integration.test.ts tests/notification-service.integration.test.ts tests/cleanup-notifications-task.test.ts tests/netlify-cleanup-notifications.test.ts tests/boundary.test.ts --no-file-parallelism`: 7 files, 180 tests pass (real-Postgres integration tests via Testcontainers `postgres:16-alpine`, all 19 checked-in migrations applied, confirmed by the run's own log line: `Datasource "db": PostgreSQL database "test", schema "public" at "localhost:...")`.
- `npx tsc --noEmit`: clean.
- `npx eslint` on every created/modified file: clean.
- The scratch database override was honored throughout: every Prisma/vitest command in this session was prefixed with the scratch `DATABASE_URL`; the Neon database was never contacted for a write, and the one live-singleton-adjacent construction (payment detail lookup for the STAFF_PAYMENT integration case) was deliberately built from scratch against `testDb.prisma` rather than reusing any live export whose scope resolver is hardcoded to the app's own `prisma` import.
- Docker was running throughout; both `<precondition>`-carrying tasks (Task 1, Task 3) confirmed their real-Postgres tests actually ran (not BLOCKED).

## Self-Check: PASSED
- All 9 created files exist on disk and appear in `git status --porcelain` as `??` (untracked); the 3 modified files (`src/app/notifications/actions.ts`, `src/server/services/notification-service.ts`, `tests/notification-service.integration.test.ts`) also show as untracked in this repo's current state, consistent with Plans 01/03 never having been committed either — not a Self-Check failure, matching the owner's no-auto-commit rule documented in those plans' own SUMMARY.md files.
- Absence of commits is expected under the owner's no-commit rule.
- All 180 tests referenced above were actually run in this session and passed; `tsc --noEmit` and `eslint` were actually run and passed.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-27*
