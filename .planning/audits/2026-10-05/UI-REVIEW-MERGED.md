# KQ Nexus: merged UI/UX review (re-baselined on develop)

Date: 2026-10-05. Code audited: `develop` at `2f73220` (Phase 14 licence work plus the co-worker's UAT fixes, merged).
Environment: local test app on port 3010 against a throwaway Postgres database (`licence_test`, Docker, port 5434), seeded with the
standard demo data. The shared Neon database was never touched. Email in stub mode. Method: axe-core (WCAG 2.0 to 2.2 AA and best
practice) on 31 screens, direct checks of each earlier finding in a visible Chrome window, and screenshots reviewed by eye at 1440px and 390px.

This file merges two lists so Phase 15 does not redo finished work:
1. my first audit of 2026-10-04 (15 findings, run before the co-worker's changes were pulled), re-checked below;
2. the co-worker's still-open items in `UAT-FIXES-AND-ADDITIONS.md` (IDs U-xx, A-xx, R3-xx), which are referenced by ID, not copied.

Related: `.planning/todos/pending/2026-10-05-phase-15-prerequisites-ui-review-and-licence-go-live.md` (the Phase 15 checklist).
A clickable prototype that fixes most of the findings below exists as a single HTML file in the Claude session scratchpad (see the todo).

## 1. New regression found by this re-check

| ID | Severity | Finding | Where | Fix |
| --- | --- | --- | --- | --- |
| N-01 | **Critical (quick)** | The new notification popup container adds two accessibility errors to **every page** (31 of 31 screens): `aria-prohibited-attr` (serious) and `region` (moderate). Before the pull those pages had zero. | `src/components/feedback/Toaster.tsx` lines 120 to 122: `<div aria-label="Notifications">` has no role. | Add `role="region"` to that div (a labelled landmark), then re-run axe. One line. |

## 2. Status of the findings from the first audit

Summary: of 14 distinct findings, **2 fixed** (3, 10), **3 partly fixed** (1, 5, 12), **9 still present** (2, 4, 6, 8, 9, 11, 13, 14, 15).

| # | Finding (2026-10-04) | Status on develop now | Evidence |
| --- | --- | --- | --- |
| 1 | Staff sidebar clips Email log and Licence on laptop-height screens, no scrollbar | **Partly fixed** | Groups now fold (5 chevrons, state remembered) but default expanded and the sidebar is still `overflow:hidden`. At 900px tall, Licence is at y=1000 and unreachable until the user folds groups. The new "Learner numbers" link made it longer. |
| 2 | Failed sign-in wipes the email and drops keyboard focus | **Still present** | Email field empty after a wrong password; focus on `body`. |
| 3 | Raw "Invalid input: expected string, received undefined" on the empty New course form | **Fixed** | Form is now three steps with "Title required", "Slug required" and a plain banner. |
| 4 | Phone sign-in and register push the form below the fold | **Still present** | Sign-in submit button bottom edge 845px, register 1009px, on an 844px screen. |
| 5 | Public catalogue: no price, no button, stray "–" | **Partly fixed** | One course now shows a price (seed data). The other two still show "–" and no text button (arrow icon only). |
| 6 | Best value line ("employer can verify") only on the sign-in panel | **Still present** | Not in the catalogue main content. |
| 7 | (Duplicate of 1: hidden nav items reachable only by keyboard) | Merged into 1 | Not counted separately, so there are 14 distinct findings. |
| 8 | Phone public header: logo collides with Sign in | **Still present** | Brand ends 136px, next control starts 126px. |
| 9 | Learner navigation differs between pages | **Still present** | Account page shows "Dashboard, Courses, Account"; the others show five items. |
| 10 | "Add instructor" needs a raw user id | **Fixed** | Popup picker ("Add instructor", Remove). |
| 11 | Enrolments table: tiny action links, ISO dates | **Still present** | 27 of 27 row actions are under 24px; dates still `2026-10-02`. |
| 12 | Generic page titles | **Partly fixed** | Staff titles are unique. Learner dashboard, My learning and Support still read "Training Administration". |
| 13 | Dashboard attendance reads "0% of 75% required" | **Still present** | Unchanged wording. |
| 14 | Auth pages: content outside landmarks | **Still present** | axe `region` x4 on sign-in, register and forgot password (the brand panel). |
| 15 | Small tap targets on register checkboxes and inline links | **Still present** | Register still has 6 targets under 24px. |

Not re-checked this round (so still unverified): Account page field alignment and the two identical "Save changes" buttons; the lopsided empty
space on the dashboard and cohort pages.

## 3. Co-worker items that stay open (carry into the plan by ID)

From `UAT-FIXES-AND-ADDITIONS.md`: **U-02** disabled buttons with no reason; **U-04** override heading with no buttons for instructors;
**U-05** developer wording ("a later phase", "(CAT-08)", raw ids and permission codes); **U-07** raw status codes and ids in lists;
**U-08** quiz page issues; **U-09** checkout error below the fold and misleading; **U-10** no mention of an open order with a held seat;
**U-11** unverified sign-in says "details do not match"; **U-12** three date formats and UTC versus Lagos time; **U-13** Users link 404
for a programme manager; **U-15** no confirmation on saving email preferences; **U-16** cancel-session dialog buttons side by side.
Not UI but adjacent: A-06, A-09, A-10, and the owner questions 1 to 7 in their file.

## 4. Merged priority list for Phase 15

### Critical
1. **N-01** Toaster `role="region"` (one line; clears the same two accessibility errors on all 31 screens).
2. **#2** Keep the email and move focus to the error after a failed sign-in (also a WCAG 2.2 "redundant entry" requirement).
3. **#1** Staff sidebar: make it scrollable, and collapse all groups except the current page's by default.
4. **#4** Phone sign-in and register: shrink the brand panel so the form starts near the top.

### High impact
5. **#5, #6** Catalogue: a text button and price on every row (or "Dates to be announced"), remove the "–", add the "employer can verify" line.
6. **#8** Fix the phone header collision.
7. **#9** One learner navigation on every page.
8. **#11 with U-12** Enrolments: actions in a menu, targets of at least 24px (ideally 44px), human dates, one date format and Lagos time everywhere.
9. **#12** Unique titles on the remaining learner pages.
10. **U-02, U-05, U-07, U-09, U-11** (co-worker's open items, grouped here because they touch the same screens).
11. **#14** Landmarks on the auth pages (clears the remaining axe `region` errors).
12. **#15** Larger register checkboxes and links.

### Nice-to-have
13. **#13** Reword attendance ("No sessions attended yet, you need 75% to qualify").
14. U-04, U-08, U-10, U-13, U-15, U-16.
15. Balance the dashboard and cohort page whitespace; align the Account page fields and label the two Save buttons (verify first).

## 5. Rules for doing this work

- One person owns the shared UI parts at a time: `ConfirmModal`, `ResourceForm`, `Toaster`, `StaffShell`, catalogue components.
- After each change, re-run axe on the 31 screens. The target is zero violations, as it was before the pull.
- Do not test against the shared Neon database. Use the throwaway Docker database with a shell-level `DATABASE_URL`.

## 6. What this review did not cover

Real payments and checkout; quizzes, assignments and certificate downloads in the browser; video; real screen readers and real phones;
modal and hover states beyond a few; email in real mail clients; performance and load.
