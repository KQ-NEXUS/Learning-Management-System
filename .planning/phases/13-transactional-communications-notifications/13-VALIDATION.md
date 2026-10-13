---
phase: "13"
slug: "transactional-communications-notifications"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-27"
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from 13-RESEARCH.md "Validation Architecture"; the Per-Task map below matches the final plan and task ids (13 plans, 9 waves).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.11, projects `node` (`tests/**/*.test.ts`) and `components` (`tests/components/**/*.test.tsx`, jsdom) |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run --no-file-parallelism tests/<file>.test.ts` |
| **Full suite command** | `npm test` (`vitest run --no-file-parallelism`) |
| **Estimated runtime** | ~120 seconds (full suite; integration tests need Docker PostgreSQL) |

---

## Sampling Rate

- **After every task commit:** Run the single relevant test file (the task's `<automated>` command)
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite green plus `npm run lint`, `npx tsc --noEmit`, `npx prisma validate` and `tests/boundary.test.ts`
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Integration commands need Docker (`tests/support/pg.ts` starts `postgres:16-alpine`) and use `--no-file-parallelism`. Test files are created inside their own task (TDD), so no separate Wave 0 plan exists.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | COM-01..04 | T-13-15, T-13-17 | Additive migration; DB CHECKs reject unknown status and negative attempts | schema | `npx prisma format && npx prisma validate && npx prisma migrate status && npx prisma generate` | n/a | ⬜ pending |
| 13-01-02 | 01 | 1 | COM-01..04 | T-13-15 | [BLOCKING] live DB and client match schema | schema | `npx prisma db push && npx prisma migrate status && npx prisma generate && npx tsc --noEmit` | n/a | ⬜ pending |
| 13-01-03 | 01 | 1 | COM-01..04 | T-13-15, T-13-21 | Closed event union; one persisted vocabulary; catalogue unchanged | unit | `npx vitest run tests/communications-contracts.test.ts tests/domain-event-service.test.ts tests/learning-phase-invariants.test.ts` | ❌ new | ⬜ pending |
| 13-02-01 | 02 | 2 | COM-04 | T-13-05, T-13-09, T-13-10 | Fail-loud sender/Reply-To/base URL; html+text payload; stub mode | unit | `npx vitest run tests/email-config.test.ts tests/brevo-client.test.ts tests/email-templates.test.ts` | ❌ new / ✅ extend | ⬜ pending |
| 13-02-02 | 02 | 2 | COM-01 | T-13-03, T-13-06 | 20 learner templates: escaped, allow-listed, no reasons/bodies | unit | `npx vitest run tests/email-templates.test.ts` | ❌ new | ⬜ pending |
| 13-02-03 | 02 | 2 | COM-01, COM-04 | T-13-09, T-13-10 | 27-template exhaustive registry; compose no longer injects a sender | unit | `npx vitest run tests/email-templates.test.ts tests/docker-email-config.test.ts` | ✅ extend | ⬜ pending |
| 13-03-01 | 03 | 2 | COM-03 | T-13-01, T-13-22 | Owner-scoped unread count; 401 no data; no-store | integration | `npx vitest run tests/notification-service.test.ts tests/notification-unread-route.test.ts tests/notification-service.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-03-02 | 03 | 2 | COM-03 | T-13-01, T-13-58, T-13-22 | Cursor list, mark read/all read only own rows, safe text | integration | `npx vitest run tests/notification-service.test.ts tests/notification-text.test.ts tests/notification-service.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-03-03 | 03 | 2 | COM-03 | T-13-20 | Only four mutable categories persistable; upsert never delete | unit | `npx vitest run tests/email-preference-service.test.ts tests/notification-service.test.ts` | ❌ new | ⬜ pending |
| 13-04-01 | 04 | 3 | COM-01, COM-02 | T-13-59, T-13-07, T-13-23 | Stable hash key; token never persisted; frozen auth results | integration | `npx vitest run tests/email-dispatch-service.test.ts tests/auth-email-service.test.ts tests/registration-service.test.ts tests/email-dispatch.integration.test.ts --no-file-parallelism` | ✅ extend / ❌ new | ⬜ pending |
| 13-04-02 | 04 | 3 | COM-02 | T-13-07, T-13-08, T-13-11 | SKIP LOCKED claim, backoff 1m/5m/30m/2h, 5 attempts, audited resend | integration | `npx vitest run tests/email-dispatch-service.test.ts tests/email-dispatch.integration.test.ts --no-file-parallelism` | ✅ extend | ⬜ pending |
| 13-04-03 | 04 | 3 | COM-01, COM-02 | T-13-59, T-13-23 | Verification, reset and email-change mails on the shared path | unit | `npx vitest run tests/verification-service.test.ts tests/password-reset-service.test.ts tests/profile-service.test.ts tests/registration-service.test.ts tests/auth-email-service.test.ts` | ✅ update | ⬜ pending |
| 13-05-01 | 05 | 3 | COM-03 | T-13-61, T-13-02, T-13-62 | Ownership check, identical unavailable outcome, validated relative href | integration | `npx vitest run tests/communication-links.test.ts tests/notification-access-service.test.ts tests/notification-access.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-05-02 | 05 | 3 | COM-03 | T-13-02, T-13-26 | Ten target resolvers mirror destination authorization | integration | `npx vitest run tests/notification-access-service.test.ts tests/notification-access.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-05-03 | 05 | 3 | COM-03 | T-13-27 | 90-day archive by archivedAt only; unread never archived; worker-safe closure | integration | `npx vitest run tests/cleanup-notifications-task.test.ts tests/netlify-cleanup-notifications.test.ts tests/notification-service.integration.test.ts tests/boundary.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-06-01 | 06 | 4 | COM-03 | T-13-29, T-13-31 | Server-rendered count, 60s visible-tab poll, badge 0/1-99/99+ | component | `npx vitest run tests/components/notification-bell.test.tsx tests/components/staff-shell.test.tsx tests/staff-layout-nav.test.ts tests/learning-phase-invariants.test.ts` | ❌ new / ✅ extend | ⬜ pending |
| 13-06-02 | 06 | 4 | COM-03 | T-13-65, T-13-64, T-13-30 | Drawer states, focus trap, no mark-read on open, stale item safe, axe | component | `npx vitest run tests/components/notification-drawer.test.tsx tests/components/notification-bell.test.tsx` | ❌ new | ⬜ pending |
| 13-06-03 | 06 | 4 | COM-03 | T-13-20 | Learner-only preferences panel; locked always-emailed list | component | `npx vitest run tests/components/email-preferences-panel.test.tsx tests/components/notification-drawer.test.tsx` | ❌ new | ⬜ pending |
| 13-07-01 | 07 | 4 | COM-01, COM-02 | T-13-67, T-13-12 | Per-event tx, SKIP LOCKED, skipDuplicates; replay and overlap safe | integration | `npx vitest run tests/domain-event-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-07-02 | 07 | 4 | COM-01, COM-02 | T-13-12, T-13-32, T-13-35 | Poison events after 3 attempts + audit; deactivated/unverified/muted handling | integration | `npx vitest run tests/domain-event-drain-service.test.ts tests/domain-event-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-07-03 | 07 | 4 | COM-01 | T-13-34 | Every-minute Netlify task; exhaustive mapper table; worker-safe closure | unit | `npx vitest run tests/drain-domain-events-task.test.ts tests/netlify-drain-domain-events.test.ts tests/event-intent-mappers.test.ts tests/boundary.test.ts` | ❌ new / ✅ extend | ⬜ pending |
| 13-08-01 | 08 | 5 | COM-01, COM-02 | T-13-70, T-13-69 | One combined enrolment mail; illegal-transition learner notice | integration | `npx vitest run tests/event-mappers-enrolment-payment.test.ts tests/enrolment-payment-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-08-02 | 08 | 5 | COM-01, COM-02 | T-13-69 | Direct checkout sends removed; correlationId required | integration | `npx vitest run tests/checkout-webhook-system-service.test.ts tests/checkout-service.test.ts tests/email-dispatch-service.test.ts tests/checkout-webhook.integration.test.ts tests/boundary.test.ts --no-file-parallelism` | ✅ update | ⬜ pending |
| 13-08-03 | 08 | 5 | COM-01, COM-02 | T-13-70, T-13-36, T-13-37 | payment.failed and atomic payment.refunded; no refund reason in mail | integration | `npx vitest run tests/refund-service.test.ts tests/refund.integration.test.ts tests/event-mappers-enrolment-payment.test.ts tests/checkout-webhook-system-service.test.ts tests/staff-payments-actions.test.ts --no-file-parallelism` | ✅ update | ⬜ pending |
| 13-12-01 | 12 | 5 | COM-01, COM-02 | T-13-77, T-13-78, T-13-79 | audit.view list, users.manage audited resend reusing the row | integration | `npx vitest run tests/email-delivery-log-service.test.ts tests/email-delivery-log.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-12-02 | 12 | 5 | COM-01 | T-13-52 | Log page states, filters, Resend visibility, sidebar entry | component | `npx vitest run tests/components/email-log-table.test.tsx tests/staff-email-log-actions.test.ts tests/staff-layout-nav.test.ts tests/email-delivery-log-service.test.ts` | ❌ new / ✅ extend | ⬜ pending |
| 13-09-01 | 09 | 6 | COM-01, COM-02 | T-13-72 | Withdrawn and cancelled mails without reason | integration | `npx vitest run tests/event-mappers-enrolment-session.test.ts tests/enrolment-session-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-09-02 | 09 | 6 | COM-01, COM-02 | T-13-38, T-13-40 | Transfer, session cancel, coalesced session updates, ACTIVE-only recipients | integration | `npx vitest run tests/event-mappers-enrolment-session.test.ts tests/enrolment-session-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-09-03 | 09 | 6 | COM-01, COM-02 | T-13-39 | One cohort-cancelled mail per affected learner; per-enrolment mails superseded | integration | `npx vitest run tests/event-mappers-enrolment-session.test.ts tests/enrolment-session-drain.integration.test.ts tests/cohort-cancel.integration.test.ts --no-file-parallelism` | ❌ new / ✅ existing | ⬜ pending |
| 13-10-01 | 10 | 7 | COM-01, COM-02 | T-13-73 | Results mail without score; RESULT_NOTICES mute | integration | `npx vitest run tests/event-mappers-learning.test.ts tests/learning-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-10-02 | 10 | 7 | COM-01, COM-02 | T-13-73, T-13-42 | Certificate mails: reference only, holder from row, always sent | integration | `npx vitest run tests/event-mappers-learning.test.ts tests/learning-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-10-03 | 10 | 7 | COM-01, COM-02 | T-13-73, T-13-42 | Learner ticket mails carry reference only; TICKET_UPDATES mute | integration | `npx vitest run tests/event-mappers-support.test.ts tests/support-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-11-01 | 11 | 8 | COM-01, COM-03 | T-13-13, T-13-46 | SQL staff resolver equals hasPermission across the grant matrix | integration | `npx vitest run tests/staff-recipient-service.test.ts tests/staff-drain.integration.test.ts tests/boundary.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-11-02 | 11 | 8 | COM-01, COM-03 | T-13-75, T-13-13 | Assignee, escalation, payment and submission alerts scoped and label-only | integration | `npx vitest run tests/event-mappers-staff.test.ts tests/staff-drain.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-11-03 | 11 | 8 | COM-03 | T-13-76, T-13-45 | Failed-email admin alert, no email about a failed email | integration | `npx vitest run tests/email-failure-alert-service.test.ts tests/domain-event-drain.integration.test.ts tests/boundary.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |
| 13-13-01 | 13 | 9 | COM-01, COM-04 | T-13-80, T-13-53, T-13-54 | Opt-in live Brevo send and live rejection degrade safely (skipped without BREVO_LIVE) | live (manual-gated) | `npx vitest run tests/brevo-live.smoke.test.ts` | ❌ new | ⬜ pending |
| 13-13-02 | 13 | 9 | COM-01..04 | T-13-55 | Catalogue 36, append-only stores, single sender config, safe UI, closures | unit | `npx vitest run tests/communications-invariants.test.ts tests/boundary.test.ts` | ❌ new / ✅ extend | ⬜ pending |
| 13-13-03 | 13 | 9 | COM-01..04 | T-13-07, T-13-01, T-13-02 | ROADMAP success criteria 1-3 end to end on real Postgres | integration | `npx vitest run tests/communications-e2e.integration.test.ts --no-file-parallelism` | ❌ new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement → test seed (from research)

