---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 29
subsystem: staging-setup-restore-rehearsal
tags: [nfr-01, nfr-08, neon, netlify, staging, pitr, seed, password-rotation]
status: complete

requires:
  - "15-28 (local rehearsal), 15-07 (database-target guard), 15-11 (restore runbook), 15-14 (seed-load)"
provides:
  - "scripts/ops/neon-branch.ts: guarded Neon REST helper (list, create at a timestamp, wait, delete) with prefix-restricted names, no restore endpoint, no host or key in output; 26 unit tests"
  - "scripts/ops/rotate-seed-passwords.ts: guarded removal of the development seed password, found by testing hashes, with a --check mode"
  - "Staging branch migrated (30 of 30), seeded (171 users, 5,003 orders, 2,000 tickets), development password removed (11 accounts), preview healthy (200)"
  - "15-STAGING.md: owner answers, branch, preview, seeded counts, monitor, notes (no secrets)"
  - "evidence/restore-neon-pitr.json: Neon point-in-time restore to a new branch, RPO 300 s, RTO 37 s, 8 of 8 row counts equal, 7 of 7 integrity checks passed, rehearsal branch deleted"
affects: ["15-30", "15-31"]

tech-stack:
  added: []
  patterns:
    - "Neon API through fetch with an injected fetch for tests; no new npm package, no neonctl"
    - "Host labels in terminal output are masked; the two known staging hosts are replaced by fixed labels so output still proves which host a tool used"
    - "Restore rehearsal: new branch at a timestamp, host added to the allow-list only inside the driver's process, branch deleted in a finally block"

key-files:
  created:
    - scripts/ops/neon-branch.ts
    - scripts/ops/rotate-seed-passwords.ts
    - tests/neon-branch.test.ts
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/15-STAGING.md
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/restore-neon-pitr.json
  modified: []

decisions:
  - "Staging schema-only branch was baselined (18 migrations marked applied with prisma migrate resolve) and the remaining 12 applied with prisma migrate deploy, instead of dropping the schema"
  - "neon-branch.ts deletes a staging- branch only with --allow-staging and never the default, primary or a protected branch (stricter than the plan)"
  - "rotate-seed-passwords finds accounts by verifying the stored hash against the seed password, not by an email list; the new passwords are discarded"
  - "The staging branch expiration was not removed by the executor on its own authority; the owner authorised it and the orchestrator cleared it through the Neon API before Task 3 ran"
  - "Restore rehearsal RTO (37 s) is measured from the incident time to the end of the integrity checks on the restored branch; repointing the app and redeploying is not included"

requirements-completed: []

actuals:
  tokens: 14100
  tasks: 3
  commits: 0

metrics:
  duration: "about 60 min (Task 2 about 50 min including the first, refused Task 3 attempt; Task 3 rerun about 10 min)"
  completed: 2026-10-11
---

# Phase 15 Plan 29: Staging target and Neon point-in-time restore rehearsal Summary

The staging Neon branch is migrated, seeded with the pilot load, free of the development password and serving a healthy deploy preview, with its facts recorded without secrets. A Neon point-in-time restore to a new branch was rehearsed on it: the restored branch was ready in 5 seconds, matched staging row for row in the eight key tables, passed all 7 integrity checks, and the whole restore took 37 seconds from incident to checked (RTO target 8 hours). The rehearsal branch was deleted afterwards.

Nothing was committed (owner rule). No connection string, host name, key or password appears in this file, in 15-STAGING.md, in the evidence file or in any terminal output of this run.

`requirements-completed` is left empty on purpose: NFR-01 and NFR-08 are measured and signed in plans 15-30 and 15-31, and NFR-08's RPO is not met by the current Neon plan (finding 3).

## Status by task

| Task | Result |
| --- | --- |
| 1. Owner sets up staging and answers OQ2 | Cleared by the owner before the first run |
| 2. Tracer: scripts, migrate, seed, rotate, health, 15-STAGING.md | Done; verify command passes |
| 3. Neon point-in-time restore rehearsal | Done on the second attempt; verify command exits 0. The first attempt (04:36 UTC) was refused by Neon because the staging branch had an expiration date; the owner authorised removing it and the rehearsal then ran at 04:49 UTC. |

## Task 2 results

**Safety checks before any write.** Through the Neon API: both hosts in `STAGING_DATABASE_HOSTS`, and the hosts of the pooled and direct staging URLs, all map to branch `br-icy-river-axqpwts7` (`staging-phase 15`, not the default branch). `scripts/ops/assert-local-db.ts` refuses the staging host (exit 1), as the plan's Task 1 verification expects. Prisma's own output confirmed it connected to the staging direct host. The branch held 51 tables and 0 rows before seeding.

