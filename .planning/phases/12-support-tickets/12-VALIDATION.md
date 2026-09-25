---
phase: 12
slug: support-tickets
status: reconciled
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-21
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11, Node + jsdom projects; Testcontainers PostgreSQL for concurrency/integration proof |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run tests/ticket-lifecycle.test.ts tests/ticket-service.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | Targeted tests under 30 seconds; full suite duration depends on Docker-backed integration availability |

## Sampling Rate

- **After every task commit:** Run the targeted test file(s) named by that task.
- **After every plan wave:** Run `npm test` and `npm run lint`.
- **Before `$gsd-verify-work`:** Full suite, production build, Prisma validation/generation, migration proof, and targeted real-Postgres concurrency/privacy tests must be green.
- **Max feedback latency:** 30 seconds for ordinary unit/component task sampling.

## Per-Requirement Verification Map

| Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| SUP-01 | T-12-01, T-12-05 | Only the owner creates/views a ticket; categories and attachments use closed allow-lists | unit + integration | `npx vitest run tests/ticket-service.test.ts tests/ticket-access.integration.test.ts` | ✅ | ✅ green (12-09) |
| SUP-01 | T-12-05, T-12-06 | Attachment intent/complete/download is owner/staff authorized, metadata-verified, READY-only, private/no-store | unit + route | `npx vitest run tests/ticket-attachment-service.test.ts tests/ticket-attachment-download-route.test.ts` | ✅ | ✅ green (12-09) |
| SUP-02 | T-12-01, T-12-04 | State transitions are valid, version-protected, attributed, immutable, and reason-gated | unit + integration | `npx vitest run tests/ticket-lifecycle.test.ts tests/ticket-concurrency.integration.test.ts` | ✅ | ✅ green (12-09) |
| SUP-02 | T-12-01 | Learner projections and downloads reveal no internal-note body, metadata, count, filename, or existence signal | negative security | `npx vitest run tests/ticket-privacy.test.ts` | ✅ | ✅ green (12-09) |
| SUP-03 | T-12-02 | A ticket-only Support Agent manages tickets but remains denied users, roles, payments, and grades | integration | `npx vitest run tests/ticket-rbac.integration.test.ts` | ✅ | ✅ green (12-09) |
| SUP-04 | T-12-07 | Escalation requires a reason, preserves history, stays Escalated until accepted, emits no private content | unit | `npx vitest run tests/ticket-service.test.ts -t escalation` | ✅ | ✅ green (12-09) |
| SUP-05 | T-12-03 | Ticket access never grants target-record access; locked references disclose safe identifiers only | unit + route | `npx vitest run tests/ticket-context.test.ts` | ✅ | ✅ green (12-09) |
| SUP-06 | T-12-01, T-12-09 | Dashboard and CSV reconcile for identical filters; export has no message/attachment data and gates identity | unit + integration | `npx vitest run tests/support-report.test.ts tests/support-report.integration.test.ts` | ✅ | ✅ green (12-09) |
| D-04 | T-12-08 | Reopen/close obey seven-day boundary; auto-close cannot overwrite a concurrent learner action | unit + integration | `npx vitest run tests/ticket-auto-close.test.ts tests/ticket-concurrency.integration.test.ts` | ✅ | ✅ green (12-09) |
| D-11–D-15 | T-12-01, T-12-07 | Separate composers, amber Staff only treatment, public review, immutable timeline | component | `npx vitest run tests/components/support-workspace.test.tsx` | ✅ | ✅ green (12-09) |

## Wave 0 Requirements

- [x] `tests/ticket-lifecycle.test.ts` — pure transition table and seven-day boundary.
- [x] `tests/ticket-service.test.ts` — aggregate commands, reasons, timestamps, event/audit/outbox behavior.
- [x] `tests/ticket-privacy.test.ts` — internal-note non-disclosure across learner projections.
- [x] `tests/ticket-attachment-service.test.ts` and `tests/ticket-attachment-download-route.test.ts` — direct private-file lifecycle.
- [x] `tests/ticket-access.integration.test.ts`, `tests/ticket-rbac.integration.test.ts`, and `tests/ticket-concurrency.integration.test.ts` — real PostgreSQL ownership/RBAC/race proof.
- [x] `tests/ticket-context.test.ts` — permission-rechecked target links and locked safe references.
- [x] `tests/support-report.test.ts` and `tests/support-report.integration.test.ts` — metrics/export reconciliation and private-content exclusion.
- [x] `tests/ticket-auto-close.test.ts` — bounded scheduled close service.
- [x] `tests/components/support-workspace.test.tsx` and `tests/components/learner-support.test.tsx` — UI interaction and disclosure states.
- [ ] Framework install: none; existing Vitest/jsdom/Testcontainers infrastructure is sufficient.

## Plan Verification Map

