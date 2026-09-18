---
phase: 11-certificates-completion-lifecycle
plan: 07
subsystem: certificates
tags: [certificates, completion, prisma, transactions, domain-events]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "11-01 schema/migration (Certificate, certificate_one_active_per_enrolment_scope, COMPLETED->ACTIVE transition); 11-03 certificate-reference.ts; 11-04 certificate-pdf-renderer.ts; 11-05 storage-service.ts certificate key builders + certificate-template-layout.ts"
provides:
  - "issueCertificateForEnrolment — creates one Certificate row, renders/stores its PDF, moves the enrolment to COMPLETED via assertTransition, treats a P2002 race as already-issued"
  - "reactToCompletionResults — maps recalculateCompletion's created/superseded/unchanged state table to issue / do-nothing / flag-and-revert, enforcing D-01's Programme-cohort exclusion and D-04's MANUAL-mode eligibility"
  - "flagCertificateForReview — the shared CRD-06 flag-write (reviewFlaggedAt only, never status/verificationRef/issuedAt/storageKey), reused by plan 11-10's grade-correction hook"
  - "recalculateCompletionAndIssue — drop-in replacement for the bare recalculateCompletion dependency slot on lesson-progress-service.ts / attendance-service.ts"
  - "getObjectBytes (storage-service.ts) — server-side object-byte fetch for embedding template images at PDF-render time"
