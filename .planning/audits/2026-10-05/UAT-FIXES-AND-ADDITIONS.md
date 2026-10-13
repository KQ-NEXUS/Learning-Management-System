# KQ Nexus LMS: UAT findings, fixes and additions

Oct 5, 2026 · @Khalid

## Summary

Three rounds of hands-on testing and one code audit between 30 September and 3 October 2026 produced 42 numbered findings. 22 are fixed, 2 are partly fixed, 2 are deferred by decision, and 16 lower-severity items are still open. After the fixes, 10 new pieces were added from the owner's list of ideas.

| Measure | Figure |
| --- | --- |
| Testing rounds | 3 UAT rounds, 1 product audit |
| Numbered findings | 42 (15 audit A-, 16 interface U-, 11 round-three R3-) |
| Fixed | 22 |
| Partly fixed | 2 (A-12, U-01) |
| Deferred by decision | 2 (R3-08, R3-11) |
| Still open | 16 (3 audit items, 13 interface notes) |
| New pieces added | 10 |
| Commits since the fix plan started | 42 on branch `Khaliddev` |
| Pushed to the shared repository | All 42, on 5 October (up to `f03221c`) |
| Local only, waiting to be pushed | None |
| Database migrations added | 3 |
| Automated tests | 5,286 unit tests and 64 real-database test files, all passing |

Everything described here was built and tested on the local Docker stack against a separate test database (`lms_uat`). Nothing has been deployed to production, and the three migrations have not been applied to the production database.

## Timeline

The work ran in four stages: test, audit, fix, then add. Newest first.

| Date | Stage | What happened |
| --- | --- | --- |
| 5 Oct | Additions | Staff-only rule for instructors and facilitators. Adding several learners at once. Full test suites re-run. Everything pushed, up to f03221c. |
| 4 Oct | Additions | Session calendar, step-by-step forms, action confirmations, folding sidebar, staff picker, learner numbers, numbers for existing learners, learner picker. |
| 4 Oct | Fixes | Last four fix-plan items: session editing (A-11), temporary-password notice (R3-12), email log wording (U-01), notification times (U-14). Pushed up to `e2b8182`. |
| 3 Oct | Fixes | Fix plan written. 18 commits covering go-live blockers, crashes, access control, learning rules and staff workflow. |
| 3 Oct | UAT round 3 | Fresh full test on a newly seeded database, build `39423b0` (phases 1 to 14). Every role tested end to end. 11 new findings (R3-); 7 earlier findings confirmed still present. |
| 30 Sep | Product audit | Code reading with file and line evidence across phases 1 to 13. 15 findings (A-) and 16 interface notes (U-). No source code changed. |
| 30 Sep | UAT round 2 | Merged build `ca2c518` with phase 13 (emails and notifications). Found the historic-email risk (A-14) and the reopened-ticket gap (A-15). |
| 30 Sep | UAT round 1 | Full-role test on the pre-merge build `ed314d4`: visitor, learner, administrator, support agent, instructor, programme manager, finance. |

The source records are in the repository: `.planning/audits/2026-09-30/` (rounds 1 and 2, the product audit) and `.planning/audits/2026-10-03/` (round 3, the fix plan).

## Findings and fixes

24 findings were fixed or partly fixed, in six batches ordered by risk. IDs starting A- and U- come from the product audit; R3- from UAT round 3.

Two owner decisions on 3 October shaped the fixes: a quiz lesson completes when the learner passes and an assignment lesson when they submit, with no manual "Mark complete" on either; and one priced payment rail is enough to publish a cohort.

### Batch 1: blockers for going live

| ID | Severity | What was wrong | What changed | Commit |
| --- | --- | --- | --- | --- |
| A-14 | High | The first production run of the email sender would have emailed every learner about every historic event. In testing, 26-day-old cancellations were emailed for a cohort now in progress. | A migration marks every event that predates notifications as already processed, so only new events send mail. Proven with a real-database test. | `2b658a6` |
| R3-02 | High | Every certificate download failed on the Docker build. The image did not include the `assets/` folder, so the certificate font was missing. | The image now ships the font. A guard test fails if it is ever left out again. Verified in the rebuilt container. | `cad925b` |
| R3-01 | High | A freshly seeded database could not sell anything. The bookable cohorts had no NGN or USD price, and one was seeded with its end date equal to its start. | The seed sets prices and a valid end date, and repairs older databases without overwriting staff edits. | `51c09c1` |
| A-03 | High | Databases seeded before 20 September kept two broken assessments: a quiz with a pass mark of 70 out of 2, and an assignment that rejected every PDF. Re-seeding never repaired them. | The seed now repairs those exact stale values. | `51c09c1` |

