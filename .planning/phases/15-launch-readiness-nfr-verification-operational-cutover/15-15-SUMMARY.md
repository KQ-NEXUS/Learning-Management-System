---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 15
subsystem: e2e-harness
tags: [nfr-03, nfr-12, nfr-13, playwright, email-capture, task-runner, d-08]
status: complete

requires:
  - phase: 15-02
    provides: patched Next 16.3.8 build
  - phase: 15-03
    provides: CI and repository hygiene (gitignore entries for Playwright output)
  - phase: 15-07
    provides: assertSafeDatabaseUrl guard and assert-local-db CLI
provides:
  - "@playwright/test 1.63.0 and @axe-core/playwright 4.13.0 (exact pins) and the test:e2e script"
  - "getBrevoBaseUrl() in src/server/email/config.ts: BREVO_API_BASE_URL, loopback only"
  - "e2e/playwright.config.ts with projects chromium, chrome, edge, firefox, webkit"
  - "e2e/support/email-capture-server.ts (/messages, /inbox, /health), server-env.ts, tasks.ts (runTask)"
  - "e2e/journey.spec.ts leg 1: discover, register, verify, sign in"
  - "scripts/ops/run-task.ts: guarded one-shot runner for the scheduled tasks"
affects: [15-16, 15-17, 15-18, 15-19, 15-20, 15-28, 15-30]

actuals:
  tokens: 8500
  tasks: 3
  commits: 0

tech-stack:
  added: ["@playwright/test 1.63.0", "@axe-core/playwright 4.13.0"]
  patterns:
    - "Email seam: BrevoClient gets baseUrl only when BREVO_API_BASE_URL is set, and only for localhost or 127.0.0.1"
    - "Guard-before-import: run-task.ts calls assertSafeDatabaseUrl before it loads any task module"
    - "Playwright webServer starts the production build (next start) and the capture server from the repository root"

key-files:
  created:
    - e2e/playwright.config.ts
    - e2e/journey.spec.ts
    - e2e/support/server-env.ts
    - e2e/support/email-capture-server.ts
    - e2e/support/tasks.ts
    - scripts/ops/run-task.ts
    - tests/email-base-url.test.ts
    - tests/run-task.test.ts
  modified:
    - package.json
    - package-lock.json
    - src/server/email/config.ts
    - src/server/email/brevo-client.ts

key-decisions:
  - "Both Playwright packages are pinned exactly (no caret), as the threat model asks"
  - "The loopback rule also rejects credentials in the URL, non-http(s) schemes and look-alike hosts such as localhost.evil.test"
  - "Leg 1 stops at the dashboard and does not click Enrol: an Enrol click sets the checkout-intent cookie, and sign-in would then land on the checkout page instead of the dashboard"
  - "Firefox and WebKit binaries were installed by hand from the official Playwright CDN because the Node downloader timed out on this machine"
---

# Phase 15 Plan 15: Browser harness, email capture seam and task runner Summary

An automated browser now registers a brand-new learner from the public catalogue, reads the verification link from a captured email, verifies, signs in and reaches the learner dashboard with no manual step, on five browser projects, with a loopback-only email seam and a guarded runner for scheduled tasks.

## What was built

