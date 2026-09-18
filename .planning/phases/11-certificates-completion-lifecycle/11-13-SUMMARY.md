---
phase: 11-certificates-completion-lifecycle
plan: 13
subsystem: api
tags: [nextjs-route-handler, presigned-download, learner-dashboard, denial-parity, react-server-component]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "certificate-service.ts's getOwnCertificateForDownload/certificateDisplayStatus, storage-service.ts's presignCertificateObjectUrl (plan 11-11)"
provides:
  - "Authenticated, denial-parity certificate download route: /api/certificates/[id]/download"
  - "CertificateColumn: a real five-branch learner certificate state replacing enrolment-dashboard-service.ts's CERTIFICATE_DEFERRED"
  - "CertificateSlot: the learner dashboard's certificate card, closing Phase 9's named gap"
affects: [12-support-tickets, 15-launch-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Denial-parity download route (staff predicate first, learner ownership predicate as fallback, every non-success outcome a byte-identical 404) — third instance of the lesson-resources precedent"
    - "Batched-once-per-dashboard-load certificate/completion lookup keyed by enrolmentId:scope, avoiding N+1 on a per-enrolment-card read"

key-files:
  created:
    - "src/app/api/certificates/[id]/download/route.ts"
    - "src/components/learner/CertificateSlot.tsx"
    - "tests/certificate-download-route.test.ts"
    - "tests/certificate-slot.test.ts"
    - "tests/components/certificate-slot.test.tsx"
  modified:
    - "src/server/services/enrolment-dashboard-service.ts"
    - "src/app/(learner)/dashboard/page.tsx"
    - "tests/enrolment-dashboard-service.test.ts"

key-decisions:
  - "deriveCertificateColumn delegates existing-certificate precedence to certificate-service.ts's certificateDisplayStatus rather than re-deriving revoked>flagged>active a second time"
  - "certificate/completionRecord reads batched once per loadLearnerDashboard call (2 extra queries total, not 2 per enrolment) — verified for a 3-enrolment dashboard"
  - "pending-issuance fires on any unsuperseded CompletionRecord with no certificate yet, not gated on certificateIssuanceMode — MANUAL-mode's queue is the literal case the plan names, but under AUTOMATIC mode the reactive issuer creates the certificate in the same transaction as the CompletionRecord, so this branch is otherwise unreachable in practice"

requirements-completed: [CRD-03, CRD-06]

# Metrics
duration: 56min
completed: 2026-09-18
---

# Phase 11 Plan 13: Certificate Download Route & Dashboard Card Summary

**Access-controlled certificate download route with 404-only denial parity, plus a real five-branch `CertificateColumn` replacing Phase 9's `CERTIFICATE_DEFERRED` dashboard placeholder.**

## Performance

- **Duration:** 56 min
- **Started:** 2026-09-18T20:25:32+01:00 (first test commit)
- **Completed:** 2026-09-18T21:21:15+01:00 (last feature commit)
- **Tasks:** 3
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments

- `/api/certificates/[id]/download` — owners and in-scope staff get a 302 to a 60-second presigned URL with `Cache-Control: private, no-store`; every other outcome (wrong owner, unknown id, revoked, missing storage key, unauthenticated) is a byte-identical 404 with an empty body, and no 401/403 is ever returned.
- `enrolment-dashboard-service.ts`'s `certificate` column is a real `CertificateColumn` (`not-complete` / `pending-issuance` / `issued` / `flagged` / `revoked`) instead of a hardcoded `DeferredColumn`, derived by the pure `deriveCertificateColumn` and backed by two batched queries (never one per card).
- `CertificateSlot` fills the learner dashboard's certificate card with UI-SPEC §6.1's copy verbatim; the flagged branch still shows the download link (a flag never withdraws earned access), the revoked branch shows neither link nor reference.

## Task Commits

Each task was committed atomically (Tasks 1 and 2 followed RED → GREEN):

1. **Task 1: `/api/certificates/[id]/download`** — `fea935a` (test, RED) → `825bd88` (feat, GREEN)
2. **Task 2: Replace `CERTIFICATE_DEFERRED` with `CertificateColumn`** — `c6be40d` (test, RED) → `18885d0` (feat, GREEN)
3. **Task 3: Learner-facing certificate card** — `9a56ec5` (feat)

**Doc fix:** `05649d5` (dedupe a duplicated DD-19 header comment block introduced while editing Task 2's file header — caught by re-reading the file post-edit, not a functional change)

_Note: Task 3 had no `tdd="true"` attribute in the plan, so it was implemented directly with its test written alongside._

## Files Created/Modified

- `src/app/api/certificates/[id]/download/route.ts` — the download route (mirrors `lesson-resources/[id]/download/route.ts` structurally)
- `src/components/learner/CertificateSlot.tsx` — the five-branch dashboard card
- `src/server/services/enrolment-dashboard-service.ts` — `CertificateColumn` type, `deriveCertificateColumn`, batched `completionRecord`/`certificate` reads in `loadLearnerDashboard`, wired into `buildCardContext`
- `src/app/(learner)/dashboard/page.tsx` — swaps `DeferredSlot` for `CertificateSlot` on the certificate column only; `tickets` still uses `DeferredSlot`
- `tests/certificate-download-route.test.ts` — 9 behaviors (owner 302, staff 302, not-yours 404, anonymous 404, unknown-id byte-identical 404, revoked 404, flagged-active 302, null-storageKey 404, no-leak assertion)
- `tests/certificate-slot.test.ts` — `deriveCertificateColumn`'s 5 branches (unit) + 5 wiring tests (tickets untouched, cross-learner absence, single-query batching for 3 enrolments, not-complete, D-01 scope matching)
- `tests/components/certificate-slot.test.tsx` — 6 DOM-rendering tests for `CertificateSlot`
- `tests/enrolment-dashboard-service.test.ts` — updated dashboard-store fake to add `completionRecord`/`certificate`; replaced the stale "certificate stays deferred" expectation with `not-complete`/`issued` cases

## Decisions Made

- **`deriveCertificateColumn` never re-derives revoked/flagged/active precedence.** It calls `certificate-service.ts`'s existing `certificateDisplayStatus` (a real, non-type-only import) so the dashboard card and the staff-facing certificate surfaces can never disagree — matching the plan's explicit instruction not to write a second implementation of "flagged beats active."
- **Batched, not per-card, certificate/completion lookup.** `loadLearnerDashboard` issues exactly one `completionRecord.findMany` and one `certificate.findMany` per call, each filtered by `enrolmentId: { in: [...] }` across every enrolment on the dashboard, keyed by `${enrolmentId}:${scope}` on the way back out. Verified directly: a 3-enrolment dashboard fixture asserts both call counts stay at 1 (`tests/certificate-slot.test.ts`, "issues exactly one completionRecord and one certificate query regardless of enrolment count").
- **D-01 scope matching.** The lookup key uses the enrolment's OWN cohort scope (`programmeId ? "PROGRAMME" : "COURSE"`), so a Programme-cohort enrolment's internal per-member-course `CompletionRecord` rows (which `completion-service.ts` also creates) never count toward that enrolment's own certificate state — the same distinction `listPendingIssuance` already applies for the staff queue.
- **`pending-issuance` is not gated on `certificateIssuanceMode`.** The plan's stated behavior ("eligible under MANUAL mode with no certificate yields pending-issuance") is satisfied without an explicit mode check, because under AUTOMATIC mode the reactive issuer creates the `Certificate` row in the same transaction as the `CompletionRecord`, so "completion record exists, no certificate yet" is — in practice — the MANUAL-mode case. This also gives a graceful (rather than misleading) "not-complete"-adjacent state if that invariant is ever violated, instead of a hard failure.
- **Not-complete reuses `DeferredSlot`** with Phase 9's exact original copy ("Certificate — arriving in a future update"), per the plan's explicit instruction to keep that state's copy unchanged.

## Deviations from Plan

None — plan executed as written. The one non-functional adjustment (deduping a comment-merge artifact in `enrolment-dashboard-service.ts`'s header, commit `05649d5`) is documentation-only and is called out above rather than hidden inside a feature commit.

## Issues Encountered

- **Acceptance-criteria greps caught literal substrings inside doc comments**, not just code: the route's header comment originally repeated the strings `fetchCache`, `use cache`, `private, no-store`, and `Response.redirect` in prose describing what the code deliberately does NOT do, which tripped the plan's own `grep -c` acceptance checks (which don't distinguish comments from code). Reworded the comment to convey the same rationale without the literal trigger substrings; re-ran the greps to confirm 0/0/1/0 as required.
- **jest-dom matchers are not configured** in the `components` Vitest project (`tests/components/setup.ts`) — `toBeInTheDocument`/`toHaveAttribute` are unavailable. Rewrote `tests/components/certificate-slot.test.tsx` assertions to the project's established `toBeTruthy()`/`.getAttribute()` convention (matching `tests/components/cohort-roster.test.tsx`).

## User Setup Required

None — no external service configuration required. No packages were installed (`git diff package.json` is empty, satisfying T-11-SC).

## Next Phase Readiness

- CRD-03's "downloadable, access-controlled" half and CRD-06's dashboard-visible flagged/revoked state are both closed for the learner-facing surface.
- Phase 9's `CERTIFICATE_DEFERRED` named gap is fully closed; Phase 12's `TICKETS_DEFERRED` gap is untouched and still renders via `DeferredSlot`, ready for that phase's own plan.
- Full-repo `npm test` (`vitest run --no-file-parallelism`) was kicked off for final confirmation but did not finish within this session's window (large repo, sequential file execution). All plan-scoped verification is independently green and was run directly: the four plan test files (`tests/certificate-download-route.test.ts`, `tests/certificate-slot.test.ts`, `tests/components/certificate-slot.test.tsx`, `tests/enrolment-dashboard-service.test.ts` — 71+ tests combined), `tests/boundary.test.ts` (closure/boundary invariants, 17 tests), `npx tsc --noEmit` (clean), `npx eslint` on every changed file (clean), and `npx next build` (clean; `/api/certificates/[id]/download` listed as dynamic `ƒ`, not static). Recommend a follow-up full-suite confirmation before the phase's own UAT/verification gate, consistent with how prior plans in this phase have flagged long-running full-suite runs.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
