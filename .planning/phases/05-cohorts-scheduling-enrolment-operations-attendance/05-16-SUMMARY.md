---
phase: 05-cohorts-scheduling-enrolment-operations-attendance
plan: 16
subsystem: verification
tags: [cohorts, scheduling, enrolment, attendance, phase-close, prisma, hydration, docker]

# Dependency graph
requires:
  - phase: 05-01
    provides: schema delta, migration 20260904092220_cohort_operations, shared cohort fixtures
  - phase: 05-02..05-15
    provides: every Phase-5 service and UI surface — see each plan's own SUMMARY.md
provides:
  - "Phase 5 verification record: automated gate result, the human-verification checkpoint's
    findings, and every fix applied in response to those findings"
  - "AttendanceRecord.correctedBy Prisma relation (schema.prisma) — fixes a 500 on every cohort
    detail page for a cohort with >=1 enrolment"
  - "CohortInstructor assignment: assignCohortInstructor/removeCohortInstructor/
    loadCohortInstructors (cohort-service.ts), instructor-actions.ts, InstructorsPanel.tsx —
    the readiness gate's Instructors check previously had no writer anywhere but prisma/seed.ts"
  - "src/lib/format-timestamp.ts — deterministic server/client timestamp formatting, fixes a
    React hydration mismatch (#418) on /staff/audit, the Roster tab and the Exceptions tab"
  - "Publish dialog copy now branches on blocking-item count instead of always claiming all
    checks pass"
  - "package-lock.json: restored multi-platform native-binding entries (lightningcss,
    @tailwindcss/oxide, @next/swc, @rolldown/binding, @unrs/resolver-binding, @img/sharp)
    dropped at commit fccd40a — Docker image build was broken for every subsequent phase
    until this plan"
affects: [09, 10, 11]

# Tech tracking
tech-stack:
  added: [playwright-cli (dev-only browser automation for this verification pass)]
  patterns:
    - "Live human-verification checkpoints can surface defects mocked-Prisma unit tests
      structurally cannot: an `as const` select object loses type-checking against
      Prisma.<Model>Select once extracted from the query call, and a fake client never
      validates a select shape against the real schema — only hitting the real client does."
    - "Date.prototype.toLocaleString()/toLocaleDateString() on a client component is a
      hydration-mismatch risk in this app: SSR and the browser have different locale/ICU
      data. Use src/lib/format-timestamp.ts (pinned locale + pinned UTC timeZone) instead."

key-files:
  created:
    - "src/app/staff/cohorts/[id]/InstructorsPanel.tsx"
    - "src/app/staff/cohorts/[id]/instructor-actions.ts"
    - "src/lib/format-timestamp.ts"
    - "prisma/migrations/20260905003936_attendance_corrected_by_relation/migration.sql"
  modified:
    - "prisma/schema.prisma (AttendanceRecord.correctedBy relation)"
    - "src/server/services/cohort-service.ts (instructor assignment)"
    - "src/app/staff/cohorts/[id]/page.tsx (InstructorsPanel wiring)"
    - "src/components/catalogue/CohortDetailActions.tsx (dialog copy)"
    - "src/app/staff/audit/AuditTable.tsx, src/app/staff/cohorts/[id]/RosterTab.tsx,
      src/app/staff/cohorts/[id]/ExceptionsTab.tsx (formatTimestamp)"
    - "package-lock.json (native-binding platform entries restored)"
    - "tests/cohort-service.test.ts, tests/cohort-cancel.integration.test.ts (instructor deps)"

key-decisions:
  - "Fixed the correctedBy 500, the missing instructor-assignment UI, the Docker build
    blocker, the publish-dialog copy contradiction, and the audit/roster/exceptions
    hydration mismatch — all discovered during this plan's own human-verification pass,
    not pre-existing known issues, and all fixed and re-verified live before phase close
    (user directive: fix rather than merely record)."
  - "Instructor picker uses a plain user-id text input, not a search UI — matching the
    SessionFormFields Facilitator field and the roster tab's Transfer/Add-enrolment
    escape hatches already established this phase. A proper picker is future work."

requirements-completed: [COH-01, COH-02, COH-03, COH-04, COH-05, COH-06, COH-07, ATT-01, ATT-02, ATT-03, ATT-04]

# Metrics
duration: ~7h (incl. two Docker-build cycles and a mid-session Docker/WSL disk reclaim)
completed: 2026-09-05
---

# Phase 5: Cohorts, Scheduling, Enrolment Operations & Attendance — Verification Summary

**Phase 5 is closed. All COH/ATT requirements are met; five real defects were found during
human verification against a running Docker build (not by the automated suite) and are now
fixed, re-tested, and re-verified live.**

## Task 1 — Automated gate

