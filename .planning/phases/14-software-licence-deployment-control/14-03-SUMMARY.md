---
phase: 14-software-licence-deployment-control
plan: 03
subsystem: database
tags: [prisma, postgres, migration, check-constraints, singleton, testcontainers, licence]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-DECISIONS.md OQ1 never-activated decision (option-a) and the 14-02 licence module constants"
provides:
  - "Prisma models DeploymentIdentity, LicenceRecord, LicenceState and the User back-relation licenceActivations"
  - "Additive migration 20261001120000_licence_deployment_control with five CHECK constraints and two seed inserts (singleton deployment identity and licence state)"
  - "tests/support/licence-db.ts: resetLicenceTables and setDeploymentId helpers for every later licence integration test"
  - "tests/licence-schema.integration.test.ts: real-Postgres proof of seed rows, defaults, CHECKs and additive-only DDL"
affects: [14-04, 14-05, 14-06, 14-07, 14-08, 14-09, 14-16]

estimate:
  tokens: 55000
  raw_tokens: 55000
  tasks: 2
  confidence: low
actuals:
  tokens: 3900
  tasks: 1
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Singleton rows pinned by CHECK (id = 'deployment' / 'current') and seeded inside the migration so every migrate deploy, including Testcontainers, has them"
    - "Raw-SQL rejected-write tests ($executeRawUnsafe) so CHECK errors surface unmodified"
    - "Additive-only proof: the test reads the migration SQL and asserts no DROP keyword"

key-files:
  created:
    - prisma/migrations/20261001120000_licence_deployment_control/migration.sql
    - tests/support/licence-db.ts
    - tests/licence-schema.integration.test.ts
  modified:
    - prisma/schema.prisma

key-decisions:
  - "The generated deployment UUID default is written as (gen_random_uuid())::text in both schema.prisma and the migration DDL, because Prisma normalises the dbgenerated expression to that form and any other spelling produces permanent migrate-diff drift."
  - "Task 2 (apply to the development database) is recorded as outstanding human work: the project .env points at a remote shared Neon database, so the plan's own local-host precondition and threat T-14-03-04 forbid running it."

patterns-established:
  - "Licence integration tests start from a seeded database and use resetLicenceTables, which never deletes the singleton rows (no application code deletes licence rows, LIC-08)"

requirements-completed: []

coverage:
  - id: D1
    description: "A database built only from checked-in migrations contains exactly one DeploymentIdentity row (id deployment, generated UUID of at least 32 characters) and one LicenceState row (UNLICENSED, everActivated false, version 0, highWaterAt set)"
    requirement: "LIC-04"
    verification:
      - kind: integration
        ref: "tests/licence-schema.integration.test.ts (13 tests pass on Testcontainers postgres:16-alpine via real prisma migrate deploy)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The database rejects a second singleton row, an unknown state, a negative version, over-long raw licence text and a duplicate licenceId; the migration contains no DROP"
    requirement: "LIC-01"
    verification:
      - kind: integration
        ref: "tests/licence-schema.integration.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration and schema.prisma are in sync (empty migrate diff) and the generated client type-checks"
    verification:
      - kind: other
        ref: "npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code (previous agent: No difference detected); npx prisma generate; npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D4
    description: "The licence tables, both seed rows and all constraints exist on the shared/development database and prisma migrate status reports it up to date"
    requirement: "LIC-04"
    verification: []
    human_judgment: true
    rationale: "Task 2 was not run: the configured DATABASE_URL names a remote shared Neon database, which the plan precondition and the project owner forbid touching from the executor. A human must run the commands listed under Outstanding Human Steps."

duration: ~30min across two executor sessions (not separately timed)
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 03: Licence Database Foundation Summary

**Seeded singleton deployment identity and licence state (three Prisma models, additive migration with five CHECK constraints and two ON CONFLICT seed inserts), proven on a real Postgres built from checked-in migrations; applying it to the shared development database remains an outstanding human step.**

