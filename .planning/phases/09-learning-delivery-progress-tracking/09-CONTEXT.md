# Phase 9: Learning Delivery & Progress Tracking - Context

**Gathered:** 2026-09-14
**Status:** Ready for planning
**Track:** B — Content & Delivery (depends on Phase 5, Phase 6; runs in parallel with Track A's Phase 8)

<domain>
## Phase Boundary

An enrolled learner has a working self-paced/instructor-led learning experience with
trustworthy, rule-based progress (LRN-01 → LRN-07):

**In scope:**
- Learner-facing enrolment dashboard: next action, progress, scheduled sessions, assessment
  obligations, results, tickets, certificate state — own records only (LRN-01).
- Server-enforced Module/Lesson sequencing with an explained lock condition (LRN-02).
- Secure, accessible content delivery across all Lesson types, reusing the Phase-4 presigned-URL
  pipeline (LRN-03).
- The completion-rule evaluation engine: `LessonProgress`, `CompletionRecord`, recalculation, and
  correction handling (LRN-04, LRN-07) — this is a confirmed, previously-unbuilt gap
  (`.planning/codebase/CONCERNS.md`).
- Manual Lesson completion within LRN-05's constraints (rule permits it, enrolled learner, valid
  access window, reversible per the policy captured below).
- Scheduled-session visibility for eligible learners, meeting-link visibility window (LRN-06) —
  builds on Phase 5's `ScheduledSession.linkVisibleFromMinutes`.
- The self-paced access-duration mechanism that Phase 5 explicitly deferred as "needs a business
  decision before Phase 9."

**Explicitly NOT in scope:**
- Assessment authoring, attempts, grading (Phase 10) — a Course's `completionRule` cannot
  reference assessment criteria yet; this phase's engine only evaluates required-lesson
  completion and (where configured) the attendance threshold Phase 5 already computes.
- Certificate issuance/verification/revocation (Phase 11) — this phase produces the
  `CompletionRecord` evidence Phase 11 will consume.
- Support tickets (Phase 12) — the dashboard's "tickets" slot renders as a named gap.
- Transactional email/notification delivery (Phase 13) — this phase emits domain events; Phase 13
  drains them.

</domain>

<decisions>
## Implementation Decisions

### Self-paced access window
- **D-01:** For a `SELF_PACED` cohort, a learner's access follows a **per-enrolment window**
  (`Enrolment.accessStartsAt` / `accessEndsAt`), not the Cohort's shared `startsAt`/`endsAt`.
  `INSTRUCTOR_LED` and `BLENDED` cohorts are unaffected — they keep using the Cohort-wide dates;
  this decision is scoped to `SELF_PACED` only.
