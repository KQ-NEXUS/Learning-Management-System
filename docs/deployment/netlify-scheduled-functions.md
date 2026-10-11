# Netlify Scheduled Functions

The production deployment uses Netlify Scheduled Functions for bounded maintenance work that does not belong in a request handler.

There are ten functions in `netlify/functions`: nine scheduled functions and one background function.

| Function | Schedule (UTC) | Operations status job |
| --- | --- | --- |
| `drain-domain-events` | every minute (`* * * * *`) | Event processing |
| `dispatch-export-jobs` | every minute (`* * * * *`) | Export dispatch |
| `process-export-jobs-background` | background, started by `dispatch-export-jobs` | Export processing |
| `expire-export-jobs` | every 15 minutes (`*/15 * * * *`) | Export expiry |
| `reconcile-payments` | every 15 minutes (`*/15 * * * *`) | Payment reconciliation |
| `release-expired-holds` | every 5 minutes (`*/5 * * * *`) | Seat hold release |
| `cleanup-stale-uploads` | hourly (`0 * * * *`) | Upload cleanup |
| `close-resolved-tickets` | hourly at 15 past (`15 * * * *`) | Ticket auto-close |
| `cleanup-notifications` | daily at 03:00 (`0 3 * * *`) | Notification cleanup |
| `check-licence` | hourly (`0 * * * *`) | Licence check |

Scheduled functions run in UTC, have a 30-second run limit, and **do not run on deploy previews or branch deploys**. The staging run on a deploy preview (plan 15-30) therefore runs each task itself with the guarded helper from plan 15-15, `npx tsx scripts/ops/run-task.ts <task name> --target staging`, between journey steps that depend on a job. Recovery steps for every function are in [`docs/runbooks/job-recovery.md`](../runbooks/job-recovery.md).

## Expired seat holds

`release-expired-holds` runs every five minutes in UTC and processes at most 25 expired holds per invocation. The domain service retains its existing per-row transaction, concurrency, event, and audit behavior.

To verify a deployment:

1. Publish a production deploy. Scheduled functions do not run automatically on deploy previews.
2. Open **Netlify > Functions** and confirm `release-expired-holds` has a **Scheduled** badge and a five-minute next-run time.
3. Select the function and choose **Run now**.
4. Confirm the log begins with `[scheduled] released`, ends with `failed`, and contains no uncaught error.

## Abandoned uploads

`cleanup-stale-uploads` runs hourly in UTC and removes at most 50 lesson resources left `UPLOADING` for more than 24 hours — an upload intent whose browser never completed the direct `PUT`. It deletes the staged object before its row and audits each removal as `SYSTEM`. The Cloudflare R2 lifecycle rule on the `lesson-uploads/` prefix is the infrastructure backstop.

To verify a deployment:

1. Open **Netlify > Functions** and confirm `cleanup-stale-uploads` has a **Scheduled** badge and an hourly next-run time.
2. Select the function and choose **Run now**.
3. Confirm the log begins with `[scheduled] removed`, ends with `failed`, and contains no uncaught error.

## Licence check

`check-licence` runs hourly in UTC (`0 * * * *`). Each run verifies the stored software licence locally, with no network call, records any state transition (for example Active to Grace, or Grace to restricted continuity mode), and emits the deduplicated Administrator notices that are due. It is idempotent: a second run inside the same hour writes no duplicate event, audit row, or notification. The schedule, the 60-day expiring-soon window and the 3-day grace-ending notice are code defaults that a deployer cannot edit. Its log line carries a state code and counts only, never licence text, keys, or contract detail.

To verify a deployment:

1. Publish a production deploy. Scheduled functions do not run automatically on deploy previews.
2. Open **Netlify > Functions** and confirm `check-licence` has a **Scheduled** badge and an hourly next-run time.
3. Select the function and choose **Run now**.
4. Confirm the log begins with `[scheduled] licence check: state=` and contains no uncaught error.
5. Open **Licence & System Status** in the staff area and confirm **Last verification** shows the new time.

### Hosting note

Docker Compose deployments ship no scheduler. Restriction still takes effect on every guarded write, because it is derived from the signed dates at the moment of the write and needs no scheduler. Renewal alerts, state-transition audit rows and Administrator notices, however, appear only when this function, or an equivalent external cron that runs the same task, executes. A self-hosted deployment that wants those alerts must schedule an hourly run itself.

### Startup check

The application also runs a best-effort licence check from `instrumentation.ts` once per Node server instance. It is bounded to 3 seconds, never throws, and never blocks the server from starting, and it writes no audit row of its own. Whether a host runs this hook on every cold start is not guaranteed, so nothing relies on it: the hourly function and the check before every guarded write are the dependable paths.