## Performance

- **Duration:** about 30 min across two executor sessions (not separately timed)
- **Completed:** 2026-10-01
- **Tasks:** 1 of 2 completed (Task 1 tracer done; Task 2 recorded as OUTSTANDING by project-owner decision)
- **Files:** 3 created, 1 modified

## Accomplishments

- Models: `DeploymentIdentity` (id "deployment", unique generated `deploymentId`, `createdAt`), `LicenceRecord` (append-only register of raw signed licence text with `licenceId` unique, `keyId`, `schemaVersion`, `clientId`, `issuedAt`, `expiresAt`, `graceEndsAt`, `activatedAt`, `activatedById`, index on `issuedAt`) and `LicenceState` (id "current", active-record pointer, `registeredClientId`, `everActivated`, `state`, `restrictedAt`, `reasonCode`, `lastVerifiedAt`, `lastVerificationOutcome`, `lastGoodAt`, `attentionSince`, `highWaterAt`, `clockAlertAt`, `version`, `updatedAt`). User gained the `licenceActivations` back-relation (no column).
- Migration `20261001120000_licence_deployment_control` is additive only. It carries `DeploymentIdentity_singleton_check`, `LicenceState_singleton_check`, `LicenceState_state_check` (seven-value vocabulary), `LicenceState_version_nonnegative_check`, `LicenceRecord_raw_length_check` (at most 8192 characters) and the two seed inserts with `ON CONFLICT DO NOTHING`. The seed is therefore present on every `migrate deploy`.
- `tests/support/licence-db.ts` exports `resetLicenceTables` (clears the active pointer, deletes licence records, restores state defaults, never touches the singleton rows) and `setDeploymentId`.
- Tracer proof: `tests/licence-schema.integration.test.ts` runs a real `prisma migrate deploy` on Testcontainers `postgres:16-alpine` and asserts seed rows, defaults, every CHECK rejection, duplicate `licenceId` rejection and the no-DROP guard.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): models, additive migration, helpers, integration test. Commit: none (owner policy)
2. Task 2 ([BLOCKING] apply to local development database): NOT RUN, outstanding human step. Commit: none (owner policy)

## Verification Results (real output, re-run in this session)

