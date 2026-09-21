# Phase 10: Assessment — Quizzes, Assignments & Grading - Research

**Researched:** 2026-09-15
**Domain:** Quiz/assignment authoring, auto-scoring, file-submission receipts, cohort-scoped grading workflow, audited overrides — server actions + Prisma on an already-locked schema
**Confidence:** HIGH (schema, permissions, and every reusable service already exist in-repo and were read directly) / MEDIUM (the versioning/reproducibility mechanism for quiz attempts, since no existing pattern in this codebase covers it)

## Summary

Phase 10 is service-and-UI work on top of a data model that already exists in full
(`prisma/schema.prisma` lines 1048–1212: `Assessment`, `QuizQuestion`, `QuizOption`, `Attempt`,
`Submission`, `Grade`, `GradeOverride`). Nothing here requires new tables. It does require exactly
one schema migration (`Assessment.attemptGradingMethod`, per CONTEXT.md D-02) and, most likely, one
non-schema architectural decision the CONTEXT session did not resolve: **how "learner attempts use
the assigned version" (ASM-01 acceptance) is made real**, given that `QuizQuestion`/`QuizOption` are
plain mutable rows with no version stamp of their own and there is no `AssessmentPublication` freeze
table analogous to `CoursePublication`/`ProgrammePublication`. See Architecture Patterns → "The
versioning gap" and Open Questions §1 — this is the single most consequential finding in this
research and the planner should resolve it explicitly before writing tasks.

Every other piece of this phase has a direct, already-proven precedent in the codebase: the
`createResourceService` CRUD factory (with a caveat — see below) for Assessment authoring; the
`createCohortScopeResolvers` pattern for grader Cohort-scoping (D-05); the presigned-URL
upload/promote pipeline in `storage-service.ts` (extended with new Submission-specific key builders,
not reused verbatim, because its key builders are hardcoded to `lessons/<lessonId>/...`); the
`getOwnX`/ownership-comparison pattern (not RBAC) for learner self-service actions (start an
Attempt, submit a Submission, read released results); `ConfirmModal` for both D-07's mandatory-reason
override and D-06's batch-release confirmation; and the `DomainEvent` outbox for `grade.released`/
`grade.overridden`/`submission.created`-type events Phase 11/13 will drain later.

The permission catalogue is closed and already contains exactly what this phase needs —
`assessments.create`, `assessments.edit`, `submissions.view`, `grades.manage` — and **no
`assessments.view`**. D-06's "does batch-release need a new permission identifier" question resolves
cleanly: it does not. Adding one requires the PRD §1.3 approval path per the catalogue's own header
comment; `grades.manage` already covers per-submission release (ASM-05) and should cover the batch
variant too, since it is the same action performed on multiple rows in one transaction.

**Primary recommendation:** Build Assessment/QuizQuestion/QuizOption authoring on
`createResourceService` where its shape fits (Assessment itself), write bespoke services for
Attempt/Submission/Grade/GradeOverride (their state-machine and audit shapes don't match the
factory's plain CRUD contract), extend `storage-service.ts` with Submission-scoped key builders
rather than reusing the Lesson-scoped ones, and resolve the quiz-versioning snapshot question before
any Attempt-scoring code is written.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Quiz/Assignment authoring (ASM-01, ASM-03) | API / Backend (`assessment-service.ts`) | Browser (authoring forms, `ResourceForm`/`ResourceTable` primitives) | Same shape as every other catalogue resource; server validates and versions, browser renders the form |
| Draft validation (incomplete questions, totalMarks/passMark consistency) | API / Backend | Browser (inline error summary) | Must be enforced server-side (published constraints "apply consistently to server validation" per ASM-03 acceptance); browser only mirrors it for UX |
| Quiz attempt taking (start, answer, submit) | Browser / Client | API / Backend (scoring, persistence) | Learner interaction is client-driven; the score that counts is always recomputed server-side on submit, never trusted from the client |
| Auto-scoring (ASM-02) | API / Backend | — | Pure, reproducible calculation; must not run in the browser or trust a client-supplied score |
| Assignment submission upload (ASM-04) | Browser (direct-to-storage PUT) | API / Backend (presign, promote, receipt) + Storage/CDN (S3-compatible object store) | Mirrors Phase 4/9's presigned-URL pipeline exactly — no file body ever traverses the Next.js server |
| Grading workflow, draft grades, release (ASM-05) | API / Backend | Browser (grader UI) | Visibility and release-gating are authorization/state concerns that must be server-enforced; UI only presents what the server already filtered |
| Batch release (D-06) | API / Backend (one action, one transaction) | Browser (checkbox selection + `ConfirmModal`) | Next.js dispatches Server Actions sequentially per client (see State of the Art) — a "batch" must be one server-side transaction, not N client-dispatched actions |
| Grade override (ASM-06) | API / Backend | Browser (`ConfirmModal` reason capture) | Audit-first mutation; the mandatory-reason and before/after preservation are server invariants |
| Learner-facing released results (ASM-07) | Frontend Server (SSR) / API | — | Server Component reads through an ownership-scoped `getOwnX`-style query, same as Phase 9's dashboard |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Quiz attempts **auto-release immediately**. The moment ASM-02's scoring completes, the
  `Grade` row is created already `status = RELEASED` — no staff DRAFT gate for quizzes, because
  there's no human judgment call to make on an objectively-scored attempt. Assignment grades still
  go through the explicit DRAFT → RELEASED staff release per ASM-05; this decision applies to
  quizzes only.
- **D-02:** `Assessment` gets a new authored field, **`attemptGradingMethod`**
  (`HIGHEST | LATEST | AVERAGE`), set by whoever authors the quiz, **default `HIGHEST`**. It
  determines which `Attempt`'s score is the one shown to the learner, used for pass/fail, and
  reported to staff when `maxAttempts > 1`. Mirrors Moodle's own per-quiz "Grading method" setting.
- **D-03:** A submission made after `Assessment.dueAt` is **accepted and flagged**
  (`Submission.isLate = true`), never hard-blocked by the due date alone. The due date is
  informational; grading judgment (accept, penalize, reject) stays with the human grader.
- **D-04:** When `allowResubmission = true` and a learner submits again, a **new `Submission` row is
  created with an incremented `attemptNumber`** — never an overwrite-in-place. `Grade.submissionId`
  links to one specific attempt.
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

### Claude's Discretion

- Whether `Assessment` needs a separate hard cutoff-date field distinct from `dueAt`/
  `availableUntil` for assignments, or whether `availableUntil` already serves that purpose for both
  Quiz and Assignment.
- Exact validation rules for `attemptGradingMethod` in ASM-01's draft validation (e.g., is it
  required at publish time, does it apply meaninglessly when `maxAttempts = 1`).
