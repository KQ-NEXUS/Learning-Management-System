---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 01
subsystem: auth
tags: [brevo, prisma-migration, pre-auth-service, tracer]

requires:
  - phase: 02-roles-permissions-staff-accounts
    provides: audit-service.ts (recordAudit, redactForAudit, AUDIT_REDACTED_KEYS)
provides:
  - Additive schema fields VerificationToken.createdAt and User.pendingEmail
  - src/lib/identity.ts shared constants (TOKEN_PURPOSE, TTLs, MIN_PASSWORD_LENGTH, POLICY_TYPE, POLICY_VERSIONS)
  - src/server/auth/request-cooldown.ts pure cooldown predicate
  - src/server/email/brevo-client.ts outbound transport
  - src/server/services/email-dispatch-service.ts EmailDispatch bookkeeping
  - src/server/services/verification-service.ts (issueToken, consumeToken, verifyEmail, resendVerification)
  - src/server/services/registration-service.ts (registerLearner, brand-new-email path)
  - /register and /verify screens
affects: [03-02-PLAN, 03-03-PLAN, 03-04-PLAN, 03-05-PLAN, 03-06-PLAN]

actuals:
  tokens: 42000
  tasks: 3
  commits: 0

tech-stack:
  added: ["@getbrevo/brevo@6.0.3"]
  patterns:
    - "Pre-auth service (no withPermission) — registration-service.ts, verification-service.ts"
    - "Conditional updateMany compare-and-set inside $transaction for single-use token claim"
    - "DI-factory create*Service(deps) with narrow store types, matching staff-account-service.ts"

key-files:
  created:
    - src/lib/identity.ts
    - src/server/auth/request-cooldown.ts
    - src/server/email/brevo-client.ts
    - src/server/services/email-dispatch-service.ts
    - src/server/services/verification-service.ts
    - src/server/services/registration-service.ts
    - src/app/(auth)/register/page.tsx
    - src/app/(auth)/register/RegisterForm.tsx
    - src/app/(auth)/register/actions.ts
    - src/app/(auth)/verify/page.tsx
  modified:
    - prisma/schema.prisma
    - .env.example

key-decisions:
  - "Task 1 checkpoint: @getbrevo/brevo SUS 'too-new' verdict confirmed as a false positive by the developer (package created 2023, 20 versions, official getbrevo/brevo-node repo) — approved and installed."
  - "Migration applied manually (hand-authored SQL + prisma db execute + prisma migrate resolve --applied) instead of `prisma migrate dev`, because the shared dev database already carried an out-of-band migration from a concurrent Phase 4 session not present in this checkout's migration history. Confirmed with the developer before touching the shared database; the other session's tables/migration were never touched."
  - "describeBrevoFailure branches on Brevo.BadRequestError / BrevoTimeoutError / BrevoError — not UnauthorizedError/TooManyRequestsError as 03-RESEARCH.md guessed. Verified directly against the installed package's .d.ts/.js: sendTransacEmail's actual @throws set is BadRequestError, BrevoError, BrevoTimeoutError. BadRequestError is reachable only as Brevo.BadRequestError (namespaced), not a bare top-level export."
  - "Final Brevo/email environment variable names (D-21): BREVO_API_KEY, EMAIL_SENDER_NAME, EMAIL_SENDER_ADDRESS, APP_BASE_URL — added to .env.example by the developer directly (dotfile access denied to the executor in this sandbox)."

patterns-established:
  - "Pattern: registration/verification/reset services never import or apply withPermission — they run before a session exists."
  - "Pattern: token consumption is a single conditional updateMany (compare-and-set) inside one $transaction, never a separate read-then-write."
  - "Pattern: a shared in-memory fake store's $transaction must snapshot-and-restore on throw to correctly simulate rollback in tests — a naive `async (fn) => fn(store)` fake does not roll back array mutations."

requirements-completed: [IAM-01, IAM-02, IAM-06]

coverage:
  - id: D1
    description: "A brand-new email registers, receives one verification email via Brevo, and the emailed link activates the account — proven end to end."
    requirement: "IAM-01"
    verification:
      - kind: unit
        ref: "tests/registration-service.test.ts#end-to-end: register then verify activates the account"
        status: pass
    human_judgment: false
  - id: D2
    description: "Token consumption is atomic (conditional compare-and-set); replay after use returns not-valid; a token is expired exactly at its expires instant, not one tick after."
    requirement: "IAM-02"
    verification:
      - kind: unit
        ref: "tests/verification-service.test.ts#consumeToken"
        status: pass
    human_judgment: false
  - id: D3
    description: "Per-address cooldown blocks a second request inside 60 seconds and allows one exactly at the boundary; reissue past the cooldown invalidates the prior token."
    requirement: "IAM-06"
    verification:
      - kind: unit
        ref: "tests/request-cooldown.test.ts, tests/verification-service.test.ts#issueToken"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two additive schema columns (VerificationToken.createdAt, User.pendingEmail) exist and the live database is migrated."
    requirement: null
    verification:
      - kind: unit
        ref: "tests/schema-identity.test.ts"
        status: pass
      - kind: other
        ref: "npx prisma migrate status"
        status: pass
    human_judgment: false
  - id: D5
    description: "The register and verify pages render with the manual smoke check (requires a real BREVO_API_KEY, not run this session)."
    requirement: null
    verification: []
    human_judgment: true
    rationale: "No real Brevo credential was exercised this session — the SDK call path is unit-tested with a fake, but an actual email send/receive round trip needs human UAT."

