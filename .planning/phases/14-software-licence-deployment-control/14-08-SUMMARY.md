---
phase: 14-software-licence-deployment-control
plan: 08
subsystem: communications
tags: [licence, notifications, domain-event, email-template, dedupe, d-15, lic-07]
status: complete

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-06 noticeCopy (closed notice copy set) in src/server/licence/policy.ts; Phase 13 communications vocabularies"
provides:
  - "writeDomainEventOnce(client, event & { id }) and DomainEventCreateManyClient: once-only outbox insert via createMany skipDuplicates"
  - "Domain event type licence.notice; notification type staff.licence_notice (target STAFF_LICENCE); template staff-licence-notice (category STAFF); LICENCE_PATH; createStaffLicenceResolver"
  - "Allow-listed notification params noticeKey, days, expiry, graceEnd"
affects: [14-14, 14-15, 14-16]

estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 2
  confidence: low
actuals:
  tokens: 8460
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Deterministic-id once-only event write: createMany with skipDuplicates never raises a unique violation, so it cannot abort the caller's Postgres transaction; no new dedupe table"
    - "Total Record vocabularies (NOTIFICATION_TYPE_TARGET, NOTIFICATION_TEXT_BUILDERS, TEMPLATE_REGISTRY, DOMAIN_EVENT_TYPE_SET) force the licence entry at compile time"

key-files:
  created:
    - tests/licence-vocabulary.test.ts
  modified:
    - src/server/services/domain-event-service.ts
    - src/server/communications/contracts.ts
    - src/server/communications/links.ts
    - src/server/communications/notification-text.ts
    - src/server/email/templates/staff-templates.ts
    - src/server/services/notification-access-service.ts
    - tests/domain-event-service.test.ts
    - tests/communications-contracts.test.ts
    - tests/notification-text.test.ts
    - tests/communication-links.test.ts
    - tests/email-templates.test.ts
    - tests/notification-access-service.test.ts

key-decisions:
  - "The staff-licence-notice sample detail omits the word 'deployment' (plan Test 4 forbids it in template-authored parts); the real noticeCopy emailDetail strings from 14-06 do contain 'this deployment' as plain prose (no deployment ID), which D-14/D-15 allow, and are not changed here"
  - "The notification-text raw-key assertion applies only to keys that are not themselves ordinary title words (expired, restricted legitimately appear in titles); keys with a suffix or hyphenated identifier are asserted absent"

patterns-established:
  - "A new notification target adds its path constant to links.ts, its resolver factory to notification-access-service.ts and registers it in the live resolvers map in the same change"

requirements-completed: []