- **D-02:** New nullable field **`Cohort.accessDurationDays` (`Int?`)**. `null` = unlimited
  access (mirrors Udemy's consumer-course default: lifetime access once purchased). A set value
  = that many days from `Enrolment.activatedAt` (mirrors Moodle's own Self-enrolment plugin,
  where the "Enrolment duration" field is blank/0-means-unlimited or a day count from
  enrolment — verified against Moodle's documented behavior, not assumed). Follows the same
  nullable-duration convention as `Cohort.holdMinutes` (Phase 5).
- **D-03:** When a self-paced learner's access window ends without completion, the **Enrolment
  stays `ACTIVE`** — access simply locks read-only past `accessEndsAt`. No new `EnrolmentStatus`
  value, no scheduled sweep/worker job. This is a rendering/authorization concern, not a
  state-machine transition.

### Lesson sequencing & prerequisite locks
- **D-04:** Only **required** lessons (`Lesson.required = true`) gate progression. Optional
  (`required = false`) lessons never block anything — Lesson N+1 unlocks once the most recent
  required lesson at or before it has a `LessonProgress` row.
- **D-05:** Sequencing is a **global path across the whole Course** — not per-Module. Module 2's
  first lesson stays locked until every required lesson in Module 1 is done. (`Course.prerequisites`
  remains free-text marketing copy — it plays no role in the lock mechanism.)
- **D-06:** A locked lesson **names the specific blocking lesson** by title: "Complete
  '<Lesson title>' to unlock this" — not a generic position-based message. Satisfies LRN-02's
  "locked content explains the unmet condition" concretely.
- **D-07:** The first lesson of a Course has no lock, but **nothing is accessible at all unless
  `Enrolment.status = ACTIVE`** — no preview/marketing access during `PENDING_PAYMENT`.

### Completion rule v1 scope
- **D-08:** Lesson completion trigger by content type: **VIDEO auto-completes at 90% watch-through**
  (`LessonProgress.source = "AUTO_VIDEO"`); TEXT/FILE/IMAGE/EMBED/LINK stay **manual mark-complete**
  only (LRN-05, gated on `Lesson.allowManualComplete`).
- **D-09:** Video watch progress needs a **new tracking mechanism** — a field (on `LessonProgress`
  or a supporting table) recording watch-percent/seconds-watched, written periodically by the
  player via a server action; crossing 90% creates the `LessonProgress` row. Exact shape (polling
  interval, client event model, field name) is **Claude's discretion** for research/planning.
- **D-10:** `Course`/`Programme.completionRule` v1 can check exactly two things: **(a) all required
  lessons complete** (always applies) and **(b) attendance ≥ `Cohort.attendanceThresholdPct`**
  (applies only when that field is set — reads the attendance component Phase 5 already computes
  and the `"attendance changed"` `DomainEvent` it already emits). **No assessment criteria** —
  Phase 10 doesn't exist yet, so a v1 `completionRule` cannot reference it.
- **D-11:** Completion recalculation is **reactive**, not scheduled: triggered on every
  `LessonProgress` write, and when Phase 5's `"attendance changed"` `DomainEvent` fires (e.g.
  after an attendance correction). No batch/sweep job.
- **D-12:** When a previously-satisfied completion becomes unsatisfied (e.g. an attendance
  correction drops someone below threshold), the existing `CompletionRecord.supersededAt` is set
  (the field already exists for exactly this) — audit trail preserved, no new `CompletionRecord`
  until the rule is satisfied again.

### Manual completion behavior
- **D-13:** A learner can **freely self-undo** a lesson they manually marked complete — no reason
  required. This is the learner's own record of their own progress, not audit-sensitive like
  attendance.
- **D-14:** **Staff can override** a learner's `LessonProgress` (mark or unmark on their behalf),
  mirroring the Phase-5 attendance-correction pattern: **mandatory reason**, actor + timestamp
  recorded, visible in audit history.
- **D-15:** The self-undo rule in D-13 applies **regardless of source** — a learner can also
  undo an `AUTO_VIDEO`-sourced completion (e.g. to intentionally rewatch before it "counts").
- **D-16:** Un-completing a required lesson **cascades**: any lesson downstream that was only
  unlocked because of it re-locks, consistent with D-04/D-05's gating rule. A learner's own
  progress on those later lessons (if any) is preserved in the database but becomes inaccessible
  until the gating lesson is re-completed.

### Claude's Discretion
- Exact video watch-progress tracking mechanism (D-09): polling interval, client-side event
  model (`timeupdate`, `pause`, `seek`), where the running value lives (new column vs. a small
  supporting table), and whether progress writes are throttled/debounced.
- The Course dashboard's "next action" derivation logic (LRN-01) — which incomplete required
  lesson, upcoming session, or pending obligation surfaces as the headline action.
- The `completionRule` JSON payload's exact shape (schema/versioning of the two v1 rule types
  from D-10) and where the evaluation engine lives (`src/server/services/completion-engine.ts`
  per the CONCERNS.md-suggested path, or split differently) — research should recommend,
  consistent with the resource-service/readiness-service conventions already in this codebase.
- Whether re-locking (D-16) needs to walk the whole downstream chain eagerly on every
  un-complete, or lazily at render time — a performance/implementation choice, not a behavior
  choice.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & product intent
- `.planning/REQUIREMENTS.md` — LRN-01…LRN-07 (lines 86–92); requirement→phase table (lines
  255–261).
