---
phase: 11-certificates-completion-lifecycle
plan: 02
subsystem: certificates
tags: [pdf-lib, fontkit, pdf-generation, permissions, supply-chain]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: Certificate schema, reusable template records, and completion lifecycle from Plan 11-01
provides:
  - Human-vetted, exact-pinned pure PDF construction dependencies
  - Executable server-side proof for positioned text, shapes, PNG images, and custom TTF fonts
  - Explicit product decision assigning certificate-template authoring to certificates.manage
affects: [11-03, 11-04, 11-05, 11-12]

tech-stack:
  added: [pdf-lib@1.17.1, "@pdf-lib/fontkit@1.1.1"]
  patterns:
    - Human legitimacy verification before third-party production dependencies enter the tree
    - Browser-free PDF construction with explicit page coordinates

key-files:
  created:
    - scripts/certificate-pdf-probe.mts
    - .planning/phases/11-certificates-completion-lifecycle/11-DECISIONS.md
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Use pdf-lib 1.17.1 with @pdf-lib/fontkit 1.1.1 after human verification of the official npm and GitHub listings."
  - "Use a dedicated certificates.manage permission for certificate-template authoring; Plan 11-05 owns the catalogue and default-role seed updates."

patterns-established:
  - "PDF rendering remains a pure Node operation with no Puppeteer or Playwright production dependency."
  - "Certificate visual-design authority is separate from issuance and revocation authority."

requirements-completed: [CRD-03]

duration: 37min
completed: 2026-09-16
---

# Phase 11 Plan 02: PDF Construction and Template Permission Decisions Summary

**Human-vetted pdf-lib rendering with positioned text, vector borders, embedded PNG and custom TTF support, plus a dedicated certificate-template management permission decision**

## Performance

- **Duration:** 37 min
- **Started:** 2026-09-16T16:32:57Z
- **Completed:** 2026-09-16T17:09:28Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Cleared the package-legitimacy gate before modifying the dependency tree and pinned only the approved PDF packages.
- Proved browser-free landscape A4 generation in this Node runtime with explicit coordinates, named colours, a filled and stroked rectangle, an in-memory PNG, and a custom TTF.
- Recorded `certificates.manage` as the dedicated certificate-template authoring permission and assigned its catalogue and seed work to Plan 11-05.

## Task Commits

Each task was committed atomically:

1. **Task 1: Package legitimacy gate** - `726f9fd` (docs)
2. **Task 2: Install approved library and prove runtime rendering** - `73d2b55` (feat)
3. **Task 3: Decide the template-authoring permission** - `d7c53d9` (docs)

## Files Created/Modified

- `package.json` - Pins `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 exactly.
- `package-lock.json` - Records the verified resolved versions and integrity hashes.
- `scripts/certificate-pdf-probe.mts` - Generates and validates a synthetic PDF using all primitives required by the future certificate renderer.
- `.planning/phases/11-certificates-completion-lifecycle/11-DECISIONS.md` - Preserves both human decisions and the corrected fontkit pin audit trail.

## Decisions Made

- Selected Option A: `pdf-lib` with `@pdf-lib/fontkit`, because its explicit coordinate API matches positioned certificate elements and needs no browser binary.
- Corrected the planned `@pdf-lib/fontkit` version from nonexistent `2.0.4` to human-verified `1.1.1` after npm returned `ETARGET`.
- Selected `new-manage`: certificate-template creation, editing, and archival will require `certificates.manage`, separating institution-wide visual-design authority from issuance and revocation.

## Deviations from Plan

### Human-approved Adjustments

**1. [Package legitimacy gate] Corrected an unavailable fontkit version**

- **Found during:** Task 2 package installation
- **Issue:** npm returned `ETARGET` because the plan's `@pdf-lib/fontkit@2.0.4` pin does not exist.
- **Resolution:** Stopped at the mandatory blocking-human checkpoint. After the human verified the official npm/GitHub listing and explicitly approved `1.1.1`, installed that exact version and updated the decision record.
- **Files modified:** `package.json`, `package-lock.json`, `.planning/phases/11-certificates-completion-lifecycle/11-DECISIONS.md`
- **Verification:** Both manifest and lockfile resolve `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 exactly; the runtime probe and full test suite pass.
- **Committed in:** `73d2b55`

---

**Total deviations:** 1 human-approved package correction
**Impact on plan:** The corrected official release provides the planned custom-font capability without expanding dependency scope.

## Issues Encountered

- The first install attempt could not write to the sandboxed npm cache. The approved install was rerun with the required filesystem access.
- The first full-suite run could not access Docker from the sandbox. The same suite was rerun with Docker access and passed all 189 test files: 2,629 tests passed and one skipped.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 11-04 can implement the single production PDF renderer against the proven `pdf-lib` primitives.
- Plan 11-05 must add `certificates.manage` to the closed catalogue and update the default-role seed before implementing template CRUD.
- No QR-code package or browser-automation production dependency was introduced.

## Self-Check: PASSED

- All four created or modified plan files and this summary exist.
- Commits `726f9fd`, `73d2b55`, and `d7c53d9` exist in Git history.
- The final probe emitted a 13,384-byte file with the `%PDF` magic header and embedded Arial TTF.
- Exact dependency, lockfile, single-PDF-library, and forbidden-package checks passed.
- `npx tsc --noEmit` passed.
- `npm test` passed all 189 files: 2,629 tests passed and one skipped.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-16*
