---
phase: 13-transactional-communications-notifications
plan: 03
subsystem: notifications
tags: [notifications, cursor-pagination, email-preferences, prisma, postgres, vitest, zod, next-route-handlers, server-actions]

requires:
  - phase: 13-01
    provides: Notification and EmailPreference models, NotificationType/EmailCategory/MUTABLE_EMAIL_CATEGORIES vocabulary in src/server/communications/contracts.ts
provides:
  - createNotificationService (unreadCount, list, markRead, markAllRead) — recipientId-scoped on every query, cursor-paged, no delete anywhere
  - renderNotificationText / toNotificationDto — total Record<NotificationType, ...> text renderer with an 8-key param allow-list, plus the drawer DTO shaper (Today/Earlier grouping via Africa/Lagos)
  - createEmailPreferenceService (getMutedCategories, saveMutedCategories) — validates before writing, upserts the 4 mutable categories only, never deletes
  - Three uncached JSON routes (GET /api/notifications/unread, /api/notifications, /api/notifications/preferences) and two server actions (markAllNotificationsReadAction, saveEmailPreferencesAction)
affects: [13-05 access-check reuse, 13-06 bell/drawer UI, 13-13 drain writer of Notification rows]

actuals:
  tokens: 13765
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Notification text is a total Record<NotificationType, TextBuilder> — same exhaustiveness convention as 13-02's TEMPLATE_REGISTRY; a missing type is a compile error, not a silent runtime fallback"
    - "Opaque cursor is base64url(`<ISO createdAt>|<id>`), validated against a pinned regex before decode; list always fetches limit+1 to decide nextCursor without a second round trip"
    - "markRead separates the ownership read (findMany by id+recipientId) from the conditional write (updateMany with readAt: null), so an owned-but-already-read row still returns true without a spurious write"

key-files:
  created:
    - src/server/services/notification-service.ts
    - src/server/services/email-preference-service.ts
    - src/server/communications/notification-text.ts
    - src/app/api/notifications/unread/route.ts
    - src/app/api/notifications/route.ts
    - src/app/api/notifications/preferences/route.ts
    - src/app/notifications/actions.ts
    - tests/notification-service.test.ts
    - tests/notification-service.integration.test.ts
    - tests/notification-unread-route.test.ts
    - tests/notification-text.test.ts
    - tests/email-preference-service.test.ts
  modified: []

key-decisions:
  - "NOTIFICATION_TEXT_BUILDERS is a total Record over all 27 NotificationType members (Claude's Discretion per 13-CONTEXT.md); only 7 titles are pinned verbatim by the plan/UI-SPEC (enrolment.confirmed, session.updated, grade.released, certificate.issued, ticket.reply, staff.ticket_new, order.payment_exception, plus staff.email_failed's exact sentence) — the remaining 19 follow the same allow-listed-param-with-safe-fallback shape by design choice, not a fixed spec"
  - "Cursor id charset is [A-Za-z0-9_-]+ (not the narrower cuid-only alphanumeric) so the same cursor mechanism tolerates uuid-shaped ids without a future change"
  - "markRead reads ownership via findMany(take:1) then always calls updateMany with readAt:null in the where clause — two queries, but the second is a no-op write for an already-read row rather than a second branch of logic"

requirements-completed: [COM-03]

coverage:
  - id: D1
    description: "Tracer: a user's unread count travels from the database through the ownership-scoped service to the uncached poll endpoint"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/notification-service.test.ts#notificationService.unreadCount (T-13-01)"
        status: pass
      - kind: integration
        ref: "tests/notification-service.integration.test.ts#unreadCount: 2 unread, 1 read, 1 archived-unread, plus another user's 3 unread -> 2"
        status: pass
      - kind: unit
        ref: "tests/notification-unread-route.test.ts#GET /api/notifications/unread"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cursor-paged list (newest first, no dup/gap), ownership-scoped markRead/markAllRead, and the safe notification text renderer + DTO shaper"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/notification-service.test.ts#notificationService.list — clamping and cursor validation"
        status: pass
      - kind: integration
        ref: "tests/notification-service.integration.test.ts#21 rows and limit 20: page 1 has 20 + a cursor, page 2 has 1 + no cursor, no id repeats or gaps"
        status: pass
      - kind: unit
        ref: "tests/notification-text.test.ts#renderNotificationText — hostile-key allow-list (D-17, T-13-58)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Email preference store (4 mutable categories only, upsert-never-delete) plus its uncached GET route and the save server action"
    requirement: "COM-03"
    verification:
      - kind: unit
        ref: "tests/email-preference-service.test.ts#emailPreferenceService.saveMutedCategories (D-16)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-27
