# Netlify Scheduled Functions

The production deployment uses Netlify Scheduled Functions for bounded maintenance work that does not belong in a request handler.

## Expired seat holds

`release-expired-holds` runs every five minutes in UTC and processes at most 25 expired holds per invocation. The domain service retains its existing per-row transaction, concurrency, event, and audit behavior.

To verify a deployment:

1. Publish a production deploy. Scheduled functions do not run automatically on deploy previews.
2. Open **Netlify > Functions** and confirm `release-expired-holds` has a **Scheduled** badge and a five-minute next-run time.
3. Select the function and choose **Run now**.
4. Confirm the log begins with `[scheduled] released`, ends with `failed`, and contains no uncaught error.

Netlify documents scheduled-function behavior and manual invocation at <https://docs.netlify.com/build/functions/scheduled-functions/>.
