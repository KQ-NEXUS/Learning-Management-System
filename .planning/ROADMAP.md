# Roadmap: Professional Training LMS

## Overview

This roadmap takes the Professional Training LMS from its current state — a proven foundation (authorization choke point, resource-service factory, full Prisma schema, and a working Courses reference slice) — through to a launch-ready platform covering the complete PRD Revision 3 / PXR Revision 3 scope: identity and access control, the full catalogue and delivery model (Programmes, Courses, Cohorts, sessions, attendance), the commercial path (registration, multi-gateway payments, refunds, reconciliation), the learning and assessment lifecycle (progress, quizzes, assignments, grading, certificates), operational support (tickets, notifications, reporting), the software licence control module, and the non-functional launch gates from PRD §14.3.

**Two tracks run in parallel throughout**, sharing the one foundation proved in Phase 1 so neither reconciles a second set of conventions later:

- **Track A — Identity & Commerce** (lead developer): IAM, RBAC, REG, PAY, and finance-facing RPT.
- **Track B — Content & Delivery** (support developer): CAT, COH, ATT, LRN, ASM, CRD, SUP.
- **Shared**: Phase 1 (already done), Phase 6 (registration/checkout — where the tracks first converge), Phase 13 (communications, which hooks into events from nearly every other phase), and Phase 15 (launch readiness, which verifies the whole system).

Phase numbers below are sequential for planning purposes only. Each phase's **Depends on** line states its real dependency; phases with no dependency on each other's outputs are flagged **(parallel-eligible)** and can be built by the two tracks at the same time rather than strictly in the numbered order.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3, ...): Planned milestone work
- Decimal phases (N.1, N.2): Urgent insertions (marked with INSERTED), executed between their surrounding integers

- [x] **Phase 1: Foundation, Authorization Core & Course Reference Slice** - Prove the authorization/resource-service pattern end-to-end on Courses so every later resource inherits it. *(Complete — already implemented.)*
- [x] **Phase 2: Roles, Permissions & Staff Accounts** *(Track A)* - Administrators manage staff accounts, roles, and scoped permission assignments with full audit. (completed 2026-09-02)
- [x] **Phase 3: Public Identity — Registration, Verification & Secure Sessions** *(Track A)* - Visitors register, verify, sign in/out, reset passwords, and manage profiles, resistant to enumeration/brute-force. (completed 2026-09-03)
- [x] **Phase 4: Catalogue Authoring — Programmes, Courses, Modules & Lessons** *(Track B, parallel-eligible with Phases 2–3)* - Staff author Programmes, Modules, Lessons, and content, versioned and published. (completed 2026-09-03)
- [x] **Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance** *(Track B, parallel-eligible with Phases 2–3)* - Staff stand up Cohorts, schedule sessions, manage enrolment lifecycle and capacity, mark and correct attendance. (completed 2026-09-07)
- [ ] **Phase 6: Registration, Checkout & Stripe Payments** *(Convergence: Track A + Track B outputs)* - A visitor selects a Cohort, creates one traceable order, and pays via Stripe with server-verified settlement.
- [ ] **Phase 7: Multi-Gateway Payments — Paystack, Manual & Refunds** *(Track A)* - Paystack and manual payment join Stripe behind one state machine; manual confirmation and refunds are staff-operable and audited.
- [ ] **Phase 8: Finance Reconciliation, Dashboards & Reporting Exports** *(Track A)* - Finance reconciles payments/refunds across providers; scoped dashboards and CSV/async exports are available.
- [ ] **Phase 9: Learning Delivery & Progress Tracking** *(Track B, depends on Phases 5–6)* - Enrolled learners work through ordered content with tracked, rule-based progress and completion.
- [ ] **Phase 10: Assessment — Quizzes, Assignments & Grading** *(Track B)* - Instructors build assessments, learners attempt/submit, graders score and release results with auditable overrides.
- [ ] **Phase 11: Certificates & Completion Lifecycle** *(Track B)* - Course/Programme certificates issue, verify publicly, and get revoked/reissued/re-evaluated correctly.
- [ ] **Phase 12: Support Tickets** *(Track B, depends on Phase 2)* - Learners raise tickets; staff (including a non-Administrator Support role) triage, reply, escalate, and report.
- [ ] **Phase 13: Transactional Communications & Notifications** *(Shared, depends on Phases 3, 5, 6, 7, 10, 11, 12)* - Every lifecycle event across the system sends exactly one deduplicated transactional email; in-product alerts surface important state.
- [ ] **Phase 14: Software Licence & Deployment Control** *(Track A, depends on Phase 2; contingent — see note below)* - Provider-signed licence verification, status visibility, and expiry-driven read-only enforcement.
- [ ] **Phase 15: Launch Readiness — NFR Verification & Operational Cutover** *(Shared, depends on all prior phases)* - Availability, performance, security, accessibility, backup/recovery, and the full unassisted learner+operator journey are verified against the PRD §14.3 launch gates.

