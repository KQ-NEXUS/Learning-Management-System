---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
verified: 2026-09-29
status: passed
score: 7/7 requirements verified
overrides_applied: 0
---

# Phase 4: Catalogue Authoring — Verification Report

**Phase Goal:** Staff can build the full content model — Programmes, Courses, Modules, Lessons, and rich content — safely versioned and published without breaking active Cohorts.
**Verified:** 2026-09-29 (retroactive — the phase shipped without a VERIFICATION.md; flagged in the v1.0 milestone audit, section 5)
**Status:** passed
**Re-verification:** No — initial verification

## Method

Each requirement was checked against the current code (not the plan SUMMARY narrative) and against a live test re-run on 2026-09-29: 40 test files, **570/570 passed**, including three real-Postgres (Testcontainers) suites — `publish.integration` 15/15, `reorder.integration` 13/13, `continuity-concurrency.integration` 14/14. One evidence gap was found (CAT-06's *scoped* Instructor case had no test; every publish test used a GLOBAL grant) and closed with two new tests in `tests/publish-service.test.ts` (22/22).

## Requirements

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **CAT-02** — Programmes are ordered sets of existing Courses; add/remove/reorder in draft; a Course can belong to several Programmes without cloning | ✓ VERIFIED | `programme-service.ts` adds a `ProgrammeCourse` join row at the end of the list and never a Course row. Tests: "adding the same courseId to a second Programme succeeds and leaves the Course row count unchanged", duplicate membership refused with a typed error, removal renumbers survivors 0..n-1 (`programme-service.test.ts` 10/10). Reordering against the real unique index: "reverses a Programme's Courses against ProgrammeCourse_programmeId_position_key" (`reorder.integration` 13/13). |
| 2 | **CAT-03** — Ordered Modules and Lessons: add, reorder, edit, preview, mark required; order stable after save | ✓ VERIFIED | `module-lesson-service.test.ts` 19/19; `reorder.integration` proves full reversal, rotation (a guaranteed collision for naive per-row updates), cross-module moves in one transaction, stale-token refusal, and that withdrawn lessons are never moved. Preview: `lesson-preview-route.test.ts` 5/5. `required` is part of the validated lesson input (`lesson-input.ts`). |
| 3 | **CAT-04** — Text, files, images, uploaded video, embeds, links, Quizzes, Assignments; format/size validated; accessible learner view | ✓ VERIFIED (one accepted deferral) | Validation: `lesson-input.ts` (sanitised body, `.strict()`), `embed-url.ts` host allow-list (no substring matching, https only — `embed-url.test.ts` 20/20), `upload-limits.ts` per-type MIME/size caps (SVG and HTML refused — `upload-limits.test.ts` 29/29). Rendering: `LessonContent` — body re-sanitised on render, titled sandboxed lazy iframe, empty-alt images with visible caption, `rel="noopener noreferrer nofollow"` links, non-READY resources never rendered (`lesson-content.test.tsx` 14/14). **Deferred:** captions/WebVTT for uploaded video (NFR-09) — an explicit user decision recorded in `04.1-GAP-COVERAGE.md`, carried to Phase 15. |
| 4 | **CAT-05** — Published content is versioned; active Cohorts are protected; staff choose whether a new version applies to future or selected Cohorts | ✓ VERIFIED | `publish-service.ts` writes an immutable `CoursePublication` per publish. Real Postgres: versions 1 and 2 with version 1's payload byte-identical afterwards; an unticked cohort stays pinned to version 1; a ticked cohort moves to version 2 with an audited reason; a lesson withdrawn after version 1 still resolves inside version 1; `@@unique([courseId, version])` rejects a duplicate (`publish.integration` 15/15). A blank migration reason is refused (`publish-service.test.ts`). |
| 5 | **CAT-06** — An Instructor with `courses.publish` in matching scope can publish an assigned Course; control and action gated; actor, version and time recorded | ✓ VERIFIED | Action: `publishCourse` checks `courses.publish` against `{ courseIds: [courseId] }` (`publish-service.ts:273, 515`). Control: `staff/courses/[id]/page.tsx:67` computes `canPublishContent` with the same scope. **Added 2026-09-29:** a COURSE-scoped grant publishes its own Course and records `publishedById`/version; a grant for a different Course is denied and writes nothing. Existing: a `courses.edit`-only caller is denied (unit and real Postgres). `publishedAt`, `publishedById`, `contentVersion` set on commit. |
| 6 | **CAT-07** — Public pages published independently of content state; only readiness-passing offers listed; unpublished URLs reveal nothing | ✓ VERIFIED | `publiclyListed` is separate from `status`: a listed DRAFT course appears (D-08 early bookings), an unlisted PUBLISHED course does not, ARCHIVED never does (`public-catalogue-service.test.ts` 17/17). Listing is refused while a blocking readiness item fails, naming it (`publish.integration`). `getPublicCourseBySlug` returns `null` — identical for unknown, unlisted and archived — and the public shape omits internal fields (completion rule, publisher, internal id). |
| 7 | **CAT-08** — Records archive without breaking historical enrolments/results/certificates; gone from new sales, readable where permitted | ✓ VERIFIED | Archiving is refused while a cohort is running, naming it (`archive-guards.test.ts` 18/18). Archiving a Course inside a published Programme leaves that `ProgrammePublication` payload byte-identical; unarchive returns DRAFT and unlisted (`publish.integration`). Archived records are excluded from the public catalogue (above), while cohorts stay pinned to their `CoursePublication`, so enrolled learners' content and history are unaffected. |

**Score:** 7/7

## Anti-patterns / notes

- None blocking. The code review (`04-REVIEW.md`, 5 findings) was fixed in `04-REVIEW-FIX.md`.
- CAT-04's video captions remain the one known accessibility gap, deferred by decision to Phase 15.

## Human verification

Not required for sign-off: every requirement is covered by automated evidence, including real-Postgres suites for the versioning, reorder and publish paths. The catalogue screens were also exercised in the Phase 04.1 design rollout and the 2026-09-27 Docker smoke test (all staff pages rendered as admin).
