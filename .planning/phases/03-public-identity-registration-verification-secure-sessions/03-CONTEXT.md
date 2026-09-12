# Phase 3: Public Identity — Registration, Verification & Secure Sessions - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Visitors register with email/password, accept the required policies that gate account creation, verify ownership of their email via a single-use expiring link, sign in/out, reset a forgotten password, and manage their own profile and communication preferences — all resistant to enumeration and brute-force. The underlying session/lockout/authorization mechanism (database sessions, `withPermission`, scrypt hashing) is already proven in Phase 1 on the staff sign-in path; this phase extends it to self-service public-visitor account lifecycle (registration, verification, reset, profile) rather than rebuilding it. Full policy-acceptance breadth (refund/cancellation policy, order-bound marketing consent) and the public catalogue itself belong to Phases 4 and 6, not here.

</domain>

<decisions>
## Implementation Decisions

### Verification & password-reset email delivery
- **D-01:** Brevo is the transactional email provider wired this phase — not Postmark, despite `docs/TRACK-A-TASKS.md` Day 3 naming Postmark. User confirmed Brevo after being told the `EmailDispatch` schema is provider-agnostic. Scope is a minimal send wrapper (enough to deliver a verification/reset link), not Phase 13's full templating/dedup system.
- **D-02:** Verification links expire after **24 hours**; password-reset links expire after **1 hour**. The asymmetry is deliberate — a reset link grants account access, so it gets a tighter window than an email-ownership check.
- **D-03:** Requesting a new verification/reset email while an unexpired one exists issues a fresh `VerificationToken` and invalidates the prior unconsumed one for that identifier+purpose — only the newest link works. — **Reversibility:** reversible — an application-layer rule with no schema implication (`consumedAt` already exists).
- **D-04:** Sender identity is a generic placeholder (e.g. "Professional Training LMS <no-reply@[domain-tbd]>") — the real client brand/domain isn't locked yet. Swapping it later is a config change, not a code change.
- **D-05:** A per-address cooldown (e.g. one request per 60 seconds) rate-limits verification/reset email requests server-side, before a new `VerificationToken` is created — IAM-06 explicitly calls for testable rate controls on top of the existing sign-in lockout.

### Policy acceptance scope at registration
- **D-06:** Registration captures **Terms of Service + Privacy Notice only** as `PolicyAcceptance` rows (`orderId` null) — the two that gate account creation. Refund/Cancellation policy and Marketing consent move to Phase 6 checkout, where REG-04's full order-bound acceptance criteria naturally applies. — **Reversibility:** reversible — Phase 6 adds more `PolicyAcceptance` rows at checkout; nothing about registration's rows needs to change.
- **D-07:** Policy versions are tracked as a hardcoded date-string constant per policy type in one config/constants file (e.g. `"2026-09-02"`), bumped manually when policy text changes. No CMS or policy-editing UI this phase.
- **D-08:** Registering with an email that already has a `PENDING_VERIFICATION` account resends verification (fresh token per D-03) rather than erroring or creating a duplicate row. The response is identical whether the account is new, already pending, or already active (IAM-06 non-enumeration) — only the internal behavior branches.

### Profile & communication preferences (IAM-05)
- **D-09:** A Learner can directly edit **name** and **phone** on their own profile — no re-verification needed, not identity-sensitive.
- **D-10:** Changing **email** requires re-verifying the new address via the same verification-token flow (D-01–D-03) before it takes effect, and requires re-entering the current password first (step-up confirmation, reuses `verifyPassword()`). — **Reversibility:** costly — if profile UI ships without the step-up check first, retrofitting it later means an additional confirmation step inserted into an already-shipped flow.
- **D-11:** Communication preferences are a single marketing-emails on/off toggle. Transactional emails (verification, reset, order/enrolment notices) are never optional.
- **D-12:** The marketing toggle creates/updates its own `PolicyAcceptance` row (`policyType: "marketing"`, `orderId` null) when flipped from the profile page — the same mechanism Phase 6 uses at checkout, just triggered from a different screen. One consistent source of truth for marketing consent state; no separate boolean field on `User`.
- **D-13:** Every profile field/preference change (name, phone, email, marketing toggle) is recorded as an `AuditEvent` with the learner as actor, reusing the existing audit-service.ts write path — matches the codebase's "every state change is audited" convention already established in Phase 1/2, not a learner-specific exemption.

### Public-facing page style
- **D-14:** Registration, verification, reset, and profile pages match the existing `/signin` page's style exactly — the same minimal centered Tailwind card, same typography/spacing, no marketing header/footer/hero chrome. User's stated concern from earlier in the project ("my fear is having 2 different codes and UI that dont match") directly motivates keeping every auth-adjacent screen visually identical. A distinct public marketing shell is deferred until Phase 4's public catalogue actually needs one. — **Reversibility:** reversible — a shared public layout wrapper can be introduced in Phase 4 without touching these screens' internals.

