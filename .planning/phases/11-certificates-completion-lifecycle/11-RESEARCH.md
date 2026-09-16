# Phase 11: Certificates & Completion Lifecycle - Research

**Researched:** 2026-09-16
**Domain:** Server-generated PDF certificates, reactive issuance hooked to an existing completion engine, public unauthenticated verification, revocation/reissue history, and a new Moodle-style template editor — on Next.js 16.3.4 / Prisma 6.19 / Postgres, self-hosted Docker Compose.
**Confidence:** MEDIUM-HIGH (architecture/integration points: HIGH, verified by direct source read; PDF-library choice: MEDIUM, package identity is [ASSUMED] per provenance rule even though registry-verified; template-editor canvas mechanics: LOW, no comparable UI exists in this codebase yet)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** "Standalone" in CRD-01 is literal. Course certificates issue only for Course-cohort enrolments. A Programme-cohort enrolment issues exactly one Programme certificate at completion — never individual Course certificates for its member courses — even though `completion-service.ts` (Phase 9) already creates a `COURSE`-scope `CompletionRecord` for every member course internally. That internal per-course evidence is read (e.g. to show progress), never used to trigger a Course `Certificate` row, when the enrolment's cohort is Programme-based.
- **D-02:** Certificate issuance mode is staff-configurable per Course/Programme, not a single hardcoded mechanism. A new field sits next to the existing `certificateEnabled` on `Course` and `Programme` — e.g. `certificateIssuanceMode: AUTOMATIC | MANUAL` — requiring a schema migration. One Course can auto-issue while another Programme requires staff sign-off.
- **D-03 (AUTOMATIC mode):** issuance fires reactively, in the same transaction that satisfies the relevant `CompletionRecord`, mirroring Phase 9's D-11 (reactive recalculation) and Phase 10's D-01 (quiz auto-release). Runs as a system actor (`actorId: null`, `actorType: SYSTEM`), the same `*AsSystem` pattern the checkout webhook (`checkout-webhook-system-service.ts`) already established. `certificates.issue` (the standalone permission already in the catalogue) exists for staff-triggered exceptions — e.g. manual reissue after a CRD-06 correction — not for every automatic issuance.
- **D-04 (MANUAL mode):** completion passing makes a certificate eligible, not issued. A new staff-facing pending-review queue (e.g. `/staff/certificates`, filtered to eligible-not-yet-issued) surfaces every enrolment satisfying its rule under a `MANUAL`-mode Course/Programme. Staff click Issue, authorized by `certificates.issue`, audit-first — mirrors Phase 10's grading-queue precedent (`10-CONTEXT.md` D-06 batch-release UI).
- **D-05:** The transition to `COMPLETED` fires on certificate issuance (whether `AUTOMATIC` or a staff `MANUAL` click) — not merely on `CompletionRecord` creation. For a Programme-cohort enrolment, it fires only when the `PROGRAMME`-scope certificate issues, consistent with D-01: individual member-course completions never complete the enrolment on their own.
- **D-06:** `COMPLETED` is reversible. If a later CRD-06 correction invalidates the certificate (revoked, flagged for review), `Enrolment.status` reverts to `ACTIVE` — mirroring Phase 9's D-12 `CompletionRecord.supersededAt` pattern (nothing destroyed, just no longer current truth). The learner can be re-evaluated and re-complete once the correction is resolved. This is the "revocation semantics that make a terminal state safe" that Phase 9's `completion-service.ts` DD-6 comment explicitly flagged as Phase 11's responsibility.
- **D-07:** The LMS always generates the certificate file per learner — never a static file the school uploads once. Each file must carry that specific learner's name/award/date and a unique `verificationRef` (CRD-03), which a single shared upload cannot provide.
- **D-08:** The certificate's visual design comes from a school-provided branded template, not the app's own built-in look — checked against Moodle's `mod_customcert` plugin before deciding (Moodle: composable elements — border, logo image, signature, fonts/colors, dynamic fields — positioned on a canvas, rendered to PDF via TCPDF, a pure PDF-construction library, not a headless browser). That rendering-mechanism shape (a PDF-construction library, not Puppeteer/HTML-to-PDF) applies regardless of template scope, and fits this project's self-hosted Docker Compose deployment better — no browser binary needed.
- **D-09 (scope addition — flag for planner):** Phase 11 v1 builds the full Moodle-style template editor — a genuine authoring surface: add elements, drag to position on a canvas, style font/color/size per element, save as a reusable template — not just a single fixed-layout upload field. This was an explicit, illustrated choice over the smaller "one upload, fixed field positions" alternative. Plan for this as real new UI/persistence work on top of the six CRD requirements, not a quick add-on.
- **D-10:** Templates live in a shared library, selected per Course/Programme — checked against Moodle's actual behavior first (site admins author templates globally under Site administration; each certificate activity picks which one to "Load"). A new `CertificateTemplate` model holds N templates authored in the editor; `Course.certificateTemplateId` / `Programme.certificateTemplateId` (nullable, defaults to whichever template is marked default) selects which one that Course/Programme issues. This is distinct from D-02's issuance-mode field, which stays per-Course/Programme regardless of which template is selected.

### Claude's Discretion

- Exact PDF-construction library choice (e.g. `pdf-lib`, `PDFKit`, or equivalent) — subject to this project's mandatory human package-legitimacy approval gate before installing anything new (the same gate `stripe`/`lucide-react` went through).
- Exact dynamic-field set beyond the schema's existing `learnerName`/`awardTitle`/`issuedAt`/`verificationRef` (e.g. whether a QR code is included, and what URL it encodes — presumably the public verification page).
- Template-editor element set and canvas mechanics (drag precision, snapping, undo) — implementation detail, not a product decision, provided staff can add/position/style border, image, and each dynamic field and save the result as a named, reusable template.
- Verification-reference format — reuse `checkout-service.ts`'s `generateOrderReference()` convention (non-sequential, random suffix, so one reference can't be guessed from another) unless research finds a reason to diverge. **Research finding: a reason to diverge was found — see Pitfall 1.**
- Exact revoke/reissue staff workflow shape (dedicated review queue vs. per-certificate action from a CRD-06-flagged list) — not discussed in depth this session; CRD-05/CRD-06's audit and never-silently-destroyed requirements are locked, the UI shape is planning-time.

### Deferred Ideas (OUT OF SCOPE)

None raised outside phase scope — discussion stayed within Phase 11's certificate/completion domain throughout, including the larger template-editor scope (D-09), which is still "how to implement CRD-03," not a new capability.