### Batch 2: crashes and dead ends

| ID | Severity | What was wrong | What changed | Commit |
| --- | --- | --- | --- | --- |
| A-04 | Medium | The New user and New role pages crashed ("Something went wrong") for every role without permission: support agent, instructor, programme manager and finance. | The denied view no longer passes a function from a server component. A static guard now checks every server component in the app for the same mistake. | `d118644` |
| R3-04 | Medium | Passing the final quiz landed the learner on a 404 page. "Open" on a completed course in My learning also gave a 404. | A completed course opens as a read-only record, and the lesson page shows a completed panel. | `13cb48a` |
| A-13 | Low | Four event-mapper tests were out of date and failing. | The tests select their own mapper and no longer depend on registry counts. | `ca46497` |

### Batch 3: access control

| ID | Severity | What was wrong | What changed | Commit |
| --- | --- | --- | --- | --- |
| A-02 | High | The payments report and its CSV export needed only the general reports permission. Instructors and programme managers, who are refused on the Payments screen, could see learner names, totals, fees and refunds. | The payments permission is now also required on the dashboard, the export request and the download. | `421bc1b` |
| A-05 | Medium | Finance could mark a learner's lessons complete, which feeds completion and certificate eligibility. | Overriding lesson completion now needs both the enrolment and the attendance permission. Nobody gained access. | `88b159d` |

### Batch 4: learning rules

| ID | Severity | What was wrong | What changed | Commit |
| --- | --- | --- | --- | --- |
| A-01 | High | Passing a quiz never completed its lesson. Depending on a setting, the learner was either stuck with every later lesson locked, or could click "Mark complete" and skip the quiz entirely. | A quiz lesson completes on a pass and an assignment lesson on submission, in the same database transaction. Neither has a manual mark or undo. | `973c864` |
| A-07 | Medium | A published quiz could be saved with a pass mark above its total marks, making it unpassable while still live. | The save is refused on a published assessment, whether the pass mark, the total or the questions are changed. | `ec51da6` |

Learners who passed a quiz before the A-01 fix are not back-filled. Any who are stuck need the staff override.

### Batch 5: staff workflow

| ID | Severity | What was wrong | What changed | Commit |
| --- | --- | --- | --- | --- |
| R3-05 | Medium | Staff forms lost everything typed when a save failed validation. Prices went blank and dates reverted. | Fixed once in the shared form component, so every staff create and edit form keeps what was typed. Registration keeps name and email. | `5e450c1`, `cc41e10` |
| R3-06 | Medium | A cohort could not be published without a USD price, so staff could not create an NGN-only cohort. | One priced rail is enough. The unpriced rail is a warning naming the currency learners cannot pay in. | `b9aec88` |
| R3-07 | Medium | A cohort that had already started could not be found or bought online, even with enrolment open. The direct link bounced back without explanation. | The catalogue lists what checkout accepts. A started cohort shows "Started ... still enrolling". | `527c3cc` |
| A-08 | Medium | A flagged certificate said "confirm it should remain active, or revoke it" but offered only Revoke. | A "Keep certificate active" action clears the flag, with the same permission and mandatory reason as revoke, and is audited. | `84af3cf` |
| A-12 | Medium | The Overview said one order was in an exception state while Reconciliation said none, and the Overview link went to an unfiltered list. | Partly fixed. The Overview item is now "Orders needing review" and opens the payments list filtered to exceptions. Order exceptions and reconciliation cases remain two queues by design. | `2f43b57` |
| A-11 | Medium | Sessions could be created and cancelled but never edited, so the "session updated" email could never send. | Each scheduled session has an Edit action. A change to title, time, location or meeting link notifies learners. | `be2cf2c` |
| A-15 | Medium | When a learner reopened a ticket, nobody on staff was told. | The ticket's owner gets an in-product alert, or every ticket manager when it has no owner. | `0731cf5`, `6ecc4d5` |