| Req | Behavior | Command | File Exists |
|-----|----------|---------|-------------|
| COM-01 | Exhaustive event→intent mapper over `DomainEventType` | `npx vitest run tests/event-intent-mappers.test.ts` | ❌ 13-07-03 |
| COM-01 | Every template renders HTML+text; no secrets/reasons; correct link and sender | `npx vitest run tests/email-templates.test.ts` | ❌ 13-02 |
| COM-01 | Combined enrolled mail once; direct checkout mail removed | `npx vitest run tests/checkout-webhook-system-service.test.ts tests/enrolment-payment-drain.integration.test.ts` | ✅ update / ❌ 13-08 |
| COM-02 | Replay/re-drain yields one EmailDispatch + one Notification per recipient | `npx vitest run tests/domain-event-drain.integration.test.ts` | ❌ 13-07-01 |
| COM-02 | Overlapping drains (SKIP LOCKED) never double-process | same file | ❌ 13-07-01 |
| COM-02 | Retry reuses row; backoff; permanent → FAILED; 5 attempts → FAILED | `npx vitest run tests/email-dispatch-service.test.ts tests/email-dispatch.integration.test.ts` | ✅ extend / ❌ 13-04-02 |
| COM-02 | Poison event: 3 failures → processed-with-error + audit | `npx vitest run tests/domain-event-drain-service.test.ts` | ❌ 13-07-02 |
| COM-02 | Verification/reset stable correlation; raw token never persisted | `npx vitest run tests/verification-service.test.ts tests/password-reset-service.test.ts tests/auth-email-service.test.ts` | ✅ update / ❌ 13-04 |
| COM-03 | Notification list/unread/paging/mark-read/ownership | `npx vitest run tests/notification-service.test.ts` | ❌ 13-03 |
| COM-03 | Stale/inaccessible link → identical "No longer available" | `npx vitest run tests/notification-access-service.test.ts` | ❌ 13-05 |
| COM-03 | Bell/drawer states, focus trap, a11y | `npx vitest run tests/components/notification-drawer.test.tsx` | ❌ 13-06 |
| COM-04 | Single sender module throws when unset; Reply-To from support contact | `npx vitest run tests/email-config.test.ts tests/brevo-client.test.ts` | ❌ new / ✅ extend 13-02 |
| Wiring | Netlify function pattern + import closure clear of request APIs | `npx vitest run tests/netlify-drain-domain-events.test.ts tests/boundary.test.ts` | ❌ 13-07-03 / ✅ existing |
| D-16 | Muted category suppresses email, keeps notification | `npx vitest run tests/domain-event-drain-service.test.ts tests/domain-event-drain.integration.test.ts` | ❌ 13-07-02 |
| D-23 | Cleanup archives read >90d, never deletes | `npx vitest run tests/cleanup-notifications-task.test.ts tests/notification-service.integration.test.ts` | ❌ 13-05-03 |
| D-24 | Opt-in live Brevo smoke | `npx vitest run tests/brevo-live.smoke.test.ts` (env-guarded `it.skipIf(!process.env.BREVO_LIVE)`) | ❌ 13-13-01 |

