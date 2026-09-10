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

Netlify documents scheduled-function behavior and manual invocation at <https://docs.netlify.com/build/functions/scheduled-functions/>.
