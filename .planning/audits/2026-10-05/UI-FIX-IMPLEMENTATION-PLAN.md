# UI fix implementation plan

Written 2026-10-05 from `UI-REVIEW-MERGED.md`. Code facts below were read from `develop` at `2f73220`.
The owner creates the branch (suggested name `ui-fixes`, created from the current `develop`); Claude implements on it.

## Implementation status (updated 2026-10-05, branch `UI-fix`, nothing committed)

Done and checked in the browser (axe: 0 violations on public, auth, learner and 14 staff screens; 390px checks pass):
T1, T7, T9, T12, T2, T4, T6, T3, T5, T11, T8, T14 (without item 5, see below).

Also done (owner approved, same day): T14 item 5 (prices typed in naira and dollars, sent as kobo and cents; `src/lib/money-input.ts`), and the co-worker items U-02 (reasons under greyed-out Pay, Confirm payment and Record refund), U-05 (no requirement or decision codes in rendered text), U-07 (readable status words; refunds show the provider reference, not the database id) and U-09 (payment problems shown above the order details; a new "payments not set up" message when the provider is not configured).

Not done:
- **U-11 unverified sign-in message.** Needs a security decision first: telling someone "not verified yet" reveals that the email has an account.
- **U-12 dates and time zones** (learner support times in UTC, staff in Lagos). Needs one agreed format and zone.
- **T13 audit scripts in the repo.** Owner decided not to keep them.
- Not changed: the inline cohort-code and learner-name links in tables are still under 24px tall (they are text links, not row actions).

## 0. How the work is done

**Ground rules**
- **No commits** unless the owner asks for that specific commit. Changes stay in the working tree.
- **Read the Next.js guide first.** `AGENTS.md` says this Next.js (16.x) has breaking changes: before touching a page, layout, metadata, server action or client component, read the matching guide under `node_modules/next/dist/docs/`.
- **Never test against the shared Neon database.** Use the throwaway Docker database (`licence_test`, port 5434) with a shell-level `DATABASE_URL`, `EMAIL_TRANSPORT=stub`, app on port 3010.
  Setup is described in the memory note `local-licence-test-env` (migrate and seed first).
- **Shared UI is also being edited by the co-worker** (`Toaster`, `StaffShell`, `LearnerShell`, primitives). Agree with them which tasks they will not touch while this branch is open.
- Run tests in small batches; the machine is memory-limited. Whole-tree scan tests need `--testTimeout=60000`.

**Definition of done for every task**
1. Focused tests for the touched code pass (named per task below), plus `npx tsc --noEmit` and `npx eslint` on touched files.
2. axe-core shows zero violations on every screen the task touches.
3. A browser check at 1440px and 390px wide (visible Chrome) confirms the behaviour.
4. After the last task: the full re-audit (section 5) shows zero axe violations on all 31 screens and every finding marked fixed.

## 1. Order of work and size

Sizes: S under 30 minutes, M 30 to 90, L over 2 hours.

| Order | Task | Finding | Size |
| --- | --- | --- | --- |
| 1 | T1 Toaster landmark | N-01 | S |
| 2 | T7 One learner navigation | #9 | S |
| 3 | T9 Page titles | #12 | S |
| 4 | T12 Attendance wording | #13 | S |
| 5 | T2 Sign-in keeps the email, focus to the error | #2 | M |
| 6 | T4 Phone auth layout and landmarks | #4, #14 | M |
| 7 | T6 Phone public header | #8 | M |
| 8 | T3 Sidebar scroll and default folding | #1 | M |
| 9 | T5 Catalogue rows | #5, #6 | M |
| 10 | T11 Register checkboxes and links | #15 | S |
| 11 | T8 Enrolments and roster row actions, dates | #11 | L |
| 12 | T14 Staff form pattern (stepped, with Review step) | U-xx wizard | L |
| 13 | T13 Make the audit repeatable (optional) | n/a | M |
| 14 | Wave 3 carry-over items | U-02, U-05, U-07, U-09, U-11, U-12 | L, needs co-worker agreement |