coverage:
  - id: C1
    description: "D-15: one licence.notice event type, one staff.licence_notice notification type (STAFF_LICENCE), one staff-licence-notice template (STAFF, never mutable) and one resolver added to the Phase 13 pipeline; no new table or delivery path"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/licence-vocabulary.test.ts (16 tests) and tests/communications-contracts.test.ts (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "LIC-07 dedupe: writeDomainEventOnce preserves the supplied id and passes skipDuplicates true; returns true on count 1 and false on count 0"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/licence-vocabulary.test.ts and tests/domain-event-service.test.ts (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "T-14-08-01/02: notification text from the closed noticeCopy set; unknown key renders the generic title; non-allow-listed params, the word reason and the raw key never appear; email has no whole-word deployment or key in template-authored parts and subject equals the headline"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/notification-text.test.ts, tests/email-templates.test.ts, tests/licence-vocabulary.test.ts (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "T-14-08-03: opening a STAFF_LICENCE notification re-checks can(licence.view, {}); denial yields the identical unavailable outcome"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/notification-access-service.test.ts (createStaffLicenceResolver and resolveOpen cases) (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "Exhaustive vocabularies stay total: 29 template ids, 29 categories, 28 notification types, 28 type-target entries, 11 target types; project type-checks"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/communications-contracts.test.ts, npx tsc --noEmit (0 errors)"
        status: pass
    human_judgment: false
---

# Phase 14 Plan 08: Licence Notice Vocabulary Summary

**A licence notice now has a typed domain event, notification type and target, rendered text, staff email template, permission-checked open resolver and a once-only event writer (createMany skipDuplicates), all inside the existing Phase 13 pipeline with no new table.**

## What was built

- `writeDomainEventOnce(client, event & { id })` in `domain-event-service.ts` (with `DomainEventCreateManyClient`): builds the redacted row via `buildDomainEventRow`, adds the caller's deterministic id and calls `createMany({ data: [row], skipDuplicates: true })`; returns `count > 0`. `writeDomainEvent` is unchanged. The `licence.notice` union member carries a comment that its payload holds no signing or contract detail.
- `contracts.ts`: `licence.notice` in `DOMAIN_EVENT_TYPE_SET`; `STAFF_LICENCE` target; `staff.licence_notice` type mapped to `STAFF_LICENCE`; `staff-licence-notice` template id mapped to `STAFF`. Counts are now 29 template ids and categories, 28 notification types and type-target entries, 11 target types.
- `links.ts`: `LICENCE_PATH = "/staff/licence"` and the `STAFF_LICENCE` case before the exhaustive `never` branch.
- `notification-text.ts`: allow-listed `noticeKey`, `days`, `expiry`, `graceEnd`; `staff.licence_notice` builder calls `noticeCopy` and returns title and meta only.
- `staff-templates.ts`: `staff-licence-notice` (subject and heading equal the headline, one detail paragraph, "Review licence" button to the absolute `/staff/licence` URL) and its sample.
- `notification-access-service.ts`: `createStaffLicenceResolver(can)` (`can("licence.view", {})`) registered for `STAFF_LICENCE` with `liveCan`.
- Tests: new `tests/licence-vocabulary.test.ts` (16 tests) and updated exact-list tests in six existing files.

## Verification (real output)

- `npx tsc --noEmit`: 0 errors, no output.
- `npx vitest run tests/licence-vocabulary.test.ts --project node`: 16 passed.
- `npx vitest run` over the seven Task 2 files `--project node`: 7 files, 407 tests passed.
- `npx eslint` over all 13 touched files: clean.
- Extra check `tests/event-intent-mappers.test.ts tests/components/email-log-table.test.tsx tests/licence-purity.test.ts`: 45 passed, 1 failed. The one failure is the pre-existing stale `payment.failed` mapper assertion named in the plan objective (STATE.md baseline), not caused by this plan.

## Tracer gate

Task 1 is `type="tracer"`. After its commit-equivalent (no commit per owner policy) the verify command was re-run end to end (`npx tsc --noEmit` clean, 16 licence-vocabulary tests passed) before Task 2 expanded the exhaustive tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan sample wording conflicted with its own no-"deployment" assertion**
- **Found during:** Task 1 (writing the sample and Test 4)
- **Issue:** The first draft of the sample detail reused noticeCopy prose ("The licence for this deployment expires soon"), which fails Test 4's whole-word "deployment" check on template-authored parts.
- **Fix:** Sample detail is "The licence expires soon. Open Licence to see the dates and renewal contact." The real 14-06 `emailDetail` strings (which say "this deployment" as plain prose, never an ID) were left unchanged; the extra test over all notice keys asserts no `key`, `signing` or `contract` wording, matching D-14/D-15.
- **Files modified:** src/server/email/templates/staff-templates.ts
- **Commit:** none (owner policy: commits only on explicit request)

**2. [Rule 1 - Bug] Test authoring errors in my own tests**
- **Found during:** Task 2
- **Issue:** A `"\n"` escape was written as a literal newline in `tests/email-templates.test.ts` (TS1002), and the "no raw key" assertion wrongly flagged the plain word "expired" that is legitimately part of a title.
- **Fix:** Corrected the escape; narrowed the raw-key assertion to keys with a hyphenated or suffixed identifier.
- **Files modified:** tests/email-templates.test.ts, tests/notification-text.test.ts
- **Commit:** none (owner policy)

### Plan wording note

Task 2 asks to "extend the live-resolver assertion that every target type has a resolver". No such live-map assertion exists in `tests/notification-access-service.test.ts` (the live service builds its resolvers from the Prisma singleton and is not introspectable). I extended the equivalent per-target describe (renamed "all eleven NOTIFICATION_TARGET_TYPES") with a `STAFF_LICENCE` allowed and denied case through `resolveOpen`, and registered the resolver in the live map; the `Record`-typed resolvers map is checked by `tsc`.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths or schema changes; the one new permission-sensitive surface (STAFF_LICENCE open) is the plan's own T-14-08-03 mitigation.

## Requirement status

LIC-07 is NOT marked complete by this plan: `requirements ready-ids` reported it blocked (notice generation, delivery and the screen land in later plans, for example 14-14). This plan delivers only the shared vocabulary.

```
{
  "ready": [],
  "blocked": [
    "LIC-07"
  ],
  "total": 1
}
```

## Commits

None (owner policy: commits only on explicit request). All changes are in the working tree.

## Self-Check: PASSED

All created and modified files verified present on disk (see below); commits are intentionally none.
