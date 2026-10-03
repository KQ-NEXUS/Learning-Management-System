---
phase: 14-software-licence-deployment-control
plan: 06
subsystem: licensing
tags: [licence, vocabulary, copy, intl-dates, permission-effects, d-06, d-09, d-10, d-11, d-14]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-04 DerivedState and LicenceStateName; 14-02 LICENCE_REJECTION_CODES; 14-DECISIONS.md OQ1 option-a"
provides:
  - "src/server/licence/display.ts: DEFAULT_DISPLAY_ZONE, formatLicenceInstant, formatUtcInstant"
  - "src/server/licence/policy.ts: RESTRICTED_CONTINUITY_LABEL and all licence copy (labels, tones, refusals, summaries, days-remaining display, rejection sentences, banner copy, notice copy, screen strings)"
  - "src/server/licence/effects.ts: LicenceEffect, LICENCE_PERMISSION_EFFECT (37 permissions), effectForPermission, Capability, RESTRICTED_CAPABILITIES"
affects: [14-07, 14-09, 14-10, 14-12, 14-13, 14-14, 14-15, 14-16, 14-17, 14-21]

estimate:
  tokens: 65000
  raw_tokens: 65000
  tasks: 3
  confidence: low
actuals:
  tokens: 17350
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "One constant owns the post-grace state phrase; every other string composes from it (a test counts the literal in the source file)"
    - "Closed copy sets: unknown notice key or rejection code renders a generic sentence and never echoes the input"
    - "Fixed month table and pinned zone abbreviations so server and browser instants are byte-identical regardless of ICU/CLDR version"
    - "Total Record over the closed Permission catalogue via import type; unknown string defaults to write"

key-files:
  created:
    - src/server/licence/display.ts
    - src/server/licence/policy.ts
    - src/server/licence/effects.ts
    - tests/licence-display.test.ts
    - tests/licence-policy.test.ts
    - tests/licence-effects.test.ts
  modified: []

key-decisions:
  - "display.ts pins month abbreviations (Jan..Dec, so September is Sep) and the zone abbreviations WAT, SAST, EAT; every other zone uses the en-GB short name from Intl (BST, GMT, UTC, offsets)."
  - "The forbidden-words guard permits exactly one sentence containing the words signing key: the verbatim UI-SPEC UNKNOWN_KEY rejection sentence. The UI-SPEC bans signing key values, not the phrase in that sentence; everywhere else the phrase fails the guard."
  - "isKnownNoticeKey and noticeCopy accept invalid-RECORD_MISSING and invalid-VALIDATION_WINDOW_EXHAUSTED in addition to the 11 rejection codes, because deriveState (14-04) emits those two reason codes into dueNoticeKeys."
  - "OQ1 option-a text is used for the Not activated summary, empty-state body and neutral pill (as recorded in 14-DECISIONS.md)."

patterns-established:
  - "Plans 14-10, 14-12, 14-14, 14-15 import every licence sentence from policy.ts and never type the post-grace phrase"
  - "Plan 14-17 starts from LICENCE_PERMISSION_EFFECT and overrides per call site where a permission spans read/write/continuity operations"

requirements-completed: []

coverage:
  - id: C1
    description: "D-06: single constant owns the post-grace phrase; seven states keep distinct labels and tones; no read-only wording anywhere"
    requirement: "LIC-02"
    verification:
      - kind: unit
        ref: "tests/licence-policy.test.ts (literal count, labels, tones, forbidden-words guard) (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "D-14 and D-11: summaries, days-remaining figures and instants equal the UI-SPEC text; grace summary composed from policy plus formatter"
    requirement: "LIC-05"
    verification:
      - kind: unit
        ref: "tests/licence-policy.test.ts and tests/licence-display.test.ts (pass)"
        status: pass
    human_judgment: false
  - id: C3
    description: "D-10, LIC-07: notice copy is a closed set; unknown keys and codes render a generic sentence; emails at most three sentences without signing, contract or deployment-ID detail"
    requirement: "LIC-07"
    verification:
      - kind: unit
        ref: "tests/licence-policy.test.ts noticeCopy and isKnownNoticeKey (pass)"
        status: pass
    human_judgment: false
  - id: C4
    description: "D-09: 37 permissions classified 14 read, 13 write, 10 continuity; works/blocked lists consistent with the classification; licence.activate is in a works item; unknown string is write"
    requirement: "LIC-02"
    verification:
      - kind: unit
        ref: "tests/licence-effects.test.ts (pass)"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 06: Licence Vocabulary, Display and Permission Effects Summary

