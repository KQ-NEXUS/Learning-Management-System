---
phase: 03-public-identity-registration-verification-secure-sessions
plan: 07
subsystem: auth
tags: [prisma, vitest, email-change, gap-closure]

# Dependency graph
requires:
  - phase: 03-public-identity-registration-verification-secure-sessions
    provides: profile-service.ts's requestEmailChange/confirmEmailChange (03-05), verification-service.ts's consumeToken (03-02/03-03)
provides:
  - A working confirmEmailChange flow — the email-change confirmation link no longer throws PrismaClientValidationError
  - Row-level single-holder guarantee for User.pendingEmail (requestEmailChange clears the address from every other row before claiming it)
  - tests/support/prisma-contract.ts — a schema-derived findUnique-selector guard reusable by any future test fake
affects: [any future plan whose test fakes stand in for the Prisma client's findUnique]

# Actuals (#2632)
actuals:
  tokens: 4200
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Schema-derived test-fake contract: legal findUnique selectors parsed from prisma/schema.prisma at run time (tests/support/prisma-contract.ts), not hand-written, so a fake can never be more permissive than the database."
    - "Row-level single-holder invariant: before a service writes a shared, non-unique column value onto one row, it clears that value from every other row first, so a later findFirst resolves unambiguously (the row-level analogue of D-03's token-invalidation pattern)."

key-files:
  created:
    - tests/support/prisma-contract.ts
    - tests/prisma-contract.test.ts
  modified:
    - src/server/services/profile-service.ts
    - tests/profile-service.test.ts

key-decisions:
  - "Kept findFirst with no @unique and no migration on User.pendingEmail, per the plan's design_decision — a unique constraint would trade the crash for an enumeration oracle on requestEmailChange, since that path has no P2002 handling."
  - "findFirst alone is not sufficient: requestEmailChange now clears pendingEmail from every other row via updateMany before claiming it, guaranteeing at most one account holds a given pending address so findFirst resolves unambiguously."
  - "Guarded only findUnique in the test fake, not findFirst — filter queries may legitimately select on any column, only findUnique carries Prisma's uniqueness contract."

requirements-completed: [IAM-05, IAM-06]

coverage:
  - id: D1
    description: "confirmEmailChange resolves the pending account via findFirst instead of the illegal findUnique, so the email-change confirmation link completes instead of throwing PrismaClientValidationError"
    requirement: IAM-05
    verification:
      - kind: unit
        ref: "tests/profile-service.test.ts#confirmEmailChange > resolves the pending account through a legal query and completes the confirmation end to end"
        status: pass
      - kind: unit
        ref: "tests/profile-service.test.ts#confirmEmailChange > moves pendingEmail into email, nulls pendingEmail, and sets emailVerified inside the claim transaction"
        status: pass
    human_judgment: false
  - id: D2
    description: "requestEmailChange clears pendingEmail from every other row before claiming it, so exactly one account ever holds a given pending address and confirmation cannot land on the wrong account"
    requirement: IAM-06
    verification:
      - kind: unit
        ref: "tests/profile-service.test.ts#confirmEmailChange > when a second account requests the same pending address, confirming resolves to the second account, never the first"
        status: pass
    human_judgment: false
  - id: D3
    description: "tests/support/prisma-contract.ts derives legal findUnique selectors from prisma/schema.prisma at run time and exports an assertion plus a delegating wrapper that guards test fakes"
    verification:
      - kind: unit
        ref: "tests/prisma-contract.test.ts (9 tests: getModelFields, assertLegalFindUniqueSelector, guardFindUnique)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The profile-service test harness's fake findUnique is guarded by the schema-derived contract and can no longer answer the pendingEmail selector that hid G-03-6a"
    verification:
      - kind: unit
        ref: "tests/profile-service.test.ts (full file, 20 tests)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-03
status: complete
---

# Phase 3 Plan 07: Fix G-03-6a — email-change confirmation lookup Summary

**`confirmEmailChange` now issues `findFirst` instead of an illegal `findUnique` on `User.pendingEmail`, `requestEmailChange` clears that address from every other row before claiming it, and a schema-derived `findUnique` contract guard (`tests/support/prisma-contract.ts`) now stands between every test fake and the database's real rules.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3 completed
- **Files modified:** 2 (`src/server/services/profile-service.ts`, `tests/profile-service.test.ts`)
- **Files created:** 2 (`tests/support/prisma-contract.ts`, `tests/prisma-contract.test.ts`)

## Accomplishments

- Fixed the blocker: `confirmEmailChange` no longer throws `PrismaClientValidationError` on every confirmation click — the flow that was 100% broken now completes.
- Closed the ambiguity `findFirst` alone would have introduced: `requestEmailChange` clears `pendingEmail` from every other row (via a new `updateMany`) before writing its own, so at most one account ever holds a given pending address.
- Built `tests/support/prisma-contract.ts`, a schema-derived guard that parses `prisma/schema.prisma` at run time for legal single-field `findUnique` selectors (field-level `@id`/`@unique`) and throws — naming the model, offending keys, and legal selectors — when a fake is asked to answer a query the real Prisma client would refuse.
- Wired that guard into `tests/profile-service.test.ts`'s fake `user.findUnique` and deleted the `pendingEmail` branch it used to answer, so the fake can no longer hide this class of bug again.
- Added a request-then-confirm regression test and a two-requester ambiguity-resolution test to `tests/profile-service.test.ts`.
- **Negative control run and confirmed** (see below): reverting only the Task 1 one-line change made the new regression tests fail loudly — at the guard, not at an assertion — proving they are real regression tests and not vacuously green ones.

## Negative Control Result (required by `<verification>`)

Performed by hand as instructed, before finalizing:

1. Reverted only `src/server/services/profile-service.ts`'s `confirmEmailChange` lookup from `findFirst` back to `findUnique({ where: { pendingEmail: row.identifier } })` — the exact original bug.
2. Ran `npx vitest run tests/profile-service.test.ts`.
3. **Result: went red as expected — 6 of 20 tests failed**, all five `confirmEmailChange` tests (including the two new ones) plus the audit-coverage test that exercises the full mutating flow. Every failure was thrown by the guard itself:
   `Error: prisma-contract: findUnique on "User" used key(s) [pendingEmail], none of which is a legal unique selector. Legal single-field selectors for "User": [email, id].`
   — not a plain assertion failure, confirming the guard fails *before* the flow can silently succeed on a fake.
4. Restored the `findFirst` fix. Re-ran the full suite: **314/314 passing**, `tsc --noEmit` clean, `eslint` clean, `npm run build` clean.

This is exactly the check the previous regression test (which did not exist before this gap) should have had, and did not — the fake answered the illegal query, so the suite passed while the browser flow was completely broken.

## Schema Parser — Attribute Forms Handled

`tests/support/prisma-contract.ts` generalizes the technique already used in `tests/schema-identity.test.ts` (read `prisma/schema.prisma` with `readFileSync`, slice a model body from `model X {` to the first following `}`). Per-line parsing handles:

- **Field-level `@id`**: `id String @id @default(cuid())` → `id` is a legal selector (matched via exact token `@id` or `@id(`).
- **Field-level `@unique`**: `email String @unique` → legal selector (exact token `@unique` or `@unique(`).
- **No attribute at all**: `pendingEmail String?` → declared field, NOT a legal selector (this is the exact case that broke `confirmEmailChange`).
- **Block-level compound unique**: `@@unique([identifier, token])` on `VerificationToken` — the line starts with `@@` and is skipped entirely during field parsing, so `identifier` (which has no field-level `@unique`, only membership in the compound) is correctly reported as NOT a legal single-field selector, while `token` (which separately carries its own field-level `@unique`) is correctly reported as legal.
- **Other block-level attributes** (`@@index(...)`) are skipped the same way.
- **Relation fields** (e.g. `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`) are recorded as declared fields (so an undeclared-field check works against them) but never as unique selectors, since none of their tokens match `@id`/`@unique`.

Verified directly against the live schema in `tests/prisma-contract.test.ts`: `User.id` and `User.email` pass as legal selectors, `User.pendingEmail` and an invented field name both throw.

## Models the Parser Could Not Parse

None. Every model in `prisma/schema.prisma` follows the same line-oriented shape (one field per line, block attributes on their own `@@`-prefixed lines), and `getModelFields` was exercised (indirectly, by the parsing pass itself running once per test file that imports it) against `User`, and directly tested against `User`, `Session`, and `VerificationToken`'s attribute shapes by inspection during `<read_first>`. No model uses multi-line field declarations, inline block attributes on a field line, or an attribute form outside `@id`/`@unique`/`@id(...)`/`@unique(...)`/`@@...` that this parser would need to special-case. If a future model shape emerges (e.g. a composite `@id([a, b])` block-level primary key), `getModelFields` would currently report zero legal selectors for that model rather than silently mis-parsing one — `assertLegalFindUniqueSelector` would then throw on every call for that model, which is loud, not silent, and exactly the failure mode this plan exists to prevent recurring.

## Files Created/Modified

- `src/server/services/profile-service.ts` — `confirmEmailChange`'s pending-account lookup changed from `findUnique` to `findFirst`; `requestEmailChange` now clears `pendingEmail` from every other row via `updateMany` before claiming it; `ProfileStore` type gained an `updateMany` member on its `user` slice.
- `tests/support/prisma-contract.ts` (new) — `getModelFields`, `assertLegalFindUniqueSelector`, `guardFindUnique`: parses `prisma/schema.prisma` at run time for legal single-field `findUnique` selectors.
- `tests/prisma-contract.test.ts` (new) — 9 tests proving the guard against the live schema (primary key/email accepted, `pendingEmail`/undeclared field rejected, unknown model throws, wrapper delegates on legal calls and refuses illegal ones without invoking the wrapped implementation).
- `tests/profile-service.test.ts` — fake `user.findUnique` wrapped with `guardFindUnique("User", ...)`, its `pendingEmail` branch and parameter-type key deleted; fake `user.updateMany` added (unguarded — filter query); two new tests added to `confirmEmailChange` (request-then-confirm regression, two-requester ambiguity resolution).

## Decisions Made

- Followed the plan's locked `design_decision` verbatim: `findFirst`, no `@unique`, no migration on `User.pendingEmail`. Documented the rationale (enumeration-oracle risk, existing `findFirst` precedent elsewhere in the file, no-migration cost) as an in-code comment above the new `updateMany` clearing call in `profile-service.ts`, matching the plan's requirement that the alternative be recorded in writing at the call site.
- The two-requester regression test needed the fake clock (`NOW.value`, shared module state read via the harness's `now` dependency) advanced past D-05's 60s per-address issuance cooldown between the first and second request — otherwise the second requester's token would silently not issue (cooldown is keyed on the target identifier, not the requester) and the test's own `dispatched[0]` lookup would fail before reaching the behavior under test. Advanced and restored `NOW.value` inside a `try/finally` in that one test to avoid leaking mutated time into later tests in the file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test's own cooldown collision, found while writing the two-requester regression test**
- **Found during:** Task 3
- **Issue:** The new "second requester" test drove both `requestEmailChange` calls at the same fixed fake-clock instant. `issueToken`'s per-identifier+purpose cooldown (D-05, `isInCooldown`, 60s) is keyed on the *target address* (`contested@example.com`), not on which user is requesting — so the second call's token issuance was silently suppressed by cooldown, `dispatched` stayed empty, and `extractToken(dispatched[0].textContent)` threw `Cannot read properties of undefined`. This was a bug in the new test, not in production code — it does not affect any `must_haves` truth.
- **Fix:** Advanced the shared fake clock (`NOW.value`) by 61 seconds between the two `requestEmailChange` calls inside that one test, restoring the original value in a `finally` block so no other test in the file observes the mutated clock.
- **Files modified:** `tests/profile-service.test.ts`
- **Verification:** `npx vitest run tests/profile-service.test.ts` — 20/20 passing; full suite re-run afterward confirmed no other test was affected by the clock mutation.

---

**Total deviations:** 1 auto-fixed (test-authoring bug, Rule 1)
**Impact on plan:** No production-code scope change. The fix is entirely internal to the new test's own setup and does not alter what the test proves about `confirmEmailChange`/`requestEmailChange`.

## Issues Encountered

- Task 1's own `<verify>` block (run `tests/profile-service.test.ts`, expect it to pass) could not literally pass in isolation: the plan assigns the `ProfileStore.updateMany` production-code addition to Task 1's `<files>`, but the corresponding fake `user.updateMany` in the test harness is assigned to Task 3's `<files>`. Running Task 1 alone against the unmodified harness fails with `store.user.updateMany is not a function`. This is expected sequencing across the three tasks (the production code and its test double are split by design across Task 1 and Task 3), not a defect — the full suite was verified green after all three tasks completed, per the plan's overall `<verification>` block, and the negative control above confirms the guard/regression pairing works as intended.

## Suggested commits

Per the standing no-commit override, nothing was committed. Working tree state reflects all changes described above. Suggested commit messages, in task order:

1. `fix(03-07): resolve email-change confirmation via findFirst and clear pendingEmail from other rows on request`
   - `src/server/services/profile-service.ts`
   - Fixes G-03-6a: `confirmEmailChange` issued `findUnique` on the non-unique `pendingEmail` column and threw `PrismaClientValidationError` on every confirmation. Switches to `findFirst` and adds a clearing `updateMany` in `requestEmailChange` so at most one row can match.

2. `test(03-07): add schema-derived findUnique-selector contract guard for test fakes`
   - `tests/support/prisma-contract.ts`
   - `tests/prisma-contract.test.ts`
   - Parses `prisma/schema.prisma` at run time for legal single-field unique selectors; exports an assertion and a delegating wrapper so a test fake can never answer a query the real Prisma client would refuse.

3. `test(03-07): guard the profile fake findUnique and pin the G-03-6a regression`
   - `tests/profile-service.test.ts`
   - Wraps the harness's fake `user.findUnique` with the new guard, deletes the `pendingEmail` branch it used to answer, adds a fake `user.updateMany`, and adds a request-then-confirm regression test plus a two-requester ambiguity test.

## Next Phase Readiness

- G-03-6a is closed. The email-change confirmation flow works end to end against the guarded fake and is pinned by a test proven (via the negative control) to fail against the original bug.
- `tests/support/prisma-contract.ts` is now available to any future plan that writes a Prisma test fake with a `findUnique` method — wrapping it with `guardFindUnique(modelName, impl)` is the one-line addition the plan's action section describes.
- 03-UAT.md's remaining gaps beyond G-03-6a (if any) are unaffected by this plan and remain open for their own gap-closure plans.

---
*Phase: 03-public-identity-registration-verification-secure-sessions*
*Completed: 2026-09-03*

## Self-Check: PASSED

All files confirmed present on disk (`src/server/services/profile-service.ts`, `tests/profile-service.test.ts`, `tests/support/prisma-contract.ts`, `tests/prisma-contract.test.ts`, this SUMMARY.md). No commits were made (per the standing no-commit override) — `git log --oneline -3` confirms HEAD is unchanged from before this plan ran. Final `npm test` (314/314 passing), `npx tsc --noEmit`, `npx eslint src tests prisma`, and `npm run build` all re-confirmed clean after the negative control's revert-and-restore cycle.
