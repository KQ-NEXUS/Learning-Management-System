---
phase: 11-certificates-completion-lifecycle
plan: 26
subsystem: certificates
tags: [certificates, font, asset, provenance, sha256, fontkit, gap-closure, CR-01]
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "@pdf-lib/fontkit 1.1.1 (human-vetted and installed in plan 11-02)"
provides:
  - "Human-approved static font assets/fonts/certificate/NotoSans-Regular.ttf (Noto Sans Regular 2.015, SIL OFL 1.1) with LICENSE.txt"
  - "assets/fonts/certificate/README.md: single recorded source of the font filename and provenance (labelled lines)"
  - "tests/certificate-font-asset.test.ts: hash pin, single-ttf, licence and glyph-coverage guard"
affects: [11-29 (Unicode rendering; its loader constant must equal the README Filename: line), 11-32, 11-33]
tech-stack:
  added: []
  patterns:
    - "README.md labelled lines (Filename:, SHA-256:, ...) are parsed by tests, so provenance and code cannot drift"
key-files:
  created:
    - assets/fonts/certificate/NotoSans-Regular.ttf
    - assets/fonts/certificate/LICENSE.txt
    - assets/fonts/certificate/README.md
    - tests/certificate-font-asset.test.ts
  modified: []
key-decisions:
  - "Font: Noto Sans Regular 2.015 (SIL OFL 1.1), placed by the human; the executor did not choose, download or modify it"
  - "The accepted limitation: a single Latin/Greek/Cyrillic font, so CJK/Arabic/Hebrew characters render as '?' (plan 11-29 never throws)"
duration: ~15min
completed: 2026-09-19
---

# Phase 11 Plan 26: Certificate Font Asset Summary

A human-placed Noto Sans Regular 2.015 (SIL OFL 1.1) font is committed unmodified with its licence, a labelled provenance README and a test that pins its SHA-256 and proves Yoruba/Polish/Western glyph coverage, unblocking plan 11-29.

## Task 1: Human gate (checkpoint:human-action) - RESOLVED

The human chose and placed the font themselves. The executor did not choose, download, generate, replace, rename or modify any font file. The human replied to the orchestrator's checklist with the two lines below (recorded verbatim):

- Download URL (verbatim): "https://fonts.google.com/selection"
- Limitation (verbatim): "yes limitation accepted"

The human did not separately restate the font name, version, filename or hash; those were confirmed by the orchestrator's checks and by the human's placement of the files. The orchestrator verified: exactly one .ttf plus one licence text file; git does not ignore them; static font (no variation axes); "Noto Sans Regular", Version 2.015; SHA-256 FE8C022F48D8DD29F17B744D16F9346F4357E16F7D4F7BE58B000AE7C291B614; glyph coverage for U+1EB8/1EB9, U+1ECC/1ECD, U+1E62/1E63, U+0300/0301/0304, U+0141/0142 and Western accents; and a Yoruba string "Ọlá Ṣẹ́gun Adéwálé" lays out with 0 .notdef glyphs. All of this is reproduced by the Task 2 test.

**Honest provenance note:** the human-supplied URL (https://fonts.google.com/selection) is the Google Fonts "selection" (cart) page. It is session-scoped and is NOT a stable or permanent pointer to the font. README.md records it verbatim as `Source URL:` and adds, in a separate section explicitly labelled "Additional provenance (added by the orchestrator, not stated by the human)", the stable references: the Google Fonts specimen page https://fonts.google.com/noto/specimen/Noto+Sans and the upstream repository named in the font's own licence header, https://github.com/notofonts/latin-greek-cyrillic. These are not the human's words.

## Task 2: Record provenance and pin the asset (TDD) - commit ff5a61e

- `assets/fonts/certificate/README.md`: `Filename: NotoSans-Regular.ttf`, `Font name`, `Version: 2.015`, `Source URL` (human's verbatim value), `Licence`, `SHA-256`, `Decided by / Date: Human decision (font placed by the human; limitation accepted), 2026-09-19`, the two verbatim quotes, the accepted CJK/Arabic/Hebrew limitation, and the separate orchestrator-added provenance section.
- `tests/certificate-font-asset.test.ts` (6 tests, all green): reads the `Filename:`/`SHA-256:`/`Licence:` labels from README.md (no hard-coded font name in the lookup); asserts every labelled line is present; asserts the recorded file exists and is the only `.ttf`; hash-pin guard (recorded digest and the pinned orchestrator digest both equal the on-disk digest); licence text present and names the Open Font License; opened through `@pdf-lib/fontkit`, has glyphs for ASCII, Yoruba precomposed, combining marks, Polish and Western accents (failure message lists missing code points); Yoruba (precomposed and NFD) and Polish sample strings lay out with zero `.notdef` glyphs.
- Committed the font and LICENSE.txt unmodified: the committed blob's SHA-256 (git show HEAD:...) equals the pinned value. `git status` confirmed these were the only new files under assets/.
- TDD note: the asset pre-existed and the test guards it, so a distinct failing RED commit was not meaningful; test and asset landed together in one commit.

## Verification

- `npx vitest run tests/certificate-font-asset.test.ts`: 6/6 passed.
- `tests/boundary.test.ts` + `tests/certificate-phase-invariants.test.ts`: 26/26 passed.
- `git diff package.json package-lock.json`: empty. No npm installs.
- `grep -c "^Filename:"` on README.md: 1. `git check-ignore` on the assets printed nothing.

## Deviations from Plan

None - plan executed as written. The test's `SHA-256` pin is checked against both the README value and a constant in the test (the plan required README-driven checking; the extra constant is an added tamper guard so editing README and font together cannot pass silently).

## Threat Flags

None. T-11-106 (tampering) mitigated by the hash pin; T-11-107 (repudiation) mitigated by the human gate and LICENSE.txt beside the font; no package changes (T-11-SC).

## Known Stubs

None.

## Self-Check: PASSED

- Files present: NotoSans-Regular.ttf, LICENSE.txt, README.md, tests/certificate-font-asset.test.ts
- Commit ff5a61e present
