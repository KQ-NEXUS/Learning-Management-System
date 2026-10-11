# Incident and secrets runbook

What to do when production is down, wrong or exposed, and how to rotate every secret the LMS uses. This repository is public: this document names variables only. Never put a secret value, a connection string, a production database host name or a person's private phone number in it.

## Who to call

Keep the contact list (names, phone numbers, the order to call them) in the owner's private operations record, linked from the launch checklist, not in this repository. The roles are:

| Role | Responsible for | Call when |
| --- | --- | --- |
| Owner (school) | Decisions that affect learners or money: restore, refunds, public messages | Every incident that affects learners, payments or data |
| Operator (whoever holds Netlify, Neon and R2 access) | Deploys, rollbacks, restores, secret rotation, function re-runs | Every incident |
| Developer | Diagnosing and fixing code | The cause is a bug, or a fix release is needed |
| Payment provider support (Paystack, Stripe) | Provider outages, settlement questions | Checkout or webhooks fail on the provider's side |
| Licence provider | Licence activation, renewal, key compromise | The licence state is wrong or the trust set must change (`provider-tools/licence-issuer/RUNBOOK.md`) |

Severity, in plain words:

- **Down**: the site or sign-in does not work for most people, or `/api/health` is failing. Start now, at any hour.
- **Money or data at risk**: payments are taken without access being granted, grades or certificates are wrong, personal data may have been exposed. Start now and call the owner.
- **Degraded**: one feature or one background job is failing, with a workaround. Fix within one working day.

## First steps in any incident

1. Write down the time you noticed the problem and what you saw. Start an incident record (a shared document the owner keeps).
2. Check `GET /api/health`. 200 `{"status":"ok"}` means the app reaches the database. 503 `{"status":"degraded"}` means it does not: check Neon status and the Neon project (compute suspended, plan limits reached, credentials changed).
3. Check the Netlify status page, the Neon status page and Cloudflare status for a provider outage.
4. Check whether a deploy happened just before the problem began (**Netlify > Deploys**). If so, consider [rollback](rollback.md) first.
5. Read the Operations status page and the host logs (next two sections).
6. Stop the damage before fixing the cause: roll back, lock auto-publishing, or pause a payment rail by removing its keys (checkout then refuses that rail) if money is being taken wrongly.

## Reading the Operations status page

Staff with `audit.view` at Global scope open **Operations status** (`/staff/operations`). It reads stored records only; it does not call the scheduler.

- The band says **All clear** or **Needs attention**, with counts for failed jobs, payment exceptions and email failures.
- **Scheduled jobs** lists each background job with **Running normally**, **Behind**, **Failing**, **Nothing waiting** or **Not tracked**. Behind means work has waited longer than three times the job's schedule interval (at least 5 minutes). Not tracked means no stored record shows when the job last ran: check the host's function log instead. What to do for each job is in [job recovery](job-recovery.md).
- **Failed and stuck work**, **Payment exceptions** and **Email failures** link to the workspace that owns each item (Export History, the audit log, the order, reconciliation, the email log).
- **Data integrity checks** shows the seven checks. Any "records need review" result is a data problem: do not fix rows by hand; open an incident and involve the developer.

## Reading the host logs

In Netlify, open **Logs > Functions** (the Next.js server and each scheduled function have their own log) or the site's runtime logs.

- Every server error writes one line like `{"event":"request_error","routePath":"/staff/payments/[id]","routeType":"render","method":"GET","errorName":"PrismaClientKnownRequestError","digest":"..."}`. It holds the route template and the error name only: no personal data, no stack. Search the logs for `request_error` and group by `routePath` to see which page or action is failing and since when.
- The `digest` is the "Reference" a user sees on the "Something went wrong" page. Ask the user for it to find their exact failure.
- Scheduled jobs log one line per run starting with `[scheduled]` (for example `[scheduled] released 0 expired seat holds; 0 failed`). A missing line means the job did not run; an uncaught error after it means it crashed. The expected line for each job is in [job recovery](job-recovery.md).
- Neon's console shows connection counts, compute state and slow queries.

## After the incident

1. Re-run any job that was behind or failing ([job recovery](job-recovery.md)).
2. Check the Operations status page is All clear or explained.
3. Complete the incident record: start, detection, actions with times, who did them, the cause, and what changes prevent it next time.
4. If personal data may have been exposed, the owner decides on notifying the people affected and the regulator. Do not delay that decision for a full root cause.

## Rotating secrets

Rotate a secret at once when it may have been exposed (pasted in a chat, committed, shown on screen, held by someone who left), and otherwise on the owner's schedule. General procedure:

1. Create the new value at the provider, keeping the old one valid if the provider allows an overlap.
2. Update the variable in **Netlify > Site configuration > Environment variables**, in the right deploy context only (production values never go to previews).
3. Trigger a new production deploy so the build, the server and every function pick up the new value. Variables changed in the UI do not reach a running deploy.
4. Run the after-deploy checks in [deployment](deployment.md).
5. Revoke the old value at the provider.
6. Record the rotation (date, variable name, who did it) in the operations record. Never record the value.

Per variable:

| Variable | Where to create the new value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Neon console: reset the role's password (or create a new role), then copy the **pooled** string | Resetting the password breaks existing connections at once, so deploy straight after. The operator's own shell copy of the direct string (used for migrations) changes too. |
| `BREVO_API_KEY` | Brevo: SMTP & API > API keys, create a key | Delete the old key after the deploy. Emails queued meanwhile retry automatically. |
| `PAYSTACK_SECRET_KEY` | Paystack dashboard: Settings > API Keys & Webhooks, generate a new secret key | Paystack signs webhooks with this same key, so webhooks arriving between the change at Paystack and the deploy fail the signature check. Deploy immediately; `reconcile-payments` and Paystack's own retries recover them, and they show on Operations status meanwhile. |
| `PAYSTACK_SUBACCOUNT_CODE` | Not a secret; changes only if the school's subaccount changes | Created outside the app. |
| `STRIPE_SECRET_KEY` | Stripe dashboard: Developers > API keys, roll the secret key (choose an expiry for the old key to allow overlap) | |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard: Developers > Webhooks > the endpoint > roll signing secret (Stripe can keep the old one valid for a period) | |
| `STRIPE_CONNECTED_ACCOUNT_ID` | Not a secret; changes only if the connected account changes | |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Cloudflare R2: Manage API tokens, create a token scoped to the bucket with object read and write | Update both together, deploy, then delete the old token. |
| `EXPORT_DISPATCH_SECRET` | Generate a random value of at least 32 characters (`openssl rand -base64 32`) | Both export functions get the new value in the same deploy. Exports queued during the deploy are picked up by the next minute's run. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Generate with `openssl rand -base64 32` | Needed at build time. After the deploy, open browser tabs must reload before their forms work. |
| `EMAIL_SENDER_NAME`, `EMAIL_SENDER_ADDRESS`, `SUPPORT_CONTACT_EMAIL`, `APP_BASE_URL` | Not secrets | Change and redeploy. |

Other credentials that are not environment variables:

- **Staff accounts**: if a staff account may be compromised, deactivate it in **Users**. Sessions of a non-active account stop working at once, because every request checks the account status. Then reset its password and review its recent actions in the audit log.
- **Licence signing key**: held by the licence provider only; compromise recovery is in `provider-tools/licence-issuer/RUNBOOK.md`.
- **GitHub, Netlify, Neon, Cloudflare, Brevo, Paystack and Stripe logins**: use two-factor sign-in on every account; remove people who leave on the day they leave.
