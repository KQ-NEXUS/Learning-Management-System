# Phase 14: Software Licence & Deployment Control - Context

**Gathered:** 2026-10-01
**Status:** Ready for planning

<domain>
## Phase Boundary

The deployment enforces its own commercial licence terms without risking client data. The LMS verifies a provider-signed licence file (LIC-01), exposes a Licence & System Status screen and a narrow activation route (LIC-02/03), re-checks state at startup, on a schedule and before high-impact mutations (LIC-04), enforces a restricted state server-side and in the UI after the grace period (LIC-05/08), audits every licence event (LIC-06) and warns Administrators through the Phase 13 notification model (LIC-07).

Requirements are fixed by PRD §18 and LIC-01..08. This discussion settled HOW only. Commercial terms are still unapproved (PRD §18.6), so every default below is a configurable-in-the-licence product default, not a legal commitment.

</domain>

<decisions>
## Implementation Decisions

### Validation model
- **D-01:** Local verification of a provider-signed licence file only. No provider validation service, no online check, no signed validation receipts in this phase. The licence is verified against embedded public key material at startup, on a scheduled cadence and before high-impact mutations. Revocation takes effect only through the file's own expiry. — **Reversibility:** costly — adding an online validator later adds a provider-side component and new states (offline window, receipts); the state machine and stored-state shape should be built so that can be added without a rewrite.
- **D-02:** Ed25519 signatures via Node built-in `crypto` (no new dependency). The licence carries a signing-key ID; the LMS ships a versioned public-key trust set so rotation overlaps and retired keys still verify. — **Reversibility:** one-way — the licence file format and key-ID scheme become a published contract with every issued licence; the schema needs an explicit schema-version field from day one.
- **D-03:** The licence generator is a separate provider-side CLI/script kept outside the client-deployed code path, with a provider runbook (issue, renew, replace, key rotation, compromise recovery) as a deliverable. The private signing key never exists in the LMS repo, config, backups or UI. Tests mint licences with a throwaway dev key only. — **Reversibility:** reversible — generator is independent of the LMS.
- **D-04:** Because there is no online validator, the "bounded offline-validation policy" of LIC-04 applies to local failures only: a cryptographically invalid, wrong-client, wrong-deployment or unsupported-schema licence restricts immediately; a transient failure to read or verify stored licence state keeps the last-known-good state for a bounded window (default 24 h) with an Administrator warning, then restricts. Network connectivity never affects licence state.

### Restricted-state scope
- **D-05:** Restriction is an application-level "continuity mode", never a database-wide read-only switch.
- **D-06:** **Terminology: the post-grace state is called "restricted continuity mode", never "read-only"** (code, UI, audit, tests, contract). Existing enrolments may continue coursework, progress recording, submissions, assessment, grading and certificate issuance. Blocked: new enrolments, new checkout sessions, publishing/content changes, staff and permission changes, settings changes and other ordinary administrative mutations (planner enumerates the exact allowlist and blocklist from the service inventory). **This is an explicit PRD amendment to §18.2** (which blocks grading/certificate changes), not an incidental deviation. — **Reversibility:** costly — flipping to strict read-only touches every learner/grading write path's exemption.
- **D-07:** Always allowed in restricted state: sign-in/out, password reset, email verification and security administration (session revoke, credential rotation); payment webhooks, refunds and reversals; data export and the licence activation route; transactional email and in-product notifications (the outbox keeps draining).
- **D-08:** **Explicit PRD amendment to §19.** Payment webhooks, reconciliation, refunds, reversals and disputes remain operational in restricted continuity mode. Payments initiated before the restriction timestamp may complete and receive their recorded entitlement (no charged-but-undelivered). Creation of new checkout sessions is blocked. This replaces the §19 "Software licence interaction" row (which blocks payment confirmation, refund initiation/recording and new enrolment activation). The "initiated before" test needs a recorded payment-initiation timestamp compared to the restriction timestamp; planner defines it.
- **D-08a:** **Amendment deliverables (user-directed):** update PRD §18.2 and §19 (and the §19 test matrix row), the commercial contract, the administrator UI copy and the acceptance tests so all use the "restricted continuity mode" wording above. If any discrepancy remains, the contract controls. Plans must include the PRD edits and a wording-consistency check across UI copy and tests; the contract itself is outside the repo and owned by the user.
- **D-09:** Enforcement lives inside the `withPermission` choke point: mutating operations are default-blocked in restricted state, returning a non-sensitive "licence restricted" error; an explicit allowlist (D-06/D-07/D-08) is exempt, so new resources inherit enforcement automatically. System paths that do not run through `withPermission` (webhook handlers, scheduled tasks, system services) get an explicit guard or an explicit documented exemption. A boundary test must prove no write path is left unguarded. The UI mirrors server state (disabled controls with a reason, never the only gate). — **Reversibility:** costly — enforcement placement shapes every future mutation path.

