---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 09
subsystem: performance-read-paths
tags: [nfr-02, support-queue, react-cache, pagination, payments, testcontainers]
status: complete

requires:
  - phase: 12-support
    provides: staff support queue (buildQueueView, compareQueueRows, parseQueueParams, QUEUE_PAGE_SIZE)
  - phase: 07-payments
    provides: listPaymentsForStaff and the /staff/payments list
  - phase: 03-identity-rbac
    provides: getCurrentActor, getActorBySessionToken, loadGrantsForUser, withPermission
provides:
  - "loadQueueView(client, params, actorId, at): SQL where/orderBy/skip/take plus a groupBy and two counts; getStaffQueue delegates to it"
  - "queueWhere(params, actorId, now) and QUEUE_ORDER_BY exported from ticket-staff-queue-service.ts; buildQueueView and compareQueueRows kept unchanged as the oracle"
  - "getCurrentActor and loadGrantsForUser are React cache() wrappers (request-scoped only)"
  - "listPaymentsForStaff({ page, pageSize }) -> { rows, total, page, pageSize }; PAYMENT_LIST_PAGE_SIZE 50, PAYMENT_LIST_MAX_PAGE_SIZE 100, PAYMENT_LIST_ORDER_BY"
  - "/staff/payments renders one page with 'Showing {n} of {total}.' and Previous/Next links"
affects: [15-28]

actuals:
  tokens: 11700
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Differential test: keep the old pure in-memory function as an oracle and assert the SQL path deep-equals it over a seeded set for every parameter combination"
    - "Request-scoped dedupe with React cache(); outside a render cache() is a pass-through, so nothing is held between calls or requests"
    - "Escape \\, % and _ before a Prisma contains filter (Prisma passes the value to ILIKE without escaping)"

key-files:
  created:
    - tests/ticket-staff-queue-sql.integration.test.ts
    - tests/request-dedupe.test.ts
    - tests/payment-list-paging.integration.test.ts
  modified:
    - src/server/services/ticket-staff-queue-service.ts
    - src/server/auth/current-actor.ts
    - src/server/services/grant-service.ts
    - src/server/services/payment-read-service.ts
    - src/app/staff/payments/page.tsx
    - tests/payment-read-service.test.ts
    - tests/staff-scoped-lists.integration.test.ts
    - tests/notification-access.integration.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/deferred-items.md

key-decisions:
  - "Queue tab counts and the health strip come from one groupBy(status, priority, assigneeId) plus a count for the 7-day resolved tab; the group count is bounded by statuses x priorities x (assignees + 1)"
  - "Queue ordering uses Prisma orderBy priority desc (TicketPriority is declared LOW..URGENT, so desc = URGENT first), updatedAt asc, reference asc; no raw SQL needed"
  - "Queue text search escapes \\, % and _ so it stays a literal substring match like buildQueueView"
  - "Payments list order is createdAt desc then id desc; the rows and the total share one cohort-scoped where"
  - "/staff/payments shows the last page instead of an empty table when the page number is past the end (one extra query, only in that case)"

requirements-completed: [NFR-02]

coverage:
  - id: D1
    description: "getStaffQueue reads one page plus a groupBy and two counts, and returns a QueueView equal to buildQueueView for every tab, filter, combined filter, search and page"
    requirement: NFR-02
    verification:
      - kind: integration
        ref: "tests/ticket-staff-queue-sql.integration.test.ts"
        status: pass
      - kind: integration
        ref: "tests/staff-support.integration.test.ts (run with --testTimeout=60000, see Issues)"
        status: pass
      - kind: unit
        ref: "tests/staff-support-actions.test.ts, tests/staff-support-routes.test.ts, tests/components/support-workspace.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "getCurrentActor and loadGrantsForUser wrapped with React cache(); no cross-request cache; revoked session or grant refused on the next call"
    requirement: NFR-02
    verification:
      - kind: unit
        ref: "tests/request-dedupe.test.ts"
        status: pass
      - kind: unit
        ref: "tests/with-permission.test.ts, tests/permissions.test.ts, tests/token-hashing.test.ts, tests/staff-layout-nav.test.ts, tests/export-access-data-permission.test.ts, tests/learner-session-service.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "listPaymentsForStaff returns at most 50 (max 100) orders newest first with a total; scoped staff see only their cohorts; /staff/payments pages with Showing line and Previous/Next"
    requirement: NFR-02
    verification:
      - kind: unit
        ref: "tests/payment-read-service.test.ts"
        status: pass
      - kind: integration
        ref: "tests/payment-list-paging.integration.test.ts"
        status: pass
      - kind: integration
        ref: "tests/staff-scoped-lists.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Measured effect of the three changes under load (statement counts per page, p75)"
    requirement: NFR-02
    human_judgment: true
    rationale: "This plan proves behaviour is unchanged; the effect is measured in the local rehearsal (plan 15-28) with pg_stat_statements"

duration: 76 min
completed: 2026-10-07
---

# Phase 15 Plan 09: Read-path fixes before load (queue in SQL, request-scoped auth reads, paged payments) Summary

