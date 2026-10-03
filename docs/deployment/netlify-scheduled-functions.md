# Netlify Scheduled Functions

The production deployment uses Netlify Scheduled Functions for bounded maintenance work that does not belong in a request handler.

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

Netlify documents scheduled-function behavior and manual invocation at <https://docs.netlify.com/build/functions/scheduled-functions/>.
