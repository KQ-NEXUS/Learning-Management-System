# UAT round 2 — merged build (ca2c518, image 8e05a7dfbef4), 2026-09-30

Setup: app restarted with EMAIL_TRANSPORT=stub and SUPPORT_CONTACT_EMAIL=support@kqnexus.test as shell env (no .env change). No scheduler locally, so the real drain task is run by hand (scratchpad/run-drain.mts, refuses to run unless stub).
Note: the first rebuild attempt earlier failed at `npm ci` ("Exit handler never called"); my wrapper hid it and I reported success. Retried; built.

## Drain of the pre-existing backlog (36 events)
- PASS  Backlog from today's round-1 actions became the right emails + notifications: ticket-created/reply/resolved (learner3), enrolment-confirmed (manual payment, learner3), certificate-revoked (learner4), grade-overridden (learner4), grade-released (learner2), staff.ticket_new to admin + support agent only (tickets.manage holders), cohort cancellation superseding per-enrolment withdrawal mails (skipped superseded_by_cohort_cancellation).
- PASS  0 poisoned, 0 failed; second run drained the remaining 11.
- ISSUE (HIGH, DEPLOY) No age limit on drained events and no backlog guard in migration 20260927015627: events from 2026-09-04 (26 days old: cohort.cancelled, enrolment.withdrawn/cancelled) were emailed today. Phases 5–12 have been writing DomainEvents with no consumer; the first production drain after phase 13 deploys will email every learner about every historic event at once. Needs: mark pre-deploy events processed in a migration (or a max-age skip) before deploy. Check the Neon DomainEvent backlog.
- NOTE  The round-1 NGN 10,000 refund produced no refund email: recorded on the old image before refunds wrote payment.refunded. Retest on new build.
- NOTE  3 grade-released emails to learner2 for one quiz (one per attempt).

## Learner (learner3) — phase 13 features
- PASS  Bell: "Notifications, 5 unread" matches the 5 rows in the DB.
- PASS  Drawer: Today group, newest first, Mark all read, Email preferences, Close; items read in plain words ("Your enrolment is confirmed", "Support ticket … has a reply").
- NOTE  Stale "Cohort cancelled: Safety Leadership Programme — January 2026" item (from the 4 Sep backlog) shows what real learners would get after a production backlog drain.
- PASS  Opening "has a reply" -> /support/KQT-…, marked read, badge 5 -> 4.
- PASS  Email preferences: 4 switches + "Always emailed" list; save persisted (GET /api/notifications/preferences -> ["TICKET_UPDATES"]).
- NOTE  No visible "Saved" confirmation after Save preferences.
- NOTE  Panel offers "Session change notices" although no session-change email can ever be sent (audit A-11).
- PASS  Reopen ticket (reason required, min 3 chars) -> ticket.reopened; drain -> ticket-reopened email SKIPPED muted_by_recipient, notification still created.
- ISSUE (MEDIUM) Reopened ticket returns to ASSIGNED (Sade) but only the learner is notified; the assigned staff member gets no alert that it came back.

## Administrator (Ada) — phase 13 staff side
- PASS  Bell "1 unread" (staff.ticket_new); opening it -> /staff/support/KQT-…; staff drawer has no email-preferences control (learner-only, by design).
- NOTE  Notification times are drain time, not event time: "New ticket … 5m ago" for a ticket created ~6 h earlier (worse for a backlog drain).
- PASS  Email log: 21 rows, status/template filters, attempts "1 of 5", stub sends labelled "SENT stub".
- ISSUE (MEDIUM, = audit U-01) Email log shows raw codes: template filter lists raw ids, statuses SKIPPED/SENT, "Last error" shows muted_by_recipient.
- PASS  Resend grade-released: "Audited action" dialog with recipient + reason (min 10) -> "Resend queued for …"; DB resentCount 1, AuditEvent email.resent with reason; next drain sent it.
- PASS  AUTH rows (email-verification, password-reset) and SKIPPED rows show no Resend.
- PASS  New build: NGN 5,000 refund -> limit correctly 116,875 (126,875 − 10,000); drain -> payment-refunded email with amount/order/path, staff reason not in params.
- PASS  Cancel FCM "Live session 3" (reason required) -> session-cancelled email only to the ACTIVE learner (learner3), not PENDING_PAYMENT learner7; reason not in params.
- NOTE  Cancel-session dialog buttons "Cancel session" and "Cancel" side by side.

## Support Agent (Sade)
- PASS  Bell "1 unread" (staff.ticket_new for tickets.manage holders).
- PASS  /staff/email-log -> 403 "You do not have access to delivery log entries" in words; no addresses in the page.

## Round-1 findings
- Unchanged by the merge (files identical ed314d4 -> ca2c518), so still open: users/new + roles/new crash, payments report permission, quiz lesson completion, pass-mark save check, Finance override. Not re-clicked.

## Not tested this round
- Email verification link (auth mail stores no params by design; can't recover the token locally).
- Staff submission / order-exception / reconciliation alerts (no qualifying event reachable: assignment upload blocked by the stale seed file types; no provider keys).
- Real email rendering in mail clients (stub transport).
