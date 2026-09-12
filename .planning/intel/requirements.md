# Requirements (PRD-sourced)

Source for all entries below unless otherwise noted:
`docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` (precedence 0 — product authority for this ingest per manifest).

Priority key: MUST = pilot-critical, SHOULD = valuable/expected unless deferred, LATER = explicitly out-of-pilot.

---

## REQ-IAM-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.1
- description: Allow a public visitor to create a Learner account using email and password and accept required policies. (Priority: MUST)
- acceptance: Valid registration creates an inactive/unverified account, prevents duplicate active email use, records consent versions, and sends one verification message.
- scope: Identity and account management

## REQ-IAM-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.1
- description: Verify account ownership through a single-use, expiring email link. (Priority: MUST)
- acceptance: A valid token activates the account once; expired or used tokens show a recoverable path without revealing unrelated account data.
- scope: Identity and account management

## REQ-IAM-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.1
- description: Support email/password sign-in, sign-out, password reset, and secure session management. (Priority: MUST)
- acceptance: Credentials are rate-limited and safely stored; reset tokens expire; session revocation invalidates selected or all sessions within the propagation target.
- scope: Identity and account management

## REQ-IAM-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.1
- description: Allow authorized staff to create or invite staff accounts and deactivate/reactivate accounts. (Priority: MUST)
- acceptance: The actor, reason, time, and resulting state are audited; deactivation prevents new access while preserving history.
- scope: Identity and account management

## REQ-IAM-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.1
- description: Allow users to maintain approved profile fields and communication preferences. (Priority: SHOULD)
- acceptance: Changes validate required formats, preserve immutable audit identifiers, and apply consent rules.
- scope: Identity and account management

## REQ-IAM-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.1
- description: Protect against account enumeration, brute force, credential stuffing, and unsafe session reuse. (Priority: MUST)
- acceptance: Error text is non-enumerating; rate/lock controls are testable; security events are logged without passwords or secrets.
- scope: Identity and account management

## REQ-RBAC-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Seed Administrator, Programme Manager, Instructor, Finance/Operations, and Learner roles. (Priority: MUST)
- acceptance: A new deployment contains all five active roles with documented initial permission sets and no separate mandatory Support role.
- scope: Roles, permissions, and access control

## REQ-RBAC-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Allow authorized administrators to edit, activate, and deactivate default or custom roles. (Priority: MUST)
- acceptance: Changes create a new role version, preserve prior versions, require a reason for sensitive reductions, and affect authorization within the propagation target.
- scope: Roles, permissions, and access control

## REQ-RBAC-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Allow custom roles to be created from the approved permission catalogue and stored as schema-validated JSON. (Priority: MUST)
- acceptance: Unknown permission strings, malformed JSON, duplicate permissions, missing required fields, or invalid version/state values are rejected.
- scope: Roles, permissions, and access control

## REQ-RBAC-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Allow any active staff account to receive one or more role assignments. (Priority: MUST)
- acceptance: Assignments may coexist; effective permissions are the union of matching active grants; revocation removes only the selected assignment.
- scope: Roles, permissions, and access control

## REQ-RBAC-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Support global, Programme, Course, and Cohort assignment scope. (Priority: MUST)
- acceptance: A scoped grant authorizes only matching resources and their documented child relationships; sibling or unrelated records remain inaccessible.
- scope: Roles, permissions, and access control

## REQ-RBAC-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Enforce authorization on the server for every protected read, write, export, and file access. (Priority: MUST)
- acceptance: Direct requests without a matching permission/scope receive a denial even if a client control is manipulated.
- scope: Roles, permissions, and access control

## REQ-RBAC-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Prevent removal of the final active role/permission administrator. (Priority: MUST)
- acceptance: A change that would leave no active user with role-management authority is blocked with a clear remediation message.
- scope: Roles, permissions, and access control

## REQ-RBAC-08
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.2
- description: Audit role definitions, versions, assignments, scope changes, revocations, and authorization-sensitive actions. (Priority: MUST)
- acceptance: Authorized reviewers can identify actor, target, before/after values, scope, reason where required, timestamp, and correlation reference.
- scope: Roles, permissions, and access control