**The staff support queue now filters, orders, counts and pages in SQL (proven equal to the old in-memory oracle over 495 combinations). The session and grant reads are deduplicated per request with React cache(), and revocation still takes effect on the next call. /staff/payments reads one page of 50 orders.**

## Performance

- **Duration:** 76 min
- **Started:** 2026-10-07T14:37:30Z
- **Completed:** 2026-10-07T15:53:48Z
- **Tasks:** 3 of 3
- **Files:** 3 created, 9 modified

## Accomplishments

- **Support queue (folded todo 2026-09-25):** `getStaffQueue` now calls `loadQueueView`. It builds one Prisma `where` (tab, category, priority, queue, owner including "me" and "unassigned", and a case-insensitive OR search over reference, subject, requester name and email). It orders with `orderBy` (priority desc, updatedAt asc, reference asc), reads 20 rows with `skip`/`take`, and takes all five tab counts and the health strip from one `groupBy` plus a resolved-window `count`. On page 1 the row read runs in parallel with the counts. `buildQueueView` and `compareQueueRows` are unchanged and exported.
- **Differential test:** 90 seeded tickets with every status, category, priority, queue and owner, only six distinct `updatedAt` values (so tie-breaks are exercised), and resolved times on both sides of the 7-day edge. It checks 5 tabs x 33 filter sets x pages 1 to 3 (495 comparisons), page 99 clamping, exact tie ordering, and a spy client that proves `findMany` always has `take` and `orderBy`.
- **Request-scoped dedupe:** `getCurrentActor` and `loadGrantsForUser` are `cache()` from `react`, with the same signatures, so every caller is unchanged and `src/app/staff/layout.tsx` was not edited. A static test forbids `unstable_cache`, `"use cache"`, `new Map(`/`new WeakMap(` and any module-level `let`/`var`. A behavioural test over fake stores shows that a revoked session, a removed assignment, a deactivated role or a revoked assignment is seen on the very next call. A guarded call is refused right after revocation.
- **Paged payments:** `listPaymentsForStaff({ page, pageSize })` clamps pageSize to 1..100 (default 50) and page to 1..100000. It runs `findMany` (with `orderBy`/`skip`/`take`) and `count` with the same scoped where, and returns `{ rows, total, page, pageSize }`. The page parses `?page=` through an allow-list (`/^[1-9]\d{0,4}$/`, else 1) and renders "Showing {n} of {total}.". Previous and Next links (existing `BTN` class) appear only when there is a previous or next page and keep a known `status` tab.

## Task Commits

Not committed (owner commits explicitly). All changes are in the working tree and nothing is staged.

1. **Task 1 (tracer): support queue in SQL with differential test**: not committed (owner commits explicitly)
2. **Task 2: request-scoped dedupe with revocation test**: not committed (owner commits explicitly)
3. **Task 3: bounded, paged staff payments list**: not committed (owner commits explicitly)

Tracer gate: verify is automated-only and `human_verify_mode` is end-of-phase. Re-run passed, so execution moved on to Tasks 2 and 3.

## Files Created/Modified

- `src/server/services/ticket-staff-queue-service.ts`: adds `queueWhere`, `QUEUE_ORDER_BY`, `QueueTicketClient` and `loadQueueView`; `getStaffQueue` delegates to it
- `src/server/auth/current-actor.ts`: `getCurrentActor = cache(...)`
- `src/server/services/grant-service.ts`: `loadGrantsForUser = cache(...)`
- `src/server/services/payment-read-service.ts`: paging options, `count` dep, `PaymentListPage`, ordering and clamping constants
- `src/app/staff/payments/page.tsx`: page parse, last-page fallback, Showing line, Previous/Next nav
- `tests/ticket-staff-queue-sql.integration.test.ts` (new): differential test plus spy-client case
- `tests/request-dedupe.test.ts` (new): static and behavioural dedupe/revocation test
- `tests/payment-list-paging.integration.test.ts` (new): 120 orders across two cohorts
- `tests/payment-read-service.test.ts`: new return shape, paging/clamp/scope cases, and page-render cases
- `tests/staff-scoped-lists.integration.test.ts`, `tests/notification-access.integration.test.ts`: follow the new return shape / deps type

## Decisions Made

