---
status: diagnosed
trigger: "Diagnose Phase 13 UAT gap G-13-2: a deliberately long recipient expands the admin Email Log table and pushes columns off-screen at desktop width, although error truncation and Resend work. Diagnose only; do not implement."
created: 2026-09-30T00:20:00+01:00
updated: 2026-09-30T00:27:00+01:00
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: "Bohrbug (deterministic automatic-table-layout/intrinsic-width failure)"
hypothesis: "CONFIRMED: EmailLogTable's recipient column makes its raw address a non-wrapping mono td with no width/max-width/truncate constraint. ResourceTable's desktop auto-layout table honors that intrinsic minimum width, expands, and scrolls later columns out of view."
test: "Compare the Email Log source with emitted CSS and focused test coverage; inspect the expected base commit to distinguish current UAT-target code from later edits."
expecting: "Confirmed source semantics: whitespace-nowrap inherits to raw recipient text; truncate has text-overflow, nowrap, and overflow:hidden but is absent from recipient; table-fixed is absent on the table."
fault_tree:
  code: "Raw recipient + mono:true adds whitespace-nowrap with no width/max-width/truncate. Confirmed."
  config: "Tailwind truncation or responsive utilities generate incorrectly. Eliminated: emitted CSS has correct truncate/whitespace-nowrap/overflow-x-auto semantics, and error truncation passes UAT."
  environment: "Browser-specific desktop behavior. Not required: automatic table layout and the current generated utilities fully predict the real-browser UAT result."
  data: "An unusually long address exposes the defect but is not malformed; the contract explicitly requires this input class to truncate."
and_gate: "yes — the off-screen-column symptom needs both the recipient's unbounded non-wrapping intrinsic width and the shared desktop table's automatic-layout/no-column-width behavior. The minimal repair is local because constraining the recipient resolves the conjunction without changing shared-table behavior."
next_action: "Return the diagnosis-only root-cause report to the orchestrator; do not modify application or UAT files."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: "In the admin Email Log, very long recipient and error values truncate inside their columns without widening the table, pushing columns off-screen, or breaking surrounding layout."
actual: "Manual UAT found that a deliberately long recipient address expands the desktop table and pushes Status, Attempts, Next attempt, Last error, Created, and Actions off-screen. The long error truncates and Resend works."
errors: "No runtime error reported."
reproduction: "Open the admin Email Log at desktop width with a row containing an unusually long recipient address, then observe whether later columns remain visible and the recipient is truncated."
started: "Observed during Phase 13 manual UAT; exact introduction date unknown."

## Eliminated
<!-- APPEND only - prevents re-investigating -->


## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: "2026-09-30T00:20:00+01:00"
  checked: "Separate-debug-session creation"
  found: "This session is scoped solely to G-13-2 and does not modify application, UAT, or plan files."
  implication: "The G-13-1 diagnosed session remains independent."

- timestamp: "2026-09-30T00:21:00+01:00"
  checked: "Phase 0 semantic recall fallback"
  found: "No MemPalace CLI is installed and .planning/debug/knowledge-base.md is absent."
  implication: "No previous resolution is available as a candidate; investigation proceeds from repository evidence."

- timestamp: "2026-09-30T00:22:00+01:00"
  checked: "Email Log/ResourceTable inventory and exact UAT/UI-SPEC references"
  found: "EmailLogTable.tsx uses the shared ResourceTable; test 66 explicitly defers the 200-character recipient/error layout assertion to a real browser. UAT confirms only recipient overflows while error truncates and Resend works."
  implication: "The differential symptom points to recipient-cell/table sizing, not a general table, action, or error-text truncation failure."

- timestamp: "2026-09-30T00:23:00+01:00"
  checked: "Complete EmailLogTable.tsx and visible shared-table source"
  found: "The Email Log recipient column returns raw row.toEmail with mono:true and no width, max-width, overflow, white-space, or text-overflow rule. In contrast, Last error returns a block span with max-w-[220px] truncate and a title."
  implication: "The only column that overflows lacks the same constraining/truncation mechanism that makes the error column pass UAT; inspect ResourceTable to confirm its automatic width behavior."

