---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 01
subsystem: planning
tags: [decisions, nfr-09, nfr-11, captions, webvtt, privacy, permissions, ownership]

requires:
  - phase: 04.1-design-system-rollout-modern-ui-across-every-existing-surfac
    provides: 04.1-CAPTIONS-SCOPE.md (narrow WebVTT scope carried to Phase 15)
  - phase: 14-software-licence-deployment-control
    provides: 14-DECISIONS.md precedent format; licence effect classification (LICENCE_PERMISSION_EFFECT)
provides:
  - 15-DECISIONS.md with the owner's NFR-09 accessible media decision (option-a, build narrow WebVTT captions)
  - 15-DECISIONS.md with the owner's privacy tool decision (option-a, new Global-only `privacy.manage`, conservative retention keep-list, hard deletion blocked)
  - Adopted assumptions ledger (OQ2-OQ4, OQ6-OQ8, OQ10, A2, A5-A16, A18, P-01 to P-11)
  - Shared UI ownership table (12 rows "pending", 1 consumed-only row "not needed")
  - Edge coverage (19 rows), prohibition (P1-P7) and UI-considerations (31 covered, 6 backstop, 3 unresolved) index
affects: [15-03, 15-05, 15-10, 15-13, 15-16, 15-18, 15-19, 15-20, 15-21, 15-22, 15-23, 15-24, 15-31, 15-32, 15-33]

actuals:
  tokens: 5200
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Decision record plus adopted-assumptions ledger, each row naming the dependent plan and a redirect instruction (Phase 14 precedent)"
    - "Shared UI ownership rows gate editing tasks through preconditions until the owner records 'agreed'"

key-files:
  created:
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/15-DECISIONS.md
  modified: []

key-decisions:
  - "NFR-09: owner chose option-a, build narrow WebVTT caption tracks (plans 15-23 and 15-24 execute; no waiver)"
  - "D-12 privacy tool: owner chose option-a, new Global-only permission privacy.manage; conservative retention keep-list accepted unchanged; hard deletion stays blocked"

patterns-established:
  - "Owner gate replies are transcribed verbatim with a Meaning, Edit list and Read-by section"

requirements-completed: [NFR-09, NFR-11]

coverage:
  - id: D1
    description: "15-DECISIONS.md exists with the five exact H2 headings, both verbatim owner replies, the ledger rows, the shared UI ownership rows and the index"
    verification:
      - kind: other
        ref: "plan 15-01 Task 3 <verify> node -e heading/ledger/ownership check"
        status: pass
    human_judgment: false
  - id: D2
    description: "NFR-09 accessible media decision recorded (option-a)"
    requirement: NFR-09
    verification: []
    human_judgment: true
    rationale: "Owner decision transcription; the owner confirms the recorded meaning matches their intent"
  - id: D3
    description: "Privacy tool permission (privacy.manage, Global only) and retention parameters recorded (option-a); no deletion option"
    requirement: NFR-11
    verification: []
    human_judgment: true
    rationale: "Owner decision transcription and policy wording; human confirms the keep-list is what they approved"
  - id: D4
    description: "Shared UI ownership rows await co-worker agreement (all 'pending')"
    verification: []
    human_judgment: true
    rationale: "Only the owner can record 'agreed' after confirming with the co-worker"

duration: 3 min
completed: 2026-10-06
status: complete
---

# Phase 15 Plan 01: Owner Decisions and Adopted-Assumptions Ledger Summary

**15-DECISIONS.md records the owner's two gate answers (NFR-09: build narrow WebVTT captions; privacy tool: new Global-only `privacy.manage` with the conservative keep-list and no deletion), a 32-row adopted-assumptions ledger, a 13-row shared UI ownership table awaiting co-worker agreement, and a full edge, prohibition and UI-considerations index.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-10-06T18:46:42Z
- **Completed:** 2026-10-06T18:49:18Z
- **Tasks:** 3 (2 owner decision gates answered in session, 1 transcription task)
- **Files modified:** 1 created

## Accomplishments

