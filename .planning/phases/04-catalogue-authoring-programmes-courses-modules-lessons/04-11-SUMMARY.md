---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 11
subsystem: ui
tags: [tiptap, prosemirror, react-server-actions, file-upload, zod, next-app-router]

requires:
  - phase: 04-04
    provides: parseLessonInput/parseLessonUpdateInput, createLesson/updateLesson, lesson-input schema
  - phase: 04-07
    provides: lesson-resource upload/download Route Handlers, UPLOAD_LIMITS, createLessonResource
  - phase: 04-09
    provides: the arrange screen that links here with ?moduleId=<id> and owns Module creation
  - phase: 04-10
    provides: the running ClamAV scan pipeline and lost-job reconciliation the UploadPanel polls
provides:
  - A Tiptap editor structurally restricted to D-29's seven controls (no H1, colour, or font command exists)
  - An UploadPanel that streams raw files to the Route Handler and renders PENDING/CLEAN/INFECTED/ERROR with bounded polling
  - Per-type fields for all eight LessonTypes, including the disabled Phase 10 assessment picker
  - Authenticated scan-status list and ERROR-only retry endpoints with an enqueue-failure rollback
  - Staff lesson create and edit routes with server-side re-validated save and withdraw actions
affects: [04-12, 04-14, learner-lesson-rendering]

tech-stack:
  added: [Tiptap v3 StarterKit + @tiptap/react, @testing-library configure]
  patterns: [extension array as the D-29 allow-list, courtesy-check-then-server-gate uploads, one action for create and edit via useActionState]

key-files:
  created:
    - src/components/catalogue/RichTextEditor.tsx
    - src/components/catalogue/UploadPanel.tsx
    - src/components/catalogue/LessonFormFields.tsx
    - src/app/api/lesson-resources/route.ts
    - src/app/api/lesson-resources/[id]/retry/route.ts
    - src/app/staff/courses/[id]/lessons/[lessonId]/page.tsx
    - src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx
    - src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts
    - src/app/staff/courses/[id]/lessons/new/page.tsx
    - tests/components/rich-text-editor.test.tsx
    - tests/components/upload-panel.test.tsx
    - tests/components/lesson-form-fields.test.tsx
    - tests/components/setup.ts
    - tests/lesson-resource-status-service.test.ts
    - tests/lesson-resource-status-routes.test.ts
  modified:
    - src/components/catalogue/index.ts
    - src/server/services/lesson-resource-service.ts
    - vitest.config.mts

key-decisions:
  - "The Tiptap extension array IS the D-29 allow-list: heading levels are [2, 3] so H1 is unrepresentable, and codeBlock/blockquote/horizontalRule/code/strike are disabled — hiding buttons is never the control."
  - "Uploads post the raw File to /api/lesson-resources/upload with metadata in the query string; the client-side UPLOAD_LIMITS check is a labelled courtesy only and the Route Handler re-validates."
  - "A retried resource that cannot be re-enqueued is rolled back to ERROR with a 503, so the UI stays truthful instead of showing a false Scanning state until the reconciliation cron sweeps it."
  - "saveLessonAction handles both create and edit; a new lesson redirects to its own editor so the UploadPanel (which needs a lessonId) becomes usable."

patterns-established:
  - "Constrained editor: restrict capability by construction in the extension list, then rely on parseLessonInput's server-side sanitiser as the actual control."
  - "Browser scan-status polling: a private, no-store list endpoint that omits storage keys and serialises BigInt sizes, 404 without enumerating unknown or unauthorized lessons."
  - "Editor form: useActionState over one server action, zod failures surfaced as ResourceForm field errors, authz failures collapsed to one non-enumerating line."

requirements-completed: [CAT-03, CAT-04]

duration: ~1h 26m
completed: 2026-09-03
---

# Phase 04 Plan 11: Lesson Authoring Form Summary

**Staff can now author a lesson of any of the eight types from one form — a rich text editor that structurally cannot produce an H1 or a colour, an upload panel wired to the live scan pipeline, and server-side re-validated save and withdraw actions.**

## Performance

- **Duration:** ~1h 26m across the RED contracts, the two component builds, the supporting API, and the staff routes
- **Started:** 2026-09-03T09:57:46+01:00
- **Completed:** 2026-09-03T11:23:57+01:00
- **Tasks:** 3
- **Files created/modified:** 19

## Accomplishments

