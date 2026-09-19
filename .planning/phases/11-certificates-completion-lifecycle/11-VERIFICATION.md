---
phase: 11-certificates-completion-lifecycle
verified: 2026-09-19T20:10:00Z
status: human_needed
score: 4/4 roadmap success criteria verified (0 blockers; 5 open warnings need an accept-or-fix decision)
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial verification. No prior 11-VERIFICATION.md existed."
gaps: []
deferred:
  - truth: "A reissue emits both certificate.issued and certificate.reissued domain events (IN-02), so a naive email drain could send two messages for one reissue"
    addressed_in: "Phase 13"
    evidence: "Phase 13 success criterion 2: 'Retried or replayed events never produce duplicate messages within the same correlation (COM-02)'; Phase 13 goal covers certificate issuance/revocation emails."
human_verification:
  - test: "Decide: accept or fix WR-06 - a learner who completes a Course with certificates DISABLED (the Course default, certificateEnabled=false) sees 'Your certificate is being finalized by your instructor.'"
    expected: "Either the copy is accepted as-is, or a follow-up plan makes deriveCertificateColumn certificateEnabled-aware so no certificate promise is shown for a Course that will never issue one."
    why_human: "Product/UX call. The false promise is observable in code (enrolment-dashboard-service.ts deriveCertificateColumn + CertificateSlot.tsx) but no success criterion mandates the messaging."
  - test: "Decide: accept or fix WR-05 - getOwnCertificateForDownload only refuses REVOKED, so an owner can still download a certificate that was revoked and then superseded by a Reissue"
    expected: "Either accept (the owner already held the file; the public verify page reads 'revoked'), or restrict the learner predicate to the current ACTIVE row."
    why_human: "Security/policy judgement about how long a withdrawn credential file stays reachable by its owner."
  - test: "Decide: accept or fix WR-03 - the template layout parser accepts any non-empty assetKey and the issuance path reads it with getObjectBytes, so a holder of certificates.manage who knows another object's key can embed that object in every certificate rendered from the template"
    expected: "Either accept (certificates.manage is a trusted staff grant) or add a 'certificate-template-assets/' prefix check at parse and read time."
    why_human: "Trust-boundary decision for a privileged role."
  - test: "Decide: accept or fix WR-02 - issuance audit is written on the global client (not the caller's tx) and revoke/reissue audit is written after commit"
    expected: "Either accept, or move audit into the same transaction so a mutation and its audit commit or roll back together."
    why_human: "CRD-05 requires audit history; the current gap is a failure-mode edge (audit write failing after a committed revocation, or an orphan audit row after a rolled-back issuance), not a normal-path defect."
  - test: "Confirm the accepted CR-05 limitation (no way to clear a false-alarm review flag; the enrolment stays ACTIVE and the learner sees 'under review' until staff Revoke + Reissue)"
    expected: "The human decision recorded in 11-DECISIONS.md on 2026-09-19 stands, or a follow-up 'Confirm certificate is valid' action is scheduled."
    why_human: "Already a recorded human scope decision; listed so it is not silently lost. The staff banner still says 'Confirm it should remain active, or revoke it' although no confirm control exists."
---

# Phase 11: Certificates & Completion Lifecycle - Verification Report

**Phase Goal:** Certificates are trustworthy - issued only when earned, publicly verifiable with minimal data, and correctly revisited when underlying results change.
**Verified:** 2026-09-19
**Status:** human_needed
**Re-verification:** No - initial verification

## Verdict

