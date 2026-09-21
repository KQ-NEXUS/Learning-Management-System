---
phase: 11-certificates-completion-lifecycle
plan: 34
subsystem: certificates
tags: [certificates, pdf-lib, upload-limits, gap-closure, CR-02]
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: certificate-pdf-renderer, template-asset-actions, upload-limits (plans 11-12, 11-24)
provides:
  - Format-sniffing image guard in the certificate renderer (undecodable image bytes skipped, resolver failures still propagate)
  - Certificate template asset allow-list (PNG and JPEG only) enforced at presign, confirm and the inspector picker
affects: [11-29 (renderer font swap must keep the image guard and its tests), 11-30, 11-32]
tech-stack:
  added: []
  patterns:
    - "Decide image format from leading bytes (PNG 8-byte signature, JPEG FF D8 FF) rather than trial embedding"
    - "Narrower per-domain allow-list delegating size checks to the shared IMAGE limit"
key-files:
  created:
    - tests/template-asset-actions.test.ts
  modified:
    - src/server/services/certificate-pdf-renderer.ts
    - src/lib/upload-limits.ts
    - src/app/staff/certificates/templates/template-asset-actions.ts
    - src/app/staff/certificates/templates/ElementInspector.tsx
    - tests/certificate-pdf-renderer.test.ts
    - tests/upload-limits.test.ts
    - tests/components/certificate-template-editor.test.tsx
key-decisions:
  - "Resolver (fetch) failures still reject the render; only permanently undecodable image bytes are skipped"
  - "Template assets use a dedicated PNG/JPEG list; UPLOAD_LIMITS.IMAGE and validateUpload are untouched so lesson images keep WebP/GIF"
requirements-completed: [CRD-03]
duration: ~35min
completed: 2026-09-19
---

# Phase 11 Plan 34: Template image assets (CR-02) Summary

**The renderer now sniffs PNG/JPEG signatures and skips any other or corrupt image bytes, while template uploads are restricted to PNG and JPEG at presign, confirm and the file picker.**

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1. Format-sniffing image guard in `drawImageElement` | e913069 | WebP, GIF, corrupt PNG, corrupt JPEG and empty bytes are skipped with the rest of the certificate intact; valid PNG/JPEG still embed; a rejecting resolver still rejects |
| 2. PNG/JPEG-only template assets | 0a47346 | `CERTIFICATE_TEMPLATE_ASSET_MIME_TYPES` + `validateTemplateAssetUpload`; both actions use it (confirm on the server-observed type); inspector `accept="image/png,image/jpeg"`; failure message names PNG or JPEG |

## Verification (RED then GREEN)

- Task 1: with the pre-change renderer restored (`git show HEAD:` copy), 5 of 21 renderer tests failed (WebP, GIF, corrupt PNG, corrupt JPEG, empty; errors "SOI not found in JPEG", "Invalid JPEG", "Offset is outside the bounds of the DataView"). After the fix all pass. The valid-PNG, valid-JPEG and resolver-rejection tests passed both before and after (guards). Image presence is asserted by parsing indirect objects for `/Subtype /Image` (object streams are not greppable); text presence by the existing `extractPdfText`.
- Task 2: before implementation, 14 tests failed, including the confirm-step test where an inspected `image/webp`/`image/gif` (declared equals observed) was promoted (`ok: true`), the presign tests, and the inspector `accept` assertion. After implementation all pass.
- Final run: `tests/upload-limits`, `tests/template-asset-actions`, `tests/components/certificate-template-editor`, `tests/certificate-pdf-renderer`, `tests/certificate-pdf-positions`, `tests/certificate-phase-invariants`, `tests/boundary` all green (115 tests). `npx tsc --noEmit` exits 0. `git diff package.json package-lock.json` is empty. The only `image/webp`/`image/gif` strings left in `src/app/staff/certificates` and `src/lib/upload-limits.ts` are inside the untouched `UPLOAD_LIMITS.IMAGE` list.
- No integration tests (Postgres/MinIO) were required for this plan; none were run.

## Deviations from Plan

- **[Rule 1 - test bug, self-caused]** Two errors in my new tests, fixed before the tasks were committed: a hand-copied JPEG base64 fixture was truncated (regenerated with sharp from `node_modules`, verified with `embedJpg`), and the text-sentinel used `text:` instead of the layout's `literal:` field. Also replaced `1_000n` BigInt literals with `BigInt(1000)` because the tsconfig target rejects BigInt literals (TS2737). No production impact.
- Otherwise the plan was executed as written. The renderer diff touches only `drawImageElement` and its comment (font/text code untouched, leaving plan 11-29 free to edit it).

## Known limits (per plan)

Existing templates that already reference WebP/GIF assets keep rendering (the image is skipped); the upload UI simply stops creating new ones. WR-03 (asset-key domain validation) is out of scope and untouched.

## Threat Flags

None. T-11-118 and T-11-119 mitigated as planned; no new network surface.

## Known Stubs

None.

## Self-Check: PASSED

Files (renderer, upload-limits, actions, inspector, four test files) exist; commits e913069 and 0a47346 exist.
