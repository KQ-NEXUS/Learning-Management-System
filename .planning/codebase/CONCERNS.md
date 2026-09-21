# Codebase Concerns

**Analysis Date:** 2026-09-01

## Tech Debt

**Unimplemented bulk actions:**
- Issue: Course table (and likely other resource tables) have empty onClick handlers for bulk operations
- Files: `src/app/staff/courses/CoursesTable.tsx` (lines 178-179)
- Impact: Users cannot publish or archive multiple courses at once; UI promises functionality that doesn't exist
- Fix approach: Implement handlers that call corresponding service methods wrapped with authorization checks; add appropriate audit logging

**Empty placeholder directories:**
- Issue: Two critical service directories exist only as `.gitkeep` placeholders with no implementation
- Files: `src/server/audit/` (should contain audit logging utilities beyond the basic audit-service), `src/server/payments/providers/` (should contain Paystack and Stripe integrations per PRD §19)
- Impact: Payment processing and payment reconciliation logic cannot be added; audit extensibility is blocked
- Fix approach: Implement provider integrations (Paystack, Stripe) with webhook handlers; expand audit module for compliance reporting

**No custom Tailwind configuration:**
- Issue: Using default Tailwind theme without project-specific design tokens or constraints
- Files: No `tailwind.config.ts` or `tailwind.config.js` present
- Impact: Design system consistency may drift; color usage is unconstrained; accessibility defaults may not match product requirements
- Fix approach: Create `tailwind.config.ts` with brand colors, spacing, typography; document as source of truth

**No API routes:**
- Issue: All endpoints are Server Actions; no explicit route handlers exist
- Files: All endpoints in `src/app/(auth)/` and `src/app/staff/`
- Impact: Limited flexibility for non-browser clients (mobile apps, integrations); CORS headers cannot be set; webhooks must rely on form submissions or indirect patterns
- Fix approach: Add route handlers in `app/api/` for payment webhooks (`app/api/webhooks/paystack` and `app/api/webhooks/stripe`), export endpoints, and other integration points

**No error boundary pages:**
- Issue: No `error.tsx` or `not-found.tsx` pages visible in app directory
- Files: Missing at `src/app/error.tsx`, `src/app/not-found.tsx`, potentially at route segment level
- Impact: Users see default Next.js error pages in production; unhandled errors are logged only to server console
- Fix approach: Implement error boundaries and not-found pages that surface permission denials gracefully while not leaking data

## Known Bugs

**Server Action redirect behavior:**
- Symptoms: `signInAction` calls `redirect()` after setting the cookie, which throws and aborts the function, but this is actually the intended behavior
- Files: `src/app/(auth)/signin/actions.ts` (lines 40-41), `src/app/(auth)/signin/actions.ts` (line 49)
- Trigger: Successful sign-in or sign-out
- Current behavior: This is actually correct — `redirect()` is meant to throw; `useActionState` catches it and navigates. Not a bug, but the pattern is implicit and could confuse future developers
- Recommendation: Add comments clarifying that redirect() throws intentionally

## Security Considerations

**Token uniqueness and rotation:**
- Risk: Session tokens are 32 random bytes (256-bit entropy), which is cryptographically strong, but there is no token rotation on long-lived sessions or elevated operations
- Files: `src/server/services/auth-service.ts` (line 56), `src/server/auth/lockout.ts` (SESSION_TTL_DAYS = 7)
- Current mitigation: 7-day session TTL bounds exposure; tokens are database-backed so can be revoked
- Recommendations: Document the 256-bit token strength in comments; consider session rotation on privilege escalation or sensitive operations; log token creation with IP/user-agent

**Session IP binding:**
- Risk: Sessions record IP address and user-agent but do not validate them on subsequent requests
- Files: `prisma/schema.prisma` (lines 275-276 Session model), `src/server/services/session-service.ts` (no IP validation)
- Current mitigation: Audit trail records IP so post-breach analysis is possible
- Recommendations: Implement optional strict IP/user-agent validation; surface IP mismatches in audit log for anomaly detection

**Password reset not visible:**
- Risk: No password reset flow is implemented, only sign-in with stored hash
- Files: `src/server/auth/password.ts` exists but no reset endpoint/flow
- Current mitigation: Account lockout after 5 failed attempts (IAM-06) limits brute force
- Recommendations: Implement password reset using VerificationToken model (already exists in schema); add rate limiting to reset request endpoint

**Authorization checks in layouts:**
- Risk: `src/app/staff/layout.tsx` (line 32) redirects on `getCurrentActor()`, but this is a convenience guard only — the actual authorization happens in service layer
- Files: `src/app/staff/layout.tsx` (line 31-34)
- Current mitigation: Comment at line 32 notes this; every service call is wrapped with withPermission
- Recommendations: This pattern is correct but fragile — a developer might assume layout guards are sufficient and skip service-layer checks. Add lint rule or documentation enforcing that all service calls must be wrapped

