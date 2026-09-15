# Phase 10: Assessment — Quizzes, Assignments & Grading - Context

**Gathered:** 2026-09-15
**Status:** Ready for planning
**Track:** B — Content & Delivery (depends on Phase 9)

<domain>
## Phase Boundary

The full assessment loop works end to end (ASM-01 → ASM-07): staff build versioned Quizzes and
Assignments, learners attempt/submit against them, graders score and release results, and learners
see only what's been released.

**In scope:**
- Quiz authoring: questions, options/answers, marks, pass threshold, attempt limit, availability,
  feedback behaviour; draft validation catches incomplete questions; published settings are
  versioned (ASM-01).
- Objective Quiz auto-scoring, reproducible, with full attempt evidence stored (ASM-02).
- Assignment authoring: instructions, due date, permitted file types/size, grading scale,
  resubmission policy (ASM-03).
- Assignment submission with a durable receipt; failures never show false success (ASM-04) — reuses
  Phase 4's presigned-URL upload pipeline.
- Grading: in-scope-only submission visibility, draft grades invisible to learners, explicit release
  (ASM-05).
- Grade override/correction with mandatory reason (ASM-06).
- Learner-facing released results, feedback, attempt history, unmet pass requirements (ASM-07).

**Explicitly NOT in scope:**
- Extending `Course`/`Programme.completionRule` to reference assessment results — Phase 9's D-10
  scoped v1 `completionRule` to required-lessons + attendance only. Whether/how a later phase wires
  assessment pass/fail into completion is not this phase's problem; Phase 10 just needs to produce
  trustworthy `Grade`/`Attempt` evidence for whoever reads it next.
- Certificate issuance/verification/revocation (Phase 11) — consumes this phase's released Grade
  data as evidence.
- Communications/notifications for result release (Phase 13) — this phase emits domain events; Phase
  13 drains them.

</domain>

<decisions>
## Implementation Decisions

### Quiz scoring & release
- **D-01:** Quiz attempts **auto-release immediately**. The moment ASM-02's scoring completes, the
  `Grade` row is created already `status = RELEASED` — no staff DRAFT gate for quizzes, because
  there's no human judgment call to make on an objectively-scored attempt. Assignment grades still
  go through the explicit DRAFT → RELEASED staff release per ASM-05; this decision applies to
  quizzes only.
- **D-02:** `Assessment` gets a new authored field, **`attemptGradingMethod`**
  (`HIGHEST | LATEST | AVERAGE`), set by whoever authors the quiz, **default `HIGHEST`**. It
  determines which `Attempt`'s score is the one shown to the learner, used for pass/fail, and
  reported to staff when `maxAttempts > 1`. Mirrors Moodle's own per-quiz "Grading method" setting
  — checked directly against Moodle's documented behavior during discussion.

### Assignment submission & resubmission
- **D-03:** A submission made after `Assessment.dueAt` is **accepted and flagged**
  (`Submission.isLate = true`), never hard-blocked by the due date alone. The due date is
  informational; grading judgment (accept, penalize, reject) stays with the human grader. (Mirrors
  Moodle: a separate optional cut-off date is what actually blocks submission there — the schema
  currently has no equivalent hard-cutoff field; see Claude's Discretion.)
- **D-04:** When `allowResubmission = true` and a learner submits again, a **new `Submission` row is
  created with an incremented `attemptNumber`** — never an overwrite-in-place. This matches the
  schema's own `@@unique([assessmentId, enrolmentId, attemptNumber])` constraint, which is built for
  multiple numbered rows, and preserves full submission history consistent with the project's
  no-hard-deletes convention. `Grade.submissionId` links to one specific attempt.

### Grading workflow & overrides
- **D-05:** Graders are scoped to their **Cohort**, not just their Course — per
  `.planning/intel/requirements.md`'s ASM-05 acceptance ("graders cannot access unrelated
  Cohorts"). A Course running under multiple Cohorts may have a different instructor grading each.
- **D-06:** A **batch-release action** exists alongside per-submission release: an instructor can
  select multiple graded (DRAFT) submissions within a Cohort/Assessment and release them together
  in one action. This is a **new UI/interaction pattern** — existing bulk-table actions elsewhere in
  the codebase (`CoursesTable.tsx`) have empty handlers, so this would be the first real one; flag
  for `/gsd:ui-phase 10`.
- **D-07:** `GradeOverride` (ASM-06) applies **only to a grade that's already `RELEASED`**. A
  still-DRAFT grade is corrected by editing/re-saving it directly — no `GradeOverride` row, no
  mandatory reason, because nothing has been shown to the learner or fed downstream yet.
  `GradeOverride` exists specifically for the case where a *released* (and possibly already
  completion/certificate-relevant) grade needs correcting — matching ASM-06's "resulting
  completion/certificate impact" wording.

### Claude's Discretion
- Whether `Assessment` needs a separate hard cutoff-date field distinct from `dueAt`/
  `availableUntil` for assignments, or whether `availableUntil` already serves that purpose for both
  Quiz and Assignment — surfaced during discussion but not resolved; research/planning should
  propose based on how `availableUntil` is actually used elsewhere.
- Exact validation rules for `attemptGradingMethod` in ASM-01's draft validation (e.g., is it
  required at publish time, does it apply meaninglessly when `maxAttempts = 1`).