## Event processing

`drain-domain-events` runs every minute in UTC. It turns up to 25 waiting domain events into email and in-app notification rows, each event in its own transaction, then sends up to 25 queued emails. An event that fails three times is marked poisoned and audited as `domain_event.poisoned`; it is not retried automatically (see the job-recovery runbook).

To verify a deployment:

1. Open **Netlify > Functions** and confirm `drain-domain-events` has a **Scheduled** badge and a one-minute next-run time.
2. Select the function and choose **Run now**.
3. Confirm the log begins with `[scheduled] drained`, reports `sent`, `retried` and `failed` counts, and contains no uncaught error.
4. Before the email sender first runs in production, confirm migration `20261003120000_mark_pre_notification_event_backlog_processed` is applied, so old events are not mailed out.

## Export dispatch and processing

`dispatch-export-jobs` runs every minute in UTC. It calls the background function `process-export-jobs-background` on the same deployment with a `POST`, the `x-export-dispatch-secret` header and a `{}` body, and expects `202`. Both read `EXPORT_DISPATCH_SECRET`; the dispatcher finds the deployment address from `DEPLOY_PRIME_URL` or `URL`. `process-export-jobs-background` answers `404` to any other request. It requeues exports stuck in processing for more than 20 minutes, then builds up to 10 queued exports and stores each file for 24 hours.

To verify a deployment:

1. Open **Netlify > Functions** and confirm `dispatch-export-jobs` has a **Scheduled** badge and a one-minute next-run time, and that `process-export-jobs-background` is listed as a background function.
2. Request a small export in **Reports** and open **Export History**.
3. Within two minutes the export shows as ready, and the `process-export-jobs-background` log contains `[scheduled] processed 1 exports; 0 failed`.
4. If the export stays queued, read the `dispatch-export-jobs` log: `Export dispatch configuration is missing` means the secret or address is unset, and `failed with status 404` means the two functions see different secrets.

## Export expiry

`expire-export-jobs` runs every 15 minutes in UTC and, for up to 25 ready exports whose download window has ended, deletes the stored file and marks the export expired. Staff can rerun an expired export from Export History.

To verify a deployment:

1. Open **Netlify > Functions** and confirm `expire-export-jobs` has a **Scheduled** badge and a 15-minute next-run time.
2. Select the function and choose **Run now**.
3. Confirm the log begins with `[scheduled] expired` and contains no uncaught error.

## Payment reconciliation

`reconcile-payments` runs every 15 minutes in UTC. For up to 25 successful Paystack and Stripe payments not yet reconciled, it records the provider's actual settlement evidence against the expected snapshot and opens a reconciliation case for Finance when the two disagree. A payment whose lookup fails backs off (15 minutes, doubling, at most 24 hours). It never marks an order paid.

To verify a deployment:

1. Open **Netlify > Functions** and confirm `reconcile-payments` has a **Scheduled** badge and a 15-minute next-run time.
2. Select the function and choose **Run now**.
3. Confirm the log begins with `[scheduled] reconciled`, ends with `failed`, and contains no uncaught error.

## Ticket auto-close

`close-resolved-tickets` runs hourly at 15 minutes past in UTC and closes up to 50 support tickets that have stayed resolved for 7 days. Each close is a compare-and-set, so a ticket reopened in the meantime is skipped, and each close writes a ticket event, a `SYSTEM` audit row and a `ticket.closed` event.

To verify a deployment:

1. Open **Netlify > Functions** and confirm `close-resolved-tickets` has a **Scheduled** badge and an hourly next-run time at 15 past.
2. Select the function and choose **Run now**.
3. Confirm the log begins with `[scheduled] auto-closed`, reports `skipped` and `failed` counts, and contains no uncaught error.

## Notification cleanup

`cleanup-notifications` runs daily at 03:00 UTC and archives up to 500 read in-app notifications older than 90 days. Unread notifications are never archived.

To verify a deployment:

1. Open **Netlify > Functions** and confirm `cleanup-notifications` has a **Scheduled** badge and a daily next-run time.
2. Select the function and choose **Run now**.
3. Confirm the log begins with `[scheduled] archived` and contains no uncaught error.

## Hosting note for all functions

Docker Compose deployments ship no scheduler, so none of these ten functions run there. A self-hosted deployment must run each task on the same schedule with its own cron. See [`docs/runbooks/deployment.md`](../runbooks/deployment.md) "Self-hosted Docker note".

Netlify documents scheduled-function behavior and manual invocation at <https://docs.netlify.com/build/functions/scheduled-functions/>.