- `.planning/intel/requirements.md` — acceptance criteria for LRN-01…LRN-07 (lines 256–296).
- `.planning/codebase/CONCERNS.md` (line ~172) — confirms no completion-rule evaluation engine
  exists yet; suggests `src/server/services/completion-engine.ts`.
- `.planning/ROADMAP.md` §"Phase 9" (line 386 onward) — goal, requirements, success criteria,
  dependency on Phases 5 & 6.
- `.planning/PROJECT.md` — locked constraints (money = integer minor units [not relevant here],
  archive-only, `@prisma/client` boundary, closed permission catalogue).

### Carried forward from Phase 5
- `.planning/phases/05-cohorts-scheduling-enrolment-operations-attendance/05-CONTEXT.md` —
  D-20 (attendance component computed, `"attendance changed"` event emitted, overall completion
  verdict belongs to Phase 9); D-18 (roster's "not tracked yet · Phase 9" named-gap columns this
  phase fills in); the explicit deferred item: "Self-paced access-duration model — needs a
  business decision before Phase 9" (resolved by D-01/D-02/D-03 above).
- `.planning/phases/05-.../05-*-SUMMARY.md` files — Phase 5 completion state.

### Carried forward from Phase 4
- `.planning/phases/04-catalogue-authoring-programmes-courses-modules-lessons/04-CONTEXT.md` —
  D-36/D-37 (presigned-URL download mechanism: Route Handler authorizes via `withPermission`,
  refuses anything not `scanStatus === "CLEAN"`, 302s to a presigned URL; 60s for FILE/IMAGE,
  4h for VIDEO). Phase 9's learner-facing content delivery (LRN-03) reuses this mechanism —
  only the authorization predicate changes (enrolment-scope check instead of staff-role check).

### Code to build on
- `prisma/schema.prisma` — `model Lesson` (641, `position`/`required`/`allowManualComplete`/
  `type: LessonType`), `model LessonProgress` (983, `source` default `"MANUAL"`),
  `model CompletionRecord` (998, `scope`/`ruleVersion`/`evidence`/`supersededAt`),
  `model Enrolment` (911, `accessStartsAt`/`accessEndsAt`/`activatedAt`), `model Cohort` (729,
  `deliveryMode`/`startsAt`/`endsAt`/`holdMinutes` nullable-duration precedent),
  `Course.completionRule` / `Programme.completionRule` (Json?, untyped — this phase gives it
  real shape for the two v1 rule types).
- `model DomainEvent` (971) — the transactional outbox; Phase 5 already inserts
  `"attendance changed"` events this phase's engine subscribes to (read the payload, don't
  recompute).
- `src/server/services/readiness-service.ts` — the pure-evaluator pattern (four-state /
  `NOT_YET_CHECKED` named-gap convention) this phase's completion engine should follow for
  consistency, per Phase 5's own reuse of it.
- `src/server/services/resource-service.ts` — the CRUD factory (list/get/create/update/archive
  with authorization, scoping, audit) that lesson-progress/completion services build on.
- `src/server/permissions/with-permission.ts` + `catalogue.ts` — the authorization choke point.
  **Research must confirm** whether new permission identifiers are needed for learner-facing
  content/progress actions, or whether "own enrolment" scoping suffices without a new
  permission (the closed 36-identifier catalogue currently has no explicit learner-facing
  permission set — Phase 9 may be the first consumer of "self-scope," distinct from
  Global/Programme/Course/Cohort staff scoping).
- `src/components/primitives/` — `ResourceTable`, `ResourceForm`, `DetailLayout`, `ConfirmModal`
  — the staff-side UI kit; the learner dashboard is a new, distinct UI surface (not staff
  console) and may need its own primitives — flag for `/gsd:ui-phase 9`.

### Framework
- `AGENTS.md` / `node_modules/next/dist/docs/` — mandatory per `AGENTS.md`; live Next.js is
  16.3.4 and differs from training data. Read the relevant guide before writing code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`readiness-service.ts`** pattern — pure evaluator + named third state (`NOT_YET_CHECKED`),
  reused twice already (Phase 4 → Phase 5). The completion engine should follow the same shape:
  a pure function over (enrolment, rule, evidence) → satisfied/unmet/not-yet-checked, not a
  stateful service with side effects baked in.
