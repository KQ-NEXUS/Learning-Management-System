# Phase 11: Certificates & Completion Lifecycle - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning
**Track:** B — Content & Delivery (depends on Phase 10 grading results, Phase 5 attendance rules)

<domain>
## Phase Boundary

Certificates are trustworthy — issued only when earned, publicly verifiable with minimal data, and
correctly revisited when underlying results change (CRD-01 → CRD-06).

**In scope:**
- Course certificate issuance for standalone Course-cohort enrolments only (CRD-01).
- Programme certificate issuance for Programme-cohort enrolments, after all required member Courses
  and Programme-level rules pass (CRD-02).
- A downloadable, access-controlled certificate file carrying a unique public verification reference
  and minimal approved learner/award fields (CRD-03).
- Public certificate verification by reference, revealing only active/revoked status and approved
  award facts — no account data (CRD-04).
- Staff revocation and reissue with mandatory reason, linking old/new certificate versions (CRD-05).
- Re-evaluation after a later grade/attendance/completion correction: affected certificates are
  flagged for review, never silently altered or destroyed (CRD-06).
- The `Enrolment.status → COMPLETED` transition and its reversal, which Phase 9 explicitly deferred
  to this phase.
- A certificate-template authoring surface (design elements, positioning, save as reusable template)
  and per-Course/Programme template selection — a genuine scope addition beyond the bare CRD
  requirements, decided during this discussion (see Decisions).

**Explicitly NOT in scope:**
- Extending `completionRule` itself or how `CompletionRecord` is computed — Phase 9/10 already built
  and own `recalculateCompletion()`; this phase only consumes its output (satisfied `CompletionRecord`
  rows) and reacts to grade/attendance corrections that flow through it.
- Support tickets (Phase 12) — dashboard's "tickets" slot stays a named gap.
- Certificate-issuance/revocation transactional emails (Phase 13) — this phase emits domain events;
  Phase 13 drains them.

</domain>

<decisions>
## Implementation Decisions

### Course certificates and Programme enrolments
- **D-01:** "Standalone" in CRD-01 is literal. Course certificates issue **only for Course-cohort
  enrolments**. A Programme-cohort enrolment issues exactly **one** Programme certificate at
  completion — never individual Course certificates for its member courses — even though
  `completion-service.ts` (Phase 9) already creates a `COURSE`-scope `CompletionRecord` for every
  member course internally. That internal per-course evidence is read (e.g. to show progress), never
  used to trigger a Course `Certificate` row, when the enrolment's cohort is Programme-based.

### Issuance trigger
- **D-02:** Certificate issuance mode is **staff-configurable per Course/Programme**, not a single
  hardcoded mechanism. A new field sits next to the existing `certificateEnabled` on `Course` and
  `Programme` — e.g. `certificateIssuanceMode: AUTOMATIC | MANUAL` — requiring a schema migration.
  One Course can auto-issue while another Programme requires staff sign-off.
- **D-03: `AUTOMATIC` mode** — issuance fires reactively, in the same transaction that satisfies the
  relevant `CompletionRecord`, mirroring Phase 9's D-11 (reactive recalculation) and Phase 10's D-01
  (quiz auto-release). Runs as a **system actor** (`actorId: null`, `actorType: SYSTEM`), the same
  `*AsSystem` pattern the checkout webhook (`checkout-webhook-system-service.ts`) already established.
  `certificates.issue` (the standalone permission already in the catalogue) exists for staff-triggered
  exceptions — e.g. manual reissue after a CRD-06 correction — not for every automatic issuance.
- **D-04: `MANUAL` mode** — completion passing makes a certificate **eligible**, not issued. A new
  staff-facing **pending-review queue** (e.g. `/staff/certificates`, filtered to eligible-not-yet-
  issued) surfaces every enrolment satisfying its rule under a `MANUAL`-mode Course/Programme. Staff
  click Issue, authorized by `certificates.issue`, audit-first — mirrors Phase 10's grading-queue
  precedent (`10-CONTEXT.md` D-06 batch-release UI).

### `Enrolment.status → COMPLETED`
- **D-05:** The transition to `COMPLETED` fires **on certificate issuance** (whether `AUTOMATIC` or a
  staff `MANUAL` click) — not merely on `CompletionRecord` creation. For a Programme-cohort enrolment,
  it fires only when the **`PROGRAMME`-scope** certificate issues, consistent with D-01: individual
  member-course completions never complete the enrolment on their own.
