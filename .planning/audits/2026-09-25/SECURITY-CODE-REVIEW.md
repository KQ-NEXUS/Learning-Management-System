# Security + Correctness Audit (deep) — Professional Training LMS

**Date:** 2026-09-25
**Branch:** Khaliddev (HEAD 07c6c70)
**Mode:** read-only, deep

## Findings (appended as verified)

### F-01 [MEDIUM, CONFIRMED] Learner resource download bypasses lesson lock, access window and publication pin
- `src/server/services/lesson-resource-service.ts:374-387` (`getDownloadableResourceForLearner`) authorizes with only `hasActiveEnrolmentCoveringCourse` (`learner-access.ts:503-522`), consumed by `src/app/api/lesson-resources/[id]/download/route.ts:58`.
- The lesson page gates on `assertLessonOpenable` (sequencing lock, `accessWindow.readOnly`, pinned publication) but the download route does not. Resources are keyed to the *live* lesson row, not the pinned publication.
- Scenario: learner notes resource ids while the lesson is open; after the access window closes (or for a draft/unpublished/withdrawn lesson's resource in the same course, or a sequencing-locked lesson) `GET /api/lesson-resources/<id>/download` still 302s to a presigned URL.
- Fix: resolve the learner's `loadLearnerPath` for an enrolment covering the course and require `assertLessonOpenable(path, row.lessonId).ok` (and that the lesson is in the pinned structure) before presigning; apply the same to `listLessonResourcesForLearner`.

### F-02 [MEDIUM, CONFIRMED] Provider checkout sessions outlive the seat hold and are never cancelled -> learners can be charged for dead/duplicate orders
- `src/server/payments/providers/stripe/checkout-session.ts:27-67` sets no `expires_at` (Stripe default 24h) while the hold is `holdMinutes` (default 30). `checkout-service.ts` `initiateStripePayment`/`initiatePaystackPayment` create a NEW PaymentAttempt + provider session on every `payAction` submit without expiring the previous one; `startCheckout` supersedes an existing PENDING_PAYMENT enrolment and sets its Order `CANCELLED` without expiring its provider session; `hold-release-system-service.ts` releases seats with no provider call.
- Scenarios: (a) learner opens Stripe Checkout, returns after 40 minutes (hold released, seat possibly resold) and pays -> `activateOrderAsSystem` (`checkout-webhook-system-service.ts:864-990`) captures money and flags `EXCEPTION`; (b) two tabs / double-submit of `payAction` -> two live sessions, both payable -> second webhook hits `IllegalTransitionError` and flips an already-`PAID` order to `EXCEPTION` (line 959-963) with a captured duplicate charge; (c) new checkout for the same cohort cancels the old order while its session is still payable.
- Fix: pass `expires_at` = hold expiry (Stripe min 30 min) and/or call `checkout.sessions.expire` on supersede/hold release/new attempt; reuse the existing PROCESSING attempt's session when still valid; for Paystack, verify the reference belongs to the latest attempt and reject/auto-refund late ones.

### F-03 [MEDIUM, CONFIRMED] Reconciliation sweep can be permanently starved by 25 poison rows
- `src/server/services/payment-reconciliation-service.ts:210-218` selects `status=SUCCEEDED, reconciledAt=null` ordered by `confirmedAt asc`, `take: 25` (`reconcile-payments-task.ts` batch). A per-row failure (`:388-393`) "leaves the row completely untouched" - no attempt counter, backoff, or `lastAttemptAt`.
- Scenario: 25 attempts whose provider lookup always throws (e.g. Paystack never reports `fees_split.subaccount` - `paystack/client.ts:176-184` throws; Stripe charge with no transfer; deleted/test-mode ids) sit at the head of the queue forever; every later settlement is never reconciled and no alert is raised beyond a console.error.
- Fix: add `reconcileAttempts`/`nextReconcileAt` columns, order by `nextReconcileAt`, and escalate to a reconciliation case after N failures.

### F-04 [LOW, CONFIRMED] Prior-review status: 05 CR-01 FIXED, 05 CR-03 FIXED, 07 CR-01 FIXED, 07 WR-01 FIXED, 07 WR-02 FIXED; 05 CR-02 only PARTIALLY fixed
- 05 CR-01: `attendance-service.ts:486-497,560-575` now filter `OFF_ROSTER_STATUSES` and `cancelledAt`.
- 05 CR-03: `enrolment-service.ts:565-576` re-locks both cohorts (`lockCohortWithOffer`) and re-checks same-offer inside the tx.
- 07 CR-01/WR-01: `checkout-webhook-system-service.ts:625-627` `SELECT ... FOR UPDATE` on Order for every rail; manual idempotency handled by `existingManualAttempt` lookup under the lock (`:718-741`). 07 WR-02: `providerRef` now written (`:917`, `:953`).
- 05 CR-02 residual: `cohort-service.ts:716-752` re-reads readiness inside the tx but takes no row lock before reading, and `assignCohortInstructor`/`removeCohortInstructor` (`:613-690`) and session cancel in `scheduled-session-service.ts` never lock the Cohort row. Under READ COMMITTED an instructor removal/session cancel that commits between the in-tx re-read and the `updateMany` still yields a PUBLISHED cohort failing readiness. Fix: `lockCohort(tx, id)` first in publish, and lock the cohort row in instructor/session mutations.

### F-05 [MEDIUM, CONFIRMED] Course-scoped staff reach every course in a programme cohort (grading, submissions, grade release, overrides)
- `src/server/services/cohort-scope.ts` `cohortResourceScope` returns `courseIds = all CohortCourse ids` for a programme cohort; `grading-service.ts:305-316` (`submissionEnrolmentScope`/`gradeEnrolmentScope`) and `grade-override-service.ts:65-68` scope a submission/grade by its *enrolment's cohort*, never by the assessment's own `courseId`.
- Scenario: an instructor holding `submissions.view`/`grades.manage` at COURSE scope for course X can open `/api/submissions/<id>/download`, `getGradingDetail`, `saveDraftGrade`, `releaseGrade`, `overrideGrade` for assessments of course Y, Z in any programme cohort that also includes X (learner files, names, grades).
- Fix: for assessment-bound resources resolve scope as `{ cohortId, programmeId, courseIds: [assessment.courseId] }` (intersection), so a COURSE grant only matches when the assessment belongs to that course.

### F-06 [HIGH, CONFIRMED] Staff user list ships every staff member's password hash (and lockout/pending-email state) to the browser
- `src/server/services/staff-account-service.ts:149-157` `listInternal` = `store.user.findMany({ where: { isStaff: true } })` with no `select` (store is the raw Prisma client, `:380-386`), so every column incl. `passwordHash`, `failedLoginAttempts`, `lockedUntil`, `pendingEmail` is returned. `getInternal` (`:159-161`) likewise.
- `src/app/staff/users/page.tsx:11,24` casts the rows to `StaffUserRow` (type-only, no runtime projection) and passes `rows={users}` to `UsersTable`, a `"use client"` component (`src/app/staff/users/UsersTable.tsx:1`). React serializes the full objects into the RSC/Flight payload.
- Scenario: any account holding GLOBAL `users.view` (a read-only support/admin viewer) opens /staff/users, reads the Flight payload in devtools and obtains the scrypt hashes of every administrator for offline cracking; an XSS or a cached page anywhere in /staff has the same yield.
- Fix: add `select: { id, name, email, status, createdAt, deactivatedAt, ... }` in `listInternal`/`getInternal`/`searchInternal`, and map to an explicit DTO before crossing the client boundary. Consider a lint rule banning un-`select`ed `user.find*` in services.

### F-07 [MEDIUM, CONFIRMED] Scoped `roles.manage` holders can grant themselves (or anyone) permissions they do not hold
- `src/server/services/assignment-service.ts:126-171` (and the initial assignment in `staff-account-service.ts:168-181`) only require `roles.manage` at the target scope and reject global-only permissions (`licence.*`). There is no "delegate only what you hold" check and no self-assignment guard; `roles.manage` is not global-only (`catalogue.ts` `GLOBAL_ONLY_PERMISSIONS`).
- Scenario: a COURSE-scoped course administrator with `roles.manage` (but no finance rights) calls `createAssignmentAction` with `userId = self`, `roleId = <Finance/Admin role>`, `scopeType=COURSE`, `scopeId=<their course>` and obtains `refunds.manage`, `payments.confirm`, `certificates.issue`, `grades.manage`, `audit.view`... at that course; combined with F-05 the course grant reaches every programme cohort containing the course (issue refunds, confirm manual payments on programme orders).
- Fix: require that every permission in `role.permissions` is held by the actor at a scope that covers the target (`hasPermission(ctx.grants, p, targetScope)` for each), forbid self-assignment, or make `roles.manage` global-only.

### F-08 [MEDIUM, CONFIRMED] Assignment submission ignores `availableFrom`, lesson lock and access window; MIME type and size are learner-controlled
- `src/server/services/submission-service.ts:366-448` `beginSubmissionUpload`: authorization is only "ACTIVE enrolment covering the assessment's course" (`resolveOwnEnrolmentForCourse`, `:337`), then `status===PUBLISHED` and `availableUntil`. `availableFrom` is never checked (grep: no reference in the file), nor `assertLessonOpenable` (sequencing lock / `accessWindow.readOnly`) which the lesson page and progress writes enforce.
- `input.mimeType` is stored and signed into the PUT verbatim (`:414,424`) with no allowlist - only the filename extension is checked (`:388-392`); when `assessment.maxFileSizeBytes` is null there is no size cap at all, and the presigned PUT carries no `ContentLength` (`storage-service.ts:presignLessonUploadUrl`), so the declared size can be up to the S3 single-PUT limit.
- Scenarios: learner submits (and is graded / counted complete) before the assessment opens or after their access window closed; uploads `report.pdf` declared as `text/html` which is later served to graders with `Content-Type: text/html` (attachment disposition limits but does not remove the risk, e.g. inline previewers); multi-GB uploads to private storage.
- Fix: check `availableFrom`; load the learner path and require the assignment lesson to be openable; validate `mimeType` against an allowlist derived from `allowedFileTypes`; apply a default max size and pass `ContentLength` into the presigned PUT.

### F-09 [MEDIUM, CONFIRMED] No security headers anywhere (CSP, frame-ancestors/X-Frame-Options, HSTS, nosniff, Referrer-Policy)
- `next.config.ts` has no `headers()`; there is no `src/proxy.ts`/`middleware.ts`, no `netlify.toml`/`_headers`; grep for CSP / X-Frame-Options / frame-ancestors / HSTS in `src` returns nothing.
- Scenario: every staff page (refund, manual payment confirmation, role assignment, certificate revoke) can be framed by any site -> clickjacking of one-click staff actions; no CSP backstop if a sanitizer bypass or future `dangerouslySetInnerHTML` lands; no HSTS on a site whose session cookie `secure` flag depends only on `NODE_ENV`.
- Fix: add `headers()` in `next.config.ts` with `Content-Security-Policy` (at least `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer` on `/reset-password`, `/verify`, `/confirm-email-change` where tokens sit in the URL), `Strict-Transport-Security`.

### F-10 [LOW, CONFIRMED] docker-compose exposes Postgres and MinIO console publicly and hands MinIO root credentials to the app
- `docker-compose.yml`: `ports: "${POSTGRES_PORT:-5432}:5432"`, `"${MINIO_PORT:-9000}:9000"`, `"${MINIO_CONSOLE_PORT:-9001}:9001"` bind on all interfaces; the `app` service receives `MINIO_ROOT_USER/PASSWORD` it never needs, while `S3_ACCESS_KEY_ID/SECRET` default to `lms-minio`/`change-me-minio` - a MinIO user that `minio-init` never creates, so operators will plug the root key into `S3_*`. No `STRIPE_WEBHOOK_SECRET`, `PAYSTACK_*`, `EXPORT_DISPATCH_SECRET` wiring in the shipped stack.
- Fix: bind DB/console to `127.0.0.1` or drop the port mappings; create a least-privilege bucket user in `minio-init`; remove root creds from `app`; fail fast on missing payment secrets at boot (env schema).

### F-11 [MEDIUM, CONFIRMED] Account pre-hijacking: an unverified registration's password survives the real owner's verification
- `src/server/services/registration-service.ts:137-146`: if the email already exists as `PENDING_VERIFICATION`, the new registration only re-sends the verification email; the stored `passwordHash`/`name` from the FIRST registrant are kept. `verification-service.ts:139-155` `verifyEmail` activates that row as-is.
- Scenario: attacker registers `victim@corp.com` with password P_a. Victim later registers with P_v, receives "verify your account", clicks it -> the account becomes ACTIVE with P_a. Attacker signs in with P_a and holds a session on the victim's verified account (sees orders, enrolments, certificates, can open tickets as the victim) until the victim notices their password "doesn't work" and resets (reset revokes sessions). Sign-in "details do not match" gives the victim no hint.
- Fix: bind the credential to the verification token (store the hash/name on the token row or overwrite `passwordHash`/`name` on each pending re-registration and invalidate older tokens), or set the password during the verification step rather than at registration.

### F-12 [MEDIUM, CONFIRMED] "Reissue" silently un-revokes a revoked certificate without `certificates.revoke` and without re-checking eligibility
- `src/server/services/certificate-service.ts:642-699` `reissueCertificate` (permission `certificates.issue` only) moves a `REVOKED` row (`status in [ACTIVE, REVOKED]`, `:661-665`) plus every other REVOKED row (`:674-677`) to `SUPERSEDED`, then calls `issueCertificateForEnrolment`, which only checks certificateEnabled / existing ACTIVE / REVOKED / template (`certificate-issuance-service.ts:346-381`). Unlike `issueCertificateManually` (`:541-544`) there is no `completionRecord` check, and the enrolment that revocation reverted to ACTIVE (`:602-606`) stays ACTIVE.
- Scenario: a certificate revoked for misconduct/eligibility failure by a `certificates.revoke` holder is turned back into a valid, publicly verifiable certificate by any `certificates.issue` holder in scope (the CR-04 "a revocation must never be undone" invariant is bypassed through the one path meant for replacements), even if the learner no longer has a current completion record.
- Fix: restrict reissue of REVOKED rows to `certificates.revoke` (or require both), re-check a non-superseded `completionRecord` inside the tx, and reconcile the enrolment status.

### F-13 [LOW, CONFIRMED] Checkout admits DRAFT (unpublished) cohorts and runs a state-changing checkout on a GET page
- `checkout-service.ts` `startCheckout` gates only on `lockOpenCohort` -> `assertCohortOpen` (`seat-accounting.ts:125-129`), which treats `DRAFT` as open; there is no check that the cohort is published/listed or that a publication pin exists. `enrollAction` (`src/app/(checkout)/actions.ts`) and the GET page `src/app/(checkout)/enrol/[cohortId]/page.tsx:74` both call it with a client-supplied `cohortId`.
- Scenarios: a learner who learns a draft cohort id (staff link, screenshot, support ticket) can create a priced order, pay, and be activated into an unpublished/unpinned cohort. Separately, `GET /enrol/<id>?currency=NGN` creates an Order, takes a seat hold and cancels the learner's previous pending order for that cohort; a top-level cross-site navigation (SameSite=Lax sends the cookie) triggers it, and scripted verified accounts can hold every seat of a small cohort in rolling 30-min windows.
- Fix: require `status in (PUBLISHED, IN_PROGRESS)` plus a publication pin and enrolment window for learner checkout; move the resumption to a POST/server action (render a confirm button on the GET page).

### F-14 [LOW, CONFIRMED] Auth hardening gaps (enumeration oracle, lockout DoS, plaintext bearer tokens at rest, email-change notification)
- Enumeration: `auth-service.ts:50-56` returns `INVALID` for unknown/pending accounts *without* running scrypt, but `LOCKED` (distinct message "Too many attempts...", `signin/actions.ts:23-27`) only for real ACTIVE accounts - 5 wrong guesses reveal whether an address has an active account; the missing-account path is also measurably faster (no `verify`).
- Lockout is per-account only with no IP/global throttle: anyone can lock any known user (including every administrator) out for 15 min, indefinitely, with 5 requests per 15 min. Password reset does not clear `failedLoginAttempts/lockedUntil`.
- `Session.sessionToken` and `VerificationToken.token` (reset/verify/email-change) are stored in plaintext (`auth-service.ts:83`, `verification-service.ts:96-106`); a DB/backup read yields live sessions and reset links. Store SHA-256 of the token and look up by hash.
- Email change (`profile-service.ts:228-282`) neither notifies the old address nor revokes other sessions after confirmation.
- `(learner)/support/[reference]/actions.ts` `failure()` returns `error.message` for any `TypeError`, leaking internal runtime messages to the client.

### F-15 [LOW, CONFIRMED] Learner-asserted completion signals
- Video: `lesson-progress-service.ts:485-560` `recordWatchProgress` trusts client `secondsWatched` and `durationSeconds`; one call `{secondsWatched:1,durationSeconds:1}` yields 100% and an `AUTO_VIDEO` completion (feeds completion -> automatic certificate). No server-known duration, no elapsed-time plausibility.
- Quiz feedback: `learner-quiz-service.ts:6-8` hides per-question results only for `NEVER`; quiz grades auto-release at submit (`attempt-service.ts:~709-757`), so the default `ON_RELEASE` behaves like `IMMEDIATE` and `correctOptionIds` (`attempt-service.ts:394`) are shown after attempt 1 while further attempts remain.
- Fix: store authored video duration and cap progress rate by wall-clock since first tick; for ON_RELEASE hide `correctOptionIds` until attempts are exhausted or the window closes.

### F-16 [LOW, CONFIRMED] Webhook handler robustness
- Paystack (`src/app/api/webhooks/paystack/route.ts`): every signed event, whatever `event.event`, calls `verifyTransaction(event.data.reference)`; for events without a transaction `reference` (refund/transfer/dispute) this throws -> `markWebhookEventRetryable` -> 500 -> Paystack retries until it gives up, and those events are never processed. Gate on `event.event === "charge.success"`.
- Stripe (`src/app/api/webhooks/stripe/route.ts`): `checkout.session.completed` activates without checking `session.payment_status === "paid"`; safe today only because `payment_method_types: ["card"]`. Add the check (and handle `checkout.session.async_payment_succeeded`) before any async method is enabled.
- Both: an amount/currency mismatch or duplicate settlement flips an already-`PAID` order to `EXCEPTION` (`checkout-webhook-system-service.ts:757-763,959-963`) with no order-status guard; intended for reconciliation but it also downgrades the learner-visible order state.

### F-17 [LOW, PLAUSIBLE] Refund edge cases outside the Order lock
- `refund-service.ts:329-470`: the Order row lock covers only reservation; the final `order.update({ status: REFUNDED | PARTIALLY_REFUNDED })` runs after the provider call with the total computed from the reservation snapshot, so two concurrent partial refunds can finish in reverse order and leave a fully refunded order marked `PARTIALLY_REFUNDED`.
- "Full" refund = remaining eligible amount, but the provider call omits `amount` (`isFullRefund ? undefined`). For Paystack an omitted amount means the full transaction amount; after a previous partial refund this either errors (refund stuck FAILED) or over-refunds depending on provider behaviour. Always pass the explicit remaining amount.
- No provider idempotency key on refund calls; a retried action after a timeout can create a second provider refund while the first row sits in PROCESSING.

## Checked and found sound (no finding)
- Webhook signatures: Stripe `constructEvent` on raw body; Paystack HMAC-SHA512 with `timingSafeEqual`; dedupe via unique `(provider, providerEventId)` with retry-claim; amount+currency compared to Order under `FOR UPDATE`; Paystack amounts taken from server-side Verify, not the webhook body.
- `withPermission` resolves scope from DB rows (grading, attendance, refunds, manual payments, certificates, assignments revoke); attendance validates enrolment vs session cohort; transfers re-lock both cohorts.
- Learner IDOR: orders (`getOwnOrder*`), tickets (`findOwnByReference`, internal notes filtered), ticket attachments, certificates (`getOwnCertificateForDownload`), submissions (`loadOwnSubmission`), ticket context ids - all ownership-checked.
- Open redirect: `checkoutReturnPathFor` constructs from allowlist; no user-controlled redirect targets found.
- Rich text: `sanitize-html` allowlist on save and render; assignment instructions sanitized before `dangerouslySetInnerHTML`; embed hosts allowlisted, https-only.
- Presigned GETs force `attachment`; certificate PDFs 60s-class TTL; exports re-check grants + expiry + requester; background export function requires secret header.
- Audit sink redacts `passwordHash`/`token`/`secret` keys. CSV exports neutralize `= + - @`.
- Public verify page exposes only learner name, award title, issue date; refs are 128-bit random.

## Summary (ranked)
1. F-06 HIGH - staff password hashes serialized to the browser on /staff/users.
2. F-07 MEDIUM - scoped roles.manage can self-grant any non-licence permission.
3. F-05 MEDIUM - course-scoped grants reach all courses of a programme cohort (grading/submissions).
4. F-11 MEDIUM - account pre-hijacking via pending registration.
5. F-02 MEDIUM - provider sessions outlive holds / duplicate live sessions -> charges on dead orders.
6. F-12 MEDIUM - reissue un-revokes certificates without revoke permission/eligibility.
7. F-01 MEDIUM - resource download bypasses lock/access window/publication.
8. F-08 MEDIUM - submissions ignore availableFrom/lock/window; MIME/size learner-controlled.
9. F-09 MEDIUM - no security headers (clickjacking of staff actions).
10. F-03 MEDIUM - reconciliation head-of-line starvation.
11. LOW: F-04 (05 CR-02 residual race), F-10, F-13, F-14, F-15, F-16, F-17.
