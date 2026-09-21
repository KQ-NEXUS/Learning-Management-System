# Phase 10 human walkthrough

Status: awaiting human observations. Full tests, TypeScript, lint and build passed. No human step is marked passed.

## Local fixture

- URL: http://localhost:3000
- Database: lms_phase10_uat on local Docker PostgreSQL port 5433.
- MinIO: localhost:9002; separate local walkthrough objects.
- Staff: admin@kqnexus.test. Learners: learner4@kqnexus.test and learner5@kqnexus.test.
- Development password: Passw0rd!dev.
- Course: /staff/courses/cmu3b3d41001cul48ky2oye49
- Cohort: /staff/cohorts/cmu3b3dbx002lul48fnqt3vlc
- Learner quiz: /learn/cmu3b3djq003rul48lbdvswjm/lessons/cmu3b8pf80001ulkwh0xukz6w
- Learner assignment: /learn/cmu3b3djq003rul48lbdvswjm/lessons/cmu3b8pjw0003ulkwmhheh7i8
- Published quiz has all three question types. Assignment is PDF-only, 10 MB, resubmission allowed, past due and without a hard cutoff.
- Twenty extra learners have local-file-backed draft grades for the large batch check. Release only three of these fixture grades in step 22; reserve the other seventeen for step 30.
- Existing cohort tabs are preserved; Grading follows Exceptions.
- Upload fixtures: .planning/phase10-valid-upload.pdf and .planning/phase10-invalid-upload.txt.
- Use separate browser profiles or sign out between staff and learner steps.

## Walkthrough

The isolated local app is already running. Walk these in order and report each observation. To restart the same fixture, use `node .planning/phase10-uat-setup.cjs --dev`.

### Staff authoring

1. Open a Course detail page. Confirm an "Assessments" link sits beside Lessons and Arrange, and
   that the top-level staff nav gained NO new item.
2. Create a Quiz. Confirm the form shows attempt limit, pass mark, a read-only total marks fact, a
   Highest/Latest/Average segmented control, and a feedback-behaviour select — and no Assignment
   fields.
3. Add three questions: one single-choice, one true/false (its options should be fixed to True and
   False), one multi-choice with two correct options. Reorder them with the keyboard only. Confirm
   each move is announced.
4. Try to publish with one question left with no correct option. Confirm publish is refused and the
   specific defect is named. Fix it and publish. Confirm the version and status update.
5. Create an Assignment. Confirm it shows instructions, due date, permitted file types, size limit,
   grading scale and resubmission policy — and no question builder.

### Learner quiz

6. As an enrolled learner, open the quiz lesson. Confirm the old "arrives in Phase 10" placeholder
   is gone and a real attempt summary renders.
7. Start the quiz. Confirm every question is on ONE page, the sticky "N of M answered" counter
   updates as you answer, and Submit stays disabled until all questions are answered.
8. Before submitting, open devtools and inspect the page payload. Confirm you cannot find which
   options are correct.
9. Submit. Confirm the score, percentage and a Passed / Not yet passed pill appear IMMEDIATELY with
   no "pending grading" state, and that the correct answers now show.
10. Start a second attempt if the limit allows. Confirm the abandon notice appears as plain inline
    text, not a modal. Confirm the attempt history lists both attempts.
11. Exhaust the attempt limit. Confirm no Start control renders and the used-all-attempts message
    appears.

### Learner assignment

12. Open an assignment lesson. Confirm the instructions, permitted types and size limit are visible
    BEFORE submitting.
13. Try a file with a disallowed extension. Confirm it is refused with a message naming the limit,
    and that nothing appears to have been submitted.
14. Upload a valid file. Confirm the receipt appears only after the upload completes, showing
    "Submitted — receipt {id}".
15. With the due date in the past, select a file. Confirm the "will be marked late" notice appears
    and does NOT block submission, and that the due date is not rendered in red.
16. Submit a second version (with resubmission enabled). Confirm BOTH receipts remain visible, most
    recent first.
