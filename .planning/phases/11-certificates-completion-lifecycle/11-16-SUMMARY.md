---
phase: 11-certificates-completion-lifecycle
plan: 16
subsystem: testing
tags: [integration-tests, testcontainers, invariants, playwright, uat, certificates]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "Plans 11-01..11-15 (schema, issuance, PDF renderer, staff/learner/public surfaces)"
provides:
  - "Real-Postgres/MinIO integration suites for the duplicate-issuance race and the presigned download round trip (both executed, green)"
  - "Seven executable phase invariants (tests/certificate-phase-invariants.test.ts)"
  - "Reconciled 11-VALIDATION.md and ROADMAP.md (16/16 plans, phase still In Progress)"
  - "A recorded, browser-driven ten-step walkthrough with six gaps for /gsd:verify-work"
affects: [verify-work, 11-gap-closure]

key-files:
  created:
    - tests/certificate-download.integration.test.ts
    - tests/certificate-concurrency.integration.test.ts
    - tests/certificate-phase-invariants.test.ts
    - .planning/phases/11-certificates-completion-lifecycle/11-16-evidence/
  modified:
    - src/server/services/certificate-issuance-service.ts
    - .planning/phases/11-certificates-completion-lifecycle/11-VALIDATION.md
    - .planning/ROADMAP.md

key-decisions:
  - "Issue certificates with createMany({ skipDuplicates: true }) (INSERT ... ON CONFLICT DO NOTHING): a P2002 caught inside a Postgres transaction leaves the transaction aborted (25P02), so try/catch-on-unique-violation cannot work inside the caller's transaction"
  - "Walkthrough run against an isolated local Docker database (lms_phase11_uat), never the Neon database in .env"
  - "Failures found in the walkthrough are recorded as gaps, not fixed inside this plan (plan 11-16 Task 3 rule)"

requirements-completed: []
requirements-reopen: [CRD-03]
requirements-not-browser-verified: [CRD-02]

duration: multi-session
completed: 2026-09-19
---

# Phase 11 Plan 16: Real-infrastructure proof, invariants and browser walkthrough

**The duplicate-issuance race is proven closed against real Postgres (and a real bug was fixed to get there), and a browser-driven walkthrough passed 7 of 10 steps but found six gaps, two of which break CRD-03 for real users.**

## Task Commits

1. **Task 1: Integration suites** - `afd2932` (test), `e28a9d0` (fix found by running them)
2. **Task 2: Invariants + validation reconciliation** - `47199c2` (test)
3. **Task 3: Browser walkthrough** - performed 2026-09-19 via `playwright-cli` in visible browsers; evidence in `11-16-evidence/`

## Task 1 / 2 outcome (truthful status)

- Both integration suites **executed and passed** against real Postgres + MinIO (Docker was reachable). The commit message of `afd2932` says "BLOCKED"; it is superseded by this result.
- The concurrency suite **failed on its first real run** (Postgres 25P02 "current transaction is aborted"): the P2002 catch could not recover inside the transaction, and would also have rolled back the caller's lesson-progress/attendance write. Fake-backed unit tests all passed. Fixed in `e28a9d0` (Rule 1).
- Seven invariants pass; `11-VALIDATION.md` has no TBD cells; `nyquist_compliant: true`.
- Environment: Vitest fails in Git Bash here; run it through `powershell.exe -NoProfile -Command "npx vitest run ..."`.

## Task 3: Walkthrough (browser-driven, not manual)

**Method.** Run by Claude with `playwright-cli` in three visible browser windows (staff, learner, signed-out public), the user watching. Not the human-performed walkthrough the plan describes; the results below are what was observed. Fixture: isolated DB `lms_phase11_uat`, Financial Controls Masterclass (course-scope cohort), learners 4 and 5.

**Disclosed fixture shortcuts** (each is a place the observation is not purely end-to-end):
- Only the two TEXT lessons were left required so a learner could complete in the UI without video watch-time.
- The FCM course's template was set via database update, because no Course edit page exists (Gap 3).
- For step 7, learner5's name and the course title were temporarily set to very long strings (title restored afterwards); certificate 2 keeps those snapshots.
- For step 10, an assignment, submission and RELEASED grade were created by database insert. The override itself was done through the staff UI.