Explicitly NOT in scope for this phase (from the Phase Boundary):
- Extending `completionRule` itself or how `CompletionRecord` is computed — Phase 9/10 already built and own `recalculateCompletion()`; this phase only consumes its output and reacts to grade/attendance corrections that flow through it.
- Support tickets (Phase 12) — dashboard's "tickets" slot stays a named gap.
- Certificate-issuance/revocation transactional emails (Phase 13) — this phase emits domain events; Phase 13 drains them.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| CRD-01 | A Course certificate issues only when standalone Course completion rules pass and issuance is enabled; the event is idempotent and references the rule/version and enrolment. | Pattern 1 (composition-root hook into `recalculateCompletion`/`applyVerdict`); Pitfall 4 + partial-unique-index recommendation for idempotency under concurrency; D-01's Course-vs-Programme-cohort distinction confirmed against `Cohort.courseId`/`programmeId` and `recalculateCompletion`'s own branching |
| CRD-02 | One Programme certificate issues after all required Programme Courses and Programme-level rules pass; partial completion does not issue the credential. | Same Pattern 1 hook, keyed off the `PROGRAMME`-scope entry in `recalculateCompletion`'s results array (confirmed only emitted once, after every member-course COURSE-scope entry, in `completion-service.ts`) |
| CRD-03 | A downloadable certificate with a unique verification reference and minimum approved learner/award fields is generated; readable, access-controlled, stable for the credential version. | Don't-Hand-Roll table (storage-service.ts key-builder/presign conventions); Code Examples (download-route pattern to replicate); Pattern 4 (versioned template layout so rendering is reproducible) |
| CRD-04 | Public certificate verification returns active/revoked status and approved award facts for a valid reference; unknown references reveal no user-account data. | Architecture diagram's public-verification-route section; Pitfalls 1-3 (entropy, no rate-limiting infra, denial-parity response shape); Security Domain threat table |
| CRD-05 | Authorized revocation and reissue with reason and audit history is supported; revocation changes public status promptly; reissue links old/new credential versions. | Don't-Hand-Roll (`createResourceService`/audit-first mutation pattern); schema's existing `supersedesId`/`revokedAt`/`revocationReason` fields (already modeled, confirmed via direct schema read) |
| CRD-06 | Certificate status is re-evaluated after an authorized grade, attendance, or completion correction; affected credentials are flagged for review, never silently destroyed. | Pattern 1 (attendance/lesson-progress half, via `applyVerdict`'s "superseded" outcome) + Pattern 2 (grade half, new independent hook in `grade-override-service.ts` — the phase's single most important non-obvious finding, since grades do not flow through the completion engine at all) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` only re-exports `./AGENTS.md`, which establishes one binding directive for this
project: **this is a customized/pinned Next.js 16.3.4, not the Next.js of training data — read
`node_modules/next/dist/docs/` before writing routes/APIs, and heed deprecation notices.**

Applied to this phase's two new route-handler surfaces:

- **`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`** (read this
  session): Next 16's Cache Components model means a `GET` Route Handler **can be prerendered
  and cached by default** unless it touches something that "stops prerendering" — the doc
  explicitly lists database queries, network requests, and runtime APIs (`cookies()`,
  `headers()`) as triggers that defer a handler to request-time rendering. Every handler this
  phase adds (`/api/certificates/[id]/download`, the `/verify/[verificationRef]` page's data
  fetch) performs a Prisma database query, which already defers it to request-time per the
  documented behavior — but the planner must NOT add `export const dynamic = 'force-static'` or
  wrap the verification lookup / presign call in a `'use cache'` helper, either of which would
  let a stale "active" verdict or a stale/expired presigned URL be served from cache. This is a
  genuine Next-16-specific pitfall (Cache Components did not exist in older Next.js versions this
  model may have been trained on) — flag explicitly for the planner and for `plan-checker`.
- The existing `lesson-resources/[id]/download/route.ts` this phase's download route mirrors
  already returns a hand-built `NextResponse` with `Cache-Control: private, no-store` precisely to
  defeat any shared-cache retention of the resolved presigned URL — replicate that header, not
  just the 302 status, on the new certificate download route.
- Route params remain `Promise`-typed (`ctx: { params: Promise<{ id: string }> }`) — already
  confirmed live in the existing download route this phase mirrors; no separate verification
  needed beyond replicating that exact signature.

## Summary

Phase 11 is service+UI work on top of an already-complete `Certificate`/`CompletionRecord` data model (same shape Phase 10 found for Assessment). The single most important finding is architectural: **there are two structurally different reactive hook points for certificate/completion side-effects, not one.** Attendance corrections and lesson-progress changes already flow through `recalculateCompletion()` → `applyVerdict()` synchronously, in the same transaction as the triggering write — this is the correct, already-proven hook point for D-03's automatic issuance and for one half of CRD-06 (re-evaluation after attendance/lesson corrections). But `completionRule` v1 has **no assessment criteria at all** (`completion-rule.ts` recognises only `requireAllRequiredLessons` + attendance threshold), and `grading-service.ts`/`grade-override-service.ts` never call `recalculateCompletion` — grades do not feed the completion engine today, contrary to what `11-CONTEXT.md` implies ("that changed in Phase 10"). `grade-override-service.ts`'s own header comment confirms this split: *"Certificate impact is evaluated by Phase 11 from the unconditional grade.overridden event."* This is the other half of CRD-06 and needs a second, independent synchronous hook inside `overrideGrade`'s transaction — not a recalculation, just a review flag, because there is no rule to re-derive a verdict from.

A second load-bearing finding: `Enrolment.status`'s `VALID_TRANSITIONS` table (`enrolment-transitions.ts`) currently has `COMPLETED: []` (terminal). D-06 requires reversibility, so this phase must add `COMPLETED: ["ACTIVE"]` to that table — a small, concrete, verifiable change.

For the PDF library, `pdf-lib` (+ `@pdf-lib/fontkit` for custom font embedding) and `pdfkit` are both mature, MIT-licensed, pure PDF-construction libraries (no headless browser) that satisfy D-08's constraint. Both passed a `slopcheck` scan clean. Either is installable only after this project's mandatory human package-legitimacy checkpoint — this research does not select one over the other with certainty, it narrows the field and hands the decision (and the checkpoint) to the planner/human, as `11-CONTEXT.md` explicitly requires.

**Primary recommendation:** Build a new `certificate-issuance-service.ts` that wraps (does not modify) `recalculateCompletion`'s existing call sites via the same dependency-injection slot those services already expose, plus a second, independent hook added to `grade-override-service.ts`'s transaction for the grade-correction half of CRD-06. Reuse `createResourceService` for `CertificateTemplate` CRUD and `Certificate` staff views. Model `CertificateTemplate.layout` as one versioned JSON blob of positioned elements (Moodle's actual shape) so the editor and the PDF renderer read the exact same structure. Gate the PDF library choice and the public-verification-route entropy/rate-limit posture behind explicit planner/human decisions — both are flagged LOW/MEDIUM confidence below for good reason.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Completion → issuance trigger (AUTOMATIC mode) | API / Backend (`src/server/services`) | — | Must run inside the same DB transaction as `applyVerdict`; no browser/SSR tier is involved |
| MANUAL-mode eligibility queue | API / Backend (read model) + Frontend Server (SSR page) | Browser (staff action button) | Mirrors Phase 10's grading-queue precedent — pure evaluator + server action |
| PDF generation | API / Backend | — | Pure PDF-construction library runs server-side only; no headless browser, no client-side rendering (D-08) |
| Certificate file storage/download | API / Backend (presign) + CDN/Storage (R2/MinIO object store) | — | Same presigned-GET pattern as `LessonResource`/`Submission`; bytes never traverse the Next.js process |
| Public verification lookup (CRD-04) | API / Backend (Route Handler or Server Component) | Frontend Server (SSR public page) | Must run server-side only — no client-side credential/DB access; unauthenticated but still server-mediated |
| Template editor canvas | Browser / Client | API / Backend (save/load `CertificateTemplate.layout` JSON) | Drag/position/style interactions are inherently client-side; persistence is a plain resource-service write |
| Revoke/reissue workflow | API / Backend (mutation + audit) | Frontend Server (staff UI) | Same audit-first mutation shape as Phase 5 attendance corrections / Phase 10 grade overrides |
| Enrolment.status reversal (D-06) | API / Backend | — | Must be transactional with the certificate revocation/review-flag write |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `pdf-lib` [ASSUMED — identified via training/WebSearch, registry-verified] | 1.17.1 (verified via `npm view`, published 2017-09-04, MIT) | Programmatic PDF construction — draw text/images/borders at explicit x/y positions | Pure PDF-construction library, no headless browser; matches D-08's TCPDF-equivalent shape; can also read back an existing PDF (useful for a background template asset) |
| `@pdf-lib/fontkit` [ASSUMED] | 2.0.4 (verified, published 2018-12-19, MIT) | Custom TTF/OTF font embedding into `pdf-lib` documents | Required companion — `pdf-lib` embeds standard 14 PDF fonts natively but needs fontkit registered (`pdfDoc.registerFontkit(fontkit)`) for a school's branded custom font |
| `pdfkit` [ASSUMED — alternative candidate] | 0.20.2 (verified, published 2011-07-11, MIT) | Alternative pure PDF-construction library with built-in font embedding (no separate fontkit registration step) | Older, more established (15 yrs), simpler font API, but no first-class "read/modify an existing PDF" story the way `pdf-lib` has — matters less here since D-07 always generates a fresh file per learner |

**Both `pdf-lib`/`@pdf-lib/fontkit` and `pdfkit` are legitimate, installable candidates.** Neither is pre-approved — see Package Legitimacy Audit below. The planner must select ONE (not both) and route it through the human legitimacy checkpoint before any install task, exactly as `stripe`/`lucide-react`/`@tiptap/extensions` were.

**Recommendation if forced to pick one:** `pdf-lib` + `@pdf-lib/fontkit`, because the template editor (D-09) needs to reason about element positions as first-class data (x, y, width, height, font, size, color) that a rendering step later maps 1:1 onto `drawText`/`drawImage`/`drawRectangle` calls — `pdf-lib`'s explicit-coordinate, no-implicit-flow API matches that shape slightly more directly than `pdfkit`'s stream/cursor-based document API. This is a judgment call, not a hard finding — flag for human confirmation.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|---------------|
| `qrcode` [ASSUMED] | 1.5.4 (verified, published 2010-12-21, MIT) | Generates a QR code as a PNG/data-URL buffer, embeddable via `pdf-lib`'s `embedPng` | Only if the planner decides the verification-reference dynamic field includes a scannable QR linking to the public verify page — explicitly "Claude's Discretion" per CONTEXT.md, not decided here |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|-----------|
| `pdf-lib`/`pdfkit` (pure construction) | Puppeteer/Playwright HTML-to-PDF | Explicitly rejected by D-08 — requires a headless browser binary in the Docker Compose image, heavier memory/CPU per certificate, and diverges from the Moodle/TCPDF precedent the discussion deliberately checked against. Do not reconsider without a new decision. |
| `pdf-lib` | `pdfmake` | `pdfmake` is a declarative/layout-engine PDF library (tables, flowing text) — a heavier abstraction than needed for a small, fixed set of absolutely-positioned template elements; also newer/thinner adoption than either candidate above. |

**Installation (once approved):**
```bash
npm install pdf-lib @pdf-lib/fontkit
# or, if the planner selects the alternative:
npm install pdfkit
```

**Version verification:** Confirmed live via `npm view <pkg> version license repository.url time.created` on 2026-09-16 (see table above). Training-data versions were not trusted as current.

## Package Legitimacy Audit

`slopcheck` was installed successfully (`pip install slopcheck`) and run against all three PDF/QR candidates plus the fontkit companion.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|--------------|-----------|-------------|
| `pdf-lib` | npm | ~9 yrs (since 2017-09-04) | not queried (no weekly-download tool in sandbox) | github.com/Hopding/pdf-lib | `[OK]` — flagged only for a generic "-lib name pattern looks like LLM bait" heuristic note, explicitly qualified by slopcheck itself as "package is established" | Approved candidate — still gated behind human install checkpoint |
| `@pdf-lib/fontkit` | npm | ~8 yrs (since 2018-12-19) | not queried | github.com/Hopding/fontkit | `[OK]` | Approved candidate — gated behind human install checkpoint |
| `pdfkit` | npm | ~15 yrs (since 2011-07-11) | not queried | github.com/foliojs/pdfkit | `[OK]` | Approved candidate — gated behind human install checkpoint |
| `qrcode` | npm | ~15 yrs (since 2010-12-21) | not queried | github.com/soldair/node-qrcode | Not run through slopcheck this session (checked via `npm view` only) — treat as `[ASSUMED]`, re-scan if the QR-code discretion item is taken up | Optional — only relevant if planner adds QR field |

**Packages removed due to slopcheck `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none — all three scanned packages returned `[OK]`.

