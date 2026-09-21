# Phase 4: Catalogue Authoring — Programmes, Courses, Modules & Lessons - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning
**Track:** B — Content & Delivery (parallel-eligible with Phases 2–3; depends only on Phase 1)

<domain>
## Phase Boundary

Staff-facing authoring for the full content model, plus the public catalogue pages that expose it.

**In scope (CAT-02 → CAT-08):**
- Programmes as ordered sets of *referenced* (never cloned) Courses
- Modules and Lessons inside Courses, with stable ordering
- Eight lesson content types, including a real file-upload pipeline
- Publish-with-versioning that protects active Cohorts from obligation changes
- Scoped Instructor publish (CAT-06)
- Public, read-only Course and Programme catalogue pages, gated on readiness checks
- Archive-without-breaking-history

**Explicitly not in scope:** booking, pricing logic, checkout, catalogue search/filtering (Phase 6);
Cohort creation, scheduling, capacity, instructor assignment (Phase 5); Assessment authoring — questions,
grading, marking (Phase 10).
</domain>

<decisions>
## Implementation Decisions

### Content Versioning (CAT-05)

- **D-01:** **Freeze obligations only.** Publishing snapshots the *rules*, not the prose. Rationale: the
  requirement's wording is "protected from silent **requirement** changes" — it guards a learner's
  obligations, not typo fixes. Body text and media stay live for everyone.
- **D-02:** **Snapshot payload = structure + rules.** FROZEN: which lessons exist, their order, required
  flags, any attached quiz/assignment, the completion rule. LIVE: titles, body text, files, images,
  embeds, links.
- **D-03:** A **withdrawn lesson stays visible-but-inert** to Cohorts pinned to a version that included
  it, so `LessonProgress` and completion records are never orphaned.
- **D-04:** **Programmes get identical treatment.** Publishing a Programme snapshots its course list,
  order, `sequential` flag and completion rule. One mental model, not two.
- **D-05:** **Everything binds to a published snapshot, never to live fields.** A new Cohort starting
  tomorrow gets the last published snapshot, not uncommitted edits. Unpublished obligation changes are
  surfaced on the course as a warning banner.
- **D-06:** **Cohort migration happens in the publish dialog.** Publishing lists every affected running
  Cohort with tick-boxes, **unticked by default**, requires a reason for any ticked, and audits the
  result. Unticked Cohorts stay on their existing snapshot.
- **D-07:** Reordering, adding, withdrawing a lesson, or toggling `required` on a published Course is an
  **unpublished obligation change** — it does not reach any Cohort until republished.

### Publication Model (CAT-06, CAT-07)

- **D-08:** **Two independent switches.** `status` governs learner content; a separate public-listing
  flag governs the public page. All four combinations are legal and each is a real business case:
  draft+unlisted (being written), draft+listed (taking bookings early), published+unlisted
  (private/corporate delivery), published+listed (fully live).
- **D-09:** **Public listing is gated on `programmes.publish`; content publish on `courses.publish`.**
  Listing is a commercial act, not a content act — a scoped Instructor can publish material to enrolled
  learners but cannot put a course on public sale. The permission catalogue is closed, so no new
  identifiers are introduced.
- **D-10:** **Public pages are read-only index + detail this phase.** Index of listed Courses and
  Programmes; detail pages rendering existing fields (title, summary, outcomes, audience, prerequisites,
  duration) plus upcoming Cohorts. No booking, pricing, search or filters — Phase 6 hangs checkout onto
  pages that already exist.
- **D-11:** **Slug freezes on first public listing.** Editable while unlisted, immutable afterwards, so
  renaming a title never breaks bookmarks or search results. No redirect machinery. Admin-only override,
  audited.
- **D-12:** **Content cannot be unpublished while Cohorts are running** — the control names the blocking
  Cohorts. Public listing can always be switched off, so sales stop immediately without pulling material
  away from people mid-study.
- **D-13:** **Staff can preview both views** — the public sales page and the learner lesson view — from
  the staff detail page, gated on `courses.view` in scope. No tokens, no shareable links.

### Archiving (CAT-08)

