---
phase: 14-software-licence-deployment-control
plan: 19
subsystem: licensing
tags: [licence, ui-mirror, banner, restriction-context, confirm-modal, resource-form, refusal-note, lic-05, lic-02, d-09, d-15]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-06 policy.ts (bannerCopy, LICENCE_STATE_LABELS, LICENCE_REFUSAL_MESSAGE, RESTRICTED_CONTROL_REASON_STAFF and _ADMIN, isLicenceRefusalMessage, rejectionSentence) and display.ts (formatLicenceInstant); 14-07 licenceService.getStatusSnapshot; 14-10 and 14-15 Licence screen and activation form; 14-11 server guard; 14-18 server refusals carry the fixed sentence"
provides:
  - "LicenceRestrictionProvider, useLicenceRestriction and UNRESTRICTED_LICENCE_RESTRICTION: a client context that defaults to unrestricted"
  - "LicenceBanner: persistent, non-dismissible Administrator banner (role status, id licence-restriction-notice, data-tone element) rendered by staff/layout.tsx between the navy header and main"
  - "LicenceRefusalNote and RestrictedControlReason: warning-style refusal note and the visible reason line paired with a disabled control"
  - "ConfirmModalProps.licenceEffect and ResourceFormProps.licenceEffect (default write): in restricted continuity mode a write confirm or submit is disabled with a described-by reason"
  - "10 ConfirmModal files marked licenceEffect continuity, AssignmentsPanel account modal conditional, tests/licence-ui-mirror-gate.test.ts exhaustive classification gate"
affects: [14-20, 14-21]

estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 3
  confidence: low
actuals:
  tokens: 15000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Context mirror: the layout computes { restricted, canViewLicence, stateLabel } once per full render; StaffShell provides it; primitives read it with a default that means unrestricted so learner shells and tests with no provider are unaffected"
    - "Disabled write control is always paired with a visible RestrictedControlReason line referenced by aria-describedby (never a tooltip alone); the reason variant depends on licence.view"
    - "Exhaustive file-level classification gate over every staff and catalogue ConfirmModal element, built with the TypeScript compiler API, with in-memory fixture tests proving it can fail"

key-files:
  created:
    - src/components/licence/LicenceRestrictionProvider.tsx
    - src/components/licence/LicenceBanner.tsx
    - src/components/licence/LicenceRefusalNote.tsx
    - tests/components/licence-banner.test.tsx
    - tests/components/licence-restriction.test.tsx
    - tests/licence-ui-mirror-gate.test.ts
  modified:
    - src/app/staff/layout.tsx
    - src/app/staff/StaffShell.tsx
    - src/components/primitives/ConfirmModal.tsx
    - src/components/primitives/ResourceForm.tsx
    - src/components/catalogue/UnsavedOrderGuard.tsx
    - src/app/staff/certificates/templates/TemplateEditorShell.tsx
    - src/app/staff/certificates/CertificateQueueTable.tsx
    - src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable.tsx
    - src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx
    - src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx
    - src/app/staff/email-log/EmailLogTable.tsx
    - src/app/staff/users/AssignmentsPanel.tsx
    - src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx
    - src/app/staff/licence/ActivateLicenceForm.tsx
    - tests/staff-layout-nav.test.ts
    - tests/components/staff-shell.test.tsx
    - tests/components/confirm-modal.test.tsx
    - tests/components/assignments-panel.test.tsx
    - tests/components/certificate-queue.test.tsx
    - tests/components/grade-entry-client.test.tsx
    - tests/components/cohort-detail-actions.test.tsx
    - tests/components/lesson-editor-client.test.tsx
    - tests/components/payment-detail.test.tsx