Package **names** above are tagged `[ASSUMED]` per this project's provenance rule even though `slopcheck`/`npm view` confirm registry legitimacy — the names themselves were recalled from training/WebSearch, not sourced from Context7 or official framework docs. The planner must still route the final choice through the mandatory human legitimacy checkpoint before any `npm install` task.

## Architecture Patterns

### System Architecture Diagram

```
                                   ┌────────────────────────────────────────┐
                                   │   Triggering writes (existing, Phase 9) │
                                   │  lesson-progress-service.ts             │
                                   │  attendance-service.ts                  │
                                   └───────────────┬──────────────────────────┘
                                                    │ (same tx)
                                                    ▼
                                   recalculateCompletion(tx, {enrolmentId, now})
                                                    │
                                                    ▼
                                   applyVerdict(tx, ...) → CompletionRecord
                                   created | superseded | unchanged  (per scope)
                                                    │
                          ┌─────────────────────────┴──────────────────────────┐
                          │ NEW: certificate-issuance-service.ts                │
                          │ reactToCompletionResults(tx, results, enrolmentId)  │
                          │  - "created" + AUTOMATIC  → issue Certificate,      │
                          │      generate PDF, write storageKey, flip           │
                          │      Enrolment.status → COMPLETED (D-05)            │
                          │  - "created" + MANUAL     → leave eligible, surface │
                          │      on /staff/certificates queue                   │
                          │  - "superseded"           → revert Enrolment.status │
                          │      → ACTIVE, set Certificate.reviewFlaggedAt      │
                          │      (D-06 / CRD-06, attendance/lesson half)        │
                          └──────────────────────────────────────────────────────┘

                                   ┌────────────────────────────────────────┐
                                   │ grade-override-service.ts (Phase 10)    │
                                   │ overrideGrade(...)  — SEPARATE path     │
                                   │ completionRule v1 never reads grades,   │
                                   │ so recalculateCompletion is NOT called  │
                                   └───────────────┬──────────────────────────┘
                                                    │ (same tx, new hook)
                                                    ▼
                          NEW: flagCertificatesForGradeCorrection(tx, {enrolmentId})
                          — sets Certificate.reviewFlaggedAt only (no verdict to
                            re-derive); never touches Enrolment.status
                            (CRD-06, grade half)

  ── PDF generation / storage ──────────────────────────────────────────────
  certificate-issuance-service.ts
     → builds element list from CertificateTemplate.layout + certificate fields
     → renders via pdf-lib/pdfkit (server-side, no browser)
     → storage-service.ts: NEW putGeneratedObject() direct S3 PUT (not
       presigned — server holds the bytes) → Certificate.storageKey

  ── Download (authenticated) ──────────────────────────────────────────────
  GET /api/certificates/[id]/download
     → owner or certificates.view/scope check
     → storage.presignCertificateDownloadUrl(storageKey) → 302 redirect
       (mirrors lesson-resources/[id]/download/route.ts exactly)

  ── Public verification (unauthenticated, CRD-04) ──────────────────────────
  GET /verify/[verificationRef]  (new top-level public route, NOT nested
      under the learner-shelled (public) catalogue group)
     → server-only lookup by verificationRef (unique index)
     → returns ONLY: status (active/revoked), awardTitle, learnerName,
       issuedAt — never enrolmentId/userId/email/internal ids
     → unknown reference and revoked reference both render (revoked shows
       revoked status; unknown shows "not found" — neither leaks account data)
```

### Recommended Project Structure

```
src/server/services/
├── certificate-issuance-service.ts   # NEW — reactToCompletionResults(), issueCertificateAsSystem()
├── certificate-service.ts            # NEW — createResourceService-based CRUD for staff Certificate views, revoke/reissue
├── certificate-template-service.ts   # NEW — createResourceService-based CRUD for CertificateTemplate authoring
├── certificate-verification-service.ts # NEW — pure, unauthenticated lookup by verificationRef (no @prisma import if kept pure; otherwise lives here since @prisma/client is service-tier only)
├── certificate-pdf-renderer.ts       # NEW — pure(ish) function: (CertificateTemplate.layout, fields) → Buffer, isolates the pdf-lib/pdfkit dependency to one file
├── grade-override-service.ts         # MODIFIED — add injected reactToGradeOverride hook
├── attendance-service.ts             # UNCHANGED logic — only the recalculateCompletion DEPENDENCY it's built with changes at the composition root
├── lesson-progress-service.ts        # UNCHANGED logic — same composition-root-only change
├── enrolment-transitions.ts          # MODIFIED — VALID_TRANSITIONS.COMPLETED: ["ACTIVE"]
├── enrolment-dashboard-service.ts    # MODIFIED — populate CERTIFICATE_DEFERRED column
└── storage-service.ts                # MODIFIED — add certificate/template-asset key builders + a direct (non-presigned) PUT for server-generated PDFs

src/app/
├── (public)/... (existing catalogue — unchanged)
├── verify/[verificationRef]/page.tsx # NEW — top-level public route (CRD-04), deliberately outside (public)'s LearnerShell nav
├── staff/certificates/page.tsx       # NEW — D-04 MANUAL-mode eligibility queue + issued/revoked list
├── staff/certificates/templates/     # NEW — D-09 template editor authoring surface
└── api/certificates/[id]/download/route.ts # NEW — mirrors lesson-resources download route exactly
```

