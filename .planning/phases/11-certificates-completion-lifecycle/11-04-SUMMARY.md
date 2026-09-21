---
phase: 11-certificates-completion-lifecycle
plan: 04
subsystem: certificates
tags: [pdf-lib, pdf-generation, certificates, vitest]

# Dependency graph
requires:
  - phase: 11-02
    provides: pdf-lib 1.17.1 / @pdf-lib/fontkit 1.1.1 human-vetted install, runtime probe proving positioned text/shapes/PNG rendering
  - phase: 11-03
    provides: certificate-template-layout.ts's CertificateTemplateLayoutV1/CertificateElementV1 schema and parseCertificateTemplateLayout, and certificate storage-key conventions this renderer's output will flow into
provides:
  - "renderCertificatePdf(layout, fields, resolveAsset) -> Uint8Array, the sole PDF-construction surface in the repository"
  - "formatCertificateIssuedDate — the shared issued-date formatter for renderer output and future editor sample-value previews"
  - "goldenCertificateLayoutFixture — a full-coverage (border + image + all 4 dynamic fields + literal) parsed layout exported for plan 11-16's integration tests"
affects: [11-05, 11-06, 11-07, 11-16]

# Tech tracking
tech-stack:
  added: []  # pdf-lib/@pdf-lib/fontkit already installed in 11-02; no new install this plan
  patterns:
    - "PDF-library-boundary confinement: pdf-lib imported in exactly one file (certificate-pdf-renderer.ts); grep-enforced"
    - "Test-time PDF text read-back via raw stream Flate-inflate + Tj-hex-decode, since pdf-lib exposes no text-extraction API and always compresses content streams"

key-files:
  created:
    - src/server/services/certificate-pdf-renderer.ts
    - tests/certificate-pdf-renderer.test.ts
  modified: []

key-decisions:
  - "No fontkit/custom-font embedding in this renderer: CertificateElementV1's text kind carries no font-family field, only fontSize/color/align, so StandardFonts.Helvetica is sufficient; fontkit registration stays deferred until a schema change actually adds a font-family element"
  - "Text x/y are consumed as pdf-lib's native bottom-left-origin page coordinates with no translation layer, matching the plan's 'no translation layer' requirement; any top-left-canvas-to-PDF-origin conversion is the editor's (11-12's) concern, not the renderer's"
  - "Border inset (24pt) and double-border gap (6pt) are local named constants, not schema fields — the layout schema only carries style/color/widthPt for border elements"
  - "Image embedding tries embedPng first, falls back to embedJpg; any failure (resolver rejection or embed failure) propagates unmodified rather than being caught, per T-11-16's 'never silently emit an incomplete certificate' requirement"

requirements-completed: [CRD-03]

# Metrics
duration: ~35min
completed: 2026-09-18
---

# Phase 11 Plan 04: Certificate PDF Renderer Summary

**`renderCertificatePdf` turns a parsed `CertificateTemplateLayoutV1` plus one learner's four award facts into real PDF bytes using pdf-lib as the only PDF-construction dependency in the repository, verified by reading dynamic-field text back out of the produced PDF's own content streams.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-09-18
- **Tasks:** 2
- **Files modified:** 2 (both newly created)

## Accomplishments

- `src/server/services/certificate-pdf-renderer.ts` exports `renderCertificatePdf` (layout + four learner facts + injected asset resolver -> `Uint8Array`) and `formatCertificateIssuedDate`, the single date formatter the renderer and a future editor preview will share
- All four dynamic fields (`learnerName`, `awardTitle`, `issuedAt`, `verificationRef`) and literal text substitute correctly, proven by decoding real text out of the produced PDF bytes — not a mock spy
- Page geometry (A4/LETTER, portrait/landscape) maps onto named point-dimension constants with orientation correctly swapping width/height
- Border (solid/double) and image (resolver-injected, PNG/JPG) elements draw without a browser binary; an unresolvable `assetKey` throws instead of silently omitting a logo
- A golden full-coverage fixture (every element kind, every dynamic field, built through `parseCertificateTemplateLayout`) is exported for plan 11-16's integration tests to reuse

## Task Commits

Task 1 used TDD (RED -> GREEN); Task 2 followed with its own commit:

1. **Task 1: renderCertificatePdf — the single PDF-construction surface**
   - `46d8864` — `test(11-04): add failing certificate PDF renderer tests` (RED — confirmed via `npx vitest run`, failed at import with "Cannot find package '@/server/services/certificate-pdf-renderer'" before the module existed)
   - `8c874c6` — `feat(11-04): implement renderCertificatePdf as the sole PDF-library boundary` (GREEN — 12/12 tests passing)