## REQ-CAT-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Create and maintain reusable Courses with title, summary, outcomes, audience, prerequisites, duration, media, and status. (Priority: MUST)
- acceptance: Authorized users can save drafts, validate required fields, preview, archive, and locate Courses without duplicate source content.
- scope: Catalogue, Programmes, Courses, and content

## REQ-CAT-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Create Programmes as ordered sets of one or more existing Courses. (Priority: MUST)
- acceptance: Courses can be added, removed, and ordered in draft; one Course can belong to multiple Programmes without being cloned.
- scope: Catalogue, Programmes, Courses, and content

## REQ-CAT-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Create ordered Modules and Lessons inside a Course. (Priority: MUST)
- acceptance: Authorized users can add, reorder, edit, preview, and mark required content; ordering is stable after save.
- scope: Catalogue, Programmes, Courses, and content

## REQ-CAT-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Support text, files, images, uploaded standard videos, embedded video links, external links, Quizzes, and Assignments. (Priority: MUST)
- acceptance: Each type validates supported format/size and renders an accessible learner view; unsupported or unsafe content is rejected.
- scope: Catalogue, Programmes, Courses, and content

## REQ-CAT-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Version published Course content and protect active Cohorts from silent requirement changes. (Priority: MUST)
- acceptance: Publishing creates a version; staff select whether a later version applies to future or explicitly selected Cohorts; active obligations remain traceable.
- scope: Catalogue, Programmes, Courses, and content

## REQ-CAT-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Allow an Instructor to publish an assigned Course when granted courses.publish within matching scope. (Priority: MUST)
- acceptance: The publish control and server action are available only with the permission; publication records actor, version, and time.
- scope: Catalogue, Programmes, Courses, and content

## REQ-CAT-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Publish public Course and Programme catalogue pages independently from the learning-content publication state. (Priority: MUST)
- acceptance: Only offers that pass readiness checks appear publicly; direct unpublished URLs do not reveal draft content.
- scope: Catalogue, Programmes, Courses, and content

## REQ-CAT-08
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.3
- description: Archive catalogue records without breaking historical enrolments, results, or certificates. (Priority: MUST)
- acceptance: Archived records disappear from new-sale flows but remain readable to authorized users and existing learners where policy permits.
- scope: Catalogue, Programmes, Courses, and content

## REQ-COH-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.4
- description: Create a Cohort for either one standalone Course or one Programme. (Priority: MUST)
- acceptance: The offer type is unambiguous and immutable after enrolment begins except through an approved migration path.
- scope: Cohorts, scheduling, and enrolment operations

## REQ-COH-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.4
- description: Set enrolment window, start/end dates, time zone, capacity, independently approved NGN and USD base prices, delivery mode, instructors, and status. (Priority: MUST)
- acceptance: The administrator enters each offered currency price explicitly; no FX conversion occurs; missing pricing for an enabled online rail blocks publication.
- scope: Cohorts, scheduling, and enrolment operations

## REQ-COH-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.4
- description: Create scheduled sessions with title, date/time, duration, location or meeting link, facilitator, and attendance expectation. (Priority: MUST)
- acceptance: Sessions appear in staff and learner schedules; link visibility follows enrolment and access timing rules.
- scope: Cohorts, scheduling, and enrolment operations

## REQ-COH-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.4
- description: Publish a Cohort only when catalogue, schedule, pricing, instructor, capacity, and completion readiness checks pass. (Priority: MUST)
- acceptance: The system shows pass/fail readiness items and rejects publish requests from users without matching permission.
- scope: Cohorts, scheduling, and enrolment operations

## REQ-COH-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.4
- description: Allow authorized staff to add, approve, transfer, withdraw, or cancel enrolments with a reason. (Priority: MUST)
- acceptance: State transitions are validated, audited, communicated where needed, and do not create duplicate active enrolments.
- scope: Cohorts, scheduling, and enrolment operations

