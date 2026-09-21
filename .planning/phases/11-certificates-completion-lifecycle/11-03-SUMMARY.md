---
phase: 11-certificates-completion-lifecycle
plan: 03
subsystem: certificates
tags: [typescript, node-crypto, s3, validation, vitest]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: Certificate schema and approved PDF foundation from Plans 11-01 and 11-02
provides:
  - Closed versioned parser for certificate-template layout JSON
  - 128-bit non-sequential public verification references
  - Unguessable certificate and template-asset storage keys
  - Direct PDF writes, short-lived downloads, and validated staged image uploads
affects: [11-04, 11-05, 11-06, 11-07, 11-12]

tech-stack:
  added: []
  patterns:
    - Pure allow-list parsing for versioned JSON blobs
    - Full-entropy public references with no derivable date or identity data
    - Per-domain S3 functions with staged asset promotion boundaries

key-files:
  created:
    - src/server/services/certificate-template-layout.ts
    - src/server/services/certificate-reference.ts
    - tests/certificate-template-layout.test.ts
    - tests/certificate-reference.test.ts
    - tests/certificate-storage-service.test.ts
  modified:
    - src/server/services/storage-service.ts

key-decisions:
  - "Encode 16 random bytes as 32 uppercase hexadecimal characters after CERT-, providing exactly 128 bits of entropy without date or identity data."
  - "Reuse validateUpload with lessonType IMAGE for template assets so MIME and size rules remain centralized."
  - "Reuse the key-generic inspectLessonObject and promoteLessonObject operations rather than duplicating certificate-template variants."

patterns-established:
  - "Certificate layout consumers must call parseCertificateTemplateLayout before rendering stored JSON."
  - "Certificate files use server-side PutObjectCommand writes and FILE-class presigned download TTLs."

requirements-completed: [CRD-03, CRD-04]

duration: 9min
completed: 2026-09-16
---

# Phase 11 Plan 03: Certificate Foundation Primitives Summary

**Strict template-layout parsing, 128-bit public verification references, and isolated S3 paths for generated PDFs and template images**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-16T17:13:31Z
- **Completed:** 2026-09-16T17:22:06Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added a zero-import parser that accepts only the v1 layout schema and rejects unknown kinds, keys, malformed literal fields, invalid colours, and invalid geometry.
- Added `CERT-` references backed by 16 cryptographically random bytes, with no date stamp, counter, or caller-controlled data.
- Extended object storage with random certificate/template keys, direct PDF writes, 60-second certificate downloads, and template-image presigning through the shared IMAGE upload rules.
- Added 37 focused tests across the three new behavior surfaces, with each suite observed failing before implementation and passing afterward.

## Task Commits

Each task was committed with separate RED and GREEN commits:

1. **Task 1: Pure versioned template-layout parser** - `d5a61c3` (test), `421a187` (feat)
2. **Task 2: High-entropy verification reference generator** - `432fb85` (test), `1b5b1e3` (feat)
3. **Task 3: Storage-service certificate and template-asset functions** - `dba5b33` (test), `edd47f2` (feat)

## Files Created/Modified

- `src/server/services/certificate-template-layout.ts` - Defines and validates the closed v1 template layout contract.
- `src/server/services/certificate-reference.ts` - Generates uppercase 128-bit verification references using `node:crypto`.
- `src/server/services/storage-service.ts` - Adds certificate PDF and template-asset storage operations.
- `tests/certificate-template-layout.test.ts` - Covers accepted layouts and every planned malformed-input class.
- `tests/certificate-reference.test.ts` - Covers format, entropy, uniqueness, and absence of derivable structure.
- `tests/certificate-storage-service.test.ts` - Covers key isolation, PDF PUT validation, short download TTL, and shared image rules.

## Decisions Made

- Used uppercase hexadecimal for the random reference segment because 32 hex characters encode the full 128 random bits while remaining URL-safe and easy to transcribe.
- Applied `validateUpload({ lessonType: "IMAGE" })` to template assets, which keeps raster MIME types and the 10 MB size cap in one source of truth.
- Kept `inspectLessonObject` and `promoteLessonObject` unchanged because both functions are already key-generic; callers can safely use them with template staging keys.

## Deviations from Plan

None - plan executed exactly as written. Task 3 received a focused test file under its existing `tdd="true"` contract so its direct PUT, validation, and TTL behaviors have executable proof.

## Issues Encountered

- The installed GSD runtime exposes the legacy `gsd-tools.cjs` command shape rather than the newer `gsd-sdk query` wrapper. Execution used the equivalent legacy handlers.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 11-04 can render only parsed `CertificateTemplateLayoutV1` values and persist generated bytes through `putGeneratedCertificateObject`.
- Plan 11-05 can use `EMPTY_LAYOUT_V1` for new templates and the staged template-asset helpers for branded images.
- Later verification and download routes can use the full-entropy references and short-lived certificate URLs without adding new storage primitives.

## Self-Check: PASSED

- All six created or modified implementation/test files and this summary exist.
- Commits `d5a61c3`, `421a187`, `432fb85`, `1b5b1e3`, `dba5b33`, and `edd47f2` exist in Git history.
- The three focused suites pass all 37 tests.
- `npx tsc --noEmit` passes.
- `tests/boundary.test.ts` passes all 14 tests.
- `package.json` is unchanged from the pre-plan commit.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-16*
