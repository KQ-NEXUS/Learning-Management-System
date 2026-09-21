# Deferred Items — Phase 5 Plan 16 (out-of-scope discoveries)

Per the executor's SCOPE BOUNDARY rule: issues discovered during 05-16 execution that are
NOT directly caused by Phase 5's own changes are logged here, not fixed.

## 1. `tests/password-reset-service.test.ts` full-suite timing flake

- **Symptom:** `signIn — lockout counter reset … a successful sign-in resets failedLoginAttempts
  to 0 and clears lockedUntil` times out at 5000ms when run inside the full `npm test` suite (and
  even alongside just one other file, `tests/components/upload-panel.test.tsx`), but passes 10/10
  when run completely alone.
- **Scope:** Phase 3 (IAM lockout), not Phase 5. No Phase 5 plan touches
  `src/server/auth/lockout.ts` or `password-reset-service.ts`.
- **Already tracked:** `.planning/debug/password-reset-suite-timeout.md` — an open debug session
  (status: investigating) opened the same day this was first observed during 05-15's verification
  run. Not re-investigated here; out of this plan's scope per the SCOPE BOUNDARY rule.
- **Verification that it does not block Phase 5's gate:** all six required Phase-5
  integration/schema files (`seat-accounting.integration.test.ts`,
  `hold-release.integration.test.ts`, `enrolment-service.integration.test.ts`,
  `attendance-service.integration.test.ts`, `cohort-cancel.integration.test.ts`,
  `schema-cohort.test.ts`) pass cleanly together in isolation: 6 files / 63 tests, 0 failures.

## 2. `tests/components/upload-panel.test.tsx` full-suite flake

- **Symptom:** `getByText("Scanning")` not found in the full `npm test` run; passes 6/6 when
  re-run alone immediately after.
- **Scope:** Phase 4 (CAT-04 resource upload), not Phase 5. No Phase 5 plan touches this file or
  its component (`src/components/catalogue/UploadPanel.tsx` family).
- **Likely cause:** resource contention under the full suite's concurrent load (consistent with
  05-15-SUMMARY.md's note about two unrelated Testcontainers files failing under the same kind of
  contention and passing cleanly on isolated re-run).
- **Verification:** re-run in isolation immediately after the full-suite run — 6/6 passed.

Neither item is a Phase 5 regression. Both are recorded here rather than fixed, per the SCOPE
BOUNDARY rule (only issues directly caused by the current task's changes are auto-fixed).