All four ROADMAP success criteria are TRUE in the code. No must-have is FAILED, so there are no blockers and `gaps_found` does not apply. `passed` is withheld because five open items (four review warnings that were declared out of scope, plus the accepted CR-05 deferral) each need an explicit human accept-or-fix decision, and I could not run the real-Postgres/MinIO integration tests myself (hard rule: no database connections). None of the five, in my judgement, defeats a success criterion. Details and reasoning are below so the human can overrule me.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Course certificate issues only once, exactly when standalone completion passes and issuance is enabled; Programme certificate only after all required Courses and Programme-level rules pass (CRD-01, CRD-02) | VERIFIED | `certificate-issuance-service.ts`: eligibility gate (ACTIVE/COMPLETED only, lines 303-305), D-01 guard rejects COURSE scope on a Programme cohort (315-317), `certificateEnabled` gate (347), ACTIVE pre-check (354-359), REVOKED tombstone (370-375), then `createMany({skipDuplicates:true})` against the partial unique index `certificate_one_active_per_enrolment_scope` (migration 20260916162101 line 41). `reactToCompletionResults` only issues on `action==="created"` and only for `AUTOMATIC` + enabled awards; Programme-cohort member-Course results are skipped. Programme verdict comes from `completion-service.ts` (union of all member-course required lessons + attendance + the Programme's own rule, lines 425-470) so partial completion produces no PROGRAMME record and therefore no certificate. COMPLETED is written only inside issuance via `assertTransition`. Wired at both composition roots (`lesson-progress-service.ts:68,804`, `attendance-service.ts:68,816`). Tests: certificate-issuance-service, certificate-service, certificate-phase-invariants pass (see spot-checks). Real-Postgres concurrency test exists (`certificate-concurrency.integration.test.ts`) but was not run by me. |
| 2 | Every issued certificate is downloadable, access-controlled, and carries a unique public verification reference showing only approved minimal facts (CRD-03, CRD-04) | VERIFIED (with WR-05 caveat) | Reference = `CERT-` + 16 random bytes hex (`certificate-reference.ts`), `verificationRef @unique`, printed by the default template layout. Download route (`api/certificates/[id]/download/route.ts`): staff `certificates.view` in scope, else owner-only predicate; every denial is an identical empty 404; 60 s presigned URL with `attachment`, `Cache-Control: private, no-store`; storage key `certificates/{id}/{randomUUID}`. Row exists before file (two-phase); the route produces the file on demand via `ensureCertificateFile` strictly after authorization. Public verify (`certificate-verification-service.ts`) selects exactly `status, learnerName, awardTitle, issuedAt`; unknown ref returns bare `{status:"not_found"}`; no reason/actor/email/user id; no caching wrapper; page has three disjoint branches. Renderer embeds the bundled Noto Sans (`certificate-font.ts`, `outputFileTracingIncludes` in `next.config.ts`, font file present), unsupported code points print "?" and never throw; template assets restricted to PNG/JPEG and undecodable images skipped. Human sign-off on PDFs recorded (11-26, 11-33). Caveat: learner predicate excludes only REVOKED (WR-05, see below). |
| 3 | Authorized staff can revoke and reissue with reason, linking old and new versions while preserving history (CRD-05) | VERIFIED | `certificate-service.ts`: `revokeCertificate` (`certificates.revoke`, trimmed reason >= 10 chars, compare-and-set `updateMany where status ACTIVE`, sets revokedAt/By/Reason, never blanks preserved fields, COMPLETED->ACTIVE via state machine, domain event without the reason, audit with before/after) and `reissueCertificate` (`certificates.issue`, reason >= 10, supersedes old row FIRST so the unique index never sees two ACTIVE, also supersedes stray REVOKED rows, issues through the single issuance implementation, sets `supersedesId`, fresh verificationRef and file). Old row keeps verificationRef/issuedAt/learnerName/awardTitle/revocationReason/storageKey. Public status flips immediately (verify reads the row on every request, SUPERSEDED reads as revoked). CR-04 fix present: automation returns `revoked-blocked` and the manual queue excludes enrolment/scopes holding a REVOKED row. UI: detail page action zone offers Revoke on ACTIVE, Reissue on REVOKED, nothing on SUPERSEDED. Tests: certificate-revocation passes. |
| 4 | A later grade, attendance, or completion correction flags affected certificates for review without silently altering or destroying the original record (CRD-06) | VERIFIED (with CR-05 limitation) | `flagCertificateForReview` sets only `reviewFlaggedAt`, never touches status/verificationRef/issuedAt/storageKey, reverts COMPLETED->ACTIVE through `assertTransition`, writes an audit row (reason, actor) and a domain event; no-op when no ACTIVE certificate. Triggers wired: completion superseded via `recalculateCompletionAndIssue` at lesson-progress and attendance roots (actorId threaded so staff, not SYSTEM, is attributed); grade override via `grade-override-service.ts:109-114` inside the override transaction, flags regardless of whether the pass mark was crossed. Public verification deliberately still shows `active` for a flagged certificate. Nothing is deleted anywhere (no `delete` on Certificate). Limitation: nothing can clear a flag (CR-05, recorded human deferral). |

**Score:** 4/4 roadmap truths verified.

### Plan-level truth that is NOT fully met (not a ROADMAP criterion)

| Plan truth | Status | Evidence |
|------------|--------|----------|
| 11-13: "Phase 9's deferred certificate slot no longer says 'arriving in a future update'" | PARTIAL - WARNING | `CertificateSlot.tsx:57` still renders "Certificate - arriving in a future update" for the `not-complete` branch, and `tests/components/certificate-slot.test.tsx:39` asserts it. The other branches are correct (test line 89 asserts absence there). This is stale copy on an in-progress card now that certificates ship (review IN-05). Same class: `GradeEntryClient.tsx:258` tells staff "Certificate impact - not yet evaluated (arriving in a future update)" on the grade-correction surface even though CRD-06 grade corrections now flag the certificate. Neither breaks a success criterion; the second slightly weakens staff awareness that a correction will flag a certificate. |

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/server/services/certificate-issuance-service.ts` | VERIFIED | Substantive, wired to lesson-progress, attendance, grade-override, certificate-service. |
| `src/server/services/certificate-file-service.ts` | VERIFIED | Two-phase file production, bounded 6 s settle, never throws, wired at both composition roots and the download route. |
| `src/server/services/certificate-service.ts` | VERIFIED | list/get on resource factory, queue, owner download predicate, manual issue, revoke, reissue. |
| `src/server/services/certificate-verification-service.ts` | VERIFIED | Closed select, three outcomes. |
| `src/server/services/certificate-pdf-renderer.ts`, `certificate-font.ts`, `assets/fonts/certificate/NotoSans-Regular.ttf` | VERIFIED | fontkit + whole-font embed (`subset:false`), "?" fallback, image sniffing. |
| `src/app/api/certificates/[id]/download/route.ts` | VERIFIED | Denial parity, presign, no-store. |
| `src/app/verify/[verificationRef]/page.tsx`, `src/app/verify-certificate/*` | VERIFIED | Public, minimal facts. |
| `src/app/staff/certificates/**` (queue, issued list, detail, templates editor) | VERIFIED | Present and wired to services; UAT 20/20. |
| `prisma/migrations/20260916162101_certificates_issuance_mode_and_templates` | VERIFIED | Contains the partial unique index. |
| `prisma/migrations/20260919120000_enrolment_one_live_per_learner_cohort` | VERIFIED (file); applied state not verifiable by me | Preflight abort + create-new-then-drop-old + reversal comments. Application to Neon mirror and main DB is claimed in 11-33-SUMMARY.md by a human-directed action; I did not connect to any database. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| lesson-progress / attendance roots | issuance | `recalculateCompletionAndIssue` as the `recalculateCompletion` dep | WIRED |
| both roots | file step | `runTransactionThenSettleCertificateFiles` on the same tx object | WIRED |
| grade-override | issuance | `flagCertificatesForGradeCorrection` in the override tx | WIRED |
| certificate-service manual issue / reissue | issuance | `issueCertificateForEnrolment` (single implementation) + `runSettled` | WIRED |
| download route | file step | `ensureCertificateFile` after both authorization predicates | WIRED |
| learner dashboard | certificate state | batched certificate read + `certificateDisplayStatus` | WIRED |
| completed enrolment | one-live index | migration 20260919120000 | WIRED (file) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Public verify page | learnerName/awardTitle/issuedAt | `prisma.certificate.findUnique` with closed select | Yes | FLOWING |
| Dashboard certificate slot | certificate column | batched `certificate.findMany` + `completionRecord.findMany` | Yes | FLOWING |
| PDF | fields | the Certificate row's own snapshot (not live Course/User) | Yes | FLOWING |
| Staff lists/detail | rows | `certificateService.list/get` -> Prisma | Yes | FLOWING |

### Behavioral Spot-Checks (read-only, no database)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase structural invariants | `vitest run tests/certificate-phase-invariants.test.ts` (alone) | 9/9 passed | PASS |
| Issuance, service, revocation, verification, download route, unicode PDF, file service | `vitest run` on those 7 files together with the invariants file | 211/212 passed; 1 failure was a 5000 ms default timeout on the invariants file's `pdf-lib has exactly one importer` test (a filesystem scan that took 5164 ms under concurrent load); it passes in isolation | PASS (see flakiness note) |
| Type check | `npx tsc --noEmit` | no output, clean | PASS |
| Real-Postgres/MinIO integration set (concurrency, download, unicode-file, lifecycle-guards, enrolment-live-index) | not run | Forbidden by hard rule (no DB connections) | SKIP - relies on prior recorded runs (11-16, 11-33 SUMMARYs, 11-VALIDATION.md) |

Flakiness note (warning): the `certificate-phase-invariants` scan test runs at 5-5.4 s per invocation against Vitest's 5000 ms default per-test timeout, so it can fail on a loaded machine. It is not a product defect but could produce a false red in CI.

### Probe Execution

No probe scripts declared or found (`scripts/*/tests/probe-*.sh`). Step 7c: not applicable.

### Requirements Coverage

Every requirement ID appearing in any PLAN frontmatter (all 34 plans) is one of CRD-01..CRD-06; all six are defined in REQUIREMENTS.md (lines 113-118, marked Complete in the traceability table at lines 269-274). No plan references an ID absent from REQUIREMENTS.md, and REQUIREMENTS.md maps no additional ID to Phase 11, so there are no orphaned requirements.

| Requirement | Claimed by plans | Status | Evidence |
|-------------|------------------|--------|----------|
| CRD-01 | 11-01, 07, 08, 10, 11, 14, 16, 20, 22, 23, 25, 30, 31, 32 | SATISFIED | Truth 1: idempotent, index-arbitrated, enabled-gated, references enrolment; rule version carried by the CompletionRecord it derives from |
| CRD-02 | 11-01, 07, 08, 10, 11, 14, 16, 20, 22, 23, 25, 30, 32 | SATISFIED | Truth 1: Programme scope only from the PROGRAMME CompletionRecord; D-01 blocks Course certs on Programme cohorts |
| CRD-03 | 11-02..05, 07..09, 11..13, 15..21, 26, 28..34 | SATISFIED | Truth 2: generated PDF, unique random ref, owner/staff-only download, stable per stored key |
| CRD-04 | 11-03, 06, 16, 21, 25 | SATISFIED | Truth 2: closed-select public lookup |
| CRD-05 | 11-01, 11, 15, 16, 25, 27, 32, 33 | SATISFIED (WR-02 caveat) | Truth 3 |
| CRD-06 | 11-01, 07, 10, 11, 13, 15, 16, 24, 27, 28, 32, 33 | SATISFIED (CR-05 caveat) | Truth 4 |

### Code-review disposition (11-REVIEW.md) as found in the code

| Item | Claimed | Observed in code |
|------|---------|------------------|
| CR-01 non-WinAnsi text aborts caller | Fixed | Confirmed: Unicode font + "?" fallback; render moved out of the transaction |
| CR-02 WebP/GIF assets | Fixed | Confirmed: PNG/JPEG only at presign, confirm and inspector `accept`; renderer sniffs bytes |
| CR-03 non-ACTIVE enrolment issuance throws | Fixed | Confirmed: `not-eligible` outcome, queue filtered |
| CR-04 revoked cert silently reinstated | Fixed | Confirmed: `revoked-blocked` and queue exclusion; reissue clears stray REVOKED rows |
| CR-06 index freed by COMPLETED | Fixed | Migration present and correct; live application not independently verifiable |
| WR-01 render inside caller tx | Fixed | Confirmed: two-phase issuance |
| CR-05 unclearable false-alarm flag | Deferred by human | Confirmed still open, recorded in 11-DECISIONS.md |
| WR-02, 03, 05, 06 (partly), 07, 08, 09, 10; IN-01..IN-06 | Out of scope | Spot-confirmed still open: WR-02 (audit outside tx, `certificate-issuance-service.ts:468`, `certificate-service.ts:619,717`), WR-03 (no `startsWith`/key-domain check in layout parser), WR-04 (`reactToCompletionResults` still discards non-issued outcomes at line 681), WR-05 (`certificate-service.ts:449`), WR-06 (`deriveCertificateColumn` comment states it is out of scope), IN-03 (verify lookup only trims), IN-05 (stale copy) |

### Do the deferred / out-of-scope items undermine a success criterion?

Judged honestly, one by one:

- **CR-05 (flag cannot be cleared).** SC4 requires flagging without silent alteration or destruction. That is met. What is not met is any way to *resolve* a review short of destroying and recreating the credential. It is a workflow dead end and the detail-page banner text ("Confirm it should remain active, or revoke it") promises an action that does not exist. Because it is a recorded human decision consistent with a locked UI decision (no Clear-flag control), I do not treat it as a gap, but it is the most product-significant limitation in the phase and could become real operational pain: every grade correction flags, including corrections that do not cross the pass mark.
- **WR-06 (learner told a certificate is "being finalized" for a Course with certificates disabled).** `Course.certificateEnabled` defaults to false (`schema.prisma:571`), so this is the mainstream case, not an edge. It does not issue anything wrongly and no success criterion covers messaging, but it tells learners something false on the trust-focused surface. Recommend fixing.
- **WR-05.** A revoked-then-reissued predecessor remains downloadable by its own owner. The public page correctly says revoked. Low exposure (owner-only, id needed).
- **WR-03.** Privileged-role cross-object read into a certificate PDF. Real, but requires `certificates.manage` plus a known key.
- **WR-02.** Failure-mode audit ordering; does not affect normal-path behaviour.
- **WR-04.** Only reachable if no default template exists; the default template cannot be archived (`DefaultTemplateRequiredError`), so practically unreachable after seeding.
- **IN-02** is deferred to Phase 13 (dedup criterion).

None of these makes any of the four success criteria false in the codebase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/learner/CertificateSlot.tsx` | 57 | Stale "arriving in a future update" copy | Warning | Contradicts shipped feature; test locks it in |
| `src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx` | 258 | Stale "Certificate impact - not yet evaluated" | Warning | Staff not told a correction will flag the certificate |
| `src/app/staff/certificates/issued/[id]/page.tsx` | 156-158 | Banner promises "Confirm it should remain active" with no such control | Warning | Tied to CR-05 |
| `tests/certificate-phase-invariants.test.ts` | 94 | Filesystem-scan test near 5000 ms timeout | Warning | Possible false red under load |
| Debt markers `TBD/FIXME/XXX` | - | Not searched exhaustively across all 60+ files; none were encountered in the files I read | Info | - |

### Human Verification Required

The five decision items are listed in the frontmatter `human_verification` block. Everything that genuinely needs a human eye (PDF glyphs for Yoruba/Polish/CJK, template editor, learner and staff flows) already has recorded human or browser sign-off (11-26, 11-33, UAT 20/20). Caveat on UAT: its results were produced by Claude driving Playwright against an isolated database and are marked "not user-confirmed"; only the PDF visual check and the migration application are recorded as human actions.

### Gaps Summary

No blocking gaps. The phase goal is achieved in code: issuance is gated, idempotent and database-arbitrated; public verification discloses four fields; revoke/reissue is audited and linked with history preserved; grade, attendance and completion corrections flag rather than mutate. Remaining items are five explicit accept-or-fix decisions (WR-06 recommended to fix; CR-05 already a recorded deferral) and the fact that I could not independently re-run the real-database integration tests or confirm the migration was applied to the shared databases.

---

_Verified: 2026-09-19_
_Verifier: Claude (gsd-verifier)_

## Human decisions and follow-up (recorded 2026-09-19 by the orchestrator, after this report)

The five human-verification items were decided by the user: **fix** WR-06 (with the two stale-copy lines), WR-05 and WR-03 — done in quick task 260919-rxu (commits 619e9f4, 4c6ee07, 704f79e; each RED-then-GREEN, real Postgres/MinIO integration case for WR-05); **accept** WR-02; **keep CR-05 deferred**. See 11-HUMAN-UAT.md (5/5 resolved). This verifier-written report is otherwise unchanged; its frontmatter status is left as written by the verifier.
