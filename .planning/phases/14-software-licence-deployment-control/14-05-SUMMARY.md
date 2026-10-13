---
phase: 14-software-licence-deployment-control
plan: 05
subsystem: licensing
tags: [licence, issuer-cli, ed25519, key-custody, runbook, dockerignore]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-02 shared format.ts (encodeLicenceEnvelope, schemas), verify.ts, trust-set.ts; 14-DECISIONS.md D-02 option-a"
provides:
  - "provider-tools/licence-issuer/issue.ts: assertOutsideRepo, generateKeyPairToFile, loadPrivateKey, issueLicence, inspectLicence"
  - "provider-tools/licence-issuer/cli.ts: keygen, issue, verify, inspect via node:util parseArgs"
  - "RUNBOOK.md (issue, renew, replace, key rotation, compromise recovery, time rules, handover) and README.md"
  - ".dockerignore entry provider-tools"
  - "tests/licence-issuer.test.ts: 11 tests incl. issued-licence-verifies tracer and key-custody guards"
affects: [14-06, 14-07, 14-20, 14-21]

estimate:
  tokens: 55000
  raw_tokens: 55000
  tasks: 2
  confidence: low
actuals:
  tokens: 10300
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Provider tool imports the verifier's format module by relative path so signer and verifier cannot drift"
    - "Key custody enforced in code: repository-path refusal (real-path aware), no-overwrite (wx flag), no key in any return value or output"

key-files:
  created:
    - provider-tools/licence-issuer/issue.ts
    - provider-tools/licence-issuer/cli.ts
    - provider-tools/licence-issuer/README.md
    - provider-tools/licence-issuer/RUNBOOK.md
    - tests/licence-issuer.test.ts
  modified:
    - .dockerignore

key-decisions:
  - "Grace is computed in the generator as expiresAt + graceDays x 86400000 ms (UTC), default 14, whole non-negative days only; the LMS never adds grace (D-10, D-11)."
  - "assertOutsideRepo resolves symlinks and Windows short names on the nearest existing ancestor before comparing, so a symlinked or 8.3-named path cannot slip into the repository."
  - "The issue command refuses to overwrite an existing licence file (flag wx), mirroring the key no-overwrite rule."
  - "CLI instants must be ISO-8601 with Z or an offset; date-only and zone-less inputs are rejected as ambiguous."
  - "The runbook uses only the term restricted continuity mode for the post-grace state, and states the OQ1 option-a decision in one paragraph."

patterns-established:
  - "PEM marker text is assembled at runtime in tests so no checked-in file contains it"

requirements-completed: []

coverage:
  - id: LIC-01-issuer
    description: "A licence issued by the provider CLI verifies with the LMS verifier; grace defaults to 14 UTC days; bad inputs fail before signing; key custody guards hold"
    requirement: "LIC-01"
    verification:
      - kind: test
        ref: "tests/licence-issuer.test.ts (11 tests) and tests/licence-purity.test.ts (18 tests): 29 passed"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 05: Provider-side Licence Issuer Summary

**Provider-only Ed25519 licence issuer (keygen, issue, verify, inspect) that signs through the verifier's own format module, refuses any key path inside the repository, is excluded from Docker images, and ships with a full lifecycle runbook.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-10-01
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 auto, both TDD)
- **Files created:** 5, modified: 1

## Accomplishments

