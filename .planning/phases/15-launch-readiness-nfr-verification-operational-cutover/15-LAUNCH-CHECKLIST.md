# Phase 15 launch checklist

Everything that only a named person can do, decide or sign before the product opens to real learners (D-05). The evidence that code and tests produced is in `15-LAUNCH-REPORT.md` (written last, plan 15-31 Task 3). Status of this file: **skeleton, 2026-10-11. No row is signed, no owner is named, no waiver is accepted and no manual check has been done.** Gap-fix batch A (same day) changed code and tests for rows G-01, G-02, G-03, G-06, D-07, B-06, B-11, H-08 and waiver candidate W-15; those rows say what was done and what is left. The changes are in the working tree and are not committed, and a fixed row still needs its owner and signature.

This repository is public. This file holds names of settings and facts only: no connection string, host name, key, token or password.

## How to use this checklist

1. **Production stays closed until every row in "Owner items" is signed (D-06).** The phase can be marked complete when everything code and tests can prove is proven; that does not open production. A row is signed when the Signed cell holds a name and a date.
2. Every row needs one named person in the Owner cell and a due date. "to be named" is a placeholder; `tests/launch-checklist.test.ts` rejects it once the owner has named people (plan 15-31 Task 3 switches that rule on) and always rejects an empty Owner cell.
3. The Type column says who the row belongs to:
   - **developer**: done by the team that built the product, on the test set-up or in the code, before handover.
   - **client handover**: done by the client on the client's own production accounts. The owner stated on 2026-10-11: "Every thing is for test remember the client will set by them selfs most likely". Every hosted value used so far (the Netlify site, the Neon project, the Paystack and Stripe keys, the storage bucket) is test-only. Nothing measured in Phase 15 was measured on the client's production accounts.
4. A failed check that cannot be fixed in time may be covered by a written waiver (D-07) that names who accepted the risk and when it expires. **A critical security, payment, authorization or private-file failure is never waived.** Findings of those kinds are rows in group G below (fix, or decide the rule), not waiver candidates, and the guard test refuses a waiver in those categories.
5. The migration list below is checked against the real `prisma/migrations` folder by `npx vitest run tests/launch-checklist.test.ts`. A new migration folder that is not added to the list fails that test.
6. Do not write a name, a date or an acceptance in this file on someone's behalf.

## Owner items

Groups: A accounts and credentials, B database and backups, C file storage, D hosting, settings, jobs and monitoring, E licence, F legal, privacy, content and people, G defects to fix and rules to decide (cannot be waived), H checks and evidence still to do, I clean-up and carried items.

### A. Accounts and credentials

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | Paystack production account: live secret key and subaccount code saved in the hosting settings for the Production context; the webhook address registered with Paystack; one small real payment made and refunded | Gateway production credentials are an owner item (D-06). Only test keys have been used so far | client handover | to be named | | |
| A-02 | Stripe production account: live secret key, webhook signing secret and connected account id saved for the Production context; the webhook endpoint registered with Stripe; one small real payment made and refunded | Same as A-01, for dollar payments | client handover | to be named | | |
| A-03 | Email sender: the sending domain verified with the email provider (Brevo), `BREVO_API_KEY`, `EMAIL_SENDER_NAME` and `EMAIL_SENDER_ADDRESS` saved for Production, `EMAIL_TRANSPORT` unset or `brevo` | The app refuses to send without a sender; mail from an unverified domain goes to spam | client handover | to be named | | |
| A-04 | One real email sent and received through Brevo with real credentials (the Phase 13 live check, D-24) | Carried from Phase 13: never run with a real key | client handover | to be named | | |
| A-05 | `SUPPORT_CONTACT_EMAIL` set to the client's real support address for Production | Shown to learners in emails and on support pages | client handover | to be named | | |
| A-06 | Who holds the Netlify, Neon, storage, payment and email accounts, and the private "Who to call" contact list for incidents | The public runbook `docs/runbooks/incident-and-secrets.md` names roles only | client handover | to be named | | |

