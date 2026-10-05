# UAT round 3 — fresh full UAT, 2026-10-03

Build: develop 39423b0 (phases 1–14), image 3cba85ae4e10. Database: new `lms_uat`, migrated (24 migrations) and seeded from scratch; the existing `lms` database is untouched. Email: EMAIL_TRANSPORT=stub. No scheduler locally: drain/exports/licence check run by hand when needed.
Seed facts: 11 users, 3 courses, 1 programme, 3 cohorts, 9 enrolments, 3 demo orders, 3 demo certificates, quiz pass mark 2 of 2, assignment types {.pdf}, licence state UNLICENSED.

Legend: PASS / NOTE / ISSUE / BLOCKED

## 1. Visitor
- PASS  /courses lists all 3 courses; /programmes lists the programme; detail pages show structure, format, cohort date and seats.
- ISSUE (HIGH, seed) A freshly seeded database cannot sell anything: FCM-2026-02 and SLP-2026-03 have only the legacy `priceMinor`; `priceNgnMinor`/`priceUsdMinor` are null, so both pages show "Payment is temporarily unavailable for this cohort. Contact support to enrol." with no price and no pay button (seed.ts sets priceNgnMinor only on SLP-2026-01). Not licence-related.
- NOTE  Catalogue list shows "—" for price on every item.
- PASS  /verify: valid (CERT-SEED-0002), revoked (0003), unknown -> not found; minimal disclosure text.
- NOTE  Policy pages are placeholders: "[POLICY TEXT: the provider's Terms of Service is published here.]".
- PASS  /courses?notice=unavailable shows the neutral "Enrolment is temporarily unavailable. Please contact support."; ?notice=__proto__ renders normally (14-REVIEW WR-04 not reproduced in the browser).
- PASS  Register: short password rejected inline; existing email and new email both end on the same "Check your email" screen.
- NOTE  (low confidence, one sample each) new-email registration ~1.9 s vs existing-email ~1.0 s: possible timing difference (14-REVIEW IN-06).
- PASS  Forgot password: neutral response for an unknown email.
- PASS  Sign-in throttle: 5 wrong passwords -> "Too many sign-in attempts from this device. Wait 15 minutes, or reset your password." Per device: a failing attempt on another account also gets it; a correct password (admin) still signs in.
- NOTE  Page <title> brand "Training Administration" vs header "KQ Nexus" (unchanged).