- timestamp: "2026-09-30T00:24:00+01:00"
  checked: "Complete ResourceTable desktop table render"
  found: "Desktop rendering uses a w-full table without table-fixed inside an overflow-x-auto wrapper. A Column's width is optional and emits a col style only when supplied. mono:true applies font-mono text-sm whitespace-nowrap tabular-nums to the td; EmailLogTable supplies no width to any of its columns."
  implication: "The recipient's inherited whitespace-nowrap creates a large intrinsic minimum width in an automatic-layout table. The table grows and its wrapper scrolls horizontally, so later columns leave the viewport exactly as UAT reports."

- timestamp: "2026-09-30T00:25:00+01:00"
  checked: "Focused test coverage and existing generated Tailwind CSS (no new build)"
  found: "EmailLogTable tests exercise filters, state copy, Resend, and accessibility using an ordinary recipient; no long-recipient layout assertion exists. ResourceTable tests note jsdom applies no CSS. Generated CSS confirms whitespace-nowrap means white-space:nowrap, truncate adds ellipsis/nowrap/overflow:hidden, table-fixed would set table-layout:fixed, and overflow-x-auto scrolls horizontally."
  implication: "The observed differential is mechanically explained: Last error has max-w-[220px] truncate, but recipient has neither constraint nor truncation. Existing tests cannot measure the real-browser table width or column visibility."

- timestamp: "2026-09-30T00:25:00+01:00"
  checked: "SBFL applicability and common-pattern classification"
  found: "There is no failing automated browser-layout test and no per-test layout coverage spectrum; the matching pattern is a deterministic CSS/intrinsic-sizing conflict rather than async, state, or data-contract behavior."
  implication: "SBFL is skipped by its documented preconditions. Working backward from the off-screen columns localizes the fault to recipient width contribution in the desktop table."

- timestamp: "2026-09-30T00:26:00+01:00"
  checked: "Expected base commit 096970d59b5f10fe3bd2da2b8c573623df4ef6f5"
  found: "EmailLogTable.tsx and its focused test are untracked in the current worktree and do not exist at the named base commit, so the base cannot compare this newly introduced Phase 13 implementation."
  implication: "The diagnosis is based on the present UAT target and its generated CSS, not an incorrect diff against the earlier base."

- timestamp: "2026-09-30T00:27:00+01:00"
  checked: "Root-cause falsification test"
  found: "The source shows the recipient is raw non-wrapping text without a width/max-width/truncate constraint, while the error text has max-w-[220px] truncate. ResourceTable confirms automatic layout with no recipient col width."
  implication: "The hypothesis is confirmed. It would be falsified if the recipient had a constraining child or column width, or if the desktop table used table-fixed; neither is present."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "The Email Log recipient column renders raw toEmail with mono:true. ResourceTable translates mono:true into inherited whitespace-nowrap on the td, but EmailLogTable supplies neither a column width nor a max-width/truncate wrapper. In ResourceTable's default automatic-layout desktop table, the long non-wrapping address supplies an unbounded intrinsic minimum width, expanding the table; its overflow-x-auto wrapper then scrolls Status through Actions off-screen. Last error avoids this because it alone renders a max-w-[220px] truncate span."
fix: "Diagnosis only. Minimal direction: retain the recipient's mono styling but render it in the same bounded truncate+title pattern as Last error (and optionally declare the matching recipient column width); add a browser-capable long-recipient regression check."
verification: "Root cause confirmed from the current EmailLogTable/ResourceTable source, existing generated Tailwind CSS, and UAT's real-browser differential (recipient fails; bounded error succeeds). No application change was made in diagnosis-only mode."
files_changed: []
