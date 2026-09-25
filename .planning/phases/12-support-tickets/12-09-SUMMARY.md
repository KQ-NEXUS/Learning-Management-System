---
phase: 12-support-tickets
plan: 09
status: partial-awaiting-human-checkpoint
requirements: [SUP-01, SUP-02, SUP-03, SUP-04, SUP-05, SUP-06]
key-files:
  created:
    - tests/ticket-access.integration.test.ts
    - tests/ticket-phase-invariants.test.ts
  modified:
    - src/server/services/ticket-service.ts
    - tests/components/support-workspace.test.tsx
    - .planning/phases/12-support-tickets/12-VALIDATION.md
---

# Phase 12 Plan 09: Cross-surface proof - PARTIAL (Tasks 1-2 done, Task 3 awaiting human)

**Do not treat this plan as complete.** Task 3 (deployed walkthrough) is a blocking human checkpoint and has not been run.

## Completed

- Task 1 (9954824): real-Postgres ownership parity and attachment lifecycle (intent/complete/download/cap/mismatch/internal-note denial) plus static invariants. 7 suites, 40 tests green.
- Task 2 (24e6248): fixed 15 no-explicit-any lint errors in ticket-service.ts, added 4 component tests, reconciled 12-VALIDATION.md. Full suite 274 files / 3710 passed / 1 skipped (pre-existing audit-table); tsc, prisma validate/generate, build green.

## Deferred / gaps

- 3 lint errors in tests/certificate-pdf-unicode.test.ts (pre-existing, unrelated) - not fixed.
- Migration 20260925120000_ticket_queue_changed_event not applied to the remote Neon dev DB (must be deployed before Task 3).
- No axe/browser run; no loading.tsx skeletons; staff filtering in memory.

## Task 3 results

PENDING - human to record per-step PASS/FAIL for the 8 walkthrough steps.