Waves: **Wave 1** = T1, T2, T3, T4 (the critical items). **Wave 2** = the rest of T-numbers. **Wave 3** = carry-over items.

## 2. Wave 1: critical

### T1. Toaster landmark (N-01)
- **Problem:** `<div aria-label="Notifications">` has no role, so axe reports `aria-prohibited-attr` (serious) and `region` (moderate) on every page.
- **File:** `src/components/feedback/Toaster.tsx`, the container div at lines 120 to 123.
- **Change:** add `role="region"` (keep `aria-label="Notifications"`). Each toast card keeps its own status or alert role. Do not add `aria-live` to the region itself if the cards already announce.
- **Tests:** `tests/components/toaster.test.tsx`: assert `getByRole("region", { name: "Notifications" })` exists with no toasts, and that an axe run on the rendered provider is clean.
- **Verify:** axe on `/courses` and `/staff`: the two errors are gone.

### T2. Sign-in keeps the email and moves focus (#2)
- **Problem:** React resets uncontrolled fields after a form action, so a failed sign-in empties the email and focus drops to `body`.
- **Files:** `src/app/(auth)/signin/actions.ts`, `src/app/(auth)/signin/SignInForm.tsx`.
- **Change:**
  1. Extend `SignInState` to `{ error: string | null; email?: string }`. In `signInAction` return `email` with every error (empty-field, `THROTTLED`, no-match). Never return the password.
  2. In `SignInForm` set `defaultValue={state.email ?? ""}` on the email input.
  3. Give the error `<p role="alert">` a ref and `tabIndex={-1}`; focus it when `state.error` changes (`useEffect` keyed on `state`). Keep the existing `role="alert"`.
  4. Apply the same pattern to `RegisterForm.tsx` (return and re-fill name and email, never the password) and `ForgotPasswordForm.tsx` (email), checking each action's state type first.
- **Tests:** update `tests/register-action.test.ts` for the returned values; add a component test for `SignInForm` (email retained after an error, focus on the alert). Check `tests/sign-in-throttle.test.ts` is unaffected.
- **Verify:** wrong password in the browser: email still there, focus on the message, a screen-reader announcement; axe clean in the error state.

### T3. Staff sidebar reachable on laptop screens (#1)
- **Problem:** at 900px tall the aside is `lg:overflow-hidden` (line 308) with the scrollbar hidden, so Licence and Email log are clipped; folding groups is the only workaround, and everything is expanded by default.
- **File:** `src/app/staff/StaffShell.tsx` (aside classes at line 308; fold storage at lines 64 to 119, `useCollapsedGroups`, `readCollapsedGroups`).
- **Change:**
  1. Change `lg:overflow-hidden` to `lg:overflow-y-auto` and replace the hidden scrollbar with a thin visible one at `lg` (keep it hidden below `lg` if the drawer design needs it). Keep the existing height-based density rules.
  2. Default folding: distinguish "never saved" from "saved empty". When nothing is stored, fold every labelled group except the one holding the current page. Once the user toggles a group, store their choice as now. Storage-blocked behaviour stays as is.
  3. First render stays "all open" for hydration; the fold applies immediately after hydration (no set-state-in-effect: keep `useSyncExternalStore`).
- **Tests:** update `tests/components/staff-shell-groups.test.tsx` (default folding, saved choice wins, current group never folds) and `tests/components/staff-shell.test.tsx` and `tests/staff-layout-nav.test.ts` if they assume all groups open.
- **Verify:** at 1440x900, 1366x768, 1280x720: Licence and Email log are visible or reachable by scrolling the sidebar; keyboard Tab reaches every link.

### T4. Phone sign-in and register layout, auth landmarks (#4, #14)
- **Problem:** `src/app/(auth)/layout.tsx` shows the whole brand panel (`p-12`, headline, paragraph, link, "AFRICA/LAGOS") above the form on phones, so the submit button is at 845px (sign-in) and 1009px (register). The panel is also outside any landmark (axe `region` x4).
- **File:** `src/app/(auth)/layout.tsx` (lines 22 to 56).
- **Change:**
  1. Make the brand panel a `<header>` (banner landmark).
  2. Below `md`: padding `p-5`, hide the headline, paragraph, verify link and the mono label, and show one short tagline line under the brand. Keep everything at `md` and up.
  3. Optionally change the headline `h2` to a `p` with the same classes (it comes before the page `h1`).