## 2. Administrator (Ada)
### Licence (phase 14)
- PASS  Nav has Licence. Page: "Not activated — keeps working normally until the first licence is activated", deployment ID, works/blocked list, "Nothing is blocked right now", data-kept statement. No banner in this state.
- PASS  Activation rejects garbage ("This is not a licence file… Nothing was changed.") and the committed dev sample licence ("not issued with a recognised signing key… Nothing was changed.") — NODE_ENV=production, dev keys untrusted. State stayed Not activated.
- PASS  Diagnostic report: 200, state/ids/timestamps only; no addresses or key material.
- NOT TESTED  A successful activation and the restricted state: no production-trusted key exists (PRODUCTION_TRUSTED_KEYS is empty by design).
### Overview
- PASS  Fresh seed populates it: learners in delivery 3, enrolments 4, revenue ₦185K, Needs attention (submission awaiting grading, attendance not marked, certificate flagged, payment exception).
### Cohorts
- PASS  List: 3 cohorts with status tabs and filters.
- NOTE  Seed: SLP-2026-01 is "In progress" with a start date of 17 Oct 2026 (future).
- ISSUE (MEDIUM, seed) FCM-2026-02 is seeded with endsAt == startsAt; the editor refuses it ("The end date must be after the start date").
- ISSUE (MEDIUM) Cohort edit form loses everything typed when a save fails validation: all fields reset to the stored values (typed NGN/USD prices blank again, date reverted). Reproduced with real keyboard input. A second save then succeeds without the lost values (prices saved as NULL the first time).
- PASS  Valid save: FCM NGN 12500000 / USD 8500 -> detail shows ₦125,000 / $85; SLP-2026-03 NGN 45000000 -> saved.
- NOTE  Prices are entered in minor units (documented with an example on the form).
- NOTE  Cohort readiness: "Not yet checked — a later phase." rows; "Add instructor (user id)" raw id input (unchanged).
### Authoring (course -> module -> lessons -> quiz -> publish -> cohort)
- PASS  New course "UAT Fire Safety Basics" created as DRAFT. NOTE: slug is not suggested from the title.
- PASS  Arrange: add module; add lesson. Text lesson created with the rich editor (8 lesson types offered).
- PASS  New quiz: readiness blocks "no questions"; add question + options + correct answer -> "Questions saved. Total marks: 1."; Publish -> "Published — version 1".
- ISSUE (MEDIUM, = audit A-07, confirmed live) On the published quiz, pass mark 99 (total 1) saves: "Saved.", readiness shows 1 blocking, quiz stays Published. Restored to 1.
- PASS  Quiz lesson: the quiz picker lists the course's quiz and links it.
- NOTE  "Allow manual complete" is ticked by default for a Quiz lesson (see learner test of A-01).
- PASS  Publish content (dialog shows changes + running cohorts) -> PUBLISHED with 1 publication; List publicly -> "Course is now publicly listed."
- NOTE  Developer text in readiness: "Not yet checked — a later phase", "Not yet checked — Phase 10", "…until the Phase 9/11 engine ships".
- PASS  New cohort for the course (self-paced, NGN 20,000) created; a start time earlier today was accepted.
- ISSUE (MEDIUM) A cohort cannot be published without a USD price: Publish is disabled with "1 blocking item must be cleared first: USD price set (Stripe)". The schema says a null rail price means "not offered", and the seed ships NGN-only published cohorts, so staff cannot create an NGN-only cohort in the UI. Added USD 15.00 to proceed; published.
- ISSUE? (to verify as learner) Cohort readiness warns "The pinned publication has no completion rule — learners cannot be marked complete": a course authored in the UI may have no completion rule.
### Certificate template (user's IMG_0499.pdf)
- ISSUE (MEDIUM, product gap) "Upload existing design" accepts only PNG/JPEG. The supplied PDF is rejected ("Certificate template images must be a PNG or JPEG file", Continue disabled). Rejection itself is clean. Certificate designs commonly arrive as PDF; the user has to convert first. Converted the PDF to PNG (1240×1755) to continue.
- PASS  PNG accepted with live preview and "1240 × 1755 px, so a portrait page"; Continue opens the editor with the design as background and four fields (learner name, award title, issued at, verification ref) with sample values.
- NOTE  The supplied design is a filled-in example ("Laura Smithton", the Advanced Biometrics sentence are part of the artwork), so live fields overlap the printed text; a blank version is needed for real use.
- PASS  Properties panel: X/Y/width/height, field type, font size, colour, alignment. Saved as "UAT Gold Certificate".
- PASS  Course edit: certificate enabled, automatic issuance, template "UAT Gold Certificate", "must pass required assessments" -> Saved.
- PASS  Re-publish: dialog shows "completion rule changed" and lets staff tick running cohorts to migrate; with a reason -> "Published. 1 cohort(s) migrated.", version 2.

## 3. Learner (learner1 Chidi) — enrol, pay, ticket
- ISSUE (MEDIUM) A cohort that has already started cannot be found or bought online, even self-paced with its enrolment window open: the course page shows "No dates are scheduled yet" (upcoming = startsAt in the future), and the direct /enrol/[cohortId] link bounces back to the course page with no explanation. Worked around by moving the start to tomorrow.
- PASS  Signed-out "Pay in NGN" -> sign in -> order review for the cohort: NGN 20,000 + 1.5% (300) + est. processing 410.66 = 20,710.66; 30-min seat hold.
- PASS  Pay is disabled until both consents are ticked; with no provider keys -> ?payment=unavailable, "Nothing was charged… Your seat is still held".
- ISSUE (LOW, measured) The payment error renders at y=803 with a 562px viewport and scrollY=0: off-screen after the redirect.
- PASS  Support ticket with an attachment: PNG listed before submit, ticket KQT-20261003-402A7F68 created, attachment shown as "certificate-design.png (PNG, 389 KB)"; its download link redirects (authorised signed URL).

## Test accounts created (local lms_uat only; passwords kept out of the repo)
- support.agent@kqnexus.test (Support Agent, Global)
- uat3.newlearner@kqnexus.test (self-registered, unverified)

