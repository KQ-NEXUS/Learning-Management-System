---
status: diagnosed
phase: 11-certificates-completion-lifecycle
source: 11-01-SUMMARY.md, 11-02-SUMMARY.md, 11-03-SUMMARY.md, 11-04-SUMMARY.md, 11-05-SUMMARY.md, 11-06-SUMMARY.md, 11-07-SUMMARY.md, 11-08-SUMMARY.md, 11-09-SUMMARY.md, 11-10-SUMMARY.md, 11-11-SUMMARY.md, 11-12-SUMMARY.md, 11-13-SUMMARY.md, 11-14-SUMMARY.md, 11-15-SUMMARY.md, 11-16-SUMMARY.md
started: 2026-09-19T02:00:00Z
updated: 2026-09-19T02:50:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

Note: results marked `verified_by: playwright walkthrough` were observed by Claude driving a browser on 2026-09-19 against an isolated database (evidence in `11-16-evidence/`, detail in `11-16-SUMMARY.md`). They are not user-confirmed. The user may overturn any of them.

### 1. Cold Start Smoke Test
expected: From a fresh database, all migrations (including 20260916162101_certificates_issuance_mode_and_templates) apply, the seed completes (creating the default certificate template), and the app boots and serves pages with live data.
result: pass
verified_by: playwright walkthrough — fresh DB lms_phase11_uat: migrate deploy applied all migrations, seed completed with certificateTemplates 1, app served sign-in and all staff pages.

### 2. Build a certificate template with the editor
expected: At /staff/certificates/templates, "New template" opens a three-panel editor. Adding a border, an image and the four dynamic fields (learner name, award title, issued date, verification reference) shows them on the canvas with sample values; dragging repositions them; Save, then reloading, shows every element exactly where it was left.
result: pass
verified_by: playwright walkthrough — 6 elements placed; element boxes identical after full reload; stored layout matches.

### 3. Keyboard-only template editing
expected: Tab reaches every canvas element; Arrow moves 1pt, Shift+Arrow 10pt; Delete removes the focused element with no modal; each move is announced.
result: pass
verified_by: playwright walkthrough — live region announced "issued date moved to 112, 394"; Delete removed an element with no modal.

### 4. Upload and position a logo on the template
expected: Uploading an image to an Image element shows it on the canvas, and dragging it with the mouse moves it smoothly to where it is dropped.
result: issue
reported: "Upload works (presign, PUT, confirm). Dragging the uploaded logo is unreliable: a 100px drag moved 15px, because the canvas <img> is natively draggable and the browser's ghost-image drag cancels the pointer drag."
severity: minor
verified_by: playwright walkthrough

### 5. Set issuance mode and template when creating a Course
expected: On /staff/courses/new, the issuance-mode radios and template picker are disabled until "Certificate enabled" is checked, then offer Automatic/Manual and the template list; the chosen values persist on the new course.
result: pass
verified_by: playwright walkthrough — created "Walkthrough Template Course"; DB shows MANUAL and the chosen template id.

### 6. Change issuance mode and template on an existing Course
expected: An existing Course has an edit page where certificates, issuance mode and template can be changed and saved.
result: issue
reported: "There is no Course edit page. CourseForm only supports mode 'create' and no /staff/courses/[id]/edit route exists, so an existing course's issuance mode and template cannot be changed. (Programme has an edit mode; not exercised.)"
severity: major
verified_by: playwright walkthrough

### 7. Manual issuance queue
expected: Under MANUAL mode, a learner who completes the course appears at /staff/certificates. "Issue certificate" opens a reason-free confirmation; confirming removes the row, shows the empty state and a "Certificate issued for {name}" message, and the enrolment becomes Completed.
result: pass
verified_by: playwright walkthrough — Bisi Adewale issued; certificate ACTIVE, enrolment COMPLETED.

### 8. Automatic issuance on completion
expected: With a Course set to AUTOMATIC issuance, when a learner completes the last required lesson, a certificate is issued immediately with no staff action. The learner never appears in the manual queue, and a certificate exists for them at /staff/certificates/issued.
result: issue
reported: "it should be issued since its automatic , but it should also show on the staff side that the certi has been issued"
severity: minor
verified_by: playwright run for this test — course set to AUTOMATIC by DB, learner3 (Tunde Bello) completed both required lessons in the UI. Certificate CERT-6959139673C13BA62B0EF9B1C44D28C1 was created at 01:17:11 with audit certificate.issued_auto (actor SYSTEM), enrolment COMPLETED, never in the manual queue. Issuance itself PASSES. Staff visibility: it appears at /staff/certificates/issued as Active and its detail says "Issued ... by System (automatic issuance)", but the /staff/certificates landing page still says "Nothing awaiting issuance" with no sign of the new certificate, and the issued list has no automatic/manual indicator. Evidence: 11-16-evidence/uat-08-*.png