- **D-14:** **A running Cohort blocks archiving** (same rule as unpublish, so staff learn one principle).
  Programme membership only warns: it names the programmes, requires a reason, and removes the course from
  their *draft* ordering while leaving already-published programme snapshots untouched.
- **D-15:** **Past learners keep read access indefinitely.** Anyone with a completion record or enrolment
  can still read the material, so a certificate always has something real behind it. Gone from the public
  catalogue and every new-sale flow. Staff with `courses.view` see it flagged Archived.
- **D-16:** **Un-archiving returns to DRAFT + unlisted** — never straight back to published or on sale.
  Re-publishing is deliberate and re-runs the readiness checks. Same permission as archiving, reason
  required, audited.
- **D-17:** **Modules and Lessons soft-delete via `withdrawnAt`.** They have no status field today and
  cascade-delete, which contradicts both the project-wide no-hard-deletes rule and D-03. Withdrawn items
  vanish from authoring and future snapshots but stay readable for pinned Cohorts.
- **D-18:** **Programmes archive under the same rules as Courses.** Course membership is informational
  only — courses are referenced, not owned, and survive independently in other programmes.

### Authoring: Structure & Reordering (CAT-02, CAT-03)

- **D-19:** **Drag-and-drop with move up/down arrows as the mandatory keyboard path.** WCAG 2.2 AA
  (NFR-09) is a locked constraint, so the accessible path ships *alongside*, not instead.
- **D-20:** **Explicit "Save order"** — rearrange freely, commit the whole arrangement at once.
- **D-21:** **Lessons can move between Modules.** Dragging re-parents (`lesson.moduleId`) and renumbers
  both source and destination in one transaction.
- **D-22:** **Warn on navigate-away, block on publish** when a rearrangement is unsaved. Publishing stale
  order would snapshot the wrong arrangement (D-02), so it is refused outright.
- **D-23:** **Optimistic version check on save** delivers CAT-03's "ordering is stable after save." The
  page carries the record's `updatedAt`; the server refuses the write if it has moved, telling the loser
  someone else reordered it and offering a reload. No new column needed.
- **D-24:** **The `required` toggle lives on the lesson form**, saved with the lesson. The arrange view
  shows a read-only Required/Optional badge, keeping the order screen about order and obligation edits on
  the deliberate path.

### Readiness Checks (CAT-07)

- **D-25:** **Hard gate on a small core, warnings for the rest.** BLOCKS listing: no title or summary,
  no modules, or a module with no lessons. WARNS but allows: **content not yet published**, no outcomes,
  no duration, no prerequisites stated, no upcoming Cohorts. A short block list means staff never fight
  it.

  > **Amended 2026-09-02 after plan verification.** "Content not published" was originally a blocking
  > item, which made D-08's *draft + listed* combination — taking bookings before the lessons are
  > finished — impossible to create rather than merely unusual. Two locked decisions contradicted each
  > other. User ruling: **D-08 wins**; "content not published" is demoted to a warning so the
  > early-bookings case is genuinely reachable. The other four blockers stand.
- **D-26:** **Every PXR category is present; Phase 5 ones render as named gaps.** Schedule, price,
  capacity and instructors show an explicit "not yet checked — Phase 5" state, neither tick nor cross.
  This honours the PXR instruction that decisions stay *named gaps rather than silently assumed pass*,
  and lets Phase 5 fill slots without redesigning the UI.
- **D-27:** **Persistent panel on the course detail page, plus the same summary in the listing dialog.**
  One shared component, one shared evaluator.

### Lesson Content & Uploads (CAT-04)

- **D-28:** **Full upload pipeline, all types.** Upload to MinIO (already provisioned in
  `docker-compose.yml`), a pg-boss job to scan, short-lived authorized download links — for files, images
  and video alike. The mechanism is identical across all three; video adds only a size limit and a player.
  Phases 10 (`Submission`) and 12 (`TicketAttachment`) inherit the same pipeline through their existing
  `scanStatus` fields.
- **D-29:** **Rich text editor with a constrained toolbar.** Bold, italic, H2, H3, bulleted list, numbered
  list, link. No font sizes, families, colour pickers, or H1 (the page title owns H1). Staff *cannot* fake
  a heading, so WCAG 2.2 AA holds structurally rather than by discipline, and the sanitisation allow-list
  stays small.