duration: 65min
completed: 2026-09-02
status: complete
---

# Phase 3: Public Identity — Registration, Verification & Secure Sessions Summary (Plan 01)

**Registration-to-verified-account tracer: additive Prisma migration, Brevo SDK transport, pre-auth token/registration services, and the /register and /verify screens**

## Performance

- **Duration:** ~65 min
- **Tasks:** 3 (1 human checkpoint, 1 blocking schema task, 1 tracer task)
- **Files modified:** 4 modified, 14 created

## Accomplishments
- Two additive Prisma migrations applied to the shared dev database without disturbing a concurrent Phase 4 session's out-of-band schema changes
- `@getbrevo/brevo` SDK installed and wired into a minimal, Prisma-free send wrapper with verified (not guessed) error-class handling
- Full registration→verification pipeline proven end to end by one test that drives `registerLearner`, extracts the token from the captured email text, and asserts the account reaches `ACTIVE`
- `/register` and `/verify` screens match `/signin`'s exact container, typography and control classes (D-14)

## Task Commits

No commits were made — per the developer's explicit instruction for this phase ("I execute it directly myself, no subagents, no commits"), all code was written directly and verified with tests, but nothing was committed to git.

## Files Created/Modified
- `prisma/schema.prisma` — added `VerificationToken.createdAt`, `User.pendingEmail`
- `prisma/migrations/20260902190232_identity_token_created_at_and_pending_email/migration.sql` — hand-authored, applied via `prisma db execute` + `prisma migrate resolve --applied`
- `.env.example` — developer added `BREVO_API_KEY`, `EMAIL_SENDER_NAME`, `EMAIL_SENDER_ADDRESS`, `APP_BASE_URL`
- `src/lib/identity.ts` — `TOKEN_PURPOSE`, `TokenPurpose`, TTL constants, `MIN_PASSWORD_LENGTH`, `POLICY_TYPE`, `POLICY_VERSIONS`
- `src/server/auth/request-cooldown.ts` — `REQUEST_COOLDOWN_MS`, `isInCooldown`, `cooldownRemainingMs`
- `src/server/email/brevo-client.ts` — `buildTransactionalEmailPayload`, `sendTransactionalEmail`, `describeBrevoFailure`
- `src/server/services/email-dispatch-service.ts` — `createEmailDispatchService`, `emailDispatchService`
- `src/server/services/verification-service.ts` — `createVerificationService`, `verificationService`
- `src/server/services/registration-service.ts` — `createRegistrationService`, `registrationService`
- `src/app/(auth)/register/page.tsx`, `RegisterForm.tsx`, `actions.ts`
- `src/app/(auth)/verify/page.tsx`
- `tests/schema-identity.test.ts`, `tests/request-cooldown.test.ts`, `tests/brevo-client.test.ts`, `tests/verification-service.test.ts`, `tests/registration-service.test.ts`

## Exported Signatures (for plans 02–06 to call without re-reading the service)

```ts
// src/server/services/verification-service.ts
verificationService.issueToken(params: { identifier: string; purpose: TokenPurpose; ttlMs: number })
  => Promise<{ ok: true; token: string } | { ok: false; reason: "COOLDOWN" }>

verificationService.consumeToken(
  params: { token: string; purpose: TokenPurpose },
  apply: (tx: VerificationStore, row: VerificationTokenRow) => Promise<void>,
) => Promise<{ ok: true } | { ok: false }>

verificationService.verifyEmail(token: string) => Promise<{ ok: true } | { ok: false }>

verificationService.resendVerification(email: string) => Promise<{ ok: true }>
// Always resolves { ok: true } regardless of branch (non-enumerating, D-08).
// Internally issues+dispatches only when a PENDING_VERIFICATION user exists for that email.

// src/server/services/registration-service.ts
registrationService.registerLearner(input: {
  email: string; password: string; name: string; phone?: string | null;
  acceptedTerms: boolean; acceptedPrivacy: boolean;
}) => Promise<{ ok: true }>
// This tracer's registerLearner handles ONLY the brand-new-email path — no
// duplicate-email branching yet (plan 02 adds the pending/active branches
// behind this same return shape).
```

## Environment Variables Settled (D-21)