## 3b. Learner (learner1) — learn, quiz, completion, certificate
- PASS  Dashboard shows the new course, progress 0 of 2, next lesson, assessment due, ticket, certificate placeholder.
- PASS  Sequencing: opening the quiz lesson before lesson 1 -> "This lesson isn't available right now… locked until you finish an earlier lesson". NOTE: the dashboard "Assessment due" link points at that locked lesson.
- PASS  Lesson 1 Mark complete -> Completed + Undo; access works before the cohort start date.
- ISSUE (HIGH, = audit A-01, confirmed on a UI-authored course) The quiz lesson shows "Mark complete" beside "Start quiz" before any attempt (editor default allowManualComplete=true). Clicking it -> "2 of 2 required lessons complete" with no attempt. The certificate was NOT issued only because this course has "must pass required assessments" ticked, which is unticked by default; on a default course this skip completes the course.
- ISSUE (LOW) Submit dialog said "This is your last attempt" on attempt 1 of 2 (Remaining showed 1): attempt wording is off by one.
- ISSUE (MEDIUM) After submitting the passing (final) quiz the learner lands on "We can't find that page 404 — The course or programme may have been archived": the pass completes the enrolment (COMPLETED) and the lesson page serves ACTIVE enrolments only. Server-side all correct: attempt 1/1 passed, enrolment COMPLETED, certificate ACTIVE issued automatically.
- PASS  Dashboard afterwards: "Course complete", "Download certificate", verification reference shown.
- ISSUE (LOW) Dashboard Results panel says "No results yet" although the quiz was passed and released.
- ISSUE (HIGH, Docker image) Certificate download returns 404: PDF generation fails in the container ("[certificate-file] render/store failed … Error"). Cause: the Dockerfile runner stage copies .next, public, prisma, src but not `assets/`, so `assets/fonts/certificate/NotoSans-Regular.ttf` is missing (confirmed: /app/assets does not exist in the container). The same render succeeds from the host (asset 398,691 bytes -> PDF 713,099 bytes -> stored). Every certificate download fails on the Docker build; Netlify is covered by next.config.ts outputFileTracingIncludes.
- ISSUE (LOW) The failure log records only the error name ("Error"), never its message, so the cause cannot be diagnosed from logs.
- PASS  (after host-side render) The issued PDF uses the uploaded design as background with learner name, award title, issue date and verification reference.
- NOTE  With the supplied filled-in design the fields overlap the printed "Laura Smithton" text and the seal; needs a blank design and repositioned fields.
- NOTE  Paystack IS configured locally: checkout failed because Paystack rejects the seed accounts' `.test` email ("email must be a valid email"), not for missing keys.
- PASS  Download works once the file exists (redirect to a signed URL); public /verify shows the new certificate as valid.
- PASS  Results page for the completed enrolment: "1 / 1 (100%) Passed" with attempt history.
- ISSUE (MEDIUM) "My learning" lists the completed course with an "Open" link that 404s (/learn/[enrolment] serves ACTIVE only): a learner who finished cannot reopen the material and the offered link is dead.

### Emails and notifications (drain run by hand, stub)
- PASS  11 events drained, 0 poisoned, 0 failed. One email + one notification each for ticket.created, enrolment.activated, grade.released, certificate.issued (learner1); staff.ticket_new to admin and support agent only. email-verification sent for the new registration.
- NOTE  Registering with an already-registered email sends that address nothing (neutral on screen; the owner is not told someone tried).

### Admin — users, roles, sweep (earlier in the run)
- PASS  Manual confirmation of learner1's order (2030000 kobo, date, channel, reference, evidence, reason) -> Paid.
- NOTE  The role form creates a role with zero permissions when none are ticked (it warns "This role currently grants no access" but saves).
- PASS  Role edit: Permissions tab, tick tickets.view + tickets.manage, Save -> Version 2.
- PASS  Staff account created with a set temporary password (shown once, out-of-band note).
- PASS  Deactivate (reason required; "signed out of every active session… role assignments are kept") -> Deactivated; Reactivate -> Active.
- PASS  Admin sweep: 44 staff routes incl. /staff/licence and /staff/email-log load, no crash.

