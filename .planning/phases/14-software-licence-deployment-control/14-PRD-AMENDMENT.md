# Phase 14 PRD and PXR Amendment Record

Tracked record of every edit made to the product documents by plan 14-20 (decision D-08a). The PRD and PXR live under `docs/reference/`, which is gitignored (the `reference/` rule in `.gitignore`), so git cannot show those diffs. This table is the reviewable copy: owners can read it, check each row against their own copy of the documents and carry the amendment to wherever those documents are maintained.

The old text below quotes the retired wording on purpose; `tests/licence-wording.test.ts` deliberately does not scan this file.

Every row implements the owner decisions D-06, D-07 and D-08: after the grace period the deployment runs in restricted continuity mode. Blocked: new enrolments, new checkout sessions, publishing and content changes, staff and permission changes, settings changes. Continuing: coursework, progress recording, submissions, assessment, grading, certificate issuance, sign-in and security administration, payment webhooks, refunds and reversals, data export, licence activation, transactional email and in-product notifications. A payment initiated before the restriction completes and receives its entitlement.

| Document | Section | Old text (abridged to one line) | New text (abridged to one line) |
| --- | --- | --- | --- |
| PRD | 1.2 Revision history, new row 5 | Rows 1 to 4 only; row 2 mentions "expiry/read-only controls" (left unedited as history) | Row 5, 1 Oct 2026, "Amendment (user-directed, Phase 14)": post-grace state is restricted continuity mode; grading, certificates, refunds, webhooks and exports continue; new checkout blocked; in-flight payments complete; the commercial contract controls any remaining discrepancy |
| PRD | 18.2 states table | Row "Expired / read-only": block publishing, payment confirmation, new enrolment activation, grading/certificate changes, staff/permission and settings changes | Row "Restricted continuity mode (after the grace period)": application-level mode, never a database-wide switch; blocked and always-allowed lists as above; data preserved and nothing deleted |
| PRD | 18.3 LIC-05 | "enforce the configured restricted/read-only state server-side and in the UI" | "enforce the configured restricted continuity mode server-side and in the UI" |
| PRD | 18.3 LIC-08 | "Read-only restrictions MUST preserve the records and permitted export/data-access route" | "Restricted continuity mode MUST preserve the records and permitted export/data-access route" |
| PRD | 18.6 post-expiry row | "Use read-only restriction and no deletion" | "Use restricted continuity mode and no deletion" |
| PRD | 19.4 Software licence interaction | Expired/read-only state blocks payment confirmation, refund initiation/recording and new enrolment activation for every method | Webhooks, reconciliation, refunds, reversals and disputes stay operational; payment initiated before the restriction instant may complete; new checkout sessions blocked; manual confirmation only for an order created before the restriction; evidence never deleted |
| PRD | 19.5 End-to-end test matrix | "... refund; expired-licence restriction." | "... refund; restricted-continuity-mode behaviour (new checkout blocked, in-flight payment completes, refund and webhook operational) and expiry during an in-flight payment." |
| PXR | 11.1 state row | Row "Expired / read-only": mutations blocked; learner access is the approved post-expiry policy | Row "Restricted continuity mode": blocked mutations refused server-side and in the UI with a precise message; grading, certificates, refunds, webhooks, exports and licence activation continue; existing enrolments continue learning |
| PXR | 11.3 matrix header | Fourth column "Expired / read-only" | Fourth column "Restricted continuity mode" |
| PXR | 11.3 row: view records and CSV export | "Allowed only to the extent explicitly retained by data-access/export policy" | "Allowed under existing scope and permissions, including permitted CSV export and the data export route" |
| PXR | 11.3 row: confirm payment, activate new enrolment, manage refund | "Blocked unless approved policy explicitly states otherwise" | Refunds, reversals and webhooks allowed; manual confirmation only for an order created before the restriction; new checkout blocked; in-flight payment completes |
| PXR | 11.3 row: attendance, grade, release, override, certificate issue, revoke, reissue | "Blocked. Preserve records; do not silently change completion/certification data" (the opposite of D-06) | "Allowed with normal scope and permissions because existing enrolments continue. Records are preserved." |
| PXR | 11.3 row: learner learning, submission, certificate download, support | "Must follow approved post-expiry learner-access policy" | Continue for existing enrolments; new enrolment unavailable with neutral copy and a calm support route |
| PXR | 11.4 step 5 | "Expiry/grace policy reaches read-only threshold." | "The expiry and grace end reach the restricted continuity mode threshold." |
| PXR | 12.4 licence row | Row "LMS licence expired/read-only": initiation, confirmation, refunds and new enrolment activation blocked for every method | Row "LMS licence in restricted continuity mode": new checkout sessions blocked for every method; in-flight payments complete; webhooks, reconciliation, refunds and reversals stay operational |
| PXR | Implementation handoff after 12.5 | "... reconciliation and expired-licence restriction before commercial launch" | "... reconciliation and restricted-continuity-mode behaviour before commercial launch" |

## Unedited by design

PXR section 11.3 rows for publish and settings, and for create staff, role changes and system settings, already say "Blocked" and name `licence.activate` as the narrowly permitted recovery control; they match D-06 and are unchanged. PXR section 11.5 contains no retired wording. The unrelated audit read service header elsewhere in the repository is a legitimate use of the old words and is not touched or scanned.

## Tracked documents amended in the same plan

`.planning/REQUIREMENTS.md` (LIC-05, LIC-08), `.planning/ROADMAP.md` (Phase 14 list entry and success criterion 3), `.planning/intel/requirements.md` (the two mirrored entries) and the comment above the licence permissions in `src/server/permissions/catalogue.ts`.

## Gitignore finding, contract and owner follow-ups

`git check-ignore -v` reports the `reference/` rule at `.gitignore` line 65 for both `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` and `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md`. The PRD and PXR edits are therefore local-only and invisible to git; the wording test skips their groups with a visible reason when the files are absent (for example in CI) and always checks the tracked planning documents.

The signed commercial contract is outside this repository and controls any remaining discrepancy between it and these documents. Owner follow-ups, none of which can be automated here:

1. Regenerate the `.docx` twins of the PRD and PXR from the amended `.md` files (adopted ledger item OQ7, manual-only verification in `14-VALIDATION.md`). This plan does not touch any `.docx` file.
2. Align the commercial contract wording (post-expiry behaviour, what continues, what is blocked) with restricted continuity mode.
3. Put the amended PRD and PXR under version control or another reviewed store, because git cannot see them here, and carry this table to it.