### 9. Programme certificate only after every required Course is complete
expected: For a Programme cohort, completing only some required Courses issues no Programme certificate. Once all required Courses (and Programme-level rules) are complete, exactly one Programme certificate is issued (or queued, in MANUAL mode) for the learner.
result: pass
verified_by: playwright run — Safety Leadership Programme set AUTOMATIC (DB), both member courses published and pinned. Tunde Bello (learner3) completed all 4 required lessons across both courses: NO certificate (attendance rule 0% of 75% unmet, correct). After staff marked Present for 3 of 4 sessions via the attendance UI (75%): exactly one PROGRAMME certificate CERT-546B9B94E66F552B625F184CCA6D3317 issued automatically (audit certificate.issued_auto, SYSTEM), enrolment COMPLETED, and zero COURSE-scope certificates for the two member courses (D-01). Fixture: three live sessions moved into the past by DB.

### 10. Learner finds and downloads their certificate
expected: After a certificate is issued, the learner's /dashboard still shows that course's card with a Certificate slot containing a "Download certificate" link and the verification reference.
result: issue
reported: "After issuance the Financial Controls card disappears from the learner dashboard entirely, taking the certificate slot and download link with it. The download route itself works when visited directly. The slot only reappears in revoked or flagged states."
severity: blocker
verified_by: playwright walkthrough

### 11. Downloaded PDF matches the template design
expected: The downloaded PDF is readable, contains the learner's real name, award, date and reference, and each element sits where it was placed in the template editor (same top-to-bottom order, logo undistorted).
result: issue
reported: "PDF is A4 landscape with correct text, but vertically mirrored relative to the editor: the logo designed at the top is at the bottom and the verification reference designed at the bottom is at the top. The logo is stretched into an ellipse where the editor showed a circle."
severity: major
verified_by: playwright walkthrough

### 12. Public verification page
expected: Signed out, /verify/{reference} shows "This certificate is valid." with exactly learner name, award title and issued date, with no sign-in prompt or catalogue nav. An unknown reference shows only "We couldn't find a certificate with this reference." with no other fields.
result: pass
verified_by: playwright walkthrough

### 13. Employer can reach the verification form from /verify
expected: Visiting the plain /verify path shows a form where a verification reference can be typed.
result: issue
reported: "Bare /verify is the email-verification page ('This link is no longer valid… Resend verification email'), so there is no place to type a reference until you already have a /verify/{reference} URL. Route collision found in plan 11-06."
severity: minor
verified_by: playwright walkthrough

### 14. Long names and references wrap cleanly
expected: With a very long learner name (81 chars) and award title (116 chars), the verify page, issued list and detail page show no horizontal scrollbar at desktop and 390px mobile widths, and the reference wraps.
result: pass
verified_by: playwright walkthrough — scrollWidth == clientWidth on all three pages at 1280 and 390.

### 15. Revoking a certificate
expected: Revoking requires a reason of at least 10 characters. Afterwards the public page says the certificate is revoked without showing the reason, the learner's dashboard offers no download, and the enrolment returns to Active.
result: pass
verified_by: playwright walkthrough

### 16. Reissuing a certificate
expected: Reissue creates a certificate with a different reference; the old and new detail pages link to each other; the old reference verifies as revoked and the new one as valid.
result: pass
verified_by: playwright walkthrough

### 17. Grade correction flags the certificate
expected: Overriding a released grade for a learner with an active certificate marks it "Flagged for review" in the issued list and on its detail page, the learner sees reassuring copy and can still download, and no "Clear flag" control exists anywhere.
result: pass
verified_by: playwright walkthrough — grade 80 to 55; reviewFlaggedAt set; learner slot showed "under review" with download link.

### 18. Attendance or completion correction also flags the certificate
expected: Correcting an attendance record (or otherwise re-evaluating completion) for a learner holding an active certificate flags that certificate for review in the same way as a grade correction, without deleting or revoking it.
result: pass
verified_by: playwright run — attendance correction (Present to Absent on Live session 3, reason required, recorded as attendance.changed by the staff user) dropped Tunde to 50%; the Programme certificate got reviewFlaggedAt, stayed ACTIVE (not revoked, not deleted), enrolment reverted to ACTIVE, and the issued list shows "Flagged for review". Minor finding recorded in Gaps: three duplicate SYSTEM flag audit entries for one correction.

