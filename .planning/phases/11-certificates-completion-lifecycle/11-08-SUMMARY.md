---
phase: 11-certificates-completion-lifecycle
plan: 08
subsystem: ui
tags: [react, zod, next-server-actions, certificates, forms]

# Dependency graph
requires:
  - phase: 11-01
    provides: certificateIssuanceMode and certificateTemplateId columns on Course/Programme
  - phase: 11-05
    provides: listSelectableTemplates() (non-archived templates only)
provides:
  - CertificateSettingsFields shared component (src/components/catalogue) — the one implementation of the issuance-mode segmented control + template select
  - Course and Programme edit/create forms both expose D-02 issuance mode and D-10 template selection
  - assertTemplateSelectable server-side guard wired into both Course and Programme create/update actions (T-11-33)
affects: [certificate-issuance-service, certificate-template-service, staff-catalogue-forms]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared form-fragment component in src/components/catalogue/ consumed by both CourseForm and ProgrammeForm, matching the LessonFormFields/AssessmentFormFields precedent"
    - "Disabled-when-dependent-off controls: a disabled native input is excluded from FormData by the browser, so the consuming action's zod schema treats the field as optional rather than required"
    - "Server-side re-resolution against the live selectable-template list (assertTemplateSelectable), never trusting the client-rendered <option> list"

key-files:
  created:
    - src/components/catalogue/CertificateSettingsFields.tsx
  modified:
    - src/app/staff/courses/CourseForm.tsx
    - src/app/staff/courses/actions.ts
    - src/app/staff/courses/new/page.tsx
    - src/app/staff/programmes/ProgrammeForm.tsx
    - src/app/staff/programmes/actions.ts
    - src/app/staff/programmes/new/page.tsx
    - src/app/staff/programmes/[id]/page.tsx
    - src/server/services/certificate-template-service.ts
    - src/components/catalogue/index.ts
    - tests/components/certificate-settings-form.test.tsx

key-decisions:
  - "Both certificateIssuanceMode and certificateTemplateId are optional in both actions' zod schemas, not required — a disabled control (certificateEnabled false) is never present in FormData, so a required enum would reject every certificates-off create/update"
  - "certificateTemplateId resolves through a shared assertTemplateSelectable guard called from both Course and Programme actions, re-checking the live listSelectableTemplates() output server-side rather than trusting the client's rendered options"
  - "course-service.ts and programme-service.ts needed no field allow-list change — both forward `data` wholesale to the Prisma delegate via the resource-service factory, verified by reading resource-service.ts's update path rather than assumed"
  - "new/page.tsx and [id]/page.tsx for both Course and Programme tolerate a certificates.view-less caller by catching AuthorizationError/AuthenticationError from listSelectableTemplates() and falling back to an empty template list, so the form still renders with only the default-template option instead of a hard page denial"

patterns-established:
  - "CertificateSettingsFields is the single owner of the issuance-mode + template picker markup; any future consumer (e.g. a bulk-edit surface) should import it rather than reimplementing the controls"

requirements-completed: [CRD-01, CRD-02, CRD-03]

# Metrics
duration: resumed session (Task 1 committed 2026-09-18T08:38:31Z in a prior interrupted run; Task 2 verified/committed 2026-09-18T13:36:35Z in this session, ~15min of active verification+commit work)
completed: 2026-09-18
---

# Phase 11 Plan 08: Certificate Settings on Course/Programme Forms Summary

**Course and Programme edit forms both expose D-02's automatic/manual issuance mode and D-10's template picker through one shared `CertificateSettingsFields` component, with server-side archived-template rejection on both actions.**

## Performance

- **Duration:** Resumed plan — Task 1 was committed in a prior, interrupted executor run (`4c46715`); this session verified Task 1 was fully satisfied without redoing it, then executed and committed Task 2.
- **Started:** Task 1 commit 2026-09-18T08:38:31Z (prior session) / this session began ~2026-09-18T13:32Z
- **Completed:** 2026-09-18T13:36:35Z
- **Tasks:** 2 (2 complete)
- **Files modified:** 7 in Task 1, 5 in Task 2 (2 overlap: `CertificateSettingsFields.tsx` and the shared test file were touched by both)