## REQ-COH-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.4
- description: Enforce capacity during checkout and administrative enrolment. (Priority: MUST)
- acceptance: Concurrent attempts cannot exceed capacity; a released or expired reservation becomes available according to policy.
- scope: Cohorts, scheduling, and enrolment operations

## REQ-COH-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.4
- description: Provide cohort-level views of learners, access, progress, attendance, assessment, completion, and exceptions. (Priority: MUST)
- acceptance: Authorized staff can filter and open a learner detail without viewing out-of-scope Cohorts.
- scope: Cohorts, scheduling, and enrolment operations

## REQ-REG-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.5
- description: Allow a public visitor to select an open Cohort from a Course or Programme offer. (Priority: MUST)
- acceptance: The choice shows current price, dates, delivery mode, remaining/availability status, prerequisites, and completion expectation.
- scope: Registration, orders, and enrolment

## REQ-REG-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.5
- description: Preserve the selected offer through registration, verification, and sign-in. (Priority: MUST)
- acceptance: After successful identity completion, the learner returns to the intended order if it remains valid; changed availability is explained.
- scope: Registration, orders, and enrolment

## REQ-REG-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.5
- description: Create one traceable order for each checkout attempt and prevent duplicate enrolment on replay. (Priority: MUST)
- acceptance: Idempotent processing produces at most one successful payment effect and one active enrolment for the learner/Cohort.
- scope: Registration, orders, and enrolment

## REQ-REG-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.5
- description: Present and record required terms, privacy notice, refund/cancellation policy, and marketing consent separately. (Priority: MUST)
- acceptance: The system stores policy versions, required acceptance, optional choice, learner, order, and time.
- scope: Registration, orders, and enrolment

## REQ-REG-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.5
- description: Send transactional confirmation and expose a receipt/order record after successful enrolment. (Priority: MUST)
- acceptance: The learner receives an email and can view order reference, offer, amount, payment state, enrolment state, and support route.
- scope: Registration, orders, and enrolment

## REQ-PAY-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.6
- description: Integrate one approved online payment gateway for the pilot. (Priority: MUST) — **superseded within this same document**: §19 "Multi-gateway learner payments" states it "supersedes the 'one approved online payment gateway' pilot assumption for the commercial payment path," replacing it with Paystack + Stripe + optional manual payment (see REQ-PAY-08 onward). This is a document-internal revision (Revision 3 history, §1.2), not a cross-document conflict.
- acceptance: The server verifies signed/correlated gateway results; client redirects alone never mark an order paid.
- scope: Payments, manual confirmation, refunds, and reconciliation — superseded by §19

## REQ-PAY-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.6
- description: Represent payment states including pending, processing, succeeded, failed, cancelled, refunded, and partially refunded if the selected gateway supports it. (Priority: MUST)
- acceptance: Transitions are valid, idempotent, timestamped, and visible to authorized users and the learner at an appropriate level.
- scope: Payments, manual confirmation, refunds, and reconciliation

## REQ-PAY-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.6
- description: Allow authorized staff with payments.confirm to confirm an approved offline/manual payment. (Priority: MUST)
- acceptance: Amount, currency, date, channel, reference, evidence or evidence note, and reason are required; one audit event and one enrolment effect result.
- scope: Payments, manual confirmation, refunds, and reconciliation

## REQ-PAY-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.6
- description: Prevent duplicate or conflicting online and manual confirmation. (Priority: MUST)
- acceptance: A second success attempt is rejected or safely reconciled; staff see the existing transaction and corrective path.
- scope: Payments, manual confirmation, refunds, and reconciliation

## REQ-PAY-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.6
- description: Allow authorized staff with refunds.manage to record and, where integrated, initiate approved refunds. (Priority: MUST)
- acceptance: Refund amount, reason, approver/reference, resulting access decision, actor, and time are preserved; amount cannot exceed eligible paid value.
- scope: Payments, manual confirmation, refunds, and reconciliation

## REQ-PAY-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.6
- description: Provide payment and refund reconciliation views and CSV exports. (Priority: MUST)
- acceptance: Totals reconcile to transaction rows for the same filters; manual and gateway records are distinguishable; exports are permission-protected.
- scope: Payments, manual confirmation, refunds, and reconciliation

