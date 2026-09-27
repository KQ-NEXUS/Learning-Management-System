# Product-wide UI Review — Professional Training LMS

**Audited:** 2026-09-25
**Baseline:** C2 Console open layout + per-phase UI-SPECs
**Screenshots:** not captured (no live browser; code-only audit)

## Pillar Scores
See "Final scores" at end of file. Overall 16/24 (Copy 2, Visuals 3, Color 3, Typography 3, Spacing 3, Experience 2).

## Findings by surface group
(appended below as each group completes)

---
### Group: Cross-cutting / System states (403/404/error/loading)

- **BLOCKER-ish (HIGH)** No `error.tsx` or `global-error.tsx` anywhere under src/app (only 2 not-found.tsx + 8 loading.tsx for 77 routes). Any unhandled throw (e.g. `throw error` fallthrough in every staff page catch, e.g. src/app/staff/courses/page.tsx:20) renders Next's default unstyled error screen outside the C2 shell, no recovery CTA.
- **HIGH** Loading coverage: only support (learner+staff) and reports/[dataset], reports/exports have loading.tsx. Dashboard, learn, lesson, quiz results, all staff tables/detail pages have no streaming skeleton — blank navigation on slow queries.
- **MEDIUM** Root 404 (src/app/not-found.tsx:17-36) is learner/catalogue-only copy ("The course or programme may have been archived", CTA "Back to the catalogue") yet it is what every staff `notFound()` resolves to (45 files call notFound()). Staff hitting a missing payment/ticket are dumped out of the staff shell into LearnerShell with a catalogue CTA. Needs src/app/staff/not-found.tsx.
- **MEDIUM** 18 staff pages render the AuthenticationError branch as a bare `<p className="text-sm">Your session has ended. Sign in again.</p>` (e.g. src/app/staff/audit/page.tsx:65, src/app/staff/cohorts/page.tsx:85) — no link to /signin, no header band.
- **MEDIUM** ResourceTable denied state (src/components/primitives/ResourceTable.tsx:425-440) prints the raw permission key in a `<code>` chip (e.g. `courses.view`) — internals leak + tinted chip; also renders two h2s (title + heading).
- **LOW** ResourceTable empty default body "Create one to get started." and `createLabel ?? New ${noun.replace(/s$/,"")}` crude singularisation (ResourceTable.tsx:470,487). Error panel default copy references "trace"/"attempt" (dev-ish).
- **HIGH (a11y)** Nested `<main>` landmarks: src/app/staff/reports/[dataset]/page.tsx:27,35,38,46 and reports/[dataset]/loading.tsx:2 render `<main>` inside StaffShell's `<main>` (StaffShell.tsx:328).
- **MEDIUM** `window.confirm` used for resource removal (src/components/catalogue/UploadPanel.tsx:192) — the only native dialog; every other destructive path uses ConfirmModal (25 files). TemplateCanvas.tsx:221 deletes an element on Delete/Backspace with no confirm.
- Positive: ConfirmModal has role=dialog, aria-modal, focus trap, ESC, focus return (ConfirmModal.tsx:75-134). 130 aria-live/status/alert sites; global :focus-visible outline (globals.css). No hard-coded hex/rgb in UI tsx (only certificate PDF template defaults #123456/#000000 in src/server/services/certificate-default-template-layout.ts:31-85).

### Cross-cutting: tokens / typography / spacing drift
- **MEDIUM** body font-size 14.5px (globals.css body rule) — off the 12/13/14/16 contract; every inherited text is off-scale.
- **MEDIUM** Off-scale font sizes: text-[28px] x6 (verify/[verificationRef]/page.tsx:70,91,112; ReportDashboard.tsx:348; AttendanceMarkClient.tsx:237), text-[10px] (TemplateCanvas.tsx:365), text-[40px]/[44px] mobile display (LearnerPageHeader.tsx:31-32), text-2xl=24px in SupportWorkspace.tsx:121, text-lg=18px AssignmentSubmissionPanel.tsx:216, text-xl ArrangeBoard.tsx:196 / ModuleComposer.tsx:212. Total 176 arbitrary text-[..px] usages instead of named tokens (81 x text-[13px]).
- **MEDIUM** Magic 1px-off negative offsets coupling headers to shell padding: PageHeader.tsx:43-44 `-mx-[25px] -mt-[37px] lg:-mx-[41px] px-[25px] pt-[10px]` vs shell px-6/pt-9/lg:px-10 (24/36/40); LearnerPageHeader.tsx:37 `-mt-[41px]`. Non-4px values; fragile.
- **LOW** Off-grid control heights h-[38px] x28, min-h-[46px] x12, px-[18px] (EnrolmentRow.tsx:53), size-[7px] dots, rounded-t-[28px] outside radius tokens (4/6/8/10).
- **MEDIUM** Pill/tinted-chip remnants vs "no pills" rule: ArrangeBoard.tsx:365 (rounded-full bg-pill-amber-bg), QuestionBuilder.tsx:103 ("Unsaved changes" rounded-full tinted), AssessmentFormFields.tsx:488 rounded-full chips, ResourceTable denied `<code>` wash.
- **LOW** Bordered rounded-xl "cards" persist against the open layout: AssignmentsPanel.tsx:125,153; EffectiveAccessPreview.tsx:13; QuestionBuilder.tsx:112; AssessmentFormFields.tsx:524; support loading skeletons (staff/support/loading.tsx:11); reports/[dataset]/page.tsx error boxes.
- Weights: 400/500/600/700 only (semibold 492, medium 52, bold 12, normal 26) — compliant.

---
### Group: Public & auth

- **HIGH** Forgot-password "Check your email" success state is a dead end: ForgotPasswordForm.tsx:12-19 swaps the whole form for an AuthTitle only — no "Back to sign in", no resend, no "didn't arrive? check spam" guidance; the form (and focused element) unmounts with no focus move/live announcement. Same pattern for register success (RegisterForm.tsx:15-22). Forgot-password form also has no link back to /signin in its idle state.
- **MEDIUM** Auth split panel on phones: (auth)/layout.tsx:23-47 stacks the full navy marketing column (p-12, 36px h2, copy, link, "AFRICA/LAGOS") ABOVE the form — sign-in fields pushed below the fold at 375px; also an h2 precedes the page h1 (heading order). Collapse the panel to a brand strip below md.
- **MEDIUM** No per-field validation on auth forms: 0 aria-invalid/field errors in RegisterForm.tsx / ResetPasswordForm.tsx; server errors come back as one top banner (role=alert, good) not tied to the offending field.
- **LOW** Catalogue rows use `<div>` for the course/programme title (courses/page.tsx:60, programmes/page.tsx:47) — no heading structure for SR navigation; 24px title fine as display size.
- **LOW** CohortCards.tsx: "{n} seats left" never pluralises ("1 seats left") and is always success-green, even at 1 seat (contract: amber for full/late/scarcity); "Full" is grey, contract says amber. NGN price rendered in sans 36px bold, USD in mono — figures should be JetBrains Mono consistently.
- **MEDIUM** CohortCards PayCta (CohortCards.tsx:33-43) is a server-action form with no pending/disabled state — double-click creates duplicate submissions / looks unresponsive while a hold is created.
- Deliberate: policies placeholder "[POLICY TEXT: ...]" ((public)/policies/[policy]/page.tsx) — noted, not scored.

### Group: Checkout & orders

- **HIGH** Confirming fallback promises help that isn't there: PollForPayment.tsx:66-70 "Refresh this page in a minute, or contact support below" — confirming/page.tsx:34-39 renders nothing below except a spinner. And the Loader2 spinner keeps spinning after the timeout (page renders it unconditionally, confirming/page.tsx:37). Add support link + stop spinner on timeout.
- **HIGH** Enrol → sign-in loses intent: (checkout)/enrol/[cohortId]/page.tsx `redirect("/signin")` with no return path; AlreadyEnrolled/CapacityExceeded/CohortClosed/CurrencyUnavailable all silently `redirect` back to the cohort page with no message explaining why checkout didn't start.
- **MEDIUM** Hold-expired state (checkout/[orderId]/page.tsx:71-96) renders LearnerPageHeader "Review your order" (h1) AND an h1 "Your seat hold has expired" — two h1s and a header that contradicts the state. Recovery is only a small text link "Back to cohort"; should be a primary button.
- **MEDIUM** Decline banner (page.tsx:165-172) is not role="alert"/live, arrives via ?declined=1 so SR users aren't told; copy says "card" even for Paystack bank/USSD rails; shows a static server-computed time next to the live countdown (two different numbers on screen).
- **MEDIUM** HoldCountdown.tsx:57-64: urgency is colour-only with no live announcement at 5:00/1:00; at 0:00 nothing tells the learner the hold lapsed (Pay stays enabled until the server rejects).
- **LOW** Receipt (orders/[reference]/page.tsx:150-205): no payment date or method; support offered twice (mailto line + GetSupportLink); checkout dates use `toLocaleDateString(undefined, …)` (page.tsx:28) while catalogue pins en-GB — inconsistent formats.
- **LOW** Unsigned-in visit to /checkout/[orderId] returns 404 rather than sign-in (by design for IDOR, but no hint for a signed-out learner returning from email).
- Positive: OrderBreakdownCard snapshot, sr-only polite live region on confirming, verification gate banner.

---
### Group: Learner (dashboard, learn, lesson, quiz, results, sessions, support)

- **HIGH** Quiz copy is false and risks lost answers: QuizAttemptPanel.tsx:102 "Your answers save as you go" — answers only live in React state (onChange at :93-95 just calls setAnswers/setSaved(false)); persistence happens only via the manual "Save answers" button (:104) or submit. No autosave, no beforeunload guard. Either autosave (debounced saveAttemptAnswersAction) or change copy to "Save your answers before leaving".
- **MEDIUM** Quiz submit has no confirmation before consuming an attempt (QuizAttemptPanel.tsx:84,105); pending label on the Submit button reads "Saving…" instead of "Submitting…"; sticky counter is role="status" (:85) so every answer click announces "N of M answered" (chatty SR).
- **MEDIUM** Empty dashboard copy is wrong for a learner with no enrolments: dashboard/page.tsx:452-457 "Nothing to pick up right now — Check back once your instructor schedules the next session, or explore what's next in your course" (they have no course). Should read e.g. "You're not enrolled on anything yet".
- **MEDIUM** Locked lesson / stale lesson link → notFound() (lessons/[lessonId]/page.tsx:78-86,107) → root 404 "The course or programme may have been archived… Back to the catalogue". Learner inside their own course is ejected to the catalogue with misleading copy; should send them back to /learn/[enrolmentId] with a "not available yet" line.
- **LOW** DeferredSlot copy "Assignments and quizzes — arriving in a future update" / "Results — arriving in a future update" (dashboard/page.tsx:264,311) still renders for unpinned-offer enrolments even though Phase 10 shipped — reads as unfinished product. Prefer "No assessments set for this course".
- **LOW** ResultsList.tsx:92 "Unlimited attempt(s) remaining" / lazy "(s)" plural. Quiz facts "Pass mark" shows bare number without unit (QuizAttemptPanel.tsx:79).
- **LOW** Assignment receipt shows raw cuid (AssignmentSubmissionPanel.tsx:70 → prisma receiptId @default(cuid())) — unlike orders/tickets which have human references.
- **LOW** LearnerShell renders the mobile menu toggle even when `nav=[]` (root 404 passes nav=[]) → an empty menu button (LearnerShell.tsx:112-124). No skip-to-content link in LearnerShell, StaffShell or LessonFrame (0 matches repo-wide).
- **LOW** Learner support list error "We couldn't load your tickets. Try again." has no retry control ((learner)/support/page.tsx:50-52). Otherwise support new/list/detail is the most complete surface: aria-invalid + aria-describedby per field, disabled while uploading, loading.tsx present, empty state with CTA.
- Positive: LessonFrame progressbar has aria-valuenow/label; outline collapses to <details> below lg; results/sessions empty states present.

---
### Group: Staff finance (payments, reconciliation, reports, exports) — least-audited, worst copy

- **HIGH** Reconciliation case detail dumps internals (src/app/staff/reconciliation/[caseId]/ReconciliationCaseDetail.tsx): raw `JSON.stringify(detail.evidence)` block in the Investigation summary (:40) and per history event (:44); raw enums shown as values — "Payment state" = `detail.order.status` (PAID), "Enrolment state" = `enrolmentStates.join(", ")` (ACTIVE, PENDING_PAYMENT), "Provider" = `detail.provider` (PAYSTACK) (:41); timeline `{entry.status}` / `{entry.provider}` (:43); "Related operational history" renders `{event.action} · {event.targetType}` audit codes (:44); resolution reason via `replaceAll("_"," ")` → "MATCHED PROVIDER EVIDENCE" even though a REASONS label map exists at :13-19. Breadcrumb and identifier are the raw cuid (`detail.caseId`, :37); breadcrumb "Workspace" links to the same URL as "Reconciliation".
- **MEDIUM** ResolveDialog (same file :51-95) is hand-rolled: no Escape handling, no focus trap (ConfirmModal has both), success does `window.location.reload()` with no success message. Money fallback "`${minor} minor units ${currency}`" (:25) is dev copy.
- **HIGH** Export history leaks job internals (src/app/staff/reports/exports/ExportHistory.tsx:29-34): raw job id in mono, "Retry of {cuid}", "Retried by {cuid}" (a job id worded like a person), raw column keys, raw filter pairs `key: value` (e.g. programmeId: clx…, provider: PAYSTACK), "Version {datasetVersion}", and `row.failure` raw failure text. Map to labels; hide ids behind a copy button.
- **MEDIUM** Report dashboard filter summary (ReportDashboard.tsx:233) prints raw ISO dates, raw provider enum (`request.filters.provider` → PAYSTACK) and `status.replaceAll("_"," ")` (ALL CAPS); :70/:83/:103 same underscore-strip for row states.
- **HIGH (a11y/structure)** reports/[dataset]/page.tsx: invalid dataset and denied both render a bordered `<main>` box saying only "Report unavailable." (:27,:35) — no header band, no way back, nested main; unknown dataset should notFound(). Error copy "No value has been replaced with zero." (:38,:46) is engineering language. `import Link` sits at the bottom of the file (:50).
- **MEDIUM** Reconciliation refund-status select options use `status.replaceAll("_"," ")` (ReconciliationWorkspace.tsx:313) → "PARTIALLY REFUNDED". Provider switcher is `<nav>` of aria-pressed buttons (:155) — filters aren't navigation. "Scoped totals" heading renders with nothing under it when summary is empty (:231-243).
- **LOW** Status tone drift vs contract: reconciliation OPEN → neutral grey (ReconciliationCaseDetail.tsx:35) and export QUEUED/PROCESSING → grey (ExportHistory.tsx:19-21); contract = blue for open/in-progress.
- **LOW** Payment detail refunds `<table>` has no overflow wrapper (staff/payments/[orderId]/page.tsx:291) — breaks the "tables scroll in own box" phone rule; same for learner ResultsList.tsx:99 and PublishDialog.tsx:229.
- Positive: reports/exports have loading.tsx; ReportDashboard scroll box is focusable with aria-label + sr-only caption; export queued/failed notes use role=status/alert; PaymentsTable/refund flows use ConfirmModal-style dialogs.

---
### Group: Staff authoring (overview, courses, programmes, arrange, lesson editor, assessments)

- **HIGH** Dev "Phase N" copy shipped in UI: src/components/catalogue/LessonFormFields.tsx:187 hint "No assessments exist yet — assessment authoring arrives in Phase 10." (Phase 10 has shipped; hint is now false as well as internal).
- **MEDIUM** QuestionBuilder.tsx: each question is a bordered rounded-xl shadow card (:112) and options are bordered boxes (:135) — the heaviest "card" surface left; "Unsaved changes" is a rounded-full tinted pill (:103). Confirm-remove uses neutral BTN, not danger styling (:120). File is written as dense one-liners (hard to maintain/audit).
- **MEDIUM** UploadPanel.tsx:192 `window.confirm("Remove this resource? …")` — native dialog breaks visual system and ConfirmModal consistency.
- **MEDIUM** Staff overview trend chart (src/app/staff/page.tsx:172-195) is an SVG with text-[12px] axis labels inside a scaling viewBox — at phone widths labels render ~5-6px. Good aria-label summary though.
- **LOW** ArrangeBoard.tsx:196 / ModuleComposer.tsx:212 use text-xl (20px, OK on scale) but via Tailwind default + tracking-tight rather than the 20px/-0.015em heading recipe used elsewhere — heading drift. ArrangeBoard.tsx:365 tinted amber pill.
- **LOW** AssessmentFormFields.tsx:488 file-type toggle chips are rounded-full bordered pills (aria-pressed — accessible, but off-style).
- Positive: UnsavedOrderGuard for arrange; keyboard Move up/down alternatives for drag (QuestionBuilder :116-117, ArrangeBoard); aria-live order announcements; Publish/Withdraw/Archive routed through ConfirmModal.

### Group: Staff operations (cohorts, roster, sessions, attendance, grading, enrolments)

- **HIGH** Roster shows dev copy "not tracked yet · Phase 9" (src/app/staff/cohorts/[id]/RosterTab.tsx:92-106, :221) for any cohort whose offer is unpinned (roster-service.ts:94,773). DEFERRED_LABEL literals for Phases 9-12 are still live strings.
- **MEDIUM** Raw-enum fallbacks `STATUS_LABEL[x] ?? x` across CohortsTable.tsx:125, RosterTab.tsx:187, EnrolmentsTable.tsx:152, cohorts/[id]/page.tsx:330, learners/[enrolmentId]/page.tsx:119,135 — any new status leaks as SCREAMING_CASE. Centralise label maps with a humanising fallback.
- **LOW** Lazy plurals: GradingQueueTable.tsx:28,48 "`${n} grades released`", "the N learner(s)".
- Positive: AttendanceMarkClient — role=radiogroup per learner with aria-label, glyph + label (not colour-only), dirty guard + "nothing is written until you save", correction via ConfirmModal with reason; grading release via ConfirmModal; SessionsTab cancel + CohortDetailActions cancel both confirmed.

### Group: Staff admin (users, roles, audit, certificates, support queue)

- **HIGH** Dev copy in empty scope pickers: src/app/staff/users/AssignmentDrawer.tsx:24-25 and StaffAccountForm.tsx:20-21 — "No Programmes exist yet — check back once catalogue authoring (Phase 4) lands." / "…once scheduling (Phase 5) lands." Reachable on any fresh tenant.
- **MEDIUM** Audit log mobile rows print raw `row.action` codes and full `targetId` (AuditTable.tsx:503-508) while desktop uses `humanizeAction()` + `shortenId()` (:440-443) — same data, two vocabularies by breakpoint.
- **MEDIUM** Denied states everywhere (via ResourceTable/DetailLayout) print the permission key (e.g. `payments.view`, reconciliation/[caseId]/page.tsx:23).
- **LOW** `focus-visible:outline-focus` references a token that does not exist in globals.css @theme (SupportWorkspace.tsx:119, QueueTabs.tsx:59, TicketContextCard.tsx:39) — utility is a no-op; only the global :focus-visible saves it. Support health tiles are bordered cards with text-2xl (24px, off UI scale) (SupportWorkspace.tsx:119-121); support "Data as of … UTC" while every other finance/ops surface uses Africa/Lagos (SupportWorkspace.tsx:111).
- **LOW** StaffShell header hard-codes "Africa/Lagos" (StaffShell.tsx:316) regardless of actor/cohort timezone; auth panel shows decorative "AFRICA/LAGOS".
- Positive: staff support ticket detail — internal notes visually distinct (warning rail + "Staff only"), TicketActionDialog with role=alert errors/conflict banner, sr-only live announcements, loading.tsx for queue + detail; user deactivate/revoke/role deactivate all via ConfirmModal with reasons; certificate revoke confirmed.

---
## Final scores

| Pillar | Score | Key finding |
|---|---|---|
| 1. Copywriting | 2/4 | "Phase 4/5/9/10" dev copy live in staff UI; false quiz autosave claim; finance surfaces print raw enums/cuids/JSON |
| 2. Visuals | 3/4 | C2 shell applied consistently; residual pills/bordered cards, double h1 on hold-expired, nested <main>, auth panel buries form on phones |
| 3. Color | 3/4 | Zero raw hex in UI tsx, semantic tokens only; tone drift (open/queued = grey not blue, scarcity green), undefined `outline-focus` token |
| 4. Typography | 3/4 | Weights 400-700 compliant; body 14.5px off-scale, text-[28px] x6, [10px], text-2xl/lg, 176 arbitrary text-[..px] instead of named tokens |
| 5. Spacing | 3/4 | Mostly 4px grid; 1px-off magic header offsets (-mx-[25px]/-mt-[37px]/[41px]), h-[38px] x28, min-h-[46px]/[50px] |
| 6. Experience Design | 2/4 | No error.tsx anywhere; 8 loading.tsx for 77 routes; staff 404 falls into learner catalogue page; enrol loses intent; bare "session ended" text |

**Overall: 16/24**

## Top 10 fixes (ranked)
1. HIGH — Add app/error.tsx + app/global-error.tsx + staff/error.tsx + (learner)/error.tsx in-shell with retry.
2. HIGH — Remove Phase-N/dev copy: LessonFormFields.tsx:187, AssignmentDrawer.tsx:24-25, StaffAccountForm.tsx:20-21, RosterTab.tsx:92-96.
3. HIGH — Quiz: autosave or fix "Your answers save as you go" (QuizAttemptPanel.tsx:102); add submit confirm.
4. HIGH — Finance internals: ReconciliationCaseDetail.tsx JSON dumps/raw enums/cuid breadcrumb; ExportHistory.tsx raw ids/filters; ReportDashboard.tsx:233 raw filter values.
5. HIGH — Confirming timeout: add the promised support link, stop spinner (PollForPayment.tsx:66-70, confirming/page.tsx:37).
6. HIGH — Enrol flow: preserve return path through /signin and explain full/closed/already-enrolled redirects (enrol/[cohortId]/page.tsx).
7. HIGH — reports/[dataset]/page.tsx: replace nested <main> "Report unavailable." boxes with PageHeader + denied/notFound states.
8. MEDIUM — staff/not-found.tsx (in StaffShell) and learner lesson "not available" path instead of catalogue 404; add sign-in link to 18 "session ended" branches.
9. MEDIUM — Auth: back-to-sign-in + resend on check-email states; collapse navy panel on phones; per-field aria-invalid.
10. MEDIUM — Add loading.tsx for dashboard, learn, lesson, staff tables/details; skip-to-content link in all three shells; set body to 14px and tokenise text sizes.