- Batch-release (D-06) exact interaction pattern — checkbox selection + confirm dialog, following
  `ConfirmModal`'s existing precedent, is the expected shape but the details are planning-time.
- Whether `attemptGradingMethod` recomputation (when a new `Attempt` completes) is reactive
  (recalculate immediately, like Phase 9's completion-engine trigger) or lazy (computed at read
  time) — a performance/implementation choice, not a behavior choice.
- Quiz-attempt UX details not discussed this session: one-question-per-page vs. single-page
  navigation, and exactly when an `IN_PROGRESS` `Attempt` transitions to `ABANDONED` or `EXPIRED`
  (both states already exist on `AttemptStatus`, so the schema anticipates this — the triggering
  behavior is open).

### Reviewed Todos (not folded)
- `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` (area: ui, score 0.7) — Phase 4.1's
  staff-side catalogue/lesson-editor async-mutation warnings; unrelated to Phase 10's assessment
  domain. Not folded.
- `2026-09-14-fix-07-review-manual-payment-race-and-idempotency.md` (area: payments, score 0.2) —
  Phase 7 payment-integrity bug; unrelated to assessment/grading. Not folded.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & product intent
- `.planning/REQUIREMENTS.md` — ASM-01 through ASM-07 (lines 101–109); requirement→phase table
  (lines 262–268).
- `.planning/intel/requirements.md` — acceptance criteria for ASM-01…ASM-07 (lines 322–362),
  including the ASM-05 "graders cannot access unrelated Cohorts" and ASM-01 "learner attempts use
  the assigned version" detail not restated verbatim in REQUIREMENTS.md.
- `.planning/ROADMAP.md` §"Phase 10" (line 447 onward) — goal, requirements, success criteria,
  dependency on Phase 9.
- `.planning/PROJECT.md` — locked constraints (archive-only, `@prisma/client` boundary, closed
  permission catalogue).

**Broken ref, flagged for awareness:** `.planning/intel/requirements.md` cites
`docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` §11.9 as the
ASM source, but that file no longer exists anywhere in the repo — only its extracted classification
metadata survives at
`.planning/intel/classifications/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments-9c7f2b4a.json`.
`.planning/intel/requirements.md`'s captured acceptance criteria (above) is the best available
substitute; researcher/planner should not expect to find the original PRD file.

