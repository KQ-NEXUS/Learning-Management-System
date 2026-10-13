---
phase: 14-software-licence-deployment-control
plan: 20
subsystem: licensing
tags: [licence, documentation, wording-consistency, prd-amendment, restricted-continuity-mode, d-08a, lic-05, lic-08]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-06 policy.ts RESTRICTED_CONTINUITY_LABEL (the single phrase owner); 14-12 to 14-19 licence-owned source, tests, runbook and deployment doc; 14-DECISIONS.md and 14-RESEARCH.md amendment map"
provides:
  - "tests/licence-wording.test.ts: automated wording-consistency check (groups licence-owned, tracked-docs, prd-18, prd-19, pxr, phrase-owner, amendment-record; 35 tests)"
  - "PRD sections 1.2 (row 5), 18.2, 18.3 (LIC-05, LIC-08), 18.6, 19.4, 19.5 and PXR sections 11.1, 11.3, 11.4, 12.4 and handoff amended to restricted continuity mode (local-only files)"
  - "REQUIREMENTS.md, ROADMAP.md and intel/requirements.md use the new wording; catalogue.ts comment no longer says the licence module is deferred"
  - "14-PRD-AMENDMENT.md: tracked 16-row record of every PRD and PXR edit, with the gitignore finding and owner follow-ups"
affects: [14-21]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low
actuals:
  tokens: 14000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Banned wording is built at run time from fragments with word boundaries and a required separator, so no scanned file (including the test itself) contains it; a self-test and recogniser fixtures prove the pattern can fail and cannot match its own file"
    - "Single-definition check by TypeScript compiler API: only string, template and (not comment) literal text under src is inspected, with a raw-text pre-filter so the whole-tree scan stays fast"
    - "Groups over gitignored documents skip with a visible title suffix when the file is absent; tracked planning documents are always checked"

key-files:
  created:
    - tests/licence-wording.test.ts
    - .planning/phases/14-software-licence-deployment-control/14-PRD-AMENDMENT.md
  modified:
    - docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md
    - docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/intel/requirements.md
    - src/server/permissions/catalogue.ts
    - src/server/licence/registry.ts
    - src/server/licence/types.ts
    - tests/components/licence-banner.test.tsx
    - tests/components/licence-restriction.test.tsx
    - tests/licence-effects.test.ts
    - tests/licence-status-view.test.ts

key-decisions:
  - "The banned pattern requires a hyphen or space between the two words and word boundaries (the plan's optional separator would match the TypeScript readonly keyword used in licence-owned files such as registry.ts, and 'thread only')"
  - "Thirteen enforcement-registry reason strings carried the phrase as literals outside policy.ts; they were reworded to 'blocked once the deployment is restricted' rather than importing policy.ts into the data-only registry"
  - "PRD revision row 5 mentions the retired wording once, as history (the revision-history table is exempt); every other amended line is free of it"

patterns-established:
  - "A new licence-owned file, doc line or src literal that reintroduces the retired wording or redefines the phrase fails tests/licence-wording.test.ts"

requirements-completed: []

