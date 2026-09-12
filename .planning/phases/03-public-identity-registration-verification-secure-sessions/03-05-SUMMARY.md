---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 05
subsystem: auth
tags: [profile, ownership-authorization, step-up, consent]

requires:
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: "03-01: verificationService (issueToken/consumeToken with the EMAIL_CHANGE purpose), current-actor.ts"
provides:
  - profile-service.ts — ownership-authorized self-service profile/preference editing (no withPermission)
  - /account — the first Learner-facing authenticated route, with its own minimal shell (not staff/layout.tsx)
  - /confirm-email-change — pre-auth email-change confirmation landing under (auth)
  - VerificationStore.user gained findFirst (pendingEmail has no unique constraint)
affects: [03-06-PLAN]

actuals:
  tokens: 38000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Ownership authorization (actor.userId IS the target id) as the deliberate alternative to withPermission for the one surface in this codebase with no RBAC entry — documented in a header comment so it isn't mistaken for a missing check."
    - "A fully server-state-controlled checkbox (checked={state.accepted}, no local optimistic useState) gets revert-on-failure for free from useActionState's returned value, avoiding this project's react-hooks/set-state-in-effect rule entirely."

key-files:
  created:
    - src/server/services/profile-service.ts
    - src/app/account/layout.tsx
    - src/app/account/page.tsx
    - src/app/account/ProfileForm.tsx
    - src/app/account/actions.ts
    - src/app/(auth)/confirm-email-change/page.tsx
    - tests/profile-service.test.ts
  modified:
    - src/server/services/verification-service.ts

key-decisions:
  - "VerificationStore's user slice gained findFirst (previously only findUnique/update) because confirmEmailChange's apply callback must look up a User by pendingEmail, which carries no unique constraint by design (two accounts may legitimately share a pending address until one confirms) — findUnique cannot target a non-unique field. Additive, backward-compatible for every other consumer of this type."
  - "The marketing-preference checkbox is a fully controlled input bound directly to useActionState's returned `accepted` value, with no separate local/optimistic state. This sidesteps the project's react-hooks/set-state-in-effect ESLint rule (which forbids syncing local state to a prop/derived value inside useEffect) entirely, and gets the plan's 'revert to pre-toggle state on failure' requirement for free: a failed save's returned `accepted` IS the reverted value."
  - "confirmEmailChange re-checks for an email collision INSIDE the same claim transaction that would otherwise violate User.email's unique constraint — refusing cleanly (not-valid result) rather than letting a Prisma constraint-violation error surface as an unhandled exception."

patterns-established:
  - "Pattern: any future self-service (ownership-authorized) entry point should follow profile-service.ts's shape — Actor-only signature (never a target user id parameter), a header comment explaining why withPermission is absent, and one frozen response value collapsing every enumeration-sensitive branch."

requirements-completed: [IAM-05, IAM-06]

coverage:
  - id: D1
    description: "A Learner edits their own name and phone directly with no step-up; no entry point accepts a target user id, so authorization is a pure ownership comparison."
    requirement: "IAM-05"
    verification:
      - kind: unit
        ref: "tests/profile-service.test.ts#updateOwnProfile"
        status: pass
    human_judgment: false
  - id: D2
    description: "An email change requires the current password before anything is written; a wrong password writes nothing; the collision, same-address, and happy-path outcomes are indistinguishable."
    requirement: "IAM-05, IAM-06"
    verification:
      - kind: unit
        ref: "tests/profile-service.test.ts#requestEmailChange"
        status: pass
    human_judgment: false
  - id: D3
    description: "Confirming the email change swaps pendingEmail into email atomically; a replay changes nothing; a collision arising between request and confirmation is refused cleanly inside the transaction."
    requirement: "IAM-05"
    verification:
      - kind: unit
        ref: "tests/profile-service.test.ts#confirmEmailChange"
        status: pass
    human_judgment: false
  - id: D4
    description: "The marketing preference is a single on/off toggle backed by a PolicyAcceptance row (updated, never deleted, on opt-out); transactional email is never gated on it."
    requirement: "IAM-05"
    verification:
      - kind: unit
        ref: "tests/profile-service.test.ts#setMarketingPreference, #getOwnProfile"
        status: pass
    human_judgment: false
  - id: D5
    description: "/account renders for a signed-in Learner (redirect target for plan 06), and /confirm-email-change lives outside the account layout's session guard."
    requirement: "IAM-05"
    verification:
      - kind: other
        ref: "npx next build (/account, /confirm-email-change routes)"
        status: pass
    human_judgment: true
    rationale: "Visual rendering and the manual live-edit-and-email-change check were not run against a live browser this session."