### Pattern 1: Composition-root wrapping, not source modification, for the AUTOMATIC-issuance hook

**What:** Every one of `recalculateCompletion`'s four call sites already receives it as an injected dependency (`recalculateCompletionDep`, defaulting to the real import) — this was built for testability, but it is also exactly the seam Phase 11 needs.

**When to use:** For D-03's reactive automatic issuance and the attendance/lesson-progress half of CRD-06.

**Example (illustrative, not verified against a Context7 source — derived from reading `lesson-progress-service.ts`/`attendance-service.ts` directly):**
```typescript
// certificate-issuance-service.ts
export async function recalculateCompletionAndIssue(
  tx: CompletionServiceTxClient & CertificateIssuanceTxClient,
  args: { enrolmentId: string; now: Date },
): Promise<CompletionRecalculationResult> {
  const result = await recalculateCompletion(tx, args);
  if (result.kind === "evaluated") {
    await reactToCompletionResults(tx, result.results, args.enrolmentId, args.now);
  }
  return result;
}

// At the composition root (lesson-progress-service.ts's
// createPrismaBackedLessonProgressService, attendance-service.ts's
// createPrismaBackedAttendanceService): swap the default
// `recalculateCompletionDep` parameter from `recalculateCompletion` to
// `recalculateCompletionAndIssue`. Zero lines change inside either service's
// own business logic.
```

**Source:** Derived directly from `src/server/services/lesson-progress-service.ts` lines 242-245, 388, 452, 578, 714 and `src/server/services/attendance-service.ts` lines 281-285, 428 (read in full this session) — not a Context7/official-docs pattern, a codebase-internal one.

### Pattern 2: A second, independent hook for the grade-correction half of CRD-06

**What:** `completionRule` v1 never reads grades, so there is nothing for `recalculateCompletion` to re-derive when a grade is overridden. `grade-override-service.ts`'s `GradeOverrideDeps` has no equivalent injection slot today — it must be added, mirroring the pattern in `attendance-service.ts`.

**When to use:** Inside `overrideGrade`'s existing transaction, immediately after `writeEvent(tx, {type: "grade.overridden", ...})`.

**Example:**
```typescript
// grade-override-service.ts — ADD to GradeOverrideDeps:
reactToGradeOverride: (tx: GradeOverrideTx, args: {
  enrolmentId: string; assessmentId: string; passedChanged: boolean;
}) => Promise<void>;

// inside overrideGrade's transaction, after the existing writeEvent call:
await deps.reactToGradeOverride(tx, {
  enrolmentId: before.enrolmentId,
  assessmentId: before.assessmentId,
  passedChanged: before.passed !== passed,
});
```
The real implementation (in `certificate-issuance-service.ts`) looks up any `Certificate` where `status = 'ACTIVE'` and `enrolmentId` matches (course-scope) or the enrolment's cohort maps to a Programme certificate (programme-scope, via the enrolment's active COURSE-scope membership) and sets `reviewFlaggedAt = now()` — **never** re-derives a verdict, never touches `Enrolment.status`. CRD-06's literal wording ("flagged for review, never silently altered or destroyed") is satisfied exactly this way: a human reviews, no automatic status change from a grade signal the completion engine doesn't itself understand.

**Source:** `src/server/services/grade-override-service.ts` (full file read this session) — its own header comment is the direct evidence for this split, cross-checked against `completion-rule.ts`'s `RECOGNISED_V1_KEYS` (only `version`, `requireAllRequiredLessons` — no assessment key exists).

### Pattern 3: `*AsSystem` actor for automatic issuance writes

**What:** `checkout-webhook-system-service.ts` established `actorId: null, actorType: SYSTEM_ACTOR_TYPE` (exported as `SYSTEM_ACTOR_TYPE = "SYSTEM"`) for writes that have no human requester. D-03 explicitly asks Phase 11 to reuse this shape for automatic issuance.

**Important distinction from the webhook case:** the webhook module is *deliberately unauthorized* because there is no session at all (an external POST). Automatic certificate issuance is different — it runs inside a transaction started by an *authenticated* actor (the learner completing a lesson, or staff marking attendance), but that actor did not request or authorize "issue a certificate" as an act; the certificate is a system-derived consequence. The correct shape is **not** a second unauthorized module reachable from a route — it is a plain internal function (`issueCertificateAsSystem`, called only from `reactToCompletionResults`, never exported to a route handler) that stamps `actorId: null, actorType: "SYSTEM"` on its own `recordAudit`/domain-event calls, while the outer request itself still went through the normal `withPermission` gate for whatever triggered it (marking a lesson complete, marking attendance). No new "unauthorized surface" is created — issuance simply isn't itself a permission-gated act when system-triggered.

**Source:** `src/server/services/checkout-webhook-system-service.ts` (header + lines 91, 764, 846-847, 863-864, 1074-1075, 1199-1200, read this session).

### Pattern 4: `CertificateTemplate.layout` as one versioned JSON blob, not structured columns

**What:** Moodle's `mod_customcert` stores each element (border, image, dynamic field, text) as a row with `x`,`y`,`width`,`height`,`font`,`colour`,`refpoint` and a `element` type discriminator — effectively a JSON-shaped structure regardless of Moodle's own table layout. For this project, following `Course.completionRule`'s existing precedent (`Json?` column + a `ruleVersion`/schema-version int, parsed and validated by a pure function — see `completion-rule.ts`), the natural shape is:

```typescript
// A NEW pure module, e.g. certificate-template-layout.ts — no imports,
// same discipline as completion-rule.ts / readiness-service.ts.
type CertificateElementV1 =
  | { kind: "text"; field: "learnerName" | "awardTitle" | "issuedAt" | "verificationRef" | "literal";
      literal?: string; x: number; y: number; fontSize: number; color: string; align: "left" | "center" | "right" }
  | { kind: "image"; assetKey: string /* storageKey of an uploaded logo/signature/background */; x: number; y: number; width: number; height: number }
  | { kind: "border"; style: "solid" | "double"; color: string; widthPt: number };

type CertificateTemplateLayoutV1 = {
  schema: 1;
  pageSize: "A4" | "LETTER";
  orientation: "landscape" | "portrait";
  elements: CertificateElementV1[];
};
```

