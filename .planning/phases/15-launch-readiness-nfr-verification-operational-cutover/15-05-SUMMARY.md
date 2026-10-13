---
phase: 15-launch-readiness-nfr-verification-operational-cutover
plan: 05
subsystem: ui-time-formatting
tags: [d-17, u-12, lagos-time, hydration, support, s6]
status: complete

requires:
  - phase: 15-01
    provides: 15-DECISIONS.md shared UI ownership row for ticket-labels.tsx and LearnerTicketDetail.tsx (agreed)
provides:
  - "src/lib/format-timestamp.ts: formatTimestamp, formatDateTimeShort ('5 Oct 2026, 14:30 WAT'), formatTimestampWithSeconds ('5 Oct 2026, 14:30:12 WAT'), formatDateOnly, formatDateShort ('5 Oct 2026'), formatLagosOrDash(value, variant), toIsoOrNull, LAGOS_ZONE_LABEL (' WAT'), LAGOS_TIME_ZONE, MISSING_TIMESTAMP, types LagosVariant and TimestampInput"
  - "src/components/time/LagosTime.tsx: LagosTime({ value, variant: 'dateTime' | 'dateTimeSeconds' | 'date', className }) renders <time dateTime={ISO UTC}> or a plain '—'"
  - "TicketTime (staff and learner support) and the learner auto-close date render Lagos time"
affects: [15-10, 15-32, 15-33]

actuals:
  tokens: 4200
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Read only numeric formatToParts values (en-GB, Africa/Lagos, h23) and assemble the text with fixed separators and a fixed month table, so server and every browser engine print byte-identical text"
    - "Every central formatter is null/invalid-safe: '—' instead of a RangeError or 'Invalid Date'"

key-files:
  created:
    - src/components/time/LagosTime.tsx
    - tests/format-lagos.test.ts
    - tests/components/lagos-time.test.tsx
  modified:
    - src/lib/format-timestamp.ts
    - src/components/support/ticket-labels.tsx
    - src/app/(learner)/support/[reference]/LearnerTicketDetail.tsx
    - src/server/email/templates/learner-templates.ts
    - tests/components/support-workspace.test.tsx
    - tests/components/learner-support.test.tsx
    - tests/email-templates.test.ts
    - tests/components/assignment-submission-panel.test.tsx
    - tests/components/grading-queue-table.test.tsx
    - tests/components/quiz-attempt-panel.test.tsx
    - tests/components/recently-issued-list.test.tsx
    - tests/learner-results-page.test.ts

key-decisions:
  - "Month abbreviations come from a fixed table, not ICU: Node 24 ICU prints September as 'Sept' in en-GB while other engines print 'Sep' (same approach as src/server/licence/display.ts)"
  - "formatTimestamp now has minutes precision (same text as formatDateTimeShort); seconds are only available through formatTimestampWithSeconds / LagosTime variant dateTimeSeconds"
  - "The central functions accept Date | string | number and return '—' for invalid input, so no call site can throw or print 'Invalid Date'"
  - "The learner auto-close sentence uses the Lagos date-only form ('28 Sep 2026'), not the old long month, per UI-SPEC S6 date-only format"

requirements-completed: []

duration: 35min
completed: 2026-10-07
---

# Phase 15 Plan 05: Lagos time formatter and LagosTime Summary

**One pure formatter now prints every central date-time as "5 Oct 2026, 14:30 WAT" in Africa/Lagos, built from numeric formatToParts values and a fixed month table so server and browsers match byte for byte. A LagosTime component wraps it in a time element, and the support screens no longer show UTC.**

## Performance

- **Duration:** about 35 min
- **Completed:** 2026-10-07
- **Tasks:** 2 of 2
- **Files:** 3 created, 12 modified

## Accomplishments

