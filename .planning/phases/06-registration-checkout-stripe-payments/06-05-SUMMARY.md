---
phase: 06-registration-checkout-stripe-payments
plan: 05
subsystem: public-catalogue-ui
tags: [react, server-components, cohort-cards, reg-01, testing-library, vitest]

requires:
  - phase: "06-03"
    provides: "CohortCards (course-page integration, enrollAction), the extended PublicCohort payload"
provides:
  - "CohortCards hardened with an explicit break-words wrapping treatment (all other boundary states — Full/no-button, last-seat, plain-text delivery mode, no-pagination — were already correct from 06-03)"
  - "tests/components/cohort-cards.test.tsx — 10-case render-test suite covering zero/one/many, the Full boundary, and the last-seat boundary"
  - "Programme offer pages (/programmes/[slug]) render the same CohortCards component the Course offer pages render, replacing the old bare Starts-{date} list"
affects: [06-07]

actuals:
  tokens: 1984
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One cohort-card component consumed by both Course and Programme offer pages — no second implementation that can drift"

key-files:
  created:
    - tests/components/cohort-cards.test.tsx
  modified:
    - src/app/(public)/CohortCards.tsx
    - src/app/(public)/programmes/[slug]/page.tsx

key-decisions:
  - "No REG-01 field gap exists on the Programme side: PublicProgramme's completion-expectation fields (memberCourseTitles, certificateEnabled) were already rendered above the cohort list before this plan; this plan adds no field and invents none (prerequisites/durationHours stay Course-only, confirmed absent from PublicProgramme by public-catalogue-service.ts and by a grep gate on the edited file)"
  - "TDD RED/GREEN run strictly in order for Task 1, since the only real gap in 06-03's CohortCards implementation was the missing break-words class: wrote the 10-case test suite first (9/10 passing against the unmodified component, proving the other boundary states were already correct), confirmed the break-words case failed (RED), then added the one-line class fix (GREEN)"

requirements-completed: [REG-01]

coverage:
  - id: D1
    description: "CohortCards' boundary states hardened and covered by render tests: Full (seatsAvailable === 0) renders no button/form of any kind, seatsAvailable === 1 renders a working Enroll control, delivery mode stays plain text (no StatusPill), no pagination/carousel affordance at any volume, and long card text wraps via break-words"
    requirement: "REG-01"
    verification:
      - kind: unit
        ref: "tests/components/cohort-cards.test.tsx — 10/10 passing"
        status: pass
      - kind: other
        ref: "grep gates: 0 StatusPill, 0 disabled, 0 raw hex, 0 scarcity vocabulary, >=1 break-words — all pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "Programme offer pages (/programmes/[slug]) render CohortCards identically to Course offer pages; REG-01's field set (price, dates, mode, availability, prerequisites, completion expectation) is satisfied on both offer types from real model data, with no invented field on the Programme side"
    requirement: "REG-01"
    verification:
      - kind: automated_ui
        ref: "npx tsc --noEmit (clean) + npx next build (clean) + grep gates (CohortCards wired exactly twice, bare Starts-{date} list gone, empty-state copy survives exactly once, memberCourseTitles unchanged, 0 prerequisites/durationHours hits)"
        status: pass
      - kind: unit
        ref: "npx vitest run tests/public-catalogue-service.test.ts — 23 total (with cohort-cards.test.tsx) passing, no service touched"
        status: pass
    human_judgment: true
    rationale: "next build, tsc, and the grep/unit gates prove the code compiles and the structural/copy invariants hold, but no automated test drives a real browser against seeded data — the actual Enroll click, side-by-side visual comparison, and empty-cohort Programme page need the human walkthrough below."

duration: ~15min
completed: 2026-09-10
status: complete
---

# Phase 6 Plan 5: Cohort Cards on Both Offer Types Summary

**Gave Programme offer pages the same enrolable `CohortCards` the Course pages already had, and closed the one real gap in 06-03's tracer implementation — the missing `break-words` wrapping treatment — proving the Full/last-seat boundary states were already correct along the way.**

## Performance
- **Duration:** ~15min
- **Started:** 2026-09-10T07:08:00Z (approx.)
- **Completed:** 2026-09-10T07:17:00Z (approx.)
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Wrote `tests/components/cohort-cards.test.tsx`, a 10-case render suite covering every `<behavior>` bullet: empty list, the Full boundary (no button/form at all), the last-seat boundary (`seatsAvailable === 1`), many-seats rendering, date/mode/price formatting, non-`StatusPill` delivery mode, single-cohort (no carousel affordance), five-cohort (no pagination), `break-words` wrapping, and absence of scarcity vocabulary.
- Confirmed via RED that 9 of those 10 cases already passed against 06-03's unmodified `CohortCards.tsx` — the Full/last-seat/plain-text-mode/no-pagination behaviors were already correct — and only the `break-words` case failed.
- Closed that one gap: added `break-words` (plus `min-w-0` so it can actually take effect inside the `sm:flex-row` layout) to the card's fact row (GREEN).
- Replaced the Programme offer page's bare `<li>Starts {date}</li>` list with the same `CohortCards` element the Course offer page renders, mirroring 06-03's integration exactly; removed the now-dead `formatDate` helper that only backed that list.
- Confirmed no REG-01 field gap exists on the Programme side: `PublicProgramme` carries `memberCourseTitles` and `certificateEnabled` (both already rendered above the cohort list, unchanged by this plan) and genuinely lacks `prerequisites`/`durationHours` — those stay Course-only, per `public-catalogue-service.ts`, and a grep gate confirms neither was invented on the Programme page.

