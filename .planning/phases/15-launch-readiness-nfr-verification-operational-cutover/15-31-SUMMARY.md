---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 31
subsystem: launch-checklist-and-report
tags: [d-05, d-06, d-07, launch-checklist, migrations, waivers, vitest, static-guard]
status: in-progress

requires:
  - "15-30 (staging run, open items a to h), 15-29 (staging target, 12 missing migrations, RPO finding), 15-20 (manual checks protocol), 15-01 (decisions and ledger)"
provides:
  - "15-LAUNCH-CHECKLIST.md skeleton: 73 owner items in nine groups, the ordered 12-migration Neon go-live list, an empty accepted-waivers table, 17 waiver candidates, the manual checks status table"
  - "tests/launch-checklist.test.ts: guard over the migration list, waiver fields, never-waive categories, owner cells and secrets, with control cases for every rule"
affects: ["15-31 Task 3 (15-LAUNCH-REPORT.md)", "docs/runbooks/deployment.md step 5 (checklist row B-06)"]

key-files:
  created:
    - .planning/phases/15-launch-readiness-nfr-verification-operational-cutover/15-LAUNCH-CHECKLIST.md
    - tests/launch-checklist.test.ts
  modified: []

decisions:
  - "The migration list starts at 20260927015627_communications_notifications (12 folders), not after 20260927150000_video_watch_pacing (7 folders): plan 15-29 found the staging schema copied from production lacked the five 20260927 migrations too. The guard requires every folder from the first listed one onward and separately asserts the plan's own baseline"
  - "Findings that touch payment, authorization, private files or security are owner items in group G (fix, or decide the rule), never waiver candidates; the guard refuses those categories in the candidates table as well as in the accepted table"
  - "Waivers are two tables: accepted (empty until the owner names a person and an expiry) and candidates (17, each with a recommendation that is the executor's suggestion only)"
  - "Production items are written as client handover steps, on the owner's statement of 2026-10-11 that every hosted value so far is test-only and the client will set up its own accounts"
  - "The empty-owner rule is gated by OWNERS_ASSIGNED (false now): an empty Owner cell always fails, the placeholder 'to be named' fails only after Task 3 flips the constant"

requirements-completed: []

actuals:
  tokens: 14300
  tasks: 1
  commits: 0

metrics:
  duration: "about 25 min for Task 1"
  completed: null
---

# Phase 15 Plan 31: Launch checklist and report Summary (DRAFT)

**Draft. Task 1 of 3 is done: the launch checklist skeleton exists with 73 owner items, the 12-migration Neon go-live list in folder order and 17 waiver candidates, and a guard test ties the list to the real migrations folder. The plan is stopped at the Task 2 owner checkpoint; the launch report is not written.**

Nothing is committed (owner rule). No name, date or waiver acceptance was written on anyone's behalf. No database, staging or load work was done in this task.

## Status by task

| Task | Result |
| --- | --- |
| 1. Tracer: checklist skeleton and guard test | **Done.** `npx vitest run tests/launch-checklist.test.ts`: 1 file, 28 tests passed. Tracer gate re-run: passed. |
| 2. Owner names people, decides waivers, supplies manual results | **Checkpoint, awaiting the owner.** Nothing answered yet. |
| 3. Fill the checklist and write `15-LAUNCH-REPORT.md` | **Not started.** |

## What Task 1 built

- **`tests/launch-checklist.test.ts`** (written first; it failed with 9 failures while the checklist did not exist, then passed). Rules, each a plain function over markdown with control cases on made-up text:
  - the migration table holds every folder of `prisma/migrations` from the first listed one onward, in folder order, with no unknown and no repeated folder; every folder after the plan's baseline `20260927150000_video_watch_pacing` is present;
  - the section says to apply with `prisma migrate deploy` over the direct connection and to run `prisma migrate status` first;
  - every accepted waiver has a person (the placeholder is never a person) and a `YYYY-MM-DD` expiry; no row of any waiver table has a category naming security, payment, authorization (either spelling) or private file;
  - every owner item has an Item and a non-empty Owner cell; `OWNERS_ASSIGNED` (false) decides whether "to be named" counts as empty;
  - the five sections exist, the D-06 "production stays closed" sentence is present, the manual checks section points at `e2e/MANUAL-CHECKS.md`;
  - the document holds no connection string, host name, key or branch id.
- **`15-LAUNCH-CHECKLIST.md`** with the five sections the plan names:
  - "How to use this checklist" (D-06, D-07, developer versus client handover);
  - "Owner items": 73 rows in groups A to I, every Owner cell "to be named", Due and Signed empty;
  - "Neon go-live migrations (in order)": 12 rows with purpose, pre-check and how to apply, the two diagnostic SELECTs for `20261006120000_grade_completion_uniqueness`, and the instruction to check production first;
  - "Waivers (D-07)": an empty accepted table and 17 candidates (W-01 to W-17);
  - "Manual checks": the five sections of `e2e/MANUAL-CHECKS.md`, all "Not done".

