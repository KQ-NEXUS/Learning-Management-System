# Phase 13: Transactional Communications & Notifications - Research

**Researched:** 2026-09-27
**Domain:** Transactional-outbox drain, deduped templated email (Brevo), in-product notifications (Next.js 16 App Router, Prisma 6, Postgres)
**Confidence:** HIGH on codebase facts (read this session); MEDIUM on Netlify runtime limits (not verified this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Outbox drain is a scheduled task `src/server/scheduled/drain-domain-events-task.ts` wrapped by a Netlify scheduled function (`netlify/functions/`), every 1-2 minutes, following the `reconcile-payments` / `release-expired-holds` pattern. No pg-boss, no new long-running process. Also invocable on demand. Reversible (task body transport-agnostic).
- **D-02:** Two-pass. Pass 1 (per-event transaction): claim a batch of unprocessed `DomainEvent`s with row locking that skips locked rows; in one transaction create every `EmailDispatch` (QUEUED) and `Notification` row the event fans out to, then set `processedAt`. Pass 2: send QUEUED `EmailDispatch` rows via Brevo with their own retry state. Never send inside the event transaction.
- **D-03:** Brevo retry: exponential backoff on later drain runs (~1 min, 5 min, 30 min, 2 h), max 5 attempts, then `FAILED`. Permanent errors (bad request / invalid address) go `FAILED` immediately. Retries reuse the same `EmailDispatch` row (unique (template, correlationId) holds). Needs attempts / next-attempt-at on `EmailDispatch` (schema change).
- **D-04:** Poison events: attempt count and last error on `DomainEvent`; after 3 failed mapping attempts mark processed-with-error and write a security audit entry. (Schema addition on `DomainEvent`.)
- **D-05:** `correlationId` = DomainEvent id (per recipient when one event fans out to several). `EmailDispatch` stays unique on (template, correlationId).
- **D-06:** Staff delivery log (read-only list: template, recipient, status, attempts, error) + audited Resend that reuses the dispatch row. Global Administrators via an existing global-scope admin permission (planner picks; no new catalogue identifier, catalogue stays closed at 36). Resend records actor and reason.
- **D-07:** Learner emails: payment+enrolment confirmed (ONE combined "you're enrolled" mail) and enrolment withdrawn/cancelled/transferred; session updated, session cancelled and cohort cancelled to enrolled learners; grade released and grade overridden, certificate issued, revoked and reissued; ticket public reply, resolved, reopened, closed, created confirmation. Certificate-revoked and ticket mails carry ids/references only, never staff reasons or message bodies (T-11-50, Phase 12 payload rules).
- **D-08:** Staff emails: assignee on `ticket.assigned`, escalation target on `ticket.escalated`, Finance/Operations payments-scope holders on `order.exception` / `payment.reconciliation_exception`. Everything else staff is in-product only: new tickets to support-queue holders, `submission.created` to graders scoped to that Cohort, in-product alert to Administrators when an email reaches FAILED (no email about a failed email).
- **D-09:** Close coverage gaps by adding events: emit `payment.failed` and `payment.refunded` (and any needed auth/profile events). `DomainEventType` is a closed union; extend deliberately.
- **D-10:** Verification, password-reset, profile-change mails join the same deduped `EmailDispatch` service + shared templates/sender but send immediately in-request. Stable correlation key per token issuance. Raw token only in memory; never in outbox payload, `EmailDispatch`, or `Notification`. Failed send retried only by the user requesting a new link. Replaces Phase 3's random per-send correlation ids.
- **D-11:** Recipients resolved at drain time: SKIPPED with recorded reason if user deactivated, or email unverified (non-auth mails). Session-change mails only to learners with an ACTIVE enrolment in that cohort at drain time. No personal email addresses in outbox payloads.
- **D-12:** Within one drain run, multiple `session.updated` for the same session collapse into one mail with latest details; `session.cancelled` always sends immediately and supersedes pending updates.
- **D-13:** HTML + auto-derived plain-text, typed template functions over one shared branded layout. Hand-written inline-styled HTML, no new dependency (not React Email).
- **D-14:** One sender identity, env-configured in a single place. Add Reply-To from `src/server/support-contact.ts`. Fail loudly if sender unset; never fall back to a default. No separate no-reply.
- **D-15:** Deep links absolute from one configured public base URL to the normal authenticated page. No tokens in links except verification/reset. No signed one-click links.
- **D-16:** Learners may mute email (not in-product) for four categories: ticket replies & updates, result release notices, session change notices, enrolment status changes. Always sent: payment and enrolment confirmations, ticket-created confirmation, certificates issued/revoked/reissued, session cancellations, verification/reset. Needs per-user preference store. Staff emails fixed.
- **D-17:** New `Notification` model written by the drain in the same transaction as the event's other outputs. Stores type, target reference (ids only), recipient, read state, timestamps. Text rendered from type + safe fields; never reasons, bodies, filenames.
- **D-18:** Bell with unread badge in both learner and staff headers opens right-side slide-over drawer (no full page). Grouped Today/Earlier, unread tinted with dot + bolder title, "Mark all read", cursor-paged "Load older". Learner-only gear swaps panel to email-preference switches with "Always emailed" locked list. Existing tokens, light/dark.
- **D-19:** Read on link open + explicit "Mark all read". Opening the drawer alone marks nothing. Muted email category still produces the in-product notification.
- **D-20:** Staff alerts resolved at drain time from permission + scope. Nobody gets an alert for a record they could not open.
- **D-21:** Stale/inaccessible links fail safely by checking access before navigating; inline "No longer available" (marked read, greyed) instead of navigating. Same `withPermission` / ownership rules as destination page; identical-404 parity, no existence leak.
- **D-22:** Badge server-rendered per navigation + ~60 s client poll while tab visible. No websockets/SSE.
- **D-23:** Read notifications older than 90 days drop out of drawer via scheduled cleanup (archive-only, never hard-deleted); unread stay until read.
- **D-24:** Unit tests render every template (HTML + text): no secrets, correct links, correct sender. UAT/dev use a stubbed transport recording to `EmailDispatch`. One opt-in live Brevo smoke test closes Phase 3's declined Brevo-outage live check.

### Claude's Discretion
- Which existing global admin permission gates the delivery log/resend (D-06).
- Exact backoff timings within the stated shape (D-03), batch size, lock/claim SQL.
- Notification `type` naming, payload shape, whether preference store is a table or JSON on `User`.
- Template copy and visual detail of the shared email layout within brand tokens.

### Deferred Ideas (OUT OF SCOPE)
- Full-page notification centre (drawer only).
- Signed one-click email links.
- Staff-side email opt-out and separate no-reply sender identity.
- Todo "Move staff support queue filtering, counts and paging into SQL".
- Todo "Fix Phase 07 review findings — manual-payment race, idempotency, providerRef" (planner should check overlap with `order.paid` dedup).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COM-01 | Every defined lifecycle event sends one templated transactional email | Event catalogue + payload-gap table below; shared template module; drain Pass 1/2 |
| COM-02 | Retries/replays never duplicate within a correlation | `EmailDispatch @@unique([template, correlationId])` + `createMany skipDuplicates` / catch P2002; correlationId = `${eventId}` per recipient |
| COM-03 | In-product notifications show unread/current state, fail safe on stale links | `Notification` model, access-check route/action reusing destination auth, bell/drawer |
| COM-04 | One approved sender identity | Single sender module, fail-loud on unset, Reply-To from support contact |
</phase_requirements>

## Summary

The outbox already exists and is written in-transaction by Phases 5-12, but several details the CONTEXT assumes are NOT true of the current code, and the planner must budget for them. (1) `session.updated` is in the `DomainEventType` union but has **no producer**: `scheduled-session-service.ts` exposes only create, repeat and cancel (no update mutation) [VERIFIED: grep of `src` found "session.updated" only in `domain-event-service.ts`; `scheduled-session-service.ts:414,460,526` are the only three `withPermission` mutations]. D-07/D-12 (session updated + coalescing) therefore need either a new session-edit mutation (scope decision) or a built-but-dormant handler. (2) Payloads deliberately carry ids only, so the drain must resolve recipients by joining: `grade.*`, `certificate.*`, `submission.created`, `session.*`, `cohort.cancelled`, `enrolment.withdrawn/cancelled/activated/approved` carry `enrolmentId`/`cohortId` but no `userId`; `order.paid` carries `orderId` (no `userId`); `ticket.escalated` carries only `queue` (no target user) and `ticket.reopened` carries `ownerId` (the assignee). (3) **A direct confirmation email already exists** in `checkout-webhook-system-service.ts` (template `order-confirmation` / `order-payment-exception`, sent post-commit via `dispatchBestEffort`). If the drain also mails on `order.paid`/`enrolment.activated`, learners get two mails. That direct path MUST be removed (D-07 says ONE combined mail).

The design is otherwise straightforward and matches existing patterns: a `createXTask(deps)` factory + Netlify wrapper (`schedule` cron), a `FOR UPDATE SKIP LOCKED` claim identical to `export-worker-service.ts:claimQueued`, an injectable-store `createEmailDispatchService`, and route handlers/server actions using `getCurrentActor` + `withPermission`. No new npm package is needed.

**Primary recommendation:** Build a pure `DomainEvent -> Intent[]` mapper layer (per event type: recipients + template + notification) invoked by a drain service in per-event transactions; keep sending in a separate Pass 2 over QUEUED `EmailDispatch`; rewire all existing direct dispatch call sites (registration, verification, reset, profile, checkout webhook) onto one extended `emailDispatchService` with stable correlation keys.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Outbox drain / fan-out | API / Backend (scheduled task -> service) | Database (row lock, unique) | Runs off-request in Netlify function; services own Prisma |
| Dedup (COM-02) | Database (unique constraint) | Service (catch P2002) | Constraint is the guarantee; app code cannot race it |
| Email render + send | API / Backend (template module + Brevo client) | — | Server-only; secrets in env |
| Recipient/scope resolution | API / Backend (service, drain time) | Database | Must use live permission/enrolment state (D-11, D-20) |
| Notification read/list/mark-read | API / Backend (server actions / route handler) | Database | Ownership: `recipientId = actor.userId` |
| Access check on click (D-21) | API / Backend (per-target resolvers) | — | Must mirror destination page auth; never client-side |
| Bell badge / drawer UI | Browser / Client (drawer, poll) | Frontend Server (initial unread count in layout) | D-22 |
| Delivery log + Resend | Frontend Server page + Server Action | API | `withPermission` on both |
| Cleanup of old read notifications | Scheduled task | Database | Archive-only |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@getbrevo/brevo` | ^6.0.3 (already installed) | Transactional send | Existing transport [VERIFIED: package.json] |
| `@prisma/client` / `prisma` | ^6.19.3 | Models, `$queryRaw` SKIP LOCKED, unique-violation (P2002) | Existing; import boundary: only `src/server/services/**` and `src/server/db.ts` |
| `@netlify/functions` | ^6.0.0 | `Config { schedule }` | Existing pattern [VERIFIED: netlify/functions/release-expired-holds.ts] |
| `next` | 16.3.4 | Route Handlers / Server Actions / layouts | Existing |
| `lucide-react` | ^1.41.0 | `Bell`, `Settings`, `X`, `Lock`, `ArrowLeft` | UI-SPEC |
| `vitest` + `@testing-library/react` + `jsdom` + `axe-core` + `testcontainers` | ^4.1.11 etc. | Tests | Existing |

No new dependencies. Package Legitimacy Audit: **none required** — no external package is added this phase (D-13 explicitly forbids React Email). `[VERIFIED: package.json read]`

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written HTML | React Email / mjml | Locked out by D-13 |
| Polling | SSE/websockets | Locked out by D-22 |
| Prefs as table | JSON column on `User` | Discretion; recommend a small `NotificationPreference` table keyed (userId, category) or `User.emailMuted String[]`. Table avoids editing a hot `User` model and is easy to extend; a JSON/array on `User` is fewer joins in the drain. Recommend table `EmailPreference(userId, category, muted)` with default = not muted (absence of row = send). |

**Installation:** none.

## Architecture Patterns

### System Architecture Diagram

```
 mutations (Phases 5-12) --tx--> DomainEvent (processedAt NULL)
                                       |
   Netlify cron (1-2 min) --> drain-domain-events-task
                                       |
   Pass 1: SELECT ... FOR UPDATE SKIP LOCKED (batch, oldest first)
        per event, own tx:
          mapper(event) -> resolve recipients (live enrolment/user/permission)
             |-- skip rules (deactivated / unverified / no ACTIVE enrolment) -> SKIPPED dispatch w/ reason
             |-- EmailDispatch QUEUED  (unique template+correlationId; skip dup)
             |-- Notification rows (in-product; even if email muted)
          set processedAt  (poison: attempts++, lastError; >=3 -> processedAt+error+audit)
                                       |
   Pass 2: claim QUEUED/due EmailDispatch (SKIP LOCKED, nextAttemptAt <= now)
          render template (HTML+text) -> Brevo -> SENT | retry(backoff) | FAILED
          FAILED -> in-product alert to Administrators (Notification, no email)

 in-request auth mails (verify/reset/profile) --> same emailDispatchService.dispatch
        (stable correlation key per token issuance, send immediately)

 Browser: layout server-renders unread count -> NotificationBell (poll ~60s)
        -> Drawer: list (cursor) / mark-read / access-check-then-navigate / prefs
```

### Recommended Project Structure
```
src/server/
  email/
    sender.ts              # single sender identity + Reply-To; throws if unset
    brevo-client.ts        # extend: htmlContent, replyTo, headers; keep describeBrevoFailure + classify permanent vs transient
    templates/
      layout.ts            # shared branded layout (literal-hex constants module)
      registry.ts          # typed template functions, html + derived text
  services/
    email-dispatch-service.ts   # extend: enqueue (idempotent), sendQueued (retry), resend (audited)
    domain-event-drain-service.ts   # Pass 1 claim + mapping
    event-intent-mappers.ts     # pure per-event mappers
    notification-service.ts     # list/unread/markRead/markAllRead/resolveLink/prefs
    notification-access-service.ts # per-target access resolvers mirroring destination pages
  scheduled/
    drain-domain-events-task.ts
    cleanup-notifications-task.ts   # 90-day archive (see Pitfall 9)
netlify/functions/
    drain-domain-events.ts     # schedule "* * * * *" or "*/2 * * * *"
    cleanup-notifications.ts
src/components/notifications/
    NotificationBell.tsx  NotificationDrawer.tsx  NotificationItem.tsx  EmailPreferencesPanel.tsx
src/app/staff/email-log/    # page + actions (delivery log)
```

### Pattern 1: Scheduled task factory + Netlify wrapper
Mirror `createReleaseExpiredHoldsTask(deps)` (returns an async runner, default export wired with real deps, `log` injected) and `createReleaseExpiredHoldsHandler(run)` with `export const config: Config = { schedule: "..." }` [VERIFIED: src/server/scheduled/release-expired-holds-task.ts, netlify/functions/release-expired-holds.ts]. `netlify/functions/dispatch-export-jobs.ts` uses `schedule: "* * * * *"`; `release-expired-holds.ts` uses `"*/5 * * * *"`. The drain task's import closure is walked by `tests/boundary.test.ts` (`workerRuntimeClosure`) and must stay free of request-only APIs (`next/headers`, `getCurrentActor`, `cookies`). Drain code must not import anything that pulls those in. Add the new netlify function files to that closure automatically (test reads the directory).

### Pattern 2: SKIP LOCKED claim
```ts
// Source: src/server/services/export-worker-service.ts claimQueued (verified read)
const rows = await tx.$queryRaw<{ id: string }[]>`
  SELECT "id" FROM "DomainEvent"
  WHERE "processedAt" IS NULL
  ORDER BY "occurredAt" ASC, "id" ASC
  FOR UPDATE SKIP LOCKED
  LIMIT ${batch}`;
```
For D-02's "per-event transaction": select ids with `FOR UPDATE SKIP LOCKED` **inside** each event's own `$transaction` (claim one, process, set processedAt, commit) — locks release at commit so overlapping runs skip in-flight rows and never double-process. Do not claim a whole batch in one long tx (holds locks, and one poison event would roll back the batch). Index `@@index([processedAt, occurredAt])` already exists [VERIFIED: schema.prisma:1086].

### Pattern 3: Idempotent enqueue (COM-02)
Create `EmailDispatch` inside the event tx; rely on `@@unique([template, correlationId])` [VERIFIED: schema.prisma:1826]. Use `createMany({ data, skipDuplicates: true })` (Prisma `ON CONFLICT DO NOTHING`) or per-row create catching `P2002` in a way that does NOT abort the Postgres tx (a failed statement aborts the whole tx in Postgres — prefer `skipDuplicates`, or pre-check with `findUnique` inside the same tx). This is Pitfall 1.

### Pattern 4: Recipient-scoped access check for notification click (D-21)
A server action `openNotification(id)`: (1) `getCurrentActor`; (2) load notification WHERE `id` AND `recipientId = actor.userId` (else same "unavailable" result); (3) call the type's access resolver which reuses the destination's own rule (learner: ownership via existing own-record services; staff: `withPermission`/`can` with the resource scope); (4) on success mark read and return `{ href }`; on any failure (missing, forbidden, deleted) mark read and return `{ unavailable: true }` — one indistinguishable outcome (identical-404 parity). Follow existing route convention in `api/certificates/[id]/.../route.ts` (empty 404 for every denial).

### Anti-Patterns to Avoid
- Sending inside the event transaction (D-02; a rollback would have already emailed).
- Putting an email address, reason, message body, filename or token in `DomainEvent.payload`, `Notification`, or `EmailDispatch` (`toEmail` is the one existing column — see Pitfall 6).
- Random correlation ids (current behaviour) — defeats COM-02.
- Client-side link-validity checks — must be server-verified.
- Keeping the direct `order-confirmation` send alongside the drain (double mail).
- Adding a catalogue permission (closed at 36).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exactly-once row creation | In-memory "seen" sets | `@@unique` + `skipDuplicates` | Only DB guarantees hold across overlapping runs |
| Concurrent claim | App-level "processing" flag | `FOR UPDATE SKIP LOCKED` | Already the repo idiom |
| Redaction of payloads | Per-call scrubbing | existing `redactForAudit` at `writeDomainEvent` sink | Already enforced [VERIFIED: domain-event-service.ts] |
| Permission + scope resolution for staff alerts | New ad-hoc queries of `Assignment` | Existing `src/server/permissions` (`hasPermission`, `loadGrants`, scope helpers) and `collection-scope.ts` | Scope rules (programme/course/cohort, windows) are subtle |
| Auth on delivery log / resend | Custom role check | `withPermission("<existing perm>", scope)` | Single choke point (RBAC-06) |
| Failure classification | String matching | extend `describeBrevoFailure` with a `classifyBrevoFailure` returning `permanent|transient` from `Brevo.BadRequestError` (permanent) vs `BrevoTimeoutError`/other `BrevoError`/network (transient) | Same SDK classes already imported |
| Audit entries | New table | `audit-service` (`actorType: "SYSTEM"` convention, `redactForAudit`) | Existing |
| Date grouping Today/Earlier | Bespoke tz math | existing `src/lib/format-timestamp.ts` / `timezone.ts` helpers | Consistent formatting |

**Key insight:** every hard part (locking, dedup, redaction, authz, audit) already has a repo primitive; the phase is composition plus mapping, not new infrastructure.

## Event Catalogue: payload facts and recipient resolution (verified reads)

Payload keys quoted from the emit sites read this session. "Resolve" = what the drain must query.

| Event | Payload keys (verbatim) | Recipient resolution | Notes |
|---|---|---|---|
| `order.paid` | `orderId, providerIntentId, amountMinor, currency` (checkout-webhook-system-service.ts:927-933) | Order -> user, cohort | Currently ALSO emails directly (:1097). Remove direct send. |
| `enrolment.activated` | `enrolmentId, cohortId, claimedSeat, actorId` (enrolment-transitions.ts:209-215) | Enrolment -> user | With `order.paid` -> ONE combined mail (D-07): pick one trigger, dedupe key on orderId/enrolmentId, not both |
| `enrolment.approved` | same shape (actorId non-null = staff) | Enrolment -> user | Staff approval; not listed in D-07 (see Open Q) |
| `enrolment.withdrawn` / `.cancelled` | `enrolmentId, cohortId, actorId, reason` (enrolment-service.ts:268-277) | Enrolment -> user | `reason` present in payload: mail/notification MUST NOT include it |
| `enrolment.transferred` | `sourceEnrolmentId, targetEnrolmentId, sourceCohortId, targetCohortId, actorId` | source enrolment -> user | |
| `cohort.cancelled` | `cohortId, actorId, reason` (cohort-service.ts:870-872) | Learners of that cohort. NOTE cancel loop already emits per-enrolment `enrolment.withdrawn/cancelled` events (via `exitEnrolment`), so a learner could get an enrolment-cancelled mail AND a cohort-cancelled mail. Decide: one mail (suppress per-enrolment mails when the same cohort has `cohort.cancelled` in the tx) | Pitfall 4. Recipients "at drain time" cannot use ACTIVE-enrolment filter here because the cancel already flipped them; resolve from enrolments whose status changed in the cancellation (join on enrolment.cohortId + status CANCELLED/WITHDRAWN + reason match is fragile). Recommended: rely on the per-enrolment events, and make `cohort.cancelled` mail carry the same correlation via cohort+user key. |
| `session.cancelled` | `sessionId, cohortId, actorId, reason` (scheduled-session-service.ts:541-548) | ACTIVE enrolments in cohort at drain time | Never include `reason`? (D-07 lists cancellation mails; keep reason out, safest) |
| `session.updated` | (no producer) | — | See Open Question 1 |
| `session.created` | `sessionId, cohortId, actorId, occurrenceIndex?` | none in scope (not in D-07) | Ignore (mark processed, no output) |
| `grade.released` (quiz) | `gradeId, assessmentId, enrolmentId, attemptId, score, maxScore, passed, ...` (attempt-service.ts:757-765) | enrolment -> user | Do NOT put score in notification if policy prefers; scores are learner's own, OK in-product, keep email to "results released" |
| `grade.released` (staff) | `gradeId, assessmentId, enrolmentId, submissionId, score, maxScore, passed, releasedBy: "STAFF"` (grading-service.ts:633-643) | same | Batch release emits one per grade: dedup per grade id is natural |
| `grade.overridden` | `gradeId, assessmentId, enrolmentId, previousScore, newScore, passedChanged` (grade-override-service.ts:87) | same | Multiple overrides of the same grade -> distinct events -> distinct mails (correlationId = event id) |
| `certificate.issued` | `certificateId, enrolmentId, scope, verificationRef` | enrolment -> user | File may not exist yet (two-phase issuance); link to authenticated page, not the PDF |
| `certificate.revoked` | `certificateId, enrolmentId, verificationRef` | same | Never reason (T-11-50) |
| `certificate.reissued` | `oldCertificateId, newCertificateId, oldVerificationRef, newVerificationRef` | resolve via certificate -> user | no enrolmentId in payload |
| `certificate.review_flagged` | (Phase 11) | staff/none | Not in D-07/D-08: ignore |
| `ticket.created` | `ticketId, reference, requesterId` | requester email (confirmation) + support-queue holders in-product (D-08) | Queue: `Ticket.queue` enum GENERAL_SUPPORT/ACCOUNTS/FINANCE/LEARNING_ASSESSMENT/TECHNICAL [VERIFIED: schema.prisma:250-256] |
| `ticket.public_reply_added` | `ticketId, reference, recipientId` | recipientId | |
| `ticket.assigned` | `ticketId, reference, assigneeId` | assigneeId (email + in-product) | |
| `ticket.escalated` | `ticketId, reference, queue` | **No target user in payload.** Resolve from Ticket.assigneeId at drain time (escalate can set `assigneeId`), else holders of `tickets.manage` for that queue | Open Q 3 |
| `ticket.resolved` / `.closed` | `ticketId, reference, requesterId` | requester | auto-close emits `.closed` with `requesterId` too |
| `ticket.reopened` | `ticketId, reference, ownerId` | **learner reopens**; `ownerId` is the ASSIGNEE (could be null). This is a staff-facing event; D-07 lists "reopened" under learner emails — mail the requester? They caused it. Recommend: notify the assignee (in-product + email? D-08 does not list it) — Open Q 4 | Payload lacks requesterId; resolve via Ticket |
| `order.exception` | `orderId, providerIntentId?, reason, from?, to?` | payments-scope holders | Emitted up to 9 places; a webhook redelivery may emit again -> different event ids -> duplicate staff mails. Dedup staff mails by (template, orderId+reason) not event id (Pitfall 3) |
| `payment.reconciliation_exception` | `paymentAttemptId, orderId, provider, ...Minor, exceptionNote?` | payments-scope holders | `exceptionNote` is staff-internal: not in mail |
| `payment.failed` / `payment.refunded` | **do not exist yet** | order -> user | D-09: add to union AND emit. `recordPaymentFailureAsSystem` (checkout-webhook-system-service.ts:1161) already runs in a `$transaction` — emit there. **`refund-service.ts` does the refund + `order.update` + audit outside a transaction (:440-470)** — emit needs a tx wrapper around order status update + event write, else the event can be lost (the exact reason for the outbox). |
| `submission.created` | `submissionId, assessmentId, enrolmentId, attemptNumber, isLate` | graders scoped to the cohort (`submissions.view`/`grades.manage` at cohort scope) | in-product only |
| `enrolment.hold_expired`, `order.created`, `attendance.changed`, `lesson.completed`, `course.completed`, `programme.completed`, `attempt.submitted`, `cohort.published` | — | none in D-07/D-08 | Drain must still mark them processed with no output (unknown-to-mapper must not stay unprocessed forever, but an unmapped type not in the union is a poison case) |

The mapper must be an exhaustive `Record<DomainEventType, Mapper>` (compile error when a new type is added) [VERIFIED: closed union in domain-event-service.ts; `tests/learning-phase-invariants.test.ts:335-375` pins the union members, so ADDING members is fine but the test will need `payment.failed`/`payment.refunded` appended if desired].

## Schema changes required (planner: one migration)

Current (verbatim, schema.prisma:1079-1088, 1813-1828):
```
model DomainEvent { id, type, payload Json, occurredAt, processedAt DateTime?  @@index([processedAt, occurredAt]) @@index([type]) }
model EmailDispatch { id, template, toEmail, userId String?, correlationId, status String @default("QUEUED"), providerMessageId?, sentAt?, failedAt?, error?, createdAt  @@unique([template, correlationId]) @@index([status, createdAt]) }
```
- `DomainEvent`: add `attempts Int @default(0)`, `lastError String?` (D-04) [+ optional `processingError`/flag to distinguish processed-with-error].
- `EmailDispatch`: add `attempts Int @default(0)`, `nextAttemptAt DateTime?`, `skipReason String?`, `category`/`kind` if needed for pref checks, `lastAttemptAt`, and resend bookkeeping (`resentCount`). `status` is a free `String` (not an enum) — values used: QUEUED/SENT/FAILED; add SKIPPED. Keep it a String (no enum migration) but centralise the constants in one module. Add index `(status, nextAttemptAt)` for Pass 2.
- `Notification`: `id, recipientId (FK User), type, targetType, targetId (ids only), safe fields (Json of ids/reference/course title? see Pitfall 6), readAt?, archivedAt?, createdAt, sourceEventId, dedupe unique (recipientId, type, sourceEventId, targetId)` + index `(recipientId, archivedAt, readAt, createdAt desc)` for cursor paging and unread count.
- Preferences: `EmailPreference` table (recommended) or `User` column.
- `toEmail` stores the address on `EmailDispatch` (existing column). D-11 says no personal addresses in outbox payloads; the dispatch row is the sanctioned place. Do not copy address into `Notification`.

Migrations use raw SQL folders under `prisma/migrations/*` plus occasional `prisma/sql/*.sql`; latest is `20260925120000_ticket_queue_changed_event` [VERIFIED: ls]. Note: enum additions and check constraints have precedent; `Notification` needs the append/no-hard-delete convention (no delete path in services).

## Common Pitfalls

### Pitfall 1: Duplicate insert aborting the Postgres transaction
**What goes wrong:** catching `P2002` from `create` inside `$transaction` and continuing fails with "current transaction is aborted". **Avoid:** `createMany skipDuplicates`, or `findUnique` first; assert with a replay integration test.

### Pitfall 2: Double confirmation mail
The `order-confirmation` direct send in `checkout-webhook-system-service.ts` (:1097-1125) exists today. Remove it (and the `dispatchEmail`/`orderEmailFacts` deps) and move the copy into the drain template; update the tests that assert it. Also the `order-payment-exception` learner mail (payment received but seat expired) has no listed D-07 equivalent: keep as a learner mail mapped from `order.exception` reason `illegal_enrolment_transition`... Note that reason is emitted as `illegal_transition`/`duplicate_active_enrolment` in the order.exception payload (:969-971) — verify exact values when mapping.

### Pitfall 3: Replayed webhooks re-emit events with new event ids
`order.exception` and similar can be emitted more than once per business incident. correlationId = event id then yields two staff mails. For staff-alert templates use a business-key correlation (`orderId:reason`) or accept and document. Learner "exactly once" events (`order.paid`) are guarded upstream by `recordWebhookEventOrSkip` [CITED: comment at checkout-webhook-system-service.ts ~1081].

### Pitfall 4: Cohort cancel fan-out overlap
`cohort.cancelled` plus N per-enrolment `enrolment.cancelled/withdrawn` events plus `session.cancelled` per session. Without a rule the learner gets 1 + 1 + K mails. Define precedence in the mapper (e.g., when an enrolment event and a cohort-cancel share the transaction/cohort within the run, send only the cohort-cancelled mail; enrolment status mail suppressed with SKIPPED reason `superseded`). Same for `session.cancelled` superseding pending `session.updated` (D-12).

### Pitfall 5: Ordering / at-least-once
`ORDER BY occurredAt` is not a total order across transactions; do not rely on it for coalescing correctness. Coalesce by reading all unprocessed `session.updated` for the same session in the run, and always render "latest details" from the DB at send time, not from the payload.

### Pitfall 6: Sensitive data leakage
Payloads carry `reason` for `enrolment.withdrawn/cancelled`, `cohort.cancelled`, `session.cancelled`, and `exceptionNote` for reconciliation. Templates and `Notification.payload` must be built from an explicit allow-list of fields, never `...payload`. Add a unit test that scans rendered HTML/text for the reason string. Provider error text stored in `EmailDispatch.error` must be the `describeBrevoFailure` classification only.

### Pitfall 7: Fail-loud sender vs current defaults
`sendTransactionalEmail` currently falls back to `"Professional Training LMS"` / `"no-reply@example.com"` [VERIFIED: brevo-client.ts]. D-14 forbids fallbacks: throw a configuration error (a permanent/non-retriable class, but do not burn attempts silently: surface as FAILED + Admin alert). Same for the public base URL: `APP_BASE_URL ?? "http://localhost:3000"` exists in `checkout-webhook-system-service.ts:99` and `SUPPORT_CONTACT_EMAIL ?? "support@example.com"` in `support-contact.ts`. Centralise base URL in one module and fail loudly outside dev/test. Check `docker-email-config.test.ts` and `.env.example`/docker-compose env so the required variables are wired (this session could not read `.env*` — blocked by a deny rule; verify names manually).

### Pitfall 8: Netlify function time/cadence
Scheduled functions are stateless with a short execution limit (commonly 30 s) [ASSUMED]; keep batches small (e.g., 25 events, 25 sends, mirroring `HOLD_SWEEP_BATCH_SIZE = 25`) and make both passes resumable. Cron granularity is 1 minute minimum [ASSUMED]. Add an on-demand invocation (exported runner + optional guarded endpoint pattern like `dispatch-export-jobs` with `EXPORT_DISPATCH_SECRET`).

### Pitfall 9: "Archive-only" for notifications vs. D-23
Add `archivedAt`; the scheduled cleanup sets it for read rows older than 90 days; list/count queries filter `archivedAt IS NULL`. Never `delete`. Unread stay.

### Pitfall 10: Access-check parity drift (D-21)
The click check duplicates authorization logic of each destination. Put each target's resolver next to (and test it against) the destination's authorization (`/orders/[reference]`, `/learn/[enrolmentId]/results`, `/learn/[enrolmentId]/sessions`, `/support/[reference]`, `/staff/support/[reference]`, `/staff/payments/[orderId]`, `/staff/reconciliation/[caseId]`, `/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]`, certificates) [VERIFIED: page.tsx listing]. Prefer routing the click through a service call that the page also uses, so the two cannot drift. Learner links must use the enrolmentId/reference the learner owns, not internal ids.

### Pitfall 11: Layout mounting
`(learner)/layout.tsx` and `account/layout.tsx` both build `<LearnerShell ... rightSlot={<LearnerAccountSlot .../>}>` — the bell must be added in both (or in a shared slot component). `LearnerShell` is a client component; pass the bell as part of `rightSlot`. `staff/layout.tsx` passes `nav/identity/signOut` into `StaffShell` (client); add a `bell` prop (server-rendered initial count) and place it in the header band. The public `(public)` layout has no actor guard — no bell there. `LearnerShell` is `"use client"`, so the unread count must be fetched in the server layout and passed down as a prop [VERIFIED: files read].

### Pitfall 12: Recipients that share a `toEmail` or unverified `pendingEmail`
Use `User.email` only when `emailVerified` is set and `status = ACTIVE` (`UserStatus` = PENDING_VERIFICATION/ACTIVE/DEACTIVATED [VERIFIED: schema.prisma:28-32]). Profile email-change mail goes to `pendingEmail` (existing behaviour) — keep that special case in the auth path.

## Code Examples

### Task factory (pattern)
```ts
// Source: src/server/scheduled/release-expired-holds-task.ts (verified)
export function createDrainDomainEventsTask(deps: {
  drain: (limits: { events: number; sends: number }) => Promise<{ processed: number; skipped: number; poisoned: number; sent: number; failed: number }>;
  log: (m: string) => void;
}) {
  return async function runDrainDomainEventsTask(): Promise<void> {
    const r = await deps.drain({ events: 25, sends: 25 });
    deps.log(`[scheduled] drained ${r.processed} events; sent ${r.sent}, failed ${r.failed}`);
  };
}
```

### Netlify wrapper
```ts
// Source: netlify/functions/dispatch-export-jobs.ts (verified)
export default createDrainDomainEventsHandler(runDrainDomainEventsTask);
export const config: Config = { schedule: "* * * * *" };
```

### Route Handler for the badge poll (Next 16)
Route Handlers are not cached by default for GET unless opted in [CITED: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md, "Caching" section]. Reading `cookies()` (via `getCurrentActor`) makes it request-time. Do NOT add `export const dynamic = 'force-static'`. Return `Response.json({ unread })` with `Cache-Control: private, no-store`; unauthenticated returns 401/empty count (no data leak). Mutations (mark read, mark all read, save preferences, open-with-access-check, resend) should be Server Actions consistent with the repo (`actions.ts` beside pages).

### Email dispatch enqueue (shape)
```ts
type Intent = {
  template: TemplateId; recipient: { userId: string; email: string };
  correlationId: string;      // `${event.id}` (+ `:${recipientUserId}` when fan-out) or stable token-issuance key
  category: "TICKET"|"RESULTS"|"SESSION"|"ENROLMENT"|"ALWAYS"|"STAFF";
  params: SafeTemplateParams; // allow-listed fields only
};
// one row per (template, correlationId); skipDuplicates
```
Since uniqueness is (template, correlationId) and the id is the event id, per-recipient fan-out from a single event needs `correlationId = ${eventId}:${userId}`; a per-recipient suffix is required or recipient 2 is rejected as a duplicate. [derived from D-05 + schema unique]

### Verification/reset stable correlation (D-10)
Correlation key = the token-issuance identity that is NOT the raw token (e.g., the issued-token row id or `sha256(tokenHash)`; never the raw token). Confirm what the token stores in `verification-service.ts`/`password-reset-service.ts` (`issueToken`) and use its row id.

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Random per-send correlation (Phase 3) | Stable correlation, DB-unique | Real dedup |
| Plain-text `textContent` only | HTML + derived text (`htmlContent` + `textContent`) | Brevo payload builder must add `htmlContent`, `replyTo` [ASSUMED field names; confirm in `@getbrevo/brevo` v6 types via `node_modules/@getbrevo/brevo` before coding] |
| Next.js `middleware` | `proxy.ts` (Next 16) | No proxy/middleware exists in this repo; do not add one for this phase [CITED: docs 16-proxy.md; VERIFIED: no src/proxy.ts or middleware.ts] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Netlify scheduled functions have ~30 s limit and 1-minute minimum cron | Pitfall 8 | Batch sizing / cadence wrong |
| A2 | `@getbrevo/brevo` v6 `sendTransacEmail` accepts `htmlContent` and `replyTo` fields | State of the Art | Template/Reply-To wiring differs; verify in package types |
| A3 | Recommended `EmailPreference` table vs JSON column | Standard Stack | Discretion item; low risk |
| A4 | Which existing permission gates the delivery log (see Open Q 5); recommended `audit.view` (view) and `audit.export`/`users.manage` for Resend — not confirmed as "global-only" in scope catalogue | Open Q | Wrong permission = wrong audience |
| A5 | Batch sizes (25) | Pitfall 8 | Throughput |

## Open Questions

1. **`session.updated` has no producer.** D-07/D-12 assume it. Options: (a) add a minimal "update session times/venue" mutation to `scheduled-session-service` emitting `session.updated` (payload: sessionId, cohortId, changed field names only) — scope creep but the roadmap criterion lists "session change"; (b) build mapper/template/coalescing and test them with synthetic events, note no live producer. Recommend (b) plus flagging to the user; escalate if the user wants (a).
2. **Combined "you're enrolled" mail trigger.** Two events (`order.paid` then `enrolment.activated`) fire on the same settlement. Recommend one template `enrolment-confirmed` triggered by `enrolment.activated` (the seat truth) with order details looked up via `enrolment.orderId`; `order.paid` maps to no mail (in-product optional). Manual/staff `enrolment.approved` (no payment): decide whether it emails (recommend yes, "enrolment approved", ALWAYS category) — user confirmation.
3. **`ticket.escalated` target.** Payload has only `queue`. Recommend resolving Ticket.assigneeId (if set) else holders of `tickets.manage` scoped to that queue at drain time; confirm.
4. **`ticket.reopened` audience.** Payload `ownerId` = assignee, learner triggers the event; D-07 lists "reopened" as a learner email. Confirm audience (requester confirmation vs assignee alert).
5. **Permission for delivery log/resend.** Existing global permissions: `audit.view`/`audit.export`, `users.view`/`users.manage`, `roles.manage`, `payments.view`, `licence.*` (global-only, unused). Suggest `audit.view` to view and `users.manage` for Resend, with a global-scope check; verify how "Global Administrators" is defined in `scope.ts`/seed roles before choosing.
6. **`enrolment.hold_expired` / payment failed learner mail**: `payment.failed` learner copy needed (D-09) — confirm it is emailed (not listed in D-07) or in-product only.
7. **Concurrency default (UI-SPEC unresolved):** while drawer open, poll updates badge only; new items prepended after next open — treat as assumption.
8. **Dark theme:** `globals.css` has no dark tokens; UI-SPEC says do not add one. Build from semantic tokens only.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | build/test | ✓ | (repo runs) | — |
| Postgres via Testcontainers (Docker) | integration tests (`*.integration.test.ts`) | Not probed this session | — | Unit tests with injected stores; integration marked Wave 0 gap if Docker missing |
| Brevo account/API key | live smoke (D-24) | Not probed; `.env*` read blocked | — | Stubbed transport (D-24) |
| Netlify runtime | scheduled fn | n/a locally | — | Invoke exported task directly |

Step skipped detail: env probing limited; no external service installs required.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.11, two projects: `node` (`tests/**/*.test.ts`) and `components` (`tests/components/**/*.test.tsx`, jsdom, setup `tests/components/setup.ts`) [VERIFIED: vitest.config.mts] |
| Config file | `vitest.config.mts` |
| Quick run command | `npx vitest run --no-file-parallelism tests/<file>.test.ts` |
| Full suite command | `npm test` (`vitest run --no-file-parallelism`) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COM-01 | Every event type maps to intent(s); exhaustive mapper over `DomainEventType` | unit | `npx vitest run tests/event-intent-mappers.test.ts` | ❌ Wave 0 |
| COM-01 | Every template renders HTML+text, no secrets/reasons, correct link and sender | unit | `npx vitest run tests/email-templates.test.ts` | ❌ Wave 0 |
| COM-01 | Combined enrolled mail sent once for order.paid+enrolment.activated; direct checkout mail removed | unit | `npx vitest run tests/checkout-webhook-system-service.test.ts tests/domain-event-drain-service.test.ts` | ✅ (existing checkout test to update) / ❌ |
| COM-02 | Replay/re-drain same event yields one EmailDispatch + one Notification per recipient | integration (testcontainers) | `npx vitest run tests/domain-event-drain.integration.test.ts` | ❌ Wave 0 |
| COM-02 | Two overlapping drain runs (SKIP LOCKED) never double-process | integration | same file | ❌ Wave 0 |
| COM-02 | Retry reuses the same row; attempts/backoff; permanent error -> FAILED immediately; 5 attempts -> FAILED | unit | `npx vitest run tests/email-dispatch-service.test.ts` | ✅ (extend) |
| COM-02 | Poison event: 3 failures -> processed-with-error + audit; queue not blocked | unit | `tests/domain-event-drain-service.test.ts` | ❌ Wave 0 |
| COM-02 | Verification/reset stable correlation; raw token never persisted | unit | `tests/verification-service.test.ts`, `tests/password-reset-service.test.ts` | ✅ (update) |
| COM-03 | List/unread/cursor paging; mark read on open; mark all read; ownership (other user's id -> unavailable) | unit/integration | `tests/notification-service.test.ts` | ❌ Wave 0 |
| COM-03 | Stale/inaccessible link -> "No longer available", identical outcome for deleted vs forbidden | unit | `tests/notification-access-service.test.ts` | ❌ Wave 0 |
| COM-03 | Bell/drawer: badge 0/1-99/99+, focus trap, Escape returns focus, empty/error/loading states, prefs panel learner-only; axe | component | `npx vitest run --project components tests/components/notification-drawer.test.tsx` | ❌ Wave 0 |
| COM-04 | Sender from single module; throws when unset; Reply-To from support contact | unit | `tests/brevo-client.test.ts` | ✅ (extend) |
| Task wiring | Netlify function/task pattern + import closure clear of request APIs | unit | `tests/netlify-drain-domain-events.test.ts`, `tests/boundary.test.ts` | ❌ / ✅ |
| D-16 | Muted category suppresses email but keeps notification; always-sent categories ignore mute | unit | `tests/event-intent-mappers.test.ts` | ❌ Wave 0 |
| D-23 | Cleanup archives read>90d, never deletes, unread untouched | unit/integration | `tests/cleanup-notifications-task.test.ts` | ❌ Wave 0 |
| D-24 | Opt-in live Brevo smoke | manual-gated | env-guarded `it.skipIf(!process.env.BREVO_LIVE)` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the single relevant test file (`npx vitest run --no-file-parallelism <file>`)
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green plus `npm run lint` and `tests/boundary.test.ts` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/event-intent-mappers.test.ts`, `tests/email-templates.test.ts`, `tests/domain-event-drain-service.test.ts`, `tests/domain-event-drain.integration.test.ts`, `tests/notification-service.test.ts`, `tests/notification-access-service.test.ts`, `tests/cleanup-notifications-task.test.ts`, `tests/netlify-drain-domain-events.test.ts`, `tests/components/notification-drawer.test.tsx`
- [ ] Shared fixtures: fake `EmailDispatchStore`, stub transport recording to `EmailDispatch`, event builders per type
- [ ] Update `tests/learning-phase-invariants.test.ts` if `payment.failed`/`payment.refunded` are pinned
- Framework install: none

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (verify/reset mails) | existing token services; raw token in memory only |
| V3 Session Management | yes | `getCurrentActor` cookie session on every notification endpoint |
| V4 Access Control | yes | `withPermission` for staff surfaces/resend; `recipientId = actor.userId` ownership for notifications; identical-404 parity |
| V5 Input Validation | yes | `zod` ^4 for action inputs (cursor, ids, prefs categories, resend reason min 10) |
| V6 Cryptography | limited | correlation key from token-row id/hash; never hand-roll |
| V7/V8 Data protection & logging | yes | allow-listed template fields; `redactForAudit`; no PII/tokens in logs |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR on notification id (read/mark others') | Info disclosure/Tampering | WHERE `recipientId = actor.userId`; indistinguishable failure |
| Existence oracle through link check | Info disclosure | single "No longer available" outcome, no 403/404 split |
| Reason/message-body leak in email/notification | Info disclosure | allow-list rendering + leak unit tests (T-11-50, Phase 12) |
| Token in outbox/dispatch/notification | Info disclosure | never persisted; stable non-token correlation key |
| Email header injection via subject/name | Tampering | strip CR/LF in user-derived strings in subject/headers; escape HTML in templates (escape every interpolation) |
| HTML injection in email body (course title/user name) | Tampering | central `escapeHtml` in template layer; do not use `sanitize-html` for whole templates |
| Duplicate/replayed sends | Repudiation/DoS | DB unique + SKIP LOCKED |
| Resend abuse | Elevation | `withPermission` + audited actor+reason; rate/limit by status (only FAILED/SENT) |
| Sender/base URL spoof via missing config | Spoofing | fail loudly, no defaults |
| Open redirect in notification link | Tampering | links are server-built from type + ids to internal paths only; return relative path, never store a URL |

## Project Constraints (from CLAUDE.md / AGENTS.md)
- **"This is NOT the Next.js you know"** — read `node_modules/next/dist/docs/` before asserting Next APIs. Consulted: Route Handlers (`01-getting-started/15-route-handlers.md`, `03-api-reference/03-file-conventions/route.md`) and Proxy (`16-proxy.md`). Middleware is renamed Proxy; the repo has none. Recommend the implementer also read `07-mutating-data.md` / `02-guides/forms.md` / `server-actions.md` and `06-fetching-data.md` before writing actions, and `02-guides/client-side-data-fetching` for the poll.
- Never auto-commit (user memory): do not commit; leave files uncommitted.
- Project conventions from prior phases: `@prisma/client` only in `src/server/services/**` and `src/server/db.ts` (ESLint-enforced, tested in `tests/boundary.test.ts`); closed 36-permission catalogue; `withPermission` choke point; no hard deletes; money in minor units; scheduled tasks call services; system actor `actorType: "SYSTEM"`.

## Sources

### Primary (HIGH confidence — files read this session)
- `.planning/phases/13-.../13-CONTEXT.md`, `13-UI-SPEC.md`
- `src/server/services/domain-event-service.ts`, `email-dispatch-service.ts`, `src/server/email/brevo-client.ts`, `src/server/support-contact.ts`
- `prisma/schema.prisma` (DomainEvent, EmailDispatch, User, Ticket, enums)
- `src/server/scheduled/release-expired-holds-task.ts`, `netlify/functions/release-expired-holds.ts`, `dispatch-export-jobs.ts`
- `src/server/services/export-worker-service.ts` (SKIP LOCKED), emit sites in checkout-webhook-system, enrolment, cohort, scheduled-session, ticket, grading, attempt, grade-override, certificate, submission, payment-reconciliation, hold-release, refund services
- `src/app/staff/layout.tsx`, `StaffShell.tsx`, `(learner)/layout.tsx`, `account/layout.tsx`, `LearnerShell.tsx`, `vitest.config.mts`, `tests/boundary.test.ts`, `tests/release-expired-holds-task.test.ts`
- Next.js docs in `node_modules/next/dist/docs/01-app/` (route handlers, proxy)

### Secondary / Tertiary
- Netlify scheduled function limits: not verified this session [ASSUMED].
- `@getbrevo/brevo` v6 request field names: not verified [ASSUMED].

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all existing.
- Architecture: HIGH — mirrors verified repo patterns.
- Event/payload gaps: HIGH — read at emit sites (some payloads truncated in grep; re-read the exact `order.exception` reason literals and remaining grade.released fields when coding).
- Pitfalls: MEDIUM-HIGH — Netlify limits and Brevo SDK fields unverified.

**Research date:** 2026-09-27
**Valid until:** ~30 days (stable), sooner if Phases 5-12 emit sites change.