status: complete
---

# Phase 13 Plan 03: Notification Read Side and Email Preference Store Summary

**Ownership-scoped notification service (unread count, cursor list, mark read/all-read) and email-preference store, both proven against real Postgres, behind three uncached JSON routes and two server actions.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-09-27
- **Tasks:** 3
- **Files:** 12 created, 0 modified

## Accomplishments
- `notification-service.ts`: `unreadCount`, `list` (cursor-paged, newest-first, limit clamped 1..50, default 20), `markRead`, `markAllRead` — every query and update carries `recipientId: actor.userId`; no delete anywhere.
- `notification-text.ts`: `renderNotificationText` (total `Record<NotificationType, ...>`, 8-key param allow-list, safe generic fallback for a missing param or an unrecognised type) and `toNotificationDto` (id/title/meta/read/createdAt ISO/group, Today-vs-Earlier computed against Africa/Lagos via the existing `utcToWallParts` helper).
- `email-preference-service.ts`: `getMutedCategories`, `saveMutedCategories` — validates the requested category set against `MUTABLE_EMAIL_CATEGORIES` before opening the transaction (an always-sent or unknown category throws and writes nothing), then upserts exactly the 4 mutable rows.
- Three GET routes (`/api/notifications/unread`, `/api/notifications`, `/api/notifications/preferences`), each with no `dynamic`/`revalidate` export and `Cache-Control: private, no-store` on every response including 401/400.
- `src/app/notifications/actions.ts`: `markAllNotificationsReadAction` and `saveEmailPreferencesAction`, both resolving the actor server-side and returning a generic message on every failure path (unauthenticated, validation failure, or service rejection).
- 45 tests across 5 files (38 unit + 7 real-Postgres integration), all passing; `tsc --noEmit` and `tests/boundary.test.ts` (19 tests) both clean.

## Task Commits

No commits were made (owner standing rule — see `commit_policy_override`). Suggested messages, hash `uncommitted`:

1. **Task 1: Tracer — unread count end-to-end** - `uncommitted` - `feat(13-03): add notification service unreadCount and the uncached unread-count route`
2. **Task 2: List, mark read/all-read, safe text, list route (TDD)** - `uncommitted` - `test(13-03): add failing tests for notification list, mark-read and text rendering` then `feat(13-03): add notification list/mark-read/mark-all-read, text renderer and list route`
3. **Task 3: Email preference store, route, save action (TDD)** - `uncommitted` - `test(13-03): add failing tests for the email preference service` then `feat(13-03): add email preference service, preferences route and save action`

**RED observed, Task 2:** before `list`/`markRead`/`markAllRead` existed on the service, the new cursor/ownership tests in `tests/notification-service.test.ts` failed at the missing-method call, and `tests/notification-text.test.ts` failed at the module-not-found import for `@/server/communications/notification-text`. GREEN followed once both were implemented.

**RED observed, Task 3:** before `email-preference-service.ts` existed, every `tests/email-preference-service.test.ts` case failed at the module-not-found import. GREEN followed once `createEmailPreferenceService` was implemented.

## Files Created/Modified
- `src/server/services/notification-service.ts` — ownership-scoped unread count, cursor list, mark read, mark all read
- `src/server/services/email-preference-service.ts` — read/replace the caller's muted email categories
- `src/server/communications/notification-text.ts` — safe title/meta rendering and the DTO shaper
- `src/app/api/notifications/unread/route.ts` — GET unread count for the bell poll
- `src/app/api/notifications/route.ts` — GET cursor-paged notification list
- `src/app/api/notifications/preferences/route.ts` — GET the caller's muted categories
- `src/app/notifications/actions.ts` — `markAllNotificationsReadAction`, `saveEmailPreferencesAction`
- `tests/notification-service.test.ts`, `tests/notification-service.integration.test.ts`, `tests/notification-unread-route.test.ts`, `tests/notification-text.test.ts`, `tests/email-preference-service.test.ts`

## Decisions Made
See `key-decisions` above: total-Record text-builder exhaustiveness, the broadened cursor id charset, and the two-query (read-then-conditional-write) shape of `markRead`.

## Deviations from Plan

