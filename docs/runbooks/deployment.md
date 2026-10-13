# Deployment runbook

How to ship a release of the LMS to production. Production runs on **Netlify** (the Next.js site and its functions), **Neon** (Postgres) and **Cloudflare R2** (private file storage). The Docker Compose stack in this repository is for local testing only (see the last section).

This document names environment variables only. Never paste a secret value, a connection string or a production database host name into this file, a ticket or a chat.

Related runbooks: [rollback](rollback.md), [restore](restore.md), [job recovery](job-recovery.md), [incident and secrets](incident-and-secrets.md), and [Netlify scheduled functions](../deployment/netlify-scheduled-functions.md).

## Before you deploy

1. Confirm the release branch passed CI (lint, type check, unit and integration tests) on GitHub.
2. Read the release's migration list: `ls prisma/migrations` and compare it with the migrations already applied in production (`npx prisma migrate status` against production, run from a trusted machine as in "Run migrations first" below). Every new migration folder must be applied before the new code is published.
3. Check that every migration in the release is additive or that the code being replaced still works with the new schema. Migrations are forward-only (see [rollback](rollback.md)), so a migration that removes or renames something the running code needs is a breaking change and must be split across two releases.
4. Check the build settings in **Netlify > Site configuration > Build & deploy** (there is no `netlify.toml` in this repository; the settings live in the Netlify UI):
   - Build command: `npm run build` (runs `next build`; `npm install` first runs the `postinstall` script, `prisma generate`).
   - Node version: **22** (set `NODE_VERSION=22` in the build environment, matching the Dockerfile and CI).
   - The Next.js runtime is detected by Netlify automatically. Do not set a publish directory by hand.
5. For a first go-live, **run `npx prisma migrate status` against production first** (as in "Run migrations first" below) and compare its pending list with the twelve migrations here. This list is the same as "Neon go-live migrations (in order)" in `.planning/phases/15-launch-readiness-nfr-verification-operational-cutover/15-LAUNCH-CHECKLIST.md` (plan 15-31), which also gives the purpose and the pre-check of each one; `tests/launch-checklist.test.ts` fails if the two lists differ. Production was not contacted in Phase 15: the staging schema, copied from the production branch, lacked these twelve, so production is probably twelve behind. If `prisma migrate status` shows a different pending list, stop and correct the checklist and this list before applying anything.
   1. `20260927015627_communications_notifications`
   2. `20260927120000_hash_bearer_tokens` (rewrites existing rows: take a restore point first)
   3. `20260927130000_login_throttle`
   4. `20260927140000_reconcile_backoff`
   5. `20260927150000_video_watch_pacing`
   6. `20261001120000_licence_deployment_control`
   7. `20261003120000_mark_pre_notification_event_backlog_processed` (must be applied **before the email sender first runs in production**, so the old event backlog is not mailed out)
   8. `20261004120000_user_password_is_temporary`
   9. `20261004150000_learner_numbers`
   10. `20261006120000_grade_completion_uniqueness` (run the two diagnostic SELECTs in the checklist first; each must return no rows)
   11. `20261007120000_user_anonymisation` (then give `privacy.manage` to the Administrator role, checklist row B-07)
   12. `20261008120000_lesson_video_captions`

   `npx prisma migrate deploy` applies every pending migration in this order in one run.
6. Tell staff when the deploy will happen if it includes migrations or visible changes. People with the site open will need to reload after the deploy (see "After deploy checks").

## Environment variables by deploy context

Netlify scopes variables per deploy context: **Production**, **Deploy previews** and **Branch deploys**. Set each variable with the scopes "Builds" and "Functions" (and "Runtime" where offered) so the build, the server and the scheduled functions all see it.

Rules:

- Production values must never be inherited by deploy previews or branch deploys. Give previews their own values (a Neon branch, a separate staging bucket, provider test keys) or leave them unset so the feature refuses to run.
- `CONTEXT`, `URL` and `DEPLOY_PRIME_URL` are provided by Netlify and are read-only. The code reads `URL` and `DEPLOY_PRIME_URL` to find the deployment's own address.
- `NODE_ENV` and `NEXT_RUNTIME` are set by the platform and Next.js. Do not set them by hand.