coverage:
  - id: C1
    description: "D-08a wording check: no licence-owned source, test, runbook or deployment-doc line (Licence check section) uses the banned wording; the scan covers 40+ files and cannot pass vacuously"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-wording.test.ts licence-owned: (5 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "Tracked planning documents (REQUIREMENTS.md, ROADMAP.md, intel/requirements.md) use restricted continuity mode on every licence-context line; LIC-05, LIC-08, roadmap entry and criterion 3, catalogue comment asserted"
    requirement: "LIC-08"
    verification:
      - kind: unit
        ref: "tests/licence-wording.test.ts tracked-docs: (7 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "PRD 18.2, LIC-05, LIC-08, 18.6, revision row 5, 19.4 and 19.5 state D-06 to D-08 (what continues, what is blocked, in-flight payments complete, contract controls)"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-wording.test.ts prd-18: (6 tests) and prd-19: (3 tests) (pass; the files were present, nothing skipped)"
        status: pass
    human_judgment: true
  - id: C4
    description: "PXR 11.1, 11.3 (header and four rows), 11.4 step 5, 12.4 and the handoff aligned with D-06 to D-08; grading and certificate actions no longer 'Blocked'"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-wording.test.ts pxr: (8 tests) (pass; the file was present, nothing skipped)"
        status: pass
    human_judgment: true
  - id: C5
    description: "Single definition of the phrase: no string or template literal under src contains it outside policy.ts (comments ignored), policy.ts defines it once"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-wording.test.ts phrase-owner: (3 tests incl. fixtures) (pass)"
        status: pass
    human_judgment: false
  - id: C6
    description: "Tracked amendment record lists every PRD and PXR edit (16 data rows) with the gitignore finding, contract statement and owner follow-ups"
    requirement: "LIC-08"
    verification:
      - kind: unit
        ref: "tests/licence-wording.test.ts amendment-record: (3 tests) (pass)"
        status: pass
    human_judgment: false
  - id: C7
    description: "Owner actions that cannot be automated: regenerate the .docx twins of the PRD and PXR (OQ7), align the commercial contract wording, place the local-only PRD and PXR under review or version control"
    requirement: "LIC-05"
    verification:
      - kind: manual
        ref: "14-PRD-AMENDMENT.md closing section (owner action, not run)"
        status: not-run
    human_judgment: true

duration: ~35min
completed: 2026-10-02
status: complete
---

# Phase 14 Plan 20: PRD Amendment and Wording-Consistency Check Summary

**The PRD, PXR and tracked planning documents now describe the post-grace state as restricted continuity mode (grading, certificates, refunds, webhooks and exports continue; new checkout blocked; in-flight payments complete), guarded by a 35-test wording check over licence-owned files, licence doc lines and the single definition of the phrase.**

## Performance

- **Duration:** about 35 min
- **Completed:** 2026-10-02
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 2 created, 12 modified (two of the modified files are local-only and gitignored)

## Accomplishments

- Tracer: `tests/licence-wording.test.ts` groups `licence-owned:`, `prd-18:` and `phrase-owner:` written first and run RED (9 of 14 failing: seven banned-wording hits in licence-owned files, the missing section 18.2 row, LIC-05, LIC-08, the 18.6 row, the missing revision row 5, and thirteen phrase literals in `registry.ts`), then the PRD section 18 amendments and the code fixes made them pass (14 of 14).
- PRD amended with exact-text edits (CRLF line endings preserved): revision-history row 5 (1 Oct 2026, "Amendment (user-directed, Phase 14)", states the contract controls any remaining discrepancy; rows 1 to 4 untouched), the section 18.2 row "Restricted continuity mode (after the grace period)" (application-level mode, never a database-wide switch; blocked and always-allowed lists per D-06 to D-08; in-flight payment completes; nothing deleted), LIC-05, LIC-08, the 18.6 post-expiry row, the 19.4 "Software licence interaction" row (replaces the text that blocked payment confirmation, refunds and enrolment activation) and the 19.5 test-matrix row.
- PXR aligned: 11.1 state row, 11.3 header and the four rows that contradicted D-06 (including the attendance, grading and certificate row, previously "Blocked"), 11.4 step 5, the 12.4 licence row and the implementation handoff. The 11.3 publish and settings rows and the staff rows were already "Blocked" with `licence.activate` as the recovery control and were left unchanged.
- Planning documents: LIC-05 and LIC-08 in REQUIREMENTS.md, the Phase 14 roadmap entry and success criterion 3, the two mirrored entries in `.planning/intel/requirements.md`, and the `catalogue.ts` comment (no longer says the licence module is deferred).
- `14-PRD-AMENDMENT.md`: tracked table (16 data rows, document, section, old text, new text) so the local-only PRD and PXR edits can be reviewed without git.
- Wording test also carries fixtures proving the scanner can fail: banned-pattern recogniser cases (hyphen, space, upper case match; the TypeScript modifier and "thread only" do not), literal, template and JSX-attribute hits found and comments ignored, plus a self-test that the test file never contains the banned wording.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): wording test groups, PRD section 18 amendments, code and test wording fixes. Commit: none (owner policy)
2. Task 2: PRD 19.4 and 19.5, PXR alignment, `prd-19:` and `pxr:` groups. Commit: none (owner policy)
3. Task 3: planning documents, catalogue comment, amendment record, `tracked-docs:` and `amendment-record:` groups. Commit: none (owner policy)

TDD gate: no `test(...)` or `feat(...)` commits exist (commits prohibited by owner policy). RED was observed on disk for Task 1 (9 failing) and Task 2 (10 failing, 1 already passing) before the document edits; Task 3 documents were edited before the `tracked-docs:` tests were added, so that group has no recorded RED run (the scanner it uses is proven by the Task 1 recogniser fixtures). Tracer gate: auto-chain flag not set, the tracer `<verify>` is automated-only, so it was re-run end to end before the expansion tasks (14 of 14 passed).

## Gitignore finding (visible limitation)

`git check-ignore -v` output, verbatim:

```
.gitignore:65:reference/	docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md
.gitignore:65:reference/	docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
```