| Plan | Automated sampling | Requirements / decisions |
|------|--------------------|--------------------------|
| 12-01 | Prisma validate/migrate/generate/typecheck; lifecycle/reference unit tests | SUP-01, SUP-02, SUP-04, SUP-05; D-02, D-03, D-04, D-08, D-09, D-13, D-15, D-18 |
| 12-02 | aggregate/privacy/context unit tests; Support Agent PostgreSQL RBAC | SUP-01–SUP-05; D-04–D-15, D-18 |
| 12-03 | attachment service/route/cleanup and boundary tests | SUP-01, SUP-02; D-03, D-05, D-11, D-14 |
| 12-04 | auto-close unit/boundary and PostgreSQL concurrency tests | SUP-02; D-04 |
| 12-05 | learner support list/create/detail component and action tests | SUP-01, SUP-02, SUP-05; D-01–D-05, D-14 |
| 12-06 | dashboard ticket summary and contextual-entry service/component tests | SUP-01, SUP-05; D-01, D-05, D-14, D-18 |
| 12-07 | staff queue/detail/action/route component tests | SUP-02–SUP-05; D-06–D-15, D-18 |
| 12-08 | report registry/query/component/export and PostgreSQL reconciliation tests | SUP-06; D-09, D-16–D-20 |
| 12-09 | cross-surface attack matrix; full Prisma/type/lint/test/build gates; deployed human checkpoint | SUP-01–SUP-06; all security/privacy and external-state contracts |

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Learner and staff ticket journeys remain understandable and usable at desktop and narrow mobile widths | SUP-01, SUP-02 | Visual hierarchy, focus flow, and responsive chronology require human review | Run the final browser walkthrough as learner and custom Support Agent; create, attach, reply, note, escalate, resolve, reopen, and verify no internal trace on learner surfaces. |
| Netlify scheduled automatic closure is registered and executes in the deployed environment | D-04 | Scheduled functions do not run automatically on deploy previews | Confirm the function has a Scheduled badge, manually invoke it with an eligible test ticket, and inspect bounded processed/failed logs. |
| Cloudflare R2 remains private and attachment disposition is safe | SUP-01 | Deployment CORS/bucket policy is external state | Confirm direct bucket URL is denied, authorized ticket download redirects briefly, and browser handles the file as an attachment. |

## Validation Sign-Off

- [x] All 25 planned tasks have an `<automated>` verification command; the deployed walkthrough additionally remains a blocking human checkpoint.
- [x] Sampling continuity: no task lacks automated sampling, so no 3-task gap exists.
- [x] Wave 0 names every missing test artifact and each artifact is assigned to a concrete plan.
- [x] No watch-mode flags appear in the plan set.
- [x] Ordinary unit/component task commands are scoped to the 30-second target; explicitly serial Docker/full-suite gates are final-wave exceptions.
- [x] `nyquist_compliant: true` is set after mapping every validation row to plans 12-01 through 12-09.

**Approval:** automated evidence reconciled by plan 12-09 (see Reconciliation Evidence). The three Manual-Only rows remain OPEN until the blocking deployed walkthrough (12-09 Task 3) is signed off; they are not converted to automated passes.

## Reconciliation Evidence (plan 12-09, 2026-09-25)

| Gate | Result |
|------|--------|
| `npx prisma validate` | exit 0 (schema valid) |
| `npx prisma migrate status` | Against the configured remote (Neon) dev DB: migration `20260925120000_ticket_queue_changed_event` is NOT yet applied. Not applied by the executor (shared remote DB). Real-Postgres suites apply all 18 migrations to a testcontainers DB and pass. Must be applied via `prisma migrate deploy` before the deployed walkthrough. |
| `npx prisma generate` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| Focused Phase 12 suites (18 files, 135 tests, Docker/testcontainers) | all pass |
| Task 1 matrix (7 files, 40 tests incl. new `ticket-access.integration.test.ts` and `ticket-phase-invariants.test.ts`) | all pass, real PostgreSQL |
| `tests/components/support-workspace.test.tsx` | 32 pass (4 added: long-content wrap, tab strip overflow, focus restoration, alert region) |
| `npm test` (full, `--no-file-parallelism`) | 274 files, 3710 passed, 1 skipped (`tests/components/audit-table.test.tsx`, pre-existing, unrelated) |
| `npm run build` | succeeds; `/support`, `/support/new`, `/support/[reference]`, `/staff/support`, `/staff/support/[reference]` and the ticket-attachment routes present |
| `npm run lint` | 3 errors + 20 warnings remain, all in files outside Phase 12 (`tests/certificate-pdf-unicode.test.ts` no-explicit-any x3; warnings in unrelated tests). The 15 `no-explicit-any` errors in `ticket-service.ts` were fixed. Logged as a deferred item, not fixed. |
| `git diff --check` | clean |

### Known automated gaps (recorded, not hidden)

- No axe/browser accessibility run; keyboard/focus/aria are asserted in jsdom only. Real mobile reflow is human-verified only.
- No `loading.tsx` skeleton for support routes (pages are server-rendered); UI-SPEC 8.1 skeleton requirement is not implemented.
- Staff queue filtering runs in memory (12-07); acceptable at current scale, not load-tested.
- Attachment storage (R2 inspect/promote/presign) is exercised with an in-memory store; real R2 behavior is Manual-Only.
- Sweep of stale UPLOADING ticket attachments has no real-DB test.
- Manual-Only rows (responsive journeys, Netlify scheduled function, R2 privacy/disposition): PENDING human sign-off.
