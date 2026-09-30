---
phase: 13-transactional-communications-notifications
plan: 13
subsystem: testing
tags: [vitest, prisma, testcontainers, brevo, communications, notifications]

requires:
  - phase: 13-transactional-communications-notifications
    provides: "Every service and mapper the phase built (dispatch, drain, notifications, access, staff alerts, delivery log) across plans 01-12"
provides:
  - "An opt-in, env-guarded live Brevo smoke test closing Phase 3's declined Brevo-outage live check (D-24)"
  - "Six phase-wide invariant tests pinning the permission catalogue size, DomainEventType membership, append-only stores, single sender identity, auth-service isolation, and safe notification rendering"
  - "Two new lint-boundary assertions plus one worker-safe-closure assertion added to tests/boundary.test.ts"
  - "One real-Postgres acceptance test walking all three ROADMAP success criteria for Phase 13 together"
affects: [ship-readiness, phase-14-planning]

actuals:
  tokens: 14000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Real send-path + mocked-SDK-only Brevo verification (vi.mock('@getbrevo/brevo') on the class constructor, everything else real) for asserting actual payload construction rather than a hand-rolled double"
    - "A mutable in-test clock object ({ ms }) passed as the dispatch service's `now` dependency to deterministically drive retry backoff without real sleeps"

key-files:
  created:
    - tests/brevo-live.smoke.test.ts
    - tests/communications-invariants.test.ts
    - tests/communications-e2e.integration.test.ts
    - .planning/phases/13-transactional-communications-notifications/deferred-items.md
  modified:
    - tests/boundary.test.ts

key-decisions:
  - "The permission catalogue invariant asserts 37 entries, not the plan's literal '36' — Phase 11 added certificates.manage after the 36-count language was written, and tests/permissions.test.ts already pins 37 as the live, correct count; asserting 36 would fail against already-correct code (Rule 1)."
  - "Two stale mapper-registration assertions (tests/event-intent-mappers.test.ts's payment.failed-is-unmapped check; tests/event-mappers-support.test.ts's ticket.created-has-one-mapper checks) are pre-existing bugs from Plans 08/10, confirmed to reproduce in complete isolation from this plan's new files, and are explicitly out of this plan's file scope per the executor's scope-boundary rule — logged to deferred-items.md and the WINDOWS.md ledger, not fixed."
  - "Criterion 1 of the acceptance test wires the REAL sendTransactionalEmail (real payload construction, real sender/Reply-To resolution) with only the Brevo SDK class mocked, so 'one sender identity' is proven on actual payload construction; criteria 2 and 3 inject a plain send stub (no SDK mock) since payload identity is already proven and only controllable success/failure timing is needed."

patterns-established:
  - "Phase-wide TypeScript-compiler-API invariant tests (tests/communications-invariants.test.ts) mirror tests/learning-phase-invariants.test.ts and tests/audit-append-only.test.ts's established style — comment-stripped source scans, never a raw text/regex match on live source that could self-invalidate on a comment."

requirements-completed: [COM-01, COM-02, COM-03, COM-04]

coverage:
  - id: D1
    description: "Opt-in live Brevo smoke test (D-24) — skips cleanly without BREVO_LIVE, and is structured to send one real email and prove a live outage degrades safely when run manually with real credentials"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/brevo-live.smoke.test.ts (both cases skipped without BREVO_LIVE — verified exit 0)"
        status: pass
    human_judgment: true
    rationale: "The live-send and live-outage assertions themselves need a real BREVO_API_KEY and network access to Brevo, which this environment does not have — only the skip path (the correct CI-mode outcome) was exercised. A human with real credentials must run BREVO_LIVE=1 to close D-24's manual-only requirement, per 13-VALIDATION.md's Manual-Only Verifications table."
  - id: D2
    description: "Phase 13 structural invariants pinned: permission catalogue size, DomainEventType membership, append-only Notification/EmailPreference/EmailDispatch/DomainEvent, single sender identity with no hard-coded fallback, auth-service isolation from APP_BASE_URL/plain-text bodies, and safe notification-component rendering"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/communications-invariants.test.ts (6/6 pass)"
        status: pass
      - kind: unit
        ref: "tests/boundary.test.ts (27/27 pass, including the 3 new 13-13 assertions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One real-Postgres acceptance test demonstrates all three ROADMAP success criteria together: one templated email per event under one sender/Reply-To; no duplicate EmailDispatch rows across replay, overlap and retry; and notifications report unread/current state and fail safely"
    requirement: "COM-01"
    verification:
      - kind: integration
        ref: "tests/communications-e2e.integration.test.ts (3/3 pass, real Testcontainers Postgres)"
        status: pass
    human_judgment: false