### Resolved from research (03-RESEARCH.md open questions / pitfalls, resolved 2026-09-02)
- **D-15:** A newly authenticated Learner (post sign-in or post-verification) redirects to `/account` — not `signInAction`'s current hard-coded `redirect("/staff/courses")`, which research found would misroute every first-time Learner into a staff-only route. `signInAction` must branch the redirect on `actor.isStaff`. — **Reversibility:** reversible — a single `redirect()` target, changeable when Phase 9 adds a real Learner dashboard.
- **D-16:** A successful password reset calls `signOutAllForUser` after the password update commits, matching D-34's precedent from Phase 2 (staff deactivation) — any session that predates the reset is no longer trusted.
- **D-17:** This phase writes a minimal `EmailDispatch` row per send (`status` transitions queued → sent/failed, populated `template`/`toEmail`/`correlationId`/`providerMessageId`) — observability only, not Phase 13's dedup-on-correlationId logic, which stays out of scope.
- **D-18:** `src/app/staff/layout.tsx`'s actor guard gains an `isStaff` check alongside its existing "any authenticated actor" check, as defense-in-depth against a Learner ever reaching a staff route (root cause is fixed by D-15; this is the cheap secondary hardening research flagged in Pitfall 2). — **Reversibility:** reversible — an added condition on an existing early-return guard, in Phase 1/2 code this phase's plan touches directly.
- **D-19:** Passwords require a minimum of **10 characters** at registration, reset, and any future password-set path — a NIST 800-63B-aligned length floor, enforced alongside (not replacing) `hashPassword`'s existing empty-string rejection. No complexity-class rules (uppercase/digit/symbol) — length only.
- **D-20:** `@getbrevo/brevo` (the official SDK) is confirmed for use — the automated "too-new" SUS flag is a heuristic false positive (it read the latest patch's publish date, not the package's actual 2023 origin, 20 published versions, and official `getbrevo/brevo-node` GitHub repo). Proceed with `npm install @getbrevo/brevo`.
- **D-21:** Exact Brevo environment variable names (`BREVO_API_KEY` and sender-identity config per D-04) could not be verified against `.env.example` during research or planning (dotfile access denied in both sandboxed contexts) — the executor must open `.env.example` directly at execution time, add any missing variables with placeholder values, and use whatever naming convention already exists there if one does.

### Claude's Discretion
None remaining — all four discussed gray areas (email delivery, policy scope, profile/preferences, page style) reached explicit decisions above, plus D-15 through D-21 resolved from research's open questions and pitfalls.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product authority
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` §348 (IAM-05: approved profile fields and communication preferences, SHOULD priority), §396 (REG-04: policy versions, required acceptance, optional choice, learner, order, time)
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` — registration/verification hand-off preserves cohort selection through to checkout (relevant to Phase 6, not blocking here)
- `docs/TRACK-A-TASKS.md` Day 3 ("Public catalogue, registration, sessions") — names Postmark; superseded by D-01's Brevo decision. Still authoritative for the rest of the Day-3 scope list (registration, email verification, sign-in/out/reset, non-enumerating errors, rate limiting/lockout).

### Requirements
- `.planning/REQUIREMENTS.md` — IAM-01, IAM-02, IAM-03, IAM-05, IAM-06 (full acceptance criteria); REG-04 (partially in scope here per D-06, remainder in Phase 6)
- `.planning/PROJECT.md` — Key Decisions table (no-Auth.js, Next.js 16.3.4) — background, not re-decided here

