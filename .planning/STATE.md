---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 11-10-PLAN.md
last_updated: "2026-09-18T15:18:29.936Z"
last_activity: 2026-09-18
progress:
  total_phases: 16
  completed_phases: 9
  total_plans: 152
  completed_plans: 146
  percent: 56
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** The complete learner + operator journey (discover → register → verify → pay → learn → attend → submit → grade → complete → download certificate) runs end to end against real seeded data, with every mutation authorized, scoped, and audited.
**Current focus:** Phase 11 — certificates-completion-lifecycle

## Current Position

Phase: 11 (certificates-completion-lifecycle) — EXECUTING
Plan: 10 of 16
Status: Ready to execute
Last activity: 2026-09-18

Progress: [██████████] 96%

## Performance Metrics

**Velocity:**

- Total plans completed (via GSD workflow): 0
- Average duration: N/A
- Total execution time: N/A

Note: Phase 1's work (foundation, authorization core, Courses reference slice — 84 tests across 10 files) was implemented directly by the dev team prior to this roadmap's creation, not tracked through GSD plan execution. It is marked Complete in ROADMAP.md on the strength of `.planning/codebase/*.md` evidence, not plan-completion timing.

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation | Retroactive | - | - |
| 2 | 8 | - | - |
| 06 | 9 | - | - |
| 10 | 17 | - | - |

**Recent Trend:**

- Last 5 plans: none yet via GSD
- Trend: N/A — first roadmap just created

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 04.1 P01 | 47min | 3 tasks | 5 files |
| Phase 04.1 P02 | 45min | 3 tasks | 5 files |
| Phase 04.1 P03 | 20 min | 3 tasks | 1 files |
| Phase 04.1 P04 | 38min | 3 tasks | 3 files |
| Phase 04.1 P05 | 35min | 3 tasks | 2 files |
| Phase 04.1 P06 | 55min | 3 tasks | 13 files |
| Phase 04.1 P07 | 60min | 3 tasks | 5 files |
| Phase 04.1 P08 | 20min | 3 tasks | 6 files |
| Phase 04.1 P09 | 34min | 3 tasks | 7 files |
| Phase 04.1 P10 | 23min | 3 tasks | 8 files |
| Phase 04.1 P11 | 22min | 3 tasks | 11 files |
| Phase 04.1 P12 | 16min | 3 tasks | 7 files |
| Phase 04.1 P13 | 17min | 3 tasks | 5 files |
| Phase 04.1 P14 | 14min | 3 tasks | 4 files |
| Phase 04.1 P15 | 25min | 2 tasks | 4 files |
| Phase 06 P02 | 70min | 3 tasks | 8 files |
| Phase 06 P01 | 46min | 3 tasks | 6 files |
| Phase 06 P03 | 110min | 3 tasks | 14 files |
| Phase 06 P04 | ~105min | 3 tasks | 8 files |
| Phase 06 P05 | ~15min | 2 tasks | 3 files |
| Phase 06 P06 | ~75min | 3 tasks | 8 files |
| Phase 06 P07 | ~95min | 3 tasks | 9 files |
| Phase 06 P08 | ~50min | 3 tasks | 7 files |
| Phase 06 P09 | ~45min | 3 tasks | 7 files |
| Phase 11 P01 | 1h 12m | 3 tasks | 5 files |
| Phase 11 P02 | 37min | 3 tasks | 4 files |
| Phase 11 P05 | 25min | 3 tasks | 8 files |
| Phase 11 P06 | 35min | 3 tasks | 5 files |
| Phase 11 P07 | 50min | 2 tasks | 4 files |
| Phase 11 P08 | resumed session | 2 tasks | 12 files |
| Phase 11 P09 | 50min | 2 tasks | 7 files |
| Phase 11 P10 | 40min | 3 tasks | 9 files |

## Accumulated Context

### Decisions

