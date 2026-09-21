# Phase 10: Assessment — Quizzes, Assignments & Grading - Pattern Map

**Mapped:** 2026-09-15
**Files analyzed:** 23 (7 new services, 2 modified services, 1 migration, ~6 UI files, 7 test files)
**Analogs found:** 20 / 23 (3 no-analog, flagged below)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/services/assessment-service.ts` | service | CRUD | `src/server/services/course-service.ts` | exact (same `createResourceService` shape) |
| `src/server/services/quiz-scoring.ts` | utility | transform | `src/server/services/completion-engine.ts` | exact (pure evaluator, no data-access import) |
| `src/server/services/attempt-service.ts` | service | event-driven (state machine) | `src/server/services/lesson-progress-service.ts` | exact (ownership-scoped writes, audit+DomainEvent) |
| `src/server/services/submission-service.ts` | service | file-I/O | `src/server/services/lesson-resource-service.ts` | exact (intent/complete two-step upload) |
| `src/server/services/grading-service.ts` | service | CRUD + batch | `src/server/services/lesson-progress-service.ts` (override) + `resource-service.ts` (audit shape) | role-match (batch-release is net-new, no exact precedent) |
| `src/server/services/grade-override-service.ts` | service | request-response | `src/server/services/lesson-progress-service.ts`'s `overrideLessonProgress` | exact (mandatory-reason, RELEASED-only gate) |
| `src/server/services/assessment-scope.ts` | utility (scope resolver) | transform | `src/server/services/cohort-scope.ts` | exact (one-hop id→ResourceScope resolver) |
| `src/server/services/domain-event-service.ts` (MODIFY) | config | event-driven | itself | exact (extend closed `DomainEventType` union) |
| `src/server/services/storage-service.ts` (MODIFY) | utility | file-I/O | itself | exact (extend with Submission key builders) |
| `src/server/services/enrolment-dashboard-service.ts` (MODIFY) | service | CRUD (read) | itself | exact (fill `assessmentObligations` deferred slot) |
| `prisma/migrations/<ts>_add_attempt_grading_method/` | migration | batch | `prisma/migrations/20260914190348_learner_access_window_and_watch_progress/` | exact (single-column additive migration) |
| `src/app/staff/assessments/AssessmentsTable.tsx` | component | request-response | `src/app/staff/courses/CoursesTable.tsx` | exact (ResourceTable staff listing) |
| `src/app/staff/assessments/AssessmentForm.tsx` | component | request-response | `src/app/staff/courses/CourseForm.tsx` | exact (ResourceForm authoring) |
| `src/app/staff/grading/GradingQueueTable.tsx` | component | CRUD + batch | `src/app/staff/courses/CoursesTable.tsx` (bulk-select shape, though its handlers are empty) | role-match — first REAL bulk action, D-06 |
| `src/app/staff/grading/GradeOverrideModal.tsx` | component | request-response | `src/components/primitives/ConfirmModal.tsx` (+ `src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx`) | exact |
| `src/app/(learner)/assessments/[id]/attempt/AttemptClient.tsx` | component | event-driven (client state machine) | none close | no analog — see below |
| `src/app/(learner)/assessments/[id]/results/page.tsx` | component (Server Component) | request-response (SSR read) | `src/app/staff/cohorts/[id]/learners/[enrolmentId]/page.tsx` (ownership-scoped detail read) | partial |
| `tests/quiz-scoring.test.ts` | test | transform | `tests/completion-engine.test.ts` | exact |
| `tests/assessment-service.test.ts` | test | CRUD | `tests/course-service.test.ts` | exact |
| `tests/attempt-service.integration.test.ts` | test | event-driven | `tests/lesson-progress-service.test.ts` | role-match |
| `tests/submission-service.integration.test.ts` | test | file-I/O | `tests/lesson-resource-service.test.ts` | exact |
| `tests/grading-service.integration.test.ts` | test | CRUD + batch | `tests/attendance-service.integration.test.ts` | role-match |
| `tests/grade-override-service.test.ts` | test | request-response | `tests/lesson-progress-service.test.ts` (`overrideLessonProgress` cases) | exact |
| `tests/learner-results.integration.test.ts` | test | request-response | `tests/checkout-service.test.ts` (`getOwnOrder` ownership cases) | role-match |

## Pattern Assignments

### `src/server/services/assessment-service.ts` (service, CRUD)

**Analog:** `src/server/services/course-service.ts` (full file, 45 lines, read directly)

**Full reference pattern** — Assessment's own CRUD/archive genuinely matches `createResourceService`'s shape (`Assessment.status` is `PublicationStatus`, same as Course):
```typescript
// Source: src/server/services/course-service.ts, lines 1-45
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import { recordAudit } from "@/server/services/audit-service";
import { createResourceService, type Delegate } from "./resource-service";

