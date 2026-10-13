# Phase 13: Transactional Communications & Notifications - Context

**Gathered:** 2026-09-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Every meaningful lifecycle event reaches the right person exactly once: one deduplicated, templated transactional email per event under one sender identity (COM-01, COM-02, COM-04), plus in-product notifications that show unread/current state and fail safely on stale or inaccessible links (COM-03).

Phase 13 drains the append-only `DomainEvent` outbox (emitted by Phases 5-12) into `EmailDispatch` rows and a new `Notification` store, sends via Brevo, and adds the bell + slide-over UI for learner and staff shells. It also brings Phase 3's direct verification/reset/profile mails onto the same deduped dispatch path.

Depends on Phases 3, 5, 6, 7, 10, 11, 12 (all complete). Phase 8 is not a dependency.

</domain>

<decisions>
## Implementation Decisions

### Drain & retry engine
- **D-01:** The outbox drain is a scheduled task `src/server/scheduled/drain-domain-events-task.ts` wrapped by a Netlify scheduled function (`netlify/functions/`), run every 1-2 minutes, following the `reconcile-payments` / `release-expired-holds` pattern. No pg-boss, no new long-running process. The task is also invocable on demand. — **Reversibility:** reversible — the task body is transport-agnostic; only the wrapper would change.
- **D-02:** Two-pass design. Pass 1 (per-event transaction): claim a batch of unprocessed `DomainEvent`s with row locking that skips locked rows (overlapping runs cannot double-process); in one transaction create every `EmailDispatch` (QUEUED) and `Notification` row the event fans out to, then set `processedAt`. Pass 2: send QUEUED `EmailDispatch` rows via Brevo with their own retry state. Sending is never done inside the event transaction.
- **D-03:** Retry policy for Brevo failures: exponential backoff on later drain runs (~1 min, 5 min, 30 min, 2 h), max 5 attempts, then `FAILED`. Permanent errors (bad request / invalid address) go to `FAILED` immediately with no retry. Retries reuse the same `EmailDispatch` row so the (template, correlationId) unique constraint holds. Needs an attempts / next-attempt-at addition to `EmailDispatch` (schema change).
- **D-04:** Poison events: track an attempt count and last error on `DomainEvent`; after 3 failed mapping attempts mark it processed-with-error and write a security audit entry so one bad event never blocks the queue. (Schema addition on `DomainEvent`.)
- **D-05:** Dedup identity (COM-02): `correlationId` = DomainEvent id (per recipient when one event fans out to several people). `EmailDispatch` stays unique on (template, correlationId). Re-draining or replaying the same event can never double-send.
- **D-06:** Staff delivery log + manual resend: a read-only list of `EmailDispatch` (template, recipient, status, attempts, error) with an audited Resend action that reuses the dispatch row. Access is Global Administrators through an existing global-scope admin permission (planner picks which; no new catalogue identifier, the catalogue stays closed at 36). Resend records actor and reason.

### Email catalogue & recipients
- **D-07:** Learner emails (COM-01): payment + enrolment confirmed (one combined "you're enrolled" mail, not two) and enrolment withdrawn/cancelled/transferred; session updated, session cancelled and cohort cancelled to enrolled learners; grade released and grade overridden, certificate issued, revoked and reissued; ticket public reply, resolved, reopened, closed, created confirmation. Certificate-revoked and ticket mails carry ids/references only, never staff reasons or message bodies (T-11-50, Phase 12 payload rules).
- **D-08:** Staff emails: the assignee on `ticket.assigned`, the escalation target on `ticket.escalated`, and Finance/Operations payments-scope holders on `order.exception` / `payment.reconciliation_exception`. Everything else for staff is in-product only: new tickets to support-queue holders, `submission.created` to graders scoped to that Cohort, and an in-product alert to Administrators when an email reaches FAILED (no email about a failed email).
- **D-09:** Coverage gaps are closed by adding events: emit `payment.failed` and `payment.refunded` (and any needed auth/profile events) into the outbox. `DomainEventType` is a closed union, so extend it deliberately.
- **D-10:** Verification, password-reset and profile-change mails join the pipeline via the same deduped `EmailDispatch` service and shared templates/sender, but send immediately in-request (not via the 1-2 min drain). They use a stable correlation key per token issuance. The raw token exists only in memory and is never written to an outbox payload, `EmailDispatch`, or `Notification`. A failed send is retried only by the user requesting a new link. Replaces Phase 3's random per-send correlation ids (`email-dispatch-service.ts`).
- **D-11:** Recipients are resolved at drain time, not event time: skip with a recorded SKIPPED reason if the user is deactivated, or the email is unverified (for non-auth mails). Session-change mails go only to learners with an ACTIVE enrolment in that cohort at drain time. No personal email addresses in outbox payloads.
- **D-12:** Session-change coalescing: within one drain run, multiple `session.updated` events for the same session collapse into one mail showing the latest details; `session.cancelled` always sends immediately and supersedes pending updates.

