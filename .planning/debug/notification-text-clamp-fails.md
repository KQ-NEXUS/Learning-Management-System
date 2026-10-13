---
status: diagnosed
trigger: "Diagnose Phase 13 UAT gap G-13-1: long notification title renders across 3 lines and metadata across 2 lines in the real notification drawer although NotificationItem.tsx includes line-clamp-2 and line-clamp-1 classes. Diagnose only; do not implement."
created: 2026-09-30T00:00:00+01:00
updated: 2026-09-30T00:13:00+01:00
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: "Bohrbug (deterministic CSS cascade conflict)"
hypothesis: "CONFIRMED: the explicit block utility overwrites Tailwind v4 line-clamp's required display: -webkit-box declaration, so the elements wrap naturally instead of being clamped."
test: "Compared the source's combined classes with the emitted Tailwind v4 utility declarations and their actual cascade order in existing .next CSS."
expecting: "Confirmed: .block follows .line-clamp-N at equal specificity, making computed display:block on both text spans."
fault_tree:
  code: "NotificationItem combines block with each line-clamp-N utility. Confirmed."
  config: "Tailwind/PostCSS fails to emit native clamp utilities. Eliminated: emitted CSS contains both native clamp rules."
  environment: "Stale browser asset could independently misrepresent a later fix but is not required: the current emitted target CSS itself has the conflicting cascade."
  data: "Long text exposes the defect but does not cause it; both fields use the same incompatible class pairing."
and_gate: "no — the code-level display override alone deterministically disables both clamps; no second condition is necessary."
next_action: "Return the diagnosis-only root-cause report to the orchestrator; do not modify application or UAT files."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: "In the real notification drawer, notification title text clamps to at most 2 lines and metadata clamps to at most 1 line, per the Phase 13 UI-SPEC."
actual: "During manual UAT, a long notification title rendered across 3 lines and metadata across 2 lines even though NotificationItem.tsx appears to include line-clamp-2 and line-clamp-1 classes."
errors: "No runtime error reported."
reproduction: "Open the real notification drawer with a sufficiently long notification title and metadata value, then observe the rendered line counts."
started: "Observed during Phase 13 manual UAT; exact introduction date unknown."

## Eliminated
<!-- APPEND only - prevents re-investigating -->


## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: "2026-09-30T00:00:00+01:00"
  checked: "Debug-session inventory and project skill directories"
  found: "An unrelated active debug session exists (password-reset-suite-timeout); no project .codex/skills or .agents/skills directories were present."
  implication: "This is a separate diagnosis-only session; no project-specific skill rules apply."

- timestamp: "2026-09-30T00:01:00+01:00"
  checked: "Phase 0 semantic recall fallback and durable knowledge base"
  found: "No MemPalace MCP capability is registered, the mempalace CLI is not installed, and .planning/debug/knowledge-base.md does not exist."
  implication: "No prior internal resolution is available as a candidate; investigation proceeds from repository evidence."

- timestamp: "2026-09-30T00:04:00+01:00"
  checked: "Initial repository path search"
  found: "src/components/notifications/NotificationItem.tsx, postcss.config.mjs, and package.json exist; the initial name glob was insufficient to enumerate drawer, global CSS, and Phase 13 paths."
  implication: "The notification item is present; exact file discovery continues without drawing conclusions from the incomplete glob."

- timestamp: "2026-09-30T00:05:00+01:00"
  checked: "Notification component and drawer-reference inventory"
  found: "The notification UI consists of NotificationBell.tsx, NotificationDrawer.tsx, NotificationItem.tsx, and EmailPreferencesPanel.tsx; notification-drawer references are confined to those UI files plus server/API text/action modules."
  implication: "NotificationDrawer.tsx is the immediate layout ancestor to inspect alongside NotificationItem.tsx; the UI failure is not routed through a separate drawer component."

- timestamp: "2026-09-30T00:06:00+01:00"
  checked: "Global CSS and Tailwind configuration discovery"
  found: "src/app/globals.css imports tailwindcss directly; package.json declares @tailwindcss/postcss ^4 and postcss.config.mjs registers it."
  implication: "The project uses the Tailwind v4 PostCSS pipeline, in which line-clamp support may be a built-in utility rather than a legacy plugin concern."