**No CSRF protection visible:**
- Risk: Server Actions have some CSRF protection built into Next.js but it is not explicitly configured or tested
- Files: No middleware or explicit CSRF token handling visible
- Current mitigation: Next.js provides implicit CSRF protection for Server Actions via origin checks
- Recommendations: Document the CSRF protection strategy; test that cross-origin requests are rejected

## Performance Bottlenecks

**N+1 grant loading:**
- Problem: Every authorized request calls `loadGrantsForUser()` which loads all assignments for a user from the database
- Files: `src/server/permissions/index.ts` (binds loadGrantsForUser), `src/server/services/grant-service.ts`
- Cause: No caching layer between request and database; no batch loading
- Improvement path: Add request-scoped cache (React cache() or Next.js unstable_cache) for grant sets; batch grant loads across concurrent requests in the same render

**Audit write on every service call:**
- Problem: Every create/update/archive operation writes an audit row; under high throughput this becomes a bottleneck
- Files: `src/server/services/resource-service.ts` (lines 82-90, 103-112, 126-135), `src/server/services/audit-service.ts`
- Cause: Synchronous Prisma write on hot path; no batching
- Improvement path: Queue audit events to a write buffer flushed at request end; use database batching if audit volume becomes an issue

**Lesson progress recorded on every completion:**
- Problem: `LessonProgress` is marked idempotent (line 751 in schema) but each completion creates/updates a row
- Files: `prisma/schema.prisma` (lines 752-763)
- Cause: No apparent deduplication logic in completion flow; if a lesson is marked complete multiple times, this could flood the audit trail
- Improvement path: Verify that idempotence is enforced in the completion service; add tests confirming duplicate submissions don't create multiple progress records

## Fragile Areas

**Permission catalogue validation:**
- Files: `src/server/permissions/catalogue.ts` (PERMISSIONS list), `src/server/services/grant-service.ts` (line 39 filter)
- Why fragile: The catalogue is a closed list (RBAC-03); retired permissions are silently filtered out (defensive), but no alerting if a role still grants a retired permission
- Safe modification: When removing a permission from the catalogue, search all Role records in the database and remove it from their permission arrays before deploying code. Add a pre-deploy check.
- Test coverage: `tests/permissions.test.ts` covers the mechanics but not the migration path for deprecating permissions

**Session validity checks:**
- Files: `src/server/services/session-service.ts` (lines 27-31)
- Why fragile: Multiple sequential checks (revoked, expired, user status) — if any check is forgotten, sessions remain valid longer than intended
- Safe modification: These checks are correct but order matters (revoked before expiration to fail fast). Document the order. Add a test verifying that a revoked session is rejected before checking expiration.
- Test coverage: `tests/with-permission.test.ts` covers the authorization side but session-service tests should verify all three rejection paths

**Scoped resource access:**
- Files: `src/server/permissions/scope.ts` (grantMatches function), `src/server/services/course-service.ts` (courseScope)
- Why fragile: Each resource type (Course, Cohort, Programme) must define its own scope function; if a new resource is added and its scope resolver is forgotten, it will silently grant global access
- Safe modification: Add a test case for each new resource type verifying that a user with only Course-scoped access cannot view Programmes. Make scope resolution explicit in service creation.
- Test coverage: Tests for grantMatches exist but real-world resource retrieval (e.g., from database) is not tested end-to-end

**Resource service factory assumptions:**
- Files: `src/server/services/resource-service.ts` (entire factory), `src/server/services/course-service.ts` (usage example)
- Why fragile: The factory assumes every resource has a `status` field that can be set to "ARCHIVED" (line 123); resources without this field will fail at runtime
- Safe modification: Add a type check in the factory or document the contract explicitly (e.g., "T must have a status property"). Course, Lesson, Module, Assessment, Cohort all have status, but Enrolment, Attempt, Grade do not.
- Test coverage: `tests/resource-service.test.ts` tests the factory in isolation but not with actual Prisma models

## Scaling Limits

**Single Prisma client instance:**
- Current capacity: Shared globally; connection pool size is database-side
- Limit: If Next.js spawns multiple concurrent processes (not typical in serverless) or if deployment scales horizontally, the singleton will be inadequate
- Scaling path: The singleton pattern is correct for Next.js App Router. If moving to a traditional Node.js server or serverless with concurrent processes, use a connection pool manager (e.g., pgBouncer for PostgreSQL)

**Session storage in database:**
- Current capacity: One row per active session; cleanup is manual (expired sessions are not purged)
- Limit: Over time, expired sessions accumulate; at millions of sessions, queries on the `Session` table slow down
- Scaling path: Add a cleanup job (via Prisma or raw SQL) that deletes sessions older than SESSION_TTL_DAYS + grace period; index on `expires` exists but should be combined with `revokedAt` for cleanup queries

**In-memory role cache absent:**
- Current capacity: Every service call loads the user's role assignments from the database
- Limit: At 100+ concurrent requests, grant loading becomes a bottleneck
- Scaling path: Add a request-scoped cache using React's `cache()` or Next.js `unstable_cache()` to share grants across withPermission calls in a single request

## Dependencies at Risk

