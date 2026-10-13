---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 19
subsystem: accessibility-testing
tags: [nfr-09, d-13, axe, wcag-2-2-aa, playwright, screens-manifest, github-actions, nightly]
status: complete

requires:
  - phase: 15-01
    provides: patched build baseline and the ownership table in 15-DECISIONS.md
  - phase: 15-10
    provides: Lagos-time staff slice 1
  - phase: 15-13
    provides: /staff/operations (S1)
  - phase: 15-15
    provides: Playwright config, guarded server env, local capture server
  - phase: 15-18
    provides: perf probe, data-primary-content hooks and e2e helper conventions
  - phase: 15-22
    provides: /staff/privacy and /staff/privacy/[userId] (S3)
  - phase: 15-24
    provides: caption panel in the lesson editor (swept as part of the lesson form screens)
  - phase: 15-32
    provides: Lagos-time staff slice 2
  - phase: 15-33
    provides: Lagos-time learner slice
provides:
  - "e2e/screens.manifest.ts: SCREENS (84, one per page.tsx, 109 states) and EXCLUDED_PAGES (empty, by design), plus routeTemplateFor and the pure checker manifestProblems"
  - "tests/screens-manifest.test.ts: fails when a page.tsx has neither a screen nor a written exclusion, when an entry's page is gone, when a route template or parameter does not match, or when a required key state is missing"
  - "e2e/support/a11y.ts: runAxe (five WCAG tags plus the landmark rules), the target-size / contrast / landmark spike, persona sign-in, the guarded fixture resolver and the state actions"
  - "e2e/a11y-screens.spec.ts: the real-browser sweep at 1440 and 390 pixels, with a guard against a screen that quietly fell back to its not-found or error page"
  - "evidence/a11y-axe-local.json: 84 screens, 109 states, 218 visits, 0 open violations, 0 waiver candidates, spike result"
  - ".github/workflows/e2e-nightly.yml and tests/ci-config.test.ts extended over every workflow file"
affects: [15-20, 15-31, 15-30]

actuals:
  tokens: 25000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "A page cannot ship unnoticed: the manifest test globs src/app/**/page.tsx and compares with SCREENS and EXCLUDED_PAGES"
    - "State actions seed what a state needs through the guarded Prisma client and put every row back afterwards (rate-limit counters, operations data)"
    - "Results are written per screen (test-results/a11y-parts/<run id>) and merged into the evidence file after every screen, because Playwright starts a new worker after any failed test"
    - "A sweep that visits a screen must also prove it reached the screen: HTTP status, final path, and no 'We can't find that page' or 'Something went wrong' heading unless the state expects it"

key-files:
  created:
    - e2e/screens.manifest.ts
    - e2e/support/a11y.ts
    - e2e/a11y-screens.spec.ts
    - tests/screens-manifest.test.ts
    - .github/workflows/e2e-nightly.yml
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/a11y-axe-local.json
  modified:
    - tests/ci-config.test.ts
    - .github/dependabot.yml
    - src/components/primitives/ResourceForm.tsx
    - src/components/catalogue/ArrangeBoard.tsx
    - src/components/catalogue/RichTextEditor.tsx
    - src/app/staff/certificates/templates/TemplateEditorShell.tsx
    - "src/app/staff/cohorts/[id]/learners/[enrolmentId]/page.tsx"
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/15-DECISIONS.md
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/deferred-items.md

key-decisions:
  - "The sweep turns on axe's landmark rules (region and the landmark-* family) in addition to the five WCAG tags, because the plan says landmark rules must run and they carry no WCAG tag"
  - "The manifest has one entry per page.tsx and no exclusions: the token pages (reset password, change of email address, verify email) are swept in their 'link that is not valid' state, which is the only state reachable without a token"
  - "The sweep runs against its own throwaway database (licence_a11y, in the existing local Docker Postgres), so the operations 'All clear' state can be reached and every run starts from a seed"
  - "Operations states change nothing for good: 'All clear' sets aside every failure source and 'With failures' adds three rows, and both are undone after each visit"

patterns-established:
  - "AxeBuilder.options() replaces the whole option object, so it must be called before withTags()"
  - "A target smaller than 24px is only reported by target-size if another target sits within 24px, so a spike needs two small buttons"

requirements-completed: []

