---
phase: 11-certificates-completion-lifecycle
plan: 19
subsystem: certificates
tags: [pdf-lib, certificate-renderer, gap-closure, uat-11, coordinates]
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: certificate PDF renderer and template editor (plans 11-12, 11-16)
provides:
  - Renderer that converts top-origin layout coordinates to pdf-lib space
  - Images fitted (object-contain) and centred instead of stretched
  - PDF content-stream readers for position-asserting tests
affects: [certificate-issuance, template-editor, seed]
tech-stack:
  added: []
  patterns:
    - "Renderer owns the single top-origin to bottom-origin conversion (exported pure helpers toPdfTextBaselineY, fitImageInBox)"
    - "Renderer tests read positions back out of produced PDF bytes"
key-files:
  created:
    - tests/support/pdf-content.ts
    - tests/certificate-pdf-positions.test.ts
  modified:
    - src/server/services/certificate-pdf-renderer.ts
    - src/server/services/certificate-default-template-layout.ts
key-decisions:
  - "Baseline offset models the editor: glyph box centred in a 1.25 x fontSize line starting at the box top (EDITOR_LINE_HEIGHT_RATIO)"
  - "Zero-sized box or image draws nothing (fitImageInBox returns null) rather than emitting NaN"
requirements-completed: [CRD-03]
duration: 20min
completed: 2026-09-19
---

# Phase 11 Plan 19: Certificate PDF vertical mirroring and image stretching Summary

The renderer now converts the editor's top-origin y into pdf-lib's bottom-origin space for text baselines and images, and fits images inside their box without stretching. This closes UAT test 11.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 (RED) position-reading helper and tests | e5b06a6 | 7 renderer cases fail against the pre-fix renderer; 2 reader self-tests and the zero-width guard pass |
| 2 (GREEN) coordinate conversion and image fit | 15d42ee | all cases pass |

## Verification

- RED proof: the position tests were run against the UNCHANGED renderer before any source edit and 7 of 10 failed with position mismatches (for example a square image at design y 40 read back at PDF y 40 instead of 475.28; a 2:1 image read back 100x100 instead of 100x50). The two content-stream reader self-tests and the zero-width image guard pass both before and after, as the plan specifies. The RED commit precedes the fix commit in history.
- After the fix: `tests/certificate-pdf-positions`, `certificate-pdf-renderer`, `certificate-phase-invariants`, `certificate-issuance-service`, `certificate-template-service`, `certificate-download.integration`, `certificate-concurrency.integration`, `boundary` all pass: 8 files, 102 tests. The integration tests ran against the live Docker Postgres (migrations applied), not skipped.
- `npx tsc --noEmit` exits 0; eslint clean on the touched files; `git diff package.json package-lock.json` is empty (no dependency added; pdf-lib still imported only by the renderer).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Seeded default template layout was authored in bottom-origin coordinates**
- **Found during:** Task 2 (checking other consumers of the renderer)
- **Issue:** `certificate-default-template-layout.ts` placed the title at y 500 and the reference at y 330 on a 595pt-high page, i.e. it had been written for the old bottom-origin renderer. With the fix it would have rendered upside down (title at the bottom).
- **Fix:** Re-expressed the five text y values in top-origin space preserving the intended arrangement (500->55, 440->123, 400->167, 360->211, 330->241). `prisma/seed.ts` updates the existing default row on every run, so a re-seed propagates it.
- **Files modified:** src/server/services/certificate-default-template-layout.ts
- **Commit:** 15d42ee

**2. [Test adjustment] Zero-width image case asserts "no visible area"**
- The plan says this case passes before and after. The pre-fix renderer draws a zero-area placement rather than nothing, so the assertion is "every placement has zero area (or none exist)". The fixed renderer draws nothing at all.

## Disclosures (not fixed here, per plan scope)

- Certificates issued BEFORE this fix keep their stored mirrored PDF (`Certificate.storageKey` is written once). Only certificates issued or reissued afterwards get the corrected layout. Regenerating stored PDFs touches an issued credential and needs a user decision.
- An already-seeded database keeps the old default layout until `prisma db seed` is re-run (the seed updates the row in place). Staff-authored templates were designed in the editor's top-origin space and are correct as-is.
- `tests/certificate-pdf-renderer.test.ts` still contains a golden layout using the old bottom-origin y values (title y 500, image y 460). It only asserts text presence and byte-size ordering so it still passes, but its coordinates are now "mirrored" as a design; left untouched as out of scope.
- The baseline offset is a model of the editor's CSS (1.25 line-height, centred glyph box), verified against pdf-lib's Helvetica metrics, not a pixel comparison against a browser render.

## Known Stubs

None.

## Threat Flags

None. T-11-77 mitigated (zero-size guard plus test), T-11-79 mitigated (position-asserting tests), T-11-SC satisfied (no installs).

## Self-Check: PASSED

Files tests/support/pdf-content.ts, tests/certificate-pdf-positions.test.ts, and the two modified source files exist; commits e5b06a6 and 15d42ee exist.
