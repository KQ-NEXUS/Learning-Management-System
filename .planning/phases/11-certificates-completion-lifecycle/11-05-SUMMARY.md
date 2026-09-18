---
phase: 11-certificates-completion-lifecycle
plan: 05
subsystem: certificates
tags: [prisma, permissions, resource-service, pdf-lib, seed]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "CertificateTemplate Prisma model (11-01), certificate-template-layout.ts parser and certificate-pdf-renderer.ts (11-03/11-04)"
provides:
  - "certificates.manage permission in the closed catalogue, granted to Administrator only"
  - "certificateTemplateService (CRUD via createResourceService) with write-boundary layout validation"
  - "setDefaultTemplate / listSelectableTemplates for the future Course/Programme picker and template editor"
  - "DefaultTemplateRequiredError / ArchivedTemplateError typed invariants"
  - "One seeded, renderable 'Default certificate' CertificateTemplate on every fresh deployment"
affects: [11-08, 11-09, 11-12, 11-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Layout validated at the write boundary (create/update) before it ever reaches the delegate, mirroring assessment-service.ts's assertValidFeedbackBehaviour precedent"
    - "Archive-invariant guard implemented inside the factory's own archiveData hook, so it runs after the permission check rather than as a separate pre-check"
    - "Shared pure fixture module (certificate-default-template-layout.ts) so seed.ts and its test never keep two independently-drifting copies of the same layout"

key-files:
  created:
    - src/server/services/certificate-template-service.ts
    - src/server/services/certificate-default-template-layout.ts
    - tests/certificate-template-service.test.ts
  modified:
    - src/server/permissions/catalogue.ts
    - src/lib/permission-groups.ts
    - tests/permissions.test.ts
    - prisma/seed.ts

key-decisions:
  - "certificates.manage (new-manage, human-recorded in 11-DECISIONS.md) is the template-authoring permission; only Administrator holds it, inherited automatically via its existing full-PERMISSIONS spread — no other default role held certificates.issue to begin with"
  - "update() only re-validates/re-stamps layout when the caller actually supplies a layout key; a rename-only edit leaves the stored layout untouched instead of overwriting it with EMPTY_LAYOUT_V1 (create's documented no-layout behavior does not apply to update — an unstated but load-bearing distinction)"
  - "Introduced certificate-default-template-layout.ts (not in the plan's files_modified list) as a pure, side-effect-free shared fixture, since prisma/seed.ts cannot be safely imported into a test file (its bottom-of-file main() call runs against a real database on import)"

patterns-established:
  - "A resource-service consumer's archive-time invariant belongs inside archiveData, not as an outer wrapper around baseService.archive — keeps the permission check as the very first thing that runs"

requirements-completed: [CRD-03]

# Metrics
duration: ~25min
completed: 2026-09-18
---

# Phase 11 Plan 05: Certificate Template Service Summary

**CertificateTemplate CRUD on createResourceService with write-boundary layout validation, a transactional single-default invariant, and one seeded renderable default template.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-18T07:55:00+01:00 (approx.)
- **Completed:** 2026-09-18T08:06:32+01:00
- **Tasks:** 3
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments
- Added `certificates.manage` to the closed permission catalogue (now 37 identifiers) per the human's recorded `new-manage` decision, granted only to Administrator
- Built `certificateTemplateService` on `createResourceService` with `parseCertificateTemplateLayout` running before every create/update write, so a blob the renderer cannot draw never reaches the database
- Implemented `setDefaultTemplate` (transactional default swap) and `listSelectableTemplates` (archived-excluded picker view), plus the archive-the-only-default guard wired through the factory's own `archiveData` hook
- Seeded exactly one renderable "Default certificate" template on every fresh deployment, verified idempotent across two consecutive `npx prisma db seed` runs against the real (Neon) database

## Task Commits

Each task was committed atomically:

1. **Task 1: Apply the recorded template-authoring permission decision** - `05ba665` (feat)
2. **Task 2: certificate-template-service.ts — CRUD, layout validation, single-default invariant** - `8e8d44c` (feat)
3. **Task 3: Seed one usable default template** - `94d4fdd` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified
- `src/server/services/certificate-template-service.ts` - CertificateTemplate CRUD, layout validation wrap, setDefaultTemplate, listSelectableTemplates, DefaultTemplateRequiredError/ArchivedTemplateError
- `src/server/services/certificate-default-template-layout.ts` - Pure shared fixture: the seeded default layout, parsed once at import time
- `tests/certificate-template-service.test.ts` - 19 cases: CRUD, layout rejection, single-default invariant, archive guard, denial cases, seeded-layout assertions
- `src/server/permissions/catalogue.ts` - Added `certificates.manage` (37th identifier)
- `src/lib/permission-groups.ts` - Added `certificates.manage` to the Certificates presentation group (kept the exhaustiveness test green)
- `tests/permissions.test.ts` - Catalogue-length assertion updated 36 -> 37
- `prisma/seed.ts` - Idempotent "Default certificate" seed step (find-by-name then create/update), Administrator role comment, `certificateTemplates` added to the summary count block

## Decisions Made
- Template-authoring permission: `certificates.manage`, per 11-DECISIONS.md's human-recorded `new-manage` choice. Role list explicitly checked by reading `prisma/seed.ts`'s `DEFAULT_ROLES`: only **Administrator** already held `certificates.issue` (via its `[...PERMISSIONS]` spread) — Programme Manager holds `certificates.view` only, and Instructor/Finance/Learner hold none of the three. So Administrator is the only default role that gains `certificates.manage`, and it does so automatically through the existing spread; no other role's permission list was touched.
- `update()`'s no-`layout`-supplied behavior deliberately diverges from `create()`'s: `create` with no layout stores `EMPTY_LAYOUT_V1` (as specified), but `update` with no `layout` key leaves the stored layout completely untouched. The plan's behavior list only specifies `create`'s empty-layout case; applying the same rule to `update` would have silently blanked a working template's layout on every rename-only edit — treated as a Rule 1 correctness fix within Task 2's own scope, not a deviation from an explicit instruction.
- `certificate-default-template-layout.ts` extracted as a new, plan-unlisted file: `prisma/seed.ts` cannot be imported by a test (its unconditional bottom-of-file `main()` call would execute a real seed run against the database), so the seeded layout needed a side-effect-free home both `seed.ts` and the test file could import without duplicating (and risking drift in) the same JSON literal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `src/lib/permission-groups.ts`'s Certificates group**
- **Found during:** Task 1
- **Issue:** `PERMISSION_GROUPS` in `src/lib/permission-groups.ts` lists the three pre-existing certificate permissions; `tests/permission-groups.test.ts`'s exhaustiveness test (`covers every catalogue permission exactly once, in both directions`) would fail the moment `certificates.manage` was added to the catalogue, since the new identifier would have no group.
- **Fix:** Added `"certificates.manage"` to the `certificates` group's `permissions` array.
- **Files modified:** `src/lib/permission-groups.ts`
- **Verification:** `npx vitest run tests/permission-groups.test.ts tests/permissions.test.ts` — 16/16 passed.
- **Committed in:** `05ba665` (Task 1 commit)

**2. [Rule 3 - Blocking] Added `certificate-default-template-layout.ts` as a new shared module**
- **Found during:** Task 3
- **Issue:** Task 3's acceptance criteria require the test file to assert the seeded layout parses, renders, and contains no `image` element — but `prisma/seed.ts` cannot be imported by a test without executing its real-database `main()` call, and duplicating the raw layout literal in both files would itself be the "second, untested layout" the task's own action text warns against.
- **Fix:** Extracted the raw layout + its parsed `CertificateTemplateLayoutV1` into a new pure module with no data-access import, imported identically by `prisma/seed.ts` and `tests/certificate-template-service.test.ts`.
- **Files modified:** `src/server/services/certificate-default-template-layout.ts` (new), `prisma/seed.ts`, `tests/certificate-template-service.test.ts`
- **Verification:** `npx vitest run tests/certificate-template-service.test.ts` (19/19 passed, including the 4 seeded-layout cases); two consecutive `npx prisma db seed` runs both reported `certificateTemplates 1`.
- **Committed in:** `94d4fdd` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking, needed to keep the existing test suite green / to avoid an untested duplicate layout)
**Impact on plan:** Both changes are small, mechanically necessary, and match the plan's own stated intent (no drifting duplicate layout, no broken catalogue-shape test). No scope creep — no new capability was added beyond what Tasks 1 and 3 already specified.

## Issues Encountered
- A test-fixture typing mismatch (`Delegate<T>.findMany`'s `where?: unknown` vs. a narrower fake signature) was caught only by `tsc --noEmit`, not by `vitest run` — fixed by widening the fake's parameter type and casting internally, per the plan's own `npx tsc --noEmit` gate. No production code was affected.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `certificateTemplateService`, `setDefaultTemplate`, and `listSelectableTemplates` are exported and ready for plan 11-08 (Course/Programme picker), 11-09/11-12 (template editor), and 11-07 (issuance) to consume.
- A real, renderable default template exists in the database (Neon, dev), verified via `renderCertificatePdf` producing a `%PDF`-headed document from the seeded layout.
- No blockers. The `licence`/`catalogue`-count prose comments elsewhere in the codebase (e.g. `attempt-service.ts`, `lesson-progress-service.ts`) still say "36-identifier" — now stale at 37; out of this plan's declared scope (not test-enforced), worth a documentation pass whenever those files are next touched.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
