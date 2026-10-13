# Job recovery runbook

How to tell that a background job is behind or failing, and how to re-run it safely. There are ten Netlify functions: nine scheduled functions and one background function (`process-export-jobs-background`). Each is a thin wrapper around a task in `src/server/scheduled/`.

Facts that apply to all of them:

- Schedules are cron expressions in **UTC**.
- A scheduled function has a **30-second** run limit, so every task works in small bounded batches and drains a backlog across several runs. The background function has Netlify's longer background limit (15 minutes).
- Scheduled functions **do not run on deploy previews or branch deploys**, and nothing runs them locally or in Docker Compose. On a preview (the staging run) or a local server, run a task once with the guarded helper from plan 15-15: `npx tsx scripts/ops/run-task.ts <task name> --target local|staging` (it refuses any database the guard rejects).
- In production, re-run a scheduled function from **Netlify > Functions > the function > Run now**. When running the site locally under `netlify dev`, `netlify functions:invoke <name>` does the same.
- Each run writes one log line starting with `[scheduled]` (except `dispatch-export-jobs`, which logs only on failure). Read it in **Netlify > Logs > Functions > the function**.
- The **Operations status** page (`/staff/operations`, needs `audit.view` at Global scope) shows one row per job with **Running normally**, **Behind**, **Failing**, **Nothing waiting** or **Not tracked**. "Behind" means work waited longer than three times the job's schedule interval, with a 5-minute minimum. "Not tracked" means no stored record shows when the job last ran: check the function log instead.

Before re-running anything, check the section's "Safe to re-run" line. All ten tasks are written to be idempotent, but some recoveries below (poisoned events, failed exports) are not re-runs and have their own steps.

## Jobs

### drain-domain-events (Event processing)

- Schedule (UTC): every minute (`* * * * *`).
- What it does: turns waiting domain events into email and in-app notification rows (at most 25 events per run), then sends queued emails (at most 25 per run). Each event is claimed in its own transaction with `FOR UPDATE SKIP LOCKED`; a failing event is retried and, after 3 failed attempts, marked poisoned with a `domain_event.poisoned` audit row.
- Log line: `[scheduled] drained N events (S skipped, P poisoned); sent X, retried Y, failed Z`.
- Operations status signal: "Event processing" is **Behind** when the oldest unprocessed event has waited more than 5 minutes ("Oldest waiting event: 12 minutes"), and **Failing** when an event has been poisoned. Poisoned events also appear under "Failed and stuck work" as "{Event} event stopped after 3 of 3 attempts", and an event that has failed but is still being retried appears there as "{Event} event retrying: {n} of 3 attempts". Email failures appear in the "Email failures" section.
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts drain-domain-events` off production.
- Safe to re-run: yes. Overlapping runs skip rows another run holds, processed events are never picked up again, and notification and email rows are written with duplicate protection. For a poisoned event see "Poisoned events" below; re-running the job does not retry it.

### dispatch-export-jobs (Export dispatch)

- Schedule (UTC): every minute (`* * * * *`).
- What it does: calls `process-export-jobs-background` on this deployment (`POST /.netlify/functions/process-export-jobs-background` with the `x-export-dispatch-secret` header and a `{}` body) and expects HTTP 202. It reads `EXPORT_DISPATCH_SECRET` and the deployment address from `DEPLOY_PRIME_URL` or `URL`.
- Log line: none on success. A failure throws `Export dispatch configuration is missing` (secret or address unset), `Export dispatch deployment URL is invalid` or `Export dispatch failed with status N` (usually 404: the two functions have different secrets).
- Operations status signal: "Export dispatch" is **Behind** when the oldest queued export has waited more than 5 minutes ("3 exports waiting"). Waiting exports also appear under "Failed and stuck work" as "{Dataset} export waiting since {time}".
- Re-run: Run now. If it keeps failing, check `EXPORT_DISPATCH_SECRET` is set in the production context and redeploy (see [incident and secrets](incident-and-secrets.md)).
- Safe to re-run: yes. It only wakes the export processor, which claims each queued export once.

### process-export-jobs-background (Export processing)

- Schedule: none. It is a background function started by `dispatch-export-jobs` every minute. It answers 404 to any call without the right secret header, method and body.
- What it does: puts exports stuck in processing for more than 20 minutes back in the queue, then claims up to 10 queued exports (`FOR UPDATE SKIP LOCKED`), builds each CSV from its request-time snapshot, uploads it to private storage and marks it ready for 24 hours. A failed build marks the export failed with a safe message.
- Log line: `[scheduled] processed N exports; F failed`.
- Operations status signal: "Export processing" is **Failing** while an export has failed and has not been retried (a retried export is closed by its retry), and **Behind** when an export has been processing for more than 20 minutes, the worker's own recovery limit. Failed exports appear under "Failed and stuck work" as "{Dataset} export failed" with a link to Export History.
- Re-run: let the next `dispatch-export-jobs` run start it (within a minute), or Run now on `dispatch-export-jobs`. Off production: `npx tsx scripts/ops/run-task.ts process-export-jobs`. A failed export is not re-run by the job: see "Failed exports" below.
- Safe to re-run: yes. Each export is claimed by exactly one run; an interrupted export is requeued after 20 minutes and rebuilt from the same snapshot.

### expire-export-jobs (Export expiry)

- Schedule (UTC): every 15 minutes (`*/15 * * * *`).
- What it does: for up to 25 ready exports whose download window has ended, deletes the stored file and marks the export expired.
- Log line: `[scheduled] expired N export files`.
- Operations status signal: "Export expiry" is **Behind** when a ready export is still stored more than 45 minutes after it should have expired; otherwise **Running normally** or **Nothing waiting**.
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts expire-export-jobs` off production.
- Safe to re-run: yes. Deleting an already-deleted file is harmless and the status change is a compare-and-set, so an export is expired once.

