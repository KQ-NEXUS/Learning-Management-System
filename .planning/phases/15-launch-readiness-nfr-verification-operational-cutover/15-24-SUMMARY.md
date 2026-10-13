---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 24
subsystem: catalogue-media
tags: [nfr-09, captions, webvtt, lesson-editor, publication-readiness, route-handler]
status: complete

requires:
  - phase: 15-01
    provides: 15-DECISIONS.md NFR-09 decision (option-a, build captions) and the agreed shared-UI row for UploadPanel and ReadinessPanel
  - phase: 15-08
    provides: shared design-contract and licence gates the new component had to satisfy
  - phase: 15-23
    provides: CAPTION upload kind, caption columns, beginLessonResourceUpload caption input, listLessonCaptions, readCaptionForLearnerOrStaff, learner player tracks
provides:
  - "CaptionPanel (src/components/catalogue/CaptionPanel.tsx): add (.vtt file, language default en, label default English) and request removal of caption tracks for one VIDEO resource, with Scanning / Ready / Failed in words"
  - "UploadPanel renders CaptionPanel under every VIDEO row that has not failed, owns caption state and the single remove-confirmation dialog"
  - "Upload-intent route accepts kind CAPTION with captionForResourceId, captionLanguage, captionLabel (400 without the parent id or when caption fields ride an ordinary upload; plain 422 for refusals)"
  - "lesson-resource-service removeCaption (courses.edit, caption rows only, deletes row and object, audited as lessonresource.caption_removed); listLessonCaptions now also returns uploadDetail"
  - "GET /api/lesson-resources?lessonId=..&includeCaptions=1 returns the lesson's caption tracks; DELETE /api/lesson-resources/{id}?caption=1 removes a caption through removeCaption"
  - "Readiness item video-captions (Content): WARN, non-blocking, '1 video lesson has no captions.' / '{n} video lessons have no captions.'; PASS when every live video lesson has a READY caption; absent when the course has no live video lesson"
  - "Shared plain caption refusal messages in src/lib/upload-limits.ts used by both the form and the service"
affects: [15-25 route bypass inventory (two route variants changed), 15-31 launch checklist (no new migration in this plan)]

requirements-completed: []

actuals:
  tokens: 17500
  tasks: 2
  commits: 0

key-files:
  created:
    - src/components/catalogue/CaptionPanel.tsx
    - tests/components/caption-panel.test.tsx
    - tests/captions-authoring.integration.test.ts
  modified:
    - src/components/catalogue/UploadPanel.tsx
    - src/app/api/lesson-resources/upload-intent/route.ts
    - src/server/services/lesson-resource-service.ts
    - src/app/api/lesson-resources/route.ts
    - src/app/api/lesson-resources/[id]/route.ts
    - src/server/services/readiness-service.ts
    - src/server/services/publish-service.ts
    - src/lib/upload-limits.ts
    - tests/readiness.test.ts
    - tests/lesson-resource-routes.test.ts
    - tests/components/readiness-panel.test.tsx
    - tests/unit/design-contract.test.ts

key-decisions:
  - "Option-a is recorded in 15-DECISIONS.md (both preconditions met: option-a, and the UploadPanel/ReadinessPanel shared-UI row reads agreed). The missing-captions item therefore WARNS and never blocks; option-c ('block') was not chosen so no blocking path was added."
  - "READY is the CLEAN state (same interpretation as 15-23): a caption counts for readiness only when its upload completed and verified (uploadStatus READY). UPLOADING and ERROR captions do not count."
  - "The CaptionPanel status words map UPLOADING to Scanning, READY to Ready, ERROR to Failed, as the plan asks. There is no antivirus scan in this codebase (see 15-23); 'Scanning' covers the window until completion verifies the file."
  - "Caption removal reuses the one ConfirmModal that UploadPanel already owns (CaptionPanel only asks via onRequestRemove). That keeps the licence ConfirmModal classification gate (UploadPanel is already a classified write file) unchanged."
  - "ReadinessPanel.tsx was not edited: it already draws any WARN item with its warning glyph, 'Warning' text and the existing text-warning class, and its summary already counts warnings. A new test proves the real evaluator output renders correctly there."

duration: resumed session
completed: 2026-10-09
---

# Phase 15 Plan 24: Caption authoring and publication warning Summary

Staff can add and remove WebVTT caption files for lesson videos from the lesson editor, through the existing upload-intent, direct upload and complete flow, and the course readiness list warns how many video lessons still have no READY captions (NFR-09, option-a: warning, never a block).

## What was done

