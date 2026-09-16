# Phase 10 Chrome walkthrough

Date: 2026-09-16. Observer: Codex, explicitly delegated by the user. Environment: seeded local lms_phase10_uat, Chrome, http://localhost:3000.

Status: complete. All 30 walkthrough steps passed after the defects found during the walkthrough were fixed and retested.

| Step | Observation | Status |
|---|---|---|
| 1 | Course detail exposes Assessments beside Arrange; the eight-item staff navigation is unchanged. | Passed |
| 2 | Quiz form exposes attempt limit, pass mark, computed total, grading method, and feedback behaviour without assignment fields; title validation works. | Passed |
| 3 | Single-choice, fixed True/False, and multi-choice questions were authored; keyboard reorder announced the move. | Passed |
| 4 | Publish rejected zero correct options and an impossible pass mark, then published after correction. | Passed |
| 5 | Assignment form exposes instructions, due date, file types, size limit, grading scale, and resubmission without a question builder. | Passed |
| 6 | The learner lesson renders the real quiz summary. | Passed |
| 7 | All questions render on one page; the sticky counter updates and Submit remains disabled until complete. | Passed |
| 8 | Delivered HTML/Flight data contained no answer-key fields before submission. | Passed |
| 9 | Submission immediately showed 3/3, 100%, Passed, selections, and correct answers. | Passed |
| 10 | The inline abandon notice used no modal. After the fix, the new attempt immediately showed both abandoned rows and the correct remaining count without reload. | Passed |
| 11 | Exhausting the limit removed Start and showed the used-all-attempts message. | Passed |
| 12 | Assignment instructions, .pdf restriction, and 10.0 MB limit appear before selection. | Passed |
| 13 | A TXT upload was refused with the accepted-type message and no receipt. | Passed |
| 14 | A valid PDF produced a receipt only after verified completion. | Passed |
| 15 | Past due date stayed muted; selecting a file showed the late notice without blocking submission. | Passed |
| 16 | A second PDF kept both receipts, newest first. | Passed |
| 17 | A past availability end replaced the upload control with the closed-window message; clearing it restored the form. | Passed |
| 18 | Cohort tabs include Grading, which lists assignments and excludes quizzes. | Passed |
| 19 | The Cohort-scoped grading heading persisted across reloads. | Passed |
| 20 | A saved draft remained absent from Batch learner 5 dashboard/results. | Passed |
| 21 | Release exposed 73/100 and eight feedback paragraphs to Batch learner 1; override changed the visible score to 82. | Passed |
| 22 | Batch learners 2-4 released together; the confirmation named 3 grades and held a single Working state. | Passed |
| 23 | Released rows have no Save action; override remained disabled for a short reason and accepted a valid reason. | Passed |
| 24 | History shows 73 to 82, Ada Admin, timestamp, full reason, and certificate-impact placeholder. | Passed |
| 25 | Draft grade entry showed zero override controls. | Passed |
| 26 | Learner dashboards show assessment obligations and released result cards; draft results were absent. | Passed |
| 27 | Results showed the released assignment score, feedback, override and history plus the quiz score and three-attempt history. | Passed |
| 28 | Long title, prompt, and option labels wrapped without horizontal page overflow at the narrow Chrome viewport. | Passed |
| 29 | Staff feedback measured 192px client height / 780px scroll height and learner feedback 192px / 460px, both with overflow-y auto, pre-wrap, and break-word. | Passed |
| 30 | Sixteen selected draft grades released in one operation; the Draft filter emptied and announced 16 grades released. | Passed |

## Defects found and fixed

1. Locale-dependent date rendering caused React hydration mismatches. Assessment, submission, results, and grading timestamps now use the shared deterministic formatter. Fresh queue and results tabs logged only React DevTools/HMR information.
2. Starting a new quiz attempt returned no refreshed history. The server action now returns authoritative history and remaining attempts, and the client applies them immediately.
3. The native file input could exceed its narrow card. The label and input now constrain width; Chrome measured a 341px input inside a 375px parent with page scroll width equal to client width.
4. Long released feedback expanded the page. Staff and learner feedback now wrap inside a 12rem vertical scroll region.
5. Assessment edit actions forwarded datetime-local strings into Prisma and displayed UTC values as local input values. Actions now parse Africa/Lagos local time into Date values and edit forms format dates in that timezone.
6. Seeded assignment file data used application/pdf while the service validates extensions. The canonical seed now stores .pdf.
7. Seeded completion rules used obsolete fields and crashed the dashboard. Seeds and isolated pinned publications now use the versioned completion-rule schema.

## Fixture actions

The user explicitly approved activating the twenty local batch accounts. The isolated fixture activated all 20, repaired six course publications and one programme publication, and never wrote to the remote development database.
