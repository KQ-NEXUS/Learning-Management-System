---
phase: 11-certificates-completion-lifecycle
plan: 01
subsystem: database
tags: [prisma, postgres, certificates, enrolment-state-machine, tdd]

requires:
  - phase: 09-learner-progress-completion
    provides: Completion records and the completion-rule lifecycle
  - phase: 10-assessments-submissions-grading
    provides: Correctable grade outcomes that can trigger certificate re-evaluation
provides:
  - Configurable AUTOMATIC or MANUAL certificate issuance for Courses and Programmes
  - Reusable versioned CertificateTemplate records with nullable Course and Programme selection
  - Database-enforced one-ACTIVE-certificate-per-enrolment-and-scope invariant
  - Tested COMPLETED to ACTIVE enrolment reversal for certificate re-evaluation
affects: [11-02, 11-05, 11-07, 11-08, 11-10, 11-11]

tech-stack:
  added: []
  patterns:
    - Fail-closed MANUAL issuance defaults for existing catalogue rows
    - PostgreSQL partial unique index for certificate issuance idempotency
    - Dedicated transition-table tests with TDD red and green commits

key-files:
  created:
    - prisma/migrations/20260916162101_certificates_issuance_mode_and_templates/migration.sql
    - tests/enrolment-transitions.test.ts
  modified:
    - prisma/schema.prisma
    - src/server/services/enrolment-transitions.ts
    - tests/enrolment-service.test.ts

key-decisions:
  - "Certificate issuance mode defaults to MANUAL for both Courses and Programmes so existing rows never begin issuing automatically."
  - "Certificate uniqueness is enforced by a PostgreSQL partial unique index on enrolmentId and scope where status is ACTIVE."
  - "Only COMPLETED may reopen to ACTIVE; WITHDRAWN, TRANSFERRED, and CANCELLED remain closed terminal states."

patterns-established:
  - "Certificate templates store one versioned JSON layout blob and remain referencable after archival."
  - "Certificate re-evaluation reuses the isolated enrolment transition module without importing permission or Next.js request code."

requirements-completed: [CRD-01, CRD-02, CRD-05, CRD-06]

duration: 1h 12m
completed: 2026-09-16
---

# Phase 11 Plan 01: Certificate Schema and Completion Lifecycle Summary

**Certificate issuance configuration, reusable template storage, database-level active-certificate uniqueness, and a tested reversible completion transition**

## Performance

- **Duration:** 1h 12m
- **Started:** 2026-09-16T16:18:42Z
- **Completed:** 2026-09-16T17:30:42Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added independent certificate enablement, issuance mode, and reusable template selection to Course and Programme configuration.
- Applied the additive Prisma migration to the configured Neon database and verified the partial unique index exists physically.
- Added a TDD-covered `COMPLETED -> ACTIVE` transition while retaining every other terminal-state restriction.

## Task Commits

Each task was committed atomically:

1. **Task 1: Additive certificate schema** - `5000eb1` (feat)
2. **Task 2: Migration and partial unique index** - `8037cd2` (feat)
3. **Task 3 RED: Completion reversal coverage** - `7c93654` (test)
4. **Task 3 GREEN: Reversible completion transition** - `5018be8` (feat)

## Files Created/Modified

- `prisma/schema.prisma` - Adds issuance mode, shared templates, and Course/Programme template relations.
- `prisma/migrations/20260916162101_certificates_issuance_mode_and_templates/migration.sql` - Adds the schema structures and concurrency-safe partial unique index.
- `src/server/services/enrolment-transitions.ts` - Permits certificate re-evaluation to return COMPLETED enrolments to ACTIVE.
- `tests/enrolment-transitions.test.ts` - Proves the new edge and protects the unchanged terminal states.
- `tests/enrolment-service.test.ts` - Updates the earlier terminal-state expectation to the Phase 11 lifecycle contract.

## Decisions Made

- Used `MANUAL` as the migration default for both catalogue scopes to keep issuance opt-in for existing records.
- Kept template selection nullable and independent from issuance mode, matching the Phase 11 D-02 and D-10 decisions.
- Kept the Certificate and CompletionRecord models byte-equivalent to their pre-plan definitions; generated PDFs remain the frozen template artifact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated a stale Phase 5 terminal-state assertion**

- **Found during:** Task 3 green verification
- **Issue:** `tests/enrolment-service.test.ts` asserted that COMPLETED always had an empty allow-list, which directly contradicted D-06 and caused the required regression command to fail.
- **Fix:** Restricted the legacy assertion to WITHDRAWN, TRANSFERRED, and CANCELLED; the dedicated Phase 11 test separately proves the sole COMPLETED-to-ACTIVE edge.
- **Files modified:** `tests/enrolment-service.test.ts`
- **Verification:** `npx vitest run tests/enrolment-transitions.test.ts tests/enrolment-service.test.ts` passed 62 tests.
- **Committed in:** `5018be8`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The adjustment was required to make the pre-existing regression suite express the newly approved lifecycle. No additional transition was opened.

## Issues Encountered

- Prisma formatting normalized spacing on three pre-existing Assessment fields while formatting the schema; no behavior or schema meaning changed.
- Applying the migration to the configured shared Neon database required explicit user approval. After approval, Prisma applied it successfully and a direct `pg_indexes` query returned `certificate_one_active_per_enrolment_scope`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Later Phase 11 plans can safely read and write certificate issuance mode and template selection.
- The live database now arbitrates concurrent active-certificate issuance attempts.
- The completion re-evaluation path can legally reopen a completed enrolment without weakening other terminal states.

## Self-Check: PASSED

- All five created or modified implementation files exist.
- Commits `5000eb1`, `8037cd2`, `7c93654`, and `5018be8` exist in Git history.
- Prisma schema validation and formatting passed.
- The configured database reports all 12 migrations applied and the partial unique index exists.
- TypeScript, 62 focused transition/service tests, and 14 boundary tests passed.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-16*