### Existing code (source of truth — Phase 1 foundation this phase extends)
- `src/server/services/auth-service.ts` — `signIn`/`signOut`/`signOutAllForUser`; registration and password-reset services sit alongside this file, following its established shape (no authorization logic of its own, database-session model)
- `src/server/auth/lockout.ts` — `MAX_FAILED_ATTEMPTS`, `LOCKOUT_MINUTES`, `SESSION_COOKIE`, `SESSION_TTL_DAYS`, `isLockedOut`/`nextFailureState` — the rate-limit pattern (D-05) should follow this pure-function, testable-without-a-database style
- `src/server/auth/password.ts` — `hashPassword`/`verifyPassword` (scrypt) — reused as-is for registration and the D-10 step-up check
- `src/server/auth/current-actor.ts` — `getCurrentActor()` reads the session cookie; unchanged by this phase
- `prisma/schema.prisma` — `User` (lines ~202-243: `status: UserStatus`, `emailVerified`, `failedLoginAttempts`/`lockedUntil`), `Session` (lines ~269-283), `VerificationToken` (lines ~286-295: `identifier`, `token`, `expires`, `purpose`, `consumedAt` — covers both verification and reset per D-02/D-03), `PolicyAcceptance` (lines ~299-312: `policyType`, `version`, `accepted`, `acceptedAt`, `orderId` nullable — grounds D-06, D-12), `EmailDispatch` (lines ~1236-1251: provider-agnostic, `template`/`toEmail`/`correlationId`/`status`/`providerMessageId` — grounds D-01)
- `src/app/(auth)/signin/page.tsx`, `SignInForm.tsx`, `actions.ts` — the exact visual and structural pattern new auth screens follow (D-14): minimal centered Tailwind card, server action per form
- `src/server/services/audit-service.ts` — the audit-first write path reused for D-13
- `.planning/codebase/CONCERNS.md` — "No password reset" and "Email notifications" gaps this phase closes; "Lockout mechanism edge cases" (counter-reset-on-success behavior) already implemented in `auth-service.ts:60-63`, worth a regression test here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hashPassword`/`verifyPassword` (`src/server/auth/password.ts`): scrypt-based, reused for registration (hash) and email-change step-up (verify).
- `isLockedOut`/`nextFailureState`/`SESSION_TTL_DAYS`/`MAX_FAILED_ATTEMPTS`/`LOCKOUT_MINUTES` (`src/server/auth/lockout.ts`): pure functions, extend with a parallel per-address cooldown check for D-05 rather than reusing the login-lockout thresholds directly (different abuse pattern).
- `signOutAllForUser` (`src/server/services/auth-service.ts`, Phase 1): called after a successful password reset commits (D-16); profile edits themselves still don't force session revocation.
- `recordAudit`/`buildAuditRow`/`redactForAudit` (`src/server/services/audit-service.ts`, extended in Phase 2): reused as-is for D-13; already redacts credential-shaped fields, relevant since profile edits touch `passwordHash`-adjacent flows.
- `VerificationToken` model: already shaped for both purposes via its `purpose` field — no migration needed to distinguish "verify" from "reset" token types. However, research found two real schema gaps requiring additive migrations before the dependent services can be written: `VerificationToken` has no `createdAt` (needed for D-05's per-address cooldown) and `User` has no `pendingEmail` (needed for D-10's email-change flow). See `03-RESEARCH.md` Pitfalls 3 & 4 for the exact field shapes.

### Established Patterns
- Deny-by-default, non-enumerating responses (IAM-06, already proven in `signIn`'s identical failure shape for missing/unverified/wrong-password) — registration, verification, and reset must follow the same "same response regardless of internal reason" shape (D-08).
- No hard deletes — this phase introduces no new deletion paths; `User.status` transitions (PENDING_VERIFICATION → ACTIVE) are the only state model needed.
- Audit-first write path — extended to self-service actions per D-13, not just staff-initiated ones.
- Service layer pattern: one file per concern in `src/server/services/`, no authorization logic embedded (delegates to `withPermission` where a session-authenticated actor is required; registration/verification themselves are pre-authentication and don't go through `withPermission`).

### Integration Points
- New registration/verification/reset routes likely sit under `src/app/(auth)/` alongside `signin/`, following its `page.tsx` + `actions.ts` + client form component shape.
- Profile page is the first *authenticated-Learner* (non-staff) page in the app — needs its own route group/layout decision at planning time (distinct from `src/app/staff/layout.tsx`'s permission-gated pattern, since a Learner has no `Assignment`-based grants to check, just "is this their own record").
- A new Brevo-sending module belongs in a location mirroring `src/server/payments/providers/`'s placeholder pattern — e.g. `src/server/email/` — kept out of `src/server/services/` proper unless it needs direct Prisma access for `EmailDispatch` bookkeeping.

</code_context>

<specifics>
## Specific Ideas

- Sender identity should be trivially swappable later — one config value, not scattered string literals (D-04).
- The marketing-preference toggle and the eventual Phase 6 checkout consent step should feel like "the same checkbox," not two unrelated features that happen to share a table (D-12).

</specifics>

<deferred>
## Deferred Ideas

- Full REG-04 scope (Refund/Cancellation policy acceptance, order-bound marketing consent) — Phase 6 checkout, per D-06.
- Distinct public-facing visual shell (header/footer/marketing chrome) — Phase 4, once the public catalogue exists to justify it, per D-14.
- Real client sender domain/brand for transactional email — whenever that's approved; D-04's placeholder is designed to make this a config swap.

### Reviewed Todos (not folded)
None — `todo.match-phase` returned zero matches for Phase 3.

</deferred>

---

*Phase: 3-Public Identity — Registration, Verification & Secure Sessions*
*Context gathered: 2026-09-02*
