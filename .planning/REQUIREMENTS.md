# Requirements: Professional Training LMS

**Defined:** 2026-09-01
**Core Value:** The complete learner + operator journey (discover → register → verify → pay → learn → attend → submit → grade → complete → download certificate) runs end to end against real seeded data, with every mutation authorized, scoped, and audited.

**Source:** `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` (product authority) unless otherwise noted. Full acceptance criteria and section references: `.planning/intel/requirements.md`.

## v1 Requirements

Requirements for the complete PRD/PXR scope through launch readiness. Each maps to exactly one roadmap phase (see Traceability).

### Identity and Account Management (IAM)

- [ ] **IAM-01**: Public visitor can create a Learner account with email/password and accept required policies; duplicate active email is prevented, consent versions recorded, one verification message sent.
- [ ] **IAM-02**: Account ownership is verified through a single-use, expiring email link that activates the account once; expired/used tokens show a recoverable path without revealing unrelated account data.
- [ ] **IAM-03**: Email/password sign-in, sign-out, password reset, and secure session management — rate-limited credentials, expiring reset tokens, selective/global session revocation. *(Sign-in/out/lockout/session revocation implemented; password reset still missing — remains Active.)*
- [x] **IAM-04**: Authorized staff can create/invite staff accounts and deactivate/reactivate accounts, with actor/reason/time/resulting-state audited.
- [ ] **IAM-05**: Users can maintain approved profile fields and communication preferences within validation and consent rules.
- [ ] **IAM-06**: Protection against account enumeration, brute force, credential stuffing, and unsafe session reuse; non-enumerating errors; testable rate/lock controls; security events logged without secrets.

