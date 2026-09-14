# Phase 9: Learning Delivery & Progress Tracking - Research

**Researched:** 2026-09-14
**Domain:** Server-enforced content sequencing, idempotent progress tracking, versioned completion-rule evaluation, ownership-scoped (non-RBAC) learner authorization, secure content delivery — on Next.js 16.3.4 / Prisma 6.19.3 / Vitest 4.1.11, no new runtime dependencies.
**Confidence:** HIGH (this phase is >90% "read the existing codebase and extend its own established conventions" — the two genuinely new mechanisms, video watch-progress tracking and the completion-rule engine, are MEDIUM/LOW and flagged as such throughout)

## Summary

Phase 9 has almost no new-technology risk and a great deal of "does this decision already have a precedent in this exact codebase" risk. Every piece this phase needs — an ownership-scoped (not RBAC-scoped) authorization pattern, a pure-function rule evaluator, a presigned-URL content-delivery pipeline, a transactional outbox for reactive recalculation, and a resource-service CRUD factory — already exists and is used by at least one prior phase. The work is composition, not invention, with two exceptions: (1) the completion-rule evaluation engine itself has never been built (confirmed gap, `CONCERNS.md`), and (2) video watch-progress tracking is a genuinely new client→server write path with no prior precedent in this codebase to copy.

The single most important structural finding is that **`src/server/permissions/scope.ts`'s `ResourceScope` type has no user/enrolment dimension at all** — it is Global/Programme/Course/Cohort only. A learner viewing their own enrolment is therefore never an RBAC concern, by construction, and this codebase already has two working precedents for the correct alternative: `checkout-service.ts` (`getOwnOrder`) and `profile-service.ts` — plain ownership-comparison functions, keyed on `actor.userId`, that import no `withPermission` wrapper at all. Phase 9's dashboard, lesson-list, lesson-reading, and sessions reads (LRN-01, LRN-02, LRN-06) must follow this same pattern, not attempt to invent a new permission or scope type. This directly resolves the "Research must confirm" question `09-CONTEXT.md`'s canonical_refs section raises about the closed 36-identifier permission catalogue.

The second load-bearing finding concerns LRN-03's file access. The existing presigned-download route (`/api/lesson-resources/[id]/download`) is used TODAY by exactly one caller — the staff preview page — authorized via `courses.view` (an RBAC/Instructor-scoped permission). A learner has no Instructor-scoped grant on a course they are merely enrolled in, so this route's authorization predicate cannot simply be reused as-is for the learner path; it must be extended to accept a second, ownership-based caller (an ACTIVE `Enrolment` covering the lesson's course) alongside the existing staff path, while keeping the one route, the one `LessonContent` component, and the one presigned-URL mechanism (`storage-service.ts`'s `presignLessonObjectUrl`, unchanged TTLs). A third finding, not previously surfaced in `09-CONTEXT.md`'s D-numbers: `enrolment-transitions.ts` already declares `ACTIVE -> COMPLETED` as a legal transition with the code comment "`COMPLETED` is reachable solely from the Phase 9/11 completion engine" — meaning this phase's completion engine is expected to write `Enrolment.status = "COMPLETED"` (not just a `CompletionRecord` row) when a Course/Programme-scope rule is satisfied. This is a real behavior this phase must implement, currently undocumented as its own decision anywhere in `09-CONTEXT.md`.