- timestamp: "2026-09-30T00:07:00+01:00"
  checked: "Complete NotificationItem.tsx and NotificationDrawer.tsx source"
  found: "NotificationItem assigns line-clamp-2 to its title and line-clamp-1 to metadata; both are block spans inside a min-w-0 flex-1 content span. The drawer provides a 400px desktop panel (full-width mobile) and a scrollable list but adds no competing text-overflow declarations."
  implication: "The intended utility class is placed on the text-owning elements, and the immediate drawer markup supplies a finite content width; next inspect emitted CSS, global overrides, and the recorded acceptance evidence."

- timestamp: "2026-09-30T00:08:00+01:00"
  checked: "Phase 13 UI-SPEC and UAT (visible portions)"
  found: "The UI-SPEC's long-text backstop explicitly requires notification titles to clamp at two lines and metadata to one line with ellipsis. The UAT records G-13-1 as a held-out browser failure: three title lines and two metadata lines despite the utility classes."
  implication: "The symptom is a deterministic rendering-contract violation rather than an unspecified visual preference; the original browser reproduction is documented."

- timestamp: "2026-09-30T00:09:00+01:00"
  checked: "Complete globals.css, package.json, and postcss.config.mjs"
  found: "globals.css contains only design tokens, body/heading/focus/animation styles and no span, display, overflow, or line-clamp overrides. package.json pins Next 16.3.4 and Tailwind/PostCSS v4; PostCSS correctly registers @tailwindcss/postcss."
  implication: "A global CSS reset/override is not the mechanism visible in source, and the declared toolchain should generate Tailwind v4's native line-clamp utilities."

- timestamp: "2026-09-30T00:10:00+01:00"
  checked: "Exact UAT test 22 and repository-wide clamp references"
  found: "Test 22 says the 200-character title/meta layout check is browser-only; its report records 3 title lines and 2 meta lines. The only notification clamp source is NotificationItem.tsx, while its unit test verifies only class-name presence, not computed layout."
  implication: "The test gap allowed an incompatible class combination to pass automated checks; the local source candidate is the added block class on both clamped spans."

- timestamp: "2026-09-30T00:11:00+01:00"
  checked: "Existing generated Tailwind v4 development CSS (without a new build)"
  found: "The emitted .line-clamp-1 and .line-clamp-2 rules set -webkit-line-clamp, -webkit-box-orient:vertical, display:-webkit-box, and overflow:hidden. The equal-specificity .block rule occurs later in the same stylesheet and sets display:block."
  implication: "For each NotificationItem text span, the cascade computes display:block, removing the display:-webkit-box prerequisite for WebKit line clamping. This directly explains the 3-line title and 2-line metadata browser evidence."

- timestamp: "2026-09-30T00:11:00+01:00"
  checked: "SBFL applicability and common-pattern classification"
  found: "No failing automated layout test and no per-test browser coverage spectrum exist; current tests assert utility-class strings only. The relevant common-pattern category is a deterministic configuration/utility conflict, not async, data-shape, or state behavior."
  implication: "SBFL is skipped by its documented preconditions. The failure is classified as a deterministic Bohrbug and was traced by working backward from the emitted CSS cascade."

- timestamp: "2026-09-30T00:12:00+01:00"
  checked: "Expected base commit 096970d59b5f10fe3bd2da2b8c573623df4ef6f5"
  found: "The Phase 13 NotificationItem and its drawer test are untracked in the current worktree and do not exist at the named base commit, so the base cannot be used to compare this newly introduced UI implementation."
  implication: "The diagnosis is based on the present UAT target and its generated CSS, not a mistaken diff against the earlier base."

- timestamp: "2026-09-30T00:13:00+01:00"
  checked: "Root-cause falsification test"
  found: "The generated CSS has .line-clamp-1/.line-clamp-2 before .block, all at equal specificity and without !important. Therefore block wins display, producing display:block rather than the -webkit-box required for WebKit clamping."
  implication: "The hypothesis is confirmed. It would be falsified only if the affected elements' computed display were -webkit-box despite this stylesheet, which the shown cascade cannot produce."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "NotificationItem.tsx applies Tailwind v4 line-clamp-2/line-clamp-1 together with block on the same title and metadata spans. In the emitted CSS, .block appears after the equal-specificity line-clamp selectors and overwrites their required display:-webkit-box with display:block, disabling the clamps and allowing natural wrapping."
fix: "Diagnosis only. Minimal direction: remove the conflicting block utility from both clamped spans; then verify computed display is -webkit-box and run the held-out long-text browser check."
verification: "Root cause confirmed from the existing emitted Tailwind v4 CSS and UAT's documented real-browser reproduction. No application change was made in diagnosis-only mode."
files_changed: []
