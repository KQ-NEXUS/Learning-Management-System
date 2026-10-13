---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 02
subsystem: infra
tags: [nextjs, npm-audit, github-actions, dependabot, ci, supply-chain, vitest]

requires: []
provides:
  - "next and eslint-config-next exact-pinned at 16.3.8; npm audit --omit=dev --audit-level=high exits 0 (critical GHSA-vcvr-r3jv-pc5j and high sharp / source-map-js fixed, none waived)"
  - ".github/workflows/ci.yml: CI on push / pull_request to main and develop with jobs static, unit, integration (4 shards, serial files) and audit; contents: read; actions pinned by SHA"
  - ".github/dependabot.yml: npm, github-actions, docker and docker-compose blocks targeting develop, npm cooldown, ignore list covering every exact pin"
  - "tests/ci-config.test.ts guard for the workflow and Dependabot rules"
  - ".gitignore and ESLint globalIgnores for Phase 15 test and evidence output"
affects: [15-14, 15-17, 15-18, 15-19, 15-20, 15-28, 15-30, 15-31]

actuals:
  tokens: 13007
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Config guard tests: pure check functions over file text, with negative cases fed mutated in-memory copies"
    - "CI type check runs `next typegen` before `tsc --noEmit` (generated next-env.d.ts and .next/types are gitignored)"

key-files:
  created:
    - .github/workflows/ci.yml
    - .github/dependabot.yml
    - tests/ci-config.test.ts
  modified:
    - package.json
    - package-lock.json
    - .gitignore
    - eslint.config.mjs
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/deferred-items.md

key-decisions:
  - "Pinned actions/checkout v7.0.1 (3d3c42e5aac5ba805825da76410c181273ba90b1) and actions/setup-node v7.0.0 (820762786026740c76f36085b0efc47a31fe5020); both tags are lightweight, so the ref SHA is the commit SHA"
  - "Fixed the new high sharp advisory (GHSA-wq5f-xc86-pv6w, sharp 0.35.4 to 0.35.5, in range) alongside source-map-js 1.2.1 to 1.2.2; neither needed --force"
  - "react and react-dom are exact-pinned in package.json, so Dependabot ignores them entirely (this covers the planned major-only ignore)"
  - "Dependabot ignore rules apply to version updates only because every block sets target-branch; GitHub security updates still reach the default branch"
  - "Added `.kilo/**` to ESLint globalIgnores next to `.worktrees/**` so a local tool's checkout no longer fails `npm run lint`"

patterns-established:
  - "A new exact pin in package.json must get a Dependabot ignore entry in the same change (tests/ci-config.test.ts Test 4)"

requirements-completed: [NFR-04, NFR-12]

coverage:
  - id: D1
    description: "Next.js 16.3.8 and eslint-config-next 16.3.8 exact pins; npm audit --omit=dev --audit-level=high exits 0; type check, lint and production build pass"
    requirement: "NFR-04"
    verification:
      - kind: other
        ref: "npm audit --omit=dev --audit-level=high (found 0 vulnerabilities, exit 0)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (exit 0)"
        status: pass
      - kind: other
        ref: "DATABASE_URL=<local Docker 5434> EMAIL_TRANSPORT=stub npm run build (Next.js 16.3.8, exit 0)"
        status: pass
      - kind: unit
        ref: "tests/aws-sdk-lockfile.test.ts and tests/server-component-function-props.test.ts (4 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CI workflow with least privilege, SHA-pinned actions and the static, unit, sharded integration and audit jobs"
    requirement: "NFR-04"
    verification:
      - kind: unit
        ref: "tests/ci-config.test.ts#Test 1, Test 2, Test 3 and the in-memory regression cases"
        status: pass
    human_judgment: true
    rationale: "The workflow has never run on GitHub (nothing is pushed). The owner must confirm after pushing that all jobs go green, including Testcontainers on hosted runners (assumption A7)"
  - id: D3
    description: "Dependabot config for npm, github-actions, docker and docker-compose targeting develop, with cooldown and an ignore entry for every exact pin"
    requirement: "NFR-04"
    verification:
      - kind: unit
        ref: "tests/ci-config.test.ts#Test 4 and Test 5"
        status: pass
    human_judgment: true
    rationale: "GitHub validates dependabot.yml only after a push; the owner checks the Dependabot tab for a config error (assumption A17; docker-compose and cooldown are documented in the current GitHub options reference)"
  - id: D4
    description: "Ignore entries for Phase 15 test and evidence output in .gitignore and ESLint globalIgnores; npm run lint exits 0"
    requirement: "NFR-12"
    verification:
      - kind: other
        ref: "npm run lint (0 errors, 27 pre-existing warnings, exit 0)"
        status: pass
    human_judgment: false