type CourseRecord = { id: string };

export function courseScope(id: string): ResourceScope {
  return { courseIds: [id] };
}

export const courseService = createResourceService<CourseRecord>({
  name: "Course",
  delegate: prisma.course as unknown as Delegate<CourseRecord>,
  permissions: { view: "courses.view", create: "courses.create", edit: "courses.edit" },
  toScope: courseScope,
  withPermission,
  audit: (entry) => recordAudit({ actorId: entry.actorId, action: entry.action,
    targetType: entry.targetType, targetId: entry.targetId, before: entry.before,
    after: entry.after, reason: entry.reason, outcome: entry.outcome }),
});
```

**Phase 10 equivalent:** `assessmentCourseScope(assessmentId)` (see `assessment-scope.ts` below) replaces `courseScope`; permissions become `{ view: "assessments.create" /* no assessments.view — RESEARCH confirms this gap; use "courses.view" for read, "assessments.create"/"assessments.edit" for write */ }` — **flag for planner**: no `assessments.view` exists in the closed catalogue, so `list`/`get` must be gated on `courses.view` instead (staff who can see the course can see its assessments), while `create`/`update`/`archive` use `assessments.create`/`assessments.edit`. `QuizQuestion`/`QuizOption` nested writes happen inside `assessment-service.ts`'s own `create`/`update` (bespoke wrapper around the factory, since the factory's plain `Delegate<T>` doesn't compose nested writes) — do NOT force the whole authoring flow through `createResourceService` unmodified; wrap it, following `lesson-resource-service.ts`'s precedent of building bespoke functions alongside a factory-built base service in the same file.

**Draft-validation pattern** (pure-evaluator, third-state shape) — copy directly for ASM-01's draft validation:
```typescript
// Source: src/server/services/readiness-service.ts, lines 14-40, 100-194
export type ReadinessState = "PASS" | "FAIL" | "WARN" | "NOT_YET_CHECKED";
export type ReadinessItem = {
  id: string; category: string; label: string; state: ReadinessState;
  detail?: string; blocking: boolean;
};
// One pure function, called from the authoring panel AND the server-side
// publish refusal — never two copies. `evaluateAssessmentDraftReadiness`
// should follow this exact shape.
```

---

### `src/server/services/quiz-scoring.ts` (utility, transform — PURE)

**Analog:** `src/server/services/completion-engine.ts` (lines 1-90, read directly)

**Purity contract to copy verbatim:**
```typescript
// Source: src/server/services/completion-engine.ts, lines 1-9, 27-28
/**
 * PURE MODULE — no runtime imports at all. `import type` only ... a
 * type-only import does not enter the runtime closure `tests/boundary.test.ts`
 * walks, so this module stays off the worker import closure.
 */
