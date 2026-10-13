---
phase: "15"
slug: "launch-readiness-nfr-verification-operational-cutover"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-06"
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from the template; the per-requirement test types, commands and Wave 0 gaps are in `15-RESEARCH.md` → `## Validation Architecture`. The planner copies them into the Per-Task Verification Map below.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.11 (unit + real-Postgres integration); Playwright and k6 to be added in Wave 0 (see research) |
| **Config file** | `vitest.config.mts`, `vitest.perf.config.mts` |
| **Quick run command** | `npx vitest run <changed test files> --no-file-parallelism` |
| **Full suite command** | `npm test` (memory-limited machine: run in small batches; whole-tree scans need `--testTimeout=60000`) |
| **Estimated runtime** | Unit and component files under 60 s each; Testcontainers integration files 1 to 5 min each; Playwright specs 2 to 15 min; the full suite runs in CI (sharded), never whole on the dev machine |

---

## Sampling Rate

- **After every task:** Run the quick run command for the files the task touched
- **After every plan wave:** Run the batched full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 minutes per task (one test file or a small batch); load, probe and staging runs are bounded by their own scripted durations

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01/02 | 01 | 1 | NFR-09, NFR-11 | T-15-01-01..03 | Owner decides captions and privacy permission (blocking-human) | decision | — (checkpoint) | n/a | ⬜ pending |
| 15-01-03 | 01 | 1 | NFR-09, NFR-11 | T-15-01-04 | Decisions, ledger, ownership, index recorded | doc check | node heading check on 15-DECISIONS.md | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | NFR-04 | T-15-02-01 | Critical next advisory fixed, never waived | audit + tsc | `npm audit --omit=dev --audit-level=high` + tsc + aws-sdk-lockfile test | ✅ | ⬜ pending |
| 15-02-02/03 | 02 | 1 | NFR-04, NFR-12 | T-15-02-02..04 | CI least privilege, SHA pins, Dependabot pins | unit | `npx vitest run tests/ci-config.test.ts tests/aws-sdk-lockfile.test.ts` | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 1 | NFR-04 | T-15-03-01/02 | Register limited per device, neutral, audited | unit | `npx vitest run tests/rate-limit.test.ts tests/register-action.test.ts tests/licence-enforcement-boundary.test.ts --testTimeout=60000` | ❌ W0 | ⬜ pending |
| 15-03-02 | 03 | 1 | NFR-04, NFR-07 | T-15-03-01/02/05 | Atomic counter, no enumeration | integration | `npx vitest run tests/rate-limit.integration.test.ts --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 15-03-03 | 03 | 1 | NFR-04 | T-15-03-03 | Cert check 4th branch, ticket limit | unit | `npx vitest run tests/verify-routes.test.ts tests/create-ticket-rate-limit.test.ts tests/unit/design-contract.test.ts --testTimeout=60000` | partial | ⬜ pending |
| 15-04-01..03 | 04 | 2 | NFR-04, NFR-07 | T-15-04-01..04 | Neutral sign-in, quiet resend, sign-in audit | unit + integration | `npx vitest run tests/auth-service-signin.test.ts tests/components/signin-form.test.tsx tests/audit-coverage.test.ts --testTimeout=60000`; identity-security integration | partial | ⬜ pending |
| 15-05-01/02 | 05 | 2 | NFR-09 | T-15-05-01 | Lagos WAT deterministic formatter | unit | `npx vitest run tests/format-lagos.test.ts tests/components/lagos-time.test.tsx tests/components/support-workspace.test.tsx` | ❌ W0 | ⬜ pending |
| 15-06-01/02 | 06 | 1 | NFR-01, NFR-07 | T-15-06-01..04 | Health uncached and leak-free; PII-free error log | unit + integration | `npx vitest run tests/health-route.test.ts tests/instrumentation-request-error.test.ts`; health-service integration | ❌ W0 | ⬜ pending |
| 15-07-01/02 | 07 | 1 | NFR-14, NFR-08 | T-15-07-01..03 | DB target guard; read-only integrity checks | unit + integration | `npx vitest run tests/db-target-guard.test.ts`; `npx vitest run tests/integrity-checks.integration.test.ts --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 15-08-01/02 | 08 | 1 | NFR-03, NFR-14 | T-15-08-01 | Guarded client mutations | component | `npx vitest run tests/components/arrange-client.test.tsx tests/components/programme-arrange-client.test.tsx tests/components/lesson-editor-client.test.tsx` | ✅ | ⬜ pending |
| 15-09-01..03 | 09 | 1 | NFR-02 | T-15-09-01..04 | Queue SQL parity; request-scoped cache; paged payments | integration + unit | queue differential, request-dedupe, payment paging tests | ❌ W0 | ⬜ pending |
| 15-10-01 | 10 | 3 | NFR-09 | T-15-10-01/02 | Lagos-time slice 1 tracer: support, audit (seconds), overview, order detail in WAT | component | `npx vitest run tests/components/audit-table.test.tsx tests/components/support-workspace.test.tsx` + design-contract | ✅ | ⬜ pending |
| 15-10-02 | 10 | 3 | NFR-09 | T-15-10-01 | Slice 1 cohorts, exports, email log, enrolments in LagosTime; slice check clean | component + static | `npx vitest run tests/components/cohorts-table.test.tsx tests/components/cohort-pages.test.tsx tests/components/cohort-roster.test.tsx tests/components/ExportHistory.test.tsx tests/components/email-log-table.test.tsx` + design-contract + node slice check | ✅ | ⬜ pending |
| 15-32-01 | 32 | 3 | NFR-09 | T-15-32-02 | Lagos-time slice 2 tracer: certificate screens in WAT | component | `npx vitest run tests/components/certificate-queue.test.tsx tests/components/recently-issued-list.test.tsx tests/components/certificate-record.test.tsx tests/components/certificate-templates.test.tsx` + design-contract | ✅ | ⬜ pending |
| 15-32-02 | 32 | 3 | NFR-09 | T-15-32-01 | Slice 2 grading, progress, users, publish dialog; no locale-dependent dates; slice check clean | component + static | `npx vitest run tests/components/grading-queue-table.test.tsx tests/components/grade-entry-client.test.tsx tests/components/staff-progress-override.test.tsx tests/components/assignments-panel.test.tsx tests/components/publish-dialog.test.tsx` + design-contract + node slice check | ✅ | ⬜ pending |
| 15-33-01 | 33 | 4 | NFR-09 | T-15-33-02 | Whole-tree guard written; public cohort dates in Lagos | component | `npx vitest run tests/components/cohort-cards.test.tsx` + design-contract | ❌ W0 | ⬜ pending |
| 15-33-02 | 33 | 4 | NFR-09 | T-15-33-01 | Learner, checkout and notification dates in Lagos; session schedules keep cohort zone | unit + component + static | `npx vitest run tests/learner-dashboard-page.test.ts tests/learner-results-page.test.ts tests/components/assignment-submission-panel.test.tsx tests/components/quiz-attempt-panel.test.tsx tests/components/support-entry-points.test.tsx tests/components/notification-drawer.test.tsx` + design-contract + node slice check | ✅ | ⬜ pending |
| 15-33-03 | 33 | 4 | NFR-09 | T-15-33-01/03 | No UTC or locale-dependent dates anywhere; certificate check Lagos long date | unit | `npx vitest run tests/lagos-time-guard.test.ts tests/components/cohort-cards.test.tsx tests/verify-routes.test.ts tests/certificates-landing-page.test.ts` + design-contract | ❌ W0 | ⬜ pending |
| 15-11-01..03 | 11 | 2 | NFR-08, NFR-12, NFR-13 | T-15-11-01..04 | Docker restore route; runbooks complete | script + unit | restore evidence check; `npx vitest run tests/runbooks.test.ts tests/restore-rehearsal.test.ts` | ❌ W0 | ⬜ pending |
| 15-12-01..03 | 12 | 2 | NFR-03, NFR-14 | T-15-12-01..04 | No duplicate grades or completions; webhook replay safe; [BLOCKING] push | integration + push | concurrency integration tests; guarded migrate deploy + status + tsc | ❌ W0 | ⬜ pending |
| 15-13-01..03 | 13 | 3 | NFR-07, NFR-13 | T-15-13-01/02 | Ops page gated and PII-free | integration + component | `npx vitest run tests/ops-status-service.integration.test.ts --no-file-parallelism`; operations-page + design-contract | ❌ W0 | ⬜ pending |
| 15-14-01..03 | 14 | 2 | NFR-02, NFR-03 | T-15-14-01..05 | Guarded load seeding; k6 thresholds; replay single effect | script + integration | k6 smoke evidence check; seed-load integration; replay evidence check | ❌ W0 | ⬜ pending |
| 15-15-01..03 | 15 | 2 | NFR-03, NFR-12 | T-15-15-01/02 | Loopback-only email seam; guarded task runner | e2e + unit | Playwright leg 1 on chromium, firefox, webkit; email-base-url and run-task tests | ❌ W0 | ⬜ pending |
| 15-16-01..03 | 16 | 3 | NFR-11 | T-15-16-01..06 | Anonymise in place, no hard delete, audited; [BLOCKING] push | integration + static + push | privacy-anonymise integration; privacy-no-hard-delete; guarded migrate | ❌ W0 | ⬜ pending |
| 15-17-01..03 | 17 | 3 | NFR-03, NFR-13, NFR-14 | T-15-17-01/02 | Full journey; 95% over 20 runs; integrity clean | e2e | Playwright "full journey"; reliability evidence check | ❌ W0 | ⬜ pending |
| 15-18-01/02 | 18 | 5 | NFR-02 | T-15-18-02 | Probe method fixed; hooks on 13 views | unit + e2e | percentiles test; probe baseline evidence check | ❌ W0 | ⬜ pending |
| 15-19-01..03 | 19 | 6 | NFR-09 | T-15-19-01..03 | axe zero violations; manifest complete; nightly | e2e + unit | a11y spec; `npx vitest run tests/screens-manifest.test.ts tests/ci-config.test.ts --testTimeout=60000` | ❌ W0 | ⬜ pending |
| 15-20-01..03 | 20 | 7 | NFR-09, NFR-10, NFR-12 | T-15-20-01/02 | Reflow 320-1920 + 200%; keyboard journeys | e2e + doc | responsive and keyboard specs; MANUAL-CHECKS heading check | ❌ W0 | ⬜ pending |
| 15-21-01/02 | 21 | 4 | NFR-11, NFR-13 | T-15-21-01..05 | Single-subject export, exclusions, states | integration | `npx vitest run tests/privacy-export.integration.test.ts --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 15-22-01..03 | 22 | 5 | NFR-11 | T-15-22-01..03 | Privacy screens gated, notFound parity, typed check | integration + component | privacy-read-service integration; privacy-actions, privacy-record, licence-ui-mirror-gate, design-contract | ❌ W0 | ⬜ pending |
| 15-23-01..03 | 23 | 4 | NFR-09, NFR-06 | T-15-23-01..04 | Authorised captions, same-origin, no-store; [BLOCKING] push | unit + integration + push | captions-route, captions integration, player component; guarded migrate | ❌ W0 | ⬜ pending |
| 15-24-01/02 | 24 | 5 | NFR-09 | T-15-24-01..03 | Caption authoring gated; readiness warning | integration + component | captions-authoring integration; caption-panel | ❌ W0 | ⬜ pending |
| 15-25-01..03 | 25 | 6 | NFR-05 | T-15-25-01..04 | Registry complete; three wrong personas refused, no writes | AST + integration | `npx vitest run tests/authz-inventory.test.ts --testTimeout=60000`; authz-bypass integration files | ❌ W0 | ⬜ pending |
| 15-26-01..03 | 26 | 7 | NFR-05 | T-15-26-01..03 | Wrong scope, wrong state, revocation | integration | authz-scope-state and authz-revocation integration | ❌ W0 | ⬜ pending |
| 15-27-01..03 | 27 | 7 | NFR-05, NFR-06 | T-15-27-01..04 | Download parity, no-store, TTL, unpredictable keys | integration + unit | authz-private-files integration; exceptions-csv-route; storage-keys | ❌ W0 | ⬜ pending |
| 15-28-01..03 | 28 | 8 | NFR-02, NFR-14 | T-15-28-01/02 | Statement budgets; local load; final regression | script | evidence checks (statements, load, probe, regression) | ❌ W0 | ⬜ pending |
| 15-29-01..03 | 29 | 9 | NFR-01, NFR-08 | T-15-29-01..05 | Safe staging; Neon PITR within RTO | human + script | neon-branch test; STAGING record check; PITR evidence check | ❌ W0 | ⬜ pending |
| 15-30-01..03 | 30 | 10 | NFR-01, NFR-02 | T-15-30-01..04 | Signed p75 at agreed load | e2e + k6 | staging-checks test; pilot, load and probe evidence checks | ❌ W0 | ⬜ pending |
| 15-31-01..03 | 31 | 11 | NFR-01..NFR-14 | T-15-31-01..04 | One report, named owners, no never-waive waivers | unit + doc | `npx vitest run tests/launch-checklist.test.ts`; report heading check | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

There is no separate Wave 0 plan: each missing harness is created by the first task that needs it, inside the plan that owns it (tracer-first).
- [ ] `scripts/ops/db-target-guard.ts` and `assert-local-db.ts` (plan 15-07, wave 1) before any seed, push or rehearsal
- [ ] `npm audit` green and `.github` CI (plan 15-02, wave 1) before the audit gate is relied on
- [ ] `@playwright/test` 1.63.0, `@axe-core/playwright` 4.13.0, `e2e/playwright.config.ts`, email capture seam, `scripts/ops/run-task.ts` (plan 15-15, wave 2)
- [ ] `scripts/load/seed-load.ts` and `perf/*.js` with the pinned `grafana/k6` image (plan 15-14, wave 2)
- [ ] `tests/support/authz-registry.ts`, `authz-matrix.ts`, `authz-inputs.ts` (plan 15-25, wave 6, after every new action exists)
- [ ] `src/server/auth/rate-limit.ts` tests (15-03), formatter tests (15-05), integrity checks test (15-07), whole-tree Lagos-time guard `tests/lagos-time-guard.test.ts` (15-33, after slices 15-10 and 15-32)
- [ ] `.gitignore` and ESLint ignores for `playwright-report/`, `test-results/`, `perf/`, `dumps/` (plan 15-02)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| One real screen-reader pass (NVDA or VoiceOver) | NFR-09 | D-13 requires a human pass | e2e/MANUAL-CHECKS.md "Screen reader pass" (plan 15-20); results copied into 15-LAUNCH-REPORT.md (plan 15-31) |
| Real Safari including an iPhone | NFR-12 | D-14 requires a human check | e2e/MANUAL-CHECKS.md "Real Safari and iPhone" (plan 15-20) |
| One unassisted manual journey run | NFR-03 | D-08 | e2e/MANUAL-CHECKS.md "Unassisted manual journey (D-08)", performed on the deploy preview in plan 15-30 |
| Phase 14 licence screens (keyboard, screen reader, 320px, 200% zoom) | NFR-09 | Folded prerequisites todo | e2e/MANUAL-CHECKS.md "Licence screens (Phase 14 folded)" |
| First CI run green and Dependabot accepted | NFR-04, NFR-12 | Needs the owner to push | Human check in plan 15-02 Task 2 and plan 15-19 Task 3 |
| Owner items with named people and waivers | All | D-05, D-06, D-07 | Plan 15-31 Task 2 checkpoint |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < target
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
