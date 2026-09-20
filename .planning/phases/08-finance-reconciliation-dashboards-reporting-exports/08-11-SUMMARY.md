# 08-11 — Netlify export dispatch and expiry

Status: implemented and locally verified, uncommitted for review.

## Delivered

- A one-minute scheduled function dispatches a constant `{}` POST to the deployment-local export Background Function. It sends only a deployment-managed secret, times out after five seconds, and treats any response other than `202` as a failure.
- The Background Function requires the secret, POST, JSON content type, an empty object body, and no query parameters. It passes no HTTP instructions to the bounded database worker. Denials return the same `404` response.
- A fifteen-minute scheduled function delegates to the bounded expiry task with no caller arguments and propagates failures.

## Verification

- `tests/netlify-export-functions.test.ts`: 6 passed, including wrong/missing secret, injected body/query, replay, dispatch failure, and expiry failure.
- `npx.cmd tsc --noEmit`: passed.
- Owned-file ESLint: passed.
- `git diff --check`: passed.
- The database worker integration suite passed during 08-07; this plan did not modify the worker.

## Deployment setup and remaining manual check

- Configure a high-entropy `EXPORT_DISPATCH_SECRET` in Netlify for both dispatcher and Background Function. `DEPLOY_PRIME_URL` or `URL` must identify the deployment's HTTPS site, and the existing S3/DB settings must be present.
- After deployment, queue an export and verify that the scheduled dispatch receives `202`, the Background Function claims the database job, and expiry clears the object after 24 hours. This deployed smoke test has not been run locally.

No commits were created, per the review instruction.