- **D-06:** `COMPLETED` is **reversible**. If a later CRD-06 correction invalidates the certificate
  (revoked, flagged for review), `Enrolment.status` reverts to `ACTIVE` — mirroring Phase 9's D-12
  `CompletionRecord.supersededAt` pattern (nothing destroyed, just no longer current truth). The
  learner can be re-evaluated and re-complete once the correction is resolved. This is the
  "revocation semantics that make a terminal state safe" that Phase 9's `completion-service.ts` DD-6
  comment explicitly flagged as Phase 11's responsibility.

### Certificate file & rendering
- **D-07:** The LMS **always generates the certificate file per learner** — never a static file the
  school uploads once. Each file must carry that specific learner's name/award/date and a unique
  `verificationRef` (CRD-03), which a single shared upload cannot provide.
- **D-08:** The certificate's **visual design comes from a school-provided branded template**, not the
  app's own built-in look — checked against Moodle's `mod_customcert` plugin before deciding (Moodle:
  composable elements — border, logo image, signature, fonts/colors, dynamic fields — positioned on a
  canvas, rendered to PDF via TCPDF, a pure PDF-construction library, not a headless browser). That
  rendering-mechanism shape (a PDF-construction library, not Puppeteer/HTML-to-PDF) applies regardless
  of template scope, and fits this project's self-hosted Docker Compose deployment better — no browser
  binary needed.
- **D-09 (scope addition — flag for planner):** Phase 11 v1 builds the **full Moodle-style template
  editor** — a genuine authoring surface: add elements, drag to position on a canvas, style
  font/color/size per element, save as a reusable template — not just a single fixed-layout upload
  field. This was an explicit, illustrated choice (two mockups shown, see Specifics) over the smaller
  "one upload, fixed field positions" alternative. Plan for this as real new UI/persistence work on top
  of the six CRD requirements, not a quick add-on.
- **D-10:** Templates live in a **shared library, selected per Course/Programme** — checked against
  Moodle's actual behavior first (site admins author templates globally under Site administration;
  each certificate activity picks which one to "Load"). A new `CertificateTemplate` model holds N
  templates authored in the editor; `Course.certificateTemplateId` / `Programme.certificateTemplateId`
  (nullable, defaults to whichever template is marked default) selects which one that Course/Programme
  issues. This is distinct from D-02's issuance-mode field, which stays per-Course/Programme
  regardless of which template is selected.

### Claude's Discretion
- Exact PDF-construction library choice (e.g. `pdf-lib`, `PDFKit`, or equivalent) — subject to this
  project's mandatory human package-legitimacy approval gate before installing anything new (the same
  gate `stripe`/`lucide-react` went through).
- Exact dynamic-field set beyond the schema's existing `learnerName`/`awardTitle`/`issuedAt`/
  `verificationRef` (e.g. whether a QR code is included, and what URL it encodes — presumably the
  public verification page).
- Template-editor element set and canvas mechanics (drag precision, snapping, undo) — implementation
  detail, not a product decision, provided staff can add/position/style border, image, and each
  dynamic field and save the result as a named, reusable template.
- Verification-reference format — reuse `checkout-service.ts`'s `generateOrderReference()` convention
  (non-sequential, random suffix, so one reference can't be guessed from another) unless research finds
  a reason to diverge.
- Exact revoke/reissue staff workflow shape (dedicated review queue vs. per-certificate action from a
  CRD-06-flagged list) — not discussed in depth this session; CRD-05/CRD-06's audit and
  never-silently-destroyed requirements are locked, the UI shape is planning-time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & product intent
- `.planning/REQUIREMENTS.md` — CRD-01 through CRD-06 (lines 113–118); requirement→phase table
  (lines 269–274).
- `.planning/ROADMAP.md` §"Phase 11" (line 502 onward) — goal, requirements, success criteria,
  dependency on Phase 10 (grading) and Phase 5 (attendance).
- `.planning/PROJECT.md` — locked constraints (archive-only, `@prisma/client` boundary, closed
  permission catalogue, no-hard-deletes).

### Carried forward from Phase 9
- `.planning/phases/09-learning-delivery-progress-tracking/09-CONTEXT.md` — D-11 (reactive
  recalculation, never scheduled), D-12 (`supersededAt`, never delete), D-10 (v1 `completionRule`
  scope: required-lessons + attendance only, no assessment criteria — that changed in Phase 10, read
  current `completion-engine.ts` for the live rule vocabulary).
- `src/server/services/completion-service.ts` — `recalculateCompletion()`'s full behavior; the DD-6
  header comment is the explicit source of this phase's `Enrolment.status` ownership; `applyVerdict()`
  is what creates/supersedes `CompletionRecord` and emits `course.completed`/`programme.completed`
  `DomainEvent`s that this phase's issuance logic should key off of (not read from the outbox — DD-12/
  DD-13 in that file explicitly forbid treating the outbox as a work-queue; issuance should hook the
  same synchronous call path `applyVerdict` uses, analogous to how completion itself hooks lesson-
  progress writes).

