# Phase 9: Learning Delivery & Progress Tracking - Pattern Map

**Mapped:** 2026-09-14
**Files analyzed:** 15 (new) + 3 (modified)
**Analogs found:** 17 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/services/completion-engine.ts` | utility (pure evaluator) | transform | `src/server/services/readiness-service.ts` + `src/server/services/attendance-component.ts` | exact |
| `src/server/services/lesson-sequencing.ts` | utility (pure evaluator) | transform | `src/server/services/readiness-service.ts` (`evaluateCourseReadiness`) | exact |
| `src/server/services/completion-service.ts` | service | CRUD + event-driven | `src/server/services/attendance-service.ts` (`writeOneRecord`/`recomputeComponent`) + `src/server/services/enrolment-transitions.ts` (`applyEnrolmentActivation`) | exact |
| `src/server/services/lesson-progress-service.ts` | service | CRUD | `src/server/services/attendance-service.ts` (correction/mandatory-reason pattern) + `src/server/services/checkout-service.ts` (ownership pattern) | exact |
| `src/server/services/enrolment-dashboard-service.ts` | service | request-response (aggregate read) | `src/server/services/checkout-service.ts` (`getOwnOrder`) + `src/server/services/roster-service.ts` (`DeferredColumn` aggregate row) | exact |
| `src/server/services/lesson-resource-service.ts` (MODIFIED — add learner predicate) | service | request-response | itself, existing `getDownloadableResource` (lines 297-308) | exact (extend in place) |
| `src/server/services/attendance-service.ts` (MODIFIED — add recalculation call site) | service | event-driven | itself, existing `writeOneRecord` (lines 362-410) | exact (extend in place) |
| `src/server/services/enrolment-transitions.ts` (referenced, not modified) | service | state-machine | n/a — reused verbatim (`assertTransition`) | exact |
| `src/server/services/domain-event-service.ts` (MODIFIED — extend union) | model/config (type union) | event-driven | itself, `DomainEventType` union (lines 31-58) | exact (additive extend) |
| `src/app/api/lesson-resources/[id]/download/route.ts` (MODIFIED — try learner path) | route | request-response | itself, existing handler | exact (extend in place) |
| `src/app/dashboard/page.tsx` | component (Server Component page) | request-response | `src/app/account/page.tsx` style (ownership-scoped SSR page) — see note | role-match |
| `src/app/learn/[enrolmentId]/page.tsx` | component (Server Component page) | request-response | `src/components/catalogue/LessonContent.tsx` consumer pages (staff `courses/[id]` detail pattern) | role-match |
| `src/app/learn/[enrolmentId]/lessons/[lessonId]/page.tsx` | component (Server Component page) | request-response | staff lesson preview page (wraps `LessonContent`) | exact |
| `src/app/learn/[enrolmentId]/lessons/[lessonId]/actions.ts` | route (Server Actions) | request-response | `src/app/(checkout)/checkout/[orderId]/actions.ts` (`payAction`) | exact |
| `src/app/learn/[enrolmentId]/sessions/page.tsx` | component (Server Component page) | request-response | Phase 5 staff `RosterTab`/session pages (server-computed visibility) | role-match |
| `prisma/schema.prisma` (MODIFIED — add `Cohort.accessDurationDays`) | model / migration | CRUD | `Cohort.holdMinutes` (nullable-duration precedent, same file, lines 753-757) | exact |
| Video watch-progress tracking storage (new column or table, Claude's discretion A3) | model | event-driven | `AttendanceRecord` (upsert-keyed-on-composite-unique shape) or `LessonProgress` itself | role-match |
| `tests/*.test.ts` for each new service | test | — | `tests/boundary.test.ts` (import-graph isolation conventions) + existing `*-service.test.ts` files per service | exact |

## Pattern Assignments

### `src/server/services/completion-engine.ts` (utility, transform)

**Analogs:** `src/server/services/readiness-service.ts` (full file), `src/server/services/attendance-component.ts` (full file)

**Header/doc-comment pattern to copy** (`attendance-component.ts` lines 1-19):
```typescript
/**
 * The attendance component (D-20, ATT-02).
 *
 * PURE MODULE — no imports at all. Same discipline as
 * `readiness-service.ts`: a data-access import here would put this module
 * on the worker import closure and break `tests/boundary.test.ts`.
 * ...
 */