### B. Database and backups

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| B-01 | **Blocking.** A Neon plan with at least 24 hours of history for production, or a daily external dump (restore runbook, Route B) with the dump stored away from Neon | The target is to lose at most 24 hours of data (RPO). The Free plan keeps 6 hours of history, so damage noticed later than 6 hours cannot be undone. The restore rehearsal passed (`evidence/restore-neon-pitr.json`) and does not change this | client handover | to be named | | |
| B-02 | Neon compute allowance checked for production, and a plan chosen that the always-awake database fits in | About 68 compute-unit hours were used between 1 and 11 October: the database never sleeps (per-minute jobs and the uptime monitor keep it awake), about 200 a month. If the allowance runs out Neon suspends the database | client handover | to be named | | |
| B-03 | Neon compute allowance of the current test project checked now; pause the staging uptime monitor or delete the staging branch after sign-off (see I-01) | The test project shares one allowance between its production and staging branches | developer | to be named | | |
| B-04 | `npx prisma migrate status` run against production before go-live, and the result compared with "Neon go-live migrations (in order)" below | Staging (schema copied from the production branch) lacked 12 migrations, not the 7 named in older notes (the deployment runbook now lists the twelve, row B-06). Production was never contacted in Phase 15 | client handover | to be named | | |
| B-05 | The migrations applied on production in the listed order, with the pre-checks, before the new code is published | Code that expects tables or columns that are not there fails | client handover | to be named | | |
| B-06 | **Done in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`).** `docs/runbooks/deployment.md` step 5 lists the same twelve migrations in the same order as the list below and says to run `prisma migrate status` first | The runbook and this list must agree. `tests/launch-checklist.test.ts` now fails if they differ in content or order | developer | to be named | | |
| B-07 | `privacy.manage` given to the Administrator role on production (re-run the seed, or tick it on the roles screen) | An existing Administrator role does not get the new permission by itself, so nobody could open the learner privacy tool | client handover | to be named | | |
| B-08 | The seed re-run on production if that database was seeded before 2026-09-20 | Repairs a quiz nobody can pass and an assignment that rejects every PDF, and sets missing cohort prices | client handover | to be named | | |
| B-09 | No account on production still has the development seed password (`rotate-seed-passwords --check`) | The seed password is in the public repository (prohibition P1) | client handover | to be named | | |
| B-10 | The restore runbook's last step (point the app at the restored branch and redeploy, Route A step 4) timed once | Not rehearsed: the measured 37 seconds does not include it, so the 8-hour recovery target is not proven end to end | developer | to be named | | |
| B-11 | **Done in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`).** One line added to `docs/runbooks/restore.md` (Route A, step 2): Neon may place the restore point slightly earlier than asked (30 seconds in the rehearsal) | Found in the rehearsal (plan 15-29). `tests/runbooks.test.ts` still passes | developer | to be named | | |

### C. File storage

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | The client's own production bucket created, with a CORS rule that allows the production site address to PUT with a content-type header | Browser uploads go straight to the bucket; on staging the upload failed until the CORS rule named the site address | client handover | to be named | | |
| C-02 | A storage token with Object Read and Write on that bucket; `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE` saved for the **Production** context with the **Functions** scope, then a new build | On staging the key was saved without reaching the functions and uploads failed five times with an empty key. Whether the Production context has the keys was never verified | client handover | to be named | | |
| C-03 | One upload (an assignment file) and one certificate download tried on the live site after its first deploy | The only proof that C-01 and C-02 are right | client handover | to be named | | |
| C-04 | The production bucket has public access off, no public bucket domain and no public development address enabled | Private files rely on the bucket being private (ledger OQ7). The local proof does not cover a hosted bucket's settings | client handover | to be named | | |
| C-05 | Object backup or versioning switched on for the production bucket | The database backup does not contain uploaded files or certificates (ledger A14) | client handover | to be named | | |