### Policy defaults and clocks
- **D-10:** Expiry, grace end and the renewal/support contact are signed fields inside the licence payload. Warning cadence for Administrators is a code default: 60, 30, 14, 7, 3 and 1 days before expiry, plus expiry and grace-ending notices. The deployer cannot edit grace or thresholds.
- **D-11:** Default grace is 14 calendar days of normal operation with prominent warnings, then restricted state. Expiry is an exact UTC instant displayed with the client-local date and timezone. The contract must state the same rule.
- **D-12:** Clock handling: persist a high-water mark of the maximum observed time; use monotonic time within a process; tolerate ~10 min skew; a larger backward jump raises an Administrator alert and an audit event rather than locking anyone out. Offline clock tampering is accepted as unsolvable.
- **D-13:** Deployment binding: the licence names a deployment identifier that must match a value seeded in the database at install (not hostname, MAC or container ID, so DR, scaling and migration survive). The active licence and its derived state live in the database so every Netlify function instance sees the same state. Writes to the stored last-known-good record must be atomic. — **Reversibility:** costly — the seeded deployment-ID and stored-state schema are Prisma migrations.

### Admin screen and alerts
- **D-14:** Licence & System Status screen (under Administration, `licence.view`): state, licence ID, registered client, deployment ID, exact UTC expiry and grace end with local timezone, days remaining, last verification result; a plain-language "what works / what is blocked" list for the current state; renewal and support contact from the signed payload; activation upload for `licence.activate` holders with clear non-sensitive rejection reasons; a downloadable non-sensitive diagnostic report; shortcut to existing exports. The UI never offers create/extend/edit/replace-signature/self-reactivate (LIC-03). Never shows signing material, gateway secrets or stack traces.
- **D-15:** Alerts reuse the Phase 13 pipeline: a scheduled task evaluates state and emits deduped domain events (correlation = licence ID + state/threshold), the existing drain creates Notification rows and emails for Global holders of `licence.view`. A persistent in-app banner for Administrators is added on top. Messages carry no signing or contract detail (LIC-07).
- **D-16:** Licence checks run as a scheduled task following the existing `src/server/scheduled/*-task.ts` + Netlify scheduled function pattern (injected-deps factory, worker-runtime-closure rule enforced by `tests/boundary.test.ts`), plus startup and before-high-impact-mutation checks.
- **D-17:** Every licence activation, validation outcome, state transition, restriction enforcement and licence-related export is written to the existing audit service with actor or system actor, target licence ID, outcome, correlation ID and safe context only (LIC-06).

### Claude's Discretion
- Licence file encoding and payload field names, within D-02's schema-version/key-ID requirement.
- Exact high-impact-mutation list for pre-action checks, and the exact continuity allowlist of learner/grading/certificate actions (D-06), derived from the existing service inventory.
- Database model shape for stored licence state, high-water mark and deployment ID.
- Scheduled cadence (hourly-to-daily is acceptable since verification is local), banner placement and copy, diagnostic-report format.
- Which existing permission/audit view surfaces licence audit events (licence permissions themselves do not grant audit access per PRD §18.4).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product authority
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` §18 (lines ~718–781) — licence model, states, LIC-01..08, permissions, safeguards, decisions required before launch.
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` §19 "Software licence interaction" row (~line 852) and test matrix (~line 862) — payment/refund behaviour in expired state; conflicts with D-07/D-08 (see flag).
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` §11.5 — Licence & System Status UI/workflow spec (PRD wins on conflict).
- `.planning/REQUIREMENTS.md` LIC-01..LIC-08.
- `.planning/ROADMAP.md` Phase 14 section — goal and success criteria.
- `.planning/PROJECT.md` Key Decisions — Phase 14 is contingent on commercial-terms approval.

### Inputs
- `.planning/research/phase-14-licence-commercial-research.md` — EXTERNAL, UNVERIFIED commercial/operational research (grace, offline window, continuity scope, contract points). Input only, not a decision record; legal items need counsel review.

### Prior phase decisions this builds on
- `.planning/phases/13-transactional-communications-notifications/13-CONTEXT.md` — D-01..D-05 (outbox drain, Netlify scheduled pattern, dedup), D-17..D-22 (Notification model, bell/drawer, staff-scope resolution).
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md` — `withPermission` choke point, service layer, folder-boundary lint rule.