## 4. Support Agent (Sade)
- NOTE  First sign-in with the admin-set temporary password does not force a password change.
- PASS  Nav: Overview + Support; bell 1 unread (staff.ticket_new); Overview explains the role has no summary views.
- PASS  Ticket detail; attachment downloadable by the agent (authorised redirect).
- PASS  Assign to me -> Assigned; Change priority (Low/Normal/High/Urgent, optional reason) -> High; Escalate (target queue, optional owner, required reason) -> Escalated; Accept escalation; Reply with review step; internal note; Resolve (note required) -> "Ticket resolved." Chronology records each step with actor, time and reason.
- NOTE  Escalation offers a "Finance" queue, but the Finance/Operations role has no ticket permissions, so no Finance user could see a ticket routed there. Owner list shows only tickets.manage holders (Ada, Sade).
- PASS  Denied in plain words: licence, email log, audit, payments, cohorts, courses, users, roles, reconciliation, enrolments, programmes.
- ISSUE (MEDIUM, = audit A-04, still present) /staff/users/new and /staff/roles/new crash: "Something went wrong… Reference 2657342927".

## 5. Instructor (Ije)
- PASS  Nav: Overview, Cohorts, Enrolments, Reports, Courses. Overview "Needs attention": submission awaiting grading, attendance not marked.
- PASS  Grading: queue lists the ungraded submission; score 140 rejected ("whole-number score between 0 and 100"); Save draft 64 + feedback; Release -> "Released 64 / 100".
- NOTE  Release has no confirmation step.
- PASS  Attendance: past session saved (3 present / 1 absent / 1 late / 1 excused). Future session: Present/Absent/Late disabled with "You can only mark excused or not-recorded before the session starts."
- QUESTION  Attendance roster (6) includes learners whose enrolment is PENDING_PAYMENT (3 ACTIVE).
- PASS  Learner progress page shows quiz and assignment results (COH-07); no override buttons for this role.
- ISSUE (HIGH, = audit A-02, still present) /staff/payments is 403 for the Instructor, but /staff/reports/payments shows learner names, totals (NGN 390,300.00, 185,000.00…), fees and an Export CSV button.
- NOTE  Seed learner Bisi shows quiz Passed and assignment Passed but "Required lessons 4 of 10" (A-01 symptom in seed data).

## 3c. Learner (learner3 Tunde) — seeded programme SLP-2026-01
- PASS  4 lessons marked complete in sequence (text, video-without-upload fallback).
- ISSUE (HIGH, = audit A-01, confirmed on clean seed data) Quiz passed 2/2 (100%) on the first attempt; the quiz lesson has no Mark complete (seed allowManualComplete=false) and does not complete on pass: next lesson stays locked, progress stuck at 4 of 10. The learner cannot continue without a staff override.
- NOTE  Submit dialog on attempt 1 of 3 says "uses one of your 2 remaining attempts" (off by one, same as 3b).

## 6. Programme Manager (Pilar)
- PASS  Nav: Overview, Cohorts, Enrolments, Reports, Courses, Programmes, Certificates, Users.
- PASS  Lesson override for learner3's quiz lesson (reason required) -> 5 of 10; results panel shows "2 / 2 Passed, 1 used · 2 left".
- PASS  Enrolments: Approve pending enrolment ("with no payment recorded. The reason is audited") -> Active. Cancel pending enrolment ("The seat is released") -> done.
- NOTE  Transfer dialog says "No other cohort shares this offer yet" although another cohort of the same programme exists (it is in progress, so not a valid target); the message should say no open cohort is available.
- PASS  Denied: payments, reconciliation, audit, licence, email log, roles, support.
- ISSUE (HIGH, = A-02) /staff/reports/payments is open to the Programme Manager.

## 3d. Learner (learner3) — assignment
- PASS  Wrong type rejected: '"png" is not an accepted file type for this assignment (accepted: .pdf)'. PDF accepted: "Submitted — receipt …", history with name/size/time, "Submit new version". NOTE: the receipt is a raw database id.
- PASS  After drain: staff.submission_new to admin, pm, instructor (submissions.view holders); grade-released email + notification to learner5 (staff release) and learner3 (quiz); enrolment-confirmed then enrolment-cancelled to learner7; staff-ticket-escalated to the assignee; ticket-reply and ticket-resolved to learner1. 19 events, 0 failed.