- **Task 1 (tracer, passed end to end).** The upload-intent route takes `kind: "CAPTION"` plus `captionForResourceId`, `captionLanguage`, `captionLabel` and passes them to `beginLessonResourceUpload`, which already enforced the attach rules (plan 15-23). Caption fields without `kind: CAPTION`, or `CAPTION` without a parent id, are a 400; a non-video lesson or any service refusal is a plain 422. `CaptionPanel` lists a video's captions (label, language, status word), offers Add captions (`.vtt` input, language defaulting to `en`, label defaulting to `English`) through intent, direct PUT and completion (completion is always attempted after an ambiguous PUT failure, as in the file flow), and asks `UploadPanel` to remove one. `UploadPanel` loads the lesson's captions with its resources (`includeCaptions=1`, video lessons only), renders `CaptionPanel` under each non-failed VIDEO row only, and removes a caption through `DELETE ...?caption=1` after the shared confirm dialog. The real-PostgreSQL integration test drives the whole staff path (intent, put, complete) and then the learner's lesson data lists the caption.
- **Task 2 (TDD).** Refusals with plain messages: non-vtt file, over 1 MB, a language such as `english!`, a bad label, and a parent that is not a VIDEO resource of the same lesson (browser courtesy checks plus the service as the real gate, one shared message set in `upload-limits.ts`). `removeCaption` removes the row and object and hides the track from learners, and refuses (422) to remove anything that is not a caption. The readiness evaluator gained the `video-captions` item (warning, `blocking: false`) fed by a new `hasCleanCaptions` flag the publish loader derives from READY caption rows; the flag is stripped from the frozen publication payload (proved by test).

## Verification

Commands run (all on this machine, real results):

| Command | Result |
|---|---|
| `npx vitest run tests/captions-authoring.integration.test.ts --no-file-parallelism` | 1 file, 14 passed (Testcontainers, real PostgreSQL 16). The very first attempt failed in `beforeAll` with a Docker Desktop `HTTP code 500 server error` before any test ran (transient engine error, no code involved); the immediate re-run passed. |
| `npx vitest run tests/components/caption-panel.test.tsx` | 14 passed |
| `npx vitest run tests/unit/design-contract.test.ts --testTimeout=60000` | 114 passed (CaptionPanel added to the `catalogue-controls-expansion` group, so it is graded) |
| `npx vitest run tests/lesson-resource-routes.test.ts tests/readiness.test.ts` | 67 passed |
| `npx vitest run tests/components/readiness-panel.test.tsx tests/components/lesson-editor-client.test.tsx` | 20 passed |
| Batch: upload-panel, lesson-form-fields, lesson-resource-routes, licence-action-refusal, readiness, lesson-resource-service | 6 files, 179 passed |
| Batch: caption-panel, upload-panel, readiness-panel, publish-dialog, publish-service, learning-phase-invariants | 6 files, 76 passed |
| Batch: licence-ui-mirror-gate, licence-enforcement-boundary, licence-action-refusal, upload-limits, lesson-resource-service, captions-route | 6 files, 179 passed |
| `npx vitest run tests/publish.integration.test.ts tests/captions.integration.test.ts --no-file-parallelism` | 2 files, 33 passed (the changed course loader and 15-23 caption suite, real PostgreSQL) |
| `npx tsc --noEmit -p .` | exit 0 |
| `npx eslint` on every touched source and test file | clean |

Acceptance criteria re-checked: `UploadPanel.tsx` renders `CaptionPanel` only when `lessonType === "VIDEO"` (and the test shows no Add captions control for a FILE lesson); the route returns 400 for `CAPTION` without `captionForResourceId` (route test); both readiness copy strings exist in `readiness-service.ts` (`"1 video lesson has no captions."` and the template `` `${missing} video lessons have no captions.` ``); all three Task 2 test commands exit 0.

Integration coverage: tracer path; mismatched completion leaves the caption failed and unoffered; learner, view-only staff and staff scoped to another course are refused for add, complete and remove with nothing changed (T-15-24-01); five input refusals with exact plain messages and no row written (T-15-24-02, T-15-24-03); removal hides the track and deletes the object and refuses to remove the video or a file; readiness warns "2 video lessons have no captions." then "1 video lesson has no captions." (an UPLOADING caption does not count), `blockingFailures` is empty, the course still publishes, and the warning clears when every video lesson has a READY caption.

