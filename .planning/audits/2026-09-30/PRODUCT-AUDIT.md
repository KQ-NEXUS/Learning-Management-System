---
audited: 2026-09-30
branch: Khaliddev
head: ca2c518 (merge of Transactional-Communications into Khaliddev, not pushed)
scope: phases 1–13 as built; phase 13 audited in depth for the first time; 14–15 not started
previous: .planning/v1.0-MILESTONE-AUDIT.md (2026-09-25; every finding there is fixed)
method: code reading with file:line evidence, plus two same-day browser UAT rounds on the local Docker stack (round 1 on the pre-merge build, round 2 on the merged image 8e05a7dfbef4 with EMAIL_TRANSPORT=stub); logs in UAT-ROUND-1.md and UAT-ROUND-2.md beside this file
status: gaps_found
counts:
  deployment: 1 (high)
  security_authz: 3 (1 high, 2 medium)
  correctness: 5 (1 high, 3 medium, 1 low)
  integration: 4 (3 medium, 1 low)
  data_seed: 1 (high, deployment risk)
  ui_ux: 16 (medium/low)
---

# Product audit — 2026-09-30

The 2026-09-25 audit's 17 security findings, 7 integration warnings and 4 fix-first items are all fixed. This pass re-reads the product at the merge commit, with phase 13 (transactional email, notifications, email log; about 28k lines) audited for the first time, and adds the defects the same-day UAT confirmed in a real browser.

Nothing in this audit changed source code.

## 1. Fix first

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| A-14 | HIGH (deploy) | **The first production drain will email every learner about every historic event.** Phases 5–12 have written `DomainEvent` rows with no consumer. The drain has no age limit (claims `processedAt IS NULL` ordered by `occurredAt`), and migration `20260927015627_communications_notifications` does not mark pre-existing events processed. In UAT round 2, events from 2026-09-04 (26 days old: `cohort.cancelled`, `enrolment.withdrawn`/`cancelled`) were emailed and appeared as "Cohort cancelled" notifications for a cohort that is now in progress. Before deploying phase 13: mark events that predate the deploy as processed (a data migration), or add a max-age skip, and check the size of the Neon `DomainEvent` backlog. | `domain-event-drain-service.ts:170-185`; migration adds only `attempts`/`lastError` to `DomainEvent`; UAT round 2 drain of 36 backlog events. |
| A-01 | HIGH | **Passing a quiz never completes its lesson.** Lesson completion comes only from `LessonProgress` rows with source `MANUAL`, `AUTO_VIDEO` or `STAFF_OVERRIDE`; no attempt or submission path writes one. With `allowManualComplete=false` the learner is stuck after passing and every later lesson stays locked; with the editor default `true` (`LessonFormFields.tsx:279`) the quiz shows "Mark complete" and can be skipped without passing. | `lesson-progress-service.ts:367-395` (manual only), `learner-access.ts:~725` (locks from `completedIds`), `attempt-service.ts` (no progress write). UAT: learner2 passed 2/2 and 2.4 stayed locked until a staff override. |
| A-02 | HIGH (authz) | **Payments report bypasses `payments.view`.** The Payments dataset requires only `reports.view`, so Programme Manager and Instructor, who are 403'd on `/staff/payments`, see and export row-level payments: learner names, totals, gateway fees, school settlement, KQ NEXUS gross/net, refunds. Conflicts with RPT-02. | `report-registry.ts:134` (`permission: "reports.view"`); only the refunds export at `:271` checks `payments.view`. UAT: PM on `/staff/reports/payments`. |
| A-03 | HIGH (data) | **Databases seeded before 2026-09-20 carry two broken assessments that re-seeding never repairs.** The quiz has `passMark: 70` with `totalMarks: 2` (unpassable; pass mark is in marks, `quiz-scoring.ts:21`), and the assignment has `allowedFileTypes: ["application/pdf"]` while submission checks extensions, so every PDF is rejected. `3d90269` fixed the seed, but it skips existing assessments. **Check the Neon database behind the deployed site.** | `git show 0d8b501:prisma/seed.ts` lines 424/476; `seed.ts:707-720` (`findFirst` then skip); `submission-service.ts:422-431`. UAT reproduced both. |
| A-04 | MEDIUM (crash) | **`/staff/users/new` and `/staff/roles/new` crash for every role without `users.manage` / `roles.manage`.** The denied branch renders `<ResourceForm onSubmit={() => {}}>` from a Server Component ("Event handlers cannot be passed to Client Component props", digest 2657342927). Hit by Support Agent, Instructor, Programme Manager and Finance. | `src/app/staff/users/new/page.tsx:22-26`, `src/app/staff/roles/new/page.tsx:33-37` |