## 7. Finance/Operations (Femi)
- PASS  Nav: Overview, Cohorts, Enrolments, Payments, Reconciliation, Reports, Users. Payments list with status tabs.
- PASS  Refund with "Revoke enrolment access" on an order whose learner holds a live certificate -> "ACTION NOT APPLIED — This learner still has a live certificate (CERT-…). Revoke it, or resolve its review, before withdrawing…"; order stays Paid, no refund row.
- PASS  Partial refund NGN 5,000 keeping access -> "Partially refunded", actor Femi Finance.
- ISSUE (MEDIUM, = audit A-12, confirmed on clean data) Reconciliation shows "No unresolved exceptions" while the seeded order ORD-SEED-0002 is in Exception (Payments tab "Exception 1", Overview "1 order in an exception state"); "Scoped totals" shows no figures.
- PASS  Export refunds CSV: options dialog; ticking Learner / Learner email reveals a required "Operational reason"; queued; worker processed (run by hand); Export History shows columns, as-of time, 2 rows, Succeeded, available 24 h; download redirects. Reason recorded on the job.
- ISSUE (MEDIUM, = audit A-05, still present) Finance sees 10 lesson-override buttons on a learner's progress page.
- ISSUE (= A-04) /staff/users/new crashes for Finance.

## 2b. Administrator — audit, certificates, reports, licence task
- PASS  Audit log lists every action of this session (40+ action types incl. authorization.denied ×37, lessonprogress.overridden, refund.recorded, course.cohorts_migrated, licence.diagnostic_downloaded) with actor filter. Export audit CSV dialog freezes the filters and withholds investigative values.
- NOTE  Audit action filter and rows use raw action codes; audit times are UTC while Export History uses Africa/Lagos.
- PASS  Certificates hub: awaiting-issuance queue (empty), recently issued with Automatic/Not recorded.
- ISSUE (MEDIUM, = audit A-08, still present) Flagged certificate: "Confirm it should remain active, or revoke it" but the only action is Revoke.
- PASS  Revoke (reason) -> Revoked with actor/time/reason; Reissue (reason) -> new certificate CERT-586C… "Supersedes CERT-410A…"; public /verify of the old reference shows revoked.
- NOTE  Staff certificate page has no preview/download of the PDF.
- ISSUE (MEDIUM, requirement gap) Reports: 5 of 10 dashboards say "Not available yet" — Progress, Submissions, Grades, Completion, Certificates — although phases 9–11 are built and RPT-01 is marked complete. Available: Registrations (4 rows), Payments (3), Enrolments (10), Attendance (2), Support (1).
- NOTE  Reports hub "Unresolved payment exceptions 0" while an order is in Exception (A-12).
- PASS  Licence check task run by hand: "[scheduled] licence check: state=UNLICENSED transitions=0 notices=0 skipped=0".

## 3e. Learner (learner5 Karim) — released grade, account
- PASS  Signs in with the correct password after the earlier lockout test (throttle blocks failed attempts only).
- PASS  Bell 1 unread: "Results released for Site hazard report" -> opens /learn/…/results with "64 / 100 (64%)" and the instructor's feedback.
- NOTE  Assignment result shows no pass/fail outcome; the submission-history score column shows "—".
- PASS  Account email change: wrong current password -> "That password wasn't right. Your email address was not changed"; correct password -> "Confirm your new email address — we've sent a verification link to …. Your current email stays active until you confirm it."
- NOTE  After the failed attempt the typed new email was cleared (same form-reset behaviour as the cohort editor).

## Not tested (and why)
- Real Paystack/Stripe payment: Paystack is configured but rejects the seed accounts' `.test` emails; I did not check whether the keys are test or live, so I did not try a realistic email.
- Email verification / reset / email-change links: tokens are hashed at rest and auth mail stores no params, so links cannot be recovered locally.
- A successful licence activation and restricted mode: no production-trusted key exists.
- Video watch tracking: seed lessons have no uploaded video.
- Real email rendering in mail clients (stub transport).
- Mobile widths / keyboard-only / screen reader passes.

## Environment left as
- App container: image 3cba85ae4e10 (develop 39423b0), DATABASE lms_uat, EMAIL_TRANSPORT=stub. The original `lms` database is untouched.
