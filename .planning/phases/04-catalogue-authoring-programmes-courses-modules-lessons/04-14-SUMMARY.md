---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 14
subsystem: ui
tags: [lesson-rendering, sanitise-on-render, server-component, staff-preview, D-13, D-30, D-37]

requires:
  - phase: 04-04
    provides: parseLessonInput, the LessonType enum, lesson-service.get / loadCourseTree
  - phase: 04-07
    provides: the /api/lesson-resources/[id]/download route and per-type presign TTL
  - phase: 04-11
    provides: the lesson authoring form and constrained editor this checkpoint verifies alongside rendering
  - phase: 04-12
    provides: the course detail action bar the preview links join
provides:
  - LessonContent — a Server Component rendering all eight LessonType values, sanitising again on render
  - LessonMediaPlayer — native <video> whose header comment pins the D-37 Range-request assumption
  - The public sales-page preview and the learner lesson-view preview (D-13), staff-gated, no shareable link
affects: [phase-09-learner-journey, 04-15]

tech-stack:
  patterns: [render-time re-sanitisation, zero-JS read path, staff-session preview with no token surface]

key-files:
  created:
    - src/components/catalogue/LessonContent.tsx
    - src/components/catalogue/LessonMediaPlayer.tsx
    - src/app/staff/courses/[id]/preview/page.tsx
    - src/app/staff/courses/[id]/preview/lessons/[lessonId]/page.tsx
    - tests/components/lesson-content.test.tsx
  modified:
    - src/app/staff/courses/[id]/page.tsx
    - src/components/catalogue/CourseDetailActions.tsx

key-decisions:
  - "LessonContent is a Server Component with no client directive and no editor-library import reachable from it — Lesson.body stores HTML precisely so the read path costs zero client JavaScript (D-30, NFR-02)."
  - "sanitizeLessonBody runs AGAIN at render, on every render — a row written before a sanitiser fix, or by a direct DB edit, must still be safe when read (D-30). A comment above the call says not to remove it as redundant."
  - "The EMBED case re-runs parseEmbedUrl on the STORED value before rendering an iframe; a value that fails renders a fallback and no iframe. Every iframe carries sandbox, title, loading=lazy and referrerPolicy=no-referrer."
  - "FILE / IMAGE / VIDEO offer a download or player only when scanStatus === CLEAN; PENDING shows Scanning, INFECTED/ERROR a blocked notice — never a link."
  - "The two previews are staff-session surfaces with no shareable link and no token mechanism; a denial maps to notFound(), and an anonymous visitor gets the same sign-in redirect as any other /staff URL (T-04-65)."

patterns-established:
  - "Render-path components take already-loaded plain data as props and never fetch — the preview route loads and authorizes, the component only draws."
  - "A media element's src is the bare authorized route with no query string and no crossOrigin, so it resolves the presigned URL exactly once (D-37)."

requirements-completed: [CAT-04, CAT-07]

duration: ~25m
completed: 2026-09-03
---

# Phase 04 Plan 14: Lesson Rendering & Staff Preview Summary

**One Server Component renders all eight lesson types with the sanitiser run again on read and zero editor JavaScript on the page, and two staff previews — the public sales page and the learner lesson view — exist without any shareable link.**

## Performance

- **Duration:** ~25m for the two build tasks plus a partially-driven checkpoint
- **Started:** 2026-09-03T15:10:11+01:00
- **Completed:** 2026-09-03T15:15:24+01:00 (build); checkpoint approved after
- **Tasks:** 2 build + 1 checkpoint
- **Files created/modified:** 7

## Accomplishments

- Built `LessonContent`: a Server Component branching over all eight `LessonType` values, re-running `sanitizeLessonBody` on every render, re-checking the stored embed URL with `parseEmbedUrl`, and gating every download/player behind `scanStatus === "CLEAN"`.
- Built `LessonMediaPlayer`: native `<video controls preload="metadata">` with a captions `<track>` slot and a header comment tying the D-37 Range-request assumption to `downloadTtlFor` so a future switch to a re-resolving player is a deliberate act.
- Built the two D-13 previews: the public sales-page preview (scalar facts + content outline, behind an unmistakable banner that also flags an unlisted course) and the learner lesson-view preview (`LessonContent` in prev/next navigation, withdrawn lessons still rendered with their marker).
- Drove the render-side checkpoint: the preview page ships no ProseMirror/Tiptap JS, the signed-out response is the ordinary sign-in redirect identical for a real and a made-up id with no course content in the body, and both banners render.

## Task Commits

1. **Task 1: the lesson content renderer** - `ca5d68e` (RED test written first)
2. **Task 2: the two staff preview surfaces** - `ac0dde6`
3. **Task 3: human verification** - approved by the developer 2026-09-03; render-side steps (9, 11, 12-partial, 14, 15a) driven, authoring and playback steps confirmed by the developer