Full decision log lives in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- [Ingest]: No Auth.js — hand-rolled database sessions, required by IAM-03's selective/global session revocation (Auth.js Credentials provider forces JWT). Already implemented.
- [Ingest]: Next.js 16.3.4 is the locked tech-stack version (live `package.json`), not the stale foundation-design SPEC's "Next.js 15."
- [Ingest]: Full PRD/PXR scope roadmapped end-to-end through launch readiness (15 phases), not just the 7-day Track A slice — explicit user directive.
- [Ingest]: Licence module (Phase 14, LIC-01..08) stays in v1 scope but is flagged contingent on commercial-terms approval per `docs/TRACK-A-TASKS.md` (§18.6 business gate, not a technical cut).
- [Phase 04.1]: lucide-react@1.41.0 installed after human-vetted package-legitimacy checkpoint (T-04.1-SC); resolved version matches what was vetted
- [Phase 04.1]: Removed stale, corrupted .next/dev/types/routes.d.ts (leftover from a prior next dev process, unrelated to plan edits) to unblock npx next build; Rule 3 auto-fix
- [Phase 04.1]: Fixed missing ResourceForm error-summary focus management (Rule 2 - NFR-09 required)
- [Phase 04.1]: ResourceTable restyle: per-row initials tile derives tone/initials from getRowLabel (or row id) via a deterministic hash, since the generic primitive has no real per-row status field to key off; segmented filter control auto-activates for select filters with <=4 options, falling back to <select> otherwise
- [Phase 04.1]: DetailLayout's tabpanel/stacked content wraps in a shadow-card panel rather than adding a facts/side-column prop; buttons in all three primitives use border-input-border matching ResourceTable's established BTN convention; ConfirmModal backdrop uses bg-foreground/40 as the semantic replacement for bg-zinc-900/40
- [Phase 04.1]: Phase 04.1 P05: StaffIdentity narrowed to {name,email}|null for the staff-shell chip rather than passing the full ProfileSnapshot into the client component
- [Phase 04.1]: Phase 04.1 P05: search-chip bg and inactive nav dot use opacity-modified existing tokens (bg-sidebar-accent/10, bg-sidebar-muted/50) instead of two uncatalogued mockup hexes, preserving the zero-raw-hex invariant
- [Phase 04.1]: Phase 04.1 P05: off-canvas menu button hidden via lg:hidden (CSS display:none) rather than JS/matchMedia conditional rendering, avoiding SSR hydration mismatch while still removing it from the a11y tree/tab order at 1024px+
- [Phase 04.1]: Phase 04.1 P06: AuthIconChip rendered on exactly two screens (verify's invalid-token branch, confirm-email-change's success branch), not the three invalid-token instances the codebase has, to hold the plan's literal 'exactly two screens' criterion
- [Phase 04.1]: Phase 04.1 P06: auth left-panel headline/subcopy use text-sidebar-fg/text-sidebar-muted rather than three new raw-hex tokens with no semantic-tier equivalent, preserving the zero-raw-hex-outside-globals.css invariant
- [Phase 04.1]: Phase 04.1 P07: Learner shell body ground uses bg-surface-2 (mockup's cooler --muted tone), not bg-background paper, per UI-SPEC 7.3's mockup-is-tiebreaker instruction
- [Phase 04.1]: Phase 04.1 P07: Sub-640px nav collapse reuses StaffShell's CSS-toggle precedent (sm:hidden/hidden sm:flex) rather than JS/matchMedia, avoiding SSR hydration mismatch
- [Phase 04.1]: Phase 04.1 P07: Deferred the mockup's account Sessions card and email Verified badge — neither exists today and either would add a new capability during a restyle, per the plan's Planner Assumptions
- [Phase 04.1]: Phase 04.1 P08: Programme audience and certificate details use conditional fact cards; absent values render no placeholder or empty cell
- [Phase 04.1]: Phase 04.1 P08: Hard-404 comments use 'streaming boundary' wording so the privacy rationale remains while the zero-Suspense gate is mechanically enforceable
- [Phase 04.1]: Phase 04.1 P09: Kept AssignmentDrawer as a documented non-primitive and mirrored ConfirmModal's z-50 tokenised overlay treatment.
- [Phase 04.1]: Phase 04.1 P09: Retained native checkbox rendering while adding the required 16px, 1.5px border-input-border treatment so checked state remains visible.
- [Phase 04.1]: Phase 04.1 P10: Kept the shipped learner-preview wording instead of adopting UI-SPEC 6.2's unverified progress-recording claim.
- [Phase 04.1]: Phase 04.1 P10: Preserved the existing empty Publish and Archive bulk-action handlers exactly as required; capability work remains deferred.
- [Phase 04.1]: Phase 04.1 P11: Preserved every permission and scope label, grouping, ordering, and wrapping behavior; the role sweep changed presentation classes only.
- [Phase 04.1]: Phase 04.1 P11: Kept programme membership references, submitted field names, action calls, ArrangeBoard props, and dirty-state calculation unchanged.
- [Phase 04.1]: Phase 04.1 P12: Pinned @tiptap/extensions at 3.31.0 after explicit human approval; no existing Tiptap package was upgraded.
- [Phase 04.1]: Phase 04.1 P12: Preserved keyboard reorder and announcement paths while adding semantic authoring surfaces, a non-colour drag outline, and a labelled dirty-state pill.
- [Phase 04.1]: Phase 04.1 P13: Broken image and video URLs retain an aspect-video neutral placeholder through CSS-only wrappers; no onError handler, state hook, client directive or unconditional error caption was introduced.
- [Phase 04.1]: Phase 04.1 P13: UploadPanel keeps the shared StatusPill and all scan/poll/rollback behavior; decorative Upload and FileText icons are named lucide-react imports.
- [Phase 04.1]: Phase 04.1 implementation closes on green automated gates; the user-requested post-implementation browser walkthrough remains human-needed and explicitly unconfirmed.
- [Phase 04.1]: UI-SPEC section 8 states 14 backstops but contains 21 individual resolved-backstop rows; Plan 14 records all 21 for conservative UAT coverage.
- [Phase 06]: [Phase 6 P02]: Created tests/identity.test.ts as a new file for POLICY_TYPE/POLICY_VERSIONS unit coverage rather than extending the real-Postgres identity-security.integration.test.ts
- [Phase 06]: [Phase 6 P02]: applyEnrolmentActivation extracted from approveEnrolment (PENDING_PAYMENT -> ACTIVE), callable by both the staff withPermission path and a future actorless Stripe webhook; enrolment.activated vs enrolment.approved distinguishes the two in the outbox
- [Phase 06]: [Phase 6 P01]: stripe pinned exact at 22.6.1 after human npmjs.com legitimacy approval; NGN test-mode Checkout Session probe succeeded against this account (country USA), clearing D-07/Pitfall-5's currency gate for 06-03
- [Phase 06]: [Phase 6 P01]: STRIPE_WEBHOOK_SECRET intentionally left unset in .env.local -- no webhook route exists until 06-03; plan-sanctioned deferral, not a blocker
- [Phase 06]: [Phase 6 P03]: Webhook authorization model resolved as-system-module (checkout-webhook-system-service.ts) -- third *AsSystem module after hold-release-system-service.ts and scan-system-service.ts; deliberately unauthorized, audits as actorId: null, actorType: SYSTEM
- [Phase 06]: [Phase 6 P03]: Rule 2 auto-fix -- added REG-03 amount/currency mismatch guard to activateOrderAsSystem (plan frontmatter prohibited it with verification:test but no task action step described it); a mismatch routes to EXCEPTION and never activates
- [Phase 06]: [Phase 6 P03]: Rule 2 auto-fix -- added getOwnOrderByReference to checkout-service.ts, mirroring getOwnOrder's ownership contract, since the receipt page needs a reference-keyed lookup the plan's Task 2 text never specified
- [Phase 06]: [Phase 6 P04]: checkoutReturnPathFor constructs the post-auth redirect from a validated cohort id (letters-and-digits allowlist), never echoes caller input -- structurally closes the T-06-20 open-redirect surface rather than merely validating against known-bad patterns
- [Phase 06]: [Phase 6 P04]: getCohortOfferPath added to checkout-service.ts (Rule 2 auto-fix) -- cohort-to-course-slug lookup the resumption route's typed-refusal redirects needed but no earlier plan exposed
- [Phase 06]: [Phase 6]: [Phase 6 P05]: No REG-01 field gap on the Programme side -- PublicProgramme's completion-expectation fields (memberCourseTitles, certificateEnabled) were already rendered before this plan; prerequisites/durationHours stay Course-only, confirmed by a grep gate rather than invented
- [Phase 06]: 06-06: extracted applyEnrolmentActivation + the enrolment transition table into enrolment-transitions.ts so the webhook's import closure never touches the permission choke point (caught by the new webhookRuntimeClosure boundary test) — enrolment-service.ts imports withPermission/cohort-scope at module scope for its staff-authorized exports; importing applyEnrolmentActivation from that file still pulled those onto checkout-webhook-system-service.ts's closure (T-06-33) even though nothing there calls them
- [Phase 06]: [Phase 6 P07]: initiateStripePayment's cancelUrl carries a declined=1 marker (Rule 2) -- Stripe gives the app no other signal distinguishing a genuine decline from an ordinary back-out at cancel_url; read for UX only, never trusted as a security/payment-state fact
- [Phase 06]: [Phase 6 P07]: getOwnVerificationStatus added to checkout-service.ts (Rule 2) -- the order-summary page needs the same User.emailVerified fact the D-13 pay-gate reads, and Actor carries no emailVerified field
- [Phase 06]: [Phase 6 P07]: extending initiateStripePayment's signature required fixing tests/checkout-hold-race.integration.test.ts and tests/checkout-webhook.integration.test.ts (Rule 3) to keep the repo compiling -- both remain Docker-BLOCKED in this sandbox, not run
- [Phase 06]: [Phase 6 P08]: Resumed after an interrupted prior run (API rate-limit, not a code failure) -- verified Task 1 (webhook confirmation email) and Task 2 (confirming interstitial) on-disk work was already correct and complete before implementing Task 3 fresh
- [Phase 06]: [Phase 6 P08]: SUPPORT_CONTACT_EMAIL sourced as a documented .env.example placeholder (support@example.com, must-override-before-launch) since no real support contact value exists anywhere in the codebase or docs and no deployment config is reachable from this sandbox -- mirrors EMAIL_SENDER_ADDRESS's existing dev-fallback convention
- [Phase 06]: [Phase 6]: [Phase 6 P09]: checkout-phase-invariants.test.ts (TypeScript-compiler-API, directory-prefix exemption) immediately caught two real pre-existing PAY-09 violations -- checkout-service.ts and the Stripe webhook route both named Stripe SDK types outside providers/stripe/ -- fixed as Rule 1 auto-fixes before the test's first real-tree run
- [Phase 06]: [Phase 6]: [Phase 6 P09]: Task 2's environment prep and twelve-step Stripe walkthrough were not attempted (Docker unavailable, and per this plan's objective no browser is available either) -- recorded as outstanding human verification rather than fabricated, consolidated with 06-03/06-05/06-07/06-08's own outstanding walkthroughs in 06-09-SUMMARY.md
- [Phase 11]: Certificate issuance mode defaults to MANUAL for Courses and Programmes so existing rows never auto-issue.
- [Phase 11]: One ACTIVE certificate per enrolment and scope is enforced with a PostgreSQL partial unique index.
- [Phase 11]: Only COMPLETED may reopen to ACTIVE; WITHDRAWN, TRANSFERRED, and CANCELLED remain closed.
- [Phase 11]: pdf-lib 1.17.1 and @pdf-lib/fontkit 1.1.1 are the human-vetted, exact-pinned PDF construction stack; the server-side probe proves positioned text, shapes, PNG, and custom-font rendering.
- [Phase 11]: Certificate-template authoring uses a dedicated certificates.manage permission; Plan 11-05 must add it to the closed catalogue and default-role seed.
- [Phase ?]: [Phase 11 P05]: certificates.manage is the template-authoring permission (new-manage, human-recorded 11-DECISIONS.md); Administrator is the only default role that already held certificates.issue, so it is the only role granted certificates.manage, inherited automatically via its existing full-PERMISSIONS spread
- [Phase ?]: [Phase 11 P05]: certificate-template-service.ts's update() only re-validates/re-stamps layout when the caller supplies a layout key -- a rename-only edit leaves the stored layout untouched rather than overwriting it with EMPTY_LAYOUT_V1
- [Phase ?]: [Phase 11 P05]: Introduced certificate-default-template-layout.ts (plan-unlisted, Rule 3) as a pure shared fixture so seed.ts and its test never keep two independently-drifting copies of the seeded default template's layout -- seed.ts cannot be safely imported into a test since its bottom-of-file main() runs against a real database
- [Phase 11]: [Phase 11 P06]: Dropped the planner's discretionary bare /verify landing page (Rule 4) -- (auth)/verify/page.tsx already owns that exact path for IAM-02 email verification (?token=), live and linked from already-dispatched transactional emails; kept /verify/[verificationRef] (CRD-04's literal requirement) and wired the reference-entry form onto that result page instead
- [Phase 11]: certificate-issuance-service.ts declares its own wider CertificateIssuanceTxClient rather than widening CompletionServiceTxClient (DD-6 omits enrolment.update on purpose) — Preserves Phase 9's structural guarantee that completion-service.ts cannot touch Enrolment.status even by accident; Phase 11 owns the COMPLETED transition and its D-06 reversal
- [Phase 11]: reactToCompletionResults, not issueCertificateForEnrolment, gates MANUAL issuance mode so the issuance dependency is never called at all under MANUAL — Upholds D-04's read-time-only eligibility invariant structurally, not merely by omitting a write
- [Phase 11]: Added storage-service.ts's getObjectBytes (Rule 2 auto-fix, plan 11-07) — no prior function fetched raw object bytes server-side, only presigned URLs — Required for the live resolveTemplateAsset binding recalculateCompletionAndIssue needs to actually embed template images at PDF-render time
- [Phase 11]: P08: Both certificateIssuanceMode/certificateTemplateId are optional in Course and Programme action schemas (a disabled control is never submitted); a shared assertTemplateSelectable guard rejects archived templates server-side on both actions (T-11-33); course-service.ts/programme-service.ts needed no allow-list change since both forward data wholesale via the resource-service factory.
- [Phase ?]: [Phase 11 P09]: Certificate template elements are keyed by array index, not a synthetic client id -- CertificateElementV1 has no id field in the persisted schema and this plan only ever appends
- [Phase ?]: [Phase 11 P09]: Image element's default assetKey is a documented 'pending-upload' placeholder (valid non-empty string), not empty -- the layout parser rejects empty assetKey and 11-12 wires the real upload/asset picker
- [Phase ?]: [Phase 11 P09]: Property inspector renders only the static 'Select an element to edit its properties.' placeholder this plan regardless of selection -- the real per-element editable fields are plan 11-12's interior
- [Phase ?]: [Phase 11 P09]: Unsaved-changes guard on the template editor is a small, self-contained ConfirmModal + beforeunload pair local to TemplateEditorShell, not UnsavedOrderGuard.tsx's context/provider pair, since this route needs its own exact UI-SPEC 6.1 copy and no UnsavedOrderProvider is mounted here
- [Phase 11]: [Phase 11 P10]: lesson-progress-service.ts and attendance-service.ts import certificate-issuance-service.ts's recalculateCompletionAndIssue aliased to the original recalculateCompletion local name, so the composition-root default-parameter swap touches only the import line and the default value, zero call-site changes in either file
- [Phase 11]: [Phase 11 P10]: GradeOverrideDeps.reactToGradeOverride carries a required actorId beyond the plan's literal 3-field args shape (Rule 2) -- the certificate-review audit row must attribute the overriding staff member, never SYSTEM (T-11-42); flagCertificateForReview grew an optional context field so flagCertificatesForGradeCorrection reuses it instead of a second flag-write implementation