- Task 1 (NFR-09 accessible media decision): owner reply `option-a` transcribed verbatim; plans 15-23 and 15-24 will build the caption resource, `text/vtt` upload, player track, staff upload and publish-time warning. No waiver.
- Task 2 (privacy tool permission and retention decision): owner reply `option-a` transcribed verbatim; plan 15-16 uses the identifier `privacy.manage` (Global only, joins `GLOBAL_ONLY_PERMISSIONS`); anonymise is write, export is continuity; the CHANGES / REMOVES / KEEPS lists are recorded for the policy constant; hard deletion is explicitly blocked.
- Task 3: ledger rows OQ2, OQ3, OQ4, OQ6, OQ7, OQ8, OQ10, A2, A5 to A16, A18 and P-01 to P-11, each with dependent plan and redirect instruction; shared UI ownership table with every agreement cell "pending" (12 rows) or "not needed" (consumed-only row); index of 19 edge-probe rows, P1 to P7 and the 40 UI-SPEC rows mapped to plans.

## Task Commits

Not committed (owner commits explicitly).

1. **Task 1: Decide how NFR-09 accessible media is met** - owner decision, no file change of its own (recorded by Task 3)
2. **Task 2: Choose the privacy tool permission and retention parameters** - owner decision, no file change of its own (recorded by Task 3)
3. **Task 3: Write 15-DECISIONS.md** - not committed (owner commits explicitly)

**Plan metadata:** not committed (owner commits explicitly)

## Files Created/Modified

- `.planning/phases/15-launch-readiness-nfr-verification-operational-cutover/15-DECISIONS.md` - owner decisions, adopted-assumptions ledger, shared UI ownership, edge/prohibition/UI-considerations index

## Decisions Made

- NFR-09: `option-a` (build narrow WebVTT caption tracks). Answered by the owner in the orchestrator session on 2026-10-06.
- Privacy tool: `option-a` (new `privacy.manage`, Global only; proposed retention parameters unchanged). Answered by the owner in the orchestrator session on 2026-10-06.
- Shared UI ownership cells were written "pending" as the plan requires. The orchestrator reports that the owner has confirmed the co-worker agreed every row; the orchestrator applies that change to "agreed" separately (not done by this executor).

## Deviations from Plan

None - plan executed exactly as written. Run overrides applied (not plan deviations): no git commits or staging (owner commits explicitly); the two blocking-human checkpoints were not returned because the owner had already answered them in session, and the replies were transcribed verbatim.

Note on the ledger: RESEARCH assumptions A1, A3, A4 and A17 are not ledger rows because the plan's row list excludes them (A3 is covered by OQ3); this is stated in the ledger preamble.

## Issues Encountered

- `requirements.ready-ids` (called with both positional arguments) returned `ready: []`, `blocked: [NFR-09, NFR-11]` because sibling plans (15-05, 15-10, 15-16, 15-19 to 15-24, 15-28, 15-31 to 15-33) also declare them and have no SUMMARY yet. Neither requirement was marked complete in REQUIREMENTS.md; they become ready when the last declaring plan finishes. `requirements-completed` in this frontmatter copies the plan's list as the template requires.

- `state.update-progress` skipped with "phase scope is unscoped, not complete", leaving the STATE.md Progress field unchanged. STATE.md was not edited by hand. `state.advance-plan` (now plan 2 of 33), `state.record-metric`, `state.add-decision` (two decisions), `state.record-session` and `roadmap.update-plan-progress 15` (1 of 33 summaries, In Progress) all succeeded.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 15-16, 15-21 and 15-22 can read the permission identifier and retention parameters without asking again.
- Plans 15-23 and 15-24 pass their NFR-09 precondition (option-a).
- Every shared-UI editing task (15-05, 15-10, 15-13, 15-18, 15-19, 15-20, 15-22, 15-23, 15-24, 15-32, 15-33) halts on its precondition until its row in "Shared UI ownership" reads "agreed".
- The caption schema migration from 15-23 must be added to the Neon go-live list (plan 15-31).

---
*Phase: 15-launch-readiness-nfr-verification-operational-cutover*
*Completed: 2026-10-06*

## Self-Check: PASSED

- FOUND: .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/15-DECISIONS.md
- Task 3 `<verify>` command: exit 0 (all five headings, ledger ids and ownership rows present)
- Acceptance: all 32 ledger ids present; 0 "agreed" cells, 12 "pending", 1 "not needed"; P1 to P7 present; 19 edge rows with an owning plan; both replies `option-a` verbatim; `privacy.manage` in backticks; no deletion option
- No files under src/ changed; `git diff --cached` empty (nothing staged); no commits made (by override, so no hashes to check)