duration: ~2h30m
completed: 2026-09-28
status: complete
---

# Phase 13 Plan 13: Phase Close-Out — Live Smoke, Invariants, and the Acceptance Run Summary

**An opt-in live Brevo smoke test, six phase-wide TypeScript-AST invariant tests, three new boundary.test.ts assertions, and one real-Postgres acceptance test proving all three ROADMAP success criteria together — closing Phase 13.**

## Performance

- **Duration:** ~2h30m
- **Tasks:** 3
- **Files modified:** 5 (3 created, 1 modified, 1 deferred-items log created)
- **Commits:** 0 (intentional — see Commit Policy below)

## Accomplishments

- **Task 1 (tracer):** `tests/brevo-live.smoke.test.ts` — both cases gated on `it.skipIf(!process.env.BREVO_LIVE)`. Case 1 renders the `ticket-reply` template through the real registry and calls the real `sendTransactionalEmail` against `BREVO_LIVE_TO`, asserting a non-`stub:` provider message id. Case 2 spins up a real Testcontainers Postgres, deliberately breaks `BREVO_API_KEY`, drives `sendAuthEmail` through a real prisma-backed dispatch store, and asserts `classifyBrevoFailure` reports `permanent`, the `EmailDispatch` row is `FAILED` with no leaked secret or address, and `sendAuthEmail` still resolves `{ sent: false }` rather than throwing. Verified in this environment: both cases skip cleanly, exit 0 — the correct CI-mode outcome, since `BREVO_LIVE` is unset and no real Brevo credentials exist here.
- **Task 2:** `tests/communications-invariants.test.ts` (6 tests) pins: permission catalogue closure (37 entries, no email/notification identifier), `DomainEventType`'s full membership including `payment.failed`/`payment.refunded`, no hard-delete call on the four append-only stores, no hard-coded sender/support literal or direct `@prisma/client` import under `src/server/email`/`src/server/communications`, the four auth services staying free of direct `APP_BASE_URL` reads and hand-built `textContent`, and no raw hex colour or HTML-injection sink under `src/components/notifications`. `tests/boundary.test.ts` gained two `lintAs` rejections (`src/server/communications/contracts.ts`, `src/server/email/config.ts`) and one closure assertion proving `cleanup-notifications.ts` stays worker-safe alongside the existing `drain-domain-events.ts` closure. All previously-existing `boundary.test.ts` assertions are unchanged.
- **Task 3:** `tests/communications-e2e.integration.test.ts` — one real-Postgres acceptance suite (3 `it` blocks) walking the three ROADMAP success criteria: (1) eight representative lifecycle events (ticket reply, enrolment activation, withdrawal, session cancellation, grade release, certificate issue, payment refund, ticket created) each produce exactly one templated email, all sharing one sender identity and Reply-To, proven against the REAL `sendTransactionalEmail` send path with only the Brevo SDK's network client mocked; (2) replay, two-drain overlap, a transient-failure-then-retry, and a deliberate resend never produce more than one `EmailDispatch` row per `(template, correlationId)`, with the retried row reaching `attempts: 2` and only the deliberate resend triggering a second provider send; (3) unread count and cursor paging are correct and unaffected by listing, opening an ACTIVE-enrolment notification returns a relative href and marks it read, opening a WITHDRAWN-enrolment notification and a stranger's notification both return the identical `{ status: "unavailable" }` outcome (also marked read), and a permanently-failed dispatch produces exactly one `staff.email_failed` alert for the global `audit.view` holder with no extra `EmailDispatch` row.

