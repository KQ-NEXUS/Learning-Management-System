---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 09
subsystem: auth
tags: [next-server-actions, react-19, revalidatePath, gap-closure]

# Dependency graph
requires:
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: "profile-service.ts's UpdateProfileResult/EmailChangeResult shapes (03-04/03-05), the staff layout's staffness guard (03-06), src/server/auth/landing.ts (03-04)"
provides:
  - "updateProfileAction echoes the service's already-returned saved profile back in state, with a monotonic save counter ProfileForm keys its inputs on, so the account page shows the saved name/phone with no manual reload"
  - "requestEmailChangeAction and updateProfileAction both call revalidatePath(\"/account\") on their success path, matching the existing pattern in src/app/staff/roles/actions.ts"
  - "A distinct step-up-failure message naming the password and stating the email was not changed, mapped only from EMAIL_CHANGE_STEP_UP_FAILED — every other requestEmailChangeAction failure still returns the shared generic error"
  - "src/app/staff/layout.tsx's non-staff branch redirects to LEARNER_LANDING_PATH (imported from src/server/auth/landing.ts) instead of a hardcoded \"/signin\" literal; the unauthenticated branch is untouched"
  - "tests/landing.test.ts source-level assertions pinning that the staff layout imports LEARNER_LANDING_PATH and that only the non-staff branch, not the whole file, is free of a literal sign-in redirect"
affects: []

# Actuals (#2632)
actuals:
  tokens: 2778
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Echo-and-key pattern for uncontrolled forms under a Server Action: because React 19 resets an uncontrolled form after the action completes (restoring `defaultValue`), a stale-render fix here needed two halves — revalidatePath so a later render is fresh, plus the action returning the service's already-available post-write value in state, with the input `key`d off a counter derived from that state so the post-action remount lands on the new value instead of the pre-save prop."
    - "Source-level regression test for a server-component redirect target: tests/landing.test.ts reads src/app/staff/layout.tsx as text at test time (matching the existing tests/schema-identity.test.ts technique) to pin that a redirect destination is imported from a shared constant rather than hardcoded, since a server-component redirect cannot otherwise be exercised without a browser."

key-files:
  created: []
  modified:
    - src/app/account/actions.ts
    - src/app/account/ProfileForm.tsx
    - src/app/staff/layout.tsx
    - tests/landing.test.ts

key-decisions:
  - "T-03-39 (03-05-PLAN.md) is superseded by T-03-57 (this plan). The generic step-up-failure copy was a deliberate, on-the-record choice in 03-05 to avoid the email-change form becoming a password oracle. That reasoning is reversed here: an attacker holding a stolen session can already read the account's email address off the same page and test candidate passwords against it at /signin — a channel that is lockout-protected and requires no extra capability the email-change form would grant. The generic copy therefore closed no real channel while leaving the legitimate account owner with no way to tell why their own change was refused, which is exactly what UAT (G-03-6c) reported. A reader of 03-05-PLAN.md should treat its T-03-39 register row as historical, not current."
  - "The step-up failure is deliberately NOT counted against the sign-in lockout counter (T-03-58, accepted risk). That counter also gates /signin; wiring a profile-page password typo into it would let a learner lock themselves out of the entire product from a mistake on their own account page — a worse outcome than the residual guessing channel it would close."
  - "Branched on `state.savedProfile !== null` rather than a null-coalescing chain (`state.savedProfile?.phone ?? phone`) when deriving the displayed phone value. A coalescing chain would silently fall back to the stale server prop whenever a saved phone was null, which is exactly the bug class (a falsy legitimate value masked by a fallback) this plan's must_haves called out by name."
  - "setMarketingPreferenceAction was left untouched, per the plan's explicit instruction — its own existing comment already establishes it is fully state-driven with no defaultValue/uncontrolled-input staleness path, so revalidatePath there would re-render the server component for no observable effect."
  - "Used the landing module's LEARNER_LANDING_PATH constant directly in the staff layout's non-staff branch rather than the landingPathFor(actor) resolver — inside a branch that has already established the actor is not staff, the resolver would only re-derive the same constant, and naming the constant directly states the destination rather than re-deriving it."
  - "The plan's md5-fingerprint gate on ProfileForm.tsx's class attributes (rather than a git-diff gate) was written when the file was untracked; by the time this plan ran, the file (and the rest of src/app/account/) had become git-tracked via the project owner's own commit bdb7675 during plan 08's session, so a git-diff gate would no longer pass vacuously. This plan still ran the md5 gate exactly as specified — it is a valid, file-tracking-independent check on its own — and it passed (6b2b28ea5d81d9de85bc2e1741636c6a, unchanged, confirming zero class-string edits). Noting this per the plan's own instruction to say so if the gate's stated premise no longer holds, rather than silently skipping past it."