- **D-30:** **`Lesson.body` stores sanitized HTML** against a strict allow-list
  (`h2 h3 p ul ol li strong em a`), cleaned on save and again on render. Readable in the database,
  portable if the editor changes, and renders with no client-side library on the learner page — which
  matters for the p75 ≤2.5s target (NFR-02).
- **D-31:** **QUIZ and ASSIGNMENT lessons exist with an empty picker.** They take their place in the
  order and the required-flags; the assessment picker has nothing to choose yet and readiness flags it as
  a named gap. Phase 10 fills the picker without touching the lesson model.

### Post-Research Decisions (added 2026-09-02 after `04-RESEARCH.md`)

- **D-32:** **Testcontainers for database-semantics tests.** The two-pass reorder transaction and the
  `updatedAt` optimistic check are the phase's highest-risk mechanisms and neither is provable against a
  mock — the deferred-constraint trap passes small tests and fails in production. Tests spin up a real
  `postgres:16-alpine`, run `prisma migrate deploy`, and exercise the real unique indexes. Accepts a new
  dev dependency, a slower suite, and Docker as a prerequisite for running tests.
- **D-33:** **Add a multi-stage Dockerfile; the scan worker is its own Compose service.** The repo has no
  Dockerfile despite PROJECT.md naming Docker Compose as the deployment target, which blocks D-28's
  worker outright. App and worker share one image with different entrypoints. This also produces the
  deployable artefact Phase 15 (launch readiness) needs regardless.
- **D-34:** **Withdrawn items get a collapsed section with Restore.** Closes a gap in D-17: withdrawn
  Modules and Lessons vanished from authoring with no way back, making a mis-click unrecoverable through
  the product. The arrange view gains a collapsed "Withdrawn (n)" section at the bottom with a Restore
  action per row. Restoring appends to the end of the order rather than guessing the original position.

- **D-35:** **Production object storage is Cloudflare R2; MinIO stays for dev and CI.** "Self-hosted" was a
  default, not a client requirement (user-confirmed 2026-09-02), so `PROJECT.md`'s deployment constraint
  was amended. Both speak the S3 API, so `@aws-sdk/client-s3` and all application code are identical
  across environments — only `S3_ENDPOINT`, `forcePathStyle` and credentials differ. R2 charges no
  egress, which dominates cost for video lessons, and supplies NFR-08 durability without the team owning
  a MinIO volume backup and restore rehearsal.
- **D-36:** **Downloads use presigned URLs, not app streaming.** R2 has a real public hostname with TLS,
  so a presigned GET works in the browser directly and the research's `[ASSUMED]` streaming workaround is
  unnecessary. The Route Handler authorizes via `withPermission`, refuses anything not
  `scanStatus === "CLEAN"`, then 302s to a 60-second presigned URL. Video bytes never pass through the
  Next.js process, protecting NFR-02 (p75 ≤2.5s) and NFR-01 (availability). Uses
  `@aws-sdk/s3-request-presigner` — no hand-rolled HMAC token, which the research itself lists as an
  anti-pattern. Satisfies NFR-06: short-lived, never a stored URL, unpredictable object path.

- **D-37:** **Presigned-URL lifetime is per content type: 60 seconds for FILE/IMAGE, 4 hours for VIDEO.**
  A single TTL cannot work for both. A `<video>` element follows the 302 once and then issues HTTP Range
  requests against the *resolved* presigned URL, so a 60-second window stalls playback partway through —
  and the 2 GB VIDEO cap makes that certain, not merely possible. Documents and images resolve in one
  request and keep the tight window. Four hours outlasts any single sitting, including a long lesson
  watched with pauses, while a leaked link dies the same working day. Still satisfies NFR-06: the object
  path is unpredictable, the URL is never stored, never public, and never permanent. The plans must state
  which Range-request behaviour the design assumes, and a checkpoint must play a video past the TTL
  rather than only confirming it uploads and scans clean.

### Schema Changes Implied

