# Professional Training LMS

## What This Is

A self-hosted Learning Management System for a professional training provider: staff build Programmes, Courses, Modules, and Lessons; learners discover, register for, and pay for Cohorts; the platform then carries them through delivery, attendance, assessment, and certification. The provider's own operations team runs it day to day (Administrator, Programme Manager, Instructor, Finance/Operations roles); learners are the paying end users. It is built on Next.js 16 App Router with a single authorization choke point in front of every protected operation.

## Core Value

The complete learner + operator journey — discover → register → verify → pay → learn → attend → submit → grade → complete → download certificate — runs end to end against real seeded data, with every mutation authorized, scoped to the right role/resource, and audited. If this journey breaks anywhere, nothing else about the product matters.

## Business Context

- **Customer**: The training provider's own operating team runs the platform (internal ops); learners are the paying end users.
- **Revenue model**: Course, Programme, and Cohort sales via Paystack, Stripe, or approved manual payment.
- **Success metric**: The full learner + operator journey (see Core Value) completes unassisted against seeded data, matching the PRD's "operational readiness" release focus and the Definition of Done in `docs/TRACK-A-TASKS.md`.
- **Strategy notes**: `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` (product authority), `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` (UI/workflow spec, PRD remains authority on conflict).

## Requirements

### Validated