### D. Hosting, settings, jobs and monitoring

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | Every production variable in the table in `docs/runbooks/deployment.md` set for the Production context with the right scopes: `DATABASE_URL` (pooled), `APP_BASE_URL`, `EXPORT_DISPATCH_SECRET`, the email, payment and storage values (A-01 to A-05, C-02), Node version 22 | A missing or mis-scoped value fails quietly, as the storage key did on staging | client handover | to be named | | |
| D-02 | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` set for Production (32 random bytes, base64) | Without it, pages left open across a deploy fail on their next action (ledger A11) | client handover | to be named | | |
| D-03 | Every scheduled function confirmed running on production: `check-licence`, `drain-domain-events`, `dispatch-export-jobs`, `process-export-jobs-background`, `expire-export-jobs`, `reconcile-payments`, `release-expired-holds`, `close-resolved-tickets`, `cleanup-notifications`, `cleanup-stale-uploads` | Scheduled functions do not run on deploy previews, so none of them was seen running on a schedule in Phase 15 | client handover | to be named | | |
| D-04 | An uptime monitor on the production `/api/health` address, with alerts going to a named person | The 99.5 percent availability target needs a record; the current monitor watches the staging preview | client handover | to be named | | |
| D-05 | Netlify Team usage read after the full load run of 2026-10-11 | Could not be read from the test machine; the run used the same credits as the test site | developer | to be named | | |
| D-06 | The uptime monitor's log read for 07:26 to 07:39 UTC on 2026-10-11 | The availability record during the full run could not be read from the test machine | developer | to be named | | |
| D-07 | **Changed in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`); not proven until CI runs on a pushed commit.** (a) The integration job starts a digest-pinned MinIO on the loopback address with the `lms-private` bucket before the tests. (b) The unit job sets `VITEST_SKIP_INTEGRATION=1`, which `vitest.config.mts` reads, because the command-line exclude never applied. (c) `tests/ticket-phase-invariants.test.ts` was out of date and now reads the shared learner nav. Left to do: commit, push, and see the first green run | Evidence: `tests/ci-config.test.ts`, 20 of 20 (5 new); `vitest list` with the switch selects 288 files and no integration file, and the integration job still selects all 85; `tests/ticket-phase-invariants.test.ts`, 9 of 9; the pinned image was started locally in the same way and the bucket was private. Not covered: the slow tests of I-06 have no explicit timeout in the integration job, and six database-backed files not named `*.integration.test.ts` still run in the unit job | developer | to be named | | |
| D-08 | The Dependabot configuration accepted on GitHub (no parse error); `e2e-nightly` run once by hand | Human checks left by plans 15-02 and 15-19 | developer | to be named | | |
| D-09 | Branch protection on `main` and `develop` requiring the CI checks (optional) | Suggested by plan 15-02; a repository setting | developer | to be named | | |

### E. Licence

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| E-01 | Production licence signing key made with the provider tool, the private key kept offline, the PUBLIC key added to `PRODUCTION_TRUSTED_KEYS` in a release | Phase 14 go-live item; no production key exists yet | developer | to be named | | |
| E-02 | One real licence issued and activated on production | Without an activated licence the deployment goes into restricted mode after the grace period | client handover | to be named | | |
| E-03 | The two new licence continuity exceptions confirmed: privacy export (`privacy-export-service.ts`) and privacy lookup and record (`privacy-read-service.ts`) stay available in restricted mode | Added in plans 15-21 and 15-22 so a learner's data can still be exported when the licence has lapsed (LIC-08). They relax licence enforcement, so a person confirms them | developer | to be named | | |
| E-04 | The Word copies of the PRD and PXR regenerated and the commercial contract wording aligned | The Phase 14 edits exist only in local markdown copies that git ignores | developer | to be named | | |
| E-05 | Phase 14 closed with `/gsd-verify-work 14` once E-01, E-02, D-03 and the licence manual checks are done | Phase 14 is still `human_needed` and is not marked complete | developer | to be named | | |

### F. Legal, privacy, content and people

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Legal and privacy approval of the terms, the privacy notice and what the anonymise tool changes, removes and keeps (`15-DECISIONS.md`) | Owner item under D-06 | client handover | to be named | | |
| F-02 | A retention schedule approved, including the proposal for old sessions, sign-in throttle rows and used verification tokens | Nothing purges these today, and hard deletion stays blocked until a schedule and a legal-hold process are approved (D-12, ledger P-04) | client handover | to be named | | |
| F-03 | Decision: should anonymising a learner also blank the address in the email delivery log and the IP address and browser on old sessions | Not covered by the recorded decision; both are kept today (plan 15-16) | client handover | to be named | | |
| F-04 | Decision: should a learner's data export include staff notes and reasons, ticket attachments and the submitted files themselves | Today the file lists names, sizes and receipt ids, not the files or staff notes (plan 15-21) | client handover | to be named | | |
| F-05 | Support staffing: who answers learner tickets, in which hours, and who covers incidents | Owner item under D-06 | client handover | to be named | | |
| F-06 | A caption file uploaded for every pilot video lesson | The NFR-09 decision was to build captions, with no waiver. Publishing warns about a video without captions and does not block it | client handover | to be named | | |
| F-07 | The learner number pattern chosen and saved (Administration, Learner numbers); if existing learners should have the lowest numbers, "Give these learners numbers" run before any new learner registers | Numbering stays off until a pattern is saved; a number can never be changed or taken back | client handover | to be named | | |
| F-08 | The staff override used for any learner who passed a quiz before the A-01 fix and is still locked out of later lessons | Those learners stay locked until a staff member overrides | client handover | to be named | | |
| F-09 | The PRD 14.2 usability measure run: moderated Administrator, Instructor and Learner scripts each reach at least 80 percent task success without help | A launch measure that needs real people; not done | client handover | to be named | | |

