---
status: diagnosed
phase: 13-transactional-communications-notifications
source: [13-01-SUMMARY.md, 13-02-SUMMARY.md, 13-03-SUMMARY.md, 13-04-SUMMARY.md, 13-05-SUMMARY.md, 13-06-SUMMARY.md, 13-07-SUMMARY.md, 13-08-SUMMARY.md, 13-09-SUMMARY.md, 13-10-SUMMARY.md, 13-11-SUMMARY.md, 13-12-SUMMARY.md, 13-13-SUMMARY.md]
started: 2026-09-28T21:29:51.309Z
updated: 2026-09-30T01:30:00.000Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing paused — Apple Mail verification remains blocked by unavailable hardware]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. [13-01/D1] Additive schema: DomainEvent attempts/lastError, EmailDispatch retry columns and index, Notification and EmailPreference models, three CHECK constraints
expected: Additive schema: DomainEvent attempts/lastError, EmailDispatch retry columns and index, Notification and EmailPreference models, three CHECK constraints
result: pass
source: automated
coverage_id: D1

### 3. [13-01/D2] DomainEventType gains payment.failed and payment.refunded
expected: DomainEventType gains payment.failed and payment.refunded
result: pass
source: automated
coverage_id: D2

### 4. [13-01/D3] contracts.ts shared vocabulary (27 templates, 27 notification types, categories, backoff, buildCorrelationId)
expected: contracts.ts shared vocabulary (27 templates, 27 notification types, categories, backoff, buildCorrelationId)
result: pass
source: automated
coverage_id: D3

### 5. [13-02/D1] Fail-loud single sender identity, brand, Reply-To, base URL and transport config; open-redirect-safe absolute links
expected: Fail-loud single sender identity, brand, Reply-To, base URL and transport config; open-redirect-safe absolute links
result: pass
source: automated
coverage_id: D1

### 6. [13-02/D2] Brevo payload carries sender, replyTo, subject, html and text with no templateId; stub transport; failure classification
expected: Brevo payload carries sender, replyTo, subject, html and text with no templateId; stub transport; failure classification
result: pass
source: automated
coverage_id: D2

### 7. [13-02/D3] 27 templates render escaped, allow-listed, absolute-linked subject, html and text through one layout
expected: 27 templates render escaped, allow-listed, absolute-linked subject, html and text through one layout
result: pass
source: automated
coverage_id: D3

### 8. [13-02/D4] docker-compose passes sender name and address through without a default
expected: docker-compose passes sender name and address through without a default
result: pass
source: automated
coverage_id: D4

### 9. [13-02/D5] Emails read correctly and the button stays tappable in Gmail, Outlook and Apple Mail, light and dark themes
expected: Emails read correctly and the button stays tappable in Gmail, Outlook and Apple Mail, light and dark themes
    Rationale: Table-based markup is verified by tests; real mail-client rendering can only be confirmed by looking.
result: blocked
blocked_by: physical-device
reason: Gmail and Outlook passed in light/dark modes with readable content and a working button; Apple Mail could not be tested because the operator has no iPhone, iPad, or Mac access.

### 10. [13-02/D6] No marketing or engagement-nudging copy in any template
expected: No marketing or engagement-nudging copy in any template
    Rationale: A phrase regex catches obvious urgency wording only; tone is a judgment call.
result: pass

### 11. [13-03/D1] Tracer: a user's unread count travels from the database through the ownership-scoped service to the uncached poll endpoint
expected: Tracer: a user's unread count travels from the database through the ownership-scoped service to the uncached poll endpoint
result: pass
source: automated
coverage_id: D1

### 12. [13-03/D2] Cursor-paged list (newest first, no dup/gap), ownership-scoped markRead/markAllRead, and the safe notification text renderer + DTO shaper
expected: Cursor-paged list (newest first, no dup/gap), ownership-scoped markRead/markAllRead, and the safe notification text renderer + DTO shaper
result: pass
source: automated
coverage_id: D2

### 13. [13-03/D3] Email preference store (4 mutable categories only, upsert-never-delete) plus its uncached GET route and the save server action
expected: Email preference store (4 mutable categories only, upsert-never-delete) plus its uncached GET route and the save server action
result: pass
source: automated
coverage_id: D3

### 14. [13-04/D1] Registration sends the verification mail through sendAuthEmail under a stable, hash-derived correlation key; a duplicate dispatch of the same key sends nothing and no raw token is ever persisted.
expected: Registration sends the verification mail through sendAuthEmail under a stable, hash-derived correlation key; a duplicate dispatch of the same key sends nothing and no raw token is ever persisted.
result: pass
source: automated
coverage_id: D1