**Migrations.** 30 of 30 applied; `prisma migrate status` reports up to date and `prisma migrate diff` against `prisma/schema.prisma` reports no difference (exit 0). See deviation 1 for how.

**Seeding** (2026-10-11, 04:19 to 04:27 UTC):

| Step | Result |
| --- | --- |
| `prisma db seed` (guard check chained in front) | exit 0: 5 roles, 11 users, 3 courses, 3 cohorts, 9 enrolments |
| `seed-load --target staging --volume` | exit 0: 150 learners, 10 staff, 160 sessions, 150 enrolments, 5,000 orders, 2,000 tickets |
| `rotate-seed-passwords --target staging --check` (before) | 11 accounts had the development password |
| `rotate-seed-passwords --target staging` | **11 accounts rotated, 0 still have the development password** (exit 0) |
| `rotate-seed-passwords --target staging --check` (after) | 0 accounts (exit 0) |

**Seeded counts on staging:** User 171, Session 160, Enrolment 159, Order 5,003, PaymentAttempt 5,002, Ticket 2,000, TicketMessage 2,000, Grade 2, CompletionRecord 3, Certificate 3, AuditEvent 6, Cohort 3. Database size about 18 MB, so the volume seed was not reduced for the Free plan.

**Integrity checks on staging** (`integrity-checks.ts --target staging`): 7 of 7 passed, 0 violations.

**Preview health:** `GET https://deploy-preview-16--kqnexuslms.netlify.app/api/health` returned **200** `{"status":"ok"}` at 04:27 UTC (2.3 s, a cold start).

Neon API reference consulted: the OpenAPI document at https://neon.com/api_spec/release/v2.json (branch create with `parent_id` and `parent_timestamp`, `endpoints: [{type: "read_write"}]`, operations polling, branch and endpoint states, branch delete).

## Task 3 results: Neon point-in-time restore rehearsal

**Blocker cleared first.** The first attempt (T = 04:36:54Z) got HTTP 400 from Neon: "Branches with an expiration date cannot have child branches". The staging branch had `expires_at` 2026-10-17T19:21:56Z, set when it was created in the console. No branch was created by that attempt. The owner then authorised removing the expiration and the orchestrator cleared it through the Neon API. This run read the branch back from the Neon API after the rehearsal: `expires_at` is empty.

**The rehearsal** (2026-10-11, all times UTC):

| Step | Time | Note |
| --- | --- | --- |
| Seeding finished | 04:26:53 | 23 minutes before the incident time, so the precondition (10 minutes) is met |
| Restore point R | 04:44:48 | T minus 5 minutes; after seeding and inside the 6-hour history window |
| Incident time T | 04:49:48 | stands in for the moment the damage is noticed |
| Branch create requested | 04:49:58 | `restore-rehearsal-20261011-044948` (`br-plain-star-axua7evk`), parent `staging-phase 15` at R, with a read-write endpoint |
| Branch ready | 04:50:03 | 5 seconds after the request; Neon reports parent `br-icy-river-axqpwts7` |
| First query answered (row counts) | 04:50:14 | |
| Integrity checks finished | 04:50:25 | |
| Rehearsal branch deleted | 04:50:26 | absent from the branch list on the first poll |

| Measure | Value | Target |
| --- | --- | --- |
| RPO (T minus R) | **300 seconds** | 24 hours (86,400 s) |
| RTO (T to integrity checks finished) | **37 seconds** | 8 hours (28,800 s) |
| Branch create to ready | 5 seconds | |

**Row counts, staging at R against the restored branch:**

| Table | Staging (rows dated at or before R) | Restored branch | Equal |
| --- | --- | --- | --- |
| User | 171 | 171 | yes |
| Enrolment | 159 | 159 | yes |
| Order | 5,003 | 5,003 | yes |
| PaymentAttempt | 5,002 | 5,002 | yes |
| Grade | 2 | 2 | yes |
| CompletionRecord | 3 | 3 | yes |
| Certificate | 3 | 3 | yes |
| AuditEvent | 6 | 6 | yes |

The eight tables are `KEY_TABLES` from `scripts/ops/restore-rehearsal.ts`. On staging, tables with a creation-time column were counted up to R (`createdAt`, or `issuedAt` for Certificate); PaymentAttempt, Grade and CompletionRecord have none of the columns the driver looks for and were counted in full. The counts equal the totals recorded after seeding, so no rows in these tables were added between seeding and the rehearsal and both ways of counting give the same numbers. A full count is a weaker comparison on a database that is being written to; a real restore check should compare against a known figure for the restore point.

