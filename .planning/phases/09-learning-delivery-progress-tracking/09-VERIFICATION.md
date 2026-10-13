---
phase: 09-learning-delivery-progress-tracking
verified: 2026-09-29
status: passed
score: 7/7 requirements verified
overrides_applied: 0
human_recommended: keyboard/screen-reader pass of the lesson player (Phase 15, NFR-09)
---

# Phase 9: Learning Delivery & Progress Tracking — Verification Report

**Verified:** 2026-09-29 (retroactive — the phase shipped with no VERIFICATION.md, no UAT and no code review; flagged in the v1.0 milestone audit, section 5)
**Status:** passed
**Re-verification:** No — initial verification

## Method

This is the phase's first independent check, so every requirement — including LRN-04 and LRN-05, previously marked Complete without a report — was checked against the current code and a live re-run on 2026-09-29: 23 test files, **459/459 passed**, including real-Postgres (Testcontainers) suites `learner-journey.integration` 2/2 (sequencing and locks, idempotent double-mark, undo and re-lock, video auto-completion, attendance-gated completion with a real supersede-then-resatisfy cycle, dashboard isolation between two learners) and `learner-results.integration` 3/3.

Later work that changed this phase's surface is included in the re-run: F-01/F-08 (lesson gates on downloads and submissions), F-15 (video credit paced against real time, optional staff-set length) and integration warning #5 (completed learners keep their results).

## Requirements

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **LRN-01** — Dashboard with next action, progress, sessions, obligations, results, tickets, certificate state — own records only | ✓ VERIFIED | `enrolment-dashboard-service.ts` builds one card per own enrolment with all seven parts (`enrolment-dashboard-service.test.ts` 70/70): "never includes another learner's enrolment (T-09-01)", ACTIVE before COMPLETED, no locked lesson recommended as next. Real Postgres: a second learner's dashboard contains none of the first's enrolments (`learner-journey.integration`). Page states: `learner-dashboard-page.test.ts` 17/17. |
| 2 | **LRN-02** — Ordered Modules/Lessons with prerequisite locks; sequencing enforced server-side; locks explain the unmet condition | ✓ VERIFIED | `lesson-sequencing.ts`: the first incomplete *required* lesson blocks everything after it and is named by title; optional lessons never block; completing the blocker unlocks the rest (`lesson-sequencing.test.ts` 16/16). Programme cohorts chain across courses (`learner-access.test.ts` 50/50). Server-side: `assertLessonOpenable` gates lesson pages, progress writes, downloads and submissions (F-01/F-08). |
| 3 | **LRN-03** — Text, images, files, video, embeds, links delivered securely and accessibly, with authorized file access | ✓ VERIFIED (accessibility check recommended) | Rendering as CAT-04 (`lesson-content.test.tsx` 14/14): body re-sanitised on render, titled sandboxed iframe, empty-alt images with visible captions, safe link `rel`, non-READY resources never rendered. File access: short-lived presigned URLs only after the lesson gate; unauthorized or unknown ids get an identical empty 404 (`lesson-resource-routes.test.ts` 26/26, F-01). Video captions are the known NFR-09 deferral (Phase 15). |
| 4 | **LRN-04** — Progress per content type; idempotent, attributable, timestamped, recalculable; unauthorized requests cannot advance it | ✓ VERIFIED | `lesson-progress-service.ts` (57/57): double-mark is idempotent, rows carry source and time, recalculation after undo re-locks. Video auto-completion at 90% requires the percentage to genuinely advance after an undo (T-09-28), and since F-15 credit is paced against time since the first tick and an optional staff-set video length. Not-own or locked enrolments are refused before any write. |
| 5 | **LRN-05** — Manual completion only where the rule permits, only by the enrolled learner in the access window, reversible per policy | ✓ VERIFIED | `markLessonComplete` requires `allowManualComplete`, the caller's own enrolment and an open, non-read-only access window (`access-window.test.ts` 9/9, `learner-lesson-actions.test.ts` 21/21). Undo is the learner's own; staff corrections go through the reasoned override (`staff-progress-override.test.ts` 17/17). |
| 6 | **LRN-06** — Session details and links only for eligible learners; hidden before the window and from unenrolled users; clear time-zone guidance | ✓ VERIFIED | `learner-session-service.ts` (14/14): another learner's enrolment returns `null` (denial parity); the cohort time zone is returned; the link is absent until the visibility window and never shown for a cancelled session; a learner never receives another learner's attendance. The page shows "opens N minutes before" and never leaks the URL early (`learner-sessions-page.test.ts` 8/8). |
| 7 | **LRN-07** — Completion from versioned rules and current evidence; each satisfied/unmet rule identified; corrections handled; completion time and rule version recorded | ✓ VERIFIED | `completion-engine.ts` returns a verdict item per rule (lessons, attendance, assessments) with `satisfied`, `state` and `detail`; unknown rule versions or fields throw rather than fall back (`completion-engine.test.ts` 31/31). `CompletionRecord` stores `ruleVersion` and `completedAt`; a correction that breaks the rule supersedes the record without deleting it, and re-satisfying creates a new one (`completion-service.test.ts` 29/29, real Postgres in `learner-journey.integration`). Assessments count where a course enables it (INT-02, 2026-09-26). |

**Score:** 7/7

## Human verification (recommended, not blocking)

Phase 9 never had a UAT. Every requirement has automated evidence, and the learner pages were exercised in the 2026-09-27 Docker smoke test (dashboard, My learning, support, account). What automation does not cover is a **keyboard-only and screen-reader pass of the lesson player** (lesson navigation, video controls, quiz and assignment panels). That belongs with the Phase 15 accessibility gate (NFR-09), together with the deferred video captions.