## Task Commits

None — see **Commit Policy** below.

## Files Created/Modified

- `tests/brevo-live.smoke.test.ts` — opt-in, env-guarded live Brevo smoke + outage check (D-24)
- `tests/communications-invariants.test.ts` — six phase-wide structural invariants
- `tests/communications-e2e.integration.test.ts` — the three-criteria real-Postgres acceptance run
- `tests/boundary.test.ts` — two new `lintAs` Prisma-import rejections + one closure assertion
- `.planning/phases/13-transactional-communications-notifications/deferred-items.md` — pre-existing, out-of-scope failures found during the mandatory `npm test` phase gate

## Decisions Made

1. **Permission catalogue count: 37, not the plan's literal 36.** The plan (and `13-CONTEXT.md`) were written when the catalogue was believed to be 36; Phase 11 (`11-05-SUMMARY.md`) added `certificates.manage`, bringing it to 37 before Phase 13 started, and `tests/permissions.test.ts` already pins 37 as the correct, live count. Asserting the plan's literal 36 would fail against already-correct code — the invariant's actual job (Phase 13 adds no new catalogue identifier) is preserved either way. Documented in the test file's own header comment.
2. **Two stale mapper-registration assertions are Plan 08/10 debt, not this plan's problem.** `tests/event-intent-mappers.test.ts` still expects `payment.failed` to have no mapper (Plan 08 added one); `tests/event-mappers-support.test.ts` still expects `ticket.created` to have exactly one mapper (Plan 11 added a second, staff-facing one — and Plan 11's own summary records catching and fixing the identical mistake in a *new* test it wrote, without going back to fix this pre-existing file). Reproduced in total isolation from every 13-13 file. Logged to `deferred-items.md` and the `WINDOWS.md` ledger (entries 18-19); not fixed, per the executor's scope-boundary rule.
3. **Criterion 1 uses the real send path with only the Brevo SDK class mocked; criteria 2/3 use a plain injected `send` stub.** This proves "one sender identity" on actual `sendTransactionalEmail`/`buildTransactionalEmailPayload` construction (real config resolution, real template rendering) rather than a hand-rolled double repeating that logic, while criteria 2 and 3 — which only need controllable success/failure timing for dedup/retry/alert proofs — reuse the simpler, already-established convention from `tests/domain-event-drain.integration.test.ts`.
4. **A mutable `{ ms }` clock object drives retry-backoff timing deterministically.** Passed as the dispatch service's `now` dependency so criterion 2's transient-failure-then-retry case can jump past the 60s D-03 backoff window without a real sleep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, test-only] A "score never leaks" assertion collided with random cuids/timestamps**
- **Found during:** Task 3, first real run of criterion 1
- **Issue:** `expect(serialized).not.toContain("97")` (checking a fixture `score: 97` never reaches a captured payload) false-failed because the digits "97" appear coincidentally inside unrelated cuids and millisecond timestamps in the same serialized payload array.
- **Fix:** Replaced the substring check with a structural one — asserting no persisted `EmailDispatch.templateParams` object ever carries a `score` key at all — which is both more precise and immune to incidental digit collisions. The distinct-string fixture-reason checks (`withdrawalReason`, `refundReason`) were kept as substring matches since those literals are long and specific enough not to collide.
- **Files modified:** `tests/communications-e2e.integration.test.ts`
- **Verification:** Re-ran `npx vitest run tests/communications-e2e.integration.test.ts --no-file-parallelism` — 3/3 pass.