<!-- Shipped, proven by the existing codebase. Evidence: .planning/codebase/*.md (analysis date 2026-09-01). -->

- ✓ **RBAC-05**: Global/Programme/Course/Cohort grant scoping — mechanism implemented and tested (`src/server/permissions/scope.ts`, `tests/scope.test.ts`) — Phase 1. See `.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`.
- ✓ **RBAC-06**: Server-side authorization on every protected Course operation, including denial of direct-request bypass — the `withPermission` choke point (`src/server/permissions/with-permission.ts`), proven end to end on Courses and inherited automatically by every future resource-service — Phase 1. See `.planning/codebase/ARCHITECTURE.md`.
- ✓ **CAT-01** (Course portion): Course create/edit/archive with draft/status fields, via the resource-service factory, staff UI (`/staff/courses`), and passing tests — Phase 1. See `.planning/codebase/STRUCTURE.md`, `TESTING.md`. (Programme/Module/Lesson/versioning portions of the Catalogue requirement set remain Active — see CAT-02..08 below.)
- ✓ **RBAC-01, RBAC-03**: Closed permission-catalogue role authoring — five seeded default roles, custom roles built only from the 36-identifier catalogue, unknown/duplicate/malformed permissions rejected server-side — Phase 2. See `role-service.ts`, `tests/role-service.test.ts`.
- ✓ **RBAC-02**: Versioned role edit/history — every edit appends a new `RoleVersion`, prior versions immutable, reason required for sensitive permission reductions — Phase 2.
- ✓ **RBAC-04**: Multi-scope role assignment — a staff account can hold concurrent assignments across Global/Programme/Course/Cohort scope; revoking one leaves siblings untouched — Phase 2.
- ✓ **RBAC-07**: Role-management continuity safeguard — blocks any change that would leave zero active GLOBAL `roles.manage` holders, at all four trigger points (role edit/deactivate, assignment revoke, staff-account deactivate) — Phase 2. See `continuity-service.ts`.
- ✓ **RBAC-08**: Full audit trail — every role/assignment/staff-account change visible with actor, before/after, reason, timestamp; append-only, credential-redacted — Phase 2. See `audit-service.ts`, `/staff/audit`.
- ✓ **IAM-04**: Staff account administration — atomic create-plus-first-assignment, deactivate/reactivate with session revocation, one-time temporary password — Phase 2. See `staff-account-service.ts`.

Verified by an independent security audit (26 threats, 0 open) and goal-backward verification (`.planning/phases/02-roles-permissions-staff-accounts/02-VERIFICATION.md`); 219/219 tests passing.

Cross-cutting foundation *also* already in place, underpinning multiple future requirements even though it is not itself a REQ-ID: folder-boundary ESLint rule confining `@prisma/client` to `src/server/services/**`; the closed 36-identifier permission catalogue (`src/server/permissions/catalogue.ts`); the resource-service CRUD factory; audit-first write path (`AuditEvent`); hand-rolled database-session auth (sign-in/out, lockout, selective+global session revocation). 84 tests passing across 10 files as of 2026-09-01.

- ✓ **ASM-01 through ASM-07**: Full assessment loop — versioned Quiz/Assignment authoring with draft-validation, automatic reproducible Quiz scoring with full attempt evidence, verified two-step Assignment submission with durable receipts, Cohort-scoped grading with invisible drafts and explicit release, mandatory-reason audited overrides, and learner-visible released-only results — Phase 10. Verified by goal-backward verification (`.planning/phases/10-assessment-quizzes-assignments-grading/10-VERIFICATION.md`, 7/7 must-haves) and a delegated 30-step Chrome walkthrough (7 defects found and fixed). See `10-VALIDATION.md`.
- ✓ **CRD-01 through CRD-06**: Certificates and completion lifecycle — Course certificates issue once when completion rules pass and issuance is enabled, Programme certificates only after every required Course and the Programme rule pass (D-01); AUTOMATIC or MANUAL issuance per Course/Programme with a reusable template library and a keyboard-accessible layout editor; per-learner PDF (bundled Noto Sans, Latin-extended/Yoruba names render, other scripts print `?`), unique 128-bit public verification reference, owner/scoped-staff download with identical-404 denial parity, public verification page disclosing only status, name, award and issue date; staff revoke and reissue with mandatory reasons and a preserved supersede chain; grade, attendance and completion corrections flag certificates for review and never delete them — Phase 11. Verified by goal-backward verification (4/4 success criteria), a 20/20 UAT (browser-driven, isolated database), a 200/200 threat-register security audit (`11-SECURITY.md`), and a human visual check of the generated PDFs. Known accepted limitations: a false-alarm review flag cannot be cleared (CR-05), audit rows are not on the caller transaction (WR-02), about 316 KB per PDF.

### Active

<!-- Current v1 scope. Full requirement list with acceptance criteria: .planning/REQUIREMENTS.md. -->

- [ ] **Identity & Sessions** — IAM-01, IAM-02, IAM-03, IAM-05, IAM-06 (registration, email verification, password reset, profile management, anti-enumeration/brute-force; sign-in/out/lockout mechanism already scaffolded, password reset still missing; IAM-04 staff-account admin shipped in Phase 2, see Validated)
- [ ] **Catalogue & Content** — CAT-02 through CAT-08 (Programmes, Modules/Lessons, content types, versioning, instructor publish, public catalogue pages, archive-without-breaking-history)
- [ ] **Cohorts, Scheduling & Attendance** — COH-01 through COH-07, ATT-01 through ATT-04
- [ ] **Registration & Orders** — REG-01 through REG-05
- [ ] **Payments, Refunds & Reconciliation** — PAY-02 through PAY-14 (PAY-01 superseded by PAY-08 within the PRD itself — see REQUIREMENTS.md)
- [ ] **Learning Delivery & Progress** — LRN-01 through LRN-07
- [ ] **Communications** — COM-01 through COM-04
- [ ] **Support Tickets** — SUP-01 through SUP-06
- [ ] **Dashboards, Reports & Audit Export** — RPT-01 through RPT-05
- [ ] **Non-Functional / Launch Gates** — NFR-01 through NFR-14
- [ ] **Software Licence & Deployment Control** — LIC-01 through LIC-08 (v1 scope per PRD, but contingent on commercial-terms approval — see Key Decisions)

Full descriptions, acceptance criteria, and phase mapping: `.planning/REQUIREMENTS.md`.

### Out of Scope

**Approved payment-facilitation boundary (2026-09-11):** The tenant selector, tenant provisioning, cross-school LMS administration, and cross-client reporting remain out of scope: each deployment serves one school. KQ NEXUS is nevertheless the approved payment facilitator for online checkout, using provider-native split settlement to collect its 1.5% platform fee while the school receives its administrator-entered base price. This narrow commerce role supersedes any reading of the bullets below that would prohibit split payments, but it does not create a platform-operator workspace inside the LMS.

- Tenant selector / multi-tenant platform operator model — PXR §1 scope guardrail; this is a single-client deployment, not a platform.
- Cross-client reporting and reseller functions — PXR §1 scope guardrail; no multi-client commercial model exists.
- Self-service branding/tenant configuration — one approved client brand and sender identity per deployment is sufficient (COM-04).
- Google Classroom workflow integration and Google Drive learning-record integration — PXR §1 scope guardrail.
- A separate "Offering" entity or alternative commercial model — the PRD's Course/Programme/Cohort model is the only one; the PXR adds no alternative.
- Native mobile apps and a public API marketplace — ruled out by PRD §5.2 for this release; also the reason the codebase is one Next.js application rather than a frontend/backend split (foundation design D1).

## Context

**Brownfield project, mid-flight.** This roadmap was generated by ingesting `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` (product authority), its companion PXR (UI/workflow spec), two internal specs/plans (`docs/superpowers/specs/2026-09-01-track-a-foundation-design.md`, `docs/superpowers/plans/2026-09-01-auth-and-courses-slice.md`), and the 7-day lead-developer task list (`docs/TRACK-A-TASKS.md`) — then reconciling all of it against what the codebase actually contains (`.planning/codebase/*.md`, mapped 2026-09-01).

**What already exists:** folder-boundary lint rule, the closed 36-identifier permission catalogue, the `withPermission` authorization choke point and resource-service CRUD factory, the full Prisma data model (~30 models, 1252-line schema), hand-rolled database-session authentication (sign-in/out, lockout, selective + global revocation), a Courses reference vertical slice (list/get/create/update/archive with staff UI), and four reusable UI primitives (ResourceTable, ResourceForm, DetailLayout, ConfirmModal) powering the staff workspace. 84 tests pass across 10 files.

**Known gaps** (see `.planning/codebase/CONCERNS.md` for full detail): payment provider integrations (Stripe, Paystack) are schema-only, no logic; no email-sending provider is wired despite the `EmailDispatch` model existing; no completion-rule evaluation engine exists despite `completionRule` JSON fields on Programme/Course/Lesson; no file upload/virus-scanning despite `scanStatus` fields on LessonResource/Submission/TicketAttachment; password reset is not implemented; bulk table actions have empty handlers; no `error.tsx`/`not-found.tsx` pages exist yet.

**Team structure:** two developers work in parallel, not sequentially. A lead developer owns **Identity & Commerce** (auth, RBAC, orders/payments/refunds/reconciliation) per `docs/TRACK-A-TASKS.md`'s day-by-day plan. A second ("support") developer owns **Content & Delivery** (Programme/Course/Module/Lesson/Cohort/Session/Assessment/Attempt/Submission/Grade/Certificate/Attendance/Ticket) — no equivalent day-by-day document exists for this track; its requirements were inferred from the PRD/PXR requirement IDs not covered by Track A. Both tracks share the same foundation (`withPermission`, the resource-service factory, the UI primitives) so they converge without reconciling two sets of conventions. `.planning/ROADMAP.md` phases are tagged by track and flagged where they can run in parallel rather than strictly in sequence.

**Scope directive:** this roadmap covers the entire PRD/PXR scope across both tracks through to launch readiness (PRD §14.3 launch gates) — not only the first 7-day Track A slice, which was a pace-setting starting point for one track, not the ceiling of the project.

## Constraints

- **Tech stack**: Next.js 16.3.4, App Router, TypeScript strict mode, React 19.2.8, Prisma 6.19.3 + PostgreSQL (Neon in dev), Tailwind CSS 4, Vitest — locked to what the live `package.json` actually pins, not the stale foundation-design SPEC's "Next.js 15."
- **Auth architecture**: No Auth.js. Hand-rolled database sessions — Auth.js's Credentials provider forces the JWT strategy, and a signed token cannot be revoked before it expires, which cannot satisfy IAM-03's selective/global session-revocation requirement.
- **Repository shape**: One Next.js application, one repository — no frontend/backend split, no package-based monorepo. Avoids a second authorization surface and matches PRD §5.2's exclusion of native apps / a public API marketplace.
- **Prisma import boundary**: `@prisma/client` may be imported only from `src/server/services/**` and `src/server/db.ts`, enforced by an ESLint `no-restricted-imports` rule (not convention) — required for RBAC-06 / NFR-05 given AI-assisted code-generation risk.
- **Permission catalogue**: a closed, typed, 36-identifier tuple in `src/server/permissions/catalogue.ts`; unknown permission strings fail at compile time (RBAC-03). `licence.view` and `licence.activate` are global-scope-only permissions (PRD §18.4).
- **Money handling**: integer minor units only, never floating point.
- **No hard deletes**: archive-only everywhere (CAT-08 and general codebase convention).
- **Secrets**: never enter source control (PAY-14); `.env*` is excluded from git.
- **Deployment**: self-hosted, Docker Compose (app + pg-boss worker + Postgres + MinIO, per the foundation spec) — one deployable artifact.
- **Availability / performance / recovery targets**: ≥99.5% monthly availability, p75 ≤2.5s interactive on core authenticated views, RPO 24h / RTO 8h (NFR-01, NFR-02, NFR-08).
- **Accessibility**: WCAG 2.2 AA across core public, learner, and staff journeys (NFR-09).
- **Process**: two developers work in parallel on separate tracks sharing one foundation; agent workers must not run `git commit` (report the suggested message instead); merge daily, no long-lived branches.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| No Auth.js — hand-rolled database sessions | Auth.js's Credentials provider forces JWT; IAM-03 requires selective/global session revocation before token expiry, which a signed JWT cannot support | ✓ Good — implemented (`src/server/auth/current-actor.ts`, `src/server/services/auth-service.ts`); user-confirmed 2026-09-01 in `.planning/INGEST-CONFLICTS.md` |
| Next.js 16.3.4 is the locked tech-stack version (not the foundation-design SPEC's "15") | Live `package.json` pins `"next": "16.3.4"` and the app runs on it; the SPEC text was stale | ✓ Good — user-confirmed 2026-09-01 in `.planning/INGEST-CONFLICTS.md` |
| One Next.js app / one repository, no monorepo | Avoids a second authorization surface; PRD §5.2 rules out native apps and a public API marketplace | ✓ Good — implemented |
| `@prisma/client` imports confined to the service layer via ESLint | RBAC-06 / NFR-05 require server-side authorization on every protected operation; convention alone is unsafe given AI-assisted code generation | ✓ Good — implemented and tested (`tests/boundary.test.ts`) |
| Roadmap covers the full PRD/PXR scope end to end through launch readiness, not just the 7-day Track A slice | Explicit user directive — the 7-day document is a pace-setter for one track, not the ceiling of the project | — Pending |
| Software Licence module (LIC-01..08) stays in v1 scope but is sequenced last and flagged contingent | PRD requires it as MUST (§18.3); `docs/TRACK-A-TASKS.md` explicitly deferred its build, "gated on commercial terms nobody has approved (§18.6)" — a business gate, not a technical scope cut | — Pending |
| Two-track parallel development (Identity & Commerce / Content & Delivery) sharing one foundation | Two developers working concurrently; sharing `withPermission`/resource-service/UI primitives avoids reconciling two sets of conventions later | — Pending |
| RBAC-07 continuity guard uses a transaction-scoped count, not a row lock | A row lock would need raw SQL with no precedent in this codebase and would be untestable without a real database; the action (revoking the last admin) is rare and already reactive-only | ✓ Accepted — narrow READ COMMITTED TOCTOU race documented and accepted, not closed; user-confirmed 2026-09-02 (`02-SECURITY.md` AR-02-01) |
| Certificate issuance is database-only inside the caller's transaction; the PDF is rendered and stored after commit | Rendering and object-store I/O inside the learner's lesson-progress or attendance transaction let a font error or slow storage roll back the learner's write (found in review CR-01 and WR-01) | ✓ Good — implemented (`certificate-file-service.ts`, plans 11-30/11-31); a missing file is produced on demand after authorization |
| A REVOKED certificate is never followed by an automatic re-issue; only staff Reissue replaces it | A revocation (possibly for misconduct) must not be undone by automation, including a learner undoing and redoing a lesson (CRD-05) | ✓ Good — implemented and tested against real Postgres (plan 11-25) |
| Certificates embed the whole bundled Noto Sans font, not a subset | fontkit's subsetter truncated the font program so most glyphs drew blank while every text-extraction test passed; found by the human visual check | ✓ Good — fixed with outline-asserting tests; trade-off about 316 KB per PDF, a trimmed Latin-only font is a follow-up |
| A false-alarm certificate review flag cannot be cleared (CR-05 deferred); staff use Revoke and Reissue | Keeps the earlier locked no-Clear-flag decision; a confirm action would need its own plan | — Pending (accepted limitation, revisit if flags become operational pain) |

---
*Last updated: 2026-09-19 after Phase 11 (Certificates & Completion Lifecycle) completed — 4/4 success criteria verified, UAT 20/20, security audit 200/200 threats closed, human PDF check passed, CR-06 migration applied.*