**Integrity checks on the restored branch** (`integrity-checks.ts --target staging`, guard allow-list extended with the rehearsal host inside the process only): **7 of 7 passed, 0 violations** (paid orders have a successful payment; active enrolments have a paid order; one live enrolment per learner and cohort; one open completion record per enrolment and course; one grade per submission; active certificates have a completion record; cohorts within capacity).

**Safety of the run.** Before creating anything the driver confirmed through the Neon API that the parent is `staging-phase 15`, is not the default branch, and that the staging direct URL's host is that branch's endpoint. The rehearsal host came from the Neon API for the branch just created, and the driver checked that the new branch's parent is the staging branch. Only branch creation at a timestamp was used; no restore endpoint was called (neon-branch.ts refuses any such path). The `production` and `prod_test2` branches were only listed.

**Rehearsal branch deleted: confirmed.** `npx tsx scripts/ops/neon-branch.ts list` after the run shows exactly three branches: `staging-phase 15` (ready), `production` (default, ready) and `prod_test2` (archived). No `restore-rehearsal-...` branch remains.

**What the rehearsal does and does not show.**

- It shows that Route A of the restore runbook works on this project and Postgres version, and that the database part of a restore takes well under a minute at this data size (about 18 MB). The 8-hour RTO has a very large margin on the database side.
- The 37 seconds do not include Route A step 4 (pointing the app at the restored branch and redeploying), which was not rehearsed. A Netlify redeploy adds minutes, not hours.
- The time will grow with data size and with how long the compute takes to start; 37 seconds is one measurement on a small database, not a guarantee.
- It does not show RPO 24 hours is achievable. The restore point can be at most 6 hours old on the Free plan (finding 3).
- Neon reported the new branch's `parent_timestamp` as 04:44:18Z, 30 seconds earlier than the R requested (04:44:48Z). The cause was not investigated. It made no difference here because no rows were written near R, but on a busy database the restored state can be slightly older than the time asked for; check the reported timestamp during a real restore.

**Verify commands run (whole plan):**