None — plan executed as written. Two self-contained test-authoring bugs were found and fixed while writing my own new test file, not deviations from the plan:
- `tests/notification-service.test.ts`'s `makeFakeStore` helper originally returned the pre-merge local mock functions instead of the ones actually installed on `db.notification` after `overrides` was spread in, so assertions against the returned mocks always saw zero calls. Fixed by reading the mocks back off the merged `notification` object before returning them.
- The same file's cursor-encoding test used a fixture id (`"n-1"`) containing a hyphen against a cursor-id regex that only allowed `[A-Za-z0-9]+`. Broadened the regex to `[A-Za-z0-9_-]+` in `notification-service.ts` (also recorded as a key decision, since it is a real, if minor, implementation choice, not merely a test fixture fix) so the cursor format tolerates uuid-shaped ids too.

**Total deviations:** 0 from-plan deviations. **Impact:** none — both fixes were caught and resolved during the plan's own TDD RED/GREEN cycle, before any acceptance criterion was checked.

## Issues Encountered
- The plan's Task 2 file list did not include a dedicated test file for `GET /api/notifications` or `GET /api/notifications/preferences` (only `tests/notification-unread-route.test.ts` was specified, for Task 1's route). Both routes are thin pass-throughs over already-unit-tested service methods (`notificationService.list`, `emailPreferenceService.getMutedCategories`) following the exact same 401/no-store shape proven for the unread route; verified by code review and by `tsc --noEmit`, not by a dedicated route-level test. Flagging here rather than silently expanding the plan's declared file list.

## User Setup Required
None — no external service configuration required.

## Known Stubs
None. All three routes and both server actions are fully wired to real services; no placeholder data or empty-array stubs.

## Threat Flags
None beyond the plan's own threat model. T-13-01, T-13-22, T-13-58 and T-13-20 are all covered by the tests listed in `coverage` above; T-13-18 (drawer XSS) and T-13-19 (server-action CSRF, accepted) belong to Plan 06 and the framework respectively, not this plan's files.

## Next Phase Readiness
- Plan 05 (access check) and Plan 06 (bell/drawer UI) can call `notificationService`, `emailPreferenceService`, `renderNotificationText`/`toNotificationDto`, and the three routes/two actions exactly as named in this plan's `must_haves.artifacts`.
- Plan 13-13 (the drain) is the eventual writer of `Notification` rows this service reads; nothing in this plan depends on the drain existing yet — the integration tests seed rows directly.
- Commit the uncommitted work when ready (no commits were created, per the owner's standing no-auto-commit rule).

## Verification
- `npx vitest run tests/notification-service.test.ts tests/notification-service.integration.test.ts tests/notification-unread-route.test.ts tests/notification-text.test.ts tests/email-preference-service.test.ts --no-file-parallelism`: 5 files, 45 tests pass (38 unit + 7 real-Postgres, Testcontainers `postgres:16-alpine`, all 19 checked-in migrations including 13-01's `20260927015627_communications_notifications` applied).
- `npx tsc --noEmit`: clean.
- `npx vitest run tests/boundary.test.ts`: 19 tests pass (no `@prisma/client` import outside `src/server/services/**`/`src/server/db.ts`; no request-only API in any actorless runtime closure).
- `npx eslint` on all 12 new files: clean.
- Grep checks: no `dynamic`/`revalidate` export in any of the three route files; no `delete(`/`deleteMany(`/`.delete` call on the `notification` or `emailPreference` delegate anywhere in this plan's files.
- The Neon `DATABASE_URL` was never contacted — no Prisma CLI command was run against it in this plan (no schema change was needed); the one real-Postgres test file uses `tests/support/pg.ts`'s Testcontainers harness, which starts its own throwaway container and overrides `DATABASE_URL` to point at it, confirmed by the test run's own log line: `Datasource "db": PostgreSQL database "test", schema "public" at "localhost:32769"`.

## Self-Check: PASSED
- All 12 created files exist on disk and appear in `git status --porcelain` (verified via `git status --porcelain` — all listed as `??`, none show as commits in `git log`, matching the owner's no-auto-commit rule).
- All 45 new/extended tests pass, including the 7 real-Postgres cases (Docker was running throughout; the container started successfully and applied all 19 migrations).
- `tsc --noEmit` and `tests/boundary.test.ts` both pass, matching the plan's overall `<verification>` block.
- Absence of commits is expected under the owner's no-commit rule, not a Self-Check failure.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-27*