### G. Defects to fix and rules to decide (cannot be waived, D-07)

These touch payment, authorization, private files or security. They are not offered as waivers. Each is either fixed, or a named person decides and signs the rule.

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| G-01 | **Fixed in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`).** `/staff/reconciliation/[caseId]` failed for a case whose order has no correlation id (Postgres error 42P18). The cast is in `getCaseDetail`. Left to do: review, commit, and open such a case once in a browser | Evidence: `tests/reconciliation-case.integration.test.ts`, 5 of 5 on Testcontainers Postgres; the new case (an order with no correlation id) was seen failing with 42P18 before the fix. It also proves that an audit row with no correlation id is not matched to such an order | developer | to be named | | |
| G-02 | **Fixed in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`).** `makeClient` in `storage-service.ts` stops with `S3_ACCESS_KEY_ID is not configured.` or `S3_SECRET_ACCESS_KEY is not configured.` when the value is missing, empty or blank, at the first call that needs storage, not when the module is imported. Left to do: review and commit; C-02 and C-03 are still needed on production | Evidence: `tests/storage-credentials.test.ts`, 12 of 12 (new); `tests/storage-presign-checksum.test.ts`, 2 of 2, unchanged. Before the fix a link was signed with an empty key and the failure showed only in the browser | developer | to be named | | |
| G-03 | **Fixed in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`), with no database migration.** Export files are stored under `exports/<job id>/<random UUID>`. The worker makes the key once when it claims the job and stores it in the existing `ExportJob.storageKey` column, so a retried job reuses it. Files made before the change keep their old path and stay downloadable until they expire. Left to do: review and commit | Evidence: `tests/export-worker.integration.test.ts`, 10 of 10 (5 new: key made at claim, upload uses the stored key, a stale retry reuses it, an old claim gets a key, a failed job loses it); `tests/storage-keys.test.ts`, 34 of 34; `tests/export-storage.test.ts`, 4 of 4; `evidence/private-files-local.json` now records the export key as ending in a UUID | developer | to be named | | |
| G-04 | Decide: the export download refusal is one fixed page (the same for every reason, naming no job) and not an empty answer like other private downloads | It cannot confirm that a file exists; it differs from the pattern on purpose because a person follows this link in a browser (plan 15-27) | developer | to be named | | |
| G-05 | Decide: video links stay valid for 4 hours. Accept that as short-lived, or lower it | Ledger P-08 leaves this to the owner; lowering it means changing the test and the setting together | client handover | to be named | | |
| G-06 | **Fixed in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`).** A staff grant now stops AT its end time, as the written rule says ("a grant whose end instant equals the request time is treated as ended", plan 15-26). The start time is still included. The email recipient query, the one other place that still counted the end instant as inside, was changed with it. Left to do: review and commit | Evidence: `tests/scope.test.ts`, 25 of 25 (6 new edge cases); `tests/authz-revocation.integration.test.ts`, 15 of 15 (the end-instant case now expects a refusal at the exact instant); `tests/staff-recipient-service.test.ts`, 4 of 4 (the SQL and `isGrantActive` agree to the millisecond at both edges) | developer | to be named | | |
| G-07 | Decide: only staff with the Global scope can create an assessment; an instructor scoped to one course is refused for their own course | It fails safe (nobody gets in who should not), but instructors cannot author assessments. One change in `assessment-service.ts` if they should | developer | to be named | | |
| G-08 | Keep: the checksum fix in commit `9be7af3` (upload links no longer carry the checksum of an empty file). Still in place after gap-fix batch A changed the same function for G-02 | A real defect found on staging and already fixed; listed so it is not reverted. `tests/storage-presign-checksum.test.ts` still passes, 2 of 2 | developer | to be named | | |

