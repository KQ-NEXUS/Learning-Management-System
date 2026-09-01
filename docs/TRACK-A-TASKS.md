# Track A — Lead Dev Task List

**Owner:** Lead developer
**Track:** Identity & Commerce
**Window:** 7 days
**Source:** PRD Revision 3 §§1–19, PXR Revision 3
**Companion:** [LMS Build Week](https://claude.ai/code/artifact/6e33334c-0d7e-4bb1-b034-0bd6492d35bf)

Tick items as you go. Anything marked **[shared]** is done with Dev 2, not alone.
A task is done when it *runs*, not when its screen exists — see [Definition of Done](#definition-of-done).

---

## Day 1 — Foundation `[shared]`

The day that produces nothing visible and decides the other six. Do not split it, do not skip ahead to payments.

### Your first three hours (alone, before anything else)

- [ ] Create repo, Next.js + TypeScript app, and the folder tree:
      `src/app/`, `src/server/{services,permissions,auth,audit,payments}`, `src/components/primitives/`
- [ ] Write the ESLint rule banning `@prisma/client` imports outside `src/server/services/` — **before** there is any code to violate it
- [ ] Commit the scaffold. Everything both of you write lands inside it.
- [ ] Write `src/server/permissions/catalogue.ts` — the typed const, transcribed from PRD §17.2:
      `export const PERMISSIONS = [...] as const;`
      `export type Permission = typeof PERMISSIONS[number];`
      Makes RBAC-03 ("unknown permission strings are rejected") a compile error, and gives Dev 2 autocomplete over the exact vocabulary.

### Schema `[shared]`

- [ ] **You drive:** User, Role, Assignment, AuditEvent, Order, PaymentAttempt, Enrolment
- [ ] **Dev 2 drives:** Programme, Course, Module, Lesson, Cohort, Session, Assessment, Attempt, Submission, Grade, Certificate, Attendance, Ticket
- [ ] **Settle the Cohort contract out loud** — price, currency, capacity, enrolment window. This is the only place the two tracks meet, and it does not change afterwards without both of you agreeing.
- [ ] Hand-written SQL migrations for what Prisma cannot express:
  - [ ] Partial unique index — one **active** enrolment per (learner, cohort)
  - [ ] Unique idempotency key on payment attempts
  - [ ] Row-level locking for cohort capacity — `count()` then `create()` **fails** under concurrent checkout (COH-06)

### Patterns (yours — the contract every slice inherits)

- [ ] `withPermission(permission, scopeResolver)` — wraps every server action. Security control, audit hook, and the reason neither of you writes authz logic twice.
- [ ] Scope resolver: global / Programme / Course / Cohort, matched to the record and its parents (RBAC-05)
- [ ] Deny by default — absent, inactive, expired or non-matching grant is a denial (RBAC-06)
- [ ] Resource service factory: list / get / create / update / archive with permission, scope and audit pre-wired
- [ ] Test that walks every exported action and asserts unauthenticated denial
- [ ] **Prove it on Courses** end to end before either of you starts a real slice

> Dev 2 owns in parallel: Docker Compose (app + pg-boss worker + Postgres + MinIO), migrations on container start, seed script, CI, the four UI primitives.

**Day 1 is not finished until `withPermission` and the service factory are proved.** If they aren't, Dev 2 spends day 2 inventing their own conventions and you spend day 5 reconciling two of everything.

---

## Day 2 — Users, roles, assignments, audit

`RBAC-01 → RBAC-08`

- [ ] Seed the five default roles — Administrator, Programme Manager, Instructor, Finance/Operations, Learner (RBAC-01)
- [ ] Role editor bound to the closed permission catalogue — arbitrary strings rejected (RBAC-03)
- [ ] Role versioning — edits create a new version, prior versions preserved (RBAC-02)
- [ ] Assignment drawer: user × role × scope (global / Programme / Course / Cohort), with start/end/active state
- [ ] Effective access = union of matching active grants; revocation removes only the selected assignment (RBAC-04)
- [ ] **Continuity safeguard** — block any change leaving no active user with `roles.manage` (RBAC-07)
- [ ] Audit log view: actor, target, before/after, scope, reason, time, correlation (RBAC-08)
- [ ] Staff account create / invite / deactivate / reactivate, audited (IAM-04)

---

## Day 3 — Public catalogue, registration, sessions

`IAM-01 → IAM-06 · CAT-07 · REG-02`

- [ ] Public catalogue: offer list, search, filter, Course/Programme detail, cohort selection
- [ ] Only published offers appear; direct unpublished URLs reveal nothing (CAT-07)
- [ ] Registration with required policy acceptance, storing consent versions (IAM-01, REG-04)
- [ ] Email verification — single-use expiring token, activates once (IAM-02)
- [ ] Postmark wired and actually sending
- [ ] Sign-in / sign-out / password reset; **database sessions**, selective and global revocation (IAM-03)
- [ ] Non-enumerating errors, rate limiting, lockout; no secrets in logs (IAM-06)
- [ ] **Selection survives registration and verification** and returns to checkout (REG-02)

---

## Day 4 — Orders, checkout, Stripe

`REG-01 → REG-05 · PAY-01, PAY-02, PAY-10`

- [ ] One traceable order per checkout attempt, with correlation + idempotency identity (REG-03)
- [ ] Shared payment state machine: pending → processing → succeeded / failed / cancelled (PAY-02)
- [ ] Revalidate capacity, price, currency and availability before payment initiation
- [ ] Stripe handoff + return screen that does **not** claim success
- [ ] Stripe webhook with **raw body** signature verification (disable body parsing on the route)
- [ ] Server-verified result is the *only* success trigger — a redirect never marks an order paid (PAY-10)
- [ ] Verified success activates the enrolment **exactly once**
- [ ] Order confirmation email + receipt / order record (REG-05)

---

## Day 5 — Paystack, manual payment, refunds

`PAY-03 → PAY-05 · PAY-08, PAY-09, PAY-13, PAY-14`

- [ ] Paystack adapter behind the same interface — adapters differ, the state machine does not (PAY-09)
- [ ] Payment method selector; only deployment-enabled, order-eligible methods selectable (PAY-08)
- [ ] Switching method keeps **one** order and cannot produce a second enrolment
- [ ] Manual payment instructions + pending-review state; no access before confirmation
- [ ] Manual confirmation requiring amount, currency, date, channel, reference, evidence, reason (PAY-03)
- [ ] Duplicate / conflicting confirmation blocked, showing existing state and corrective path (PAY-04)
- [ ] Refunds routed to original provider where supported, else recorded manually; capped at eligible paid value (PAY-05, PAY-13)
- [ ] Gateway credentials and webhook secrets in deployment-managed secret storage — never in browser, UI, exports, audit detail or source control (PAY-14)

---

## Day 6 — Reconciliation, dashboards, export

`PAY-06, PAY-07, PAY-12 · RPT-01 → RPT-03`

- [ ] Provider and currency as first-class filters — Paystack, Stripe and manual stay distinguishable (PAY-12)
- [ ] Duplicate, delayed and out-of-order events become **visible exceptions**, never duplicate outcomes (PAY-07)
- [ ] Reconciliation view: compare records, filter exceptions, resolve with reason
- [ ] Commercial dashboard — totals reconcile with transaction rows for the same filters and as-of time (RPT-01)
- [ ] CSV export with stable columns, applied filters, generation time (RPT-03)
- [ ] Export applies the requester's permissions and scope; sensitive columns off by default (RPT-02)
- [ ] Synchronous CSV for now — pg-boss queue swapped in after the week

---

## Day 7 — Integrate `[shared]`

- [ ] Connect checkout to real cohorts; verified payment activates a real enrolment, once
- [ ] Seed a complete demo dataset — a Programme, a standalone Course, a cohort, staff, learners
- [ ] Walk the full journey unassisted: discover → register → verify → pay → learn → attend → submit → grade → complete → download → verify certificate
- [ ] Run the authorization bypass suite — direct requests to every action without a matching grant
- [ ] Compose deploy end to end on a clean machine, empty volume to running app
- [ ] Operator runbook: backup, restore, secret rotation, upgrade with migrations
- [ ] Support tickets **only if time remains** — cheapest thing to cut

---

## Definition of Done

A slice is finished when:

1. **It runs** — against real seeded data, not just renders
2. **Its actions are wrapped** — every mutation through `withPermission` with a correct scope resolver
3. **An unauthorized direct request is denied**, and a test proves it
4. **All six states render** — loading, empty, populated, validation error, permission denied, recoverable failure
5. **Sensitive actions write audit events** — actor, before, after, reason, time
6. **It is merged** — long-lived branches over seven days is how two tracks become two codebases

---

## Standing rules

- Nothing imports Prisma outside `src/server/services/`
- Deny by default; hidden UI controls are convenience, the server decision is the security
- Reason + audit on every integrity action: manual payment, refund, grade override, attendance correction, certificate revoke/reissue, role change, sensitive export
- Idempotency keys on anything with an effect: payments, enrolment activation, submissions, completion, certificate issuance, notifications
- **Payments have one owner — you, start to finish**
- Merge daily

---

## Deliberately not in this week

- **Licence module (PRD §18)** — gated on commercial terms nobody has approved (§18.6). Self-hosting makes it a speed bump, not a lock; the contract is the real control.
- **Async export queue** — pg-boss runs from day 1, exports move onto it later
- **Formal WCAG audit, security testing, restore rehearsal** — launch gates (§14.3), not build tasks
- **Support tickets** — day 7 if time remains

## Watch list

Where the residual risk actually sits:

- The duplicate / delayed / out-of-order webhook matrix (§19.5)
- Cohort capacity under genuinely concurrent checkout (COH-06)
- Never starting payments early — they are day 4, not day 1

---

## Notes & blockers

_Log anything that blocks you or that Dev 2 needs to know._
