---
phase: 11-certificates-completion-lifecycle
plan: 30
subsystem: certificates
tags: [certificates, issuance, transactions, object-storage, gap-closure, CR-01b, WR-01]
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: certificate-issuance-service with eligibility and revoked-blocked outcomes (11-25), renderer image guard (11-34)
provides:
  - certificate-file-service.ts: post-commit render and store, pending-file registry, ensure-on-demand, bounded never-throwing settle, transaction wrapper
  - Database-only issuance: the caller's transaction writes rows only (certificate row with storageKey null, COMPLETED, audit, event) and registers the id for the post-commit step
  - Invariant 8: the issuance module never imports the renderer or object-store functions and never parses a layout
affects: [11-31 (wires settle at the two composition roots and the download route), 11-29 (font swap lives in the renderer the file service calls), 11-32]
tech-stack:
  added: []
  patterns:
    - "Two-phase issuance: rows in the caller's transaction, file after commit, best effort and bounded"
    - "Pending registry as a module-level WeakMap keyed on the transaction object identity"
    - "Compare-and-set finalisation (updateMany where storageKey null and status ACTIVE)"
key-files:
  created:
    - src/server/services/certificate-file-service.ts
    - tests/certificate-file-service.test.ts
  modified:
    - src/server/services/certificate-issuance-service.ts
    - tests/certificate-issuance-service.test.ts
    - tests/certificate-revocation.test.ts
    - tests/certificate-concurrency.integration.test.ts
    - tests/certificate-download.integration.test.ts
    - tests/certificate-phase-invariants.test.ts
key-decisions:
  - "Two-phase issuance: a render or storage failure (or a P2028 timeout) can only be kept away from the caller's write by moving the work out of the transaction; a try/catch inside the transaction cannot"
  - "Settle timeout 6_000 ms default (overridable through CertificateFileDeps.timeoutMs): the bound is the worst-case latency added to a lesson-complete or attendance click"
  - "Layout parsing moved to the post-commit step, so a corrupt stored layout can no longer abort the caller's write; the no-template outcome still comes from an existence check before any row is written"
  - "A lost compare-and-set orphans the loser's own object (accepted, bounded to a genuine concurrent race; keys are unique per attempt, nothing is overwritten)"
requirements-completed: [CRD-01, CRD-02, CRD-03]
duration: ~50min
completed: 2026-09-19
---

# Phase 11 Plan 30: Two-phase issuance (CR-01b, WR-01) Summary

**Certificate issuance inside a caller's transaction is now database-only; the PDF is rendered and stored after commit by a never-throwing, 6-second-bounded, idempotent file service that can also be invoked on demand.**

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1. certificate-file-service.ts | 63ced0a | `renderAndStoreCertificateFile`, `ensureCertificateFile`, `settlePendingCertificateFiles`, `registerPendingCertificateFile`, `resolveCertificateTemplate`, `runTransactionThenSettleCertificateFiles`, and a live binding to Prisma, the real renderer and the object store. 28 unit tests |
| 2. Two-phase issuance | e72e5b1 | `issueCertificateForEnrolment` no longer renders, stores or parses a layout; `IssueCertificateDeps` and `liveIssuanceDeps` are `{ generateRef, audit, writeEvent }`; invariant 8 added; both integration suites and the revocation fixtures adapted |

## How the mechanism behaves

- Phase A (in the caller's transaction, D-03 preserved): eligibility, revoked-blocked and idempotency checks, template existence check, the row created with `storageKey: null`, the COMPLETED transition (D-05), audit, domain event, then `registerPendingCertificateFile(tx, certificateId)`.
- Phase B (after commit): render from the CERTIFICATE ROW's snapshot (learnerName, awardTitle, issuedAt, verificationRef), store under `buildKey({ certificateId })`, then `updateMany where { id, storageKey: null, status: ACTIVE }`. Every failure is contained as `{ kind: "failed" }` and logged with the certificate id and the error name only.
- Until plan 11-31 wires the composition roots, nothing calls settle after commit, so newly issued certificates simply have no file yet. That is the designed degraded state: rows, statuses, audit and events are correct, and `ensureCertificateFile` produces the file on demand. The tree is consistent and green in that state (no existing unit test depends on a file existing after issuance; the two integration suites that do now settle explicitly).
- `runTransactionThenSettleCertificateFiles` keys on the transaction object identity, so the roots must hand the SAME tx object the transaction body received to the issuance service (no wrapping or proxying). This is documented in the module.

## Verification (RED then GREEN)

- Task 1: the module did not exist, so the new unit file could not have passed before implementation (I did not run it in a failing state; it was written first, then implemented, 28/28 green).
- Task 2, run against the pre-change issuance source with the updated tests in place: 14 tests failed, including
  - the new invalid-layout test: `UnsupportedCertificateLayoutError: Unsupported certificate layout value: "version"` (pre-change issuance parsed the layout inside the caller's transaction);
  - invariant 8: the issuance source imported the renderer and referenced the object-store functions;
  - the rest: `TypeError: deps.renderPdf is not a function` (deps no longer carry render/put), confirming the dependency was really removed rather than merely unused.
  After the refactor all pass.
- Guard replacing the old "rolls back the row when PDF rendering throws" test: issuance has no render dependency (`Object.keys(deps)` asserted to be exactly `audit, generateRef, writeEvent`), and a rollback after issuance leaves no row, no COMPLETED status, no event and nothing registered.
- Unit and boundary suites: `certificate-issuance-service`, `certificate-service`, `certificate-revocation`, `certificate-file-service`, `boundary` all green (in one run alongside invariants 174 passed; invariant 1's whole-src AST walk hit the default 5 s timeout under that parallel load, so `certificate-phase-invariants` was re-run alone and passes 9/9).
- Integration (executed for real, Docker up: Testcontainers Postgres plus MinIO at localhost:9002): `certificate-concurrency.integration.test.ts` and `certificate-download.integration.test.ts` 7/7 green. Concurrency: COURSE and PROGRAMME races still converge on exactly one ACTIVE row with the loser returning already-issued, and the winning row has `storageKey` null (neither transaction rendered). Download: the row is null after commit, the settle produces a real `%PDF` object with the learner's name, `runTransactionThenSettleCertificateFiles` works against real Prisma, and `ensureCertificateFile` re-produces a missing file idempotently.
- `npx tsc --noEmit` exits 0. `git diff package.json package-lock.json` is empty. No install, no migrate/db push/db execute.

## Deviations from Plan

None material. Notes:

- `src/server/services/certificate-service.ts`, `tests/certificate-service.test.ts` and `grade-override-service.ts` needed NO edits: the plan expected removed-deps fallout there, but `certificate-service.ts` only passes `liveIssuanceDeps` through and the service test builds no issuance deps with the removed members. Zero lines touched in those files; tsc confirms.
- Acceptance grep for `registerPendingCertificateFile`: it appears once as the call and once as the import (plus header prose); the call site is unique.
- Two test files (`certificate-issuance-service.test.ts`, `certificate-revocation.test.ts`) have CRLF working-copy line endings; git normalises to LF (`eol=lf`), so committed content is unaffected.

## Known Stubs

None.

## Threat Flags

None: the new module takes only a certificate id, is not a server action, is not permission-gated (reachable only from already-authorised paths per T-11-128), and imports no `next/*`.

## Self-Check: PASSED

- src/server/services/certificate-file-service.ts, tests/certificate-file-service.test.ts: present
- Commits 63ced0a and e72e5b1: present