coverage:
  - id: D1
    description: "Every page.tsx under src/app is a screen in the manifest or carries a written exclusion; a new page, a removed page, a wrong route template or a parameter without a fixture fails the guard"
    requirement: NFR-09
    verification:
      - kind: unit
        ref: "tests/screens-manifest.test.ts (11 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "axe (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa plus landmark rules) reports zero violations on all 84 screens and 109 states at 1440 and 390 pixels in Chromium, including failed sign-in, each rate-limit message, operations all clear and with failures, privacy before and after anonymisation and the empty new-course form"
    requirement: NFR-09
    verification:
      - kind: e2e
        ref: "npx playwright test --config e2e/playwright.config.ts e2e/a11y-screens.spec.ts --project=chromium --headed (85 passed)"
        status: pass
      - kind: other
        ref: "evidence/a11y-axe-local.json (screens 84, visits 218, openViolations 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ledger A8: tag selection runs target-size (two 10 pixel buttons 4 pixels apart are flagged); colour contrast and the region landmark rule are flagged in the same run"
    requirement: NFR-09
    verification:
      - kind: e2e
        ref: "e2e/a11y-screens.spec.ts#spike (evidence spike.flagged, contrastFlagged, landmarkFlagged all true)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Five axe findings in existing screens were fixed at their source"
    requirement: NFR-09
    verification:
      - kind: e2e
        ref: "the final full sweep (0 open violations) and tests/components/resource-form*.test.tsx, arrange-board, arrange-client, rich-text-editor, lesson-form-fields, certificate-template*, staff-progress-override, tests/unit/design-contract.test.ts (all pass)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Nightly workflow: schedule and manual dispatch only, contents read, SHA-pinned actions, no secrets, Postgres service container, journey then sweep; guard covers every workflow file"
    requirement: NFR-09
    verification:
      - kind: unit
        ref: "tests/ci-config.test.ts (15 tests)"
        status: pass
      - kind: manual_procedural
        ref: "run the e2e-nightly workflow once with workflow_dispatch on GitHub"
        status: unknown
    human_judgment: true
    rationale: "The workflow has not run on GitHub. Its first run may show environment issues (for example the MinIO image pull or the build step) that only the real runner can show."
  - id: D6
    description: "Whether the sweep's coverage is enough for NFR-09: it proves the rule-checkable WCAG 2.2 AA criteria only"
    requirement: NFR-09
    verification: []
    human_judgment: true
    rationale: "Keyboard use, focus order, error identification in context, zoom and reflow and screen-reader behaviour are plan 15-20 and the manual pass; accessible media is plans 15-23 and 15-24 or the recorded waiver"

duration: about 3 h wall clock (four production builds of about 6 minutes each and six sweeps of 12 to 19 minutes)
completed: 2026-10-09
---

# Phase 15 Plan 19: Accessibility sweep, screens manifest and nightly workflow Summary

**A real-browser axe sweep (five WCAG tags plus the landmark rules, 1440 and 390 pixels) now covers all 84 pages in 109 states with zero open violations, guarded by a manifest test that fails when a page is forgotten, with five accessibility defects fixed at their source and a nightly workflow that keeps the journey and the sweep running.**

## Performance

- **Duration:** about 3 h wall clock, mostly production builds and sweep runs
- **Completed:** 2026-10-09
- **Tasks:** 3 (tracer, manifest with guard and sweep and fixes, nightly workflow)
- **Commits:** 0 (the project owner commits; nothing was staged or committed)
- **Files:** 6 created, 9 modified (list above)

## What was built

### Task 1 (tracer)

`e2e/support/a11y.ts`, `e2e/screens.manifest.ts` (three screens) and `e2e/a11y-screens.spec.ts` were written and run against a production build: the spike plus public courses, sign-in (with the failed state) and the operations page, at both widths.

The first tracer run was not trustworthy: the spike failed, and the reason was a bug in the helper (the three screens passed, but with the wrong rule set). `AxeBuilder.options()` replaces the whole option object, so calling it after `withTags()` silently dropped the five tags and axe ran its default rules instead. That is exactly what the spike exists to catch. The order was corrected (options first), the spike now flags the small buttons, and the tracer was re-run and passed (4 passed) before the manifest was expanded. Every number in the evidence comes from runs made after this fix.

A second spike finding worth knowing: a **lone** 10 by 10 pixel button is not flagged, because target-size has a spacing exception when no other target is within 24 pixels. The spike fixture uses two buttons 4 pixels apart.

### Task 2 (manifest, guard, sweep, fixes)