| Command | Result |
| --- | --- |
| Task 3 evidence check (plan's node one-liner on `evidence/restore-neon-pitr.json`) | exit 0 |
| Secret scan of the evidence file (connection string, Neon host, Neon password or API key patterns) | 0 matches |
| `npx vitest run tests/neon-branch.test.ts` | 1 file, 26 tests passed |
| 15-STAGING.md headings and secret scan (plan's node one-liner), run after the Task 3 edits | exit 0 |
| `npx tsc --noEmit` (new files) and `npx eslint` on the three new files (Task 2 run; files unchanged since) | no findings |

The rehearsal driver is not in the repository (it is not in this plan's file list); it lives in the session's temporary folder. It imports `createNeonClient` from `scripts/ops/neon-branch.ts` and `KEY_TABLES` and `compareRowCounts` from `scripts/ops/restore-rehearsal.ts`, builds the rehearsal connection in memory from the staging direct URL and the new endpoint host, adds that host to the allow-list only inside its own process, runs the row counts and `integrity-checks.ts --target staging`, writes the evidence, and deletes the branch in a `finally` block. If the owner wants the rehearsal to be repeatable from the repository, that is a small follow-up (a `scripts/ops/` file plus a test).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Schema-only branch had an empty migration history**
- **Found during:** Task 2, `prisma migrate status`.
- **Issue:** A Neon schema-only branch copies table definitions and no rows, so `_prisma_migrations` was empty and Prisma treated all 30 migrations as unapplied; `prisma migrate deploy` would have failed on the first one.
- **Fix:** Compared the branch's catalog with every migration's objects (read-only). Migrations 1 to 18 (through `20260925120000_ticket_queue_changed_event`) were present, 19 to 30 absent. Marked the first 18 as applied with `prisma migrate resolve --applied`, then `prisma migrate deploy` applied the other 12. Verified with `migrate status` and `migrate diff` (no difference). Chosen over dropping and recreating the schema because it deletes nothing.
- **Files modified:** none in the repository.

**2. [Rule 2 - Safety] Stricter delete and create rules in neon-branch.ts**
- The plan allows deleting any `staging-` or `restore-rehearsal-` branch. The script also refuses the default, a primary or a protected branch whatever its name, needs `--allow-staging` for a `staging-` branch, only creates branches with one of the two prefixes, and refuses any API path containing `/restore`. All are unit tested.

**3. [Rule 2 - Safety] Guard in front of unguarded commands**
- `prisma/seed.ts` and the Prisma command line have no database guard. Each run was chained behind a guard check (`assertSafeDatabaseUrl` with the staging target) and the Neon API host-to-branch check. `prisma/seed.ts` itself was not changed (outside this plan's files).

### Other deviations

**4. Load tokens written to `perf/results/tokens-staging.json`**, not the default `tokens.json`, so the local rehearsal's tokens from plan 15-28 were not overwritten. The folder is ignored by git. Plan 15-30 must point the load scripts at this file.

**5. `rotate-seed-passwords.ts` has a `--check` mode** (not in the plan) so the result can be verified without writing.

**6. Task 3 needed two attempts and an owner decision.** The first attempt was refused because of the branch expiration and was deliberately not auto-fixed (changing a setting on the owner's branch was outside the authorised Neon operations). The owner authorised the change, the orchestrator cleared the expiration through the Neon API, and the second attempt passed. The staging branch's expiration setting is therefore changed from how the owner created it: it no longer expires.

**7. Task 3 was driven by a temporary script, not by `neon-branch.ts` commands typed one by one.** The plan says "through neon-branch.ts"; the driver uses that file's client functions (create at a timestamp, wait, endpoint host, delete, list) so the timings are not stretched by typing. The driver is outside the repository.

**8. The evidence file has more fields than the plan lists** (project facts, branch ids and names, `seedFinishedAt`, `firstQueryAt`, `branchReadySeconds`, targets, `rowCountBasis`, `rowCountsMatch`, `integrityPassed`, `passed`, `rehearsalBranchDeleted`, `rehearsalBranchDeletedAt`, `notes`). All the plan's fields are present with the plan's names.

**9. No edits outside the plan's file list in the repository.** This SUMMARY and `.planning/STATE.md` / `ROADMAP.md` (through the GSD state commands) are the only other files touched.

## Findings for the owner and for plans 15-30 and 15-31

1. **Staging branch expiration: resolved.** It was removed on 2026-10-11 with the owner's authorisation. The branch now stays until someone deletes it; delete it when Phase 15 is signed (the Free plan allows 10 branches).
2. **Production may be 12 migrations behind, not 7.** The staging schema (copied schema-only, by the owner's account from production) lacked the five `20260927...` migrations as well as the seven the deployment runbook lists. Production was not contacted. Confirm with `npx prisma migrate status` against production and correct the launch checklist's ordered migration list (plan 15-31).
3. **RPO 24h is not met by the Free plan's 6-hour history.** Blocking launch-checklist item: a paid Neon plan or a daily external dump (must-have truth 6 of this plan). The successful rehearsal does not change this.
4. **Preview variables not confirmed as staging values:** `S3_*`, `PAYSTACK_*`, `STRIPE_*`, `EXPORT_DISPATCH_SECRET` are whatever the site had for all contexts. Until confirmed, do not run checkout, upload, certificate or export steps against the preview.
5. **Netlify credits are shared with production** (recorded as yes; the owner did not answer directly). Plan 15-30 starts with the 10 percent pilot.
6. **Seeded `@kqnexus.test` accounts cannot be signed into** until a password reset or a staff-set temporary password; the load accounts work.
7. The deployed commit of the preview was not read from Netlify; `9a68b7a` was the head of `LAUNCH`.
8. **Restore runbook, Route A step 4 (repoint the app and redeploy) is not rehearsed.** Consider timing it once on the preview in plan 15-30 so the signed RTO covers the whole route.
9. **Neon may place the restore point slightly earlier than asked** (30 seconds in this run). Worth one line in `docs/runbooks/restore.md`.

## Known Stubs

None in the files created by this plan.

## Threat Flags

None. No new network endpoint, auth path or schema change; the two scripts are operator tools behind the existing guard and the Neon API key.

## Self-Check: PASSED

- FOUND: scripts/ops/neon-branch.ts, scripts/ops/rotate-seed-passwords.ts, tests/neon-branch.test.ts, 15-STAGING.md, evidence/restore-neon-pitr.json.
- Plan verification: 15-STAGING.md check exit 0, evidence check exit 0, `npx vitest run tests/neon-branch.test.ts` 26 passed.
- Rehearsal branch absent from the Neon branch list (three branches remain: `production`, `staging-phase 15`, `prod_test2`).
- Commits: none, by the owner's rule.
