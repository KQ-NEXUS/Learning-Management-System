---
phase: 11
slug: certificates-completion-lifecycle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-16
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

*Populated by the planner once PLAN.md task IDs exist. Requirement → test coverage is pre-mapped below; the planner assigns each row to its owning Task ID.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CRD-01 | — | Course certificate issues exactly once when standalone completion passes + issuance enabled; never issued for internally-tracked member-course evidence under a Programme cohort (D-01) | unit + concurrency | `npx vitest run tests/certificate-issuance-service.test.ts -t "idempotent"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CRD-01 | — | Programme-cohort enrolment never issues a Course cert for member-course evidence (D-01) | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "programme-cohort"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CRD-02 | — | Programme certificate issues only after ALL required Courses + Programme-level rule pass | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "programme completion"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CRD-03 | Information Disclosure (storage key predictability) | Generated PDF downloadable, access-controlled, carries `verificationRef` + minimal fields; storage key follows `randomUUID()`-suffixed convention; short-TTL presigned download | integration (real Postgres + real S3/MinIO) | `npx vitest run tests/certificate-download.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CRD-04 | Information Disclosure (verificationRef enumeration) | Public verification by reference reveals only status + approved minimal facts; unknown ref reveals nothing (denial-parity response shape); high-entropy non-truncated reference | unit + route test | `npx vitest run tests/certificate-verification.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CRD-05 | Elevation of Privilege (template-editor permission gap) | Revoke/reissue requires mandatory reason; old/new versions linked via `supersedesId`; audit trail preserved (actor/before-after/reason/outcome) | unit | `npx vitest run tests/certificate-revocation.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CRD-06 (attendance/lesson half) | — | A `CompletionRecord` supersede (attendance/lesson correction) flags the certificate for review and reverts `Enrolment.status` COMPLETED → ACTIVE | unit, reusing existing `attendance-service.test.ts`/`lesson-progress-service.test.ts` fakes with the wrapped `recalculateCompletion` dep | `npx vitest run tests/certificate-issuance-service.test.ts -t "superseded"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CRD-06 (grade half) | — | A `grade.overridden` event flags the certificate for review without altering completion state (independent hook — cannot re-derive a verdict) | unit | `npx vitest run tests/certificate-issuance-service.test.ts -t "grade correction"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Enrolment.status transition | — | `COMPLETED → ACTIVE` is now a legal transition; no other new terminal escapes introduced | unit | `npx vitest run tests/enrolment-transitions.test.ts` (extend existing file if present) | Check — may already exist | ⬜ pending |
| TBD | TBD | TBD | Concurrency (Pitfall 4) | — | Two simultaneous completion triggers for the same enrolment/scope never produce two ACTIVE certificates (partial unique index + P2002 handling) | integration (real Postgres) | `npx vitest run tests/certificate-concurrency.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | V5 Input Validation | — | `CertificateTemplate.layout` JSON parsed/validated by a pure function rejecting unrecognised element kinds/fields (mirrors `parseCompletionRule`) | unit | `npx vitest run tests/certificate-template-service.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/certificate-issuance-service.test.ts` — covers CRD-01, CRD-02, CRD-06 (both halves)
- [ ] `tests/certificate-verification.test.ts` — covers CRD-04
- [ ] `tests/certificate-revocation.test.ts` — covers CRD-05
- [ ] `tests/certificate-download.integration.test.ts` — covers CRD-03 (real Postgres + real MinIO)
- [ ] `tests/certificate-concurrency.integration.test.ts` — covers the Pitfall-4 race, real Postgres
- [ ] `tests/certificate-template-service.test.ts` — covers D-09/D-10's `CertificateTemplate` CRUD + layout parsing
- [ ] Extend `tests/enrolment-transitions.test.ts` (or wherever `VALID_TRANSITIONS` is currently tested) for the new `COMPLETED → ACTIVE` edge
- [ ] Framework install: none — Vitest already configured project-wide

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Template-editor canvas mechanics (drag/position/style element, save as reusable template) | D-09 | No comparable UI exists anywhere in this codebase to pattern-match; canvas interaction quality is inherently visual | Author a template in the editor, add border/image/signature/each dynamic field, drag to reposition, save, reopen and confirm positions persisted; generate a certificate using it and visually confirm layout matches |
| PDF visual fidelity (fonts, positioning, embedded images) end-to-end | CRD-03, D-08 | Automated tests can assert byte-level structure but not visual correctness | Generate a certificate PDF from a real template and visually inspect against the template's canvas layout |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < N/A (no watch mode; per-task/per-wave sampling)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