**Primary recommendation:** Build one new pure module, `src/server/services/completion-engine.ts` (evidence in, verdict out, zero imports — mirrors `readiness-service.ts` and `attendance-component.ts` exactly), wrapped by a `completion-service.ts` that reads evidence, calls the pure engine, writes `CompletionRecord`/`LessonProgress`, and — on a fresh COURSE/PROGRAMME-scope satisfaction — transitions `Enrolment.status` to `COMPLETED` via the existing `assertTransition` guard. Trigger recalculation synchronously (same transaction, direct function call) from `LessonProgress` writes and from `attendance-service.ts`'s existing `attendance.changed` emission point — not via outbox polling, since D-11 explicitly rules out a batch/sweep job and the outbox is Phase 13's export mechanism, not an internal pub-sub bus.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Dashboard next-action/progress derivation (LRN-01) | Frontend Server (SSR) | API/Backend (data reads via ownership-scoped services) | Server Component reads via `src/server/services/*`, no client JS needed for the derivation itself |
| Module/Lesson sequencing & lock evaluation (LRN-02) | API/Backend | — | Must be enforced server-side per LRN-02's explicit requirement; a pure function over course structure + progress, called from both the lesson-list page and the lesson-reading page's access gate |
| Lesson content rendering (LRN-03) | Frontend Server (SSR) | — | `LessonContent` is already a zero-JS Server Component (Phase 4); this phase wraps it, never edits it |
| Authorized file access (LRN-03) | API/Backend (Route Handler) | Database/Storage (S3 presigned URL) | `/api/lesson-resources/[id]/download` — object bytes never traverse the app process |
| Video watch-progress tracking (LRN-04/D-09) | Browser/Client (event capture) | API/Backend (Server Action write) | `timeupdate` listener is inherently client-side; the write-and-threshold-check is server-side to prevent a client from forging completion |
| Lesson completion write (LRN-04, LRN-05) | API/Backend | Database/Storage (`LessonProgress`) | Idempotent upsert on `(enrolmentId, lessonId)` — must reject a request outside the caller's own access window server-side |
| Completion-rule evaluation (LRN-07) | API/Backend | Database/Storage (`CompletionRecord`) | Pure evaluator + a thin persistence wrapper, following the `readiness-service.ts` split exactly |
| Session visibility window (LRN-06) | API/Backend | Frontend Server (SSR render) | `linkVisibleFromMinutes` arithmetic must run server-side so the link URL itself is never sent to the client before the window opens |
| Ownership authorization (all learner-facing reads/writes) | API/Backend | — | New precedent class ("own enrolment"), not RBAC — lives in each service file, not `with-permission.ts` |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D-01:** For a `SELF_PACED` cohort, a learner's access follows a per-enrolment window (`Enrolment.accessStartsAt`/`accessEndsAt`), not the Cohort's shared dates. `INSTRUCTOR_LED`/`BLENDED` cohorts keep using Cohort-wide dates.
- **D-02:** New nullable field `Cohort.accessDurationDays` (`Int?`). `null` = unlimited access; a set value = that many days from `Enrolment.activatedAt`. Follows the `Cohort.holdMinutes` nullable-duration convention.
- **D-03:** When a self-paced learner's access window ends without completion, `Enrolment` stays `ACTIVE` — access locks read-only past `accessEndsAt`. No new `EnrolmentStatus` value, no sweep job — a rendering/authorization concern, not a state-machine transition.
- **D-04:** Only **required** lessons (`Lesson.required = true`) gate progression. Optional lessons never block anything — Lesson N+1 unlocks once the most recent required lesson at or before it has a `LessonProgress` row.
- **D-05:** Sequencing is a **global path across the whole Course** — not per-Module. `Course.prerequisites` remains free-text marketing copy, no role in locking.
- **D-06:** A locked lesson names the specific blocking lesson by title: "Complete '<Lesson title>' to unlock this" — not generic.
- **D-07:** The first lesson has no lock, but nothing is accessible at all unless `Enrolment.status = ACTIVE` — no preview/marketing access during `PENDING_PAYMENT`.
- **D-08:** VIDEO auto-completes at 90% watch-through (`LessonProgress.source = "AUTO_VIDEO"`); TEXT/FILE/IMAGE/EMBED/LINK stay manual mark-complete only, gated on `Lesson.allowManualComplete`.
- **D-09:** Video watch progress needs a new tracking mechanism — periodic server-action writes; crossing 90% creates the `LessonProgress` row. Exact shape (polling interval, client event model, field name) is Claude's discretion.
- **D-10:** `completionRule` v1 checks exactly two things: (a) all required lessons complete (always applies), (b) attendance ≥ `Cohort.attendanceThresholdPct` (applies only when set). No assessment criteria (Phase 10 doesn't exist yet).
- **D-11:** Completion recalculation is reactive: triggered on every `LessonProgress` write, and when Phase 5's `attendance changed` DomainEvent fires. No batch/sweep job.
- **D-12:** When a previously-satisfied completion becomes unsatisfied, `CompletionRecord.supersededAt` is set — no new `CompletionRecord` until satisfied again.
- **D-13:** A learner can freely self-undo a lesson they manually marked complete — no reason required.
- **D-14:** Staff can override a learner's `LessonProgress` (mark/unmark on their behalf) — mandatory reason, actor+timestamp recorded, mirroring Phase 5's attendance-correction pattern.
- **D-15:** The self-undo rule (D-13) applies regardless of source — a learner can undo an `AUTO_VIDEO`-sourced completion too.
- **D-16:** Un-completing a required lesson cascades: downstream lessons that were only unlocked because of it re-lock. A learner's own progress on those later lessons is preserved in the database but inaccessible until re-completed.

### Claude's Discretion

- Exact video watch-progress tracking mechanism (D-09): polling interval, client-side event model (`timeupdate`, `pause`, `seek`), where the running value lives (new column vs. supporting table), whether writes are throttled/debounced.
- The dashboard's "next action" derivation logic (LRN-01).
- The `completionRule` JSON payload's exact shape and where the evaluation engine lives (`src/server/services/completion-engine.ts` per CONCERNS.md, or split differently).
- Whether re-locking (D-16) walks the whole downstream chain eagerly on every un-complete, or lazily at render time.

### Deferred Ideas (OUT OF SCOPE)

- Preview/marketing access to content before payment (e.g. Lesson 1 visible during `PENDING_PAYMENT`) — explicitly not chosen; v1 requires `ACTIVE` enrolment for any content access.
- Per-lesson or per-module access windows distinct from the whole-Course window — D-01/D-02 apply the access window at the Enrolment level only.
- Assessment-based completion criteria — out of scope until Phase 10 exists; the engine must be extensible enough to add this later without a rewrite.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LRN-01 | Personal enrolment dashboard — own records only | Ownership-scoped read pattern (`checkout-service.ts`/`profile-service.ts` precedent, §"Architecture Patterns" Pattern 1); `readiness-service`-style pure derivation for "next action" (§Pattern 4) |
| LRN-02 | Server-enforced Module/Lesson sequencing, locked content explains unmet condition | Pure sequencing evaluator (§Pattern 2), built from `Lesson.required`/`position` + `LessonProgress` rows, D-04/D-05/D-06 |
| LRN-03 | Secure, accessible content delivery, authorized file access only | Reuse `LessonContent`/`LessonMediaPlayer`/`presignLessonObjectUrl` verbatim (§Pattern 3); extend `getDownloadableResource`'s authorization predicate to accept ownership as well as staff `courses.view` |
| LRN-04 | Idempotent, attributable, timestamped, recalculable progress; not advanced by unauthorized requests | `LessonProgress`'s existing `@@unique([enrolmentId, lessonId])` upsert target; access-window check server-side before every write (§Pitfall 2) |
| LRN-05 | Manual completion only where policy permits, only by enrolled learner in valid access window, reversible only per policy | `Lesson.allowManualComplete` gate + D-07/D-01 access-window check + D-13/D-15 unconditional self-undo + D-14 staff override with mandatory reason (mirrors `attendance-service.ts`'s correction pattern) |
| LRN-06 | Session details/meeting links to eligible learners within visibility window, hidden otherwise | `ScheduledSession.linkVisibleFromMinutes` — same server-side arithmetic Phase 5 already established, now read by a learner-facing, ownership-scoped query instead of a staff one |
| LRN-07 | Versioned completion-rule evaluation, identifies each satisfied/unmet rule, handles corrections, records completion time and rule version | New `completion-engine.ts` pure evaluator (§Pattern 4) + `completion-service.ts` wrapper, `CompletionRecord.ruleVersion`/`evidence`/`supersededAt` (already-existing columns), reactive trigger from `LessonProgress` writes and `attendance.changed` (§Pitfall 4) |

</phase_requirements>

## Standard Stack

No new runtime dependency is required for this phase. Every mechanism it needs — native `<video>`, Server Actions, Prisma, the presigned-URL S3 client, Tailwind/lucide-react for UI — is already installed and pinned.

### Core (already installed, unchanged versions)

| Library | Version | Purpose | Why Standard (for this phase) |
|---------|---------|---------|--------------|
| `next` | 16.3.4 `[VERIFIED: package.json]` | App Router, Server Actions, Route Handlers | Locked project-wide version; Server Actions are the dispatch mechanism for lesson mark-complete and video watch-progress writes |
| `@prisma/client` / `prisma` | ^6.19.3 `[VERIFIED: package.json]` | ORM, `LessonProgress`/`CompletionRecord`/`Enrolment` access | Existing schema already carries every column this phase needs (see Runtime State Inventory — none needed, this is additive-column-only, not a rename phase) |
| `lucide-react` | ^1.41.0 `[VERIFIED: package.json]` | `Lock`/`Circle`/`PlayCircle`/`Clock`/`MapPin`/`Video`/`Calendar`/`CheckCircle2` icons | Already the approved icon set (04.1); UI-SPEC §1 confirms none of these seven icons are imported anywhere yet, but the package itself needs no new install |
| `vitest` | ^4.1.11 `[VERIFIED: package.json]` | Unit/integration tests for the new services | Existing test runner (`npm test` = `vitest run --no-file-parallelism`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `<video>` + throttled `timeupdate` writes (D-09 discretion) | A dedicated video-analytics library (e.g. Video.js plugins, Mux Data) | Rejected: `LessonMediaPlayer`'s own header comment locks in native `<video>` for the single-resolution presigned-URL Range-request assumption (D-36/D-37); swapping players is explicitly flagged as requiring a deliberate, separate TTL change. No such swap is in scope here. |
| Synchronous same-transaction completion recalculation (recommended, §Summary) | A message-queue / job-runner consuming the `DomainEvent` outbox as a pub-sub bus | Rejected: D-11 explicitly forbids a batch/sweep job, and the outbox's own header comment states it is Phase 13's export mechanism, "NOT a work-queue API." Introducing a poller here would be a second, competing consumer of the same table Phase 13 is designed to own. |

## Package Legitimacy Audit

Not applicable — this phase installs zero new external packages. No slopcheck run is required; nothing in the Standard Stack table above was discovered this session (all are pre-existing, pinned entries in `package.json`, confirmed via direct file read, not web search).

## Architecture Patterns

### System Architecture Diagram

```
Learner's browser
      │
      │  GET /dashboard, /learn/[enrolmentId], /learn/[enrolmentId]/lessons/[lessonId], /learn/[enrolmentId]/sessions
      ▼
Next.js App Router (Server Components, SSR)
      │
      ├─► [ownership check] "does this Enrolment.userId === session actor?"
      │        │  NOT mine / PENDING_PAYMENT / doesn't exist → same denied render (D-07)
      │        ▼
      ├─► enrolment-dashboard-service.ts ──► reads Enrolment + Cohort + CompletionRecord + LessonProgress + ScheduledSession + AttendanceRecord
      │                                        (LRN-01 "own records only")
      │
      ├─► lesson-sequencing-service.ts ──► pure lock-evaluator (course structure + LessonProgress) → per-lesson {locked, blockingLessonTitle}
      │                                        (LRN-02)
      │
      ├─► LessonContent (unchanged, Phase 4) ──► img/video/file <a href> → 
      │                                             GET /api/lesson-resources/[id]/download (Route Handler)
      │                                                   │
      │                                                   ├─► [predicate: staff courses.view] OR [predicate: learner ACTIVE Enrolment ownership]  ◄── NEW, this phase
      │                                                   ▼
      │                                             storage-service.presignLessonObjectUrl() ──► 302 → S3 presigned URL (60s FILE/IMAGE, 4h VIDEO)
      │                                                                                              (LRN-03 — object bytes never traverse the app)
      │
      ├─► [client island] mark-complete button / video timeupdate listener
      │        │  Server Action (POST, same-origin CSRF-checked by Next.js)
      │        ▼
      ├─► lesson-progress-service.ts ──► [ownership + access-window + allowManualComplete/AUTO_VIDEO gate] ──► upsert LessonProgress
      │                                        │
      │                                        ▼ (same transaction, synchronous call — NOT outbox polling)
      │                                  completion-service.ts ──► completion-engine.ts (PURE: evidence in, verdict out)
      │                                        │
      │                                        ├─► verdict changed to SATISFIED → new CompletionRecord row (ruleVersion, evidence)
      │                                        │        └─► if scope=COURSE/PROGRAMME → Enrolment.status: ACTIVE → COMPLETED (assertTransition)
      │                                        └─► verdict changed to UNSATISFIED → existing CompletionRecord.supersededAt = now()
      │
      └─► attendance-service.ts (Phase 5, existing) ──► writeOneRecord() ──► emits "attendance.changed" DomainEvent
                                                              │
                                                              └─► [NEW call site, same transaction] completion-service.ts ──► same engine, same verdict path
```

### Recommended Project Structure

```
src/server/services/
├── completion-engine.ts          # NEW — pure evaluator (readiness-service.ts pattern): {lessons, progress, attendanceComponent} → per-rule verdicts
├── completion-service.ts         # NEW — wraps the engine: reads evidence, writes CompletionRecord, transitions Enrolment.status, emits domain events
├── lesson-sequencing.ts          # NEW — pure lock evaluator (D-04/D-05/D-06): course structure + LessonProgress → {lessonId: locked|unlocked, blockingLessonTitle}
├── lesson-progress-service.ts    # NEW — ownership-scoped mark/unmark, access-window check, cascade re-lock trigger (D-16), staff-override path (D-14, mirrors attendance correction)
├── enrolment-dashboard-service.ts# NEW — ownership-scoped aggregate read for LRN-01 (next action, progress, sessions, named gaps)
├── attendance-service.ts         # EXISTING — one new call site added: after emitting "attendance.changed", call completion-service's recalculation synchronously
├── lesson-resource-service.ts    # EXISTING — getDownloadableResource's authorization predicate extended (see Pitfall 1)
└── storage-service.ts            # EXISTING — presignLessonObjectUrl unchanged, called by both predicates

src/app/
├── dashboard/page.tsx                                    # NEW (LRN-01)
├── learn/[enrolmentId]/page.tsx                           # NEW (LRN-02)
├── learn/[enrolmentId]/lessons/[lessonId]/page.tsx        # NEW (LRN-03/04/05)
├── learn/[enrolmentId]/lessons/[lessonId]/actions.ts       # NEW — Server Actions: markLessonComplete, undoLessonComplete, recordWatchProgress
└── learn/[enrolmentId]/sessions/page.tsx                  # NEW (LRN-06)
```

### Pattern 1: Ownership-scoped authorization — NOT `withPermission`

**What:** A plain async function that derives its target exclusively from `actor.userId`, never accepts a target-user-id parameter, and returns `null`/denies identically whether the record doesn't exist or belongs to someone else.

**When to use:** Every learner-facing read/write this phase adds. `ResourceScope` (Global/Programme/Course/Cohort) has no representation for "this specific user's own record" — attempting to force this through `withPermission` would require either a new permission identifier (contradicts the closed 36-identifier catalogue, which has no "self" concept) or a fabricated scope that leaks to sibling records.

**Example:**
```typescript
// Source: src/server/services/checkout-service.ts (existing, lines 546-555)
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

// Phase 9 applies the identical shape to Enrolment:
async function getOwnEnrolment(actor: Actor, enrolmentId: string): Promise<EnrolmentDetail | null> {
  const enrolment = await prisma.enrolment.findUnique({ where: { id: enrolmentId }, include: {/* ... */} });
  if (!enrolment || enrolment.userId !== actor.userId) return null;
  if (enrolment.status !== "ACTIVE") return null; // D-07 — PENDING_PAYMENT etc. get the identical "not found" treatment
  return enrolment;
}
```

### Pattern 2: Pure lock evaluator (D-04/D-05/D-06)

**What:** A function with zero data-access imports (same discipline as `readiness-service.ts`/`attendance-component.ts`) that takes the whole course's flattened, ordered lesson list plus the set of completed lesson ids and returns, per lesson, whether it is locked and — if so — the title of the specific blocking lesson.

**When to use:** Called from both the lesson-list page (LRN-02's rendered lock state) and the lesson-reading page's access gate (LRN-02's server-side enforcement) — one function, two call sites, so the two can never disagree (exactly the `readiness-service.ts` justification: "One function, three call sites").

**Example (illustrative, not yet written):**
```typescript
export type SequencingLesson = { id: string; title: string; required: boolean; position: number; moduleId: string };
export type SequencingResult = { lessonId: string; locked: boolean; blockingLessonTitle: string | null };

export function evaluateLessonSequencing(
  courseLessons: SequencingLesson[],        // flattened across ALL modules, ordered (D-05: whole-course path)
  completedLessonIds: ReadonlySet<string>,
): SequencingResult[] {
  const ordered = [...courseLessons].sort((a, b) => a.position - b.position);
  let blockingTitle: string | null = null;
  return ordered.map((lesson) => {
    const result = { lessonId: lesson.id, locked: blockingTitle !== null, blockingLessonTitle: blockingTitle };
    // D-04: only a REQUIRED, incomplete lesson becomes the new blocker for everything after it.
    if (lesson.required && !completedLessonIds.has(lesson.id)) {
      blockingTitle = lesson.title;
    }
    return result;
  });
}
```

### Pattern 3: Content delivery — reuse verbatim, extend only the predicate

**What:** `LessonContent` (Server Component, zero client JS) renders unchanged; the wrapping page adds a sibling client island (mark-complete button, video-progress hook) around it, never inside it, per `LessonContent`'s own doc comment ("Phase 9 builds the learner journey around this component").

**When to use:** LRN-03, verbatim. The ONLY code change to the existing pipeline is `getDownloadableResource`'s authorization: today it is `deps.withPermission<string>("courses.view", (id) => lessonResourceScope(id))`, reachable only by staff. Extend it to also accept a learner whose ACTIVE Enrolment covers the lesson's course — see Pitfall 1 for the concrete shape.

### Pattern 4: Pure completion-rule evaluator (LRN-07)

**What:** `completion-engine.ts` — zero imports, takes structural evidence (required-lesson completion set, attendance component if a threshold is configured) and the rule definition, returns a per-rule-item verdict list plus an overall satisfied/unsatisfied boolean. Mirrors `readiness-service.ts`'s `ReadinessItem[]` shape (id/label/state/detail) so the dashboard's "Your progress" and a future staff-facing view can render it identically.

**When to use:** LRN-07's "identifies each satisfied/unmet rule" requirement is a structural match for `readiness-service.ts`'s named-item list — do not collapse the two D-10 rule components (required-lessons, attendance) into one composite percentage; the UI-SPEC (§7.1) already locks in "two independent, identical bars... never merged into one composite percentage."

**Example (illustrative, shape only):**
```typescript
export type CompletionRuleV1 = {
  version: 1;
  requiresAllRequiredLessons: true;                 // always present, D-10(a)
  attendanceThresholdPct?: number;                   // present only if D-10(b) applies
};

export type CompletionVerdictItem = { id: string; label: string; satisfied: boolean; detail: string };
export type CompletionVerdict = { items: CompletionVerdictItem[]; satisfied: boolean };

export function evaluateCompletion(
  rule: CompletionRuleV1,
  evidence: {
    requiredLessonIds: string[];
    completedLessonIds: ReadonlySet<string>;
    attendance: AttendanceComponent | null; // from attendance-component.ts, re-used not recomputed
  },
): CompletionVerdict {
  const items: CompletionVerdictItem[] = [];
  const allDone = evidence.requiredLessonIds.every((id) => evidence.completedLessonIds.has(id));
  items.push({ id: "required-lessons", label: "All required lessons complete", satisfied: allDone,
    detail: `${evidence.requiredLessonIds.filter((id) => evidence.completedLessonIds.has(id)).length} of ${evidence.requiredLessonIds.length} complete` });

  if (rule.attendanceThresholdPct != null && evidence.attendance?.kind === "computed") {
    items.push({ id: "attendance", label: "Attendance threshold met", satisfied: evidence.attendance.meetsThreshold,
      detail: `${evidence.attendance.earnedPct}% of ${evidence.attendance.requiredPct}% required` });
  }

  return { items, satisfied: items.every((i) => i.satisfied) };
}
```

### Anti-Patterns to Avoid

- **Wrapping learner-facing reads in `withPermission`:** There is no permission identifier for "view my own enrolment" in the closed catalogue, and inventing one contradicts `09-CONTEXT.md`'s own framing of this as an ownership question, not an RBAC one. Use Pattern 1 instead.
- **Polling the `DomainEvent` outbox for completion recalculation:** The outbox's header comment is explicit that it is not a work-queue API. D-11 rules out a batch job. Call the completion engine synchronously, in the same transaction, from the two write sites (`LessonProgress` upsert, `attendance-service.ts`'s existing event-emission point).
- **Editing `LessonContent.tsx` or `LessonMediaPlayer.tsx` to add the mark-complete button or the watch-progress hook:** Both are explicitly locked as unchanged surfaces this phase consumes (04.1/06 UI-SPEC precedent, and `LessonContent`'s own "zero client JS" doc comment). Add a sibling wrapper component instead.
- **Merging the two D-10 rule components into one percentage:** UI-SPEC §7.1 and `readiness-service.ts`'s own convention both require distinct, separately-rendered items — collapsing them loses the "identifies each satisfied/unmet rule" requirement of LRN-07 itself.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video progress percentage / scrubber UI | A custom progress overlay on top of `<video>` | The native `<video>` element's own controls (UI-SPEC §7.3 explicit requirement: "no progress percentage or scrubber overlay is drawn on top of the native `<video>` element") | Native controls are already keyboard-accessible and screen-reader-labelled; a custom overlay would have to re-earn NFR-09 compliance for no product benefit |
| Presigned URL generation for lesson content | A second S3/storage client or a bespoke signing helper | `storage-service.ts`'s existing `presignLessonObjectUrl` + `downloadTtlFor` | Already handles the `ResponseContentDisposition`/`ResponseContentType` header-baking that prevents a stored HTML file rendering in the storage origin (T-04-27c) — a second implementation would need to independently rediscover that mitigation |
| CRUD/audit plumbing for any new resource that needs a permission gate | A bespoke list/get/create/update/archive set per new model | `createResourceService` factory (`resource-service.ts`) — though note most of Phase 9's new services are ownership-scoped, not permission-scoped, so most will NOT use this factory; it remains relevant only for the staff-side override path (D-14) if built as its own resource | Writing scope/audit per-domain is "a dozen chances to forget the scope check," per the factory's own header |
| Attendance percentage computation | A second earned/required attendance calculator inside the completion engine | `attendance-component.ts`'s `computeAttendanceComponent`, read via the `attendance.changed` event payload's `component` field | Phase 5's own header is explicit: Phase 9 "read[s] the payload, don't recompute" |
| Access-duration expiry sweeping | A scheduled worker/cron job that flips something when `accessEndsAt` passes | A read-time check (`now() > accessEndsAt` inline in the ownership-scoped read), per D-03's explicit "no scheduled sweep/worker job" | Access lock is a rendering/authorization concern, not a state transition — the same reasoning `Cohort.holdMinutes`'s hold-sweep-vs-read-time-check distinction already documents elsewhere in this codebase (that one DOES need a sweep, for seat accounting; this one explicitly does not) |

**Key insight:** This phase's biggest risk is not "what library do I need" (none) but "did I re-derive a rule this codebase already computes and expose two sources of truth that can drift" — attendance component, presigned-URL TTL policy, and the enrolment status-transition table are the three most likely places to accidentally duplicate logic instead of calling into it.

## Common Pitfalls

### Pitfall 1: The lesson-resource download route currently has only ONE caller (staff) and its authorization does not generalize to learners

**What goes wrong:** A naive Phase 9 implementation adds an `if (isStaff) ... else ...` branch that duplicates `getDownloadableResource`'s upload-status/scan checks, or worse, adds a `withPermission("courses.view", ...)` grant hack that would require inventing a fake COURSE-scope grant for every enrolled learner (a genuine RBAC/privilege-boundary violation — it would let a learner reach staff-only course-scoped actions too, since grants aren't action-scoped once matched).

**Why it happens:** `getDownloadableResource` in `lesson-resource-service.ts` is currently wrapped in `deps.withPermission<string>("courses.view", (id) => lessonResourceScope(id))` — a single RBAC-gated function, not two.

**How to avoid:** Add a second, ownership-based resolver (no `withPermission` wrapper, following Pattern 1) — e.g. `getDownloadableResourceForLearner(actor, id)` — that checks the calling user holds an ACTIVE `Enrolment` in a Cohort whose pinned publication includes this lesson's course. In the Route Handler, try the staff path first (if the actor has a session and any staff grant reaches `courses.view` for this course, allow); if that fails, try the learner path. Both paths funnel into the SAME `presignLessonObjectUrl` call with the SAME TTL logic — only the predicate differs, per `09-CONTEXT.md`'s own framing.

**Warning signs:** Any new code that duplicates the `uploadStatus === "READY"` / `ResourceUploadPendingError` / `ResourceUploadUnavailableError` checks instead of calling the existing helper twice with different authorization.

### Pitfall 2: `Lesson.allowManualComplete` and D-08's VIDEO auto-completion path are easy to conflate

**What goes wrong:** Treating "VIDEO type" and "manual complete disallowed" as the same condition. `Lesson.allowManualComplete` defaults to `true` and is a genuinely independent flag from `type`; D-08 says VIDEO's *primary* path is auto-completion but does not forbid also allowing manual complete on a VIDEO lesson if the flag is set — UI-SPEC §7.3 explicitly carves out this case ("VIDEO only if manual override is separately allowed").

**Why it happens:** The schema has one boolean (`allowManualComplete`) and one enum (`type`); the product rule couples them only for the DEFAULT case, not absolutely.

**How to avoid:** Gate the manual-complete button on `lesson.allowManualComplete === true` alone, regardless of `type`. Gate the auto-video listener on `lesson.type === "VIDEO"` alone, regardless of `allowManualComplete`. The two can both be true simultaneously (a VIDEO lesson with both auto-completion AND a manual override available) — write the completion-write path so a `LessonProgress` row from either source is equally idempotent (the `@@unique([enrolmentId, lessonId])` constraint already guarantees this at the database level; the service layer must simply treat "already exists" as a successful no-op, not an error, for both sources).

### Pitfall 3: Server Actions dispatch **sequentially per client** — an aggressive `timeupdate`-driven write interval will queue, not parallelize

**What goes wrong:** A naive implementation calls a Server Action on every native `timeupdate` event (which fires roughly 4x/second in most browsers). Next.js 16's documented behavior is that Server Actions from one client dispatch one at a time — the second waits for the first to finish, then the third waits for the second (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, "Sequential dispatch on the client"). At 4 writes/second this either backs up the queue indefinitely on a slow connection or hammers the database with far more writes than the 90%-threshold decision needs.

**Why it happens:** `timeupdate` is a high-frequency native event; nothing throttles it by default.

**How to avoid:** Throttle/debounce client-side to a coarse interval (e.g. every 10-15 seconds of playback, or on `pause`/`seek`/unmount) before dispatching the Server Action — this is explicitly Claude's discretion per D-09, but the sequential-dispatch behavior documented above is a hard constraint on how coarse that interval needs to be, not just a nice-to-have. UI-SPEC §8's backstop item ("A throttled/debounced watch-progress write failing silently... must not block playback") should be read together with this: a failed write must be safely retryable on the NEXT throttled tick, never blocking the video element itself.

### Pitfall 4: Reactive recalculation must not create a circular/duplicate-event problem

**What goes wrong:** If `completion-service.ts`'s COURSE/PROGRAMME-scope satisfaction path both writes a `CompletionRecord` AND emits its own `DomainEvent` (e.g. `course.completed`) AND that event type is later also consumed as a *trigger* for something else in the same phase, an infinite or duplicate-write loop becomes possible. Separately, `DomainEventType` is a closed string union (`domain-event-service.ts`) — a new event type (`lesson.completed`, `course.completed`, `programme.completed`) is a compile error until the union is extended, exactly as Phase 6/7 additively extended it for their own new event types.

**Why it happens:** The outbox pattern makes "emit an event whenever something interesting happens" feel free, but this phase's OWN recalculation trigger is direct function calls, not event-driven — the emitted events here are purely for Phase 13's future email drain, and must not be re-read by this phase's own recalculation logic.

**How to avoid:** Extend `DomainEventType` additively (new union members only, never restructure existing ones — matches the "shared-module extensions" pattern STATE.md records for Phase 6/7). Keep the completion engine's OWN recalculation triggers as plain synchronous function calls (`recalculateCompletion(tx, enrolmentId)` called directly from `lesson-progress-service.ts` and from `attendance-service.ts`), and treat the emitted `lesson.completed`/`course.completed`/`programme.completed` events purely as write-once, read-never-by-this-phase output for Phase 13.

### Pitfall 5: `Enrolment.status` transition to `COMPLETED` is a real, currently-undocumented-in-CONTEXT.md behavior this phase must implement

**What goes wrong:** Building the completion engine to write only a `CompletionRecord` row and stopping there, because no D-number in `09-CONTEXT.md` explicitly says to transition `Enrolment.status`. This would leave `enrolment-transitions.ts`'s own comment — "`COMPLETED` is reachable solely from the Phase 9/11 completion engine" — permanently unfulfilled, and `VALID_TRANSITIONS.ACTIVE` would keep listing a target state nothing ever reaches.

**Why it happens:** This is genuinely a gap between `enrolment-transitions.ts` (written during Phase 6) and `09-CONTEXT.md` (written during Phase 9's discussion) — the transition table anticipated this phase's behavior but `09-CONTEXT.md`'s D-numbers don't name it explicitly (D-03 only covers the SELF_PACED-access-ends-without-completion case, which deliberately does NOT transition status — a different scenario).

**How to avoid:** When `completion-service.ts` newly satisfies a COURSE-scope or PROGRAMME-scope rule (not a per-lesson event) for an Enrolment currently `ACTIVE`, call `assertTransition("ACTIVE", "COMPLETED")` and update the row (setting `Enrolment.status = "COMPLETED"`), inside the same transaction as the `CompletionRecord` insert, emitting an appropriately-named domain event. Flag this explicitly for user/planner confirmation since it is inferred from code, not stated as a locked decision — see Assumptions Log A1.

## Code Examples

### Ownership-scoped enrolment lookup with the D-07 access gate folded in

```typescript
// Source: pattern from src/server/services/checkout-service.ts getOwnOrder (existing)
export async function getOwnActiveEnrolment(
  actor: Actor,
  enrolmentId: string,
): Promise<EnrolmentForLearner | null> {
  const enrolment = await prisma.enrolment.findUnique({
    where: { id: enrolmentId },
    include: { cohort: true },
  });
  // "Not mine" and "does not exist" and "not yet ACTIVE" are the SAME answer —
  // D-07: nothing is accessible at all outside ACTIVE, and a denial must not
  // leak which of the three is true (mirrors T-06-13's reasoning).
  if (!enrolment || enrolment.userId !== actor.userId || enrolment.status !== "ACTIVE") {
    return null;
  }
  return enrolment;
}
```

### Access-window check for a self-paced Cohort (D-01/D-02/D-03)

```typescript
// Illustrative — combines D-01 (per-enrolment window for SELF_PACED),
// D-02 (Cohort.accessDurationDays nullable-duration), D-03 (read-only past end).
function computeAccessWindow(enrolment: EnrolmentRow, cohort: CohortRow): { readOnly: boolean; endsAt: Date | null } {
  if (cohort.deliveryMode !== "SELF_PACED") {
    return { readOnly: false, endsAt: cohort.endsAt }; // D-01: non-self-paced uses Cohort dates, unaffected by this phase
  }
  if (cohort.accessDurationDays == null || enrolment.activatedAt == null) {
    return { readOnly: false, endsAt: null }; // D-02: null = unlimited access
  }
  const endsAt = new Date(enrolment.activatedAt.getTime() + cohort.accessDurationDays * 24 * 60 * 60 * 1000);
  return { readOnly: new Date() > endsAt, endsAt }; // D-03: locks read-only, no status change
}
```

### Session meeting-link visibility (LRN-06, reusing Phase 5's existing field)

```typescript
// Source: pattern already established for ScheduledSession.linkVisibleFromMinutes (Phase 5)
function isMeetingLinkVisible(session: { startsAt: Date; linkVisibleFromMinutes: number }, now: Date): boolean {
  const visibleFrom = new Date(session.startsAt.getTime() - session.linkVisibleFromMinutes * 60 * 1000);
  return now >= visibleFrom;
}
// The Server Component must compute this and OMIT meetingUrl entirely from the
// props/HTML sent to the client when false — hiding it with CSS would still
// leak the URL to anyone reading the page source (NFR-06 "no permanent report
// links" spirit applies equally to a link nobody should see yet).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A — no prior completion/progress implementation exists in this codebase to supersede | `readiness-service.ts`-style pure evaluator, applied to completion for the first time | This phase (Phase 9) | Sets the precedent Phase 11 (certificates) will consume directly — `CompletionRecord` rows are Phase 11's evidence input, per `09-CONTEXT.md`'s explicit scope boundary |

**Deprecated/outdated:** Nothing in this phase's domain is deprecated — this is greenfield work inside an established codebase, not a migration.

## Assumptions Log

| # | Claim | Section | Risk if Wrong | Resolution |
|---|-------|---------|---------------|------------|
| A1 | The completion engine must transition `Enrolment.status` from `ACTIVE` to `COMPLETED` when a COURSE/PROGRAMME-scope rule is newly satisfied (inferred from `enrolment-transitions.ts`'s comment, not stated as a D-number in `09-CONTEXT.md`) | Common Pitfalls, Pitfall 5 | If wrong (i.e. the product intent is that `Enrolment.status` should stay `ACTIVE` forever and `COMPLETED` is reserved for a different, later trigger), the planner ships an unwanted status transition that could affect any other code reading `Enrolment.status === "ACTIVE"` as a gate (e.g. the dashboard/lesson-list access checks in this very phase would need to also treat `COMPLETED` as accessible-read-only, similar to D-03's self-paced-ended case) | **RESOLVED — DD-6 (09-04-PLAN.md):** ruled against transitioning; Phase 9 writes `CompletionRecord` only, `Enrolment.status` stays `ACTIVE`; transition ownership assigned to Phase 11. |
| A2 | The lesson-resource download route (`getDownloadableResource`) should be extended with a second, ownership-based predicate on the SAME route/function family, rather than the learner path getting an entirely separate Route Handler | Common Pitfalls, Pitfall 1 | Low risk either way functionally, but a separate route would duplicate the `uploadStatus`/presign logic UI-SPEC and D-36/D-37 treat as a single mechanism — worth confirming during planning which shape the team prefers | **RESOLVED — DD-14 (09-05-PLAN.md):** extended the existing route/function with a second ownership-based predicate; no separate route created. |
| A3 | Video watch-progress should be stored as a field/small table keyed on `(enrolmentId, lessonId)` rather than reusing `LessonProgress` itself for the in-progress percentage (only the final 90%-crossing write touches `LessonProgress`) | Architecture Patterns, Recommended Project Structure | If the team instead wants watch-percent stored directly on `LessonProgress` (widening its schema pre-completion), the migration shape changes; D-09 leaves this explicitly as Claude's discretion, so this is a recommendation, not a verified fact | **RESOLVED — DD-1 (09-01-PLAN.md):** new `LessonWatchProgress` table, keyed on `(enrolmentId, lessonId)`; `LessonProgress` untouched until the 90% completion write. |
| A4 | Recalculation should be a synchronous, same-transaction function call rather than any queue/poll mechanism | Summary; Architecture Patterns; Pitfall 4 | If the actual intent behind "subscribes to the... DomainEvent" (attendance-component.ts's own header phrasing) was a literal event-subscription/poll mechanism rather than a direct call, a synchronous-only implementation would need to be revisited — but D-11's explicit "no batch/sweep job" strongly supports the synchronous reading | **RESOLVED — DD-12 (09-04-PLAN.md):** implemented as a synchronous, same-transaction call; no queue/poll mechanism. |

**If this table is empty:** N/A — see rows above. All four assumptions arise from inference across multiple source files rather than an explicit written specification, and should be confirmed with the user or explicitly locked by the planner before implementation.

## Open Questions (RESOLVED)

1. **RESOLVED — DD-18 (09-07-PLAN.md).** Does the dashboard's "assessment obligations" and "results" named-gap slots need any data-shape placeholder now, or can they render purely from static copy?
   - What we know: UI-SPEC §6.1 gives exact copy ("Assignments and quizzes — arriving in a future update") and treats them as visually-labelled placeholders, identical to Phase 5's `RosterTab` `DeferredColumn` pattern.
   - What's unclear: Whether `enrolment-dashboard-service.ts`'s return type should include typed `DeferredColumn` fields now (so Phase 10 only widens a type, per `tests/boundary.test.ts`'s own `DeferredColumn` convention) or whether the dashboard component hardcodes the placeholder text with no backing data field at all.
   - Recommendation: Mirror `DeferredColumn = { kind: "deferred"; phase: 9 | 10 | 11 }` from `tests/boundary.test.ts` exactly — add `assessmentObligations: DeferredColumn`, `results: DeferredColumn`, `tickets: DeferredColumn`, `certificate: DeferredColumn` to the dashboard's returned shape now, so Phase 10/11/12 each widen one field's type later instead of restructuring the dashboard service.

2. **RESOLVED — DD-31 (09-13-PLAN.md).** Should the staff-override UI for D-14 (mandatory-reason `LessonProgress` correction) ship in this phase or be explicitly deferred?
   - What we know: UI-SPEC §7.5 flags this as an open item with no staff route on disk, and takes no position beyond "if built this phase, use `ConfirmModal` verbatim."
   - What's unclear: Whether `09-CONTEXT.md`'s D-14 (a locked decision about the *capability*) obligates a staff screen in Phase 9's actual shipped scope, or whether it can be a service-layer-only capability (correct, audited, tested) with the UI surfaced later.
   - Recommendation: Treat D-14 as requiring the SERVICE-layer capability (the function, its authorization, its audit trail, its tests) in Phase 9, and treat the STAFF UI SCREEN for it as a planner discretion call — likely deferrable to a small addition on the existing `staff/cohorts/[id]` roster area without blocking this phase's learner-facing surfaces, consistent with the UI-SPEC's own framing.

3. **RESOLVED — DD-3/DD-9 (09-02-PLAN.md/09-03-PLAN.md).** Exact shape of the `Course.completionRule`/`Programme.completionRule` JSON payload and its versioning relationship to `completionRuleVersion`.
   - What we know: Both columns already exist (`Json?` + `Int @default(1)`), currently untyped/unused. D-10 defines the v1 semantic content (two checks). `CompletionRecord.ruleVersion` records which version was satisfied.
   - What's unclear: Whether `completionRuleVersion` increments automatically whenever `completionRule` JSON changes (mirroring `CoursePublication`'s versioning discipline) or is a manually-set field, and whether the pinned `CoursePublication.payload` (the frozen structure Cohorts pin to) is the actual source the engine should read `completionRule` from — not the live, possibly-since-edited `Course.completionRule` column.
   - Recommendation: Read `completionRule`/`completionRuleVersion` from the PINNED `CoursePublication.payload`/`ProgrammePublication.payload` (the same frozen-snapshot source `CohortCourse.coursePublicationId`/`Cohort.coursePublicationId` already point at), never from the live `Course`/`Programme` row directly — this is consistent with D-05 (Phase 4)'s entire reason for `CoursePublication` existing ("active Cohorts are protected from silent requirement changes"). A live edit to `Course.completionRule` must not retroactively change what an already-enrolled learner is evaluated against.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (new) | Reuses existing session mechanism — no new auth surface this phase |
| V3 Session Management | No (new) | Unchanged |
| V4 Access Control | **Yes** | Ownership-comparison pattern (Pattern 1) for every learner-facing read/write; server-side sequencing enforcement (Pattern 2) so a locked lesson's content is never reachable by direct URL even if the UI lock is bypassed |
| V5 Input Validation | Yes | Server Action inputs (lesson id, watch-percent) validated server-side and re-derived from the session, never trusted as supplied — matches the Next.js docs' own "Safe: take only the change, derive identity from the session" example verbatim |
| V6 Cryptography | No | No new cryptographic surface — presigned URLs are signed by the existing AWS SDK client, unchanged |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Direct navigation to `/learn/[enrolmentId]/...` with another learner's enrolment id (IDOR) | Elevation of Privilege / Information Disclosure | Ownership comparison (Pattern 1) returns the identical "not found" result whether the id doesn't exist or belongs to someone else — never a distinct "forbidden" vs "not found" (matches RBAC-06's existing denial-parity discipline, applied to ownership) |
| Forged `LessonProgress` write bypassing the sequencing lock or the access window (client calls the Server Action directly with a crafted lesson id) | Tampering | LRN-04's "not advanced by unauthorized requests" requirement — every write path re-derives the enrolment from the session actor and re-checks the access window and (for a locked lesson) the sequencing state server-side before writing, never trusting a client-supplied "this lesson is unlocked" flag |
| Forged video watch-percent claiming 90%+ without actually watching (client sends a fabricated `timeupdate` value) | Tampering | Out of this phase's stated threat model per D-09/D-08 (the product accepts client-reported watch position, same trust level as most LMS video-completion tracking); if a stronger anti-gaming control is wanted later it is a v2 concern, not blocking here — flag as a known, accepted limitation rather than silently ignoring it |
| Meeting-link URL exposure before the visibility window via page source / API response inspection | Information Disclosure | Compute `isMeetingLinkVisible` server-side and OMIT `meetingUrl` from the rendered props/HTML entirely when false — never send-then-hide-with-CSS (Code Examples, third example) |
| Presigned URL reused past its TTL / shared outside the authorized session | Information Disclosure | Already mitigated by existing `downloadTtlFor` (60s FILE/IMAGE, 4h VIDEO) — unchanged this phase, just gained a second (learner) authorization predicate in front of it |

## Sources

### Primary (HIGH confidence — direct source read this session)

- `prisma/schema.prisma` (lines 420-1030) — `Lesson`, `LessonProgress`, `CompletionRecord`, `Enrolment`, `Cohort`, `ScheduledSession`, `AttendanceRecord`, `DomainEvent`, `CompletionScope`, `EnrolmentStatus`, `UploadStatus` enums — read directly, not summarized from memory
- `src/server/services/readiness-service.ts` — full file read; pure-evaluator pattern
- `src/server/services/attendance-component.ts` — full file read; attendance component shape and its explicit "Phase 9 reads the payload, don't recompute" instruction
- `src/server/services/attendance-service.ts` (lines 1-46, 340-440) — the exact `attendance.changed` DomainEvent payload shape (`sessionId`, `enrolmentId`, `cohortId`, `before`, `after`, `correction`, `component`, `actorId`)
- `src/server/services/domain-event-service.ts` — full file read; closed `DomainEventType` union, outbox-is-not-a-queue header comment
- `src/server/services/checkout-service.ts` (lines 1-30, 540-610) — ownership-comparison pattern (`getOwnOrder`), explicit header rationale for not using `withPermission`
- `src/server/services/profile-service.ts` (lines 1-40) — second precedent for the same ownership pattern
- `src/server/services/resource-service.ts` — full file read; CRUD factory shape, deliberately NOT the fit for most of this phase's new services
- `src/server/services/lesson-resource-service.ts` (lines 40-360) — `getDownloadableResource`'s current single-caller (`courses.view`) authorization, confirmed as the thing that needs extending
- `src/server/services/enrolment-transitions.ts` — full file read; `VALID_TRANSITIONS` table, the load-bearing "COMPLETED is reachable solely from the Phase 9/11 completion engine" comment (Assumption A1's basis)
- `src/server/permissions/scope.ts` — full file read; confirms `ResourceScope` has no user/enrolment dimension
- `src/server/permissions/with-permission.ts` — full file read; confirms the authorization choke point's design and why it doesn't fit ownership checks
- `src/server/permissions/catalogue.ts` — full file read; confirms the closed 36-identifier permission list has no learner-facing/self entry
- `src/components/catalogue/LessonContent.tsx`, `LessonMediaPlayer.tsx` — full files read; confirms zero-client-JS design and the native-`<video>`/Range-request TTL rationale
- `src/app/api/lesson-resources/[id]/download/route.ts` — full file read; the exact 302/presigned-URL mechanism and its two failure-mode-to-404 mapping
- `src/server/services/storage-service.ts` (lines 173-192) — `presignLessonObjectUrl` implementation
- `tests/boundary.test.ts` (lines 45-93) — `DeferredColumn` convention, confirms `progress`/`assessment`/`completion` roster columns are typed exactly for this phase to widen
- `src/components/shell/LearnerShell.tsx` — full file read; confirms the `nav: LearnerNavItem[]` prop shape this phase extends with a new caller
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` — full file read; sequential per-client dispatch (Pitfall 3's basis), the ownership-derivation security example (Code Examples basis), CSRF/body-size framework protections
- `.planning/phases/09-learning-delivery-progress-tracking/09-CONTEXT.md`, `09-UI-SPEC.md` — full files read
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` — read per task instructions
- `package.json` — version pins for `next`, `react`, `@prisma/client`, `prisma`, `vitest`, `lucide-react`

### Secondary (MEDIUM confidence)

- None — every claim in this document traces to a primary source read during this session; no WebSearch was needed because this phase's domain is entirely internal to the existing codebase's own conventions.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages, every version confirmed by direct `package.json` read
- Architecture: HIGH for reused patterns (ownership scoping, presigned URLs, pure evaluators — all copied from working precedent code); MEDIUM for the two genuinely new mechanisms (completion-engine wiring, video watch-progress tracking) since no prior instance of either exists in this codebase to copy verbatim
- Pitfalls: HIGH — four of five pitfalls are grounded in direct source reads of existing code/docs (Server Actions sequential-dispatch doc, the single-caller download route, the closed DomainEventType union, the enrolment-transitions comment); Pitfall 3's exact throttle interval remains a planner/Claude's-discretion judgment call, not a verified number

**Research date:** 2026-09-14
**Valid until:** 30 days (stable, internal-codebase-driven research; no external library API surface to go stale) — re-verify sooner only if `prisma/schema.prisma`, `domain-event-service.ts`, or `enrolment-transitions.ts` change before planning begins
