---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 05
subsystem: api
tags: [prisma, resource-service, authorization, publish, readiness, optimistic-concurrency, outbox, tdd]

# Dependency graph
requires:
  - phase: 05-01
    provides: "Cohort.coursePublicationId / programmePublicationId pins, holdMinutes, model DomainEvent"
  - phase: 05-02
    provides: "cohortResourceScope (async DB-derived ResourceScope for the factory toScope)"
  - phase: 05-03
    provides: "evaluateCohortReadiness(ReadinessCohortInput) + blockingFailures + ReadinessCohortInput shape"
  - phase: 05-04
    provides: "writeDomainEvent(tx, event), CohortNotFoundError"
  - phase: 04-catalogue-authoring
    provides: "createResourceService factory (async toScope, archiveData override, runInTransaction), StaleOrderError, publish-service.ts publish/refusal/stale-token patterns"
provides:
  - "src/server/services/cohort-service.ts — cohortService (factory: list/get/create/update/archive), updateCohort (D-30 offer-lock wrapper), assertOfferMutable / createCohortGuards, publishCohort, loadCohortReadinessAggregate"
  - "Typed refusals: OfferLockedError, CohortReadinessRefusedError, NoPublishedOfferError (plans 05-12 / 05-15 map each to UI-SPEC copy)"
  - "createCohortService(deps) DI factory + CohortRecord / CohortAggregateRow / CohortPublishTx types"
  - "tests/cohort-service.test.ts — 23 unit proofs against fake delegates"