17. Set the assessment's availability end date in the past and reload. Confirm the submit control is
    REPLACED by the window-closed message, not merely greyed out.

### Staff grading

18. Open a Cohort detail page. Confirm the "Grading" tab follows Exceptions and lists only assignment
    assessments — no quizzes.
19. Open an assessment's submission queue. Confirm the Cohort-scope banner is visible, and stays
    visible on every reload.
20. Grade a submission: enter a score and feedback, Save draft. As the learner, confirm the results
    page shows NOTHING for that assessment.
21. Back as staff, Release it. As the learner, confirm it now appears with the score and feedback.
22. Select several draft submissions and use "Release selected". Confirm the confirmation says
    "Release {N} grades", that it shows a pending state for the whole operation, and that all the
    selected rows flip to Released together.
23. On a released grade, confirm the Save button is GONE and only "Override grade" is offered.
    Confirm the override refuses a reason under 10 characters. Override it with a real reason.
24. Confirm the override history row shows the previous score, new score, your name, the date and
    the reason, and that "Certificate impact — not yet evaluated" renders as a plain label.
25. On a draft grade, confirm NO override affordance is offered anywhere.

### Learner results

26. Open the learner dashboard. Confirm the Assessments and Results cards show real data rather
    than a deferred placeholder, and that the Tickets and Certificate cards are unchanged.
27. Follow "View all" to the results page. Confirm it lists results in course order, shows attempt
    and submission history, shows the override, and shows "N attempts remaining" on an unpassed
    assessment.

### UI backstops

28. Author an assessment with a very long title and a very long question prompt. Confirm both wrap
    without breaking the sticky counter's layout or the option alignment.
29. Release a grade with several paragraphs of feedback. Confirm it wraps and scrolls inside its
    card on both the grade-entry screen and the learner results page, without widening the page.
30. Select a large number of submissions and batch-release. Confirm the modal shows a pending state
    for the whole transaction and never appears to hang with no feedback.

For step 30, use network throttling in browser devtools if the local transaction finishes too quickly to observe the pending state.

During steps 3 and 12 also inspect long MULTI_CHOICE option labels and allowed-file-type chips on a narrow viewport. Step 17 requires staff to set the assignment hard cutoff in the past, then restore it for grading.

## Observation record

Record a concrete observation for every step, including security checks 8, 20 and 25 and visual checks 28-30.

| Step | Observed result | Status |
|---|---|---|
| 1 | Awaiting human observation | Pending |
| 2 | Awaiting human observation | Pending |
| 3 | Awaiting human observation | Pending |
| 4 | Awaiting human observation | Pending |
| 5 | Awaiting human observation | Pending |
| 6 | Awaiting human observation | Pending |
| 7 | Awaiting human observation | Pending |
| 8 | Awaiting human observation | Pending |
| 9 | Awaiting human observation | Pending |
| 10 | Awaiting human observation | Pending |
| 11 | Awaiting human observation | Pending |
| 12 | Awaiting human observation | Pending |
| 13 | Awaiting human observation | Pending |
| 14 | Awaiting human observation | Pending |
| 15 | Awaiting human observation | Pending |
| 16 | Awaiting human observation | Pending |
| 17 | Awaiting human observation | Pending |
| 18 | Awaiting human observation | Pending |
| 19 | Awaiting human observation | Pending |
| 20 | Awaiting human observation | Pending |
| 21 | Awaiting human observation | Pending |
| 22 | Awaiting human observation | Pending |
| 23 | Awaiting human observation | Pending |
| 24 | Awaiting human observation | Pending |
| 25 | Awaiting human observation | Pending |
| 26 | Awaiting human observation | Pending |
| 27 | Awaiting human observation | Pending |
| 28 | Awaiting human observation | Pending |
| 29 | Awaiting human observation | Pending |
| 30 | Awaiting human observation | Pending |

| Additional manual item | Observed result | Status |
|---|---|---|
| Long option labels and file-type chips | Awaiting human observation | Pending |