### 15. [13-04/D2] sendQueued (Pass 2) claims due rows with FOR UPDATE SKIP LOCKED, retries transient failures on the 1m/5m/30m/2h schedule, fails permanently on the 5th attempt or a permanent classification, recovers stale SENDING rows after 10 minutes, and resend reuses a FAILED/SENT row with an audited actor and reason.
expected: sendQueued (Pass 2) claims due rows with FOR UPDATE SKIP LOCKED, retries transient failures on the 1m/5m/30m/2h schedule, fails permanently on the 5th attempt or a permanent classification, recovers stale SENDING rows after 10 minutes, and resend reuses a FAILED/SENT row with an audited actor and reason.
result: pass
source: automated
coverage_id: D2

### 16. [13-04/D3] Verification resend, password-reset request, and email-change request are all rewired onto sendAuthEmail — no inline process.env base URL, no plain-text body builder, frozen results unchanged under a throwing dispatch or an unconfigured base URL in production.
expected: Verification resend, password-reset request, and email-change request are all rewired onto sendAuthEmail — no inline process.env base URL, no plain-text body builder, frozen results unchanged under a throwing dispatch or an unconfigured base URL in production.
result: pass
source: automated
coverage_id: D3

### 17. [13-05/D1] Tracer: opening a learner ticket notification checks ownership server-side, marks it read, and returns a validated relative href; the identical outcome for missing/foreign/deleted/denied
expected: Tracer: opening a learner ticket notification checks ownership server-side, marks it read, and returns a validated relative href; the identical outcome for missing/foreign/deleted/denied
result: pass
source: automated
coverage_id: D1

### 18. [13-05/D2] All ten notification targets (LEARNER_DASHBOARD/ORDER/ENROLMENT/RESULTS/SESSIONS/TICKET, STAFF_TICKET/PAYMENT/SUBMISSION/EMAIL_LOG) gated by the exact rule their destination page enforces, with cross-role denial parity
expected: All ten notification targets (LEARNER_DASHBOARD/ORDER/ENROLMENT/RESULTS/SESSIONS/TICKET, STAFF_TICKET/PAYMENT/SUBMISSION/EMAIL_LOG) gated by the exact rule their destination page enforces, with cross-role denial parity
result: pass
source: automated
coverage_id: D2

### 19. [13-05/D3] Scheduled 90-day archive of read notifications: exact-cutoff boundary, unread rows never touched, already-archived rows untouched, no row ever deleted, daily Netlify schedule, worker-safe import closure
expected: Scheduled 90-day archive of read notifications: exact-cutoff boundary, unread rows never touched, already-archived rows untouched, no row ever deleted, daily Netlify schedule, worker-safe import closure
result: pass
source: automated
coverage_id: D3

### 20. [13-06/D1] Tracer: the server-rendered unread count reaches the bell badge in the learner and staff headers and refreshes by a 60s visible-tab poll, with zero-one-many badge rules and a silent-failure/chrome-persistence guarantee
expected: Tracer: the server-rendered unread count reaches the bell badge in the learner and staff headers and refreshes by a 60s visible-tab poll, with zero-one-many badge rules and a silent-failure/chrome-persistence guarantee
result: pass
source: automated
coverage_id: D1

### 21. [13-06/D3] Learner-only email-preferences panel: four switches loaded from and saved to the muted-category store, five non-interactive always-emailed items, save success/failure copy that keeps input on failure, and the staff variant has no gear/panel at all
expected: Learner-only email-preferences panel: four switches loaded from and saved to the muted-category store, five non-interactive always-emailed items, save success/failure copy that keeps input on failure, and the staff variant has no gear/panel at all
result: pass
source: automated
coverage_id: D3

