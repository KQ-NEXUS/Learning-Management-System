---
phase: 08-finance-reconciliation-dashboards-reporting-exports
plan: 01
subsystem: payments
tags: [prisma, postgresql, reconciliation, nextjs, rbac, testcontainers]
requires:
  - phase: 07-payment-automation-finance-operations
    provides: Provider-neutral payment, refund, settlement, and enrolment facts
provides:
  - Durable payment-or-refund reconciliation cases with append-only evidence history
  - Scope-safe Finance case detail projection and dedicated server-rendered route
  - Live PostgreSQL migration and concurrency proof
affects: [08-02-reconciliation-queue, finance-reporting, audit-exports]
tech-stack:
  added: []
  patterns:
    - PostgreSQL partial uniqueness plus exactly-one-subject constraints
    - Idempotent raw-SQL convergence with row locking and append-only events
    - Trusted-ancestry authorization before detail projection and corrective links
key-files:
  created:
    - prisma/migrations/20260915120000_reconciliation_cases/migration.sql
    - src/server/services/reconciliation-case-service.ts
    - src/app/staff/reconciliation/[caseId]/page.tsx
    - tests/reconciliation-case.integration.test.ts
  modified:
    - prisma/schema.prisma
key-decisions:
  - Enforce one active case per payment attempt or refund with PostgreSQL partial unique indexes and an exactly-one-subject check constraint.
  - Preserve prior resolutions as immutable events and reopen only when a new evidence fingerprint contradicts the resolved case.
  - Represent manual gateway values as not applicable, online unknown actuals as pending, and numeric zero only as a genuine observed zero.
  - Derive case visibility and corrective links from current grants and trusted case ancestry rather than request-supplied identifiers.
requirements-completed: [PAY-06, PAY-12, RPT-02]
coverage:
  - dimension: Durable reconciliation ledger
    requirement: PAY-06
    evidence: Concurrent payment/refund synchronization, resolution preservation, and contradictory-evidence reopening pass against real PostgreSQL.
  - dimension: Currency and amount semantics
    requirement: PAY-12
    evidence: Integration assertions distinguish genuine zero, pending online actuals, and manual not-applicable values without cross-currency aggregation.
  - dimension: Scoped Finance detail
    requirement: RPT-02
    evidence: Integration assertions prove non-enumerating denial, timeline/history projection, audit correlation, and permission-gated corrective links.
  - dimension: Browser presentation
    requirement: RPT-02
    evidence: The Next.js Server Component passes TypeScript and ESLint verification; no browser walkthrough was required by this plan.
    human_judgment: true
actuals:
  tokens: 14267
  tasks: 2
  commits: 0
duration: 192m
completed: 2026-09-15
status: complete
---

# Phase 08 Plan 01: Scoped Reconciliation Case Detail Summary

Durable payment/refund reconciliation cases now converge safely under concurrency, retain an append-only evidence and resolution history, and render through a scope-safe Finance detail route with exact money-state semantics.

## Performance

- **Duration:** 192 minutes, including checkpoint resolution and live database verification
- **Started:** 2026-09-15T16:59:35Z
- **Completed:** 2026-09-15T20:11:45Z
- **Tasks:** 2
- **Files changed:** 5 implementation/test artifacts plus this summary

## Accomplishments

- Added payment-or-refund reconciliation case and event models backed by database-enforced subject exclusivity and partial uniqueness.
- Implemented deterministic, redacted evidence fingerprints with idempotent case creation, evidence-change events, and resolution-preserving reopen behavior.
- Added a permission-scoped case projection and dedicated Next.js 16 Server Component with provider, order, learner, currency, expected/actual amounts, payment/refund timeline, evidence, operational correlation, and case history.
- Proved concurrency, immutability of source financial facts, non-enumerating authorization, money-state honesty, history, and corrective-link gating against disposable PostgreSQL.
- Applied the migration to the user-designated local Docker PostgreSQL instance and confirmed all ten checkout migrations are current.

## Task Commits

No commits were created. The user explicitly required every implementation, migration, test, and summary change to remain uncommitted for review.

The TDD RED gate was still exercised before implementation: the focused suite failed because `reconciliation-case-service.ts` did not yet exist. The completed implementation then passed the same focused suite with all four tests green.

## Files Created/Modified

- `prisma/schema.prisma` - Adds reconciliation subjects, risks, statuses, event types, resolution reasons, relations, and case/event models.
- `prisma/migrations/20260915120000_reconciliation_cases/migration.sql` - Creates the ledger tables, indexes, foreign keys, exactly-one-subject check, and subject-specific partial uniqueness.
- `src/server/services/reconciliation-case-service.ts` - Synchronizes redacted evidence and returns the current-grant-scoped detail projection.
- `src/app/staff/reconciliation/[caseId]/page.tsx` - Renders the production Finance case detail with explicit pending and not-applicable states.
- `tests/reconciliation-case.integration.test.ts` - Exercises the case ledger, scope boundary, source-fact immutability, money states, history, and links on real PostgreSQL.

## Decisions Made

- Database constraints are the final concurrency boundary; the service uses parameterized SQL, conflict handling, and row locks to converge competing synchronizers.
- Case history is append-only. A later contradiction reopens a resolved case without deleting or rewriting the earlier resolution event.
- Evidence fingerprinting recursively removes sensitive keys before stable serialization and hashing, keeping secrets out of persisted investigation evidence.
- The service authorizes from the stored case subject through order/cohort ancestry, then emits only links the actor may currently use.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Released stale Prisma query-engine DLL locks**

- **Found during:** Task 2, Prisma Client generation
- **Issue:** Two three-day-old worker processes held this checkout's generated query-engine DLL open, causing Prisma's atomic rename to fail with `EPERM`.
- **Fix:** Identified the exact processes by loaded module path and stopped only those stale leaf workers; unrelated Node and Next.js processes were left untouched.
- **Files modified:** None
- **Commit:** None, per user override

## Issues Encountered

- The configured Neon database contained two migrations that are not present in this checkout, so it was not a valid migration proof target. Execution paused rather than resetting or rewriting shared history. The user then designated the existing local Docker PostgreSQL instance whose migration history matched the checkout; the new migration applied there successfully.
- Prisma emitted its existing package.json configuration deprecation warning, and the test helper emitted Node's existing `DEP0190` warning. Neither warning affected verification.

## User Setup Required

None. No environment files were changed. The local Docker connection was assembled only in process scope from the container's PostgreSQL settings, with the password never printed.

## Next Phase Readiness

- The durable case ledger and scoped detail tracer are ready for queue, action, dashboard, and export expansion.
- The local PostgreSQL proof target is at all ten migrations through `20260915120000_reconciliation_cases`.

## Self-Check: PASSED

- All five planned implementation, migration, and test artifacts exist, along with this summary.
- Prisma schema validation and migration status passed against the designated local PostgreSQL instance.
- TypeScript, owned-file ESLint, the four-test real-PostgreSQL integration suite, and `git diff --check` all exited successfully on the final tree.
- HEAD remains `47e5be00ca42021281b53b5cb0a83d9e54f6c937`; no commit was created.