import type { CompletionRuleV1 } from "./completion-rule";
import type { AttendanceComponent } from "./attendance-component";
```
`quiz-scoring.ts` must have ZERO runtime imports — no `@prisma/client`, no `withPermission`. It receives the snapshotted question/option data and the learner's raw selections as plain arguments and returns `{ score, maxScore, passed }`.

**MULTI_CHOICE partial-credit formula** (D-09, locked): `M × max(0, (S − W) / C)` where `M` = question marks, `C` = total correct options, `S` = correct options selected, `W` = incorrect options selected. No existing codebase precedent for this exact formula — write it fresh inside `quiz-scoring.ts`, but structure the module the same way `completion-engine.ts` builds one `CompletionVerdictItem` per rule component (here: one score-computation function per `QuestionType` — `SINGLE_CHOICE`, `MULTI_CHOICE`, `TRUE_FALSE`).

**Never-trust-client-score pattern** (Pitfall 1, RESEARCH): the submit input type must carry ONLY the learner's raw option-id selections per question — never `score`, `maxScore`, or `passed` fields.

---

### `src/server/services/attempt-service.ts` (service, event-driven state machine)

**Analog:** `src/server/services/lesson-progress-service.ts` (full file, 805 lines, read directly — sections below)

**Ownership-check pattern** (start/answer/submit an Attempt — NOT RBAC):
```typescript
// Source: src/server/services/lesson-progress-service.ts, lines 6-21 (DD-15 header)
/**
 * DD-15 — EXACTLY ONE `withPermission`-WRAPPED EXPORT IN THIS FILE.
 * markLessonComplete/undoLessonComplete/recordWatchProgress are
 * ownership-scoped ... authorization here is an ownership comparison, not a
 * permission check, and they MUST NOT be wrapped in `withPermission`.
 */
```
`attempt-service.ts`'s `startAttempt`/`answerQuestion`/`submitAttempt`/`getOwnAttempt` must follow this same discipline: derive the enrolment from `actor.userId` (own-record ownership, like `loadLearnerPath`), never accept a caller-supplied `enrolmentId`.

**Typed refusal class pattern** — copy this shape for Attempt-specific refusals (attempt limit reached, assessment not available, already submitted):
```typescript
// Source: src/server/services/lesson-progress-service.ts, lines 93-120
export class LessonNotOpenableError extends Error {
  readonly enrolmentId: string;
  readonly lessonId: string;
  readonly reason: "not-found" | "locked" | "access-window-closed";
  constructor(enrolmentId: string, lessonId: string, reason: "not-found" | "locked" | "access-window-closed") {
    super(LessonNotOpenableError.messageFor(reason));
    this.name = "LessonNotOpenableError";
    this.enrolmentId = enrolmentId;
    this.lessonId = lessonId;
    this.reason = reason;
  }
  private static messageFor(reason) { /* switch → user-facing message per reason */ }
}
```

**Write shape — tx, audit, DomainEvent together** (submit path, mirrors `markLessonComplete`):
```typescript
// Source: src/server/services/lesson-progress-service.ts, lines 366-413
await deps.runInTransaction(async (tx) => {
  // ... write the row ...
  await deps.writeEvent(tx, { type: "lesson.completed", payload: {...}, occurredAt: nowValue });
});
await deps.audit({ action: "lessonprogress.marked", targetType: "Enrolment", targetId: args.enrolmentId,
  actorId: actor.userId, outcome: "SUCCESS", reason: null, before: {...}, after: {...} });