- Built `RichTextEditor` as a Tiptap StarterKit configured so D-29 holds by construction: `heading: { levels: [2, 3] }`, and `codeBlock`/`blockquote`/`horizontalRule`/`code`/`strike`/`underline`/`hardBreak` disabled, with an accessible inline link editor instead of `window.prompt`.
- Built `UploadPanel` (raw-`File` fetch to the Route Handler, no `FormData`, no Server Action) and `LessonFormFields` covering all eight `LessonType`s, with the INFECTED branch offering no download and QUIZ/ASSIGNMENT saving against a disabled, clearly-labelled Phase 10 picker.
- Added the scan-status list endpoint and the ERROR-only retry endpoint the plan's polling and Retry behaviour require, with an enqueue-failure rollback so a failed retry never leaves a false "Scanning".
- Built the staff create and edit routes with `LessonEditorClient` and `actions.ts`: every save funnels through `parseLessonInput`/`parseLessonUpdateInput`, positions are never read from the form or query, and an authorization failure is one generic message.

## Task Commits

1. **Task 1 RED: constrained editor behaviour** - `944c18c`
2. **Task 1 GREEN: constrained rich text editor** - `948ec51`
3. **Task 2 RED: upload and type-field behaviour** - `f1493ef`
4. **Task 2 RED: resource status and retry contracts** - `96a6c11`
5. **Deviation: jsdom editor-teardown stub** - `0a3fc73`
6. **Task 2 GREEN: lesson resource status and retry endpoints** - `1706027`
7. **Task 2 GREEN: upload panel and per-type lesson fields** - `643bf23`
8. **Deviation: raise async-query timeout for editor mounts** - `b5a7a5b`
9. **Task 3: lesson create and edit routes with server actions** - `e3ee2cc`

## Files Created/Modified

- `src/components/catalogue/RichTextEditor.tsx` - Tiptap editor whose extension array is the D-29 allow-list; seven `aria-pressed` toolbar toggles and an inline link field.
- `src/components/catalogue/UploadPanel.tsx` - Streams the raw `File` to the upload route, renders each scan state as a `StatusPill`, polls a bounded number of times while any resource is PENDING, and stops on unmount.
- `src/components/catalogue/LessonFormFields.tsx` - Renders the fields for a chosen `LessonType` from the primitives, including the D-24 Required toggle and the D-31 empty assessment picker.
- `src/app/api/lesson-resources/route.ts` - `GET` list for browser polling: private/no-store, omits `storageKey`/`uploadedById`, serialises `sizeBytes`, empty 404 on denial.
- `src/app/api/lesson-resources/[id]/retry/route.ts` - `POST` retry: re-enqueues only an authorized ERROR row, rolls back to ERROR with a 503 if the enqueue fails, 409 for any non-ERROR state.
- `src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts` - `saveLessonAction` and `withdrawLessonAction`; `"use server"`, no Prisma import, no hand-parsing.
- `src/app/staff/courses/[id]/lessons/[lessonId]/page.tsx` - Edit page: `await params`, `lessonService.get`, `AuthorizationError -> notFound()`.
- `src/app/staff/courses/[id]/lessons/new/page.tsx` - Create page: awaited `searchParams.moduleId`; a missing, unknown, foreign, or withdrawn module is `notFound()`.
- `src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx` - `useActionState` over `saveLessonAction`, a type selector that switches the rendered fields, and a `ConfirmModal` withdraw with a mandatory reason.
- `src/server/services/lesson-resource-service.ts` - Adds `listLessonResources`, `retryLessonResource`, `markRetryEnqueueFailed`, and `ResourceRetryNotAllowedError`.
- `tests/components/setup.ts` - Stubs the `Range` client-rect methods jsdom lacks and raises `asyncUtilTimeout` for heavy editor mounts.
- `src/components/catalogue/index.ts`, `vitest.config.mts` - Barrel exports and the components setup-file registration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the browser-readable scan-status and retry endpoints**

- **Found during:** Task 2 inventory
- **Issue:** The plan's supporting API had upload and download but no authenticated endpoint the `UploadPanel` could poll for scan status, and no endpoint behind the specified Retry control.
- **Fix:** Added `GET /api/lesson-resources` and `POST /api/lesson-resources/[id]/retry`, plus `listLessonResources` / `retryLessonResource` / `ResourceRetryNotAllowedError` in the service, all authorized through the resource's parent course.
- **Files modified:** `src/app/api/lesson-resources/route.ts`, `src/app/api/lesson-resources/[id]/retry/route.ts`, `src/server/services/lesson-resource-service.ts`, `tests/lesson-resource-status-service.test.ts`, `tests/lesson-resource-status-routes.test.ts`
- **Verification:** 25 focused service and route tests pass; the payload omits storage keys, serialises BigInt sizes, and never enumerates unknown lessons.
- **Committed in:** `96a6c11` (RED), `1706027` (GREEN)

**2. [Rule 1 - Bug] Rollback when a retried scan cannot be enqueued**