## REQ-PAY-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.6
- description: Handle delayed, duplicated, or out-of-order gateway notifications safely. (Priority: MUST)
- acceptance: Webhook replay and ordering tests do not duplicate enrolment, receipt, or financial effect; ambiguous cases enter a visible exception state.
- scope: Payments, manual confirmation, refunds, and reconciliation

## REQ-LRN-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.7
- description: Show each learner an enrolment dashboard with next action, progress, scheduled sessions, assessment obligations, results, tickets, and certificate state. (Priority: MUST)
- acceptance: Only the learner's own active/historical records are shown; empty and completed states provide clear next actions.
- scope: Learning delivery and progress

## REQ-LRN-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.7
- description: Render published Modules and Lessons in the defined order with prerequisite locks where configured. (Priority: MUST)
- acceptance: Required sequencing is enforced server-side; locked content explains the unmet condition.
- scope: Learning delivery and progress

## REQ-LRN-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.7
- description: Deliver supported lesson content securely and accessibly. (Priority: MUST)
- acceptance: Text, images, permitted files, standard uploaded video, embeds, and links display with appropriate labels, keyboard behavior, and authorized file access.
- scope: Learning delivery and progress

## REQ-LRN-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.7
- description: Track learner progress using completion rules appropriate to each content type. (Priority: MUST)
- acceptance: Progress is idempotent, attributable, timestamped, recalculable, and not advanced by unauthorized requests.
- scope: Learning delivery and progress

## REQ-LRN-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.7
- description: Allow manual Lesson completion only where the published rule permits it. (Priority: MUST)
- acceptance: The action is available only to the enrolled learner in the valid access window and can be reversed only according to policy.
- scope: Learning delivery and progress

## REQ-LRN-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.7
- description: Provide scheduled-session details and meeting links to eligible learners. (Priority: MUST)
- acceptance: Links are hidden before the configured visibility window and from unenrolled users; time zone and access failure guidance are clear.
- scope: Learning delivery and progress

## REQ-LRN-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.7
- description: Calculate Course and Programme completion from versioned rules and current learner evidence. (Priority: MUST)
- acceptance: The calculation identifies each satisfied/unmet rule, handles corrections, and records the completion time and rule version.
- scope: Learning delivery and progress

## REQ-ATT-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.8
- description: Allow authorized staff to mark attendance for scheduled sessions using present, absent, late, excused, or not-recorded states. (Priority: MUST)
- acceptance: Each change records actor, time, state, and optional note; bulk entry cannot affect out-of-scope learners.
- scope: Attendance

## REQ-ATT-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.8
- description: Support a configured attendance threshold as a Course or Programme completion rule. (Priority: MUST)
- acceptance: The learner and staff can see earned/required attendance; completion recalculates after an authorized correction.
- scope: Attendance

## REQ-ATT-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.8
- description: Permit authorized attendance correction with mandatory reason after the normal marking window. (Priority: MUST)
- acceptance: Before/after values and reason remain in audit history and are reflected consistently in progress and reports.
- scope: Attendance

## REQ-ATT-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.8
- description: Expose attendance exceptions to staff dashboards and learner detail. (Priority: SHOULD)
- acceptance: Missing registers, at-risk learners, and disputed/corrected states are filterable with matching CSV values.
- scope: Attendance

## REQ-ASM-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.9
- description: Create Quizzes with questions, options/answers, marks, pass threshold, attempt limit, availability, and feedback behavior. (Priority: MUST)
- acceptance: Draft validation catches incomplete questions; published settings are versioned; learner attempts use the assigned version.
- scope: Quizzes, assignments, grading, and feedback

## REQ-ASM-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.9
- description: Score supported objective Quiz questions automatically and store attempt evidence. (Priority: MUST)
- acceptance: Score calculation is reproducible; attempts include start/submit time, answers, version, result, and status.
- scope: Quizzes, assignments, grading, and feedback

