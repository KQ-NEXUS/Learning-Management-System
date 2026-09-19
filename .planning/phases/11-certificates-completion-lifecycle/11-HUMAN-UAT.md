---
status: complete
phase: 11-certificates-completion-lifecycle
source: [11-VERIFICATION.md]
started: 2026-09-19T21:45:00Z
updated: 2026-09-19T22:30:00Z
---

## Current Test

[testing complete]

## Tests

Each item is real in the code but none makes a ROADMAP success criterion false (verifier: 4/4 verified, 0 blockers). Each needs an explicit accept or fix decision.

### 1. WR-06 — false "being finalized" promise on courses that never issue certificates (verifier: recommend fixing)
expected: A learner who completes a Course with certificates disabled (the default, `certificateEnabled=false`) does not see "Your certificate is being finalized by your instructor". Either accept as-is, or make `deriveCertificateColumn` certificateEnabled-aware.
result: pass
resolution: "fixed by quick task 260919-rxu (commit 619e9f4): certificateEnabled-aware dashboard column, new not-applicable kind, stale copy replaced (learner slot and staff grade entry)"

### 2. CR-05 — a false-alarm review flag cannot be cleared (recorded human deferral)
expected: Staff can resolve a flag ("Confirm it should remain active"). Today no confirm control exists: the enrolment stays ACTIVE and the learner sees "under review" until staff Revoke and Reissue, and every grade correction flags, even ones that do not cross the pass mark. Either keep the deferral or add an audited confirm action.
result: pass
resolution: "accepted: CR-05 stays deferred by human decision (2026-09-19); staff use Revoke and Reissue to resolve a flag"

### 3. WR-05 — owner can still download a superseded (revoked then reissued) certificate PDF
expected: The learner download predicate returns only the current ACTIVE certificate. Today it excludes only REVOKED, so the predecessor is downloadable once superseded (the public verify page still says revoked). Either accept or restrict.
result: pass
resolution: "fixed by quick task 260919-rxu (commit 4c6ee07): learner download only for the current ACTIVE certificate; real Postgres/MinIO integration case added"

### 4. WR-03 — template layout accepts any object-store key as an image `assetKey`
expected: Template images must come from `certificate-template-assets/`. Today a holder of `certificates.manage` who knows another object's key can embed it in every certificate from that template. Either accept (admin-only permission) or restrict the prefix.
result: pass
resolution: "fixed by quick task 260919-rxu (commit 704f79e): template image assetKey must be under certificate-template-assets/"

### 5. WR-02 — issuance audit not written on the caller's transaction; revoke/reissue audit written after commit
expected: Audit rows survive or roll back atomically with the change. Only matters on failure paths. Either accept or fix.
result: pass
resolution: "accepted: WR-02 (audit atomicity) left as-is by human decision (2026-09-19); only matters on failure paths"

## Also noted by the verifier (not decision items)
- Stale copy: `CertificateSlot.tsx:57` still shows "Certificate — arriving in a future update" on in-progress cards (a test locks it in), and `GradeEntryClient.tsx:258` still tells staff "Certificate impact — not yet evaluated (arriving in a future update)" although grade corrections now flag certificates.
- IN-02 (reissue emits both `certificate.issued` and `certificate.reissued`) is deferred to Phase 13, whose dedup criterion covers it.
- UAT caveat: 20/20 results were produced by Claude driving Playwright against an isolated database (marked not user-confirmed); only the PDF visual check and the migration application are recorded as human actions.

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