- **`createResourceService`** — gives new services (lesson-progress, completion) authorization/
  scoping/audit for free.
- **Presigned-URL download pipeline** (Phase 4, D-36/D-37) — directly reusable for learner
  content access; only the authorization predicate changes.
- **`DomainEvent` outbox** — already the mechanism Phase 5 uses to signal "attendance changed";
  this phase both consumes that event type and likely emits its own (e.g. "lesson completed",
  "course completed") for Phase 13 to drain later.

### Established Patterns
- **Audit-first writes** — actor / before-after / reason / outcome on every mutation (D-14's
  staff override must follow this, like Phase 5's attendance corrections).
- **`@prisma/client` only in `src/server/services/`** — ESLint-enforced, `tests/boundary.test.ts`.
- **Named gaps, not silent passes** — `NOT_YET_CHECKED` / `deferredTo` convention; Phase 9's
  dashboard "assessment obligations," "tickets," and "certificate state" slots (LRN-01) are
  named gaps pointing at Phases 10/12/11 respectively, the same way Phase 5's roster columns
  pointed at Phase 9.
- **Nullable-duration fields mean "unbounded"** — `Cohort.holdMinutes` (Phase 5) and now
  `Cohort.accessDurationDays` (D-02) share this convention.

### Integration Points
- **Phase 5's `"attendance changed"` `DomainEvent`** → this phase's completion-recalculation
  trigger (D-11).
- **Phase 5's roster "not tracked yet · Phase 9" columns** → this phase's `CompletionRecord`/
  progress data is what finally populates them.
- **Phase 10 (Assessment)** will extend `completionRule`'s rule vocabulary beyond D-10's two
  v1 types — the rule-evaluation engine should be built so adding a rule type doesn't require
  re-architecting it (a small, explicit rule-type dispatch, not a hardcoded two-branch `if`).
- **Phase 11 (Certificates)** consumes this phase's `CompletionRecord` rows as its evidence.
- **Phase 13 (Communications)** will drain whatever domain events this phase emits
  (lesson/course/programme completion) for transactional email.

</code_context>

<specifics>
## Specific Ideas

- The self-paced access-duration decision was cross-checked against two real systems during
  discussion: Udemy's consumer marketplace (lifetime access by default, no expiry) and Moodle's
  Self-enrolment plugin (blank/0 = unlimited, else a day-count from enrolment) — both converge
  on the same nullable-duration design as `Cohort.accessDurationDays`.
- Locked-lesson messaging should name the specific blocking lesson by title, not a generic
  "finish the previous lesson" message — this was an explicit product-quality decision, not
  just a technical default.

</specifics>

<deferred>
## Deferred Ideas

- **Preview/marketing access to content before payment** (e.g. Lesson 1 visible during
  `PENDING_PAYMENT`) — surfaced as an option during discussion and explicitly not chosen; v1
  requires `ACTIVE` enrolment for any content access. Could be a future growth/marketing feature.
- **Per-lesson or per-module access windows distinct from the whole-Course window** — not
  discussed; D-01/D-02 apply the access window at the Enrolment level (whole Course/Programme),
  not per-lesson.
- **Assessment-based completion criteria** — explicitly out of scope until Phase 10 exists;
  the rule-evaluation engine (Claude's Discretion, above) should be extensible enough to add
  this later without a rewrite.

### Reviewed Todos (not folded)
- `2026-09-14-fix-07-review-manual-payment-race-and-idempotency.md` (area: payments) — surfaced
  by keyword match (score 0.6) but is a Phase 7 payment-integrity bug, unrelated to Phase 9's
  learning-delivery domain. Not folded.
- `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` (area: ui) — surfaced by area
  match (score 0.3) but concerns Phase 4.1's staff-side arrange/lesson-editor components, not
  Phase 9's learner-facing surfaces. Not folded.

</deferred>

---

*Phase: 9-Learning Delivery & Progress Tracking*
*Context gathered: 2026-09-14*
