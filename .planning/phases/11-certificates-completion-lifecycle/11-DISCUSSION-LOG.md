# Phase 11: Certificates & Completion Lifecycle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-16
**Phase:** 11-Certificates & Completion Lifecycle
**Areas discussed:** Course certs inside a Programme, Issuance trigger, Enrolment.status → COMPLETED, Certificate file & rendering

---

## Course certs inside a Programme

| Option | Description | Selected |
|--------|-------------|----------|
| Programme-only | Course-cohort enrolments get Course certificates; Programme-cohort enrolments get exactly one Programme certificate, even though completion-service.ts internally tracks each member course's CompletionRecord | ✓ |
| Both | Programme learner gets a Course certificate per finished member course PLUS the final Programme certificate | |
| You decide | Let Claude/research pick | |

**User's choice:** Programme-only (recommended)
**Notes:** Grounded in code: `completion-service.ts`'s `recalculateCompletion()` already creates a `COURSE`-scope `CompletionRecord` for every member course of a Programme cohort, which made the literal reading of "standalone" in CRD-01 the key ambiguity to resolve before any certificate-issuance logic could be scoped correctly.

---

## Issuance trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic | Reactive, fires the instant a CompletionRecord is satisfied, system-actor pattern (mirrors D-11/D-01 precedent) | |
| Staff-triggered | Completion passing makes it eligible; staff must actively issue via `certificates.issue` | |
| You decide | Let Claude/research pick the mechanism | |

**User's choice (initial):** "can they be a dropdown so staff can choose if it should be automatic or staff triggered"
**Resolution:** Neither hardcoded option — made configurable per Course/Programme instead (see follow-ups below).

### Follow-up: where does the issuance-mode setting live?

| Option | Description | Selected |
|--------|-------------|----------|
| Per Course/Programme | New field next to certificateEnabled (certificateIssuanceMode: AUTOMATIC \| MANUAL) | ✓ |
| One global deployment setting | Single system-wide switch for all Courses/Programmes | |

**User's choice:** Per Course/Programme (recommended)

### Follow-up: MANUAL-mode staff workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Pending-review queue | New staff list (e.g. /staff/certificates) filtered to eligible-not-yet-issued; mirrors Phase 10's grading-queue precedent | ✓ |
| Per-enrolment only | Staff see "eligible - not issued" only on a specific enrolment/roster detail view, no dedicated queue | |

**User's choice:** Pending-review queue (recommended)

---

## Enrolment.status → COMPLETED

| Option | Description | Selected |
|--------|-------------|----------|
| On certificate issuance | Enrolment -> COMPLETED fires in the same transaction as certificate issuance (AUTOMATIC or MANUAL click); for Programme cohorts, only on the PROGRAMME-scope certificate | ✓ |
| On CompletionRecord creation | Fires independent of certificate issuance, even if certificateEnabled = false | |
| You decide | Let Claude/research pick, preserving reversibility | |

**User's choice:** On certificate issuance (recommended)
**Notes:** Grounded in `completion-service.ts`'s DD-6 comment, which explicitly deferred this transition (and "the revocation semantics that make a terminal state safe") to Phase 11.

### Follow-up: does COMPLETED revert on a CRD-06 correction?

| Option | Description | Selected |
|--------|-------------|----------|
| Revert to ACTIVE | Mirrors D-12's CompletionRecord.supersededAt pattern — nothing destroyed, learner can re-complete | ✓ |
| Stays COMPLETED regardless | Enrolment.status never reverts; correction tracked entirely on the Certificate row | |

**User's choice:** Revert to ACTIVE (recommended)

---

## Certificate file & rendering

**Initial question (rendering library) — superseded by user clarification:**

**User's clarification:** "i dont understand are we to generate it or it would be uploaded by the school so students/learners can download it" — surfaced a real ambiguity between the certificate's *content* (must be system-generated per learner, per CRD-03's unique verificationRef requirement) and its *visual design* (could be app-native or school-branded). Resolved by splitting into the two questions below.

### Design-source question

| Option | Description | Selected |
|--------|-------------|----------|
| School-provided branded template | Administrator uploads one branded background/template; LMS overlays dynamic fields | ✓ |
| App's own built-in design | Fixed app-styled layout, no branding upload | |
| You decide | Research recommends | |

**User's choice:** School-provided branded template — but asked to check Moodle's actual approach first before locking in.

**Research performed (WebSearch):** Moodle's `mod_customcert` plugin — site admins configure certificate templates via composable elements (border, image/logo, signature, dynamic fields for name/course/date) positioned on a canvas, rendered to PDF via TCPDF (a PDF-construction library, not a headless browser). Sources: docs.moodle.org/502/en/Certificate_templates, docs.moodle.org/502/en/Custom_certificate_module, moodle.org/plugins/mod_customcert.

### Template-editor scope question (illustrated)

Two ASCII-preview mockups shown inline first, then a full illustrated Artifact page published
(https://claude.ai/artifact/XCab67XEfi8jGbi1VwMpUE) comparing:

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed layout, uploaded background | One upload field, app-defined fixed field positions, no new positioning UI | |
| Full Moodle-style template editor | Canvas editor: add/drag-position/style each element, save as reusable template | ✓ |

**User's choice:** Full Moodle-style template editor — chosen after viewing the illustrated comparison. Explicitly flagged in CONTEXT.md (D-09) as a real scope addition for the planner, not a small add-on.

### Template-span question

| Option | Description | Selected |
|--------|-------------|----------|
| One global template | Matches COM-04's "one approved client brand per deployment" precedent | |
| Per Course/Programme templates | Each Course/Programme authors its own design | |

**User's initial answer:** "from the editor can't we design multiple templates then when creating the course/programme we can choose the one we want to be issued, but before we lock that in check how moodle handles it"

**Research performed (WebSearch):** Confirmed Moodle's actual behavior — templates are authored once in a global library (Site administration), then each certificate activity selects which one to load via a "Load template" dropdown. Source: moodle.org/mod/forum/discuss.php?d=371586, docs.moodle.org/502/en/Custom_certificate_module, github.com/mdjnelson/moodle-mod_customcert.

**Final answer (after confirmation):** Shared library, per-Course/Programme selection — matches the user's proposed structure and Moodle's confirmed behavior. New `CertificateTemplate` model; `Course.certificateTemplateId` / `Programme.certificateTemplateId` selects from the shared library.

---

## Claude's Discretion

- Exact PDF-construction library choice (e.g. pdf-lib, PDFKit) — subject to the project's mandatory human package-legitimacy approval gate.
- Exact dynamic-field set beyond learnerName/awardTitle/issuedAt/verificationRef (e.g. QR code target URL).
- Template-editor element set and canvas mechanics (drag precision, snapping, undo).
- Verification-reference format — reuse checkout-service.ts's generateOrderReference() convention unless research finds a reason to diverge.
- Exact revoke/reissue staff workflow shape (dedicated review queue vs. per-certificate action) — not discussed in depth this session.

## Deferred Ideas

None raised outside phase scope. Two previously-surfaced todos were reviewed via `todo.match-phase` but not folded (same as Phase 9 and Phase 10): the Phase 4.1 UI mutation-warnings todo (unrelated domain) and the Phase 7 payment-race todo (unrelated domain).