### H. Checks and evidence still to do

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| H-01 | The screen reader pass (15 steps, NVDA on desktop and VoiceOver on iPhone) in `e2e/MANUAL-CHECKS.md` | Not done. A tool cannot judge whether a page makes sense read aloud | developer | to be named | | |
| H-02 | The real Safari and iPhone check (12 steps) | Not done. The automated WebKit run is not Safari; the versions recorded here are also the proof for older browser versions | developer | to be named | | |
| H-03 | The keyboard-only walkthrough (10 steps) | Not done | developer | to be named | | |
| H-04 | The licence screens check (11 steps, carried from Phase 14) | Done 2026-10-13 by the assistant in a visible browser on a local test copy, except LC-04 (screen reader), which is not done. Found and fixed in the working tree: copy button never reset, Publish not disabled in restricted mode, refusal screen without a heading | developer | to be named | | |
| H-05 | The unassisted journey (D-08, 11 steps) by a person who has never used the product, with an observer | Not done. The automated journey passing is not a substitute | developer | to be named | | |
| H-06 | A human look in a real browser at the Operations status page, the sidebar with and without `privacy.manage`, and the anonymise "danger zone" | Plans 15-13 and 15-22 built these without opening them in a browser | developer | to be named | | |
| H-07 | The staff payments list: status tabs, counts, search and the provider filter cover only the 50 rows on the current page | Staff can read "All 50" when 120 payments exist and can miss a payment in search. See waiver candidate W-12 | developer | to be named | | |
| H-08 | **Run in gap-fix batch A with a throwaway local object store.** `submission-service` 11 of 11, `certificate-download` 6 of 6, `certificate-unicode-file` 12 of 12, `authz-private-files` 40 of 40 | Needed to complete the full-suite record (plan 15-28). In a first run of four files one after another on a loaded machine, one case in each certificate file failed because the certificate file took longer than the 6-second wait after issuing; both files passed when run again on their own | developer | to be named | | |
| H-09 | The per-job "Operations status signal" lines in `docs/runbooks/job-recovery.md` re-checked against what the Operations status page really shows | The runbook was written before the page was built (plan 15-11) | developer | to be named | | |
| H-10 | The co-worker told about the two shared-file edits made under the general agreement: `ResourceForm.tsx` (hidden step names) and `ResourceTable.tsx` (search box width, keyboard-reachable table box) | `15-DECISIONS.md` records them as "covered by the agreed row", not agreed one by one | developer | to be named | | |
| H-11 | The Phase 15 working-tree changes reviewed, including the four record-state fixes of plan 15-26 | Commits are made only when the owner asks | developer | to be named | | |
| H-12 | `/gsd-verify-work 15` after this checklist and the report are complete | Phase sign-off | developer | to be named | | |

### I. Clean-up and carried items

| Id | Item | Why | Type | Owner | Due | Signed (name and date) |
| --- | --- | --- | --- | --- | --- | --- |
| I-01 | After sign-off: delete the staging Neon branch, remove the deploy-preview variables, pause or delete the staging uptime monitor | The staging branch has no expiry any more and the monitor keeps the database awake (B-02, B-03) | developer | to be named | | |
| I-02 | Staging data left behind (171 accounts, 5,003 orders, 2,000 tickets, the journey learners) goes with the branch; the token file `perf/results/tokens-staging.json` and the raw results on the test machine deleted | The token file holds the shared load password and 160 session tokens. It is ignored by git | developer | to be named | | |
| I-03 | Phase 11 plan 11-33 closed: human sign-off on the Yoruba, Polish and CJK certificate PDFs | Carried from Phase 11 | developer | to be named | | |
| I-04 | Optional: `DROP DATABASE licence_a11y` on the local Docker Postgres | Left behind by the accessibility sweeps (plans 15-19, 15-20) | developer | to be named | | |
| I-05 | Development-only dependency advisories (8 high in test and lint tooling) handled through a Dependabot group | Outside the launch gate, which checks production dependencies only (0 found) | developer | to be named | | |
| I-06 | Slow tests given explicit timeouts: `licence-enforcement-boundary`, `staff-support.integration`, `support-workspace` | They exceed the default 5 seconds on a slow machine and fail for that reason only | developer | to be named | | |
| I-07 | The gated upload diagnostic `e2e/support/upload-diagnostic.ts` kept (off by default) or removed | Added while finding the staging upload fault; untracked | developer | to be named | | |
| I-08 | The folded todo `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` closed, and the open lines of the Phase 15 prerequisites todo (review and commit the UI work, the audit scripts, the UI prototype copy, Wave 3 with the co-worker) decided | Housekeeping left by plan 15-08 and the prerequisites todo | developer | to be named | | |