Not run: no browser session. The plan asks for none, and the component behaviour is covered by jsdom component tests plus the route and integration tests. A visual pass of the lesson editor with a real `.vtt` upload against storage was not performed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Files outside `files_modified` had to change for the feature to work**
- **Found during:** Task 1 and Task 2 planning
- **Issue:** The plan's action list names behaviour whose natural homes are not in its `files_modified`: listing a video's captions for the panel (the list route never returns caption rows), removing a caption (the DELETE route), the readiness item (`readiness-service.ts` and the course loader in `publish-service.ts`; the plan text says "add the readiness item to the readiness service" and `ReadinessPanel.tsx` alone has no data to draw).
- **Fix:** `src/app/api/lesson-resources/route.ts` (opt-in `includeCaptions=1`), `src/app/api/lesson-resources/[id]/route.ts` (opt-in `?caption=1` routing to `removeCaption`), `src/server/services/readiness-service.ts` (item and optional `hasCleanCaptions` input), `src/server/services/publish-service.ts` (loader maps READY caption rows to `hasCleanCaptions` and drops the raw rows), `src/lib/upload-limits.ts` (shared plain message constants, the file's stated purpose being to stop these rules drifting). All changes are additive and opt-in; the default response shapes are unchanged.
- **Files modified:** the five files above.

**2. [Rule 3 - Blocking] Existing test doubles needed the new service exports**
- **Issue:** `tests/lesson-resource-routes.test.ts` mocks the service module with a fixed export list; the routes now import `CaptionAttachmentError`, `removeCaption` and `listLessonCaptions`.
- **Fix:** added those to the mock and added route tests (caption intent, refusals, `?caption=1`, `includeCaptions=1`). `tests/readiness.test.ts` and `tests/components/readiness-panel.test.tsx` gained caption-warning cases.
- **Files modified:** `tests/lesson-resource-routes.test.ts`, `tests/readiness.test.ts`, `tests/components/readiness-panel.test.tsx`.

**3. [Rule 2 - Missing critical functionality] The new component must be graded by the design contract**
- **Issue:** the plan verifies `tests/unit/design-contract.test.ts` but a new file is only graded once it is in a manifest group.
- **Fix:** added `src/components/catalogue/CaptionPanel.tsx` to the `catalogue-controls-expansion` group (next to UploadPanel). The test passes (114).
- **Files modified:** `tests/unit/design-contract.test.ts`.

**4. [Interpretation] Remove-caption wiring**
- The plan says "add `removeCaption(resourceId)` to the service". It is exposed through the DELETE route's `?caption=1` branch rather than a separate route, so the caption control cannot delete a lesson's video or file (the service refuses non-captions).

**5. [Interpretation] ReadinessPanel left unchanged**
- Listed in `files_modified`, but it already renders WARN items with the existing glyph, "Warning" word and `text-warning` class, and counts warnings in its summary. No edit was needed; a new test pins the behaviour for the real evaluator output.

**6. [Interpretation] `CLEAN` means READY**
- Same reading as 15-23: the schema has `uploadStatus` UPLOADING, READY, ERROR and no malware scan; READY (verified completion) is the clean state.

### Total deviations
6 recorded (3 auto-fixed Rule 2/3, 3 interpretations). None changes the plan's intent; the extra files are small, additive and opt-in.

## Known Stubs

None. (A staff preview of a captioned video still shows no track: `src/app/staff/courses/[id]/preview/lessons/[lessonId]/page.tsx` does not pass captions to `LessonContent`. That was already noted as out of scope in the 15-23 SUMMARY and is not in this plan's files.)

## Threat model

- T-15-24-01 (elevation of privilege): mitigated. Add, complete and remove all run through the existing `courses.edit` `withPermission` path; the integration test refuses a learner, a view-only staff member and staff scoped to another course for all three actions and checks nothing changed.
- T-15-24-02 (tampering, wrong lesson): mitigated. The service requires the parent to be an ordinary resource of a VIDEO lesson in the same lesson; the route also refuses a non-video lesson before presigning.
- T-15-24-03 (non-caption content): mitigated as far as the codebase allows. `text/vtt` only, 1 MB cap, completion verifies size and content type, only READY captions are listed to learners or served. There is no antivirus scan in this repository, so "malware scan" in the threat text is satisfied by the verification gate only (see 15-23).

## Threat Flags

None beyond the planned surface. Two existing routes gained opt-in query variants (`includeCaptions=1`, `caption=1`); both stay behind the same `courses.view` / `courses.edit` checks and the same empty-404 denial. Plan 15-25's route inventory should list them.

## Neon go-live list

No new migration. The only database requirement is the 15-23 migration `20261008120000_lesson_video_captions` already queued for plan 15-31.

## Requirements

`requirements-completed` is left empty by orchestrator instruction. NFR-09 is declared by this plan and 15-23 (and others); the orchestrator owns the checkbox.

## Self-Check: PASSED

- Files exist: CaptionPanel.tsx, caption-panel.test.tsx, captions-authoring.integration.test.ts (checked in `git status`), and every modified file listed above.
- All verify commands above exit 0 with non-zero passed counts and no "BLOCKED" output (the one transient Docker 500 on the first integration attempt was re-run and passed).
- No commits were made, nothing was staged, STATE position and REQUIREMENTS were not touched (owner and orchestrator instruction).
