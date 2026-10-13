# UAT round 1 — full-role UAT, 2026-09-30 (pre-merge build ed314d4, local Docker stack)

> Raw test log, kept as written during the run. Where it differs from `PRODUCT-AUDIT.md`, the audit is authoritative: the pass-mark item was refined to A-07 (publishing is gated; editing a published quiz is not), the rejected-PDF item was traced to stale seed data (A-03; the editor only accepts known file types), and the "Loading ticket" hang was withdrawn as a test-harness artefact.

Legend: PASS / NOTE (minor UX/data) / ISSUE (defect) / BLOCKED

## Environment
- ENV   Local Docker DB was seeded before 3d90269 (20 Sep): no Course/ProgrammePublication rows, cohorts unpinned, 3 of 4 catalogue items publiclyListed=false. Every enrolled learner saw "content not yet available". Re-ran the idempotent seed against 127.0.0.1:5433 only; pins, listings and demo certificates now exist. Items below marked (stale-db) were caused by this.
- ENV   No scheduler in the Docker stack: seat holds / pending orders never expire locally (learner7 hold from 27 Sep still PENDING).

## Visitor
- PASS  / redirects to /courses; 1 course listed (FCM). Course detail shows modules, format, NGN+USD price, seats left, two pay rails.
- NOTE  Programmes page empty and 2 of 3 courses hidden: seed has publiclyListed=false for SLP programme + 2 courses. Correct per PUBLIC_VISIBILITY_WHERE; seed choice, not a bug.
- NOTE  Page <title> suffix is "Training Administration" while header brand is "KQ Nexus"; checkout page title is just "Training Administration".
- PASS  Signed-out "Pay in NGN" -> /signin -> after sign-in lands on the order review for that cohort (intent preserved).

## Learner (learner3 Tunde Bello)
- PASS  Checkout review: fee breakdown (school 125,000 + 1.5% platform 1,875 + est. processing 2,000 = 128,875), 30-min seat hold countdown.
- NOTE  Pay disabled until Terms + Refund boxes ticked, but no text explains why it's disabled.
- NOTE  Seed cohort FCM-2026-02 is titled "... — February 2026" but runs 4–31 Oct 2026.
- PASS  Pay with no Paystack keys -> ?payment=unavailable, "Nothing was charged", seat still held.
- NOTE  After redirect the page is at the top; the error alert is below the fold beside the Pay button (not focused/scrolled).
- NOTE  Error copy says provider "didn't accept — try again in a moment"; when a rail is unconfigured, retry can't succeed.
- NOTE  Dashboard shows "not enrolled" with no mention of the learner's open order / held seat; no orders list page to return to it.
- PASS  Account: phone + marketing opt-in save and persist across reload.
- PASS  Support: empty submit -> summary + per-field errors; ticket KQT-20260930-0C65596A created (Payment/order, New).
- NOTE  Learner support timestamps render in UTC; staff pages use Africa/Lagos.
- NOTE  Header nav differs between public/checkout shell (Dashboard, Courses, Account) and learner shell (Dashboard, My learning, Support, Catalogue, Account).
- PASS  Sign out -> protected /dashboard redirects to /signin.

## Learner (learner2 Amara, SLP-2026-03 programme)
- PASS  Dashboard: greeting, next session, assessments/results/certificate panels.
- ISSUE? Cohort SLP-2026-03 startsAt 3 Nov but has live sessions 2 Oct and 9 Oct (before start). Seed data or missing session-date validation — check as staff.
- (stale-db) "This course's content is not yet available" — fixed by reseed.
- PASS  Programme path: 2 courses, 10 required lessons, sequential locks.
- NOTE  Lock hint always "Complete 'Lesson 1.1'…"; both courses have a "Lesson 1.1", ambiguous in course 2.
- PASS  Text lesson Mark complete -> Completed + Undo, next unlocks. Video lesson w/o upload falls back to Mark complete (seed has no video; 90% auto-complete not browser-testable here).
- PASS  Quiz: start consumes an attempt (3->2); confirm dialog before submit; attempt history; per-question feedback.
- NOTE  Quiz title rendered twice; "Pass mark 70" shows no unit; submit dialog says "uses one of your 2 remaining" though start already counted it (counts themselves are correct).
- NOTE  "Correct answers shown once attempts used" but per-question Correct/Not correct is shown, which reveals True/False answers.
- ISSUE Quiz scored 2/2 (100%) but "Not yet passed", next lesson stays locked. Cause: pre-20-Sep seed wrote passMark=70 (marks, not %) with totalMarks=2; 3d90269 fixed the seed to 2 but the seed skips an existing quiz, so old DBs (possibly Neon/deployed) keep an unpassable quiz.
- ISSUE A PUBLISHED quiz can have passMark > totalMarks; readiness treats that as FAIL but nothing prevents it being live.