## REQ-ASM-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.9
- description: Create Assignments with instructions, due date, permitted file types/size, grading scale, and resubmission policy. (Priority: MUST)
- acceptance: Published instructions and constraints are visible before submission and apply consistently to server validation.
- scope: Quizzes, assignments, grading, and feedback

## REQ-ASM-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.9
- description: Accept Assignment submissions and issue a durable receipt. (Priority: MUST)
- acceptance: A successful submission stores file metadata/reference, learner, assessment version, time, attempt, and receipt ID; failures never display a false success.
- scope: Quizzes, assignments, grading, and feedback

## REQ-ASM-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.9
- description: Allow authorized graders to view in-scope submissions, record grades and feedback, save drafts, and release results. (Priority: MUST)
- acceptance: Learners cannot see draft grades; release is explicit and attributed; graders cannot access unrelated Cohorts.
- scope: Quizzes, assignments, grading, and feedback

## REQ-ASM-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.9
- description: Allow an authorized grade override or correction with mandatory reason. (Priority: MUST)
- acceptance: Original and revised value, actor, reason, time, and resulting completion/certificate impact are preserved.
- scope: Quizzes, assignments, grading, and feedback

## REQ-ASM-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.9
- description: Show learners released results, feedback, attempt history, and unmet pass requirements. (Priority: MUST)
- acceptance: Only released and permitted details appear; the UI clearly identifies pass/fail, next allowed action, and support route.
- scope: Quizzes, assignments, grading, and feedback

## REQ-CRD-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.10
- description: Issue a Course certificate only when standalone Course completion rules pass and certificate issuance is enabled. (Priority: MUST)
- acceptance: The event is idempotent, references the rule/version and enrolment, and produces one active credential unless reissued.
- scope: Certificates and verification

## REQ-CRD-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.10
- description: Issue one Programme certificate after all required Programme Courses and Programme-level rules pass. (Priority: MUST)
- acceptance: Partial Programme completion does not issue the Programme credential; the calculation shows remaining obligations.
- scope: Certificates and verification

## REQ-CRD-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.10
- description: Generate a downloadable certificate with unique verification reference and minimum approved learner/award fields. (Priority: MUST)
- acceptance: The generated file is readable, access-controlled, stable for the credential version, and does not expose internal identifiers.
- scope: Certificates and verification

## REQ-CRD-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.10
- description: Provide public certificate verification with privacy-minimized output. (Priority: MUST)
- acceptance: A valid reference returns active/revoked status and approved award facts; unknown references do not reveal user-account data.
- scope: Certificates and verification

## REQ-CRD-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.10
- description: Allow authorized revocation and reissue with reason and audit history. (Priority: MUST)
- acceptance: Revocation changes public status promptly; reissue links old/new credential versions and preserves the historical record.
- scope: Certificates and verification

## REQ-CRD-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.10
- description: Re-evaluate certificate status after an authorized grade, attendance, or completion correction. (Priority: MUST)
- acceptance: The system flags affected credentials for review and never silently destroys a previously issued record.
- scope: Certificates and verification

## REQ-COM-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.11
- description: Send transactional emails for verification, password reset, order/payment outcome, enrolment, session change, result release, certificate issuance/revocation, and ticket activity. (Priority: MUST)
- acceptance: Each event has an approved template, correct recipient, delivery record, and no sensitive secret in message content.
- scope: Communications and notifications

## REQ-COM-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.11
- description: Prevent duplicate transactional messages during retries and idempotent processing. (Priority: MUST)
- acceptance: Repeated events within the same correlation produce at most one intended notification or a documented replacement.
- scope: Communications and notifications

## REQ-COM-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.11
- description: Show important in-product notifications or dashboard alerts for learner and staff actions. (Priority: SHOULD)
- acceptance: Users can see unread/current state and open the relevant authorized record; stale or inaccessible links fail safely.
- scope: Communications and notifications

## REQ-COM-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.11
- description: Use one approved client sender identity and brand configured at deployment. (Priority: MUST)
- acceptance: Templates consistently use the client's approved name, sender, support route, and legal footer; no tenant-level editor is required.
- scope: Communications and notifications