## 2. Security and authorization

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| A-02 | HIGH | See section 1. | |
| A-05 | MEDIUM | **Finance can change learning completion.** The per-learner lesson override is gated by `enrolments.manage`, which Finance/Operations holds for enrolment processes. It sees and can use all override buttons, which feed completion and certificate eligibility. Suggest a dedicated `progress.override` (or `attendance.manage`/`submissions.*`) permission. | `lesson-progress-service.ts:701-710`; seed `Finance/Operations` permissions `seed.ts:74-79`. UAT: 10 override buttons for Femi. |
| A-06 | LOW | **Email Log resend goes to the stored address.** A resend requeues the original row, so a learner who has since changed their email receives it at the old inbox. | `email-dispatch-service.ts` `requeueForResend` (no re-resolution of `toEmail`) |

Phase 13 security review, no findings:
- Notification APIs derive identity from the session, send `Cache-Control: private, no-store`, clamp `limit` to 50, validate cursors, and scope every query by `recipientId` (`notification-service.ts:33-213`).
- Opening a notification re-checks the destination's own access rule and returns one uniform "unavailable" result (`notifications/actions.ts`, `notification-access-service.ts`).
- The drain claims one event at a time with `FOR UPDATE SKIP LOCKED`, deduplicates on `@@unique([template, correlationId])` with `skipDuplicates`, and poisons an event after `MAX_EVENT_ATTEMPTS` with an audit record (`domain-event-drain-service.ts:170-363`). Multi-recipient mappers include the recipient in the correlation id.
- Staff alert recipients come from one parameterised query mirroring the permission scope rules (active staff, live unrevoked assignment, active role, GLOBAL or covering scope) (`staff-recipient-service.ts:44-88`).
- Resend refuses AUTH templates and rows without stored params, requires an ACTIVE recipient, uses compare-and-set on status, and audits `email.resent` with a reason; the log needs `audit.view` (GLOBAL), resend needs `users.manage`.
- Templates escape every interpolation including quotes, sanitise subject headers, and only build links on the configured public origin (`layout.ts:40-48`, `config.ts:26, 85-97`, `auth-templates.ts` origin assertion).
- Scheduled Netlify functions take no input and follow the existing pattern.

## 3. Correctness

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| A-01 | HIGH | See section 1. | |
| A-07 | MEDIUM | **A published quiz can be edited into an unpassable state.** `publishAssessment` refuses blocking readiness failures, but "Save changes" validates `passMark` only as `0..1,000,000`, never against `totalMarks`, and attempts snapshot the live pass mark at start. | `assessments/actions.ts:115`; `assessment-service.ts:403-419` (gate only on publish); `attempt-service.ts:28-34` |
| A-08 | MEDIUM | **Flagged certificate cannot be cleared.** The page says "Confirm it should remain active, or revoke it" but offers only Revoke. | `/staff/certificates/issued/[id]` (UAT) |
| A-09 | MEDIUM | **Manual payment and refund amounts are typed in minor units.** Manual confirmation expects base + platform fee (₦126,875) while the same page shows "Total charged ₦128,875"; the rejection names the internal order id and minor units. The $4.86 USD price on FCM-2026-02 (`priceUsdMinor=486`) is the same class of slip; nothing sanity-checks USD against NGN. | payments detail dialogs (UAT); `Cohort.priceUsdMinor` |
| A-10 | LOW | **Past sessions still offer "Join session"** with the meeting link. | `/learn/[enrolmentId]/sessions` (UAT) |

## 4. Integration and requirements

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| A-11 | MEDIUM | **COM-01 "session change" is only half covered.** Sessions can be created and cancelled but never edited, so `session.updated` has no writer. Its template, mapper, SESSION_CHANGES preference and UAT test #40 (synthetic events) are unreachable in production. | `scheduled-session-service.ts` writes only `session.created`/`session.cancelled` (`:435, :495, :547`); the only other `scheduledSession.update` is cohort cancellation (`cohort-service.ts:873`) |
| A-12 | MEDIUM | **Overview and Reconciliation disagree on exceptions.** Overview counts "1 order in an exception state" and links to the unfiltered Payments list; Reconciliation shows "No unresolved exceptions". | `/staff`, `/staff/reconciliation` (UAT) |
| A-15 | MEDIUM | **A reopened ticket alerts nobody on staff.** Reopening returns the ticket to ASSIGNED (its previous owner) but `ticket.reopened` maps only to the learner's email and notification, so the assignee isn't told it came back. | `event-mappers/support.ts` (learner-only `ticket.reopened`); `event-mappers/staff.ts` has no `ticket.reopened` entry. UAT round 2: learner3 reopened KQT-20260930-0C65596A. |
| A-13 | LOW | **4 stale mapper tests fail** (`event-intent-mappers`, `event-mappers-support`): plan 13-08 added a `payment.failed` mapper and 13-11 a second `ticket.created` mapper, but the older tests still expect the earlier counts. Already logged with a fix in `13-*/deferred-items.md`; fail on `Transactional-Communications` alone. | |

Event coverage (COM-01): every mapped domain event has a writer except `session.updated` (A-11). Unmapped events (`enrolment.created`, `hold_expired`, `attendance.changed`, `cohort.published`, `session.created`, `order.created`, `order.paid`, `payment.reconciled`, `lesson/course/programme.completed`) are internal and send no email by design; the enrolment confirmation rides on `enrolment.activated` / `enrolment.approved`.

