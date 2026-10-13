# Phase 15 gap fixes, batch B

Requested by the owner on 2026-10-11 ("fix all the gaps"). **Nothing here is committed**; every change is in the working tree, on top of the uncommitted batch A changes. No hosted database or storage is contacted and no `.env` file is read: tests run on Testcontainers Postgres and a throwaway local MinIO.

This file is written as the work goes. A row that says "not started" has had no change made for it.

| Item | Status |
| --- | --- |
| 1. W-12 staff payments list (search, filters, counts over all rows) | fixed, tested |
| 2. W-13 closed cohort and archived assessment refusals | fixed, tested |
| 3. W-14 repeat actions that answer success | fixed, tested (all nine refused; analysis below) |
| 4. W-15 remainder, revoked certificate owner denial row | fixed, tested |
| 5. W-08 refusal screens without a page heading | fixed, tested; the browser sweep's new check passed on all 84 screens (see section 7) |
| 6. W-09 captions in the staff preview | fixed, tested |
| 7. W-07 staff pages missing from the narrow-screen sweep | fixed, full sweep passed |
| 8. Six database-backed test files in the CI unit job | fixed, tested |
| 9. STATE.md stale decision line | report only, no edit (see section 9) |

## 1. W-12 (and H-07) Staff payments list: filters, counts and search covered one page

