---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 23
subsystem: catalogue-media
tags: [nfr-09, nfr-06, captions, webvtt, lesson-video, prisma, route-handler]
status: complete

requires:
  - phase: 15-01
    provides: 15-DECISIONS.md NFR-09 decision (option-a, build captions) and the agreed shared-UI row for LessonMediaPlayer and LessonContent
  - phase: 15-16
    provides: migration 20261007120000_user_anonymisation (applied before this one)
provides:
  - "LessonResource.captionForResourceId (self-relation ResourceCaptions, cascade), captionLanguage, captionLabel, index; migration 20261008120000_lesson_video_captions"
  - "Upload kind CAPTION (text/vtt only, 1 MB) in UPLOAD_LIMITS, plus CAPTION_LANGUAGE_PATTERN, isValidCaptionLanguage and the label/length limits"
  - "lesson-resource-service: caption input on beginLessonResourceUpload (CaptionAttachmentError), listLessonCaptions (staff), listLessonCaptionsForLearner (READY only), readCaptionForLearnerOrStaff(actor, id)"
  - "storage-service: readLessonObjectBounded and StoredObjectTooLargeError"
  - "Route GET /api/lesson-resources/[id]/captions (same-origin text/vtt, private no-store, empty 404 on every refusal)"
  - "LessonMediaPlayer captions prop (one track per caption, first default); LessonContent captions prop; learner lesson page passes READY captions"
affects: [15-24 caption authoring panel and readiness warning, 15-25 route bypass inventory, 15-31 Neon go-live list]

requirements-completed: []

actuals:
  tokens: 12000
  tasks: 3
  commits: 0

key-files:
  created:
    - prisma/migrations/20261008120000_lesson_video_captions/migration.sql
    - src/app/api/lesson-resources/[id]/captions/route.ts
    - tests/captions.integration.test.ts
    - tests/captions-route.test.ts
    - tests/components/lesson-media-player.test.tsx
  modified:
    - prisma/schema.prisma
    - src/lib/upload-limits.ts
    - src/server/services/lesson-resource-service.ts
    - src/server/services/storage-service.ts
    - src/components/catalogue/LessonMediaPlayer.tsx
    - src/components/catalogue/LessonContent.tsx
    - src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx
    - tests/upload-limits.test.ts
    - tests/lesson-resource-service.test.ts
    - tests/learner-lesson-page.test.ts
    - tests/learning-phase-invariants.test.ts

key-decisions:
  - "READY is the CLEAN state. The scan-status column was replaced by uploadStatus (migration 20260910120000); the existing upload gate is intent, direct PUT, completion that verifies size and content type, then READY. Captions go through that same gate, and every caption reader (route, learner track list) requires READY."
  - "Caption rows live in LessonResource but are excluded from listLessonResources and listLessonResourcesForLearner, so the lesson renderer's resources[0] stays the file, image or video itself."
  - "Captions are served by the app (bounded read, 1 MB) instead of a presigned redirect because a track element cannot follow a redirect to storage without bucket CORS; video keeps its redirect."
  - "removeLessonResource also deletes the caption objects of a removed video, since the database cascade only removes the rows."

duration: resumed session
completed: 2026-10-09
---

# Phase 15 Plan 23: WebVTT captions for lesson video Summary

Lesson videos can now carry scanned WebVTT caption tracks that learners switch on in the native player, served through an authorised, uncached, same-origin route (NFR-09, NFR-06).

## What was done

