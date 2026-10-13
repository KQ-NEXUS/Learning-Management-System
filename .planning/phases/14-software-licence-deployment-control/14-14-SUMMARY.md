---
phase: 14-software-licence-deployment-control
plan: 14
subsystem: communications
tags: [licence, notifications, domain-event, mapper, dedupe, drain, d-15, d-10, lic-07, p5]
status: complete

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-08 writeDomainEventOnce, licence.notice / staff.licence_notice / STAFF_LICENCE / staff-licence-notice vocabularies; 14-06 noticeCopy, isKnownNoticeKey, formatLicenceInstant; 14-04 LicenceStatusSnapshot and dueNoticeKeys; 14-09 evaluateAndRecord noticeKeys"
provides:
  - "licence-notice-service.ts: createLicenceNoticeService({ db, now }), licenceNoticeService, prismaCreateManyClient; emitNotices({ snapshot, noticeKeys }) writes one deterministic licence.notice event per key (id licence:{licenceId|none}:{noticeKey}) and returns { created, skipped }"
  - "event-mappers/licence.ts: createLicenceMappers() with the licence.notice mapper over Global licence.view holders; registered in EVENT_MAPPER_GROUPS"
  - "tests/licence-notice-service.test.ts, tests/event-mappers-licence.test.ts, tests/licence-drain.integration.test.ts (real Postgres)"
affects: [14-15, 14-16, 14-21]

estimate:
  tokens: 75000
  raw_tokens: 75000
  tasks: 3
  confidence: low
actuals:
  tokens: 11700
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Field-by-field allow-listed event payload (licenceId, noticeKey, state, days, expiry, graceEnd, reasonCode) built from the snapshot without spreading it, so a new snapshot member can never leak into an event"
    - "Mapper builds notification and email params explicitly from named optional strings; the email is omitted for the one in-product-only key (expiring-60)"
    - "Structural Prisma adapter (prismaCreateManyClient) keeps domain-event-service free of an @prisma/client import while a real client satisfies DomainEventCreateManyClient"

key-files:
  created:
    - src/server/services/licence-notice-service.ts
    - src/server/services/event-mappers/licence.ts
    - tests/licence-notice-service.test.ts
    - tests/event-mappers-licence.test.ts
    - tests/licence-drain.integration.test.ts
  modified:
    - src/server/services/event-intent-mappers.ts

key-decisions:
  - "Recipients come only from resolveStaffHolders(ctx.tx, { permission: 'licence.view', scope: {} }): Global grants only, active staff only; the mapper consults no other recipient source"
  - "Every notice creates a notification; every notice except expiring-60 also creates one STAFF email (never mutable). expiring-60 is in-product only"
  - "An unknown or non-string noticeKey throws MalformedEventError before recipients are resolved, so it takes the drain's poison path (3 attempts) and notifies nobody"
  - "The payload carries expiry and graceEnd whenever the dates exist (preformatted in the licence's own time zone); days is the bucket for expiring-N and daysToGraceEnd for grace-ending; reasonCode is taken from the notice key suffix of invalid-* keys"
  - "The content-prohibition test matches forbidden field names case-sensitively and additionally asserts the fixture's actual secret values (deployment ID, key ID, client name, support addresses, licence text) are absent: the upper-case closed reason codes BAD_SIGNATURE and WRONG_DEPLOYMENT are codes, not signing material"
  - "The whole-word 'deployment' assertion on rendered email permits only the approved plain-prose phrase 'this deployment' (see Deviations)"

patterns-established:
  - "A drain integration test for a new event type seeds its audience (holder, wrong-permission staff, learner, deactivated holder), drains with the real harness, and asserts exact per-recipient row counts plus an unchanged count after a re-emit and a processedAt reset replay"

requirements-completed: []