requirements-completed: [IAM-03, IAM-05, IAM-06]

coverage:
  - id: D1
    description: "After saving name or phone, /account shows the saved values immediately with no manual reload, and a saved phone of null renders as an empty field rather than the stale non-null value"
    requirement: IAM-05
    verification:
      - kind: manual_procedural
        ref: "Task 1 <human-check>(a): sign in as a Learner, change name and phone, save, confirm both fields show the new values without reload, then reload once and confirm persistence"
        status: unknown
    human_judgment: true
    rationale: "A form field's post-action DOM value cannot be proven by an automated check in this environment — the plan's own <verify> block designates this a <human-check> item, to be harvested into 03-UAT.md at end of phase."
  - id: D2
    description: "After requesting an email change, /account reflects the pending address on its next render rather than serving the pre-request cache"
    requirement: IAM-05
    verification:
      - kind: unit
        ref: "grep -c 'revalidatePath(\"/account\")' src/app/account/actions.ts == 2 (profile save and email-change request paths, not the marketing toggle)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A learner who mistypes their own current password during an email change is told the password was wrong and that the email was not changed, distinct from the shared generic error"
    requirement: IAM-05
    verification:
      - kind: manual_procedural
        ref: "Task 1 <human-check>(b): submit a wrong current password, confirm the message names the password and states the email was not changed (not the generic copy); repeat with the correct password and confirm normal confirmation + email arrival"
        status: unknown
    human_judgment: true
    rationale: "The plan's own <verify> block designates the rendered error copy a <human-check> item — no automated test exercises the server action's rendered output in this session; to be harvested into 03-UAT.md at end of phase."
  - id: D4
    description: "An authenticated non-staff actor reaching a staff route is sent to the learner landing path (/account), not to a sign-in page; an unauthenticated visitor reaching a staff route still lands on /signin"
    requirement: IAM-03
    verification:
      - kind: unit
        ref: "tests/landing.test.ts#staff layout guard resolves its non-staff destination via landing.ts (G-03-7) (3 tests: imports LEARNER_LANDING_PATH, non-staff branch has no literal sign-in path, unauthenticated branch keeps its literal sign-in redirect)"
        status: pass
      - kind: manual_procedural
        ref: "Task 2 <human-check>: as a Learner, navigate to /staff/courses and confirm landing on /account with no staff data/nav and the session still signed in; sign out and confirm /staff/courses now lands on /signin"
        status: unknown
    human_judgment: true
    rationale: "The source-level test pins the code shape (destination is not hardcoded) but cannot itself prove the browser-observed redirect outcome; the plan's <verify> block designates that a <human-check> item, to be harvested into 03-UAT.md at end of phase."

duration: 35min
completed: 2026-09-03
status: complete
---

# Phase 3 Plan 09: Close G-03-6b, G-03-6c, G-03-7 — stale profile render, silent step-up failure, wrong staff redirect Summary

**The account page now echoes and revalidates its own save results instead of requiring a manual reload, a mistyped current password during an email change now names the password instead of the shared generic error, and the staff layout's non-staff branch now redirects to the learner landing path instead of `/signin`.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 completed
- **Files modified:** 4 (`src/app/account/actions.ts`, `src/app/account/ProfileForm.tsx`, `src/app/staff/layout.tsx`, `tests/landing.test.ts`)

## Accomplishments