key-decisions:
  - "The licence activation ConfirmModal (ActivateLicenceForm) is marked licenceEffect continuity although the plan's list omitted it: left on the default write it would be disabled in restricted state, locking the administrator out of the recovery action (T-14-19-02, prohibition P4). CONTINUITY_MODAL_FILES therefore has 10 files, not the plan's 11"
  - "ManualPaymentDialog and RefundDialog are bespoke dialogs (PublishDialog precedent) with no ConfirmModal element, so there is nothing to mark; they cannot be disabled by the mirror, which is the intended outcome. The gate asserts they stay off ConfirmModal and ResourceForm"
  - "stateLabel in the restriction context is null for staff without licence.view (the plan text builds it from LICENCE_STATE_LABELS for everyone); the context travels in the RSC payload, so a non-holder must not receive licence detail (T-14-19-01)"
  - "A licence refusal supplied as a ResourceForm field error renders through LicenceRefusalNote and is excluded from the danger summary (beyond the plan's error-state-only wording), so a refusal can never appear as a danger entry (T-14-19-05)"
  - "Reason line for the lesson editor header save sits directly under the page header (white content area), not inside the navy action band, where muted text would not meet contrast"

patterns-established:
  - "A new staff or catalogue ConfirmModal file fails tests/licence-ui-mirror-gate.test.ts until it is listed in CONTINUITY_MODAL_FILES or WRITE_MODAL_FILES"
  - "A continuity action is marked on the primitive (licenceEffect continuity); a write action carries no attribute"

requirements-completed: [LIC-02]

