# Performance and load harnesses

Three harnesses cover three different questions. They are separate on purpose;
none of them replaces another.

## What each harness measures

| Harness | Command | Question it answers |
| --- | --- | --- |
| Export budget | `npm run test:perf` | Does persisting a 25,000-row report export stay inside its time budget? A Testcontainers service-level test (`tests/export-snapshot-load.perf.test.ts`, config `vitest.perf.config.mts`). It is NOT an HTTP or page benchmark and stays exactly as it is. |
| k6 load | Docker image `grafana/k6:2.3.0`, scripts in this folder | What are the server's document timings and error rate with 150 learners and 10 staff using the site at once? One p75 threshold per core view; a breach exits non-zero. |
| Playwright probe | plan 15-18 | How long until a real browser shows usable primary content (the NFR-02 p75), measured while k6 holds the background load. |

k6 cannot easily call Next.js server actions, so it loads pages and route
handlers and replays signed webhooks. Writes (register, enrol, submit, pay) are
exercised by the Playwright journey, not by k6.

k6 is the Go binary in the Docker image. Do NOT `npm install k6`: the npm
package of that name is a 2017 placeholder, not the tool.

## Seed the load

Every database command starts with the guard. `.env` points at the shared Neon
database, so the shell must carry a local `DATABASE_URL`; the seeder refuses
anything else before it opens a connection.

```bash
# the shell's DATABASE_URL must point at the local Docker Postgres
npx tsx scripts/ops/assert-local-db.ts

# 150 learners, 10 staff, active enrolments, one session each
npx tsx scripts/load/seed-load.ts

# a small run for the smoke test
npx tsx scripts/load/seed-load.ts --learners 10 --staff 2

# add 5,000 orders and 2,000 tickets so the unbounded lists have realistic data
npx tsx scripts/load/seed-load.ts --volume

# one pending Paystack order for the webhook replay
npx tsx scripts/load/seed-load.ts --learners 0 --staff 0 --pending-order
```

The seeder needs the development catalogue (`npx prisma db seed`) because it
enrols into the seeded pilot cohorts `SLP-2026-01`, `SLP-2026-03` and
`FCM-2026-02`. It raises those cohorts' capacity to fit the load learners (they
hold 25 or 40 seats) and recomputes `seatsTaken` from the real rows.

It writes the raw session tokens, the one random password and the ids the
scripts need to `perf/results/tokens.json`. That folder is ignored by git and
the seeder prints counts only. The password is random per run and is never the
default seed password. Re-running updates the same accounts and issues fresh
sessions (the old tokens stop working).

Staging: `--target staging` is refused unless the host is listed in
`STAGING_DATABASE_HOSTS` and `ALLOW_STAGING_DATABASE=1` is set.

## Run k6

Start the local **production build** (`npm run build`, then
`npx next start -p 3010`) with the shell `DATABASE_URL` pointing at the Docker
database and `EMAIL_TRANSPORT=stub`. Stop the server when you are done.

```bash
# Git Bash on Windows: MSYS_NO_PATHCONV stops the volume path being rewritten,
# and pwd -W gives the Windows path Docker Desktop wants.
MSYS_NO_PATHCONV=1 docker run --rm -i \
  -v "$(pwd -W)/perf:/perf" \
  -e BASE_URL=http://host.docker.internal:3010 \
  -e SMOKE=1 \
  grafana/k6:2.3.0 run --summary-export /perf/results/k6-local-smoke.json /perf/pilot-load.js
```

PowerShell: `docker run --rm -i -v "${PWD}/perf:/perf" -e BASE_URL=http://host.docker.internal:3010 -e SMOKE=1 grafana/k6:2.3.0 run --summary-export /perf/results/k6-local-smoke.json /perf/pilot-load.js`

* `SMOKE=1`: 5 learner and 1 staff virtual users for one minute, short think
  time. Proves the harness.
* Without `SMOKE`: the agreed pilot load. Learners ramp to 150 over 2 minutes,
  hold for 10 minutes, ramp down over 30 seconds, with 5 to 15 seconds of think
  time; 10 staff virtual users run alongside.
* The image tag is pinned. Confirm a newer tag exists with `docker pull`
  before bumping it.
* `BASE_URL` has no default. A load run must name its target; never point it at
  the production site. Use the deploy preview URL (plan 15-30).
* Only documents are requested (no static assets), which keeps the run on the
  application and limits the hosting bill.

Thresholds and exit codes: every core view has its own
`http_req_duration{page:<name>}: p(75)<2500`, requests fail below
`http_req_failed: rate<0.01`, and every document must come back 200 without a render error and without
redirecting to `/signin` (`checks: rate>0.999`). A breached threshold makes k6
exit **99**; any other non-zero exit is a script or setup error.

Pages (tag): `dashboard`, `learn`, `course-home`, `lesson`, `results`,
`sessions`, `support`, `staff-overview`, `staff-cohorts`, `staff-cohort`,
`staff-grading`, `staff-support`, `staff-payments`.

### Webhook replay (NFR-03)

Posts one correctly signed Paystack `charge.success` event 10 times at the same
moment and checks the order was settled once. The webhook route re-verifies
every event against Paystack, and a rehearsal must never call a live provider,
so the local server is started with a small preload that answers only that one
verify call:

```bash
npx tsx scripts/load/seed-load.ts --learners 0 --staff 0 --pending-order

PAYSTACK_SECRET_KEY=sk_test_local_rehearsal_only \
PAYSTACK_VERIFY_STUB_FILE=perf/results/pending-order.json \
NODE_OPTIONS="--require ./perf/stubs/paystack-verify-stub.cjs" \
  npx next start -p 3010

MSYS_NO_PATHCONV=1 docker run --rm -i -v "$(pwd -W)/perf:/perf" \
  -e BASE_URL=http://host.docker.internal:3010 \
  -e PAYSTACK_SECRET=sk_test_local_rehearsal_only \
  grafana/k6:2.3.0 run --summary-export /perf/results/webhook-replay-summary.json /perf/webhook-replay.js

npx tsx scripts/load/webhook-replay-report.ts --k6 perf/results/webhook-replay-summary.json
```

The report script reads the local database (guarded) and exits 0 only when there
is exactly one `SUCCEEDED` attempt, one `PROCESSED` webhook event and the order
is `PAID` with its enrolment `ACTIVE`.

### Sign-in burst (ledger A12)

`perf/signin-burst.js` replays the no-JavaScript sign-in form (hidden
`$ACTION_*` inputs) 150 times in 60 seconds, to measure the scrypt cost of a
morning rush. Run with `-e ATTEMPTS=10` for a local check. If the replay cannot
authenticate (no session cookie comes back), the burst is recorded as
**unmeasured** with an owner in the report; it is never silently dropped.
Sign-in is rate limited, so a throttled result is counted apart from a failed
one.

## Where results go

`perf/results/` (tokens, k6 summaries, the pending-order file). It is ignored by
git and must never be committed: the tokens file holds working session cookies
and the load accounts' password. Signed evidence is copied into the phase
`evidence/` folder by hand.

## Staging

Never run the full load against staging first. Plan 15-30 runs a 10 percent
pilot (15 learners, 1 staff) against the Netlify deploy preview and the Neon
branch, checks the Netlify usage page, and only then runs the full 150 + 10.
Local runs are a rehearsal: the laptop shares CPU between k6, Next, Postgres and
the browser, which is why only the staging run is signed off.
