# Integration Report v1.0 (in progress)

## Review findings status

## Flows

## Staff nav/scoping

## Requirements map

### Review findings (verified in code)
- 05 CR-01 FIXED: attendance-service.ts:477 session.cancelledAt guard; :491 OFF_ROSTER_STATUSES enrolment guard (markAttendance); :552/:561 saveSessionAttendance guard + roster status notIn.
- 05 CR-02 FIXED (WARNING residual): cohort-service.ts publishCohort re-reads aggregate + re-evaluates readiness inside the tx before updateMany claim. Re-read is a plain findUnique (no FOR UPDATE on CohortInstructor/ScheduledSession); under READ COMMITTED a concurrent instructor-remove committing between re-read and claim still possible (narrow window).
- 05 CR-03 FIXED: enrolment-service.ts:173-178 lockCohortWithOffer FOR UPDATE; :567-573 both cohorts re-locked and same-offer re-validated in tx.
- 07 CR-01 FIXED: manual-payment-service.ts:243 routes through activateOrderAsSystem; checkout-webhook-system-service.ts:625-627 SELECT ... FOR UPDATE on Order; :660-686 re-check blocked status under lock.
- 07 WR-01 FIXED: second submit serializes on Order lock, sees PAID -> ALREADY_PAID (:661); plus findFirst on idempotencyKey (:718-745) before create.
- 07 WR-02 FIXED: providerRef written at checkout-webhook-system-service.ts:727 (manual), :917 and :953 (online success / exception).

### Staff nav / links
- All 115 literal internal route targets resolve to existing page/route files (incl. report datasets registry report-registry.ts:12-23). No dead links found.
- staff/layout.tsx:93-95 nav visibility uses can(perm, {}) -> only GLOBAL grants match (scope.ts grantMatches). Scoped (COHORT/COURSE/PROGRAMME) staff see only "Overview"; staff-overview-service.ts:93-101 likewise all can(...,{}) -> empty overview. List pages cohortService.list({}) / loadStaffEnrolments({}) / getStaffQueue (ticket-staff-queue-service.ts:178 () => ({})) are GLOBAL-only by design. => scoped instructor has no in-app path to /staff/cohorts/[id] (grading, attendance). WARNING (RBAC-04/05, ATT-01, ASM-05).

### Flow: discover -> register -> verify -> sign in -> intent -> checkout
- WIRED: CohortCards.tsx:52 form action enrollAction -> (checkout)/actions.ts:43 sets checkout_intent cookie `${cohortId}.${currency}` -> signin/actions.ts:46-49 consumes cookie -> landing.ts checkoutReturnPathFor -> /enrol/[cohortId]?currency -> startCheckout -> /checkout/[orderId].
- verify page (auth)/verify/page.tsx verifies on GET then links /signin (cookie survives same-browser only; by design).
### Flow: pay -> settlement
- Stripe: webhooks/stripe/route.ts:158-178 -> activateOrderAsSystem (providerIntentId=session.id matches checkout-service.ts:764).
- Paystack: webhooks/paystack/route.ts:111-123 verifyTransaction -> activateOrderAsSystem (providerIntentId=reference matches checkout-service.ts:830).
- Manual: manual-payment-service.ts:243 -> activateOrderAsSystem.
- WARNING (PAY-03/REG-05 retry): paystack/initialize.ts:60 uses reference = order.reference; each initiatePaystackPayment (checkout-service.ts:809-831) creates a NEW PaymentAttempt but re-sends the SAME reference. Paystack rejects duplicate transaction references -> a learner retrying Paystack on the same Order fails after an orphan PENDING attempt row is created; if Paystack accepted, several attempts would share providerIntentId and settlement findFirst (checkout-webhook-system-service.ts ~802) is ambiguous.
### Flow: grade -> completion -> certificate
- BROKEN LINK (design gap, unowned): completion-rule.ts:24-35 v1 = required lessons + attendance only; completion-service.ts:373-400 reads lessonProgress + attendance only. Phase 10 CONTEXT:29-31 deferred assessment->completion ("not this phase's problem"); Phase 11 never picked it up. recalculateCompletionAndIssue only called from lesson-progress-service.ts and attendance-service.ts; grading-service/attempt-service never trigger it. grade-override-service.ts:110 only flags certificates. => certificate can issue with no quiz/assignment passed; grade release has no completion effect. Affects LRN-07, CRD-01/02, ASM-05/07 flow.

### Refund -> enrolment/certificate
- PARTIAL: RefundDialog.tsx:121/230 -> payments/actions.ts:150 -> refund-service.ts:379 stores accessDecision RETAINED|REVOKED only; refund-service.ts:25-30 explicitly never changes access. accessDecision is not read anywhere else (no display on staff/payments/[orderId], reconciliation, reports; no prompt/link to cohort withdraw). REVOKED decision is a dead-end record: enrolment stays ACTIVE, certificate untouched. WARNING (PAY-05, PAY-13, CRD-05).
### Enrolment cancel/transfer -> progress/attendance/certificate
- Transfer: history intentionally stays on source (enrolment-service.ts:24-27). Attendance excludes TRANSFERRED/CANCELLED (fixed CR-01).
- WARNING: flagCertificateForReview (certificate-issuance-service.ts:522-543) returns COMPLETED->ACTIVE while certificate stays ACTIVE. ACTIVE enrolment can then be withdrawn/cancelled/transferred (enrolment-transitions.ts:72) and enrolment-service has no certificate check -> ACTIVE, publicly verifiable certificate (certificate-verification-service.ts:81 checks only certificate.status) on a CANCELLED/TRANSFERRED enrolment. (COH-05, CRD-05/06)

