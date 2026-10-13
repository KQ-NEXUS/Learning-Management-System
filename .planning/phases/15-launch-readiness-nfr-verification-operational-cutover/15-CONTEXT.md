# Phase 15: Launch Readiness — NFR Verification & Operational Cutover - Context

**Gathered:** 2026-10-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the system is ready to run the business, not just feature-complete. Verify NFR-01 to NFR-14 against the PRD §14.3 launch gates (product acceptance, security and privacy, operational readiness, commercial readiness, learning readiness, user readiness), close what the code and tests can close, and leave a visible launch checklist for the items that need an owner (payment gateway production credentials, legal policies, the email sender domain, retention approval).

This phase adds no learner-facing features. It adds verification, the small amount of tooling the NFRs require (rate limits, privacy tools, CI, an ops status page) and the evidence.

The phase is planned together with the co-worker. UI/UX fixes from the 2026-10-05 review are already merged to `develop`; only the open items U-11 and U-12 carry into this phase.

</domain>

<decisions>
## Implementation Decisions

### Where and how we test
- **D-01:** Rehearsals run locally first (Docker Postgres, production build) so they are repeatable. The numbers that are signed off come from ONE run on a staging target: a Neon branch plus a Netlify deploy preview. Never test against the shared production Neon database. — **Reversibility:** reversible.
- **D-02:** "Expected pilot load" for NFR-02 is **150 learners and 10 staff active at once**. The PRD gives no number; this is the agreed definition. The p75 2.5s target is measured at that load. If it cannot be met, performance work is in scope.
- **D-03:** Page speed is measured with **k6** (concurrent load, timings) plus **Playwright** (real-browser time to usable primary content, the p75 measure). The repo already has `npm run test:perf` and `vitest.perf.config.mts`; the planner should check how they fit.
- **D-04:** The backup and restore rehearsal (NFR-08) uses **both** a Neon point-in-time restore on a branch **and** a dump restored into Docker, so there is a recovery route that does not depend on Neon. RPO 24h / RTO 8h; record timings.

### What counts as done
- **D-05:** Evidence is **one report at the end** rather than a file per gate. A separate **launch checklist** file lists the owner-dependent items with a named person for each.
- **D-06:** The phase may be marked complete once everything the code and tests can prove is proven. Owner items (gateway production credentials, legal/privacy/retention approval, email sender domain, support staffing) stay on the launch checklist, and production stays closed until they are signed.
- **D-07:** A failed check that cannot be fixed in time may be covered by a **written waiver** naming who accepted the risk and when it expires. Critical security, payment, authorization and private-file failures are **never waived**.
- **D-08:** The "unassisted full journey" (discover, register, verify, pay, learn, attend, submit, grade, complete, certificate) is proven by a repeatable **automated Playwright run on seeded data plus one manual run** with no help. The 95% end-to-end reliability measure uses the automated runs.

### Security and privacy depth
- **D-09:** The authorization bypass suite (NFR-05) covers **every server action and every private-file/download route**, driven from the existing action registry so a new action cannot be forgotten. Each is tried as the wrong user, with no permission, with the wrong scope and in the wrong record state.
- **D-10:** Add **GitHub Actions** (type check, lint, tests, `npm audit`) and **Dependabot**. There is currently no `.github/workflows`. This adds new CI files to the repo and also protects every future merge. — **Reversibility:** costly — workflow files become a shared dependency for the whole team.
- **D-11:** Extend rate limiting beyond sign-in to **register, forgot password, resend verification, public certificate check and support ticket submission**, reusing the existing approach (`src/server/auth/sign-in-throttle.ts`, `request-cooldown.ts`), with tests.
- **D-12:** NFR-11 privacy tools: a **permission-gated, audited staff tool** to export one learner's data and to **anonymise** their account. **Hard deletion stays blocked** until owners approve a retention schedule and legal-hold process (the PRD safe default). No learner self-service in this phase. — **Reversibility:** costly — anonymisation rewrites personal data in place.

### Accessibility and browsers
- **D-13:** WCAG 2.2 AA is proven by **axe on every screen** (kept in the repeatable tests), a **keyboard-only walkthrough** of the three journeys, and **one real screen-reader pass** (NVDA or VoiceOver) with the result recorded.
- **D-14:** Browser support (current and previous major of Chrome, Edge, Firefox, Safari) is covered by **Playwright on Chromium (Chrome and Edge), Firefox and WebKit** plus **one manual check on real Safari including an iPhone**.
- **D-15:** The responsive range is **320px phone to 1920px desktop plus 200% zoom/reflow**, with no unintended horizontal scrolling on primary forms and content.

### Carried-in UI decisions
- **D-16 (U-11, unverified sign-in):** Keep **one neutral message** for everyone. If the details match an unverified account, quietly send a fresh verification email. Nothing on screen reveals whether an account exists.
- **D-17 (U-12, dates and time zones):** Show **Lagos time with the zone label** everywhere, for staff and learners, for example "5 Oct 2026, 14:30 WAT". Learner support times currently show UTC and must change.

### Monitoring and availability
- **D-18:** Add a **staff-only operations status page** listing failed jobs, payment exceptions and email failures from data already stored, plus a **free external uptime monitor** hitting a health endpoint. The uptime monitor measures the 99.5% target (NFR-01). No new paid service and no error-tracking vendor in this phase.

### Claude's Discretion
- Exact k6 scenarios and thresholds, the seeding scripts, and how the performance and journey tests are split between local and staging runs.
- The layout of the ops status page and the health endpoint's shape.
- How the report and launch checklist are organised, provided every PRD gate is covered.
- Runbook format and content for deployment, rollback and job recovery (NFR-12); these were not discussed in detail.