These follow from the decisions above and are the planner's starting point:

1. **Obligation snapshot table** for Course and Programme — lesson set, order, required flags, attached
   assessment, completion rule (Course); course list, order, `sequential`, completion rule (Programme).
   `Cohort` pins a snapshot id. (D-01, D-02, D-04, D-05)

   > **Corrected 2026-09-02 after research.** An earlier draft of this section stated that no snapshot
   > storage exists. That was wrong: `CohortCourse.contentSnapshot Json?` already exists
   > (`prisma/schema.prisma:637`) with a comment describing D-01/D-02's exact intent. It is not
   > sufficient on its own — a per-cohort JSON copy cannot answer D-05 ("what does a *new* cohort get")
   > or D-06 ("which cohorts are currently on version N"), because neither question is about any single
   > cohort. A publication table keyed per publish, with `CohortCourse` pinning it by foreign key, is
   > still required. The existing column is where the pinned payload is read from, not a replacement for
   > the publication record. See `04-RESEARCH.md`.
2. **Public-listing flag** on `Course` and `Programme`, separate from `status`. (D-08)
3. **`withdrawnAt`** timestamp on `Module` and `Lesson`. (D-17)
4. **Slug immutability** once first publicly listed. (D-11)
5. **No new column for lesson content** — `Lesson.body` holds sanitized HTML; `LessonResource` already
   carries `storageKey` / `mimeType` / `sizeBytes` / `scanStatus`.

### Claude's Discretion

The user decided every gray area presented; nothing was delegated. Three implementation choices are left
to research and planning rather than settled here:

- **Drag-and-drop library** — must support a keyboard-accessible fallback and pointer/touch input.
- **Virus-scanning engine and its pg-boss job shape** — no scanner dependency exists in `package.json`,
  and no pg-boss worker service exists in `docker-compose.yml` yet.
- **HTML sanitiser** — must run on write *and* on render (D-30).

### Correction Recorded

An initial recommendation of Markdown over a rich text editor was overridden by the user and the
reasoning re-examined: the people authoring lessons are Programme Managers and Instructors, not
developers, so a recurring daily learning cost on them outweighs one-time implementation cost. Two of the
four arguments for Markdown do not survive the follow-up decisions — the accessibility argument is
neutralised by the constrained toolbar (D-29), and the versioning argument does not apply because prose
is never frozen (D-02). What genuinely remains is the sanitisation surface and the editor dependency,
both accepted.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product authority
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` — product authority;
  wins on any conflict with the PXR
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` — UI/workflow spec;
  source of the readiness-checklist categories and the "named gaps rather than silently assumed pass" rule

### Project state
- `.planning/ROADMAP.md` §Phase 4 — goal, requirements, success criteria, track and dependency flags
- `.planning/REQUIREMENTS.md` — CAT-02 → CAT-08 acceptance criteria (lines 37–43)
- `.planning/PROJECT.md` — locked constraints, key decisions, known gaps
- `.planning/intel/constraints.md` — synthesised constraints; note the hoisted Next.js version correction
  at the head of the Track A foundation bullet

### Code to build on
- `src/server/services/course-service.ts` — the reference resource-service; copy its shape, never its
  authorization (the factory owns that)
- `src/server/services/resource-service.ts` — CRUD factory: list/get/create/update/archive. **Has no
  publish operation** — publish is new surface in this phase
- `src/server/permissions/catalogue.ts` — the closed 36-identifier catalogue
- `src/server/permissions/with-permission.ts` — the authorization choke point
- `src/components/primitives/index.ts` — `ResourceTable`, `ResourceForm`, `DetailLayout`, `ConfirmModal`
- `prisma/schema.prisma` lines 420–575 — `Programme`, `ProgrammeCourse`, `Course`, `Module`, `Lesson`,
  `LessonResource`
- `docker-compose.yml` — MinIO and Postgres already provisioned; no pg-boss worker service yet