### Email look & sender
- **D-13:** Emails are HTML with an auto-derived plain-text alternative, rendered from typed template functions over one shared branded layout (brand name, heading, body, button, support footer). Hand-written inline-styled HTML, no new dependency (not React Email). Replaces today's plain-text-only `textContent`.
- **D-14:** One sender identity (COM-04): From name/address stays env-configured in a single place. Add Reply-To from the existing support contact (`src/server/support-contact.ts`). Fail loudly if the sender is unset; never fall back to a default. No separate no-reply address.
- **D-15:** Deep links use an absolute URL from one configured public base URL and point at the normal authenticated page. No tokens in links except verification/reset, no signed one-click links.
- **D-16:** Learners may mute email (not in-product) for four categories: ticket replies & updates, result release notices, session change notices, enrolment status changes. Always sent: payment and enrolment confirmations, ticket-created confirmation, certificates issued/revoked/reissued, session cancellations, verification/reset. Needs a per-user preference store. Staff notification emails are fixed (no opt-out).

### In-product notifications
- **D-17:** A `Notification` model (new) written by the drain in the same transaction as the event's other outputs. Storage holds type, target reference (ids only), recipient, read state, timestamps. Text is rendered from type + safe fields; it never contains reasons, message bodies, filenames or other sensitive detail.
- **D-18:** UI: a bell with an unread badge in both the learner and staff headers opens a right-side slide-over drawer (no full notifications page). List grouped Today / Earlier, unread rows tinted with a dot and bolder title, "Mark all read", cursor-paged "Load older". Learner-only gear icon in the drawer swaps the same panel to the email-preference switches (D-16) with an "Always emailed" locked list. Approved design: https://claude.ai/artifact/9ttR5SBAFnxvFmgxShLdBH (source `notifications-drawer.html` in the session scratchpad). Uses the app's existing tokens (navy/brand blue, Schibsted Grotesk), light and dark.
- **D-19:** Read state: an item is marked read when its link is opened, plus explicit "Mark all read". Opening the drawer alone marks nothing. A muted email category still produces the in-product notification.
- **D-20:** Staff scope: staff alerts are resolved at drain time from permission + scope (ticket alerts to support holders, the assignee for assigned/escalated, payments holders for exceptions, Cohort-scoped graders for submissions, Administrators for failed email). Nobody gets an alert for a record they could not open.
- **D-21:** Stale/inaccessible links fail safely by checking access before navigating: on click the drawer verifies access and shows an inline "No longer available" state (item marked read and greyed) instead of navigating. Keep this check in sync with the destination page's authorization (same `withPermission` / ownership rules; identical-404 parity, no existence leak).
- **D-22:** The unread badge is server-rendered on each navigation plus a light client poll (~60 s) while the tab is visible. No websockets/SSE.
- **D-23:** Retention: read notifications older than 90 days drop out of the drawer through a scheduled cleanup (archive-only, never hard-deleted); unread stay until read.

### Verification approach
- **D-24:** Unit tests render every template (HTML + text): no secrets, correct links, correct sender. UAT and dev use a stubbed transport that records to `EmailDispatch`. One opt-in live Brevo smoke test closes Phase 3's declined Brevo-outage live check.