## Neon go-live migrations (in order)

**Check production first.** Run `npx prisma migrate status` against the production database from a trusted machine and compare the pending list with this table (row B-04). Production was not contacted in Phase 15. What is known: the staging branch's schema was copied from the production branch and it lacked the 12 migrations below, so production is probably 12 behind, not the 7 that the older notes name. If `prisma migrate status` shows a different pending list, stop and correct this table before applying anything. If production reports no migration history at all, do not use `migrate resolve` without comparing the schema with each migration first, as plan 15-29 did for staging.

**How to apply.** Use `npx prisma migrate deploy` over the direct connection (the unpooled connection string, not the pooled one the app uses). It applies every pending migration in folder order in one run. Apply before publishing the code that needs the tables. Never use `prisma db push`, `prisma migrate dev`, `prisma migrate reset` or `--accept-data-loss` on production: two indexes in row 10 exist only in the migration and `db push` may propose dropping them. Migrations are forward-only; see `docs/runbooks/rollback.md`.

The first 18 migrations (up to `20260925120000_ticket_queue_changed_event`) were found already present in the copied schema and are not listed. That includes `20260919120000_enrolment_one_live_per_learner_cohort`, whose application on shared databases was the human step of Phase 11 plan 11-33; confirm it shows as applied in the B-04 check.

| Order | Migration folder | Purpose | Pre-check | How to apply |
| --- | --- | --- | --- | --- |
| 1 | `20260927015627_communications_notifications` | Phase 13 messages: the Notification and EmailPreference tables, retry columns on the email log and on events | None; additive | apply with prisma migrate deploy over the direct connection |
| 2 | `20260927120000_hash_bearer_tokens` | Session cookies and emailed link tokens are stored as a hash; existing rows are converted in place | It rewrites existing rows: take a restore point first. Sessions and outstanding links keep working | apply with prisma migrate deploy over the direct connection |
| 3 | `20260927130000_login_throttle` | The per-device sign-in throttle table | None; additive | apply with prisma migrate deploy over the direct connection |
| 4 | `20260927140000_reconcile_backoff` | Retry state for the payment reconciliation job | None; additive | apply with prisma migrate deploy over the direct connection |
| 5 | `20260927150000_video_watch_pacing` | Staff-set video length and the watch pacing start time | None; existing progress rows get their last update as the start | apply with prisma migrate deploy over the direct connection |
| 6 | `20261001120000_licence_deployment_control` | Phase 14 licence tables (deployment identity, licence state, licence records) | None; additive. Apply before or with the deploy | apply with prisma migrate deploy over the direct connection |
| 7 | `20261003120000_mark_pre_notification_event_backlog_processed` | Marks events older than one hour as already handled, so the old backlog is not emailed to learners | **Must be applied before the email sender (`drain-domain-events`) first runs on production.** Check that the sender is not yet running | apply with prisma migrate deploy over the direct connection |
| 8 | `20261004120000_user_password_is_temporary` | A flag for accounts still on a password an administrator set | None; additive | apply with prisma migrate deploy over the direct connection |
| 9 | `20261004150000_learner_numbers` | The learner number on each account and its single settings row, switched off | None; additive. Numbering stays off until F-07 | apply with prisma migrate deploy over the direct connection |
| 10 | `20261006120000_grade_completion_uniqueness` | One grade per submission and one open completion record per enrolment, scope and course (two partial unique indexes) | Run the two diagnostic SELECTs below; each must return no rows. The migration stops and changes nothing if duplicates exist; a person decides which duplicate is real | apply with prisma migrate deploy over the direct connection |
| 11 | `20261007120000_user_anonymisation` | Two columns that mark an anonymised account and who did it | None; additive. Then do B-07 (`privacy.manage` on Administrator) | apply with prisma migrate deploy over the direct connection |
| 12 | `20261008120000_lesson_video_captions` | Caption files linked to a lesson video (three columns, one index) | None; additive | apply with prisma migrate deploy over the direct connection |

Diagnostic SELECTs for row 10 (read-only; each must return no rows):

```sql
SELECT "submissionId", count(*) AS grades
FROM "Grade"
WHERE "submissionId" IS NOT NULL
GROUP BY "submissionId"
HAVING count(*) > 1;

SELECT "enrolmentId", scope, COALESCE("courseId", '') AS course, count(*) AS open_records
FROM "CompletionRecord"
WHERE "supersededAt" IS NULL
GROUP BY "enrolmentId", scope, COALESCE("courseId", '')
HAVING count(*) > 1;
```