## REQ-SUP-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.12
- description: Allow learners to create and view their own support tickets with category, subject, description, and permitted attachments. (Priority: MUST)
- acceptance: A ticket receives a reference and status; unsafe files are rejected; the learner sees only public replies and own attachments.
- scope: Support tickets

## REQ-SUP-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.12
- description: Support priority, status, assignment, public reply, private internal note, and closure/reopen behavior. (Priority: MUST)
- acceptance: Public and private content remain distinctly labeled and permission-protected; every transition is timestamped and attributed.
- scope: Support tickets

## REQ-SUP-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.12
- description: Allow ticket access through tickets.view and tickets.manage without requiring Administrator status. (Priority: MUST)
- acceptance: A custom Support Agent role can triage and resolve tickets while being denied unrelated role, financial, grading, and user-management actions.
- scope: Support tickets

## REQ-SUP-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.12
- description: Allow escalation to another staff owner or queue with reason. (Priority: MUST)
- acceptance: Escalation preserves history, notifies the next owner according to policy, and remains visible in operational reporting.
- scope: Support tickets

## REQ-SUP-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.12
- description: Allow permitted contextual links to learner, Cohort, Course, order, submission, or certificate records. (Priority: SHOULD)
- acceptance: Opening context performs a fresh permission/scope check; ticket access alone does not grant unrestricted domain access.
- scope: Support tickets

## REQ-SUP-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.12
- description: Report ticket volume, age, priority, status, ownership, response, resolution, and escalation. (Priority: MUST)
- acceptance: Dashboard and CSV values reconcile for the same filters and exclude private note content from general exports.
- scope: Support tickets

## REQ-RPT-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.13
- description: Provide fixed operational dashboards for registrations, payments, enrolments, attendance, progress, submissions, grades, completion, certificates, and support. (Priority: MUST)
- acceptance: Each dashboard states metric definition, filter context, last refreshed time, and empty/error behavior.
- scope: Dashboards, reports, exports, and audit

## REQ-RPT-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.13
- description: Apply the requesting user's permissions and scope to every dashboard, aggregate, drill-down, and export. (Priority: MUST)
- acceptance: A user cannot infer out-of-scope data through totals, filters, identifiers, downloads, or direct requests.
- scope: Dashboards, reports, exports, and audit

## REQ-RPT-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.13
- description: Provide CSV export for the defined operational datasets. (Priority: MUST)
- acceptance: Exports include stable column definitions, applied filters, generation time, and a row-level reconciliation path.
- scope: Dashboards, reports, exports, and audit

## REQ-RPT-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.13
- description: Process large exports asynchronously and provide queued, processing, succeeded, failed, expired, and retry states. (Priority: MUST)
- acceptance: The user can leave the screen, later see job state, safely retry, and download only through time-limited authorized access.
- scope: Dashboards, reports, exports, and audit

## REQ-RPT-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §11.13
- description: Provide an authorized, filterable audit view and export for security and sensitive business actions. (Priority: MUST)
- acceptance: Audit records are append-only to application users, include correlation data, and redact secrets while preserving investigative value.
- scope: Dashboards, reports, exports, and audit