- **G-03-6b closed for both halves of the plan's diagnosis.** `updateProfileAction` now returns the profile `updateOwnProfile` already hands back (previously discarded) plus a monotonically increasing save counter; `requestEmailChangeAction` and `updateProfileAction` both call `revalidatePath("/account")` on success (marketing toggle deliberately untouched — it is already fully state-driven). In `ProfileForm.tsx`, the name and phone inputs derive their displayed value from the echoed profile (branching on presence, not a coalescing chain, so a saved `null` phone renders empty rather than falling back to the stale prop) and are each `key`d on the save counter so React 19's post-action uncontrolled-form reset remounts onto the freshly saved value instead of the pre-save `defaultValue`.
- **G-03-6c closed, and T-03-39 explicitly superseded.** `requestEmailChangeAction` now distinguishes `EMAIL_CHANGE_STEP_UP_FAILED` from every other failure reason, returning a message that names the password and states the email was not changed; every other failure still returns the shared generic error. The reversal of `03-05-PLAN.md`'s `T-03-39` decision is recorded both as a code comment above the new message constant and in this SUMMARY's key-decisions, per the plan's `<output>` instruction. Recorded as accepted risk `T-03-57` (the residual guessing channel is strictly worse for an attacker than the already-reachable, lockout-protected `/signin`) and `T-03-58` (deliberately not wired to the sign-in lockout counter, to avoid a learner locking themselves out of the product from their own account page).
- **G-03-7 closed.** `src/app/staff/layout.tsx`'s non-staff branch now redirects to `LEARNER_LANDING_PATH` (imported from `src/server/auth/landing.ts`) instead of the hardcoded `/signin` literal; the unauthenticated branch's `/signin` redirect is untouched, since that branch was already correct. `tests/landing.test.ts` gained a source-level assertion (matching the `tests/schema-identity.test.ts` read-the-file-at-test-time technique) pinning that the staff layout imports the landing constant and that only the non-staff branch — not the whole file — is free of a literal sign-in redirect.
- All plan-specified `<automated>` checks pass: `npx tsc --noEmit` clean, `npx eslint src tests prisma` clean, `npm run build` clean (all 17 routes compile, `/account` and every `/staff/*` route included), `npm test` **328/328 passing** (up from 325 before this plan — the 3 new source-assertion tests in `tests/landing.test.ts`), the `revalidatePath("/account")` count gate returns exactly 2, the staff-layout grep gate confirms exactly one remaining `"/signin"` literal (in the unauthenticated branch), and the `ProfileForm.tsx` class-attribute md5 fingerprint is unchanged (`6b2b28ea5d81d9de85bc2e1741636c6a`) — zero class strings edited, D-14's visual contract intact.

## Files Created/Modified

- `src/app/account/actions.ts` — `UpdateProfileState` widened with `saveCount` and `savedProfile`; `updateProfileAction` echoes the saved profile and increments the counter on success, leaves both untouched on failure; both `updateProfileAction` and `requestEmailChangeAction` call `revalidatePath("/account")` on success; `requestEmailChangeAction` maps `EMAIL_CHANGE_STEP_UP_FAILED` to a new distinct message, every other failure keeps the shared `GENERIC_ERROR`.
- `src/app/account/ProfileForm.tsx` — `UPDATE_INITIAL` widened to match; name/phone inputs now derive their displayed value from `state.savedProfile` (branch on presence) when set, else the server prop; each input `key`d on `state.saveCount`; zero class-string changes.
- `src/app/staff/layout.tsx` — imports `LEARNER_LANDING_PATH` from `@/server/auth/landing`; non-staff branch redirects there instead of `/signin`; unauthenticated branch unchanged; guard comment extended with the destination reasoning.
- `tests/landing.test.ts` — new `describe` block with 3 tests: staff layout imports `LEARNER_LANDING_PATH`, the non-staff branch line contains no literal `"/signin"` and does contain `LEARNER_LANDING_PATH`, the unauthenticated branch line still contains the literal `"/signin"`.

## Decisions Made

See `key-decisions` in frontmatter — in particular the explicit **T-03-39 superseded by T-03-57** note the plan's `<output>` section required: `03-05-PLAN.md`'s generic-copy mitigation for the email-change step-up failure no longer describes the code as of this plan; a later reader of that plan's threat register should treat that row as historical.

## Deviations from Plan

None — plan executed exactly as written, including the message copy structure (names the password, states the email was not changed) and the "no counter against lockout" constraint. One premise-check surfaced by the plan's own objective section is worth recording, not as a deviation but as the plan instructed: the md5-fingerprint gate on `ProfileForm.tsx` was written assuming the file was untracked (so a git-diff gate would pass vacuously); by execution time the file had become git-tracked via the project owner's commit `bdb7675` (made during plan 08's session, per that plan's own self-check note). The md5 gate was run exactly as specified anyway — it is valid independent of tracking status — and passed unchanged.

## Issues Encountered

None. All `<automated>` verify commands across both tasks passed on the first attempt; no auto-fix, blocker, or architectural deviation was needed.

