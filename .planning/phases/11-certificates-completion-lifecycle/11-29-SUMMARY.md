---
phase: 11-certificates-completion-lifecycle
plan: 29
subsystem: certificates
tags: [certificates, pdf-lib, fontkit, unicode, gap-closure, CR-01]
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: human-approved NotoSans-Regular.ttf + README record (11-26), renderer image guard (11-34), post-commit file service (11-30/11-31)
provides:
  - Renderer embeds the bundled Unicode font through @pdf-lib/fontkit (subset), no standard-font fallback
  - sanitiseCertificateText: NFC, CR/LF/tab -> space, other controls dropped, unsupported code points -> "?" (never throws)
  - certificate-font.ts: cached font loader with CERTIFICATE_FONT_FILENAME pinned to the README Filename line
  - next.config.ts outputFileTracingIncludes so the font ships with the server output
affects: [11-32 (Unicode end to end on real Postgres + MinIO), 11-33 (human visual check)]
tech-stack:
  added: []
  patterns:
    - "Measure and draw with the SAME sanitised string so alignment cannot drift"
    - "Loader memoises the promise and clears it on rejection (no cached failure)"
    - "Tests recover drawn text through the PDF ToUnicode CMap because embedded fonts write glyph ids, not character codes"
key-files:
  created:
    - src/server/services/certificate-font.ts
    - tests/certificate-pdf-unicode.test.ts
  modified:
    - src/server/services/certificate-pdf-renderer.ts
    - next.config.ts
    - tests/support/pdf-content.ts
    - tests/certificate-pdf-renderer.test.ts
    - tests/certificate-pdf-positions.test.ts
    - tests/certificate-download.integration.test.ts
key-decisions:
  - "Embed with features { ccmp: false }: the font's ccmp decomposes lowercase o/s/e with dot below into a base glyph plus a zero-advance mark with no text mapping; with ccmp off the precomposed glyph is drawn and mapped correctly"
  - "loadCertificateFontBytes takes an optional root parameter used only by tests to simulate a failed read; production calls pass nothing (process.cwd())"
requirements-completed: [CRD-03]
duration: ~50min
completed: 2026-09-19
---

# Phase 11 Plan 29: Unicode renderer (CR-01 part a) Summary

**The certificate renderer now embeds the human-approved Noto Sans font through fontkit (subset), so Yoruba, Polish and accented names render as real glyphs, and a sanitiser guarantees no name can make rendering throw.**

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1. Unicode font through fontkit, text sanitiser, font loader | 0f79c58 | Real Yoruba/Polish/French/decomposed names render and round-trip through ToUnicode; CJK/Arabic/emoji become one "?" per code point; controls handled; loader + README filename pin; font traced for Next |

## Verification (RED then GREEN)