## Phase Details

### Phase 1: Foundation, Authorization Core & Course Reference Slice

**Goal**: Prove the authorization and resource-service pattern end-to-end on one real resource (Courses) so every later resource inherits consistent, server-enforced access control without reinventing it.
**Depends on**: Nothing (first phase)
**Requirements**: RBAC-05, RBAC-06, CAT-01
**Success Criteria** (what must be TRUE):

  1. Every protected Course operation (list/get/create/update/archive) is denied server-side for a caller without a matching permission and scope, even via a direct request that bypasses the UI. (RBAC-06)
  2. A caller's access is correctly limited to their GLOBAL, PROGRAMME, COURSE, or COHORT grants, with no leakage to sibling or unrelated records. (RBAC-05)
  3. Staff can create, edit, and archive a Course through a working UI backed by the resource-service factory, with the full test suite (84 tests / 10 files) passing. (CAT-01)
  4. No code outside `src/server/services/` and `src/server/db.ts` imports `@prisma/client` — enforced by ESLint, not convention.

**Plans**: Retroactive — implemented prior to this roadmap. See `.planning/codebase/*.md` (analysis date 2026-09-01) for evidence.
**UI hint**: yes

---

### Phase 2: Roles, Permissions & Staff Accounts

**Goal**: Administrators can define who can do what, where, without touching code, and every access-control change is attributable.
**Depends on**: Phase 1
**Requirements**: RBAC-01, RBAC-02, RBAC-03, RBAC-04, RBAC-07, RBAC-08, IAM-04
**Success Criteria** (what must be TRUE):

  1. A deployment seeds five active default roles (Administrator, Programme Manager, Instructor, Finance/Operations, Learner), and an administrator can build a custom role only from the approved permission catalogue — unknown/duplicate/malformed permissions are rejected. (RBAC-01, RBAC-03)
  2. Editing a role creates a new version while preserving prior versions and requires a reason for sensitive reductions; a staff account can hold multiple active role assignments across global/Programme/Course/Cohort scope, and revoking one assignment does not affect others. (RBAC-02, RBAC-04)
  3. The system refuses any change that would leave zero active users with role-management authority. (RBAC-07)
  4. Every role, assignment, and staff-account change (create/invite/deactivate/reactivate) is visible in an audit view with actor, before/after, reason, and timestamp. (RBAC-08, IAM-04)

**Plans**: 8 plans across 7 waves (tracer-first: plan 01 proves the service/action/UI pattern end-to-end on role creation before any expansion)
Plans:

- [x] 02-01-PLAN.md — Tracer: create a custom role from the catalogue, end to end (RBAC-01, RBAC-03)
- [x] 02-02-PLAN.md — Continuity safeguard + audit scope fields and credential redaction (RBAC-07, RBAC-08)
- [x] 02-03-PLAN.md — Role edit, versioning, history and deactivation (RBAC-02, RBAC-03, RBAC-07, RBAC-08)
- [x] 02-04-PLAN.md — Assignment create/revoke and the four-scope target lookup (RBAC-04, RBAC-07, RBAC-08)
- [x] 02-05-PLAN.md — /staff/audit view with expand-in-place rows (RBAC-08)
- [x] 02-06-PLAN.md — Staff account service: atomic create, deactivate, reactivate (IAM-04, RBAC-07, RBAC-08)
- [x] 02-07-PLAN.md — Staff accounts list and combined create-and-assign form (IAM-04)
- [x] 02-08-PLAN.md — Staff account detail, assignments panel and assignment drawer (RBAC-04, IAM-04)

**UI hint**: yes

---

### Phase 3: Public Identity — Registration, Verification & Secure Sessions