### Claude's Discretion
- Which existing global admin permission gates the delivery log/resend (D-06).
- Exact backoff timings within the stated shape (D-03), batch size, and lock/claim SQL.
- Notification `type` naming, payload shape, and whether the preference store is a table or JSON on `User`.
- Template copy and visual detail of the shared email layout within the brand tokens.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — COM-01..COM-04 (lines ~122-125) and traceability rows
- `.planning/ROADMAP.md` §"Phase 13: Transactional Communications & Notifications" — goal, dependencies, success criteria
- `.planning/PROJECT.md` — Key Decisions (no hard deletes, closed permission catalogue, Prisma import boundary, money in minor units)
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` — product authority for communications
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` — UI/workflow spec (PRD wins on conflict)

### Prior-phase context that Phase 13 consumes
- `.planning/phases/12-support-tickets/12-CONTEXT.md` — ticket events/payload rules, "Phase 13 delivers ticket email + in-product" boundary
- `.planning/phases/11-certificates-completion-lifecycle/11-CONTEXT.md` — certificate events; outbox is not a work-queue for issuance; no revocation reason in mail
- `.planning/phases/12-support-tickets/12-VERIFICATION.md` — Phase 12 verified state
- `.planning/v1.0-MILESTONE-AUDIT.md` — open gaps; Phase 3 Brevo-outage live check still `human_needed`

### Code contracts
- `src/server/services/domain-event-service.ts` — closed `DomainEventType` union, sink-level redaction, event catalogue to drain
- `src/server/services/email-dispatch-service.ts` — current dispatch bookkeeping (random correlation ids to be replaced)
- `src/server/email/brevo-client.ts` — Brevo transport, env-configured sender, failure classification
- `prisma/schema.prisma` — `DomainEvent` (line ~1079), `EmailDispatch` (line ~1813, unique on template+correlationId)
- `src/server/scheduled/*-task.ts` and `netlify/functions/*.ts` — scheduled-task pattern; `tests/reconcile-payments-task.test.ts`, `tests/release-expired-holds-task.test.ts` as test analogs
- `src/server/support-contact.ts` — support contact for Reply-To/footer
- `src/app/globals.css` — design tokens for the drawer and email layout

No further external specs beyond the above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DomainEvent` outbox: already written in-transaction by Phases 5-12 with redacted payloads; `processedAt` reserved for this phase's drain.
- `EmailDispatch` + `createEmailDispatchService` (injectable store/send): extend rather than replace.
- Brevo client and failure describer: reuse for send + permanent/transient classification.
- Scheduled task + Netlify wrapper pattern (7 existing tasks) and their system-actor audit convention (`actorType: "SYSTEM"`).
- `redactForAudit` / audit service for resend and poison-event audit entries.

### Established Patterns
- `@prisma/client` only in `src/server/services/**` and `src/server/db.ts`; scheduled tasks call services.
- Closed permission catalogue (36) and `withPermission` choke point; ownership-safe identical-404 for inaccessible records.
- Archive-only, no hard deletes.

### Integration Points
- Learner and staff layout headers (bell + drawer mount).
- Phase 3 auth services (registration, verification, password reset, profile) switch to the new dispatch path (D-10).
- Payment services must emit new `payment.failed` / `payment.refunded` events (D-09).
- Staff admin area for the delivery log page.

</code_context>

<specifics>
## Specific Ideas

- Drawer design approved by the user ("i like the design"): right-side slide-over, bell with badge, gear inside the drawer for email preferences, greyed "No longer available" stale items, Learner/Staff variants.
- Combine payment + enrolment activation into one learner mail.

</specifics>

<deferred>
## Deferred Ideas

- Full-page notification centre — user chose drawer only.
- Signed one-click email links — new bearer-credential surface, not needed for v1.
- Staff-side email opt-out and a separate no-reply sender identity.
- Todo "Move staff support queue filtering, counts and paging into SQL" — reviewed, not folded (Support queue performance, not communications).
- Todo "Fix Phase 07 review findings — manual-payment race, idempotency, providerRef" — reviewed, not folded (payments hardening); planner should check overlap with `order.paid` dedup.

### Reviewed Todos (not folded)
- `2026-09-25-move-staff-support-queue-filtering-into-sql.md` — belongs with a support/performance pass.
- `2026-09-14-fix-07-review-manual-payment-race-and-idempotency.md` — payments phase follow-up; relevant only where it touches event emission.

</deferred>

---

*Phase: 13-Transactional Communications & Notifications*
*Context gathered: 2026-09-27*