The PRD and PXR edits are local-only: git cannot see them and they will not appear in any commit. In both runs here the files were present, so the `prd-18:`, `prd-19:` and `pxr:` groups RAN (nothing skipped); in a checkout without `docs/reference` (for example CI) those three groups skip with the title suffix "(docs/reference is gitignored and absent in this checkout)" while the tracked-docs, licence-owned and phrase-owner groups still run. No `.docx` file was touched.

## Owner actions (not automatable, recorded in 14-PRD-AMENDMENT.md)

1. Regenerate the `.docx` twins of the PRD and PXR from the amended `.md` files (adopted ledger OQ7; manual-only verification in 14-VALIDATION.md).
2. Align the commercial contract wording with restricted continuity mode. The contract is outside the repository and controls any discrepancy (stated in PRD revision row 5).
3. Carry the PRD and PXR edits to wherever they are maintained or version them; git does not track them here. Review them using `14-PRD-AMENDMENT.md`.

## Verification Results (real output)

- Task 1 verify, `npx vitest run tests/licence-wording.test.ts -t "licence-owned:|prd-18:|phrase-owner:"`: 1 file, 14 tests passed.
- Task 2 verify, `npx vitest run tests/licence-wording.test.ts -t "prd-18:|prd-19:|pxr:|licence-owned:"`: 22 passed, 3 skipped (the three `phrase-owner:` tests excluded by the filter, not a document skip).
- Task 3 verify, `npx vitest run tests/licence-wording.test.ts tests/permissions.test.ts` (default timeout): 2 files, 45 passed (35 wording plus 10 permissions). Also green with `--project node` and with `--testTimeout=60000`.
- First run of the whole-tree `phrase-owner:` scan timed out at the default 5 s (10.4 s under machine load, before the fix); fixed in the test, not by hiding it: a raw-text pre-filter limits the syntax-tree walk to files that contain the phrase, and the describe has an explicit 60 s timeout. After that the full file passes at the default timeout (9.1 s total file duration).
- `npx vitest run tests/licence-purity.test.ts --project node` (alone): 28 passed.
- `npx vitest run tests/licence-enforcement-boundary.test.ts --project node` (alone, registry reasons reworded): 41 passed.
- `npx vitest run tests/licence-effects.test.ts tests/licence-status-view.test.ts tests/licence-policy.test.ts --project node`: 3 files, 84 passed; `tests/components/licence-banner.test.tsx` and `tests/components/licence-restriction.test.tsx` (default project): 2 files, 25 passed.
- `npx tsc --noEmit`: no output, 0 errors. No new error.
- `npx eslint` on `tests/licence-wording.test.ts`, `src/server/licence/registry.ts`, `src/server/licence/types.ts`, `src/server/permissions/catalogue.ts` and the four edited test files: exit 0, no findings.
- Acceptance greps: PRD contains `initiated before the restriction` (3 occurrences, including the 19.4 row), `restricted-continuity-mode behaviour` (the 19.5 row) and the row `Restricted continuity mode (after the grace period)`; PXR line 380 header ends `**Restricted continuity mode** |`.
- Not run (owner policy): the full suite and any Testcontainers file; no prisma command or DATABASE_URL access.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-20-PLAN.md LIC-05 LIC-08`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-05",
    "LIC-08"
  ],
  "total": 2
}
```

  No requirement is marked complete: both IDs are blocked because plan 14-21 still declares them (the LIC-05 and LIC-08 proof is owned there).

## Files Created/Modified

See key-files. Documents: the PRD and PXR (local-only), three tracked planning documents, one new tracked record. Code touched only for wording: one comment in `types.ts`, thirteen reason strings in `registry.ts`, one comment in `catalogue.ts`.

## Decisions Made

See key-decisions. Everything else follows the plan: group prefixes as specified, the phrase owner stays `policy.ts`, the old text is quoted only in the amendment record (which the test deliberately does not scan), and no `.docx` was edited.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan premise] The planned banned pattern matches legitimate TypeScript**
- **Found during:** Task 1 (pattern design and first scan)
- **Issue:** the plan builds the pattern from "read", an optional separator and "only". With the separator optional it matches the TypeScript `readonly` modifier (used in licence-owned files, for example `readonly guardOperations` in `registry.ts`) and words such as "thread only".
- **Fix:** the separator is required (hyphen or space) and the pattern is word-bounded; still built at run time from fragments so the test file never contains the wording. A recogniser test proves it matches hyphen, space and upper-case forms and ignores `readonly` and "thread only".
- **Files modified:** `tests/licence-wording.test.ts`
- **Commit:** none (owner policy). Ledger: WINDOWS (deviation).