### 19. Dashboard copy reflects that certificates are live
expected: The dashboard's "Next up" card for a completed course no longer refers to certificates as something that will ship in the future.
result: issue
reported: "Card still reads 'You've completed everything required here — your certificate slot below will reflect this once certificates ship.' Stale Phase 9 copy (src/components/learner/NextUpCard.tsx:62)."
severity: minor
verified_by: playwright walkthrough

### 20. Template editor stays responsive with many elements
expected: With about 20 elements on a template, keyboard nudges and inspector edits show no noticeable input lag.
result: pass
verified_by: playwright walkthrough — 50 nudges averaged 13 ms, 10 inspector edits 15 ms, worst Event Timing sample 48 ms (inferred, not human-perceived).

## Summary

total: 20
passed: 13
issues: 7
pending: 0
skipped: 0
blocked: 0

## Gaps

<!-- Root causes below were established by direct code inspection during the 11-16 walkthrough; no debug agents were needed for these. -->
- truth: "After a certificate is issued, the learner's dashboard still shows that course's Certificate slot with a Download link"
  status: resolved
  resolved_by: "11-17 + 11-18"
  reverified: "Dashboard as Tunde Bello shows the Financial Controls card for a COMPLETED enrolment with Download certificate link and reference (reverify-10-dashboard-completed-card.png)"
  reason: "User reported: After issuance the Financial Controls card disappears from the learner dashboard entirely, taking the certificate slot and download link with it."
  severity: blocker
  test: 10
  root_cause: "listOwnActiveEnrolments filters status ACTIVE, but issuance moves the enrolment to COMPLETED (D-05), so the dashboard card that hosts CertificateSlot is never rendered for an ACTIVE certificate. Unit tests used ACTIVE enrolment fixtures and missed it. A second ACTIVE-only filter at learner-access.ts:460 also affects lesson access for completed enrolments; whether COMPLETED enrolments keep lesson access is a Phase 9 decision the fix must settle."
  artifacts:
    - path: "src/server/services/learner-access.ts"
      issue: "listOwnActiveEnrolments (line ~429) and related check (line ~460) filter status: ACTIVE only"
    - path: "src/server/services/enrolment-dashboard-service.ts"
      issue: "Dashboard cards built only from ACTIVE enrolments, so CertificateColumn never renders for COMPLETED"
  missing:
    - "Include COMPLETED enrolments (at least when they hold a certificate) in the learner dashboard listing"
    - "Decide and test lesson-access behaviour for COMPLETED enrolments"
    - "Regression test using a COMPLETED enrolment with an ACTIVE certificate"
  debug_session: "diagnosed in 11-16 walkthrough (direct inspection); evidence 11-16-evidence/04-learner-dashboard-no-card-after-issue.png"

- truth: "Each element in the downloaded PDF sits where it was placed in the editor, and images are not distorted"
  status: resolved
  resolved_by: "11-19"
  reverified: "Reissued certificate PDF: logo at top and round, name/award below, date lower-left, reference bottom-right, matching the editor layout (reverify-11-reissued-pdf-layout.png). Certificates issued BEFORE the fix keep their old mirrored PDF."
  reason: "User reported: PDF is vertically mirrored relative to the editor and the logo is stretched into an ellipse."
  severity: major
  test: 11
  root_cause: "certificate-pdf-renderer.ts passes element.y directly to pdf-lib drawText/drawImage. The editor's y is top-origin; pdf-lib's origin is bottom-left, so every element is mirrored vertically. drawImage also stretches to width x height while the editor preview uses object-contain. Renderer tests assert text presence only, not position."
  artifacts:
    - path: "src/server/services/certificate-pdf-renderer.ts"
      issue: "Line ~103 drawText y: element.y and line ~125 drawImage y: element.y lack the top-origin conversion (pageHeight - y - height for images, pageHeight - y - fontSize-ish for text baseline); drawImage does not preserve aspect ratio"
  missing:
    - "Convert top-origin layout y to pdf-lib bottom-origin for text and images"
    - "Fit images inside their box preserving aspect ratio (match the editor's object-contain)"
    - "Position-asserting renderer test (e.g. read back positions from the PDF content stream) using the golden layout fixture"
  debug_session: "diagnosed in 11-16 walkthrough (direct inspection); evidence 11-16-evidence/06-downloaded-pdf-rendered.png"