### reconcile-payments (Payment reconciliation)

- Schedule (UTC): every 15 minutes (`*/15 * * * *`).
- What it does: for up to 25 successful Paystack and Stripe payments not yet reconciled, fetches the provider's actual settlement evidence and records it against the expected snapshot, opening a reconciliation case for Finance when they differ. It never marks an order paid and never grants access.
- Log line: `[scheduled] reconciled N payment attempts; F failed`.
- Operations status signal: "Payment reconciliation" is **Behind** when successful payments have waited for reconciliation longer than 45 minutes. Open cases show in the "Payment exceptions" section ("{n} open reconciliation cases ({h} high risk)") with a link to Reconciliation.
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts reconcile-payments` off production. Repeated `failed` counts usually mean a provider outage or a rotated key: check the provider status page and the keys in [incident and secrets](incident-and-secrets.md).
- Safe to re-run: yes. Only payments with no reconciliation recorded are picked up, and a failing payment backs off before it is tried again.

### release-expired-holds (Seat hold release)

- Schedule (UTC): every 5 minutes (`*/5 * * * *`).
- What it does: releases up to 25 checkout seat holds whose time has run out, so the seats return to the cohort. Each hold is released in its own transaction with its event and audit row.
- Log line: `[scheduled] released N expired seat holds; F failed`.
- Operations status signal: "Seat hold release" is **Behind** when an expired hold has been waiting for release more than 15 minutes. Learners may see a full cohort that should have free seats.
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts release-expired-holds` off production.
- Safe to re-run: yes. A hold already released is skipped; a hold that was paid in the meantime is not released.

### cleanup-stale-uploads (Upload cleanup)

- Schedule (UTC): every hour on the hour (`0 * * * *`).
- What it does: removes up to 50 lesson uploads left half-finished for more than 24 hours (the browser never completed the upload). It deletes the stored object first, then the row, and audits each removal as `SYSTEM`. The R2 lifecycle rule on `lesson-uploads/` is the backstop.
- Log line: `[scheduled] removed N abandoned uploads; F failed`.
- Operations status signal: "Upload cleanup" is **Behind** when an abandoned upload is more than 3 hours past its 24-hour limit; otherwise **Running normally** or **Nothing waiting**. Nothing learner-facing breaks while it is behind.
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts cleanup-stale-uploads` off production.
- Safe to re-run: yes. A removed upload is gone from the work set, and deleting an object that no longer exists is harmless.

### close-resolved-tickets (Ticket auto-close)

- Schedule (UTC): every hour at 15 minutes past (`15 * * * *`).
- What it does: closes up to 50 support tickets that have stayed resolved for 7 days, writing the ticket event, a `SYSTEM` audit row and a `ticket.closed` event. Each close is a compare-and-set, so a ticket the learner reopened is never closed.
- Log line: `[scheduled] auto-closed N resolved tickets; S skipped; F failed`.
- Operations status signal: "Ticket auto-close" is **Behind** when a resolved ticket is more than 3 hours past its 7-day close time; otherwise **Running normally** or **Nothing waiting**.
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts close-resolved-tickets` off production.
- Safe to re-run: yes. Closed tickets drop out of the work set and a lost race is skipped, never retried.

### cleanup-notifications (Notification cleanup)

