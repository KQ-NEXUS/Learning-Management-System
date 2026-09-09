---
gsd_state_version: 1.0
current_phase: 06
current_phase_name: Registration, Checkout & Stripe Payments
status: executing
stopped_at: Completed 06-02-PLAN.md
last_updated: "2026-09-09T12:45:11.295Z"
last_activity: 2026-09-09
state_head: d34412d7a7f455bed28d3de1393d3def3dc24d31
progress:
  total_phases: 16
  completed_phases: 1
  total_plans: 74
  completed_plans: 51
  percent: 6
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** The complete learner + operator journey (discover → register → verify → pay → learn → attend → submit → grade → complete → download certificate) runs end to end against real seeded data, with every mutation authorized, scoped, and audited.
**Current focus:** Phase 06 — Registration, Checkout & Stripe Payments

## Current Position

Phase: 06 (Registration, Checkout & Stripe Payments) — EXECUTING
Status: Executing Phase 06
Last activity: 2026-09-09

Progress: [█░░░░░░░░░] 6% (6/16 phases complete: 1, 2, 3, 4, 04.1, 5)

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

### Pending Todos

None yet.

### Blockers/Concerns

Carried forward from `.planning/codebase/CONCERNS.md` (full detail there) — relevant to upcoming phases:

- [Phase 3, resolved]: Password reset is now implemented (`password-reset-service.ts`, 1h token TTL, global session revocation on completion) — closes IAM-03's remaining gap. Human UAT of the live sign-in/reset/routing flows is still pending (see 03-06-SUMMARY.md coverage item D5).
- [Phase 3, resolved]: Brevo is wired as the transactional email provider (`brevo-client.ts`) for verification, reset, and email-change confirmation sends. No manual smoke test with a real `BREVO_API_KEY` was run this session.
- [Phase 6/7]: `src/server/payments/providers/` is an empty placeholder — Stripe and Paystack adapters, webhook signature verification, and the shared payment state machine are all still to be built.
- [Phase 9/11]: No completion-rule evaluation engine exists yet despite `completionRule` JSON fields on Programme/Course/Lesson — needed before LRN-07 and CRD-01/02 can work.
- [Phase 4/9]: No file upload/virus-scanning exists yet despite `scanStatus` fields on LessonResource/Submission/TicketAttachment — needed for CAT-04, LRN-03, ASM-04, SUP-01.
- [Phase 14]: Licence module implementation is contingent on commercial-terms approval (business gate, not technical) — may need re-sequencing once that decision lands.
- [General]: Bulk table actions have empty onClick handlers in `CoursesTable.tsx`; no `error.tsx`/`not-found.tsx` pages exist yet. Low priority, but worth picking up opportunistically in Phase 2+.
- [Phase 5]: `05-REVIEW.md` (2026-09-08) found 3 CRITICAL correctness bugs — CR-01 (attendance markable on cancelled sessions/off-roster enrolments), CR-02 (cohort publish can use stale readiness under a race), CR-03 (enrolment transfer can race past the same-offer invariant). Candidate fixes + regression tests exist uncommitted in the working tree as of 2026-09-09 (attendance-service.ts, cohort-service.ts, enrolment-service.ts + tests) — all pass, tsc clean, no regressions — but await explicit user go-ahead to commit (never auto-commit for this project).
- [Phase 04.1]: Real video captions/WebVTT support (NFR-09 accessible media alternative) remains unresolved — no schema/upload contract for it exists. `04.1-GAP-COVERAGE.md` documents this as an explicitly open scope decision, not silently closeable by a styling pass. Accepted as a deferred gap by user decision on 2026-09-09 rather than blocking Phase 6; revisit before NFR-09 launch-gate verification (Phase 15).
- [Tooling] STATE.md's Current Position section has no 'Current Plan'/'Total Plans in Phase' labeled lines, so 'gsd_run query state.advance-plan' errors with a parse failure (pre-existing gap, not caused by Phase 6 Plan 2's changes; state.sync does not add these fields either) — phase-level position tracking still works via progress.completed_plans in frontmatter.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-09-09T12:45:10.313Z
Stopped at: Completed 06-02-PLAN.md
Resume file: None