---

## Wave 0 Requirements

Each test file below is created by the task named in the Per-Task map (TDD), so there is no separate Wave 0 plan; the executor writes the test first inside the task.

- [ ] `tests/communications-contracts.test.ts` (13-01-03), `tests/email-config.test.ts` and `tests/email-templates.test.ts` (13-02)
- [ ] `tests/notification-service.test.ts`, `tests/notification-service.integration.test.ts`, `tests/notification-unread-route.test.ts`, `tests/notification-text.test.ts`, `tests/email-preference-service.test.ts` (13-03)
- [ ] `tests/email-dispatch.integration.test.ts`, `tests/auth-email-service.test.ts` (13-04)
- [ ] `tests/communication-links.test.ts`, `tests/notification-access-service.test.ts`, `tests/notification-access.integration.test.ts`, `tests/cleanup-notifications-task.test.ts`, `tests/netlify-cleanup-notifications.test.ts` (13-05)
- [ ] `tests/components/notification-bell.test.tsx`, `tests/components/notification-drawer.test.tsx`, `tests/components/email-preferences-panel.test.tsx` (13-06)
- [ ] `tests/support/drain-harness.ts` (shared drain fixture: startDrainHarness, seedVerifiedLearner, seedStaffUser, writeEvent), `tests/domain-event-drain.integration.test.ts`, `tests/domain-event-drain-service.test.ts`, `tests/event-intent-mappers.test.ts`, `tests/drain-domain-events-task.test.ts`, `tests/netlify-drain-domain-events.test.ts` (13-07)
- [ ] `tests/event-mappers-enrolment-payment.test.ts`, `tests/enrolment-payment-drain.integration.test.ts` (13-08)
- [ ] `tests/event-mappers-enrolment-session.test.ts`, `tests/enrolment-session-drain.integration.test.ts` (13-09)
- [ ] `tests/event-mappers-learning.test.ts`, `tests/event-mappers-support.test.ts`, `tests/learning-drain.integration.test.ts`, `tests/support-drain.integration.test.ts` (13-10)
- [ ] `tests/staff-recipient-service.test.ts`, `tests/event-mappers-staff.test.ts`, `tests/staff-drain.integration.test.ts`, `tests/email-failure-alert-service.test.ts` (13-11)
- [ ] `tests/email-delivery-log-service.test.ts`, `tests/email-delivery-log.integration.test.ts`, `tests/staff-email-log-actions.test.ts`, `tests/components/email-log-table.test.tsx` (13-12)
- [ ] `tests/brevo-live.smoke.test.ts`, `tests/communications-invariants.test.ts`, `tests/communications-e2e.integration.test.ts` (13-13)
- [ ] Existing tests updated in place: `tests/brevo-client.test.ts`, `tests/docker-email-config.test.ts`, `tests/domain-event-service.test.ts`, `tests/email-dispatch-service.test.ts`, `tests/registration-service.test.ts`, `tests/verification-service.test.ts`, `tests/password-reset-service.test.ts`, `tests/profile-service.test.ts`, `tests/checkout-webhook-system-service.test.ts`, `tests/checkout-webhook.integration.test.ts`, `tests/checkout-service.test.ts`, `tests/refund-service.test.ts`, `tests/refund.integration.test.ts`, `tests/components/staff-shell.test.tsx`, `tests/staff-layout-nav.test.ts`, `tests/boundary.test.ts`

*No framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Brevo delivery + outage behaviour (closes Phase 3's declined live check) | COM-01, COM-04 | Needs real credentials and network | Set `BREVO_LIVE=1`, `BREVO_LIVE_TO`, `BREVO_API_KEY`, `EMAIL_SENDER_NAME`, `EMAIL_SENDER_ADDRESS`, `SUPPORT_CONTACT_EMAIL`, `APP_BASE_URL`, then run `npx vitest run tests/brevo-live.smoke.test.ts`; confirm receipt, sender identity and Reply-To in the mailbox |
| Drawer long-text clamping, focus feel and reduced-motion in a real browser | COM-03 | jsdom cannot measure layout or motion (UI-SPEC backstops) | Open the bell drawer in learner and staff shells with a 200-character title; check 2-line and 1-line clamps, Tab wrap, Escape returns focus to the bell, and `prefers-reduced-motion` removes the slide |
| Email rendering in real clients (Gmail, Outlook, Apple Mail; light and dark) | COM-01 | Client rendering cannot be asserted in tests | Send the live smoke mail and one template of each group; check layout, button tappability and footer |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
