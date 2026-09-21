---
phase: 12
slug: support-tickets
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| SUP-01 | T-12-01, T-12-05 | Only the owner creates/views a ticket; categories and attachments use closed allow-lists | unit + integration | `npx vitest run tests/ticket-service.test.ts tests/ticket-access.integration.test.ts` | ❌ W0 | ⬜ pending |
| SUP-01 | T-12-05, T-12-06 | Attachment intent/complete/download is owner/staff authorized, metadata-verified, READY-only, private/no-store | unit + route | `npx vitest run tests/ticket-attachment-service.test.ts tests/ticket-attachment-download-route.test.ts` | ❌ W0 | ⬜ pending |
| SUP-02 | T-12-01, T-12-04 | State transitions are valid, version-protected, attributed, immutable, and reason-gated | unit + integration | `npx vitest run tests/ticket-lifecycle.test.ts tests/ticket-concurrency.integration.test.ts` | ❌ W0 | ⬜ pending |
| SUP-02 | T-12-01 | Learner projections and downloads reveal no internal-note body, metadata, count, filename, or existence signal | negative security | `npx vitest run tests/ticket-privacy.test.ts` | ❌ W0 | ⬜ pending |
| SUP-03 | T-12-02 | A ticket-only Support Agent manages tickets but remains denied users, roles, payments, and grades | integration | `npx vitest run tests/ticket-rbac.integration.test.ts` | ❌ W0 | ⬜ pending |
| SUP-04 | T-12-07 | Escalation requires a reason, preserves history, stays Escalated until accepted, emits no private content | unit | `npx vitest run tests/ticket-service.test.ts -t escalation` | ❌ W0 | ⬜ pending |
| SUP-05 | T-12-03 | Ticket access never grants target-record access; locked references disclose safe identifiers only | unit + route | `npx vitest run tests/ticket-context.test.ts` | ❌ W0 | ⬜ pending |
| SUP-06 | T-12-01, T-12-09 | Dashboard and CSV reconcile for identical filters; export has no message/attachment data and gates identity | unit + integration | `npx vitest run tests/support-report.test.ts tests/support-report.integration.test.ts` | ❌ W0 | ⬜ pending |
| D-04 | T-12-08 | Reopen/close obey seven-day boundary; auto-close cannot overwrite a concurrent learner action | unit + integration | `npx vitest run tests/ticket-auto-close.test.ts tests/ticket-concurrency.integration.test.ts` | ❌ W0 | ⬜ pending |
| D-11–D-15 | T-12-01, T-12-07 | Separate composers, amber Staff only treatment, public review, immutable timeline | component | `npx vitest run tests/components/support-workspace.test.tsx` | ❌ W0 | ⬜ pending |

## Wave 0 Requirements

- [ ] `tests/ticket-lifecycle.test.ts` — pure transition table and seven-day boundary.
- [ ] `tests/ticket-service.test.ts` — aggregate commands, reasons, timestamps, event/audit/outbox behavior.
- [ ] `tests/ticket-privacy.test.ts` — internal-note non-disclosure across learner projections.
- [ ] `tests/ticket-attachment-service.test.ts` and `tests/ticket-attachment-download-route.test.ts` — direct private-file lifecycle.
- [ ] `tests/ticket-access.integration.test.ts`, `tests/ticket-rbac.integration.test.ts`, and `tests/ticket-concurrency.integration.test.ts` — real PostgreSQL ownership/RBAC/race proof.
- [ ] `tests/ticket-context.test.ts` — permission-rechecked target links and locked safe references.
- [ ] `tests/support-report.test.ts` and `tests/support-report.integration.test.ts` — metrics/export reconciliation and private-content exclusion.
- [ ] `tests/ticket-auto-close.test.ts` — bounded scheduled close service.
- [ ] `tests/components/support-workspace.test.tsx` and `tests/components/learner-support.test.tsx` — UI interaction and disclosure states.
- [ ] Framework install: none; existing Vitest/jsdom/Testcontainers infrastructure is sufficient.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Learner and staff ticket journeys remain understandable and usable at desktop and narrow mobile widths | SUP-01, SUP-02 | Visual hierarchy, focus flow, and responsive chronology require human review | Run the final browser walkthrough as learner and custom Support Agent; create, attach, reply, note, escalate, resolve, reopen, and verify no internal trace on learner surfaces. |
| Netlify scheduled automatic closure is registered and executes in the deployed environment | D-04 | Scheduled functions do not run automatically on deploy previews | Confirm the function has a Scheduled badge, manually invoke it with an eligible test ticket, and inspect bounded processed/failed logs. |
| Cloudflare R2 remains private and attachment disposition is safe | SUP-01 | Deployment CORS/bucket policy is external state | Confirm direct bucket URL is denied, authorized ticket download redirects briefly, and browser handles the file as an attachment. |

## Validation Sign-Off

- [ ] All tasks have automated verification or explicit Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verification.
- [ ] Wave 0 covers all missing references.
- [ ] No watch-mode flags.
- [ ] Feedback latency under 30 seconds for targeted tests.
- [ ] `nyquist_compliant: true` set after the final plan map is populated.

**Approval:** pending plan generation and UI-SPEC integration