affects: [05-11, 05-12, 05-15, cohort-service, cohort publish action, cohort detail page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resource-service factory instance + a hand-written withPermission wrapper for the one field-conditional refusal the factory cannot express (updateCohort → assertOfferMutable), mirroring catalogue-guards.ts"
    - "Publish outside the factory: load aggregate → NoPublishedOfferError → blockingFailures(evaluate…) → $transaction { conditional updateMany stale-check + writeDomainEvent } → audit after commit (publish-service.ts shape)"
    - "loadCohortReadinessAggregate does all the reading; the pure evaluator stays import-free — no readiness rule leaves readiness-service.ts (grep-gated: zero PASS/FAIL/WARN literals in cohort-service.ts)"
    - "Catalogue pin resolved from the offer target's latest publication row + target.status, not the cohort's own (null) pin column — resolves the pre-first-publish chicken-and-egg"

key-files:
  created:
    - "src/server/services/cohort-service.ts"
    - "tests/cohort-service.test.ts"
  modified: []

key-decisions:
  - "publishCohort loads ONE aggregate row (CohortAggregateRow) and derives both the ReadinessCohortInput and the pin metadata (offer kind, latest publication id, before-status) from it — one query, no second round trip."
  - "The catalogue-readiness pin is built from `target.publications[0]` (latest by version desc) + `target.status`, NOT from Cohort.coursePublicationId/programmePublicationId — those are null until this very operation sets them, so reading them would make first publish impossible."
  - "NoPublishedOfferError is thrown BEFORE the readiness evaluation (plan-specified order) even though the blocking `catalogue` readiness item would also catch an unpinned cohort — it gives 05-15 a distinct typed error with its own message."
  - "OfferLockedError message is the exact UI-SPEC line ('The course/programme this cohort delivers is locked because it has enrolments. Changing it needs an approved migration.') so plan 05-12 maps it with no rewording."
  - "createCohortService is a DI factory (deps: delegate, enrolment, aggregate, db, toScope, withPermission, audit, runInTransaction, now) + a bound `built` instance — the unit tests drive it with fakes, exactly like reorder-service / publish-service."

patterns-established:
  - "assertOfferMutable counts Enrolment rows with NO status filter (where: { cohortId }) — a WITHDRAWN/CANCELLED/TRANSFERRED row still locks the offer target (D-30)"
  - "publishCohort emits `cohort.published` inside the publish $transaction and audits `cohort.published` after commit — event + audit, same as publish-service.ts"

requirements-completed: [COH-01, COH-02, COH-04]

# Metrics
duration: 9min
completed: 2026-09-04
---

# Phase 5 Plan 05: Cohort Service (CRUD + Offer Lock + Readiness-Gated Publish) Summary

**`cohortService` is the factory instance (authorized, cohort-scoped, audited, archive = `status: CANCELLED`); `updateCohort` refuses an offer-target change once any enrolment exists (`OfferLockedError`, D-30); `publishCohort` is gated on the dedicated publish permission, refuses with named failing readiness items, pins the latest published Course/Programme snapshot, refuses a stale token, emits `cohort.published` and audits after commit.**

## Performance

- **Duration:** ~9 min
- **Tasks:** 2 (both TDD: RED test commit → GREEN feat commit each — 4 commits)
- **Files:** 2 created

## Accomplishments

- **`cohortService`** — `createResourceService<CohortRecord>` with `permissions: { view: "cohorts.view", create: "cohorts.manage", edit: "cohorts.manage" }`, `toScope: cohortResourceScope`, `archiveData: () => ({ status: "CANCELLED" })` (D-31 soft-cancel), `runInTransaction: (fn) => prisma.$transaction(fn)` (so 05-11's bulk withdraw is atomic). No `delete` anywhere (grep-gated).
- **`createCohortGuards` / `assertOfferMutable`** — injected-`Enrolment`-delegate guard in the `catalogue-guards.ts` style. `OfferLockedError` carries `cohortId` + `enrolmentCount`; the count has **no status filter**, proven with a test asserting the exact `{ where: { cohortId } }` argument.
- **`updateCohort`** — `withPermission("cohorts.manage", cohortResourceScope)` wrapper that reads the stored row, compares `courseId`/`programmeId`, and calls `assertOfferMutable` only when a submitted value actually differs, then delegates to the factory's audited `cohortService.update`.
- **`loadCohortReadinessAggregate(cohortId)`** — one query (readiness columns + `scheduledSessions` + `_count.instructors` + the offer target's latest publication `payload`), transformed into a `ReadinessCohortInput`. Returns `null` for a missing cohort. `completionRule` is read off the frozen publication payload.
- **`publishCohort({ cohortId, expectedUpdatedAt, reason? })`** — gated `cohorts.publish` (grep-gated: exactly one occurrence). Order: `CohortNotFoundError` → `NoPublishedOfferError` (offer target unpinnable) → `CohortReadinessRefusedError` (carries `failures: ReadinessItem[]`) → `$transaction`: conditional `cohort.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data: { status: "PUBLISHED", publishedAt, coursePublicationId | programmePublicationId } })` → `StaleOrderError` on `count === 0` → `writeDomainEvent(tx, { type: "cohort.published", … })` → audit `cohort.published` after commit.

## Exported surface (plans 05-11 / 05-12 / 05-15 consume these)

```ts
export const cohortService;        // list / get / create / update / archive (archive → status: "CANCELLED")
export const updateCohort;         // ({ id, data, reason? }) — offer-lock wrapper
export const assertOfferMutable;   // (cohortId) => Promise<void>  throws OfferLockedError
export function createCohortGuards(deps: { enrolment: { count } }): { assertOfferMutable };
export const publishCohort;        // ({ cohortId, expectedUpdatedAt, reason? }) => { publicationId, status }
export const loadCohortReadinessAggregate; // (cohortId) => Promise<ReadinessCohortInput | null>

export class OfferLockedError extends Error { cohortId; enrolmentCount }
export class CohortReadinessRefusedError extends Error { failures: ReadinessItem[] }
export class NoPublishedOfferError extends Error { cohortId; offerKind: "course" | "programme" }

export function createCohortService(deps: CohortServiceDeps): { cohortService, updateCohort, loadCohortReadinessAggregate, publishCohort };
export type { CohortRecord, CohortAggregateRow, CohortAggregateDelegate, CohortPublishTx, CohortPublishDb };
```

`publishCohort` returns `{ publicationId, status: "PUBLISHED" }`.

## Task Commits

1. **Task 1: Factory CRUD + cancel-on-archive + offer-lock guard (TDD)** — `7ddf2b2` (test) → `25fe596` (feat)
2. **Task 2: Readiness aggregate loader + publishCohort (TDD)** — `a8e9f4b` (test) → `6bad55e` (feat)

_No REFACTOR commits — both GREEN implementations needed no cleanup._

**Plan metadata (SUMMARY / STATE / ROADMAP):** disk-only — `.planning/` is gitignored (sequential-execution-mode note).

## Deviations from Plan

None — plan executed as written. Task 1 GREEN comment initially read "cohorts-publish permission"; `-` matches `.` under the acceptance gate `grep -c 'cohorts.publish'` (regex), so the comment was reworded to "the dedicated publish permission" — same meaning, gate now returns exactly 1. Not a behaviour change.

Note on the catalogue pin (worth recording for 05-15): the readiness aggregate resolves the pin from the offer target's *latest publication row* and *live status*, not from the cohort's own `coursePublicationId`/`programmePublicationId` columns. Those are `null` until `publishCohort` sets them, so a first publish would be impossible if readiness read them. `publishCohort` then pins that same latest publication id inside its transaction.

## Verification Results

- `npx vitest run tests/cohort-service.test.ts` — 23/23 passed.
- `npx vitest run tests/cohort-readiness.test.ts tests/cohort-scope.test.ts` — 48/48 passed (unchanged).
- `npx vitest run tests/resource-service.test.ts tests/course-service.test.ts tests/publish-service.test.ts tests/boundary.test.ts tests/permissions.test.ts tests/with-permission.test.ts tests/domain-event-service.test.ts` — 86/86 passed (shared factory + Phase-4 publish path unaffected, worker import closure clean).
- Full `node` project — 58 files / 783 tests passed (includes Testcontainers integration).
- `npx tsc --noEmit` — exit 0. `npm run lint` — exit 0.
- Grep gates: `archiveData` present with `status: "CANCELLED"`; permission literals = only `cohorts.view` / `cohorts.manage` / `cohorts.publish`; `delete(` = 0; `evaluateCohortReadiness` = 3; `"(PASS|FAIL|WARN)"` literals = 0; `cohorts.publish` = 1; `expectedUpdatedAt` = 2.

## Known Stubs

None.

## Threat Flags

None — the file implements mitigations already in the plan's threat register (T-05-23 … T-05-30): `withPermission` + `cohortResourceScope` on every op, `publishCohort` gated on `cohorts.publish` specifically, `assertOfferMutable` status-filter-free, `NoPublishedOfferError` + blocking catalogue item, conditional `updateMany` stale-check, unmodified `AuthorizationError`, `cohort.published` audit + outbox row, no hard delete.

## Self-Check: PASSED

- `src/server/services/cohort-service.ts` — FOUND
- `tests/cohort-service.test.ts` — FOUND
- Commit `7ddf2b2` — FOUND
- Commit `25fe596` — FOUND
- Commit `a8e9f4b` — FOUND
- Commit `6bad55e` — FOUND

---
*Phase: 05-cohorts-scheduling-enrolment-operations-attendance*
*Completed: 2026-09-04*