## REQ-NFR-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Availability
- acceptance: At least 99.5% monthly availability for the production service, excluding approved maintenance windows communicated in advance.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Interactive performance
- acceptance: Common authenticated page views reach usable primary content within 2.5 seconds at p75 under the agreed expected pilot load and supported network profile.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Reliability and idempotency
- acceptance: Payments, enrolment activation, submissions, completion, certificate issuance, notification dispatch, and export creation tolerate retries without duplicate business effects.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Security baseline
- acceptance: Use current supported components, TLS in transit, encryption at rest where applicable, secure password hashing, secret management, input validation, rate limiting, dependency scanning, and least privilege.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Authorization
- acceptance: All protected server operations and private-file downloads evaluate identity, active permissions, assignment scope, and record state; tests cover direct-request bypass attempts.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Private files and reports
- acceptance: Downloads use short-lived, authorized access; public storage URLs, predictable object paths, and permanent report links are prohibited.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Audit and observability
- acceptance: Security and sensitive business events include time, actor, target, action, outcome, correlation, and safe context; operational monitoring detects failed jobs, payment exceptions, email failures, and error-rate changes.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-08
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Backup and recovery
- acceptance: Production data is backed up to meet RPO 24 hours and RTO 8 hours; a pilot-stage restore rehearsal demonstrates documented recovery steps and evidence.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-09
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Accessibility
- acceptance: Core public, learner, and staff journeys align with WCAG 2.2 AA, including keyboard operation, visible focus, semantic labels, contrast, error identification, zoom/reflow, and accessible document/media alternatives.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-10
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Responsive web
- acceptance: Core journeys remain usable across agreed modern desktop and mobile-web viewport ranges; no horizontal scrolling is required for primary forms and learner content except deliberate data tables.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-11
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Privacy and data lifecycle
- acceptance: Collect only necessary data; record lawful/consent basis where applicable; support access/export, correction, retention, deletion/anonymization, and legal hold according to approved policy.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-12
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Compatibility and supportability
- acceptance: Support the agreed current and previous major versions of Chrome, Edge, Firefox, and Safari at launch; document deployment, rollback, job recovery, and operational runbooks.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-13
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Asynchronous work
- acceptance: Long-running work exposes queued, processing, succeeded, failed, and retrying states; retries are bounded, observable, and safe.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-NFR-14
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §12
- description: Data integrity
- acceptance: Foreign-key/business invariants, unique constraints, transactional boundaries, and reconciliation checks protect enrolment, payment, grading, completion, and credential records.
- scope: Non-functional, security, accessibility, and operational requirements

## REQ-LIC-01
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: The LMS MUST verify a provider-signed licence with a public verification key and MUST reject altered, expired, wrong-client, wrong-deployment, or otherwise invalid licences.
- acceptance: A modified payload or invalid signature cannot activate the LMS.
- scope: Software licence and deployment control — note: track-a-tasks.md (precedence 5) records this module as deliberately deferred past the current 7-day build window, "gated on commercial terms nobody has approved (§18.6)"; this is a scheduling deferral, not a scope removal, and does not contradict the PRD.

## REQ-LIC-02
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: The LMS MUST provide an Administration > Licence & System Status screen for users with licence.view.
- acceptance: The screen displays current state, licence ID, registered client, relevant dates, validation result, and renewal/support route without exposing signing secrets.
- scope: Software licence and deployment control

## REQ-LIC-03
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: Only a tightly restricted licence.activate permission MAY activate a provider-issued licence. The UI MUST NOT offer licence creation, date extension, plan editing, signature replacement, or self-authorised reactivation.
- acceptance: An Administrator can upload/activate a valid issued licence; ordinary Administrators and all other roles cannot forge or alter it.
- scope: Software licence and deployment control

## REQ-LIC-04
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: Licence checks MUST run at startup, on an approved scheduled cadence, and before high-impact mutations. Temporary validation unavailability MUST use a bounded, approved offline-validation policy and warn authorized Administrators.
- acceptance: A transient connectivity issue does not silently become a permanent Active state or cause an unexplained immediate outage.
- scope: Software licence and deployment control

## REQ-LIC-05
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: When the approved expiry/grace threshold is reached, the LMS MUST enforce the configured restricted/read-only state server-side and in the UI.
- acceptance: Direct requests cannot bypass restrictions; prohibited actions receive a clear, non-sensitive licence restriction response.
- scope: Software licence and deployment control

## REQ-LIC-06
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: The LMS MUST audit licence activation, validation outcome, state transition, restriction enforcement, and authorized data export with actor/system actor, time, target licence, outcome, correlation and safe context.
- acceptance: Licence events can be reviewed by restricted audit users.
- scope: Software licence and deployment control

## REQ-LIC-07
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: The LMS MUST notify authorized Administrators of approved renewal-warning, grace, expiry, invalid and validation-attention states through the transactional/in-product notification model.
- acceptance: Messages are deduplicated and do not leak sensitive signing or contract details.
- scope: Software licence and deployment control

