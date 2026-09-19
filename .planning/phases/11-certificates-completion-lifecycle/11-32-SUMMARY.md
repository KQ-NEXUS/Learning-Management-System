---
phase: 11-certificates-completion-lifecycle
plan: 32
subsystem: certificates
tags: [certificates, integration-tests, testcontainers, minio, gap-closure, CR-01, CR-03, CR-04, CR-06]
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: plans 11-25 (eligibility, revoked-blocked, reissue supersede-all), 11-27 (widened enrolment index), 11-29 (Unicode font), 11-30/11-31 (two-phase issuance, settle wiring, on-demand recovery), 11-34 (image guard)
provides:
  - Real Postgres + real MinIO proof of Unicode certificate production after commit and of failure containment (CR-01, CR-01b)
  - Real Postgres proof of the CR-03, CR-04 and CR-06 lifecycle guards including the legacy two-REVOKED reissue
  - Three evidence PDFs (Yoruba, Polish, CJK names) for the human visual check in plan 11-33
affects: [11-33 (human visual check reads the evidence PDFs)]
tech-stack:
  added: []
  patterns:
    - "Failure injection through createCertificateFileService deps (renderPdf / putObject / timeoutMs) against the container database, with a marker row written by the same transaction body to prove the caller's write survives"
    - "createCertificateService built over the container Prisma client with a permissive createTestWithPermission and a no-op settle, so revoke / reissue / manual issue run with real transactions"
key-files:
  created:
    - tests/certificate-unicode-file.integration.test.ts
    - tests/certificate-lifecycle-guards.integration.test.ts
  modified: []
key-decisions:
  - "Evidence PDFs are left untracked (the plan says to keep them for the human, not to commit them); path reported below"
  - "Scenario A uses the LIVE wrapper, live settle and liveIssuanceDeps (bound to the @/server/db singleton, which reads the container DATABASE_URL); failure-injection scenarios use createCertificateFileService with injected deps"
requirements-completed: [CRD-01, CRD-02, CRD-03, CRD-05, CRD-06]
duration: ~40min
completed: 2026-09-19
---

# Phase 11 Plan 32: Real-infrastructure proof of the second-pass criticals Summary

**Two Testcontainers-Postgres suites (one also against the live MinIO) now prove, with real transactions and real rows, that Unicode-named certificates are produced after commit, that render/store/timeout failures never break the caller's write, and that the CR-03, CR-04 (including the legacy two-REVOKED Reissue) and CR-06 guards hold.**

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1. Unicode names, post-commit files, failure containment | d687bb6 | `tests/certificate-unicode-file.integration.test.ts`, 12 tests, all green |
| 2. CR-03 / CR-04 / CR-06 lifecycle guards | 97a4714 | `tests/certificate-lifecycle-guards.integration.test.ts`, 12 tests, all green |

No source was changed (`git diff --stat -- src package.json package-lock.json` is empty).

## What each suite covers

**certificate-unicode-file (real Postgres + real MinIO at localhost:9002)**
- Scenario A (live wrapper, live settle, `liveIssuanceDeps`): "Adébáyọ̀ Ṣolá", "Ọlọ́run Ẹlẹ́gbẹ́", "Łukasz Żółć", "François Müller-Ñandú" issue, the row is ACTIVE, the enrolment COMPLETED, `storageKey` set, the object read back from MinIO starts with `%PDF`, and the text recovered through the ToUnicode-aware reader equals the NFC name. "山田 太郎" and "محمد" issue and store a PDF whose drawn name is `?? ??` and `???` (accepted limitation), while the row keeps the real name.
- Scenario B: a throwing renderer and a throwing object-store put each leave the wrapper resolved, the certificate row, the COMPLETED enrolment and a marker row written by the SAME transaction body committed, `storageKey` null. `ensureCertificateFile` then produces the file, and a second call returns the same key. The failure log carries only the certificate id and the error name (asserted with a learner name embedded in the error message).
- Scenario C: a renderer that never resolves, with `timeoutMs: 400`, lets the wrapper resolve well inside 4 s with the row file-less; a later ensure completes it.
- Scenario D: an invalid stored layout still commits the row, COMPLETED and the marker (file step fails contained, `storageKey` null, one log entry); a WebP logo renders a PDF with the text and zero image XObjects, and a valid JPEG control keeps exactly one image.

**certificate-lifecycle-guards (real Postgres, real `runInTransaction`, `createCertificateService` with a permissive `withPermission` and the real staff user)**
- CR-03: WITHDRAWN and PENDING_PAYMENT enrolments with a satisfied record on an AUTOMATIC course: `reactToCompletionResults` resolves, no certificate, status unchanged, and the caller's marker write in the same transaction commits; `issueCertificateForEnrolment` returns `not-eligible`. MANUAL queue lists the ACTIVE enrolment and omits the WITHDRAWN one.
- CR-04: issue, revoke, undo (`superseded`), redo (`created`) leaves exactly one REVOKED row, no ACTIVE row and an ACTIVE enrolment; `revoked-blocked` for the system and for a staff actor; `reissueCertificate` then yields one ACTIVE row linked by `supersedesId`, the old row SUPERSEDED, enrolment COMPLETED. On a MANUAL course the revoked enrolment is not in the queue and manual issue returns `revoked-blocked`. The flag path is a no-op for an enrolment holding only a REVOKED row (no flag, no audit row).
- Legacy two-REVOKED: rows A and B seeded directly; Reissue from B creates exactly one ACTIVE row (`supersedesId` = B), A and B both SUPERSEDED, enrolment COMPLETED.
- CR-06: after issuance a second ACTIVE enrolment for the same learner and cohort fails P2002 (also after the revoke returned the enrolment to ACTIVE); revoke and the CRD-06 flag reversal both succeed and leave exactly one live enrolment; re-enrolment after WITHDRAWN still works (REG-03).