**2. [Rule 1 - Bug, test-only] `classifyFailure` was hardcoded "transient" in the shared drain helper, breaking criterion 3's permanent-failure alert test**
- **Found during:** Task 3, while wiring the shared `buildStubSendDrain` helper for criteria 2 and 3
- **Issue:** The helper hardcoded `classifyFailure: () => "transient"`, matching criterion 2's retry-then-succeed need — but criterion 3 needs a genuinely *permanent* classification so the failing dispatch goes straight to `FAILED` (and triggers the staff alert) instead of being retried.
- **Fix:** Added a `classification: "transient" | "permanent"` parameter to `buildStubSendDrain` (default `"transient"`), and criterion 3 passes `"permanent"` explicitly.
- **Files modified:** `tests/communications-e2e.integration.test.ts`
- **Verification:** Criterion 3's `failResult.failed` assertion and the single `staff.email_failed` alert assertion both pass.

**3. [Rule 1 - Bug, lint] Two lint warnings introduced by this plan's own new files**
- **Found during:** Phase-gate `npm run lint`
- **Issue:** (a) An unused `eslint-disable-next-line no-console` comment in `tests/brevo-live.smoke.test.ts` (the rule was never actually triggering). (b) An unused `sessionEnrolment` destructure in `tests/communications-e2e.integration.test.ts` (the enrolment id itself is never read — `session.cancelled` fans out by cohort/session id, not enrolment id).
- **Fix:** Removed the stray disable comment; removed the unused variable binding with an explanatory comment in its place.
- **Files modified:** `tests/brevo-live.smoke.test.ts`, `tests/communications-e2e.integration.test.ts`
- **Verification:** `npm run lint` — zero warnings/errors attributable to any of this plan's files.

---

**Total deviations:** 3 auto-fixed (all Rule 1, all self-caught within this plan's own new test files — no production code touched, matching the plan's "no production code" objective).
**Impact on plan:** All three fixes correct bugs in this plan's own newly-written test assertions/lint hygiene. No scope creep; no other file touched beyond what the plan named.

## Issues Encountered

- **Pre-existing test failures during the mandatory `npm test` phase gate.** The full suite (`npm test`, ~36 minutes, 4575 tests across 318 files) reported 7 failed files / 24 failed tests. All were confirmed pre-existing and unrelated to this plan (see `deferred-items.md` for full detail and reproduction commands):
  - `tests/event-intent-mappers.test.ts` (1) and `tests/event-mappers-support.test.ts` (3) — stale mapper-count assertions from Plans 08/10, reproduced in isolation from any 13-13 file.
  - `tests/certificate-download.integration.test.ts` (3), `tests/certificate-unicode-file.integration.test.ts` (8), `tests/submission-service.integration.test.ts` (5) — `ECONNREFUSED 127.0.0.1:9002`: the MinIO object-storage container (`docker-compose.yml`'s `minio` service) was not running for this session, only the Postgres dev container and each test file's own Testcontainers Postgres.
  - `tests/schema-cohort.test.ts` (1, `afterAll` hook 300s timeout) and `tests/certificate-revocation.test.ts` (2, 5s test timeout) — apparent resource-contention flakes under the full ~36-minute combined-load run; both are unrelated content (Phase 5/11), and unlikely to reflect a real logic defect.
  - **This plan's own files (`tests/brevo-live.smoke.test.ts`, `tests/communications-invariants.test.ts`, `tests/communications-e2e.integration.test.ts`, and the `tests/boundary.test.ts` additions) contributed zero failures to this run.** They were also independently re-verified together via the plan's exact `<verification>` command (`npx vitest run tests/communications-invariants.test.ts tests/communications-e2e.integration.test.ts tests/brevo-live.smoke.test.ts tests/boundary.test.ts --no-file-parallelism`), which passed 33/33 (2 correctly skipped).
- **Docker was available and used as expected.** `postgres:16-alpine` via Testcontainers started successfully for both `tests/brevo-live.smoke.test.ts`'s case 2 (which was skipped, so the container never actually started for this run) and `tests/communications-e2e.integration.test.ts` (which did start it, ran all migrations, and ran all three criteria against it).
- **A transient `boundary.test.ts` timeout (unrelated to this plan) self-resolved on retry.** Running `communications-invariants.test.ts` + `boundary.test.ts` together once hit a pre-existing 5000ms default-timeout flake in `boundary.test.ts`'s pdf-lib-importer full-`src/`-tree walk (CPU contention from two heavy filesystem-walking files running back to back). Re-ran cleanly (30/30) twice afterward; not touched.

## Phase-Gate Check Results

| Check | Command | Result |
|---|---|---|
| Plan verification | `npx vitest run tests/communications-invariants.test.ts tests/communications-e2e.integration.test.ts tests/brevo-live.smoke.test.ts tests/boundary.test.ts --no-file-parallelism` | **PASS** — 33 passed, 2 skipped (live Brevo cases, correct without `BREVO_LIVE`), 0 failed |
| Full suite | `npm test` | **7 files / 24 tests failed** — all pre-existing and unrelated to this plan (see Issues Encountered / `deferred-items.md`); 310 files / 4548 tests passed, 3 skipped |
| Lint | `npm run lint` | **14 errors** in `.kilo/worktrees/soft-cord/` (a `.git/info/exclude`-ignored local artifact directory, confirmed via `git check-ignore`, entirely unrelated to this plan) + 47 pre-existing warnings elsewhere. **Zero errors/warnings from any file this plan touched.** |
| TypeScript | `npx tsc --noEmit` | **PASS** — clean, no output |
| Prisma | `npx prisma validate` | **PASS** — "The schema ... is valid" |

## Commit Policy

**This plan made zero git commits**, per explicit run-level instruction overriding the standard per-task-commit executor workflow. This matches Plans 07-10 and 12's convention in this same phase (per `STATE.md`'s own note: "commits are only made when the user explicitly asks, even if offered as a menu option"). All changes — the three new test files, the `tests/boundary.test.ts` additions, and this SUMMARY.md — are left uncommitted in the working tree.