```
Apply the identical "PURE MODULE — no imports at all" framing to `completion-engine.ts`'s header, naming `readiness-service.ts` and `attendance-component.ts` as the precedent, and stating explicitly that this module has zero `@prisma/client` / `@/server/*` imports.

**Third-state discipline** (`readiness-service.ts` lines 14-20):
```typescript
/**
 * `NOT_YET_CHECKED` is a THIRD state — neither a grey PASS nor a grey FAIL.
 * ...It is easy to erode this into a tick over time; it must not become one.
 */
export type ReadinessState = "PASS" | "FAIL" | "WARN" | "NOT_YET_CHECKED";
```
`completion-engine.ts` needs the equivalent discriminated-union discipline for `AttendanceComponent`-style inputs (`{ kind: "computed" }` vs `{ kind: "no-rule" }` vs `{ kind: "no-sessions" }`, `attendance-component.ts` lines 47-59) — never collapse a "no rule configured" case into a fake `satisfied: true`.

**Core evaluator shape to copy** (`attendance-component.ts` lines 71-102, `computeAttendanceComponent`):
```typescript
export function computeAttendanceComponent(
  input: AttendanceComponentInput,
): AttendanceComponent {
  if (input.thresholdPct === null) {
    return { kind: "no-rule" };
  }
  const countable = input.entries.filter(/* ... */);
  if (countable.length === 0) {
    return { kind: "no-sessions" };
  }
  // ... compute earnedPct, meetsThreshold
  return { kind: "computed", earnedPct, requiredPct, attendedCount, countableCount, meetsThreshold };
}
```
`evaluateCompletion(rule, evidence)` follows the exact same "guard clause per named-gap state, then compute" shape. Per D-10, it must produce a `CompletionVerdictItem[]` (not a single percentage) — one item per rule component (`required-lessons`, and `attendance` only when `attendanceThresholdPct` is set), mirroring `ReadinessItem[]`'s `{ id, label, state/satisfied, detail }` shape (`readiness-service.ts` lines 31-40).

**"One function, N call sites" framing** (`readiness-service.ts` lines 5-11) — reuse verbatim, renaming the three consumers to: the dashboard's progress panel, the lesson-progress-service's post-write recalculation, and attendance-service's post-correction recalculation.

### `src/server/services/lesson-sequencing.ts` (utility, transform)

**Analog:** `src/server/services/readiness-service.ts` — `evaluateCourseReadiness` (lines 100-194) for the "flatten, filter live rows, walk in order" shape.

**Concrete pattern already drafted in RESEARCH.md** (Pattern 2, `09-RESEARCH.md` lines 209-229) — copy this shape directly:
```typescript
export type SequencingLesson = { id: string; title: string; required: boolean; position: number; moduleId: string };
export type SequencingResult = { lessonId: string; locked: boolean; blockingLessonTitle: string | null };