### Batch 6: polish

| ID | Severity | What was wrong | What changed | Commit |
| --- | --- | --- | --- | --- |
| U-01 | Medium | The email log showed raw template ids, status codes and skip reasons. | Partly fixed. Template names, statuses and skip reasons read as words. The audit log's action codes are unchanged. | `1b28aaa` |
| R3-09 | Low | The submit dialog said "this is your last attempt" on attempt 1 of 2. | Wording corrected. | `ee01bf4` |
| R3-10 | Low | The dashboard results panel said "No results yet" after a pass. | A completed course's card loads its released results. | `ee01bf4` |
| R3-12 | Low | A staff member's first sign-in with an administrator-set password did not prompt a change. | Done as a suggestion, by owner decision on 4 October. A notice links to choosing a new password and blocks nothing. It hides after 12 seconds and has a Dismiss button that keeps it away for 30 days on that browser. | `eaf20d2`, `e2b8182` |
| U-14 | Low | Notification times showed when the email sender ran, not when the event happened. | A notification shows the time of its event. | `3499756` |
| U-03 | Medium | Adding an instructor to a cohort meant typing a raw user id. | Replaced by a pop-up list of staff. See Additions. | `87d3a7d` |

## Deferred and still open

18 numbered findings are not done: 2 deferred by decision and 16 not yet addressed. None was judged a blocker for going live.

### Deferred by decision

| ID | Finding | Why deferred |
| --- | --- | --- |
| R3-08 | Five of ten report dashboards say "Not available yet": Progress, Submissions, Grades, Completion, Certificates. | Five new reports. To be planned as its own phase. |
| R3-11 | Certificate design upload accepts PNG and JPEG only, so a PDF design must be converted first. | Set aside by the owner on 4 October. |

### Audit items not yet addressed

| ID | Severity | Finding |
| --- | --- | --- |
| A-06 | Low | Resending from the email log goes to the address stored at the time, so a learner who has since changed email gets it at the old inbox. |
| A-09 | Medium | Manual payment and refund amounts are typed in minor units (kobo, cents). The expected amount differs from the "Total charged" on the same page without explanation, and nothing sanity-checks a USD price against the NGN price. |
| A-10 | Low | Past sessions still offer a "Join session" link. |

### Interface notes not yet addressed

| ID | Finding |
| --- | --- |
| U-02 | Disabled buttons give no reason: checkout Pay before both consents, manual confirmation before a date, refund over the limit. |
| U-04 | An instructor sees the "Lesson override" heading and explanation with no buttons. It should say the role cannot override. |
| U-05 | Developer wording in the product: "Not yet checked, a later phase", "(CAT-08)", "(D-14)", raw ids in headings, raw permission codes in the picker. |
| U-06 | Readiness numbers quiz questions from 2, one off from the editor. |
| U-07 | Raw status codes in staff lists, a database id as the refund reference, "application/pdf" shown as an accepted file type. |
| U-08 | Quiz page: title shown twice, pass mark with no unit, attempt history out of order, per-question feedback revealing true or false answers early. The attempt-count wording was fixed under R3-09. |
| U-09 | The checkout payment error appears below the fold after the redirect, and says "try again" when the rail is simply not configured. |
| U-10 | The learner dashboard does not mention an open order with a held seat, and there is no orders list. |
| U-11 | Signing in before verifying says the details do not match an account, with no hint to resend the verification email. |
| U-12 | Three date formats across learner pages; learner support times in UTC while staff pages use Lagos time; "Admin workspace" shown for every staff role. |
| U-13 | The Users list links to a detail page that gives a 404 for a programme manager. |
| U-15 | Saving email preferences shows no confirmation. |
| U-16 | The cancel-session dialog puts "Cancel session" and "Cancel" side by side. |

### Ideas raised and set aside

- Remove the duplicate "New course" heading on the stepped form.
- Convert the remaining long forms to steps: lesson, assessment, staff account, role.
- Action confirmations on learner-side screens. They are on staff screens only, which is why U-15 is still open.
- Phase 15, to be planned with the co-worker.

## Additions

