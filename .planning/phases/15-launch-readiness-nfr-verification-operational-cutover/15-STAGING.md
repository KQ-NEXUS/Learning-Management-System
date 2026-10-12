# Phase 15 staging target

Facts about the one staging target D-01 allows: a Neon branch plus a Netlify deploy preview. Plans 15-30 and 15-31 read this file.

This repository is public. This file holds names and facts only: no connection string, database host name, key, token or password. Those live in the owner's shell environment (`NEON_API_KEY`, `NEON_PROJECT_ID`, `STAGING_DATABASE_URL`, `STAGING_DIRECT_DATABASE_URL`, `STAGING_DATABASE_HOSTS`) and in Netlify.

## Owner answers

Answers to ledger item OQ2, given by the owner on 2026-10-11. Items marked "read from the Neon API" were confirmed by plan 15-29 as well.

| Question | Answer |
| --- | --- |
| Neon plan | Free |
| Postgres major | 18 (read from the Neon API; the staging server reports 18.6) |
| Neon history window | 6 hours (`history_retention_seconds` 21600, read from the Neon API) |
| Neon region | aws-us-east-2 |
| Netlify plan | Free |
| Netlify credits shared with production | Yes. The preview is a deploy preview of the same Netlify site as production, so load on it spends the same credits. The owner did not answer this one directly; it was recorded as yes and the owner was told. |
| Staging branch name | `staging-phase 15` (the name contains a space) |
| Preview URL | https://deploy-preview-16--kqnexuslms.netlify.app |
| Monitor provider | UptimeRobot |
| Set up by | Disu Kuwam |

What these answers mean for NFR-08 and NFR-01 (ledger OQ2, RESEARCH Pitfall 1):

- A 6-hour history window cannot meet RPO 24 hours by itself: damage noticed more than 6 hours later is outside what Neon can restore. Before NFR-08 is signed, production needs either a paid Neon plan (history of 24 hours or more) or a daily external dump (restore runbook, Route B). **This is a blocking owner item for the launch checklist (plan 15-31).**
- The Free plan also caps compute hours and always scales to zero after 5 minutes idle. The per-minute scheduled functions keep production compute awake, which can use up the monthly allowance. Check the Neon usage page before signing NFR-01.
- The staging run (plan 15-30) starts with a 10 percent pilot and checks the Netlify and Neon usage pages first (ledger A5, A6), because credits are shared with production.

## Branch

| Fact | Value |
| --- | --- |
| Name | `staging-phase 15` |
| Branch id | `br-icy-river-axqpwts7` |
| Base | Schema only (`init_source` is `parent-schema`): the table definitions were copied and no rows. It held 51 tables and 0 rows before seeding, so no real learner data is on it. |
| Created at | 2026-10-10T19:21:57Z, in the Neon console |
| Expires at | None (read from the Neon API on 2026-10-11 at 04:51 UTC). The branch was created with a 7-day expiration (2026-10-17T19:21:56Z), and Neon refuses to create a child branch from a branch that has an expiration date. The owner authorised removing it and it was cleared through the Neon API on 2026-10-11, so the branch is no longer deleted automatically and the restore rehearsal could run. |
| Other branches in the project (never touched by Phase 15 scripts) | `production` (the default branch) and `prod_test2` (archived) |
| Migrations | 30 of 30 applied on 2026-10-11 through the direct host; `prisma migrate status` reports the schema is up to date and `prisma migrate diff` against `prisma/schema.prisma` reports no difference |

How it was migrated. A schema-only branch arrives with an empty `_prisma_migrations` table, so Prisma saw all 30 migrations as not applied. The copied schema was compared, object by object, with each migration: the first 18 migrations (up to and including `20260925120000_ticket_queue_changed_event`) were already present and the last 12 were absent. The first 18 were recorded as applied with `prisma migrate resolve --applied` and the last 12 were applied with `prisma migrate deploy`:

1. `20260927015627_communications_notifications`
2. `20260927120000_hash_bearer_tokens`
3. `20260927130000_login_throttle`
4. `20260927140000_reconcile_backoff`
5. `20260927150000_video_watch_pacing`
6. `20261001120000_licence_deployment_control`
7. `20261003120000_mark_pre_notification_event_backlog_processed`
8. `20261004120000_user_password_is_temporary`
9. `20261004150000_learner_numbers`
10. `20261006120000_grade_completion_uniqueness`
11. `20261007120000_user_anonymisation`
12. `20261008120000_lesson_video_captions`

**Owner item for the launch checklist (plan 15-31):** if this branch's schema was copied from the `production` branch, production is 12 migrations behind the code, not the 7 that `docs/runbooks/deployment.md` lists (the five `20260927...` migrations are the extra ones). Plan 15-29 did not connect to production to check. Confirm with `npx prisma migrate status` against production before go-live and correct the ordered migration list.

