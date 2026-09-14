# Phase 4: Catalogue Authoring — Programmes, Courses, Modules & Lessons - Research

**Researched:** 2026-09-02
**Domain:** Content authoring (ordered hierarchies), publish-time versioning, rich text + file pipeline, public catalogue pages — on Next.js 16.3.4 App Router / React 19.2.8 / Prisma 6.19.3 / PostgreSQL
**Confidence:** HIGH on framework mechanics and schema findings (read from installed source), MEDIUM on library recommendations (verified on registry + GitHub, evaluated against locked constraints), LOW on nothing material.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Content Versioning (CAT-05)**
- **D-01:** **Freeze obligations only.** Publishing snapshots the *rules*, not the prose. Rationale: the requirement's wording is "protected from silent **requirement** changes" — it guards a learner's obligations, not typo fixes. Body text and media stay live for everyone.
- **D-02:** **Snapshot payload = structure + rules.** FROZEN: which lessons exist, their order, required flags, any attached quiz/assignment, the completion rule. LIVE: titles, body text, files, images, embeds, links.
- **D-03:** A **withdrawn lesson stays visible-but-inert** to Cohorts pinned to a version that included it, so `LessonProgress` and completion records are never orphaned.
- **D-04:** **Programmes get identical treatment.** Publishing a Programme snapshots its course list, order, `sequential` flag and completion rule. One mental model, not two.
- **D-05:** **Everything binds to a published snapshot, never to live fields.** A new Cohort starting tomorrow gets the last published snapshot, not uncommitted edits. Unpublished obligation changes are surfaced on the course as a warning banner.
- **D-06:** **Cohort migration happens in the publish dialog.** Publishing lists every affected running Cohort with tick-boxes, **unticked by default**, requires a reason for any ticked, and audits the result. Unticked Cohorts stay on their existing snapshot.
- **D-07:** Reordering, adding, withdrawing a lesson, or toggling `required` on a published Course is an **unpublished obligation change** — it does not reach any Cohort until republished.

**Publication Model (CAT-06, CAT-07)**
- **D-08:** **Two independent switches.** `status` governs learner content; a separate public-listing flag governs the public page. All four combinations are legal and each is a real business case: draft+unlisted (being written), draft+listed (taking bookings early), published+unlisted (private/corporate delivery), published+listed (fully live).
- **D-09:** **Public listing is gated on `programmes.publish`; content publish on `courses.publish`.** Listing is a commercial act, not a content act — a scoped Instructor can publish material to enrolled learners but cannot put a course on public sale. The permission catalogue is closed, so no new identifiers are introduced.
- **D-10:** **Public pages are read-only index + detail this phase.** Index of listed Courses and Programmes; detail pages rendering existing fields (title, summary, outcomes, audience, prerequisites, duration) plus upcoming Cohorts. No booking, pricing, search or filters — Phase 6 hangs checkout onto pages that already exist.
- **D-11:** **Slug freezes on first public listing.** Editable while unlisted, immutable afterwards, so renaming a title never breaks bookmarks or search results. No redirect machinery. Admin-only override, audited.
- **D-12:** **Content cannot be unpublished while Cohorts are running** — the control names the blocking Cohorts. Public listing can always be switched off, so sales stop immediately without pulling material away from people mid-study.
- **D-13:** **Staff can preview both views** — the public sales page and the learner lesson view — from the staff detail page, gated on `courses.view` in scope. No tokens, no shareable links.

**Archiving (CAT-08)**
- **D-14:** **A running Cohort blocks archiving** (same rule as unpublish, so staff learn one principle). Programme membership only warns: it names the programmes, requires a reason, and removes the course from their *draft* ordering while leaving already-published programme snapshots untouched.
- **D-15:** **Past learners keep read access indefinitely.** Anyone with a completion record or enrolment can still read the material, so a certificate always has something real behind it. Gone from the public catalogue and every new-sale flow. Staff with `courses.view` see it flagged Archived.
- **D-16:** **Un-archiving returns to DRAFT + unlisted** — never straight back to published or on sale. Re-publishing is deliberate and re-runs the readiness checks. Same permission as archiving, reason required, audited.
- **D-17:** **Modules and Lessons soft-delete via `withdrawnAt`.** They have no status field today and cascade-delete, which contradicts both the project-wide no-hard-deletes rule and D-03. Withdrawn items vanish from authoring and future snapshots but stay readable for pinned Cohorts.
- **D-18:** **Programmes archive under the same rules as Courses.** Course membership is informational only — courses are referenced, not owned, and survive independently in other programmes.

**Authoring: Structure & Reordering (CAT-02, CAT-03)**
- **D-19:** **Drag-and-drop with move up/down arrows as the mandatory keyboard path.** WCAG 2.2 AA (NFR-09) is a locked constraint, so the accessible path ships *alongside*, not instead.
- **D-20:** **Explicit "Save order"** — rearrange freely, commit the whole arrangement at once.
- **D-21:** **Lessons can move between Modules.** Dragging re-parents (`lesson.moduleId`) and renumbers both source and destination in one transaction.
- **D-22:** **Warn on navigate-away, block on publish** when a rearrangement is unsaved. Publishing stale order would snapshot the wrong arrangement (D-02), so it is refused outright.
- **D-23:** **Optimistic version check on save** delivers CAT-03's "ordering is stable after save." The page carries the record's `updatedAt`; the server refuses the write if it has moved, telling the loser someone else reordered it and offering a reload. No new column needed.
- **D-24:** **The `required` toggle lives on the lesson form**, saved with the lesson. The arrange view shows a read-only Required/Optional badge, keeping the order screen about order and obligation edits on the deliberate path.

**Readiness Checks (CAT-07)**
- **D-25:** **Hard gate on a small core, warnings for the rest.** BLOCKS listing: no title or summary, content not published, no modules, or a module with no lessons. WARNS but allows: no outcomes, no duration, no prerequisites stated, no upcoming Cohorts. A short block list means staff never fight it.
- **D-26:** **Every PXR category is present; Phase 5 ones render as named gaps.** Schedule, price, capacity and instructors show an explicit "not yet checked — Phase 5" state, neither tick nor cross. This honours the PXR instruction that decisions stay *named gaps rather than silently assumed pass*, and lets Phase 5 fill slots without redesigning the UI.
- **D-27:** **Persistent panel on the course detail page, plus the same summary in the listing dialog.** One shared component, one shared evaluator.

**Lesson Content & Uploads (CAT-04)**
- **D-28:** **Full upload pipeline, all types.** Upload to MinIO (already provisioned in `docker-compose.yml`), a pg-boss job to scan, short-lived authorized download links — for files, images and video alike. The mechanism is identical across all three; video adds only a size limit and a player. Phases 10 (`Submission`) and 12 (`TicketAttachment`) inherit the same pipeline through their existing `scanStatus` fields.
- **D-29:** **Rich text editor with a constrained toolbar.** Bold, italic, H2, H3, bulleted list, numbered list, link. No font sizes, families, colour pickers, or H1 (the page title owns H1). Staff *cannot* fake a heading, so WCAG 2.2 AA holds structurally rather than by discipline, and the sanitisation allow-list stays small.
- **D-30:** **`Lesson.body` stores sanitized HTML** against a strict allow-list (`h2 h3 p ul ol li strong em a`), cleaned on save and again on render. Readable in the database, portable if the editor changes, and renders with no client-side library on the learner page — which matters for the p75 ≤2.5s target (NFR-02).
- **D-31:** **QUIZ and ASSIGNMENT lessons exist with an empty picker.** They take their place in the order and the required-flags; the assessment picker has nothing to choose yet and readiness flags it as a named gap. Phase 10 fills the picker without touching the lesson model.