Ten pieces were added on 4 and 5 October from the owner's list of ideas. Each was built, tested and checked in a real browser before the next began.

| # | Addition | Where it appears | Commit |
| --- | --- | --- | --- |
| 1 | Session calendar | Cohort, Sessions tab; learner "Calendar" page | `10a3225`, `81c3e63`, `9ba9b75` |
| 2 | Step-by-step forms | New and edit course, cohort, programme | `162b5d7` |
| 3 | Action confirmations | About 25 staff screens | `138d227`, `48464f0` |
| 4 | Folding sidebar | Staff sidebar | `fe13c3d` |
| 5 | Staff picker | Cohort instructors; session facilitator | `87d3a7d` |
| 6 | Learner numbers | Administration, Learner numbers; roster, enrolments, learner page, account page | `b8ac9e3`, `0db3dbe` |
| 7 | Numbers for existing learners | Administration, Learner numbers | `de8c977` |
| 8 | Learner picker | Cohort, Roster, Add enrolment | `0919320` |
| 9 | Adding several learners at once | Cohort, Roster, Add enrolment | `6996178` |
| 10 | Staff-only rule for instructors and facilitators | Server | `52b7185` |

### 1. Session calendar

Staff can schedule a session by clicking a day; learners see their upcoming sessions on one calendar.

- **Staff**: the cohort's Sessions tab has a Table and Calendar switch. Clicking a day opens a short form with the date already set. Clicking a session on the calendar opens it for editing.
- **Learners**: one calendar across everything they are enrolled in, linked from the dashboard and My learning.
- **Views**: month and week.
- **Short form**: the pop-up shows the essentials, with the rest under "More options".
- **Feedback**: an "Updating sessions" indicator shows while the list refreshes after a save.
- **Owner decisions**: staff calendar is per cohort only; learners get one calendar for everything; month and week views; the table stays, behind a switch.

### 2. Step-by-step forms

The long create and edit forms for courses, cohorts and programmes are split into three named steps with a progress indicator.

- **Course**: Basics, Who it is for, Completion and certificate.
- **Cohort**: Details, Schedule, Capacity and price.
- **Programme**: Basics, Who it is for, Order and certificate.
- **Creating**: steps are taken in order with Next and Back, and Submit on the last.
- **Editing**: any step can be opened directly.
- **Errors**: a failed save jumps to the step holding the first problem.

Before this, a forms inventory was produced: every screen in the app that asks for input, with screenshots. It is a review aid, not part of the product.

### 3. Action confirmations

Every staff action now says what happened, in one consistent place.

- **Placement**: a pop-up in the bottom-right corner.
- **Duration**: success messages leave after about 5 seconds; errors stay until dismissed.
- **After a redirect**: actions that move to another page, such as creating a course, still confirm on arrival.
- **Accessibility**: messages are announced to screen readers.
- **Owner decisions**: corner pop-up; about 5 seconds; overlapping a button briefly is acceptable.

### 4. Folding sidebar

Each group in the staff sidebar (Delivery, Finance, Catalogue, Operations, Administration) folds to its heading.

- The choice is remembered on that browser.
- The group holding the current page always stays open.

### 5. Staff picker

Fields that asked for a typed user id are replaced by a pop-up list. This closes finding U-03.

- **Add instructor**: lists active staff with email and roles, searchable by name or email. Someone already an instructor is shown but cannot be chosen.
- **Session facilitator**: chosen from the cohort's instructors, with Change and Clear.
- **Owner decision**: a pop-up window for instructors and facilitators.

### 6. Learner numbers

Each learner gets a readable, sequential number in a format the organisation chooses.

- **Format**: fixed text, a run of `#` for the counter (at least three), and optionally `{YYYY}` or `{YY}` for the year the learner registered. Examples: `KQL-######` gives `KQL-000001`; `KQ/{YY}/#####` gives `KQ/26/00001`.
- **Settings screen**: Administration, Learner numbers, for administrators only. It shows a live preview of the next numbers, explains a bad pattern in plain words, and shows how many learners have and lack a number.
- **Issuing**: at registration, inside the same transaction that creates the account. Twenty simultaneous registrations were tested and got twenty consecutive numbers.
- **Off by default**: nothing is issued until an administrator saves a pattern.
- **Changing the pattern**: affects only later registrations. The counter carries on and never restarts. A number never changes once issued.
- **Where it shows**: cohort roster, enrolments list (also searchable by number), the learner's progress page, and the learner's own account page.
- **Owner decisions**: sequential, not random; customisable format.