## Preview

| Fact | Value |
| --- | --- |
| URL | https://deploy-preview-16--kqnexuslms.netlify.app |
| Source | Deploy preview of pull request 16, branch `LAUNCH`, on the same Netlify site as production |
| Commit | `9a68b7a` was the head of `LAUNCH` on 2026-10-11. The preview rebuilds on every push, and plan 15-29 did not read the deployed commit from Netlify, so plan 15-30 records the commit it measures. |
| Commit now served | `9be7af3` ("fix(storage): stop signing an empty-body checksum into upload links") since the owner's push on 2026-10-11; read from GitHub at 08:34 UTC (head of pull request 16, Netlify deploy-preview check passed for that commit) and consistent with the upload link the preview issued at 08:37 UTC, which no longer carries a checksum parameter. **The signed load run and probe of plan 15-30 (07:26 to 07:39 UTC) were measured on `9a68b7a`, not on this build.** The storage fix changes only how the S3 client signs requests and does not touch page rendering, so the page timings are not expected to differ; that is reasoning, not a measurement, and nothing was re-measured on `9be7af3`. |
| Health | `GET /api/health` returned 200 `{"status":"ok"}` on 2026-10-11 at 04:27 UTC, after migrating and seeding |
| Variables the owner set for the Deploy previews context | `DATABASE_URL` (the staging branch, pooled), `APP_BASE_URL`, `EMAIL_TRANSPORT=stub`, `SUPPORT_CONTACT_EMAIL`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, plus `SECRETS_SCAN_OMIT_PATHS` and `SECRETS_SCAN_OMIT_KEYS` |

**Cleared on 2026-10-11 by the owner's confirmation that every hosted value on the preview is test-only ("They are test keys"; recorded verbatim in 15-30-SUMMARY). The item as first written:** **Open owner item (not confirmed, blocks any payment, file or export step in plan 15-30):** the `S3_*`, `PAYSTACK_*`, `STRIPE_*` and `EXPORT_DISPATCH_SECRET` variables on the preview are whatever the site already had for all deploy contexts. It is not confirmed that they are separate staging and test values. Until the owner confirms a separate staging bucket, Paystack and Stripe **test** keys and a preview-only export secret, treat the preview as able to reach the production bucket and live payment keys: do not run checkout, upload, certificate or export steps against it.

**Uploads from the browser to the hosted bucket work on the preview since 2026-10-11, 09:29 UTC (plan 15-30).** The owner reported that the first Netlify change "did not save"; `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` were then saved for the preview, the cache cleared and the site redeployed (GitHub shows "Deploy Preview ready!" at 09:24:07 UTC, still commit `9be7af3`). The staging journey then passed end to end in a visible Chromium with a real, un-routed upload (learner 144, 09:27 to 09:30 UTC): the upload link carries a 32-character access key id, the storage service answered the PUT with 200, and grading, completion, the certificate download and the public verification passed. So the storage key and secret reach the preview's functions and may read and write the bucket. **Not verified: whether the Production context has the storage keys.** The paragraph below is the history of the fault.

**History: uploads from the browser to the hosted bucket failed on the preview (plan 15-30, open on `9be7af3` until 09:08 UTC on 2026-10-11).** The bucket's CORS setting is right (preflight 204 for the preview's address) and the empty-body checksum is gone from the upload link. The reason has been read: the storage service answers 400 `InvalidArgument`, "Credential access key has length 0, should be 32", because the preview's functions have no value in `S3_ACCESS_KEY_ID` and the link is signed with an empty key. The owner reported setting `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` for the Deploy Previews context and retrying the deploy; GitHub shows a new "Deploy Preview ready!" status at 09:00:47 UTC, **but the two runs after it (09:03 and 09:06 UTC) found the key still empty.** So the storage keys are not among the variables that reach the preview's functions yet: check the variable's exact name, that its scopes include Functions, and that it has a Deploy Previews value, then start a new build ("Clear cache and deploy site", or a push). Whether the Production context has the keys is not verified. See `deferred-items.md`.

The preview was first built while the branch still had the older schema (18 migrations). It now reads a fully migrated database; no rebuild is needed for that, because the schema is read at run time.

## Seeded data

Seeded on 2026-10-11 between 04:19 and 04:27 UTC, every command behind the database guard with `--target staging`:

1. `npx prisma db seed` (the development seed: roles, 11 accounts, one programme, three courses, three cohorts).
2. `npx tsx scripts/load/seed-load.ts --target staging --volume` (150 learners, 10 staff, 5,000 orders with payment attempts, 2,000 support tickets).
3. `npx tsx scripts/ops/rotate-seed-passwords.ts --target staging` (11 accounts rotated; a second run with `--check` found 0 accounts with the development password).

