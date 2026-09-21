---
phase: 11
slug: certificates-completion-lifecycle
status: reconciled
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-16
reconciled: 2026-09-19 (second gap pass rows 11-17..11-34 added)
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 11-RESEARCH.md § Validation Architecture (researcher-derived from live test infra).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (`vitest run --no-file-parallelism`) |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run <touched-test-file>` |
| **Full suite command** | `npm test` (runs `vitest run --no-file-parallelism` across `tests/`) |
| **Estimated runtime** | See project history — full suite is `--no-file-parallelism` (serial, real-Postgres integration tests share one database) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <file(s) touched>`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green, AND the two real-Postgres integration tests (`certificate-download.integration.test.ts`, `certificate-concurrency.integration.test.ts`) must actually execute in a Docker-enabled environment — do not assume green from a `Docker-BLOCKED` skip (documented recurring risk in this project's history, e.g. Phase 6/06-09, Phase 6/06-03).
- **Max feedback latency:** N/A — no watch-mode; per-task and per-wave sampling only.

---

## Per-Task Verification Map

*Reconciled 2026-09-19 (plan 11-16 Task 2) against what was actually built across all 16 plans — see each row's Plan/Wave/Task ID and the corresponding `11-NN-SUMMARY.md` for provenance.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-07 T1 | 11-07 | 3 | CRD-01 | T-11-01 | Course certificate issues exactly once when standalone completion passes + issuance enabled; never issued for internally-tracked member-course evidence under a Programme cohort (D-01) | unit + concurrency | `npx vitest run tests/certificate-issuance-service.test.ts -t "idempotent"` | ✅ | ✅ green |
| 11-07 T2 | 11-07 | 3 | CRD-01 | T-11-28 | Programme-cohort enrolment never issues a Course cert for member-course evidence (D-01) | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "programme-cohort"` | ✅ | ✅ green |
| 11-07 T2 | 11-07 | 3 | CRD-02 | T-11-28 | Programme certificate issues only after ALL required Courses + Programme-level rule pass | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "programme completion"` | ✅ | ✅ green |
| 11-16 T1 | 11-16 | 6 | CRD-03 | T-11-09, T-11-70 | Generated PDF downloadable, access-controlled, carries `verificationRef` + minimal fields; storage key follows `randomUUID()`-suffixed convention; short-TTL presigned download | integration (real Postgres + real S3/MinIO) | `npx vitest run tests/certificate-download.integration.test.ts` | ✅ | ✅ green — executed 2026-09-19 against Testcontainers Postgres + real MinIO (2/2 cases: real presigned fetch returns `%PDF` bytes carrying the learner's name; non-owner request denied). Run from PowerShell — see 11-16-SUMMARY.md |
| 11-06 T1 | 11-06 | 2 | CRD-04 | T-11-08 | Public verification by reference reveals only status + approved minimal facts; unknown ref reveals nothing (denial-parity response shape); high-entropy non-truncated reference | unit + route test | `npx vitest run tests/certificate-verification.test.ts` | ✅ | ✅ green |
| 11-11 T2/T3 | 11-11 | 4 | CRD-05 | T-11-49, T-11-52, T-11-53 | Revoke/reissue requires mandatory reason; old/new versions linked via `supersedesId`; audit trail preserved (actor/before-after/reason/outcome) | unit | `npx vitest run tests/certificate-revocation.test.ts` | ✅ | ✅ green |
| 11-07 T2 | 11-07 | 3 | CRD-06 (attendance/lesson half) | T-11-30 | A `CompletionRecord` supersede (attendance/lesson correction) flags the certificate for review and reverts `Enrolment.status` COMPLETED → ACTIVE | unit, reusing existing `attendance-service.test.ts`/`lesson-progress-service.test.ts` fakes with the wrapped `recalculateCompletion` dep | `npx vitest run tests/certificate-issuance-service.test.ts -t "superseded"` | ✅ | ✅ green |
| 11-10 T2 | 11-10 | 4 | CRD-06 (grade half) | T-11-41 | A `grade.overridden` event flags the certificate for review without altering completion state (independent hook — cannot re-derive a verdict) | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "grade correction"` | ✅ | ✅ green |
| 11-01 T3 | 11-01 | 1 | Enrolment.status transition | T-11-04 | `COMPLETED → ACTIVE` is now a legal transition; no other new terminal escapes introduced | unit | `npx vitest run tests/enrolment-transitions.test.ts` | ✅ | ✅ green |
| 11-16 T1 (real); 11-07 T1 (unit) | 11-16; 11-07 | 6; 3 | Concurrency (Pitfall 4) | T-11-01 | Two simultaneous completion triggers for the same enrolment/scope never produce two ACTIVE certificates (partial unique index; loser inserts via `ON CONFLICT DO NOTHING` and reports `already-issued`) | integration (real Postgres); unit | `npx vitest run tests/certificate-concurrency.integration.test.ts` | ✅ | ✅ green — executed 2026-09-19 against real Postgres (2/2: COURSE and PROGRAMME scope, `Promise.all` over two `$transaction`s, exactly one ACTIVE row). NOTE: its FIRST real run FAILED (25P02 — create+catch(P2002) aborts the Postgres transaction; every fake-backed unit test had passed); fixed in commit e28a9d0 (`createMany({skipDuplicates})`) and re-run green. The unit-level lost-race case (11-07 T1) was updated to the new shape |
| 11-03 T1; 11-05 T2 | 11-03; 11-05 | 1; 2 | V5 Input Validation | T-11-12 | `CertificateTemplate.layout` JSON parsed/validated by a pure function rejecting unrecognised element kinds/fields (mirrors `parseCompletionRule`) | unit | `npx vitest run tests/certificate-template-service.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · 🚫 blocked (written and reachable, environment prerequisite unavailable — never reported green)*

### Phase-wide structural invariants (plan 11-16 Task 2, new)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-16 T2 | 11-16 | 6 | D-08 | — | pdf-lib has exactly one importer under `src/` | invariant (AST) | `npx vitest run tests/certificate-phase-invariants.test.ts -t "invariant 1"` | ✅ | ✅ green |
| 11-16 T2 | 11-16 | 6 | D-08 | T-11-06, T-11-17 | No browser-automation package (puppeteer/playwright/playwright-core/chromium) imported anywhere in `src/` | invariant (AST) | `npx vitest run tests/certificate-phase-invariants.test.ts -t "invariant 2"` | ✅ | ✅ green |
| 11-16 T2 | 11-16 | 6 | Pitfall 1 | T-11-08 | `verificationRef` is minted in exactly one place (`certificate-reference.ts`) | invariant (AST) | `npx vitest run tests/certificate-phase-invariants.test.ts -t "invariant 3"` | ✅ | ✅ green |
| 11-16 T2 | 11-16 | 6 | Pitfall 6 | T-11-24 | No route under `src/app/verify/` or `src/app/api/certificates/` exports `dynamic`/`revalidate`/`fetchCache` or declares `'use cache'` | invariant (AST) | `npx vitest run tests/certificate-phase-invariants.test.ts -t "invariant 4"` | ✅ | ✅ green |
| 11-16 T2 | 11-16 | 6 | CRD-04 | T-11-08, T-11-22 | The public verification service's Prisma `select` key set is exactly `{status, learnerName, awardTitle, issuedAt}` | invariant (AST) | `npx vitest run tests/certificate-phase-invariants.test.ts -t "invariant 5"` | ✅ | ✅ green |
| 11-16 T2 | 11-16 | 6 | CAT-08, CRD-05 | T-11-20 | `Certificate` is never hard-deleted anywhere in `src/` | invariant (AST) | `npx vitest run tests/certificate-phase-invariants.test.ts -t "invariant 6"` | ✅ | ✅ green |
| 11-16 T2 | 11-16 | 6 | D-05 | T-11-31 | `Enrolment.status = "COMPLETED"` is written by exactly one module (`certificate-issuance-service.ts`) | invariant (AST) | `npx vitest run tests/certificate-phase-invariants.test.ts -t "invariant 7"` | ✅ | ✅ green |
| 11-17 T1-T2; 11-18 T1-T2 | 11-17; 11-18 | 7; 8 | CRD-03 | T-11-09 | A COMPLETED enrolment holding an ACTIVE certificate keeps its dashboard card and download slot (visible, not operable) | unit + integration | `npx vitest run tests/enrolment-dashboard-service.test.ts tests/learner-dashboard-page.test.ts tests/certificate-download.integration.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-19 T1-T2 | 11-19 | 7 | CRD-03 | — | Top-origin layout renders unmirrored; images fit their box | unit (content-stream positions) | `npx vitest run tests/certificate-pdf-positions.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-20 T1-T3 | 11-20 | 7 | D-02, D-10 | T-11-33, T-11-34 | Existing Course has an edit path for issuance mode and template; archived template does not block unrelated edits | unit + component | `npx vitest run tests/course-actions.test.ts tests/components/course-form.test.tsx` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-21 T1-T2 | 11-21 | 7 | CRD-04, D-09 | T-11-24 | Canvas logo drag is not hijacked by native image drag; public reference-entry page at /verify-certificate without touching /verify | component + route table | `npx vitest run tests/components/certificate-template-editor.test.tsx tests/verify-routes.test.ts tests/components/verify-entry-page.test.tsx` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-22 T1-T2; 11-23 T1-T2 | 11-22; 11-23 | 7; 8 | CRD-01 | T-11-22 | Staff can see automatic vs staff issuance (Issued-by column, filter, Recently issued on the landing page) | unit + component | `npx vitest run tests/certificate-service.test.ts tests/components/certificate-record.test.tsx tests/components/recently-issued-list.test.tsx tests/certificates-landing-page.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-24 T1-T2 | 11-24 | 7 | CRD-06 | T-11-42 | One correction writes one attributable flag; D-01 guard on the superseded branch | unit | `npx vitest run tests/certificate-issuance-service.test.ts tests/attendance-service.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-25 T1-T2 | 11-25 | 8 | CRD-01, CRD-05 | — | Only ACTIVE/COMPLETED enrolments are certificate-eligible; a REVOKED certificate blocks every auto or queue issuance; Reissue supersedes all REVOKED rows | unit + integration | `npx vitest run tests/certificate-issuance-service.test.ts tests/certificate-revocation.test.ts tests/certificate-lifecycle-guards.integration.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-26 T2; 11-29 T1 | 11-26; 11-29 | 8; 10 | CRD-03, D-08 | T-11-SC | Bundled Noto Sans is hash-pinned; Yoruba/Polish/diacritic names render; CJK/Arabic draw ? and never throw; every drawn glyph has an outline in the embedded font program | unit | `npx vitest run tests/certificate-font-asset.test.ts tests/certificate-pdf-unicode.test.ts tests/certificate-pdf-renderer.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-27 T1-T3 | 11-27 | 8 | CRD-05, D-06 | — | COMPLETED keeps the one-live-enrolment slot (widened index); preflight aborts on duplicates; re-enrolment after WITHDRAWN/CANCELLED/TRANSFERRED still works | integration (real Postgres) | `npx vitest run tests/enrolment-live-index.integration.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-28 T1-T2 | 11-28 | 8 | CRD-06 | — | An existing certificate decides the dashboard slot before the completion record (flagged slot survives superseded completion) | unit + component | `npx vitest run tests/enrolment-dashboard-service.test.ts tests/learner-dashboard-page.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-30 T1-T2; 11-31 T1-T2; 11-32 T1-T2 | 11-30; 11-31; 11-32 | 9; 10; 11 | CRD-01, CRD-03, D-03 | T-11-135 | Issuance is database-only inside the caller transaction; PDF rendered and stored after commit; render/storage failure never rolls back the caller write; on-demand recovery in the download route | unit + invariant 8 + integration | `npx vitest run tests/certificate-file-service.test.ts tests/certificate-phase-invariants.test.ts tests/certificate-unicode-file.integration.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |
| 11-34 T1-T2 | 11-34 | 8 | CRD-03 | T-11-118 | Renderer skips undecodable images (WebP/GIF/corrupt); template assets limited to PNG/JPEG | unit | `npx vitest run tests/certificate-pdf-renderer.test.ts tests/template-asset-actions.test.ts` | ✅ | ✅ green (per-plan SUMMARY; second-pass full-suite run recorded in 11-33-SUMMARY) |

---

## Wave 0 Requirements

- [x] `tests/certificate-issuance-service.test.ts` — covers CRD-01, CRD-02, CRD-06 (both halves) — created plan 11-07, extended plan 11-10 (grade correction) and plan 11-11 (idempotency fix regression case)
- [x] `tests/certificate-verification.test.ts` — covers CRD-04 — created plan 11-06
- [x] `tests/certificate-revocation.test.ts` — covers CRD-05 — created plan 11-11, extended plan 11-15
- [x] `tests/certificate-download.integration.test.ts` — covers CRD-03 (real Postgres + real MinIO) — created plan 11-16 Task 1; executed and green (2/2) 2026-09-19
- [x] `tests/certificate-concurrency.integration.test.ts` — covers the Pitfall-4 race, real Postgres — created plan 11-16 Task 1; executed and green (2/2) 2026-09-19 after the 25P02 bug it exposed was fixed (commit e28a9d0)
- [x] `tests/certificate-template-service.test.ts` — covers D-09/D-10's `CertificateTemplate` CRUD + layout parsing — created plan 11-05
- [x] Extended `tests/enrolment-transitions.test.ts` for the new `COMPLETED → ACTIVE` edge — plan 11-01 (the file did not exist beforehand; 11-01 created it)
- [x] Framework install: none — Vitest already configured project-wide; confirmed no phase-11 plan installed a test framework

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Template-editor canvas mechanics (drag/position/style element, save as reusable template) | D-09 | No comparable UI exists anywhere in this codebase to pattern-match; canvas interaction quality is inherently visual | Author a template in the editor, add border/image/signature/each dynamic field, drag to reposition, save, reopen and confirm positions persisted; generate a certificate using it and visually confirm layout matches |
| PDF visual fidelity (fonts, positioning, embedded images) end-to-end | CRD-03, D-08 | Automated tests can assert byte-level structure but not visual correctness | Generate a certificate PDF from a real template and visually inspect against the template's canvas layout |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — confirmed by counting `<task type="...">` vs `<automated>` in all 16 `11-NN-PLAN.md` files: every plan is a 1:1 match (e.g. 11-01: 3/3, 11-07: 2/2, 11-11: 3/3, 11-16: 3/3)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — trivially true given the 1:1 match above
- [x] Wave 0 covers all MISSING references — all seven Wave 0 files exist on disk (see checklist above) and both integration files have executed green against real infrastructure
- [x] No watch-mode flags — no plan in this phase invoked `--watch`
- [x] Feedback latency < N/A (no watch mode; per-task/per-wave sampling) — satisfied by construction
- [x] `nyquist_compliant: true` set in frontmatter — every task across all 16 plans carries an `<automated>` verify (verified by count: tasks = automated blocks in every `11-NN-PLAN.md`). Note this is structural completeness only: Task 3 of plan 11-16 (browser walkthrough) is a blocking human checkpoint whose result is recorded in 11-16-SUMMARY.md, not here

**Approval:** Reconciled 2026-09-19 (plan 11-16 Task 2) against all 15 prior `11-NN-SUMMARY.md` files and the phase's own PLAN.md verify blocks. Both real-infrastructure integration suites executed green this run (Docker was reachable from a PowerShell-launched vitest; they had never run before, and the first run exposed a real transaction-abort bug, since fixed). The ten-step human browser walkthrough (Manual-Only table above) is outstanding at the time of writing. Final phase sign-off is `/gsd:verify-work`'s call, not this document's.