**Prisma version 6.19.3:**
- Risk: Pinned to a minor version; next major (7.x) will likely have breaking changes
- Impact: If security issues are found in 6.x, migration is required
- Migration plan: Monitor Prisma releases; when 7.x is stable, plan a test cycle to verify schema compatibility and client API changes

**Next.js 16.3.4:**
- Risk: Pre-1.0 version of Next.js (semantic versioning treats 16.x as 0.16.x); minor updates may introduce breaking changes
- Impact: Server Action behavior, middleware APIs, or page rendering could change
- Migration plan: Pin the version; stay current with Next.js release notes; test before updating to minor versions

**Custom password hashing (Node.js crypto):**
- Risk: Relying on platform crypto module (scrypt) rather than a battle-tested library like `argon2` or `bcrypt`
- Impact: If a bug is found in Node's scrypt, the codebase is vulnerable; if scrypt parameters need adjustment, they must be deployed with backward compatibility
- Migration plan: The current approach is correct (OWASP parameters are used, promisify handles async). If this becomes a concern, migrate to `argon2-cli` or `bcryptjs` but plan for hash migration

## Missing Critical Features

**Payment provider integrations:**
- Problem: Paystack and Stripe are listed in the schema (PaymentProvider enum) but no provider logic exists
- Blocks: Cannot process payments; webhooks cannot be handled; refund operations cannot be reconciled
- PRD requirement: §19 specifies two providers (Paystack, Stripe) and a manual flow; all three must be implemented before launch
- Implementation path: `src/server/payments/providers/` exists as a placeholder; add `paystack.ts` and `stripe.ts` with webhook verification and payment state machine

**Email notifications:**
- Problem: EmailDispatch table exists (lines 1236-1251 in schema) but no send logic is visible
- Blocks: Users don't receive sign-up, password reset, enrolment, or completion emails
- PRD requirement: COM-02 specifies deduplication by correlation ID; likely a queued process
- Implementation path: Add email provider in `src/server/integrations/` or similar; hook it to AuditEvent triggers (enrolment, grade release, etc.)

**Completion rule evaluation:**
- Problem: Schema has `completionRule` JSON fields (Programme, Course, Lesson) and `completionRuleVersion` but no evaluation engine
- Blocks: Cannot determine if a learner has completed a course or programme; certificates cannot be issued
- PRD requirement: LRN-07 specifies rules are versioned and evidence is recorded
- Implementation path: Add completion engine in `src/server/services/completion-engine.ts` that evaluates rules against learner progress and records CompletionRecord

**File upload and scanning:**
- Problem: LessonResource, TicketAttachment, Submission all have `scanStatus` field (malware/compliance scanning) but no scan logic
- Blocks: Cannot upload course materials, ticket attachments, or assignment submissions safely
- PRD requirement: NFR-06 specifies private storage and short-lived signed URLs; implied virus scan
- Implementation path: Hook file uploads to a virus scan queue (ClamAV, VirusTotal API); update scanStatus asynchronously

## Test Coverage Gaps

**Component integration tests:**
- What's not tested: How ResourceTable, ResourceForm, ConfirmModal integrate with server actions and error boundaries
- Files: `src/components/primitives/*.tsx` have no tests visible
- Risk: Refactoring service layer breaks UI in ways unit tests won't catch; error cases (denied, network timeout) are not exercised
- Priority: High — primitives are reused across 40+ screens

**End-to-end authorization scenarios:**
- What's not tested: A user with Programme-scoped access attempting to view a Course in a different Programme; a user with expired grant attempting an action at the boundary of expiration
- Files: `tests/with-permission.test.ts` covers the factory; `tests/permissions.test.ts` covers scope matching; no integration test loads real assignments
- Risk: Authorization bypass due to off-by-one in grant window or scope matching logic
- Priority: High — authorization is the core security boundary

**Concurrent write scenarios:**
- What's not tested: Two enrolment requests for the same (user, cohort) arriving simultaneously; auditing behavior under concurrent updates
- Files: `tests/resource-service.test.ts` is synchronous; no concurrency testing visible
- Risk: Partial unique index on Enrolment (one ACTIVE per user/cohort) could be violated; audit trail could miss a write
- Priority: Medium — this only manifests under realistic load

**Error recovery:**
- What's not tested: What happens if Prisma connection is lost mid-request; if audit write fails, does the business action roll back; if email dispatch fails, is it retried
- Files: All service files assume successful database writes
- Risk: Silent failures; data inconsistencies; lost audit trail
- Priority: Medium — needs clarification on error strategy (fail-fast vs. best-effort)

**Lockout mechanism edge cases:**
- What's not tested: A user who fails login 4 times, succeeds, then fails again (does counter reset?); a user locked out who requests password reset
- Files: `tests/lockout.test.ts` covers the basic logic; `tests/auth-service.test.ts` missing or not visible
- Risk: Lockout doesn't reset on success (counter is reset in auth-service line 62 but not tested in isolation)
- Priority: Medium — IAM-06 is a security requirement

---

*Concerns audit: 2026-09-01*