After applying: run `npx prisma migrate status` again and confirm the schema is up to date, then do B-07, B-08 and B-09.

## Waivers (D-07)

A waiver names the finding, who accepted the risk, the date it expires and what limits the risk until then. Security, payment, authorization and private-file findings are in group G above and cannot appear here; the guard test refuses those categories in both tables.

### Accepted waivers

None yet. A row is added here only when the owner gives the person and the expiry date (plan 15-31 Task 2).

| Id | Finding | Category | Accepted by | Expires | Mitigation until then |
| --- | --- | --- | --- | --- | --- |

### Candidates awaiting the owner's decision

Nothing in this table is accepted. "accept" in the Recommendation column is the executor's suggestion, not a decision. A rejected candidate must be fixed before launch.

| Id | Finding | Category | Evidence | Recommendation | Mitigation until then |
| --- | --- | --- | --- | --- | --- |
| W-01 | The lesson page has no browser timing under full load (the samples were lost to a fault in the test harness, not in the page) | performance evidence | `evidence/staging-probe.json`, `evidence/staging-load.json`: server timing under load p75 658 ms; browser timing with no load p75 680 ms; target 2,500 ms | accept | Re-measure that one view at the next approved load run |
| W-02 | Two short slow spells in the full run (about 10 seconds and 2 seconds) have no known cause | performance | `evidence/staging-load.json` slowest requests; every threshold passed and no request failed | accept | Read the hosting function log for those seconds; watch the first weeks of production |
| W-03 | The signed load numbers were measured on commit `9a68b7a`; the preview now serves `9be7af3` | performance evidence | `15-STAGING.md`; the later commit changes only how storage links are signed | accept | Re-measure at the next approved load run |
| W-04 | The "cold" samples were not true cold starts (the uptime monitor kept the site and database awake); first visits of about 6.5 to 7 seconds were seen at the start of a load | performance | `evidence/staging-probe.json` cold samples; plan 15-30 notes | accept | The production uptime monitor keeps the site warm; record real first-visit times after go-live |
| W-05 | The full sign-in burst (150 sign-ins in 60 seconds) was not measured; only 10 sign-ins in 10 seconds, locally | performance | plan 15-14 notes; the pilot and full runs used ready-made sessions | accept | Stagger the first cohort's invitations; measure at the next approved load run |
| W-06 | The automated accessibility, responsive and keyboard sweeps ran on Chromium only | browser evidence | `evidence/a11y-axe-local.json`, `evidence/responsive-local.json`, `evidence/keyboard-local.json`; the journey ran on three engines | accept only after H-02 is done | The manual Safari and iPhone check (H-02) |
| W-07 | Some staff pages with their own sideways scrolling were not in the narrow-screen sweep: reconciliation workspace, audit table, report dashboards, export history, the staff learner results table | accessibility | plan 15-20 notes | accept | Include them in H-01 to H-03, or in the next sweep |
| W-08 | The two refusal screens (Operations status and Learner privacy, for staff without the permission) have no page heading | accessibility | `evidence/a11y-axe-local.json` (best-practice rule, not a WCAG failure) | accept | The refusal message is still read; fix with the co-worker who owns the screens |
| W-09 | The staff preview of a video lesson shows no captions; the learner player does | accessibility | plans 15-23 and 15-24 notes | accept | Staff check captions on the learner view |
| W-10 | Tab strips scroll sideways inside themselves and are on the sweep's allow-list; each data table adds one keyboard stop | accessibility | `evidence/responsive-local.json` allow-list (4 entries) | accept | Covered by the keyboard walkthrough (H-03) |
| W-11 | One of the first 20 automated journeys stalled on "Mark complete" and did not recur in later runs; the cause is unknown | reliability | `evidence/journey-reliability-local.json`, plan 15-17 notes | accept | Diagnostics were added; watch lesson-progress times in production |
| W-12 | The staff payments list filters, counts and search cover only the current page of 50 (H-07). Not classed as a payment failure: no money is taken, lost or mis-recorded | staff list display | `deferred-items.md` row 15-09 | fix first | If waived: staff page through the list or use the reconciliation screens |
| W-13 | Staff are not refused when adding a session to a cancelled or completed cohort, editing a cancelled cohort, or publishing an archived assessment (it goes straight to published) | record-state rule | `evidence/authz-scope-state-local.json`, `deferred-items.md` row 15-26; not a permission bypass | fix first | If waived: tell staff not to edit closed cohorts |
| W-14 | A repeat archive of a course, programme, assessment or template answers success; so do withdrawing or saving a withdrawn lesson, renaming a withdrawn module and restoring a module that is not withdrawn. The write effect of the last four was not analysed | record-state rule | `deferred-items.md` row 15-26 | accept after the write effect of the last four is checked | None needed if the check shows no change to data |
| W-15 | **Fixed in the working tree, not committed (gap-fix batch A, `15-GAP-FIXES-A.md`); no waiver needed for the main case.** A learner downloading their own certificate no longer adds an "authorization.denied" line: the route checks ownership first. What remains: the owner of a REVOKED certificate is refused and still leaves one such line per attempt | audit log quality | `tests/certificate-download-route.test.ts` (17 of 17), `tests/authz-private-files.integration.test.ts` (40 of 40: the owner leaves no denial line in three downloads; another learner and staff scoped elsewhere still leave one each) | no waiver needed once the fix is reviewed and committed; decide whether the revoked-certificate line matters | None needed |
| W-16 | Three pieces of wording on the learner privacy screens were written by the executor and not reviewed: the export failure message, the "Removed: ..." labels, the "by a staff member" fallback | content | plan 15-22 notes | accept after the owner reads the three lines | None |
| W-17 | The "next up" card on the learner dashboard still shows a session time in the cohort's own time zone, so one plan line ("imports LagosTime") is not met | plan conformance | plan 15-33 notes; follows the adopted rule that session times stay in the cohort's zone (ledger OQ4) | accept | None; reversing OQ4 would be a new decision |
| W-18 | The whole-page refusal screens of the support ticket (`/staff/support/[reference]`) and the reconciliation case (`/staff/reconciliation/[caseId]`) have no page heading, the same gap as W-08. The licence page had it too and is fixed in the working tree. Other whole-page refusals (payment detail, the list pages, the new-role, new-user and learner-number forms) were not checked in a browser; the shared refusal panels in `DetailLayout`, `ResourceTable` and `ResourceForm` draw only an h2 | accessibility | LC-11 in `e2e/MANUAL-CHECKS.md`; code in `src/components/primitives/DetailLayout.tsx` | fix first, in the shared panels, with the co-worker who owns them | The refusal message is still read by a screen reader; staff without the permission rarely reach these addresses |
| W-19 | In restricted mode the Add enrolment picker shows an administrator the "Ask an administrator to check the licence status" wording instead of the "Open Licence" wording | wording | LC-09 | accept | None; the control is disabled either way |

