# Phase 4: Catalogue Authoring — Programmes, Courses, Modules & Lessons - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 4-catalogue-authoring-programmes-courses-modules-lessons
**Areas discussed:** Versioning, Public page vs content, Archiving, Reordering, Readiness checks, Lesson content & uploads

**Note on question framing:** the first attempt at presenting gray areas bundled two to three
decisions into each option and leaned on schema jargon. The user asked for them to be broken down and
explained better. All subsequent questions were re-framed in plain language with a concrete scenario
per question. Recorded because it changed how the whole discussion was run.

---

## Versioning

### Q1 — A Cohort started in January. In March you edit the course. What should those January learners see?

| Option | Description | Selected |
|--------|-------------|----------|
| Freeze obligations only | Snapshot the rules on publish; prose and media stay live for everyone | ✓ |
| Freeze everything | Full frozen copy of the module/lesson tree; typo fixes never reach a running class | |
| Draft and live copies | Edit safely in a draft; publishing still pushes to everyone at once | |
| Warn only | Edits go live immediately; confirmation dialog naming affected cohorts | |

**Notes:** Framing that drove the answer — the requirement says "silent **requirement** changes", not
"content changes", so what it guards is a learner's obligations rather than prose.

### Q2 — Three classes are mid-flight on v2 when you publish v3. How do staff move them across?

| Option | Description | Selected |
|--------|-------------|----------|
| Publish dialog lists them | Tick-box per affected class, unticked by default, reason required, audited | ✓ |
| Separate action on the class | Publishing only ever affects future classes; migration is a separate deliberate act | |
| Effective date | All running classes roll over automatically on a set date | |
| Both dialog and later action | Tick-boxes at publish plus a persistent control on each class | |

### Q3 — Where is the line between an obligation and ordinary content?

| Option | Description | Selected |
|--------|-------------|----------|
| Structure + rules | Frozen: lesson set, order, required flags, attached assessment, completion rule | ✓ |
| Rules only | Frozen: required flags and completion rule only; lesson set and order stay live | |
| Structure, rules + titles | As above plus module and lesson titles | |

**Notes:** Deletion case resolved here — a withdrawn lesson stays visible-but-inert for pinned classes
so completion records are never orphaned. This is what later forced the `withdrawnAt` decision under
Archiving.

### Q4 — Do Programmes get the same freeze treatment?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, same treatment | Snapshot course list, order, sequential flag and completion rule | ✓ |
| Courses only | Programmes stay live with a warning | |
| Programme list only | Freeze the course list and order, leave the completion rule live | |

**Notes:** Raised as a gap — the first three questions had covered only Courses.

### Q5 — Between publishes, an obligation field is edited but not republished. A new class starts tomorrow. What does it owe?

| Option | Description | Selected |
|--------|-------------|----------|
| Last published snapshot | Every class, new or running, binds to a published snapshot, never live fields | ✓ |
| Live fields | New classes pick up current values; only running classes are pinned | |
| Block the edit | Obligation fields are immutable on a published course; must start a new draft version | |

---

## Public page vs content

### Q1 — One switch or two?

| Option | Description | Selected |
|--------|-------------|----------|
| Two switches | `status` for learner content plus a separate readiness-gated public-listing flag | ✓ |
| One switch | Published means sales page and learner material go live together | |
| Derive from cohorts | Public page appears when a bookable Cohort is published against it | |

**Notes:** The two combinations that motivated it — taking bookings before content is finished, and
running a private/corporate course that is delivered but never listed.

### Q2 — Which existing permission controls the public-listing switch?

| Option | Description | Selected |
|--------|-------------|----------|
| `programmes.publish` | Listing is a commercial act; Instructors publish content but cannot list for sale | ✓ |
| `courses.publish` | Same permission for both; one publish right, one mental model | |
| `users.manage` | Administrators only | |

**Notes:** Constrained by the closed 36-identifier permission catalogue — no `catalogue.list` can be
added, so listing had to reuse an existing identifier.

### Q3 — How much of the public page is Phase 4's job?

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only detail + index | Index and detail pages; no booking, pricing, search or filters | ✓ |
| Detail pages only | Individual pages, no public index | |
| Index, detail, search + filters | Full browsing experience | |

### Q4 — What happens to the URL when a listed course is renamed?

| Option | Description | Selected |
|--------|-------------|----------|
| Frozen once listed | Editable while unlisted, locked on first public listing; no redirect machinery | ✓ |
| Follows the title | Slug regenerates on rename; needs historical-slug redirect tracking | |
| Always manually editable | Free-text field with a uniqueness check | |

### Q5 — Can content be unpublished while classes are mid-flight?

| Option | Description | Selected |
|--------|-------------|----------|
| Blocked while classes run | Control names the blocking classes; public listing can always be switched off | ✓ |
| Allowed with a warning | Dialog names affected classes, requires a reason, audited | |
| Never unpublish | Published can only move forward to Archived | |