export function evaluateLessonSequencing(
  courseLessons: SequencingLesson[],
  completedLessonIds: ReadonlySet<string>,
): SequencingResult[] {
  const ordered = [...courseLessons].sort((a, b) => a.position - b.position);
  let blockingTitle: string | null = null;
  return ordered.map((lesson) => {
    const result = { lessonId: lesson.id, locked: blockingTitle !== null, blockingLessonTitle: blockingTitle };
    if (lesson.required && !completedLessonIds.has(lesson.id)) {
      blockingTitle = lesson.title;
    }
    return result;
  });
}
```
This is D-04/D-05/D-06 exactly. Zero imports, same as `readiness-service.ts`. Must be called from both the lesson-list page and the lesson-reading page's access gate — never duplicated (`readiness-service.ts`'s own "One function, three call sites" rationale, lines 5-11).

### `src/server/services/completion-service.ts` (service, CRUD + event-driven)

**Analogs:** `src/server/services/attendance-service.ts` (`recomputeComponent`/`writeOneRecord`, lines 333-410) and `src/server/services/enrolment-transitions.ts` (`applyEnrolmentActivation`, lines 173-219)

**Recompute-inside-transaction pattern** (`attendance-service.ts` lines 333-354):
```typescript
async function recomputeComponent(
  tx: AttendanceTxClient,
  cohortId: string,
  enrolmentId: string,
): Promise<AttendanceComponent> {
  const [cohortRow, sessions, records] = await Promise.all([
    tx.cohort.findUnique({ where: { id: cohortId } }),
    tx.scheduledSession.findMany({ where: { cohortId } }),
    tx.attendanceRecord.findMany({ where: { enrolmentId } }),
  ]);
  // ... shape evidence, call the pure evaluator
  return computeAttendanceComponent({ /* ... */ });
}
```
`completion-service.ts`'s `recalculateCompletion(tx, enrolmentId)` follows this exact shape: read within `tx` (so it reflects the write that just happened in the same transaction), shape evidence, call `evaluateCompletion` (the pure engine), act on the verdict.

**Supersede-not-delete pattern (D-12)** — no direct code precedent exists for `CompletionRecord.supersededAt` yet (confirmed gap), but the identical semantic — "never destroy history, stamp a nullable timestamp column instead" — is `AttendanceRecord`'s correction fields (`attendance-service.ts` lines 381-385):
```typescript
const stamps = afterClose
  ? { correctedById: actorId, correctedAt: now(), correctionReason: reason }
  : { recordedById: actorId, recordedAt: now() };
```
Apply the same "never blank/delete the prior row, stamp a new field" discipline: on a fresh SATISFIED verdict, `create` a new `CompletionRecord`; on a verdict flipping to UNSATISFIED, `update` the existing open record's `supersededAt = now()` — never delete it.

**Status-transition pattern** (`enrolment-transitions.ts` lines 173-219, `applyEnrolmentActivation`):
```typescript
export async function applyEnrolmentActivation(
  tx: EnrolmentActivationTxClient,
  args: { enrolment: EnrolmentRow; reason: string; actorId: string | null; now: Date },
): Promise<{ id: string; before: EnrolmentStatusValue; claimedSeat: boolean }> {
  const before = e.status as EnrolmentStatusValue;
  assertTransition(before, "ACTIVE", e.id);
  // ... mutate, then:
  await writeDomainEvent(tx as unknown as DomainEventTxClient, {
    type: actorId === null ? "enrolment.activated" : "enrolment.approved",
    payload: { enrolmentId: e.id, cohortId: e.cohortId, claimedSeat: !heldSeat, actorId },
  });
  return { id: e.id, before, claimedSeat: !heldSeat };
}
```
Per RESEARCH.md Pitfall 5 / Assumption A1: when `completion-service.ts` newly satisfies a COURSE/PROGRAMME-scope rule for an `ACTIVE` enrolment, call `assertTransition("ACTIVE", "COMPLETED", enrolmentId)` (imported from `enrolment-transitions.ts`, never re-implemented) before writing `Enrolment.status = "COMPLETED"`, inside the same transaction as the `CompletionRecord` insert, then `writeDomainEvent` with a newly-added event type (e.g. `"course.completed"` / `"programme.completed"`).

**Domain-event emission pattern** (`attendance-service.ts` lines 395-407):
```typescript
await deps.writeEvent(tx, {
  type: "attendance.changed",
  payload: { sessionId: session.id, enrolmentId, cohortId: session.cohortId, before, after: state, correction: afterClose, component, actorId },
});
```
Copy this shape for `"lesson.completed"` / `"course.completed"` / `"programme.completed"` emissions — payload carries enough for Phase 13 to compose an email without a second query.

### `src/server/services/lesson-progress-service.ts` (service, CRUD)

**Analogs:** `src/server/services/checkout-service.ts` (ownership functions) + `src/server/services/attendance-service.ts` (mandatory-reason correction gate)

**Ownership-scoped read, "not mine = doesn't exist"** (`checkout-service.ts` lines 546-555):
```typescript
/**
 * "Not mine" and "does not exist" are the SAME answer — a guessed id
 * cannot be used to confirm another learner's order exists (T-06-13).
 */