### 7. Numbers for existing learners

An administrator can give numbers to learners who registered before numbering was switched on.

- A button on the Learner numbers screen, behind a "cannot be undone" confirmation that states how many learners and where numbering starts.
- Oldest registration first, continuing from the counter.
- The year in the number is the year each learner registered, not the year of the run.
- Staff are never numbered. Learners who already have a number keep it.
- Two administrators running it at once take turns, so nobody is numbered twice.
- The run is recorded in the audit log.
- **Owner decision**: the original decision was not to number existing learners. On 4 October it was reversed, as an explicit action an administrator chooses.

### 8. Learner picker

Roster, Add enrolment no longer asks for a typed learner id.

- A list of learner accounts, searchable by name, email or learner number.
- The number shows on every row, so two learners with the same name can be told apart.
- Learners already in the cohort are shown greyed out with the reason.
- A long list shows the first 50 and says how many more match.
- Choosing, then giving the reason, are two steps in sequence. Only one pop-up is open at a time.

### 9. Adding several learners at once

The learner list has tick boxes, so a group can be added in one go.

- Ticks are kept while searching for the next person, and everyone chosen is listed underneath with a remove button.
- One status and one reason apply to the whole group. Each learner still gets their own enrolment and their own audit entry.
- **Not enough seats**: nobody is added, and the message says how many seats are left and how many learners to remove.
- **Already enrolled**: if any chosen learner already has a place, nobody is added.
- Adding a single learner works as before.
- **Owner decisions**: add none when seats run short, rather than as many as fit; no limit on group size.

### 10. Staff-only rule for instructors and facilitators

The server now refuses anyone who is not an active staff account as an instructor or a session facilitator.

- The pop-ups already listed staff only. This holds the same rule on the server, whatever sends the request.
- Re-sending an assignment that already exists is still accepted.
- A session whose facilitator has since left can still be edited, as long as the facilitator is not being changed.

## Verification

Both automated suites pass at the latest commit (`f03221c`), and every addition was exercised in a real browser against the rebuilt application.

### Automated suites

| Suite | When | Result |
| --- | --- | --- |
| Unit, 338 files | 5 Oct, latest commit | 5,286 pass. One slow test timed out in the full run and passes on its own. |
| Integration, 64 files, real database | 5 Oct, latest commit | All pass. 57 files passed first time; 7 passed on a re-run in smaller groups. |
| Unit | 4 Oct, after the audit fixes (`eaf20d2`) | 5,108 pass |
| Integration | 4 Oct, after the audit fixes (`eaf20d2`) | 607 pass |
| Type check and lint | Each commit | Clean |

The full runs on 4 and 5 October caught three real problems, all fixed before this document was written:

- Two licence "gate" tests require every new staff screen and confirmation pop-up to be classified. The learner-numbers files were not. They are now (`f4ca5a7`).
- A test written for adding several learners created 150 learners with 150 simultaneous database calls and overwhelmed the test database. It now creates them in one call (`f03221c`).
- One assertion in a new test had a timing race (`f4ca5a7`).

Six of the seven integration files that needed a re-run failed on "cannot reach database server" or a 5-second limit, not on a wrong result. Docker on the test machine has under 4 GB of memory and each test file starts its own database, so the whole suite in one go is unreliable there. The suite must be run in batches.

### Browser checks

Each check was a scripted run in Chrome against the rebuilt local application, with screenshots.