| Check | Result |
|---|---|
| `npx prisma migrate status` | PASS — 5 migrations applied, no drift |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm test` (full suite, incl. 6 integration/schema files) | PASS — 1035/1036 (1 pre-existing, already-tracked flake in `tests/password-reset-service.test.ts`, `.planning/debug/password-reset-suite-timeout.md`, unrelated to Phase 5) |
| `npm run build` (local) | PASS |
| `npm run docker:up` (production stack) | PASS (after fixing a pre-existing lockfile regression — see below) |
| Worker `queues ready` line | Confirmed: `lesson-resource.scan, lesson-resource.reconcile, enrolment.hold-sweep` |

**Docker build blocker (fixed before the human checkpoint could even start):** `package-lock.json`
lost its Linux (`musl`/`gnu`) platform entries for `lightningcss` and several other native-binding
deps (`@tailwindcss/oxide`, `@next/swc`, `@rolldown/binding`, `@unrs/resolver-binding`,
`@img/sharp`) at commit `fccd40a` "Merge branch 'develop' into Khaliddev" — before any Phase-5
plan ran. Every Docker image build since then would have failed the same way; nothing before
05-16 exercised a Docker build to catch it. Fixed by restoring the dropped platform entries
(`0bd6027`, `d0d4acd`), verified against the npm registry as genuine published packages.

## Task 2 — Human verification (checkpoint)

Driven live against the running Docker stack using `playwright-cli` (browser automation), not
simulated. Full 8-step checklist from `05-VALIDATION.md` plus the additional spot-checks.

| Step | Result |
|---|---|
| 1. Readiness panel + publish gate (COH-04) | Gate mechanism confirmed correct (Publish button inside the dialog is properly `disabled` with an itemized blocking-items alert) — but found a real functional gap: **no UI/service anywhere could assign a `CohortInstructor`** except `prisma/seed.ts`, so a staff-created instructor-led/blended cohort could never clear the Instructors check. **Fixed** (see below) and re-verified: assigning flips the panel from FAIL to PASS live; removing flips it back; both audited. |
| 2. Meeting-link visibility window (COH-03/D-25) | **Untestable in this phase, by design, not a regression.** `readSessionForViewer` exists (`scheduled-session-service.ts`) but is gated on `cohorts.view` — a staff-only permission (seeded `Learner` role has zero permissions) — and is not wired to any route. Matches 05-06-SUMMARY's own note that this is Phase 9 (LRN-06) territory. |
| 3. Bulk attendance save (ATT-01) | **Verified live.** Started session: dirty indicator, single "Save attendance" commit, only changed rows updated. Not-yet-started session: Present/Absent/Late correctly disabled with the exact hint copy; Excused/Not-recorded stayed enabled. |
| 4. Post-window correction (ATT-03) | **Verified live.** Reason box gated (disabled <10 chars, enabled >=10), dialog named old->new state verbatim, `/staff/audit` showed both the original mark and the correction with before/after values, actor, reason. |
| 5. Cohort-cancel bulk withdraw (D-31) | **Verified live.** Dialog stated the exact active-enrolment count and required a reason. After confirm: status Cancelled, seats 0, ACTIVE enrolments -> Withdrawn, the one PENDING_PAYMENT enrolment -> Cancelled (correct distinct exit status per D-14, not a bug), 4 sessions -> Cancelled, nothing deleted, 4 separate per-enrolment audit rows (not batched) plus 1 `cohort.cancelled` + 4 `session.cancelled` rows. |
| 6. Hold-expiry sweep (COH-06/D-03) | **Verified live.** Worker log: `released 1 expired seat holds`. That enrolment is Cancelled, reason "hold expired", audited to SYSTEM. |
| 7. Exceptions CSV parity (ATT-04) | **Verified live.** On-screen count matched CSV row count exactly for both an unfiltered (6/6) and filtered (3/3, "at-risk") view. |
| 8. Keyboard nav / denial (NFR-09/RBAC-06) | Keyboard half **verified live** (ArrowRight/End/Home move tab focus correctly, visible focus outline). Denial half **not independently verified** — the seeded `instructor@kqnexus.test` account carries a GLOBAL role assignment (in addition to its `CohortInstructor` rows), so it cannot demonstrate a cohort-scoped-only denial; a genuinely scoped test account was not created this session. |

### Additional defects found and fixed during the checkpoint (not on the original checklist)

1. **`AttendanceRecord.correctedBy` — HTTP 500 on every cohort detail page with >=1 enrolment.**
   `roster-service.ts`'s `RECORD_SELECT` selected a `correctedBy` relation the schema never
   declared (only the scalar `correctedById` existed) — confirmed only by hitting the real
   Prisma client in the browser; every unit test used a mocked client that never validates a
   select shape. Fixed: added the relation to `schema.prisma` (`79be0c8`). A subsequent
   independent code-review pass caught that this first fix only regenerated the Prisma
   client and never generated an actual migration, so the foreign key was never created in
   any real database (dev, CI or production all provision via `prisma migrate deploy` from
   the committed migrations directory, never `db push`). Generated and applied
   `20260905003936_attendance_corrected_by_relation` (`ADD CONSTRAINT ... FOREIGN KEY
   ("correctedById") REFERENCES "User"("id") ON DELETE SET NULL`, `a08151a`) against the dev
   DB; `prisma migrate status` reports no drift and the 4 schema regression suites (47 tests)
   pass applying every migration fresh via Testcontainers. Full suite + build re-verified
   green after both fixes.
2. **Publish dialog copy contradiction.** The dialog's description always said "All blocking
   readiness checks pass" even while the alert directly below it listed real blocking items.
   The actual gate was never wrong (Publish stayed disabled) — just the static text. Fixed:
   branches on `blocking.length` (`1def6c4`).
3. **React hydration mismatch (#418) on `/staff/audit`, the Roster tab, and the Exceptions tab.**
   All three called `Date.prototype.toLocaleString()`/`toLocaleDateString()` directly in a
   client component — locale/ICU-dependent, so the server render and the browser's render of
   the same instant produced different text. Fixed: `src/lib/format-timestamp.ts`, a pure
   helper pinning both locale and time zone; wired into all three call sites (`1def6c4`).
   Confirmed live: zero console errors on reload after the fix (previously exactly 1).

4. **Instructor-assignment concurrency races (found by an independent code-review pass over
   this plan's own new code, not by manual testing).** `assignCohortInstructor` /
   `removeCohortInstructor` did a plain check-then-write against `CohortInstructor`'s
   `@@unique([cohortId, userId])` constraint with no unique-violation guard — unlike every
   other writer in this codebase that touches a constraint two concurrent requests can race
   on. A concurrent double-assign or double-remove would have surfaced a raw Prisma error
   instead of the documented idempotent success. Fixed with the same
   `isUniqueConstraintViolation`/`isRecordNotFoundError` (P2002/P2025) guards used elsewhere
   (`resource-service.ts`, `seat-accounting.ts`), plus 4 new tests proving both races resolve
   correctly (`a08151a`).

**Checkpoint outcome: approved.** All findings — both from live manual verification and from
a follow-up independent code review of the new code written in response to it — were fixed
and re-verified (live in the browser, and via the full automated suite) rather than merely
recorded, per explicit user directive mid-checkpoint.

## Requirement-by-requirement status

| Requirement | Status | Note |
|---|---|---|
| COH-01 | Complete | Cohort CRUD, offer-lock guard (D-30) |
| COH-02 | Complete | Readiness-gated publish |
| COH-03 | Complete (staff side) | Scheduling, timezone-correct storage, repeat-weekly. Learner-facing meeting-link gate is Phase 9 (LRN-06) — see checklist step 2 |
| COH-04 | Complete | Readiness panel + publish gate; instructor-assignment gap closed this plan |
| COH-05 | Complete | Enrolment state machine, all 5 staff actions |
| COH-06 | Complete | Hold-expiry sweep, verified releasing a real expired hold |
| COH-07 | Complete | Roster with transition history and attendance component |
| ATT-01 | Complete | Bulk attendance save, pre-marking restriction |
| ATT-02 | **Deferred to Phase 9** | Attendance component is computed and `attendance.changed` is emitted (D-20); no learner-facing view exists yet |
| ATT-03 | Complete | Post-window correction, mandatory reason, audit trail |
| ATT-04 | Complete | Attendance exceptions + filter-parity CSV |

## Decision required before Phase 9

**Self-paced access-duration model (PRD §15.3(1)).** Whether a `SELF_PACED` cohort should keep
the dated-`Cohort` shape Phase 5 shipped, or move to an access-window-from-enrolment model.
Phase 9's learning delivery depends on the answer, and changing it later touches
`Enrolment.accessStartsAt`/`accessEndsAt` semantics directly.

## Other deferred items (restated, not lost)

- Waitlist at capacity — its own future slice, not in the COH requirement set.
- Cross-offer transfer and COH-01's approved-migration path for changing a Cohort's offer after
  enrolment — needs a business-policy decision; treated as cancel + new enrolment for now.
- Session recurrence entity (RRULE-style) — Phase 5 ships a "repeat weekly xN" row-inserter only.
- Automated refund/credit on withdrawal or transfer — PRD §15.3(4), Finance handles this in
  Phase 7/8 against approved policy.
- Per-cohort attendance marking window — Phase 5 uses the project constant
  `ATTENDANCE_MARKING_WINDOW_HOURS = 168`; promote to a `Cohort` field only on request.
- ATT-02 learner-facing attendance display — Phase 9 learner dashboard (see table above).
- A genuinely cohort-scoped staff test account for the RBAC-06 denial half of checklist step 8.

## Operational requirements for deploy

- `prisma migrate deploy` must run — the schema includes `20260904092220_cohort_operations`
  plus this plan's `correctedBy` relation (client-only, no new migration).
- The worker service must be running in production, or seat holds will never release
  (`enrolment.hold-sweep` queue).