**Schema Changes Implied (planner's starting point)**
1. **Obligation snapshot table** for Course and Programme — lesson set, order, required flags, attached assessment, completion rule (Course); course list, order, `sequential`, completion rule (Programme). `Cohort` pins a snapshot id. (D-01, D-02, D-04, D-05)
2. **Public-listing flag** on `Course` and `Programme`, separate from `status`. (D-08)
3. **`withdrawnAt`** timestamp on `Module` and `Lesson`. (D-17)
4. **Slug immutability** once first publicly listed. (D-11)
5. **No new column for lesson content** — `Lesson.body` holds sanitized HTML; `LessonResource` already carries `storageKey` / `mimeType` / `sizeBytes` / `scanStatus`.

### Claude's Discretion

The user decided every gray area presented; nothing was delegated. Three implementation choices are left to research and planning rather than settled here:

- **Drag-and-drop library** — must support a keyboard-accessible fallback and pointer/touch input.
- **Virus-scanning engine and its pg-boss job shape** — no scanner dependency exists in `package.json`, and no pg-boss worker service exists in `docker-compose.yml` yet.
- **HTML sanitiser** — must run on write *and* on render (D-30).

### Deferred Ideas (OUT OF SCOPE)

- **Catalogue search and filtering** — raised while scoping public pages; belongs with discovery in Phase 6 alongside checkout.
- **Booking and pricing on public pages** — Phase 6. This phase builds the pages they attach to.
- **Cohort-side readiness checks** (schedule, price, capacity, instructors) — Phase 5 fills the named-gap slots this phase creates.
- **Assessment authoring** (questions, grading, marking) — Phase 10 fills the empty picker from D-31.
- **Slug redirect history** — rejected in favour of freezing the slug (D-11). If URLs ever need to change at scale, a historical-slug lookup table is the fallback.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAT-02 | Programmes are ordered sets of one or more existing Courses; add/remove/reorder in draft; one Course in many Programmes without cloning | `ProgrammeCourse` join already exists with `@@unique([programmeId, courseId])` + `@@unique([programmeId, position])`. Reorder mechanics: §Pattern 3 (two-pass negative offset). `programmeService` built on `createResourceService`. |
| CAT-03 | Ordered Modules and Lessons inside a Course; add, reorder, edit, preview, mark required; ordering stable after save | §Pattern 3 (reorder transaction), §Pattern 4 (optimistic `updatedAt` check for D-23), §Standard Stack (drag-and-drop = `@hello-pangea/dnd` + arrow buttons), §Pattern 6 (Link `onNavigate` blocking for D-22) |
| CAT-04 | Text, files, images, uploaded video, embeds, links, Quizzes, Assignments; each validates format/size and renders accessibly | §Standard Stack (Tiptap + sanitize-html + AWS SDK v3 + pg-boss + ClamAV), §Pattern 7/8 (upload + download path), §Don't Hand-Roll |
| CAT-05 | Published content is versioned; active Cohorts protected from silent requirement changes; staff choose which version applies | §Pattern 1 (`CoursePublication` / `ProgrammePublication` JSON snapshot + FK pin). **Critical finding:** `CohortCourse.contentSnapshot Json?` already exists in the schema — see §Existing Schema Findings. |
| CAT-06 | Instructor with `courses.publish` in matching scope can publish an assigned Course; control + server action gated; records actor, version, time | §Pattern 2 (`createPublishOperation` extending the factory). `CoursePublication` row carries `publishedById`, `version`, `publishedAt`. `withPermission("courses.publish", courseScope)`. |
| CAT-07 | Public pages published independently of learning-content state; only readiness-passing offers appear; direct unpublished URLs reveal nothing | §Next.js 16 Specifics (`notFound()` before streaming for a true 404), §Pattern 5 (readiness evaluator), `publiclyListed` flag gated on `programmes.publish` |
| CAT-08 | Archive without breaking historical enrolments/results/certificates; gone from new-sale flows; readable where policy permits | Factory `archive` already sets `status: "ARCHIVED"`; needs the running-Cohort guard (D-14) and `withdrawnAt` on Module/Lesson (D-17). §Pattern 9. |
</phase_requirements>

---

## Summary

This phase is mostly **schema + service + transaction work**, with three genuinely new external dependencies (an editor, a sanitiser, a storage/queue/scan pipeline) and one new UI capability (drag-and-drop). The existing foundation carries more of it than the CONTEXT.md schema notes assume: the Prisma schema **already contains** `CohortCourse.contentSnapshot Json?` and `contentVersion Int`, with a comment stating exactly the obligation-freeze intent of D-01/D-02. The snapshot design should build on that intent rather than invent a parallel one.

Two findings change the shape of the plan and should be read before anything else:

1. **`SET CONSTRAINTS ... DEFERRED` will not work here.** Prisma emitted `@@unique([courseId, position])` as `CREATE UNIQUE INDEX "Module_courseId_position_key"`, not as a table constraint (verified in `prisma/migrations/20260901115332_init/migration.sql:827,839,845`). PostgreSQL can only defer *constraints*, never bare unique *indexes*. The whole-list reorder must therefore use the two-pass negative-offset technique inside one `prisma.$transaction`, or the migration must replace the index with a `DEFERRABLE` constraint (which creates Prisma-migrate drift). Recommendation: two-pass. See §Pattern 3.

2. **Server Actions cap request bodies at 1 MB by default** (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:83`). Uploaded video (D-28) cannot travel through a Server Action. The upload path must be a Route Handler — which has no equivalent framework limit (`.../03-file-conventions/route.md:597`) — with the metadata write and job enqueue happening after the object lands.

Everything else is conventional: extend `createResourceService` with a shared publish operation, add four small schema deltas, and add a separate `worker` process to `docker-compose.yml` running pg-boss against the same Postgres.

> **Superseded in two places by decisions taken after this research, 2026-09-02.**
> - **Storage (D-35):** production object storage is Cloudflare R2, not MinIO. MinIO remains for local
>   development and CI. Both speak S3, so every library choice below stands unchanged — only `S3_ENDPOINT`,
>   `forcePathStyle` and credentials differ by environment.
> - **Downloads (D-36):** downloads presign and 302 rather than streaming through the app. This reverses
>   assumption A2 below, whose only argument was that a URL signed for `http://minio:9000` is unresolvable
>   from a browser — an objection R2's public hostname removes. `@aws-sdk/s3-request-presigner` is
>   therefore load-bearing, not optional.
> - **Download lifetime (D-37):** the presigned expiry is per content type — 60 seconds for FILE and IMAGE,
>   4 hours for VIDEO. A `<video>` element follows the 302 once and then Range-requests the resolved URL,
>   so a single tight TTL stalls playback partway through a long lesson.
>
> Also note the D-25 amendment in `04-CONTEXT.md`: "content not published" is a readiness WARNING, not a
> blocking item, so D-08's draft+listed early-bookings case is reachable.

**Primary recommendation:** Use `@hello-pangea/dnd` for drag-and-drop, `@tiptap/react` (extension-restricted to exactly D-29's seven marks/nodes) for authoring, `sanitize-html` for the write-and-render allow-list, and `@aws-sdk/client-s3` + `pg-boss` + a `clamav/clamav` Compose service for the file pipeline. Model obligation snapshots as immutable `CoursePublication` / `ProgrammePublication` rows with a JSON payload, pinned by foreign key from `CohortCourse` / `Cohort`.

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

`./CLAUDE.md` is a single `@AGENTS.md` include. `./AGENTS.md` contains one managed directive block:

| Directive | Enforcement in this research |
|-----------|------------------------------|
| "This is NOT the Next.js you know. This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices." | Every Next.js claim in this document cites a file under `node_modules/next/dist/docs/` read during this session. No Next.js claim is from training data. |
| The managed block is re-written by `next dev` — committing it with your work keeps the tree clean. | Planner: do not delete the `<!-- BEGIN:nextjs-agent-rules -->` block from `AGENTS.md`. |

**Additional project-wide constraints inherited from `.planning/PROJECT.md` (treat as locked):**

- `@prisma/client` imports only from `src/server/services/**` and `src/server/db.ts` — ESLint `no-restricted-imports`, tested by `tests/boundary.test.ts`. The rule's `files` glob is `src/**/*.{ts,tsx}`, so a worker placed **outside** `src/` is unconstrained by it. Keep the worker's data access in services anyway.
- Permission catalogue is closed at 36 identifiers. No `modules.*`, no `lessons.*`, no `catalogue.*`.
- No hard deletes anywhere.
- Money in integer minor units.
- Agent workers must not run `git commit` — report the suggested message.
- WCAG 2.2 AA (NFR-09); p75 ≤2.5s interactive (NFR-02); private storage only with short-lived authorized access, no public storage URLs, no predictable object paths (NFR-06).

**Project skills:** No `.claude/skills/` or `.agents/skills/` directory exists. [VERIFIED: filesystem]

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reorder commit (Module/Lesson/ProgrammeCourse) | API / Backend (service + `$transaction`) | Browser (optimistic list state only) | The unique-index invariant and the `updatedAt` concurrency check (D-23) are database-level facts. The browser holds *proposed* order; only the server holds *committed* order. |
| Drag-and-drop interaction | Browser / Client | — | Pointer/touch events and animation are inherently client-side. Ships as a `"use client"` island inside a server-rendered arrange page. |
| Move up/down keyboard path (D-19) | Browser / Client | API (same commit action) | Must mutate the same client-side proposed-order array as dragging, then commit through the identical server action. Two code paths into one commit, not two commits. |
| HTML sanitisation on save | API / Backend | — | Client-side sanitisation is advisory only; a Server Action is a public POST endpoint (`server-actions.md` §Security). |
| HTML sanitisation on render (D-30) | Frontend Server (RSC) | — | The learner lesson view is a Server Component; sanitising there means zero client JS for content rendering, which is the NFR-02 argument in D-30. |
| Rich text editing | Browser / Client | — | ProseMirror requires a DOM. Staff-only bundle; never loaded on the learner or public page. |
| File upload transport | API / Backend (Route Handler) | Browser (multipart form / fetch) | Server Actions cap at 1 MB. Route Handlers do not. See §Next.js 16 Specifics. |
| Object storage | Database / Storage (MinIO) | API (S3 client) | MinIO stays on the internal Docker network; the app is the only S3 client. |
| Virus scanning | Separate worker process (pg-boss consumer) | Database / Storage (ClamAV container) | Scanning is slow and memory-heavy; it must not occupy a request thread or a Next.js server instance. |
| Readiness evaluation (D-25/D-27) | API / Backend (pure function over a loaded aggregate) | Frontend Server (renders the panel) | One evaluator shared by the detail panel and the listing dialog (D-27) means it cannot live in a component. |
| Public catalogue pages | Frontend Server (RSC) | CDN / Static (ISR) | Anonymous, read-only, cacheable. See §Next.js 16 Specifics for the revalidation trap. |
| Publish / list / archive authorization | API / Backend (`withPermission`) | — | RBAC-06: the choke point, never re-implemented. |

---

## Existing Schema Findings

These were read from `prisma/schema.prisma` and `prisma/migrations/` during this session. They materially change the plan. [VERIFIED: local source]

### 1. The obligation snapshot is partly anticipated already

`CohortCourse` (schema.prisma ~line 626) already carries:

```prisma
model CohortCourse {
  id             String @id @default(cuid())
  cohortId       String
  courseId       String
  position       Int
  contentVersion Int

  // Structure captured at cohort publication: modules, lessons, required
  // flags, assessment references. The learner's obligations are read from
  // here, not from the live Course.
  contentSnapshot Json?

  @@unique([cohortId, courseId])
  @@unique([cohortId, position])
}
```

The schema author's stated intent matches D-01/D-02 exactly. **However**, a per-cohort JSON copy cannot satisfy two of the locked decisions on its own:

- D-05 requires "a new Cohort gets the *last published snapshot*" — there is no place to store a published snapshot that is not yet attached to a cohort.
- D-06 requires the publish dialog to list "every affected running Cohort" and migrate ticked ones — which needs the question "which cohorts are pinned to version N?" answerable by an indexed column, not by probing JSON.

**Recommendation:** add `CoursePublication` and `ProgrammePublication` as the immutable published artefacts and have `CohortCourse` / `Cohort` pin them by **foreign key**, leaving `contentSnapshot` unused (or dropped). One source of truth; D-06's migration becomes a single FK update rather than a JSON re-copy. See §Pattern 1.

### 2. `Course.publishedById` exists but is a dangling string

`Course.publishedById String?` has no `@relation` and no version history. CAT-06 requires "publication records actor, version, time" — a `CoursePublication` row supplies all three properly. Keep `publishedById` as a convenience denormalisation of the latest publication, or drop it in favour of `course.publications.orderBy(version desc).first()`.

### 3. Position uniqueness is an INDEX, not a deferrable CONSTRAINT

```
prisma/migrations/20260901115332_init/migration.sql:827  CREATE UNIQUE INDEX "ProgrammeCourse_programmeId_position_key" ...
prisma/migrations/20260901115332_init/migration.sql:839  CREATE UNIQUE INDEX "Module_courseId_position_key" ...
prisma/migrations/20260901115332_init/migration.sql:845  CREATE UNIQUE INDEX "Lesson_moduleId_position_key" ...
```

PostgreSQL's `SET CONSTRAINTS ALL DEFERRED` affects deferrable *constraints*. A unique index created by `CREATE UNIQUE INDEX` is not a constraint and cannot be deferred. See §Pattern 3 for the consequence. [VERIFIED: local migration source + PostgreSQL semantics]

### 4. Module and Lesson cascade-delete today

`Module.course ... onDelete: Cascade`, `Lesson.module ... onDelete: Cascade`, `LessonResource.lesson ... onDelete: Cascade`. Combined with "no hard deletes", these cascades are currently unreachable — which is fine, but D-17's `withdrawnAt` is what makes withdrawal expressible at all. Nothing in the schema currently allows a lesson to stop being authored while staying readable.

### 5. `prisma/sql/001_integrity.sql` is a manual paste-in, not automated

Its header says: *"Paste this into the migration generated by `prisma migrate dev` before applying it."* No script or test references it (grep found only documentation mentions). Any new raw-SQL constraint this phase adds must follow the same manual convention **and** should get a test, because the current one has none.

### 6. `LessonResource` has no `uploadedById`, no `position`, and no `scanCompletedAt`

For audit completeness (RBAC-08 "actor, target, before/after") and for retry/backoff visibility on the scan job, the planner should consider adding `uploadedById`, `scannedAt DateTime?`, and `scanDetail String?`. `scanStatus` is a bare `String @default("PENDING")` with no enum — the planner should decide whether to promote it to an enum shared with `Submission` and `TicketAttachment` (Phases 10, 12 inherit it).

---

## Standard Stack

All versions confirmed against the npm registry on 2026-09-02.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@hello-pangea/dnd` | 18.0.1 | Drag-and-drop for Module/Lesson/ProgrammeCourse arrange views | Only mainstream React DnD library that **declares** React 19 in `peerDependencies` (`^18.0.0 \|\| ^19.0.0`) and ships built-in keyboard dragging + screen-reader live-region announcements. Supports movement between multiple droppables, which D-21 requires. [VERIFIED: npm peerDependencies; CITED: github.com/hello-pangea/dnd] |
| `@tiptap/react` + `@tiptap/pm` + `@tiptap/starter-kit` | 3.31.0 | Constrained rich text editor (D-29) | Headless ProseMirror. Extensions are opt-in, so a toolbar with no H1 / colour / font-size is enforced by *what the editor can produce*, not by hiding buttons. Outputs HTML directly (`editor.getHTML()`), matching D-30's storage format. React 19 in peers. 15.9M weekly downloads. [VERIFIED: npm peerDependencies] |
| `sanitize-html` | 2.17.7 | Allow-list sanitisation on save and on render (D-30) | Pure Node, htmlparser2-based, no DOM emulation — so it runs inside a React Server Component with no jsdom in the render path (the NFR-02 argument in D-30). Allow-list is declarative and maps 1:1 to D-30's eight tags. 10.3M weekly downloads. [VERIFIED: npm registry] |
| `@aws-sdk/client-s3` | 3.1124.0 | S3 API client for MinIO | MinIO is S3-compatible; the AWS SDK v3 is the reference client. **Already on Next.js's auto-externalized package list**, so it needs no `serverExternalPackages` entry. [CITED: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md] |
| `@aws-sdk/lib-storage` | 3.1124.0 | Multipart streaming upload | Streams a `ReadableStream` straight to MinIO without buffering the whole video in the Node process. |
| `@aws-sdk/s3-request-presigner` | 3.1124.0 | Short-lived signed GET URLs (NFR-06) | The mechanism NFR-06 names: "short-lived authorized access". |
| `pg-boss` | 12.29.0 | Scan job queue on the existing Postgres | Already named in `.planning/PROJECT.md`'s deployment constraint ("app + pg-boss worker + Postgres + MinIO"). Adds no new infrastructure — the queue lives in a `pgboss` schema in the database that already exists. Very actively maintained (12.29.0 released 2026-08-30). [VERIFIED: npm + GitHub releases] |
| `clamav/clamav` (Docker image) | `stable` tag | Virus scanning engine | The only practical self-hosted open-source scanner. Official Cisco-Talos image, exposes `clamd` on TCP 3310. [CITED: docs.clamav.net/manual/Installing/Docker.html] |
| `clamscan` | 2.4.0 | Node client for `clamd` | Supports remote TCP `clamd` and stream scanning, which is what a worker on a separate container needs. **See the caveat in §Package Legitimacy Audit — it is a maintenance risk, not a legitimacy risk.** |
| `zod` | 4.5.4 | Server-side input validation for every Server Action / Route Handler | The `server-actions.md` guide explicitly instructs validating all `FormData` as untrusted. Nothing comparable exists in the project today; every action currently parses `FormData` by hand. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tiptap/extension-link` | 3.31.0 | Link mark with `rel`/`target` control | Bundled in StarterKit in v3; pin explicitly if you need custom `validate`/`protocols`. |
| `@dnd-kit/core` + `@dnd-kit/sortable` | 6.3.1 / 10.0.0 | Alternative DnD | Only if `@hello-pangea/dnd`'s bundle size becomes a measured problem. See §Alternatives. |
| `@atlaskit/pragmatic-drag-and-drop` | 3.1.0 | Alternative DnD | Only if you need file-drop-from-desktop targets or thousands-of-items scale. |
| `@pg-boss/dashboard` | (paired with pg-boss 12) | Ops visibility into the scan queue | Optional; useful in Phase 15 hardening, not required here. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@hello-pangea/dnd` | `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 | **Larger ecosystem and 24.9M weekly downloads, but its `peerDependencies` still read `react: ">=16.8.0"` and `@dnd-kit/core` has not published a release since 2024-12-05 — 21 months stale.** The maintainer's active work is on `@dnd-kit/react` 0.5.0 (a pre-1.0 rewrite, last published 2026-07-13). Adopting a pre-1.0 package for a WCAG-AA-locked production surface is the wrong risk; adopting the stale v6 line means no upstream fix if React 19.3+ breaks it. `@hello-pangea/dnd` at least *declares* React 19 and had a commit on 2026-09-02. |
| `@hello-pangea/dnd` | `@atlaskit/pragmatic-drag-and-drop` 3.1.0 | The most actively maintained option (pushed 2026-09-01) and framework-agnostic, but deliberately ships **no** accessibility layer, no animation, and no sortable-list abstraction — you build the keyboard path, the live region, and the reorder maths yourself. Given D-19 already mandates hand-built arrow buttons, this is less lopsided than it sounds, but it is materially more code for a phase that already has a lot. |
| `@hello-pangea/dnd` | `react-beautiful-dnd` 13.1.1 | **Do not use.** Deprecated by Atlassian; `@hello-pangea/dnd` is its maintained fork. No React 19 support. |
| `sanitize-html` | `isomorphic-dompurify` 4.1.0 (wrapping DOMPurify 3.4.14) | DOMPurify is the stronger security pedigree (cure53, 0 open issues). But on the server it needs jsdom, which means jsdom in the RSC render path on **every learner lesson view** — directly against D-30's stated NFR-02 reasoning. Choose it only if the team weights cure53's hardening above render cost. See the CVE analysis in §Pitfall 2. |
| `sanitize-html` | Store Markdown, render server-side | Explicitly overridden by the user in CONTEXT.md's "Correction Recorded". Out of scope. |
| Tiptap | Lexical (Meta) | Smaller core, but HTML import/export is a separate `@lexical/html` concern and building a *restricted* node set is more manual. Tiptap's extension array *is* the allow-list, which makes D-29 auditable in one file. |
| Tiptap | Quill / Editor.js / Slate | Quill produces its own Delta format (fights D-30). Editor.js produces JSON blocks (fights D-30). Slate is a framework, not an editor — more code than Tiptap for a *more* constrained result. |
| `clamscan` | Hand-rolled `clamd` INSTREAM client (~60 lines over `net.Socket`) | Viable — the INSTREAM protocol is trivial — and removes a stale dependency. Weigh against §Don't Hand-Roll. Reasonable if `clamscan` proves unmaintained during the phase. |
| `clamscan` | `pompelmi` 1.20.0 | **Not recommended.** Surfaced only via a promotional HackerNoon article; 9.4k weekly downloads. `clamdjs` (17.6k/wk) and `clamav.js` (9.8k/wk) are both unmaintained since 2022. |
| `@aws-sdk/client-s3` | `minio` 8.0.7 (official MinIO JS client) | Smaller and MinIO-native, but ties the codebase to MinIO. The AWS SDK keeps a migration path to any S3 provider open, and is already Next-externalized. |
| pg-boss | BullMQ + Redis | Adds a Redis container to a self-hosted Compose deployment for no benefit. `.planning/PROJECT.md` already names pg-boss. |

**Installation:**

```bash
# Application dependencies
npm install @hello-pangea/dnd @tiptap/react @tiptap/pm @tiptap/starter-kit \
            sanitize-html zod \
            @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner \
            pg-boss

# Worker-only dependency
npm install clamscan

# Types
npm install -D @types/sanitize-html @types/clamscan
```

> Verify `@types/sanitize-html` and `@types/clamscan` exist and are current before adding them — they were not individually version-checked in this session. `[ASSUMED]`

---

## Package Legitimacy Audit

`slopcheck` 14-package scan: **14 OK, 0 SLOP, 0 SUS.** (The tool exited with a Windows `CreateProcess` traceback *after* printing `scanned 14 packages / 14 OK` — that failure is the tool attempting to shell out to `npm install`, not a scan failure.)

| Package | Registry | Latest | Last publish | Weekly downloads | Source repo | slopcheck | Disposition |
|---------|----------|--------|--------------|------------------|-------------|-----------|-------------|
| `@hello-pangea/dnd` | npm | 18.0.1 | 2025-02-09 | 3,197,573 | github.com/hello-pangea/dnd (pushed 2026-09-02) | OK | **Approved** |
| `@dnd-kit/core` | npm | 6.3.1 | 2024-12-05 | 24,862,894 | github.com/clauderic/dnd-kit (pushed 2026-07-13) | OK | Approved (alternative only) |
| `@dnd-kit/sortable` | npm | 10.0.0 | 2024-12-04 | — | same | OK | Approved (alternative only) |
| `@tiptap/react` | npm | 3.31.0 | 2026-09-01 | 14,924,978 | github.com/ueberdosis/tiptap (pushed 2026-09-01) | OK | **Approved** |
| `@tiptap/starter-kit` | npm | 3.31.0 | 2026-09-01 | 15,928,180 | same | OK | **Approved** |
| `@tiptap/pm` | npm | 3.31.0 | 2026-09-01 | — | same | OK | **Approved** |
| `sanitize-html` | npm | 2.17.7 | 2026-08-13 | 10,280,504 | github.com/apostrophecms/sanitize-html — **GitHub repo archived 2026-02-26**, development moved into the `apostrophecms/apostrophe` monorepo; releases continued monthly Feb→Aug 2026 | OK | **Approved with note** |
| `pg-boss` | npm | 12.29.0 | 2026-08-30 | 1,494,375 | github.com/timgit/pg-boss (pushed 2026-09-01) | OK | **Approved** |
| `@aws-sdk/client-s3` | npm | 3.1124.0 | 2026-09-01 | — | aws/aws-sdk-js-v3 | OK | **Approved** |
| `@aws-sdk/lib-storage` | npm | 3.1124.0 | 2026-09-01 | — | same | OK | **Approved** |
| `@aws-sdk/s3-request-presigner` | npm | 3.1124.0 | 2026-09-01 | — | same | OK | **Approved** |
| `clamscan` | npm | 2.4.0 | **2024-10-21 (23 months)** | 343,553 | github.com/kylefarris/clamscan (pushed 2024-10-21) | OK | **Approved with WARNING** |
| `zod` | npm | 4.5.4 | 2026-08-29 | — | colinhacks/zod | OK | **Approved** |
| `@atlaskit/pragmatic-drag-and-drop` | npm | 3.1.0 | 2026-08-29 | 1,343,967 | atlassian/pragmatic-drag-and-drop | OK | Approved (alternative only) |

**Packages removed due to slopcheck [SLOP] verdict:** none.

**Packages flagged for the planner despite a clean slopcheck:**

- `` `clamscan` `` **[WARNING: no release in 23 months; last repo push 2024-10-21; one historical high-severity command-injection advisory GHSA-5v25-xr56-phph (2022-05-24, fixed well before 2.4.0). Verify before using, and use the TCP/`clamdscan`-daemon mode rather than any binary-spawning mode — the historical CVE was in binary invocation. If the maintenance gap is unacceptable, hand-rolling the `clamd` INSTREAM client is a ~60-line, zero-dependency alternative.]**
- `` `sanitize-html` `` **[WARNING: standalone GitHub repository archived 2026-02-26 in favour of the ApostropheCMS monorepo. npm releases have continued monthly (2.17.1 → 2.17.7, Feb→Aug 2026), so this is a relocation, not abandonment — but a planner checkpoint confirming the maintenance channel is warranted before locking it in.]**
- `` `@dnd-kit/core` `` **[WARNING: no release since 2024-12-05; `peerDependencies` still say `react: ">=16.8.0"` with no explicit React 19 declaration. Listed as an alternative only.]**

**Ecosystem verification:** all packages verified on **npm** (the correct ecosystem for this Node/Next.js project). No cross-ecosystem name confusion. `postinstall` scripts were not individually inspected — the planner should run `npm view <pkg> scripts.postinstall` for each before the install task. `[ASSUMED]`

---

## Architecture Patterns

### System Architecture Diagram

```
STAFF AUTHORING                                          PUBLIC / LEARNER
───────────────                                          ────────────────

 Browser (client islands)                                 Browser (no JS for content)
   ├─ ArrangeBoard  ──┐                                     │
   │   @hello-pangea/dnd                                    │ GET /courses/[slug]
   │   + ↑/↓ buttons  │ proposed order (client state)       │
   │   + unsaved flag │                                     ▼
   ├─ LessonEditor ───┤                            ┌──────────────────────┐
   │   Tiptap (7 nodes)│                           │ RSC: public catalogue│
   └─ UploadPanel ─────┤                           │  readiness-gated     │
       fetch(multipart)│                           │  notFound() if not   │
                       │                           │  publiclyListed      │
        ┌──────────────┴──────────┐                └──────────┬───────────┘
        │                         │                           │
        ▼                         ▼                           ▼
  Server Action            Route Handler            ┌──────────────────────┐
  (≤1 MB bodies)           POST /api/lesson-        │ RSC: learner lesson  │
   ├ reorderModules         resources/upload        │  reads pinned        │
   ├ reorderLessons          (streams, no cap)      │  CoursePublication   │
   ├ saveLesson (sanitize)         │                │  + live Lesson rows  │
   ├ publishCourse                 │                │  sanitize-html again │
   ├ setPublicListing              │                └──────────┬───────────┘
   └ archiveCourse                 │                           │
        │                          │                           │
        └──────────┬───────────────┴───────────────────────────┘
                   ▼
        ┌────────────────────────────────────────────┐
        │ withPermission(...)  ← the ONLY entry gate │
        │   courses.edit / courses.publish /         │
        │   programmes.manage / programmes.publish   │
        └───────────────────┬────────────────────────┘
                            ▼
        ┌────────────────────────────────────────────┐
        │ src/server/services/*                      │
        │  createResourceService (list/get/create/   │
        │   update/archive)  +  NEW publish op       │
        │  reorder-service   (two-pass $transaction) │
        │  readiness-service (pure evaluator)        │
        │  storage-service   (S3 client)             │
        │  scan-queue        (pg-boss send)          │
        └──────┬──────────────────┬──────────────┬───┘
               │                  │              │
               ▼                  ▼              ▼
        ┌────────────┐    ┌──────────────┐  ┌──────────────┐
        │ PostgreSQL │    │    MinIO     │  │ pgboss schema│
        │  public.*  │    │ lms-private  │  │  (same DB)   │
        │  Course    │    │ storageKey = │  └──────┬───────┘
        │  Module    │    │  random uuid │         │
        │  Lesson    │    │  (NFR-06)    │         │ SKIP LOCKED poll
        │  CoursePub-│    └──────┬───────┘         ▼
        │  lication  │           │          ┌───────────────────┐
        │  Cohort──pin│          │          │ worker (Node,     │
        └────────────┘           │          │  separate compose │
                                 │◄─────────┤  service)         │
                          GET object        │  lesson-resource. │
                                 │          │   scan handler    │
                                 ▼          └────────┬──────────┘
                          ┌──────────────┐           │ INSTREAM
                          │ clamav/clamav│◄──────────┘ tcp:3310
                          │  clamd :3310 │
                          └──────────────┘
                                 │
                     scanStatus: CLEAN | INFECTED | ERROR
                                 ▼
                          UPDATE LessonResource
```

Download path (NFR-06): `GET /api/lesson-resources/[id]/download` → `withPermission("courses.view", courseScope)` → refuse unless `scanStatus === "CLEAN"` → presign a 60-second S3 GET → stream or redirect. Never a stored URL.

### Recommended Project Structure

```
src/
├── app/
│   ├── (public)/
│   │   ├── courses/page.tsx                    # listed courses index
│   │   ├── courses/[slug]/page.tsx             # detail; notFound() when unlisted
│   │   ├── programmes/page.tsx
│   │   ├── programmes/[slug]/page.tsx
│   │   └── not-found.tsx
│   ├── staff/
│   │   ├── courses/[id]/
│   │   │   ├── page.tsx                        # + ReadinessPanel (D-27)
│   │   │   ├── arrange/page.tsx                # Module/Lesson arrange board
│   │   │   ├── lessons/[lessonId]/page.tsx     # lesson form + Tiptap + uploads
│   │   │   └── actions.ts                      # server actions for the above
│   │   └── programmes/…                        # mirrors courses
│   ├── api/lesson-resources/
│   │   ├── upload/route.ts                     # POST — streams to MinIO
│   │   └── [id]/download/route.ts              # GET  — authorize then presign
│   └── not-found.tsx                           # root 404 (none exists today)
├── components/
│   ├── primitives/                             # EXISTING — do not fork
│   └── catalogue/
│       ├── ArrangeBoard.tsx                    # "use client" — dnd + ↑/↓
│       ├── RichTextEditor.tsx                  # "use client" — Tiptap
│       ├── ReadinessPanel.tsx                  # shared by detail + dialog (D-27)
│       ├── PublishDialog.tsx                   # cohort tick-boxes (D-06)
│       └── UnsavedOrderGuard.tsx               # Link onNavigate context (D-22)
├── lib/
│   └── sanitize.ts                             # THE allow-list — one file, one config
└── server/
    ├── services/
    │   ├── programme-service.ts                # createResourceService
    │   ├── module-service.ts                   # createResourceService, courses.edit
    │   ├── lesson-service.ts                   # createResourceService, courses.edit
    │   ├── lesson-resource-service.ts
    │   ├── publish-service.ts                  # createPublishOperation (shared)
    │   ├── reorder-service.ts                  # the $transaction
    │   ├── readiness-service.ts                # pure evaluator + loader
    │   └── storage-service.ts                  # S3 client, presign
    └── jobs/
        └── queue.ts                            # pg-boss singleton + send helpers
worker/                                          # OUTSIDE src/ — see note below
├── index.ts                                     # boss.start(), boss.work(...)
└── handlers/scan-lesson-resource.ts
```

> **Why `worker/` sits outside `src/`:** the ESLint boundary rule's `files` glob is `src/**/*.{ts,tsx}`. A worker under `src/` that imports `@prisma/client` would be blocked; a worker under `src/server/services/` would blur the "services are authorized entry points" meaning. Placing it at the repo root keeps the boundary rule's meaning intact. The worker still calls into `src/server/services/*` for data access (the `@/` alias resolves under `tsx`), so Prisma access stays in one place. **The planner must add a `tests/boundary.test.ts` case asserting the worker cannot import Prisma directly, or explicitly document the exemption.**

### Pattern 1: Obligation snapshot as an immutable publication row with a JSON payload

**What:** Each publish writes one new `CoursePublication` / `ProgrammePublication` row. The row is never updated. Cohorts pin it by FK.

**When to use:** For D-01 through D-07 and CAT-05/CAT-06.

**Recommended schema delta:**

```prisma
model CoursePublication {
  id       String @id @default(cuid())
  courseId String
  version  Int                    // mirrors Course.contentVersion at publish time

  // D-02 FROZEN payload. Shape documented and versioned by payloadSchema.
  // { schema: 1,
  //   completionRule: {...}, completionRuleVersion: 1,
  //   modules: [ { id, position,
  //                lessons: [ { id, position, required, type, assessmentId } ] } ] }
  payload       Json
  payloadSchema Int   @default(1)

  publishedAt   DateTime @default(now())
  publishedById String                     // CAT-06: actor
  reason        String?

  course      Course       @relation(fields: [courseId], references: [id])
  publishedBy User         @relation(fields: [publishedById], references: [id])
  pinnedBy    CohortCourse[]

  @@unique([courseId, version])
  @@index([courseId, publishedAt])
}

model ProgrammePublication {
  id          String @id @default(cuid())
  programmeId String
  version     Int
  // { schema: 1, sequential: bool, completionRule: {...},
  //   courses: [ { courseId, position } ] }
  payload       Json
  payloadSchema Int      @default(1)
  publishedAt   DateTime @default(now())
  publishedById String
  reason        String?

  programme Programme @relation(fields: [programmeId], references: [id])
  pinnedBy  Cohort[]

  @@unique([programmeId, version])
}

// Pins (Phase 5 builds the UI; this phase defines the columns + read path)
model CohortCourse {
  // ... existing fields ...
  coursePublicationId String?
  coursePublication   CoursePublication? @relation(fields: [coursePublicationId], references: [id])
  // contentSnapshot Json?  ← now redundant; drop or leave unused
}

model Cohort {
  // ... existing fields ...
  programmePublicationId String?
  programmePublication   ProgrammePublication? @relation(fields: [programmePublicationId], references: [id])
}
```

**Why JSON payload over normalised snapshot rows:**

| Consideration | JSON payload | Normalised rows (`SnapshotModule` / `SnapshotLesson`) |
|---|---|---|
| Learner read path (Phase 8) | 1 row read → then `lesson.findMany({ where: { id: { in: ids } } })` for live content. **2 queries.** | 2–3 joined reads for structure, then the live read. More queries, more indexes. |
| D-03 (withdrawn lesson stays visible-but-inert) | Trivial: the id is in the payload; the live row still exists (`withdrawnAt` set); render read-only. | Same, but requires a nullable FK or an intentionally un-enforced reference. |
| D-06 ("which cohorts are on version N?") | Answered by the **FK index**, not by probing JSON. No JSON query needed anywhere. | Same. |
| Immutability | Natural — nothing ever updates the payload. | Requires discipline across three tables. |
| Referential integrity | Cannot FK into JSON — an orphan lesson id is theoretically possible. **Mitigated absolutely by "no hard deletes" + `withdrawnAt`:** a lesson row never disappears. | Enforced by FK. |
| Diffing for the D-05 "unpublished changes" banner | One `JSON.stringify` comparison of the canonical live tree against the payload. Simple and total. | Requires a structural diff across tables. |
| Migration burden | One column. | Three new tables plus their indexes. |

**Verdict:** JSON payload. It also matches the existing schema author's intent (`CohortCourse.contentSnapshot Json?`), so the codebase stays internally consistent. `[ASSUMED — this is a design judgement, not a verified fact; the planner should surface it for confirmation.]`

**The D-05 banner** ("unpublished obligation changes exist") is then a pure function:

```ts
// Compare only the FROZEN facets (D-02). Titles/body/media are excluded by construction.
function buildObligationTree(course: LoadedCourse): ObligationPayload { /* canonical, sorted */ }

export function hasUnpublishedObligationChanges(
  course: LoadedCourse,
  latest: CoursePublication | null,
): boolean {
  if (!latest) return course.status === "PUBLISHED";
  return JSON.stringify(buildObligationTree(course)) !== JSON.stringify(latest.payload);
}
```

Because `buildObligationTree` sorts deterministically and includes only D-02's frozen facets, a typo fix in `Lesson.body` never trips the banner — which is precisely D-01.

### Pattern 2: A shared publish operation extending the resource-service factory

**What:** `createResourceService` stops at `archive`. Publish is new surface, and D-04 gives Course and Programme identical semantics — so write it once.

**When to use:** CAT-05, CAT-06, and the D-08 listing switch.

```ts
// src/server/services/publish-service.ts
import type { Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";

export type PublishConfig<TAggregate, TPayload> = {
  /** "Course" | "Programme" — audit target type. */
  name: string;
  permission: Permission;                       // "courses.publish"
  toScope: (id: string) => ResourceScope;
  withPermission: WithPermission;
  audit: (entry: ResourceAuditEntry) => Promise<void>;

  /** Loads everything the snapshot and the readiness check need, in one query. */
  load: (id: string) => Promise<TAggregate | null>;
  /** D-02: the FROZEN facets only. Must be deterministic and sorted. */
  buildPayload: (aggregate: TAggregate) => TPayload;
  /** D-25: hard blocks. Returns [] when publishable. */
  blockingFailures: (aggregate: TAggregate) => ReadinessFailure[];
  /** D-06: running cohorts affected by this publish. */
  affectedCohorts: (id: string) => Promise<AffectedCohort[]>;
  /** Writes the publication row and applies migrations, in ONE transaction. */
  commit: (args: {
    aggregate: TAggregate;
    payload: TPayload;
    version: number;
    actorId: string;
    reason: string | null;
    migrateCohortIds: string[];   // D-06: ticked boxes only
  }) => Promise<{ publicationId: string; version: number }>;
};
```

Three invariants the planner must encode as tasks:

1. **D-22 is a server-side refusal, not just a client warning.** The publish action takes the client's `expectedUpdatedAt` (same token as D-23). If the parent's `updatedAt` has moved, refuse — that covers "publish while another tab has unsaved order" as well as "publish while *this* tab has unsaved order".
2. **D-06's migration list is unticked by default.** The action signature should take `migrateCohortIds: string[]` (default `[]`) and `reason: string` (required and non-empty when the array is non-empty). Never a boolean `migrateAll`.
3. **Two independent switches (D-08).** `publishCourse` (gated `courses.publish`) must never touch the listing flag; `setPublicListing` (gated `programmes.publish`) must never touch `status`. Two actions, two permissions, no shared write.

### Pattern 3: Whole-list reorder under a unique index, in one transaction

**What:** Commit an entire proposed arrangement without tripping `Module_courseId_position_key` / `Lesson_moduleId_position_key` / `ProgrammeCourse_programmeId_position_key`.

**Why the obvious approaches fail:**

- A single `UPDATE ... SET position = position + 1` can violate the unique index **mid-statement**. PostgreSQL evaluates a non-deferrable unique index per row as the statement progresses, not once at statement end.
- `SET CONSTRAINTS ALL DEFERRED` **has no effect here** — Prisma emitted `CREATE UNIQUE INDEX`, and PostgreSQL can only defer *constraints*. [VERIFIED: `prisma/migrations/20260901115332_init/migration.sql:827,839,845`]
- Issuing one `update` per row without a temp pass fails whenever the new order overlaps the old one (which is almost always).

**The pattern — two passes, one transaction:**

```ts
// src/server/services/reorder-service.ts
export async function commitLessonOrder(input: {
  courseId: string;
  expectedUpdatedAt: Date;                       // D-23
  // D-21: covers BOTH source and destination modules in one payload.
  arrangement: { moduleId: string; lessonIds: string[] }[];
}) {
  return prisma.$transaction(async (tx) => {
    // 1. Optimistic concurrency (D-23) — conditional UPDATE, no read-then-write race.
    const claimed = await tx.course.updateMany({
      where: { id: input.courseId, updatedAt: input.expectedUpdatedAt },
      data:  { updatedAt: new Date() },
    });
    if (claimed.count === 0) throw new StaleOrderError();

    const touchedModuleIds = input.arrangement.map((m) => m.moduleId);
    const allLessonIds     = input.arrangement.flatMap((m) => m.lessonIds);

    // 2. Verify every lesson actually belongs to this course. Never trust the client.
    const owned = await tx.lesson.count({
      where: { id: { in: allLessonIds }, module: { courseId: input.courseId } },
    });
    if (owned !== allLessonIds.length) throw new ArrangementMismatchError();

    // 3. PASS ONE — park every affected row in the negative space, which no
    //    committed row occupies. Covers source AND destination modules (D-21),
    //    so cross-module moves cannot collide either.
    await tx.$executeRaw`
      UPDATE "Lesson"
         SET "position" = -"position" - 1
       WHERE "moduleId" = ANY(${touchedModuleIds}::text[])
    `;

    // 4. PASS TWO — write the final arrangement, re-parenting as needed (D-21).
    let i = 0;
    for (const group of input.arrangement) {
      for (const [position, lessonId] of group.lessonIds.entries()) {
        await tx.lesson.update({
          where: { id: lessonId },
          data:  { moduleId: group.moduleId, position },
        });
        i++;
      }
    }
    return { moved: i };
  });
}
```

**Why the negative offset is safe:** `position` is always `>= 0` for committed rows, so `-position - 1` maps `[0,1,2,…]` onto `[-1,-2,-3,…]` — disjoint from the destination space and internally unique. Both passes run inside one transaction, so no other session ever observes a negative position.

**Do not add `CHECK (position >= 0)`.** It would break pass one.

**Alternative if the row-by-row pass-two loop becomes a measured problem:** replace it with one `UPDATE ... FROM (VALUES ...)` statement via `$executeRaw`. Only do this after measuring; a course rarely has more than a few hundred lessons.

**The same pattern applies verbatim to** `Module` (keyed on `courseId`) **and** `ProgrammeCourse` (keyed on `programmeId`). Write it once, parameterise the table.

**Documented alternative (not recommended):** replace each unique index with a deferrable constraint in a `prisma/sql/002_*.sql` companion, following the manual paste-in convention of `001_integrity.sql`:

```sql
DROP INDEX "Lesson_moduleId_position_key";
ALTER TABLE "Lesson"
  ADD CONSTRAINT "Lesson_moduleId_position_key" UNIQUE ("moduleId", "position")
  DEFERRABLE INITIALLY IMMEDIATE;
-- then, inside the transaction:  SET CONSTRAINTS "Lesson_moduleId_position_key" DEFERRED;
```

This permits a single renumbering `UPDATE`, but creates permanent Prisma-migrate drift (Prisma's `@@unique` will keep wanting to re-create the index) and every future `prisma migrate dev` becomes a manual review. **Not worth it** for a two-statement alternative that needs no DDL at all.

### Pattern 4: Optimistic concurrency via a conditional UPDATE, not a read-then-compare

**What:** D-23's "the server refuses the write if `updatedAt` has moved".

**The trap:** loading the record, comparing `updatedAt` in JS, then writing, is itself a race — two requests can both read the same `updatedAt` and both proceed.

**The fix** is shown in Pattern 3 step 1: an `updateMany` with `updatedAt` in the `where` clause. It is a single atomic statement; exactly one concurrent caller gets `count === 1`. The loser gets a typed `StaleOrderError` that the UI turns into "someone else reordered this — reload".

**Serialising the token:** `updatedAt` is a `DateTime` with PostgreSQL microsecond precision. Passing it through a form field as `toISOString()` truncates to milliseconds and will silently never match. Pass `updatedAt.getTime()` and reconstruct with `new Date(ms)`, **or** verify that Prisma's `DateTime` maps to `timestamp(3)` in the generated migration. `[ASSUMED — the planner must add a test that a round-tripped token matches.]`

### Pattern 5: One readiness evaluator, three render targets

**What:** D-25/D-26/D-27 — one pure function, consumed by the detail panel, the listing dialog, and the publish action's server-side gate.

```ts
export type ReadinessState = "PASS" | "FAIL" | "WARN" | "NOT_YET_CHECKED";

export type ReadinessItem = {
  id: string;
  category: "Content" | "Schedule" | "Price" | "Capacity" | "Instructors" | "Completion";
  label: string;
  state: ReadinessState;
  detail?: string;
  /** D-25: only FAIL items with blocking=true stop public listing. */
  blocking: boolean;
  /** D-26: the phase that will fill this slot, when NOT_YET_CHECKED. */
  deferredTo?: "Phase 5" | "Phase 10";
};

export function evaluateCourseReadiness(a: LoadedCourse): ReadinessItem[] {
  return [
    { id: "title",   category: "Content", label: "Title",   blocking: true,
      state: a.title?.trim() ? "PASS" : "FAIL" },
    { id: "summary", category: "Content", label: "Summary", blocking: true,
      state: a.summary?.trim() ? "PASS" : "FAIL" },
    { id: "published", category: "Content", label: "Content published", blocking: true,
      state: a.status === "PUBLISHED" ? "PASS" : "FAIL" },
    { id: "modules", category: "Content", label: "At least one module", blocking: true,
      state: a.modules.length > 0 ? "PASS" : "FAIL" },
    { id: "module-lessons", category: "Content", label: "Every module has a lesson",
      blocking: true,
      state: a.modules.every((m) => m.lessons.length > 0) ? "PASS" : "FAIL" },

    // D-25 warnings — never blocking
    { id: "outcomes",      category: "Content", label: "Outcomes stated",      blocking: false,
      state: a.outcomes?.trim() ? "PASS" : "WARN" },
    { id: "duration",      category: "Content", label: "Duration set",         blocking: false,
      state: a.durationHours != null ? "PASS" : "WARN" },
    { id: "prerequisites", category: "Content", label: "Prerequisites stated", blocking: false,
      state: a.prerequisites?.trim() ? "PASS" : "WARN" },
    { id: "cohorts",       category: "Content", label: "Upcoming cohorts",     blocking: false,
      state: a.upcomingCohortCount > 0 ? "PASS" : "WARN" },

    // D-26 named gaps — a THIRD state, visually distinct from both tick and cross
    { id: "schedule",    category: "Schedule",    label: "Schedule",    blocking: false,
      state: "NOT_YET_CHECKED", deferredTo: "Phase 5" },
    { id: "price",       category: "Price",       label: "Price",       blocking: false,
      state: "NOT_YET_CHECKED", deferredTo: "Phase 5" },
    { id: "capacity",    category: "Capacity",    label: "Capacity",    blocking: false,
      state: "NOT_YET_CHECKED", deferredTo: "Phase 5" },
    { id: "instructors", category: "Instructors", label: "Instructors", blocking: false,
      state: "NOT_YET_CHECKED", deferredTo: "Phase 5" },

    // D-31 named gap
    ...(a.hasAssessmentLessons
      ? [{ id: "assessments", category: "Completion" as const,
           label: "Quiz/Assignment content", blocking: false,
           state: "NOT_YET_CHECKED" as const, deferredTo: "Phase 10" as const }]
      : []),
  ];
}
```

The `setPublicListing` action re-runs this server-side and refuses on any `state === "FAIL" && blocking`. The panel and the dialog render the same array. `NOT_YET_CHECKED` must be a distinct visual token — not a grey tick, not a grey cross.

### Pattern 6: Blocking navigation on unsaved order (D-22)

**What:** Next.js 16 supports client-side navigation interception on `Link` via `onNavigate`, whose event carries `preventDefault()`.

```tsx
// src/components/catalogue/UnsavedOrderGuard.tsx
"use client";
import Link from "next/link";
import { createContext, useContext, useState } from "react";

const UnsavedCtx = createContext<{ dirty: boolean; setDirty: (v: boolean) => void }>({
  dirty: false, setDirty: () => {},
});
export const useUnsavedOrder = () => useContext(UnsavedCtx);

export function GuardedLink({ href, children }: { href: string; children: React.ReactNode }) {
  const { dirty } = useUnsavedOrder();
  return (
    <Link
      href={href}
      onNavigate={(e) => {
        if (dirty && !window.confirm("You have an unsaved arrangement. Leave anyway?")) {
          e.preventDefault();          // documented: cancels the client-side navigation
        }
      }}
    >
      {children}
    </Link>
  );
}
```

[CITED: `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:453-476, 1094` — the docs give this exact React-Context pattern for "block navigation when a form has unsaved changes".]

Caveats the docs state explicitly and the planner must handle:
- `onNavigate` does **not** fire for external URLs, `download` links, or modifier-key clicks (Ctrl/Cmd+click opens a new tab and leaves the current page intact — acceptable).
- It does **not** cover full page reloads or the back button. Pair with a `beforeunload` listener for those. `window.confirm` is not WCAG-friendly; prefer the existing `ConfirmModal` primitive and only fall back to `beforeunload` for hard unloads.
- The server-side refusal in Pattern 2/4 is the real guarantee. The dialog is courtesy.

### Pattern 7: Upload path — Route Handler, not Server Action

**What:** D-28's upload pipeline, given the 1 MB Server Action body cap.

```ts
// src/app/api/lesson-resources/upload/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";          // required — the S3 SDK is Node-only

export async function POST(request: Request) {
  // 1. Parse metadata FIRST from headers/query so we can authorize before
  //    consuming the (potentially large) body.
  const lessonId = new URL(request.url).searchParams.get("lessonId");
  // 2. withPermission("courses.edit", lessonScope(lessonId)) — the choke point.
  // 3. Validate declared mimeType + sizeBytes against an allow-list per LessonType.
  // 4. storageKey = `lessons/${lessonId}/${randomUUID()}` — NFR-06: unpredictable,
  //    never derived from the filename, never a URL.
  // 5. Stream to MinIO with @aws-sdk/lib-storage Upload({ client, params: { Body: request.body } }).
  // 6. Create the LessonResource row (scanStatus stays "PENDING").
  // 7. Enqueue: boss.send("lesson-resource.scan", { lessonResourceId }).
  return NextResponse.json({ id, scanStatus: "PENDING" });
}
```

Three points the planner must not lose:

- **Authorize before reading the body.** Otherwise an unauthenticated caller can make the server buffer a 2 GB stream before being told no.
- **`request.formData()` buffers the whole file in memory.** For video, read `request.body` (a `ReadableStream`) and hand it to `lib-storage`'s `Upload`, which does multipart streaming. `[ASSUMED — verify `Upload` accepts a web `ReadableStream` as `Body` in the installed SDK version; it may need `Readable.fromWeb()`.]`
- **Size limits are application-enforced.** Next.js imposes none on Route Handlers ([CITED: `.../03-file-conventions/route.md:597` — "unlike API Routes with the Pages Router, you do not need to use `bodyParser`"]). Enforce per-type caps yourself (e.g. image 10 MB, file 50 MB, video 2 GB) and abort the stream on overrun. If a `proxy.ts` is ever added to this project, `experimental.proxyClientMaxBodySize` (default **10 MB**) silently truncates bodies — see §Pitfall 5.

### Pattern 8: Download path — authorize, then presign, never store a URL

```ts
// src/app/api/lesson-resources/[id]/download/route.ts
export async function GET(request: Request, ctx: RouteContext<'/api/lesson-resources/[id]/download'>) {
  const { id } = await ctx.params;                    // Next 16: params is a Promise
  // withPermission("courses.view", lessonResourceScope(id))
  // Refuse unless scanStatus === "CLEAN" (never serve PENDING or INFECTED).
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: storageKey }),
                                 { expiresIn: 60 });  // NFR-06: short-lived
  return Response.redirect(url, 302);
}
```

**Deployment caveat the planner must resolve:** a presigned URL is signed for the endpoint host. In `docker-compose.yml` the app reaches MinIO at `http://minio:9000`, a name the browser cannot resolve. Two resolutions:

- **(A) Reverse-proxy MinIO** at a public path with the same `Host` the signature was computed against, and set `S3_PUBLIC_ENDPOINT` for presigning. Cheapest bandwidth; requires the deployment to expose a MinIO route.
- **(B) Stream the object through the Route Handler** (`GetObjectCommand` → pipe `Body` to the response). MinIO stays entirely internal, no CORS, no host/signature mismatch — at the cost of app bandwidth. The URL is then permanent-but-session-gated, so satisfy NFR-06's "short-lived" wording by embedding a 5-minute HMAC token in the URL.

**Recommendation: (B) for this phase.** It works with `docker-compose.yml` exactly as it stands, keeps MinIO off the public network, and needs no infrastructure change. Revisit (A) in Phase 15 if bandwidth measurements justify it. `[ASSUMED — deployment-topology judgement; flag for user confirmation.]`

### Pattern 9: Guards on unpublish and archive

D-12 and D-14 share a predicate. Write it once:

```ts
/** Cohorts that are running now (started, not ended, not cancelled). */
export async function blockingCohorts(courseId: string): Promise<BlockingCohort[]> {
  const now = new Date();
  return prisma.cohort.findMany({
    where: {
      status: { in: ["PUBLISHED", "IN_PROGRESS"] },   // confirm against CohortStatus enum
      startsAt: { lte: now }, endsAt: { gte: now },
      OR: [{ courseId }, { cohortCourses: { some: { courseId } } }],
    },
    select: { id: true, code: true, title: true, endsAt: true,
              _count: { select: { enrolments: true } } },
  });
}
```

The returned list feeds both the D-12 refusal message ("naming the blocking Cohorts") and the D-06 publish dialog's tick-box list (which per the CONTEXT.md specifics needs **Cohort code, learner count, and end date** — exactly the `select` above).

`CohortStatus` is `DRAFT | PUBLISHED | IN_PROGRESS | COMPLETED | CANCELLED` (schema.prisma:53-59). [VERIFIED: local source] `PUBLISHED` and `IN_PROGRESS` are the correct "running" members; `CANCELLED` and `COMPLETED` never block.

### Anti-Patterns to Avoid

- **Adding a `modules.view` / `lessons.edit` permission.** The catalogue is closed and typed; it would not compile. Module and Lesson services must pass `courses.edit` / `courses.view` and resolve `toScope` up to the parent Course. `toScope` for a Lesson requires a **query** (`lesson → module → courseId`), so it must be `async` — `withPermission`'s `ScopeResolver` already returns `ResourceScope | Promise<ResourceScope>`, so this is supported. But the `createResourceService` factory's `toScope: (id: string) => ResourceScope` type is **synchronous**. The planner must widen that signature (a one-line change, but it touches the shared factory and `tests/resource-service.test.ts`).
- **Sanitising only in the editor.** Tiptap's schema constrains what the editor *produces*; it constrains nothing about what a POST *contains*. Sanitise server-side on every write.
- **Rendering `Lesson.body` with `dangerouslySetInnerHTML` without re-sanitising.** D-30 mandates both passes precisely so that rows written before a sanitiser bug was fixed are still safe when read.
- **Trusting the client's arrangement to be complete.** A malicious payload could omit lessons (orphaning them at stale positions) or include lessons from another course. Pattern 3 step 2 is not optional.
- **A boolean `migrateAllCohorts`.** D-06 says unticked by default, per-cohort, with a reason. A boolean invites "just tick them all".
- **Making `publishCourse` also set the listing flag** (or vice versa). D-08/D-09 make these two permissions and two business acts.
- **Putting the readiness evaluator inside a React component.** D-27 requires one evaluator behind three surfaces including a server-side refusal.
- **Deleting a `LessonResource` row when a scan comes back INFECTED.** No hard deletes. Set `scanStatus = "INFECTED"`, refuse to serve it, surface it in the UI.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML sanitisation | A regex or tag-stripper | `sanitize-html` (or DOMPurify) | mXSS, entity-decoded payloads inside raw-text elements, `javascript:` URI variants, SVG/SMIL animation vectors. The 2024–2026 advisory stream for both leading libraries is entirely made of bypasses no hand-rolled filter would have anticipated. |
| Rich text editing | contenteditable + `document.execCommand` | Tiptap (ProseMirror) | `execCommand` is deprecated, browser-divergent, and produces arbitrary markup — it cannot deliver D-29's "staff *cannot* fake a heading". ProseMirror's schema makes invalid documents unrepresentable. |
| Accessible drag-and-drop | Native HTML5 DnD events | `@hello-pangea/dnd` | Native HTML5 DnD has no touch support at all, no keyboard model, and no screen-reader affordance. NFR-09 is not satisfiable with it. |
| Job queue | A `setInterval` poller over a `jobs` table | `pg-boss` | `SKIP LOCKED` semantics, exactly-once delivery, retry with exponential backoff, dead-letter queues, multi-instance safety. The naive version double-processes on the first horizontal scale-out. |
| S3 request signing | Hand-built SigV4 | `@aws-sdk/s3-request-presigner` | SigV4 canonicalisation is a documented footgun; a wrong signature fails opaquely. |
| Virus scanning | Magic-byte / extension checks | ClamAV | An extension check is not a scan. `scanStatus` in the schema is a commitment to a real engine. |
| Reorder collision avoidance | Sparse positions (10, 20, 30…) with periodic rebalancing | Two-pass negative offset (Pattern 3) | Sparse positions still eventually collide, need a rebalance job, and make "position N" meaningless in a snapshot payload. |
| Input validation | Hand-parsing `FormData` | `zod` | Server Actions are public POST endpoints; every field is untrusted. [CITED: `.../02-guides/server-actions.md` §Security] |
| Optimistic concurrency | Read-compare-write in JS | Conditional `updateMany` (Pattern 4) | Read-then-write is itself a race. |

**Key insight:** every item above is a *correctness-under-adversity* problem — malicious input, concurrent writers, or assistive-technology users. Those are exactly the categories where a plausible-looking hand-rolled solution passes the happy-path test suite and fails in production.

---

## Common Pitfalls

### Pitfall 1: `SET CONSTRAINTS ALL DEFERRED` silently does nothing

**What goes wrong:** The reorder transaction is written assuming deferred uniqueness, tests pass on small arrangements that happen not to collide, and production throws `duplicate key value violates unique constraint "Lesson_moduleId_position_key"` on any real reorder.
**Why it happens:** PostgreSQL defers *constraints*. Prisma's `@@unique` emits `CREATE UNIQUE INDEX`, which is not a constraint. `SET CONSTRAINTS` neither errors nor warns for a name that is an index.
**How to avoid:** Pattern 3's two-pass negative offset. Never rely on deferral against a Prisma-generated `@@unique`.
**Warning signs:** Any `SET CONSTRAINTS` in a `$executeRaw`; a reorder test that only ever moves the last item.

### Pitfall 2: Choosing the sanitiser on brand rather than on threat surface

**What goes wrong:** The team picks DOMPurify for its reputation, then discovers jsdom is instantiated on every learner lesson render, and NFR-02's p75 budget erodes. Or the team picks `sanitize-html`, reads its advisory list, and panics.
**Why it happens:** Both libraries have active advisory streams — that is what a maintained sanitiser looks like.
**The actual analysis** [VERIFIED: GitHub Security Advisories API, 2026-09-02]:

| `sanitize-html` advisory | Reachable under D-30's allow-list (`h2 h3 p ul ol li strong em a`)? |
|---|---|
| GHSA-g8qq-57p8-ggw5 — stored XSS via **SVG SMIL** URI-list scheme bypass (2026-09-01) | No — `svg` not allowed |
| GHSA-rpr9-rxv7-x643 — critical XSS via **`xmp`** raw-text passthrough (2026-05-14) | No — `xmp` not allowed |
| GHSA-9mrh-v2v3-xpfm — allowedTags bypass via entity-decoded text in **`nonTextTags`** (2026-04-16) | No — the default `nonTextTags` (`script`, `style`, `textarea`, `option`) are all disallowed |
| GHSA-vccv-cmxp-4j9h — incomplete URI scheme validation allows `javascript:` (2026-07-31) | **Yes — this one is reachable via `<a href>`.** Fixed before 2.17.7. |

**How to avoid:** Pin `sanitize-html >= 2.17.7`, restrict `allowedSchemes` to `['http','https','mailto']`, add `allowedSchemesAppliedToAttributes: ['href']`, force `rel="noopener noreferrer nofollow"` on every anchor via a transform, and write a unit test asserting `javascript:`, `data:`, and protocol-relative `//evil.com` hrefs are stripped. Add the package to a dependency-update watch.
**Warning signs:** No test file named for the sanitiser; an allow-list that grew past D-30's eight tags.

```ts
// src/lib/sanitize.ts — the single source of truth for D-30
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "a"],
  allowedAttributes: { a: ["href", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
  },
};

/** D-30: called on save AND again on render. Same function, both times. */
export function sanitizeLessonBody(dirty: string): string {
  return sanitizeHtml(dirty, OPTIONS);
}
```

### Pitfall 3: The public catalogue page is prerendered at build and never updates

**What goes wrong:** `/courses` and `/courses/[slug]` have no cookies, headers, or `searchParams` — they are anonymous by design. With the default `dynamic = 'auto'` and no `cacheComponents` flag, Next.js prerenders them at build time. Toggling `publiclyListed` off then leaves the course visible on a statically served page indefinitely. Worse, the build itself now needs a live database.
**Why it happens:** The staff pages in this codebase are dynamic *by accident* — `getCurrentActor()` calls `cookies()`, which opts every authorized page out of prerendering. The public pages have no such call, so the behaviour silently differs.
**How to avoid:** decide explicitly per route. Three viable choices [CITED: `.../02-guides/caching-without-cache-components.md`]:

| Option | Code | Trade-off |
|---|---|---|
| **ISR + on-demand (recommended)** | `export const revalidate = 300` on the public routes, and `revalidatePath('/courses'); revalidatePath('/courses/[slug]', 'page')` inside `setPublicListing`, `publishCourse`, and `archiveCourse` | Fast anonymous reads (helps NFR-02), correct within one action roundtrip. Requires the build to reach the database. |
| **Fully dynamic** | `export const dynamic = 'force-dynamic'` | Always correct, no build-time DB, no revalidation bookkeeping. Every anonymous hit is a DB query. |
| **Opt out of prerender only** | `await connection()` before the query | Same as force-dynamic, expressed at the data-access layer. [CITED: `.../04-functions/connection.md`] |

`revalidatePath` with a dynamic segment **requires** the `type` argument: `revalidatePath('/courses/[slug]', 'page')`. [CITED: `.../04-functions/revalidatePath.md` §Parameters]
**Warning signs:** `next build` succeeding with no `DATABASE_URL`; a listing toggle that "doesn't take effect".

### Pitfall 4: A soft 404 on the public detail page

**What goes wrong:** CAT-07 requires that a direct URL to an unlisted course "reveals nothing". If the existence check runs inside a `<Suspense>` boundary, the response has already begun streaming as `200` and the status cannot change — you get a soft 404 (200 + `noindex`).
**Why it happens:** The `notFound()` docs describe exactly this trade-off.
**How to avoid:** perform the `publiclyListed` check in the page component **before** any `<Suspense>` boundary — a top-level `await` in `page.tsx`, then `notFound()`. [CITED: `.../04-functions/not-found.md` §"Calling notFound() after streaming has started" — "To return a real 404 status, the resource has to be checked before the response streams."]
**Also:** the existing staff pattern (`src/app/staff/courses/[id]/page.tsx`) already maps `AuthorizationError → notFound()`, deliberately, so a denial does not confirm existence. Copy it verbatim; do not introduce `forbidden()` (which is experimental behind `authInterrupts` and returns 403 — the exact thing CAT-07 forbids). [CITED: `.../03-file-conventions/forbidden.md`]
**Warning signs:** the check living inside a component wrapped in `<Suspense>`; any 403 on a public route.

### Pitfall 5: Video uploads truncated or rejected

**What goes wrong:** Upload works for a 200 KB PDF, fails silently or errors for a 300 MB video.
**Why it happens:** three independent caps —
1. Server Actions cap at **1 MB** by default [CITED: `.../02-guides/server-actions.md:83`]. Raising `serverActions.bodySizeLimit` to gigabytes is not a fix; it removes a DoS guard for *every* action in the app.
2. If a `proxy.ts` is ever added, `experimental.proxyClientMaxBodySize` defaults to **10 MB** and, per its docs, **"the request will not fail or return an error to the client"** — it silently truncates. [CITED: `.../05-config/01-next-config-js/proxyClientMaxBodySize.md`]
3. Any reverse proxy in front of the app (nginx `client_max_body_size` defaults to 1 MB).
**How to avoid:** Route Handler (Pattern 7), stream rather than buffer, document the reverse-proxy setting alongside the Compose file, and do not add a `proxy.ts` without revisiting this.
**Warning signs:** an upload path importing from a `"use server"` module; `request.formData()` on a video route.

### Pitfall 6: ClamAV eats the deployment's memory

**What goes wrong:** `clamd` is OOM-killed on a small VPS; scans hang forever; every resource stays `PENDING`.
**Why it happens:** ClamAV loads its signature database into RAM — roughly **1.2 GB minimum, 2–4 GB recommended**. [CITED: docs.clamav.net Docker guide]
**How to avoid:** set an explicit `mem_limit` on the `clamav` service, add a healthcheck, mount `/var/lib/clamav` as a named volume so `freshclam` does not re-download the full database on every restart, and document the memory floor in `.env.example` / the Compose comments. Give the scan job a bounded timeout so a hung `clamd` marks the resource `ERROR` rather than leaving it `PENDING` forever.
**Warning signs:** no `mem_limit`; no `/var/lib/clamav` volume; a scan handler with no timeout.

### Pitfall 7: The scan job is enqueued outside the transaction and is lost

**What goes wrong:** The `LessonResource` row commits, the process dies before `boss.send`, and the file sits at `PENDING` forever — undownloadable and invisible to any retry.
**Why it happens:** pg-boss's transactional-enqueue adapter `fromPrisma` **requires Prisma v7+ with `@prisma/adapter-pg`**. [CITED: pgboss.io/api/adapters] This project is on **Prisma 6.19.3**, so `fromPrisma` is unavailable without an out-of-scope major upgrade.
**How to avoid:** two options —
- **(A, recommended) A reconciliation cron job.** `boss.schedule("lesson-resource.reconcile", "*/5 * * * *")` re-enqueues any `LessonResource` with `scanStatus = "PENDING"` and `createdAt < now() - 10 minutes`. Simple, needs no Prisma upgrade, and also recovers from worker crashes mid-scan. This is the belt-and-braces mechanism regardless of which enqueue path is used.
- **(B) Implement pg-boss's minimal `Db` interface over a Prisma transaction client.** pg-boss documents the interface as `{ executeSql(text, values): Promise<{ rows: any[] }> }`, so `{ executeSql: async (text, values) => ({ rows: await tx.$queryRawUnsafe(text, ...values) }) }` should work. `[ASSUMED — not verified against the installed pg-boss; requires a spike task before being planned as the primary path.]`

**Take (A) as the plan. Treat (B) as an optional refinement.**
**Warning signs:** no reconciliation schedule; no query anywhere for long-`PENDING` resources.

### Pitfall 8: pg-boss v12 API differs from older tutorials

**What goes wrong:** Code copied from a v9-era blog post fails at import or at first job.
**Why it happens:** three changes, all verified from the v12.29.0 package and README:
- `pg-boss@12` is **ESM-only** (`"type": "module"`) and requires **Node >= 22.12.0** (local Node is 22.14.0 — fine). [VERIFIED: `unpkg.com/pg-boss@12.29.0/package.json`]
- The class is a **named export**: `const { PgBoss } = require('pg-boss')` / `import { PgBoss } from 'pg-boss'`, not a default export. [VERIFIED: `dist/index.d.ts` — `export declare class PgBoss extends EventEmitter`]
- The work handler receives an **array of jobs**: `boss.work(queue, async ([job]) => { ... })`. [VERIFIED: README example]
- **`createQueue` must be called before `send`.** `await boss.createQueue('lesson-resource.scan')` at worker startup and, idempotently, wherever the app first enqueues.
**How to avoid:** write the worker against the installed `dist/index.d.ts`, not from memory. Attach `boss.on('error', ...)` — the README shows it before `start()`.
**Warning signs:** `import PgBoss from 'pg-boss'`; a handler typed as a single job.

### Pitfall 9: `toScope` cannot be synchronous for Module and Lesson

**What goes wrong:** `createResourceService<Lesson>({ toScope: (id) => ({ courseIds: [???] }) })` — the course id is not derivable from a lesson id without a query, and the factory's type is synchronous.
**Why it happens:** the factory was written for Course, where `toScope(id) => ({ courseIds: [id] })` is trivially synchronous.
**How to avoid:** widen `ResourceServiceConfig.toScope` to `(id: string) => ResourceScope | Promise<ResourceScope>`. `withPermission`'s own `ScopeResolver` already permits a Promise, so the change is confined to the factory's type and does not touch the authorization core. Update `tests/resource-service.test.ts`.
**Warning signs:** a Lesson service that takes `courseId` as a caller-supplied argument — that is a scope the caller *asserted*, which `with-permission.ts` explicitly warns against ("Resolved before the check so the scope reflects the real record and its parents, not something the caller asserted").

### Pitfall 10: Tiptap loaded on the learner or public page

**What goes wrong:** NFR-02's p75 budget is spent on a ProseMirror bundle nobody interacts with.
**Why it happens:** a shared `LessonBody` component used for both authoring preview and learner render.
**How to avoid:** two components. `RichTextEditor.tsx` is `"use client"` and imported only from staff routes. The learner/public render is a Server Component doing `<div dangerouslySetInnerHTML={{ __html: sanitizeLessonBody(lesson.body ?? "") }} />` with zero client JS — which is D-30's explicit reasoning.
**Warning signs:** any `@tiptap/*` import reachable from `src/app/(public)/**` or a learner route.

---

## Code Examples

### Module service on the existing factory (mirroring `course-service.ts`)

```ts
// src/server/services/module-service.ts
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import { recordAudit } from "@/server/services/audit-service";
import { createResourceService, type Delegate } from "./resource-service";

type ModuleRecord = { id: string };

/**
 * A Module has no scope of its own — it is reached through its Course
 * (D-09: the permission catalogue is closed; there is no modules.*).
 * Async because the parent id requires a lookup, never a caller assertion.
 */
export async function moduleScope(id: string): Promise<ResourceScope> {
  const row = await prisma.module.findUnique({
    where: { id }, select: { courseId: true },
  });
  return { courseIds: row ? [row.courseId] : [] };   // empty ⇒ denied, per hasPermission
}

export const moduleService = createResourceService<ModuleRecord>({
  name: "Module",
  delegate: prisma.module as unknown as Delegate<ModuleRecord>,
  permissions: { view: "courses.view", create: "courses.edit", edit: "courses.edit" },
  toScope: moduleScope,            // requires the factory's toScope to accept a Promise
  withPermission,
  audit: (e) => recordAudit({ ...e }),
});
```

> **Note:** the factory's `archive` writes `{ status: "ARCHIVED" }`. `Module` has no `status` field — D-17 gives it `withdrawnAt` instead. The planner must either parameterise the factory's archive payload (`archiveData: () => Record<string, unknown>`) or give Module/Lesson a bespoke `withdraw` operation. **Parameterising is better**, because Phase 12 (`TicketAttachment`) will hit the same wall.

### Tiptap configured to make D-29 structurally impossible to violate

```tsx
// src/components/catalogue/RichTextEditor.tsx
"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

export function RichTextEditor({ value, onChange }: {
  value: string; onChange: (html: string) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,          // required under RSC/SSR — see note
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },   // D-29: H1 is not representable
        codeBlock: false, blockquote: false, horizontalRule: false,
        code: false, strike: false,
        link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  return <EditorContent editor={editor} />;
}
```

The extension array *is* the allow-list. There is no colour, font-size, or font-family extension registered, so those commands do not exist — D-29 holds by construction rather than by hiding toolbar buttons.

> `immediatelyRender: false` is required when a Tiptap editor is mounted in a Next.js App Router tree to avoid an SSR hydration mismatch. `[ASSUMED — confirm the exact option name against the installed `@tiptap/react` 3.31.0 types; the option was introduced in Tiptap 2.4 and is believed unchanged in v3.]`
>
> **Verify the StarterKit v3 option surface before writing this file.** StarterKit v3 absorbed several previously separate extensions (including Link), and the `configure` keys differ from v2 tutorials. Read `node_modules/@tiptap/starter-kit/dist/index.d.ts` after install.

### Worker entry point

```ts
// worker/index.ts  — run with: tsx worker/index.ts
import { PgBoss } from "pg-boss";                       // NAMED export in v12
import { scanLessonResource } from "./handlers/scan-lesson-resource";

const boss = new PgBoss(process.env.DATABASE_URL!);
boss.on("error", (err) => console.error("[pg-boss]", err));

await boss.start();
await boss.createQueue("lesson-resource.scan");
await boss.createQueue("lesson-resource.reconcile");

// Handler receives an ARRAY of jobs in v10+.
await boss.work<{ lessonResourceId: string }>(
  "lesson-resource.scan",
  async ([job]) => { await scanLessonResource(job.data.lessonResourceId); },
);

// Pitfall 7 mitigation: recover anything stuck at PENDING.
await boss.schedule("lesson-resource.reconcile", "*/5 * * * *");

const shutdown = async () => { await boss.stop(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

### Compose additions

```yaml
  clamav:
    image: clamav/clamav:stable
    restart: unless-stopped
    volumes:
      - clamav-db:/var/lib/clamav      # persist signatures across restarts
    mem_limit: 4g                       # Pitfall 6 — 1.2GB is the floor
    healthcheck:
      test: ["CMD", "clamdscan", "--ping", "1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 300s                # first freshclam download is slow

  worker:
    build: .
    restart: unless-stopped
    command: ["npx", "tsx", "worker/index.ts"]
    depends_on:
      postgres: { condition: service_healthy }
      minio:    { condition: service_healthy }
      clamav:   { condition: service_healthy }
    environment:
      DATABASE_URL: ${DATABASE_URL}
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: ${S3_BUCKET:-lms-private}
      CLAMAV_HOST: clamav
      CLAMAV_PORT: "3310"

volumes:
  clamav-db:
```

> There is currently **no `Dockerfile`** in this repository — the Compose file provisions dependencies only, not the app. The planner must either add one (used by both an `app` service and this `worker` service) or run the worker outside Compose. This is a real gap, not an oversight in this research. [VERIFIED: filesystem]

### S3 client for MinIO

```ts
// src/server/services/storage-service.ts
import { S3Client } from "@aws-sdk/client-s3";

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,      // http://minio:9000
  region: "us-east-1",                     // MinIO ignores it; the SDK requires it
  forcePathStyle: true,                    // REQUIRED for MinIO — no virtual-host buckets
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER!,
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD!,
  },
});
```

`forcePathStyle: true` is the single most commonly missed MinIO setting. `[ASSUMED — long-standing MinIO/S3 SDK convention, not re-verified against MinIO docs this session.]`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on this phase |
|---|---|---|---|
| `react-beautiful-dnd` | `@hello-pangea/dnd` (maintained fork) | Atlassian deprecated rbd; last rbd release 13.1.1 | Do not install `react-beautiful-dnd`. |
| `middleware.ts` | `proxy.ts` (`edge` runtime unsupported) | Next.js 16 | No middleware exists here; if one is added, use `proxy.ts` and mind `proxyClientMaxBodySize`. [CITED: version-16.md] |
| `revalidateTag('x')` | `revalidateTag('x', 'max')` — the cacheLife profile is now **required**; single-arg form is a TS error | Next.js 16 | Any tag revalidation in this phase must pass two arguments. |
| — | `updateTag(tag)` — new, Server-Actions-only, read-your-own-writes semantics | Next.js 16 | Preferable to `revalidateTag` after a publish, since staff expect to see the change immediately. |
| `unstable_cacheLife` / `unstable_cacheTag` | `cacheLife` / `cacheTag` (stable) | Next.js 16 | Drop `unstable_` prefixes. |
| `experimental.ppr` | `cacheComponents: true` | Next.js 16 | **Not enabled here.** `next.config.ts` is empty, so the previous caching model applies — use `caching-without-cache-components.md`, not the Cache Components guide. |
| Sync `params` / `searchParams` / `cookies()` | All async; sync access fully removed | Next.js 16 | Every new page/route in this phase must `await params`. The existing `staff/courses/[id]/page.tsx` already does. |
| `next dev --turbopack` | Turbopack is the default for `dev` **and** `build` | Next.js 16 | A webpack config would now fail the build. None exists. |
| pg-boss default export, single-job handler | Named `PgBoss` export, array handler, `createQueue` required, ESM-only, Node ≥ 22.12 | pg-boss 10 → 12 | See Pitfall 8. |
| Tiptap v2 separate extension packages | Tiptap v3 StarterKit absorbs Link and others | Tiptap 3.x (2025) | Verify `configure` keys against installed types. |

**Deprecated / do not use:**
- `react-beautiful-dnd` — unmaintained.
- `document.execCommand` — deprecated; the reason a real editor is needed.
- `next/legacy/image`, `images.domains` — deprecated in Next 16.
- `forbidden()` / `unauthorized()` for public catalogue routes — experimental (`authInterrupts`), and a 403 is exactly what CAT-07 prohibits.

---

## Validation Architecture

`.planning/config.json` does not exist, so `workflow.nyquist_validation` is absent — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 |
| Config file | `vitest.config.mts` — `environment: "node"`, `include: ["tests/**/*.test.ts"]`, `@` → `src` alias |
| Quick run command | `npx vitest run tests/<file>.test.ts` |
| Full suite command | `npm test` (`vitest run`) |
| Current state | 84 tests, 10 files, all passing |

**Critical constraint: the current setup cannot test React components.** `environment: "node"` and an `include` glob of `tests/**/*.test.ts` (not `.tsx`) mean there is no jsdom, no `@testing-library/react`, and no component test path at all. Every existing test is a pure-function or service-layer test with hand-injected dependencies (see `tests/resource-service.test.ts`'s `harness()`).

**This phase's UI is substantial** (arrange board, editor, readiness panel, publish dialog). The planner must choose one:
- **(a) Keep the boundary.** Test all logic in pure functions and services; leave component behaviour to manual verification. Cheapest, consistent with the existing codebase, but leaves the D-19 keyboard path untested.
- **(b) Add a browser-mode or jsdom Vitest project** plus `@testing-library/react`, and widen `include` to `.tsx`. Real cost, real coverage of the accessibility path that NFR-09 makes non-negotiable.

**Recommendation: (b), scoped narrowly** — a second Vitest project covering only `tests/components/**/*.test.tsx`, used to prove the ↑/↓ keyboard reorder path and the readiness panel's three-state rendering. Everything else stays in node-mode service tests. `[ASSUMED — a testing-strategy judgement; the planner should surface it.]`

### Phase Requirements → Test Map

| Req | Behaviour | Type | Command | Exists? |
|---|---|---|---|---|
| CAT-02 | Programme service create/update/archive gated on `programmes.manage` | unit | `npx vitest run tests/programme-service.test.ts` | ❌ Wave 0 |
| CAT-02 | Reordering `ProgrammeCourse` commits without unique violation | integration (real PG) | `npx vitest run tests/reorder.integration.test.ts` | ❌ Wave 0 |
| CAT-02 | A Course in two Programmes is referenced, never duplicated | unit | same file | ❌ Wave 0 |
| CAT-03 | Whole-list Lesson reorder inside one Module | integration | `tests/reorder.integration.test.ts` | ❌ Wave 0 |
| CAT-03 | Lesson moved across Modules renumbers both (D-21) | integration | same | ❌ Wave 0 |
| CAT-03 | Stale `expectedUpdatedAt` is refused (D-23) | integration | same | ❌ Wave 0 |
| CAT-03 | Arrangement containing a foreign lesson id is refused | unit | `tests/reorder.test.ts` | ❌ Wave 0 |
| CAT-03 | ↑/↓ buttons produce the same array as a drag (D-19) | component | `npx vitest run tests/components/arrange-board.test.tsx` | ❌ Wave 0 (needs framework decision) |
| CAT-04 | Sanitiser strips `javascript:`, `data:`, `//host`, `<script>`, `<h1>`, `style=` | unit | `npx vitest run tests/sanitize.test.ts` | ❌ Wave 0 |
| CAT-04 | Sanitiser is idempotent (save then render, D-30) | unit | same | ❌ Wave 0 |
| CAT-04 | Per-type size/mime validation accepts and rejects correctly | unit | `npx vitest run tests/upload-validation.test.ts` | ❌ Wave 0 |
| CAT-04 | Download refuses `PENDING` and `INFECTED` | unit | `tests/lesson-resource-service.test.ts` | ❌ Wave 0 |
| CAT-04 | `storageKey` is unpredictable and never contains the filename (NFR-06) | unit | same | ❌ Wave 0 |
| CAT-05 | `buildObligationTree` is deterministic and excludes titles/body (D-01/D-02) | unit | `npx vitest run tests/publication.test.ts` | ❌ Wave 0 |
| CAT-05 | A body-only edit does **not** raise the unpublished-changes banner | unit | same | ❌ Wave 0 |
| CAT-05 | A reorder / `required` toggle **does** raise it (D-07) | unit | same | ❌ Wave 0 |
| CAT-05 | Publish creates a new immutable version; unticked cohorts keep their pin (D-06) | integration | `tests/publish.integration.test.ts` | ❌ Wave 0 |
| CAT-05 | A withdrawn lesson still resolves for a pinned cohort (D-03) | integration | same | ❌ Wave 0 |
| CAT-06 | `courses.publish` at COURSE scope permits publishing that course only | unit | `tests/publish-service.test.ts` | ❌ Wave 0 |
| CAT-06 | `courses.publish` does **not** permit public listing (D-09) | unit | same | ❌ Wave 0 |
| CAT-06 | Publication records actor, version, timestamp | unit | same | ❌ Wave 0 |
| CAT-07 | Readiness blocks on the five D-25 items and only those | unit | `npx vitest run tests/readiness.test.ts` | ❌ Wave 0 |
| CAT-07 | Phase-5 categories return `NOT_YET_CHECKED`, not PASS (D-26) | unit | same | ❌ Wave 0 |
| CAT-07 | `setPublicListing` refuses when a blocking item fails | unit | `tests/publish-service.test.ts` | ❌ Wave 0 |
| CAT-07 | Slug is immutable once `slugLockedAt` is set (D-11) | unit | `tests/course-service.test.ts` (extend) | ⚠️ file exists |
| CAT-08 | Archive is blocked by a running cohort and names it (D-14) | unit | `tests/archive-guards.test.ts` | ❌ Wave 0 |
| CAT-08 | Un-archive returns DRAFT + unlisted (D-16) | unit | same | ❌ Wave 0 |
| CAT-08 | Archiving a Course does not mutate published Programme snapshots (D-14) | integration | `tests/publish.integration.test.ts` | ❌ Wave 0 |
| — | Worker cannot import `@prisma/client` directly | lint | `npx vitest run tests/boundary.test.ts` (extend) | ⚠️ file exists |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/<the file(s) that task touched>`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` fully green plus `npx eslint .` clean before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] **Decide the integration-test strategy.** Patterns 3 and 4 are *PostgreSQL semantics*. A mocked delegate cannot prove that the two-pass reorder avoids a unique violation — only a real Postgres can. Options: a Testcontainers-style throwaway Postgres, a dedicated `DATABASE_URL_TEST` schema, or PGlite. Without this, the single highest-risk mechanism in the phase ships untested. **This is the most important Wave 0 decision.**
- [ ] `tests/sanitize.test.ts` — covers CAT-04 / D-30 (no new infrastructure needed; write it first, it is cheap and high value)
- [ ] `tests/readiness.test.ts` — covers CAT-07 / D-25 / D-26 (pure function, no infrastructure)
- [ ] `tests/publication.test.ts` — covers CAT-05 / D-01 / D-02 / D-07 (pure function, no infrastructure)
- [ ] `tests/reorder.test.ts` (pure validation) + `tests/reorder.integration.test.ts` (real PG) — CAT-02 / CAT-03
- [ ] `tests/publish-service.test.ts`, `tests/archive-guards.test.ts`, `tests/programme-service.test.ts`, `tests/lesson-resource-service.test.ts`
- [ ] `tests/conftest`-equivalent shared fixtures — the existing `harness()` idiom in `tests/resource-service.test.ts` is duplicated per file; a shared `tests/support/harness.ts` is now worth extracting
- [ ] Component-test framework decision + install (`@testing-library/react`, jsdom or Vitest browser mode) — only if option (b) above is chosen
- [ ] Extend `tests/boundary.test.ts` with a `worker/` case

---

## Security Domain

`security_enforcement` is not configured (no `.planning/config.json`); treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control in this phase |
|---|---|---|
| V2 Authentication | Indirectly | Existing `getCurrentActor()` session cookie. Unchanged by this phase. |
| V3 Session Management | Indirectly | Existing. Note the **CSRF check** Next.js performs on Server Actions (Origin vs Host) — configure `serverActions.allowedOrigins` if a reverse proxy is introduced. [CITED: `.../02-guides/server-actions.md:82`] |
| V4 Access Control | **Yes — central** | `withPermission` on every action and Route Handler. CAT-07's "reveals nothing" is an **enumeration** control: `notFound()` on denial, never `forbidden()`. Insecure-direct-object-reference risk is high here (lesson ids, module ids, resource ids all cross the wire) — every id must be re-scoped server-side, never trusted. |
| V5 Input Validation | **Yes — central** | `zod` on every Server Action and Route Handler payload. `sanitize-html` on `Lesson.body`. `embedUrl` / `linkUrl` need a scheme + host allow-list (an unvalidated `embedUrl` rendered in an `<iframe>` is a stored-XSS and clickjacking vector — D-29's constrained toolbar does **not** cover the separate embed field). |
| V6 Cryptography | Partially | Presigned-URL signing and any download HMAC — use `@aws-sdk/s3-request-presigner` and `node:crypto`; never hand-roll SigV4. `storageKey` must be `randomUUID()`-derived (NFR-06: "predictable object paths prohibited"). |
| V12 Files & Resources | **Yes — central** | ClamAV scan gate before any download; per-type size and MIME allow-lists; content sniffing rather than trusting the client's declared `mimeType`; `Content-Disposition: attachment` and a restrictive `Content-Type` on download to prevent HTML files executing in the site's origin. |
| V14 Configuration | Yes | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be stable across instances in a self-hosted multi-instance deploy, or inline-action closures fail to decrypt. [CITED: `.../02-guides/server-actions.md` §Security] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Stored XSS via `Lesson.body` | Tampering / Elevation | `sanitize-html` on write **and** on render (D-30); allow-list of 8 tags; scheme allow-list on `href` |
| Stored XSS / clickjacking via `Lesson.embedUrl` in an `<iframe>` | Tampering | Host allow-list (YouTube/Vimeo only), `sandbox` attribute, `https:` only. **Not covered by the body sanitiser.** |
| Malware distribution through uploads | Tampering / Repudiation | ClamAV gate; refuse download unless `scanStatus === "CLEAN"` |
| Stored HTML/SVG served from the app origin | Elevation | `Content-Disposition: attachment`, never `text/html`, ideally a separate download origin |
| Resource enumeration via 403-vs-404 | Information Disclosure | `notFound()` on both denial and absence (already the codebase pattern) |
| IDOR on lesson/module/resource ids | Elevation | `toScope` resolves the parent by **query**, never from the request |
| Server Action invoked directly by POST | Elevation | `withPermission` inside every action; the framework CSRF check is not authorization [CITED: `.../02-guides/server-actions.md`] |
| Reorder race corrupting a published snapshot | Tampering | Conditional `updateMany` on `updatedAt` (D-23 / Pattern 4) + server-side publish refusal (D-22) |
| Upload DoS (giant body) | Denial of Service | Authorize before reading the body; per-type caps; abort the stream on overrun |
| Presigned URL leakage | Information Disclosure | 60-second expiry; no logging of signed URLs; no storage of them |
| Prototype pollution via snapshot JSON | Tampering | Snapshots are server-built, never client-supplied. Never `JSON.parse` a client payload into a snapshot. |

---

## Runtime State Inventory

Not applicable — this is a greenfield feature phase, not a rename/refactor/migration. No existing runtime state carries a name or key that this phase changes.

One adjacent item worth naming, since it is genuinely runtime state this phase *creates*: pg-boss installs its own `pgboss` schema in the application database on first `boss.start()`. Prisma Migrate manages only the `public` schema, so the two coexist — but `prisma migrate reset` will not recreate the pgboss schema, and a developer who resets will need the worker to run once before jobs flow again. Document this in the worker README.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | Everything; pg-boss 12 needs ≥ 22.12.0 | ✓ | 22.14.0 | — |
| npm | Package installs | ✓ | 10.9.2 | — |
| Docker | MinIO, Postgres, ClamAV, worker | ✓ | 29.6.2 | — |
| Docker Compose | The deployment artefact | ✓ | v5.3.1 | — |
| Python + pip | slopcheck tooling only | ✓ | 3.13.5 / 25.1.1 | — |
| `psql` CLI | Manual application of raw-SQL migrations (`prisma/sql/*.sql`) | ✗ | — | `docker compose exec postgres psql`, or paste the SQL into the Prisma migration file as `001_integrity.sql`'s header instructs |
| PostgreSQL server | Integration tests for Patterns 3 & 4 | Not probed | — | `docker compose up postgres`; dev currently uses Neon per PROJECT.md |
| MinIO | D-28 uploads | Provisioned in Compose, not running | — | — |
| ClamAV | D-28 scanning | **Not present in `docker-compose.yml`** | — | None — must be added |
| `Dockerfile` | Building the `worker` (and `app`) Compose service | **Does not exist in the repository** | — | Run the worker outside Compose with `npx tsx worker/index.ts` during development |

**Missing with no fallback:**
- **ClamAV service** — must be added to `docker-compose.yml` (D-28 has no alternative engine).
- **A `Dockerfile`** — the Compose file currently provisions dependencies only. Adding the `worker` service requires one. This is a genuine scope item the planner must schedule, not assume.

**Missing with fallback:**
- `psql` — use `docker compose exec postgres psql` or the existing paste-into-migration convention.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | JSON snapshot payload beats normalised snapshot rows for this workload | Pattern 1 | Design judgement, not a fact. If the learner read path later needs to query *inside* snapshots (e.g. "every cohort whose obligations include lesson X"), normalised rows would win. Confirm with the user before locking. |
| ~~A2~~ | ~~Streaming downloads through a Route Handler (option B) beats presigned-URL redirects for this deployment~~ — **RESOLVED 2026-09-02, AND REVERSED.** A2 chose streaming solely because a URL signed for `http://minio:9000` is unresolvable from a browser. D-35 moved production object storage to Cloudflare R2, which has a real public hostname with TLS, so that objection no longer exists. D-36 rules that downloads presign and 302. See plan `04-07` `<planner_decisions>` and Task 3. | Pattern 8 | No longer an open risk. The residual risk moved: a presigned URL must be signed for the host the BROWSER resolves (`S3_PUBLIC_ENDPOINT`), not the one the server uses. Plan 04-07 Task 1 names this and Task 3 tests the 302 expiry. A second residual surfaced during plan verification and became **D-37**: a single TTL cannot serve both a PDF and a 2 GB video, because a media element issues Range requests against the *resolved* presigned URL rather than re-resolving the route. TTL is therefore per content type — 60s for FILE/IMAGE, 4h for VIDEO. |
| A3 | `@aws-sdk/lib-storage`'s `Upload` accepts a web `ReadableStream` as `Body` | Pattern 7 | May need `Readable.fromWeb(request.body)`. A one-line fix, but it will fail at the first video upload if assumed wrong. Verify against installed types. |
| A4 | pg-boss's `Db` interface can be satisfied with `tx.$queryRawUnsafe` on Prisma 6 | Pitfall 7 (option B) | Only the *fallback* path; the recommended path (reconciliation cron) does not depend on it. Requires a spike before being planned as primary. |
| A5 | `immediatelyRender: false` is the correct Tiptap 3 SSR option name | Code Examples | Hydration-mismatch warnings in staff authoring. Verify against `@tiptap/react@3.31.0` types. |
| A6 | Tiptap 3 StarterKit's `configure` accepts `heading.levels`, `link`, and per-extension `false` disabling | Code Examples | StarterKit v3 absorbed extensions and changed option keys vs v2. **Read the installed `.d.ts` before writing this component.** |
| A7 | `forcePathStyle: true` is required for MinIO with AWS SDK v3 | Code Examples | Long-standing convention, not re-verified against MinIO docs this session. Wrong ⇒ bucket-as-subdomain requests that MinIO rejects. |
| A8 | Prisma's `DateTime` round-trips through a form field without precision loss | Pattern 4 | If `updatedAt` is `timestamp(6)` and the token is serialised as an ISO string (millisecond precision), the D-23 check would **never** match and every reorder would be refused. Test this explicitly. |
| A9 | Adding a jsdom/browser Vitest project is worth the cost for the D-19 keyboard path | Validation Architecture | Testing-strategy judgement. Option (a) is a legitimate choice and matches the existing codebase. |
| A10 | `@types/sanitize-html` and `@types/clamscan` exist and are current | Installation | Trivial to correct at install time. |
| ~~A11~~ | ~~`CohortStatus` includes `PUBLISHED` / `IN_PROGRESS`~~ — **RESOLVED, VERIFIED** | Pattern 9 | Confirmed at `prisma/schema.prisma:53-59`: `DRAFT PUBLISHED IN_PROGRESS COMPLETED CANCELLED`. No longer an assumption. |
| A12 | `postinstall` scripts of the recommended packages are benign | Package Legitimacy Audit | Not individually inspected. Run `npm view <pkg> scripts.postinstall` before the install task. |

---

## Open Questions

> **All six RESOLVED during planning, 2026-09-02.** Each is answered below with a pointer to where the
> decision is recorded and enforced. Nothing in this section is still open; do not re-litigate them during
> execution.

1. **RESOLVED — `Cohort` pins directly AND `CohortCourse` pins per-course.** Both, because `Cohort` carries
   `courseId XOR programmeId` and a standalone-Course Cohort has no guaranteed `CohortCourse` row to hang a
   pin on. Recorded in plan `04-02` `<planner_decisions>` (OQ-1) and implemented as
   `Cohort.coursePublicationId`, `Cohort.programmePublicationId` and `CohortCourse.coursePublicationId`,
   each with its own `@@index` because PostgreSQL does not index a foreign key automatically.

   *Original question:* **Does `CohortCourse` get a row for standalone-Course Cohorts, or only for Programme Cohorts?**
   - What we know: `Cohort` has `courseId` XOR `programmeId` (enforced by a CHECK constraint). `CohortCourse` exists with `contentVersion` and `contentSnapshot`, commented as the Programme-cohort mechanism.
   - What's unclear: whether a standalone-Course Cohort also gets one `CohortCourse` row, or pins its publication directly on `Cohort`.
   - Recommendation: **give `Cohort` its own `coursePublicationId` as well**, so a standalone-Course Cohort pins directly and a Programme Cohort pins per-course through `CohortCourse`. Uniform read path: "resolve the publication(s) for this cohort" is one function either way. Phase 5 owns the UI; this phase owns the columns and the resolver. Flag to the user.

2. **RESOLVED — kept, never written.** Plan `04-02` Task 1 retains `CohortCourse.contentSnapshot` and
   amends its comment to point at `coursePublicationId` as the live mechanism. Removing it would churn a
   migration for no gain; Phase 15 may drop it.

   *Original question:* **Does `contentSnapshot Json?` get dropped, or kept as a denormalised copy?**

3. **RESOLVED — Testcontainers, and it is a pre-flight condition, not a fallback (D-32).**
   `tests/support/pg.ts` in plan `04-05` Task 1 starts `postgres:16-alpine` and runs `prisma migrate deploy`.
   Plans `04-05` Task 3 and `04-08` Task 3 both state that if Docker is unavailable the executor reports a
   blocker rather than weakening the tests to mocks. Option (b) from Validation Architecture was also taken:
   plan `04-01` adds a narrow jsdom Vitest project for `tests/components/**/*.test.tsx`, used only for the
   D-19 keyboard path and the D-26 three-state rendering.

   *Original question:* **Which Vitest strategy for PostgreSQL-semantics tests?**

4. **RESOLVED — promoted now.** Plan `04-02` adds `enum ScanStatus { PENDING CLEAN INFECTED ERROR }` and
   applies it to all three models in the single phase migration, with a schema test that fails if any of
   them reverts to `String`. One migration here stops Phases 10 and 12 inventing two more vocabularies.

   *Original question:* **Is `scanStatus` promoted to an enum now, or left as a String?**

5. **RESOLVED — this phase builds it (D-33).** Plan `04-10` Task 1 adds a multi-stage `Dockerfile` and
   `.dockerignore`, and the `app` and `worker` Compose services build from the same image with different
   entrypoints. Phase 15 inherits the deployable artefact rather than discovering it is missing.

   *Original question:* **Who owns the `Dockerfile`?**

6. **RESOLVED — yes, in a collapsed section (now D-34, user-confirmed).** Plan `04-09` Task 1 renders a
   collapsed "Withdrawn (n)" section excluded from the arrangement payload, with a Restore action per row.
   Restore APPENDS to the end rather than returning to the original slot — plans `04-03` and `04-04`
   implement that with `nextAppendPosition`, because the position indexes are total and the old slot is
   very likely occupied by then.

   *Original question:* **Does the arrange view need to render withdrawn lessons at all?**

---

## Sources

### Primary (HIGH confidence — read from installed source this session)

- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` — async request APIs, Turbopack default, `revalidateTag` two-arg requirement, `updateTag`, `refresh`, `middleware`→`proxy`, `cacheComponents`, React 19.2
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` — 1 MB body cap (line 83), CSRF Origin check (line 82), security model, `updateTag`/`revalidatePath`/`refresh` selection
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` — Server Function creation and invocation
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md` — streaming vs true 404, Route Handler usage, `unstable_rethrow`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md` — `not-found.js` / `global-not-found.js` conventions and status codes
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/forbidden.md` — 403 semantics (why CAT-07 must not use it)
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:453-503, 1094` — `onNavigate` + `preventDefault()` navigation blocking, React Context pattern for unsaved changes
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` — `type` argument required for dynamic segments
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md` — opting a route out of prerendering
- `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` — the applicable caching model (cacheComponents is off), `dynamic`/`fetchCache` segment config
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` — `bodySizeLimit`, `allowedOrigins`
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md` — 10 MB default, silent truncation
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md` — `@aws-sdk/client-s3` already auto-externalized
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (§Request Body, line 597) — no `bodyParser` limit on Route Handlers
- `prisma/schema.prisma` (lines 420–660) — Programme, ProgrammeCourse, Course, Module, Lesson, LessonResource, Cohort, **CohortCourse.contentSnapshot**
- `prisma/migrations/20260901115332_init/migration.sql:827,839,845` — position uniqueness emitted as `CREATE UNIQUE INDEX`
- `prisma/sql/001_integrity.sql` — the manual raw-SQL convention
- `src/server/services/resource-service.ts`, `course-service.ts` — the factory and its reference consumer
- `src/server/permissions/{catalogue,scope,with-permission,index}.ts` — the closed catalogue and the choke point
- `src/app/staff/courses/[id]/page.tsx` — the established `AuthorizationError → notFound()` pattern
- `eslint.config.mjs`, `vitest.config.mts`, `tests/boundary.test.ts`, `tests/resource-service.test.ts` — boundary rule and test idioms
- `unpkg.com/pg-boss@12.29.0/package.json` and `dist/index.d.ts` — ESM-only, Node ≥ 22.12, named `PgBoss` export
- `raw.githubusercontent.com/timgit/pg-boss/master/README.md` — v12 usage, array handler, `createQueue`, requirements
- npm registry (`npm view`) — every version, publish date, and `peerDependencies` block quoted in §Standard Stack
- GitHub REST API (`/repos`, `/advisories`) — maintenance signals and the CVE analysis in Pitfall 2
- `slopcheck install` — 14 packages, 14 OK

### Secondary (MEDIUM confidence — web sources cross-checked against a primary signal)

- [pgboss.io/api/adapters](https://pgboss.io/api/adapters) — "Requires Prisma v7+ with `@prisma/adapter-pg`"; the minimal `Db` interface. Corroborated by the project's own Prisma 6.19.3 pin.
- [docs.clamav.net/manual/Installing/Docker.html](https://docs.clamav.net/manual/Installing/Docker.html) and [hub.docker.com/r/clamav/clamav](https://hub.docker.com/r/clamav/clamav) — official image, port 3310, 1.2 GB signature-load floor / 4 GB recommended
- [github.com/hello-pangea/dnd](https://github.com/hello-pangea/dnd) — keyboard + screen-reader support, movement between lists. Corroborated by the npm `peerDependencies` declaring React 19.
- Search result establishing that `apostrophecms/sanitize-html` was archived 2026-02-26 in favour of the `apostrophecms/apostrophe` monorepo — corroborated by the package's own `repository.url` pointing at `apostrophecms/apostrophe` and by continued monthly npm releases through 2026-08-13.

### Tertiary (LOW confidence — used only for orientation, not for any recommendation)

- [dev.to — Top 5 Drag-and-Drop Libraries for React in 2026](https://dev.to/puckeditor/top-5-drag-and-drop-libraries-for-react-24lb) and [puckeditor.com blog](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) — their download figures disagree with the npm API and their "dnd-kit is the 2026 default" conclusion does not survive the observation that `@dnd-kit/core` has not shipped since 2024-12-05. Not relied upon.
- [pkgpulse.com comparison](https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026) — same caveat.
- A HackerNoon article promoting `pompelmi` — self-promotional; the package was **not** recommended.

---

## Metadata

**Confidence breakdown:**

- **Next.js 16 mechanics: HIGH** — every claim cites a file under `node_modules/next/dist/docs/` read in this session, as `AGENTS.md` mandates. Nothing from training data.
- **Existing-schema and codebase findings: HIGH** — read directly from `prisma/schema.prisma`, the init migration SQL, and `src/`. The unique-index-not-constraint finding and the pre-existing `CohortCourse.contentSnapshot` field are both verified against source.
- **Standard stack (versions, maintenance, peer deps): HIGH** — npm registry and GitHub API, queried 2026-09-02. All 14 packages clean under slopcheck.
- **Library *selection* (which DnD, which sanitiser, which editor): MEDIUM** — the evidence (peer-dependency declarations, publish recency, repo activity, advisory reachability under D-30's allow-list) is verified; weighing it against the locked constraints is judgement. The alternatives table gives the planner enough to overrule.
- **Architecture patterns 1, 8: MEDIUM** — Pattern 1's JSON-vs-normalised call and Pattern 8's stream-vs-presign call are design judgements, logged as A1 and A2.
- **Architecture patterns 2–7, 9: HIGH** — derived from verified framework behaviour and verified schema facts.
- **Pitfalls: HIGH** — every pitfall traces to a verified source: an installed doc line, a migration file line, a package.json field, or the GitHub advisory API.
- **Validation architecture: MEDIUM** — the framework facts are verified (`vitest.config.mts` read directly); the recommendation to add a component-test project is judgement (A9).

**Research date:** 2026-09-02
**Valid until:** 2026-10-02 for the framework and schema findings (stable). **2026-09-16 for the drag-and-drop recommendation** — `@dnd-kit/react` is at 0.5.0 and moving; if it reaches 1.0 with a React 19 guarantee before this phase is executed, re-evaluate.