- ISSUE Past session ("Live session 1", 25 Sep) still shows a "Join session" link to the meeting URL.
- NOTE  Three date formats across learner pages: "2026-10-02 10:00 (Africa/Lagos)", "Fri 2 Oct", "30/09/2026".
- ISSUE? Results page mirrors the quiz defect (2/2 "Not yet passed").

## Learner (learner1 Chidi) / certificates
- (stale-db) learner1 holds ACTIVE CERT-SEED-0002 but its enrolment is WITHDRAWN (old DB enrolments not updated by the upsert seed) -> dashboard shows nothing, no download.
- QUESTION Should an ACTIVE certificate stay reachable to the learner after the enrolment is withdrawn/transferred?
- PASS  Public /verify: valid (CERT-SEED-0002), revoked (0003, details kept + clear revoked banner), unknown ref -> not found. Minimal disclosure note shown.

## Administrator (Ada)
- PASS  Staff overview: metrics, Needs attention (overdue attendance, flagged cert, payment exception), next sessions, capacity.
- ISSUE? Next sessions lists "Site walk-through · SLP-2026-01" although SLP-2026-01 is CANCELLED.
- NOTE  "Learners in delivery 0" beside "1 cohort running". FCM seats: staff "0 of 40 taken" vs public "39 seats left" (holds counted publicly only).
- NOTE  Staff lists show raw status codes (PUBLISHED) — courses, assessments.
- PASS  Assessment editor: readiness flagged "Pass mark 70 exceeds total marks 2" (blocking); set pass mark 2 + instructions, Saved, 0 blocking; Publish -> version 2.
- ISSUE Readiness numbers questions "Question 2/3" while editor shows Question 1/2 (off by one).
- NOTE  Editor header shows raw id; readiness rows "Not yet checked — a later phase"; archive copy cites "(CAT-08)" — dev language in product UI.
- NOTE  Pass-mark rule only "blocks public listing", so an unpassable quiz can be live.
- PASS  Roles: new role "Support Agent" with tickets.view + tickets.manage created (6 roles).
- NOTE  Permission picker shows raw codes (tickets.view) with no plain description; groups collapsed by default.
- PASS  Users: staff account Sade Support (support.agent@kqnexus.test) created with Support Agent/Global; temp password shown once with out-of-band note.
- NOTE  Staff-account role list includes "Learner".
- PASS  Payments list: status tabs with counts, provider filter.
- ISSUE FCM-2026-02 priceUsdMinor=486 ($4.86 for a NGN 125,000 course) — entered via staff UI (seed doesn't set it); an older Stripe order charged $261.64. No sanity check on USD vs NGN price.
- PASS  Manual confirmation: wrong amount rejected ("Action not applied"), correct amount -> order Paid, provider Manual, total 126,875; duplicate-payment guard text shown.
- ISSUE Manual confirmation amount is entered in minor units (kobo); error message shows internal order id and minor units; expected amount (126,875 = base + platform, no gateway estimate) differs from the "Total charged 128,875" shown on the same page, with no explanation.
- NOTE  Confirm button disabled while Date empty, but Date not marked required and no reason shown. Same pattern: refund over the limit just disables the button.
- PASS  Refund: limit shown; NGN 10,000 partial refund recorded (keep access) -> "Partially refunded", actor + date.
- NOTE  Refund reference shows a raw database id.
- (stale-db) Overview "cancelled SLP-2026-01 in Next sessions": after reseed SLP-2026-01 is IN_PROGRESS; not an issue.
- NOTE  SLP-2026-03 sessions all before its 3 Nov start: cohort readiness flags it as a Warning (not blocking). Seed data; guard exists.
- ISSUE Cohort "Add instructor" takes a raw user id (no picker).
- NOTE  Cohort USD price missing -> readiness "blocks public listing".
- QUESTION Attendance roster includes Segun Alade whose enrolment is PENDING_PAYMENT.
- PASS  Attendance: marked Present/Absent, counters update; edit within 168h needs no reason (by design); Present/Late blocked before a session starts (by design).
- NOTE  No "Saved" confirmation after Save attendance (counters change only).
- ISSUE Flagged certificate page says "Confirm it should remain active, or revoke it" but offers only Revoke; no way to clear the flag.
- NOTE  Certificates list "Issued by: Not recorded" vs detail "System (automatic issuance)".
- PASS  Revoke certificate: reason required, actor/time/reason shown, public status changes. Reissue correctly refused ("learner no longer meets the completion rules").
- PASS  Admin route sweep: 59 staff routes load (no error pages); unknown staff URL 404.
- PASS  App refuses to render in an iframe (frame-ancestors / X-Frame-Options).
- NOTE  Reconciliation shows "No unresolved exceptions" while Overview says "1 order in an exception state"; Overview Review link goes to unfiltered /staff/payments.
- NOTE  Streamed staff pages return HTTP 200 even when they render the 404/denied state.

## Support Agent (Sade, custom role: tickets.view + tickets.manage)
- PASS  Nav shows only Overview + Support; Overview explains the role has no summary views.
- PASS  Denied (403 panel or not-found parity) on audit, cohorts, courses, enrolments, payments, reconciliation, roles, users, report datasets, certificate pages, course/assessment editors.
- ISSUE /staff/users/new and /staff/roles/new CRASH ("Something went wrong", digest 2657342927) for a role without users.manage/roles.manage: the denied branch renders <ResourceForm onSubmit={() => {}}> from a Server Component ("Event handlers cannot be passed to Client Component props"). src/app/staff/users/new/page.tsx:22-26, src/app/staff/roles/new/page.tsx:~33-37.
- ISSUE /staff/reports renders the Reports hub with "Could not load this report" + dataset list instead of a clean denial.
- NOTE  /staff/reports/exports opens (Export History) — check it is owner-scoped.
- NOTE  Header says "Admin workspace" for a Support Agent; "Data as of" in UTC while header shows Africa/Lagos.
- ISSUE? Ticket page hung on "Loading ticket" >23 s on first client navigation; reload loaded it (intermittent).
- PASS  Ticket: Assign to me -> Assigned; Reply with review step (recipient + message) -> in chronology; internal note saved; Resolve requires a note -> Resolved.
- WITHDRAWN "Loading ticket" hang: tab was document.visibilityState=hidden (Chrome background-tab throttling in the test harness), not an app bug.

## Learner cross-checks after staff actions
- PASS  learner3 ticket view: staff reply visible (signed "Support"), internal note hidden, Close/Reopen + auto-close date (7 Oct).
- PASS  END-TO-END: failed online pay -> ticket -> staff manual confirmation -> learner3 dashboard shows FCM course, next lesson, sessions; ticket Resolved.
- PASS  learner2 sees republished quiz v2 (instructions + pass mark 2); last attempt: "This is your last attempt" dialog, 2/2 Passed, correct answers revealed after final attempt.
- NOTE  Earlier v1 attempts stay "Not yet passed" (not re-scored on republish) — defensible, but staff have no quick way to see why.
- NOTE  Attempt history order 2, 1, 3.
- ISSUE (MAJOR) Passing a quiz does not complete its lesson. Only lessonProgress sources are MANUAL / AUTO_VIDEO / STAFF_OVERRIDE. Seed quiz/assignment lessons have allowManualComplete=false -> after passing, "Site hazard report" and everything after stays locked forever unless staff override. The editor default is allowManualComplete=true (LessonFormFields.tsx:279) -> a quiz lesson would show "Mark complete" and can be skipped without passing. Either way assessment lessons are not tied to pass/submit.

## Instructor (Ije)
- PASS  Nav: Overview, Cohorts, Enrolments, Reports, Courses. Denied: audit, payments (+detail), reconciliation, roles, support, users, programmes.
- ISSUE /staff/users/new crashes for Instructor too (same onSubmit bug).
- NOTE  Learner progress page shows "Lesson override" heading + explanation but no buttons for a role that can't override; say so instead.
- NOTE  Staff progress page shows quiz "Passed" next to its lesson "Not completed" (symptom of the major quiz-lesson gap).
- PASS  Grading queue + submission detail (file, score 78/100, feedback, certificate-impact warning).
- NOTE  Seeded submission file key submissions/seed/site-hazard-report-*.pdf does not exist in MinIO; Download redirects to a missing object (raw storage error). Seed data, but the route doesn't check existence.
- PASS  Grade override on a released grade: reason required; 150/100 rejected; 78 -> 82 stored in GradeOverride with previous/new/reason/actor.

## Programme Manager (Pilar)
- PASS  Nav: Overview, Cohorts, Enrolments, Reports, Courses, Programmes, Certificates, Users. Denied: payments, reconciliation ("You do not have access to perform this action."), audit.
- PASS  Lesson override: reason required (dialog cites "(D-14)"), Hazard identification check -> "Staff override", learner 4 -> 5 of 10.
- PASS  No privilege escalation: Users list view-only; /staff/users/new not usable.
- ISSUE /staff/users/new crashes for PM too.
- NOTE  Users list links to /staff/users/[id], which 404s for PM (dead links).
- ISSUE (SECURITY/AUTHZ) Payments report (and CSV export) requires only reports.view (src/server/services/report-registry.ts:134), not payments.view. PM and Instructor are 403'd on /staff/payments but see row-level payment data in /staff/reports/payments: learner names, totals, gateway fees, school settlement, KQ NEXUS gross/net, refunds. Conflicts with RPT-02. Only the reconciliation-refunds export (line 271) checks payments.view.

## Finance/Operations (Femi)
- PASS  Nav: Overview, Cohorts, Enrolments, Payments, Reconciliation, Reports, Users. Payment detail offers Record a refund; Reconciliation + Export refunds CSV.
- PASS  Denied: courses (403), certificates (not-found parity).
- ISSUE /staff/users/new crashes for Finance too.
- ISSUE (AUTHZ) Finance can mark lessons complete on a learner's progress page (10 override buttons). Override is gated by enrolments.manage only (lesson-progress-service.ts:~701-710), which Finance holds for enrolment processes -> a finance user can change learning completion (and so certificate eligibility).

## Visitor (after reseed) / identity
- PASS  Catalogue: 3 courses + Safety Leadership Programme listed; programme page shows member courses, cohort, 24 seats, NGN rail only.
- NOTE  Cohort readiness says missing USD price "blocks public listing", yet the cohort is publicly listed (NGN only) — wording misleading.
- NOTE  Member courses show "No dates scheduled —" with no hint they're sold via the programme.
- PASS  Register with an existing email -> same neutral "Check your email" (no enumeration).
- PASS  Password < 10 chars rejected with inline message.
- PASS  New registration (uat.newlearner@kqnexus.test) -> "Check your email".
- NOTE  Unverified sign-in says "Those details do not match an account." — enumeration-safe but misleading, no resend hint.
- ENV   No email provider locally and verification links aren't logged, so a new account can't be verified on this stack (email is phase 13).
- PASS  Forgot password: [not recorded here] response for real and unknown email.
- PASS  Brute force: after 5 failures "Too many sign-in attempts from this device. Wait 15 minutes…"; other accounts on the same device unaffected.

## Learner assignment (learner2)
- PASS  After staff override, 2.4 Site hazard report unlocked; brief, due date, limits, file picker.
- NOTE  "Accepted file types" shows raw MIME "application/pdf".
- ISSUE (stale-db, RISK) Valid PDF rejected: '"pdf" is not an accepted file type (accepted: application/pdf)'. submission-service compares extensions; pre-20-Sep seed stored "application/pdf" (0d8b501), current seed ".pdf" but skips existing assessments. Any DB seeded before 20 Sep (possibly Neon/deployed) rejects all PDF submissions. Readiness doesn't validate allowedFileTypes entries.
- BLOCKED Learner submission -> instructor grade -> release -> learner result, not reachable without fixing the assessment's file types.

## Test accounts created during UAT (local only; passwords kept out of the repo)
- support.agent@kqnexus.test (Support Agent, Global) password: [not recorded here]
- uat.newlearner@kqnexus.test (self-registered learner) password: [not recorded here]