- **Task 1 (tracer).** Installed `@playwright/test` 1.63.0 and `@axe-core/playwright` 4.13.0 (exact pins), added `npm run test:e2e`. Added `getBrevoBaseUrl()` to `src/server/email/config.ts` and passed `baseUrl` to `BrevoClient` only when it is set. Built the capture server (answers the SDK's `POST /smtp/email` with a message id; serves `GET /messages?to=`, `GET /inbox`, `GET /health`; listens on both loopback addresses only). Wrote the Playwright config (localhost on port 3010, one worker, no retries, `webServer` entries for the capture server and `next start`) and journey leg 1.
- **Task 2.** `tests/email-base-url.test.ts` (seam behaviour, including the SDK client being built with and without `baseUrl`) and `scripts/ops/run-task.ts` with `tests/run-task.test.ts`. The runner accepts the ten task names (the nine scheduled Netlify functions plus `process-export-jobs`, the in-process form of the background function), takes `--target local|staging`, and calls the database guard before it imports any task module. `e2e/support/tasks.ts` exports `runTask(name)`.
- **Task 3.** Added the chrome, edge, firefox and webkit projects (exactly five projects in total) and ran leg 1 on every one.

## Results

| Check | Result |
| --- | --- |
| Leg 1 on chromium | passed |
| Leg 1 on firefox | passed |
| Leg 1 on webkit | passed (session cookie kept over http on localhost; no TLS proxy and no storageState needed) |
| Leg 1 on chrome (branded) | passed |
| Leg 1 on edge (branded) | passed |
| `npx vitest run tests/email-base-url.test.ts tests/run-task.test.ts tests/brevo-client.test.ts tests/email-config.test.ts` | 4 files, 67 tests passed |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every touched file | clean |
| Real run: `run-task.ts drain-domain-events` on the local database | exit 0, printed the task's own summary line |
| Real run against a non-local host, and with an unknown task name | exit 1, host only in the message, valid names listed |

All Playwright runs used the local Docker database (`licence_test`, port 5434) after `assert-local-db.ts` passed, and the production build made against it. No server is left running (ports 3010 and 4010 checked).

The sign-in cookie options were not touched by this plan: no change was made to `src/app/(auth)/signin/actions.ts` (it shows an uncommitted diff, but that comes from earlier Phase 15 plans, not this one).

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Playwright browsers could not be downloaded by the Node installer**
- **Found during:** Task 3
- **Issue:** `npx playwright install firefox webkit` timed out on every CDN mirror, although `curl` reached the same URLs.
- **Fix:** Downloaded the Firefox (build 1543) and WebKit (build 2359) zips from the official `cdn.playwright.dev` URLs with `curl`, unpacked them into the Playwright browser cache (`%LOCALAPPDATA%\ms-playwright\firefox-1543` and `webkit-2359`) and added the `INSTALLATION_COMPLETE` marker. The browsers are user-cache files, not npm packages, and nothing in the repository depends on how they got there. A normal `npx playwright install firefox webkit` on a machine with a working connection gives the same result.
- **Files modified:** none in the repository

**2. [Rule 3 - Blocking] webServer commands ran from the e2e folder**
- **Found during:** Task 1
- **Issue:** Playwright runs `webServer` commands from the config file's folder, so `npx tsx e2e/support/...` resolved to `e2e/e2e/support`.
- **Fix:** Added `cwd` (the repository root) to both `webServer` entries in `e2e/playwright.config.ts`.

**3. [Rule 1 - Bug] runTask would break on a checkout path with spaces**
- **Found during:** Task 2
- **Issue:** The path to the repository contains spaces and Windows runs the command through a shell.
- **Fix:** `runTask` runs from the repository root with a relative script path.

### Plan interpretation

- The plan's first step says "start enrolment or registration as a new visitor". Leg 1 uses the public site's own Register link and does not click Enrol, because an Enrol click stores a checkout-intent cookie and sign-in would then redirect to the checkout page instead of the dashboard that the plan asks to assert. The enrol and pay legs belong to the later journey plans.
- `NODE_ENV=production` is not set in `server-env.ts`: `next start` already runs in production mode, so session cookies are still `Secure`, as in a real deployment.

## Known Stubs

None. `E2E_BASE_URL` can point the same spec at a deployed site later (the capture seam only works against a server started with `BREVO_API_BASE_URL`).

## Threat Flags

None beyond the plan's register. T-15-15-01 is mitigated and tested (13 rejection cases including look-alike hosts); T-15-15-02 is mitigated (guard first, tested that no task module loads when the guard refuses); T-15-15-03 holds (cookie options untouched, WebKit passed without any change); T-15-SC holds (exact pins, no k6 package).

## Owner notes

- Run the journey with the local database URL in the shell, then `npm run build` and `npm run test:e2e -- --project=<name> --grep "leg 1"`. The config stops before any server starts if `DATABASE_URL` is not a local host.
- For the manual unassisted run, start `npx tsx e2e/support/email-capture-server.ts` and the app with `BREVO_API_BASE_URL=http://localhost:4010`, then open `http://localhost:4010/inbox` to click the emailed links.
- Real Safari and an iPhone still need the manual pass (Playwright WebKit is not Safari).

## Neon go-live list

No migration was created by this plan. Nothing here touches the shared database.

## Self-Check: PASSED

- Files present: e2e/playwright.config.ts, e2e/journey.spec.ts, e2e/support/server-env.ts, e2e/support/email-capture-server.ts, e2e/support/tasks.ts, scripts/ops/run-task.ts, tests/email-base-url.test.ts, tests/run-task.test.ts, src/server/email/config.ts (getBrevoBaseUrl), src/server/email/brevo-client.ts.
- package.json devDependencies hold `@playwright/test` 1.63.0 and `@axe-core/playwright` 4.13.0; no `k6` or `@types/k6`.
- Playwright config defines exactly chromium, chrome, edge, firefox, webkit; base URL uses localhost on port 3010.
- No commits were made and nothing is staged (per the run overrides, `commits: 0`).