| Table | Rows |
| --- | --- |
| User | 171 (11 seeded, 150 load learners, 10 load staff) |
| Session | 160 (one per load account) |
| Enrolment | 159 |
| Order | 5,003 |
| PaymentAttempt | 5,002 |
| Ticket | 2,000 |
| TicketMessage | 2,000 |
| Grade | 2 |
| CompletionRecord | 3 |
| Certificate | 3 |
| AuditEvent | 6 |
| Cohort | 3 (SLP-2026-01 with 55 seats taken of 55, SLP-2026-03 with 51 of 51, FCM-2026-02 with 50 of 50) |
| Course / Module / Lesson | 3 / 6 / 14 |

Database size after seeding: about 18 MB, far inside the Free plan's storage allowance, so the volume seed was not reduced.

Accounts and sign-in:

- The 11 seeded accounts (`...@kqnexus.test`) now have random passwords that nobody knows. To sign in as one of them, use the password reset flow (email is a stub on the preview, so run the email task and read the stub output) or have a load staff account set a temporary password.
- The 160 load accounts (`load-learner-001@load.test` to `load-learner-150@load.test`, `load-staff-01@load.test` to `load-staff-10@load.test`; staff hold the Administrator role) share one random password. That password and the session tokens are in `perf/results/tokens-staging.json` on the machine that ran the seed. The folder is ignored by git. The file was written to `tokens-staging.json`, not the default `tokens.json`, so the local rehearsal's tokens were not overwritten; point the load scripts at it.
- Running `seed-load` again issues fresh sessions and a new shared password. Running `prisma db seed` again does not bring the development password back for existing accounts, but run `rotate-seed-passwords --check` afterwards anyway.

## Monitor

| Fact | Value |
| --- | --- |
| Provider | UptimeRobot (free) |
| Check | HTTP `GET` on the preview's `/api/health` |
| Interval | 5 minutes |
| Owner | Disu Kuwam |

A 5-minute interval measures availability to within 5 minutes per check; the 99.5 percent monthly target allows 216 minutes of downtime in a 30-day month.

## Notes

- **Scheduled functions do not run on deploy previews.** Nothing drains events, sends email, dispatches exports, releases seat holds or reconciles payments on the preview by itself. Run each task by hand with `npx tsx scripts/ops/run-task.ts <task-name> --target staging` (RESEARCH Pitfall 9).
- Every database command needs the guard: `STAGING_DATABASE_HOSTS` listing only the staging (and, during a rehearsal, the rehearsal) branch hosts, `ALLOW_STAGING_DATABASE=1`, and `--target staging`. `npx tsx scripts/ops/assert-local-db.ts` refuses the staging host, as it should.
- Migrations use the branch's direct (unpooled) host; the app and the preview use the pooled host.
- `prisma db seed` and the Prisma command line have no guard of their own. Chain a guard check in front of them and confirm through the Neon API that the host belongs to branch `br-icy-river-axqpwts7` before any write.
- Neon branches are managed with `npx tsx scripts/ops/neon-branch.ts` (`list`, `create`, `wait`, `delete`). It only creates branches named `staging-...` or `restore-rehearsal-...`, never calls a restore endpoint, refuses to delete the default branch, and deletes a `staging-...` branch only with `--allow-staging`.
- The expiration on this branch was removed on 2026-10-11: the owner authorised it and it was cleared through the Neon API. A first restore rehearsal attempt before that (04:36 UTC) was refused by Neon because of the expiration, and created no branch.
- **Point-in-time restore rehearsal: passed on 2026-10-11** (`evidence/restore-neon-pitr.json`). Incident time 04:49:48 UTC, restore point 04:44:48 UTC (RPO 300 seconds). A new branch `restore-rehearsal-20261011-044948` was created from this branch at the restore point and was ready in 5 seconds; the eight key tables matched this branch row for row (User 171, Enrolment 159, Order 5,003, PaymentAttempt 5,002, Grade 2, CompletionRecord 3, Certificate 3, AuditEvent 6) and 7 of 7 integrity checks passed with 0 violations. Time from incident to checks finished: 37 seconds, against the 8-hour RTO target. That figure does not include pointing the app at the restored branch and redeploying (restore runbook, Route A step 4), which was not rehearsed. No in-place restore was used. The rehearsal branch was deleted at 04:50:26 UTC; the project again has only `production`, `staging-phase 15` and `prod_test2`.
- The rehearsal proves the restore works and is fast. It does not change the RPO finding above: with a 6-hour history window, RPO 24 hours still needs a paid Neon plan or a daily external dump.
- The Free plan allows 10 branches. Delete rehearsal branches as soon as they are checked.