### Carried forward from Phase 10
- `.planning/phases/10-assessment-quizzes-assignments-grading/10-CONTEXT.md` — D-01 (auto-release
  precedent for D-03's automatic issuance), D-06 (batch-release/queue UI precedent for D-04's
  pending-review queue), D-07 (`GradeOverride` on `RELEASED`-only grades — one of the correction
  sources CRD-06 must react to).

### Code to build on
- `prisma/schema.prisma` — `model Certificate` (~1229, already has `verificationRef`, `scope`,
  `courseId`/`programmeId`, `awardTitle`, `learnerName`, `issuedAt`, `status: CertificateStatus`,
  `storageKey`, `revokedAt`/`revokedById`/`revocationReason`, `supersedesId` for reissue linkage,
  `reviewFlaggedAt` for CRD-06), `model CompletionRecord` (~1036, `scope: CompletionScope`,
  `courseId`, `ruleVersion`, `evidence`, `supersededAt`), `enum CertificateStatus` (~134: `ACTIVE`,
  `REVOKED`, `SUPERSEDED`), `enum CompletionScope` (~129: `COURSE`, `PROGRAMME`), `enum
  EnrolmentStatus` (~61, `COMPLETED` exists but nothing sets it yet), `Course.certificateEnabled`
  (~561, default `false`), `Programme.certificateEnabled` (~474, default `true`) — **the data model
  is already fully designed for CRD-01..06; nothing built on top of it yet (no service, no UI)**,
  same "schema ready, service+UI work" shape Phase 10 found for Assessment.
- `src/server/permissions/catalogue.ts` (~59–62) — `certificates.view`, `certificates.issue`,
  `certificates.revoke` already exist in the closed permission catalogue. Confirm whether a new
  identifier is needed for template-editor authoring (D-09) — likely reuses an existing
  content-authoring permission rather than needing a new one, research should confirm.
- `src/server/services/enrolment-dashboard-service.ts` (~115, ~270, ~550) — `CERTIFICATE_DEFERRED`
  named-gap column, explicitly pinned to Phase 11; this phase populates it with real data, same
  pattern Phase 10 used for the `assessmentObligations`/`results` columns.
- `src/server/services/checkout-service.ts` (~379) — `generateOrderReference()`, the existing
  random/non-guessable reference-generation convention `verificationRef` generation should follow.
- `src/server/services/resource-service.ts` — the CRUD factory; `CertificateTemplate` authoring
  (create/edit/archive) should build on it like every other resource.
- `src/server/services/lesson-resource-service.ts` + `storage-service.ts` — the existing
  presigned-URL upload/download pipeline; both the school's uploaded template asset and each
  generated certificate PDF (`Certificate.storageKey`) likely reuse this, mirroring how
  `LessonResource`/`Submission` already do.
- `src/server/services/readiness-service.ts` — the pure-evaluator + named-third-state pattern,
  reused three times already (Phase 4 → 5 → 9); D-04's `MANUAL`-mode eligibility list should follow
  the same shape.

### Design grounding from this discussion
- Moodle `mod_customcert` plugin docs (`docs.moodle.org/502/en/Custom_certificate_module`,
  `docs.moodle.org/502/en/Certificate_templates`, `moodle.org/plugins/mod_customcert`) — confirmed:
  (a) templates are composable elements (border/image/signature/dynamic-field) positioned on a canvas
  and rendered to PDF via TCPDF, informing D-08/D-09; (b) templates are authored once in a global
  library and selected per certificate activity via "Load template," informing D-10.