## Verification run

| Command | Result |
| --- | --- |
| `npx vitest run tests/launch-checklist.test.ts` before the checklist existed | 9 failed (file not found), 19 control cases passed |
| `npx vitest run tests/launch-checklist.test.ts` after | 1 file, 28 tests passed |
| `npx eslint tests/launch-checklist.test.ts` | clean |
| `npx tsc --noEmit` | clean |
| Carriage returns in the two new files | 0 (LF, as the neighbouring files) |
| Secret scan of the checklist (the guard's own patterns: connection string, Neon, Netlify and storage host names, payment and email keys, branch ids) | no match |

## Deviations from Plan

**1. [Rule 1 - Wrong baseline] The migration list holds 12 folders, not 7.** The plan lists the folders after `20260927150000_video_watch_pacing`. Plan 15-29 found that the staging schema, copied from the production branch, lacked the five `20260927...` migrations as well. The list starts at `20260927015627_communications_notifications`; the guard enforces that wider range and still asserts the plan's own baseline in a separate test. Production was not contacted; checklist row B-04 makes `prisma migrate status` on production the first step.

**2. [Rule 2 - D-07] Never-waive findings are owner items, not waiver candidates.** The plan seeds one "Waivers (D-07)" table with candidates. Findings in the payment, authorization, private-file and security areas (the reconciliation case page defect, the storage client signing with an empty key, export keys that use the job id, the export refusal page, the 4-hour video link, the grant end instant, Global-only assessment creation) are in owner-item group G as "fix" or "decide the rule". The guard refuses those categories in the candidates table too, so one cannot be offered by mistake.

**3. [Structure] Two waiver tables.** The plan's rule "a row lacks a person or an expiry" would fail on every unaccepted candidate. Accepted waivers (person and expiry enforced) and candidates (category enforced only) are separate tables under the one heading.

**4. [Structure] Owner items table has two extra columns** (Id and Type) beside the plan's Item, Why, Owner, Due, Signed. Type marks "developer" or "client handover", as the owner's statement of 2026-10-11 requires.

**5. [Classification, for the owner to confirm] Three candidates sit close to a never-waive area and were classed outside it, with the reason written in the row:** W-12 (staff payments list filters cover one page: a display limit, no money mishandled; recommendation "fix first"), W-13 and W-14 (record-state gaps that plan 15-26 established are not permission bypasses), W-15 (an audit line written on a correct certificate download). If the owner classes any of them as payment, authorization or private-file, it moves to group G and cannot be waived.

**6. Target-size waiver not seeded.** The plan names "target-size on inline table links" as an example candidate. The accessibility sweep reported none (`waiverCandidates` 0, plan 15-19), so no candidate exists; the checklist says so. Captions were built (option-a), so there is no NFR-09 waiver row; the caption files are owner item F-06.

No file outside the plan's list was edited. `docs/runbooks/deployment.md` step 5 still names four waiting migrations; that is checklist row B-06, not changed here.

## State updates

Run: `state.record-metric` (phase 15, plan 31, 25 min, 1 task, 2 files), `state.add-decision` twice, `state.record-session` (stopped at the Task 2 checkpoint, resume file this plan). Side effect: `completed_plans` in `STATE.md` went from 258 to 259 because this draft summary file exists; it was set back to 258 by hand (the plan is not complete). Not run: `roadmap.update-plan-progress`, `state.advance-plan`, `state.update-progress`, `state.begin-phase`, `requirements.mark-complete`, `gsd_run query commit`.

## Known Stubs

- Every Owner cell holds the placeholder "to be named", and Due and Signed are empty, by the plan's design until Task 2. The accepted-waivers table is empty. These are the checkpoint's subject, not finished content.

## Threat Flags

None. No product code, endpoint, auth path or schema changed.

## Open at the checkpoint (Task 2)

1. A named person and a due date for each of the 73 owner items (40 developer, 33 client handover).
2. Accept or reject each of the 17 waiver candidates, with the accepting person and an expiry date for each accepted one.
3. The five manual check sections in `e2e/MANUAL-CHECKS.md`: none done; every results table is empty.

## Self-Check: PASSED (Task 1 only)

- `15-LAUNCH-CHECKLIST.md` and `tests/launch-checklist.test.ts` exist on disk.
- No commit was made (owner rule); `actuals.commits` is 0.
- The plan is not complete: Tasks 2 and 3 are open and `15-LAUNCH-REPORT.md` does not exist.