| Addition | Checks passed | What was exercised |
| --- | --- | --- |
| Learner numbers and settings | 19 of 19 | Bad pattern refused, live preview, saving, two new registrations numbered in order, existing learners untouched, number shown on four screens, instructor refused |
| Learner picker | 19 of 19 | List opens, no id box, search by number finds one learner, already-enrolled greyed out, add and confirm, role without rights has no button |
| Numbers for existing learners | 17 of 17 | Offer shown with count, confirmation, cancel changes nothing, 14 learners numbered in registration order with no gaps, staff untouched, audit entry |
| Staff-only rule | 9 of 9 | A request altered to name a learner is refused for instructor and for facilitator; normal use still works |
| Adding several learners | 20 of 20 | Ticks kept across searches, chosen list, reason step, one seat for two learners refused with nobody added, two added with room, single learner unchanged |
| Session calendar | Passed | Saving from the day pop-up, editing by clicking a session, updating indicator |
| Step-by-step forms | Passed | Next, Back, submit, jump to the step with an error |
| Action confirmations | Passed | Corner pop-up, timing, confirmation after redirect |
| Folding sidebar | Passed | Fold, remember, current group stays open |
| Staff picker | Passed | Instructor and facilitator pop-ups, search, already-assigned greyed out |

For the last five, the individual check counts were not kept in this record.

### Not tested

- A real Paystack or Stripe payment.
- Email verification, password reset and email-change links.
- A successful licence activation and the restricted state.
- Video watch tracking.
- Email rendering in real mail clients.
- Mobile widths, keyboard-only use and screen readers, beyond what the automated accessibility checks cover.

## Before production

Nothing here has been deployed. Production runs on Netlify with a Neon database; the Docker stack is for local testing only. These steps are needed when this work goes live.

### Database migrations to apply on Neon

| Migration | What it does | Needed for |
| --- | --- | --- |
| `20261003120000_mark_pre_notification_event_backlog_processed` | Marks every historic event as already processed. | A-14. Must be applied before the email sender first runs in production. |
| `20261004120000_user_password_is_temporary` | Adds a flag for staff still on an administrator-set password. | R3-12 |
| `20261004150000_learner_numbers` | Adds the learner number to each account and the single settings row, switched off. | Learner numbers |

### Steps

- [x] Push the 17 local commits on `Khaliddev`. Done on 5 October; the remote is at `f03221c`.
- [ ] Apply the three migrations on Neon.
- [ ] Re-run the seed on Neon if that database was seeded before 20 September. It repairs the unpassable quiz and the assignment that rejects PDFs (A-03) and sets the missing cohort prices (R3-01).
- [ ] Confirm `SUPPORT_CONTACT_EMAIL` is set on Netlify.
- [ ] Decide the learner number pattern and save it under Administration, Learner numbers. Numbering stays off until this is done.
- [ ] If existing learners should have the lowest numbers, run "Give these learners numbers" before any new learner registers.
- [ ] Use the staff override for any learner who passed a quiz before the A-01 fix and is still locked out of later lessons.

### Things to know

- A learner number cannot be changed or taken back once issued, and the counter never restarts. Choose the pattern with that in mind.
- Staff accounts created before the temporary-password migration are not prompted to change their password.
- The certificate font fix (R3-02) concerned the Docker image only. Netlify was already covered.

## Open questions and known gaps

Seven questions need an owner decision, and five known gaps are worth recording.

### Questions for the owner

| # | Question | Where it came from |
| --- | --- | --- |
| 1 | Should an order in an exception state also open a reconciliation case? Today they are two separate queues, which is why Overview and Reconciliation can show different counts. | A-12 |
| 2 | Should overriding lesson completion have its own permission? Today it needs the enrolment and attendance permissions together. | A-05 |
| 3 | Should an active certificate stay reachable to a learner after their enrolment is withdrawn or transferred? | UAT round 1 |
| 4 | Should the attendance roster include learners whose enrolment is still pending payment? | UAT rounds 1 and 3 |
| 5 | Escalation offers a Finance queue, but the Finance role has no ticket permissions, so nobody there could see a ticket routed to it. Give Finance ticket access, or remove the queue? | UAT round 3 |
| 6 | The policy pages (Terms, Privacy, Refund) still hold placeholder text. Who supplies the real text? | UAT round 3 |
| 7 | Should staff also get numbers? The build assumes learners only. | Learner numbers |

### Known gaps

- **Learners who passed before the A-01 fix** are not automatically marked complete. They need the staff override.
- **Audit log** still shows raw action codes, and its times are in UTC while other staff pages use Lagos time.
- **The integration suite** cannot run in one go on the current test machine. It must be run in batches, or Docker given more memory.
- **One slow unit test** (it parses every source file) sits close to its 5-second limit and times out when the machine is busy.
- **Local test data** from this work remains in the `lms_uat` database only: about ten test learner accounts, a few test sessions and draft courses. None of it is in production.