- `npx prisma validate`: "The schema at prisma\schema.prisma is valid", exit 0.
- `npx prisma generate`: "Generated Prisma Client (v6.19.3) to .\node_modules\@prisma\client in 731ms", exit 0.
- `npx tsc --noEmit`: exit 0, 0 errors. (The 14-02 summary recorded 15 pre-existing errors from a stale generated client; regenerating the client for the new models cleared them.)
- `npx vitest run tests/licence-schema.integration.test.ts --project node --no-file-parallelism`: 1 file passed, 13 tests passed, 0 failed (19.16 s); the log lists all migrations, ending with 20261001120000_licence_deployment_control, then "All migrations have been successfully applied."
- Previous agent, Task 1 (not re-run here): `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` printed "No difference detected"; eslint clean on the new files.
- Requirement gate, `gsd_run query requirements ready-ids <plan-path> LIC-01 LIC-04`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-01",
    "LIC-04"
  ],
  "total": 2
}
```

  No requirement was marked complete (both are blocked; other plans in the phase still carry them).

## Files Created/Modified

- `prisma/schema.prisma` - three licence models and the User back-relation (66 added lines, no existing line changed)
- `prisma/migrations/20261001120000_licence_deployment_control/migration.sql` - additive DDL, CHECK constraints, seed inserts
- `tests/support/licence-db.ts` - shared reset and deployment-id helpers
- `tests/licence-schema.integration.test.ts` - real-Postgres schema proof

## Decisions Made

See key-decisions. The OQ1 option (never-activated policy) does not change this schema; it only affects state derivation in plan 14-04.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] dbgenerated default spelled to match Prisma's normalised form**
- **Found during:** Task 1 (migrate diff check)
- **Issue:** The plan specified `dbgenerated("gen_random_uuid()::text")`. Prisma introspects the live default as `(gen_random_uuid())::text`, so the plan's spelling produced permanent drift between schema and migrations (`migrate diff` non-empty).
- **Fix:** `dbgenerated("(gen_random_uuid())::text")` in schema.prisma and `DEFAULT (gen_random_uuid())::text` in the migration DDL. Behaviour is identical; the seed insert still uses `gen_random_uuid()::text`.
- **Files modified:** prisma/schema.prisma, prisma/migrations/20261001120000_licence_deployment_control/migration.sql
- **Verification:** `prisma migrate diff ... --exit-code` returned "No difference detected"; 13/13 integration tests pass.
- **Commit:** none (owner policy)

### Plan step not executed (owner decision, not a rule deviation)

**Task 2 was not run.** Its precondition (the resolved DATABASE_URL names localhost or 127.0.0.1) is not met: the project `.env` points at a remote shared Neon database. The plan says to stop and report instead of running any command, and threat T-14-03-04 exists for exactly this case. The project owner decided to mark Task 2 outstanding and complete the plan. No `migrate deploy`, `db push`, `migrate status` or `migrate dev` was run against any configured database, no local development database was started, and `.env` was not read.

**Total deviations:** 1 auto-fixed (Rule 1), 1 task outstanding by owner decision.
**Impact on plan:** The Rule 1 fix is required for a clean migrate diff. The software half of Task 2 (generate, type-check) was run and is green; only the database-touching half is open.

## Outstanding Human Steps

Task 2's database-touching steps are OUTSTANDING and must be run by a human against a database that is safe to change (a local development database, or the shared Neon database after the owner has decided to apply this additive migration there). Never pass `--accept-data-loss`.

```
npx prisma migrate deploy      # applies the additive migration, CHECKs and seed rows
npx prisma db push             # in-sync verification only: expect "already in sync", no data-loss prompt; stop if it proposes anything destructive
npx prisma migrate status      # expect "Database schema is up to date"
```

(`npx prisma generate` and `npx tsc --noEmit` already pass and need no repeat.) For a local database, start it first with `docker compose up -d postgres` and confirm DATABASE_URL names localhost.

Stand-in evidence until then: the Testcontainers proof (a real `prisma migrate deploy` on postgres:16-alpine, all 13 assertions green) and the empty `prisma migrate diff` together show the migration applies cleanly from the checked-in history and matches schema.prisma. They do not prove the shared database has been migrated, so any plan or manual check that reads the live shared database (not Testcontainers) will find no licence tables until the steps above are run.

## Issues Encountered

None beyond the Deviation above.

## User Setup Required

None for code. The Outstanding Human Steps above are a database action, not an external-service configuration.

## Known Stubs

None.

## Threat Flags

None. The migration adds tables only; threat register items T-14-03-02 (additive-only, tested), T-14-03-03 (singleton CHECKs, tested) and T-14-03-04 (shared-database precondition, honoured by not running Task 2) are covered.

## Next Phase Readiness

- Downstream plans that use Testcontainers (14-04 onward, via `tests/support/licence-db.ts`) can proceed: the schema, seeds and generated client are in place and type-check clean.
- OUTSTANDING: the plan's `[BLOCKING]` schema push against the development/shared database has not been done. The plan states no downstream plan should start before it. The project owner chose to proceed regardless; run the three commands under Outstanding Human Steps before any manual or deployed use of the licence tables, and before any plan that needs the live shared database.
- Broken-windows ledger: `.planning/WINDOWS.md` entry id 20 (`unrun-verify`, phase 14, status open) records the unrun Task 2 database steps.

## Self-Check: PASSED

- FOUND on disk: prisma/migrations/20261001120000_licence_deployment_control/migration.sql; tests/support/licence-db.ts; tests/licence-schema.integration.test.ts; prisma/schema.prisma contains the three models (generate and validate succeeded against it).
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