### Pending Todos

None yet.

### Blockers/Concerns

Carried forward from `.planning/codebase/CONCERNS.md` (full detail there) — relevant to upcoming phases:

- [Phase 3, resolved]: Password reset is now implemented (`password-reset-service.ts`, 1h token TTL, global session revocation on completion) — closes IAM-03's remaining gap. Human UAT of the live sign-in/reset/routing flows is still pending (see 03-06-SUMMARY.md coverage item D5).
- [Phase 3, resolved]: Brevo is wired as the transactional email provider (`brevo-client.ts`) for verification, reset, and email-change confirmation sends. No manual smoke test with a real `BREVO_API_KEY` was run this session.
- [Phase 6/7, resolved]: Stripe and Paystack adapters, signature-verified webhooks, provider routing, settlement reconciliation, manual confirmation, and refunds are implemented and accepted in provider test mode. See Phase 7 `07-UAT.md` and `07-VALIDATION.md`.
- [Phase 9/11]: No completion-rule evaluation engine exists yet despite `completionRule` JSON fields on Programme/Course/Lesson — needed before LRN-07 and CRD-01/02 can work.
- [Phase 4/9]: No file upload/virus-scanning exists yet despite `scanStatus` fields on LessonResource/Submission/TicketAttachment — needed for CAT-04, LRN-03, ASM-04, SUP-01.
- [Phase 14]: Licence module implementation is contingent on commercial-terms approval (business gate, not technical) — may need re-sequencing once that decision lands.
- [General]: Bulk table actions have empty onClick handlers in `CoursesTable.tsx`; no `error.tsx`/`not-found.tsx` pages exist yet. Low priority, but worth picking up opportunistically in Phase 2+.
- [Phase 5]: `05-REVIEW.md` (2026-09-08) found 3 CRITICAL correctness bugs — CR-01 (attendance markable on cancelled sessions/off-roster enrolments), CR-02 (cohort publish can use stale readiness under a race), CR-03 (enrolment transfer can race past the same-offer invariant). Candidate fixes + regression tests exist uncommitted in the working tree as of 2026-09-09 (attendance-service.ts, cohort-service.ts, enrolment-service.ts + tests) — all pass, tsc clean, no regressions — but await explicit user go-ahead to commit (never auto-commit for this project).
- [Phase 04.1]: Real video captions/WebVTT support (NFR-09 accessible media alternative) remains unresolved — no schema/upload contract for it exists. `04.1-GAP-COVERAGE.md` documents this as an explicitly open scope decision, not silently closeable by a styling pass. Accepted as a deferred gap by user decision on 2026-09-09 rather than blocking Phase 6; revisit before NFR-09 launch-gate verification (Phase 15).
- [Tooling] STATE.md's Current Position section has no 'Current Plan'/'Total Plans in Phase' labeled lines, so 'gsd_run query state.advance-plan' errors with a parse failure (pre-existing gap, not caused by Phase 6 Plan 2's changes; state.sync does not add these fields either) — phase-level position tracking still works via progress.completed_plans in frontmatter.
- [Tooling, Phase 11 P05]: `state.advance-plan` incremented the unlabelled 'Plan: N of 16' line from a stale baseline of 1 (last written after 11-01) rather than the actual 5 plans complete in Phase 11 (11-01..11-05 all have SUMMARY.md on disk); the frontmatter's `percent` field was also stuck at 56 (a stale phase-count coincidence, 9/16≈56%) until `state.update-progress` recalculated it to 93 (141/152 plans) from disk. Both were hand-corrected this session; same underlying gap as the entry above — `advance-plan` trusts the last-written counter instead of counting SUMMARY.md files itself.
- [Phase 6/06-03]: tests/checkout-webhook.integration.test.ts (6 cases, real-Postgres settlement proof) could not run in this execution sandbox -- Docker unavailable, same gate 06-01/06-02 hit. Needs a Docker-enabled environment to actually execute before REG-03/REG-05/PAY-10's real-Postgres proof is complete.
- [Phase 6/06-04]: tests/checkout-intent.integration.test.ts (4 cases, real-Postgres register->verify->sign-in->order round trip) could not run in this execution sandbox -- Docker unavailable, same gate 06-01/06-02/06-03 hit. Needs a Docker-enabled environment to actually execute before REG-02's real-Postgres proof is complete.
- [Phase 6/06-07]: tests/checkout-hold-race.integration.test.ts and tests/checkout-webhook.integration.test.ts were updated to compile against 06-07's extended initiateStripePayment(actor, orderId, consent) signature and new user dep -- both remain Docker-BLOCKED in this sandbox (same gate as above), so the D-13-aware fixture change and the transactional PolicyAcceptance write were proven only at the unit level (tests/checkout-service.test.ts), not against a real Postgres transaction. Needs a Docker-enabled environment to confirm.
- [Phase 6/06-09]: Phase 6 code is complete across all nine plans but three real-Postgres integration test files (checkout-webhook.integration.test.ts, checkout-hold-race.integration.test.ts, checkout-intent.integration.test.ts) have never run to completion in any sandboxed execution of this phase (Docker unavailable throughout), and the consolidated five-part human UAT walkthrough (06-03/06-05/06-07/06-08/06-09) is still outstanding -- both needed before Phase 6's UAT can close. See 06-09-SUMMARY.md.
- [Phase 9/09-14]: All 14 plans executed, all automated gates green (including a real production bug found, fixed, then further hardened after code review — see 09-14-SUMMARY.md deviations 2-3). The developer independently ran the final fix's test suite themselves (186 focused tests + both real-Postgres integration tests + tsc/eslint) and confirmed steps 1, 6, 8, 9 of the walkthrough in the browser. Still open: three UI-SPEC backstops (long-title wrap, video auto-completion/offline resilience, one long-form-text wrapping item) blocked by seed-data gaps (no long lesson titles, no real uploaded video, no realistic long-form copy) — not code defects. Also open: live browser confirmation of a session's meeting-link opening transition (a throwaway test session was seeded 2026-09-15 to make this checkable; delete `ScheduledSession` id `cmu2iy9mr0001ulxwgbg7na3z` after use if it wasn't already removed). Amara's cohort (cohort `cmtn3eo6j001huliwsyaw1sw4`, March) was never offered by either course's staff migration dialog and remains unpinned to any publication — a data-health gap worth investigating if that migration-dialog eligibility logic is ever touched.
- [Phase 9/09-08]: `ProgressMeter.tsx`'s caption renders BELOW the progress bar with only an "N of M lessons complete" string — `09-UI-SPEC.md` §5's token rules for `--teal-fill`/`--teal-text` and §7.1's copy table both specify the caption sits BESIDE the bar, and §5's token rule additionally names an actual percentage figure ("62% complete") that the current implementation never renders at all. Found during the 09-14 human walkthrough (not part of that plan's own scope to fix), deferred by explicit user decision on 2026-09-15 rather than fixed in-session. Note the UI-SPEC itself is internally inconsistent about the caption's exact text format ("62% complete" in §5 vs "{N} of {M} required lessons complete" in §7.1) — resolve that ambiguity with the user before implementing either the layout or content fix.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-09-18T15:18:29.034Z
Stopped at: Completed 11-10-PLAN.md
Resume file: None