- Cause: the list was paged on the server (50 a page) but `PaymentsTable.tsx` filtered, searched and counted the rows it had been handed, in the browser.
- Change:
  - `src/server/services/payment-read-service.ts`: `listPaymentsForStaff` takes `status`, `provider` and `search` and applies them in the same query as the scope. The filters are added beside the `cohort` scope condition, never in place of it. It also returns `totalAll` and `statusCounts` (a `groupBy` over the caller's scope only) and the filters it applied. Unknown status or provider values are dropped before the query; the search is trimmed, cut to 100 characters, and `%`, `_` and `\` are escaped.
  - `src/app/staff/payments/page.tsx`: reads `?status=`, `?provider=`, `?q=` and `?page=`, passes them to the service, and keeps them in the Previous and Next links.
  - `src/app/staff/payments/PaymentsTable.tsx`: no longer filters or counts rows. A tab or provider change replaces the address (page 1); the search box does the same 300 ms after the last key. Tab counts and the "n of m" line come from the server.
  - `src/app/staff/payments/payment-status.ts`: the provider options, `initialPaymentProvider` and `paymentsListHref` (shared by the page and the table).
- Tests (the unit and component cases were run before the change and failed: 10 and 12 failures):
  - `tests/payment-read-service.test.ts`: 12 new cases (7 service, 5 page), 1 existing expectation updated (the page now passes the status to the service). 40 of 40.
  - `tests/components/payments-table.test.tsx` (new): 16 of 16.
  - `tests/payment-list-filters.integration.test.ts` (new, Testcontainers Postgres, 130 orders in two cohorts): 14 of 14. Written before the code but first run after it. Its first run failed one case and found a real fault: a search for `%` matched all 130 orders, because the database treats it as a wildcard. Fixed by escaping.
  - Unchanged and still passing: `tests/payment-list-paging.integration.test.ts` 5 of 5, `tests/staff-scoped-lists.integration.test.ts` 4 of 4, `tests/payments-initial-status.test.ts` 4 of 4.
- Authorization: a cohort-scoped caller's rows, total and status counts cover only that cohort; a search for another cohort's order, learner name or email returns nothing; a caller without `payments.view` is refused before any filter is read.
- Not done: the column sort (order reference, amount) still sorts only the rows of the page on screen, and the page still opens sorted by reference within the page. It was not in the request. No shared primitive was edited.

A second run finished this batch after the first was stopped by a rate limit. The first run left item 1 done and, for items 2 and 3, only the test side written (the registry `recordStates` and the `STATE_CASES` rows); no service code had been changed. The second run found one half-finished edit from item 1 (`tests/notification-access.integration.test.ts` built a payments reader without the new `countByStatus`, a type error) and completed it.

## Shared by items 2 and 3: one refusal class and one hook

- `src/server/errors/record-state-error.ts` (new): `RecordStateError extends UserInputError`. Its message is a sentence for the staff member. It is thrown before any write, so no row changes, no audit row and no domain event are written, and it is not an authorization denial.
- `src/server/services/resource-service.ts` (the shared service factory, not a UI primitive): a new optional setting `assertWritable(operation, before)`, called for `update`, `archive` and `restore` with the row read just before the write, after the permission and scope check. A service that does not set it behaves exactly as before.
- Every action that can now receive the refusal shows its sentence: `cohorts/[id]/session-actions.ts`, `cohorts/actions.ts`, `courses/[id]/assessments/actions.ts`, `courses/[id]/lessons/[lessonId]/actions.ts`, `courses/[id]/arrange/actions.ts`, `courses/[id]/publish-actions.ts`, `programmes/[id]/publish-actions.ts`, `certificates/templates/template-actions.ts`.
- Order of checks is unchanged: permission and scope first, state second. A caller without the permission gets the authorization refusal and never learns the record's state (a unit case per service proves it).

## 2. W-13 Closed cohorts and archived assessments

| Action | Before | Now |
| --- | --- | --- |
| Add a session, or a weekly series, to a CANCELLED or COMPLETED cohort | a live session was added | "This cohort is cancelled, so sessions cannot be added to it." (or "completed") |
| Edit a CANCELLED cohort | title, dates and price were saved | "A cancelled cohort cannot be edited." |
| Publish an ARCHIVED assessment | went straight to PUBLISHED | "An archived assessment cannot be published." |

- Code: `scheduled-session-service.ts` (the cohort read now includes `status`; `assertCohortTakesSessions` is called by the two create paths only, so changing or cancelling an existing session of a closed cohort is unchanged), `cohort-service.ts` (`updateCohort`), `assessment-service.ts` (`publishAssessment`).
- A COMPLETED cohort can still be edited (the request named only CANCELLED).
- Tests, unit, seen failing before the code (16 failures across items 2 and 3): `tests/scheduled-session-service.test.ts` 8 new cases, `tests/cohort-service.test.ts` 6 new, `tests/assessment-service.test.ts` 4 new.
- Tests, state matrix (`tests/authz-scope-state.integration.test.ts`): 6 new record-state cases (`createSessionAction` and `repeatWeeklyAction` on `cohort:CANCELLED` and `cohort:COMPLETED`, `updateCohortAction` on `cohort:CANCELLED`, `publishAssessmentAction` on `assessment:ARCHIVED`). Each calls the real action as fully authorised staff on real Postgres and checks: refused, nothing written, no denial row, the sentence above. They were written by the first run and first run by the second after the code, so these six were not watched failing; the gap they cover is the one plan 15-26 recorded.
- **For the owner:** there is no "restore" for an archived assessment. Publishing was the only way back, and it is now refused. If staff need to bring an archived assessment back, that is a small new action (archived to draft, like a course) and a decision.

## 3. W-14 Repeat actions that answered success

What each one wrote before, read from the code:

| Action | What the repeat wrote | Verdict |
| --- | --- | --- |
| Archive an archived course or programme | the same status again and a second `course.archived` / `programme.archived` audit row | misleading audit row: refused |
| Archive an archived assessment | the same status again and a second `assessment.archived` audit row | misleading audit row: refused |
| Archive an archived certificate template | **overwrote `archivedAt`** with the new time and added a second audit row | data changed: refused |
| Withdraw a withdrawn lesson or module (editor and arrange screen) | **overwrote `withdrawnAt`** and **moved the row one slot deeper** in the withdrawn band, plus an audit row | data changed: refused |
| Save a withdrawn lesson | saved the new title and content, plus `lesson.updated` | data changed: refused |
| Rename a withdrawn module | saved the new title, plus `module.updated` | data changed: refused |
| Restore a module or lesson that is not withdrawn | **moved a live item to the end of the order** and wrote `module.restored` / `lesson.restored` | data changed: refused |

None was a harmless no-op, so none was left as it was. No domain event was involved in any of them. Sentences: "This course is already archived." (also programme, assessment, template), "This lesson is already withdrawn." (also module), "This lesson is withdrawn. Restore it before you change it." (also module), "Only a withdrawn module can be restored." (also lesson).

- Code: `publish-service.ts` (course and programme archive), and the `assertWritable` setting in `assessment-service.ts`, `certificate-template-service.ts`, `module-service.ts`, `lesson-service.ts`.
- Not changed: saving the layout of an archived certificate template, and editing the details of an archived assessment. Neither was in the list.
- Tests, unit, seen failing first: `tests/publish-service.test.ts` 4 new, `tests/certificate-template-service.test.ts` 1 new, `tests/module-lesson-service.test.ts` 8 new, and the archive cases in `tests/assessment-service.test.ts`. The six unit files together: 224 of 224.
- Tests, state matrix: 11 new record-state cases (`archiveCourseAction`, `archiveProgrammeAction`, `archiveAssessmentAction`, `archiveTemplateAction`, `withdrawLessonAction`, `saveLessonAction`, `renameModuleAction`, `withdrawItemAction` for a lesson and for a module, `restoreItemAction` for a module and for a lesson). Same note as item 2: first run after the code.
- Unchanged and still passing: `cohort-cancel`, `publish`, `reorder`, `authz-revocation` (integration, 51 of 51), `cohort-lifecycle-security`, `enrolment-session-drain`, and six unit files that call these actions (109 of 109).

## 4. W-15 The owner of a revoked certificate no longer leaves a denial row

- Cause: the owner path answered "nothing" for a revoked certificate without saying why, so the route fell through to the staff permission check, which records `authorization.denied`.
- Change:
  - `src/server/services/certificate-service.ts`: `resolveOwnCertificateForDownload` answers `served`, `owner-refused` (the caller owns it and it is REVOKED or SUPERSEDED) or `not-owner` (somebody else's, or no such id; the two are not told apart). One lookup, as before. `getOwnCertificateForDownload` is now a thin wrapper over it and behaves as before.
  - `src/app/api/certificates/[id]/download/route.ts`: for `owner-refused`, the audited staff check is skipped, but only when the caller holds `certificates.view` nowhere (`canAnywhere`). The response is the same empty 404.
- Not weakened:
  - A stranger and a visitor get `not-owner` and always go through the audited check: one denial row per attempt, as before.
  - Staff without the permission, and staff scoped to another cohort, are not owners, so the same.
  - An owner who is also staff holding `certificates.view` somewhere still goes through the audited check: served if their scope covers it (staff may open a revoked certificate), refused and recorded if not. The set of people served is unchanged.
  - The `staffProbeDenial` exception in the state matrix is removed altogether. The matrix now requires "no denial row for a fully authorised caller" for every record-state case, this one included.
- Tests:
  - `tests/certificate-download-route.test.ts`: 3 new cases (the owner of a revoked certificate is refused without the staff check; that answer is identical to a stranger's; an owner who holds the permission somewhere still goes through the check, served or refused). The existing "still asks for the staff permission" case now also checks that a stranger and a visitor are never excused. 20 of 20. Seen failing first, coarsely: the whole file failed until the route used the new function.
  - `tests/certificate-service.test.ts`: 4 new cases, seen failing first. 49 of 49.
  - `tests/authz-private-files.integration.test.ts` (real Postgres, real audit rows, throwaway MinIO): the revoked-certificate case now checks that ten refused requests by the owner add no denial row, and that another learner, staff with no permission and staff scoped elsewhere each still add exactly one on the revoked certificate. 40 of 40. Written before the code, first run after it.

## 5. W-08 The two refusal screens have a page heading

- Cause: `OperationsDenied` and `PrivacyDenied` asked the shared table for a page title (`asPage title=...`), but the table's refusal state draws the title as an h2, never as the page's h1.
- Change: `src/app/staff/operations/OperationsDenied.tsx` and `src/app/staff/privacy/PrivacyDenied.tsx` draw the title with `PageHeader` (the h1 every staff page uses) and leave the refusal panel untitled, so the refusal sentence is the h2. Headings are now h1 then h2; before they were h2 then h3 with no h1.
- **No shared primitive was edited.** `ResourceTable` is unchanged. Flag for the co-worker: its refusal state ignores `asPage`, so any other page that shows a whole-page refusal through it with no `PageHeader` of its own would have the same gap. The sweep found only these two among 218 visits.
- Tests:
  - `tests/components/refusal-screens.test.tsx` (new): 6 cases, 4 seen failing first (one h1 naming the page; the refusal is the h2 and no level is skipped; the permission sentence and the 403 are still there). 6 of 6.
  - `e2e/a11y-screens.spec.ts`, the sweep that recorded the gap but did not fail on it: a visited screen with no h1 is now a failure. In the last recorded run (`evidence/a11y-axe-local.json`) these two refusal states were the only visits without one, so the check is not expected to trip elsewhere. Run on 2026-10-12; see section 7.

## 6. W-09 The staff preview of a video lesson offers its captions

- Change: `src/app/staff/courses/[id]/preview/lessons/[lessonId]/page.tsx` reads the lesson's caption tracks with `listLessonCaptions` (the existing staff reader, behind `courses.view` on the lesson's course), only for a VIDEO lesson and only after the existing check that the lesson belongs to the course in the address. It passes READY tracks only, and only `id`, `videoResourceId`, `language` and `label`, to `LessonContent`, the same four fields the learner page passes. A refusal maps to the same not-found page as every other refusal on this page.
- The caption file itself is unchanged: the browser fetches it from `/api/lesson-resources/[id]/captions`, which already authorises staff with `courses.view` and serves READY tracks only (`tests/captions.integration.test.ts`, unchanged).
- Tests: `tests/lesson-preview-route.test.ts`, 5 new cases, 4 seen failing first (tracks are passed; an upload in progress and a failed one are left out and no status or storage field crosses to the client; a lesson that is not a video reads no captions; a lesson of another course reads none; a refusal ends in not-found). 10 of 10. Not checked in a browser.

## 7. W-07 The wide staff tables are in the narrow-screen sweep

- Change:
  - `e2e/screens.manifest.ts`: six staff screens are marked `primary`, so `e2e/responsive.spec.ts` visits them: audit log, reconciliation queue, reports index, one report, export history, and one learner's record in a cohort (the released results table).
  - `e2e/responsive.spec.ts`: five allow-list entries, each with its reason, for the tables that scroll inside themselves. A seeded database has no export, so the sweep makes one export history row first (`ensureExportHistoryRow` in `e2e/support/a11y.ts`).
  - Four scrolling boxes were not labelled, focusable regions, so a keyboard user could not scroll them. They now have `role="region"`, a name and `tabIndex={0}`: `AuditTable.tsx`, `ReconciliationWorkspace.tsx`, `ExportHistory.tsx`; `ReportDashboard.tsx` had the name and focus and gained the role. In `ReconciliationWorkspace.tsx` the provider strip's gap is smaller below 640 px.
  - No shared primitive was edited.
- Runs, 2026-10-12, Chromium, visible browser, production build, throwaway local Postgres and MinIO:
  - Narrow-screen sweep, whole file: 42 of 42 tests, 33 screens, 57 states, 456 visits, 0 failures (was 27 screens, 408 visits). `evidence/responsive-local.json` is replaced by this run. An earlier partial run of the six new screens alone (48 visits, 0 failures) is superseded and its file removed.
  - Accessibility sweep with the new page-heading check (section 5): 84 screens, 109 states, 218 visits, 0 open violations, and no screen without an h1. It ran in four pieces because the first run was stopped by the laptop running out of memory after 31 screens; the other 53 ran in three `A11Y_ONLY` runs. `evidence/a11y-axe-w08-local.json` is the four merged and says so. `evidence/a11y-axe-local.json` (plan 15-19) is unchanged.
- Not done: other engines (W-06 stands), and no screen reader was used on the new regions.

## 8. Database-backed test files and the CI unit job

- Checked each of the six: all of them import `tests/support/pg.ts` and start a throwaway Postgres, so all need Docker. None needs the object store. Only `brevo-live.smoke` touches the network, and only when a person sets `BREVO_LIVE`.
- Change:
  - Five files renamed to `*.integration.test.ts` (plain file moves, so git shows a delete and a new file until they are staged): `licence-diagnostic`, `reconciliation-case-service`, `schema-cohort`, `schema-payment-split`, `staff-recipient-service`. The unit job no longer selects them and the sharded integration job does. Three comments that name the old paths were updated (`src/server/services/staff-recipient-service.ts`, `tests/event-mappers-staff.test.ts`, `tests/schema-payment-split.integration.test.ts`); the 2026-09 plan under `docs/superpowers/plans/` still names the old paths and was left as history.
  - `brevo-live.smoke.test.ts` keeps its name and its header instructions. `vitest.config.mts` now also leaves `tests/**/*.smoke.test.ts` out when `VITEST_SKIP_INTEGRATION=1`. It was already safe (both cases are `it.skipIf(!LIVE)` and the database is started inside a case); now the unit job does not load it at all, and the integration job's `integration.test` filter never matched it.
- Guard, `tests/ci-config.test.ts`, 3 new cases, seen failing first: (6b) every test file that imports `tests/support/pg.ts` is named `*.integration.test.ts` or `*.perf.test.ts`, the smoke being the one listed exception, so a new database-backed file with the wrong name fails here; (6c) the smoke is excluded from the unit job, every case in it is skipped without `BREVO_LIVE`, and no workflow sets `BREVO_LIVE` or names the file; and a tamper case for each of those three. 23 of 23.
- Checked with `vitest list`: with the switch, 282 files (was 288) and no integration, smoke or perf file; the integration job's command selects 91 (85, plus the one added for item 1, plus these five).
- The five renamed files run as integration files: 76 of 76.
- Not proven: CI itself, which needs a pushed commit (same as D-07 in batch A).

## 9. STATE.md stale decision line

`.planning/STATE.md` line 363 still says "grant end instant is inclusive (isGrantActive: ended only when endsAt < now)". Batch A changed this: a grant ends on `endsAt <= now`. The line is left for the end-of-phase state update.

## Checks over the whole tree after both runs (2026-10-11 and 12)

- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 28 warnings.
- The CI unit job's two commands, run locally: node project 4,888 of 4,889; components 1,091 of 1,100 with 1 skipped. The nine failures were not caused by this batch and were dealt with:
  - `tests/components/cohort-pages.test.tsx` (6): stale since commit 9a68b7a, which wrapped the cohort page in a `data-primary-content` element; the test still read the old shape. Test updated, 9 of 9.
  - `tests/licence-issuer.test.ts` (1): failed about one run in 64, when the generated public key began with `-` and the argument parser took it for an option. The test now passes `--public-x=<value>`, and the usage line in `provider-tools/licence-issuer/cli.ts` shows that form. 11 of 11.
  - `tests/components/rich-text-editor.test.tsx` (2): timed out at 15 s in the full run; passes alone. Not changed.
- Not run after the last edits: the full integration suite in one go (each item ran its own files, as recorded above), and CI itself.