### Support ticket <-> enrolment/order context
- Learner side WIRED: GetSupportLink (components/support/GetSupportLink.tsx) used in learn/[enrolmentId]/page.tsx:198 (COHORT), orders/[reference]/page.tsx:202 (ORDER), CertificateSlot.tsx:105, ResultsList.tsx:156 -> /support/new?contextKind&contextId -> parseLearnerContextHint/validate -> ticket-service create persists one context FK.
- BLOCKER (SUP-05): staff side never resolves context. ticket-service.ts:222-236 contextDto hardcodes `href: null, locked: true` for every ticket; createTicketContextService (ticket-context-service.ts:54, the fresh-authorize resolver) is ORPHANED — never instantiated anywhere. StaffTicketDetail.tsx:70 only links when href && !locked -> staff can never open the linked order/cohort/submission/certificate from a ticket, even with GLOBAL permissions. No USER/learner link either.
- WARNING (CRD-06): staff-overview-service.ts:233 links "/staff/certificates/issued?status=flagged" but issued/page.tsx ignores searchParams and IssuedCertificatesTable.tsx:94 initialises filter "" -> link lands unfiltered.

### Other verified wiring
- Grade release: GradingQueueTable.tsx:8 releaseGradesBatchAction -> grading-service.ts:614 RELEASED -> learner-results-service.ts:75 filters RELEASED -> dashboard ResultsSection / /learn/[id]/results. WIRED.
- Lesson page imports QuizAttemptPanel/AssignmentSubmissionPanel + loadLearnerQuiz (lessons/[lessonId]/page.tsx:21-24). WIRED.
- Completion triggers: lesson-progress-service.ts:389/453/579/715 and attendance-service.ts:429 -> recalculateCompletionAndIssue (certificate-issuance-service.ts:751) -> issue + enrolment COMPLETED (:464). WIRED.
- Certificate download CertificateSlot.tsx:49 -> api/certificates/[id]/download (staff then learner owner path). Public verify: layouts link /verify-certificate -> VerifyReferenceForm.tsx:46 -> /verify/[ref] -> verifyCertificateByRef. WIRED.
- Confirmation emails: checkout-webhook-system-service.ts:95 imports email-dispatch-service. Scheduled jobs: netlify/functions/* -> src/server/scheduled/* (holds, exports, reconcile, tickets, uploads). WIRED.
- Password reset IS wired (forgot-password/actions.ts:27, reset-password/actions.ts:20, SignInForm.tsx:39) -> REQUIREMENTS.md IAM-03 note "password reset still missing" is stale.
- WARNING (ASM-07/LRN-01): COMPLETED learner loses results: dashboard/page.tsx:37 renders ResultsSection only when primaryActive; /learn/[id]/results uses loadLearnerPath default ACTIVE-only (learner-access.ts:422) -> 404 after certificate issuance.
- WARNING (docs): REQUIREMENTS.md still has 72 unchecked boxes incl. built-phase IDs IAM-01/02/03/05/06, CAT-02..08, COH-*, ATT-*, LRN-01/02/03/06/07, PAY-03..08/11..17, RPT-*.
- WARNING (COH-04): CR-02 residual — no FOR UPDATE / serializable in cohort-service.ts or scheduled-session-service.ts; instructor removal committing between tx re-read and claim can still publish.

## Requirements Integration Map
| Group | Status | Issue |
|---|---|---|
| RBAC-01..08 (Ph1/2) | PARTIAL | Enforcement WIRED everywhere; scoped staff get no nav/list discovery (layout.tsx:94, overview :93-101) |
| IAM-01..06 (Ph2/3) | WIRED | REQUIREMENTS.md checkboxes stale |
| CAT-01..08 (Ph1/4) | WIRED | public catalogue -> CohortCards -> enrollAction |
| COH-01..07, ATT-01..04 (Ph5) | WIRED (W) | CR-01/03 fixed; CR-02 residual; flagged-cert enrolment cancel leaves ACTIVE cert |
| REG-01..05, PAY-02/09/10 (Ph6) | WIRED | intent cookie survives auth; webhooks settle |
| PAY-03..17 (Ph7) | PARTIAL | Paystack retry reuses order.reference; refund accessDecision REVOKED never acted/shown |
| PAY-06/12, RPT-01..05 (Ph8) | WIRED | collection-scope on reports/reconciliation/audit/exports |
| LRN-01..07 (Ph9) | PARTIAL | LRN-07 completion excludes assessments; completed learner loses results |
| ASM-01..07 (Ph10) | PARTIAL | grades never feed completion (only flag certs) |
| CRD-01..06 (Ph11) | PARTIAL | issues without assessment pass; flagged filter link ignored |
| SUP-01..06 (Ph12) | PARTIAL | SUP-05 staff context always locked; resolver orphaned (BLOCKER) |