## Appendix: commits

42 commits on `Khaliddev` since the fix plan started, newest first. All are pushed to the shared repository as of 5 October.

| Commit | Date | Summary |
| --- | --- | --- |
| `f03221c` | 5 Oct | Test: create the batch-add test learners in one insert |
| `6996178` | 5 Oct | Add several learners to a cohort in one go |
| `52b7185` | 5 Oct | Only active staff can be an instructor or a session's facilitator |
| `f4ca5a7` | 4 Oct | Test: classify the learner number screen in the licence gates |
| `de8c977` | 4 Oct | Give numbers to learners who registered before numbering |
| `0919320` | 4 Oct | Choose the learner from a pop-up, not by typing an id |
| `0db3dbe` | 4 Oct | Learner number settings screen; number shown where learners are listed |
| `b8ac9e3` | 4 Oct | Learner numbers issued in order from a configurable pattern |
| `87d3a7d` | 4 Oct | Choose an instructor or facilitator from a pop-up |
| `fe13c3d` | 4 Oct | Sidebar groups fold to their headings |
| `48464f0` | 4 Oct | The instructor error is announced to screen readers |
| `138d227` | 4 Oct | Actions say what happened, in one consistent place |
| `9418a8e` | 4 Oct | Test: drop an unused helper |
| `162b5d7` | 4 Oct | Long forms are filled in step by step |
| `9ba9b75` | 4 Oct | Show that the sessions are updating after a save |
| `81c3e63` | 4 Oct | The calendar pop-up is a short form |
| `10a3225` | 4 Oct | A calendar for scheduling and for seeing upcoming sessions |
| `e2b8182` | 4 Oct | The temporary-password notice dismisses and hides itself (R3-12) |
| `eaf20d2` | 4 Oct | Suggest a password change while a temporary password is in use (R3-12) |
| `be2cf2c` | 4 Oct | A scheduled session can be edited (A-11) |
| `cc41e10` | 4 Oct | Test: expect the echoed name and email on a refusal (R3-05) |
| `6ecc4d5` | 4 Oct | The reopened-ticket staff alert reads the reference from the ticket (A-15) |
| `3499756` | 4 Oct | A notification shows when its event happened (U-14) |
| `1b28aaa` | 4 Oct | Email log shows template names, statuses and skip reasons as words (U-01) |
| `ee01bf4` | 3 Oct | Correct attempt wording; show results on a completed course (R3-09, R3-10) |
| `2f43b57` | 3 Oct | The exception item opens the orders it counts (A-12) |
| `84af3cf` | 3 Oct | A flagged certificate can be confirmed as well as revoked (A-08) |
| `0731cf5` | 3 Oct | Staff are told when a learner reopens a ticket (A-15) |
| `5e450c1` | 3 Oct | A refused save no longer wipes what was typed (R3-05) |
| `527c3cc` | 3 Oct | A started cohort that is still enrolling can be found and bought (R3-07) |
| `b9aec88` | 3 Oct | One priced rail is enough to publish a cohort (R3-06) |
| `ec51da6` | 3 Oct | A published assessment cannot be saved with a pass mark above its total (A-07) |
| `973c864` | 3 Oct | Quiz and assignment lessons complete through their assessment (A-01) |
| `88b159d` | 3 Oct | Overriding lesson completion needs the attendance permission too (A-05) |
| `421bc1b` | 3 Oct | The payments report and its export require the payments permission (A-02) |
| `ca46497` | 3 Oct | Mapper tests no longer depend on registry counts (A-13) |
| `13cb48a` | 3 Oct | A completed course opens as a record instead of a 404 (R3-04) |
| `d118644` | 3 Oct | New user and new role pages no longer crash without permission (A-04) |
| `51c09c1` | 3 Oct | Sellable cohorts on a fresh database; repair of stale demo data (R3-01, A-03) |
| `cad925b` | 3 Oct | Ship the certificate font in the runtime image (R3-02) |
| `2b658a6` | 3 Oct | Never drain the pre-notification event backlog (A-14) |
| `b1f91ee` | 3 Oct | UAT round 3 record and the fix plan |