**Three pure modules that define the licence vocabulary once: UI-SPEC copy composed from a single post-grace phrase constant, ICU-independent instant formatting in the licence's zone beside the exact UTC instant, and a total read/write/continuity classification of all 37 permissions that also drives the works/blocked lists.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-10-01
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto; all marked tdd)
- **Files:** 6 created, 0 modified

## Accomplishments

- `display.ts`: `formatLicenceInstant(date, zone | null)` gives `30 Nov 2026, 23:59 WAT` (en-GB parts, explicit `timeZone`, `hourCycle: "h23"`), falls back to Africa/Lagos for a null or invalid zone, never prints `24:00`. `formatUtcInstant` gives `2026-11-30T22:59:59Z`.
- `policy.ts`: `RESTRICTED_CONTINUITY_LABEL` is the only literal of the phrase in the file (test asserts one occurrence, comments included); labels, tones, refusal messages, preserved-data statement, seven state summaries, days-remaining display, 11 rejection sentences plus `CONCURRENT_CHANGE`, banner copy, closed-set notice copy with `isKnownNoticeKey`, and every screen string the later plans need.
- Tracer proven: `stateSummary("GRACE", ...)` over formatter output equals "The licence expired on 30 Nov 2026, 23:59 WAT. Everything still works until 14 Dec 2026, 23:59 WAT. After that, restricted continuity mode begins."
- `effects.ts`: `LICENCE_PERMISSION_EFFECT` is a total `Record<Permission, LicenceEffect>` (14 read, 13 write, 10 continuity, exact sets asserted); `effectForPermission` defaults an unknown string, including `constructor` and `__proto__`, to write; `RESTRICTED_CAPABILITIES` has 7 works and 5 blocked items with attendance and support tickets in works (A9, A11) and registration in blocked (A12).
- Forbidden-words guard runs over every exported string constant and over 100+ sample outputs of every copy function; its regexes are assembled from fragments so the test file contains no banned wording itself, and a non-vacuity test proves each pattern matches its own wording.

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): display.ts, policy.ts (core), tests. Commit: none (owner policy)
2. Task 2: rejection, banner, notice and screen copy, forbidden-words guard. Commit: none (owner policy)
3. Task 3: effects.ts and tests/licence-effects.test.ts. Commit: none (owner policy)

TDD gate: for Task 3 RED was run first (`tests/licence-effects.test.ts` failed at import, "no tests", before `effects.ts` existed) and GREEN followed. For Tasks 1 and 2 the display, policy and rejection code was written before its tests (the date strings were first probed against the runtime, as the plan instructs), so no separate RED run exists for those two. No `test(...)`/`feat(...)` git commits exist because commits are prohibited by owner policy.

## Verification Results (real output)

- `npx vitest run tests/licence-effects.test.ts tests/licence-purity.test.ts tests/licence-policy.test.ts tests/licence-display.test.ts --project node`: 4 files passed, 82 tests passed, 0 failed (3.83 s). The purity guard enumerates `src/server/licence` and covers the three new files (24 tests, passed).
- Per file: `tests/licence-display.test.ts` 8 tests, `tests/licence-policy.test.ts` 34 tests (together 42 in the focused run).
- `npx tsc --noEmit`: exit 0, no output (0 errors; no new error).
- `npx eslint` on the three source files and three test files: exit 0, no output.
- Acceptance greps: `effects.ts` contains `import type { Permission } from "@/server/permissions/catalogue"`; `policy.ts` contains one `"Restricted continuity mode"` literal.
- Requirement gate, `gsd_run query requirements ready-ids .planning/phases/14-software-licence-deployment-control/14-06-PLAN.md LIC-02 LIC-05 LIC-07`, output verbatim:

```
{
  "ready": [],
  "blocked": [
    "LIC-02",
    "LIC-05",
    "LIC-07"
  ],
  "total": 3
}
```

  No requirement was marked complete (all three are blocked; later plans still carry them).

## Observed runtime values (plan instruction: record rather than loosen)

On Node 24.6.0 / ICU 77.1 / CLDR 47.0:

- `Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", timeZoneName: "short" })` prints `GMT+1`, not the `WAT` the UI-SPEC and plan Test 1 require (en-NG and en-ZA print `WAT`; Africa/Johannesburg prints `GMT+2`, Africa/Nairobi `GMT+3`).
- en-GB prints `Sept` for September, not `Sep`.
- With two-digit hour fields, en-GB formatToParts pads the day (`01 Mar`).
- Europe/London gives `BST` and `GMT` exactly as expected, including across the 2026-03-29 changeover.

The assertions were not loosened. The formatter was changed instead (see Deviations 1).

## Files Created/Modified

- `src/server/licence/display.ts` - instant formatting in an IANA zone plus UTC
- `src/server/licence/policy.ts` - all licence vocabulary and copy
- `src/server/licence/effects.ts` - permission effect classification and works/blocked lists
- `tests/licence-display.test.ts` - formatter tests
- `tests/licence-policy.test.ts` - copy, closed-set and forbidden-words guard tests
- `tests/licence-effects.test.ts` - classification and capability-list tests

## Decisions Made

