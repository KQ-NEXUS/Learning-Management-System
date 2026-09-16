# Phase 10 Chrome walkthrough

Date: 2026-09-16. Observer: Codex, explicitly delegated by the user. Environment: seeded local `lms_phase10_uat`, Chrome, http://localhost:3000. These are agent browser observations, not human observations.

Status: in progress. Chrome's extension refused file-chooser `setFiles` with `Not allowed`; upload checks are blocked until file URL access is enabled by the user. After the user asked to continue, the local server was restarted successfully, but the Chrome connector returned no available browser and could not resume the remaining checks.

| Step | Actual observation | Status |
|---|---|---|
| 1 | Course detail exposes Assessments beside Arrange; existing Content tab remains. Eight staff navigation items unchanged. | Passed |
| 2 | Created a quiz through the form. Attempt limit, raw pass mark, read-only computed total, Highest/Latest/Average buttons, feedback select; no assignment settings. A title over 200 characters was refused. | Passed |
| 3 | Authored single-choice, fixed True/False, and multi-choice questions. Enter on Move question 3 up announced `Question 3 moved to position 2 of 3` in the live status. Two correct multi-choice options were added before successful publication. | Passed |
| 4 | Publishing an invalid multi-choice question refused with `Question 2: correct option count` and a message naming zero correct options. Raw pass mark 70 against total 3 was also refused. After fixes, publication reported version 1. | Passed |
| 5 | Created an assignment with instructions, due date control, permitted extension buttons, byte size/MB display, total/pass marks, and resubmission checkbox; no question builder. | Passed |
| 6 | Learner lesson displays the real quiz summary with attempts, remaining count, and pass mark; no Phase 10 placeholder. | Passed |
| 7 | All three question types rendered on one page. Counter changed 0/3 to 1/3 to 3/3; Submit disabled until all answered. Counter has computed `position: sticky`. | Passed |
| 8 | Before first submission, inspected rendered HTML including serialized script data containing the question text. No `isCorrect`, `correctOptionIds`, `answerKey`, or `correctAnswers` was present. No correct-answer labels appeared in the quiz. This checks delivered DOM/Flight script data, not a separate network trace. | Passed |
| 9 | First submission resolved directly to 3/3 (100%), Passed, with selected and correct answers for every question; no manual grading state. | Passed |
| 10 | Reloading an unfinished second attempt exposed Resume and Start new attempt. Start showed a plain inline abandonment notice and zero dialogs. After reload, history showed Attempt 2 as Abandoned between submitted attempts. The immediate view omitted that row and briefly showed remaining 0; reload corrected it to remaining 1 because abandoned attempts do not consume the allowance. | Passed with transient UI defect |
| 11 | After using the slot freed by the abandoned attempt, the final submission resolved 0/3 Not yet passed, remaining 0, and `You've used all 3 of your attempts for this quiz`; no Start button. History contained three submitted attempts plus the abandoned attempt. | Passed |
| 12 | Instructions, application/pdf, and 10.0 MB are visible before selecting a file. | Passed |
| 13 | TXT fixture could not reach the input: Chrome extension file chooser rejected `setFiles` with `Not allowed`. | Blocked |
| 14 | Valid PDF upload not run because Chrome file access is disabled. | Blocked |
| 15 | Past due date is visible without red styling; selection/late notice requires the blocked upload capability. | Blocked |
| 16 | Resubmission not run because Chrome file access is disabled. | Blocked |
| 17 | Not yet run. | Pending |
| 18 | Cohort tabs render Overview, Sessions, Roster, Exceptions, Grading in that order. Grading listed only `Site hazard report` and the newly authored assignment; no quiz appeared. | Passed |
| 19 | Queue heading remained `Grading: Safety Leadership Programme — January 2026 · Site hazard report` after reload, with the back-to-cohort link and 20 rows. | Passed |
| 20 | On Batch learner 1, changed score to 73 and entered eight paragraphs of feedback. Save draft persisted both. No Override control appeared on the draft. The learner-side invisibility check is blocked because the seeded batch account is inactive. | Partial / blocked |
| 21 | Staff Release changed the row to Released, removed Save, displayed 73/100 and the saved feedback, and exposed Override grade. Learner-side visibility is blocked because the seeded batch account is inactive. | Partial / blocked |
| 22 | Selected Batch learners 2–4. Confirmation said `Release 3 grades`; confirmation changed to `Working…` with Escape suppressed, then closed. Chrome disconnected before a fresh row-by-row status read. | Partial |
| 23 | Released grade had no Save action and only Override grade. A five-character reason kept the action disabled. A real reason changed score 73 to 82. | Passed |
| 24 | History rendered `Overridden from 73 to 82 by Ada Admin`, the timestamp, and the full reason. `Certificate impact — not yet evaluated (arriving in a future update)` rendered as plain text. | Passed |
| 25 | The draft grade showed zero Override grade controls anywhere on the grade-entry view. | Passed |
| 26 | Learner dashboard not run before Chrome disconnected. | Pending |
| 27 | Learner results page not run before Chrome disconnected. | Pending |
| 28 | Published learner quiz was edited through staff UI to a long title and prompt. Narrow screenshot shows wrapped title and prompt; no horizontal overflow (document width equals client width). Requested 360px override reported actual client width 383px. | Passed |
| 29 | Eight paragraphs wrapped without horizontal page overflow on the staff grade-entry screen (`scrollWidth` equaled `clientWidth`). The feedback definition expanded to 500 px with `overflow-y: visible`, so it did not scroll inside its card as required. Learner side is blocked by the inactive account. | Failed / blocked |
| 30 | Three-grade batch showed a whole-operation `Working…` state and completed without an unresponsive gap. Large remaining batch was not run before Chrome disconnected. | Partial |

Long multi-choice option labels wrapped clearly with their controls in the narrow screenshot. The assignment metadata stayed readable, but the native file-input row visibly extended past the narrow card's right edge. The seeded quiz's inconsistent 70/3 raw pass mark was corrected through the staff form to 2/3, instructions updated, and changes published as version 2 before learner checks.

## Browser console findings

Learner quiz/assignment pages and the grading queue logged React hydration mismatches. The server rendered dates in a day-first locale while Chrome rendered month-first (`16/09/2026, 01:17:29` versus `9/16/2026, 1:17:29 AM`). React regenerated the affected trees on the client.

## Confirmed defects

1. Date `toLocaleString()` output differs between server and browser, causing hydration failures on assessment and grading screens.
2. Immediately after abandoning an unfinished quiz, history and remaining-attempt state are stale until reload.
3. The native assignment file input overflows the narrow submission card.
4. Long released feedback expands the staff grade card instead of scrolling within it.
