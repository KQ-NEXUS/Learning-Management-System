---
phase: 14-software-licence-deployment-control
plan: 01
subsystem: licensing
tags: [licence, ed25519, decision-record, governance]

requires:
  - phase: 14-software-licence-deployment-control
    provides: CONTEXT.md locked decisions D-01..D-17 and RESEARCH.md open questions and assumptions
provides:
  - "D-02 contract decision: compact LMS-LIC1 envelope approved as written (option-a)"
  - "OQ1 never-activated decision: operational until first activation, then permanent enforcement (option-a), named NEVER_ACTIVATED_POLICY"
  - "Adopted assumptions ledger (OQ2-OQ8, A4, A5, A7-A15) with redirect instructions"
  - "Per-plan edge coverage and prohibition index (P1-P5, LIC-01..LIC-08 unclassified items)"
affects: [14-02, 14-03, 14-04, 14-05, 14-06, 14-07, 14-09, 14-10, 14-12, 14-13, 14-14, 14-15, 14-16, 14-17, 14-20, 14-21]

actuals:
  tokens: 3800
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns: ["Human decision record with verbatim owner replies, mirroring 11-DECISIONS.md"]

key-files:
  created:
    - .planning/phases/14-software-licence-deployment-control/14-DECISIONS.md
    - .planning/phases/14-software-licence-deployment-control/14-01-SUMMARY.md
  modified: []

key-decisions:
  - "D-02 contract (owner reply: option-a): schema version 1, LMS-LIC1.{header}.{payload}.{signature}, Ed25519, key-ID trust set with active/retired/revoked, client pinned at first activation, anti-replay by issuedAt. Plans 14-02 and 14-05 read this."
  - "OQ1 never-activated (owner reply: option-a): fully operational until first activation, then enforcement permanent via everActivated; implemented as the policy constant NEVER_ACTIVATED_POLICY in plan 14-04. Plans 14-03, 14-04, 14-06 read this."
  - "All other open questions (OQ2-OQ8, A4, A5, A7-A15) adopted at RESEARCH-recommended defaults and recorded in the ledger, each with a redirect instruction."

patterns-established:
  - "One-way doors are gated with checkpoint:decision gate=blocking-human and the answer is transcribed verbatim before dependent plans run"

# Requirements LIC-01 and LIC-05 are declared by this plan but are shared with later Phase 14 plans;
# `requirements ready-ids` reported both as blocked, so none are marked complete here.
requirements-completed: []

coverage:
  - id: D1
    description: "14-DECISIONS.md with D-02 and OQ1 owner replies, ledger and edge/prohibition index"
    requirement: "LIC-01"
    verification:
      - kind: other
        ref: "node -e heading check from 14-01-PLAN.md Task 3 (exit 0)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 01: Decision Gates Summary

**Owner approved the compact Ed25519 LMS-LIC1 licence contract and the "fully operational until first activation" never-activated policy, and both are now recorded verbatim in 14-DECISIONS.md with the adopted-assumptions ledger and the edge/prohibition index.**

## Performance

- **Duration:** about 20 min (continuation: Task 3 plus tracking; Tasks 1-2 were human gates resolved by the orchestrator)
- **Completed:** 2026-10-01
- **Tasks:** 3 of 3 (Tasks 1 and 2 resolved by the owner, Task 3 executed)
- **Files created:** 2 (decision record and this summary)

## Accomplishments

- Recorded the D-02 contract decision (owner reply `option-a`, no edits) with the full approved contract so plans 14-02 and 14-05 need ask nothing further.
- Recorded the OQ1 decision (owner reply `option-a`) and named the policy constant `NEVER_ACTIVATED_POLICY` for plan 14-04.
- Wrote the ledger table covering OQ2 to OQ8, A4, A5 and A7 to A15 (every row carries a redirect instruction).
- Indexed the LIC-01..LIC-08 edge items and prohibitions P1 to P5 against their owning plans.

## Task Commits

None. Owner policy: commits only on explicit request, and none was made. All changes remain in the working tree.

1. Task 1 (checkpoint:decision, D-02): resolved by owner, no files, commit none
2. Task 2 (checkpoint:decision, OQ1): resolved by owner, no files, commit none
3. Task 3 (record decisions): 14-DECISIONS.md created, commit none (owner policy: commits only on explicit request)

## Files Created/Modified

- `.planning/phases/14-software-licence-deployment-control/14-DECISIONS.md` - human decision record, ledger, index
- `.planning/phases/14-software-licence-deployment-control/14-01-SUMMARY.md` - this summary

## Decisions Made

See key-decisions above. Owner replies are transcribed verbatim in 14-DECISIONS.md under "D-02 contract decision" and "OQ1 never-activated decision".

## Deviations from Plan

None - plan executed as written. Minor note: ledger rows A12, A13 and A15 appear both inside their combined OQ rows (OQ8/A12, OQ4/A13, OQ6/A15) and as standalone rows so every id named in the acceptance criteria has its own row.

## Auth Gates

None.

## Known Stubs

None (documentation only).

## Threat Flags

None.

## Issues Encountered

None.

## Next Phase Readiness

Plans 14-02 (format and verify), 14-03 (migration default), 14-04 (state derivation and NEVER_ACTIVATED_POLICY) and 14-05 (provider tool) may start; neither one-way door needs further input.

## Self-Check: PASSED

- FOUND: `.planning/phases/14-software-licence-deployment-control/14-DECISIONS.md` (four exact H2 headings, ledger ids OQ2-OQ8, A4, A5, A7-A15 and NEVER_ACTIVATED_POLICY present; plan verify command exit 0)
- FOUND: `.planning/phases/14-software-licence-deployment-control/14-01-SUMMARY.md`
- Commits: none by owner policy; `git status --short` shows no staged files from this plan.