- **Tests:** add or update an auth layout test (find with `grep -rl "AuthLayout\|(auth)/layout" tests`); assert the `banner` role exists.
- **Verify:** at 390x844 the submit button's bottom edge is under 844px on `/signin` and under about 760px on `/register`; axe `region` errors gone on the six auth pages.

## 3. Wave 2: high impact

### T5. Catalogue rows (#5, #6)
- **File:** `src/app/(public)/courses/page.tsx` (rows at lines 52 to 91; price cell line 84 to 86; arrow line 87).
- **Problems:** a lone "—" for courses without a scheduled cohort, no visible button (only an arrow, `hidden md:block`, so none on phones), no "verify" value line.
- **Change:** (1) replace the "—" with visible text for the unscheduled case (for example "Price shown with dates"); (2) show a visible "View course" label with the arrow at every width (it is one big link, keep it that way); (3) change the subtitle on the page header to carry the value line, "Professional training an employer can verify." with a link to `/verify-certificate`. Confirm `LearnerPageHeader`'s `subtitle` type allows a link.
- **Tests:** `tests/public-catalogue-service.test.ts` is data-only; add a render test for the page text if one does not exist (grep for "Professional training you can enrol on").
- **Verify:** 1440px and 390px screenshots; axe clean.

### T6. Phone public header collision (#8)
- **Files:** `src/app/(public)/layout.tsx` (buttons at lines 21 to 42), `src/components/shell/LearnerShell.tsx` (right slot at line 112; menu at lines 131 to 155).
- **Change:** add `max-sm:hidden` to the anonymous "Sign in" and "Register" buttons; add an optional `mobileMenuExtra` prop to `LearnerShell` rendered at the end of the open mobile `<nav>`; pass "Sign in" and "Create an account" links (44px high) from the public layout. Signed-in visitors keep their single "My dashboard" button (check it still fits at 390px).
- **Tests:** shell tests (find with `grep -rl LearnerShell tests`): menu shows the extra links.
- **Verify:** at 390px brand and controls do not overlap; the menu opens and Escape closes it.

### T7. One learner navigation (#9)
- **Problem:** three layouts define their own nav: `src/app/(learner)/layout.tsx` (lines 30 to 34: five items), `src/app/account/layout.tsx` (lines 27 to 29: three items) and `src/app/(checkout)/layout.tsx` (lines 17 to 19: three items, "Courses" not "Catalogue").
- **Change:** create `src/components/shell/learner-nav.ts` exporting `LEARNER_NAV` (Dashboard, My learning, Support, Catalogue, Account) and use it in all three layouts.
- **Tests:** update any test asserting the three-item nav (grep tests for `"Courses"` near `account`); add one test that the three layouts share the constant.
- **Verify:** header links identical on `/dashboard`, `/learn`, `/support`, `/account`, `/enrol/...`.

### T8. Enrolments and roster row actions, human dates (#11, part of U-12)
- **Problem:** `src/app/staff/enrolments/EnrolmentsTable.tsx` renders two or three text buttons per row (lines 174 to 229, class `text-xs underline`, under 24px), dates as `toISOString().slice(0, 10)` (lines 68 and 169). `src/app/staff/cohorts/[id]/RosterTab.tsx` repeats the pattern (`ACTION_BTN`, line 151).
- **Change:**
  1. New primitive `src/components/primitives/RowActionMenu.tsx`: a three-dots (⋮) icon button (min 44x44px, accessible name "Actions for <learner>"; on phone cards also show the visible word "Actions" beside the icon) opening a menu (`aria-haspopup="menu"`, `role="menuitem"`s, ArrowUp/Down/Home/End, Escape returns focus, Tab closes, outside click closes); destructive items (Withdraw, Cancel) after a separator, red text. Each item opens the same confirmation dialogs as today. If the table wrapper clips the menu, render it in a portal.
  2. Use it in `EnrolmentsTable.tsx` and `RosterTab.tsx`.
  3. Dates: use `formatDateShort` from `src/lib/format-timestamp.ts` ("12 Jan 2026", UTC-pinned for hydration) for `Created` and the access window.