| # | Step | Result | Observation |
|---|------|--------|-------------|
| 1 | Template editor | **Passed** (one gap) | Border, image (real presign→PUT→confirm upload), all four dynamic fields placed by mouse drag. Keyboard-only pass: Tab reached every element, Arrow = 1pt, Shift+Arrow = 10pt, Delete removed an element with no modal, and a live region announced "moved to 112, 394". Save then full reload: every element box identical; stored layout matches the keyboard-edited values exactly. Gap 4: dragging the uploaded logo is unreliable. |
| 2 | Issuance mode | **Partial** | Mode radios and template picker are disabled until "Certificate enabled" is checked, list the new template, and persist (MANUAL + template) when creating a course. But there is no Course edit page, so "on a Course's edit page" cannot be done (Gap 3). |
| 3 | Manual queue | **Passed** | Completing both required lessons created a CompletionRecord and no certificate (correct for MANUAL). Learner appeared in `/staff/certificates`; "Issue certificate" opened a reason-free confirmation; row disappeared, empty state showed, status "Certificate issued for Bisi Adewale." Enrolment moved to COMPLETED. |
| 4 | Learner download | **Failed** | After issuance the Financial Controls card **vanished** from `/dashboard`, taking the certificate slot and download link with it (Gap 1). The route itself works: as the learner, `/api/certificates/<id>/download` returned 200 `application/pdf`, 3,399 bytes, `%PDF-1.7`, via a presigned MinIO URL. |
| 5 | Public verification | **Passed** (one gap) | Signed out: valid reference shows "This certificate is valid." with exactly three facts (learner name, award title, issued date), no sign-in prompt, no catalogue nav. A made-up reference shows "We couldn't find a certificate with this reference." and no other fields. Bare `/verify` is the email-verification page and cannot take a reference (Gap 5). |
| 6 | PDF visual fidelity | **Failed** | The PDF is A4 landscape with the real name, award, date and reference, and horizontal positions match. **Vertical positions are inverted**: the logo (designed at top) is at the bottom, and the reference (designed at bottom) is at the top. The logo is also stretched into an ellipse where the editor showed a circle (Gap 2). |
| 7 | Backstop: long strings | **Passed** | No horizontal scroll (scrollWidth == clientWidth, zero elements past the edge) on the verify page, issued list and detail page at 1280 and 390 wide, using an 81-char name and 116-char award title. Reference wraps onto two lines at 390. |
| 8 | Backstop: editor at scale | **Passed** | 20 elements (19 text + border). 50 keyboard nudges averaged 13 ms; 10 inspector edits averaged 15 ms; worst Event Timing sample 48 ms. Measured with the Event Timing API, so "no visible lag" is inferred from a sub-100 ms worst case rather than perceived by a human. |
| 9 | Revoke and reissue | **Passed** | 10-character minimum enforced (5 chars leaves submit disabled). After revoking: staff banner shows the reason; public page says "revoked and is no longer valid", and the reason text does not appear anywhere on it; enrolment returned to ACTIVE; learner dashboard shows "revoked, contact support" with no download. Reissue created a different reference; old and new detail pages link to each other; old ref verifies as revoked, new as valid; enrolment COMPLETED again. |
| 10 | CRD-06 flag | **Passed** | Overriding a released grade 80 to 55 flagged the active certificate. Issued list and detail page show "Flagged for review"; the only action is Revoke; no "Clear flag" control exists. Learner sees "Your certificate is under review…" and still gets the download link (visible only because the flag reverted the enrolment to ACTIVE; see Gap 1). |

## Gaps for /gsd:verify-work (none fixed here)

1. **BLOCKER, CRD-03: learner cannot reach an active certificate.** `listOwnActiveEnrolments` (`src/server/services/learner-access.ts:429`) filters `status: "ACTIVE"`, but issuance moves the enrolment to COMPLETED (D-05), so the dashboard card holding `CertificateSlot` disappears exactly when a certificate becomes ACTIVE. The slot is only visible in revoked/flagged states, where the enrolment is ACTIVE again. Unit tests missed it because fixtures use ACTIVE enrolments. Whether COMPLETED enrolments should also keep lesson access is a Phase 9 decision the fix must settle.
2. **MAJOR, CRD-03: PDF layout does not match the editor.** `certificate-pdf-renderer.ts` passes `element.y` straight to pdf-lib's `drawText`/`drawImage` (lines ~103, ~125). The editor's y is top-down; pdf-lib's origin is bottom-left, so every element is vertically mirrored. `drawImage` also stretches to the box while the editor preview uses object-contain. Tests only assert text presence, not position.
3. **MAJOR, D-02/D-10: no Course edit page.** `CourseForm` only accepts `mode: "create"`; there is no `/staff/courses/[id]/edit`. Issuance mode and template can only be set when creating a course. Programme has an edit mode (`updateProgrammeAction`) and was not exercised here.
4. **MODERATE: logo drag glitch.** The canvas `<img>` is natively draggable (`draggable` true, `pointer-events: auto`), so grabbing an uploaded logo starts the browser's ghost-image drag and cancels the editor's pointer drag (a 100 px drag moved 15 px). Also `user-select: auto` allows stray text selection.
5. **MINOR: no public entry point.** The bare `/verify` path is the IAM-02 email-verification page (route collision found in 11-06), so an employer cannot type a reference from `/verify`; only `/verify/<ref>` works.
6. **MINOR: stale copy.** The dashboard "Next up" card still says "your certificate slot below will reflect this once certificates ship."

## Not covered

- CRD-02 (Programme-scope issuance) was not driven in a browser; only Course scope.
- Programme edit form's certificate settings were not exercised.
- Attendance-correction and completion-correction flag paths (only the grade-override path was driven).
- Certificate PDF with the long name/title (step 7 checked page layout, not PDF overflow).
- The template's saved `assetKey` still points under `certificate-template-assets/draft/…`; rendering worked, so this was only noted.

## Requirements

`REQUIREMENTS.md` currently marks CRD-01..06 Complete. On this evidence **CRD-03 should be reopened** (Gaps 1 and 2). CRD-02 has no browser evidence.

## Next

Run `/gsd:verify-work 11` to turn Gaps 1-3 into fix plans (`/gsd:plan-phase 11 --gaps`). Phase 11 must not be marked Complete until then.