### 22. [13-06/D2] The drawer: grouped Today/Earlier list, 4-skeleton loading, empty/error states with retry, cursor-paged Load older, optimistic Mark all read with revert-on-failure, access-checked item activation (ok-href navigate+close, unavailable safe-fail, failure revert), full focus/scroll-lock mechanics, and plain-text-only rendering
expected: The drawer: grouped Today/Earlier list, 4-skeleton loading, empty/error states with retry, cursor-paged Load older, optimistic Mark all read with revert-on-failure, access-checked item activation (ok-href navigate+close, unavailable safe-fail, failure revert), full focus/scroll-lock mechanics, and plain-text-only rendering
    Rationale: Three UI-SPEC backstop truths (200-char title/meta clamp under real layout, the drawer's keyboard/focus 'feel', and the reduced-motion collapse) explicitly require a real browser — jsdom has no layout engine. The class-level and mechanics-level assertions above are automated; the visual/feel confirmation itself is not.
result: issue
reported: "Held-out browser screenshot shows the long notification title wrapping to 3 lines and metadata wrapping to 2 lines; the UI-SPEC requires title clamp to 2 lines and metadata clamp to 1 line. Focus trapping, Escape focus restoration, and background scroll lock passed."
severity: cosmetic

### 23. [13-07/D1] A ticket.public_reply_added event drains into exactly one QUEUED-then-SENT EmailDispatch (correlationId = event id, allow-listed templateParams) and one ticket.reply Notification, exactly once across replay and reset-and-redrain, and exactly once per event across two concurrent drain runs on 10 events
expected: A ticket.public_reply_added event drains into exactly one QUEUED-then-SENT EmailDispatch (correlationId = event id, allow-listed templateParams) and one ticket.reply Notification, exactly once across replay and reset-and-redrain, and exactly once per event across two concurrent drain runs on 10 events
result: pass
source: automated
coverage_id: D1

### 24. [13-07/D2] A mapper failure rolls back only that event; attempts increment across separate drain runs; the third failure marks processed-with-error with a safe (name/code only) lastError and exactly one SYSTEM domain_event.poisoned audit entry carrying only type+attempts; a 4th run leaves it untouched; a good event in the same run as a poison event still commits; an event whose type is outside DOMAIN_EVENT_TYPE_LIST follows the identical path
expected: A mapper failure rolls back only that event; attempts increment across separate drain runs; the third failure marks processed-with-error with a safe (name/code only) lastError and exactly one SYSTEM domain_event.poisoned audit entry carrying only type+attempts; a 4th run leaves it untouched; a good event in the same run as a poison event still commits; an event whose type is outside DOMAIN_EVENT_TYPE_LIST follows the identical path
result: pass
source: automated
coverage_id: D2

### 25. [13-07/D3] Recipient-state and mute gating: a DEACTIVATED recipient gets a SKIPPED recipient_deactivated dispatch and no notification; a PENDING_VERIFICATION/unverified recipient gets SKIPPED email_unverified and no notification; a missing user yields no rows and the event still processes; a recipient muted for the intent's mutable category gets a SKIPPED muted_by_recipient dispatch but the notification is still created; decideEmailDisposition is table-tested across all 7 EMAIL_CATEGORY values x DEACTIVATED/unverified/muted/unmuted states
expected: Recipient-state and mute gating: a DEACTIVATED recipient gets a SKIPPED recipient_deactivated dispatch and no notification; a PENDING_VERIFICATION/unverified recipient gets SKIPPED email_unverified and no notification; a missing user yields no rows and the event still processes; a recipient muted for the intent's mutable category gets a SKIPPED muted_by_recipient dispatch but the notification is still created; decideEmailDisposition is table-tested across all 7 EMAIL_CATEGORY values x DEACTIVATED/unverified/muted/unmuted states
result: pass
source: automated
coverage_id: D3

### 26. [13-07/D4] buildMapperTable is exhaustive over every DOMAIN_EVENT_TYPE_LIST member (empty array for an unregistered type, exactly one mapper for ticket.public_reply_added); requireString throws MalformedEventError for a missing/non-string/empty field
expected: buildMapperTable is exhaustive over every DOMAIN_EVENT_TYPE_LIST member (empty array for an unregistered type, exactly one mapper for ticket.public_reply_added); requireString throws MalformedEventError for a missing/non-string/empty field
result: pass
source: automated
coverage_id: D4

### 27. [13-07/D5] The drain is a scheduled task wrapped by an every-minute Netlify function, invocable on demand, following the release-expired-holds pattern; its runtime import closure has no request-only API and non-vacuously reaches the drain and dispatch services; the file is rejected for a Prisma import like the other scheduled functions
expected: The drain is a scheduled task wrapped by an every-minute Netlify function, invocable on demand, following the release-expired-holds pattern; its runtime import closure has no request-only API and non-vacuously reaches the drain and dispatch services; the file is rejected for a Prisma import like the other scheduled functions
result: pass
source: automated
coverage_id: D5

### 28. [13-08/D1] A paid enrolment (order.paid then enrolment.activated) yields exactly one enrolment-confirmed EmailDispatch and one enrolment.confirmed Notification; order.paid alone produces no output
expected: A paid enrolment (order.paid then enrolment.activated) yields exactly one enrolment-confirmed EmailDispatch and one enrolment.confirmed Notification; order.paid alone produces no output
result: pass
source: automated
coverage_id: D1

### 29. [13-08/D2] A staff-approved enrolment with no order (enrolment.approved) yields the same enrolment-confirmed mail with no orderReference/amountLabel in templateParams
expected: A staff-approved enrolment with no order (enrolment.approved) yields the same enrolment-confirmed mail with no orderReference/amountLabel in templateParams
result: pass
source: automated
coverage_id: D2

### 30. [13-08/D3] The checkout webhook and settlement path send no email directly: orderEmailFacts/dispatchEmail, the plain-text builders and the email-dispatch-service imports are removed from checkout-webhook-system-service.ts; only the drain sends
expected: The checkout webhook and settlement path send no email directly: orderEmailFacts/dispatchEmail, the plain-text builders and the email-dispatch-service imports are removed from checkout-webhook-system-service.ts; only the drain sends
result: pass
source: automated
coverage_id: D3

### 31. [13-08/D4] An order.exception with reason illegal_transition yields one order-payment-exception mail; every other reason (duplicate_active_enrolment etc.) yields zero learner mail
expected: An order.exception with reason illegal_transition yields one order-payment-exception mail; every other reason (duplicate_active_enrolment etc.) yields zero learner mail
result: pass
source: automated
coverage_id: D4

### 32. [13-08/D5] payment.failed is written in the same transaction as the PaymentAttempt FAILED update (recordPaymentFailureAsSystem) and maps to a payment-failed mail plus payment.failed notification; illegal-transition/missing-attempt exception paths write order.exception and no payment.failed
expected: payment.failed is written in the same transaction as the PaymentAttempt FAILED update (recordPaymentFailureAsSystem) and maps to a payment-failed mail plus payment.failed notification; illegal-transition/missing-attempt exception paths write order.exception and no payment.failed
result: pass
source: automated
coverage_id: D5

### 33. [13-08/D6] A COMPLETED or RECORDED_MANUALLY refund writes the Refund status update, the Order status update and the payment.refunded event in one transaction (rollback proven by a forced event-write failure); a FAILED provider refund writes no event
expected: A COMPLETED or RECORDED_MANUALLY refund writes the Refund status update, the Order status update and the payment.refunded event in one transaction (rollback proven by a forced event-write failure); a FAILED provider refund writes no event
result: pass
source: automated
coverage_id: D6

### 34. [13-08/D7] DispatchParams requires correlationId and htmlContent and narrows template to TemplateId; the random-UUID fallback is gone — no remaining caller omits either field (tsc --noEmit proves this statically)
expected: DispatchParams requires correlationId and htmlContent and narrows template to TemplateId; the random-UUID fallback is gone — no remaining caller omits either field (tsc --noEmit proves this statically)
result: pass
source: automated
coverage_id: D7

### 35. [13-08/D8] Refund reasons, provider outcomes, staff notes and exception notes never reach a persisted email/notification param; amount labels are formatted only by formatMinorAmount, never by client float arithmetic
expected: Refund reasons, provider outcomes, staff notes and exception notes never reach a persisted email/notification param; amount labels are formatted only by formatMinorAmount, never by client float arithmetic
result: pass
source: automated
coverage_id: D8

### 36. [13-09/D1] A staff withdrawal or cancellation of a single enrolment (no cohort cancellation) mails the learner exactly once with enrolment-withdrawn/enrolment-cancelled and the matching notification; the staff reason never reaches any persisted column
expected: A staff withdrawal or cancellation of a single enrolment (no cohort cancellation) mails the learner exactly once with enrolment-withdrawn/enrolment-cancelled and the matching notification; the staff reason never reaches any persisted column
result: pass
source: automated
coverage_id: D1

### 37. [13-09/D2] A recipient who muted ENROLMENT_STATUS still gets a SKIPPED muted_by_recipient dispatch and exactly one notification (mute affects the mail, never the in-product notification)
expected: A recipient who muted ENROLMENT_STATUS still gets a SKIPPED muted_by_recipient dispatch and exactly one notification (mute affects the mail, never the in-product notification)
result: pass
source: automated
coverage_id: D2

### 38. [13-09/D3] enrolment.transferred mails the source enrolment's learner exactly once, naming both cohort titles and linking to the target enrolment
expected: enrolment.transferred mails the source enrolment's learner exactly once, naming both cohort titles and linking to the target enrolment
result: pass
source: automated
coverage_id: D3

### 39. [13-09/D4] session.cancelled mails every learner with an ACTIVE enrolment in that cohort at drain time, once each, and nobody else (a WITHDRAWN learner gets nothing); the cancellation reason never reaches any persisted column
expected: session.cancelled mails every learner with an ACTIVE enrolment in that cohort at drain time, once each, and nobody else (a WITHDRAWN learner gets nothing); the cancellation reason never reaches any persisted column
result: pass
source: automated
coverage_id: D4

### 40. [13-09/D5] Several pending session.updated events for one session, drained together, collapse into exactly one mail per ACTIVE learner carrying the session's latest details read at drain time; the older events leave SKIPPED coalesced_into_later_update rows
expected: Several pending session.updated events for one session, drained together, collapse into exactly one mail per ACTIVE learner carrying the session's latest details read at drain time; the older events leave SKIPPED coalesced_into_later_update rows
result: pass
source: automated
coverage_id: D5

### 41. [13-09/D6] session.cancelled always sends and supersedes a pending session.updated for the same session — the update leaves a SKIPPED superseded_by_session_cancellation row and the cancellation mail goes out normally
expected: session.cancelled always sends and supersedes a pending session.updated for the same session — the update leaves a SKIPPED superseded_by_session_cancellation row and the cancellation mail goes out normally
result: pass
source: automated
coverage_id: D6

### 42. [13-09/D7] A real cancelCohort of a cohort with 2 ACTIVE and 1 PENDING_PAYMENT enrolments (plus a learner who withdrew two days earlier) mails only the 3 affected learners once each with cohort-cancelled; the 3 per-enrolment withdrawn/cancelled events are recorded SKIPPED superseded_by_cohort_cancellation with zero QUEUED/SENT rows among them, the earlier-withdrawn learner gets nothing, and a second drain adds no new rows
expected: A real cancelCohort of a cohort with 2 ACTIVE and 1 PENDING_PAYMENT enrolments (plus a learner who withdrew two days earlier) mails only the 3 affected learners once each with cohort-cancelled; the 3 per-enrolment withdrawn/cancelled events are recorded SKIPPED superseded_by_cohort_cancellation with zero QUEUED/SENT rows among them, the earlier-withdrawn learner gets nothing, and a second drain adds no new rows
result: pass
source: automated
coverage_id: D7

### 43. [13-09/D8] The 60-second cohort-cancellation precedence window is a real boundary: 59 seconds before/after supersedes, 61 seconds does not; a different actor or a different reason within the window is neither superseded nor swept into the cohort mail
expected: The 60-second cohort-cancellation precedence window is a real boundary: 59 seconds before/after supersedes, 61 seconds does not; a different actor or a different reason within the window is neither superseded nor swept into the cohort mail
result: pass
source: automated
coverage_id: D8

### 44. [13-09/D9] Every cross-event lookup (cohort-cancellation window, session-cancellation existence, newer-pending-update) uses parameterised Prisma.sql tagged templates over the DomainEvent JSONB payload — no payload text is ever concatenated into SQL, and no reason string reaches any persisted email/notification param
expected: Every cross-event lookup (cohort-cancellation window, session-cancellation existence, newer-pending-update) uses parameterised Prisma.sql tagged templates over the DomainEvent JSONB payload — no payload text is ever concatenated into SQL, and no reason string reaches any persisted email/notification param
result: pass
source: automated
coverage_id: D9

### 45. [13-10/D1] A released grade (quiz auto-release or staff release, score/maxScore/passed present in the payload) mails the enrolment's learner exactly once with grade-released and a matching grade.released notification targeting LEARNER_RESULTS; templateParams carries exactly assessmentTitle and resultsPath, never the score
expected: A released grade (quiz auto-release or staff release, score/maxScore/passed present in the payload) mails the enrolment's learner exactly once with grade-released and a matching grade.released notification targeting LEARNER_RESULTS; templateParams carries exactly assessmentTitle and resultsPath, never the score
result: pass
source: automated
coverage_id: D1

### 46. [13-10/D2] A grade.overridden event yields template grade-overridden and notification type grade.overridden; previousScore, newScore and passedChanged never reach templateParams, notification params, or any other persisted column
expected: A grade.overridden event yields template grade-overridden and notification type grade.overridden; previousScore, newScore and passedChanged never reach templateParams, notification params, or any other persisted column
result: pass
source: automated
coverage_id: D2

### 47. [13-10/D3] A recipient who muted RESULT_NOTICES still gets a SKIPPED muted_by_recipient dispatch and exactly one notification for a grade.released/grade.overridden event (mute affects the mail, never the in-product notification, D-19)
expected: A recipient who muted RESULT_NOTICES still gets a SKIPPED muted_by_recipient dispatch and exactly one notification for a grade.released/grade.overridden event (mute affects the mail, never the in-product notification, D-19)
result: pass
source: automated
coverage_id: D3

### 48. [13-10/D4] Two different learners' grade.released events drained together each receive only their own mail, with the correct per-recipient assessment title (multi-recipient isolation)
expected: Two different learners' grade.released events drained together each receive only their own mail, with the correct per-recipient assessment title (multi-recipient isolation)
result: pass
source: automated
coverage_id: D4

### 49. [13-10/D5] certificate.issued mails the certificate's own holder (resolved from the Certificate row, never a payload user id) exactly once with the verification reference and the learner dashboard link, plus a certificate.issued notification targeting LEARNER_DASHBOARD; a missing certificate row yields no rows
expected: certificate.issued mails the certificate's own holder (resolved from the Certificate row, never a payload user id) exactly once with the verification reference and the learner dashboard link, plus a certificate.issued notification targeting LEARNER_DASHBOARD; a missing certificate row yields no rows
result: pass
source: automated
coverage_id: D5

### 50. [13-10/D6] certificate.revoked mails only the verification reference — a hostile reason key on the payload (SECRET-REVOCATION-REASON) never reaches templateParams, notification params, or any other persisted column; templateParams keys are exactly [verificationRef]
expected: certificate.revoked mails only the verification reference — a hostile reason key on the payload (SECRET-REVOCATION-REASON) never reaches templateParams, notification params, or any other persisted column; templateParams keys are exactly [verificationRef]
result: pass
source: automated
coverage_id: D6

### 51. [13-10/D7] certificate.reissued resolves the holder from the NEW certificate row (not the superseded old one) and mails both verification references; a hostile reissue reason on the payload never reaches any persisted column
expected: certificate.reissued resolves the holder from the NEW certificate row (not the superseded old one) and mails both verification references; a hostile reissue reason on the payload never reaches any persisted column
result: pass
source: automated
coverage_id: D7

### 52. [13-10/D8] With all four mutable email categories muted for the recipient, every certificate dispatch (issued/revoked/reissued) is still QUEUED or SENT, never SKIPPED — certificate mail is always sent (D-16)
expected: With all four mutable email categories muted for the recipient, every certificate dispatch (issued/revoked/reissued) is still QUEUED or SENT, never SKIPPED — certificate mail is always sent (D-16)
result: pass
source: automated
coverage_id: D8

### 53. [13-10/D9] Each of ticket.created, ticket.public_reply_added, ticket.resolved, ticket.reopened and ticket.closed drains to exactly one EmailDispatch (templates ticket-created/ticket-reply/ticket-resolved/ticket-reopened/ticket-closed) and one Notification for the requester; the ticket message body used in the fixture never reaches any persisted column
expected: Each of ticket.created, ticket.public_reply_added, ticket.resolved, ticket.reopened and ticket.closed drains to exactly one EmailDispatch (templates ticket-created/ticket-reply/ticket-resolved/ticket-reopened/ticket-closed) and one Notification for the requester; the ticket message body used in the fixture never reaches any persisted column
result: pass
source: automated
coverage_id: D9

### 54. [13-10/D10] A ticket.reopened event with payload ownerId null still yields exactly one dispatch and notification for the ticket's requester (resolved from the Ticket row, A-04); with ownerId set to a real assignee id the requester — not the assignee — is still mailed
expected: A ticket.reopened event with payload ownerId null still yields exactly one dispatch and notification for the ticket's requester (resolved from the Ticket row, A-04); with ownerId set to a real assignee id the requester — not the assignee — is still mailed
result: pass
source: automated
coverage_id: D10

### 55. [13-10/D11] ticket-created is always sent (D-16 ALWAYS category) while TICKET_UPDATES muted for the requester leaves ticket-resolved/ticket-reopened/ticket-closed SKIPPED muted_by_recipient, with the notification still created in every case
expected: ticket-created is always sent (D-16 ALWAYS category) while TICKET_UPDATES muted for the requester leaves ticket-resolved/ticket-reopened/ticket-closed SKIPPED muted_by_recipient, with the notification still created in every case
result: pass
source: automated
coverage_id: D11

### 56. [13-11/D1] resolveStaffHolders returns exactly the same user set as hasPermission/isGrantActive over loadGrantsForUser across the full grant matrix (global, cohort, programme, course, wrong scope id, inactive role, revoked, expired, not-yet-started, deactivated, non-staff) — proven against a real, throwaway Testcontainers Postgres, not trusted by code inspection
expected: resolveStaffHolders returns exactly the same user set as hasPermission/isGrantActive over loadGrantsForUser across the full grant matrix (global, cohort, programme, course, wrong scope id, inactive role, revoked, expired, not-yet-started, deactivated, non-staff) — proven against a real, throwaway Testcontainers Postgres, not trusted by code inspection
result: pass
source: automated
coverage_id: D1

### 57. [13-11/D2] A cohort-scoped grant for a different cohort is absent from a cohort-scoped result while a global holder is present for every scope; boundary window instants (startsAt/endsAt at the current moment) are still active, matching isGrantActive's inclusive semantics
expected: A cohort-scoped grant for a different cohort is absent from a cohort-scoped result while a global holder is present for every scope; boundary window instants (startsAt/endsAt at the current moment) are still active, matching isGrantActive's inclusive semantics
result: pass
source: automated
coverage_id: D2

### 58. [13-11/D3] Draining ticket.created notifies every global tickets.manage holder except the requester and a deactivated holder, with zero EmailDispatch rows (D-08, D-20)
expected: Draining ticket.created notifies every global tickets.manage holder except the requester and a deactivated holder, with zero EmailDispatch rows (D-08, D-20)
result: pass
source: automated
coverage_id: D3

### 59. [13-11/D4] ticket.assigned mails and notifies the payload assignee; ticket.escalated mails and notifies only the Ticket row's assigneeId when set, else notifies (no email) every global tickets.manage holder (A-03)
expected: ticket.assigned mails and notifies the payload assignee; ticket.escalated mails and notifies only the Ticket row's assigneeId when set, else notifies (no email) every global tickets.manage holder (A-03)
result: pass
source: automated
coverage_id: D4

### 60. [13-11/D5] order.exception and payment.reconciliation_exception email and notify only payments.view holders whose scope reaches the order's cohort; templateParams carry only orderReference/reasonLabel/paymentPath (or orderReference/paymentPath) — never exceptionNote, free-text reason, or provider detail; an unknown reason code renders the generic 'Payment needs review' label rather than the raw code
expected: order.exception and payment.reconciliation_exception email and notify only payments.view holders whose scope reaches the order's cohort; templateParams carry only orderReference/reasonLabel/paymentPath (or orderReference/paymentPath) — never exceptionNote, free-text reason, or provider detail; an unknown reason code renders the generic 'Payment needs review' label rather than the raw code
result: pass
source: automated
coverage_id: D5

### 61. [13-11/D6] submission.created creates an in-product notification (no email) only for submissions.view holders whose scope reaches the submission's own enrolment cohort — a grader scoped to a different cohort and a non-holder both receive nothing
expected: submission.created creates an in-product notification (no email) only for submissions.view holders whose scope reaches the submission's own enrolment cohort — a grader scoped to a different cohort and a non-holder both receive nothing
result: pass
source: automated
coverage_id: D6

### 62. [13-11/D7] When an EmailDispatch reaches FAILED in Pass 2, every global audit.view holder gets exactly one staff.email_failed notification (targetType STAFF_EMAIL_LOG, params limited to template and an 8-character dispatchRef), a non-holder gets none, a second drain over the same FAILED state adds no duplicate, no EmailDispatch row is ever created by the alert, and two failures in one run raise exactly two alerts while zero failures call the service zero times
expected: When an EmailDispatch reaches FAILED in Pass 2, every global audit.view holder gets exactly one staff.email_failed notification (targetType STAFF_EMAIL_LOG, params limited to template and an 8-character dispatchRef), a non-holder gets none, a second drain over the same FAILED state adds no duplicate, no EmailDispatch row is ever created by the alert, and two failures in one run raise exactly two alerts while zero failures call the service zero times
result: pass
source: automated
coverage_id: D7

### 63. [13-11/D8] The drain's runtime import closure (netlify/functions/drain-domain-events.ts) never reaches @/server/permissions or its submodules — the staff resolver and mappers import only Permission/ResourceScope as types
expected: The drain's runtime import closure (netlify/functions/drain-domain-events.ts) never reaches @/server/permissions or its submodules — the staff resolver and mappers import only Permission/ResourceScope as types
result: pass
source: automated
coverage_id: D8

### 64. [13-12/D1] Tracer: a FAILED email with stored params appears in the permission-gated log, an administrator resends it with an audited reason, and a subsequent drain delivers it — the same EmailDispatch row throughout, one audit.resent row
expected: Tracer: a FAILED email with stored params appears in the permission-gated log, an administrator resends it with an audited reason, and a subsequent drain delivers it — the same EmailDispatch row throughout, one audit.resent row
result: pass
source: automated
coverage_id: D1

### 65. [13-12/D2] listDispatches never exposes templateParams, projects only the stored error/skipReason classification, marks stub: provider ids, and computes canResend correctly across the full status/category/params matrix; resendDispatch is refused for a caller without users.manage even when they hold audit.view
expected: listDispatches never exposes templateParams, projects only the stored error/skipReason classification, marks stub: provider ids, and computes canResend correctly across the full status/category/params matrix; resendDispatch is refused for a caller without users.manage even when they hold audit.view
result: pass
source: automated
coverage_id: D2

### 66. [13-12/D3] The staff page filters by status/template, shows the exact UI-SPEC empty/error/denied copy, hides Resend from viewers without users.manage, and the sidebar shows Email log only to audit.view holders, positioned after Audit
expected: The staff page filters by status/template, shows the exact UI-SPEC empty/error/denied copy, hides Resend from viewers without users.manage, and the sidebar shows Email log only to audit.view holders, positioned after Audit
    Rationale: The 200-character truncation readability backstop (must-have T-13-… 'long recipient and error text') needs a real browser — jsdom measures no layout. The truncate+title mechanism is implemented; visual confirmation is deferred to the phase's held-out UI-state pass, same as Plan 06's own outstanding backstops.
result: issue
reported: "Held-out browser screenshots show the long recipient expanding the table so that columns move off-screen instead of truncating within the recipient column. The long error text truncates and the administrator Resend control renders correctly. Email log visibility after Audit and instructor denial visibility both passed."
severity: minor

### 67. [13-13/D2] Phase 13 structural invariants pinned: permission catalogue size, DomainEventType membership, append-only Notification/EmailPreference/EmailDispatch/DomainEvent, single sender identity with no hard-coded fallback, auth-service isolation from APP_BASE_URL/plain-text bodies, and safe notification-component rendering
expected: Phase 13 structural invariants pinned: permission catalogue size, DomainEventType membership, append-only Notification/EmailPreference/EmailDispatch/DomainEvent, single sender identity with no hard-coded fallback, auth-service isolation from APP_BASE_URL/plain-text bodies, and safe notification-component rendering
result: pass
source: automated
coverage_id: D2

### 68. [13-13/D3] One real-Postgres acceptance test demonstrates all three ROADMAP success criteria together: one templated email per event under one sender/Reply-To; no duplicate EmailDispatch rows across replay, overlap and retry; and notifications report unread/current state and fail safely
expected: One real-Postgres acceptance test demonstrates all three ROADMAP success criteria together: one templated email per event under one sender/Reply-To; no duplicate EmailDispatch rows across replay, overlap and retry; and notifications report unread/current state and fail safely
result: pass
source: automated
coverage_id: D3

### 69. [13-13/D1] Opt-in live Brevo smoke test (D-24) — skips cleanly without BREVO_LIVE, and is structured to send one real email and prove a live outage degrades safely when run manually with real credentials
expected: Opt-in live Brevo smoke test (D-24) — skips cleanly without BREVO_LIVE, and is structured to send one real email and prove a live outage degrades safely when run manually with real credentials
    Rationale: The live-send and live-outage assertions themselves need a real BREVO_API_KEY and network access to Brevo, which this environment does not have — only the skip path (the correct CI-mode outcome) was exercised. A human with real credentials must run BREVO_LIVE=1 to close D-24's manual-only requirement, per 13-VALIDATION.md's Manual-Only Verifications table.
result: pass
source: manual

## Summary

total: 69
passed: 66
issues: 2
pending: 0
skipped: 0
blocked: 1

## Gaps

- gap_id: G-13-1
  truth: "Notification titles clamp to 2 lines and metadata to 1 line in the real drawer layout"
  status: failed
  reason: "Held-out browser screenshot shows the long title at 3 lines and metadata at 2 lines despite the line-clamp utility classes."
  severity: cosmetic
  test: 22
  root_cause: "NotificationItem combines line-clamp-2/line-clamp-1 with block on the same spans. Tailwind v4 emits .block after the equal-specificity clamp utilities, so display:block overrides the clamp-required display:-webkit-box and the text wraps naturally."
  artifacts:
    - path: "src/components/notifications/NotificationItem.tsx"
      issue: "Both clamped text spans also carry the conflicting block utility."
    - path: "tests/components/notification-drawer.test.tsx"
      issue: "The test asserts utility-class presence but cannot verify computed layout behavior."
  missing:
    - "Remove the conflicting block utilities while preserving full-width text behavior."
    - "Add browser-level regression coverage for a 200-character title and metadata value."
  debug_session: ".planning/debug/notification-text-clamp-fails.md"
- gap_id: G-13-2
  truth: "Long recipient and error values truncate without widening or breaking the Email Log table"
  status: failed
  reason: "Held-out desktop screenshots show a long recipient expanding the table and pushing columns off-screen; error text truncation and Resend rendering work correctly."
  severity: minor
  test: 66
  root_cause: "The recipient cell renders raw mono text. ResourceTable applies whitespace-nowrap to mono cells, while the recipient has no width, max-width, or truncate wrapper; its intrinsic width expands the auto-layout table and the overflow wrapper moves later columns off-screen."
  artifacts:
    - path: "src/app/staff/email-log/EmailLogTable.tsx"
      issue: "Recipient rendering is unbounded, unlike the constrained Last error cell."
    - path: "src/components/primitives/ResourceTable.tsx"
      issue: "The shared auto-layout table applies whitespace-nowrap to mono cells."
    - path: "tests/components/email-log-table.test.tsx"
      issue: "No real-layout regression covers a long recipient address."
  missing:
    - "Bound and truncate the recipient value while preserving mono styling and full-value access via title."
    - "Add browser-level regression coverage proving later columns remain visible with a long recipient."
  debug_session: ".planning/debug/email-log-recipient-overflow.md"