- **Tests:** new `tests/components/row-action-menu.test.tsx` (keyboard, axe, focus return); update `tests/components/cohort-roster.test.tsx` and any enrolments table test.
- **Verify:** every row action is at least 44px; destructive items require confirmation; works as cards on a phone.

### T14. Staff form pattern: improved stepped forms (owner approved 2026-10-05)
- **Reference:** clickable prototype https://claude.ai/artifact/EL7ZyGM7LyCfGLiYtUEyEj (design "Proposed: steps"); source in the Claude session scratchpad `wizard/index.html` (temporary, copy into `design/` if kept).
- **Problem:** the current stepped mode of `src/components/primitives/ResourceForm.tsx` splits short forms (Course, Programme: about 10 fields, 2 required) across 3 screens, shows the browser tooltip AND a custom banner for one mistake, gives no summary before create, and edit mode behaves like a wizard with no unsaved-changes feedback. Slug is typed by hand; prices entered in kobo and cents.
- **Keep:** the multi-step idea and the three callers: `CourseForm.tsx`, `CohortForm.tsx`, `ProgrammeForm.tsx` (create = linear, edit = free).
- **Change:**
  1. Stepper: numbered, labelled, tick when done, red `!` on a step with errors, `aria-current="step"`. Create: only reached steps clickable. Edit: all steps open, with a sticky save bar ("Unsaved changes" / "All changes saved", Discard, Save).
  2. Validation: `noValidate` on the form; one error summary (role alert, focus moves to it) with a link per field; no browser tooltip. Server errors jump to the step of the first errored field (keep existing behaviour).
  3. Create flow adds a final Review step: ready banner (Draft tag, count of blank optional fields), one card per section with "Change", and a "What happens when you create it" note. Submit label "Create <thing> as draft".
  4. Slug auto-made from the title on create (editable); keep slug-freeze rules.
  5. Money inputs: enter naira and dollars, convert to kobo/cents in the action (check validation schema and tests before changing units).
  6. Phone: step bar collapses to numbered dots with the current step named; Back and Continue pinned at the bottom (`env(safe-area-inset-bottom)`).
- **Tests:** update `tests/components` for ResourceForm and the three forms; add axe, focus-to-summary, review-step and unit-conversion cases; licence UI gate classification unchanged (no new write paths).
- **Verify:** keyboard-only create of a course, cohort and programme; axe clean on each step and the review step; 390px width.

### T9. Learner page titles (#12)
- **Change:** add `export const metadata = { title: "…" }` (the template adds "· Training Administration") to: `(learner)/dashboard/page.tsx` ("Dashboard"), `(learner)/learn/page.tsx` ("My learning"), `(learner)/support/page.tsx` ("Support"), `(learner)/support/new/page.tsx` ("New support request"), `(learner)/learn/[enrolmentId]/sessions/page.tsx` ("Sessions"), `(learner)/learn/[enrolmentId]/results/page.tsx` ("Results"). For `support/[reference]/page.tsx` use `generateMetadata` with the ticket reference only if it can be read without leaking data.
- **Tests:** `tests/learner-dashboard-page.test.ts` may assert metadata; otherwise verified by the re-audit script (page titles check).

### T11. Register checkboxes and links (#15)
- **File:** `src/app/(auth)/register/RegisterForm.tsx` (checkboxes at lines 79 to 99; `CHECKBOX` constant).
- **Change:** checkbox at least 24px (`size-6`), label `items-start gap-3 py-2` with a 44px minimum height, links with vertical padding (`inline-block py-1.5`).
- **Tests:** component test that both checkboxes keep their names and `required`.