### Q6 — Can staff preview before publishing?

| Option | Description | Selected |
|--------|-------------|----------|
| Both views, staff-only link | Public sales page and learner lesson view, gated on `courses.view` | ✓ |
| Public page only | Preview the sales page only | |
| No preview this phase | Publish and look at the real page | |

---

## Archiving

### Q1 — Archiving a Course that sits in Programmes and has a running class

| Option | Description | Selected |
|--------|-------------|----------|
| Block on classes, warn on programmes | Running class blocks; programme membership warns with a reason | ✓ |
| Warn on both | Always permitted with a naming dialog and a reason | |
| Block on both | Refused until no running classes and removed from every programme | |

**Notes:** Chosen partly for consistency — same blocking rule as unpublish, so staff learn one principle.

### Q2 — Who can read archived material afterwards?

| Option | Description | Selected |
|--------|-------------|----------|
| Learners who studied it, indefinitely | Any completion record or enrolment keeps read access forever | ✓ |
| Learners until their class ends | Access lapses when the class closes; certificate and grade survive | |
| Staff only | Archived means gone for learners immediately | |

### Q3 — Can archiving be undone?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, back to draft | Returns to DRAFT + unlisted; re-publishing re-runs readiness checks | ✓ |
| Yes, restores prior state | Returns exactly as it was, published and listed if so left | |
| No, archiving is final | Clone into a new record to run it again | |

### Q4 — How should removing a Module or Lesson work?

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-delete flag on both | Add `withdrawnAt`; row survives, hidden from authoring, readable for pinned classes | ✓ |
| Full status field on both | Give Module and Lesson their own DRAFT/PUBLISHED/ARCHIVED | |
| Hard delete, blocked when referenced | Keep cascade delete, refuse when referenced | |

**Notes:** Surfaced as a genuine gap during discussion — Module and Lesson have no status field and
cascade-delete today, which contradicts both the project-wide no-hard-deletes rule and the
visible-but-inert behaviour agreed under Versioning Q3.

### Q5 — Do Programmes archive under the same rules?

| Option | Description | Selected |
|--------|-------------|----------|
| Same rules | Running programme-classes block; course membership informational only | ✓ |
| Stricter for programmes | Also require the programme be emptied of courses first | |
| Looser for programmes | Archive freely with a warning even mid-delivery | |

---

## Reordering

### Q1 — How do staff move things around?

| Option | Description | Selected |
|--------|-------------|----------|
| Arrows, keyboard-first | Move up/down buttons only; accessible by construction, no drag library | |
| Drag-and-drop plus arrows | Mouse drag with the arrows kept as the keyboard path | ✓ |
| Editable position numbers | Type a new position; everything renumbers | |

**Notes:** WCAG 2.2 AA (NFR-09) is a locked project constraint, so the keyboard path ships alongside
the drag interaction rather than instead of it. This makes the chosen option strictly more work than
arrows alone.

### Q2 — When does a move actually save?

| Option | Description | Selected |
|--------|-------------|----------|
| Save immediately | Each move writes straight away; no unsaved state | |
| Explicit Save order | Rearrange freely, commit the whole arrangement at once | ✓ |
| Arrange mode | Dedicated screen, saves on exit | |

### Q3 — Can a lesson move between modules?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, across modules | Dragging re-parents the lesson and renumbers both modules | ✓ |
| Within a module only | Moving elsewhere means editing the lesson's module in a form | |

### Q4 — Navigate-away or Publish with a pending unsaved rearrangement

| Option | Description | Selected |
|--------|-------------|----------|
| Warn on both | Navigate-away confirms; Publish blocked outright | ✓ |
| Warn on navigate-away only | Publish proceeds against whatever is saved | |
| Autosave as a draft order | Rearrangements persist as a draft ordering until Save | |

### Q5 — Two staff rearrange concurrently; CAT-03 asks for ordering "stable after save"

| Option | Description | Selected |
|--------|-------------|----------|
| Version check on save | Page carries `updatedAt`; server refuses the write if it has moved | ✓ |
| Last write wins | No check; losing rearrangement disappears silently | |
| Lock while editing | Arrange view takes a lock; others read-only | |

### Q6 — Where does the "mark required content" toggle live?

| Option | Description | Selected |
|--------|-------------|----------|
| In the lesson form | Saved with the lesson; arrange view shows a read-only badge | ✓ |
| Inline in the arrange list | Toggle per row in the arrange view | |
| Both | Inline for speed plus the lesson form for completeness | |

---

## Readiness checks

### Q1 — Hard gates or advisory?

| Option | Description | Selected |
|--------|-------------|----------|
| Hard gate on a small core | Short defined block list; everything else warns | ✓ |
| All hard gates | Every check must pass before listing | |
| All advisory | Show what is missing, block nothing | |

