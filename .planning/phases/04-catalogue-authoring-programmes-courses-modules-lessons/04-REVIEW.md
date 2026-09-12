---
status: issues
phase: "04"
phase_name: "Catalogue Authoring — Programmes, Courses, Modules & Lessons"
depth: standard
files_reviewed: 115
findings:
  critical: 4
  warning: 1
  info: 0
  total: 5
---

# Phase 04: Code Review Report

**Reviewed:** 2026-09-08T00:00:00Z
**Depth:** standard
**Files Reviewed:** 115
**Status:** issues

## Summary

Reviewed the Phase 4 catalogue authoring surface at standard depth, including staff routes, server actions, service-layer authorization, Prisma publication/reorder behavior, upload/download handling, public catalogue reads, and tests. The implementation still has blocker-level gaps in deployment security, course authoring completeness, cross-course lesson reorder authorization, and programme unpublish permissions.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Compose Starts With A Predictable Auth Secret

**Classification:** BLOCKER
**File:** `docker-compose.yml:127`
**Issue:** The self-hosted deployment path defaults `AUTH_SECRET` to `change-me-before-production`. This Compose file is described as the deployment path, not just a dev helper, so an operator who omits `AUTH_SECRET` gets a live app with a known session/signing secret. `.env.example:50` correctly leaves `AUTH_SECRET` empty, but Compose silently replaces that missing value with a public constant instead of failing closed.
**Fix:**
```yaml
AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET must be set}
```

### CR-02: Top-Level Course Create UI Is Missing

**Classification:** BLOCKER
**File:** `src/app/staff/courses/CoursesTable.tsx:190`
**Issue:** Phase 4 requires staff to build the full content model, including Courses, but the current staff Courses surface has no create route/action/form. The list page only renders `CoursesTable` (`src/app/staff/courses/page.tsx:24`), the table renders a disabled `New course` button (`src/app/staff/courses/CoursesTable.tsx:190-196`), and the regression test asserts that `New course` is disabled (`tests/components/courses-table.test.tsx:17-24`). The only `courses.create` implementation is the generic service binding (`src/server/services/course-service.ts:23-30`); there is no `src/app/staff/courses/new/page.tsx`, `src/app/staff/courses/actions.ts`, or `CourseForm` route/component. Staff cannot create standalone courses through the catalogue authoring UI, so module/lesson authoring depends on pre-existing seed/imported courses.
**Fix:** Add a protected `/staff/courses/new` page, a Course form, and `createCourseAction` that validates title/slug/summary/etc., calls `courseService.create`, revalidates `/staff/courses`, and redirects to `/staff/courses/{id}`. Replace the disabled header button with a link gated by `can("courses.create", {})`, mirroring the Programme create flow.

### CR-03: Lesson Reorder Can Mutate Lessons In Another Course

**Classification:** BLOCKER
**File:** `src/server/services/reorder-service.ts:301`
**Issue:** `commitLessonOrder` authorizes only `input.courseId` (`src/server/services/reorder-service.ts:301-304`) but then trusts the client-supplied `arrangement[].moduleId` list. It loads existing lessons with `where: { moduleId: { in: touchedModuleIds }, withdrawnAt: null }` (`src/server/services/reorder-service.ts:314-316`) and updates each lesson into each supplied module (`src/server/services/reorder-service.ts:332-337`) without proving those modules belong to the authorized course. A user with `courses.edit` on Course A can submit a complete arrangement for modules in Course B and reorder/reparent Course B lessons while only passing the Course A scope check. Existing tests cover a foreign lesson inserted into a local module, but not a complete foreign module group.
**Fix:**
```ts
const modules = await tx.module.findMany({
  where: { id: { in: touchedModuleIds }, courseId: input.courseId, withdrawnAt: null },
  select: { id: true },
});
verifyArrangement(touchedModuleIds, modules.map((module) => module.id));
```
Then keep all lesson reads/writes constrained to those verified module ids.

### CR-04: Programme Unpublish Uses The Course Publish Permission

**Classification:** BLOCKER
**File:** `src/server/services/publish-service.ts:569`
**Issue:** The shared `unpublishContent` operation is hard-coded to `"courses.publish"` (`src/server/services/publish-service.ts:569-571`) for both Course and Programme targets. The Programme detail action and UI contract say programme content publishing/listing uses `programmes.publish` (`src/app/staff/programmes/[id]/publish-actions.ts:7-8`, `src/app/staff/programmes/[id]/page.tsx:63-65`), and publish itself correctly uses `programmes.publish` (`src/server/services/publish-service.ts:528`). As written, a legitimate programme publisher without `courses.publish` cannot unpublish a programme, while a mis-scoped `courses.publish` grant on a Programme resource can pass the wrong permission check. Tests only cover the Course branch of `unpublishContent` (`tests/publish-service.test.ts:485-517`), so the Programme branch is unproven.
**Fix:**
```ts
const unpublishContent = withPermission<{ kind: PublishKind; id: string; reason: string }>(
  (input) => input.kind === "Course" ? "courses.publish" : "programmes.publish",
  (input) => input.kind === "Course" ? courseScope(input.id) : programmeScope(input.id),
)(...)
```
If `withPermission` cannot accept a dynamic permission, split this into `unpublishCourseContent` and `unpublishProgrammeContent` wrappers that share an internal implementation after authorization.

## Warnings

### WR-01: Upload Metadata Stores The Declared Size Instead Of The Measured Size

**Classification:** WARNING
**File:** `src/app/api/lesson-resources/upload/route.ts:84`
**Issue:** `putLessonObject` measures and returns the actual streamed byte count (`src/server/services/storage-service.ts:88-114`), but the upload route ignores that return value and stores `BigInt(meta.sizeBytes)` from query metadata (`src/app/api/lesson-resources/upload/route.ts:84-98`). A client can declare `sizeBytes=1` while streaming a much larger object under the per-type cap; the resource row, UI size display, audit trail, and any future quota/accounting logic then carry false data.
**Fix:**
```ts
const { bytesUploaded } = await putLessonObject({
  key: storageKey,
  body: toNodeStream(source),
  contentType: meta.mimeType,
  maxBytes,
});

const resource = await createLessonResource({
  lessonId: meta.lessonId,
  title: meta.title,
  storageKey,
  filename: meta.filename,
  mimeType: meta.mimeType,
  sizeBytes: BigInt(bytesUploaded),
});
```
Optionally reject requests where declared and measured sizes differ if the client needs a strict integrity check.

---

_Reviewed: 2026-09-08T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