### T12. Attendance wording (#13)
- **File:** `src/app/(learner)/dashboard/page.tsx`, lines 291 to 297 (`RailItem` already supports `sub`).
- **Change:** when `earnedPct` is 0 show "No sessions attended yet" with sub "You need {requiredPct}% to qualify"; otherwise "{earnedPct}% attended" with sub "{requiredPct}% needed to qualify".
- **Tests:** `tests/learner-dashboard-page.test.ts` for both cases.

### T13. Make the audit repeatable (optional)
- Copy the audit scripts from the Claude session scratchpad into the repo, for example `scripts/ui-audit/` (`lib`, public, learner, staff, `reaudit-checks`), with a short README (start the app on a throwaway database, open Chrome with a debugging port, run). This replaces the temporary session folder, which will be deleted. Needs the owner's OK to add files to the repo.

## 4. Wave 3: co-worker items (agree scope first)

Each starts with a search, then a decision with the co-worker. Do not start without their agreement because they own these screens.

| ID | Where to start | Acceptance |
| --- | --- | --- |
| U-02 Disabled buttons give no reason | checkout Pay (`src/app/(checkout)`), manual confirmation and refund dialogs under `src/app/staff/payments` | Each disabled primary button has visible helper text linked with `aria-describedby`. |
| U-05 Developer wording | `grep -rn -E "a later phase|\(CAT-[0-9]+\)|Not yet checked" src --include=*.tsx` (22 hits; includes `ReadinessPanel.tsx`, `AssessmentFormFields.tsx`, public course and programme pages). The many `(D-xx)` hits are mostly code comments: only change text rendered to users. | No requirement or decision codes in rendered text. |
| U-07 Raw status codes and ids | staff list tables and the refund reference | Human labels everywhere; no database id shown as a reference. |
| U-09 Checkout error | `src/app/(checkout)/checkout/[orderId]` | Error is visible without scrolling and says what happened ("payments are not set up") instead of "try again". |
| U-11 Unverified sign-in | `src/app/(auth)/signin/actions.ts` line 31 (the message) | Distinguish "not verified yet" with a resend link without revealing whether an account exists. Needs a security decision first. |
| U-12 Dates and time zones | learner support times (UTC) versus staff (Lagos) | One agreed format and zone, shown with the zone name. |

## 5. Final check (after the last task)

1. Start the throwaway database (migrate, seed) and the app on port 3010; open Chrome with a debugging port.
2. Run axe on all 31 screens at 1440px and 390px: expected zero violations. Screens: public (`/`, `/courses`, `/programmes`, `/signin`, `/register`, `/forgot-password`, `/verify-certificate`, a course page); learner (`/dashboard`, `/learn`, a course home, sessions, results, a lesson, `/support`, `/support/new`, `/account`); staff (`/staff`, `/staff/cohorts`, a cohort, `/staff/courses`, a course, `/staff/courses/new`, `/staff/enrolments`, `/staff/payments`, `/staff/support`, `/staff/reports`, `/staff/users`, `/staff/audit`, `/staff/certificates`, `/staff/licence`).
3. Re-run the finding checks (sign-in email kept, phone submit button above 844px, header overlap, learner nav equal on every page, sidebar reach at 900, 800 and 768px tall, titles, target sizes) and update the Status column of `UI-REVIEW-MERGED.md`.
4. Run the licence safety tests again (`licence-enforcement-boundary`, `licence-ui-mirror-gate`, `licence-action-refusal`, `licence-purity`, `licence-wording`): shared UI parts changed.
5. Then close the Phase 15 to-do item for the UI work and tell the co-worker which files changed.

## 6. Risks

- **Merge conflicts** with the co-worker on `Toaster.tsx`, `StaffShell.tsx`, `LearnerShell.tsx`, primitives. Mitigation: agree file ownership; keep each change small and in one task.
- **Hydration mismatches**: T3 changes what renders after hydration; keep the first render identical on server and client.
- **Licence UI gate tests** (`licence-ui-mirror-gate`, `licence-enforcement-boundary`) classify every confirm modal and write path; new row menus and dialogs in T8 must be classified or the gate fails. Plan time for this.
- **T11 and T5 copy** may need the owner's wording.