See key-decisions. Fixed copy choices not dictated verbatim by the UI-SPEC: the clock-rollback and invalid email detail sentences (written to the plan's "what happened, what works or is blocked, where to act" shape, no key, signing, contract or deployment-ID detail); the singular "1 day" forms for the banner, grace-ending notice and graceDays; `NOT_AVAILABLE` as the fallback when a preformatted variable is missing so no raw `{placeholder}` is ever rendered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The planned Intl formatter does not produce the UI-SPEC strings on this runtime**
- **Found during:** Task 1 (probe before fixing expected strings, then first test run)
- **Issue:** The plan's formatter (en-GB, `month: "short"`, `timeZoneName: "short"`) yields `GMT+1` for Africa/Lagos (spec: `WAT`), `Sept` for September (spec: `d MMM`, `Sep`), and a padded day `01 Mar`. Server and browser ICU versions can disagree on these, which would also reintroduce the hydration mismatch D-11 is meant to prevent.
- **Fix:** `display.ts` takes month numerically and maps it through a fixed Jan..Dec table, normalises the day with `Number`, and pins named abbreviations for the zones the product serves (`Africa/Lagos` WAT, `Africa/Johannesburg` SAST, `Africa/Nairobi` EAT); every other zone uses the en-GB short name from Intl. Tests hold the UI-SPEC text. Residual risk: a zone outside the pinned set renders whatever Intl returns (for example `GMT+5:30`), the same on server and browser only if their ICU data agree.
- **Files modified:** src/server/licence/display.ts, tests/licence-display.test.ts
- **Commit:** none (owner policy)

**2. [Rule 1 - Spec conflict] The forbidden-words list contradicts the verbatim UNKNOWN_KEY rejection sentence**
- **Found during:** Task 2 (guard test failed on its own verbatim data)
- **Issue:** The plan lists "signing key" among words that must never appear in any export, but plan Task 2 and UI-SPEC require the verbatim rejection sentence "This licence was not issued with a recognised signing key. Contact support." The UI-SPEC's own list bans "signing key" values (key material), not that phrase.
- **Fix:** The sentence stays verbatim. The guard removes exactly that one fixed sentence before matching, so the phrase fails the guard everywhere else (a test asserts both the permitted sentence and a non-permitted use). The remaining fragments (read-only, extend, generate, create licence, edit licence, unlock, reactivate, bypass, private key, stack trace) are checked with no exemption.
- **Files modified:** tests/licence-policy.test.ts
- **Commit:** none (owner policy)
- **For the owner:** if "signing key" must be absent even from this sentence, the UI-SPEC rejection table needs a wording change; this is a one-line edit in `policy.ts` plus the test constant.

**3. [Rule 2 - Missing critical functionality] Notice keys the state machine really emits were not in the plan's closed set**
- **Found during:** Task 2
- **Issue:** `deriveState` (14-04) can return reason codes `RECORD_MISSING` and `VALIDATION_WINDOW_EXHAUSTED`, so `dueNoticeKeys` emits `invalid-RECORD_MISSING` and `invalid-VALIDATION_WINDOW_EXHAUSTED`. Validating `invalid-` suffixes against the 11 rejection codes alone would make `isKnownNoticeKey` reject them and plan 14-14 would silently drop those two notices (LIC-07).
- **Fix:** the closed suffix set is the 11 rejection codes plus those two codes, each with a fixed sentence ("The installed licence record could not be read." and "The licence check could not complete within 24 hours."). Any other suffix, including `invalid-NOPE`, is still unknown and renders the generic copy. A test asserts all 11 rejection codes plus the two are known.
- **Files modified:** src/server/licence/policy.ts, tests/licence-policy.test.ts
- **Commit:** none (owner policy)

### Interpretation choices (no behaviour change to the plan's listed tests)

- `validation-attention` and `clock-rollback` notice keys are accepted both bare and with their dedupe suffix (`-{epoch seconds}`, `-{YYYY-MM-DDTHH}`); the tests use the suffixed forms the state machine and clock module emit.
- `daysRemainingDisplay` returns both fields null for VALIDATION_ATTENTION (the screen shows the Check pending pill and summary; no figure).
- `bannerCopy` takes one extra optional input, `reasonSentence`, for the invalid-state message (the plan's input list had no source for the `{reason sentence}` placeholder).
- `LAST_VERIFICATION_LABELS` is keyed `OK | FAILED | UNAVAILABLE | NOT_CHECKED` to match `LicenceVerificationOutcome` plus the not-checked case.

**Total deviations:** 3 (2 Rule 1, 1 Rule 2). **Impact:** none breaks the interface contract; the exports and signatures named in the plan are unchanged.

## Issues Encountered

None beyond the deviations above.

## Known Stubs

None. Every export is wired to real content; `NOT_AVAILABLE` fallbacks are intentional UI copy, not placeholder data.

## Threat Flags

None. The files are pure and add no endpoints, auth paths, file access or schema. Register items T-14-06-01 (closed copy sets, generic unknown output, forbidden-words guard, no deployment ID or signing detail in email text), T-14-06-02 (exact-set tests for all three classes, every write permission in a blocked item), T-14-06-03 (licence.activate continuity and in a works item) and T-14-06-04 (distinct refusal constant) are covered by tests.

## Next Phase Readiness

- Plans 14-07 (service), 14-09, 14-10 (screen), 14-12 (learner refusal), 14-13, 14-14 (notices; call `isKnownNoticeKey` and `noticeCopy`), 14-15, 14-16 and 14-17 (enforcement; start from `LICENCE_PERMISSION_EFFECT`, override per call site) can import the interface contract unchanged.
- Note for plan 14-10 and 14-14: dates passed into the copy functions are preformatted by the caller with `formatLicenceInstant(date, snapshot.timeZone)`.
- Broken-windows ledger: no new stub, skipped test or unrun verify was introduced, so nothing was appended to `.planning/WINDOWS.md`.
- Carried forward: the 14-03 Task 2 database apply remains an outstanding human step (WINDOWS.md entry id 20); this plan does not depend on the live database.

## Self-Check: PASSED

- FOUND on disk: src/server/licence/display.ts; src/server/licence/policy.ts; src/server/licence/effects.ts; tests/licence-display.test.ts; tests/licence-policy.test.ts; tests/licence-effects.test.ts.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.

---
*Phase: 14-software-licence-deployment-control*
*Completed: 2026-10-01*