- **Found during:** Task 2 review
- **Issue:** `retryLessonResource` flips an ERROR row to PENDING before the route calls `enqueueScan`. A thrown enqueue left the row PENDING with no job, so the UI showed a false "Scanning" until the 04-10 reconciliation cron swept it minutes later.
- **Fix:** Added `markRetryEnqueueFailed`, a `courses.edit`-scoped compensating write that returns the row to ERROR with a truthful detail; the route calls it and returns 503. It no-ops if a racing worker already moved the row.
- **Files modified:** `src/server/services/lesson-resource-service.ts`, `src/app/api/lesson-resources/[id]/retry/route.ts`, `src/components/catalogue/UploadPanel.tsx`, the two status test files
- **Verification:** Route tests cover the 503 with the rolled-back resource and the case where the rollback write itself fails; the component test shows the row staying "Scan error" with the reason surfaced.
- **Committed in:** `1706027`

**3. [Rule 1 - Bug] jsdom editor-teardown stub**

- **Found during:** Task 1 / Task 2 gate
- **Issue:** ProseMirror's `scrollToSelection` runs on every editor state change and, via a deferred `focus()` chain command, fired after a test tore its editor down — an unhandled `TypeError: target.getClientRects is not a function`, which Vitest warns can cause false test results.
- **Fix:** Added `tests/components/setup.ts` with inert `Range.prototype.getClientRects` / `getBoundingClientRect` stubs, registered as the components project's `setupFiles`.
- **Files modified:** `tests/components/setup.ts`, `vitest.config.mts`
- **Verification:** The unhandled error is gone across 20+ isolated editor runs and 4 consecutive full-suite runs.
- **Committed in:** `0a3fc73`

**4. [Rule 1 - Bug] Raised the async-query timeout for heavy editor mounts**

- **Found during:** Task 3 full-suite gate
- **Issue:** `rich-text-editor.test.tsx` test 1 failed once in the 33-file suite: a Tiptap/ProseMirror mount under a dozen competing worker processes occasionally exceeded Testing Library's 1000ms `findBy*` default (a later full run measured 1482ms). The test predates this plan's session; it does not flake in isolation.
- **Fix:** `configure({ asyncUtilTimeout: 5000 })` in the components setup — a ceiling raise only; queries still resolve as soon as the node appears.
- **Files modified:** `tests/components/setup.ts`
- **Verification:** 3 further consecutive full-suite runs, all 431 tests green.
- **Committed in:** `b5a7a5b`

---

**Total deviations:** 4 (1 blocking API gap, 2 bug fixes in test infra, 1 robustness fix).
**Impact on plan:** The API additions make the specified polling and Retry behaviour possible; the rest harden the test suite and the retry path without expanding product scope. A stray `output/` scan fixture from the 04-10 checkpoint is left untracked (not added to `.gitignore`, whose CRLF-normalisation would otherwise have started ignoring `.planning`).

## Verification Results

- `npx tsc --noEmit`: clean.
- `npx eslint . --max-warnings=0`: clean.
- `npx vitest run`: 33 files, 431 tests passed — 4 consecutive full runs green after deviation 4.
- `npx vitest run tests/boundary.test.ts`: 9 passed; nothing under `src/app/staff/courses/[id]/lessons/` imports `@prisma/client`.
- Task 1 acceptance greps: 7-button toolbar, `levels: [2, 3]` once, zero `color`/`fontSize`/`fontFamily`/`TextStyle`, `codeBlock: false` once, zero `window.prompt`.
- Task 2 acceptance greps: `/api/lesson-resources/upload` present, zero `FormData`, zero `"use server"`, INFECTED branch renders no download, `Phase 10` and `EMBED_HOST_ALLOWLIST` present.
- Task 3 acceptance greps: one `"use server"`, `parseLessonInput` present, zero `sanitize`, `notFound()` on both pages, `await params`, zero `@prisma/client`.

## Next Phase Readiness

- Plan 04-12 can compose the editor and per-type fields into the module/lesson builder surface.
- Plan 04-14's human checkpoint exercises authoring and rendering for all eight types in one pass, including the pasted-HTML POST path and a >5 MB upload.
- The editor and upload panel are imported only from staff routes, keeping the ProseMirror bundle off learner surfaces (D-30, NFR-02).

## Self-Check: PASSED

- All three tasks' production and test files exist and are committed on `gsd/phase-04-plan-10`.
- Every task acceptance criterion and the plan-level `tsc` / `eslint` / `vitest` / `boundary` commands pass.
- The one full-suite flake was root-caused (heavy mount vs. a 1s query timeout) and fixed, not retried away.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-03*