## User Setup Required

**D-24's live Brevo check remains a manual-only step**, per `13-VALIDATION.md`'s Manual-Only Verifications table. A human with a real `BREVO_API_KEY` must run:
```
BREVO_LIVE=1 BREVO_LIVE_TO=<a mailbox you control> BREVO_API_KEY=<real key> \
EMAIL_SENDER_NAME=<approved name> EMAIL_SENDER_ADDRESS=<verified address> \
SUPPORT_CONTACT_EMAIL=<support mailbox> APP_BASE_URL=<public origin> \
npx vitest run tests/brevo-live.smoke.test.ts
```
and confirm receipt, the From identity, and the Reply-To header in that mailbox. Without this, D-24 is only closed at the CI/skip level (verified: the file exits 0 with both cases skipped), not at the "real send actually works" level.

## Next Phase Readiness

**Phase 13's three ROADMAP success criteria are now demonstrated together against a real database**, closing out the phase's final plan. Outstanding before Phase 13 can be marked fully done in `ROADMAP.md`/`state.json`:

1. **The two pre-existing stale test assertions** (`tests/event-intent-mappers.test.ts`, `tests/event-mappers-support.test.ts`) should be fixed in a small follow-up — they are one-line count corrections, not design questions (see `deferred-items.md` item 1 for the exact fix).
2. **MinIO should be started** (`docker compose up -d minio`) before the next full-suite run to confirm the 11 MinIO-dependent test failures are purely environmental, not regressions.
3. **D-24's live Brevo smoke check** is still human-needed with real credentials (see User Setup Required above).
4. **This plan's own three new test files plus the `tests/boundary.test.ts` additions are fully green** and were independently re-verified against the plan's exact `<verification>` command — no blocker from this plan's own scope.

No production code was touched by this plan, matching its stated objective.

## Self-Check: PASSED

All 5 claimed files confirmed present on disk:
- `tests/brevo-live.smoke.test.ts` — FOUND
- `tests/communications-invariants.test.ts` — FOUND
- `tests/communications-e2e.integration.test.ts` — FOUND
- `.planning/phases/13-transactional-communications-notifications/deferred-items.md` — FOUND
- `.planning/phases/13-transactional-communications-notifications/13-13-SUMMARY.md` — FOUND

No commit hashes to verify (zero commits made, per Commit Policy above). The plan's `<verification>` command was independently re-run after every fix and passed 33/33 (2 correctly skipped) on its final run.

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-28*