```
`submitAttempt` applies this exact shape: inside one `tx`, snapshot-score via `quiz-scoring.ts`, write the `Attempt` row (`status: SUBMITTED`), auto-create the `Grade` row already `RELEASED` (D-01), `writeDomainEvent(tx, { type: "attempt.submitted" | "grade.released", ... })`, THEN `audit()` outside the tx with `actorId: actor.userId` (the learner's own submit action IS the trigger — Pitfall 4: never skip the audit trail because "nobody clicked release").

**Versioning snapshot (Open Question 1, RESOLVED default = option 1):** at `startAttempt`, snapshot the live `QuizQuestion`/`QuizOption` set (id, prompt, marks, options, `isCorrect`) into `Attempt.answers` JSON alongside `{ questionSnapshot, responses }`. All scoring/review reads ONLY this JSON, never the live tables.

---

### `src/server/services/submission-service.ts` (service, file-I/O)

**Analog:** `src/server/services/lesson-resource-service.ts` (full file, 443 lines, read directly) + `src/server/services/storage-service.ts` (full file, 193 lines, read directly)

**Intent/complete two-step upload — copy this shape exactly**, swapping the ownership predicate (own-enrolment, not staff `courses.edit`):
```typescript
// Source: src/server/services/lesson-resource-service.ts, lines 179-259
// completeLessonResourceUpload: read `before`, guard status !== "UPLOADING",
// capture stagedKey BEFORE any write, then:
let stored;
try {
  stored = await storage.inspect(stagedKey);
} catch {
  await cleanupStaged();
  throw new ResourceUploadValidationError(UNVERIFIED_DETAIL, await failUpload(UNVERIFIED_DETAIL));
}
const contentType = before.mimeType.trim().toLowerCase();
if (stored.sizeBytes !== before.sizeBytes || stored.contentType !== contentType) {
  await cleanupStaged();
  throw new ResourceUploadValidationError(MISMATCH_DETAIL, await failUpload(MISMATCH_DETAIL));
}
const finalKey = storage.finalKey(stagedKey);
await storage.promote({ stagedKey, finalKey });
const after = await delegate.update({ where: { id: before.id },
  data: { storageKey: finalKey, uploadStatus: "READY", uploadedAt: now(), uploadDetail: null } });
