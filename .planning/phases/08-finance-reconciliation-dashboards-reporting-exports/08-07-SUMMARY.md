---
phase: 08-finance-reconciliation-dashboards-reporting-exports
plan: "07"
subsystem: exports
tags: [postgresql, s3, aws-sdk, csv, worker, vitest]
requires:
  - phase: 08-finance-reconciliation-dashboards-reporting-exports
    plan: "05"
    provides: Immutable export snapshots and stable CSV serializer
  - phase: 08-finance-reconciliation-dashboards-reporting-exports
    plan: "06"
    provides: Human approval of exact managed upload package version
provides:
  - Private managed multipart export upload, deletion, and short-lived GET signing
  - Idempotent database-claimed export worker and 24-hour expiry sweep
  - Bounded scheduled task factories for processing and expiry
affects: [08-08-export-history, 08-11-deployment-adapters]
actuals:
  tokens: 7000
  tasks: 2
  commits: 0
tech-stack:
  added: ["@aws-sdk/lib-storage@3.1125.0"]
  patterns:
    - Short SKIP LOCKED claim transaction followed by snapshot-only streaming upload
    - Conditional terminal transitions and audit writes converge under replay
key-files:
  created:
    - src/server/services/export-worker-service.ts
    - src/server/scheduled/process-export-jobs-task.ts
    - src/server/scheduled/expire-export-jobs-task.ts
    - tests/aws-sdk-lockfile.test.ts
    - tests/export-storage.test.ts
    - tests/export-worker.integration.test.ts
  modified:
    - package.json
    - package-lock.json
    - src/server/services/storage-service.ts
key-decisions:
  - Keep a deterministic private object key from the random job identity and dataset version.
  - Preserve the first claim timestamp across stale recovery so replayed CSV bytes stay stable.
  - Bound managed upload concurrency at two 5-MiB parts and cap signed GET lifetime at 120 seconds.
requirements-completed: [RPT-03, RPT-04]
coverage:
  - id: D1
    description: Exact approved AWS package and private export storage boundary
    requirement: RPT-04
    verification:
      - kind: unit
        ref: tests/aws-sdk-lockfile.test.ts
        status: pass
      - kind: unit
        ref: tests/export-storage.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Concurrent claim, snapshot-only generation, safe failure, stale recovery and expiry
    requirement: RPT-04
    verification:
      - kind: integration
        ref: tests/export-worker.integration.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Production private storage configuration and background invocation
    requirement: RPT-04
    verification: []
    human_judgment: true
    rationale: Deployment invocation is owned by Plan 08-11, and no live S3 or Netlify job was exercised in this plan.
completed: 2026-09-16
status: complete
---

# Phase 08 Plan 07: Private Export Worker and Expiry

**Queued immutable snapshots now have a bounded private storage worker and a 24-hour file expiry path.**

## Accomplishments

- Installed the human-approved `@aws-sdk/lib-storage@3.1125.0` exactly. Both existing S3 sibling specs and resolved versions remained unchanged; `npm ls` and lockfile tests pass.
- Extended the existing request-agnostic S3 boundary with deterministic export keys, managed streaming upload, delete, and short-lived attachment signing.
- Added `FOR UPDATE SKIP LOCKED` claims, snapshot-only CSV generation, conditional success/failure audit transitions, stale claim recovery, and repeated expiry convergence. Scheduled task factories invoke bounded batches; Netlify adapters remain in 08-11.

## Verification

- `tests/aws-sdk-lockfile.test.ts` and `tests/export-storage.test.ts`: 5 passed.
- `tests/export-worker.integration.test.ts`: 5 passed against disposable PostgreSQL with all 12 migrations.
- TypeScript, owned-file ESLint, `npm ls --depth=0 @aws-sdk/lib-storage@3.1125.0`, and `git diff --check`: passed.

## Issues Encountered

The sandbox denied npm registry access; the exact previously approved install succeeded on the escalated retry. No sibling AWS package version changed. No live S3 or deployed background invocation was attempted here.

## Task Commits

None, under the user's existing instruction to keep Phase 8 changes uncommitted for review.

## Self-Check: PASSED

Both plan tasks and their focused gates pass. The worker never queries live payment, refund or report rows while generating an existing job.
