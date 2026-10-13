---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 11
subsystem: infra
tags: [nfr-08, nfr-12, nfr-13, restore-rehearsal, pg_dump, docker, runbooks, netlify-functions]
status: complete

requires:
  - phase: 15-launch-readiness-nfr-verification-operational-cutover
    provides: "15-07 db-target-guard (assertSafeDatabaseUrl) and integrity-checks CLI; 15-06 /api/health and the request_error log line"
provides:
  - "scripts/ops/restore-rehearsal.ts: guarded pg_dump -Fc of the source into a fresh postgres:{major}-alpine container on port 5440, row-count comparison of 8 key tables, integrity checks on the restored copy, timing evidence JSON"
  - "evidence/restore-local.json: Docker route proven locally (8/8 row counts equal, 7/7 integrity checks passed, RTO 197.3 s)"
  - "docs/runbooks/{deployment,rollback,restore,incident-and-secrets,job-recovery}.md"
  - "docs/deployment/netlify-scheduled-functions.md now covers all ten functions"
  - "README 'Deploy and operate' section linking the runbooks (Vercel boilerplate removed)"
  - "tests/runbooks.test.ts coverage guard tying netlify/functions to both documents"
affects: [15-13, 15-15, 15-30, 15-31]

actuals:
  tokens: 24300
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Docker credentials passed by inherited env (`-e NAME` with no value) so passwords never appear on a command line"
    - "Fresh restore container per run with a random password, removed in a finally block; dump deleted unless --keep-dump"
    - "Docs coverage test derives the inventory from the filesystem (netlify/functions) rather than a hard-coded list"

key-files:
  created:
    - scripts/ops/restore-rehearsal.ts
    - tests/restore-rehearsal.test.ts
    - tests/runbooks.test.ts
    - docs/runbooks/deployment.md
    - docs/runbooks/rollback.md
    - docs/runbooks/restore.md
    - docs/runbooks/incident-and-secrets.md
    - docs/runbooks/job-recovery.md
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/restore-local.json
  modified:
    - docs/deployment/netlify-scheduled-functions.md
    - README.md

key-decisions:
  - "Restore rehearsal RTO = integrityFinishedAt - startedAt (startedAt stands in for the incident start); RPO is recorded as latestRestorablePoint = dump start, because a rehearsal dumps after the 'incident'"
  - "The restore target is always a new container (database restore_rehearsal, user postgres, 127.0.0.1 only); a target equal to the source, on the source's local port, or named licence_test is refused on top of the host guard"
  - "Prisma-only URL parameters (schema, connection_limit, pgbouncer, ...) are stripped before handing a URL to libpq tools"
  - "Job-recovery signals are written in UI-SPEC S1 words with the P-11 Behind rule (3x interval, 5-minute minimum); where a job may have no stored signal the runbook points to the function log ('Not tracked')"
  - "Poisoned-event replay is documented as a single-row, owner-approved SQL reset guarded by a WHERE clause that only matches poisoned rows, recorded in the incident record"

patterns-established:
  - "Ops scripts: guard both ends, spawn with argument arrays and shell:false, mask secrets in child stderr, never print URLs"

requirements-completed: [NFR-08, NFR-12, NFR-13]

duration: 50min
completed: 2026-10-07
---

# Phase 15 Plan 11: Restore rehearsal and operating runbooks Summary

**A guarded pg_dump/pg_restore rehearsal into a fresh Docker container proves recovery without Neon (8/8 row counts equal, 7/7 integrity checks passed, 197 s RTO). Five runbooks now cover deployment, rollback, restore, incidents and secrets, and recovery for all ten Netlify functions, and a test keeps them in step with `netlify/functions`.**

## Performance

- **Duration:** about 50 min (rehearsal runs take about 3.5 min each because Docker Desktop is slow to start containers on this machine)
- **Started:** 2026-10-07T21:05Z
- **Completed:** 2026-10-07T21:55Z
- **Tasks:** 3/3
- **Files:** 9 created, 2 modified

## Accomplishments

- **Task 1 (tracer):** `scripts/ops/restore-rehearsal.ts` with `--source` (defaults to the shell `DATABASE_URL`), `--target-port` (5440), `--target local|staging`, `--out` and `--keep-dump`. It guards the source and the computed target with `assertSafeDatabaseUrl` before any docker command, reads `SHOW server_version_num` to choose `postgres:{major}-alpine`, starts `restore-rehearsal-{timestamp}`, runs `pg_dump -Fc` from a matching container through `host.docker.internal` into the gitignored `dumps/`, then `pg_restore --no-owner --no-privileges --exit-on-error`, compares row counts for User, Enrolment, Order, PaymentAttempt, Grade, CompletionRecord, Certificate and AuditEvent, runs `scripts/ops/integrity-checks.ts` against the restored copy, and removes the container (and the dump) in `finally`. Evidence from the local run on 2026-10-07: dump 208,364 bytes in 58.4 s, restore 63.7 s, integrity 41.8 s, RTO 197.3 s; all counts equal and all checks passed. Afterwards no `restore-rehearsal-*` container was left.
- **Task 2:** `deployment.md` (build command `npm run build`, Node 22, a table of every variable the code reads by deploy context, migrations first through the Neon direct host with `prisma migrate deploy` only, a pointer to `15-LAUNCH-CHECKLIST.md`, health, uptime and scheduled-function checks, and a Docker note that says compose is local-only, has no scheduler or health check, and does not use `AUTH_SECRET`/`AUTH_URL`); `rollback.md` (publish the previous deploy, forward-only migrations, open tabs, when to restore); `restore.md` (targets, Route A with `neonctl branches create --parent <branch>@<RFC 3339>`, Route B with the measured timings, R2 files as an owner item, the timing record); `incident-and-secrets.md` (roles, first steps, reading Operations status and `request_error` lines, rotation steps for every secret variable). README "Deploy on Vercel" replaced with "Deploy and operate".
- **Task 3 (TDD):** `tests/runbooks.test.ts` written first. RED: the job-recovery file was missing. GREEN: 32 tests passed. A negative probe (a temporary undocumented function file) made 5 tests fail, and the probe was then removed. `job-recovery.md` has one section per function (UI-SPEC job name, UTC schedule, what it does, log line, "Operations status signal:", re-run, "Safe to re-run:"), plus Poisoned events, Failed exports, Failed emails and Stuck webhooks. `netlify-scheduled-functions.md` gains a ten-row table, the preview/`run-task.ts` note and sections for the seven undocumented functions.