<!-- IAM-03 checkbox left unchecked deliberately: password reset (part of this requirement's acceptance) is not yet implemented. See Traceability status. -->

### Roles, Permissions, and Access Control (RBAC)

- [x] **RBAC-01**: A new deployment seeds Administrator, Programme Manager, Instructor, Finance/Operations, and Learner as five active default roles with documented permission sets; no separate mandatory Support role.
- [x] **RBAC-02**: Authorized administrators can edit, activate, and deactivate roles; changes create a new version, preserve prior versions, require a reason for sensitive reductions.
- [x] **RBAC-03**: Custom roles are created from the approved permission catalogue, stored as schema-validated JSON; unknown permissions, malformed JSON, duplicates, missing fields, or invalid version/state are rejected.
- [x] **RBAC-04**: Any active staff account can receive one or more role assignments; effective permissions are the union of matching active grants; revocation removes only the selected assignment.
- [x] **RBAC-05**: Global, Programme, Course, and Cohort assignment scope are supported; a scoped grant authorizes only matching resources and documented child relationships.
- [x] **RBAC-06**: Authorization is enforced on the server for every protected read, write, export, and file access; direct requests without a matching permission/scope are denied even if client controls are manipulated.
- [x] **RBAC-07**: Removal of the final active role/permission administrator is prevented, with a clear remediation message.
- [x] **RBAC-08**: Role definitions, versions, assignments, scope changes, revocations, and authorization-sensitive actions are audited with actor, target, before/after, scope, reason, timestamp, correlation.

### Catalogue, Programmes, Courses, and Content (CAT)

- [x] **CAT-01**: Reusable Courses with title, summary, outcomes, audience, prerequisites, duration, media, and status can be created and maintained — draft, validate, preview, archive, locate without duplicate source content.
- [ ] **CAT-02**: Programmes are created as ordered sets of one or more existing Courses; Courses can be added/removed/reordered in draft; one Course can belong to multiple Programmes without cloning.
- [ ] **CAT-03**: Ordered Modules and Lessons can be created inside a Course; add, reorder, edit, preview, and mark required content; ordering is stable after save.
- [ ] **CAT-04**: Text, files, images, uploaded standard video, embedded video links, external links, Quizzes, and Assignments are supported; each validates supported format/size and renders an accessible learner view.
- [ ] **CAT-05**: Published Course content is versioned; active Cohorts are protected from silent requirement changes — staff select whether a later version applies to future or explicitly selected Cohorts.
- [ ] **CAT-06**: An Instructor with `courses.publish` in matching scope can publish an assigned Course; the control and server action are gated on the permission; publication records actor, version, time.
- [ ] **CAT-07**: Public Course and Programme catalogue pages are published independently from learning-content publication state; only readiness-passing offers appear publicly; direct unpublished URLs reveal nothing.
- [ ] **CAT-08**: Catalogue records can be archived without breaking historical enrolments, results, or certificates; archived records disappear from new-sale flows but remain readable where policy permits.

### Cohorts, Scheduling, and Enrolment Operations (COH)

- [ ] **COH-01**: A Cohort is created for either one standalone Course or one Programme; the offer type is unambiguous and immutable after enrolment begins except through an approved migration path.
- [ ] **COH-02**: Enrolment window, start/end dates, time zone, capacity, price, currency, delivery mode, instructors, and status can be set; date/capacity conflicts block publication.
- [ ] **COH-03**: Scheduled sessions can be created with title, date/time, duration, location/meeting link, facilitator, and attendance expectation; link visibility follows enrolment and access-timing rules.
- [ ] **COH-04**: A Cohort publishes only when catalogue, schedule, pricing, instructor, capacity, and completion readiness checks pass; pass/fail readiness items are shown; publish is permission-gated.
- [ ] **COH-05**: Authorized staff can add, approve, transfer, withdraw, or cancel enrolments with a reason; state transitions are validated, audited, communicated, and never create duplicate active enrolments.
- [ ] **COH-06**: Capacity is enforced during checkout and administrative enrolment; concurrent attempts cannot exceed capacity; released/expired reservations become available per policy.
- [ ] **COH-07**: Cohort-level views of learners, access, progress, attendance, assessment, completion, and exceptions are available; staff can filter and open a learner detail without viewing out-of-scope Cohorts.

### Registration, Orders, and Enrolment (REG)

- [ ] **REG-01**: A public visitor can select an open Cohort from a Course or Programme offer, seeing current price, dates, delivery mode, availability, prerequisites, and completion expectation.
- [ ] **REG-02**: The selected offer is preserved through registration, verification, and sign-in; after identity completion the learner returns to the intended order if still valid.
- [ ] **REG-03**: One traceable order is created per checkout attempt; duplicate enrolment on replay is prevented; idempotent processing produces at most one successful payment effect and one active enrolment.
- [ ] **REG-04**: Required terms, privacy notice, refund/cancellation policy, and marketing consent are presented and recorded separately, with policy versions, learner, order, and time stored.
- [ ] **REG-05**: Transactional confirmation is sent and a receipt/order record is exposed after successful enrolment, showing order reference, offer, amount, payment state, enrolment state, and support route.

### Payments, Manual Confirmation, Refunds, and Reconciliation (PAY)

- **PAY-01**: *Superseded within the PRD itself* — the original "one approved online payment gateway" pilot assumption is replaced by PAY-08 onward (§19, multi-gateway payments). Not tracked as an independent v1 item; see PAY-08.
- [ ] **PAY-02**: Payment states (pending, processing, succeeded, failed, cancelled, refunded, partially refunded where supported) are represented; transitions are valid, idempotent, timestamped, and visible appropriately.
- [ ] **PAY-03**: Authorized staff with `payments.confirm` can confirm an approved offline/manual payment; amount, currency, date, channel, reference, evidence/note, and reason are required; one audit event and one enrolment effect result.
- [ ] **PAY-04**: Duplicate or conflicting online/manual confirmation is prevented; a second success attempt is rejected or safely reconciled, showing staff the existing transaction and a corrective path.
- [ ] **PAY-05**: Authorized staff with `refunds.manage` can record/initiate approved refunds; amount, reason, approver/reference, resulting access decision, actor, and time are preserved; amount cannot exceed eligible paid value.
- [ ] **PAY-06**: Payment and refund reconciliation views and CSV exports are available; totals reconcile to transaction rows for the same filters; manual and gateway records are distinguishable; exports are permission-protected.
- [ ] **PAY-07**: Delayed, duplicated, or out-of-order gateway notifications are handled safely; webhook replay/ordering does not duplicate enrolment, receipt, or financial effect; ambiguous cases enter a visible exception state.
- [ ] **PAY-08**: A learner can select Paystack, Stripe, or approved manual payment only when the method is available for the current order; unavailable options cannot be chosen. *(Supersedes PAY-01's single-gateway assumption.)*
- [ ] **PAY-09**: Provider-specific Paystack and Stripe integrations sit behind one product-owned payment interface and shared state machine; provider differences do not change the learner's enrolment/receipt/audit/support model.
- [ ] **PAY-10**: Paystack and Stripe results are verified server-side using approved correlation/signature controls before payment success is recorded; redirect manipulation and invalid webhooks cannot mark an order paid.
- [ ] **PAY-11**: Payment initiation, confirmation, failure, cancellation, refund, and reconciliation are idempotent across methods; repeated/reordered events and method switching produce at most one successful payment effect and active enrolment.
- [ ] **PAY-12**: Provider, currency, transaction/reference, payment state, and safe exception context are exposed to authorized Finance/Operations users with provider-filtered reconciliation/export views.
- [ ] **PAY-13**: An authorized refund routes to the original provider where supported, or records a controlled manual refund outcome; amount cannot exceed eligible paid value; reason/approver/outcome/actor/time are auditable.
- [ ] **PAY-14**: Gateway credentials and webhook secrets stay in deployment-managed secret storage — never in the browser, exports, audit detail, staff UI, or source control; staff may see enabled provider status but not secrets.

### Learning Delivery and Progress (LRN)

- [ ] **LRN-01**: Each learner sees an enrolment dashboard with next action, progress, scheduled sessions, assessment obligations, results, tickets, and certificate state — own records only.
- [ ] **LRN-02**: Published Modules and Lessons render in defined order with prerequisite locks where configured; required sequencing is enforced server-side; locked content explains the unmet condition.
- [ ] **LRN-03**: Supported lesson content is delivered securely and accessibly — text, images, permitted files, uploaded video, embeds, links — with appropriate labels, keyboard behavior, and authorized file access.
- [ ] **LRN-04**: Learner progress is tracked using completion rules appropriate to each content type; progress is idempotent, attributable, timestamped, recalculable, and not advanced by unauthorized requests.
- [ ] **LRN-05**: Manual Lesson completion is allowed only where the published rule permits it, only by the enrolled learner in the valid access window, reversible only per policy.
- [ ] **LRN-06**: Scheduled-session details and meeting links are provided to eligible learners; links are hidden before the visibility window and from unenrolled users; time-zone/access guidance is clear.
- [ ] **LRN-07**: Course and Programme completion is calculated from versioned rules and current learner evidence; the calculation identifies each satisfied/unmet rule, handles corrections, and records completion time and rule version.

### Attendance (ATT)

- [ ] **ATT-01**: Authorized staff can mark attendance for scheduled sessions using present/absent/late/excused/not-recorded; each change records actor, time, state, optional note; bulk entry cannot affect out-of-scope learners.
- [ ] **ATT-02**: A configured attendance threshold is supported as a Course/Programme completion rule; learner and staff see earned/required attendance; completion recalculates after correction.
- [ ] **ATT-03**: Authorized attendance correction after the normal marking window requires a mandatory reason; before/after values and reason remain in audit history and are reflected consistently.
- [ ] **ATT-04**: Attendance exceptions (missing registers, at-risk learners, disputed/corrected states) are exposed to staff dashboards and learner detail, filterable with matching CSV values.

### Quizzes, Assignments, Grading, and Feedback (ASM)

- [ ] **ASM-01**: Quizzes are created with questions, options/answers, marks, pass threshold, attempt limit, availability, and feedback behavior; draft validation catches incomplete questions; published settings are versioned.
- [ ] **ASM-02**: Supported objective Quiz questions are scored automatically with reproducible calculation; attempts store start/submit time, answers, version, result, status.
- [ ] **ASM-03**: Assignments are created with instructions, due date, permitted file types/size, grading scale, and resubmission policy; published constraints apply consistently to server validation.
- [ ] **ASM-04**: Assignment submissions are accepted and issue a durable receipt; a successful submission stores file metadata/reference, learner, assessment version, time, attempt, receipt ID; failures never display false success.
- [ ] **ASM-05**: Authorized graders can view in-scope submissions, record grades/feedback, save drafts, and release results; learners cannot see draft grades; release is explicit and attributed.
- [ ] **ASM-06**: An authorized grade override/correction requires a mandatory reason; original/revised value, actor, reason, time, and completion/certificate impact are preserved.
- [ ] **ASM-07**: Learners see released results, feedback, attempt history, and unmet pass requirements; only released/permitted details appear.

### Certificates and Verification (CRD)

- [ ] **CRD-01**: A Course certificate issues only when standalone Course completion rules pass and issuance is enabled; the event is idempotent and references the rule/version and enrolment.
- [ ] **CRD-02**: One Programme certificate issues after all required Programme Courses and Programme-level rules pass; partial completion does not issue the credential.
- [ ] **CRD-03**: A downloadable certificate with a unique verification reference and minimum approved learner/award fields is generated; readable, access-controlled, stable for the credential version.
- [ ] **CRD-04**: Public certificate verification returns active/revoked status and approved award facts for a valid reference; unknown references reveal no user-account data.
- [ ] **CRD-05**: Authorized revocation and reissue with reason and audit history is supported; revocation changes public status promptly; reissue links old/new credential versions.
- [ ] **CRD-06**: Certificate status is re-evaluated after an authorized grade, attendance, or completion correction; affected credentials are flagged for review, never silently destroyed.

### Communications and Notifications (COM)

- [ ] **COM-01**: Transactional emails are sent for verification, password reset, order/payment outcome, enrolment, session change, result release, certificate issuance/revocation, and ticket activity — approved template, correct recipient, delivery record, no sensitive secrets.
- [ ] **COM-02**: Duplicate transactional messages during retries/idempotent processing are prevented; repeated events within the same correlation produce at most one intended notification.
- [ ] **COM-03**: Important in-product notifications/dashboard alerts are shown for learner and staff actions; users see unread/current state and open the relevant authorized record; stale links fail safely.
- [ ] **COM-04**: One approved client sender identity and brand, configured at deployment, is used consistently; no tenant-level editor is required.

### Support Tickets (SUP)

- [ ] **SUP-01**: Learners can create and view their own support tickets with category, subject, description, and permitted attachments; a ticket receives a reference and status; unsafe files are rejected.
- [ ] **SUP-02**: Priority, status, assignment, public reply, private internal note, and closure/reopen behavior are supported; public/private content stay distinctly labeled and permission-protected; transitions are timestamped/attributed.
- [ ] **SUP-03**: Ticket access is granted through `tickets.view`/`tickets.manage` without requiring Administrator status; a custom Support Agent role can triage/resolve while denied unrelated permissions.
- [ ] **SUP-04**: Escalation to another staff owner/queue with reason is supported; escalation preserves history, notifies the next owner per policy, and stays visible in operational reporting.
- [ ] **SUP-05**: Permitted contextual links to learner, Cohort, Course, order, submission, or certificate records are allowed; opening context performs a fresh permission/scope check.
- [ ] **SUP-06**: Ticket volume, age, priority, status, ownership, response, resolution, and escalation are reportable; dashboard and CSV values reconcile for the same filters and exclude private note content.

### Dashboards, Reports, Exports, and Audit (RPT)

- [ ] **RPT-01**: Fixed operational dashboards exist for registrations, payments, enrolments, attendance, progress, submissions, grades, completion, certificates, and support; each states metric definition, filter context, last-refreshed time, and empty/error behavior.
- [ ] **RPT-02**: The requesting user's permissions and scope apply to every dashboard, aggregate, drill-down, and export; out-of-scope data cannot be inferred through totals, filters, identifiers, downloads, or direct requests.
- [ ] **RPT-03**: CSV export is provided for the defined operational datasets, with stable column definitions, applied filters, generation time, and a row-level reconciliation path.
- [ ] **RPT-04**: Large exports process asynchronously with queued, processing, succeeded, failed, expired, and retry states; users can leave the screen, see job state later, retry safely, and download only via time-limited authorized access.
- [ ] **RPT-05**: An authorized, filterable audit view and export exists for security and sensitive business actions; audit records are append-only, include correlation data, and redact secrets while preserving investigative value.

### Non-Functional, Security, Accessibility, and Operational Requirements (NFR)

- [ ] **NFR-01**: Availability — at least 99.5% monthly availability for production, excluding approved/communicated maintenance windows.
- [ ] **NFR-02**: Interactive performance — common authenticated page views reach usable primary content within 2.5s at p75 under expected pilot load.
- [ ] **NFR-03**: Reliability and idempotency — payments, enrolment activation, submissions, completion, certificate issuance, notification dispatch, and export creation tolerate retries without duplicate business effects.
- [ ] **NFR-04**: Security baseline — current supported components, TLS in transit, encryption at rest where applicable, secure password hashing, secret management, input validation, rate limiting, dependency scanning, least privilege.
- [ ] **NFR-05**: Authorization — all protected server operations and private-file downloads evaluate identity, active permissions, assignment scope, record state; tests cover direct-request bypass attempts.
- [ ] **NFR-06**: Private files and reports — downloads use short-lived authorized access; public storage URLs, predictable object paths, and permanent report links are prohibited.
- [ ] **NFR-07**: Audit and observability — security/sensitive business events include time, actor, target, action, outcome, correlation, safe context; monitoring detects failed jobs, payment exceptions, email failures, error-rate changes.
- [ ] **NFR-08**: Backup and recovery — production data backed up to meet RPO 24h/RTO 8h; a pilot-stage restore rehearsal demonstrates documented recovery steps.
- [ ] **NFR-09**: Accessibility — core public, learner, and staff journeys align with WCAG 2.2 AA (keyboard, focus, semantics, contrast, error identification, zoom/reflow, accessible media alternatives).
- [ ] **NFR-10**: Responsive web — core journeys remain usable across agreed desktop/mobile-web viewports; no unintended horizontal scrolling on primary forms/content.
- [ ] **NFR-11**: Privacy and data lifecycle — collect only necessary data; record lawful/consent basis; support access/export, correction, retention, deletion/anonymization, legal hold per approved policy.
- [ ] **NFR-12**: Compatibility and supportability — support agreed current/previous major versions of Chrome, Edge, Firefox, Safari; document deployment, rollback, job recovery, operational runbooks.
- [ ] **NFR-13**: Asynchronous work — long-running work exposes queued/processing/succeeded/failed/retrying states; retries bounded, observable, safe.
- [ ] **NFR-14**: Data integrity — foreign-key/business invariants, unique constraints, transactional boundaries, reconciliation checks protect enrolment, payment, grading, completion, and credential records.

### Software Licence and Deployment Control (LIC)

<!-- v1 scope per PRD §18.3 (all MUST), but implementation is contingent on commercial-terms approval per docs/TRACK-A-TASKS.md ("gated on commercial terms nobody has approved, §18.6"). See ROADMAP.md Phase 14 note and PROJECT.md Key Decisions. -->

- [ ] **LIC-01**: The LMS verifies a provider-signed licence with a public verification key and rejects altered, expired, wrong-client, wrong-deployment, or otherwise invalid licences.
- [ ] **LIC-02**: An Administration > Licence & System Status screen is provided for users with `licence.view`, showing state, licence ID, registered client, relevant dates, validation result, renewal/support route — no signing secrets exposed.
- [ ] **LIC-03**: Only a tightly restricted `licence.activate` permission may activate a provider-issued licence; the UI never offers licence creation, date extension, plan editing, signature replacement, or self-authorized reactivation.
- [ ] **LIC-04**: Licence checks run at startup, on an approved scheduled cadence, and before high-impact mutations; temporary validation unavailability uses a bounded, approved offline-validation policy and warns Administrators.
- [ ] **LIC-05**: When the approved expiry/grace threshold is reached, the LMS enforces the configured restricted/read-only state server-side and in the UI; direct requests cannot bypass restrictions.
- [ ] **LIC-06**: Licence activation, validation outcome, state transition, restriction enforcement, and authorized data export are audited with actor/system actor, time, target licence, outcome, correlation, safe context.
- [ ] **LIC-07**: Authorized Administrators are notified of renewal-warning, grace, expiry, invalid, and validation-attention states through the transactional/in-product notification model; messages are deduplicated.
- [ ] **LIC-08**: Read-only restrictions preserve records and the permitted export/data-access route; expiry never deletes client data or silently makes it unavailable beyond agreed restrictions.

## v2 Requirements

None yet. This milestone's roadmap spans the complete PRD Revision 3 / PXR Revision 3 scope through launch readiness, per explicit user directive (see PROJECT.md Key Decisions). Future enhancements beyond PRD Revision 3 would be logged here.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Tenant selector / multi-tenant platform operator model | PXR §1 scope guardrail — single-client deployment, not a platform |
| Cross-client reporting and reseller functions | PXR §1 scope guardrail — no multi-client commercial model |
| Self-service branding / tenant configuration | One approved client brand + sender identity per deployment is sufficient (COM-04) |
| Google Classroom workflow integration | PXR §1 scope guardrail |
| Google Drive learning-record integration | PXR §1 scope guardrail |
| Separate "Offering" entity / alternative commercial model | PRD's Course/Programme/Cohort model is the only commercial model; PXR adds no alternative |
| Native mobile apps | Ruled out by PRD §5.2 for this release |
| Public API marketplace | Ruled out by PRD §5.2 for this release; reinforces the one-app/one-repo decision |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RBAC-05 | Phase 1 | Complete |
| RBAC-06 | Phase 1 | Complete |
| CAT-01 | Phase 1 | Complete |
| RBAC-01 | Phase 2 | Complete |
| RBAC-02 | Phase 2 | Complete |
| RBAC-03 | Phase 2 | Complete |
| RBAC-04 | Phase 2 | Complete |
| RBAC-07 | Phase 2 | Complete |
| RBAC-08 | Phase 2 | Complete |
| IAM-04 | Phase 2 | Complete |
| IAM-01 | Phase 3 | Pending |
| IAM-02 | Phase 3 | Pending |
| IAM-03 | Phase 3 | In Progress (sign-in/out/lockout/session revocation done; password reset pending) |
| IAM-05 | Phase 3 | Pending |
| IAM-06 | Phase 3 | Pending |
| CAT-02 | Phase 4 | Pending |
| CAT-03 | Phase 4 | Pending |
| CAT-04 | Phase 4 | Pending |
| CAT-05 | Phase 4 | Pending |
| CAT-06 | Phase 4 | Pending |
| CAT-07 | Phase 4 | Pending |
| CAT-08 | Phase 4 | Pending |
| COH-01 | Phase 5 | Pending |
| COH-02 | Phase 5 | Pending |
| COH-03 | Phase 5 | Pending |
| COH-04 | Phase 5 | Pending |
| COH-05 | Phase 5 | Pending |
| COH-06 | Phase 5 | Pending |
| COH-07 | Phase 5 | Pending |
| ATT-01 | Phase 5 | Pending |
| ATT-02 | Phase 5 | Pending |
| ATT-03 | Phase 5 | Pending |
| ATT-04 | Phase 5 | Pending |
| REG-01 | Phase 6 | Pending |
| REG-02 | Phase 6 | Pending |
| REG-03 | Phase 6 | Pending |
| REG-04 | Phase 6 | Pending |
| REG-05 | Phase 6 | Pending |
| PAY-02 | Phase 6 | Pending |
| PAY-09 | Phase 6 | Pending |
| PAY-10 | Phase 6 | Pending |
| PAY-01 | — | Superseded by PAY-08 (document-internal revision, PRD §19) |
| PAY-03 | Phase 7 | Pending |
| PAY-04 | Phase 7 | Pending |
| PAY-05 | Phase 7 | Pending |
| PAY-07 | Phase 7 | Pending |
| PAY-08 | Phase 7 | Pending |
| PAY-11 | Phase 7 | Pending |
| PAY-13 | Phase 7 | Pending |
| PAY-14 | Phase 7 | Pending |
| PAY-06 | Phase 8 | Pending |
| PAY-12 | Phase 8 | Pending |
| RPT-01 | Phase 8 | Pending |
| RPT-02 | Phase 8 | Pending |
| RPT-03 | Phase 8 | Pending |
| RPT-04 | Phase 8 | Pending |
| RPT-05 | Phase 8 | Pending |
| LRN-01 | Phase 9 | Pending |
| LRN-02 | Phase 9 | Pending |
| LRN-03 | Phase 9 | Pending |
| LRN-04 | Phase 9 | Pending |
| LRN-05 | Phase 9 | Pending |
| LRN-06 | Phase 9 | Pending |
| LRN-07 | Phase 9 | Pending |
| ASM-01 | Phase 10 | Pending |
| ASM-02 | Phase 10 | Pending |
| ASM-03 | Phase 10 | Pending |
| ASM-04 | Phase 10 | Pending |
| ASM-05 | Phase 10 | Pending |
| ASM-06 | Phase 10 | Pending |
| ASM-07 | Phase 10 | Pending |
| CRD-01 | Phase 11 | Pending |
| CRD-02 | Phase 11 | Pending |
| CRD-03 | Phase 11 | Pending |
| CRD-04 | Phase 11 | Pending |
| CRD-05 | Phase 11 | Pending |
| CRD-06 | Phase 11 | Pending |
| SUP-01 | Phase 12 | Pending |
| SUP-02 | Phase 12 | Pending |
| SUP-03 | Phase 12 | Pending |
| SUP-04 | Phase 12 | Pending |
| SUP-05 | Phase 12 | Pending |
| SUP-06 | Phase 12 | Pending |
| COM-01 | Phase 13 | Pending |
| COM-02 | Phase 13 | Pending |
| COM-03 | Phase 13 | Pending |
| COM-04 | Phase 13 | Pending |
| LIC-01 | Phase 14 | Pending |
| LIC-02 | Phase 14 | Pending |
| LIC-03 | Phase 14 | Pending |
| LIC-04 | Phase 14 | Pending |
| LIC-05 | Phase 14 | Pending |
| LIC-06 | Phase 14 | Pending |
| LIC-07 | Phase 14 | Pending |
| LIC-08 | Phase 14 | Pending |
| NFR-01 | Phase 15 | Pending |
| NFR-02 | Phase 15 | Pending |
| NFR-03 | Phase 15 | Pending |
| NFR-04 | Phase 15 | Pending |
| NFR-05 | Phase 15 | Pending |
| NFR-06 | Phase 15 | Pending |
| NFR-07 | Phase 15 | Pending |
| NFR-08 | Phase 15 | Pending |
| NFR-09 | Phase 15 | Pending |
| NFR-10 | Phase 15 | Pending |
| NFR-11 | Phase 15 | Pending |
| NFR-12 | Phase 15 | Pending |
| NFR-13 | Phase 15 | Pending |
| NFR-14 | Phase 15 | Pending |

**Coverage:**

- v1 requirements: 109 total (108 active + 1 superseded-in-document, PAY-01)
- Mapped to phases: 108
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-01*
*Last updated: 2026-09-01 after initial roadmap generation from brownfield ingest*