**Why this shape:** the editor UI reads/writes the exact same array the PDF renderer iterates over — no translation layer, no drift risk between "what staff designed" and "what got rendered" (the same rationale `completion-rule.ts`'s header gives for parsing a pinned JSON payload once, in one place). A `schema: 1` discriminator lets a future template-editor feature (v2 elements) fail loudly on an unrecognised key, exactly like `parseCompletionRule`'s `UnsupportedCompletionRuleFieldError`.

**Confidence:** MEDIUM — the *shape* (JSON blob of positioned elements) is well-grounded in both Moodle's documented behavior and this codebase's own `completionRule`/`ProgrammePublication.payload` precedent for "one versioned JSON blob, parsed by one pure function." The *exact element field list* is LOW confidence / Claude's Discretion per CONTEXT.md — this is a starting point for the planner, not a locked schema.

### Anti-Patterns to Avoid

- **Reading `course.completed`/`programme.completed` DomainEvents to trigger issuance:** `completion-service.ts`'s DD-12/DD-13 explicitly forbid this — the outbox is Phase 13's drain input only, never a work-queue any other module polls. Hook the synchronous call path instead (Pattern 1).
- **Making `certificate-issuance-service.ts` part of `completion-service.ts`'s own `CompletionServiceTxClient`:** DD-6 in `completion-service.ts` deliberately omits `enrolment.update` from that type so completion-service.ts *cannot* touch `Enrolment.status` even by accident. Certificate issuance's `Enrolment.status` write must live in a separate module with its own, wider tx-client type — do not widen `CompletionServiceTxClient` to add `enrolment.update`.
- **Puppeteer/Playwright/HTML-to-PDF for rendering:** explicitly rejected by D-08; also this project's `playwright-cli` skill (`.claude/skills/playwright-cli/`) is a *test-automation* tool, not a production rendering dependency — do not conflate the two even though the term "Playwright" appears in both contexts.
- **Weak-entropy `verificationRef` for the public route:** see Pitfall 1 below — do not blindly copy `checkout-service.ts`'s `generateOrderReference()` convention without adjusting entropy.
- **Nesting `/verify/[ref]` under the existing `(public)` route group:** that group's `layout.tsx` renders `LearnerShell` with a "Sign in" CTA and catalogue nav — appropriate for browsing, wrong tone/surface for a minimal-disclosure verification utility a third party (employer, credential checker) may land on directly. Give it its own minimal layout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Certificate/template CRUD (list/get/create/update/archive), scoping, audit | A bespoke certificate-management module | `createResourceService` (`resource-service.ts`) | Same factory every other domain (Course, Cohort, Assessment) already uses; gives permission-gating, scope resolution, and audit rows for free |
| Presigned upload/download plumbing for template background images/logos | A new S3 client wrapper | `storage-service.ts`'s existing `presignLessonUploadUrl`/`inspectLessonObject`/`promoteLessonObject` pattern, extended with sibling `certificate*` key builders (that file's own stated convention: one function per domain, not a shared generic) | The presigned-PUT / verify / promote three-step flow (`lesson-resource-service.ts`) already solves staged-key hijacking, content-type/size validation, and NFR-06's no-predictable-path rule |
| PDF byte construction | Hand-writing raw PDF syntax or an HTML+CSS-to-PDF pipeline | `pdf-lib`/`pdfkit` (pending human approval) | Both handle PDF object graph, font embedding, and page geometry correctly; hand-rolling PDF syntax is a well-known rabbit hole (kerning, embedded font subsetting, cross-reference tables) |
| Certificate uniqueness under concurrent completion triggers | Application-level "check then insert" alone | A partial unique index, same convention as `enrolment_one_active_per_learner_cohort` (see `prisma/migrations/20260901115332_init/migration.sql` lines 1208-1218) | Prisma's schema DSL cannot express a `WHERE status = 'ACTIVE'` partial unique index; this project already hand-writes such constraints directly into the generated migration SQL — reuse that exact convention for `Certificate` |
| MANUAL-mode eligibility computation | A denormalized "is eligible" boolean column, updated ad hoc | The pure-evaluator pattern (`readiness-service.ts`) — a function taking structural inputs (CompletionRecord existence, Course/Programme issuance mode) and returning the queue's rows, called fresh at read time | Same reasoning readiness-service.ts's header gives: one evaluator, no drift between what staff see and what the server enforces |

**Key insight:** Nothing in this phase needs new authorization/audit/storage primitives — every mechanical piece (resource CRUD, presigned storage, pure evaluators, `*AsSystem` actors, partial unique indexes) already has exactly one established precedent in this codebase. The genuinely new work is (a) the PDF-rendering function itself, (b) the template editor's canvas UI, and (c) wiring the two CRD-06 hook points described above.

## Runtime State Inventory

Not applicable — this is a greenfield feature phase (new models, new services, new routes), not a rename/refactor/migration phase. No existing runtime state carries the strings/identifiers this phase introduces.

## Common Pitfalls

### Pitfall 1: `generateOrderReference()`'s entropy is not safe to reuse as-is for a public, unauthenticated, enumerable-by-reference lookup

**What goes wrong:** `checkout-service.ts`'s `generateOrderReference()` (line 379-382) produces `ORD-${YYYYMMDD}-${8 hex chars}` — only 32 bits of randomness (`randomUUID().slice(0, 8)`), scoped per calendar day. Order references are looked up only by an authenticated owner or staff with `payments.view`/scope — brute-forcing one is not useful even if guessed, because the lookup itself is permission-gated. `Certificate.verificationRef` (CRD-04) is looked up by **anyone, unauthenticated, no rate limit exists anywhere in this codebase today** (confirmed: no `rate-limit`/`RateLimit` file anywhere under `src/`; the only throttling mechanism, `src/server/auth/lockout.ts`, is keyed to a `User` row's `failedLoginAttempts`/`lockedUntil` columns and has no analog for an anonymous per-reference or per-IP lookup).

**Why it happens:** CONTEXT.md's discretion note frames this as "reuse the convention unless research finds a reason to diverge" — this is exactly that reason. A successful guess on the public route discloses a real learner's name + award title (minimal, but still personal data), and at scale a 32-bit space is enumerable by an unrate-limited scripted client well within this app's own uptime.

**How to avoid:** Increase entropy for `verificationRef` specifically — e.g. a full random token (`randomUUID()` in full, or a longer random suffix, 16+ bytes / 128 bits) rather than the 8-hex-char slice `generateOrderReference` uses. Keep the *convention* (random suffix, non-sequential, generated the same way — `randomUUID()`-derived) but not the *exact length*. This is a genuine divergence from the CONTEXT.md discretion note's default, backed by the entropy math above — flag for the planner to confirm with the human, since it changes a stated default.

**Warning signs:** If the planner's task literally copies `generateOrderReference`'s implementation for `verificationRef` unchanged, that is under-provisioned entropy for a public anonymous endpoint.

### Pitfall 2: No rate-limiting infrastructure exists anywhere in this codebase to lean on for the public verify route

**What goes wrong:** IAM-06 (account enumeration/brute-force protection) is still listed `Pending` in `.planning/REQUIREMENTS.md`'s traceability table for Phase 3's sign-in flow, and no generic rate-limiting middleware, Redis-backed counter, or Next.js middleware throttle exists in `src/` at all as of this session.

**Why it happens:** Building full rate-limiting infrastructure is out of this phase's explicit scope (not mentioned anywhere in `11-CONTEXT.md`).

**How to avoid:** Given the scope boundary, the primary defense for CRD-04 should be Pitfall 1's entropy increase (makes brute force computationally infeasible even without throttling) plus minimal-disclosure response shape (Pitfall 3) — not a new rate-limiter. If the planner wants defense-in-depth, a very small self-contained in-memory or DB-row counter scoped only to this one route is a reasonable minimal addition, but should be called out explicitly as new infrastructure, not assumed to already exist.

**Warning signs:** A plan step that says "add rate limiting" without specifying a concrete, scoped mechanism is likely to balloon into unscoped work — pin it down to "N requests per IP per minute on this one route" if included at all.

### Pitfall 3: Public verification response must not distinguish "unknown reference" from "no longer exists" in a way that leaks structure

**What goes wrong:** CRD-04 requires "unknown references reveal no user-account data." A naive implementation might 404 for unknown refs but 200-with-full-detail for revoked ones, or vice versa, in a way that lets an attacker distinguish "this reference was never issued" from "this reference exists but is revoked" — both are fine to distinguish per the requirement (revoked IS one of the two facts to reveal), but the *response shape* for "unknown" must never accidentally echo back partial data (e.g., a Prisma error message, a stack trace, or an HTTP status that differs based on a database-level distinction like soft-deleted vs never-existed).

**How to avoid:** One lookup function, one of exactly three outcomes: `{status: "active", ...minimalFields}` / `{status: "revoked", ...minimalFields}` / `{status: "not_found"}` — mirroring `lesson-resources/[id]/download/route.ts`'s "every non-success outcome is a 404 with an empty body" discipline (T-09-03's denial-parity rule), adapted to a public GET page instead of a download route.

**Warning signs:** Any code path in the verification lookup that returns a different HTTP status or error message shape depending on *why* a reference didn't resolve.

### Pitfall 4: Concurrent completion triggers racing to create duplicate `Certificate` rows