## Human-check items harvested for end-of-phase UAT (per this plan's `<output>` instruction)

These are the exact items from the plan's `<verify>` blocks, not yet run live in this session (no dev server / browser available to this executor):

1. **Task 1(a):** Sign in as a Learner, open `/account`, change name and phone, save. Without reloading, both fields must show the new values and "Saved." must appear. Then reload once and confirm the same values persist.
2. **Task 1(b):** On the same page, submit a new email address with a deliberately wrong current password. The message must name the password and state the email was not changed — not the shared "Something went wrong" copy. Repeat with the correct password and confirm the normal confirmation panel appears and a confirmation email arrives at the new address.
3. **Task 2:** Signed in as a Learner, navigate directly to `/staff/courses`: destination must be `/account`, with no staff data or nav visible and the session still signed in. Then sign out entirely and hit `/staff/courses` again — this time it must land on `/signin`.

## Suggested commits

Per the standing no-commit override, nothing was committed. Working tree state reflects all changes described above. Suggested commit messages, in task order:

1. `fix(03-09): echo saved profile values and revalidate /account so saves render without a reload`
   - `src/app/account/actions.ts`
   - `src/app/account/ProfileForm.tsx`
   - Closes G-03-6b: `updateProfileAction` and `requestEmailChangeAction` now call `revalidatePath("/account")` on success; `updateProfileAction` echoes the service's already-returned saved profile with a save counter; `ProfileForm.tsx`'s name/phone inputs derive their value from that echo and remount via a counter-derived `key` so React 19's post-action form reset lands on the saved value, not the pre-save default.

2. `fix(03-09): name the step-up failure in the email-change form instead of the generic error`
   - `src/app/account/actions.ts`
   - Closes G-03-6c, supersedes `T-03-39` (`03-05-PLAN.md`) with `T-03-57`/`T-03-58`: a wrong current password on the email-change form now returns a message naming the password and stating the email was not changed, distinct from the shared generic error every other failure still returns. Deliberately not counted against the sign-in lockout counter.

3. `fix(03-09): send an authenticated non-staff actor to their own landing path, not to sign-in`
   - `src/app/staff/layout.tsx`
   - `tests/landing.test.ts`
   - Closes G-03-7: the staff layout's non-staff branch now redirects to `LEARNER_LANDING_PATH` (from `src/server/auth/landing.ts`) instead of a hardcoded `/signin`; the unauthenticated branch is untouched. Adds a source-level regression test pinning that the destination is not hardcoded.

## Next Phase Readiness

- All three non-blocker gaps this plan targeted (`G-03-6b`, `G-03-6c`, `G-03-7`) are closed for every `<automated>` check the plan specifies: `npm test` (328/328), `npx tsc --noEmit`, `npx eslint src tests prisma`, and `npm run build` all clean; both `<automated>` grep/md5 gates pass.
- Three `<human-check>` items remain open, exactly as the plan anticipated (a form field's post-action DOM value and a rendered redirect/error outcome both require a browser this executor session does not have) — listed above for harvesting into `03-UAT.md`.
- `T-03-39`'s register row in `03-05-PLAN.md` is now historical; any future reader of that plan should cross-reference this plan's `T-03-57`/`T-03-58` for the current behavior.
- No new dependency, schema change, or architectural surface was introduced — this was a targeted, three-defect gap-closure plan with no scope beyond what `03-UAT.md` recorded.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-03*

## Self-Check: PASSED

All files confirmed present and modified on disk: `src/app/account/actions.ts`, `src/app/account/ProfileForm.tsx`, `src/app/staff/layout.tsx`, `tests/landing.test.ts`, this SUMMARY.md. No commits were made BY THIS EXECUTION (per the standing no-commit override) — `git status --short` confirms every file this plan touched is `M` (modified, uncommitted), sitting on top of the already-uncommitted work from plans 03-07/03-08. `npm test` (328/328 passing, up from 325), `npx tsc --noEmit`, `npx eslint src tests prisma`, and `npm run build` all re-confirmed clean after both tasks. The `ProfileForm.tsx` class-attribute md5 fingerprint (`6b2b28ea5d81d9de85bc2e1741636c6a`) and the two grep-count gates (`revalidatePath("/account")` == 2, `"/signin"` in `staff/layout.tsx` == 1) all match the plan's specified values.