- `tests/screens-manifest.test.ts` was written first and failed (8 of 11 failed: the exports did not exist), then went green with the manifest (11 passed).
- The manifest lists all 84 `page.tsx` files, with persona, parameter sources and 109 states. 26 screens carry `primary: true` (the forms and content screens plan 15-20 also sweeps). `EXCLUDED_PAGES` is empty: reset password, change of email address and verify email are swept in their "link that is not valid" state.
- Key states from the contract are all in: failed sign-in, empty sign-in, each S5 message (sign-in, register, forgot password, resend verification, certificate check, new support request), S1 all clear and with failures, S3 before, with the confirmation open and after anonymisation, and empty new-course, cohort, programme, role, user, assessment, lesson and template forms. Extra states: refusals for an instructor on operations, privacy lookup and privacy record, staff overview as instructor, finance and programme manager, the cohort detail tabs, the cross-site enrol screen and the invalid-token screens.
- The first full sweep had 13 failing screens: 3 were problems in the sweep itself (home, enrol, operations) and 10 came from four real accessibility defects. Later runs, and reading the visit log, found three more sweep problems (new lesson, reconciliation case, a denied-record status) and a fifth real defect (the lesson body editor). All five defects are fixed; the sweep problems are under Deviations.

### Task 3 (nightly workflow)

`.github/workflows/e2e-nightly.yml`: triggers `schedule` (one cron, 02:17 UTC) and `workflow_dispatch` only; top-level `contents: read`; `postgres:16-alpine` service container; checkout and setup-node at the same SHAs as ci.yml; `assert-local-db`, `prisma migrate deploy`, `prisma db seed`; a throwaway MinIO container for the journey's uploads (image pinned by digest, local test values); `npm run build`; `playwright install --with-deps chromium`; the "full journey" test, then the sweep (`if: !cancelled()`, output to `test-results/a11y-axe.json`); the report folder is uploaded as an artifact on failure with upload-artifact pinned to v7.0.2's commit SHA. No secrets are read. `tests/ci-config.test.ts` now runs its trigger, permission and SHA-pin checks over every file in `.github/workflows` and has a new test that the nightly workflow runs on a schedule and manual dispatch only, plus negative cases.

## Findings fixed (each source file, finding and the ownership row that covered it)

All five are covered by the "accessibility fix sites (15-19)" row of 15-DECISIONS.md (agreed) unless noted.

| File | Finding (axe rule, where) | Fix |
| --- | --- | --- |
| `src/components/primitives/ResourceForm.tsx` | `button-name`, critical: on a phone the names of the non-current steps of a stepped form were `display: none`, so those step buttons had no name (new and edit forms for cohorts, courses, programmes at 390px) | `hidden sm:inline` became `sr-only sm:not-sr-only` (one class, nothing changes on screen). **Primitive**: see ownership note below |
| `src/components/catalogue/ArrangeBoard.tsx` | `aria-hidden-focus`, serious: the drag handles are `aria-hidden` but react-beautiful-dnd gives them `tabIndex=0` (course arrange and programme arrange, both widths) | `tabIndex={-1}` after the spread; the Move up / Move down buttons remain the keyboard route |
| `src/components/catalogue/RichTextEditor.tsx` | `aria-prohibited-attr`, serious: `aria-label` on the editable `div` with no role (new lesson form, both widths) | the editable node gets `role="textbox"` and `aria-multiline="true"` |
| `src/app/staff/certificates/templates/TemplateEditorShell.tsx` | `landmark-unique`, moderate: two unlabelled `aside` landmarks (template editor, 1440px) | `aria-label="Elements"` and `aria-label="Properties"` |
| `src/app/staff/cohorts/[id]/learners/[enrolmentId]/page.tsx` | `scrollable-region-focusable`, serious: the results table's scroll container could not be reached by keyboard (both widths) | `role="region"`, `aria-label="Released results"`, `tabIndex={0}`, as the UI-SPEC S7 reflow row prescribes |