coverage:
  - id: C1
    description: "D-15 banner: role status, id licence-restriction-notice, tone element with data-tone and aria-hidden icon, white message, underlined 44px link, wraps with link on its own line below sm, no dismiss control, no animation"
    requirement: "LIC-02"
    verification:
      - kind: unit
        ref: "tests/components/licence-banner.test.tsx (4 banner tests) (pass)"
        status: pass
      - kind: manual
        ref: "320px width and 200% zoom wrap check (outstanding human UAT, WINDOWS id 23)"
        status: not-run
    human_judgment: true
  - id: C2
    description: "Layout wiring: banner for the five states at the right tones, none for active, not activated or expiring beyond 30 days, none and unrestricted context when the read fails, link label depends on licence.activate, no banner and no label for staff without licence.view"
    requirement: "LIC-02"
    verification:
      - kind: unit
        ref: "tests/staff-layout-nav.test.ts (8 new cases incl. it.each over 4 states) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "Shell: banner sits between header and main in DOM order; absent banner adds nothing; children receive the supplied restriction value or the unrestricted default"
    requirement: "LIC-02"
    verification:
      - kind: unit
        ref: "tests/components/staff-shell.test.tsx (3 new cases) (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "D-09 mirror: restricted write ConfirmModal confirm and ResourceForm submit disabled with a resolvable visible reason (staff and Open Licence variants), continuity untouched, Cancel stays enabled, no provider means unchanged behaviour, every restriction-disabled button has a non-empty described-by element"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/components/licence-restriction.test.tsx (19 tests) and tests/components/confirm-modal.test.tsx (pass)"
        status: pass
    human_judgment: false
  - id: C5
    description: "T-14-19-05: a server refusal in the ConfirmModal error slot, the ResourceForm error state or a form error renders as LicenceRefusalNote (role status, Lock icon, no danger class); any other error keeps the standard danger rendering"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/components/licence-restriction.test.tsx (refusal cases) (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "T-14-19-02: every staff and catalogue ConfirmModal is classified (10 continuity, 1 dynamic, 10 write) and an unclassified file fails with its path; no ResourceForm is continuity; bespoke dialogs stay off the mirror; consumer behaviour proven for certificate issue, grade override, refund, account deactivate (enabled) and reactivate, revoke assignment, cohort cancel, lesson header save (disabled with reason)"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-ui-mirror-gate.test.ts (12 tests) plus component additions in 7 existing files (pass)"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-10-02
status: complete
---

# Phase 14 Plan 19: Staff UI Mirror of Restricted Continuity Mode Summary

**A persistent Administrator banner in the staff shell, a restriction context that disables write confirms and form submits with a visible, programmatically associated reason, a calm warning note for server refusals, and an exhaustive gate that classifies every staff and catalogue ConfirmModal so recovery and local-only actions can never be disabled.**

## Performance

- **Duration:** about 30 min
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 6 created, 25 modified

## Accomplishments

- Read first (AGENTS.md): `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` ("Layouts do not rerender" on navigation, so the banner reflects the last full render; the plan's adopted default stands, no poll built; activation revalidates the staff layout per 14-15).
- Tracer: `licence-restriction` context, `LicenceBanner`, `StaffShell` props `banner` and `licenceRestriction`, and `staff/layout.tsx` reading `licenceService.getStatusSnapshot()`; a restricted snapshot now renders the banner through the layout. The read sits in a try and catch like the bell; the banner JSX is built outside the try block (the React compiler lint forbids JSX inside it), so only the read is guarded and a read failure leaves no banner and an unrestricted context.
- `LicenceBanner` follows UI-SPEC exactly: `on-navy bg-sidebar-hover border-b border-sidebar-line min-h-12 px-6 lg:px-8 py-2 flex flex-wrap items-center gap-x-4 gap-y-2`, `role="status"`, `id="licence-restriction-notice"`, a `data-tone` element with `border-l-4 border-current` holding a 20px `aria-hidden` icon (`TriangleAlert` or `ShieldAlert`) and the 14px/600 label, the message in 14px white, a 14px/600 white underlined link with `min-h-11`. No dismiss control, no animation, no new CSS or token. Copy and tone come from `bannerCopy` (14-06); the link is "Activate a licence" only when the viewer holds `licence.activate`.
- `ConfirmModal` and `ResourceForm` gained `licenceEffect` (default write). Blocked means restricted and not continuity: the confirm or submit is disabled, `aria-describedby` points to a `RestrictedControlReason` rendered directly after the button row (ConfirmModal) or footer (ResourceForm), and Cancel stays enabled. With no provider both behave exactly as before (all pre-existing tests pass unchanged).
- `LicenceRefusalNote` renders a `LICENCE_REFUSAL_MESSAGE` found in the ConfirmModal `error` slot, the ResourceForm error state or a ResourceForm field error as a warning note (`border-l-2 border-warning bg-warning-surface px-4 py-2 text-sm text-foreground`, Lock icon, `role="status"`, no danger class). Any other text keeps the standard danger rendering.
- Continuity marks on 10 modal files, `AssignmentsPanel` account modal conditional (`isActive ? "continuity" : "write"`), `LessonEditorClient` header save disabled with a described-by reason.
- No wording says "read-only" anywhere in the new code (asserted for the banner, note and reason copy).

## Classification of every staff and catalogue ConfirmModal file (owner review)

| File | Class | Action(s) |
|------|-------|-----------|
| src/app/staff/certificates/CertificateQueueTable.tsx | continuity | issue certificate (certificates.issue) |
| src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx | continuity (2 modals) | revoke (certificates.revoke), reissue (certificates.issue) |
| src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx | continuity | override released grade (grades.manage) |
| src/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable.tsx | continuity | release grades (grades.manage) |
| src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx | continuity | progress override (A9) |
| src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx | continuity | attendance correction (attendance.manage) |
| src/app/staff/email-log/EmailLogTable.tsx | continuity | resend email (call-site override, 14-17) |
| src/app/staff/licence/ActivateLicenceForm.tsx | continuity (not in the plan list, see deviations) | activate licence (licence.activate, the recovery route) |
| src/components/catalogue/UnsavedOrderGuard.tsx | continuity (local only) | leave without saving the order |
| src/app/staff/certificates/templates/TemplateEditorShell.tsx | continuity (local only) | leave without saving the template |
| src/app/staff/users/AssignmentsPanel.tsx | dynamic (the single reviewed case) | account toggle: continuity when deactivating (A10), write when reactivating; revoke assignment: write (default) |
| src/app/staff/certificates/templates/TemplatesTable.tsx | write | archive template |
| src/app/staff/cohorts/[id]/EnrolmentActionModals.tsx (5 modals) | write | add, approve, transfer, withdraw, cancel enrolment |
| src/app/staff/cohorts/[id]/SessionsTab.tsx | write | cancel session |
| src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx | write | withdraw lesson (and the header save, mirrored separately) |
| src/app/staff/programmes/[id]/ProgrammeDetailClient.tsx (3 modals) | write | unpublish, archive, un-archive programme |
| src/app/staff/roles/RoleDetailPanels.tsx (2 modals) | write | remove permissions, deactivate or reactivate role |
| src/components/catalogue/AssessmentFormFields.tsx | write | archive assessment |
| src/components/catalogue/CohortDetailActions.tsx | write | cancel cohort |
| src/components/catalogue/CourseDetailActions.tsx (3 modals) | write | unpublish, archive, un-archive course |
| src/components/catalogue/UploadPanel.tsx | write | remove lesson resource |
| src/app/staff/payments/ManualPaymentDialog.tsx | not a ConfirmModal (bespoke dialog) | never disabled by the mirror; server class continuity (payments.confirm) |
| src/app/staff/payments/RefundDialog.tsx | not a ConfirmModal (bespoke dialog) | never disabled by the mirror; server class continuity (refunds.manage) |

Outside the scan roots and unaffected (learner screens mount no provider): `LearnerTicketDetail.tsx`, `QuizAttemptPanel.tsx`. No `ResourceForm` consumer is continuity: every staff and catalogue ResourceForm consumer (cohort, course, programme, role, staff account, lesson, assessment fields, question builder, new role and new user pages) is write.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): provider, banner, shell and layout wiring, three test files. Commit: none (owner policy)
2. Task 2: refusal note, ConfirmModal and ResourceForm mirror, restriction tests. Commit: none (owner policy)
3. Task 3: continuity marks, lesson header save, gate test, consumer assertions in seven existing files. Commit: none (owner policy)

TDD gate: no `test(...)`/`feat(...)` commits exist (commits prohibited by owner policy). Tests were written alongside the implementation (Task 1 tests first on disk, but no separate failing run was recorded), so no distinct RED run exists; the gate test and the refusal and restriction tests all assert exact strings and element relationships, and the gate carries in-memory fixtures proving it can fail. Tracer gate: auto-chain flag false, interactive default end-of-phase; the tracer `<verify>` here carries a `<human-check>`, which the checkpoint reference routes to a checkpoint, but the owner's standing policy directs visual and keyboard checks to outstanding human UAT in this SUMMARY (browser verification is not possible), so the automated verify was re-run end to end (43 of 43 passed) before the expansion tasks and the human check is recorded below rather than approved.

## Verification Results (real output)

- Task 1 verify, `npx vitest run tests/components/licence-banner.test.tsx tests/components/staff-shell.test.tsx tests/staff-layout-nav.test.ts`: 3 files, 43 tests passed.
- Task 2 verify, `npx vitest run tests/components/licence-restriction.test.tsx tests/components/confirm-modal.test.tsx tests/components/course-form.test.tsx tests/components/cohort-form.test.tsx` (plus resource-form.test.tsx): 5 files, 55 tests passed; confirm-modal.test.tsx alone 11 of 11 after the additive case.
- Task 3 verify and the consumer files, `npx vitest run tests/licence-ui-mirror-gate.test.ts tests/components/assignments-panel.test.tsx certificate-queue certificate-record email-log-table attendance-mark licence-restriction grade-entry-client cohort-detail-actions lesson-editor-client payment-detail`: 11 files, 144 tests passed.
- Other test files that mount edited components or the shell (brand-mark, certificate-template-editor, certificate-templates, grading-queue-table, licence-activate-form, resource-form, staff-progress-override, licence-status, licence-page, phase8-invariants, staff-support-routes, design-contract, licence-purity): 13 files, 254 tests passed.
- Final combined run of the plan verification set plus the consumer files (13 files): 164 tests passed.
- `npx vitest run tests/boundary.test.ts --project node` (alone, default timeout, no timeout hit): 31 passed.
- `npx vitest run tests/licence-enforcement-boundary.test.ts --project node` (alone, default timeout, no timeout hit): 41 passed.
- `npx tsc --noEmit`: no output, 0 errors (run twice, the second after the final layout edit). No new error.
- `npx eslint` on `src/components/licence`, `src/components/primitives`, `src/app/staff/layout.tsx`, `src/app/staff/StaffShell.tsx` (the plan command): exit 0, no findings. On all other touched source and test files: 0 errors; 4 pre-existing `no-unused-vars` warnings remain in `tests/components/certificate-queue.test.tsx` (lines 33, 82, 98, 116, existing `_input` helpers; my added case uses a zero-argument function and adds none). The first run flagged `react-hooks/error-boundaries` for JSX built inside the layout's try block; fixed by building the banner element after the try (Rule 1, below).
- Acceptance greps: `LicenceBanner.tsx` contains `id="licence-restriction-notice"` and `role="status"` once each; `useLicenceRestriction` and `licenceEffect` appear in both `ConfirmModal.tsx` and `ResourceForm.tsx`; each of the 10 continuity files contains `licenceEffect="continuity"` (CertificateRecordActions twice); `AssignmentsPanel.tsx` line 254 `licenceEffect={isActive ? "continuity" : "write"}`.
- Not run (owner policy): the full suite and any Testcontainers integration file (this plan adds no database behaviour); no prisma command or DATABASE_URL access.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-19-PLAN.md LIC-05 LIC-02`, output verbatim:

```
{
  "ready": [
    "LIC-02"
  ],
  "blocked": [
    "LIC-05"
  ],
  "total": 2
}
```

  Only LIC-02 is marked complete (it is in `ready`). LIC-05 stays open: it is still owned by later plans (14-20 documentation, 14-21 the restricted-state proof).

## Files Created/Modified

See key-files. Created: three licence components and three test files. Modified: layout and shell, the two primitives, 10 continuity consumers (plus `AssignmentsPanel` and `LessonEditorClient`), and 9 existing test files (additive cases only, no existing assertion changed).

## Decisions Made

See key-decisions. Everything else follows the plan: interface contract names unchanged (`LicenceRestrictionValue`, `LicenceRestrictionProvider({ value, children })`, `useLicenceRestriction()`, `licenceEffect?: "write" | "continuity"`, `StaffShell` props `banner` and `licenceRestriction`); one extra export, `UNRESTRICTED_LICENCE_RESTRICTION`, from the provider module.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan inventory] The licence activation modal was not classified**
- **Found during:** Task 3 (listing every `<ConfirmModal` under `src/app/staff` and `src/components/catalogue` before editing)
- **Issue:** `src/app/staff/licence/ActivateLicenceForm.tsx` (plan 14-15) contains a ConfirmModal that the plan's 11-file continuity list and "every other file is write" rule would leave on the default write effect. In restricted state the confirm would be disabled, so an administrator could not activate a replacement licence, the one recovery action (`licence.activate` is continuity; T-14-19-02, prohibition P4).
- **Fix:** marked it `licenceEffect="continuity"` and added it to `CONTINUITY_MODAL_FILES` (10 files, not "the 11 listed plus nothing else"). Existing `licence-activate-form.test.tsx` still passes.
- **Files modified:** `src/app/staff/licence/ActivateLicenceForm.tsx`, `tests/licence-ui-mirror-gate.test.ts`
- **Commit:** none (owner policy). Ledger: WINDOWS id 25.

**2. [Rule 1 - Bug in plan premise] ManualPaymentDialog and RefundDialog have no ConfirmModal element**
- **Found during:** Task 3 (grep for `<ConfirmModal`)
- **Issue:** both are bespoke dialogs on the `PublishDialog` precedent, so `licenceEffect="continuity"` cannot be added, and the plan's literal acceptance grep for the "eleven" files cannot pass for them.
- **Fix:** none needed in the files: the mirror never touches them, so they stay enabled in restricted state (the intended outcome, server class continuity). Recorded in the gate as `BESPOKE_CONTINUITY_DIALOG_FILES`, with a test that they stay off ConfirmModal and ResourceForm, and a component test that the refund dialog stays enabled under a restricted provider.
- **Files modified:** `tests/licence-ui-mirror-gate.test.ts`, `tests/components/payment-detail.test.tsx`
- **Commit:** none (owner policy)

**3. [Rule 1 - Lint] JSX inside try/catch in the layout**
- **Found during:** Task 3 final eslint run (`react-hooks/error-boundaries`)
- **Fix:** the try block now computes only data (`bannerCopy` output); the `LicenceBanner` element is built after it. Behaviour is identical and the failure-of-read test still passes.
- **Files modified:** `src/app/staff/layout.tsx`

**4. [Rule 2 - Missing critical functionality] Focus fallback and form-error refusals**
- A disabled confirm cannot take focus, so with no reason field the dialog opened with focus on the page behind. `ConfirmDialog` now falls back to focusing the dialog container when focus did not land inside (no change when a field or the confirm is focusable).
- A licence refusal returned as a `ResourceForm` field error (the usual way actions feed forms) would otherwise render in the danger summary. Such errors now render through `LicenceRefusalNote` and are excluded from the danger summary count.
- **Files modified:** `src/components/primitives/ConfirmModal.tsx`, `src/components/primitives/ResourceForm.tsx`

### Interpretation choices (flag for owner review)

- **stateLabel is null for staff without licence.view** (see key-decisions). The plan text builds it for everyone; the context is serialized to the browser, so non-holders get no licence detail. The label is unused for non-holders either way.
- **The lesson editor header save is mirrored, the lesson `ResourceForm` is not double-covered.** The form uses `hideFooter` and an external submit, so its own submit is hidden and gets no `aria-describedby`; the header button carries the mirror, with the reason line under the page header.
- **Bespoke write buttons** (neither a ResourceForm submit nor a ConfirmModal confirm; for example the Withdraw lesson trigger, cohort publish and the Add enrolment button) are not individually disabled by this mirror, as the plan states; the server refusal and its message are authoritative. The human check item (1) in Task 3 expects the Cancel cohort, Add enrolment and publish controls disabled with a Lock line; only the modal confirms, form submits and the lesson header save are disabled by this implementation, so that check may legitimately show the page-level trigger buttons still enabled and refusing on submit. Flagged so the owner can decide whether to extend the mirror to those bespoke triggers.
- **Stale banner after soft navigation:** the plan's adopted default stands (accept staleness until the next full load; activation revalidates; server refusal text authoritative). No poll was built.
- **Bundle and import cost of using `policy.ts` from the primitives (flag for owner review):** `ConfirmModal` and `ResourceForm` now import `LICENCE_REFUSAL_MESSAGE` and `isLicenceRefusalMessage` from `src/server/licence/policy.ts`, as the plan directs, and `policy.ts` imports `format.ts`, which imports zod. Measured in jsdom: importing `policy.ts` costs about 0.33 s (zod alone about 0.41 s in a cold file), and in a production build zod may now be pulled into every client bundle that uses these primitives, including learner screens that use `ConfirmModal` (no licence text is rendered for learners; the provider default is unrestricted). Not refactored here because `policy.ts` is the single owner of the phrase (D-06) and a split would touch a prior plan module; a follow-up could move the dependency-free constants into a small module that `policy.ts` re-exports.

**Total deviations:** 4 auto-fixed (2 Rule 1 plan-premise gaps, 1 Rule 1 lint, 1 Rule 2), 5 interpretation notes. **Impact:** `CONTINUITY_MODAL_FILES` has 10 files instead of 11; no interface name changed.

## Issues Encountered

None blocking. No auth gates, no Rule 4 architectural decisions, no stubs. Under machine load two tests hit the 5 s default once each in a combined parallel run: the whole-tree TypeScript scan in the new gate test (5.7 s; it passes alone in about 3 s) and the first dynamic `import("@/components/primitives")` inside the first case of `tests/components/confirm-modal.test.tsx` (5.0 to 5.5 s; 1.4 s alone). Fixed without hiding failures: the gate describe now has an explicit 60 s timeout, and `confirm-modal.test.tsx` gained a `beforeAll` that warms the barrel with a 60 s ceiling (additive, no existing assertion touched). After that, two consecutive combined runs of 9 files (111 tests) were green. `tests/boundary.test.ts` and `tests/licence-enforcement-boundary.test.ts` ran alone and did not time out. One shell quirk: a multi-line Python heredoc was rejected by the shell, so test edits were applied with the Edit tool instead (no content impact).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema. The restriction context adds one boolean (`restricted`) to what any signed-in staff member receives; this is intended by D-09 (staff must be told an action is unavailable) and carries no licence detail for non-holders (T-14-19-01 covered by the layout test and the reason-variant tests). T-14-19-02 is covered by the gate and the consumer tests, T-14-19-04 by the layout failure test, T-14-19-05 by the refusal-note tests; T-14-19-03 (UI mistaken for enforcement) is accepted as the plan states: the 14-11 guard and 14-17 registry are the controls.

## Outstanding Human UAT

Browser verification was not possible. Recorded in `.planning/WINDOWS.md` as `unrun-verify` entries 23 and 24 plus a deviation entry 25.

- **Task 1 (id 23), banner:** with a licence in grace or restricted state, as an Administrator: (1) the strip sits between the navy header and the white content sheet, state label and icon in the tone colour, page title unchanged; (2) at 320px width and 200% zoom the strip wraps, the link drops to its own line, nothing is clipped; (3) as staff without licence.view no strip appears; (4) Tab to the strip link and the focus ring is visible (note: the global accent focus ring on the navy strip should be eyeballed for contrast).
- **Task 3 (id 24), restricted-state controls:** (1) on a cohort page the Cancel cohort modal confirm is disabled with the Lock line "Open Licence to see how to restore this." (see the interpretation note: the page-level Add enrolment and publish trigger buttons are not individually disabled); (2) the refund dialog, manual payment dialog, grade entry and attendance marking still work; (3) leaving the template editor and the order editor with unsaved changes still works; (4) deactivating a staff account works and reactivating one is disabled with a reason; (5) as staff without licence.view the reason reads "Ask an administrator to check the licence status." with no licence detail; (6) added: as an Administrator in restricted state, the licence activation confirm is enabled and activation succeeds.
- Carried forward: the 14-03 migration is proven on Testcontainers only and is NOT applied to the shared database (outstanding human step, WINDOWS.md entry id 20). This plan used no database.

## Next Phase Readiness

- Plan 14-20 (documentation) can describe the banner, the disabled-with-reason controls and the refusal note; plan 14-21 can cite `tests/licence-ui-mirror-gate.test.ts`, `tests/components/licence-restriction.test.tsx` and `tests/staff-layout-nav.test.ts` as the LIC-05 UI-side evidence.
- Any new staff or catalogue `ConfirmModal` file must be classified in the gate test or it fails.

## Self-Check: PASSED

- FOUND on disk: src/components/licence/LicenceRestrictionProvider.tsx, LicenceBanner.tsx, LicenceRefusalNote.tsx; tests/components/licence-banner.test.tsx, tests/components/licence-restriction.test.tsx, tests/licence-ui-mirror-gate.test.ts; every modified file listed in key-files (tests above exercise each); this SUMMARY.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run. No prisma command or DATABASE_URL access was used.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-02*