coverage:
  - id: C1
    description: "D-15: emitNotices writes a deduplicated licence.notice event (id licence:{licenceId|none}:{noticeKey}) through writeDomainEventOnce; an unknown key rejects before any write; an empty list writes nothing; created vs skipped follows the createMany count"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/licence-notice-service.test.ts (10 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "LIC-07 recipients (T-14-14-01): the mapper asks resolveStaffHolders for permission licence.view with an empty scope only; on a real database exactly the two Global licence.view holders get one notification and one email each, and staff with another permission, a learner and a deactivated holder get nothing"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/event-mappers-licence.test.ts (recipients, registration)"
        status: pass
      - kind: integration
        ref: "tests/licence-drain.integration.test.ts Test 1 (Testcontainers)"
        status: pass
    human_judgment: false
  - id: C3
    description: "LIC-07 dedupe (T-14-14-03): re-emitting the same notice is skipped, a second drain pass and a processedAt-reset replay leave event, Notification and EmailDispatch counts and the send count unchanged; a replacement licence id renews the same key"
    requirement: "LIC-07"
    verification:
      - kind: integration
        ref: "tests/licence-drain.integration.test.ts Tests 2 and 4 (Testcontainers)"
        status: pass
    human_judgment: false
  - id: C4
    description: "Email policy: expiring-60 yields notifications and zero EmailDispatch rows; expiring-30 and every other key yield both"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/event-mappers-licence.test.ts (expiring-60 omits email; 13-key sweep)"
        status: pass
      - kind: integration
        ref: "tests/licence-drain.integration.test.ts Test 3"
        status: pass
    human_judgment: false
  - id: C5
    description: "Content prohibition P5 (T-14-14-02): across all 13 notice keys the payload, notification params and email params contain none of deploymentId, signature, privateKey, client, contract or any fixture secret value; params are string-only and field-allow-listed; stored Notification.params and EmailDispatch.templateParams on a real database obey the same; the sent email subject equals the notification title"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/event-mappers-licence.test.ts (13-key content prohibition sweep, days and param types)"
        status: pass
      - kind: integration
        ref: "tests/licence-drain.integration.test.ts Test 5"
        status: pass
    human_judgment: false
  - id: C6
    description: "T-14-14-04: a licence.notice event with an unknown or missing noticeKey ends in the poison state after 3 attempts (lastError MalformedEventError), with no Notification, no EmailDispatch and no send"
    requirement: "LIC-07"
    verification:
      - kind: integration
        ref: "tests/licence-drain.integration.test.ts Test 6"
        status: pass
      - kind: unit
        ref: "tests/event-mappers-licence.test.ts (MalformedEventError before recipient resolution)"
        status: pass
    human_judgment: false
  - id: C7
    description: "Exactly one mapper is registered for licence.notice in the live EVENT_MAPPER_GROUPS table"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/event-mappers-licence.test.ts (registers exactly one mapper)"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-10-02
---

# Phase 14 Plan 14: Licence Notice Emission and Mapping Summary

**Licence notices are emitted as deduplicated `licence.notice` events (id `licence:{licenceId|none}:{noticeKey}`, written once via createMany skipDuplicates) and the real Phase 13 drain fans each one out to exactly the active staff with a Global `licence.view` grant, as one notification and, except for `expiring-60`, one email each, with no signing, contract, key or deployment detail, all proven on a real Postgres.**

## Performance

- **Duration:** about 40 min
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 5 created, 1 modified (3 source: 2 created, 1 modified; 3 test files created)

## Accomplishments

- `licence-notice-service.ts`: `emitNotices` validates every key with `isKnownNoticeKey` first (an unknown key throws "Unknown licence notice key." and writes nothing), then writes one event per key through `writeDomainEventOnce` with `occurredAt` from the injected clock, returning the created and skipped ids. The payload is built field by field. `prismaCreateManyClient(db)` adapts a Prisma client to the structural `DomainEventCreateManyClient`; the singleton `licenceNoticeService` uses it over `@/server/db`. No request-only module is imported.
- `event-mappers/licence.ts`: `createLicenceMappers()` returns `{ "licence.notice": mapper }`. The mapper reads `noticeKey` with `requireString`, throws `MalformedEventError` for an unknown key, resolves holders with permission `licence.view` and empty scope, builds copy with `noticeCopy`, and returns per holder a notification (`staff.licence_notice`, `STAFF_LICENCE`, targetId the licence id or `none`, params only `noticeKey` plus present `days`/`expiry`/`graceEnd`) and an email (`staff-licence-notice`, params `headline`, `detail`, `licencePath`, correlation id from `buildCorrelationId(event.id, holderId)`), omitting the email for `expiring-60`.
- `event-intent-mappers.ts`: `createLicenceMappers()` appended to `EVENT_MAPPER_GROUPS`; explanatory comment updated.
- Tests: 10 service tests, 36 mapper tests (incl. a 13-key sweep for rendering and content prohibition), 6 real-Postgres drain tests.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): service, mapper, registration, tests. Commit: none (owner policy)
2. Task 2: 13-key rendering and content-prohibition sweep, days and param-type tests, service shaping tests. Commit: none (owner policy)
3. Task 3: `tests/licence-drain.integration.test.ts` (6 Testcontainers tests). Commit: none (owner policy)