### Code
- `src/server/permissions/catalogue.ts` (lines ~82–107), `src/lib/permission-groups.ts` — `licence.view` and `licence.activate` already exist, Global only; catalogue stays closed.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/permissions/with-permission.ts` — the single authorization choke point; natural home for restricted-state enforcement (D-09).
- `src/server/scheduled/*-task.ts` (e.g. `cleanup-notifications-task.ts`, `reconcile-payments-task.ts`) — injected-deps task factories wrapped by `netlify/functions/`; template for the licence-check task.
- `src/server/services/domain-event-service.ts`, `domain-event-drain-service.ts`, `notification-service.ts`, `email-dispatch-service.ts`, `event-intent-mappers.ts`, `src/server/services/event-mappers/` — outbox, dedup, in-product notifications and email for licence warnings.
- `src/server/services/audit-service.ts`, `audit-read-service.ts`, `audit-export-service.ts` — append-only audit with credential redaction.
- `src/server/services/export-service.ts`, `export-worker-service.ts`, `export-download-service.ts` — existing export route to keep reachable in restricted state.
- `src/server/services/continuity-service.ts` — existing role-management continuity safeguard (unrelated name; do not conflate with licence continuity mode).
- Staff UI primitives (ResourceTable, ResourceForm, DetailLayout, ConfirmModal) and the Phase 13 notification bell/drawer.

### Established Patterns
- Services under `src/server/services/` are the only importers of `@prisma/client` (ESLint-enforced); scheduled-task closure must not import `next/headers`, the permission layer or `getCurrentActor` (`tests/boundary.test.ts`).
- Closed permission catalogue (36 identifiers); no new permission identifiers.
- Audit-first write path; identical-404 denial parity; non-sensitive error responses.
- Webhooks live under `src/app/api/webhooks/` and run outside the normal permission path, so they need an explicit licence decision (D-07/D-09).

### Integration Points
- Every mutating server action and API route (enforcement), checkout session creation (block), payment webhook handlers and refund service (allowlist), the Phase 13 drain and notification bell (alerts), the staff Administration navigation (new screen), audit view and export routes.

</code_context>

<specifics>
## Specific Ideas

- Guiding principle from research: restriction stops new commercial use while preserving identity, existing readable content, data recovery, security and cleanup of financial obligations.
- Keep "expired", "grace", "restricted/read-only", "invalid" as distinct, separately named states in code, UI and audit (research risk #20).
- Do not invest in obfuscation, hidden checks or a remote kill switch; the contract is the primary control (PRD §18.1).
- Tests should cover leap years/timezone boundaries, clock rollback, restored backups, expiry during an in-flight payment, old licence-schema versions, and key rotation overlap.

</specifics>

<deferred>
## Deferred Ideas

- Online validation service, signed validation receipts and a manual request/response file for air-gapped installs — future phase if suspension/revocation becomes a commercial requirement (D-01 keeps the door open).
- Revocation/suspension of an issued licence before its expiry — depends on the online validator.
- Emergency-extension workflow beyond issuing a replacement signed licence — contract-dependent.
- Licence telemetry — not collected; would need a disclosure/lawful-basis review.
- Legal and contract items (ownership, no-lien data clause, export format guarantees, DPA, NDPA/GAID roles, merchant of record) — counsel review, outside the product build.

### Reviewed Todos (not folded)
- `2026-09-25-move-staff-support-queue-filtering-into-sql.md` — support-queue performance; unrelated to licensing.
- `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` — UI mutation warnings; unrelated to licensing.

</deferred>

---

*Phase: 14-Software Licence & Deployment Control*
*Context gathered: 2026-10-01*