- truth: "An existing Course has an edit page where certificates, issuance mode and template can be changed"
  status: resolved
  resolved_by: "11-20"
  reverified: "/staff/courses/[id]/edit loads prefilled; switching Automatic to Manual and saving shows Saved., persists MANUAL, audit course.updated by USER"
  reason: "User reported: There is no Course edit page; CourseForm only supports create."
  severity: major
  test: 6
  root_cause: "CourseForm is typed mode: 'create' only and is used solely by /staff/courses/new. No /staff/courses/[id]/edit route and no updateCourseAction exist, although plan 11-08's stated purpose was the edit forms. Programme has an edit mode (updateProgrammeAction)."
  artifacts:
    - path: "src/app/staff/courses/CourseForm.tsx"
      issue: "mode: 'create' only"
    - path: "src/app/staff/courses/actions.ts"
      issue: "Only createCourseAction exported"
  missing:
    - "Course edit route and form (edit mode) reusing CertificateSettingsFields"
    - "updateCourseAction with the same .strict() schema, template selectability guard and audit"
    - "Confirm the Programme edit path's certificate settings in a browser"
  debug_session: "diagnosed in 11-16 walkthrough (direct inspection)"

- truth: "Dragging an uploaded logo on the template canvas moves it smoothly to the drop position"
  status: resolved
  resolved_by: "11-21"
  reverified: "Logo drag in the template editor moved 150px of 150px requested (was 15px of 100px)"
  reason: "User reported: Dragging the uploaded logo is unreliable (100px drag moved 15px)."
  severity: minor
  test: 4
  root_cause: "The canvas renders the uploaded image as a plain <img> (draggable true, pointer-events auto, user-select auto), so mousedown+move starts the browser's native image drag, which cancels the editor's pointer-event drag."
  artifacts:
    - path: "src/app/staff/certificates/templates/TemplateCanvas.tsx"
      issue: "<img ... className='h-full w-full object-contain'> (line ~350) lacks draggable={false} / pointer-events-none and the element box lacks select-none / touch-action none"
  missing:
    - "Set draggable={false} and pointer-events-none on the preview image; select-none and touch-none on element boxes"
    - "Component test that a pointer drag over an image element moves it"
  debug_session: "diagnosed in 11-16 walkthrough (DOM inspection: draggable=true, pointer-events=auto)"

- truth: "Visiting the plain /verify path offers a form to enter a verification reference"
  status: resolved
  resolved_by: "11-21"
  reverified: "/verify-certificate shows the reference form; submitting routes to /verify/{ref} and shows valid; bare /verify unchanged"
  reason: "User reported: Bare /verify is the email-verification page, so an employer cannot type a reference there."
  severity: minor
  test: 13
  root_cause: "src/app/(auth)/verify/page.tsx already owns /verify for IAM-02 email verification (links already sent in transactional emails). Plan 11-06 therefore dropped the bare landing page rather than colliding; only /verify/[verificationRef] exists."
  artifacts:
    - path: "src/app/(auth)/verify/page.tsx"
      issue: "Owns /verify"
    - path: "src/app/verify/VerifyReferenceForm.tsx"
      issue: "Only reachable from an existing /verify/{reference} page"
  missing:
    - "A separate public entry path (e.g. /verify-certificate) hosting the reference form, or a reference-entry section on the email-verification fallback"
  debug_session: "diagnosed in 11-16 walkthrough; known deviation recorded in 11-06-SUMMARY.md"

- truth: "The dashboard 'Next up' card for a completed course no longer refers to certificates shipping in the future"
  status: resolved
  resolved_by: "11-18"
  reverified: "Next-up card now reads: Your certificate, if this course issues one, is shown in the Certificate section below."
  reason: "User reported: Card still says 'your certificate slot below will reflect this once certificates ship.'"
  severity: minor
  test: 19
  root_cause: "Phase 9 placeholder copy in NextUpCard was not updated when Phase 11 shipped CertificateSlot."
  artifacts:
    - path: "src/components/learner/NextUpCard.tsx"
      issue: "Line ~62 stale copy"
  missing:
    - "Update copy to reflect live certificate states (and keep the related component test in step)"
  debug_session: "diagnosed in 11-16 walkthrough (grep)"