duration: 65min
completed: 2026-09-02
status: complete
---

# Phase 3: Public Identity — Registration, Verification & Secure Sessions Summary (Plan 05)

**profile-service.ts closes IAM-05: ownership-authorized self-service editing, a step-up-gated email change with a pre-auth confirmation landing, and consent-backed marketing preferences — plus the first Learner-facing authenticated page**

## Performance

- **Duration:** ~65 min
- **Tasks:** 3
- **Files modified:** 6 created, 1 modified (`verification-service.ts`'s store type)

## Accomplishments
- `profile-service.ts` is the phase's only ownership-authorized surface — no `withPermission`, by design, documented in its header comment
- Email change is properly two-sided: a current-password step-up gate on the way in, a confirmed new address before it takes effect on the way out, with a pending-address collision re-checked inside the confirm transaction
- `/account` is now a real, working first authenticated page for Learners — the redirect target plan 06 needs
- `/confirm-email-change` lives under `(auth)`, deliberately outside the account layout's session guard, since the link is opened from the new mailbox in a possibly-sessionless browser

## Task Commits

No commits — per the developer's standing instruction, all code written and verified directly.

## Files Created/Modified
- `src/server/services/profile-service.ts` — `getOwnProfile`, `updateOwnProfile`, `requestEmailChange`, `confirmEmailChange`, `setMarketingPreference`
- `src/app/account/{layout.tsx,page.tsx,ProfileForm.tsx,actions.ts}`
- `src/app/(auth)/confirm-email-change/page.tsx`
- `src/server/services/verification-service.ts` — added `findFirst` to `VerificationStore.user`
- `tests/profile-service.test.ts` — 18 tests
- `tests/verification-service.test.ts` — added `findFirst` to its own harness's fake store to match the extended type

## `getOwnProfile` Return Shape

```ts
export type ProfileSnapshot = {
  name: string;
  phone: string | null;
  email: string;
  pendingEmail: string | null;
  marketingOptIn: boolean;
};
```

Returns `null` when no user matches the actor's id (defensive; should not occur for a session-authenticated actor).

## Audit Action Strings

- `user.profile_updated` — name/phone edits
- `user.email_change_requested` — only on the branch that actually issued a token (not on collision/same-address no-ops)
- `user.email_changed` — after a successful confirmation
- `user.marketing_preference_updated` — every toggle, on or off

## Confirmation: `/account` Renders for a Signed-In Learner

Confirmed via `npx next build` (`/account` compiles as a dynamic route) and `npx tsc --noEmit`. **Plan 06 can safely redirect a newly authenticated Learner to `/account`.**

## Decisions Made

- Extended `VerificationStore.user` with `findFirst` (see key-decisions in frontmatter) — a genuine, necessary type extension, not scope creep, since `pendingEmail`'s intentional non-uniqueness (per 03-RESEARCH.md Pitfall 4) makes `findUnique` unusable for that lookup.
- Chose a fully server-controlled checkbox over local optimistic state for the marketing toggle, both to avoid this project's `react-hooks/set-state-in-effect` rule and because it satisfies the plan's revert-on-failure requirement with no extra code.

## Deviations from Plan

### Auto-fixed Issues

**1. VerificationStore type gap for the pendingEmail lookup**
- **Found during:** Task 1 (profile-service.ts)
- **Issue:** `confirmEmailChange`'s apply callback needs `tx.user.findFirst({ where: { pendingEmail: ... } })`, but `VerificationStore.user` only declared `findUnique`/`update`. `pendingEmail` has no unique constraint, so `findUnique` would be the wrong (and, against a real Prisma client, type-invalid) choice.
- **Fix:** Added `findFirst` to `VerificationStore.user`'s type, and added a matching mock to `tests/verification-service.test.ts`'s own harness (the only place with an explicit, non-cast type annotation that would otherwise fail to compile).
- **Files modified:** `src/server/services/verification-service.ts`, `tests/verification-service.test.ts`
- **Verification:** `npx tsc --noEmit` clean; all existing verification-service tests still pass.

---

**Total deviations:** 1 (a necessary type extension surfaced by writing real code against the existing type, not scope creep).

## Issues Encountered

None beyond the type-gap above.

## User Setup Required

None.

## Next Phase Readiness

Plan 06 depends on `/account` existing as the redirect target for `signInAction`'s fix (D-15) and on nothing else new from this plan.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-02*