**Ownership note (needs the owner's eye).** `ResourceForm.tsx` is a primitive. The plan says a primitive fix needs its own "agreed" row naming the file. The "Any primitive, shell or Toaster change an accessibility, responsive or keyboard finding requires" row already reads "agreed (owner confirmed 2026-10-06 in the execute-phase session)", but says "one row per file, added when found". I added the per-file row to 15-DECISIONS.md and worded its agreement cell as "covered by the agreed row above ... revert the one class change if the co-worker objects" rather than writing "agreed" myself. If the owner reads the plan strictly (a file-specific confirmation is needed), this is a single class name to revert, and the five phone steppers would then show the `button-name` finding again. No shell or Toaster file was edited.

Other findings: **target-size reported nothing at all** in this build, so the inline table links (UI-SPEC unresolved row, ledger OQ10) did not need to become waiver candidates: `waiverCandidates` is 0 and no D-07 waiver is needed from this sweep.

## Verification run (all results real; nothing marked passed that did not run)

| Command | Result |
| --- | --- |
| `npx tsx scripts/ops/assert-local-db.ts` (before every database-touching run, with the shell URL pointing at `licence_a11y`) | exit 0, "database target is local (localhost)" |
| `npx vitest run tests/screens-manifest.test.ts` (RED, before the manifest was complete) | 8 failed, 3 passed |
| `npx vitest run tests/screens-manifest.test.ts --testTimeout=60000` | 1 file, 11 tests passed |
| `npx vitest run tests/ci-config.test.ts --testTimeout=60000` | 1 file, 15 tests passed |
| `npx vitest run tests/screens-manifest.test.ts tests/ci-config.test.ts --testTimeout=60000` (plan-level verification) | 2 files, 26 tests passed |
| `npx playwright test --config e2e/playwright.config.ts e2e/a11y-screens.spec.ts --project=chromium --headed` (final run, against the final code and a fresh production build) | 85 passed (11.6 min): the spike and 84 screens |
| Task 2 `node -e` evidence check | passed: screens 84, states 109, visits 218, open violations 0, waiver candidates 0, spike present |
| `npx vitest run --project components` on `arrange-board`, `arrange-client`, `certificate-template-editor`, `resource-form-steps`, `resource-form`, `rich-text-editor` | 6 files, 77 tests passed |
| same project on `lesson-form-fields`, `certificate-templates`, `staff-progress-override` | 3 files, 43 tests passed |
| `npx vitest run tests/unit/design-contract.test.ts tests/licence-ui-mirror-gate.test.ts tests/screens-manifest.test.ts tests/ci-config.test.ts` | 4 files, 152 tests passed |
| `npx vitest run --project components tests/components/resource-form-steps.test.tsx tests/components/resource-form.test.tsx` (after the last class-string fix) | 2 files, 25 tests passed |
| `npx tsc --noEmit` and `npx eslint` on every new or edited file | clean |
| `npm run build` against the local database (four times: after the first fixes, the second set, the lesson-editor fix and the final class-string fix) | each exit 0 |

Not run: the nightly workflow on GitHub (the plan's human check), any browser other than Chromium, and any run against a database other than the local throwaway ones.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] axe tags were dropped by the helper**
- **Found during:** Task 1 (the spike)
- **Issue:** `.options({ rules }).withTags(...)` order matters; with the reverse order the five tags were silently replaced and target-size never ran.
- **Fix:** options first, then tags; comment in the code. The spike now covers target-size, colour contrast and the region rule.
- **Files modified:** `e2e/support/a11y.ts`

**2. [Rule 1 - Bug] Evidence lost after any failed test**
- **Found during:** Task 2 (first full run)
- **Issue:** Playwright starts a new worker after a failed test, and the evidence was held in memory, so the file only held the last worker's screens.
- **Fix:** one part file per screen under `test-results/a11y-parts/<run id>`, merged into the evidence file after every screen.
- **Files modified:** `e2e/a11y-screens.spec.ts`

**3. [Rule 1 - Bug] Sweep defects found by reading the visit log**
- Home redirects a visitor to the catalogue; the enrol page needs `?currency=NGN`; first sign-in after a server start needs more than 5 s; the operations "All clear" neutraliser first set the exception order to PAID, which created a data-integrity finding (now FAILED); the new-lesson page needs `?moduleId=`, and without it the sweep had been "passing" on the not-found page (a guard now fails any screen that shows "We can't find that page" or "Something went wrong" unless the state expects it); a reconciliation case page error (below).
- **Files modified:** `e2e/screens.manifest.ts`, `e2e/support/a11y.ts`, `e2e/a11y-screens.spec.ts`

**4. [Rule 3 - Blocking] `tests/ci-config.test.ts` failed before this plan changed anything**
- **Found during:** Task 3
- **Issue:** Test 4 (every exact pin in package.json needs a Dependabot ignore entry) failed for `@axe-core/playwright` and `@playwright/test`, pinned exactly by plan 15-15. Task 3's verify needs the whole file green.
- **Fix:** two ignore entries added to `.github/dependabot.yml` (not in this plan's file list), with a comment.
- **Files modified:** `.github/dependabot.yml`

**5. [Environment] Own throwaway database**
- The plan's precondition names the local database with the 15-17 journey fixtures and 15-14 load accounts. The sweep needs the operations page to read "All clear" and starts a nightly-style run from a seed, so it uses its own database `licence_a11y` (created, migrated with `prisma migrate deploy` and seeded with `prisma/seed.ts`) in the existing local Docker Postgres (port 5434). The journey fixtures are created by the Playwright global setup (it ran on every sweep); the load accounts are not needed because the sweep signs in with the seeded accounts. The password of the throwaway role `licence_test` was reset (kept only in the session scratchpad, as in plan 15-18) and a throwaway MinIO container was started for the global setup and removed afterwards. The `.env` database was never read or contacted.

---

**Total deviations:** 5 (3 bugs in this plan's own code, 1 blocking test drift, 1 environment choice). **Impact:** none on scope; the dependabot.yml edit is two lines in a file outside the list.

## Known issues found and not fixed (also in deferred-items.md)

- **`/staff/reconciliation/[caseId]` shows "Something went wrong" when the case's order has no correlation id** (`getCaseDetail`'s `${row.orderCorrelationId} IS NOT NULL` sends an untyped null; Postgres error 42P18). Checkout-created orders always carry a correlation id, so real cases are likely unaffected; seeded and legacy orders have none. The sweep's fixture gives its case's order a correlation id. One-line fix: `CAST(${row.orderCorrelationId} AS text) IS NOT NULL`.
- **The two refusal screens (`/staff/operations` and `/staff/privacy` for a staff member without the permission) have no `<h1>`.** Not a WCAG-tag finding (axe `page-has-heading-one` is best practice), so the sweep passes, but a screen-reader user lands on a page with no heading.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-15-19-01: the workflow triggers are `schedule` and `workflow_dispatch`, permissions `contents: read`, every action SHA-pinned, no `secrets.` reference, and the guard test covers all workflow files with negative cases. T-15-19-02: the manifest guard plus the nightly sweep. T-15-19-03: no waiver was needed; the only waivable class (inline table link target-size) is detected and recorded separately in the evidence (`waiverCandidate`), and the sweep fails on anything else.

## Neon go-live list

None. No migration, schema or configuration change.

## Owner notes

- Nothing was committed or staged. The 217 entries in `git status` are mostly other plans' work; this plan's files are listed under key-files. The five source fixes are mixed in the working tree with other plans' edits in the same files (`learners/[enrolmentId]/page.tsx` also carries the Lagos-time change); stage by hunk.
- Check `.github/` is added with the rest: it is new and untracked.
- To re-run the sweep locally: start the local Postgres, MinIO and an app build as the plan 15-17 and 15-18 summaries describe, point `DATABASE_URL` at a local database (the guard stops anything else), and run the Playwright command above. `A11Y_ONLY=signin,staff-operations` limits it and marks the file partial; `A11Y_OUT` redirects the file. A full run takes about 12 minutes.
- The evidence file is regenerated by every full run. The one saved here comes from the final run against the final code.
- Left running: nothing. The next server (3010), the email capture server (4010) and the MinIO container were stopped and removed. The database `licence_a11y` stays in the local Docker Postgres container (`DROP DATABASE licence_a11y` removes it).
- Open for the owner: run `e2e-nightly` once with `workflow_dispatch` after pushing (the plan's human check); decide on the `ResourceForm.tsx` row wording; consider the two deferred items above.

## Self-Check: PASSED

- Files exist: `e2e/screens.manifest.ts`, `e2e/support/a11y.ts`, `e2e/a11y-screens.spec.ts`, `tests/screens-manifest.test.ts`, `.github/workflows/e2e-nightly.yml`, `evidence/a11y-axe-local.json`; edited files present.
- Acceptance: a11y.ts contains the five tags; the spike test passes; the Playwright run passes for all screens; `tests/screens-manifest.test.ts` passes; the evidence reports 84 screens, the spike result and no violation without `waiverCandidate`; e2e-nightly.yml has triggers `schedule` and `workflow_dispatch` only, `contents: read` and no `secrets.` reference; `tests/ci-config.test.ts` iterates every workflow file and passes.
- No commits made, nothing staged; `actuals.commits: 0`. STATE position and REQUIREMENTS untouched.