async function getOwnOrder(actor: Actor, orderId: string): Promise<OrderSnapshot | null> {
  const order = await deps.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== actor.userId) return null;
  const { userId: _userId, ...snapshot } = order;
  return snapshot;
}
```
Copy this exact shape for `getOwnActiveEnrolment(actor, enrolmentId)` — already drafted concretely in `09-RESEARCH.md` lines 343-361 (includes the D-07 `status !== "ACTIVE"` fold-in). This file imports NO `withPermission` wrapper — confirm the same header framing as `checkout-service.ts` lines 6-15 / `profile-service.ts` lines 4-12 ("Authorization here is an ownership comparison, not a permission check — and that is the intended model, not a gap").

**Mandatory-reason correction gate (D-14, mirrors ATT-03)** (`attendance-service.ts` lines 301-318):
```typescript
function assertMarkAllowed(
  session: SessionRow,
  enrolmentId: string,
  state: AttendanceStateValue,
  reason: string | null,
  timing: Timing,
): void {
  if (timing.beforeStart && LIVE_STATES.has(state)) {
    throw new PreMarkingStateError(session.id, enrolmentId, state);
  }
  if (timing.afterClose && !reason) {
    throw new CorrectionReasonRequiredError(session.id, enrolmentId, timing.closesAt);
  }
}
```
For D-14 (staff override of `LessonProgress`), copy this "assert-before-write, pure function" pattern: a staff-actor path requires a non-empty `reason` (throw a new `OverrideReasonRequiredError` if missing); a learner's own self-undo (D-13/D-15) requires no reason at all — branch on `actorId === enrolment.userId` vs a staff actor, not on a client-supplied flag.

**Idempotent upsert treating "already exists" as success** (Pitfall 2, `09-RESEARCH.md` lines 307-313) — no direct line-numbered precedent exists yet for `LessonProgress`, but `attendance-service.ts`'s `writeOneRecord` upsert (lines 387-391) is the shape to copy:
```typescript
await tx.attendanceRecord.upsert({
  where: { sessionId_enrolmentId: { sessionId: session.id, enrolmentId } },
  create: { sessionId: session.id, enrolmentId, state, note, ...stamps },
  update: { state, note, ...stamps },
});
```
Apply identically to `LessonProgress`'s `@@unique([enrolmentId, lessonId])` constraint — an existing row from either `source` ("MANUAL" or "AUTO_VIDEO") is a successful no-op, never an error.

**Audit entry shape** (`attendance-service.ts` lines 412-429, `auditChange`):
```typescript
await deps.audit({
  action: "attendance.changed",
  targetType: "Enrolment",
  targetId: args.enrolmentId,
  actorId: args.actorId,
  outcome: "SUCCESS",
  reason: args.reason,
  // before/after also included
});
```
Copy for `lessonprogress.marked` / `lessonprogress.unmarked` audit rows — `reason: null` for a learner's own self-undo, non-null for a staff override.

### `src/server/services/enrolment-dashboard-service.ts` (service, request-response aggregate read)

**Analogs:** `src/server/services/checkout-service.ts` (`getOwnOrder`) + `src/server/services/roster-service.ts` (`DeferredColumn`)

**Named-gap typed field, not a fake zero** (`roster-service.ts` lines 44-60):
```typescript
/**
 * ... Making the named gap the only inhabitable type is what
 * stops a numeric fallback (a zero, which reads as "failing") or a blank
 * (which reads as a bug) creeping in later. When Phase 9 / 10 / 11 land, each
 * will DELIBERATELY widen its column's type ...
 */
export type DeferredColumn = { kind: "deferred"; phase: 9 | 10 | 11 };