- `src/lib/format-timestamp.ts` rewritten as a pure module with no imports. All five central functions (`formatTimestamp`, `formatDateTimeShort`, `formatTimestampWithSeconds`, `formatDateOnly`, `formatDateShort`) plus `formatLagosOrDash` render Lagos time with the literal `" WAT"` label. Date-only values use the Lagos calendar day. The module never uses `timeZoneName` and never pins `timeZone: "UTC"`. This moves about 22 existing call sites at once.
- `src/components/time/LagosTime.tsx` works in both server and client components (no "use client", no server-only imports). It renders a `<time dateTime="{ISO UTC}">` element, or a plain "—" with no time element when the value is missing or unparseable.
- `TicketTime` now renders through `LagosTime` and keeps its classes, so every staff and learner support timestamp shows "… WAT". `LearnerTicketDetail` uses `LagosTime variant="date"` for the auto-close date instead of its own UTC Intl call.
- Every test that pinned the old UTC output now expects the Lagos strings.

## Task Commits

None. The run override says no commits; the owner commits explicitly.

1. **Task 1 (tracer): Lagos formatter, LagosTime, learner support times.** Uncommitted. The tracer gate re-ran `<verify>` end to end and it passed.
2. **Task 2: pinned tests moved to Lagos strings.** Uncommitted.

## Files Created/Modified

- `src/lib/format-timestamp.ts`: the Lagos formatter (D-17, S6)
- `src/components/time/LagosTime.tsx`: the time element component
- `src/components/support/ticket-labels.tsx`: `TicketTime` now uses `LagosTime`
- `src/app/(learner)/support/[reference]/LearnerTicketDetail.tsx`: the auto-close date uses `LagosTime`; the private UTC `formatDate` is removed
- `src/server/email/templates/learner-templates.ts`: dropped the extra `" UTC"` suffix (deviation 1)
- `tests/format-lagos.test.ts`, `tests/components/lagos-time.test.tsx`: new
- `tests/components/support-workspace.test.tsx`: changed UTC expectations to "24 Sep 2026, 11:00 WAT" and "20 Sep 2026, 10:00 WAT", plus a check that no UTC text is left
- Task 2 expectation changes: `01/01/2026, 00:00:00` became `1 Jan 2026, 01:00 WAT` in `assignment-submission-panel`, `grading-queue-table`, `quiz-attempt-panel` and `recently-issued-list`, and `01/09/2026, 10:00:00` became `1 Sep 2026, 11:00 WAT` in `learner-results-page`. `audit-table.test.tsx` needed no change because it computes its expectation through `formatTimestamp`.

### Extra test files found by the Task 2 grep or by running affected tests

| File | Why | Result |
|------|-----|--------|
| `tests/components/learner-support.test.tsx` | Pinned the learner auto-close sentence "28 September 2026" (UTC long form). Now asserts the sentence text "… on 28 Sep 2026 unless you reopen it." and the time element's datetime. | 25/25 pass |
| `tests/email-templates.test.ts` | New regression test: session emails print "5 Oct 2026, 10:00 WAT" and never "UTC". | 183/183 pass |
| `tests/components/resource-form-steps.test.tsx` | Grep hit "1 Mar 2027, 09:00". It comes from `ResourceForm`'s own wall-time review formatting, not the central functions, so it was left unchanged. | pass |

A grep of `tests/` found no other `dd/mm/yyyy` assertions and no other UTC-style `"d Mon yyyy, HH:mm"` assertions.

## Decisions Made

See `key-decisions` in the frontmatter. The most important: month names come from a fixed table. On this machine Node 24 prints "19 Sept 2026" for en-GB, while other engines print "Sep". Reading the month from ICU would have broken the byte-identical guarantee and caused hydration mismatches.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Session emails would have read "… WAT UTC"**
- **Found during:** Task 2 (grep for other consumers of the central functions)
- **Issue:** `when()` in `src/server/email/templates/learner-templates.ts` appended `" UTC"` to `formatDateTimeShort(date)`. After Task 1 that would have produced "5 Oct 2026, 10:00 WAT UTC" in the session-updated and session-cancelled emails.
- **Fix:** return `formatDateTimeShort(date)` alone, which already carries " WAT". Added a regression test in `tests/email-templates.test.ts`.
- **Files modified:** `src/server/email/templates/learner-templates.ts`, `tests/email-templates.test.ts`
- **Note:** this is the only `src` change outside Task 1's file list. It is a direct consequence of Task 1's formatter change, not Task 2's (Task 2 changed tests only). Session emails do not carry the cohort zone, so they now print Lagos time with WAT, which matches the default cohort zone (ledger OQ4).