## REQ-LIC-08
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §18.3
- description: Read-only restrictions MUST preserve the records and permitted export/data-access route defined by approved policy; the product MUST NOT delete client data as an expiry action.
- acceptance: Expiry does not delete data or silently make it unavailable beyond the agreed restrictions.
- scope: Software licence and deployment control

## REQ-PAY-08
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §19.3
- description: Before order creation, the LMS MUST let a learner select an available administrator-entered NGN or USD price; NGN routes only to Paystack, USD routes only to Stripe, and approved manual payment appears only when configured.
- acceptance: The LMS performs no FX conversion and rejects every client attempt to pair NGN with Stripe or USD with Paystack.
- scope: Multi-gateway learner payments — supersedes REQ-PAY-01's single-gateway assumption

## REQ-PAY-09
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §19.3
- description: The LMS MUST use provider-specific Paystack and Stripe integrations behind one product-owned payment interface and shared state machine.
- acceptance: Provider differences do not change the learner's enrolment, receipt, audit or support model.
- scope: Multi-gateway learner payments

## REQ-PAY-10
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §19.3
- description: The LMS MUST verify Paystack and Stripe provider results server-side using approved correlation/signature controls before payment success is recorded.
- acceptance: Redirect manipulation, invalid webhooks and uncorrelated results cannot mark an order paid.
- scope: Multi-gateway learner payments

## REQ-PAY-11
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §19.3
- description: The LMS MUST make payment initiation, confirmation, failure, cancellation, refund and reconciliation idempotent across methods.
- acceptance: Repeated/reordered events and a currency/order replacement result in at most one successful payment effect and active enrolment.
- scope: Multi-gateway learner payments

## REQ-PAY-12
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §19.3
- description: The LMS MUST expose provider, currency, base price, platform fee, estimated/actual gateway fee, learner total, school settlement, KQ NEXUS gross/net, transaction/reference, payment state and safe exception context to authorized Finance/Operations users.
- acceptance: Finance can prove the learner charge and each recipient's settlement, distinguish estimates from actuals, and reconcile filters/totals with provider transaction rows.
- scope: Multi-gateway learner payments

## REQ-PAY-13
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §19.3
- description: The LMS MUST route an authorized refund to the original provider where integration supports it, or record a controlled manual refund outcome.
- acceptance: Refund amount cannot exceed eligible paid value; reason, approver/reference, resulting access decision, actor, time and provider outcome are auditable.
- scope: Multi-gateway learner payments

## REQ-PAY-14
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md §19.3
- description: The LMS MUST keep gateway credentials and webhook secrets in deployment-managed secret storage, never in the browser, exports, audit detail, staff UI or source control.
- acceptance: Authorized staff may see enabled provider status but cannot view secrets.
- scope: Multi-gateway learner payments

## REQ-PAY-15
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md Revision 4 Section 19.3
- description: The LMS MUST add a KQ NEXUS platform fee equal to 1.5% of the administrator-entered base Cohort price and never calculate it from the gateway-grossed learner total.
- acceptance: The immutable Order and learner breakdown preserve the base-derived platform fee in integer minor units.
- scope: Multi-gateway learner payments

## REQ-PAY-16
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md Revision 4 Section 19.3
- description: The LMS MUST gross up the learner total from an active versioned provider schedule containing percentage, fixed charge, threshold, cap, tax treatment, and rounding.
- acceptance: The calculation is reproducible from the Order snapshot after Cohort prices or provider schedules change.
- scope: Multi-gateway learner payments

## REQ-PAY-17
- source: docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md Revision 4 Section 19.3
- description: The LMS MUST use Paystack split payments and Stripe Connect destination charges so the school receives its immutable base price and KQ NEXUS receives the platform allocation while bearing the actual gateway charge.
- acceptance: Expected and actual provider fees and school/KQ settlement values are persisted and reconcilable without rewriting the Order.
- scope: Multi-gateway learner payments