- Schedule (UTC): daily at 03:00 (`0 3 * * *`), which is 04:00 in Lagos.
- What it does: archives up to 500 read in-app notifications older than 90 days.
- Log line: `[scheduled] archived N read notifications older than 90 days`.
- Operations status signal: "Notification cleanup" is always **Not tracked** (archiving leaves no "last run" record); read the function log. Nothing learner-facing breaks while it is behind.
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts cleanup-notifications` off production. Run it several times to drain a large backlog.
- Safe to re-run: yes. Archived notifications are not picked up again.

### check-licence (Licence check)

- Schedule (UTC): every hour on the hour (`0 * * * *`).
- What it does: verifies the stored software licence locally (no network call), records any state change once, and sends the due Administrator notices once.
- Log line: `[scheduled] licence check: state=STATE transitions=N notices=N skipped=N`. It never contains licence text or keys.
- Operations status signal: "Licence check" shows "Last licence check: {time}" and is **Behind** when that time is more than 3 hours old. It shows **Not tracked** if the licence has never been verified. **Licence & System Status** shows the same time as "Last verification".
- Re-run: Run now, or `npx tsx scripts/ops/run-task.ts check-licence` off production.
- Safe to re-run: yes. A second run in the same hour writes no duplicate event, audit row or notice. Restriction itself does not depend on this job: it is checked before every guarded write.

## Recovery procedures

### Poisoned events

An event is poisoned when the drain failed on it 3 times. It is kept (processed with an error) and audited as `domain_event.poisoned`, and the notifications and emails it should have produced were **not** created.

1. Open **Operations status > Failed and stuck work** and follow "Open audit log", or filter the audit log for the action `domain_event.poisoned`. Note the event id (the audit row's target) and the event type.
2. Find the cause in the function log for `drain-domain-events` around the time of the audit row. It is usually a bug in a mapper or data the mapper did not expect. Fix it and deploy the fix first: replaying without a fix just poisons the event again after 3 more attempts.
3. With the owner's approval, replay that one event by clearing its processed marker in the Neon SQL editor (production branch):

   ```sql
   UPDATE "DomainEvent"
   SET "processedAt" = NULL, "attempts" = 0, "lastError" = NULL
   WHERE "id" = '<event id>' AND "processedAt" IS NOT NULL AND "lastError" IS NOT NULL;
   ```

   The `WHERE` clause only matches a poisoned event, so a typo cannot reopen a healthy one. Record the replay (event id, who, when, why) in the incident record, because this change is not audited by the app.
4. Let the next `drain-domain-events` run pick it up (within a minute) or use Run now. Replay is safe: the event's notification and email rows are written with duplicate protection, so nothing already sent is sent twice.
5. Check the audit log shows no new `domain_event.poisoned` row for that event, and that the expected notification or email appears (email log).

Never replay events in bulk and never edit other columns.

### Failed exports

1. Open **Reports > Export History** (`/staff/reports/exports`), or follow "Open export history" from Operations status.
2. A failed export shows a safe message. If the message suggests bad filters or a permission change, ask the requester to make a new export instead.
3. Otherwise choose **Retry export**. This queues a new export linked to the failed one ("Retry of export ..."); the failed row stays for the record, and Operations status stops listing it.
4. Confirm `dispatch-export-jobs` is running (Operations status "Export dispatch" is not Behind) so the retry starts within a minute.
5. If retries keep failing, read the `process-export-jobs-background` log for the run's `failed` count and the `request_error` lines, and involve the developer.

An expired export is not a failure: use **Rerun export**, which captures current data with a new "as of" time.

### Failed emails

An email that fails 5 times, or fails permanently (for example a rejected address), is marked failed.

1. Open the **Email log** (`/staff/email-log?status=FAILED`), or follow "Open email log" from Operations status.
2. Check the stored failure classification. If Brevo itself was failing (an outage, a rotated or revoked `BREVO_API_KEY`), fix that first: see [incident and secrets](incident-and-secrets.md).
3. Choose **Resend email** on the row and give a reason. Resend needs `users.manage`; it is audited, and it only works for eligible rows (the recipient's account must be active, and the email category must allow a resend).
4. An email stuck "sending" for more than 10 minutes is picked up again automatically by the next `drain-domain-events` run; no action is needed unless Operations status keeps showing it.

### Stuck webhooks

A provider webhook is stuck when it was received but not applied, was rejected because the signature did not match, or could not be applied (exception).

1. Open **Reconciliation** (`/staff/reconciliation`), or follow "Open reconciliation" from Operations status (Payment exceptions section).
2. **Signature did not match**: almost always a key mismatch. Paystack signs with `PAYSTACK_SECRET_KEY`; Stripe signs with `STRIPE_WEBHOOK_SECRET`. Check the production values match the provider dashboard (a rotation that was not deployed is the usual cause), fix and redeploy. Then resend the event from the provider: Stripe can resend an event from the webhook endpoint's event list; Paystack retries failed deliveries on its own schedule.
3. **Could not be applied**: open the order from the case. The payment may need a manual decision (for example a payment for a cohort that became full). Finance resolves it in the Reconciliation workspace; do not change order or payment rows by hand.
4. **Received but never applied** (Operations status does not list these; Reconciliation and the host logs are the only signal): check the `request_error` lines for `/api/webhooks/paystack` or `/api/webhooks/stripe` in the host logs. Once the cause is fixed, the provider's retries and the `reconcile-payments` run bring the payment up to date.
5. Check Operations status again: an order exception or reconciliation case clears once it is resolved. A webhook that was rejected or could not be applied stays listed under "Payment exceptions" for 14 days, because nothing on that page can resolve it.