Not candidates, for the record: small table links (ledger OQ10) were not flagged by the accessibility sweep, so no waiver is needed; captions for lesson video (NFR-09) were built, so no waiver is recorded (see F-06); `/staff/payments` failing in a production build (found in plan 15-14) was fixed and the page was measured on staging.

## Manual checks

The steps and the results tables are in `e2e/MANUAL-CHECKS.md`. The filled tables are copied into `15-LAUNCH-REPORT.md` with tester, device, versions and date. A failed step on a security, payment, authorization or private-file matter is never waived.

| Section in e2e/MANUAL-CHECKS.md | Steps | Where to run it | Status on 2026-10-11 | Checklist row |
| --- | --- | --- | --- | --- |
| Screen reader pass | SR-01 to SR-15 | Local production build, NVDA on desktop and VoiceOver on iPhone | Not done; results table empty | H-01 |
| Real Safari and iPhone | SF-01 to SF-12 | Staging deploy preview, payment in provider test mode | Not done; results table empty | H-02 |
| Keyboard-only walkthrough | KB-01 to KB-10 | Local production build, desktop browser | Not done; results table empty | H-03 |
| Licence screens (Phase 14 folded) | LC-01 to LC-11 | Local or staging, including a restricted deployment | Done 2026-10-13 except LC-04 (needs a screen reader); results table filled | H-04 |
| Unassisted manual journey (D-08) | UJ-01 to UJ-11 | Staging deploy preview, a tester who has never used the product, with an observer | Not done; results table empty | H-05 |

Do the staging sections (Safari and iPhone, unassisted journey) before the staging branch is deleted (I-01).
