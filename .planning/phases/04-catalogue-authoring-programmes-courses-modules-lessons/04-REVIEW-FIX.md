---
status: all_fixed
phase: "04"
phase_name: "Catalogue Authoring - Programmes, Courses, Modules & Lessons"
review_file: ".planning/phases/04-catalogue-authoring-programmes-courses-modules-lessons/04-REVIEW.md"
findings_in_scope: 5
fixed: 5
skipped: 0
iteration: 1
---

# Phase 04 Code Review Fix Report

## Summary

All five Phase 04 standard code-review findings were fixed.

## Fixes

- CR-01: `docker-compose.yml` now fail-closes when `AUTH_SECRET` is missing instead of using the known `change-me-before-production` default.
- CR-02: Added a top-level course creation UI at `/staff/courses/new`, a `CourseForm`, a server action wired to `courseService.create`, and changed the `/staff/courses` "New course" affordance from disabled button to route link.
- CR-03: `commitLessonOrder` now verifies every touched module belongs to the authorized parent course before reading or moving lessons.
- CR-04: Programme unpublish now requires `programmes.publish`; Course unpublish still requires `courses.publish`.
- WR-01: Lesson resource uploads now persist the measured streamed byte count returned by storage, not the client-declared metadata size.

## Verification

- `npx.cmd vitest run tests/docker-compose-config.test.ts tests/components/course-form.test.tsx tests/components/courses-table.test.tsx tests/reorder.test.ts tests/publish-service.test.ts tests/lesson-resource-routes.test.ts`
  - Passed: 6 files, 55 tests.
- `npx.cmd eslint docker-compose.yml src/app/api/lesson-resources/upload/route.ts src/app/staff/courses/CoursesTable.tsx src/app/staff/courses/CourseForm.tsx src/app/staff/courses/actions.ts src/app/staff/courses/new/page.tsx src/server/services/publish-service.ts src/server/services/reorder-service.ts tests/components/courses-table.test.tsx tests/components/course-form.test.tsx tests/docker-compose-config.test.ts tests/lesson-resource-routes.test.ts tests/publish-service.test.ts tests/reorder.test.ts`
  - Passed for changed code files.
  - Warning: `docker-compose.yml` is ignored by the ESLint configuration.
- `npm.cmd run build`
  - Passed. Route manifest includes `/staff/courses/new`.

## Notes

- `npm.cmd run lint` and `npm.cmd test` were attempted, but both remained silent and active for several minutes in this environment and were stopped. Focused regression tests, targeted ESLint, and production build completed successfully.