const PROGRESS_DEFERRED: DeferredColumn = { kind: "deferred", phase: 9 };
const ASSESSMENT_DEFERRED: DeferredColumn = { kind: "deferred", phase: 10 };
const COMPLETION_DEFERRED: DeferredColumn = { kind: "deferred", phase: 11 };
```
This is the EXACT precedent for the dashboard's "assessment obligations," "tickets," "results," "certificate state" named-gap slots (LRN-01, Open Question 1). Import `DeferredColumn` from `roster-service.ts` (or re-export it from a shared location) rather than inventing a parallel type — the dashboard's returned shape should include `assessmentObligations: DeferredColumn`, `results: DeferredColumn`, `tickets: DeferredColumn`, `certificate: DeferredColumn`, each pinned to the correct phase number (10, 10, 12, 11 respectively) so Phase 10/11/12 each widen one field's type later instead of restructuring this service.

**Ownership-scoped aggregate read** — combine `checkout-service.ts`'s `getOwnOrder` pattern (see above) with `roster-service.ts`'s row-shaping pattern (lines 61-94, the `RosterRow` type combining `attendance: AttendanceComponent` + three `DeferredColumn` fields) for the dashboard's overall return shape.

### `src/server/services/lesson-resource-service.ts` (MODIFIED — extend authorization predicate)

**Analog:** itself — `getDownloadableResource` (lines 297-308) and `lessonResourceScope` (lines 128-133)

**Current single-caller RBAC wrapper** (lines 297-308):
```typescript
const getDownloadableResource = deps.withPermission<string>(
  "courses.view",
  (id) => lessonResourceScope(id),
)(async (id): Promise<DownloadableResource | null> => {
  const row = await delegate.findUnique({ where: { id } });
  if (!row) return null;
  if (row.uploadStatus === "UPLOADING") throw new ResourceUploadPendingError();
  if (row.uploadStatus !== "READY") throw new ResourceUploadUnavailableError();
  const context = await resolveLessonContext(row.lessonId);
  return { ...row, lesson: { type: context?.type ?? "FILE" } };
});
```
Per RESEARCH.md Pitfall 1: add a SECOND, ownership-based resolver (`getDownloadableResourceForLearner(actor, id)`, no `withPermission` wrapper, following the Pattern 1 ownership shape above) that checks an ACTIVE `Enrolment` covers the lesson's course, then calls the SAME row-shaping logic (`uploadStatus` checks, `lesson.type` resolution) — do not duplicate those checks inline; factor them into a shared internal function both the staff-authorized and the ownership-authorized paths call.

### `src/app/api/lesson-resources/[id]/download/route.ts` (MODIFIED — try both predicates)

**Analog:** itself, existing handler (full file, 62 lines)

**302-redirect-with-no-store pattern to keep unchanged** (lines 42-47):
```typescript
// Built by hand rather than via Response.redirect so the no-store header
// rides along: no shared cache may retain the resolved location.
return new NextResponse(null, {
  status: 302,
  headers: { Location: url, "Cache-Control": "private, no-store" },
});
```
**Error-to-status mapping to extend, not replace** (lines 48-60) — add the learner path's ownership failure to the SAME `catch` block's 404 branch (never a distinct 403 — matches RBAC-06's denial-parity discipline per RESEARCH.md's IDOR mitigation table). Try staff-authorized `getDownloadableResource` first; on `AuthorizationError`, fall through to `getDownloadableResourceForLearner(actor, id)`; if that also fails/returns null, 404.

### `src/app/learn/[enrolmentId]/lessons/[lessonId]/page.tsx` (component, request-response)

**Analog:** `src/components/catalogue/LessonContent.tsx` (consume verbatim, do not edit)

**"Wraps, never edits" framing** (`LessonContent.tsx` lines 5-12):
```typescript
/**
 * The learner-facing lesson renderer for all eight `LessonType` values.
 *
 * A SERVER COMPONENT by construction: no client directive, no state, no
 * event handlers... `Lesson.body` stores HTML precisely so the read
 * path ships zero client JavaScript (D-30, NFR-02). Phase 9 builds the learner
 * journey around this component.
 */