// audit "lessonresource.upload_completed" ... then best-effort delete staged key
```
This is the exact ASM-04 "never false success" invariant (Pitfall 3) — `Submission.uploadStatus` mirrors `UploadStatus` (`UPLOADING`/`READY`/`ERROR`) verbatim per the schema comment.

**Key-builder pattern to extend (NOT reuse verbatim)** — `storage-service.ts` needs new Submission-scoped functions alongside the existing Lesson-scoped ones:
```typescript
// Source: src/server/services/storage-service.ts, lines 72-95
export function buildStorageKey({ lessonId }: { lessonId: string }): string {
  return `lessons/${lessonId}/${randomUUID()}`;
}
export function buildStagedStorageKey({ lessonId }: { lessonId: string }): string {
  return `lesson-uploads/${lessonId}/${randomUUID()}`;
}
export function finalStorageKeyFor(stagedKey: string): string {
  if (!stagedKey.startsWith("lesson-uploads/")) throw new Error(...);
  return stagedKey.replace(/^lesson-uploads\//, "lessons/");
}
// New, parallel functions needed:
//   buildSubmissionStorageKey({ enrolmentId, assessmentId }) → `submissions/${enrolmentId}/${assessmentId}/${randomUUID()}`
//   buildStagedSubmissionStorageKey(...) → `submission-uploads/${enrolmentId}/${assessmentId}/${randomUUID()}`
//   finalSubmissionKeyFor(staged) — same prefix-check-then-replace shape, `submission-uploads/` → `submissions/`
```
Reuse `inspectLessonObject`/`promoteLessonObject`/`deleteLessonObject`/`presignLessonUploadUrl` UNMODIFIED (they take a `key` string, no Lesson-specific logic inside) — only the key BUILDERS need Submission-scoped siblings.

**D-04 resubmission — new row, never overwrite:** `Submission`'s `@@unique([assessmentId, enrolmentId, attemptNumber])` means resubmission is `create` with `attemptNumber: previous + 1`, never `update` on the existing row — same "no hard deletes, always a new row" discipline `lesson-progress-service.ts`'s `undoLessonComplete` documents for its own domain (there, delete is fine because there's no history requirement; here, D-04 explicitly requires preserving every attempt).

---

### `src/server/services/grading-service.ts` (service, CRUD + batch)

**Analog (single-release + draft-save):** `src/server/services/lesson-progress-service.ts`'s `overrideLessonProgress` shape (mandatory audit, staff actor, `ctx.actor.userId`) — see Grade Override section below for the closely related override.

**Analog (Cohort-scoped listing):** `src/server/services/cohort-scope.ts`'s `enrolmentCohortScope` — reused AS-IS, no new resolver code:
```typescript
// Source: src/server/services/cohort-scope.ts, lines 151-160
async function enrolmentCohortScope(enrolmentId: string): Promise<ResourceScope> {
  const row = await deps.enrolment.findUnique({ where: { id: enrolmentId }, select: { cohortId: true } });
  if (!row) return {};
  return cohortResourceScope(row.cohortId);
}
```
Every `withPermission("grades.manage", (input) => enrolmentCohortScope(submission.enrolmentId))`-style gate on a grading action reuses this import directly — `grading-service.ts` does NOT need its own Cohort resolver.

**Batch-release (D-06) — NO existing precedent; this is new code.** RESEARCH's own worked example (grounded in `resource-service.ts`'s audit shape + `domain-event-service.ts`'s outbox, and Next.js 16.3.4's sequential-dispatch constraint):
```typescript
// Source: 10-RESEARCH.md "Pattern 4: Batch actions must be ONE server-side transaction"
export const releaseGradesBatch = withPermission<{ gradeIds: string[] }>(
  "grades.manage",
  async (input) => { /* resolve to the COMMON cohort scope of every gradeId */ },
)(async (input, ctx) => {
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const id of input.gradeIds) {
      const before = await tx.grade.findUnique({ where: { id } });
      if (before?.status !== "DRAFT") continue; // skip already-released
      const after = await tx.grade.update({ where: { id }, data: { status: "RELEASED",
        releasedById: ctx.actor.userId, releasedAt: new Date() } });
      await writeDomainEvent(tx, { type: "grade.released", payload: { gradeId: id }, occurredAt: new Date() });
      results.push(after);
    }
    return results;
  });
});
```
**Why this must be one action, not N client calls:** Next.js 16.3.4 dispatches Server Actions sequentially per client (confirmed by RESEARCH reading `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` directly per `AGENTS.md`'s mandate) — N separate release calls serialize AND fragment the audit/DomainEvent trail into N entries for what the user experienced as one action.

**D-07 guard — DRAFT-only plain edit, RELEASED routes to override:** `grading-service.ts`'s ordinary draft-save `update` path must assert `status !== "RELEASED"` before accepting a plain edit (mirrors `grade-override-service.ts`'s inverse assertion below) — this is the "GradeOverride bypass" threat RESEARCH's Security Domain table names explicitly.

---

### `src/server/services/grade-override-service.ts` (service, request-response)

**Analog:** `src/server/services/lesson-progress-service.ts`'s `overrideLessonProgress` (full function, lines 661-737, read directly)

**Mandatory-reason, staff-actor, before/after audit shape — copy directly:**
```typescript
// Source: src/server/services/lesson-progress-service.ts, lines 661-737
const overrideLessonProgress = withPermission<{
  enrolmentId: string; lessonId: string; complete: boolean; reason: string;
}>("enrolments.manage", (input) => deps.enrolmentScope(input.enrolmentId))(
  async (input, ctx) => {
    const reason = trimReason(input.reason);
    if (!reason) throw new OverrideReasonRequiredError(input.enrolmentId, input.lessonId);
    // ... read before, write after inside tx ...
    await deps.audit({
      action: "lessonprogress.overridden", targetType: "Enrolment", targetId: input.enrolmentId,
      actorId: ctx.actor.userId, outcome: "SUCCESS", reason,
      before: {...}, after: {...},
    });
    return {...};
  },
);
```
`gradeOverride`'s entry function replaces the permission with `"grades.manage"` and the scope resolver with `enrolmentCohortScope(grade.enrolmentId)`. The **D-07 RELEASED-only gate** is the one structural addition with no analog anywhere else in the codebase — add an explicit assertion before accepting the override:
```typescript
if (grade.status !== "RELEASED") {
  throw new GradeNotReleasedError(gradeId); // new error class, same shape as OverrideReasonRequiredError
}
```
`GradeOverride.previousScore`/`newScore`/`reason`/`actorId`/`createdAt` already match this pattern's `before`/`after`/`reason`/`actorId` audit shape 1:1 — no schema gap here (RESEARCH confirms this directly).

---

### `src/server/services/assessment-scope.ts` (utility, scope resolver)

**Analog:** `src/server/services/cohort-scope.ts` (full file, 201 lines, read directly)

**New resolver, structurally identical to the existing per-id-lookup resolvers:**
```typescript
// Source: src/server/services/cohort-scope.ts, lines 140-160 (sessionCohortScope /
// enrolmentCohortScope — the exact one-hop shape to copy)
async function sessionCohortScope(sessionId: string): Promise<ResourceScope> {
  const row = await deps.session.findUnique({ where: { id: sessionId }, select: { cohortId: true } });
  if (!row) return {}; // deny-by-default on a missing row
  return cohortResourceScope(row.cohortId);
}