**What goes wrong:** `applyVerdict`'s own `CompletionRecord` idempotency ("a second mark-complete never creates a second record") is enforced by an application-level `findFirst` + `create` inside one transaction — safe within a single transaction, but if `reactToCompletionResults` naively does the same "check-then-insert" for `Certificate` without a DB-level constraint, two nearly-simultaneous triggers (e.g., a learner rapidly toggling a video-completion boundary, or a race between an attendance-mark and a lesson-progress write both recalculating the same enrolment) could each independently observe "no ACTIVE certificate yet" in their own transaction and both insert one.

**Why it happens:** Postgres transaction isolation (default READ COMMITTED) does not prevent two concurrent transactions from both reading "no matching row" and both successfully inserting — only a unique constraint (checked at commit/insert time) closes this, exactly as this project's own `enrolment_one_active_per_learner_cohort` partial index was added specifically to close this same class of race for enrolments.

**How to avoid:** Add a hand-written partial unique index in the generated migration's raw-SQL trailer section (same file/section as `enrolment_one_active_per_learner_cohort` and `cohort_targets_exactly_one_offer`):
```sql
CREATE UNIQUE INDEX certificate_one_active_per_enrolment_scope
  ON "Certificate" ("enrolmentId", "scope")
  WHERE status = 'ACTIVE';
```
Then have `reactToCompletionResults`/`issueCertificateAsSystem` catch the resulting `P2002` unique-violation and treat it as "already issued, no-op" — the same "attempt once, and a unique-constraint collision means someone else won" shape `resource-service.ts`'s `withPositionRetry`/`PositionContentionError` already uses for a different index.

**Warning signs:** A plan task that issues a certificate via plain `findFirst`-then-`create` with no unique index and no `P2002` handling.

### Pitfall 5: `certificateTemplateId` FK direction and the "no CertificateTemplate deletion" invariant

**What goes wrong:** `CAT-08`/this project's "no hard deletes" convention means a `CertificateTemplate` a Course/Programme currently points at can only be archived, never removed — but an archived template must still render correctly for certificates already issued against it (the certificate's rendered PDF is a frozen artifact; only *future* issuance should be blocked from selecting an archived template).

**How to avoid:** `Course.certificateTemplateId`/`Programme.certificateTemplateId` should be nullable (already specified in D-10) and the template-selection UI should filter out archived templates from the *pickable* list without needing the FK itself to enforce anything — the FK simply points at whichever template row (archived or not) was selected at generation time, and `Certificate` generation reads the template as it existed at issuance time (or, more robustly, denormalizes the resolved layout into the certificate's own generation call rather than re-reading a possibly-since-edited template — avoids CAT-05's "silent requirement change" class of bug recurring in a new domain).