**2. [Rule 2 - Correctness] Central functions are invalid-safe**
- **Found during:** Task 1
- **Issue:** the plan made only `formatLagosOrDash` dash-safe. An invalid `Date` passed to the other functions would throw a RangeError from `formatToParts`.
- **Fix:** every function routes through one renderer that returns "—" for invalid input. The functions now accept `Date | string | number`, a widening that existing `Date` callers do not notice.

**3. [Rule 1 - Test fix] learner-support auto-close assertion**
- The auto-close date is now inside a `<time>` element, so the full-sentence `getByText` no longer matched (the text spans two nodes). The test now checks the paragraph's `textContent` and the time element's `datetime`.

**Total deviations:** 3 auto-fixed. **Impact:** all three follow from the formatter change; no scope creep.

## Issues Encountered

- The `tests/components/support-workspace.test.tsx` axe cases exceed Vitest's default 5000 ms on this machine (6.8 s). They pass with `--testTimeout=60000` (34/34). This predates this plan and is already logged in `deferred-items.md` by 15-09.

## Checks Run

- `npx vitest run tests/format-lagos.test.ts tests/timezone.test.ts tests/components/lagos-time.test.tsx tests/components/support-workspace.test.tsx`: 60 passed. The 2 axe cases only time out at the default 5 s; `support-workspace` alone with `--testTimeout=60000` gives 34/34.
- The six Task 2 tests (`audit-table`, `assignment-submission-panel`, `grading-queue-table`, `quiz-attempt-panel`, `recently-issued-list`, `learner-results-page`): 57 passed, 1 skipped (pre-existing skip).
- Other consumers of the central functions: `assignments-panel`, `certificate-queue`, `certificate-record`, `certificate-templates`, `cohort-pages`, `cohort-roster` gave 84 passed. `email-log-table`, `grade-entry-client`, `staff-progress-override` (component and unit), `support-entry-points`, `resource-form-steps` gave 84 passed.
- `tests/components/learner-support.test.tsx`: 25 passed. `tests/email-templates.test.ts`: 183 passed. `tests/unit/design-contract.test.ts`: 105 passed.
- `npx tsc --noEmit`: clean.
- `npx eslint` on all touched files: 0 errors. There are 2 warnings in `grading-queue-table.test.tsx` about unused `_input` parameters on lines this plan did not touch.
- Acceptance greps: `format-timestamp.ts` contains "Africa/Lagos", " WAT" and `formatToParts`. It has 0 non-comment lines with `timeZoneName` or `timeZone: "UTC"`. `ticket-labels.tsx` has 0 non-comment `UTC</` or `} UTC` lines.
- Next.js note: `LagosTime` uses no Next APIs. It is a plain React component built on a pure module, safe in both server and client components.

## Neon go-live list

None. This plan adds no migration.

## Known Stubs

None.

## Threat Flags

None. T-15-05-01 is mitigated by pinned parts, fixed separators, a fixed month table and exact-string tests. T-15-05-02 is mitigated by one formatter, day-boundary tests and the ISO `dateTime` on every `LagosTime`.

## Next Phase Readiness

- Plans 15-10, 15-32 and 15-33 can now swap ad-hoc Intl calls for `LagosTime` (`value`, `variant`, `className`) and `formatLagosOrDash`.
- `SupportWorkspace.tsx` line 112 ("Data as of … UTC") is still a UTC Intl call. It belongs to plan 15-10's slice and was not touched here.

## Self-Check: PASSED

- FOUND: src/lib/format-timestamp.ts
- FOUND: src/components/time/LagosTime.tsx
- FOUND: tests/format-lagos.test.ts
- FOUND: tests/components/lagos-time.test.tsx
- Commits: none expected (run override: no commits); nothing staged (`git diff --cached` empty)