// Phase 10's new resolver, same shape, reading Assessment.courseId instead:
async function assessmentCourseScope(assessmentId: string): Promise<ResourceScope> {
  const row = await deps.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } });
  if (!row) return {};
  return { courseIds: [row.courseId] };
}
```
**Deny-by-default on missing row** (`return {}`) is load-bearing — copy verbatim, do not special-case a missing Assessment into a wider scope. Do NOT import the permission choke point here (`cohort-scope.ts`'s header: "must not take a value import from the permissions layer... only the `ResourceScope` type").

---

### `src/server/services/domain-event-service.ts` (MODIFY — extend closed union)

**Pattern:** add new members to the closed `DomainEventType` union, following the exact comment-annotated style already used for each phase's additions:
```typescript
// Source: src/server/services/domain-event-service.ts, lines 31-70
export type DomainEventType =
  | "enrolment.created"
  // ... existing members ...
  | "lesson.completed"
  | "course.completed"
  | "programme.completed";
  // Phase 10 additions needed (append, do not reorder existing members):
  //   | "attempt.submitted"
  //   | "grade.released"       (both D-01 auto-release AND D-06 batch/single staff release)
  //   | "grade.overridden"     (ASM-06 / D-07)
  //   | "submission.created"   (ASM-04 receipt)