### Carried forward from Phase 9
- `.planning/phases/09-learning-delivery-progress-tracking/09-CONTEXT.md` — D-10
  ("`Course`/`Programme.completionRule` v1 can check exactly two things … No assessment criteria —
  Phase 10 doesn't exist yet"). Phase 9's dashboard "assessment obligations" slot is a named gap
  this phase fills. Phase 10 does **not** need to extend `completionRule` itself.

### Code to build on
- `prisma/schema.prisma` — `model Assessment` (~line 1048, already carries Quiz settings
  `maxAttempts`/`passMark`/`totalMarks` and Assignment settings
  `allowedFileTypes`/`maxFileSizeBytes`/`allowResubmission` on one model, discriminated by
  `AssessmentType`), `model QuizQuestion`/`QuizOption` (1087–1112), `model Attempt` (1116, already
  has `AttemptStatus` `IN_PROGRESS`/`SUBMITTED`/`ABANDONED`/`EXPIRED`), `model Submission` (1141,
  `uploadStatus` shares its lifecycle with `LessonResource`), `model Grade` (1167, `DRAFT`/
  `RELEASED` via `GradeStatus`), `model GradeOverride` (1200). **The full data model already
  exists** — nothing built on top of it yet (no service, no UI).
- `src/server/permissions/catalogue.ts` (~line 53) — `assessments.create`, `assessments.edit`,
  `submissions.view`, `grades.manage` already exist in the closed permission catalogue; confirm
  whether a new identifier is needed for D-06's batch-release before assuming `grades.manage`
  covers it.
- `src/server/services/readiness-service.ts` — pure-evaluator + named-third-state pattern (reused
  Phase 4→5→9); ASM-01's draft validation should follow this shape if it needs a multi-state result.
- `src/server/services/resource-service.ts` — the CRUD factory Assessment authoring
  (create/edit/archive) should build on, same as every other resource in this codebase.
- `src/server/services/lesson-resource-service.ts` + `src/server/services/storage-service.ts` — the
  existing presigned-URL upload/download pipeline (`UploadStatus` `UPLOADING`/`READY`/`ERROR`) that
  ASM-04's `Submission` file handling reuses; `Submission.uploadStatus` already mirrors this exact
  enum.
- `src/server/services/completion-service.ts` / `completion-engine.ts` / `lesson-progress-service.ts`
  — Phase 9's established audit-first, `DomainEvent`-emitting service pattern; `Attempt`/
  `Submission`/`Grade` services should follow the same shape (actor/before-after/reason/outcome).
- `src/components/primitives/` — `ResourceTable`, `ResourceForm`, `DetailLayout`, `ConfirmModal` —
  staff-side UI kit; D-06's batch-release is the first real bulk-select action in this codebase.

### Framework
- `AGENTS.md` / `node_modules/next/dist/docs/` — mandatory per `AGENTS.md`; live Next.js is 16.3.4
  and differs from training data. Read the relevant guide before writing code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The full Assessment/QuizQuestion/QuizOption/Attempt/Submission/Grade/GradeOverride schema**
  already exists (unlike Phase 9, which had to design `LessonProgress`/`CompletionRecord` from
  scratch) — this phase is service + UI work on an already-locked data model, not schema design.
- **Presigned-URL upload pipeline** (`storage-service.ts`, `lesson-resource-service.ts`) — directly
  reusable for `Submission` file handling; only the authorization predicate changes (enrolment/
  Cohort-scope check instead of staff-role check, mirroring Phase 9's LRN-03 reuse).
- **`createResourceService`** — gives new services (assessment authoring) authorization/scoping/
  audit for free.
- **`DomainEvent` outbox** — the mechanism this phase's grade-release and override actions should
  emit through, for Phase 11/13 to drain later.

### Established Patterns
- **Audit-first writes** — actor/before-after/reason/outcome on every mutation (D-07's override
  must follow this, like Phase 5's attendance corrections and Phase 9's staff progress override).
- **`@prisma/client` only in `src/server/services/`** — ESLint-enforced, `tests/boundary.test.ts`.
- **Named gaps, not silent passes** — the `NOT_YET_CHECKED`/`deferredTo` convention Phase 9's
  dashboard already uses for its "assessment obligations" slot, which this phase now fills in.

### Integration Points
- Phase 9's dashboard "assessment obligations" slot → this phase populates it with real data.
- Phase 11 (Certificates) will read RELEASED `Grade`/`Attempt`/`Submission` evidence — D-07's
  override should emit a `DomainEvent` Phase 11 can consume for CRD-06's "re-evaluate after a
  correction" requirement, mirroring Phase 9's D-11/D-12 reactive-recalculation pattern.
- Cohort-scoped grader access (D-05) should reuse the `cohort-scope.ts` pattern already established
  for staff roster/attendance access in Phase 5.

</code_context>

<specifics>
## Specific Ideas

- Before locking these decisions, a live reference Moodle LMS (`lms.lou.university`) was checked via
  browser automation to see how a real system handles quiz release/grading — it turned out to be a
  Moodle **theme demo site** ("Lambda" theme by RedPi Themes) with 0 enrolled students and 0 quiz/
  assignment activities configured anywhere (confirmed via its Grader report: "All participants:
  0/0"). Reasoning fell back to Moodle's well-documented general behavior instead of live
  inspection.
- That grounding directly shaped three decisions: Moodle's **review-options timing** (quiz scores
  typically show immediately after attempt submission unless a teacher deliberately delays them) →
  D-01's auto-release; Moodle's per-quiz **"Grading method"** setting (Highest/Last/Average) → D-02's
  `attemptGradingMethod`; Moodle's **due-date vs. cut-off-date** distinction (due date alone only
  flags lateness; a separate cut-off date is what actually blocks submission) → D-03's
  accept-and-flag behavior.

</specifics>

<deferred>
## Deferred Ideas

None raised outside phase scope — discussion stayed within Phase 10's assessment/grading domain.

### Reviewed Todos (not folded)
See `<decisions>` above — two todos were reviewed via `todo.match-phase` but not folded (unrelated
domains: Phase 4.1 UI mutation warnings, Phase 7 payment race condition).

</deferred>

---

*Phase: 10-Assessment — Quizzes, Assignments & Grading*
*Context gathered: 2026-09-15*
