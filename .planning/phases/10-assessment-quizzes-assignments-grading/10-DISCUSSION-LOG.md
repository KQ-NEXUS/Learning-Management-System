# Phase 10: Assessment — Quizzes, Assignments & Grading - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-15
**Phase:** 10-Assessment — Quizzes, Assignments & Grading
**Areas discussed:** Quiz release behavior, Multiple-attempt scoring, Late submission & resubmission, Grading workflow & overrides

---

## Quiz release behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-release immediately | Grade row created already RELEASED the moment the attempt is scored | ✓ |
| Always draft, manual release | Every Grade — quiz or assignment — goes through the same DRAFT→RELEASED staff gate | |
| Per-assessment staff choice | New `releaseMode` setting on Assessment (auto/manual) | |

**User's choice:** Auto-release immediately.
**Notes:** None — went with the recommended option.

---

## Multiple-attempt scoring

| Option | Description | Selected |
|--------|-------------|----------|
| Highest score | Best attempt wins regardless of order | |
| Most recent attempt | Latest submission always counts | |
| Average of all attempts | Mean score across every attempt | |

**User's choice:** "Can't the staff or instructor choose?" — none of the fixed options; user wanted it configurable per assessment.
**Notes:** Resolved as a new authored field on Assessment (`attemptGradingMethod`: HIGHEST/LATEST/AVERAGE, default HIGHEST), mirroring Moodle's own per-quiz "Grading method" setting rather than a system-wide policy.

---

## Late submission & resubmission

### Late submission

| Option | Description | Selected |
|--------|-------------|----------|
| Accepted and flagged | isLate=true set but submission still goes through; due date is informational | ✓ |
| Blocked after due date | Due date is a hard deadline, no submission possible once it passes | |

**User's choice:** Accepted and flagged.
**Notes:** Went with the recommended option, grounded in Moodle's due-date-vs-cutoff-date distinction (checked live during the Playwright/Moodle research detour, then reasoned from Moodle's documented behavior since the reference site had no live quiz/assignment data).

### Resubmission

| Option | Description | Selected |
|--------|-------------|----------|
| New row, incremented attemptNumber | Matches schema's unique([assessmentId, enrolmentId, attemptNumber]) constraint | ✓ |
| Overwrite in place | Same Submission row's file/metadata replaced | |

**User's choice:** New row, incremented attemptNumber.
**Notes:** Went with the recommended option.

---

## Grading workflow & overrides

### Batch release

| Option | Description | Selected |
|--------|-------------|----------|
| One at a time only | No batch primitive; matches ASM-05's literal per-submission wording | |
| Batch-release across a Cohort | Instructor selects multiple graded submissions and releases together | ✓ |

**User's choice:** Batch-release across a Cohort.
**Notes:** Diverged from the recommended option. This is a new UI/interaction pattern — existing bulk-table actions elsewhere in the codebase (`CoursesTable.tsx`) have empty handlers, so D-06 would be the first real one.

### Override scope

| Option | Description | Selected |
|--------|-------------|----------|
| RELEASED grades only | A DRAFT grade is just edited/re-saved directly, no override record | ✓ |
| Both DRAFT and RELEASED | Every grade change creates a GradeOverride row, even before release | |

**User's choice:** RELEASED grades only.
**Notes:** Went with the recommended option.

---

## Research detour: live LMS reference check

Before finalizing the above, the user asked to check a real LMS (`lms.lou.university`) via
Playwright to see how it handles quiz release/grading, rather than deciding from first principles.
Findings:
- The site required headed-browser mode to actually appear on screen (initial `open` was headless
  by default — corrected mid-session).
- After logging in, all 4 enrolled courses plus the full 29-course catalogue were checked for
  Quiz/Assignment activities — none found anywhere (content-only: File/URL/Forum resources).
- The course Grader report confirmed "All participants: 0/0" with only a "Course total" column — no
  gradable activities configured at all.
- The site's sidebar links (Support → redpithemes.ticksy.com, Documentation →
  lambda-docs.redpithemes.com) revealed it's a Moodle theme demo/showcase site ("Lambda" theme by
  RedPi Themes), not a real running university with assessment data.
- User chose to proceed by reasoning from Moodle's well-documented real-world behavior instead of
  live inspection, which directly grounded D-01, D-02, and D-03 in CONTEXT.md.

## Claude's Discretion

- Whether Assessment needs a separate hard cutoff-date field distinct from dueAt/availableUntil.
- Exact validation rules for attemptGradingMethod in ASM-01's draft validation.
- Batch-release exact interaction pattern (checkbox selection + confirm dialog).
- Whether attemptGradingMethod recomputation is reactive or lazy.
- Quiz-attempt UX details: question navigation model, ABANDONED/EXPIRED transition triggers.

## Deferred Ideas

None raised outside phase scope.