```
This page imports `LessonContent` unchanged and renders a SIBLING client island (mark-complete button, video-progress hook) around it — never inside `LessonContent.tsx` or `LessonMediaPlayer.tsx` (RESEARCH.md Anti-Pattern, both files' own doc comments forbid it).

**Download-route consumption pattern** (`LessonContent.tsx` line 40, 160, 189, 212):
```typescript
const DOWNLOAD_ROUTE = (id: string) => `/api/lesson-resources/${id}/download`;
// ...
<LessonMediaPlayer src={DOWNLOAD_ROUTE(first.id)} title={lesson.title} />
```
Unchanged — the same route, now reachable by a learner because of the Pitfall-1 extension above, not because this component changed.

### `src/app/learn/[enrolmentId]/lessons/[lessonId]/actions.ts` (route, Server Actions)

**Analog:** `src/app/(checkout)/checkout/[orderId]/actions.ts` (`payAction`, full file)

**"use server" + actor-derivation + typed-error-to-redirect pattern** (lines 1, 40-46, 61-77):
```typescript
"use server";

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";

export async function payAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) redirect("/courses");

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  try {
    const order = await getOwnOrder(actor, orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    // ...
  } catch (err) {
    if (err instanceof HoldExpiredError /* ... */) {
      redirect(`/checkout/${orderId}`);
    }
    throw err;
  }
}
```
Copy this exact shape for `markLessonComplete`, `undoLessonComplete`, `recordWatchProgress`: `"use server"` directive, `getCurrentActor()` (never a client-supplied user id — matches the V5 Input Validation note in RESEARCH.md's Security Domain table, "derive identity from the session"), typed service errors caught and mapped to either a redirect or a re-thrown error for the page's error boundary. Per RESEARCH.md Pitfall 3, `recordWatchProgress` must additionally be throttled client-side before dispatch (Server Actions from one client dispatch sequentially) — the action itself stays a simple, fast, idempotent write.

## Shared Patterns

### Ownership-scoped authorization (NOT `withPermission`)
**Source:** `src/server/services/checkout-service.ts` lines 1-39, 546-578; `src/server/services/profile-service.ts` lines 1-12
**Apply to:** `lesson-progress-service.ts`, `enrolment-dashboard-service.ts`, `lesson-sequencing.ts`'s callers, the new learner predicate in `lesson-resource-service.ts`, all four `src/app/learn/...`/`src/app/dashboard` pages.
```typescript
async function getOwnOrder(actor: Actor, orderId: string): Promise<OrderSnapshot | null> {
  const order = await deps.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== actor.userId) return null;
  const { userId: _userId, ...snapshot } = order;
  return snapshot;
}
```
Never accept a target-user-id parameter. Never distinguish "not found" from "not yours" in the response. No `withPermission` import in these files — that omission is deliberate per both analogs' own header comments.

### Pure-evaluator discipline (zero imports)
**Source:** `src/server/services/readiness-service.ts` (full file), `src/server/services/attendance-component.ts` (full file)
**Apply to:** `completion-engine.ts`, `lesson-sequencing.ts`
```typescript
/**
 * PURE MODULE — no imports at all. Same discipline as `readiness-service.ts`:
 * a data-access import here would put this module on the worker import
 * closure and break `tests/boundary.test.ts`.
 */