See `key-decisions` in the frontmatter. The priority enum order matches `PRIORITY_RANK`, so the raw `CASE` fallback the plan allowed was not needed and the queue has no raw SQL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma `contains` treats `_` and `%` as wildcards**
- **Found during:** Task 1 (differential test, search `_` on the my-work tab returned 14 rows where the oracle returned 1)
- **Issue:** Prisma 6.19 passes the `contains` value to ILIKE without escaping, so a search for `_` or `%` matched every row
- **Fix:** escape `\`, `%` and `_` before building the filter (part of T-15-09-02)
- **Files modified:** src/server/services/ticket-staff-queue-service.ts
- **Verification:** the `_` and `%` cases in the differential test now equal the oracle
- **Commit:** not committed (owner commits explicitly)

**2. [Rule 3 - Blocking] Two more consumers of the payments list contract**
- **Found during:** Task 3 (grep and tsc)
- **Issue:** `tests/staff-scoped-lists.integration.test.ts` used the old array return, and `tests/notification-access.integration.test.ts` builds `PaymentReadServiceDeps` without the new `count`
- **Fix:** read `.rows` in the scoped-lists test (assertions unchanged) and add a `count` stub to the notification test
- **Verification:** tsc exits 0; staff-scoped-lists integration passes (with the paging test, 9/9). The notification test was typechecked but not run (its change is a stub that is never called)
- **Commit:** not committed (owner commits explicitly)

**3. [Rule 1 - Existing test kept passing] `initialStatus={initialPaymentStatus(status)}` kept verbatim in page.tsx**
- `tests/payments-initial-status.test.ts` asserts that exact source text. The page keeps it and uses a separate `statusTab` for the paging links

**4. [Process] Task 3 test-first order**
- Task 3's service change was written just before its tests (RED was not observed separately). Tasks 1 and 2 followed test-first, and Task 2's RED failed on the 3 static checks as expected

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking), 2 process notes. **Impact:** none on scope. The escape fix closes a search-correctness gap the differential test caught.

## Issues Encountered

- **Pre-existing slow tests:** `tests/staff-support.integration.test.ts` exceeds Vitest's 5 s default per case on this machine. I checked against the unchanged HEAD service (temporary swap, restored): all three cases timed out there too (12.4 s, 7.5 s, 10.9 s). The `support-workspace.test.tsx` axe cases behave the same. Both pass unchanged with `--testTimeout=60000`. Logged in deferred-items.md.
- **Paged list vs client filters (follow-up):** `PaymentsTable.tsx` (not in this plan) still filters status, provider and search, and counts the tabs, over the loaded rows only. With paging these now cover the current page only. Logged in deferred-items.md with a suggested fix (server-side filters plus groupBy counts).
- **Dedupe inside a render is not unit-proven:** under Vitest's node conditions `react` resolves to the client build, where `cache()` is a pass-through. The test proves there is no cross-call cache and that revocation is immediate. The per-request read count is to be measured in plan 15-28 with pg_stat_statements, as the plan intends.

## Known Stubs

None.

## Threat Flags

None. No new endpoints or trust-boundary surface; T-15-09-01..04 are mitigated as planned (request-scoped cache only with static guard, parameterised and escaped search, one scoped where for rows and count, take on both queries with page size clamped to 100).

## Schema / Neon go-live

No migration. Nothing to add to the Neon go-live list.

## Checks Run

- `npx vitest run tests/ticket-staff-queue-sql.integration.test.ts tests/staff-support.integration.test.ts --no-file-parallelism`: queue 4/4 pass; staff-support passes 3/3 with `--testTimeout=60000` (default-timeout failure is pre-existing)
- `npx vitest run tests/staff-support-actions.test.ts tests/staff-support-routes.test.ts tests/components/support-workspace.test.tsx`: 16/16 and 34/34 (the last with `--testTimeout=60000`)
- `npx vitest run tests/request-dedupe.test.ts tests/learner-session-service.test.ts`: 23/23
- Permission/session regression: with-permission, permissions, token-hashing, staff-layout-nav, export-access-data-permission: 65/65
- `npx vitest run tests/payment-read-service.test.ts` plus payments-initial-status: 32/32
- `npx vitest run tests/payment-list-paging.integration.test.ts tests/staff-scoped-lists.integration.test.ts --no-file-parallelism`: 9/9
- `tests/unit/design-contract.test.ts` plus the unit files above: 160/160
- `npx tsc --noEmit`: exit 0. `npx eslint` on all touched files: exit 0
- Databases: Testcontainers only; the shared Neon database was not touched

## Next Phase Readiness

The three slow spots are changed and their behaviour is proven unchanged. They are ready for the pg_stat_statements measurement in plan 15-28. The folded todo `2026-09-25-move-staff-support-queue-filtering-into-sql.md` is done in code and left in pending for the phase to close.

## Tracking

- `state.advance-plan` ran once (plan 8 to 9 of 33); `state.record-metric`, `roadmap.update-plan-progress 15` (7 of 33 summaries), 3 `state.add-decision` and `state.record-session` ran.
- `state.update-progress` skipped itself ("phase scope is unscoped, not complete"); STATE.md Progress was not hand-edited.
- `requirements.ready-ids <plan> NFR-02` returned 0 of 1 ready (other phase 15 plans also declare NFR-02), so NFR-02 was not marked complete.

## Self-Check: PASSED

- All 3 created and 5 key modified source files exist on disk; SUMMARY exists.
- Commits: none by design (owner commits explicitly); `git diff --cached` is empty, nothing staged.
- Acceptance criteria re-run: queue `findMany` has `take: QUEUE_PAGE_SIZE` and `orderBy: QUEUE_ORDER_BY`; `buildQueueView` exported and used 3 times in the differential test; both auth files contain `import { cache } from "react"` and 0 `unstable_cache`/`new Map(` outside comments; payments `findMany` passes `skip` and `take`; page source has "Showing" and reads `params.page`.
- Folded todo left in `.planning/todos/pending/`.