### Framework
- `AGENTS.md` / `node_modules/next/dist/docs/` — mandatory per `AGENTS.md`; live Next.js is 16.3.4
  and differs from training data. Read the relevant guide before writing code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The full `Certificate`/`CompletionRecord` schema already exists** (same shape Phase 10 found for
  Assessment) — this phase is service + UI work on an already-locked data model, not schema design
  from scratch, except for the two additive fields/models D-02 and D-10 introduce
  (`certificateIssuanceMode`, `CertificateTemplate`).
- **`recalculateCompletion()`'s `applyVerdict()` success path** — the exact hook point for D-03's
  automatic issuance; it already knows scope/courseId/verdict per evaluated enrolment.
- **`*AsSystem` service pattern** (`checkout-webhook-system-service.ts`, established Phase 6) —
  directly reusable for D-03's system-actor automatic issuance.
- **Presigned-URL upload pipeline** — reusable for both the template asset upload and generated
  certificate file storage/download.
- **`createResourceService`** — gives `CertificateTemplate` authoring and Certificate staff views
  authorization/scoping/audit for free.

### Established Patterns
- **Audit-first writes** — actor/before-after/reason/outcome on every mutation (D-04's manual issue
  action and CRD-05's revoke/reissue must follow this, like Phase 5's attendance corrections and
  Phase 10's grade overrides).
- **`@prisma/client` only in `src/server/services/`** — ESLint-enforced, `tests/boundary.test.ts`.
- **Named gaps, not silent passes** — the `NOT_YET_CHECKED`/`deferredTo` convention; Phase 9's
  dashboard `certificate` column is the specific named gap this phase closes.
- **Supersede, never delete** — `CompletionRecord.supersededAt` (D-12/Phase 9) and `Certificate`'s own
  `supersedesId`/`reviewFlaggedAt` fields already follow the same no-hard-deletes convention this
  phase's D-06 reuses for `Enrolment.status` reversal.
- **New third-party dependencies require human legitimacy approval** before install — established
  precedent for `stripe` (Phase 6), `lucide-react` (Phase 04.1), `@tiptap/extensions` (Phase 04.1);
  applies to whatever PDF-construction library this phase adds.

### Integration Points
- Phase 9's dashboard `certificate` named-gap column → this phase populates it with real state
  (eligible/issued/revoked/flagged).
- Phase 10's `GradeOverride` (RELEASED-only corrections) and Phase 5's attendance corrections are
  the two correction sources CRD-06 must listen for to set `Certificate.reviewFlaggedAt`.
- Phase 13 (Communications) will drain whatever domain events this phase emits (certificate issued,
  revoked, reissued) for transactional email — this phase only needs to emit them, not send anything.
- The public verification page (CRD-04) is a new, unauthenticated public route — likely alongside the
  existing `(public)` route group used by the catalogue pages.

</code_context>

<specifics>
## Specific Ideas

- Two illustrated mockups were shown and compared before deciding D-09: a "fixed layout, one uploaded
  background image" option and a "full Moodle-style drag-and-drop template editor" option (Artifact:
  https://claude.ai/artifact/XCab67XEfi8jGbi1VwMpUE). The user picked the full editor after seeing
  both, explicitly accepting the larger scope.
- Two decisions (D-08 visual-design source, D-10 template span) were deliberately checked against
  Moodle's real, documented `mod_customcert` behavior before locking in, rather than assumed — same
  grounding discipline Phase 10 used for quiz release/grading-method decisions.

</specifics>

<deferred>
## Deferred Ideas

None raised outside phase scope — discussion stayed within Phase 11's certificate/completion domain
throughout, including the larger template-editor scope (D-09), which is still "how to implement
CRD-03," not a new capability.

### Reviewed Todos (not folded)
- `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` (area: ui, score 0.9 — keyword match
  on "review/verification/staff/courses" is generic, not a real domain match) — Phase 4.1's staff-side
  catalogue/lesson-editor async-mutation warnings; unrelated to Phase 11's certificate domain. Not
  folded (also reviewed-not-folded in Phase 9 and Phase 10).
- `2026-09-14-fix-07-review-manual-payment-race-and-idempotency.md` (area: payments, score 0.6) —
  Phase 7 payment-integrity bug; unrelated to certificates. Not folded (also reviewed-not-folded in
  Phase 9 and Phase 10).

</deferred>

---

*Phase: 11-Certificates & Completion Lifecycle*
*Context gathered: 2026-09-16*