| Group | Variable | Production | Deploy preview / branch deploy | Notes |
| --- | --- | --- | --- | --- |
| Database | `DATABASE_URL` | Neon **pooled** connection string of the production branch | Neon pooled string of a staging branch created from a seeded base branch, never from production | The app uses the pooled host. Migrations use the direct host (next section). |
| Email | `BREVO_API_KEY` | Required | Leave unset, or a separate Brevo key | Secret. |
| Email | `EMAIL_TRANSPORT` | Unset or `brevo` | `stub` | `stub` sends nothing. Any other value stops sending with a configuration error. |
| Email | `EMAIL_SENDER_NAME`, `EMAIL_SENDER_ADDRESS` | Required | Staging values | No default: the app refuses to send when they are unset. |
| Email | `SUPPORT_CONTACT_EMAIL` | Required | Staging value | Shown to learners in emails and on support pages. |
| Payments | `PAYSTACK_SECRET_KEY`, `PAYSTACK_SUBACCOUNT_CODE` | Live values | Paystack **test** values only | Secrets. Checkout refuses a rail whose keys are missing. |
| Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECTED_ACCOUNT_ID` | Live values | Stripe **test** values only | Secrets. Each environment has its own webhook endpoint and signing secret. |
| Storage | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Production R2 bucket and an R2 API token scoped to it; `S3_FORCE_PATH_STYLE=false` | A **separate** staging bucket and token | Access key and secret are secrets. |
| Exports | `EXPORT_DISPATCH_SECRET` | Required, random, at least 32 characters | Its own value | Secret. Shared between `dispatch-export-jobs` and `process-export-jobs-background`. Unset means exports never start. |
| Exports | `EXPORT_DOWNLOAD_TTL_SECONDS` | Optional | Optional | Lifetime of an export download link; default 60 seconds. |
| Licence | `APP_VERSION` | Optional | Optional | Release label recorded with licence checks. The production licence public key is not a variable: it ships in code (`src/server/licence/trust-set.ts`, see `provider-tools/licence-issuer/RUNBOOK.md`). |
| URLs | `APP_BASE_URL` | The public site address, `https://...`, no trailing slash | The preview address | Used in email links and redirects. |
| Client IP | `TRUSTED_CLIENT_IP_HEADER` | Leave unset on Netlify | Leave unset | Netlify's `x-nf-client-connection-ip` is used automatically. Set this only behind your own reverse proxy, naming the header that proxy guarantees. |
| Next.js | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Required: a base64 value of 32 random bytes (`openssl rand -base64 32`) | Its own value | Secret. It must be available at **build** time (it is embedded in the build). Keeping it stable across deploys keeps Server Action references valid between instances and builds. |

## Run migrations first

Apply database migrations **before** publishing the code that needs them.

1. From a trusted machine with the repository checked out at the release commit, set `DATABASE_URL` in the shell to the Neon **direct (unpooled)** connection string of the production branch (the host without `-pooler`). Do not put it in `.env` and do not commit it.
2. Run `npx prisma migrate status` and confirm the list of pending migrations is the one you expect.
3. Run `npx prisma migrate deploy`.
4. Run `npx prisma migrate status` again and confirm "Database schema is up to date".
5. Clear the variable from the shell (`unset DATABASE_URL`) or close the shell.

Never run `prisma db push` against production, never run `prisma migrate dev` or `prisma migrate reset` against production, and never use the `--accept-data-loss` flag. If `migrate deploy` fails part-way, stop: do not publish the code, and follow [rollback](rollback.md) and [restore](restore.md).

## Deploy

1. Merge the release into the production branch, or trigger **Deploys > Trigger deploy > Deploy site** in Netlify.
2. Watch the build log until the deploy is **Published**. A failed build leaves the previous deploy live; nothing else needs undoing except any migration you applied (which must be compatible with the old code, see "Before you deploy").
3. Note the deploy ID and time in the release record. You need it to roll back.

## After deploy checks

1. `GET /api/health` on the production address returns HTTP 200 with `{"status":"ok"}`. A 503 with `{"status":"degraded"}` means the app cannot reach the database: follow [incident and secrets](incident-and-secrets.md).
2. The uptime monitor watching `/api/health` (chosen and owned by the owner, listed on the launch checklist) is green.
3. In **Netlify > Functions**, each of the nine scheduled functions shows its **Scheduled** badge and a next-run time, and `process-export-jobs-background` is listed as a background function. The list and schedules are in [Netlify scheduled functions](../deployment/netlify-scheduled-functions.md).
4. Sign in as an administrator and open **Operations status** (`/staff/operations`). The band shows **All clear**, or every item it lists is explained (for example a payment exception that was already open before the deploy).
5. Open **Licence & System Status** and confirm the licence state is what you expect.
6. Users who had the site open during the deploy may see a failed action until they reload the page. If a staff member reports "the button did nothing" right after a deploy, ask them to reload first.
7. Watch the host logs for 15 minutes for new `request_error` lines (see [incident and secrets](incident-and-secrets.md)).

## Self-hosted Docker note

`docker-compose.yml` and the `Dockerfile` describe a stack (Postgres, MinIO and the app) that is used for local testing only. Production does not run on it. If a client ever self-hosts with it, know that:

- It ships **no scheduler**. None of the ten Netlify functions run. Seat holds are not released, events and emails are not processed, exports never start, payments are not reconciled and the hourly licence check does not run. A self-hosted deployment must run each task on the same schedule with its own cron (see [job recovery](job-recovery.md)).
- The app service has **no health check** in the compose file. Add one that calls `/api/health` if you run it anywhere real.
- `AUTH_SECRET` and `AUTH_URL` in `docker-compose.yml` are **unused**: the app has its own session handling and reads neither variable. Setting them changes nothing.
- The compose file does not pass several variables the app needs in production (for example `EXPORT_DISPATCH_SECRET` and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`). Use the table above as the complete list.
- The `migrate` service runs `prisma migrate deploy` before the app starts, which matches the "migrations first" rule.