- RED: the new `tests/certificate-pdf-unicode.test.ts` was run against the UNCHANGED renderer (only the new loader file existed). 14 of 20 tests failed; every render case failed with pdf-lib's `Error: WinAnsi cannot encode "ọ" (0x1ecd)` (likewise `"Ł" (0x0141)`, `"山" (0x5c71)`, the combining dot below `0x0323`), thrown from `drawTextElement` -> `font.widthOfTextAtSize`. The ASCII, empty-string, loader and README-pin cases passed both before and after (guards).
- GREEN: after the change, `certificate-pdf-unicode`, `certificate-pdf-renderer` (including 11-34's image-guard tests, untouched), `certificate-pdf-positions`, `certificate-font-asset`: 58/58. `certificate-phase-invariants` + `boundary` + `certificate-font-asset`: 32/32 (invariant 1: pdf-lib still imported only by the renderer). Also green: `certificate-download.integration` (real Postgres + MinIO via Docker, 5/5), `certificate-template-service`, `certificate-file-service`, `certificate-download-route`, `certificate-issuance-service` (96).
- `npx tsc --noEmit` exits 0. `git diff package.json package-lock.json` is empty; the `.ttf` was not touched.
- `npx next build` succeeded (run with a throwaway local `DATABASE_URL`/`DIRECT_URL` so the remote database in `.env` was never used). 76 server trace files (`.next/server/**/*.nft.json`) list `NotoSans-Regular.ttf`.
- Size guard: a Yoruba certificate serialises well under 200 KB (subset embedding).

## next.config.ts syntax check

Read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` (per AGENTS.md): `outputFileTracingIncludes` keys are route globs, values are globs relative to the project root, and `'/*'` targets all routes. Config uses `"/*": ["./assets/fonts/certificate/**/*"]`, confirmed effective by the build's traces above.

## Deviations from Plan

**1. [Rule 1 - Bug found in first GREEN attempt] Lowercase Yoruba letters lost their dot in text mapping**
- **Found during:** running the new tests after the first implementation (3 failures: ọ, ṣ, ẹ).
- **Issue:** fontkit's default `ccmp` layout replaces U+1ECD/U+1E63/U+1EB9 with a base glyph plus a zero-advance dot-below mark glyph that has no code point, and pdf-lib's ToUnicode CMap cannot map it (recovered text showed U+FFFD). Uppercase Ọ/Ẹ were unaffected.
- **Fix:** `embedFont(bytes, { subset: true, features: { ccmp: false } })`; the font's own precomposed glyphs (e.g. ọ = glyph 803) are then used with a correct ToUnicode entry, which is the "precomposed Yoruba letters" behaviour the plan intends. Positions tests compute expected widths with the same options.
- **Files:** `certificate-pdf-renderer.ts`, `certificate-pdf-positions.test.ts`. **Commit:** 0f79c58.

**2. [Rule 3 - Blocking] Shared text extractor and the integration test's copy**
- `tests/certificate-pdf-renderer.test.ts` and `tests/certificate-download.integration.test.ts` each carried a private Latin-1 `extractPdfText` that would return glyph ids for an embedded font. Both now import a ToUnicode-aware `extractPdfText` exported from `tests/support/pdf-content.ts` (a pure module, so the integration file's reason for copying rather than importing a test file no longer applies; its header comment was updated). `certificate-download.integration.test.ts` is not in the plan's `files_modified`.

Otherwise executed as written. `drawImageElement` and its tests are untouched.

## Known limits (per plan, recorded not fixed)

- Complex-script shaping and combining-mark positioning: pdf-lib applies glyph advances only, so a letter carrying a tone mark without a precomposed form (for example Yoruba o + dot below + acute normalises to precomposed ọ plus a combining acute) is drawn base then mark and may sit slightly off. This is a visual concern for plan 11-33's human check; it was not inspected visually here.
- CJK, Arabic and Hebrew show "?" per character (human-accepted in plan 11-26).
- Text with a ligature (for example "fi") is drawn as the ligature glyph; its ToUnicode entry maps back to both letters.

## Threat Flags

None. T-11-117, T-11-120 (subset embedding, size guard), T-11-121 (no fallback; a font read failure rejects; a rejected read is not cached) mitigated as planned. No new network surface.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/server/services/certificate-font.ts, tests/certificate-pdf-unicode.test.ts
- FOUND commit: 0f79c58

## Post-verification defect (found in plan 11-33's visual check, fixed 2026-09-19)

The 11-29 renderer embedded the font with `subset: true`. The 11-32 evidence PDFs then looked wrong in both Chrome's PDF viewer and pdf.js: most letters were blank (a Yoruba name showed only tone marks; "September" drew as "Sep e"). Every automated test still passed, because they read text through the ToUnicode map, which was intact, and never checked that glyphs have outlines.

Root cause (isolated with a four-way experiment): fontkit's subsetter produced a truncated font program (10 glyphs, most without outlines) for Noto Sans, independent of the `ccmp` option. Embedding the whole font renders correctly.

Fix: `subset: false` (about 316 KB per certificate, was 3-5 KB). New viewer-independent tests read the font program out of the PDF and require every drawn glyph to have an outline and the embedded program to be complete; they fail against the subset embedding (4 failures, embedded font 10 glyphs vs 4,503) and pass after. The old "PDF under 200 KB" guard, which encoded the wrong premise, now bounds the size at 200-500 KB.

Also fixed: `tests/support/pdf-content.ts` trimmed every trailing CR/LF from streams, which can drop a legitimate last byte of Flate data and hid the ToUnicode map of full-font PDFs; it no longer trims.

Follow-up (not done): a pre-trimmed Latin-only font would cut the per-certificate size to roughly 50-60 KB.
