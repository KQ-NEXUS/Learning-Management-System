---
phase: 11-certificates-completion-lifecycle
plan: 20
subsystem: staff-catalogue
tags: [certificates, courses, server-actions, gap-closure, uat]
requires: ["11-16"]
provides:
  - "updateCourseAction (courses.edit at course scope, audited via courseService.update)"
  - "course-schema.ts with strict createCourseSchema / updateCourseSchema"
  - "CourseForm mode create|edit and /staff/courses/[id]/edit route"
affects: [staff-courses, certificate-settings]
tech-stack:
  added: []
  patterns:
    - "schemas live outside 'use server' files"
    - "changed-only template validation; absent disabled controls mean unchanged"
key-files:
  created:
    - src/app/staff/courses/course-schema.ts
    - "src/app/staff/courses/[id]/edit/page.tsx"
    - tests/course-actions.test.ts
  modified:
    - src/app/staff/courses/actions.ts
    - src/app/staff/courses/CourseForm.tsx
    - "src/app/staff/courses/[id]/page.tsx"
    - src/components/catalogue/CertificateSettingsFields.tsx
    - tests/components/course-form.test.tsx
    - tests/components/programme-form.test.tsx
key-decisions:
  - "Archived stored template rendered as a disabled selected option via a new optional archivedTemplate prop on the shared CertificateSettingsFields (not forked); a disabled selected option is omitted from FormData so the stored value stays unchanged"
  - "Edit page resolves the archived template's name through certificateTemplateService.get, tolerating an authorization failure"
requirements-completed: [CRD-01, CRD-02, CRD-03]
duration: ~35 min
completed: 2026-09-19
---

# Phase 11 Plan 20: Course edit path Summary

An existing Course can now be edited at `/staff/courses/[id]/edit`: certificate enablement, issuance mode and template persist through `updateCourseAction`, authorised by `courses.edit` at course scope and audited as `course.updated` by the resource factory (closes UAT test 6).

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1. Strict schema module + updateCourseAction | 76c7255 | 16 tests |
| 2. Edit-capable CourseForm, edit route, entry link | 435661d | 9 form tests (8 new) |
| 3. Programme edit form certificate-settings tests | 41c2adc | 3 new tests |

## RED verification

- Task 1: `tests/course-actions.test.ts` written first and run against the repo before `updateCourseAction` existed: 14 failed ("updateCourseAction is not a function"), the 2 schema tests passed (the schema module already existed). Then 16/16 green with `tests/course-service.test.ts` (18 total).
- Task 2: the 8 new edit-mode form tests were written first: 6 failed against the create-only form, 3 passed (existing create test plus two tests that assert create-mode behaviour). All green after the change.
- Task 3: the 3 Programme tests passed on first run; no defect found (see below).

## What was built

- `course-schema.ts`: `createCourseSchema` (behaviour unchanged, now `.strict()`) and `updateCourseSchema` (`.strict()`, blank optional text becomes `null`, `durationHours` mapped blank-to-null BEFORE parsing and parsed with `z.number()` not `z.coerce`, so blank does not become 0).
- `updateCourseAction`: hidden `courseId`; loads row, reload message if missing; slug freeze (`assertSlugMutable`) only on a changed slug; `assertTemplateSelectable` only when the submitted template differs from the stored one; update data built only from named fields with undefined keys omitted; `courseService.update(id, data, "Edited from the course editor.")`; revalidates staff and public catalogue paths. `toFailure` now takes a verb, handles `SlugFrozenError`, and passes `error.message` through only for the two user-facing domain errors.
- `CourseForm`: discriminated union like `ProgrammeForm`; checkbox seeded from the course; outcomes and prerequisites controlled to survive a rejected save; "Saved." status; "Save changes" label.
- Edit route: `await params`, `courseService.get` inside try mapping auth errors to `notFound()`, `can("courses.edit")` gate, template list with graceful fallback, only serialisable values passed.
- Detail page: "Edit course" link shown only when `can("courses.edit", { courseIds: [id] })`, added to the existing `Promise.all`.

## Programme edit path

Verified by component test only (not in a browser): prefilled Automatic radio and template, submitted `programmeId` + changed mode/template, and disabled controls with absent keys when certificates are off. All passed on the first run; `ProgrammeForm.tsx` needed no change.

## Deviations from Plan

**1. [Rule 2 - Missing functionality] `CertificateSettingsFields` gained an optional `archivedTemplate` prop.** The plan requires the archived stored template to stay visible in the shared picker; that needs a small addition to the shared component (`src/components/catalogue/CertificateSettingsFields.tsx`, not in the plan's file list). It is additive; the existing certificate-settings-form tests still pass. Commit 435661d.

**2. [Rule 3] Edit page imports `certificateTemplateService`** to label an archived stored template with its name (fallback label "Current template"). Not a new dependency.

No package installs (`git diff package.json package-lock.json` empty).

## Verification

- Targeted vitest: course-actions, course-service, course-form, certificate-settings-form, programme-form, programme-service, boundary, design-contract all green.
- `npx tsc --noEmit` exit 0.
- `npx next build` clean; `/staff/courses/[id]/edit` listed as dynamic.
- No raw hex colours in `src/app/staff/courses`; `error.message` appears only for `SlugFrozenError` and `TemplateNotSelectableError` (plus a comment).
- Not verified in a browser: UAT test 6 still needs a browser re-check.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register (T-11-80 to T-11-85 mitigated as specified).

## Self-Check: PASSED

Files and commits 76c7255, 435661d, 41c2adc present.
