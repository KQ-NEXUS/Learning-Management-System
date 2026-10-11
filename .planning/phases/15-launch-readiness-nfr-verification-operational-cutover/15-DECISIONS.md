# Phase 15 Decisions

Human decision record for the two owner gates of Phase 15 (Launch Readiness: NFR Verification and Operational Cutover), the adopted-assumptions ledger, the shared UI ownership table and the edge, prohibition and UI-considerations index. Source: plan 15-01. Both decisions were answered by the project owner on 2026-10-06 through the orchestrator session. Fixed frame, not reopened by either decision: D-07 (written, time-boxed waivers; critical security, payment, authorization and private-file failures are never waived), D-10 (GitHub Actions and Dependabot) and D-12 (permission-gated, audited privacy tool; hard deletion stays blocked; no learner self-service).

## NFR-09 accessible media decision

**Reversibility:** costly (option a adds a caption data model, an upload type and a schema migration that every later video lesson relies on).

**Owner reply (verbatim):** `option-a`

**Meaning:** build narrow WebVTT caption tracks, as scoped in `04.1-CAPTIONS-SCOPE.md` and plan 15-01 Task 1:

- A caption resource linked to one video resource, with language and label metadata.
- `text/vtt` added to the upload allow-list, behind the same malware-scan gate as every other upload.
- Delivery through the existing short-lived presigned download path.
- A `track` element in the learner player (`LessonMediaPlayer`), fed by `LessonContent`.
- Staff upload of a caption file on the lesson editor.
- A publish-time warning (not a block) for a video lesson without captions.
- One additive schema migration, added to the Neon go-live list.

No waiver is recorded for NFR-09. Working video is never hidden or disabled, and captions are never fabricated from the lesson title or body (rejected non-options in `04.1-CAPTIONS-SCOPE.md`).

**Edit list:** none (option-a, no option-c changes).

**Read by:** plans 15-23 and 15-24 read this NFR-09 accessible media decision in their first task precondition (option-a, so both plans execute); plan 15-31 would copy a waiver into the launch checklist only for option-b, which was not chosen.

## Privacy tool permission and retention decision

**Reversibility:** costly (a new catalogue permission is stored in role permission arrays in every database).

**Owner reply (verbatim):** `option-a`

