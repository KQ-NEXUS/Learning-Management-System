# Restore runbook

How to recover the LMS database after data loss or damage, and how to rehearse it. Two routes exist: a Neon point-in-time branch (fast, needs Neon access) and a dump restored into Docker (does not depend on Neon). Files in object storage are covered separately.

This document names variables and commands only. Never paste a connection string, a password or a production database host name here or in the incident record.

## Targets (RPO 24h, RTO 8h)

The requirement (NFR-08) is:

- **RPO 24 hours**: at most 24 hours of data may be lost. RPO is measured as the incident time minus the latest point we can restore to.
- **RTO 8 hours**: service is back within 8 hours. RTO is measured from the incident start to the moment the restored database has passed the integrity checks and the app is pointed at it.

What makes these achievable:

- Neon keeps history for point-in-time restore only for its plan's window (Free: 6 hours; Launch: up to 7 days; Scale: up to 30 days). A 6-hour window alone does not meet a 24-hour RPO if a problem is noticed late, so production must be on a paid Neon plan **or** take a daily external dump (Route B). The launch checklist records which one the owner chose.
- Route A is proven against a staging branch in plan 15-30 and signed on the launch checklist. Route B is proven locally by `scripts/ops/restore-rehearsal.ts` (results below).

## Route A: Neon point-in-time branch

Use this when production runs on Neon and the restore point is inside the plan's history window.

1. Decide the restore point: the last moment before the damage, in UTC, as an RFC 3339 time (for example `2026-10-06T08:00:00Z`). Use the audit log, the host logs and the incident report to find it.
2. Create a **new** branch at that time. Never restore in place on the production branch while you are still investigating: an in-place restore rewrites the branch.

   ```bash
   neonctl branches create --project-id <project id> --name restore-<yyyymmdd-hhmm> --parent <production branch name>@2026-10-06T08:00:00Z
   ```

   This leaves the production branch untouched. Neon may place the restore point slightly earlier than the time you asked for (30 seconds earlier in the plan 15-29 rehearsal), so read the time the new branch reports and record that as the restore point.
3. Get the new branch's **direct (unpooled)** connection string from the Neon console and, in a shell on a trusted machine, run the integrity checks against it:

   ```bash
   STAGING_DATABASE_HOSTS=<the new branch host> ALLOW_STAGING_DATABASE=1 DATABASE_URL=<direct string> npx tsx scripts/ops/integrity-checks.ts --target staging --fail-on-violation
   ```

   Exit code 0 means all seven checks passed. Spot-check the data you expected to recover (for example the orders or grades that were lost).
4. Decide with the owner how to bring production back:
   - **Point the app at the branch**: in Netlify, change the production `DATABASE_URL` to the new branch's **pooled** string, then trigger a deploy so every function picks it up. Fastest, and the damaged branch stays available for investigation.
   - **Restore the production branch**: once you are sure of the time, use Neon's branch restore on the production branch. Neon keeps a backup branch of the pre-restore state, and the connection strings stay the same.
5. Run the after-deploy checks in [deployment](deployment.md) (health, uptime monitor, scheduled functions, Operations status).
6. Record the timings (last section).

## Route B: dump restored into Docker

Use this when Neon is unavailable, when the restore point is outside Neon's history window, or to rehearse recovery without Neon. It needs Docker and a dump made with `pg_dump -Fc` by the same Postgres major version as the server.

**Rehearsal (local, repeatable).** With Docker running and the shell `DATABASE_URL` pointing at the local Docker Postgres (never the shared database in `.env`):

```bash
npx tsx scripts/ops/assert-local-db.ts && npx tsx scripts/ops/restore-rehearsal.ts --out .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/restore-local.json
```

The script refuses to run unless both the source and the restore target pass the database guard (`scripts/ops/db-target-guard.ts`). It reads the source's Postgres major, dumps it with `pg_dump -Fc` from the matching `postgres:<major>-alpine` image into `dumps/` (gitignored), restores into a **fresh** container named `restore-rehearsal-<timestamp>` on port 5440, compares row counts for `User`, `Enrolment`, `Order`, `PaymentAttempt`, `Grade`, `CompletionRecord`, `Certificate` and `AuditEvent`, runs the seven integrity checks against the restored copy, and then removes the container and the dump. It refuses a target equal to the source, on the source's port, or named `licence_test`. Add `--keep-dump` to keep the dump file.

Measured on 2026-10-07 against the seeded local database (Postgres 16, 208,364-byte dump):

| Step | Time |
| --- | --- |
| Dump (`pg_dump -Fc`, including container start) | 58.4 s |
| Restore (`pg_restore` into the fresh container) | 63.7 s |
| Integrity checks on the restored copy | 41.8 s |
| Total, start to integrity pass (rehearsal RTO) | 197.3 s |

All eight row counts matched and all seven integrity checks passed. The seeded database is small; a production-sized dump takes longer, which is why the staging run (plan 15-30) records its own timings. Even so, the route is far inside the 8-hour RTO.

**Real recovery.** The steps are the same as the script, done by hand against real infrastructure:

1. Take or fetch the most recent dump. From a trusted machine, with the source's **direct** connection string in the shell only:

   ```bash
   docker run --rm -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -v "<dumps folder>:/dumps" postgres:<major>-alpine pg_dump -Fc -f /dumps/lms-<yyyymmdd>.dump
   ```

   Set the `PG*` variables in the shell first so the password never appears on the command line. In Git Bash, prefix docker commands that mount a folder with `MSYS_NO_PATHCONV=1`.
2. Restore into the new database (a new Neon project or branch, or a new Postgres server) with `pg_restore --no-owner --no-privileges --exit-on-error -d <new database> /dumps/lms-<yyyymmdd>.dump`.
3. Run the integrity checks against the new database (as in Route A, step 3).
4. Point production at it (`DATABASE_URL` in Netlify, pooled string if it is Neon), redeploy, and run the after-deploy checks in [deployment](deployment.md).
5. Delete dump files from any laptop once the incident is closed. They hold personal data.

## Files in object storage

Database rows point at objects in the Cloudflare R2 bucket: lesson resources, learner submissions, certificates and export files. A database restore does **not** restore those files, and a restore to an earlier time may point at files that were deleted later (or miss files created after the restore point).

- R2 has no built-in versioning, so a deleted or overwritten object cannot be recovered from R2 itself. A bucket backup route (for example a scheduled copy to a second bucket, or a bucket lock rule) needs an **owner-confirmed** decision. It is an owner item on the launch checklist, and until it is confirmed, file recovery is not covered by this runbook.
- After a restore, staff may see "file unavailable" on items whose object is missing. Ask the owner whether to re-request those files from staff or learners.
- Export files are short-lived by design and are not worth restoring; staff can re-run an export.

## Record the timings

For every rehearsal and every real restore, record in the incident record (or the evidence folder for a rehearsal):

- incident start time (or rehearsal start), detection time and the chosen restore point;
- the route used (A or B) and the dump size or branch name;
- when the restore finished and when the integrity checks passed;
- RPO = incident time minus restore point; RTO = integrity pass (and app pointed back) minus incident start;
- the row counts compared and the integrity-check result;
- who did each step.

The rehearsal script writes these fields to its JSON evidence file automatically. Keep connection strings and host names out of the record.