**Goal**: A visitor can become a verified, securely authenticated Learner, and the system resists enumeration, brute-force, and unsafe session reuse throughout.
**Depends on**: Phase 2
**Requirements**: IAM-01, IAM-02, IAM-03, IAM-05, IAM-06
**Success Criteria** (what must be TRUE):

  1. A visitor can register with email/password, accept required policies, and receive exactly one verification email; duplicate active emails are rejected. (IAM-01)
  2. A single-use, expiring verification link activates the account once; expired or used links show a safe, recoverable path without revealing unrelated account data. (IAM-02)
  3. A registered user can sign in, sign out, reset a forgotten password, and have sessions selectively or globally revoked. (IAM-03 — sign-in/out/lockout/session revocation already implemented per Phase 1's auth work; password reset is the remaining gap closed here)
  4. A user can maintain profile fields and communication preferences within validation and consent rules. (IAM-05)
  5. Repeated failed logins lock the account, error messages never reveal whether an email exists, and no secrets appear in logs. (IAM-06)

**Plans**: 10 plans across 7 waves — 6 original (tracer-first: plan 01 proves the register-to-verified pipeline end to end through every layer before any expansion) plus 4 gap-closure plans raised by UAT
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Tracer: register a brand-new email through to a verified account, end to end (IAM-01, IAM-02, IAM-06)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — Registration completeness: policy capture, the three account-state branches, password floor (IAM-01, IAM-06)
- [x] 03-03-PLAN.md — Verification link landing: two states and the resend recovery path (IAM-02, IAM-06)
- [x] 03-04-PLAN.md — Password reset: non-enumerating request, atomic completion, global session revocation (IAM-03, IAM-06)
- [x] 03-05-PLAN.md — Learner account area: profile fields, step-up email change, marketing preference (IAM-05, IAM-06)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-06-PLAN.md — Post-authentication routing and staff-route guard hardening (IAM-03, IAM-06)

**Gap closure** *(raised by UAT — see `03-UAT.md`; run with `/gsd-execute-phase 03 --gaps-only`)*

**Wave 4**

- [x] 03-07-PLAN.md — BLOCKER G-03-6a: email-change confirmation runs an invalid Prisma query; plus a schema-derived findUnique guard for the test fakes that hid it (IAM-05, IAM-06)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03-08-PLAN.md — BLOCKER G-03-3: unguarded email dispatch crashes on a provider outage and opens an account-enumeration oracle on the reset path (IAM-01, IAM-02, IAM-03, IAM-05, IAM-06)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03-09-PLAN.md — G-03-6b/6c/7: stale profile render, unhelpful step-up error, and a signed-in learner redirected to sign-in (IAM-03, IAM-05, IAM-06)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 03-10-PLAN.md — Reconcile 03-VALIDATION.md against the phase that was actually built (IAM-01, IAM-02, IAM-03, IAM-05, IAM-06)

**UI hint**: yes

---

### Phase 4: Catalogue Authoring — Programmes, Courses, Modules & Lessons

**Goal**: Staff can build the full content model — Programmes, Courses, Modules, Lessons, and rich content — safely versioned and published without breaking active Cohorts.
**Depends on**: Phase 1 (parallel-eligible with Phases 2–3; no shared dependency beyond the foundation)
**Requirements**: CAT-02, CAT-03, CAT-04, CAT-05, CAT-06, CAT-07, CAT-08
**Success Criteria** (what must be TRUE):

  1. Staff can compose a Programme from one or more existing Courses, reordering and reusing (not cloning) Courses across multiple Programmes. (CAT-02)
  2. Staff can build ordered Modules and Lessons inside a Course, mixing text, files, images, uploaded video, embeds, links, Quizzes, and Assignments, each validated and rendered accessibly. (CAT-03, CAT-04)
  3. Publishing a Course creates a version; active Cohorts are protected from silent requirement changes until staff explicitly choose an effective date or version. (CAT-05)
  4. An Instructor holding `courses.publish` in matching scope — and only that Instructor — can publish an assigned Course, with the action recorded. (CAT-06)
  5. Only catalogue records that pass readiness checks appear on public Course/Programme pages, and archiving a record removes it from new sales without breaking existing learners' history. (CAT-07, CAT-08)

**Plans**: 15/15 plans executed.
**UI hint**: yes

---

### Phase 04.1: Design System Rollout — Modern UI Across Every Existing Surface (INSERTED)

**Goal**: Every surface already built — public catalogue, auth, account and the whole staff console — moves onto one approved design system, so Phase 5 onward is built to it rather than retrofitted.
**Depends on**: Phase 4 (its catalogue screens and bespoke components are in scope)
**Inserted because**: Track B is mid-Phase-5 and building UI now. Landing the system before Phase 5 completes means those screens inherit it; landing it after means retrofitting them. The window closes when Phase 5 ships.
**Requirements**: NFR-09 (WCAG 2.2 AA)
**Design contract**: the approved mockup — 28 screens, all 30 routes — at https://claude.ai/code/artifact/a4e2573f-256a-4b84-994f-32f9350aca26
**Success Criteria** (what must be TRUE):

  1. One token chain in `globals.css` — primitive → semantic → component — replaces the six flat values, and no component reads a raw hex.
  2. Amber and teal each carry a two-tone pair: the fill (#f79009 / #12a594) for indicators, and a text-safe sibling (#b45309 / #0f766e) wherever they carry words. Every foreground/background pair in the app meets 4.5:1 for body text and 3:1 for large text and UI edges. (NFR-09)
  3. All 18 `/staff/*` routes render the approved shell and table treatment without any per-screen styling, because the change lives in `staff/layout.tsx` and the four primitives.
  4. The six `(auth)` routes share one `(auth)/layout.tsx`; that layout owns the shared split-panel chrome, and every screen's existing state contract renders inside it.
  5. The public catalogue and `/account` render on the approved system.
  6. Phase 4's six bespoke components (RichTextEditor, ArrangeBoard, UploadPanel, PublishDialog, ReadinessPanel, LessonContent) are reconciled to the system or explicitly deferred with a reason.
  7. `npm run build` is clean and the full suite stays green — 707 tests at the time of writing. No screen loses a state: loading, empty, denied, error and validation-error all still render.

**Plans**: 31/31 plans executed. Gap-closure plans 17–31 were completed externally (delegated to the other developer, executed with Codex — per user confirmation 2026-09-09) rather than through this session's tracked execute-phase flow; not independently re-verified here. Known accepted gap: real video captions/WebVTT support (NFR-09 accessible media alternative) remains unresolved per `04.1-GAP-COVERAGE.md` — explicitly deferred by user decision rather than blocking Phase 6.
**UI hint**: yes

Plans:
**Wave 1**

- [x] 04.1-01-PLAN.md — Tracer: three-tier token chain, Plus Jakarta Sans + IBM Plex Mono, the mechanical WCAG contrast gate, and the gated `lucide-react` install (wave 1)
- [x] 04.1-02-PLAN.md — Wave-0 state-render tests for the four primitives, including a mechanical denial-parity assertion (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04.1-03-PLAN.md — `ResourceTable`: tinted `StatusPill`, tokenised class constants, card table shell, segmented filter affordance (wave 2)
- [x] 04.1-04-PLAN.md — `ResourceForm`, `DetailLayout` and `ConfirmModal`: 3:1 control edges, muted micro-text, density-correct shadows (wave 2)
- [x] 04.1-05-PLAN.md — Staff shell rebuild: 228px navy sidebar, five-item nav, identity chip, header bar, off-canvas collapse (wave 2)
- [x] 04.1-06-PLAN.md — New `(auth)/layout.tsx` split panel; six pages shed the duplicated wrapper; five auth forms on the new control edge (wave 2)
- [x] 04.1-07-PLAN.md — Shared learner shell for `(public)` and `/account`; `/account` widened to a two-column grid (wave 2)
- [x] 04.1-08-PLAN.md — Public catalogue card grids, detail display scale, and both 404 panels (wave 2)
- [x] 04.1-09-PLAN.md — Hand-styled staff surfaces: audit table, assignment drawer, permission picker and the users widgets (wave 2)
- [x] 04.1-10-PLAN.md — Staff courses-area sweep, including both preview screens (wave 2)
- [x] 04.1-11-PLAN.md — Staff programmes- and roles-area sweep (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04.1-12-PLAN.md — Catalogue components A: rich-text editor with its new empty-state prompt, arrange board, lesson fields, course actions (wave 3)
- [x] 04.1-13-PLAN.md — Catalogue components B: upload panel, publish dialog, readiness panel, lesson content with a zero-JS broken-media placeholder (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04.1-14-PLAN.md — Phase close: roadmap reconciliation, four phase-wide invariant gates, full suite and build, 28-screen walkthrough (wave 4)

**Gap closure** *(17–31 completed externally — delegated to the other developer, executed with Codex; per user confirmation 2026-09-09, not re-verified through this session's tracking. NFR-09 captions gap accepted as open, see note above.)*

- [x] 04.1-15-PLAN.md — Accessible staff table selection and honest course controls (gap wave 1)
- [x] 04.1-16-PLAN.md — Keyboard-safe staff navigation and approved shell mark (gap wave 1)
- [x] 04.1-17-PLAN.md — Assignment drawer focus, failure feedback and scope searches (gap wave 1)
- [x] 04.1-18-PLAN.md — Publish confirmation and catalogue action recovery (gap wave 1)
- [x] 04.1-19-PLAN.md — Form summaries and rich-editor error associations (gap wave 1)
- [x] 04.1-20-PLAN.md — Readable mobile audit history (gap wave 1)
- [x] 04.1-21-PLAN.md — Programme outcomes form parity (gap wave 1)
- [x] 04.1-22-PLAN.md — Retained module edits and recoverable staff mutations (gap wave 1)
- [x] 04.1-23-PLAN.md — Resilient upload polling and truthful lesson previews (gap wave 1)
- [x] 04.1-24-PLAN.md — Primitive visual contract and executable source gate (gap wave 2)
- [x] 04.1-25-PLAN.md — Auth visual scale and locked split-shell geometry (gap wave 3)
- [x] 04.1-26-PLAN.md — Public catalogue and account visual reconciliation (gap wave 3)
- [x] 04.1-27-PLAN.md — Course and programme staff visual reconciliation (gap wave 3)
- [x] 04.1-28-PLAN.md — Staff access and audit visual reconciliation (gap wave 3)
- [x] 04.1-30-PLAN.md — Catalogue authoring visual reconciliation (gap wave 3)
- [x] 04.1-31-PLAN.md — Catalogue reading visual reconciliation (gap wave 3)
- [x] 04.1-29-PLAN.md — Combined gap verification and honest browser handoff (gap wave 4)

**Cross-cutting constraints:**

- Every denied and error panel across these files renders the same copy it does today, with no cue keyed to record existence (RBAC-06, T-04.1-01).
- Every input, select, textarea and checkbox on these screens carries an edge clearing 3:1 (D-15, NFR-09).

### Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance

**Goal**: Staff can run a real delivery calendar — Cohorts, sessions, enrolment lifecycle, capacity, and attendance — safely under concurrency and correction.
**Depends on**: Phase 4 (parallel-eligible with Phases 2–3)
**Requirements**: COH-01, COH-02, COH-03, COH-04, COH-05, COH-06, COH-07, ATT-01, ATT-02, ATT-03, ATT-04
**Success Criteria** (what must be TRUE):

  1. Staff can create a Cohort for exactly one Course or one Programme, set enrolment window/dates/timezone/capacity/price/currency/delivery mode/instructors, and publish it only once catalogue/schedule/pricing/instructor/capacity/completion readiness checks pass. (COH-01, COH-02, COH-04)
  2. Staff can schedule sessions with facilitator, location/link, and attendance expectations, visible to enrolled learners under access-timing rules. (COH-03)
  3. Concurrent checkout cannot push a Cohort over capacity, and a released or expired reservation becomes available again. (COH-06)
  4. Staff can add, approve, transfer, withdraw, or cancel enrolments with a reason without creating duplicate active enrolments, and can view a scoped cohort-level roster of progress/attendance/exceptions. (COH-05, COH-07)
  5. Staff can mark attendance and, after the marking window, correct it with a mandatory reason; corrections recalculate completion and remain in audit history and dashboards. (ATT-01, ATT-02, ATT-03, ATT-04)

**Plans**: 16/16 plans executed.
**UI hint**: yes

---

### Phase 6: Registration, Checkout & Stripe Payments

**Goal**: A visitor can turn a Cohort choice into a paid, active enrolment through one traceable order and a server-verified Stripe payment.
**Depends on**: Phase 3 (identity), Phase 4 (published catalogue), Phase 5 (cohorts to register for) — this is the first point where Track A and Track B converge
**Requirements**: REG-01, REG-02, REG-03, REG-04, REG-05, PAY-02, PAY-09, PAY-10
**Success Criteria** (what must be TRUE):

  1. A visitor can select an open Cohort and see current price, dates, mode, availability, prerequisites, and completion expectation before continuing. (REG-01)
  2. The selected offer survives identity verification/sign-in and returns the learner to their intended order. (REG-02)
  3. Each checkout attempt creates exactly one traceable, idempotent order; replays cannot create duplicate enrolments. (REG-03)
  4. Required terms, privacy notice, refund/cancellation policy, and optional marketing consent are captured with versions, separately, at order time. (REG-04)
  5. A learner can pay via Stripe; only a server-verified result (never a client redirect) marks the order paid and activates enrolment exactly once, through a shared, provider-agnostic payment state machine, and the learner receives a confirmation email and receipt/order record. (PAY-02, PAY-09, PAY-10, REG-05)

**Plans**: 1/9 plans executed across 6 waves (tracer-first: plan 03 proves the full visitor-to-enrolled path end to end — cohort card, order summary, Stripe Checkout, signature-verified webhook, receipt — before any expansion)
Plans:
**Wave 1**

- [ ] 06-01-PLAN.md — Stripe SDK behind its package-legitimacy gate, the single client module, and the NGN currency probe (PAY-09, PAY-10)
- [x] 06-02-PLAN.md — Shared-module extensions: domain-event union, refund/cancellation policy type, `applyEnrolmentActivation` extraction, `PublicCohort` commerce fields (REG-01, REG-04, PAY-02, PAY-09)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 06-03-PLAN.md — Tracer: cohort selection through to a webhook-settled, ACTIVE enrolment, end to end (REG-01, REG-03, REG-05, PAY-02, PAY-09, PAY-10)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 06-04-PLAN.md — REG-02: cohort selection survives registration, verification and sign-in via a single-use intent cookie (REG-02)
- [ ] 06-05-PLAN.md — REG-01 completeness: cohort-card boundary states and Programme offer parity (REG-01)
- [ ] 06-06-PLAN.md — Webhook hardening: replay safety, amount cross-check, terminal-state guards, the hold-expiry race, and the import-closure gate (REG-03, PAY-02, PAY-09, PAY-10)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 06-07-PLAN.md — REG-04: three versioned order-bound consents, the server-side pay gate, the hold countdown, and the decline/expired states (REG-04, PAY-02)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 06-08-PLAN.md — REG-05: confirmation email, the confirming interstitial, and the receipt with its honest exception sub-state (REG-05, PAY-02)

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 06-09-PLAN.md — Phase close: executable PAY-09/PAY-10 invariants, the full journey walkthrough, and record reconciliation (all eight requirements)

**Cross-cutting constraints:**

- Only the signature-verified webhook may write a paid order; no page, redirect handler or staff action may (PAY-10, T-06-61).
- Stripe-specific types and imports stay inside `src/server/payments/providers/stripe/`, enforced by `tests/checkout-phase-invariants.test.ts` (PAY-09).
- Seat capacity, holds and their expiry are Phase 5's `seat-accounting.ts` primitives called directly, never re-derived (D-09, D-12).
- The amount charged is always read from the `Cohort` row inside the order-creation transaction, never accepted from a client (D-07).

**UI hint**: yes

---

### Phase 7: Multi-Gateway Payments — Paystack, Manual & Refunds

**Goal**: A learner can pay by any deployment-enabled method, and staff can safely confirm manual payments and process refunds without ever creating a duplicate financial or enrolment effect.
**Depends on**: Phase 6
**Requirements**: PAY-03, PAY-04, PAY-05, PAY-07, PAY-08, PAY-11, PAY-13, PAY-14
**Success Criteria** (what must be TRUE):

  1. A learner can also pay via Paystack or an approved manual channel, chosen only when available for the order, and switching methods never creates a second order or enrolment. (PAY-08, PAY-11)
  2. Authorized staff can confirm a manual payment (amount, currency, date, channel, reference, evidence, reason) producing exactly one audit event and one enrolment effect. (PAY-03)
  3. A second success attempt on an already-paid order is rejected or safely reconciled, showing staff the existing transaction and a corrective path — never a silent duplicate. (PAY-04)
  4. Authorized staff can record or initiate a refund capped at eligible paid value, with reason, approver, and audit trail, routed to the original provider where supported. (PAY-05, PAY-13)
  5. Duplicate, delayed, or out-of-order provider notifications become a visible exception rather than a duplicate effect, and gateway credentials/webhook secrets never appear outside deployment-managed secret storage. (PAY-07, PAY-14)

**Plans**: TBD
**UI hint**: yes

---

### Phase 8: Finance Reconciliation, Dashboards & Reporting Exports

**Goal**: Finance/Operations staff can trust the numbers — reconciled across providers, correctly scoped, and exportable.
**Depends on**: Phase 7
**Requirements**: PAY-06, PAY-12, RPT-01, RPT-02, RPT-03, RPT-04, RPT-05
**Success Criteria** (what must be TRUE):

  1. Finance/Operations staff can distinguish Paystack, Stripe, and manual records in a reconciliation view where totals match transaction rows for the same filters. (PAY-06, PAY-12)
  2. Every operational dashboard (registrations, payments, enrolments, attendance, progress, submissions, grades, completion, certificates, support) states its metric definition, filters, and last-refreshed time, scoped to the requester's permissions. (RPT-01, RPT-02)
  3. Staff can export CSV datasets with stable columns, applied filters, and generation time; large exports run asynchronously with queued/processing/succeeded/failed/retry states and short-lived authorized download links. (RPT-03, RPT-04)
  4. Authorized reviewers can filter and export an audit view of security and sensitive business actions without exposing secrets. (RPT-05)

**Plans**: TBD
**UI hint**: yes

---

### Phase 9: Learning Delivery & Progress Tracking

**Goal**: An enrolled learner has a working self-paced/instructor-led learning experience with trustworthy, rule-based progress.
**Depends on**: Phase 5 (cohorts/sessions), Phase 6 (an active enrolment must exist to populate the learner dashboard)
**Requirements**: LRN-01, LRN-02, LRN-03, LRN-04, LRN-05, LRN-06, LRN-07
**Success Criteria** (what must be TRUE):

  1. An enrolled learner sees a personal dashboard showing only their own records: next action, progress, scheduled sessions, assessment obligations, results, tickets, and certificate state. (LRN-01)
  2. Modules and Lessons render in defined order with prerequisite locks enforced server-side, explaining any unmet condition. (LRN-02)
  3. Every supported content type displays securely and accessibly, with authorized file access only. (LRN-03)
  4. Lesson completion is tracked idempotently per content-appropriate rule, and a learner can manually complete a Lesson only where policy allows and only within their own valid access window. (LRN-04, LRN-05)
  5. Eligible learners see session details and meeting links within the configured visibility window, and Course/Programme completion is calculated from versioned rules against current evidence, identifying each satisfied/unmet rule. (LRN-06, LRN-07)

**Plans**: TBD
**UI hint**: yes

---

### Phase 10: Assessment — Quizzes, Assignments & Grading

**Goal**: The full assessment loop works: build, attempt, submit, grade, release, and correct — with drafts always invisible to learners.
**Depends on**: Phase 9
**Requirements**: ASM-01, ASM-02, ASM-03, ASM-04, ASM-05, ASM-06, ASM-07
**Success Criteria** (what must be TRUE):

  1. Staff can build versioned Quizzes (questions, marks, pass threshold, attempt limits) and Assignments (instructions, due date, file constraints, grading scale, resubmission policy), with draft validation catching incomplete items. (ASM-01, ASM-03)
  2. Objective Quiz answers are scored automatically and reproducibly, with full attempt evidence stored. (ASM-02)
  3. A learner's Assignment submission produces a durable receipt and never shows false success on failure. (ASM-04)
  4. Graders see only in-scope submissions, can save draft grades invisibly to learners, and must explicitly release results; overrides require a mandatory reason and are fully audited. (ASM-05, ASM-06)
  5. Learners see only released results, feedback, attempt history, and unmet pass requirements. (ASM-07)

**Plans**: TBD
**UI hint**: yes

---

### Phase 11: Certificates & Completion Lifecycle

**Goal**: Certificates are trustworthy — issued only when earned, publicly verifiable with minimal data, and correctly revisited when underlying results change.
**Depends on**: Phase 10 (grading results), Phase 5 (attendance rules feed completion)
**Requirements**: CRD-01, CRD-02, CRD-03, CRD-04, CRD-05, CRD-06
**Success Criteria** (what must be TRUE):

  1. A Course certificate issues only once, exactly when standalone completion rules pass and issuance is enabled; a Programme certificate issues only after all required Courses and Programme-level rules pass. (CRD-01, CRD-02)
  2. Every issued certificate is downloadable, access-controlled, and carries a unique public verification reference showing only approved minimal facts. (CRD-03, CRD-04)
  3. Authorized staff can revoke and reissue a certificate with reason, linking old and new versions while preserving history. (CRD-05)
  4. A later grade, attendance, or completion correction flags affected certificates for review without silently altering or destroying the original record. (CRD-06)

**Plans**: TBD
**UI hint**: yes

---

### Phase 12: Support Tickets

**Goal**: Learners can get help, and staff (not only Administrators) can run a real support queue without leaking internal notes.
**Depends on**: Phase 2 (role system needed for a custom Support Agent role); contextual record links deepen as Phases 5/6/9/11 land but are not required to start
**Requirements**: SUP-01, SUP-02, SUP-03, SUP-04, SUP-05, SUP-06
**Success Criteria** (what must be TRUE):

  1. A learner can create and view their own tickets (category, subject, description, permitted attachments) with a reference and status, seeing only public replies and their own attachments. (SUP-01)
  2. Staff can set priority, status, and assignment, and add either a public reply or a private internal note that a learner never sees; every transition is timestamped and attributed. (SUP-02)
  3. A custom Support Agent role can triage and resolve tickets via `tickets.view`/`tickets.manage` without gaining unrelated financial, grading, or user-management access. (SUP-03)
  4. Staff can escalate a ticket to another owner/queue with a reason, preserving history and visible in reporting; contextual links to learner/cohort/order/submission/certificate records re-check permission on open. (SUP-04, SUP-05)
  5. Ticket volume, age, priority, status, ownership, response, resolution, and escalation are reportable and exportable, excluding private notes. (SUP-06)

**Plans**: TBD
**UI hint**: yes

---

### Phase 13: Transactional Communications & Notifications

**Goal**: Every meaningful lifecycle event across the whole system reliably reaches the right person exactly once.
**Depends on**: Phase 3 (verification/reset), Phase 5 (session change), Phase 6 (order/enrolment), Phase 7 (payment outcome), Phase 10 (result release), Phase 11 (certificate issuance/revocation), Phase 12 (ticket activity)
**Requirements**: COM-01, COM-02, COM-03, COM-04
**Success Criteria** (what must be TRUE):

  1. Every defined lifecycle event (verification, reset, order/payment outcome, enrolment, session change, result release, certificate issuance/revocation, ticket activity) sends exactly one templated transactional email under one approved sender identity. (COM-01, COM-04)
  2. Retried or replayed events never produce duplicate messages within the same correlation. (COM-02)
  3. Important in-product notifications surface unread/current state to the right user and fail safely on stale or inaccessible links. (COM-03)

**Plans**: TBD
**UI hint**: yes

---

### Phase 14: Software Licence & Deployment Control

**Goal**: The deployment enforces its own commercial licence terms without ever risking client data.
**Depends on**: Phase 2 (global-scope permission model, Administration area conventions)
**Note**: Stays in v1 scope per PRD §18.3 (all MUST), but `docs/TRACK-A-TASKS.md` explicitly flagged this module as "gated on commercial terms nobody has approved (§18.6)" — a business/contract gate, not a technical scope cut. Sequencing may slip pending that approval; see PROJECT.md Key Decisions.
**Requirements**: LIC-01, LIC-02, LIC-03, LIC-04, LIC-05, LIC-06, LIC-07, LIC-08
**Success Criteria** (what must be TRUE):

  1. The LMS verifies a provider-signed licence at startup, on a scheduled cadence, and before high-impact mutations, rejecting altered/expired/wrong-client/wrong-deployment licences. (LIC-01, LIC-04)
  2. Users with `licence.view` see current state, licence ID, client, dates, and validation result without exposed signing secrets; only the narrow `licence.activate` permission can activate a provider-issued licence — nothing can forge or self-extend one. (LIC-02, LIC-03)
  3. On reaching the expiry/grace threshold, the system enforces a read-only state server-side and in the UI without deleting client data. (LIC-05, LIC-08)
  4. Every licence event (activation, validation outcome, state transition, restriction enforcement) is audited and triggers the appropriate Administrator notification. (LIC-06, LIC-07)

**Plans**: TBD
**UI hint**: yes

---

### Phase 15: Launch Readiness — NFR Verification & Operational Cutover

**Goal**: The system is demonstrably ready to run the business, not just feature-complete.
**Depends on**: All prior phases (1–14)
**Requirements**: NFR-01, NFR-02, NFR-03, NFR-04, NFR-05, NFR-06, NFR-07, NFR-08, NFR-09, NFR-10, NFR-11, NFR-12, NFR-13, NFR-14
**Success Criteria** (what must be TRUE):

  1. The full learner + operator journey (discover → register → verify → pay → learn → attend → submit → grade → complete → download certificate) runs unassisted end to end against real seeded data. (NFR-03, NFR-13, NFR-14)
  2. Core authenticated views meet the p75 2.5s interactive-performance bar, and the service meets its 99.5% monthly availability target under agreed load. (NFR-01, NFR-02)
  3. The security baseline (TLS, encryption at rest, secure hashing, secret management, rate limiting, dependency scanning) and authorization coverage — including private-file downloads — pass a direct-request bypass test suite. (NFR-04, NFR-05, NFR-06)
  4. Security/business events remain auditable and observable, and a backup/restore rehearsal meets RPO 24h / RTO 8h. (NFR-07, NFR-08)
  5. Core public/learner/staff journeys meet WCAG 2.2 AA, work responsively across the agreed viewport range, follow the approved privacy/data-lifecycle policy, and support the agreed browser matrix. (NFR-09, NFR-10, NFR-11, NFR-12)

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phase 1 → {Phase 2, 3} and {Phase 4, 5} in parallel → Phase 6 (convergence) → {Phase 7 → Phase 8} and {Phase 9 → Phase 10 → Phase 11} in parallel → Phase 12 → Phase 13 → Phase 14 → Phase 15

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation, Authorization Core & Course Reference Slice | Retroactive | Complete | 2026-09-01 |
| 2. Roles, Permissions & Staff Accounts | 8/8 | Complete    | 2026-09-02 |
| 3. Public Identity — Registration, Verification & Secure Sessions | 10/10 | Complete | 2026-09-03 |
| 4. Catalogue Authoring — Programmes, Courses, Modules & Lessons | 15/15 | Complete | 2026-09-03 |
| 5. Cohorts, Scheduling, Enrolment Operations & Attendance | 16/16 | Complete | 2026-09-07 |
| 6. Registration, Checkout & Stripe Payments | 1/9 | In Progress|  |
| 7. Multi-Gateway Payments — Paystack, Manual & Refunds | 0/TBD | Not started | - |
| 8. Finance Reconciliation, Dashboards & Reporting Exports | 0/TBD | Not started | - |
| 9. Learning Delivery & Progress Tracking | 0/TBD | Not started | - |
| 10. Assessment — Quizzes, Assignments & Grading | 0/TBD | Not started | - |
| 11. Certificates & Completion Lifecycle | 0/TBD | Not started | - |
| 12. Support Tickets | 0/TBD | Not started | - |
| 13. Transactional Communications & Notifications | 0/TBD | Not started | - |
| 14. Software Licence & Deployment Control | 0/TBD | Not started | - |
| 15. Launch Readiness — NFR Verification & Operational Cutover | 0/TBD | Not started | - |