**Meaning:** a new permission `privacy.manage`, Global only, gates both actions of the staff privacy tool (export one learner's data, anonymise one account). It is added to the closed catalogue through the PRD section 1.3 approval path (this record is that approval) and joins `GLOBAL_ONLY_PERMISSIONS` like `licence.*`; the seeded Administrator role receives it through its full permission spread. Plan 15-16 must use exactly the identifier `privacy.manage` in `src/server/permissions/catalogue.ts`, classify it in `LICENCE_PERMISSION_EFFECT` (`src/server/licence/effects.ts`), group it in `permission-groups.ts` and update the permission tests. `users.manage` and `audit.export` are not reused for this tool.

Licence classification (whatever the permission): anonymise is a write (blocked in licence restricted mode); export of one person's data is continuity (LIC-08 permitted data-access route). Both actions are audited with actor, target, reason and outcome.

**Retention parameters (the proposed conservative default, accepted unchanged by option-a; rendered on S3 "What is kept" from one service policy constant):**

Anonymise CHANGES:
1. name to "Anonymised learner"
2. email to a unique `anonymised-{userId}@invalid.example` value
3. phone (cleared)
4. pending email (cleared)
5. password hash (cleared)
6. status to `DEACTIVATED`
7. all sessions (revoked)

Anonymise REMOVES:
1. email preferences
2. in-app notifications
3. verification tokens for the old address
4. sign-in throttle rows keyed by the old address

Anonymise KEEPS unchanged: orders, payment attempts, refunds, webhook events, enrolments, attendance, grades, completion records, certificates including the printed learner name (so issued credentials stay verifiable), support tickets and their attachments, submissions, the learner number, policy acceptances, and audit events (the audit log is append-only and is never rewritten).

**Hard deletion:** stays blocked (D-12). No option offered or recorded here deletes a User row or any retained financial, audit or credential record; deletion waits for an owner-approved retention schedule and legal-hold process.

**Edit list:** none (option-a, no option-c retention changes).

**Read by:** plans 15-16 (catalogue identifier and the anonymise policy constant), 15-21 (export action and its licence class) and 15-22 (staff privacy screens, nav permission row and "What is kept") read this privacy tool permission and retention decision.

## Adopted assumptions ledger

Every row below is adopted at the stated default. None is a locked decision; each stays visible here so it can be redirected. Sources: 15-RESEARCH.md "Open Questions (RESOLVED)" and "Assumptions Log", 15-UI-SPEC.md "Open items for the planner", and the planner's own choices (P-rows). OQ1, OQ5 and OQ9 are decided by the two owner gates above, not adopted here; A1, A3, A4 and A17 are not carried (A3 is covered by OQ3; A1, A4 and A17 are resolved inside the plans that read them).

| Id | Default adopted | Plan that depends on it | How to redirect |
| --- | --- | --- | --- |
| OQ2 | Production Neon plan, Netlify team sharing and the Postgres major are unknown; the staging setup plan 15-29 asks for them in its owner checkpoint and the staging run is plan 15-30; the launch checklist requires the Neon Launch plan or a daily external dump before NFR-01 and NFR-08 are signed | 15-29, 15-30, 15-31 | Reply in the next planning or execution session with the replacement default |
| OQ3 | NFR-02 sign-off uses Chromium network emulation matching Chrome DevTools "Regular 4G", at least 30 samples per view, warm samples for the p75 and cold starts reported separately | 15-18, 15-30 | Reply in the next planning or execution session with the replacement default |
| OQ4 | D-17 scope: session schedules and calendars stay in the cohort's own zone with its label; every other rendered date-time is Lagos time with " WAT" (UI-SPEC S6) | 15-05, 15-10, 15-32, 15-33 | Reply in the next planning or execution session with the replacement default |
| OQ6 | No job-run heartbeat table; the ops page derives job health from stored staleness signals and shows "Not tracked" where none exists | 15-13 | Reply in the next planning or execution session with the replacement default |
| OQ7 | R2 public-access setting and object-storage backup are owner checks on the launch checklist | 15-31 | Reply in the next planning or execution session with the replacement default |
| OQ8 | Netlify plus Neon plus R2 is the production target; Docker Compose is local only; runbooks are written for Netlify with a Docker note | 15-11 | Reply in the next planning or execution session with the replacement default |
| OQ10 | Inline table links under 24px stay deferred per CONTEXT; if axe `target-size` flags them, a time-boxed D-07 waiver is recorded | 15-19, 15-31 | Reply in the next planning or execution session with the replacement default |
| A2 | Load model: ramp to 150 learner and 10 staff virtual users over 2 minutes, hold 10 minutes, think time 5 to 15 seconds | 15-14 | Reply in the next planning or execution session with the replacement default |
| A5 | Neon compute hours (always-on about 182 CU-hours a month): the staging run starts with a 10 percent pilot and checks the usage page first | 15-30 | Reply in the next planning or execution session with the replacement default |
| A6 | Netlify credits (150-VU run cost and team-level pooling): the staging run starts with a 10 percent pilot and checks the usage page first | 15-30 | Reply in the next planning or execution session with the replacement default |
| A7 | GitHub-hosted Ubuntu runners have Docker for Testcontainers; the first CI run on GitHub confirms it | 15-02 | Reply in the next planning or execution session with the replacement default |
| A8 | axe `wcag22aa` tag selection runs the `target-size` rule; confirmed by a spike | 15-19 | Reply in the next planning or execution session with the replacement default |
| A9 | 200 percent zoom is emulated by a 640 by 360 CSS pixel viewport, and reflow is checked at 320 pixels | 15-20 | Reply in the next planning or execution session with the replacement default |
| A10 | Screen-reader (NVDA / VoiceOver) checklist content as listed in 15-RESEARCH.md B17 | 15-20 | Reply in the next planning or execution session with the replacement default |
| A11 | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is set on Netlify (post-deploy stale-tab Server Action failures) | 15-11, 15-31 | Reply in the next planning or execution session with the replacement default |
| A12 | The k6 sign-in burst replays the no-JavaScript form; if it cannot authenticate, the burst risk is reported as unmeasured with an owner | 15-14 | Reply in the next planning or execution session with the replacement default |
| A13 | Rate limits: register 30 per 15 minutes per device, forgot password 20, resend verification 20, public certificate check 60, new support request 5 per 15 minutes per learner; per-address cooldowns stay silent | 15-03 | Reply in the next planning or execution session with the replacement default |
| A14 | R2 versioning is unknown; the owner checks it | 15-31 | Reply in the next planning or execution session with the replacement default |
| A15 | Netlify runs `next/server` `after()`; confirmed on staging by the quiet-resend check | 15-30 | Reply in the next planning or execution session with the replacement default |
| A16 | The Netlify synchronous function timeout is measured on staging | 15-30 | Reply in the next planning or execution session with the replacement default |
| A18 | `x-nf-client-connection-ip` is the real client IP on Netlify (existing assumption) | 15-03 | Reply in the next planning or execution session with the replacement default |
| P-01 | The automated journey pays through the manual payment confirmation path, so no test seam is added to payment code; gateway payments are proven by the existing webhook integration tests, the k6 webhook replay and one staging manual run in provider test mode | 15-17 | Reply in the next planning or execution session with the replacement default |
| P-02 | The privacy export is one CSV file in long format through the existing ExportJob pipeline | 15-21 | Reply in the next planning or execution session with the replacement default |
| P-03 | The export action is continuity and the anonymise action is write in the licence classification | 15-16, 15-21 | Reply in the next planning or execution session with the replacement default |
| P-04 | No new purge job for sessions, sign-in throttle rows or used verification tokens; listed as a retention proposal on the checklist because D-12 blocks deletion until a retention schedule is approved | 15-31 | Reply in the next planning or execution session with the replacement default |
| P-05 | New audit rows: sign-in success, failure and throttled, sign-out, rate-limit blocks, privacy export and anonymise; certificate downloads and public checks are not audited | 15-03, 15-04, 15-16, 15-21 | Reply in the next planning or execution session with the replacement default |
| P-06 | Audit append-only stays application-level, with no database REVOKE or trigger (stated in the report) | 15-31 | Reply in the next planning or execution session with the replacement default |
| P-07 | The attendance exceptions CSV route denies with an empty 404 like every other private download | 15-27 | Reply in the next planning or execution session with the replacement default |
| P-08 | VIDEO presigned URLs keep the documented 4-hour lifetime; the owner accepts it as short-lived on the checklist | 15-27, 15-31 | Reply in the next planning or execution session with the replacement default |
| P-09 | Learner lesson-access loops are changed only if the rehearsal shows the lesson route over its statement budget | 15-28 | Reply in the next planning or execution session with the replacement default |
| P-10 | Prisma `connection_limit` on the Neon pooled URL is measured on staging | 15-30 | Reply in the next planning or execution session with the replacement default |
| P-11 | "Behind" means work waited longer than three times the job's schedule interval, minimum 5 minutes | 15-13 | Reply in the next planning or execution session with the replacement default |

## Shared UI ownership

The co-worker owns Toaster, shells, primitives and `src/app/staff/layout.tsx`, and edits catalogue and support components in the same period. Each row names the plan that edits the file or file group in this phase. Every agreement cell starts as "pending". The owner changes a cell to "agreed" after confirming with the co-worker, and each editing plan's task precondition halts while its row is still pending.

| File | Editing plan | Edit | Co-worker agreement |
| --- | --- | --- | --- |
| `src/app/staff/layout.tsx` | 15-13; 15-22 | 15-13 adds the "Operations status" nav item and its permission row; 15-22 adds the "Learner privacy" nav item and its permission row | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| `src/components/support/ticket-labels.tsx` and `src/app/(learner)/support/[reference]/LearnerTicketDetail.tsx` | 15-05 | Lagos time (D-17, S6) | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| The date call sites listed in plan 15-10 | 15-10 | Lagos-time staff slice 1: support, audit, overview, order detail, cohorts, export history, email log, enrolments. One owner edits all three Lagos-time slices (15-10, 15-32, 15-33) in one mechanical pass | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| The date call sites listed in plan 15-32 | 15-32 | Lagos-time staff slice 2: certificates, grading, learner progress, users, publish dialog. Same single owner as the other two slices | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| The date call sites listed in plan 15-33 | 15-33 | Lagos-time slice 3: learner, checkout, notification, public catalogue and certificate-check screens. Same single owner as the other two slices | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| Page content wrappers that receive the `data-primary-content` attribute | 15-18 | One attribute on the page's own wrapper only, never `PageHeader`, `LearnerPageHeader` or a shell | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| `src/components/catalogue/LessonMediaPlayer.tsx` and `src/components/catalogue/LessonContent.tsx` | 15-23 | Captions track in the player and passing captions to the player; only if the NFR-09 decision is option-a or option-c (it is option-a) | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| `src/components/catalogue/UploadPanel.tsx` and `src/components/catalogue/ReadinessPanel.tsx` | 15-24 | The caption panel under video rows and the readiness warning; only if the NFR-09 decision is option-a or option-c (it is option-a) | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| `tests/unit/design-contract.test.ts` | 15-13; 15-22 | Add the `staff-operations-privacy` group (and update `EXPECTED_GROUPS`) | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| The accessibility fix sites (15-19) | 15-19 | Existing `src/app` and `src/components` files an axe finding requires fixing, each listed in the 15-19 SUMMARY | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| The responsive and keyboard fix sites (15-20) | 15-20 | Existing `src/app` and `src/components` files a reflow or keyboard finding requires fixing, each listed in the 15-20 SUMMARY | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| Any primitive, shell or Toaster change an accessibility, responsive or keyboard finding requires | 15-19; 15-20 | One row per file, added when found; needed in addition to the fix-sites row above before that file is edited | agreed (owner confirmed 2026-10-06 in the execute-phase session) |
| `src/components/primitives/ResourceForm.tsx` (found by 15-19, 2026-10-09) | 15-19 | Stepper in stepped forms: on a phone the names of the steps other than the current one were `display: none`, so those step buttons had no accessible name (axe `button-name`, critical, on the new and edit forms for cohorts, courses and programmes at 390px). The name is now visually hidden text (`sr-only sm:not-sr-only` instead of `hidden sm:inline`); nothing changes on screen | covered by the agreed row above (owner confirmation of 2026-10-06 names any primitive, shell or Toaster change a 15-19 or 15-20 finding requires); listed here by 15-19 when the finding was made, so the co-worker can see the file. Revert the one class change if the co-worker objects |
| `src/components/primitives/ResourceTable.tsx` (found by 15-20, 2026-10-09) | 15-20 | Two responsive findings. (1) The list search box was `w-[340px] max-w-full` inside a wrapper that sized itself to the box, so on a 320 or 360 pixel phone the box was wider than the page column and the right of it was cut off (staff cohorts, enrolments, payments, cohort exceptions tab). The filter row now lets the wrapper shrink (`max-w-full` on the filter, `min-w-0` on the wrapper); nothing changes at wider sizes. (2) The data table's scrolling box (visible from 640 pixels up, and scrolling sideways at 640 to about 1300 pixels on the cohorts, enrolments, payments and sessions tables) could not be reached by keyboard. It is now `role="region"`, `aria-label="<noun> table"` and `tabIndex={0}` (WCAG 2.1.1, as the UI-SPEC S7 reflow row prescribes and as 15-19 did for the learner results table); one extra Tab stop per table | covered by the agreed row above (owner confirmation of 2026-10-06 names any primitive, shell or Toaster change a 15-19 or 15-20 finding requires); listed here by 15-20 when the findings were made, so the co-worker can see the file. Revert the two edits if the co-worker objects (the table box then fails axe `scrollable-region-focusable` between 640 and about 1300 pixels) |
| `ConfirmModal`, `Toaster`, `RowActionMenu`, `ResourceForm`, `ResourceTable` | none (consumed only) | No source change in this phase; consumed through their current props | not needed (except the one `ResourceForm` row and the one `ResourceTable` row above) |

## Edge coverage, prohibition and UI-considerations index

Per owning plan, so no probe-surfaced item is silently dropped.

### Edge coverage (19 probe rows, all unresolved at planning; source: the planning coverage report)

| # | Requirement | Category | Owning plan | How it is carried |
| --- | --- | --- | --- | --- |
| 1 | NFR-04 | boundary | 15-03 | Explicit truths |
| 2 | NFR-04 | precision | 15-03 | Explicit truths |
| 3 | NFR-05 | adjacency | 15-25, 15-26 | Explicit truths |
| 4 | NFR-05 | empty | 15-25, 15-26 | Explicit truths |
| 5 | NFR-05 | ordering | 15-25, 15-26 | Explicit truths |
| 6 | NFR-05 | concurrency | 15-25, 15-26 | Explicit truths |
| 7 | NFR-06 | concurrency | 15-27 | Explicit truths |
| 8 | NFR-07 | boundary | 15-13 | Explicit truths |
| 9 | NFR-07 | precision | 15-13 | Explicit truths |
| 10 | NFR-01 | unclassified (review manually) | 15-06 | Flagged assumption |
| 11 | NFR-02 | unclassified (review manually) | 15-18 | Flagged assumption |
| 12 | NFR-03 | unclassified (review manually) | 15-17 | Flagged assumption |
| 13 | NFR-08 | unclassified (review manually) | 15-11 | Flagged assumption |
| 14 | NFR-09 | unclassified (review manually) | 15-19 | Flagged assumption |
| 15 | NFR-10 | unclassified (review manually) | 15-20 | Flagged assumption |
| 16 | NFR-11 | unclassified (review manually) | 15-16 | Flagged assumption |
| 17 | NFR-12 | unclassified (review manually) | 15-20 | Flagged assumption |
| 18 | NFR-13 | unclassified (review manually) | 15-13 | Flagged assumption |
| 19 | NFR-14 | unclassified (review manually) | 15-07 | Flagged assumption |

### Prohibitions

| Id | Prohibition | Owning plans |
| --- | --- | --- |
| P1 | Never run tests, seeds, load or restore against the shared production Neon database or real learner data, and never leave the default seed password on a reachable production-like target | 15-07, 15-14, 15-28, 15-30 |
| P2 | Never waive a critical security, payment, authorization or private-file failure | 15-02, 15-31 |
| P3 | Never hard-delete personal data and never rewrite retained financial, audit or credential records | 15-16 |
| P4 | Never reveal through message, status, markup or timing whether an account exists on sign-in, register, forgot password or resend | 15-03, 15-04 |
| P5 | The ops page never shows recipient addresses, email bodies, provider error text, webhook payloads, learner names or amounts | 15-13 |
| P6 | The privacy export never contains another person's data, password or token hashes, or staff-only internal ticket notes | 15-21 |
| P7 | Per-device rate limits never throttle many learners behind one shared network address at the strict per-address threshold | 15-03 |

### UI considerations (15-UI-SPEC.md "UI Considerations": 31 covered, 6 backstop, 3 unresolved)

Covered (31 rows), by surface:

| Surface | Covered rows | Owning plan |
| --- | --- | --- |
| S1 Operations status | empty section lists; empty whole page; error page load; error one section; populated lists; partial job signals; overflow lists over 10 rows; zero-one-many counts and band figures (8 rows) | 15-13 |
| S1, S2 and S3 shared | loading S1, S2, S3 navigation (1 row; existing staff `loading.tsx` skeleton) | 15-13 (S1), 15-22 (S2, S3) |
| S2 Learner privacy lookup and S3 Learner privacy record | S2 empty lookup form; S3 export state never exported; S3 export job in flight; S3 anonymise in flight; S3 export failed; S3 anonymise failed or concurrent change; S2 no match; S3 export ready; S3 learner facts partial; S3 name and email long text; S2 lookup match (11 rows) | 15-21, 15-22 |
| S4 Sign-in failure | error sign-in failure; empty sign-in fields (2 rows) | 15-04 |
| S5 Rate-limit messages | error rate limits; partial rate-limited forms keep typed values (2 rows) | 15-03 |
| S6 Dates and times | long-text timestamps in tables; missing timestamp; invalid timestamp; every date-time populated; date-only fields (5 rows) | 15-05, 15-10, 15-32, 15-33 |
| S7 Accessibility and responsive (every screen) | loading every screen; error every form (2 rows) | 15-19, 15-20 |

Backstop (6 rows):

| Row | Owning plan |
| --- | --- |
| S4/S5 messages at 320px and 200% zoom | 15-20 |
| S2 lookup form at 320px | 15-20 |
| Every screen at 320px and 200% zoom | 15-20 |
| S1 job and dataset labels (long labels) | 15-13 |
| S1 with real failure data (seeded failures) | 15-13 |
| S5 certificate check fourth branch | 15-03 |

Unresolved at UI-SPEC time (3 rows):

| Row | Owning plan | Status after this plan |
| --- | --- | --- |
| Inline table links under 24px (cohort code, learner name) | 15-19 (waiver, if needed, in 15-31) | Adopted default: ledger row OQ10 |
| Lesson video media: captions and transcripts (NFR-09) | 15-01 and 15-23 (with 15-24) | Decided: "NFR-09 accessible media decision" above, option-a (build captions) |
| S3 "What is kept" contents | 15-01 and 15-16 (rendered by 15-22) | Decided: "Privacy tool permission and retention decision" above, option-a (conservative keep-list) |
