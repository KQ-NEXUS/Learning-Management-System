---
phase: "3"
slug: "public-identity-registration-verification-secure-sessions"
status: complete
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-02"
reconciled: "2026-09-03"
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 |
| **Config file** | `vitest.config.mts` (`environment: "node"`, `include: ["tests/**/*.test.ts"]`, `@` alias → `./src`) |
| **Quick run command** | `npx vitest run tests/<new-file>.test.ts` |
| **Full suite command** | `npm test` (→ `vitest run`) |
| **Measured runtime** | **7.80s** (`npm test`, 29 test files / 328 tests, run 2026-09-03 during 03-10 reconciliation) — the original estimate of "~15-20 seconds (extrapolated from Phase 2's 219 tests / 19 files at ~13s)" was never re-measured until now; the real suite is well under both the estimate and the 20s Nyquist ceiling below. |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/<file>.test.ts`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~20 seconds (measured: 7.80s — compliant)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T3, 03-02-T1/T3 | 01, 02 | 1, 2 | IAM-01, IAM-06 | T-03-01, T-03-09 | Registration creates PENDING_VERIFICATION user + 2 PolicyAcceptance rows + issues one token (plan 01 tracer); duplicate ACTIVE email rejected with identical response shape (D-08), plus already-pending and lost-insert-race branches (plan 02) | unit | `npx vitest run tests/registration-service.test.ts` | ✅ `tests/registration-service.test.ts` | ✅ green |
| 03-01-T3, 03-03-T3 | 01, 03 | 1, 2 | IAM-02 | T-03-02, T-03-17, T-03-18 | Token valid once; expired/used token returns a safe non-throwing state, never a thrown error (plan 01); replay, purpose-isolation and invalidate-on-reissue regression coverage (plan 03) | unit | `npx vitest run tests/verification-service.test.ts` | ✅ `tests/verification-service.test.ts` | ✅ green |
| 03-04-T1 | 04 | 2 | IAM-03 | T-03-24, T-03-25 | Password reset: request issues 1h token (D-02); consuming it updates passwordHash and calls signOutAllForUser (D-16); regression test that successful sign-in still resets failedLoginAttempts to 0 | unit | `npx vitest run tests/password-reset-service.test.ts` | ✅ `tests/password-reset-service.test.ts` | ✅ green |
| 03-05-T1 | 05 | 2 | IAM-05 | T-03-31, T-03-32, T-03-33, T-03-38 | Own-record-only profile edit; name/phone update without re-verification (D-09); email change requires verifyPassword step-up (D-10) and does not touch User.email until token consumed; marketing toggle upserts PolicyAcceptance (D-12) | unit | `npx vitest run tests/profile-service.test.ts` | ✅ `tests/profile-service.test.ts` | ✅ green |
| 03-01-T2 | 01 | 1 | IAM-06 | T-03-04 | Per-address cooldown pure functions (mirroring lockout.test.ts's style, D-05). *(Correction: this file tests only the cooldown predicate itself — the "non-enumeration response-shape equality" half of the original description is exercised inside `registration-service.test.ts` and `password-reset-service.test.ts`, not here.)* | unit | `npx vitest run tests/request-cooldown.test.ts` | ✅ `tests/request-cooldown.test.ts` | ✅ green |
| n/a — pre-existing Phase 2 test | Phase 2 (pre-existing, not a Phase 3 task) | n/a | IAM-06 | — | Audit redaction already covers token/password fields — regression-only, re-run here to confirm Phase 3 introduced no regression | unit | `npx vitest run tests/audit-service.test.ts` (existing) | ✅ existing | ✅ green |
| 03-01-T3 | 01 | 1 | — | T-03-06 | Brevo client: request shape and typed-error propagation, mocked fetch/SDK, no real network call | unit | `npx vitest run tests/brevo-client.test.ts` | ✅ `tests/brevo-client.test.ts` | ✅ green |
| 03-01-T2 | 01 | 1 | — | — | Schema regression: `VerificationToken.createdAt` and `User.pendingEmail` exist (additive migrations, Pitfalls 3 & 4). *(Correction: this table originally named `tests/schema-auth.test.ts (extend existing)` — that file was never touched. The phase instead shipped a new, separate file, `tests/schema-identity.test.ts`, which is what actually carries these assertions.)* | unit | `npx vitest run tests/schema-identity.test.ts` | ✅ `tests/schema-identity.test.ts` (new file, not an extension of `schema-auth.test.ts`) | ✅ green |
| manual — see Manual-Only Verifications table and `03-UAT.md` tests 1-7, 31 | 01-09 (cross-cutting) | 1-6 | IAM-01, IAM-02, IAM-03, IAM-05, IAM-06 | — | Registration/verification/reset/profile/routing pages render and interact correctly (manual UI verification) | manual (UI) | UAT (`03-UAT.md`) | N/A | ⬜ pending — most flows passed live UAT (tests 1-5, 7); the account-page flow (test 6) and three gap re-verifications (G-03-3, G-03-6a/b/c, G-03-7) are not yet re-run live post-fix — see Manual-Only Verifications table below |
| 03-07-T2 | 07 | 4 | IAM-05 | T-03-48 | Schema-derived `findUnique`-selector contract guard: a test fake can no longer answer a query the real Prisma client would refuse — the exact defect class that hid G-03-6a from the original suite | unit | `npx vitest run tests/prisma-contract.test.ts` | ✅ `tests/prisma-contract.test.ts` (new, gap closure) | ✅ green |
| 03-07-T3 | 07 | 4 | IAM-05 | T-03-45, T-03-46, T-03-49 | `confirmEmailChange` resolves the pending account via `findFirst` instead of the illegal `findUnique` on the non-unique `pendingEmail` column (the confirmation link was 100% broken before this); `requestEmailChange` clears `pendingEmail` from every other row before claiming it so at most one account ever holds a given pending address (closes **G-03-6a**) | unit | `npx vitest run tests/profile-service.test.ts` (`confirmEmailChange` describe block; negative-control-verified per 03-07-SUMMARY.md) | ✅ `tests/profile-service.test.ts` (extended, gap closure) | ✅ green |
| 03-08-T1, 03-08-T3 | 08 | 5 | IAM-01, IAM-02, IAM-03, IAM-05, IAM-06 | T-03-50, T-03-51, T-03-52, T-03-54 | `dispatchBestEffort` guards all four email send call sites (registration, resend-verification, forgot-password, email-change) so a provider-send failure never escapes to a framework error page and never makes an existing account distinguishable from a non-existing one during an outage (closes **G-03-3**, the live account-enumeration oracle UAT found in `requestReset`); `dispatch` itself still writes the FAILED row and rethrows, now directly tested for the first time; `registerLearner`'s `user.created` audit write survives a send failure | unit | `npx vitest run tests/email-dispatch-service.test.ts tests/registration-service.test.ts tests/verification-service.test.ts tests/password-reset-service.test.ts tests/profile-service.test.ts` | ✅ `tests/email-dispatch-service.test.ts` (new, gap closure); rejecting-transport regressions added to the four existing service test files | ✅ green |
| 03-06-T1, 03-09-T2 | 06, 09 | 3, 6 | IAM-03 | T-03-40, T-03-59, T-03-60 | `landingPathFor` resolves correctly for `isStaff` true/false/absent (plan 06); `staff/layout.tsx`'s non-staff branch now redirects an authenticated Learner through `LEARNER_LANDING_PATH` instead of a hardcoded `"/signin"` literal, while the unauthenticated branch's literal `/signin` redirect is pinned unchanged (plan 09, closes **G-03-7**) | unit | `npx vitest run tests/landing.test.ts` | ✅ `tests/landing.test.ts` (new — plan 06; extended with 3 tests — plan 09) | ✅ green |
| 03-09-T1 | 09 | 6 | IAM-05 | T-03-61, T-03-62, T-03-57, T-03-58 | `updateProfileAction` echoes the saved profile with a save counter and, together with `requestEmailChangeAction`, calls `revalidatePath("/account")` on success, so a save renders immediately without a manual reload (closes **G-03-6b**); a wrong current password on the email-change form now returns a message naming the password and stating the email was not changed, distinct from the shared generic error (closes **G-03-6c**, supersedes `T-03-39` with `T-03-57`/`T-03-58`) | other (source-level gate) | `grep -c 'revalidatePath("/account")' src/app/account/actions.ts` (== 2); `ProfileForm.tsx` class-attribute md5 fingerprint unchanged | N/A — source-level gate, not a test file | ✅ green for the automated gate; ⬜ pending for the live re-check (see Manual-Only Verifications table) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — all Task IDs, Plans, Waves and Threat Refs above are transcribed from the phase's SUMMARY files and PLAN.md threat registers, not guessed.*

---

## Wave 0 Requirements

- [x] `tests/registration-service.test.ts` — covers IAM-01 (plan 01/02)
- [x] `tests/verification-service.test.ts` — covers IAM-02 (plan 01/03)
- [x] `tests/password-reset-service.test.ts` — covers IAM-03 (plan 04)
- [x] `tests/profile-service.test.ts` — covers IAM-05 (plan 05)
- [x] `tests/request-cooldown.test.ts` — covers IAM-06 (plan 01; lockout half already covered by pre-existing `tests/lockout.test.ts`)
- [x] `tests/brevo-client.test.ts` — mocked fetch/SDK call, asserts request shape and error propagation (plan 01)
- [x] `tests/schema-identity.test.ts` — asserts `VerificationToken.createdAt` and `User.pendingEmail` exist (plan 01). **Note:** the checklist originally called for extending `tests/schema-auth.test.ts`; the phase instead shipped this as a new, separate file. Both files exist on disk today; `schema-auth.test.ts` was never touched by Phase 3.
- [x] Framework install: none — Vitest already present and configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | UAT Result |
|----------|-------------|------------|--------------------|------------|
| Registration form submission, policy checkboxes, "check your email" response | IAM-01 | Visual/interaction confirmation — service logic is unit-proven, rendering is not | UAT — verified at `/gsd-verify-work` | ✅ Pass — `03-UAT.md` tests 2, 3 (2026-09-02/03) |
| Clicking a real verification link end-to-end (success, expired, already-used states) | IAM-02 | Requires an actual emailed link and browser navigation | UAT | ✅ Pass — `03-UAT.md` tests 3, 4 |
| Forgot-password request and reset-password form, including the forced sign-out-elsewhere behavior (D-16) | IAM-03 | Visual/interaction confirmation | UAT | ✅ Pass — `03-UAT.md` test 5 |
| Profile page: name/phone edit, email-change step-up + re-verify flow, marketing toggle | IAM-05 | Visual/interaction confirmation | UAT | ✅ Pass — re-verified live 2026-09-03 after plans 07 and 09. G-03-6a (broken email-change confirmation), G-03-6b (stale render after save) and G-03-6c (silent step-up failure) are all fixed and confirmed in a real browser; harvested into `03-UAT.md` test 6, and gaps G-03-6a/6b/6c marked `resolved`. |
| Learner sign-in redirect lands on `/account`, not `/staff/courses` (D-15) | IAM-03 | Requires a real browser navigation/redirect check | UAT | ✅ Pass for D-15 itself — `03-UAT.md` test 7 (staff → `/staff/courses`, Learner → `/account`, no staff data leaked). That same test also found **G-03-7**: a signed-in non-staff actor hitting a staff route was sent to `/signin` (reads as an unexpected sign-out) instead of their own landing path. G-03-7 is now fixed in code (plan 09, `staff/layout.tsx`) and pinned by `tests/landing.test.ts`'s 3 new source-level assertions. The live re-verification was run on 2026-09-03: a signed-in Learner hitting `/staff/courses` now lands on `/account`. Harvested into `03-UAT.md`; G-03-7 marked `resolved`. |
| Any email send when the provider rejects the send (register, resend verification, forgot password, email change) | IAM-06 | Requires a deliberately invalid `BREVO_API_KEY` and a live browser session | UAT | ⚠ Fixed, live verification DECLINED — `03-UAT.md` test 31 found this live: **G-03-3**, a blocker, and specifically an account-enumeration oracle in `requestReset` during a simulated Brevo outage. The fix is complete and unit-tested with a confirmed negative control (plan 08; suite 303→328 tests), including a rejecting-transport indistinguishability test in `tests/password-reset-service.test.ts`. The live re-test with a deliberately broken `BREVO_API_KEY` was offered to the project owner on 2026-09-03 and declined. **This is the one Phase 3 finding never observed working in a real browser.** Recorded in `03-UAT.md` as `status: fixed_not_live_verified`, `live_verification: DECLINED`. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — every automated row above names a real, passing command; the manual rows are the ones the phase's own plans deliberately designated `<human-check>`, not gaps in the automated contract.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — automated rows dominate the table; no 3-row manual gap exists.
- [x] Wave 0 covers all MISSING references — all 8 Wave 0 items above are ticked, with the one filename correction (schema-identity vs. schema-auth) noted rather than hidden.
- [x] No watch-mode flags — every command above uses `vitest run` / `npm test`, never `--watch`.
- [x] Feedback latency < 20s — measured 7.80s for the full 328-test suite (2026-09-03), well under the 20s ceiling.
- [x] `nyquist_compliant: true` set in frontmatter — set above; all five conditions above genuinely hold as of the 2026-09-03 run recorded in `03-10-SUMMARY.md`.

**Approval:** complete (2026-09-03) — for the automated validation contract described by this document. `status: complete` and `nyquist_compliant: true` describe the health of the phase's *automated* feedback loop (`npm test` 328/328, `npx tsc --noEmit` clean, `npx eslint src tests prisma` clean, `npm run build` clean, all recorded in `03-10-SUMMARY.md`), not the completeness of manual UAT. Three live re-verifications remain genuinely outstanding — G-03-3's Brevo-outage retest, G-03-6a/b/c's account-page retest, and G-03-7's staff-redirect retest — and are marked `⬜ pending` above rather than forced green. These are tracked for harvesting into `03-UAT.md` and should be closed before the phase is considered fully UAT-complete.

---

## Reconciliation Note (2026-09-03, plan 03-10)

This document sat in a not-yet-compliant draft state — status marked draft, both compliance flags marked not-yet-true, with all ten original rows marked `⬜ pending` and every Task ID/Plan/Wave/Threat Ref left as an unfilled placeholder — from the moment it was written through the end of gap-closure plans 07, 08 and 09 — even though every test file it named existed and passed throughout that entire window, and the suite had grown from the ~219 tests it was estimated against to 328 tests across 29 files. The drift was not caused by any test going red; it was caused by this document never being updated after the plans that made its claims true actually ran.

This reconciliation, performed after plans 07 (fixes `G-03-6a`), 08 (fixes `G-03-3`) and 09 (fixes `G-03-6b`, `G-03-6c`, `G-03-7`) were both executed and self-checked, replaces every unfilled placeholder with the real plan/task/threat provenance transcribed from those plans' own SUMMARY files and threat registers, corrects the two rows whose named test file was wrong (the schema row and, implicitly, the cooldown row's description), adds five rows for coverage gap closure introduced that had no row at all, and sets the frontmatter flags to match what a real `npm test` / `tsc` / `eslint` / `build` run showed on 2026-09-03 — while leaving three live human-verification items honestly marked outstanding rather than flipped green to match the rest of the document.