- Batch-release (D-06) exact interaction pattern — checkbox selection + confirm dialog, following
  `ConfirmModal`'s existing precedent, is the expected shape but the details are planning-time.
- Whether `attemptGradingMethod` recomputation (when a new `Attempt` completes) is reactive
  (recalculate immediately, like Phase 9's completion-engine trigger) or lazy (computed at read
  time) — a performance/implementation choice, not a behavior choice.
- Quiz-attempt UX details not discussed this session: one-question-per-page vs. single-page
  navigation, and exactly when an `IN_PROGRESS` `Attempt` transitions to `ABANDONED` or `EXPIRED`.

### Deferred Ideas (OUT OF SCOPE)

None raised outside phase scope — discussion stayed within Phase 10's assessment/grading domain.
Explicitly out of scope per CONTEXT.md: extending `completionRule` to reference assessment results
(Phase 9 owns v1 `completionRule` as required-lessons + attendance only); certificate
issuance/verification/revocation (Phase 11); result-release notifications (Phase 13, this phase only
emits `DomainEvent` rows for Phase 13 to drain).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASM-01 | Quizzes created with questions, options/answers, marks, pass threshold, attempt limit, availability, feedback behavior; draft validation catches incomplete questions; published settings versioned | Schema already has every authored field except `attemptGradingMethod` (D-02, new migration). Versioning mechanism is the open architectural question — see Open Questions §1. `readiness-service.ts`'s pure-evaluator/third-state pattern is the direct precedent for draft validation. |
| ASM-02 | Objective Quiz questions scored automatically, reproducibly; attempts store start/submit time, answers, version, result, status | `Attempt` model already carries every required field. `QuestionType` is a closed enum (`SINGLE_CHOICE`/`MULTI_CHOICE`/`TRUE_FALSE`) — all three are auto-scorable, no manual-grading-for-quiz-question path exists. Scoring must run server-side only; see Common Pitfalls §1. |
| ASM-03 | Assignments created with instructions, due date, file types/size, grading scale, resubmission policy; published constraints apply consistently to server validation | `Assessment` already carries `allowedFileTypes`/`maxFileSizeBytes`/`allowResubmission`/`dueAt`. These are per-Assessment authored values, NOT looked up from the static `UPLOAD_LIMITS` table in `src/lib/upload-limits.ts` (that table is keyed only to `FILE`/`IMAGE`/`VIDEO` LessonTypes and deliberately excludes `QUIZ`/`ASSIGNMENT`). |
| ASM-04 | Assignment submissions accepted with durable receipt; failures never show false success | `Submission` model mirrors `LessonResource`'s `UploadStatus` lifecycle exactly (`UPLOADING`/`READY`/`ERROR`) and already has `receiptId`. Direct precedent: `lesson-resource-service.ts`'s intent/complete two-step upload plus `storage-service.ts`'s presign/promote — needs new Submission-scoped key builders (see Don't Hand-Roll §2). |
| ASM-05 | Graders view in-scope submissions only, record grades/feedback, save drafts, explicit release; learners never see drafts | `Grade.status` (`DRAFT`/`RELEASED`) already exists. Cohort-scoping precedent: `cohort-scope.ts`'s `createCohortScopeResolvers` — needs a new `enrolmentCohortScope`-style resolver reused directly for Submission/Attempt (both have `enrolmentId`), and a new Course→Cohort-aware resolver for Assessment listing itself. |
| ASM-06 | Grade override/correction with mandatory reason; original/revised value, actor, reason, time, completion/certificate impact preserved | `GradeOverride` model already stores `previousScore`/`newScore`/`reason`/`actorId`/`createdAt`. `ConfirmModal`'s docstring already names "grade overrides" as an intended consumer. D-07 scopes this to RELEASED grades only. |
| ASM-07 | Learners see released results, feedback, attempt history, unmet pass requirements; only released/permitted details appear | Precedent: `lesson-progress-service.ts`'s `getOwnWatchProgress`/ownership-comparison pattern (derives the enrolment from `actor.userId`, not an RBAC permission check) — the same shape applies to a learner reading their own `Grade`/`Attempt`/`Submission` rows. |

## Standard Stack

No new external packages are required for this phase. Every dependency it needs is already
installed and verified in `package.json`:

| Library | Version (installed) | Purpose | Already used for |
|---------|---------|---------|-------------------|
| `@prisma/client` | ^6.19.3 | Assessment/Attempt/Submission/Grade/GradeOverride persistence | Every existing service |
| `zod` | ^4.5.4 | Server-side input-shape validation (draft validation, quiz answer payload shape) | Role-JSON validation, existing server action input schemas |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | ^3.1125.0 | Presigned PUT/GET for Submission file uploads | `storage-service.ts` (LessonResource pipeline) |
| `vitest` | ^4.1.11 | Unit + integration tests | Existing `tests/*.test.ts` suite |

**Installation:** none required — no `npm install` needed for this phase.

**Version verification:** not applicable; no new packages. If the planner later decides a rich-text
editor is needed for Assignment instructions authoring, note `@tiptap/*` is already pinned at 3.31.0
(Phase 4.1 P12, human-approved) and should be reused rather than a second editor introduced.

## Package Legitimacy Audit

Not applicable — this phase installs no new external packages. All required libraries are already
present in `package.json` and were installed/vetted in prior phases (see table above). No
`slopcheck`/registry verification needed.

## Architecture Patterns

### System Architecture Diagram

```
STAFF (Instructor/Programme Manager) — authoring & grading
  │
  ▼
[Assessment authoring UI] ──(assessments.create/edit, Course-scoped)──▶ assessment-service.ts
  │  builds Assessment + QuizQuestion + QuizOption rows, draft-validates,
  │  bumps Assessment.version on publish
  ▼
[Grading UI] ──(grades.manage, COHORT-scoped via enrolmentCohortScope)──▶ grading-service.ts
  │  lists in-scope Submissions/Attempts, writes draft Grade, explicit release
  │  (single release + D-06 batch release, one transaction each)
  ▼
DomainEvent outbox (grade.released, grade.overridden, submission.created, attempt.submitted)
                                    │
                                    ▼ (Phase 13 drains later — this phase only writes)

LEARNER — attempt & submit
  │
  ▼
[Quiz attempt UI] ──(own-enrolment ownership check, no RBAC permission)──▶ attempt-service.ts
  │  creates IN_PROGRESS Attempt, learner answers, submit triggers
  │  server-side scoring against the ASSIGNED VERSION's question set
  │  (see "The versioning gap" below) → Grade auto-created RELEASED (D-01)
  ▼
[Assignment submission UI] ──(own-enrolment ownership check)──▶ submission-service.ts
  │  1. presign staged PUT (storage-service.ts, extended)
  │  2. browser PUTs bytes directly to object store — server never sees the body
  │  3. complete: HeadObject verify → promote staged→final key → Submission row
  │     written READY only after the object store confirms (D-04's "never false success")
  ▼
[Learner results UI] ──(own-enrolment, RELEASED-only filter)──▶ getOwnResults-style read
  shows released Grade + feedback + attempt history + unmet pass requirements (ASM-07)
```