```
Structural input types only (no `@prisma/client` types); named third/fourth states for "not configured" or "not yet checked," never a fake pass/zero; one function callable from every render/enforcement site so they can never disagree.

### Reactive, same-transaction recalculation (never outbox polling)
**Source:** `src/server/services/attendance-service.ts` lines 333-410; `src/server/services/domain-event-service.ts` lines 1-22 (header)
**Apply to:** `completion-service.ts`, the new call site added inside `lesson-progress-service.ts`'s write path, the new call site added inside `attendance-service.ts` after its existing `attendance.changed` emission.
```typescript
// domain-event-service.ts header:
// "This is NOT ... a work-queue API either: Phase 13 adds the drain job
// that turns unprocessed rows into emails ... Phase 9/11 read the
// attendance component straight out of a payload without recomputing it."
```
Call `recalculateCompletion(tx, enrolmentId)` as a plain synchronous function call inside the same transaction as the triggering write — never poll `DomainEvent`, never a batch job (D-11).

### Mandatory-reason staff override / free self-undo split
**Source:** `src/server/services/attendance-service.ts` lines 276-318, 381-385
**Apply to:** `lesson-progress-service.ts`'s mark/unmark functions (D-13/D-14/D-15)
```typescript
function trimReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}
// ...
if (timing.afterClose && !reason) {
  throw new CorrectionReasonRequiredError(session.id, enrolmentId, timing.closesAt);
}
```
Branch on WHO is acting (the enrolment's own learner vs. a staff actor), not on a client flag: learner self-undo requires no reason (D-13/D-15); staff override requires a non-empty trimmed reason (D-14), and stamps distinct actor/timestamp columns without disturbing the original record's stamps — same as `AttendanceRecord.correctedById`/`correctedAt`/`correctionReason` never blanking `recordedById`/`recordedAt`.

### Domain event emission (additive union, closed set)
**Source:** `src/server/services/domain-event-service.ts` lines 26-58; `src/server/services/attendance-service.ts` lines 395-407
**Apply to:** `completion-service.ts` (new `"lesson.completed"`, `"course.completed"`, `"programme.completed"` event types)
```typescript
export type DomainEventType =
  | "enrolment.created"
  // ... existing members, never restructured
  | "payment.reconciliation_exception";
```
Extend `DomainEventType` with new union members ONLY — never rename or remove existing ones (matches the Phase 6/7 additive-extension precedent RESEARCH.md's Pitfall 4 cites). Emit via `writeDomainEvent(tx, { type, payload })` inside the same transaction as the mutation, exactly like `attendance-service.ts` lines 395-407.

### Nullable-duration field convention
**Source:** `prisma/schema.prisma` lines 753-757, `Cohort.holdMinutes`
**Apply to:** the new `Cohort.accessDurationDays Int?` migration (D-02)
```prisma
// D-02 — per-cohort seat-hold TTL in minutes. Default 30. `null` or `0`
// means "no hold": ...
holdMinutes Int? @default(30)
```
Write the equivalent doc comment for `accessDurationDays`, explicitly stating `null` = unlimited access (D-02), and that it is read only for `SELF_PACED` cohorts (D-01) — mirror the existing comment's citation style (D-number + one-sentence semantic + pointer to where the CHECK/logic lives, if any).

### Server Action shape: "use server" + session-derived actor + typed-error-to-redirect
**Source:** `src/app/(checkout)/checkout/[orderId]/actions.ts` (full file)
**Apply to:** `src/app/learn/[enrolmentId]/lessons/[lessonId]/actions.ts`
See full excerpt under that file's Pattern Assignment above. Never accept an actor/user id from `formData` — always `getCurrentActor()`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Video watch-progress tracking mechanism (new column/table, D-09) | model + event-driven write | No prior client→server periodic-progress write path exists in this codebase (confirmed in RESEARCH.md Summary and Assumptions A3). The closest structural shape is `AttendanceRecord`'s `@@unique`-keyed upsert, but the throttling/debounce behavior (Pitfall 3) has no precedent — this is genuinely new composition, follow RESEARCH.md's Pattern/Pitfall 3 guidance directly rather than a codebase analog. |
| Staff-facing UI screen for D-14's mandatory-reason override | component | RESEARCH.md Open Question 2 flags this as possibly deferred; if built, the closest analog is the staff `RosterTab`'s correction-entry UI (`src/app/staff/cohorts/[id]/RosterTab.tsx`) paired with `ConfirmModal` — not yet confirmed in scope for this phase. |

## Metadata

**Analog search scope:** `src/server/services/`, `src/server/permissions/`, `src/components/catalogue/`, `src/components/shell/`, `src/app/(checkout)/`, `src/app/account/`, `src/app/staff/cohorts/[id]/`, `src/app/api/lesson-resources/`, `prisma/schema.prisma`, `tests/boundary.test.ts`
**Files scanned:** ~20 (all read directly, no summarization from memory)
**Pattern extraction date:** 2026-09-14