## Accomplishments
- `CertificateSettingsFields` (`src/components/catalogue/`) is the single implementation of the "Certificate issuance" segmented control (radiogroup, `AUTOMATIC`/`MANUAL`) and the "Certificate template" `<select>` populated from `listSelectableTemplates()`, disabled whenever the parent's `certificateEnabled` is off.
- Both `CourseForm` and `ProgrammeForm` consume that one component — `grep -rl "Certificate issuance" src/app/ src/components/` returns exactly one path (`CertificateSettingsFields.tsx`), confirming no duplicate markup exists.
- Both `courses/actions.ts` and `programmes/actions.ts` add `certificateIssuanceMode`/`certificateTemplateId` as optional fields to their `.strict()` zod schemas, and both create/update actions call `assertTemplateSelectable` before persisting, rejecting an archived (or otherwise non-selectable) template id even from a hand-crafted request (T-11-33).
- Neither `course-service.ts` nor `programme-service.ts` needed an allow-list edit — both forward `data` wholesale to the Prisma delegate through the shared resource-service factory.
- `new/page.tsx` and `[id]/page.tsx` for both Course and Programme load `listSelectableTemplates()` for the picker and degrade gracefully (empty list, not a page-level denial) for a caller who can manage the resource but lacks `certificates.view`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Course certificate settings — issuance mode and template picker** - `4c46715` (feat) — committed in a prior interrupted executor session, verified in this session against the plan's read_first/acceptance criteria rather than redone.
2. **Task 2: Programme certificate settings — the same two controls** - `7df69d7` (feat)

**Plan metadata:** (this commit, made after this Summary)

## Files Created/Modified
- `src/components/catalogue/CertificateSettingsFields.tsx` - Shared issuance-mode + template-select component (created in Task 1, consumed by both forms after Task 2)
- `src/components/catalogue/index.ts` - Exports `CertificateSettingsFields` and its types
- `src/app/staff/courses/CourseForm.tsx` - Lifts `certificateEnabled` into local state, renders the shared controls (Task 1)
- `src/app/staff/courses/actions.ts` - Adds both fields to the strict zod schema, calls `assertTemplateSelectable` (Task 1)
- `src/app/staff/courses/new/page.tsx` - Loads `listSelectableTemplates()` for the create form (Task 1)
- `src/server/services/certificate-template-service.ts` - `createTemplateSelectionGuard` / `assertTemplateSelectable` / `TemplateNotSelectableError` (Task 1)
- `src/app/staff/programmes/ProgrammeForm.tsx` - Consumes `CertificateSettingsFields`; Programme's `certificateEnabled` defaults `true` with no editable toggle on this form, so the controls are enabled by default (Task 2)
- `src/app/staff/programmes/actions.ts` - Adds both fields to the strict zod schema, calls `assertTemplateSelectable` in create and update (Task 2)
- `src/app/staff/programmes/new/page.tsx` - Loads `listSelectableTemplates()` for the create form (Task 2)
- `src/app/staff/programmes/[id]/page.tsx` - Loads `listSelectableTemplates()` and passes stored values into the edit form (Task 2)
- `tests/components/certificate-settings-form.test.tsx` - 14 cases covering the shared component, `CourseForm`, `ProgrammeForm`, and the `assertTemplateSelectable` guard

## Decisions Made
- Both new fields are `.optional()` in both actions' zod schemas rather than required, because a disabled input (certificates off) is never present in submitted `FormData` — a required enum would reject every "certificates off" create.
- Server-side archived-template rejection is a single shared guard (`assertTemplateSelectable`, injectable via `createTemplateSelectionGuard`) called identically from both Course and Programme actions, rather than two independent implementations.
- No service-layer allow-list edits were made to `course-service.ts`/`programme-service.ts` — verified by reading `resource-service.ts`'s `update` path, which forwards `data` wholesale; a speculative edit was deliberately not added.
- Both Course and Programme "new"/"[id]" pages catch `AuthorizationError`/`AuthenticationError` from `listSelectableTemplates()` and fall back to an empty template array (form still renders with only "Use the default template") rather than denying the page to a role that can manage the resource but lacks `certificates.view`.

## Deviations from Plan

None - plan executed exactly as written. Task 2's implementation (Programme form, actions, pages, and the extended test file) was found already present but uncommitted in the working tree at the start of this session — the prior executor run appears to have completed the code but was interrupted before the commit step. This session verified the code against every Task 2 acceptance criterion (shared-component grep, both forms importing it, zod fields present, disabled-state/default-template test assertions, `tsc --noEmit`, existing Course/Programme form suites green) before committing it, rather than re-implementing from scratch.

## Issues Encountered
- `npx vitest run` with the default thread pool timed out waiting for a worker to start (`[vitest-pool-runner]: Timeout waiting for worker to respond`), an environment/infra issue unrelated to the code under test. Re-ran with `--pool=forks`, which completed normally (14/14 tests passed in ~1s of actual test time). No code change required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 11-08 is complete: both Course and Programme forms are staff-operable for issuance mode and template selection, closing the gap plan 11-01 opened (schema fields with no UI) and giving plan 11-07's issuance/recalculation services a way for staff to actually choose `AUTOMATIC` vs `MANUAL` per Course/Programme.
- No blockers identified for subsequent Phase 11 plans.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*

## Self-Check: PASSED

All created/modified files confirmed present on disk (`CertificateSettingsFields.tsx`, `ProgrammeForm.tsx`, `programmes/actions.ts`, this SUMMARY.md). All referenced commits (`4c46715`, `7df69d7`, `2130bc1`) confirmed present in `git log --oneline --all`.
