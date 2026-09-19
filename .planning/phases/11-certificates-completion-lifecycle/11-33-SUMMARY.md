---
phase: 11-certificates-completion-lifecycle
plan: 33
subsystem: verification
tags: [human-verify, human-action, migration, neon, pdf, visual-check, gap-closure]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "11-29 Unicode renderer, 11-32 evidence PDFs, 11-27 migration 20260919120000_enrolment_one_live_per_learner_cohort"
provides:
  - "Human sign-off on the Yoruba / Polish / CJK certificate PDFs (after a subset-font defect was found and fixed)"
  - "CR-06 migration applied and verified on a Neon mirror branch and on the main Neon database"
affects: [verify-work, phase-11-close]

key-decisions:
  - "The visual check found a real defect the automated suite missed (subset font, blank glyphs); fixed before sign-off"
  - "Migration applied to the main Neon database by the orchestrator at the user's explicit instruction, after a rehearsal on a mirror branch"

requirements-completed: []

duration: multi-step
completed: 2026-09-19
---

# Phase 11 Plan 33: Human visual check and shared-database migration

**A human visual check caught blank glyphs in the generated certificate PDFs that every automated test had passed; after the fix the PDFs were approved, and the CR-06 index migration was rehearsed on a Neon branch and then applied to the main Neon database.**

## Task 1: Visual check of generated certificates (checkpoint:human-verify)

**Defect found before sign-off (not by the human's eye alone).** Rendering the plan-11-32 evidence PDFs in Chrome's PDF viewer and in pdf.js showed most letters missing (a Yoruba name showed only tone marks; "September" drew as "Sep e"). All automated tests had passed, because they recover text through the ToUnicode map, which was intact, and never checked that glyphs have outlines.

Root cause, isolated with a four-way experiment: fontkit's subsetter produced a truncated font program for Noto Sans (10 of 4,503 glyphs, most without outlines), independent of the `ccmp` option. Fix (commit `c7d8033`): embed the whole font, about 316 KB per certificate (was 3-5 KB), plus tests that read the font program out of the PDF and require an outline for every drawn glyph and a complete glyph set (they fail against the subset embedding). A latent test-helper bug that trimmed a valid last byte of Flate streams was fixed in the same commit. See the "Post-verification defect" section of 11-29-SUMMARY.md.

The evidence PDFs were regenerated through the real integration suite (`CERTIFICATE_EVIDENCE_DIR` set) and re-inspected: Yoruba dotted letters and tone marks draw, Polish Ł / Żółć draw, CJK shows "?? ??" (accepted in plan 11-26), and the reference, date, award and title are present and in the expected order.

**Human reply (verbatim):** "i've looked at the pdfs they pass"

Not judged separately by the human, and therefore recorded as open items: the small tone-mark offset for a letter with no precomposed form (known limitation) and the CJK/Arabic/Hebrew "?" behaviour (accepted in 11-26). File size (about 316 KB per certificate) is a follow-up: a pre-trimmed Latin-only font would cut it to roughly 50-60 KB.

## Task 2: CR-06 migration on shared databases (checkpoint:human-action)

Migration: `prisma/migrations/20260919120000_enrolment_one_live_per_learner_cohort`. **Deviation from the plan text, at the user's explicit direction:** the plan reserved this action for the human and forbade the executor from touching shared databases. The user supplied a Neon branch connection string and later instructed "apply to main db"; the orchestrator therefore ran the steps below. Connection strings were passed as environment variables to single commands and never written to a file (the main database URL was built from .env inside the shell and not echoed; the branch URL was typed inline in the commands, so it appears in the session transcript). The direct (non-pooled) host was used for both.

| Environment | Diagnostic (duplicate live enrolments) | Result |
|---|---|---|
| Neon mirror branch `ep-purple-wildflower-axl8la7c` | 0 rows | **applied**, verified |
| Main Neon database `ep-polished-cloud-axoo6q1b` | 0 rows | **applied**, verified |

Steps per environment: confirmed the endpoint differed from the other; `prisma migrate status` showed exactly one pending migration; read-only diagnostic returned zero rows (36 enrolments: ACTIVE 11, CANCELLED 21, PENDING_PAYMENT 1, TRANSFERRED 1, WITHDRAWN 2); `prisma migrate deploy` (never `migrate dev`); verified `enrolment_one_live_per_learner_cohort` exists with predicate `status IN ('ACTIVE','COMPLETED')` and `enrolment_one_active_per_learner_cohort` is gone; status counts identical before and after; `migrate status` reports "Database schema is up to date". A behavioural probe, run inside a transaction that is always rolled back, confirmed a COMPLETED enrolment plus a second ACTIVE enrolment for the same learner and cohort is rejected by the unique index; zero probe rows were left behind and the touched row's status was restored.

Backup posture: the user created the mirror branch immediately before the main apply, which serves as a restore point taken before the change.

Not done / open items:
- The optional application smoke test (revoke through the UI against a migrated database) was not run; the revoke reversal is covered by the real-Postgres suites of plans 11-27 and 11-32.
- Other environments: the user named none besides the branch and main. The local Docker UAT database `lms_phase11_uat` is one migration behind (it was migrated before this migration existed); it is a disposable walkthrough database.
- The branch connection string was shared in the conversation. The user should delete or reset that branch, or rotate its password.
- No `prisma migrate`, `db push` or `db execute` was run against any database other than the two named above.

## Phase-close bookkeeping done here
- `11-VALIDATION.md` now has rows for plans 11-17 through 11-34 (previously only 11-01..11-16).

## Regression gate
Second-pass full test-suite run: 223 test files passed, 3,189 tests passed, 1 skipped, 0 failed (npm test via PowerShell, exit code 0, 2026-09-19, after the whole-font renderer fix and both migrations were in place). The one failure seen in the first-pass run (a Phase 10 upload test timing out under load) did not recur.

## Next
Run `/gsd:verify-work 11` (the phase verifier has not been run for either gap pass). Phase 11 stays "In Progress" until then.