duration: 1h 36m
completed: 2026-10-06
status: complete
---

# Phase 15 Plan 02: Dependency audit gate, CI and Dependabot Summary

**The critical Next.js RCE advisory is fixed by moving to 16.3.8, and the high sharp and source-map-js advisories by in-range patches. A public-repo-safe GitHub Actions workflow (static, unit, 4-shard integration, audit) and a pin-respecting Dependabot config now protect main and develop, and a guard test checks both.**

## Performance

- **Duration:** 1h 36m (much of it waiting on npm install, a 10-minute production build and `tsc` on a memory-limited machine)
- **Started:** 2026-10-06T21:09:12Z
- **Completed:** 2026-10-06T22:45:06Z
- **Tasks:** 3 of 3
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- `npm audit --omit=dev --audit-level=high` goes from 1 critical and 2 high to 0 vulnerabilities. Nothing was waived and `--force` was never used (D-07, prohibition P2).
- `next` and `eslint-config-next` are exact-pinned at 16.3.8. Type check, lint, the pinned-lockfile test and a full production build all pass on 16.3.8.
- `.github/workflows/ci.yml`: plain `pull_request` and `push` triggers on main and develop, plus `workflow_dispatch`. It sets `permissions: contents: read`, uses no secrets and runs `persist-credentials: false`. Concurrency cancels superseded runs. Node 22 matches the Dockerfile. Both actions are pinned to 40-character SHAs with the version in a comment.
- `.github/dependabot.yml`: four ecosystems, all targeting develop. The npm block has a weekly schedule, a limit of 5 open PRs, a cooldown of 3 days (7 for majors), and minor and patch dev-dependency updates grouped into one PR. Its ignore list covers every exact pin, the `@aws-sdk/*` family and axe-core, plus major updates of prisma, `@prisma/client` and typescript.
- `tests/ci-config.test.ts` has 11 tests: the five planned checks, plus six negative cases that each prove a regression in an in-memory copy is caught.

## Audit findings (recorded per Task 1)

Before the change, `npm audit --omit=dev` reported:

| Package | Range | Severity | Advisory | Fix applied |
| --- | --- | --- | --- | --- |
| next | 16.2.0 - 16.3.5 | critical | GHSA-vcvr-r3jv-pc5j (RCE in next/og ImageResponse) | `next` 16.3.4 to 16.3.8 (exact pin); npm's own suggestion was `--force` to 16.4.0, which was not used |
| sharp | < 0.35.5 | high | GHSA-wq5f-xc86-pv6w (librsvg CVE-2026-96889); new since research | 0.35.4 to 0.35.5 via `npm audit fix --omit=dev` (within next's `^0.35.4`) |
| source-map-js | 1.0.0 - 1.2.1 | high | GHSA-68fv-2mgg-jv7q | 1.2.1 to 1.2.2 via `npm audit fix --omit=dev` (every dependent declares `^1.2.1`) |

After the change: `found 0 vulnerabilities`, exit 0.

Commands run (none with `--force` or `--accept-data-loss`):
- `npm audit --omit=dev`
- edit package.json pins, then `npm install`
- `npm audit fix --omit=dev --dry-run`, then `npm audit fix --omit=dev`
- `npm install` (restores dev dependencies that `audit fix --omit=dev` pruned from node_modules; the lockfile was byte-identical before and after)
- `npm audit --omit=dev --audit-level=high`
- `npx tsc --noEmit`
- `npm run lint`
- `npx vitest run tests/aws-sdk-lockfile.test.ts tests/server-component-function-props.test.ts --testTimeout=60000`
- Build: `DATABASE_URL="$LOCAL_DB_URL" EMAIL_TRANSPORT=stub NEXT_TELEMETRY_DISABLED=1 npm run build`, after a node check that the host is localhost. LOCAL_DB_URL is the Docker Postgres on localhost:5434, database `licence_test`. Next.js checks `process.env` before any `.env*` file, so the shared Neon URL in `.env` was never used.

Lockfile delta: version changes only to next, `@next/env`, `@next/eslint-plugin-next`, `@next/swc-*`, eslint-config-next, sharp, `@img/sharp-*` and source-map-js. There are 27 new lockfile entries. All are optional platform binaries of the same packages (`@next/swc-darwin-*`, `-linux-arm64-*`, `-win32-arm64-msvc`; `@img/sharp-*` for other OS/CPU targets) plus `@emnapi/runtime`, which only the wasm32 sharp build pulls in. No new package is installed on win32-x64, linux-x64 (CI) or linuxmusl-x64 (Docker). `@aws-sdk/lib-storage` stays 3.1125.0.

## Action SHA resolution (recorded per Task 2)

```
gh api repos/actions/checkout/releases/latest --jq .tag_name       # v7.0.1
gh api repos/actions/setup-node/releases/latest --jq .tag_name     # v7.0.0
gh api repos/actions/checkout/git/ref/tags/v7.0.1   --jq '.object.type + " " + .object.sha'  # commit 3d3c42e5aac5ba805825da76410c181273ba90b1
gh api repos/actions/setup-node/git/ref/tags/v7.0.0 --jq '.object.type + " " + .object.sha'  # commit 820762786026740c76f36085b0efc47a31fe5020
gh api repos/actions/checkout/commits/3d3c42e5aac5ba805825da76410c181273ba90b1    # exists, 2026-07-17
gh api repos/actions/setup-node/commits/820762786026740c76f36085b0efc47a31fe5020  # exists, 2026-07-14
```

Both refs are type `commit` (lightweight tags), so no annotated-tag dereference was needed.

## Task Commits

No commits were made; the owner commits explicitly.

1. **Task 1: Tracer, Next.js 16.3.8, audit, tsc, lint, build:** not committed (owner commits explicitly). Tracer gate: `human_verify_mode` is end-of-phase and `<verify>` is automated only, so the full verify chain was re-run before expanding. It passed (`TRACER_VERIFY_EXIT=0`).
2. **Task 2: CI workflow, Dependabot, ignore entries:** not committed (owner commits explicitly).
3. **Task 3: Guard test:** not committed (owner commits explicitly).

## Files Created/Modified

- `package.json`: `next` and `eslint-config-next` set to 16.3.8 (exact).
- `package-lock.json`: next 16.3.8 family, sharp 0.35.5, source-map-js 1.2.2, and the optional platform entries above.
- `.github/workflows/ci.yml`: the CI workflow (static, unit, integration ×4, audit).
- `.github/dependabot.yml`: Dependabot version updates for npm, github-actions, docker and docker-compose.
- `tests/ci-config.test.ts`: the guard test for the workflow and Dependabot config (node project).
- `.gitignore`: a "Phase 15 test and evidence output" block (`/playwright-report/`, `/test-results/`, `/perf/results/`, `/dumps/`, `/e2e/.auth/`).
- `eslint.config.mjs`: globalIgnores `playwright-report/**`, `test-results/**`, `perf/**` (k6 runtime imports), `dumps/**` and `.kilo/**`.
- `.planning/.../deferred-items.md`: dev-only advisories and the `.kilo` lint note.

## Decisions Made

See `key-decisions` in the frontmatter. The two that matter most:
- **Dependabot ignore vs security updates:** GitHub's options reference says options in a block with `target-branch` "no longer apply to security updates". Ignoring `next` therefore cannot suppress a security PR, and the CI audit job is the backstop either way.
- **Cooldown placement:** `semver-major-days` is supported for npm but not for docker, docker-compose or github-actions, so `cooldown` sits on the npm block only. GitHub applies its 3-day default cooldown to the others.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/Security] Fixed a high `sharp` advisory the research did not list**
- **Found during:** Task 1 (baseline `npm audit --omit=dev`)
- **Issue:** GHSA-wq5f-xc86-pv6w (sharp < 0.35.5) had appeared since research, making 3 findings instead of 2.
- **Fix:** Lifted by the same non-forced `npm audit fix --omit=dev` (patch, in range).
- **Files modified:** package-lock.json
- **Verification:** `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities.
- **Committed in:** not committed (owner commits explicitly)

**2. [Rule 3 - Blocking] Restored dev dependencies pruned by `npm audit fix --omit=dev`**
- **Found during:** Task 1
- **Issue:** With `--omit=dev`, npm also pruned dev packages from node_modules (vitest and testcontainers were gone), which would block every later step.
- **Fix:** Plain `npm install` from the lockfile. A byte comparison showed the lockfile unchanged.
- **Files modified:** none (node_modules only)
- **Verification:** `cmp` printed LOCK-UNCHANGED; vitest runs.

**3. [Rule 3 - Blocking] `npx next typegen` before `tsc --noEmit` in the CI static job**
- **Found during:** Task 2
- **Issue:** `tsconfig.json` includes `next-env.d.ts` and `.next/types/**`, both generated and gitignored, so a clean CI checkout lacks them. The bundled Next docs (`06-cli/next.md`) give `next typegen && tsc --noEmit` as the CI pattern. `next.config.ts` reads no env, so typegen needs no secrets.
- **Fix:** Added a `npx next typegen` step to the static job.
- **Files modified:** .github/workflows/ci.yml
- **Verification:** ci-config Test 3 still passes. The first GitHub run is the real proof (owner human-check).

**4. [Rule 3 - Blocking] `.kilo/**` added to ESLint globalIgnores**
- **Found during:** Task 1 / Task 2 (`npm run lint` exit 1)
- **Issue:** 14 lint errors, all in `.kilo/worktrees/soft-cord/.planning/phase10-uat-setup.cjs`, a local tool's checkout excluded via `.git/info/exclude`. They predate this plan and are unrelated to the bump, but Task 2 requires `npm run lint` to exit 0.
- **Fix:** One ignore entry beside the existing `.worktrees/**`, following the same rule. No file under `.kilo/` was touched.
- **Files modified:** eslint.config.mjs
- **Verification:** `npm run lint` gives 0 errors and 27 warnings (all pre-existing), exit 0.

**5. [Rule 2 - Hardening] Workflow extras beyond the plan text**
- `persist-credentials: false` on every checkout, so the read-only token is not left in `.git/config`.
- `timeout-minutes` per job and `fail-fast: false` on the shard matrix.
- Workflow-level `EMAIL_TRANSPORT: stub`, so no test can send real email.
- The guard's Test 1 also fails on any `: write` permission and any `${{ secrets.` reference (T-15-02-02, "no secrets in any job").
- **Files modified:** .github/workflows/ci.yml, tests/ci-config.test.ts

---

**Total deviations:** 5 (1 bug/security, 3 blocking, 1 hardening).
**Impact on plan:** All within the plan's intent; there is no new package name in the installed set and no change of scope.

## TDD note (Task 3)

Task 3 is `tdd="true"`, but its subject (the Task 2 config files) already existed when the tests were written, as the plan sequences it. A RED run against the real files could not fail. The failure path is instead proved by six negative tests that feed mutated in-memory copies to the same check functions: pull_request_target added, token widened or secret read, action unpinned, audit job dropped or parallel integration, new exact pin without an ignore, a block without target-branch develop. All six fail the checks as intended, so the guard is not vacuous.

## Issues Encountered

- npm printed `EPERM rmdir` cleanup warnings for `node_modules/dockerode/.../test/fixtures` during the prune (a Windows file lock). This was harmless, and the restore install succeeded.
- `npm audit` over the full tree (dev included) still shows 8 high findings in dev-only tooling (`@grpc/grpc-js`, `brace-expansion`, `braces`, `undici`). They are outside the NFR-04 gate and logged in `deferred-items.md`.
- `requirements.ready-ids` reported NFR-04 and NFR-12 as blocked before this SUMMARY existed, because sibling plans also declare them. See the State updates section.

## User Setup Required

None in this repo. After the owner pushes (not done here), these human checks remain:
1. **GitHub Actions tab:** the CI run shows static, unit, integration (4 shards) and audit all green, which also confirms assumption A7 (Testcontainers on hosted runners). The `next typegen` step is new to this repo and is first proven on that run.
2. **Dependabot tab** (Insights > Dependency graph > Dependabot): the config is accepted, with no "unsupported ecosystem" or parse error (A17). If `docker-compose` is rejected, remove that block and record it.
3. Optional: enable branch protection on main and develop requiring the four CI checks. That is a repository setting and not part of this plan.

## Next Phase Readiness

- Later Phase 15 plans that add Playwright, k6 or dump output (15-14, 15-17 to 15-20, 15-28, 15-30) can write to the now-ignored directories without lint or git noise.
- Any later plan that adds an exact pin, for example `@axe-core/playwright` or `@playwright/test`, must add a matching Dependabot ignore entry, or `tests/ci-config.test.ts` fails.

## State updates

- `state.advance-plan`, `state.record-metric` (15 / 02, 1h 36m, 3 tasks, 8 files), two `state.add-decision` entries and `state.record-session` ("Completed 15-02-PLAN.md") succeeded.
- `state.update-progress` returned `updated: false` ("phase scope is unscoped, not complete"). STATE.md was not hand-edited.
- `roadmap.update-plan-progress 15`: Phase 15 is In Progress.
- `requirements.ready-ids <15-02-PLAN.md> NFR-04,NFR-12` (run after this SUMMARY existed) returned `ready: []` and `blocked: [NFR-04, NFR-12]`, because sibling plans that also declare them have no SUMMARY yet. REQUIREMENTS.md was therefore not marked; the last declaring plan marks them. `requirements-completed` above lists this plan's share, as the template requires.

## Self-Check: PASSED

- FOUND: .github/workflows/ci.yml, .github/dependabot.yml, tests/ci-config.test.ts, 15-02-SUMMARY.md
- Commits: none, by design (owner commits explicitly). HEAD is still 9599060; nothing staged (`git diff --cached` is empty)
- Plan verification re-run: `npm audit --omit=dev --audit-level=high` exit 0; `npx vitest run tests/ci-config.test.ts tests/aws-sdk-lockfile.test.ts` 13/13 passed; production build passed on 16.3.8
- Acceptance criteria, all PASS:
  - T1: exact 16.3.8 pins, audit exit 0, build exit 0, no `--force` or `--accept-data-loss`
  - T2: four jobs, no pull_request_target, 0 unpinned `uses:`, 4 ecosystems each with `target-branch: "develop"`, 5 gitignore entries, 4 ESLint ignores, lint exit 0
  - T3: 11 `it(` blocks, an in-memory pull_request_target fixture fails the check, the vitest file passes

---
*Phase: 15-launch-readiness-nfr-verification-operational-cutover*
*Completed: 2026-10-06*