2. **Task 2: Golden-layout regression fixture**
   - `ad5f04b` — `test(11-04): add golden-layout regression fixture for the PDF renderer` (13/13 tests passing)

**Plan metadata:** committed as part of this Summary's own commit (see final_commit step).

## Files Created/Modified

- `src/server/services/certificate-pdf-renderer.ts` — the sole `pdf-lib` import site; `renderCertificatePdf`, `formatCertificateIssuedDate`, named `A4_PORTRAIT_PT`/`LETTER_PORTRAIT_PT`/`PAGE_SIZES` dimension constants, text/image/border drawing helpers
- `tests/certificate-pdf-renderer.test.ts` — 13 test cases (dynamic-field substitution x4, literal text, `EMPTY_LAYOUT_V1`, `%PDF` header, orientation swap, page-size difference, border byte-length proof, image embed success/failure, golden-layout full-coverage regression) plus a hand-rolled PDF text-extraction helper (`extractPdfText`) and the exported `goldenCertificateLayoutFixture`

## Decisions Made

- Standard font only (Helvetica via `StandardFonts`), no `fontkit` registration — the layout schema has no font-family field for text elements, so custom font embedding is out of scope for this pass; documented as a key decision above so a future schema change (adding a font-family element) knows where to hook it in
- Test-time PDF text extraction implemented by hand: `pdf-lib` always Flate-compresses content streams (`useObjectStreams` only affects the xref/object-stream container, not content-stream compression) and exposes no public text-readback API, so the test file inflates each `stream ... endstream` object with Node's `zlib.inflateSync` and decodes `<HEXSTRING> Tj` operators — standard-font WinAnsi hex codes are byte-identical to ASCII for the plain Latin text this suite uses. Page-dimension assertions instead use `PDFDocument.load(bytes).getPage(0).getSize()`, since that's the library's own read-back API and doesn't need manual stream parsing.
- Border inset (24pt) and double-border gap (6pt) are local constants inside the renderer, not part of `CertificateElementV1` — the parsed schema only carries `style`/`color`/`widthPt` for border elements, so positioning is the renderer's own layout decision.

## Deviations from Plan

**1. [Rule 1 - Bug] Removed a literal `@prisma/client` mention from the module's own header comment**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** The header comment describing the module as "pure" originally used the literal string `` `@prisma/client` `` to say it isn't imported — but the acceptance criterion `grep -c "@prisma/client" src/server/services/certificate-pdf-renderer.ts` returns 0 is a raw text grep with no comment/code distinction, so the comment's own self-description caused the criterion to read 1, contradicting its own claim.
- **Fix:** Reworded to "no database-client import, no data access" — same meaning, no literal match.
- **Files modified:** `src/server/services/certificate-pdf-renderer.ts`
- **Verification:** `grep -c "@prisma/client" src/server/services/certificate-pdf-renderer.ts` now returns 0; `npx tsc --noEmit` and the full test file still pass.
- **Committed in:** `8c874c6` (part of Task 1's GREEN commit — found and fixed before that commit was made)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cosmetic wording fix required to satisfy a mechanical grep acceptance criterion; no functional change.

## Issues Encountered

- `pdf-lib`'s `PDFDocument.save()` always Flate-compresses content streams with no opt-out, so the plan's "minimal stream/%PDF content scan" verification approach required writing a small zlib-based inflate step rather than a plain substring search on the raw bytes. Resolved by inflating each stream object before scanning for `Tj` operators (see Decisions above); confirmed correct against a standalone probe before writing it into the test suite.

## User Setup Required

None — no external service configuration required. `pdf-lib`/`@pdf-lib/fontkit` were already installed and human-approved in plan 11-02; `git diff package.json` is empty for this plan.

## Next Phase Readiness

- `renderCertificatePdf` is ready for plan 11-06/11-07 (certificate issuance service) to call at issuance time, and for plan 11-16 to reuse `goldenCertificateLayoutFixture` in its integration tests
- `formatCertificateIssuedDate` is ready for plan 11-12's template-editor sample-value preview to import so staff see the identical date shape they'll get on the real certificate
- No blockers. PDF visual fidelity (fonts, positioning, embedded images end-to-end) remains an explicitly manual verification per `11-VALIDATION.md`, deferred to plan 11-16 alongside the template-editor canvas walkthrough

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*

## Self-Check: PASSED

- FOUND: `src/server/services/certificate-pdf-renderer.ts`
- FOUND: `tests/certificate-pdf-renderer.test.ts`
- FOUND: `.planning/phases/11-certificates-completion-lifecycle/11-04-SUMMARY.md`
- FOUND commit: `46d8864` (test — RED)
- FOUND commit: `8c874c6` (feat — GREEN)
- FOUND commit: `ad5f04b` (test — golden fixture)
- FOUND commit: `246262f` (docs — this summary)
