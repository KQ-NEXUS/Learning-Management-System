# Constraints (SPEC-sourced)

Two SPEC-classified documents are synthesized here, at section granularity (not row-by-row) given their length. Both explicitly defer to the PRD as product authority.

- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` (precedence 1 — "declares the PRD remains the product authority")
- `docs/superpowers/specs/2026-09-01-track-a-foundation-design.md` (precedence 2 — "Where this design and the PRD disagree, the PRD wins")

---

## Track A Foundation — repository/module boundary decisions (D1–D4)
- source: docs/superpowers/specs/2026-09-01-track-a-foundation-design.md
- type: protocol
- content: D1 — One Next.js application, one repository (no frontend/backend split, no package-based monorepo); justified by avoiding a second authorization surface and because PRD §5.2 rules out native apps/public API marketplace. D2 — Boundaries come from folders, enforced by lint: `@prisma/client` may be imported only inside `src/server/services/`; all other code reaches data through the service layer. Framed as the load-bearing decision, required by PRD RBAC-06 and NFR-05 (server-side authorization on every protected read/write/export/file access, tested against direct-request bypass), enforced via ESLint rather than convention because of AI-assisted code generation risk. D3 — The permission catalogue is a closed, typed constant: a `readonly` tuple of string literals in `src/server/permissions/catalogue.ts`, transcribed from PRD §17.2 and §18.4; `Permission` is a derived union type, satisfying RBAC-03 (unknown permission strings rejected) at compile time. Licence permissions (`licence.view`, `licence.activate`) are included even though the licence module is deferred. D4 — Some permissions are global-scope only: `licence.view` and `licence.activate` may not be granted at Programme, Course, or Cohort scope (PRD §18.4), expressed as a constant set alongside the catalogue.

## Track A Foundation — file structure
- source: docs/superpowers/specs/2026-09-01-track-a-foundation-design.md
- type: schema
- content: `prisma/` (schema + hand-written SQL migrations); `src/app/` (routes/UI only, never imports Prisma); `src/server/services/` (only place `@prisma/client` may be imported); `src/server/permissions/catalogue.ts` (closed permission vocabulary); `src/server/auth/` (Auth.js configuration, database sessions — later superseded by the no-Auth.js decision in the auth-and-courses-slice DOC, see context.md); `src/server/audit/` (audit event writer); `src/server/payments/providers/` (Stripe and Paystack adapters); `src/components/primitives/` (ResourceTable, ResourceForm, DetailLayout, ConfirmModal); `src/lib/` (framework-agnostic helpers).

## Track A Foundation — tech/version constraints and success criteria
- source: docs/superpowers/specs/2026-09-01-track-a-foundation-design.md
- type: nfr
- content: Node 24.6.0, npm 11.5.1 (installed versions); Next.js 15, App Router, TypeScript strict mode; ESLint 9 flat configuration (`eslint.config.mjs`); repository had no commits at time of writing — this spec's work produces the initial commit; `.gitignore` must not exclude `TRACK-A-TASKS.md`; secrets never enter source control (PRD PAY-14), `.env*` excluded before any gateway credential exists. Success criteria: `npm run build` succeeds on a clean checkout; importing `@prisma/client` from `src/app/` fails lint while importing it from `src/server/services/` does not; the catalogue contains exactly the 36 identifiers from PRD §17.2 and §18.4 with no duplicates; an identifier outside the catalogue fails type checking at its call site; the initial commit contains the scaffold, the boundary rule, and the catalogue. NOTE (auto-resolved conflict, see INGEST-CONFLICTS.md): this SPEC's "Next.js 15" contradicts the DOC-classified `auth-and-courses-slice.md` (precedence 3), which specifies "Next.js 16" / "Next.js 16.3.4." Per the manifest's explicit precedence (2 beats 3, non-locked), this SPEC's Next.js 15 is recorded as the winning value for synthesis purposes; the actual repository `package.json` currently pins `"next": "16.3.4"`.

## PXR §1 — Scope and design authority guardrail
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: This PXR operationalizes PRD Revision 1's product model (Courses/Programmes/Cohorts) and adds no separate Offering entity or alternative commercial model. Scope guardrail: no tenant selector, platform operator, cross-client reporting, reseller functions, self-service branding/configuration, Google Classroom workflow, or Google Drive learning record is included.

## PXR §1.2 — Product state vocabulary
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Account: Registered → verification pending → verified/active (recovery/resend must avoid enumeration). Content: Draft version → preview → published version (active-Cohort-impacting edits require effective-date/version decision). Cohort/catalogue: Draft → readiness attention → published/available. Order/payment: Pending → paid/manual-confirmed → enrolment activated (failed/expired/duplicate/reconciliation-exception are distinct states). Enrolment: Pending commercial confirmation → active (transfer/withdrawal/cancellation where authorized). Assessment: Available → in progress/submitted → graded → released (correction/override triggers audit + completion re-evaluation). Certificate: Issued → active/publicly verifiable (revocation/reissue controlled and auditable). Ticket: New → triaged/open → assigned/escalated → resolved/closed (reopen constrained by approved policy).

## PXR §2 — Role, permission, and navigation model
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Job titles are presentation defaults only. Authority is the union of active role assignments, approved permission identifiers, and matching global/Programme/Course/Cohort scope; expired, revoked, deactivated, or out-of-scope grants provide no authority.

## PXR §2.1 — Global control behavior
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: No matching permission → hide destructive/action controls, direct navigation shows "You do not have access to this area," server denies and logs. Permission but wrong scope → no target record or "outside your assignment scope"; server denies directly, does not rely on list filtering alone. Inactive/revoked/expired role → treated as no grant; audited. Sensitive action → explicit confirmation, reason/evidence where PRD requires; server captures actor/target/before/after/reason/outcome/time/correlation. Async work → queued/processing state, then succeeded/failed/retrying with bounded, observable, idempotent retries.

## PXR §3 — Screen inventory and shared screen spec standard
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Every route must handle loading, empty, unauthorized/out-of-scope, validation-error, server-error/retry, and responsive states, in addition to screen-specific states. Screen families P01–P05 (Public), I01–I05 (Identity), L01–L10 (Learner), S01–S08 (Content & catalogue), S09–S15 (Cohorts & delivery), S16–S20 (Assessment), F01–F06 (Finance), A01–A08 (Administration), X01–X04 (Support/reporting). Shared standard: accessible skip navigation and profile menu in headers; persistent filter state and permission-gated empty-state actions on list pages; inline validation after attempt/blur with linked error summaries on forms; mobile card/summary pattern for tables with no sensitive values preloaded for unauthorized users; destructive/high-impact actions require a consequence-specific modal with reason/evidence fields and a confirm button disabled until requirements are met.

## PXR §4 — Public visitor, identity, and commercial journey
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Canonical commercial flow: discovery → Cohort choice → account creation and verified email → checkout → gateway success or authorized manual confirmation → active enrolment. No access is granted merely because an order was started. Cohort selection must survive verification (revalidated at checkout); registration/verification messaging must not disclose whether an arbitrary email exists; public certificate verification shows only status, learner display name, award title, issue date, and reference — no account/contact data.

## PXR §5.3 — Assessment-to-certificate workflow
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Submission confirmation modal names attempt/file, provides durable receipt + timestamp. Grade release requires an explicit "Release grade" confirmation naming the learner(s); draft grades are not learner-visible. Override/correction requires reason, triggers completion recalculation and affected-certificate review rather than silently altering the record. Certificate issue/reissue/revoke dialogs name credential, learner, reason, and notification consequence; public verification reflects active/revoked status with minimal data.

## PXR §6 — Staff setup, content governance, and delivery operations
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Programme editor: Course references are reused, not copied by default; Programme changes to active Cohort membership do not silently change learner obligations (Cohort snapshot preserved). Course editor: draft/published versions; edits affecting active Cohorts require an explicit effective-date or version decision. Cohort setup: exactly one target (Course or Programme); invalid target combinations prevented. Readiness checklist: covers content, schedule, capacity/price, instructors, assessment/completion, legal/policy prerequisites; PRD decisions remain named gaps rather than silently assumed pass. Instructor controls: Save Draft requires `courses.edit` in matching scope, Publish requires `courses.publish` in matching scope; attendance correction requires reason; grade release/override require matching scope and (for override) reason + audit + completion/certificate impact review.

## PXR §7 — Finance, support, certificates, reporting, and administration
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Manual payment confirmation modal repeats learner/order/amount and states "This activates enrolment once"; failed save is retry-safe, successful result is idempotent and audited. Refund: no automatic refund policy invented — UI reflects approved policy and gateway capability, reason/audit/learner communication required. Reconciliation: manual confirmation is distinct from gateway; duplicate/delayed gateway events become exceptions, not duplicate enrolments. Support: public reply and internal note composer are visually/semantically separate; learner never sees internal notes; every escalation/status/owner change records reason/time. Administration: role editor accepts only the approved permission catalogue, shows a sensitive-permission warning and effective-access preview; continuity safeguard prevents unsafe last-administrator removal. Dashboard/CSV export lifecycle: PII/sensitive columns omitted by default; export is auditable with requester/scope/filters/as-of time; download requires still-valid authorization and short-lived access.

## PXR §8 — Button, modal, validation, and recovery standards
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Button taxonomy ties visibility/enablement to matching permission/scope: navigation controls are always safe; create/save-draft controls require matching create/edit/manage scope; publish/activate controls (Publish Course, Publish Cohort, Release grade, Confirm payment) require matching sensitive permission/scope plus prerequisite readiness and show a review modal; integrity actions (Override grade, Correct attendance, Revoke/Reissue certificate, Refund, Revoke role) are visible only to tightly permitted users, require reason/evidence, use a high-impact confirmation modal, and must not partially change local UI on failure; export/download controls require `reports.export`/`audit.export` plus current record authorization, with queued/progress/failure/retry states and expiring, audited links. Cross-cutting error handling: never render success before confirmed server outcome; private file failures never fall back to a public URL; permission changes mid-session must refresh effective access within the propagation window.

## PXR §9 — End-to-end workflow acceptance notes
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Defines "definition of done" per major workflow (discovery-to-enrolled-learner, programme/course/cohort setup, self-paced/instructor-led/blended delivery, assessment-to-released-outcome, completion/certificate lifecycle, payment/refund/reconciliation, support escalation, roles/reporting/audit) with explicit key controls per workflow (e.g. no access on pending/failed payment; not-graded ≠ zero; internal notes never leak). Includes pilot-test scripts per role (Learner, Instructor, Programme Manager, Finance/Operations, Administrator/custom staff) with observable proof criteria.

## PXR §10 — Workflow review: resolved logic and decision flags
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Ten findings are marked "Resolved" as UI/interaction clarifications within the PRD (duplicate enrolment activation, lost Cohort selection during verification, not-graded/zero confusion, silent content-obligation changes, scoped-role visible-but-denied controls, certificate correction visibility, invisible manual-payment queue, public/internal ticket leakage, out-of-scope export exposure — resolutions listed against each). Five items are flagged "Decision required" and intentionally left as open policy rather than invented product behavior — these mirror PRD §15.3's decisions-required list: (1) self-paced delivery access-duration rule vs. dated Cohort model; (2) prerequisite enforcement level (informational vs. blocking vs. sequencing); (3) support reopening window/response targets/escalation ownership; (4) refund/cancellation/transfer/withdrawal policy — do not automate approval logic; (5) file/video allowed types/sizes/scanning/retention approval; certificate public fields and retention/deletion schedule also require final owner approval. No new decision beyond what PRD §15 already opens is introduced here.

## PXR §11 — Software licence experience and administration
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: Client Administrator can view licence state and activate a provider-issued, signed renewal only — cannot generate licences, change dates, select a plan, replace signatures, or clear an expired/suspended state. The private provider licence generator and signing key remain outside the client deployment. Licence states: Active, Expiring soon, Grace period, Expired/read-only (mutations blocked server-side and in UI; learner access follows approved post-expiry policy, not an accidental broken journey), Invalid/suspended/validation attention (non-secret status explanation, no self-service bypass). Button/restriction matrix: view/permitted export generally allowed across states (subject to policy in expired state); publish/edit operational settings, payment confirmation/refund/new-enrolment activation, attendance/grading/certificate actions, and staff/role/settings changes are all blocked in the Expired/read-only state. `licence.view` and `licence.activate` are global-scope-only permissions (aligns with foundation-design D4).

## PXR §12 — Multi-gateway checkout and finance operations
- source: docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md
- type: protocol
- content: "This section supersedes the prior single-online-gateway assumption in the commercial workflow" (document-internal revision, consistent with PRD §19 superseding PRD PAY-01 — see requirements.md REQ-PAY-01 note). Checkout offers Paystack, Stripe, and optional manual payment, all sharing one order/payment/enrolment/notification/audit/reconciliation model. Method selector shows only currently available methods; choosing/switching method keeps one order and does not create a second enrolment. Server-verified provider result is the sole payment-success trigger — a browser redirect or client-declared success never marks payment succeeded. Duplicate/delayed provider notifications must not duplicate receipt/payment/refund/enrolment; conflicting results become a visible exception. Provider credentials/webhook secrets are deployment-managed and never exposed to staff UI. If the LMS licence reaches expired/read-only state, payment initiation/confirmation, refunds, and new enrolment activation are blocked for every method, without deleting payment evidence.