- **Task 1 (tracer, passed end to end).** Additive migration and schema (three nullable columns, an index, a cascading self-relation). `CAPTION` upload kind accepts only `text/vtt`, 1 MB; `text/vtt` is still rejected for VIDEO, FILE and IMAGE. The service validates a caption upload (text/vtt within the cap, language is a BCP 47 tag, label 1 to 60 characters, parent is an ordinary resource of a VIDEO lesson in the same lesson and not itself a caption) and refuses with `CaptionAttachmentError`, writing no row. `readCaptionForLearnerOrStaff` decides access like the download route (staff `courses.view` on the resource's course, otherwise a learner who can open the lesson) and returns `null` for an unknown id, a non-caption, a non-READY upload or no access; the route turns `null` into an empty 404 and otherwise returns the body as `text/vtt; charset=utf-8` with `Cache-Control: private, no-store` and `nosniff`.
- **Task 2 (TDD).** `LessonMediaPlayer` renders one `<track kind="captions" srclang label>` per caption (first one `default`) with `src=/api/lesson-resources/{id}/captions`, and no track at all without captions. `LessonContent` passes the captions belonging to the video resource; the learner lesson page loads READY captions for VIDEO lessons only. The header comment was rewritten to say tracks render only for real, scanned caption files. The invariants test now checks by AST that the single `<track>` sits inside `captions.map(...)`.
- **Task 3 ([BLOCKING] push).** On the local Docker database only: `assert-local-db` passed, `prisma migrate deploy` applied the new migration, `migrate status` printed "Database schema is up to date!", `prisma generate` ran, `tsc --noEmit` is clean. A `migrate diff` from the local database to the schema is empty, so the migration SQL matches the schema exactly. No `db push`, no data-loss flag.

## Verification

- `npx prisma validate` ok; `npx tsc --noEmit` exit 0; eslint clean on every touched source and test file.
- `tests/captions-route.test.ts` 3 passed; `tests/captions.integration.test.ts` 18 passed (Testcontainers, real PostgreSQL); `tests/upload-limits.test.ts` and `tests/lesson-resource-service.test.ts` pass (64 together with the route test); `tests/components/lesson-media-player.test.tsx`, `tests/components/lesson-content.test.tsx`, `tests/learning-phase-invariants.test.ts` pass; `tests/learner-lesson-page.test.ts` 26 passed; `tests/unit/design-contract.test.ts` 107 passed; `tests/licence-action-refusal.test.ts` passed.
- Integration coverage: attach rules (non-VTT, oversized, wrong-lesson parent, non-video parent, unknown parent, bad language, empty label, caption-of-caption all refused with no row), captions absent from the ordinary lists, enrolled learner allowed, other learner and anonymous refused without a storage read, UPLOADING and ERROR refused to learners and staff, non-caption id refused, staff with `courses.view` on the course allowed and staff scoped to another course refused, learners offered READY tracks only, removing a video removes its caption rows and deletes their objects.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing test fixtures needed the new storage method and page export**
- **Found during:** Task 1 and Task 2
- **Issue:** `LessonResourceStorage` gained `readBounded`, and the learner lesson page now imports `listLessonCaptionsForLearner`; `tests/lesson-resource-service.test.ts` and `tests/learner-lesson-page.test.ts` mock these modules and failed (5 page tests).
- **Fix:** Added `readBounded` to the service test's storage double; added the new mock export to the page test, plus two new page tests (captions reach the player for a VIDEO lesson; no caption lookup for a TEXT lesson).
- **Files modified:** `tests/lesson-resource-service.test.ts`, `tests/learner-lesson-page.test.ts`

**2. [Rule 2 - Missing critical functionality] Caption rows must not enter the ordinary resource lists**
- **Found during:** Task 1
- **Issue:** Captions are `LessonResource` rows of the same lesson. The lesson renderer and staff list use `resources[0]` as the file or video, so an unfiltered list could make a caption the "video".
- **Fix:** `listLessonResources` and `listLessonResourcesForLearner` exclude caption rows; separate caption lists were added. Also made `removeLessonResource` delete caption objects when their video is removed.
- **Files modified:** `src/server/services/lesson-resource-service.ts`

**3. [Interpretation] "CLEAN" scan state**
- The plan wording says CLEAN; the schema has `uploadStatus` UPLOADING, READY, ERROR (scan status was replaced in migration 20260910120000). READY is treated as CLEAN throughout.

**4. [Test design] Learner access is injected in the integration test**
- The integration test uses the real service factory and Prisma delegate on a real database, but injects `canOpenLesson` (the real pinned-version, unlock and access-window logic has its own suites) and mocks object storage at the service boundary, as the plan allowed.

### Not changed (out of scope, owned elsewhere)

- The upload-intent route is untouched: accepting a caption kind in the route (CAPTION kind, `captionForResourceId`, language, label) is plan 15-24. The service already supports it and enforces all the rules, so the route only needs to pass the fields through.
- The staff preview page (`src/app/staff/courses/[id]/preview/lessons/[lessonId]/page.tsx`) does not pass captions to `LessonContent`, so a staff preview of a captioned video shows no track. It is not in this plan's file list; 15-24 or a follow-up can pass `listLessonCaptions` READY rows if wanted.

## Neon go-live list

- `prisma/migrations/20261008120000_lesson_video_captions/migration.sql` (additive: three nullable columns, one index, one self-referencing foreign key; no DROP). Apply after `20261007120000_user_anonymisation`, with `prisma migrate deploy`, never `db push`. Plan 15-31 should add it to the ordered Neon list. Applied to the local Docker database only.

## Threat model

- T-15-23-01 (disclosure): same access decision as the download route, empty 404 parity, `private, no-store`. The new route still needs adding to the bypass suite by plan 15-25's inventory.
- T-15-23-02 (tampering): `text/vtt` only for CAPTION, 1 MB cap, same upload gate; only READY captions are served or rendered.
- T-15-23-03 (denial of service): size check on the row, declared-length check and received-length check in `readLessonObjectBounded`.
- T-15-23-04 (migration): additive only, applied locally after the guard.

## Known Stubs

None.

## Threat Flags

None beyond the planned captions route (covered by T-15-23-01).

## Requirements

`requirements.ready-ids` reports NFR-09 and NFR-06 as blocked (NFR-09 also needs 15-24; NFR-06 is shared with other plans), so nothing was marked complete.

## Self-Check: PASSED

- Files exist: migration.sql, captions route.ts, the three new test files, SUMMARY (checked).
- Local database reports "Database schema is up to date!"; `tsc --noEmit` exit 0; targeted tests listed above pass.
- No commits were made and nothing is staged (owner instruction).