### The versioning gap (read before planning ASM-01/ASM-02)

`Assessment.version: Int` and `Attempt.versionUsed: Int` / `Submission.versionUsed: Int` already
exist in the schema, and `.planning/intel/requirements.md`'s ASM-01 acceptance criterion is explicit:
**"learner attempts use the assigned version."** But unlike Course/Programme (which freeze a whole
obligation tree into a separate `CoursePublication`/`ProgrammePublication` row at publish time —
`publication.ts`'s `CourseObligationPayload`), there is **no `AssessmentPublication` table** and
`QuizQuestion`/`QuizOption` carry **no version column of their own**. They are plain mutable rows
tied to `assessmentId` with `onDelete: Cascade`.

This means: if a staff member edits a question's `marks` or a `QuizOption.isCorrect` flag after a
learner has already attempted (and been auto-scored and auto-released, per D-01) against the earlier
version, nothing in the schema as it stands prevents that edit from silently changing what a live
`IN_PROGRESS` attempt or a re-render of a `SUBMITTED` attempt's evidence would show — because the
question/option data an attempt renders or re-scores against would be read live, not from a frozen
snapshot.

Two viable resolutions, in order of how well they fit the existing schema:

1. **Self-contained attempt snapshot (no migration needed).** At `Attempt` creation, snapshot the
   live question set (id, prompt, marks, options, `isCorrect`) into `Attempt.answers` (already
   `Json?`) alongside the learner's picks, e.g. `{ questionSnapshot: [...], responses: [...] }`.
   Scoring reads ONLY from this JSON, never from live `QuizQuestion`/`QuizOption`. `versionUsed`
   still records `Assessment.version` at start time for display/audit ("this attempt used v2"), but
   the JSON blob — not the live tables — is what makes ASM-02's "reproducible calculation" and
   ASM-01's "learner attempts use the assigned version" actually true after a later edit. This fits
   the existing `Attempt.answers: Json?` field with zero schema changes.
2. **Frozen `AssessmentPublication` snapshot table**, mirroring `CoursePublication`/
   `ProgrammePublication` exactly (new model + migration). More consistent with the codebase's
   existing "PXR is protected from silent requirement changes" pattern, but the CONTEXT.md session
   never discussed it, and it is a materially larger schema change than D-02's single new column.

This research recommends **option 1** as the lower-risk default — it needs no schema migration
beyond D-02's `attemptGradingMethod`, and it produces a genuinely self-contained, reproducible
attempt record (ASM-02's exact wording). It does NOT, however, freeze the pass/fail *threshold*
(`Assessment.passMark`) the same way — a later `passMark` change would still retroactively change
whether an old attempt reads as "passed." If the planner wants the threshold frozen too, either
snapshot `passMark`/`totalMarks` into the same JSON, or accept that pass/fail is evaluated against
the *live* `passMark` (which contradicts "learner attempts use the assigned version" for that one
field). **This is now a locked-in Open Question — flag it for the planner/discuss-phase, it was not
resolved in CONTEXT.md.**

### Recommended Project Structure

```
src/server/services/
├── assessment-service.ts       # Quiz+Assignment authoring, draft validation, publish/version bump
├── quiz-scoring.ts             # PURE scoring function — no data-access import (mirrors completion-engine.ts)
├── attempt-service.ts          # start/answer/submit an Attempt; own-enrolment check; calls quiz-scoring.ts
├── submission-service.ts       # presign/complete Submission upload; own-enrolment check; extends storage-service.ts
├── grading-service.ts          # draft grade save, single release, batch release (D-06), Cohort-scoped listing
├── grade-override-service.ts   # D-07's RELEASED-only override, mandatory reason, audit
└── assessment-scope.ts         # new resolvers: assessmentCourseScope (staff authoring), reuses enrolmentCohortScope (grading)

src/app/staff/assessments/       # authoring UI (ResourceTable/ResourceForm/DetailLayout)
src/app/staff/grading/           # grader queue UI (Cohort-scoped), batch-release checkbox UI
src/app/(learner)/assessments/   # attempt-taking UI, submission UI
src/app/(learner)/dashboard/     # existing "assessment obligations" slot — this phase fills it (readiness-service.ts's NOT_YET_CHECKED item)

tests/
├── quiz-scoring.test.ts         # pure function, exhaustive per-QuestionType cases
├── assessment-service.test.ts
├── attempt-service.test.ts
├── submission-service.test.ts
├── grading-service.test.ts
├── grade-override-service.test.ts
└── assessment-*.integration.test.ts  # real-Postgres, Docker available in this environment (see Environment Availability)
```

### Pattern 1: Course-scoped authoring vs. Cohort-scoped grading (two different scope resolvers)

**What:** `Assessment` belongs to a `Course` (`Assessment.courseId`), but grading happens per
`Submission`/`Attempt`, which belong to an `Enrolment`, which belongs to a `Cohort`. D-05 requires
grader visibility scoped to **Cohort**, not Course. These are two different `ResourceScope` shapes
and must use two different resolvers.

**When to use:** Authoring actions (`assessments.create`/`assessments.edit`) scope through the
Assessment's `courseId` — a new `assessmentCourseScope(assessmentId)` resolver, structurally
identical to the existing per-id-lookup resolvers in `cohort-scope.ts`, just reading
`Assessment.courseId` → `{ courseIds: [courseId] }`. Grading actions (`grades.manage` on a
Submission/Attempt) scope through `enrolmentCohortScope(enrolmentId)` — already exists, reused
as-is, no new code.

**Example:**
```typescript
// Source: src/server/services/cohort-scope.ts (existing precedent, read directly)
// New resolver for Assessment authoring — same one-hop shape as sessionCohortScope/enrolmentCohortScope
async function assessmentCourseScope(assessmentId: string): Promise<ResourceScope> {
  const row = await deps.assessment.findUnique({
    where: { id: assessmentId },
    select: { courseId: true },
  });
  if (!row) return {}; // deny-by-default on a missing row
  return { courseIds: [row.courseId] };
}

// Grading reuses the EXISTING enrolmentCohortScope unchanged:
// grades.manage on a Submission → enrolmentCohortScope(submission.enrolmentId)
// grades.manage on an Attempt   → enrolmentCohortScope(attempt.enrolmentId)
```

### Pattern 2: `createResourceService` fits Assessment authoring, NOT Attempt/Submission/Grade

**What:** The factory in `resource-service.ts` gives `list`/`get`/`create`/`update`/`archive` with
permission+scope+audit for free, but its `Delegate<T>` contract assumes plain field-level updates and
a single `permissions.edit` gate for every write. `Attempt`/`Submission`/`Grade` have real state
machines (`IN_PROGRESS → SUBMITTED`, `UPLOADING → READY|ERROR`, `DRAFT → RELEASED`) with different
actors on different transitions (learner starts an Attempt, server auto-scores it; grader saves a
draft, then explicitly releases; only a released Grade can be overridden, per D-07) — squeezing that
into `update()`+`archive()` would either bypass the factory's audit shape or force awkward reuse of
`archive` for a non-archival transition.

**When to use:** Use `createResourceService` for `Assessment` (its own CRUD + archive genuinely
matches the factory's shape — same as Course/Module/Lesson). Write bespoke services, following
`completion-service.ts`'s hand-rolled audit-first/DomainEvent-emitting shape, for
Attempt/Submission/Grade/GradeOverride.

**Anti-pattern to avoid:** Do not force Grade release through `resource-service.ts`'s `update()`.
`update()`'s audit action name is a generic `"grade.updated"` — ASM-05 needs a distinct,
Phase-13-consumable `"grade.released"` domain event, and D-06's batch-release needs one action that
writes N Grade rows and N audit entries inside one transaction, which the factory's single-record
`update` signature does not support.

### Pattern 3: Own-record access for learner self-service actions (not RBAC)

**What:** Starting a quiz Attempt, submitting an Assignment, and reading released results are
learner actions on the learner's OWN enrolment — not staff actions gated by the permission
catalogue (there is no `attempts.*` or a learner-facing permission in `catalogue.ts` at all, by
design). The existing precedent (`lesson-progress-service.ts`'s `getOwnWatchProgress`,
`checkout-service.ts`'s `getOwnOrder`) derives the enrolment from `actor.userId` and does an
ownership comparison, never a `withPermission` grant check.

**When to use:** Every learner-facing action in this phase (start Attempt, answer, submit Attempt,
presign Submission upload, complete Submission upload, read own Grade/Attempt history).

**Example:**
```typescript
// Source: src/server/services/lesson-progress-service.ts (pattern, read directly) — line ~11
// "authorization here is an ownership comparison... not a scope check"
export async function startAttempt(actor: Actor, input: { assessmentId: string }) {
  const enrolment = await tx.enrolment.findFirst({
    where: { userId: actor.userId, cohort: { /* pinned course includes this assessment */ } },
  });
  if (!enrolment) return { kind: "not-found" }; // never reveal whether the Assessment exists
  // ... proceed only against enrolment.id, never a caller-supplied enrolmentId
}
```

### Pattern 4: Batch actions must be ONE server-side transaction

**What:** Next.js 16.3.4 dispatches Server Actions **sequentially per client** — triggering N
actions in quick succession serializes them, it does not parallelize them (see State of the Art). A
naive "select 10 rows, call `releaseGrade(id)` 10 times from the client" implementation would be
slow (10 serialized round-trips) AND would produce 10 separate audit rows / 10 separate
`DomainEvent` rows for what the user experienced as one action.

**When to use:** D-06's batch-release must be implemented as a single server action taking an array
of Grade ids, doing the whole batch inside one `prisma.$transaction`, and writing one batch-level
audit entry (or N audit entries written together inside the one transaction — but always one round
trip, one `withPermission` check, one scope validation covering every selected id).

**Example:**
```typescript
// New — no existing batch-release precedent in the codebase (CONTEXT.md D-06 confirms
// CoursesTable.tsx's existing bulk actions have EMPTY handlers, not a working pattern to copy)
export const releaseGradesBatch = withPermission<{ gradeIds: string[] }>(
  "grades.manage",
  async (input) => { /* resolve to the COMMON cohort scope of every gradeId; reject if they span cohorts a grant doesn't cover */ },
)(async (input, ctx) => {
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const id of input.gradeIds) {
      const before = await tx.grade.findUnique({ where: { id } });
      if (before?.status !== "DRAFT") continue; // skip already-released, never double-release
      const after = await tx.grade.update({ where: { id }, data: { status: "RELEASED", releasedById: ctx.actor.userId, releasedAt: new Date() } });
      await writeDomainEvent(tx, { type: "grade.released", payload: { gradeId: id }, occurredAt: new Date() });
      results.push(after);
    }
    return results;
  });
});
```

### Anti-Patterns to Avoid

- **Trusting a client-supplied score or pass/fail verdict.** Every Attempt submission must
  recompute the score server-side from the (snapshotted, per "the versioning gap" above) question
  set — never accept `score`/`passed` fields in the submit payload.
- **Reusing `storage-service.ts`'s `buildStorageKey({ lessonId })` verbatim for Submissions.** Its
  key format (`lessons/<lessonId>/...`) is hardcoded to the Lesson domain. Submission uploads need
  their own key builder (e.g. `submissions/<enrolmentId>/<assessmentId>/<randomUUID()>`) — copy the
  presign/promote/inspect *functions*, not the key-shape assumption.
  `UploadStatus`/`downloadTtlFor` infrastructure is generic and DOES reuse cleanly.
- **Looking up Assignment file-type/size limits in `UPLOAD_LIMITS`.** That table is deliberately
  keyed only to `FILE`/`IMAGE`/`VIDEO` LessonTypes; QUIZ/ASSIGNMENT are absent on purpose. Assignment
  constraints are per-Assessment authored values (`Assessment.allowedFileTypes`/`maxFileSizeBytes`),
  validated dynamically, not against a static table.
- **Letting `feedbackBehaviour` (currently a raw `String @default("ON_RELEASE")`, not a Prisma enum)
  go unvalidated at the application layer.** Prisma does not enforce it as a closed set — validate
  it against an explicit allow-list in `assessment-service.ts`'s draft-validation step, the same way
  `isPermission` validates the permission catalogue at a trust boundary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Presigned S3 upload/promote for Submission files | A second S3 client / new presign logic | `storage-service.ts`'s `makeClient`/`getSignedUrl`/`CopyObjectCommand` functions, called with new Submission-scoped keys | One S3 client, one set of presign/promote/inspect functions already proven correct for LessonResource; only the key-builder and the authorization predicate (own-enrolment vs. staff-role) differ |
| Grader Cohort-scope resolution | A new scoping mechanism for "graders cannot access unrelated Cohorts" | `cohort-scope.ts`'s `enrolmentCohortScope` (already exists, reused as-is for Submission/Attempt grading) | It already correctly populates all three `ResourceScope` keys (`cohortId`/`programmeId`/`courseIds`) so a COHORT, PROGRAMME, or COURSE-scoped grant all resolve correctly — reimplementing this is how the T-05-07/T-05-08 threats documented in that file's header get reintroduced |
| Draft-completeness validation with a third "not yet checked" state | A boolean pass/fail validator | `readiness-service.ts`'s `ReadinessState` (`PASS`/`FAIL`/`WARN`/`NOT_YET_CHECKED`) pattern, or at minimum its pure-evaluator/single-source-of-truth shape | The codebase has already solved "the panel and the server-side gate must never drift apart" once (three call sites, one evaluator) — ASM-01's draft validation is the same shape of problem |
| Audit rows for every assessment/grade/override mutation | Bespoke audit-writing per service | The `audit()` callback shape `resource-service.ts` and `completion-service.ts` both already use (actor/before/after/reason/outcome) | RBAC-08 requires this exact shape everywhere; a bespoke shape here is a compliance gap the audit export (RPT-05) would then have to special-case |
| Permission-catalogue additions for batch-release | A new `grades.release` or `grades.batch_release` permission identifier | `grades.manage` (already exists, already covers per-submission release) | The catalogue is explicitly closed — `catalogue.ts`'s own header states additions require the PRD §1.3 approval path, not an implementation-time decision |

**Key insight:** every piece of infrastructure this phase needs — presigned uploads, Cohort
scoping, audit-first writes, a pure/reusable evaluator for draft-completeness, a closed permission
set — was already built once, correctly, for an earlier phase. The actual net-new engineering in
Phase 10 is narrow: quiz auto-scoring logic, the state machines for Attempt/Submission/Grade, and
resolving the versioning-snapshot question above. Anything that looks like it needs a new pattern is
worth double-checking against the existing services first.

## Common Pitfalls

### Pitfall 1: Trusting `Attempt.answers` from the client as the score input

**What goes wrong:** A client submits `{ answers: [...], score: 8, passed: true }` and the server
naively persists the client-computed score.
**Why it happens:** It looks like a shortcut — the client already has the question data to compute a
local preview score for UX feedback.
**How to avoid:** The submit endpoint accepts ONLY the learner's raw selections (option ids chosen
per question), looks up the snapshotted-at-start question/option data (see "the versioning gap"),
and recomputes score/passed server-side via the pure `quiz-scoring.ts` function. Never accept a
score or passed field in the submit payload.
**Warning signs:** A server action's input type includes `score`, `maxScore`, or `passed` fields on
the SUBMIT path (as opposed to the internal return value of the scoring function).

### Pitfall 2: `MULTI_CHOICE` scoring ambiguity — exact-match vs. partial credit

**What goes wrong:** `QuestionType.MULTI_CHOICE` allows multiple `QuizOption.isCorrect = true` rows,
but the schema does not specify whether a partially-correct selection (2 of 3 correct options picked,
no incorrect ones picked) earns partial marks or zero marks. Implementing one behavior without an
explicit decision risks disagreeing with what staff expect when they author a multi-select question.
**Why it happens:** `QuestionType` and `marks: Int` per question are present, but nothing in the
CONTEXT.md session or the schema comments states the scoring rule for this one question type.
**How to avoid:** Flag this explicitly as an Open Question for the planner/discuss-phase before
writing `quiz-scoring.ts` — pick and document ONE deterministic rule (recommended: exact-set-match
only — full marks if the learner's selected-option set equals the correct-option set exactly, zero
otherwise — the simplest, most "reproducible," least surprising default, and it needs no new schema
field to express).
**Warning signs:** `quiz-scoring.test.ts` has no test case for "learner selects a strict subset of
the correct options on a MULTI_CHOICE question."

### Pitfall 3: A `false`-showing-success upload receipt (ASM-04's core invariant)

**What goes wrong:** A `Submission` row is created (or its `uploadStatus` marked `READY`) before the
object store has actually confirmed the PUT succeeded — e.g., writing the row optimistically right
after presigning, rather than after a `HeadObjectCommand` verification step.
**Why it happens:** The intent/complete two-step (presign → browser PUT → complete-and-verify) has a
tempting shortcut: skip the verify step and just trust the browser's "upload finished" signal.
**How to avoid:** Mirror `lesson-resource-service.ts`'s `completeLessonResourceUpload` exactly:
verify via `inspectLessonObject`/`HeadObjectCommand` (declared size/type match), THEN promote
staged→final key, THEN write `uploadStatus: READY` and the `receiptId` becomes durable/displayable.
Any failure at the verify step surfaces `uploadStatus: ERROR`, never a bare exception the UI might
swallow into an apparent success.
**Warning signs:** A `Submission` create call that doesn't call `HeadObjectCommand`/an equivalent
inspect step before setting `READY`.

### Pitfall 4: Quiz auto-release (D-01) bypassing the audit-first DomainEvent pattern

**What goes wrong:** Because D-01 makes quiz grading fully automatic (no staff action triggers
release), it's easy to write the score-and-release path as a plain data write without the
`writeDomainEvent`/audit-row discipline every other mutation in this codebase follows — "nobody
clicked release, so there's nothing to audit."
**Why it happens:** The audit-first pattern in this codebase (`resource-service.ts`,
`completion-service.ts`) is written around an `actor.userId` triggering the write; an
auto-scored-and-released quiz grade has no staff actor, only the learner who submitted the attempt.
**How to avoid:** Follow the `*-system-service.ts` precedent (`checkout-webhook-system-service.ts`,
`completion-engine.ts`'s DD-12 comment) for actorless/system-triggered writes: still emit a
`DomainEvent` (`grade.released` or a distinct `grade.auto_released`), still write an audit row with
`actorType: SYSTEM`/`actorId: null` or the learner's own id (their submit action IS the trigger —
unlike a webhook, there IS a real actor here, it's the learner), never skip the audit trail just
because no staff member clicked anything.
**Warning signs:** `attempt-service.ts`'s submit path creates a `Grade` row without a corresponding
audit-service call or `writeDomainEvent` call.

### Pitfall 5: `GradeOverride` created for a still-DRAFT grade

**What goes wrong:** D-07 is explicit that `GradeOverride` exists ONLY for correcting an
already-`RELEASED` grade; a DRAFT grade correction should just be a normal edit-and-resave with no
`GradeOverride` row and no mandatory reason. Implementing override-for-everything (simpler code path)
silently violates this locked decision.
**How to avoid:** `grade-override-service.ts`'s entry function should assert
`grade.status === "RELEASED"` before accepting an override request — reject (not silently downgrade
to a plain edit) if the grade is still DRAFT, so the caller routes DRAFT corrections through
`grading-service.ts`'s ordinary draft-save path instead.
**Warning signs:** A grading UI that offers the "reason required" override flow on a DRAFT-status
row.

## Code Examples

### Draft-validation, pure-evaluator shape (reused convention)
```typescript
// Source: src/server/services/readiness-service.ts (read directly, lines 20–40, 100–194)
export type ReadinessState = "PASS" | "FAIL" | "WARN" | "NOT_YET_CHECKED";
export type ReadinessItem = {
  id: string;
  category: string;
  label: string;
  state: ReadinessState;
  detail?: string;
  blocking: boolean;
};

// Phase 10 equivalent — evaluateAssessmentDraftReadiness(assessment) should follow the SAME
// shape: pure function, no data-access import, called from both the staff authoring panel
// AND the server-side publish action's refusal check, never two separate copies.
```

### Audit-first write shape (reused convention)
```typescript
// Source: src/server/services/resource-service.ts (read directly, lines 210–247)
const create = withPermission<Record<string, unknown>>(permissions.create, () => ({}))(
  async (data, ctx) => {
    const created = await delegate.create({ data });
    await audit({
      action: `${slug}.created`,
      targetType: name,
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });
    return created;
  },
);
```

### Own-record ownership check (reused convention, not RBAC)
```typescript
// Source: src/server/services/lesson-progress-service.ts header comment (read directly, lines 10-12)
// "authorization here is an ownership comparison (loadLearnerPath re-derives the enrolment
//  from actor.userId), not a scope check."
```

### Presigned upload key isolation (existing convention to extend, not copy verbatim)
```typescript
// Source: src/server/services/storage-service.ts (read directly, lines 72–95)
export function buildStorageKey({ lessonId }: { lessonId: string }): string {
  return `lessons/${lessonId}/${randomUUID()}`;
}
export function buildStagedStorageKey({ lessonId }: { lessonId: string }): string {
  return `lesson-uploads/${lessonId}/${randomUUID()}`;
}
// Phase 10 needs its own analogues, e.g.:
//   buildSubmissionStorageKey({ enrolmentId, assessmentId }) → `submissions/${enrolmentId}/${assessmentId}/${randomUUID()}`
//   buildStagedSubmissionStorageKey(...) → `submission-uploads/${enrolmentId}/${assessmentId}/${randomUUID()}`
// finalStorageKeyFor's prefix-check logic (`lesson-uploads/` → `lessons/`) needs the equivalent
// `submission-uploads/` → `submissions/` mapping, not a shared function across both domains.
```

## State of the Art

| Old Approach (training-data Next.js) | Current Approach (Next.js 16.3.4, this repo) | When Changed | Impact |
|--------------------------------------|-----------------------------------------------|---------------|--------|
| Client-side `Promise.all([action1(), action2()])` to parallelize multiple mutations | Server Actions dispatch **sequentially per client** — the second waits for the first, always | Documented behavior as of the installed 16.3.4 docs (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`) | D-06's batch-release MUST be one server action operating on an array of ids inside one transaction — N separate client-dispatched release calls would serialize (slow) AND fragment the audit/DomainEvent trail |
| Manual `router.refresh()` / separate fetch after a mutation to see fresh data | `updateTag`/`revalidatePath`/`refresh` inside the Server Action itself — the SAME HTTP response carries both the mutation result and the re-rendered RSC payload | Current 16.3.4 model, per the same doc | Grading/release/override actions that need "read-your-own-write" (e.g., a released grade immediately disappearing from the DRAFT queue) should call `updateTag`/`revalidatePath` before returning, not rely on a follow-up client fetch |

**Deprecated/outdated:** Do not assume any pre-16 Server Actions mental model (parallel dispatch,
separate revalidation round-trip) — per `AGENTS.md`'s explicit warning, this local Next.js differs
from training data and the docs were read directly from
`node_modules/next/dist/docs/01-app/02-guides/server-actions.md` for this research.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Option 1 ("self-contained attempt snapshot in `Attempt.answers` JSON") is the recommended resolution to the versioning gap, over a new `AssessmentPublication` freeze table | Architecture Patterns → "The versioning gap" | If the planner instead needs full-payload freeze consistency with Course/Programme (e.g., for a future Phase 11 audit requirement), a larger schema migration would be needed later; low risk since option 1 doesn't foreclose option 2 (the JSON snapshot approach can coexist with a later freeze table) |
| A2 | `MULTI_CHOICE` scoring should default to exact-set-match (full marks or zero, no partial credit) absent an explicit user decision | Common Pitfalls §2 | If staff actually expect partial credit (common in real LMSs), this recommendation is wrong and would need a schema/UX change (e.g., per-option-marks) after the fact — should be confirmed with the user before implementation, not just assumed silently |
| A3 | D-06's batch-release should reuse `grades.manage` rather than requesting a new permission identifier | Summary, Don't Hand-Roll | Low risk — this is a direct reading of the closed-catalogue comment in `catalogue.ts`, not a training-data guess; if wrong, the fix is simply requesting the PRD §1.3 approval path before implementation |
| A4 | `feedbackBehaviour`'s intended meaning survives D-01 (quiz grades always auto-release) as "how much detail is shown," not "when release happens" | Anti-Patterns to Avoid | If wrong, `feedbackBehaviour` may be effectively dead code post-D-01 and the planner should confirm with the user whether to keep, repurpose, or remove reliance on it |

## Open Questions

1. **How is "learner attempts use the assigned version" (ASM-01 acceptance) actually enforced given
   `QuizQuestion`/`QuizOption` have no version stamp and there is no `AssessmentPublication` freeze
   table?**
   - What we know: `Assessment.version`/`Attempt.versionUsed`/`Submission.versionUsed` all already
     exist as plain int columns; `CoursePublication`/`ProgrammePublication` show the codebase's
     existing pattern for freezing a requirement tree, but Assessment has no equivalent table.
   - What's unclear: whether the CONTEXT.md session's silence on this means it was considered
     out-of-scope-for-discussion (i.e., assumed to be a planning-time implementation detail) or
     genuinely missed.
   - Recommendation: resolve before Wave 1 of planning — see "The versioning gap" section above for
     the recommended default (option 1, JSON snapshot in `Attempt.answers`), but confirm with the
     user whether `passMark`/`totalMarks` freezing is also required.

2. **`MULTI_CHOICE` question scoring rule — exact match or partial credit?**
   - What we know: `QuestionType.MULTI_CHOICE` and `QuizOption.isCorrect` support multiple correct
     answers; `marks: Int` is per-question, not per-option.
   - What's unclear: whether the product intends partial credit for a partially-correct multi-select
     answer.
   - Recommendation: confirm with the user (this affects `quiz-scoring.ts`'s core logic and is
     genuinely a product decision, not an implementation detail) before writing the scoring function.

3. **Hard cutoff-date field for Assignments — `availableUntil` reused, or a new field?**
   (Carried from CONTEXT.md's Claude's Discretion, unresolved by this research.)
   - What we know: `Assessment.availableUntil: DateTime?` already exists and is generic across QUIZ
     and ASSIGNMENT; `dueAt` is separate and, per D-03, is informational-only (never blocks
     submission).
   - What's unclear: whether `availableUntil` is currently used anywhere as a hard submission cutoff
     for Assignments, or whether it's purely a "no longer listed/visible" gate (closer to Quiz
     `availableFrom`/`availableUntil`'s likely meaning: attempt-window, not submission-window).
   - Recommendation: `availableUntil` most likely already serves as the hard cutoff for BOTH types
     (its name and type are generic, and it predates this phase in the schema) — recommend
     confirming there is no separate `Assignment.cutoffAt` concept anywhere else in the codebase
     (grep found none) and using `availableUntil` as the (optional) hard block, keeping `dueAt` as
     the D-03 soft/informational marker. No new schema field needed under this reading.

4. **Quiz-attempt UX: one-question-per-page vs. single page; `IN_PROGRESS` → `ABANDONED`/`EXPIRED`
   trigger.** (Carried from CONTEXT.md's Claude's Discretion, unresolved by this research — genuinely
   a planning/UI-phase decision, not something further backend research would resolve.)
   - Recommendation: flag for `/gsd:ui-phase 10` per CONTEXT.md's own note on D-06; for the
     `ABANDONED`/`EXPIRED` transition, the simplest server-enforceable rule consistent with the rest
     of this codebase's "no scheduled sweep, reactive-only" completion-engine convention (DD-12) is:
     evaluate lazily on next read (an `IN_PROGRESS` Attempt read after `Assessment.availableUntil`
     has passed is treated as `EXPIRED` at read time, written on next touch) rather than a cron/sweep
     job — but this is a recommendation, not a locked finding.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (Docker) | Every service's real-Postgres integration tests | ✓ | `postgres:16-alpine`, container `learning-management-system-postgres-1`, healthy | — |
| MinIO (S3-compatible) | Submission presigned upload pipeline | ✓ | `minio/minio:latest`, container `learning-management-system-minio-1`, healthy | — |
| ClamAV | Submission file scan (mirrors `LessonResource`'s `scanStatus`/upload lifecycle) | ✓ | `clamav/clamav:stable`, container `learning-management-system-clamav-1`, healthy | — |
| Docker | Running the above | ✓ | client 29.6.2 | — |
| Node.js | Build/test runtime | ✓ | v22.14.0 | — |
| npm | Package management | ✓ | 10.9.2 | — |
| vitest | Test runner | ✓ | ^4.1.11 (installed) | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none — this environment (unlike the sandbox limitations
recorded against several prior phases in `STATE.md`, e.g. Phase 6/06-09's Docker-BLOCKED integration
tests) currently has Docker running with Postgres/MinIO/ClamAV all healthy. Real-Postgres integration
tests for this phase should be runnable end-to-end in this environment, not deferred as a human-only
verification step the way several Phase 6 integration tests were.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.11 |
| Config file | `vitest.config.ts` (repo root — confirm exact path at plan time; not re-verified in this pass beyond `package.json`'s `"test": "vitest run --no-file-parallelism"` script) |
| Quick run command | `npx vitest run tests/quiz-scoring.test.ts tests/assessment-service.test.ts` (per-module, add files as they're written) |
| Full suite command | `npm test` (`vitest run --no-file-parallelism`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASM-01 | Draft validation catches incomplete questions; publish bumps version | unit | `npx vitest run tests/assessment-service.test.ts` | ❌ Wave 0 |
| ASM-02 | Objective scoring is reproducible per QuestionType, including the MULTI_CHOICE rule (Open Question 2) | unit | `npx vitest run tests/quiz-scoring.test.ts` | ❌ Wave 0 |
| ASM-02 | Attempt evidence (start/submit time, answers snapshot, version, result, status) persisted correctly | integration (real Postgres) | `npx vitest run tests/attempt-service.integration.test.ts` | ❌ Wave 0 |
| ASM-03 | Published Assignment constraints (file types/size) enforced server-side, not just client-side | unit | `npx vitest run tests/assessment-service.test.ts` | ❌ Wave 0 |
| ASM-04 | Failed upload never shows false success; receipt only durable after verified promote | integration (real Postgres + MinIO) | `npx vitest run tests/submission-service.integration.test.ts` | ❌ Wave 0 |
| ASM-05 | Grader sees only in-scope (Cohort) submissions; draft invisible to learner; release explicit | integration (real Postgres) | `npx vitest run tests/grading-service.integration.test.ts` | ❌ Wave 0 |
| ASM-05 | D-06 batch-release: one transaction, skips already-released, one audit/event per row | unit + integration | `npx vitest run tests/grading-service.test.ts` | ❌ Wave 0 |
| ASM-06 | Override rejected on DRAFT grade (D-07); mandatory reason; before/after preserved | unit | `npx vitest run tests/grade-override-service.test.ts` | ❌ Wave 0 |
| ASM-07 | Learner read path returns only RELEASED grades/feedback, never DRAFT | integration (real Postgres) | `npx vitest run tests/learner-results.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant unit test file for the module just touched.
- **Per wave merge:** full suite (`npm test`) — real-Postgres integration tests are runnable in this
  environment (Docker healthy, see Environment Availability), so they should be included in the
  wave-merge gate, not deferred to human-only UAT the way several Phase 6 integration tests were.
- **Phase gate:** full suite green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/quiz-scoring.test.ts` — covers ASM-02, including the resolved MULTI_CHOICE rule (Open
  Question 2)
- [ ] `tests/assessment-service.test.ts` — covers ASM-01, ASM-03
- [ ] `tests/attempt-service.integration.test.ts` — covers ASM-02's persisted-evidence requirement,
  and the versioning-snapshot resolution (Open Question 1)
- [ ] `tests/submission-service.integration.test.ts` — covers ASM-04, extends the MinIO fixture
  pattern the existing LessonResource integration tests already use
- [ ] `tests/grading-service.integration.test.ts` — covers ASM-05, including D-05's Cohort-scope
  denial case and D-06's batch-release transaction
- [ ] `tests/grade-override-service.test.ts` — covers ASM-06, including D-07's DRAFT-rejection case
- [ ] `tests/learner-results.integration.test.ts` — covers ASM-07's RELEASED-only filter
- [ ] Prisma migration for `Assessment.attemptGradingMethod` (D-02) — no framework install needed,
  `npx prisma migrate dev` per the existing `db:migrate` script

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No (reuses existing session auth) | — |
| V3 Session Management | No (reuses existing session auth) | — |
| V4 Access Control | Yes | `withPermission` choke point for every staff action (`assessments.create/edit`, `grades.manage`); own-enrolment ownership comparison for every learner action; deny-by-default `{}` scope on any missing-row resolver (mirrors `cohort-scope.ts`'s existing pattern) |
| V5 Input Validation | Yes | `zod` for server action input shapes; server-side re-validation of `allowedFileTypes`/`maxFileSizeBytes` on Submission upload (never trust client-declared MIME/size alone — mirrors the existing `HeadObjectCommand` verify step) |
| V6 Cryptography | No new surface (S3 presigning already handled by `@aws-sdk/s3-request-presigner`, never hand-rolled) | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Client-supplied score/passed on Attempt submit | Tampering | Server always recomputes from the snapshotted question set (Pitfall 1); never accept a score field in the submit input type |
| Learner reads another enrolment's Grade/Attempt/Submission by guessing an id | Information Disclosure | Own-enrolment ownership check derives the enrolment from `actor.userId`, never accepts a caller-supplied enrolmentId (same T-05-06 class threat `cohort-scope.ts` documents) |
| Grader with a COHORT grant for Cohort A reads/grades a submission in Cohort B | Elevation of Privilege | `enrolmentCohortScope` resolves the REAL owning cohort from the row, never a caller-asserted cohortId — reused unmodified from the existing precedent |
| Staged Submission upload URL leaked/reused to overwrite a different learner's file | Tampering | Staged key includes `randomUUID()` and is never the final key; promote is a server-side copy the browser cannot trigger directly, mirroring the existing LessonResource pipeline's threat model |
| GradeOverride bypass — editing a RELEASED grade directly instead of going through the mandatory-reason override path | Repudiation | `grade-override-service.ts` must be the ONLY write path capable of changing a RELEASED grade's score; `grading-service.ts`'s ordinary draft-save path must assert `status !== "RELEASED"` before accepting a plain edit |

## Sources

### Primary (HIGH confidence — read directly in this session)
- `prisma/schema.prisma` (lines 41–119, 457, 499–612, 641–683, 1044–1213) — full Assessment/
  QuizQuestion/QuizOption/Attempt/Submission/Grade/GradeOverride schema, PublicationStatus,
  CoursePublication/ProgrammePublication, Lesson.assessmentId
- `src/server/permissions/catalogue.ts` — the full closed permission list (54–57) and its
  "additions require PRD §1.3 approval" header comment
- `src/server/permissions/with-permission.ts` — the single authorization choke point's usage shape
- `src/server/services/resource-service.ts` — `createResourceService` factory, full read
- `src/server/services/readiness-service.ts` — pure-evaluator/`NOT_YET_CHECKED` third-state pattern,
  full read, including the existing `assessments`/Phase-10-deferred readiness item (lines 180–191)
- `src/server/services/cohort-scope.ts` — `createCohortScopeResolvers`, full read
- `src/server/services/completion-service.ts` — audit-first/DomainEvent-emitting service shape, full
  read
- `src/server/services/storage-service.ts` — presigned-URL pipeline, full read
- `src/server/services/lesson-resource-service.ts` — intent/complete two-step upload pattern (grep +
  targeted reads)
- `src/server/services/domain-event-service.ts` — closed `DomainEventType` union, outbox semantics
  (lines 1–70)
- `src/server/services/publication.ts` — `CourseObligationPayload` freeze pattern (lines 1–100),
  contrasted against Assessment's lack of an equivalent table
- `src/server/services/lesson-progress-service.ts` — own-record ownership-comparison pattern (grep,
  header comment)
- `src/lib/upload-limits.ts` — `UPLOAD_LIMITS` table, confirmed QUIZ/ASSIGNMENT deliberately excluded
- `src/components/primitives/ConfirmModal.tsx` — full read of props/behavior; docstring explicitly
  names "grade overrides" as an intended consumer
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` — full read; sequential dispatch,
  single-response revalidation model, per `AGENTS.md`'s mandate to read live docs for this
  Next.js 16.3.4 install rather than trust training data
- `.planning/phases/10-assessment-quizzes-assignments-grading/10-CONTEXT.md` — full read, all locked
  decisions and discretion items
- `.planning/REQUIREMENTS.md`, `.planning/intel/requirements.md` (ASM-01…07 acceptance criteria) —
  full read
- `.planning/STATE.md`, `.planning/ROADMAP.md` (Phase 10 section) — full read
- `prisma/migrations/` directory listing — confirmed `YYYYMMDDHHMMSS_description` naming convention
- Live `docker ps` in this session — confirmed Postgres/MinIO/ClamAV containers healthy in this
  environment

### Secondary (MEDIUM confidence)
- None — every finding in this research was verified directly against the live codebase, live
  Next.js docs, or the CONTEXT.md session record; no WebSearch was needed since this phase adds no
  new external dependency and every architectural question resolves against in-repo precedent.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every dependency confirmed installed in `package.json`
- Architecture (reused patterns — resource-service, cohort-scope, storage-service, audit-first,
  ownership-comparison): HIGH — all read directly from the live codebase
- Architecture (versioning-snapshot mechanism, MULTI_CHOICE scoring rule): MEDIUM — no existing
  precedent in this codebase covers either question; recommendations given are reasoned defaults,
  not verified facts, and are flagged as Open Questions / Assumptions for user confirmation
- Pitfalls: HIGH — each pitfall is grounded in either a locked CONTEXT.md decision (D-01, D-04, D-07)
  or a directly-observed existing pattern (`completeLessonResourceUpload`'s verify-before-write)
- Next.js 16 behavior: HIGH — read directly from the installed package's own docs, per AGENTS.md's
  mandate

**Research date:** 2026-09-15
**Valid until:** 30 days (stable, in-repo-grounded findings; re-check sooner only if
`node_modules/next` is upgraded or the schema changes before planning starts)