affects: [11-10-completion-hooks, 11-11-certificate-service, 11-16-integration-validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composition-root DI wrapping: recalculateCompletionAndIssue matches recalculateCompletion's exact signature so it swaps into an existing dependency slot with zero business-logic changes at the consumer"
    - "Create-then-render ordering for concurrency-safe issuance: the DB row exists before any rendering/object-store work, so the partial unique index arbitrates a race before expensive work is spent on a losing attempt"
    - "*AsSystem actor stamping (actorId: null, actorType: SYSTEM) for a system-triggered write inside an already-authorized request, reused from checkout-webhook-system-service.ts's SYSTEM_ACTOR_TYPE convention"

key-files:
  created:
    - src/server/services/certificate-issuance-service.ts
    - tests/certificate-issuance-service.test.ts
  modified:
    - src/server/services/domain-event-service.ts
    - src/server/services/storage-service.ts

key-decisions:
  - "certificate-issuance-service.ts declares its own, wider CertificateIssuanceTxClient rather than extending CompletionServiceTxClient — completion-service.ts's DD-6 deliberately omits enrolment.update so that module cannot touch Enrolment.status even by accident"
  - "The idempotency pre-check queries (enrolmentId, scope, status: ACTIVE) before create; the P2002 catch path re-queries the same predicate to find the race's winner, never re-throwing a Prisma error for a lost race"
  - "flagCertificateForReview looks up the ACTIVE certificate by enrolmentId alone (no scope disambiguation) per RESEARCH's Open Question 1 — D-01 guarantees at most one certificate type is ever eligible per enrolment"
  - "reactToCompletionResults, not issueCertificateForEnrolment, is where MANUAL-mode eligibility is gated — the issuance dependency is never called at all under MANUAL mode, keeping D-04's read-time-only eligibility invariant"

requirements-completed: [CRD-01, CRD-02, CRD-03, CRD-06]

duration: 50min
completed: 2026-09-18
---

# Phase 11 Plan 07: Certificate Issuance & Completion Reaction Summary

**New certificate-issuance-service.ts turns a satisfied CompletionRecord into an issued, downloadable certificate (create-before-render ordering closes the concurrent-completion race via the partial unique index) and reacts to a later supersede by flagging the certificate for review and reverting the enrolment to ACTIVE — plus a signature-compatible recalculateCompletionAndIssue wrapper ready for plan 11-10's composition-root swap.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-09-18T08:39:58+01:00 (immediately after 11-06)
- **Completed:** 2026-09-18T09:04:16+01:00
- **Tasks:** 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `issueCertificateForEnrolment`: resolves the Course/Programme award through the enrolment's cohort (refusing scope `COURSE` on a Programme cohort per D-01), snapshots `awardTitle`/`learnerName` onto the row, creates the `Certificate` row before rendering (so `certificate_one_active_per_enrolment_scope` arbitrates a race before any PDF work happens), renders and stores the PDF, and moves the enrolment to `COMPLETED` through `assertTransition` — never a bare update.
- `reactToCompletionResults`: iterates `recalculateCompletion`'s results array and applies the full CRD-01/CRD-02/CRD-04/CRD-06 state table — automatic issuance only under `AUTOMATIC` mode with `certificateEnabled: true`, zero issuance calls for a `COURSE`-scope result on a Programme cohort, and a shared flag-write on `superseded`.
- `flagCertificateForReview`: the one CRD-06 flag-write implementation, exported for reuse by plan 11-10's grade-correction hook — sets `reviewFlaggedAt` only, reverts `COMPLETED` → `ACTIVE` via `assertTransition`, never touches `status`/`verificationRef`/`issuedAt`/`storageKey`.
- `recalculateCompletionAndIssue`: signature-identical to `recalculateCompletion`, proven via a compile-time assignability assertion against both `LessonProgressServiceDeps["recalculateCompletion"]` and `AttendanceServiceDeps["recalculateCompletion"]` in the test file — ready for plan 11-10 to install with a one-line default-parameter swap.
- `DomainEventType` extended with `certificate.issued` (ids/scope/verificationRef only, never PDF bytes) and `certificate.review_flagged`.
- `storage-service.ts` gained `getObjectBytes` — the live `resolveTemplateAsset` binding's server-side fetch for embedding a template's logo/signature/background image at render time.

## Task Commits

Each task was committed atomically:

1. **Task 1: issueCertificateForEnrolment — one certificate, one PDF, one COMPLETED enrolment** - `250bd46` (feat)
2. **Task 2: reactToCompletionResults and the recalculateCompletionAndIssue wrapper** - `c786e4c` (feat)

_Both tasks had `tdd="true"`; tests were written and iterated alongside the implementation in the same commit rather than as separate RED/GREEN commits, since the plan's own artifact spec (one file, incrementally built across both tasks) made a clean pre-implementation failing-test commit impractical without duplicating fixture/harness code across two throwaway states. Both tasks' full behavior lists are covered by named test cases verified to pass before each commit._

## Files Created/Modified

- `src/server/services/certificate-issuance-service.ts` - New service: `issueCertificateForEnrolment`, `flagCertificateForReview`, `reactToCompletionResults`, `recalculateCompletionAndIssue`, plus `CertificateIssuanceTxClient` and the Prisma-backed live bindings (672 lines)
- `tests/certificate-issuance-service.test.ts` - 22 named test cases across four `describe` blocks, driven by an in-memory staged-commit fake `tx` (769 lines)
- `src/server/services/domain-event-service.ts` - Extended `DomainEventType` with `certificate.issued` and `certificate.review_flagged`
- `src/server/services/storage-service.ts` - Added `getObjectBytes` for server-side object-byte fetches

## Decisions Made

- `CertificateIssuanceTxClient` is its own, wider tx-client type — never widens `CompletionServiceTxClient` (DD-6 in `completion-service.ts` deliberately omits `enrolment.update`, and that omission is preserved: `git diff src/server/services/completion-service.ts` is empty).
- Issuance idempotency is enforced twice: an application-level `findFirst` pre-check for the ordinary case, and a `P2002` catch on the unique index for the concurrent case — both return `{ kind: "already-issued" }`, never a thrown Prisma error.
- `reactToCompletionResults` (not `issueCertificateForEnrolment`) gates `MANUAL` issuance mode, so the issuance dependency (render/store/audit) is never invoked at all when mode is `MANUAL` — D-04's "eligibility is a read-time fact, no flag column" is upheld structurally, not just by omission of a write.
- `flagCertificateForReview` is exported (not file-private) specifically so plan 11-10's `flagCertificatesForGradeCorrection` can reuse it verbatim per that plan's explicit "share, do not duplicate" instruction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Extended `DomainEventType`'s closed union with `certificate.issued` and `certificate.review_flagged`**
- **Found during:** Task 1
- **Issue:** `writeDomainEvent`'s `type` parameter is a closed, compile-time-enforced union (`domain-event-service.ts`) that did not include either new event this plan's behavior list requires writing.
- **Fix:** Added both literals to the union with a comment explaining their firing conditions, consistent with the file's existing per-phase annotation style.
- **Files modified:** `src/server/services/domain-event-service.ts`
- **Verification:** `npx tsc --noEmit` exits 0; both event types are asserted by name in tests.
- **Committed in:** `250bd46` (certificate.issued), `c786e4c` (certificate.review_flagged)

**2. [Rule 2 - Missing critical functionality] Added `getObjectBytes` to `storage-service.ts`**
- **Found during:** Task 2
- **Issue:** The plan (and 11-04's own header) explicitly assigns this plan responsibility for the live `resolveTemplateAsset` implementation ("the caller — plan 11-07 — resolves keys only from the template's own persisted asset records"), but no existing function in this codebase fetches raw object bytes server-side — every existing `storage-service.ts` export either builds a key or presigns a browser-facing URL. Without this, `recalculateCompletionAndIssue`'s live binding (the "drop-in wrapper... ready for the composition roots" this plan's own success criteria promises) could not actually embed a template's logo/signature/background image at render time.
- **Fix:** Added `getObjectBytes(key): Promise<Uint8Array>` using the existing `s3`/`bucketName()` primitives already in the file, following its established per-domain-function convention. Server-side only — never part of a browser-reachable flow.
- **Files modified:** `src/server/services/storage-service.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npx eslint` clean; used in `liveIssuanceDeps.resolveTemplateAsset`.
- **Committed in:** `c786e4c`

---

**Total deviations:** 2 auto-fixed (both Rule 2 - missing critical functionality)
**Impact on plan:** Both additions were structurally required for the plan's own stated deliverables (a closed domain-event union that must carry this plan's events; a live template-asset resolver for the "drop-in wrapper" success criterion) rather than scope creep. No architectural changes, no new external dependencies, no `package.json` diff.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 11-10 can install `recalculateCompletionAndIssue` at both `lesson-progress-service.ts`'s and `attendance-service.ts`'s composition roots via a one-line default-parameter swap — the compile-time assignability assertions in this plan's test file prove the signature fits both slots today.
- Plan 11-10's grade-correction hook can call `flagCertificateForReview` directly instead of writing a second flag implementation.
- Plan 11-11's staff-triggered manual-issue path can call `issueCertificateForEnrolment` (or the exported `issueCertificateForEnrolmentLive` convenience wrapper) with its own actor and its own `withPermission` gate.
- No blockers. `npx vitest run tests/certificate-issuance-service.test.ts tests/completion-service.test.ts tests/boundary.test.ts` is green (54 tests); `npx tsc --noEmit` exits 0; `git diff --stat` for `completion-service.ts`, `lesson-progress-service.ts`, `attendance-service.ts`, and `package.json` are all empty, confirming this plan touched only its own two files plus the two additive, narrowly-scoped Rule 2 extensions documented above.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