**Warning signs:** A plan that lets editing a `CertificateTemplate.layout` retroactively change how *already-issued* certificates would re-render (they shouldn't re-render at all post-issuance — D-07 generates once per learner, the file is the artifact of record).

### Pitfall 6: Next.js 16's Cache Components can silently cache a GET route handler that must always be live

**What goes wrong:** Unlike older Next.js versions, a `GET` Route Handler in this pinned 16.3.4
build follows the same prerendering model as a normal page — it CAN be cached/prerendered unless
it touches something that defers it to request time. A verification lookup or a presigned-download
route that got statically cached would serve a stale revoked/active status or a dead presigned URL.

**Why it happens:** This is a documented behavior change from the Next.js versions most training
data reflects (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`,
read this session) — exactly the kind of divergence `AGENTS.md` warns about.

**How to avoid:** Every Prisma database query already defers a handler to request-time per that
doc's own list of prerendering-stopping triggers, so the two new routes in this phase are safe by
default AS LONG AS no one adds `export const dynamic = 'force-static'` or wraps the lookup/presign
logic in a `'use cache'` helper. Keep the download route's existing `Cache-Control: private,
no-store` header (copied from `lesson-resources/[id]/download/route.ts`) on the new certificate
download route as a second, explicit layer of defense beyond relying on the implicit dynamic
behavior.

**Warning signs:** Any new route file in this phase that exports `dynamic = 'force-static'`,
`revalidate`, or wraps its data fetch in a function marked `'use cache'`.

## Code Examples

### Existing download-route pattern to replicate for `/api/certificates/[id]/download`

```typescript
// Source: src/app/api/lesson-resources/[id]/download/route.ts (read in full this session)
// Adapt directly: swap getDownloadableResource/-ForLearner for a certificate-
// ownership check (owner userId match OR certificates.view + scope), swap
// presignLessonObjectUrl for a new presignCertificateDownloadUrl, keep the
// exact 302-with-Cache-Control-no-store construction and the "every failure
// is a 404 with empty body" discipline.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  // ... same shape as the read file, 34-89
}
```

### `generateOrderReference` — the convention to adapt, not copy verbatim

```typescript
// Source: src/server/services/checkout-service.ts, lines 379-382
function generateOrderReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ORD-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
// For verificationRef: keep the randomUUID()-derived non-sequential shape,
// but do not truncate to 8 hex chars — see Pitfall 1.
```

### The partial-unique-index convention to extend

```sql
-- Source: prisma/migrations/20260901115332_init/migration.sql, lines 1208-1218
CREATE UNIQUE INDEX enrolment_one_active_per_learner_cohort
  ON "Enrolment" ("userId", "cohortId")
  WHERE status = 'ACTIVE';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `Enrolment.status` had no legal path back out of `COMPLETED` | `VALID_TRANSITIONS.COMPLETED` must add `["ACTIVE"]` | This phase (D-06) | Enables the CompletionRecord-style "supersede, never destroy" pattern to extend to enrolment status, closing the exact gap `completion-service.ts`'s DD-6 comment names as "Phase 11's responsibility" |
| `completionRule` v1 (requiredLessons + attendance only) | Unchanged — still v1, no assessment criteria, despite `11-CONTEXT.md` implying Phase 10 added assessment criteria | Not changed by Phase 10 (verified: `completion-rule.ts`'s `RECOGNISED_V1_KEYS` is exactly `["version", "requireAllRequiredLessons"]`, and no grading file calls `recalculateCompletion`) | This phase must NOT assume grades already influence completion — CRD-06's grade-correction half needs its own independent hook, not a recalculation (see Pattern 2) |

**Deprecated/outdated:** None — no prior certificate implementation exists to deprecate; this is the first pass.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | `pdf-lib`, `@pdf-lib/fontkit`, `pdfkit`, `qrcode` are the correct npm package names for these tools (identified via training data / WebSearch, registry-existence confirmed via `npm view` and `slopcheck`, but not sourced from Context7 or official framework docs) | Standard Stack, Package Legitimacy Audit | Low — all four independently resolve on the npm registry with matching GitHub repos and long publish history; risk is a naming/version drift by install time, not a hallucinated package |
| A2 | `pdf-lib`'s explicit-coordinate API is a marginally better fit than `pdfkit`'s stream API for the template editor's element-position model | Standard Stack | Low-Medium — this is a judgment call with no hard technical blocker either way; picking `pdfkit` instead would not be wrong, just a different mapping layer |
| A3 | The public verification route should live at a new top-level `/verify/[verificationRef]` path outside the existing `(public)` route group | Architecture Patterns, Pattern 1 diagram | Low — this is a routing/UX choice, not a security-relevant one; nesting it under `(public)` would still function, just with an unnecessary "Sign in" CTA and catalogue nav for a use case (external verifier) that likely isn't a prospective learner |
| A4 | `generateOrderReference`'s 32-bit entropy is insufficient for `verificationRef` and should be increased | Common Pitfalls, Pitfall 1 | Medium — this directly contradicts CONTEXT.md's stated default ("reuse... unless research finds a reason to diverge"); if the human disagrees with the entropy-math reasoning here, the original convention can still be used, but should be an explicit, informed choice, not a silent copy |
| A5 | No rate-limiting infrastructure exists anywhere in `src/` (verified by exhaustive grep for `rate-limit`/`RateLimit`/`rateLimit`, zero matches) | Common Pitfalls, Pitfall 2 | Low — this is a direct, verifiable grep result, not an inference |
| A6 | `CertificateTemplate.layout` should be one versioned JSON blob (structured element array) rather than normalized element rows | Architecture Patterns, Pattern 4 | Medium — this is the single largest undecided data-model shape in the phase; if the planner/human prefers normalized `CertificateTemplateElement` rows instead (e.g., for per-element query/audit granularity), that is a legitimate alternative this research did not fully explore |

## Open Questions (RESOLVED)

1. **(RESOLVED)** **Does the Programme-scope certificate's grade-correction review-flag need to look through cohort membership, or is there a simpler existing lookup?**
   - What we know: A `Certificate` row carries `enrolmentId` directly (schema, line 1235) and `scope`/`courseId`/`programmeId`. A grade override's `enrolmentId` is the SAME enrolment for both course-cohort and programme-cohort learners (Grade → Assessment → Course, but the learner's `enrolmentId` is stable regardless of cohort type).
   - What's unclear: For a Programme-cohort enrolment, is there ever a course-scope `Certificate` row to flag (per D-01, no — course certificates never issue for Programme-cohort enrolments), so the grade-correction hook only ever needs to look up the ONE `Certificate` (course or programme scope) matching `enrolmentId` with `status = 'ACTIVE'` — likely simpler than initially assumed.
   - Recommendation: Confirm during planning that `WHERE enrolmentId = ? AND status = 'ACTIVE'` (no scope disambiguation needed) is sufficient, since D-01 guarantees at most one certificate type is ever certificate-eligible per enrolment.

2. **(RESOLVED)** **Exact `MANUAL`-mode eligibility-queue data shape** — should it be a live query (read-time evaluation, like `readiness-service.ts`) or a persisted "eligible" flag set at the same hook point as automatic issuance?
   - What we know: `readiness-service.ts`'s pattern is explicitly "pure evaluator, called fresh at read time, no denormalized flag" — but that evaluator only reads pinned obligation payloads and live Course/Programme rows, none of which change from "eligible" to "not eligible" the way a `CompletionRecord` can be superseded mid-queue.
   - What's unclear: Whether a MANUAL-mode enrolment that becomes eligible, then has its `CompletionRecord` superseded (an attendance correction dropping it back below threshold) before staff act on it, should silently vanish from the queue (if read-time-evaluated) or need an explicit "no longer eligible" audit trail entry.
   - Recommendation: Read-time evaluation (query `CompletionRecord` rows with `supersededAt: null` joined to `Course`/`Programme.certificateIssuanceMode = 'MANUAL'` and no existing `Certificate`) is simpler and matches the existing precedent; the planner should confirm this doesn't need an audit trail for "became ineligible before staff acted," since CRD-06 only requires flagging *issued* certificates for review, not tracking eligibility churn.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|-----------|
| Node.js / npm | PDF library install, all TypeScript builds | ✓ | (project-pinned via package.json, not re-verified this session) | — |
| PostgreSQL | `Certificate`/`CompletionRecord`/`CertificateTemplate` persistence | ✓ (existing Docker Compose service, used by all prior phases) | — | — |
| S3-compatible object storage (MinIO dev / R2 prod) | Certificate PDF + template asset storage | ✓ (existing `storage-service.ts` infra, `S3_*` env vars) | — | — |
| `slopcheck` (Python/pip) | Package legitimacy gate | ✓ — installed this session via `pip install slopcheck` | (version not captured; ran successfully) | — |
| Context7 MCP | Library documentation lookups | ✗ — not present in this agent's tool set | — | Used `npm view` (registry) + `WebSearch` instead, per documentation_lookup fallback; findings tagged `[ASSUMED]`/verified-by-registry accordingly |
| Rate-limiting infrastructure | Public verify-route hardening (optional, Pitfall 2) | ✗ — does not exist anywhere in `src/` | — | Rely on `verificationRef` entropy (Pitfall 1) instead; building new infra is out of this phase's explicit scope |

**Missing dependencies with no fallback:** None — the one genuine gap (rate-limiting infra) has an accepted fallback (entropy) within this phase's stated scope.

**Missing dependencies with fallback:** Context7 (used registry+WebSearch instead); rate-limiting middleware (used entropy instead).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (`vitest run --no-file-parallelism`) |
| Config file | `vitest.config.mts` |
| Quick run command | `npx vitest run tests/certificate-issuance-service.test.ts` (once created) |
| Full suite command | `npm test` (runs `vitest run --no-file-parallelism` across `tests/`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|---------------|
| CRD-01 | Course certificate issues exactly once when standalone completion passes + issuance enabled | unit + concurrency | `npx vitest run tests/certificate-issuance-service.test.ts -t "idempotent"` | ❌ Wave 0 |
| CRD-01 | Course-cohort enrolment never issues a Course cert for internally-tracked member-course evidence when the cohort is actually Programme-based (D-01) | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "programme-cohort"` | ❌ Wave 0 |
| CRD-02 | Programme certificate issues only after ALL required Courses + Programme-level rule pass | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "programme completion"` | ❌ Wave 0 |
| CRD-03 | Generated PDF is downloadable, access-controlled, carries `verificationRef` + minimal fields | integration (real Postgres + real S3/MinIO) | `npx vitest run tests/certificate-download.integration.test.ts` | ❌ Wave 0 |
| CRD-04 | Public verification by reference reveals only status + approved facts; unknown ref reveals nothing | unit + route test | `npx vitest run tests/certificate-verification.test.ts` | ❌ Wave 0 |
| CRD-05 | Revoke/reissue with mandatory reason; old/new versions linked (`supersedesId`); audit trail preserved | unit | `npx vitest run tests/certificate-revocation.test.ts` | ❌ Wave 0 |
| CRD-06 (attendance/lesson half) | A `CompletionRecord` supersede (attendance correction) flags the certificate for review and reverts `Enrolment.status` | unit, reusing existing `attendance-service.test.ts`/`lesson-progress-service.test.ts` fakes with the new wrapped `recalculateCompletion` dep | `npx vitest run tests/certificate-issuance-service.test.ts -t "superseded"` | ❌ Wave 0 |
| CRD-06 (grade half) | A `grade.overridden` event flags the certificate for review without altering completion state | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "grade correction"` | ❌ Wave 0 |
| Enrolment.status transition | `COMPLETED → ACTIVE` is now a legal transition; still no other new terminal escapes | unit | `npx vitest run tests/enrolment-transitions.test.ts` (extend existing file if present, else new) | Check — file may already exist from Phase 6/9, extend rather than duplicate |
| Concurrency (Pitfall 4) | Two simultaneous completion triggers for the same enrolment/scope never produce two ACTIVE certificates | integration (real Postgres, exercises the partial unique index + P2002 handling) | `npx vitest run tests/certificate-concurrency.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `npx vitest run <file>` for the file(s) touched.
- **Per wave merge:** `npm test` (full suite, `--no-file-parallelism` already enforces serial execution — this project's convention for real-Postgres integration tests sharing one database).
- **Phase gate:** Full suite green, plus the two real-Postgres integration tests (`certificate-download.integration.test.ts`, `certificate-concurrency.integration.test.ts`) actually executed in a Docker-enabled environment — this project's history (Phase 6/06-09, Phase 6/06-03 etc.) shows integration tests are frequently written but left `Docker-BLOCKED` in the execution sandbox; flag this risk explicitly rather than assume they ran.

### Wave 0 Gaps
- [ ] `tests/certificate-issuance-service.test.ts` — covers CRD-01, CRD-02, CRD-06 (both halves)
- [ ] `tests/certificate-verification.test.ts` — covers CRD-04
- [ ] `tests/certificate-revocation.test.ts` — covers CRD-05
- [ ] `tests/certificate-download.integration.test.ts` — covers CRD-03 (real Postgres + real MinIO)
- [ ] `tests/certificate-concurrency.integration.test.ts` — covers the Pitfall-4 race, real Postgres
- [ ] `tests/certificate-template-service.test.ts` — covers D-09/D-10's `CertificateTemplate` CRUD + layout parsing
- [ ] Extend `tests/enrolment-transitions.test.ts` (or wherever `VALID_TRANSITIONS` is currently tested) for the new `COMPLETED → ACTIVE` edge
- [ ] Framework install: none — Vitest already configured project-wide

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | This phase adds no new authentication surface |
| V3 Session Management | No | Unchanged |
| V4 Access Control | Yes | Existing `withPermission` + `ResourceScope` pattern (`certificates.view`/`issue`/`revoke`) for all staff-facing certificate/template operations; the public verify route is the one deliberately-unauthenticated exception, scoped to minimal-disclosure read-only |
| V5 Input Validation | Yes | `CertificateTemplate.layout` JSON must be parsed/validated by a pure function (mirroring `completion-rule.ts`'s `parseCompletionRule`) that rejects unrecognised element kinds/fields rather than silently accepting them; revoke/reissue `reason` fields require non-empty validation (mirroring `grade-override-service.ts`'s 10-character minimum) |
| V6 Cryptography | No direct new crypto — `verificationRef` generation uses `node:crypto`'s `randomUUID()` (already in use project-wide via `storage-service.ts`), never hand-rolled randomness |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Enumeration of `verificationRef` values via the public, unauthenticated verify route | Information Disclosure | High-entropy reference (Pitfall 1) + minimal response fields (name/title/date only, never internal ids) + denial-parity response shape (Pitfall 3) |
| Predictable/guessable storage object keys for certificate PDFs | Information Disclosure | Reuse `storage-service.ts`'s existing convention — `randomUUID()`-suffixed keys, never the original filename or a sequential id, exactly like `buildStorageKey`/`buildSubmissionStorageKey` |
| A leaked presigned download URL being replayed indefinitely | Information Disclosure / Elevation | Short TTL (mirror the existing 60-second FILE-class TTL from `downloadTtlFor`) — certificates are small, single-request downloads, no reason to need the 4-hour VIDEO TTL |
| A staff member with only `certificates.issue` (meant for exceptional manual issuance) using it to author/edit templates | Elevation of Privilege | Resolve the D-09 permission question explicitly before implementation — see below; do not let template-editor writes fall through on an under-specified permission check |
| Race between two completion triggers double-issuing a certificate | Tampering / Repudiation (duplicate financial-adjacent record) | Partial unique index + `P2002` handling (Pitfall 4) |
| Template asset upload (school-provided logo/signature image) used as an XSS/path-traversal vector | Tampering | Reuse `upload-limits.ts`'s allow-list-only MIME validation (no `image/svg+xml`) and `storage-service.ts`'s randomUUID-keyed staged-upload promotion flow verbatim — do not invent a parallel, looser validation path for "just a certificate logo" |

**D-09 permission open item (flagged, not resolved by this research):** the closed permission catalogue (`src/server/permissions/catalogue.ts`) currently has exactly three certificate permissions — `certificates.view`, `certificates.issue`, `certificates.revoke` — none of which semantically means "author a certificate template's visual design." Adding a new identifier (e.g., `certificates.manage`) requires the PRD §1.3 catalogue-change approval path per that file's own header comment ("Adding an identifier here is a product decision, not an implementation one"). This research recommends the planner propose reusing `certificates.issue` for template authoring as the pragmatic default (the same staff role — Programme Manager/Administrator — plausibly holds both capabilities), but flags this explicitly as needing human sign-off before implementation, since it is a catalogue-shape decision this research cannot make unilaterally.

## Sources

### Primary (HIGH confidence — direct source read this session)
- `prisma/schema.prisma` (lines ~60-140, ~460-575, ~1036-1268) — `Certificate`, `CompletionRecord`, `CertificateStatus`, `CompletionScope`, `EnrolmentStatus`, `Course.certificateEnabled`, `Programme.certificateEnabled`
- `src/server/services/completion-service.ts` (full file) — `recalculateCompletion`, `applyVerdict`, DD-6/DD-12/DD-13 headers
- `src/server/services/completion-rule.ts` (full file) — v1 rule vocabulary, confirms no assessment criteria
- `src/server/services/lesson-progress-service.ts` (relevant sections) — `recalculateCompletion` call sites and DI shape
- `src/server/services/attendance-service.ts` (relevant sections) — `recalculateCompletion` call site, correction-vs-marking handling
- `src/server/services/grade-override-service.ts` (full file) — confirms grades don't flow through completion; own header names Phase 11's obligation
- `src/server/services/enrolment-transitions.ts` (relevant lines) — `VALID_TRANSITIONS`, confirms `COMPLETED: []`
- `src/server/services/checkout-service.ts` (lines 379-403) — `generateOrderReference`
- `src/server/services/checkout-webhook-system-service.ts` (header + relevant lines) — `*AsSystem` pattern, `SYSTEM_ACTOR_TYPE`
- `src/server/services/resource-service.ts` (full file) — `createResourceService` factory, `PositionContentionError`
- `src/server/services/storage-service.ts` (full file) — presign/key-builder conventions, per-domain sibling-function discipline
- `src/lib/upload-limits.ts` (full file) — MIME allow-lists, `downloadTtlFor`
- `src/server/permissions/catalogue.ts` (full file) — closed permission list, existing `certificates.*` trio
- `src/server/services/readiness-service.ts` (partial) — pure-evaluator/named-third-state pattern
- `src/server/services/lesson-resource-service.ts` (partial) — three-step upload flow
- `src/app/api/lesson-resources/[id]/download/route.ts` (full file) — download-route pattern to replicate
- `src/app/(public)/layout.tsx` — existing public route group's shell/nav
- `prisma/migrations/20260901115332_init/migration.sql` (lines 1195-1230) — partial-unique-index and CHECK-constraint conventions
- `src/server/auth/lockout.ts` (full file) — confirms the only existing throttle mechanism is User-row-keyed, not reusable for anonymous lookups
- `.planning/phases/11-certificates-completion-lifecycle/11-CONTEXT.md` — locked decisions D-01 through D-10, discretion items
- `.planning/REQUIREMENTS.md` — CRD-01 through CRD-06 acceptance criteria
- `.planning/STATE.md` — project history, confirms Phase 9/11 dependency gap already flagged ("No completion-rule evaluation engine... needed before LRN-07 and CRD-01/02 can work" — now resolved, but the note about assessment criteria absence is corroborated here independently)
- `package.json` — Next.js 16.3.4, Vitest 4.1.11, Prisma 6.19.3 pinned versions
- npm registry (`npm view`) — live version/license/repo/creation-date checks for `pdf-lib`, `@pdf-lib/fontkit`, `pdfkit`, `qrcode` (2026-09-16)
- `slopcheck` CLI (installed and run this session) — legitimacy scan for `pdf-lib`, `@pdf-lib/fontkit`, `pdfkit`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` (read this session, per `AGENTS.md`'s mandatory-read directive) — Cache Components / GET-handler caching behavior

### Secondary (MEDIUM confidence)
- WebSearch: "pdf-lib vs pdfkit Node.js license npm downloads font embedding" — cross-checked feature/license claims against the primary npm-registry lookups above; agreement found

### Tertiary (LOW confidence)
- None retained without cross-verification — all WebSearch findings in this research were checked against the npm registry directly.

## Metadata

**Confidence breakdown:**
- Standard stack (PDF library choice): MEDIUM — two legitimate, verified candidates identified; final selection deliberately deferred to the mandatory human legitimacy checkpoint, not a research gap
- Architecture (reactive hook points, `*AsSystem` pattern, transition table change): HIGH — every claim traced to a specific file/line read this session, not inferred
- Template-editor canvas mechanics: LOW — no comparable drag/position UI exists anywhere in this codebase to pattern-match against; this is genuinely new UI work for the planner to scope carefully (D-09's own "flag for planner" framing in CONTEXT.md)
- Pitfalls (entropy, rate-limiting gap, concurrency race, denial-parity): HIGH — each grounded in either a direct grep/read of existing code or well-established security reasoning (entropy math, transaction-isolation behavior)

**Research date:** 2026-09-16
**Valid until:** 30 days (stable domain — no fast-moving external API; the one time-sensitive element, exact npm package versions, should be re-verified at install time regardless per this project's standing convention)