## Files Created/Modified

- `src/components/catalogue/LessonContent.tsx` - the eight-type renderer; `dangerouslySetInnerHTML={{ __html: sanitizeLessonBody(...) }}` for prose, `parseEmbedUrl` for iframes, `humanSize` for download sizes.
- `src/components/catalogue/LessonMediaPlayer.tsx` - the VIDEO case; no `crossOrigin`, no cache-busting query.
- `src/app/staff/courses/[id]/preview/page.tsx` - public sales-page preview; `courses.view` gated, `AuthorizationError -> notFound()`.
- `src/app/staff/courses/[id]/preview/lessons/[lessonId]/page.tsx` - learner lesson view; loads the lesson + `listLessonResources`, renders `LessonContent`.
- `src/app/staff/courses/[id]/page.tsx` - "Preview public page" and "Preview learner view" links in the action bar.
- `src/components/catalogue/CourseDetailActions.tsx` - the 04-12 "Preview" link moved out to the page so both previews live together.
- `tests/components/lesson-content.test.tsx` - 13 `it` blocks covering every `<behavior>` bullet, including a stored `<script>` never reaching the output and a PENDING resource rendering no download href.

## Deviations from Plan

### Minor

**1. Preview links placed on the page, not inside `CourseDetailActions`**

- **Issue:** Plan 04-12 had already added a single "Preview" link inside the `CourseDetailActions` client component. Task 2 asks to "add both preview links to the action bar" of `page.tsx`.
- **Fix:** Removed the one link from `CourseDetailActions` and added both ("Preview public page", "Preview learner view") in `page.tsx`'s `actions` slot, wrapped alongside the client component. The learner link targets the course's first lesson.

**2. `<img>` for the IMAGE case rather than `next/image`**

- **Issue:** The framework reading points at the `Image` contract, but the image `src` is a 302 to a short-lived presigned URL.
- **Fix:** A plain `<img>` with an `eslint-disable-next-line @next/next/no-img-element` and a rationale comment — `next/image` cannot proxy an authorized redirect and would defeat the D-37 single-resolution assumption.

**3. Upcoming-cohort schedule omitted from the public preview**

- **Issue:** The plan lists "upcoming cohorts" among the sales-page fields, but there is no exported "upcoming cohorts for a course" helper and plan 04-15 owns the real public page.
- **Fix:** The preview renders the scalar facts and the content outline and states that cohort dates/pricing appear on the live public page (04-15). No new service surface added for a value 04-15 will formalise.

---

**Total deviations:** 3 minor (2 placement/framework choices, 1 deferred field). No product scope added or removed.

## Verification Results

- `npx vitest run tests/components/lesson-content.test.tsx`: 13 passed.
- `npx tsc --noEmit`: clean.
- `npx eslint .`: clean.
- `npx vitest run`: 35 files, **426 non-integration tests passed** + 28 skipped (the 2 Testcontainers integration files pass whenever the local Docker daemon is up; it dropped repeatedly this session).
- Task 1 greps: 13 `it` blocks; stored `<script>` asserted absent; PENDING renders no download href; zero `"use client"` and zero `@tiptap` in both components; `sanitizeLessonBody`, `sandbox=`, `parseEmbedUrl` present; zero `crossorigin` in the player; the player carries the D-37 header comment.
- Task 2 greps: `notFound()` in both preview pages; the banner text present twice; no token mechanism; `ReadinessPanel` still on the course page; zero `@prisma/client` in the preview folder.
- Human checkpoint: approved 2026-09-03. Steps 9, 11, 12 (heading order), 14 and 15a driven against the live app — the render path loaded no editor JavaScript and the signed-out response was content-free and identical for a real and an invented course id. Steps 1-8 (authoring), 10/10b (download, EICAR, video playback past the 60-second signature and forward seek, the 14400-vs-60 TTL check), 12 (full keyboard pass), 13 (screen reader) and 15b (signed-in-unscoped 404) confirmed by the developer against the Compose stack.

## Next Phase Readiness

- Plan 04-15 builds the real public catalogue pages and reuses this preview's rendering shape; it also wires the public-route `revalidatePath` calls into both `publish-actions.ts` files.
- Phase 9 builds the learner journey around `LessonContent` — it takes plain props and never fetches, so the journey supplies the data.
- Phase 04 has one plan left: 04-15.

## Self-Check: PASSED

- Both build tasks' files exist and are committed on `Khaliddev`.
- Every task acceptance criterion and the plan-level `tsc` / `eslint` / `vitest` commands pass.
- The developer approved the checkpoint; the two observations only a human can make — no editor JavaScript on the render path, and a video that outlives its first request — were confirmed (the first by driving, the second by the developer).

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-03*