- Tracer: a key generated under a temp directory signs a licence through `encodeLicenceEnvelope` / `licencePayloadSchema` (relative import `../../src/server/licence/format`), and `verifyLicence` accepts it in `activate` mode. `payload.graceEndsAt - payload.expiresAt` is exactly 14 x 86,400,000 ms by default, 30 x when `graceDays` is 30, and 0 when 0. Tracer gate: the automated verify was re-run and passed before expansion.
- `issueLicence` validates before signing: `expiresAt` not after `issuedAt`, negative or fractional `graceDays`, unknown IANA time zone, a licence id outside `A-Za-z0-9._-`, a bad key id, an invalid date and `notBefore` after expiry all throw.
- Key custody (T-14-05-01): `assertOutsideRepo` rejects the repository root, absolute and relative paths inside it and non-existent paths inside it; `generateKeyPairToFile` writes mode 0600 with the `wx` flag (existing file refused, content verified unchanged), returns only `{ kid, publicJwkX, trustSetEntry }`; `loadPrivateKey` refuses repository paths and non-Ed25519 keys. The CLI keygen/issue output was asserted not to contain the PEM body or the marker text.
- CLI end to end (spawned with `npx tsx`, shell true): keygen, issue (prints the UTC instants and `graceEndsAt = expiresAt + 14 x 24 h`), verify (`OK`, and `REJECTED: WRONG_DEPLOYMENT` with exit 1), inspect (labelled UNVERIFIED; prints licence id, client, deployment id and the four UTC instants), keygen overwrite refusal and an unknown command printing usage and exiting 2.
- `.dockerignore` gained the line `provider-tools`; a test asserts it, scans `provider-tools` for the PEM marker and scans every runtime import under `src` and `netlify` (using `runtimeImports`) for a `provider-tools` specifier (zero found, with a non-vacuous probe).
- RUNBOOK.md has all eight required headings plus "Purpose and custody", "Behaviour without a licence" (OQ1 option-a paragraph) and "Things the generator must never do"; it states that revocation before expiry is not possible (D-01), that every production licence is `UNKNOWN_KEY` until the public key ships in `PRODUCTION_TRUSTED_KEYS`, and uses only the term restricted continuity mode.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): issue.ts, cli.ts, tracer and guard tests. Commit: none (owner policy)
2. Task 2: RUNBOOK.md, README.md, `.dockerignore`, custody and handover tests. Commit: none (owner policy)

## Verification Results (real output)

- `npx vitest run tests/licence-issuer.test.ts tests/licence-purity.test.ts --project node`: 2 files passed, 29 tests passed, 0 failed (about 33 s; the CLI test spawns `npx tsx` five times).
- Tracer-only run before expansion (`-t tracer`): 6 passed, 5 skipped.
- `npx tsc --noEmit`: exit 0, 0 errors (the 15 errors reported by 14-02 no longer appear; the project is at 0 as the owner stated). `tsconfig.json` includes `**/*.ts`, and `npx tsc --noEmit --listFilesOnly` confirms `provider-tools/licence-issuer/issue.ts`, `cli.ts` and `tests/licence-issuer.test.ts` are type-checked, so no tsconfig change was needed.
- `npx eslint provider-tools tests/licence-issuer.test.ts`: exit 0, no output.
- `git status` shows no key or licence file in the repository; all test keys lived under `os.tmpdir()` and were removed in `afterAll`.

## Deviations from Plan

None - plan executed exactly as written. Judgement calls within the plan's intent are listed below.

### Judgement calls (not rule violations)

- `graceDays` must be a whole non-negative number (the plan says only "negative throws"); fractional days would blur the "24-hour days" rule.
- `assertOutsideRepo` returns the resolved path (the plan lists no return) and resolves real paths so symlinks and Windows 8.3 names are compared correctly.
- `issue` refuses to overwrite an existing licence output file, and CLI instants require a `Z` or offset. Both are small safety additions.
- The CLI test quotes arguments manually because `execFileSync` with `shell: true` concatenates arguments and the repository path contains a space; the CLI is run by relative path with `cwd` set to the repository root.
- `actuals.tokens` (about 10,300) is chars/4 over the final content of the created and modified files, well below the 55,000 estimate.

## Auth Gates

None.

## Known Stubs

None. `PRODUCTION_TRUSTED_KEYS` remains intentionally empty (D-03); the runbook states that every production licence is `UNKNOWN_KEY` until the provider runs keygen and releases the public key.

## Threat Flags

None. No network endpoint, auth path or schema change was added. T-14-05-01 (key in repo or image), T-14-05-02 and T-14-05-03 mitigations are covered by tests; T-14-05-04 and T-14-05-SC are accepted as planned (no package was installed).

## Issues Encountered

None.

## Next Phase Readiness

Plan 14-06 and later plans can rely on a working issuer to mint real licence files for manual UAT once the provider generates a key and adds its public half to the trust set (a provider action, not repository work). Plan 14-20 should cite RUNBOOK.md's time rules in the licence contract text.

## Self-Check: PASSED

- FOUND on disk: provider-tools/licence-issuer/{issue.ts,cli.ts,README.md,RUNBOOK.md}; tests/licence-issuer.test.ts; `.dockerignore` contains the exact line `provider-tools`.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run. No database command and no private key written to the repository.