- truth: "When a certificate is issued automatically, staff can see that it has been issued (not only by opening All certificates)"
  status: resolved
  resolved_by: "11-22 + 11-23"
  reverified: "Landing page shows a Recently issued section with Automatic pills; All certificates has an Issued by column and All/Automatic/Staff filter"
  reason: "User reported: it should be issued since its automatic , but it should also show on the staff side that the certi has been issued"
  severity: minor
  test: 8
  root_cause: "The Certificates nav item lands on the pending-issuance queue, which only lists MANUAL-mode eligibles and shows "Nothing awaiting issuance" once empty. Automatic issuances never surface there. The issued list has no issuance-mode or issued-by column, so an automatic issue looks the same as a manual one; only the detail page says "System (automatic issuance)"."
  artifacts:
    - path: "src/app/staff/certificates/page.tsx"
      issue: "Landing shows pending queue only; empty-state copy says certificates appear "under manual issuance""
    - path: "src/app/staff/certificates/issued/IssuedCertificatesTable.tsx"
      issue: "No Issued-by / issuance-mode indicator; issuer only resolved on the detail page (getCertificateIssuer)"
  missing:
    - "Surface recent issuances on the Certificates landing (e.g. a Recently issued section or count) so automatic issues are visible"
    - "Show issuance source (Automatic / staff name) in the issued list, or a filter for it"
    - "Consider a staff-visible notice or audit entry link when an automatic issuance happens"
  debug_session: "diagnosed by direct observation during UAT test 8; evidence 11-16-evidence/uat-08-*.png"

- truth: "One attendance/completion correction produces one attributable flag entry on the affected certificate"
  status: resolved
  resolved_by: "11-24"
  reverified: "Fix covered by unit tests (three superseded results give one flag audit row); not re-run in the browser"
  reason: "Observed in test 18 (function passes): a single attendance correction on a Programme cohort wrote three certificate.review_flagged audit events ~50 ms apart, all actor SYSTEM, reason "completion superseded"."
  severity: minor
  test: 18
  root_cause: "reactToCompletionResults (certificate-issuance-service.ts ~lines 619-668) flags on every result with action superseded. On a Programme cohort one correction supersedes two COURSE-scope records and the PROGRAMME record, so flagCertificateForReview (keyed on the enrolment) runs three times. The created branch skips COURSE results on Programme cohorts (D-01) but the superseded branch has no equivalent guard. The actor is always SYSTEM, unlike the grade-override path (11-10) which passes the staff actorId."
  artifacts:
    - path: "src/server/services/certificate-issuance-service.ts"
      issue: "superseded branch lacks the D-01 Programme-cohort COURSE-scope skip and carries no staff actor"
  missing:
    - "Skip COURSE-scope superseded results on Programme cohorts, or de-duplicate flag writes per enrolment per transaction"
    - "Pass the correcting staff member as actor where the trigger has one (attendance correction)"
    - "Test asserting exactly one flag audit entry per correction on a Programme cohort"
  debug_session: "diagnosed by direct observation and code read during UAT test 18"

- truth: "A learner whose certificate is flagged after an attendance/completion correction still sees the certificate slot and can download it"
  status: failed
  reason: "Found while re-verifying test 10: on a Programme card whose completion was superseded by an attendance correction, the Certificate slot shows the deferred "arriving in a future update" copy although an ACTIVE, flagged Programme certificate exists."
  severity: major
  test: 17
  root_cause: "deriveCertificateColumn (enrolment-dashboard-service.ts ~L461) returns not-complete whenever there is no active CompletionRecord, before it looks at the certificate. An attendance or completion correction supersedes the completion record, so the learner loses the slot and the download. The grade-override case (test 17) passed only because it does not supersede completion."
  artifacts:
    - path: "src/server/services/enrolment-dashboard-service.ts"
      issue: "deriveCertificateColumn checks hasCompletionRecord before certificate"
  missing:
    - "Check for an existing certificate first (flagged/revoked/active), and only fall back to not-complete / pending-issuance when none exists"
    - "Regression test: superseded completion record plus ACTIVE flagged certificate renders the flagged branch with a download link"
  debug_session: "found by browser re-verification 2026-09-19; evidence: Tunde Bello Programme card"

- truth: "Certificate rendering and issuance are robust for real-world data"
  status: failed
  reason: "Code review 11-REVIEW.md: 6 critical and 10 warning findings. CR-01 is empirically confirmed: the PDF renderer throws for names outside WinAnsi (Yoruba ọ ṣ ẹ, Ł, CJK) and the render runs inside the learner lesson-progress / attendance transaction, so a learner with such a name could not complete their last lesson in an AUTOMATIC course."
  severity: blocker
  test: 11
  root_cause: "See .planning/phases/11-certificates-completion-lifecycle/11-REVIEW.md (CR-01..CR-06, WR-01..WR-10)"
  artifacts:
    - path: "src/server/services/certificate-pdf-renderer.ts"
      issue: "Helvetica-only (WinAnsi) embedding; approved fontkit not used; render not guarded and inside the caller transaction"
  missing:
    - "Plan a second gap-closure pass from 11-REVIEW.md, starting with CR-01 (Unicode-capable font), CR-03 (assertTransition on non-ACTIVE enrolments), CR-04/05/06"
  debug_session: "11-REVIEW.md; CR-01 reproduced with tsx against renderCertificatePdf"