## Task Commits
1. **Task 1 (TDD RED): failing test for CohortCards boundary states** - `999113d` (test)
2. **Task 1 (TDD GREEN): break-words wrapping treatment** - `8334253` (feat)
3. **Task 2: Programme page wired to CohortCards** - `0013b6c` (feat)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified
- `tests/components/cohort-cards.test.tsx` - 10-case render-test suite for `CohortCards`, fixtures built directly from the `PublicCohort` type
- `src/app/(public)/CohortCards.tsx` - added `break-words`/`min-w-0` to the card's fact row; no other change needed
- `src/app/(public)/programmes/[slug]/page.tsx` - replaced the bare cohort list with `<CohortCards cohorts={programme.upcomingCohorts} />`, removed the dead `formatDate` helper

## Decisions Made
- **No REG-01 field gap on the Programme side** — `PublicProgramme`'s completion-expectation fields (`memberCourseTitles`, `certificateEnabled`) were already rendered in the page's existing fact grid/section before this plan touched it; this plan adds no field and confirmed via `public-catalogue-service.ts` and a grep gate that `prerequisites`/`durationHours` (Course-only fields) were not invented here.
- **TDD ordering held strictly** for Task 1 given the small, precisely-scoped gap: the full 10-case test suite was written and run against the unmodified component first (9/10 passed, proving the other boundary states already worked), the one failing case was confirmed as the real RED signal, then the single-line fix made it GREEN — rather than writing a trivial or pre-passing test to satisfy the `tdd="true"` frontmatter mechanically.

## Deviations from Plan

None - plan executed exactly as written. The plan's own text anticipated that most of Task 1's `<behavior>` bullets might "already be true from plan 06-03's tracer pass" and instructed reviewing and closing only what wasn't — that is exactly what happened (break-words was the only gap).

**Total deviations:** 0. **Impact:** none.

## Human Verification Needed

From Task 2's `<verify>` block (copied verbatim, not run automatically — this project's `human_verify_mode` is `end-of-phase`):

With the dev server running and signed in as a seeded learner:
1. Open a Programme detail page that has an open cohort. Confirm it renders the same cohort cards as a Course page — date range, mode, price, seat count, "Enroll now" — and not the old "Starts {date}" list.
2. Confirm the programme's member-course list and certificate statement still render above the cohort list, unchanged and not duplicated inside any card.
3. Click "Enroll now" from the Programme page and confirm you reach an order summary for that programme cohort at the right price.
4. Open a Programme with no scheduled cohorts. Confirm it reads "No dates are scheduled yet." with no Enroll control anywhere.
5. Compare a Course detail page and a Programme detail page side by side. Confirm the cohort cards are visually identical.

## Issues Encountered

- `npm test` (full suite): 14 test files fail, all pre-existing and unrelated to this plan — matching 06-01 through 06-04's already-documented findings exactly. 12 files fail with `Could not find a working container runtime strategy` (Docker unavailable in this sandbox); `tests/docker-email-config.test.ts` (2 cases) fails on the pre-existing `.env.example` blank-`AUTH_SECRET` gap noted in `.planning/STATE.md`. 1393 tests pass, including this plan's own 10 new cases and the untouched `public-catalogue-service.test.ts` suite (23 total together). Neither failure category touches any file this plan modified.

## Known Stubs

None introduced by this plan.

## User Setup Required

None.

## Next Phase Readiness

06-05 is the last of the three parallel Wave 3 plans (06-04, 06-05, 06-06) from this executor's perspective. Wave 4 (06-07) depends on 06-03 + 06-04 + 06-06, not on 06-05 directly, but 06-05 completes REG-01's remaining field-set/boundary-state work that the phase's UAT will check. The human browser walkthrough above (and 06-03's own outstanding walkthrough) should be run before end-of-phase UAT closes; the Docker-gated integration suites documented by 06-01 through 06-04 remain the other open item, unrelated to this plan's scope.

## Self-Check: PASSED
- All 3 touched files verified present on disk (`tests/components/cohort-cards.test.tsx` created; `src/app/(public)/CohortCards.tsx`, `src/app/(public)/programmes/[slug]/page.tsx` modified).
- All 3 task commits (`999113d`, `8334253`, `0013b6c`) verified present in `git log`.

---
*Phase: 06-registration-checkout-stripe-payments*
*Completed: 2026-09-10*
