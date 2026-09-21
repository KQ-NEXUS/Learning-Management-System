# Certificate font

This directory holds the single Unicode-capable font embedded by the certificate PDF renderer (plan 11-29). This README is the one recorded source of the font filename; the loader constant is pinned to the `Filename:` line below by a test, and `tests/certificate-font-asset.test.ts` pins the hash. Do not add a second `.ttf` here.

Filename: NotoSans-Regular.ttf
Font name: Noto Sans Regular
Version: 2.015
Source URL: https://fonts.google.com/selection
Licence: SIL Open Font License, Version 1.1
SHA-256: FE8C022F48D8DD29F17B744D16F9346F4357E16F7D4F7BE58B000AE7C291B614
Decided by / Date: Human decision (font placed by the human; limitation accepted), 2026-09-19

The licence text (including the copyright notice, "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)") is stored beside the font as `LICENSE.txt`.

## Human decision (verbatim)

- Download URL: "https://fonts.google.com/selection"
- Limitation: "yes limitation accepted"

The `Source URL:` line above is the human's verbatim value. It is the Google Fonts "selection" (cart) page, which is a session-scoped page and not a stable or permanent pointer to this font. See the additional provenance below for stable references.

## Additional provenance (added by the orchestrator, not stated by the human)

- Google Fonts specimen page: https://fonts.google.com/noto/specimen/Noto+Sans
- Upstream repository named in the font's own licence header: https://github.com/notofonts/latin-greek-cyrillic

The font name, version and hash above were verified by the orchestrator against the file the human placed (static font with no variation axes; "Noto Sans Regular", Version 2.015).

## Accepted limitation

This is a single Latin/Greek/Cyrillic font. It does NOT cover CJK, Arabic or Hebrew scripts. The renderer (plan 11-29) never throws for such names but draws a "?" for each unsupported character. Shipping a CJK/Arabic/Hebrew fallback font is out of scope for this pass, and the human accepted this limitation.

## Required coverage (asserted by the test)

Yoruba precomposed letters U+1EB8/U+1EB9, U+1ECC/U+1ECD, U+1E62/U+1E63; combining grave/acute/macron U+0300, U+0301, U+0304; Polish U+0141/U+0142; and common Western European accents.
