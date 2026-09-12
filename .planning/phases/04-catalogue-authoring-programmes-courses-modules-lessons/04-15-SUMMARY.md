---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 15
subsystem: ui
tags: [public-catalogue, anonymous-read, real-404, ISR, on-demand-revalidation, enumeration-control]

requires:
  - phase: 04-08
    provides: publiclyListed / slugLockedAt / status columns and the listing operations
  - phase: 04-12
    provides: the course publish/list/archive Server Actions the revalidation hooks into
  - phase: 04-13
    provides: the programme publish/list/archive Server Actions and the create/edit action
provides:
  - public-catalogue-service — the only anonymous read path, one shared PUBLIC_VISIBILITY_WHERE
  - Four public routes: /courses, /courses/[slug], /programmes, /programmes/[slug]
  - src/app/not-found.tsx (the repo's first) and src/app/(public)/not-found.tsx
  - On-demand revalidation of the public routes from every listing/publish/archive action
affects: [phase-06-discovery-and-checkout]

tech-stack:
  patterns: [anonymous read service unwrapped by the permission choke point, top-level-await existence check before Suspense, ISR + revalidatePath]

key-files:
  created:
    - src/server/services/public-catalogue-service.ts
    - src/app/not-found.tsx
    - src/app/(public)/not-found.tsx
    - src/app/(public)/layout.tsx
    - src/app/(public)/courses/page.tsx
    - src/app/(public)/courses/[slug]/page.tsx
    - src/app/(public)/programmes/page.tsx
    - src/app/(public)/programmes/[slug]/page.tsx
    - tests/public-catalogue-service.test.ts
  modified:
    - src/app/staff/courses/[id]/publish-actions.ts
    - src/app/staff/programmes/[id]/publish-actions.ts
    - src/app/staff/programmes/actions.ts

key-decisions:
  - "public-catalogue-service is deliberately not wrapped in the permission choke point — its audience is anonymous — so its `where` clause IS the access control and lives once, as PUBLIC_VISIBILITY_WHERE (publiclyListed AND not ARCHIVED), reused by all four queries."
  - "Every public query selects an explicit field list; the returned shapes carry no completionRule, publishedById or internal id, and the Programme shape omits prerequisites/durationHours (no such columns) and adds ordered member course titles."
  - "The [slug] pages do the existence check as a top-level await BEFORE any Suspense boundary, so notFound() produces a real HTTP 404. The experimental 403 helper is not used — a 403 confirms the record exists."
  - "Prerendering: all four routes are `export const dynamic = 'force-dynamic'` — the fallback the planner sanctioned. `npm run build` on the host passed with ISR, but the Docker builder has no `DATABASE_URL` (`.dockerignore` excludes `.env*`), so a statically-prerendered `listPublicCourses()` failed `docker build` (04-10's requirement). Per-request rendering keeps `notFound()` a real 404 and T-04-71 already accepted the anonymous DB traffic."
  - "Unlisted, archived and never-existed slugs all resolve to null and render the identical not-found page — no enumeration oracle (T-04-68)."

patterns-established:
  - "Anonymous surfaces get one shared visibility filter as an exported constant, never an inlined per-query where."
  - "A page whose 404 must be a real status code performs its existence check as a top-level await and calls notFound() before rendering anything."

requirements-completed: [CAT-07, CAT-08]

duration: ~20m
completed: 2026-09-03
---

# Phase 04 Plan 15: Public Catalogue Summary

**An anonymous, read-only Course and Programme catalogue with one shared visibility filter, a real HTTP 404 for anything not publicly listed, the repository's first not-found page, and on-demand revalidation that keeps a running production build honest within one action.**

## Performance

- **Duration:** ~20m for the two build tasks plus a partially-driven checkpoint
- **Started:** 2026-09-03T15:27:04+01:00
- **Completed:** 2026-09-03T15:35:04+01:00 (build); checkpoint approved after
- **Tasks:** 2 build + 1 checkpoint
- **Files created/modified:** 12

## Accomplishments

- Built `public-catalogue-service` with `PUBLIC_VISIBILITY_WHERE` (`publiclyListed: true`, `status: { not: "ARCHIVED" }`) reused by `listPublicCourses`, `listPublicProgrammes`, `getPublicCourseBySlug`, `getPublicProgrammeBySlug` — explicit field selects, no internal columns in the returned shapes, unknown/unlisted/archived slugs return `null`.
- Built `src/app/not-found.tsx` (the repo never had one) and `src/app/(public)/not-found.tsx`, both revealing nothing about why a slug did not resolve.
- Built the four public routes: read-only card indexes with no search/filter/price/booking (D-10), and `[slug]` detail pages whose existence check is a top-level `await` before any `<Suspense>` so `notFound()` is a real 404; `generateMetadata` is 404-safe.
- Wired `revalidatePath('/courses')` + `revalidatePath('/courses/[slug]', 'page')` (and the programme equivalents) into every listing/publish/archive action.
- Drove the checkpoint against a production build: unlisted and made-up slugs both returned a real 404, no 403 anywhere, and "List publicly" from the staff UI surfaced the course on the anonymous index within one reload.

## Task Commits

1. **Task 1: public read service + not-found pages** - `ff64f1f` (RED test first)
2. **Task 2: four public routes + revalidation** - `f6a9331`
3. **Task 3: human verification** - approved by the developer 2026-09-03; steps 2-8 and 10 driven/curled against `npm run build && npm start`, steps 9 and 11 confirmed by the developer

## Files Created/Modified

- `src/server/services/public-catalogue-service.ts` - the anonymous read path; `PUBLIC_VISIBILITY_WHERE` used 4×, `upcomingCohorts` filtered to PUBLISHED / future-starting / window-still-open.
- `src/app/not-found.tsx` / `src/app/(public)/not-found.tsx` - the root and public 404s.
- `src/app/(public)/layout.tsx` - minimal read-only nav.
- `src/app/(public)/courses/page.tsx` / `programmes/page.tsx` - `revalidate = 300`, card indexes.
- `src/app/(public)/courses/[slug]/page.tsx` / `programmes/[slug]/page.tsx` - top-level existence check + `notFound()`; the programme page shows member course titles, never `prerequisites`/`durationHours`.
- `src/app/staff/courses/[id]/publish-actions.ts` / `src/app/staff/programmes/[id]/publish-actions.ts` / `src/app/staff/programmes/actions.ts` - public-route `revalidatePath` calls added to the existing revalidate helpers.
- `tests/public-catalogue-service.test.ts` - 9 `it` blocks: draft+listed IS returned / published+unlisted is NOT / ARCHIVED never is; `null` for unknown slugs; no `completionRule` in the shape; programme shape omits prereq/duration and adds member titles; upcoming-cohort filter.

## Deviations from Plan

### Minor

**1. Programme revalidation split across two files**

- **Issue:** Task 2 says to add the programme revalidation to `src/app/staff/programmes/actions.ts`, but plan 04-13 moved the programme publish/list/archive actions into `src/app/staff/programmes/[id]/publish-actions.ts` (which did not exist when 04-15 was written).
- **Fix:** The public `revalidatePath` calls went into `[id]/publish-actions.ts`'s `revalidateProgramme` helper (where listing/publish/archive actually happen) AND into `actions.ts`'s `updateProgrammeAction` (a title or slug edit also changes the public page).

**2. Added `(public)/layout.tsx`**

- **Issue:** The `(public)/not-found.tsx` references "the public navigation" and the routes need a shared shell, but the plan's `files_modified` does not list a layout.
- **Fix:** A minimal read-only `(public)/layout.tsx` — a header with Courses / Programmes links and a content container. No search, no filters, no account controls (D-10).

**3. `upcomingCohorts` filters in JS on top of the query `where`**

- **Issue:** The plan describes the filter; the injected fake delegate in the test does not honour a `where` on the cohort query.
- **Fix:** The service passes the `where` to Prisma AND re-applies the `startsAt` / `enrolmentClosesAt` predicates in JS — defensive, and it keeps the unit test meaningful.

---

**Total deviations:** 3 minor (1 file-location correction from a later plan, 1 shell file, 1 belt-and-braces filter). No product scope change, no schema change.

## Verification Results

- `npx vitest run tests/public-catalogue-service.test.ts`: 9 passed.
- `npx tsc --noEmit`: clean.
- `npx eslint "src/app/(public)"`: clean.
- `npm run build`: **succeeds**. All four public routes render `ƒ` (Dynamic, server-rendered on demand) after the `force-dynamic` change — see the follow-up fix below.
- `npx vitest run`: 36 files, **435 non-integration tests passed** + 28 skipped (the 2 Testcontainers files pass when the local Docker daemon is up — it dropped repeatedly this session).
- Task 1 greps: 9 `it` blocks; draft+listed asserted returned and published+unlisted not; ARCHIVED never returned under either flag; `completionRule` absent from the shape; `PUBLIC_VISIBILITY_WHERE` used 6× (definition + uses); zero `withPermission`; both not-found files exist.
- Task 2 greps: all four routes export `revalidate`; zero `forbidden()`; `notFound()` before the first `<Suspense` in each `[slug]/page.tsx`; the `revalidatePath('/courses/[slug]', 'page')` call present; no search/filter/price/booking control; zero `prerequisites`/`durationHours` on the programme page; `prisma/schema.prisma` unchanged; zero `@prisma/client` under `(public)`.
- Human checkpoint: approved 2026-09-03. Driven against a production build — an unlisted course URL and a made-up slug both returned HTTP 404 (verified on the document response, not just the page), no route returned 403, and listing a course through the staff "List publicly" action made it appear on the anonymous `/courses` index within one reload. Steps 9 (archive leaves the catalogue while staff can still read it) and 11 (accessibility pass) confirmed by the developer.

## Follow-up fixes (developer testing, same day)

Three issues surfaced when the developer exercised the Docker/self-hosted path:

1. **`docker build` failed** — the two `○ Static` public index pages prerender at build, calling `listPublicCourses()`, but the Docker builder has no `DATABASE_URL`. Local `npm run build` had masked it (`.env` + Neon). Fixed by switching all four public routes to `export const dynamic = "force-dynamic"` — the fallback `<planner_decisions>` sanctioned. The `[slug]` routes were already dynamic; the index pages were the blocker.
2. **`prisma format --check` failed** — not a schema problem. `core.autocrlf=true` with no `.gitattributes` checked the LF-stored schema out as CRLF. Added `.gitattributes` (`* text=auto eol=lf`) and renormalised; this also removes the CRLF class that had briefly made `.gitignore` mis-ignore `.planning` earlier in the phase.
3. **`docker compose config --quiet` failed** — the repo `.env` is a `next dev` file (Neon `DATABASE_URL` only); `docker-compose.yml` needs `POSTGRES_PASSWORD` / `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (`:?` form). Merged `.env.example`'s self-hosted section into the local `.env` — dev tools ignore the extras, and the Compose services build their own `DATABASE_URL` from `POSTGRES_*`.

## Next Phase Readiness

- Phase 06 hangs discovery, search and checkout onto `/courses` and `/programmes`, which now exist.
- **Phase 04 is complete** — all fifteen plans executed and their checkpoints approved.

## Self-Check: PASSED

- Both build tasks' files exist and are committed on `Khaliddev`.
- Every task acceptance criterion, `npm run build`, and the plan-level `tsc` / `eslint` / `vitest` commands pass.
- The developer approved the checkpoint; the two observations only a production build can make — a real 404 status and revalidation of a static index — were both confirmed by driving the built app.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-03*