**2. [Rule 1 - Prior-plan wording defects found by the new check] Retired wording in licence-owned files**
- **Found during:** Task 1 (first RED run of `licence-owned:`)
- **Issue:** seven lines matched: a doc comment in `src/server/licence/types.ts` ("Read-only picture ..."), and six lines in four test files (`licence-banner.test.tsx`, `licence-restriction.test.tsx`, `licence-effects.test.ts`, `licence-status-view.test.ts`) that asserted the wording's absence with a literal regex or named it in a test title.
- **Fix:** comment reworded to "Immutable picture"; the four test files now build the pattern from fragments (same assertions) and their titles say "retired post-grace wording". No assertion weakened.
- **Files modified:** `src/server/licence/types.ts`, `tests/components/licence-banner.test.tsx`, `tests/components/licence-restriction.test.tsx`, `tests/licence-effects.test.ts`, `tests/licence-status-view.test.ts`
- **Commit:** none (owner policy)

**3. [Rule 1 - Prior-plan defect] Phrase literals outside policy.ts in the enforcement registry**
- **Found during:** Task 1 (first RED run of `phrase-owner:`)
- **Issue:** thirteen `reason` strings in `src/server/licence/registry.ts` (14-17) contained the phrase as string literals, contradicting D-06 (single owner) and the plan's phrase-owner rule.
- **Fix:** "blocked in restricted continuity mode" became "blocked once the deployment is restricted" in each reason. `registry.ts` stays pure data with no import (its header requires that); the boundary test only checks reasons are non-empty and the snapshot rows are a different structure, so `tests/licence-enforcement-boundary.test.ts` still passes (41 of 41).
- **Files modified:** `src/server/licence/registry.ts`
- **Commit:** none (owner policy)

**4. [Rule 2 - Missing critical functionality] Whole-tree scan speed**
- The `phrase-owner:` whole-tree scan exceeded the 5 s default under load. Added a raw-text pre-filter and an explicit 60 s describe timeout (see Verification Results).
- **Files modified:** `tests/licence-wording.test.ts`

### Interpretation choices (flag for owner review)

- **Section 11.3 view row and learner row** were reworded (retaining export access, naming the neutral new-enrolment copy), a small extension of the plan's list that keeps the matrix consistent with D-06 and OQ8; both are listed in the amendment record.
- **PRD 18.2 row** also states that a payment initiated before the restriction completes (D-08), an addition to the plan's text so section 18 and section 19 agree.
- **Revision row 5** quotes the retired wording once ("replacing the earlier read-only state") as history; the plan exempts the revision-history table.
- **Staff deactivation (adopted A10)** is continuity, but the PXR 11.3 staff row still says only "Blocked ... licence.activate is the narrowly permitted recovery control". I left it, since the plan listed that row as already consistent; an owner may want a clause for security administration.

**Total deviations:** 4 auto-fixed (3 Rule 1, 1 Rule 2), 4 interpretation notes. **Impact:** three prior-plan wording defects fixed; no interface or behaviour change, only comments, test patterns and reason text.

## Issues Encountered

None blocking. No auth gates, no Rule 4 architectural decisions, no stubs. One shell quirk: the first edits were applied with a Python helper rather than the Edit tool because the PRD and PXR use CRLF line endings; each replacement asserted exactly one match and preserved line endings.

## Known Stubs

None.

## Threat Flags

None. Documentation and test changes only; no endpoint, auth path, file access pattern or schema. T-14-20-01 (wording drift) is mitigated by the automated check and the contract statement in revision row 5; T-14-20-02 (local-only edits) by the visible gitignore finding, the skip suffix and the tracked amendment record; T-14-20-04 by the run-time pattern, the recogniser fixtures and the explicit skip reporting.

## Outstanding Human Steps

Recorded in `.planning/WINDOWS.md` (kind `unrun-verify` for the docx twins, contract alignment and versioning of the local PRD and PXR; kind `deviation` for the pattern change and the registry reason rewording).

## Next Phase Readiness

- Plan 14-21 (the restricted-state proof) can cite `tests/licence-wording.test.ts` as the LIC-05 and LIC-08 wording evidence and `14-PRD-AMENDMENT.md` as the document-side record.
- Any new licence-owned file, tracked planning line or src literal that reintroduces the retired wording or redefines the phrase now fails the wording test.

## Self-Check: PASSED

- FOUND on disk: tests/licence-wording.test.ts, .planning/phases/14-software-licence-deployment-control/14-PRD-AMENDMENT.md, this SUMMARY; the PRD and PXR (local-only) contain the amended rows (grep-verified); every modified file listed in key-files exists and is exercised by the tests above.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run. No prisma command or DATABASE_URL access was used. No `.docx` was touched.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-02*