```
Nothing else in this file changes — `writeDomainEvent`/`buildDomainEventRow` are generic and already redact payloads via `redactForAudit`.

---

## Shared Patterns

### Authorization choke point (`withPermission`)
**Source:** `src/server/permissions/with-permission.ts`, lines 1-50
**Apply to:** every staff-facing action in `assessment-service.ts`, `grading-service.ts`, `grade-override-service.ts`.
```typescript
export const publishCourse = withPermission(
  "courses.publish",
  async (input: { courseId: string }) => ({ courseIds: [input.courseId] }),
)(async (input, ctx) => {
  // ctx.actor is authenticated, ctx.resource is the matched scope
});
```
**Note the gap:** the closed catalogue (`src/server/permissions/catalogue.ts`, lines 53-57) has `assessments.create`, `assessments.edit`, `submissions.view`, `grades.manage` but **no `assessments.view`** — confirmed directly. Read paths on Assessment must gate on `courses.view` instead; do not propose a new identifier (RESEARCH: catalogue additions require PRD §1.3 approval, out of scope).

### Ownership comparison (not RBAC) for learner self-service
**Source:** `src/server/services/lesson-progress-service.ts` header (DD-15) + `src/server/services/checkout-service.ts`'s `getOwnOrder` (lines 550-555)
**Apply to:** every learner-facing action — `startAttempt`, `answerQuestion`, `submitAttempt`, presign/complete Submission upload, `getOwnResults`.
```typescript
// Source: src/server/services/checkout-service.ts, lines 550-555
async function getOwnOrder(actor: Actor, orderId: string): Promise<OrderSnapshot | null> {
  const order = await deps.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== actor.userId) return null;
  const { userId: _userId, ...snapshot } = order;
  return snapshot;
}
```
These functions MUST NOT be wrapped in `withPermission` — same file-level discipline `lesson-progress-service.ts`'s DD-15 documents (a `withPermission`-wrapped export pulls the whole permission choke point into the module's import closure).

### Audit-first write shape
**Source:** `src/server/services/resource-service.ts`, lines 210-247
**Apply to:** every mutation in every new service this phase adds.
```typescript
const create = withPermission<Record<string, unknown>>(permissions.create, () => ({}))(
  async (data, ctx) => {
    const created = await delegate.create({ data });
    await audit({ action: `${slug}.created`, targetType: name, targetId: created.id,
      actorId: ctx.actor.userId, outcome: "SUCCESS", reason: null, after: created });
    return created;
  },
);
```

### DomainEvent outbox — write inside the same transaction as the mutation
**Source:** `src/server/services/domain-event-service.ts`, lines 106-117
**Apply to:** `attempt.submitted`, `grade.released`, `grade.overridden`, `submission.created`.
```typescript
export async function writeDomainEvent(tx: DomainEventTxClient, event: DomainEventInput): Promise<void> {
  await tx.domainEvent.create({ data: buildDomainEventRow(event) });
}
```
Always called with the CALLER's `tx` — never opens its own transaction — so the outbox row commits atomically with the state change that produced it.

### Confirm/reason capture UI
**Source:** `src/components/primitives/ConfirmModal.tsx`, full file (223 lines) — docstring explicitly names "grade overrides" as an intended consumer (line 9).
**Apply to:** D-07's mandatory-reason override UI, D-06's batch-release confirmation (no `minReasonLength` needed for batch-release since D-06 has no mandatory-reason requirement — only override does).
```typescript
export type ConfirmModalProps = {
  open: boolean; eyebrow?: string; title: string; description: ReactNode;
  confirmLabel: string; tone?: "danger" | "default";
  minReasonLength?: number; reasonLabel?: string; pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void | Promise<void>;
  onCancel: () => void;
};
```

### Bulk-select table UI (D-06 — first REAL implementation)
**Source:** `src/app/staff/courses/CoursesTable.tsx`, lines 176-185 (the EXISTING but non-functional precedent)
```typescript
selection={{
  selectedIds, onChange: setSelectedIds,
  actions: [
    { label: "Publish", onClick: () => {}, disabled: true, description: UNAVAILABLE },
    { label: "Archive…", onClick: () => {}, disabled: true, description: UNAVAILABLE },
  ],
}}
```
`GradingQueueTable.tsx` copies this `selection` prop shape from `ResourceTable` but must WIRE `onClick` to a real server action (calling `releaseGradesBatch`) rather than leaving it `disabled: true` — CONTEXT.md D-06 explicitly flags this as the first working instance of the pattern.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/app/(learner)/assessments/[id]/attempt/AttemptClient.tsx` | component | event-driven (client-side quiz state) | No existing client component manages a multi-step, timed, answer-accumulating interaction; closest is `AttendanceMarkClient.tsx` (marks many rows in one form) but the domain shape (question-by-question navigation, submit-once semantics) has no precedent. CONTEXT.md/RESEARCH both flag one-question-per-page vs. single-page as Claude's Discretion / `/gsd:ui-phase 10` territory. |
| `quiz-scoring.ts`'s `MULTI_CHOICE` partial-credit formula | (logic within utility) | transform | D-09's `M × max(0, (S−W)/C)` formula is locked but has zero precedent anywhere in this codebase — write fresh, structured like `completion-engine.ts`'s per-component builder functions. |
| `src/app/staff/grading/GradingQueueTable.tsx`'s working batch-release wiring | component (interaction) | CRUD + batch | `CoursesTable.tsx`'s bulk actions are `disabled: true` stubs — there is no functioning "select N rows, confirm, one transaction" flow anywhere in the codebase to copy from. Use `ResourceTable`'s `selection` prop shape + `ConfirmModal` + the new `releaseGradesBatch` action (see Pattern Assignments above) as the closest composable building blocks. |

## Metadata

**Analog search scope:** `src/server/services/`, `src/server/permissions/`, `src/app/staff/`, `src/components/primitives/`, `tests/`, `prisma/schema.prisma`, `prisma/migrations/`
**Files scanned:** ~30 (service layer), 4 primitives, 8 staff-UI table/form components, 8 test files, full Assessment→GradeOverride schema block
**Pattern extraction date:** 2026-09-15