## Pre-fix failure modes (T-11-136)

The new APIs (file service, settle wrapper, `not-eligible` / `revoked-blocked` outcomes) do not exist in the pre-fix tree, so these files cannot compile there and an old tree was not checked out. The failures below are the ones the earlier plans recorded against the pre-fix source:

| Case | Pre-fix failure, as recorded |
|------|------------------------------|
| Unicode names (Scenario A) | 11-29 RED: 14 of 20 tests failed with pdf-lib `WinAnsi cannot encode "ọ" (0x1ecd)` (likewise `"Ł"`, `"山"`, combining dot below), thrown inside the caller's transaction so nothing committed |
| Containment, invalid layout (B, C, D) | 11-30: PDF work ran inside the caller's transaction; the invalid-layout test failed with `UnsupportedCertificateLayoutError` inside the transaction; 14 unit failures; `deps.renderPdf is not a function` after the dependency was removed |
| WebP logo (D) | 11-34: 5 of 21 renderer tests failed (WebP, GIF, corrupt PNG/JPEG, empty) with "SOI not found in JPEG" and similar |
| CR-03 | 11-25: `IllegalTransitionError` aborted the caller's transaction; 4 pending-queue status omissions; 12 unit failures |
| CR-04 undo/redo, revoked-blocked, legacy two-REVOKED | 11-25: 9 unit failures; a new ACTIVE certificate appeared and the enrolment returned to COMPLETED; the supersede-all step shown load-bearing |
| CR-06 | 11-27: 6 of 10 real-Postgres tests failed without the migration (duplicate ACTIVE insert succeeded, reversal then failed P2002) |

One extra mutation check was run in this plan: temporarily neutralising STEP 1b of `reissueCertificate` (the supersede-all-REVOKED update, in `certificate-service.ts`) made exactly one test fail, the legacy two-REVOKED case, with `Reissue could not produce a new certificate (outcome: revoked-blocked)`; the file was restored with `git checkout -- <file>` and `git diff --stat -- src` is empty afterwards. This shows the integration suite really can fail against the pre-fix behaviour, not just the unit suites.

## Verification (all executed for real; Docker up, Testcontainers `postgres:16-alpine`, live MinIO at localhost:9002)

- `certificate-unicode-file.integration.test.ts`: 12/12 (run once with `CERTIFICATE_EVIDENCE_DIR` set)
- `certificate-lifecycle-guards.integration.test.ts`: 12/12
- `enrolment-live-index.integration.test.ts`: 10/10
- `certificate-concurrency.integration.test.ts`: 2/2
- `certificate-download.integration.test.ts`: 5/5
- `npx tsc --noEmit` exits 0. `git diff package.json package-lock.json` is empty. No install, no `prisma migrate` / `db push` / `db execute` was run by hand. The only migrate call is the existing `startTestDatabase()` harness (`migrate deploy` against the throwaway container, DATABASE_URL overridden; its output shows the container datasource `localhost:<random port>`). Both files also assert `process.env.DATABASE_URL === testDb.url` in `beforeAll` before any dynamic import; the remote Neon database in `.env` was never contacted.
- Nothing was skipped, `.skip`ed, `.todo`d or faked.

## Evidence for plan 11-33 (untracked, for the human visual check)

`C:\Users\disuk\Learning-Management-System\.planning\phases\11-certificates-completion-lifecycle\11-32-evidence\`
- `yoruba-certificate.pdf` ("Ọlọ́run Ẹlẹ́gbẹ́")
- `polish-certificate.pdf` ("Łukasz Żółć")
- `cjk-certificate.pdf` ("山田 太郎", expected to show `?? ??` by design)

These are produced by re-running the unicode suite with `CERTIFICATE_EVIDENCE_DIR=.planning/phases/11-certificates-completion-lifecycle/11-32-evidence`. Synthetic names only. They were deliberately not committed (the plan says to keep them for the human check and commit nothing else generated).

## Deviations from Plan

None - the plan was executed as written. Both suites passed on their first run; the extra mutation check above was added to confirm the suites are able to fail. No source defect was found in earlier plans' work.

## Known Stubs

None.

## Threat Flags

None: tests only; T-11-134 to T-11-136 and T-11-SC mitigated as described above.

## Self-Check: PASSED

- tests/certificate-unicode-file.integration.test.ts: FOUND
- tests/certificate-lifecycle-guards.integration.test.ts: FOUND
- Evidence PDFs (3): FOUND
- Commits d687bb6, 97a4714: FOUND
