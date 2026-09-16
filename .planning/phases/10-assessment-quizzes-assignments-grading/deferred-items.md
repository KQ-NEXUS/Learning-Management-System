# Deferred Items — Phase 10

Out-of-scope discoveries found during plan execution, logged rather than fixed
per the executor's scope boundary (only issues directly caused by the current
task's changes are auto-fixed).

## 10-02: pre-existing `npx tsc --noEmit` failure in `src/app/layout.tsx`

- **Found during:** Plan 10-02, Task 1 verification (`npx tsc --noEmit`)
- **Error:** `src/app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.`
- **Scope:** `src/app/layout.tsx` was not touched by 10-02 (`git diff HEAD -- src/app/layout.tsx`
  shows no uncommitted changes, and the file's last commit predates this plan). `LayoutProps`
  appears to be a Next.js 16 App Router generated global type (produced by `next dev`/`next build`
  type generation into `.next/types/`) that is not present/stale in this sandbox — unrelated to
  `quiz-scoring.ts`'s pure-module scoring logic.
- **Action:** Not fixed — out of scope for this plan. `src/server/services/quiz-scoring.ts` and
  `tests/quiz-scoring.test.ts` were confirmed independently error-free (isolated `vitest run`
  passes 31/31; `eslint` on `quiz-scoring.ts` reports zero errors). This project-wide `tsc --noEmit`
  gate should be re-run once `.next/types` is regenerated (e.g. by `next dev` or `next build`) in an
  environment where that step is available.

## 10-05: `tests/checkout-webhook.integration.test.ts` — 3 failures under concurrent-agent DB contention

- **Found during:** Plan 10-05, Task 3's "full node project" verification pass
  (`npx vitest run --project node --exclude "**/*.integration.test.ts"` — even with integration
  tests excluded by pattern, Vitest 4's project-level `include` still picked this one up because the
  file glob matched before the CLI `--exclude` was applied to the "node" project's own `include`).
- **Error:** `a redelivered event.id is a no-op`, `a hold already expired...routes to EXCEPTION`, and
  `a mail-provider outage still leaves the response at 200` all failed with
  `Unique constraint failed on the fields: (provider,providerEventId)` and
  `terminating connection due to administrator command` — a Postgres connection killed mid-test.
- **Scope:** `submission-service.ts`/`submission-service.test.ts` (this plan's only files) never
  import or touch `checkout-webhook-system-service.ts`, `WebhookEvent`, or any Stripe/Paystack path.
  This worktree runs against the same ephemeral test-container Postgres several other parallel
  worktree-agent processes are simultaneously migrating/writing to (confirmed via `tasklist` showing
  ~15+ concurrent `node.exe` processes during this run) — the unique-constraint collision and the
  admin-killed connection are consistent with cross-agent contention on a shared test database, not
  a defect introduced by this plan.
- **Action:** Not fixed — out of scope and not reproducible in isolation. This plan's own scoped
  verification (`npx vitest run tests/submission-service.test.ts tests/boundary.test.ts`) passes
  22/22 and 14/14 respectively with zero failures, `npx tsc --noEmit` exits 0, and
  `npx eslint src/server/services/submission-service.ts` reports zero errors — the plan's own
  `<verification>` block is fully green. Re-run the full suite once uncontended (no concurrent
  worktree-agent DB writers) to confirm this integration file is unaffected.

## 2026-09-15 Wave 3 integration regression findings

- The full Node regression run reports enrolment-service.integration.test.ts failures because the existing global cohort-scope Prisma client has no DATABASE_URL, despite the fixture having a container-bound client. The terminal WITHDRAWN case was reproduced on worktree-agent-a15db908ac159067d at pre-Wave 3 HEAD 0b0b2b3; the test, enrolment service, and cohort-scope source are unchanged from that base. This is pre-existing and outside assessment Wave 3.
- checkout-phase-invariants.test.ts hit the default 5-second timeout during the loaded full-suite run. An isolated rerun with --testTimeout=15000 passed all 10 tests. No source or runner configuration changed.
- cohort-lifecycle-security.integration.test.ts also reports six timeout failures after the same missing DATABASE_URL errors in unchanged cohort-scope.ts. The concurrent-test barrier waits for a read that the global client cannot perform. These paths and tests are unchanged by Wave 3.

Final full Node regression result: 128 files passed / 3 failed; 2101 tests passed / 17 failed; exit 1, 755.61 seconds. Failures: ten enrolment integration cases and six cohort lifecycle cases using the existing global cohort-scope client without DATABASE_URL, plus one payment-invariant timeout (isolated rerun passed 10/10 at a 15-second timeout). No assessment Wave 3 tests failed in the full run.

## 10-14: `npx next build` unavailable in this parallel worktree (no local `node_modules`)

- **Found during:** Plan 10-14, Task 2 verification (`npx tsc --noEmit && npx next build`).
- **Error:** `Could not find the Next.js package (next/package.json)` — Turbopack's hermetic build
  sandboxes resolution to the worktree's own filesystem root and refuses to traverse into the
  parent repository's `node_modules`, which this worktree does not have its own copy of (`ls
  node_modules` reports "No such file or directory"; confirmed pre-existing, not caused by this
  plan's edits).
- **Scope:** `npx tsc --noEmit` (Node's own upward `node_modules` resolution, unaffected by
  Turbopack's sandboxing) passes clean except the pre-existing, already-logged `src/app/layout.tsx`
  `LayoutProps` gap (see the 10-02 entry above — untouched by this plan).
  `npx eslint` on every file this plan touched (`AssignmentSubmissionPanel.tsx`,
  `submission-actions.ts`, `LessonContent.tsx`, `page.tsx`) exits clean with zero errors. Attempting
  to work around the missing `node_modules` (a directory junction to the parent repo, or an `npm
  install` inside this worktree) was not attempted — a junction attempt was blocked by this
  sandbox's git-safety wrapper (any `cmd.exe` invocation is refused as unverifiable), and an `npm
  install` here risks resource contention with the other concurrent worktree-agent processes noted
  in the 10-05 and Wave 4 entries above.
- **Action:** Not fixed — infra-level gate, not a code defect. `npx next build` should be re-run
  once this worktree is merged into an environment with `node_modules` present (the orchestrator's
  consolidated build pass, matching how Wave 4's entry below records a passing Turbopack build in
  that fuller environment).

## 2026-09-15 Wave 4 verification limits

- The sandboxed broad Node run reached 116 passing files / 1,975 passing tests, but 21 files failed Docker initialization (22 failing suite groups); 181 cases were skipped after setup failed. Docker configuration/runtime access was denied. This is not a passing integration run.
- An explicit unit-file run subsequently passed all 117 files / 1,943 tests. Final main-workspace focused regression passed 136 tests before adding one exhausted-attempt refusal-copy regression; the corrected action suite passed 11/11 afterward. All three new component suites passed 20/20, and the final main Turbopack build passed after the correction.
- Existing tests/components/cohort-pages.test.tsx still expects "$500.00" where this locale returns "US$500.00". The price formatter and expectation are unchanged by Wave 4; adding the new GradingTab sibling mock allows the existing suite to run (8/9 pass). No currency behavior was changed to satisfy the locale-dependent assertion.
- Real PostgreSQL/MinIO proof for override, batch and released-results boundaries remains plan 10-16; the human visual/keyboard walkthrough remains plan 10-17.


## 2026-09-16 Wave 5 closeout

- The integrated 25-case PostgreSQL/MinIO run passed; the upload suite also passed 11/11 after fixture fixes. This supersedes Docker-blocked notes for these three Phase 10 suites, without clearing unrelated older infrastructure findings.
- Broad unit regression: 119 files and 1,986 tests passed; two checkout source scans timed out at the default 5-second limit under parallel build/Docker load. Isolated rerun passed all 10 checkout invariants at 30 seconds.
- Initial assessment component run suffered four fork-worker startup timeouts and a transient pending-label assertion. The assertion now waits for the submit control; the five-suite rerun using one thread passed 41/41. LessonContent stale placeholder assertions were updated and passed 14/14. No global runner configuration was changed.
- Final integrated Turbopack build, TypeScript and changed-file lint passed. Other historical component failures were not reclassified as passing; the plan 10-17 human walkthrough remains outstanding.

## Plan 10-17 final automated gate (2026-09-16)

The complete two-project regression run passed 188 files / 2,614 tests, zero failures, with one existing skipped audit-table 360 px reflow manual gate; runtime 953.36 seconds. This supersedes historical missing-DATABASE_URL and stale currency/readiness assertion failures. The enrolment factory now uses its injected database for scope reads. Node integration tests retain process isolation; component tests use threads to avoid Windows fork startup delays. A prior mixed-thread attempt exited without a report and is not counted as successful.

Final TypeScript, repository lint (zero errors, twelve warnings), and Turbopack production build passed. Source fixes include the reproduced released-grade save race, assignment upload enrolment disambiguation, and fixed True/False drag-handle errors; eleven AST gates protect the phase. The only Phase 10 completion checkpoint remaining is the explicit thirty-step human walkthrough and four UI observations, prepared against separate local seed data. Certificate-impact evaluation remains the named Phase 11 consumer gap.
