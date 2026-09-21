---
phase: 11-certificates-completion-lifecycle
plan: 11
subsystem: api
tags: [certificates, audit, rbac, resource-service, completion-lifecycle]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle (plan 11-07)
    provides: certificate-issuance-service.ts's issueCertificateForEnrolment,
      flagCertificateForReview, and the CertificateIssuanceTxClient shape this
      plan's service builds directly on top of
provides:
  - certificateService.list/get — staff-scoped certificate reads
  - listPendingIssuance — the D-04 MANUAL-mode eligibility queue, computed
    fresh at read time with D-01's Programme-cohort single-row rule applied
  - getOwnCertificateForDownload — the learner ownership predicate the
    download route (plan 11-12+) needs
  - issueCertificateManually / revokeCertificate / reissueCertificate — the
    three audited staff mutations, each compare-and-set guarded
  - certificateDisplayStatus — the one place UI-SPEC §5's tone precedence is
    computed, for the queue/list/detail/dashboard to share
affects: [staff-certificate-ui, certificate-download-route, dashboard-certificate-slot]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Audit-first compare-and-set mutation (grade-override-service.ts's exact shape) applied to Certificate revoke/reissue"
    - "One issuance implementation, many callers: manual issue and reissue both delegate to issueCertificateForEnrolment rather than duplicating render/store/COMPLETED-transition logic"
    - "Never-throwing ownership predicate (lesson-resource-service.ts's getDownloadableResourceForLearner shape) for getOwnCertificateForDownload"

key-files:
  created:
    - src/server/services/certificate-service.ts
    - tests/certificate-service.test.ts
    - tests/certificate-revocation.test.ts
  modified:
    - src/server/services/certificate-issuance-service.ts
    - src/server/services/domain-event-service.ts

key-decisions:
  - "certificateService exposes only list/get from the resource-service factory — create/update/archive are never exported; certificates are created only via issuance and mutated only via the explicit revoke/reissue functions"
  - "issueCertificateManually takes no reason parameter (D-04/UI-SPEC §6.1 — issuing is a forward action, not a correction)"
  - "revokeCertificate and reissueCertificate share one 10-trimmed-character reason minimum and one CertificateChangedError compare-and-set-failure type"
  - "Rule 1 bug fix: issueCertificateForEnrolment's COMPLETED transition is now idempotent when the enrolment is already COMPLETED, so reissuing directly from an ACTIVE certificate (or a second reissue in the same supersede chain) no longer throws IllegalTransitionError on a COMPLETED -> COMPLETED no-op"

patterns-established:
  - "Pattern: certificateDisplayStatus is the single owner of UI-SPEC §5's four-branch status-tone precedence (revoked > flagged > superseded > active) — every future UI surface (queue, issued list, detail page, dashboard slot) must call it rather than deriving tone from status alone"

requirements-completed: [CRD-01, CRD-02, CRD-03, CRD-05, CRD-06]

# Metrics
duration: ~50min
completed: 2026-09-18
---

# Phase 11 Plan 11: Certificate Staff Surface — Read, Manual Issue, Revoke, Reissue Summary

**Staff-facing certificate-service.ts (scoped list/get, D-04's fresh pending-issuance queue, learner ownership predicate) plus three audit-first, compare-and-set-guarded mutations — manual issue, revoke, and reissue — all built on the grade-override-service.ts precedent.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-09-18T17:10:00Z (approx.)
- **Completed:** 2026-09-18T17:59:27Z
- **Tasks:** 3 completed
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- Staff can list/get certificates scoped to their cohort/programme/course grants, with a sibling cohort's certificate structurally absent from another caller's result
- `listPendingIssuance` computes the MANUAL-mode eligibility queue fresh at read time — no denormalized eligibility column — and yields exactly one row for a Programme cohort (the PROGRAMME-scope entry), never one per member course (D-01)
- `getOwnCertificateForDownload` gives a learner access to only their own, non-revoked certificate, returning `null` — never throwing — for every denial reason
- `issueCertificateManually`, `revokeCertificate`, and `reissueCertificate` are audited, compare-and-set-guarded mutations matching the grade-override precedent exactly; reissue preserves the old certificate's history untouched and links the new row via `supersedesId`, including through a two-hop supersede chain

## Task Commits

Each task was committed atomically:

1. **Task 1: Read surface — scoped list/get, pending-issuance evaluator, learner ownership predicate** - `75f6241` (feat)
2. **Task 2: Manual issue and revoke** - `fff10ff` (feat)
3. **Task 3: Reissue — a new credential linked to the old** - `742f95d` (feat)

_No separate plan-metadata commit was made prior to this summary; this SUMMARY.md and the STATE/ROADMAP/REQUIREMENTS updates are committed together below._

## Files Created/Modified

- `src/server/services/certificate-service.ts` - The full staff certificate surface: `certificateService.list/get`, `listPendingIssuance`, `getOwnCertificateForDownload`, `certificateDisplayStatus`, `issueCertificateManually`, `revokeCertificate`, `reissueCertificate`
- `tests/certificate-service.test.ts` - Task 1's nine behaviors (scoping, pending queue, ownership predicate, status precedence)
- `tests/certificate-revocation.test.ts` - Task 2's eleven behaviors (manual issue, revoke) plus Task 3's eleven behaviors (reissue), including the ordering guard and the two-hop chain
- `src/server/services/certificate-issuance-service.ts` - One-line idempotency fix: `issueCertificateForEnrolment`'s COMPLETED transition now skips when the enrolment is already COMPLETED
- `src/server/services/domain-event-service.ts` - Added `certificate.revoked` and `certificate.reissued` to the closed `DomainEventType` union

## Decisions Made

- Only `list`/`get` are exposed from the `createResourceService` factory build; `create`/`update`/`archive` are never part of the exported `certificateService` object, enforced by both a grep gate and a structural test asserting `Object.keys(certificateService)` is exactly `["get", "list"]`
- `issueCertificateManually` and `reissueCertificate` both delegate to `certificate-issuance-service.ts`'s `issueCertificateForEnrolment` — one issuance implementation, three callers total (the reactive path from plan 11-07/11-10, this plan's manual issue, this plan's reissue)
- `revokeCertificate`/`reissueCertificate` share the same `RevocationReasonRequiredError`/`CertificateChangedError` types rather than minting a fourth near-identical error pair, since both need the identical 10-character mandatory-reason and compare-and-set discipline

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `issueCertificateForEnrolment`'s COMPLETED transition threw on a same-state no-op**
- **Found during:** Task 3 (reissue — the "reissuing twice produces a two-hop chain" test case)
- **Issue:** `issueCertificateForEnrolment` unconditionally called `assertTransition(enrolment.status, "COMPLETED", enrolmentId)` before setting `Enrolment.status = "COMPLETED"`. `VALID_TRANSITIONS.COMPLETED` has no self-entry, so calling this function on an enrolment that is already `COMPLETED` — the normal case when reissuing directly from an `ACTIVE` certificate, or reissuing a second time in the same chain — threw `IllegalTransitionError("COMPLETED", "COMPLETED")` instead of treating it as a no-op.
- **Fix:** Wrapped the `assertTransition`/`enrolment.update` pair in a guard that skips both when the enrolment's current status is already `"COMPLETED"`.
- **Files modified:** `src/server/services/certificate-issuance-service.ts`
- **Verification:** `tests/certificate-revocation.test.ts`'s "reissuing directly from an ACTIVE certificate" and "reissuing twice produces a two-hop chain" cases now pass; re-ran `tests/certificate-issuance-service.test.ts` (plan 11-07's own suite) in full — all 33 cases still pass, confirming the reactive/automatic issuance paths (which always start from a non-COMPLETED enrolment) are unaffected.
- **Committed in:** `742f95d` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug fix)
**Impact on plan:** Necessary correctness fix surfaced by Task 3's own acceptance criteria (the two-hop chain case); no scope creep — the fix is a one-line idempotency guard on existing logic, not new behavior.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `certificate-service.ts`'s exported surface (`certificateService`, `listPendingIssuance`, `getOwnCertificateForDownload`, `issueCertificateManually`, `revokeCertificate`, `reissueCertificate`, `certificateDisplayStatus`) is ready for the staff UI (queue, issued list, detail page) and the learner-facing download route/dashboard slot that later plans in this phase build.
- `certificateDisplayStatus` is the one place every future UI surface must call for status tone — do not re-derive tone from `status` alone in a component.
- Full automated verification green: `tests/certificate-service.test.ts` (18), `tests/certificate-revocation.test.ts` (39), `tests/boundary.test.ts` (17), `tests/certificate-issuance-service.test.ts` (33 — unaffected by the Rule 1 fix), `npx tsc --noEmit` exit 0. Full `npx vitest run` was also run: 2599 passed, 0 failures attributable to this plan's changes — all 25 failing suites are pre-existing Docker/testcontainers-unavailable environment limitations already documented in STATE.md, not regressions from this work.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