TDD gate: the production files were written before their tests (the plan's action text lists implementation first), so no separate RED run exists, and no `test(...)` or `feat(...)` git commits exist because commits are prohibited by owner policy. All suites passed on first run. To guard against vacuous passes the tests assert exact counts and identities (two holder ids, two rows, zero rows for C/D/E, unchanged counts after re-emit and replay, 2 sends after replay) and the content sweep asserts both forbidden field names and the fixture's actual secret values.

## Tracer gate

Task 1 is `type="tracer"`. Its verify (`npx vitest run tests/licence-notice-service.test.ts tests/event-mappers-licence.test.ts`) was run end to end before expanding: 2 files passed, 45 tests passed. Not `gate="blocking-human"`; the tracer verified green so Tasks 2 and 3 proceeded.

## Verification Results (real output)

- `npx vitest run tests/licence-notice-service.test.ts tests/event-mappers-licence.test.ts --project node`: 2 files, 45 passed (first run, before the adapter test; 46 with it).
- `npx vitest run tests/licence-drain.integration.test.ts --project node --no-file-parallelism`: 1 file, 6 passed (Testcontainers postgres:16, all 24 migrations applied including `20261001120000_licence_deployment_control`; Docker reachable; the shared DATABASE_URL was never used).
- Combined run `tests/licence-notice-service.test.ts tests/event-mappers-licence.test.ts tests/boundary.test.ts tests/licence-purity.test.ts tests/communications-contracts.test.ts tests/event-intent-mappers.test.ts tests/licence-vocabulary.test.ts tests/domain-event-service.test.ts tests/event-mappers-staff.test.ts --project node`: 9 files, 180 passed, 1 failed. The single failure is the pre-existing stale assertion `tests/event-intent-mappers.test.ts > maps a type with no registered mapper to an empty array` (`payment.failed` now has `paymentFailedLearnerMail`), named in the owner's instructions; it is the only failure and is not caused by this plan. It was not fixed.
- Regression: `tests/domain-event-drain.integration.test.ts tests/staff-drain.integration.test.ts tests/licence-drain.integration.test.ts --project node --no-file-parallelism`: 3 files, 28 passed (the new mapper in the live table disturbs neither existing drain suite).
- `tests/event-mappers-support.test.ts` (the other known stale `ticket.created` assertion) was not run.
- `npx tsc --noEmit`: no output, 0 errors in the final state. (An intermediate run reported TS2322 in this plan's own new code, a Prisma client not assignable to `DomainEventCreateManyClient`; fixed, see Deviations.)
- `npx eslint` over `licence-notice-service.ts`, `event-mappers/licence.ts`, `event-intent-mappers.ts` and the three test files: no output, 0 findings.
- Acceptance greps: `licence:` and `writeDomainEventOnce` present in the service; `licence.view` and `staff-licence-notice` present in the mapper; `expiring-60` (6 hits) and `clock-rollback-` (2 hits) in the mapper test; a test asserts `buildMapperTable(EVENT_MAPPER_GROUPS)["licence.notice"]` has length 1.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-14-PLAN.md LIC-07`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-07"
  ],
  "total": 1
}
```

  LIC-07 is NOT marked complete: the scheduled task that calls the notice service (14-16) and the screen and acceptance proof (14-15, 14-21) are still outstanding. `requirements-completed` is empty.

## Files Created/Modified

- `src/server/services/licence-notice-service.ts` - emitter, payload allow-list, `prismaCreateManyClient`, singleton
- `src/server/services/event-mappers/licence.ts` - the `licence.notice` mapper and `createLicenceMappers`
- `src/server/services/event-intent-mappers.ts` - import, registration and comment
- `tests/licence-notice-service.test.ts` - 10 unit tests
- `tests/event-mappers-licence.test.ts` - 36 unit tests (`it.each` over 13 keys twice)
- `tests/licence-drain.integration.test.ts` - 6 real-Postgres tests

## Decisions Made

See key-decisions. Next.js: no Next.js API was written or changed (service, mapper and test code only), so no framework guide applied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A real Prisma client does not satisfy `DomainEventCreateManyClient`**
- **Found during:** Task 3 (tsc after the integration test, and the singleton wiring in Task 1)
- **Issue:** The plan says the singleton is "wired with prisma from @/server/db" and the integration test builds the service over the container client, but 14-08's structural type (`data: Record<string, unknown>[]`) is not assignable from Prisma's generic `createMany` (`DomainEventCreateManyInput` requires `type` and `payload`); tsc reported TS2322 at the singleton and at the test.
- **Fix:** Added an exported adapter `prismaCreateManyClient(db)` in the notice service that narrows the already-shaped row to Prisma's input type in one place, used by the singleton and the integration test, plus a unit test of the pass-through. `domain-event-service.ts` is unchanged (it keeps its no-`@prisma/client` design) and `createLicenceNoticeService(deps: { db: DomainEventCreateManyClient; now? })` keeps the contract signature.
- **Files modified:** src/server/services/licence-notice-service.ts, tests/licence-notice-service.test.ts, tests/licence-drain.integration.test.ts
- **Commit:** none (owner policy)

### Interpretation choices (no change to the interface contract)

- **Whole-word "deployment" in rendered email (plan Task 2 Test 2).** The plan asks that rendered email text and html contain no whole-word "deployment" or "key". The approved 14-06 `noticeCopy.emailDetail` strings (UI-SPEC copy) for the six expiring keys contain the plain-prose phrase "this deployment" (no identifier); 14-08's summary already recorded this. Editing the approved UI-SPEC copy to satisfy the assertion would be a copy change outside this plan, and the plan's own prohibition is on deployment ID/detail (UI-SPEC: "no deployment ID in the email body"). The test therefore asserts: whole-word `key`, `signature` and `contract` are absent; every fixture secret value (deployment ID, key ID, client name, support addresses, licence text) is absent; and after removing the exact phrase "this deployment" no whole-word "deployment" remains. This is a narrowing for one phrase of approved copy, not for any identifier. If the owner wants the word removed from email prose as well, the six `emailDetail` strings in `src/server/licence/policy.ts` and their policy tests would change together; flagged for the owner, not decided here.
- **Forbidden field names are matched case-sensitively** (`deploymentId`, `signature`, `privateKey`, `client`, `contract`), because the closed upper-case reason codes `BAD_SIGNATURE` and `WRONG_DEPLOYMENT` legitimately appear as the `invalid-{code}` notice key and as `reasonCode`. Real secret values are asserted absent separately.
- The in-product notification meta for `invalid-*` keys uses the existing `rejectionSentence(code)` text from 14-06, which for `UNKNOWN_KEY`, `KEY_REVOKED`, `BAD_SIGNATURE` and `WRONG_DEPLOYMENT` mentions the words "signing key", "key", "signature" and "deployment ID" as plain prose (no values). The plan and UI-SPEC constrain the email body and the params, not the rendered notification meta, so no test or copy was changed; noted for the owner alongside the point above.
- Two extra tests beyond the plan's list: the Prisma adapter pass-through, and a second malformed event (missing `noticeKey`) in the poison drain test.

**Total deviations:** 1 rule-based (Rule 3), 4 interpretation choices. **Impact:** none breaks the interface contract.

## Issues Encountered

Only the tsc type mismatch above. No auth gates, no checkpoints, no Rule 4 decisions. A shell heredoc mishap while patching the service (python missing) was recovered with a node fallback; the final file state was inspected and is correct.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema change. The register items are covered: T-14-14-01 (recipients, drain Test 1 and mapper recipient tests), -02 (allow-lists and the 13-key content sweep, drain Test 5), -03 (three dedupe layers, drain Tests 2 and 4), -04 (unknown key rejected in the service and poisoned in the mapper, drain Test 6). T-14-14-05 accepted as planned.

## Next Phase Readiness

- Plan 14-16's scheduled task can call `licenceNoticeService.emitNotices({ snapshot, noticeKeys })` with the `snapshot` and `noticeKeys` from `evaluateAndRecord`; the singleton is already wired over the shared Prisma client.
- Carried forward: the 14-03 migration apply to the shared database remains an outstanding human step (WINDOWS.md entry id 20); this plan used Testcontainers only.
- Broken-windows ledger: no new stub, skipped test or unrun verify was introduced, so nothing was appended to `.planning/WINDOWS.md`.

## Self-Check: PASSED

- FOUND on disk: src/server/services/licence-notice-service.ts, src/server/services/event-mappers/licence.ts, src/server/services/event-intent-mappers.ts (contains createLicenceMappers), tests/licence-notice-service.test.ts, tests/event-mappers-licence.test.ts, tests/licence-drain.integration.test.ts, this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-02*