**Notes:** All-advisory was flagged as not satisfying CAT-07, which requires that only readiness-passing
offers appear publicly — that needs something to actually not pass.

### Q2 — The PXR checklist covers Cohort concerns that land in Phase 5

| Option | Description | Selected |
|--------|-------------|----------|
| Show as named gaps | Full category list; Phase 5 items render as "not yet checked", neither tick nor cross | ✓ |
| Content categories only | Show only what Phase 4 can evaluate | |
| Build the whole checklist now | Implement every category including schedule, price, capacity, instructors | |

**Notes:** Directly honours the PXR instruction that PRD decisions "remain named gaps rather than
silently assumed pass."

### Q3 — Where does the checklist appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Panel plus publish dialog | Persistent panel on the detail page, same summary repeated at listing | ✓ |
| Publish dialog only | Appears only when listing is attempted | |
| Panel only | Always visible; listing button disabled with a tooltip | |

---

## Lesson content & uploads

> This area was initially skipped, then reopened by the user at the end of the discussion on the
> grounds that it most changes the size of the phase.

### Q1 — How much of the file pipeline does Phase 4 build?

| Option | Description | Selected |
|--------|-------------|----------|
| Full pipeline, all types | MinIO upload, pg-boss scan job, short-lived links, for files/images/video | ✓ |
| Files and images, video later | Trim the hardest part; video becomes its own slice | |
| Upload now, scanning stubbed | Wire upload and access; scanning hook marks everything CLEAN | |
| Defer all binary uploads | Text, embed and link lessons only | |

**Notes:** Three models carry `scanStatus` — `LessonResource` (this phase), `Submission` (Phase 10),
`TicketAttachment` (Phase 12) — so the pipeline is built once and inherited twice. Deferring would have
left CAT-04 explicitly unmet and required a roadmap insertion.

### Q2 — What do QUIZ and ASSIGNMENT lesson types do, given Assessment authoring is Phase 10?

| Option | Description | Selected |
|--------|-------------|----------|
| Slot exists, empty picker | Lesson takes its place in order and required-flags; picker empty, flagged as a named gap | ✓ |
| Hide both types | Only the six content types appear this phase | |
| Minimal assessment stub | Create a bare Assessment record from the lesson | |

### Q3 — What do staff write a text lesson in?

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown with preview | Plain text box, few symbols, Preview tab; no dependency, no stored HTML to clean | |
| Rich text editor | Word-style toolbar; nothing to learn; stores sanitized HTML | ✓ |
| Markdown now, editor later | Ship Markdown, add an editor on the same stored format later | |
| Structured blocks | Typed blocks stored as JSON | |

**Notes:** Asked twice. The first presentation was answered with a request to explain the options
further; a plain-language explanation of what each looks like to the person writing, and where the real
differences land (accessibility, sanitisation, versioning), preceded the second ask.

The user then challenged the Markdown recommendation directly. On re-examination the recommendation had
weighted implementation cost over authoring cost, which was the wrong way round for this product — the
people writing lessons are Programme Managers and Instructors, not developers, so a recurring daily
learning cost falls on them while the costs avoided were one-time and fell on the builder. Two of the
four arguments for Markdown also did not survive the follow-up decisions: the accessibility argument is
neutralised by the constrained toolbar, and the versioning argument does not apply because prose is
never frozen. The sanitisation surface and editor dependency remain real and were accepted.

### Q4 — What is on the toolbar?

| Option | Description | Selected |
|--------|-------------|----------|
| Constrained toolbar | Bold, italic, H2, H3, lists, link; no sizes, families, colours, or H1 | ✓ |
| Constrained plus warnings | Same toolbar plus live accessibility checks | |
| Full toolbar | Fonts, sizes, colours, alignment | |

### Q5 — What gets stored in `Lesson.body`?

| Option | Description | Selected |
|--------|-------------|----------|
| Sanitized HTML | Strict allow-list, cleaned on save and on render; renders with no client library | ✓ |
| Editor JSON | Lossless round-trip; ties content to one editor library | |

---

## Claude's Discretion

The user decided every gray area presented; nothing was delegated. Three implementation choices were
left to research and planning rather than settled in discussion:

- Drag-and-drop library (must support a keyboard-accessible fallback and pointer/touch input)
- Virus-scanning engine and its pg-boss job shape (no scanner dependency, and no worker service in
  `docker-compose.yml` yet)
- HTML sanitiser (must run on write and on render)

## Deferred Ideas

- **Catalogue search and filtering** — belongs with discovery in Phase 6
- **Booking and pricing on public pages** — Phase 6; this phase builds the pages they attach to
- **Cohort-side readiness checks** (schedule, price, capacity, instructors) — Phase 5 fills the
  named-gap slots created here
- **Assessment authoring** (questions, grading, marking) — Phase 10 fills the empty picker
- **Slug redirect history** — rejected in favour of freezing the slug; a historical-slug lookup table is
  the fallback if URLs ever need to change at scale