## 5. UI and UX

Phase 13 screens: the notification bell, drawer and email preferences are accessible (`role="dialog"` + `aria-modal` + labelled heading, `role="switch"` + `aria-checked`, labelled icon buttons). The staff Email Log regresses the 2026-09-29 "words, not codes" round:

- **U-01 (MEDIUM)** Email Log shows raw codes: template ids, status pills from `row.status`, rows labelled `${template} to ${email}`, and the stored error/skip-reason string as "Last error" (`EmailLogTable.tsx:109, 125, 147-153, 229`).

Carried from the same-day UAT (all confirmed in the browser):
- **U-02 (MEDIUM)** Disabled buttons with no reason: checkout Pay until both consents are ticked; manual confirmation until Date is set (Date not marked required); refund over the limit.
- **U-03 (MEDIUM)** Cohort "Add instructor (user id)" takes a raw user id.
- **U-04 (MEDIUM)** Instructor sees "Lesson override" and its explanation with no buttons; say the role can't override.
- **U-05 (LOW)** Developer text still in the product: readiness rows "Not yet checked — a later phase", "(CAT-08)", "(D-14)"; assessment editor heading shows the raw id; permission picker shows raw codes (`tickets.view`) with no descriptions.
- **U-06 (LOW)** Readiness numbers quiz questions from 2 (off by one against the editor).
- **U-07 (LOW)** Raw status codes in staff course/assessment lists (`PUBLISHED`); refund reference is a database id; "Accepted file types" shows `application/pdf`.
- **U-08 (LOW)** Quiz page: title rendered twice, "Pass mark 70" with no unit, the submit dialog's "uses one of your 2 remaining" after start already counted it, attempt history out of order (2, 1, 3), and per-question Correct/Not correct shown while "answers are shown once attempts are used" (reveals True/False answers).
- **U-09 (LOW)** Checkout payment error renders below the fold after the redirect; "provider didn't accept, try again" is shown when the rail is simply unconfigured.
- **U-10 (LOW)** Learner dashboard doesn't mention an open order with a held seat; there is no orders list.
- **U-11 (LOW)** Unverified sign-in says "Those details do not match an account." (safe, but misleading, with no resend hint).
- **U-12 (LOW)** Three date formats across learner pages; learner support times in UTC while staff pages use Africa/Lagos; "Admin workspace" label for every staff role.
- **U-13 (LOW)** Users list links to `/staff/users/[id]`, which 404s for Programme Manager.
- **U-14 (LOW)** Notification times are the drain time, not the event time ("New ticket … 5m ago" for a ticket created about 6 hours earlier); after a backlog drain every item looks new.
- **U-15 (LOW)** Saving email preferences shows no confirmation (the save does persist).
- **U-16 (LOW)** The cancel-session dialog puts "Cancel session" and "Cancel" side by side.

Phase 13 behaviour confirmed live in UAT round 2 (stub transport, drain run by hand): events became the right emails and notifications (ticket created/reply/resolved/reopened, enrolment confirmed, refund, session cancelled, certificate revoked, grade released/overridden); staff "new ticket" alerts reached only `tickets.manage` holders; a muted category skipped the email but kept the notification; opening a notification routed correctly and marked it read; Email log resend was reason-gated, audited and delivered; AUTH rows had no Resend; the Support Agent was denied the Email log; refund and session emails carried no staff reasons; session cancellation reached only ACTIVE learners; no dispatch failed and no event was poisoned.

## 6. Verification coverage

| Phase | Status |
|---|---|
| 02–12 | passed (08 closed 2026-09-30: export lifecycle and 200% zoom UAT) |
| 13 | **No `13-VERIFICATION.md` yet.** Phase UAT 68/69 (Apple Mail rendering blocked on hardware); this audit's UAT round 2 exercised it live (see section 5). REQUIREMENTS marks COM-01..04 Complete; A-11 qualifies COM-01, and A-14 must be resolved before deploy. |

Automated health at `ca2c518`:
- tsc clean; eslint 0 errors.
- vitest (full, Docker up): 4,758 tests, 4,734 passed, 3 skipped, 21 failed before the merge fixes. After them, the only failures are the 4 stale mapper tests (A-13).
- `certificate-revocation.test.ts` takes about 60 s (each certificate action about 2 s) before and after the merge, so some tests exceed the 5 s default; environmental, worth a look.

## 7. Suggested order

0. **A-14 before any deploy of phase 13**: mark pre-deploy events processed (or add a max-age skip) and size the Neon backlog.
1. A-04 (two-line crash fix) and A-13 (test expectations, fix already written up).
2. A-02 and A-05 (permission changes), with a regression test per role.
3. Decide A-01's rule (auto-complete on pass/submit, or allow Mark complete only after passing), then implement.
4. A-03: check Neon; if affected, a one-off data fix for the seeded quiz and assignment, and make the seed repair existing assessments.
5. A-07, A-08, A-09, A-11 (decide: build session editing or re-scope COM-01's "session change" to cancellation), A-15.
6. Write `13-VERIFICATION.md`; then the UI list.