### Framework
- `node_modules/next/dist/docs/` — **mandatory** per `AGENTS.md`. This Next.js differs from training data;
  read the relevant guide before writing code. Live version is 16.3.4

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createResourceService`** — gives list/get/create/update/archive with authorization, scoping and
  audit for free. Programme, Module and Lesson services should all be built on it.
- **`ResourceTable` / `ResourceForm` / `DetailLayout` / `ConfirmModal`** — the staff workspace already
  runs on these; the Courses screens are the working example to mirror.
- **`courseScope(id)`** — the pattern for turning a record id into a `ResourceScope`. Programme needs its
  equivalent; Modules and Lessons resolve to their parent Course's scope.
- **MinIO + Postgres in `docker-compose.yml`** — storage is provisioned, just unwired.

### Established Patterns
- **Authorization is never written by hand.** Everything routes through `withPermission`; a service that
  re-implements a scope check is doing it wrong.
- **`@prisma/client` may only be imported from `src/server/services/`**, enforced by ESLint, not
  convention. Tested by `tests/boundary.test.ts`.
- **Audit-first writes** — the factory records actor, before/after, reason and outcome on every mutation.
- **Archive, never delete** — project-wide.

### Integration Points
- **The permission catalogue is closed.** No `modules.*` or `lessons.*` exist and none may be added.
  Module and Lesson authoring gates on `courses.edit`; Programme authoring on `programmes.manage`;
  content publish on `courses.publish`; public listing on `programmes.publish` (D-09).
- **Publish is new surface** — the factory stops at archive. Whatever shape it takes must be shared by
  Course and Programme, since D-04 gives them identical semantics.
- **`CohortCourse.contentSnapshot Json?` already exists** (`prisma/schema.prisma:637`) and is where a
  pinned cohort's obligations are read from. What is missing is the publication record it should point
  at. Phase 5 owns Cohort authoring, so this phase defines the publication table, the FK pin and the read
  path; Phase 5 builds the UI around it.
- **Reordering cannot use deferred constraints.** Prisma emitted the position uniqueness as
  `CREATE UNIQUE INDEX` (`prisma/migrations/20260901115332_init/migration.sql:827,839,845`), and
  PostgreSQL can only defer *constraints*, not indexes — `SET CONSTRAINTS ALL DEFERRED` would silently do
  nothing and pass small tests before failing in production. The reorder needs a two-pass negative-offset
  transaction. See `04-RESEARCH.md`.
- **Video upload cannot go through a Server Action** — they cap at 1 MB, so D-28's video path needs a
  Route Handler.
- **Public catalogue pages prerender at build and will never update** unless explicitly handled. The
  existing staff pages are dynamic only incidentally, via `cookies()`.
- **Three models carry `scanStatus`** — `LessonResource` (line 561), `Submission` (895),
  `TicketAttachment` (1200). Build the pipeline once; Phases 10 and 12 inherit it.
- **No `error.tsx` / `not-found.tsx` exist yet** — and CAT-07 requires unpublished public URLs to return
  404, not 403 (a 403 confirms existence). This phase needs at least `not-found.tsx`.

</code_context>

<specifics>
## Specific Ideas

- The publish dialog's Cohort list should show enough to decide with — Cohort code, learner count, and end
  date — not just an identifier.
- Readiness gaps belonging to Phase 5 should read as a distinct third state ("not yet checked — Phase 5"),
  visually different from both pass and fail.
- The arrange view shows Required/Optional as a read-only badge so staff can see a course's whole
  obligation shape in one screen without being able to edit it there.

</specifics>

<deferred>
## Deferred Ideas

- **Catalogue search and filtering** — raised while scoping public pages; belongs with discovery in
  Phase 6 alongside checkout.
- **Booking and pricing on public pages** — Phase 6. This phase builds the pages they attach to.
- **Cohort-side readiness checks** (schedule, price, capacity, instructors) — Phase 5 fills the named-gap
  slots this phase creates.
- **Assessment authoring** (questions, grading, marking) — Phase 10 fills the empty picker from D-31.
- **Slug redirect history** — rejected in favour of freezing the slug (D-11). If URLs ever need to change
  at scale, a historical-slug lookup table is the fallback.

</deferred>

---

*Phase: 4-Catalogue Authoring — Programmes, Courses, Modules & Lessons*
*Context gathered: 2026-09-02*