### Folded Todos
- **Phase 15 prerequisites** (`.planning/todos/pending/2026-10-05-phase-15-prerequisites-ui-review-and-licence-go-live.md`): the licence go-live items fold in. Apply four Neon migrations, including `20261001120000_licence_deployment_control`; generate the production licence signing key and add its public half to `PRODUCTION_TRUSTED_KEYS`; confirm the hourly Netlify `check-licence` function runs; regenerate the `.docx` twins of the PRD and PXR and align contract wording; manual keyboard, screen-reader, narrow-width and zoom checks of the licence screens; close Phase 14 (`human_needed`) with `/gsd-verify-work 14`.
- **Support queue filtering into SQL** (`2026-09-25-move-staff-support-queue-filtering-into-sql.md`): `getStaffQueue` reads the whole ticket table and filters in JavaScript. Fix it as part of the NFR-02 performance work. Keep the existing queue tests.
- **Latent async-mutation warnings** (`2026-09-07-close-04-1-review-2-latent-mutation-warnings.md`): three unguarded or unclean mutation handlers in `ArrangeClient.tsx`, `ProgrammeArrangeClient.tsx` and `LessonEditorClient.tsx`. Fix as part of reliability (NFR-03) and data integrity (NFR-14).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and launch gates
- `.planning/ROADMAP.md` (Phase 15 section) — goal, five success criteria, requirement list NFR-01 to NFR-14.
- `.planning/REQUIREMENTS.md` — NFR-01 to NFR-14 text and the traceability table.
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` §14.2 (pilot success measures), §14.3 (launch gates), §15.1 to §15.3 (dependencies, risks, decisions and safe defaults before launch). This file is gitignored and local only.
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` — companion document; regenerate its `.docx` twin as part of cutover.

### Carried-in work from the UI review and Phase 14
- `.planning/audits/2026-10-05/UI-REVIEW-MERGED.md` — re-baselined UI findings and what is fixed.
- `.planning/audits/2026-10-05/UI-FIX-IMPLEMENTATION-PLAN.md` — what was implemented, what is left (U-11, U-12).
- `.planning/todos/pending/2026-10-05-phase-15-prerequisites-ui-review-and-licence-go-live.md` — go-live checklist and the rules for planning this phase.
- `.planning/phases/14-software-licence-deployment-control/14-VERIFICATION.md` and `14-UAT.md` — Phase 14 is still `human_needed`; its open manual items belong on the launch checklist.
- `docs/deployment/netlify-scheduled-functions.md` — scheduled functions that must run in production.

### Folded todos
- `.planning/todos/pending/2026-09-25-move-staff-support-queue-filtering-into-sql.md`
- `.planning/todos/pending/2026-09-07-close-04-1-review-2-latent-mutation-warnings.md`

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `CONCERNS.md`, `INTEGRATIONS.md`, `STACK.md`, `STRUCTURE.md`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/auth/sign-in-throttle.ts`, `src/server/auth/request-cooldown.ts`: existing throttling to extend to the other entry points (D-11).
- `src/server/licence/registry.ts` and the licence UI-mirror and enforcement-boundary tests: a registry of server actions already exists and is scanned by tests. The bypass suite (D-09) should be driven from it.
- `src/server/scheduled/*-task.ts` (release-expired-holds, reconcile-payments, drain-domain-events, dispatch/process/expire-export-jobs, cleanup tasks, check-licence): the job inventory for failed-job monitoring (D-18) and job recovery runbooks.
- `src/app/api/` routes (`certificates`, `lesson-resources`, `notifications`, `staff`, `submissions`, `ticket-attachments`, `webhooks`): the private-file and download routes to cover in the bypass suite.
- `npm run test:perf` with `vitest.perf.config.mts`: existing performance harness to review before adding k6.
- The audit service and event log already record sensitive actions (NFR-07); check coverage rather than rebuilding it.
- Docker Postgres on port 5434 with the `licence_test` throwaway database; the `.env` file points at the shared Neon database and must never be used for tests.

### Established Patterns
- Tests run in small batches because the dev machine is memory-limited; whole-tree scan tests need `--testTimeout=60000`.
- `withPermission` plus the licence guard is the single choke point for protected writes.
- Design-contract tests constrain spacing and colour classes in UI source.
- Staff forms use the shared `ResourceForm`; row actions use `RowActionMenu`.

### Integration Points
- A new GitHub Actions workflow and Dependabot config at the repo root.
- A new staff-only ops status page and a public health endpoint.
- New permission(s) for the learner export and anonymise tool, registered in the licence registry as write actions.
- Rate limits on `(auth)` actions, the public certificate check and support ticket submission.

</code_context>

<specifics>
## Specific Ideas

- Time display format: "5 Oct 2026, 14:30 WAT".
- The pilot offer the PRD assumes is one Programme plus one standalone Course, so the load model is one small set of cohorts with up to 150 learners active at once.
- Plan this phase with the co-worker. They own `Toaster`, shell and primitive components that the UI work touched; agree who edits shared UI parts and keep one owner at a time.

</specifics>

<deferred>
## Deferred Ideas

- Learner self-service data export and deletion requests: a later phase, after the retention policy is approved.
- A paid error-tracking service such as Sentry: revisit if the in-product ops page proves too thin.
- Hard deletion of personal data: blocked until owners approve a retention schedule and legal-hold process.
- Inline table links (cohort code, learner name) under 24px tall: still open from the UI review, low priority.

### Reviewed Todos (not folded)
None. All three matching todos were folded.

</deferred>

---

*Phase: 15-Launch Readiness — NFR Verification & Operational Cutover*
*Context gathered: 2026-10-06*