| Variable | Purpose |
|---|---|
| `BREVO_API_KEY` | Brevo API authentication |
| `EMAIL_SENDER_NAME` | D-04 placeholder sender display name |
| `EMAIL_SENDER_ADDRESS` | D-04 placeholder sender address |
| `APP_BASE_URL` | Origin verification/reset links are built against |

`.env.example` could not be read by any agent in this sandbox (dotfile access denied); the developer added these four lines directly.

## Migration

Directory: `prisma/migrations/20260902190232_identity_token_created_at_and_pending_email/`

Applied via a manual procedure, not `prisma migrate dev`, because the shared Neon dev database already carried a migration (`20260902183714_catalogue_publications_and_listing`, apparently a concurrent Phase 4 session's work) that does not exist in this checkout's local migration history. `prisma migrate dev` (with or without `--create-only`) refused and offered only `prisma migrate reset` (drops all data) — rejected. Instead: hand-authored the two-line `migration.sql`, applied it directly with `npx prisma db execute --file ... --schema prisma/schema.prisma`, then recorded it as applied with `npx prisma migrate resolve --applied <name>`. `npx prisma migrate status` now reports the database up to date, and the other session's tables/migration were never touched.

## Decisions Made

- Task 1 (blocking human checkpoint): developer confirmed the `@getbrevo/brevo` SUS "too-new" verdict is a heuristic false positive and approved the install.
- Database migration conflict (not anticipated by the plan): resolved by developer decision — apply this phase's SQL manually rather than wait for the other session or reset the shared database. See "Migration" above.
- `describeBrevoFailure`'s actual error-class branching (`Brevo.BadRequestError` / `BrevoTimeoutError` / `BrevoError`) was corrected against the installed package's real `.d.ts`/`.js` files rather than following 03-RESEARCH.md's `UnauthorizedError`/`TooManyRequestsError` guess, which does not match `sendTransacEmail`'s actual documented `@throws` set.

## Deviations from Plan

### Auto-fixed Issues

**1. Migration procedure changed due to unanticipated shared-database drift**
- **Found during:** Task 2 ([BLOCKING] schema migration)
- **Issue:** `prisma migrate dev` refused to run — the shared dev database had an out-of-band migration not in this checkout's history, and Prisma's only offered remedy was a full destructive reset.
- **Fix:** Manual SQL authorship + `prisma db execute` + `prisma migrate resolve --applied`, confirmed with the developer before touching the shared database.
- **Files modified:** `prisma/migrations/20260902190232_identity_token_created_at_and_pending_email/migration.sql`
- **Verification:** `npx prisma migrate status` reports up to date; `tests/schema-identity.test.ts` passes.

**2. `describeBrevoFailure`'s error classes corrected from research's guess**
- **Found during:** Task 3a (brevo-client.ts)
- **Issue:** 03-RESEARCH.md's code examples cited `UnauthorizedError`/`TooManyRequestsError`, which are real exports of the package but not what `sendTransacEmail` actually throws per its own `.d.ts` JSDoc.
- **Fix:** Read the installed package's actual `.d.ts` and `.js` source; branched on `Brevo.BadRequestError` (namespaced, not a bare export), `BrevoTimeoutError`, and the `BrevoError` base class instead.
- **Files modified:** `src/server/email/brevo-client.ts`, `tests/brevo-client.test.ts`
- **Verification:** `tests/brevo-client.test.ts` passes against the real installed types.

**3. Test-harness transaction rollback bug (self-caught)**
- **Found during:** Task 3g (registration-service.test.ts)
- **Issue:** The fake store's `$transaction: async (fn) => fn(store)` didn't roll back array mutations on throw, so the "zero User rows survive a PolicyAcceptance failure" test failed even though the real service code was correct.
- **Fix:** Snapshot-and-restore the fake arrays around the transaction callback.
- **Files modified:** `tests/registration-service.test.ts`
- **Verification:** Test passes; this is a test-harness fix, not a production-code change.

---

**Total deviations:** 3 (1 unanticipated infrastructure conflict, 1 research-guess correction, 1 self-caught test-harness bug). No scope creep — all three were necessary for correctness.

## Issues Encountered

Concurrent-development database drift (see Deviations #1) — flagged to the developer immediately rather than worked around silently, since it involved a shared, destructive-by-default remedy (`prisma migrate reset`).

## User Setup Required

`.env.example` needs real values for `BREVO_API_KEY`, `EMAIL_SENDER_NAME`, `EMAIL_SENDER_ADDRESS`, `APP_BASE_URL` before a real email can be sent — the developer already added the four placeholder entries. No manual smoke test with a real Brevo account was run this session (see coverage item D5).

## Next Phase Readiness

Plans 02–05 (wave 2) can now build on `verificationService.resendVerification`/`issueToken`/`consumeToken` and `registrationService`'s established shape without re-reading this plan's source. Plan 06 (wave 3) depends on this plan for the token/service layer before it fixes the `signInAction` redirect (D-15) and hardens `staff/layout.tsx` (D-18) — neither of those files were touched by this plan.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-02*
