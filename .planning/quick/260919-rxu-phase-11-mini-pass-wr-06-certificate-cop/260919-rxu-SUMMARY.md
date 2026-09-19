---
phase: quick-260919-rxu
plan: 01
subsystem: certificates
tags: [phase-11, wr-06, wr-05, wr-03, dashboard, certificate-download, template-layout]
requirements: [WR-06, WR-05, WR-03]
key-files:
  modified:
    - src/server/services/enrolment-dashboard-service.ts
    - src/components/learner/CertificateSlot.tsx
    - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx
    - src/server/services/certificate-service.ts
    - src/server/services/certificate-template-layout.ts
metrics:
  completed: 2026-09-19
---

# Quick 260919-rxu: Phase 11 mini-pass (WR-06, WR-05, WR-03) Summary

Three verifier findings fixed, each TDD with a RED run first and a separate commit. WR-02 accepted as-is and CR-05 still deferred: no audit/transaction change, no flag-clearing control.

## Commits

- `619e9f4` fix(11): WR-06 hide certificate promise for awards that issue none; replace stale certificate copy
- `4c6ee07` fix(11): WR-05 restrict learner certificate download to the current ACTIVE row
- `704f79e` fix(11): WR-03 confine certificate template image assetKey to certificate-template-assets/
- `2832cf2` chore(11): drop unneeded eslint-disable in template layout parser

## Task 1 - WR-06 (certificateEnabled-aware dashboard + stale copy)

- New `CertificateColumn` kind `not-applicable`; `deriveCertificateColumn` takes required `certificateEnabled`. Only the no-certificate branch consults it: false -> `not-applicable`. An existing certificate row (issued / flagged / revoked) always wins over a disabled flag.
- `loadLearnerDashboard` adds two batched reads to the existing `Promise.all`: `store.course.findMany` (distinct course-cohort `courseId`s) and `store.programme.findMany` (distinct `programmeId`s), each skipped when its id list is empty. Awards keyed `COURSE:<id>` / `PROGRAMME:<id>`; a programme cohort reads the Programme flag, never a member course (D-01). A missing award row is treated as NOT enabled.
- `CertificateSlot`: `not-applicable` renders `null`; `not-complete` is a normal card ("Your certificate will appear here once you have completed all requirements."); `DeferredSlot` import dropped. Other branch copy unchanged.
- `GradeEntryClient` RELEASED line is now "Certificate impact — correcting a released grade flags any active certificate for staff review."
- The three remaining dashboard named-gap strings (Assignments, Results, Support tickets) are untouched.
- RED (against unchanged code, 5 files): 12 failed / 106 passed. Failures were the expected ones: `pending-issuance` returned where `not-applicable` was expected, `course`/`programme` findMany never called, old slot copy / non-empty container, old staff string, page still containing "Certificate". GREEN: 118/118.

## Task 2 - WR-05 (download only for current ACTIVE)

- `getOwnCertificateForDownload`: `row.status === "REVOKED"` -> `row.status !== "ACTIVE"`; not-found and owner checks and order unchanged. Doc comments updated. The route and the staff/scoped path are untouched (404 parity preserved).
- RED: unit SUPERSEDED case failed ("expected row to be null"); the real Postgres/MinIO integration case failed at the SUPERSEDED assertion for the same reason.
- GREEN: certificate-service + certificate-revocation + certificate-download-route: 88/88 (no changes needed to the revocation or route tests). `tests/certificate-download.integration.test.ts` run FOR REAL under Testcontainers: 6/6, including the existing dashboard/G-01 case, which exercises the new course read against real Prisma with a certificateEnabled course. The new integration case also covers REVOKED and flagged-but-ACTIVE still returning.
- The `prisma:error ... E57P01 terminating connection` lines in the integration log are container-teardown noise, not test failures.

## Task 3 - WR-03 (assetKey confinement)

- Layer decision: the pure parser only. `certificate-template-service.ts` already parses on every create/update (save-time) and `certificate-file-service.ts` re-parses the stored layout before every render (read-time); no service, storage-service, seed or default-layout change was needed. The module stays import-free (purity invariant green).
- `parseImageElement` now requires: string; the exported prefix `certificate-template-assets/`; a non-empty remainder; no empty / `.` / `..` segment; no backslash; no control characters. The key is returned unchanged; the error `issue` is the field name "assetKey", never the key.
- Schema stays 1 (narrows a value domain, not the shape). Consequence: a previously saved layout with an out-of-domain key would now fail loudly at the render step (the same failure mode as a typo'd key). The seeded default template has no image element and confirmed uploads always land under `certificate-template-assets/`, so nothing legitimate regresses. `pending-upload` (the editor placeholder) is now also rejected server-side.
- RED: 21 failed (19 parser reject cases + service create + service update); accept cases, empty/whitespace/non-string cases already passed as expected. GREEN: layout, template-service, pdf-renderer, pdf-positions, file-service, boundary: 151/151; issuance-service + phase-invariants: 64/64.

## Final verification

- `npx tsc --noEmit`: clean. `npx eslint` on all changed src and test files: clean (one unused-directive warning fixed in `2832cf2`).
- boundary.test.ts and certificate-phase-invariants.test.ts green (invariants also green alongside others; no timeout).
- `git diff` for package.json, package-lock.json, prisma/, assets/, the download route, certificate-template-service.ts and storage-service.ts is empty. No prisma migrate/db push/db execute, no .env DATABASE_URL, no installs. ROADMAP.md, STATE.md and .planning/config.json not touched.

## Decisions

- `not-applicable` renders nothing (per the user's WR-06 ruling) rather than a neutral card.
- Missing award row is treated as not enabled (never promise a certificate we cannot confirm).
- Award flag is read from the enrolment's own scope (D-01).

## Deviations from Plan

None. Minor: the WR-05 integration test is one `it` covering SUPERSEDED, REVOKED and flagged-but-ACTIVE, rather than two separate cases. The "four named-gap strings" test in learner-dashboard-page.test.ts is now named "remaining named-gap strings" (three).

## Not in this pass

- WR-06's REVOKED+ACTIVE row-selection half (documented in the code comment as a separate item).
- WR-02 accepted; CR-05 still deferred.

## Self-Check: PASSED

All four commits present in `git log`; the SUMMARY's referenced files exist.