## Task Commits

None. The run override says no commits: the owner commits explicitly.

## Files Created/Modified

- `scripts/ops/restore-rehearsal.ts`: the guarded rehearsal. Its pure parts are exported for tests, and `main` runs only when the file is invoked directly.
- `tests/restore-rehearsal.test.ts`: 21 tests covering argument parsing, refusal rules, image tags, RTO arithmetic, row-count parsing and comparison, and source-order safety assertions.
- `tests/runbooks.test.ts`: the coverage guard (function names from `netlify/functions`, the four recovery headings, the required runbook headings, and the README link).
- `docs/runbooks/*.md`: the five runbooks.
- `docs/deployment/netlify-scheduled-functions.md`: additions only (83 lines added, none removed).
- `README.md`: the boilerplate Vercel section replaced.
- `.planning/.../evidence/restore-local.json`: the rehearsal evidence.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The local source database predated the 15-07 seed fix**
- **Found during:** Task 1, first rehearsal run.
- **Issue:** The restore itself worked (all 8 row counts equal), but "Active certificates have a completion record" reported 2 violations. The source database had the same 2 violations: it was seeded before plan 15-07 added completion records for the seeded certificates. So the restored copy faithfully reproduced a source defect, and the plan's "every integrity check passed" criterion could not be met.
- **Fix:** Ran `assert-local-db` and then the existing idempotent `prisma/seed.ts` against the local database only (`localhost:5434/licence_test`). This added the 3 completion records, and `integrity-checks --fail-on-violation` then exited 0. The rehearsal was re-run and the evidence rewritten. No code change was needed.
- **Files modified:** none (local database data only).

**2. [Rule 2 - Security] Extra hardening beyond the plan text**
- The restore container port is bound to `127.0.0.1` only and uses a random password for each run. Credentials reach docker through inherited env vars, never on the command line. Child-process stderr is masked before any error is shown. A stray positional argument is never echoed (it could be a URL). The dump is deleted after the run unless `--keep-dump` is set (threat T-15-11-02).

**Total deviations:** 2 (1 blocking data precondition, 1 hardening). No scope change.

## Issues Encountered

- Docker Desktop on this machine takes about 35 to 60 s to start each container, so a rehearsal of a tiny database takes about 3.5 minutes. That is still far inside the 8-hour RTO. The first foreground run went past the tool timeout and was moved to the background. It completed normally.

## Known Stubs

None. Two runbook references point at artifacts that later plans create: `scripts/ops/run-task.ts` (plan 15-15), and the Operations status page `/staff/operations` with its per-job signals (plan 15-13). `15-LAUNCH-CHECKLIST.md` comes from plan 15-31. The plan's dependency order sets these references on purpose. They are not stubs in code.

## Neon go-live list

No new migration in this plan.

## Threat Flags

None. The script only adds local Docker and database access behind the existing guard. It adds no endpoints.

## Owner notes

- `docs/runbooks/job-recovery.md` describes Operations status signals (job names, Behind thresholds) from UI-SPEC S1 and ledger P-11. When plan 15-13 builds the page, re-check the per-job "Operations status signal:" lines against what it actually derives, especially the jobs that may show "Not tracked".
- The contact list for "Who to call" belongs in the owner's private operations record. The public runbook names roles only.
- R2 object backup stays an owner item (OQ7, A14).

## Next Phase Readiness

- Plan 15-30 can run Route A (Neon branch) and reuse `restore-rehearsal.ts --target staging` for a staging dump.
- Plan 15-31's launch checklist can link these runbooks and must carry the ordered Neon migration list that `deployment.md` points to.

## Self-Check: PASSED

- FOUND: scripts/ops/restore-rehearsal.ts, tests/restore-rehearsal.test.ts, tests/runbooks.test.ts
- FOUND: docs/runbooks/deployment.md, rollback.md, restore.md, incident-and-secrets.md, job-recovery.md
- FOUND: evidence/restore-local.json (route docker, 8/8 counts equal, 7/7 passed; the Task 1 verify command exits 0)
- `npx vitest run tests/runbooks.test.ts tests/restore-rehearsal.test.ts`: 2 files, 53 tests passed
- Task 2 verify command: OK. Runbook scan for connection strings, provider hosts and key prefixes: none
- `npx tsc --noEmit`: exit 0. `npx eslint` on the three touched TS files: 0 problems
- `docker ps -a --filter name=restore-rehearsal`: none. `dumps/`: empty
- Commits: none by design (run override). Nothing staged.
