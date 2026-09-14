# Phase 9: Learning Delivery & Progress Tracking - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-14
**Phase:** 9-Learning Delivery & Progress Tracking
**Areas discussed:** Self-paced access window, Lesson sequencing & prerequisite locks, Completion rule v1 scope, Manual completion behavior

---

## Self-paced access window

| Option | Description | Selected |
|--------|-------------|----------|
| Per-enrolment window | Each learner gets their own accessStartsAt/accessEndsAt from activation | ✓ |
| Cohort-wide window | Everyone in a SELF_PACED cohort shares Cohort.startsAt/endsAt | |

**User's choice:** Per-enrolment window.
**Notes:** The user asked to first clarify what "self-paced" means in this codebase before deciding window length — clarified as: DeliveryMode with no required scheduled sessions and no required instructor (per Phase 5's readiness-check rules).

| Option | Description | Selected |
|--------|-------------|----------|
| New Cohort field: accessDurationDays | Staff set a duration; every enrolment's accessEndsAt = activatedAt + N days | |
| Open-ended (no end date) | accessEndsAt stays null, access never expires | |
| Other / describe your own policy | — | ✓ (merged) |

**User's choice:** Merge both — a nullable field, staff can set a duration or leave it blank for unlimited access.
**Notes:** User asked how Udemy handles this before locking in. Researched via WebSearch: Udemy consumer courses give lifetime access by default (no expiry), with expiry only appearing in the separate Udemy Business subscription product. User then asked to check a live reference site (lms.lou.university) via a browser session — the user logged into a Playwright-controlled dashboard themselves. The site turned out to be a Moodle-based demo/theme showcase with broken course links, but its underlying platform (Moodle) was confirmed via WebSearch to implement the identical pattern in its Self-enrolment plugin: blank/0 = unlimited, or a day-count from enrolment. Both real-world references converged on the same design, which the user then locked in.

| Option | Description | Selected |
|--------|-------------|----------|
| Enrolment stays ACTIVE, access just locks | Read-only past accessEndsAt, no status churn | ✓ |
| Auto-transition to an expired-like status | New EnrolmentStatus value + sweep worker | |

**User's choice:** Enrolment stays ACTIVE, access just locks.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, correct | Scoped to SELF_PACED only | ✓ |
| No, per-enrolment windows for ALL delivery modes | Broader change | |

**User's choice:** Yes, scoped to SELF_PACED only.

---

## Lesson sequencing & prerequisite locks

| Option | Description | Selected |
|--------|-------------|----------|
| Strictly linear by position | Every lesson gates the next regardless of required/optional | |
| Only required lessons gate | Optional lessons never block progression | ✓ |

**User's choice:** Only required lessons gate.

| Option | Description | Selected |
|--------|-------------|----------|
| Global sequence | One continuous ordered path across the whole Course | ✓ |
| Per-module only | Modules not gated against each other | |

**User's choice:** Global sequence.

| Option | Description | Selected |
|--------|-------------|----------|
| Name the specific blocking lesson | "Complete '<title>' to unlock this" | ✓ |
| Generic position-based message | "Complete the previous lesson" | |

**User's choice:** Name the specific blocking lesson.

| Option | Description | Selected |
|--------|-------------|----------|
| First lesson open on ACTIVE enrolment only | No content access before ACTIVE | ✓ |
| Preview access before payment | Some content visible during PENDING_PAYMENT | |

**User's choice:** First lesson open on ACTIVE enrolment only (no preview).

---

## Completion rule v1 scope

| Option | Description | Selected |
|--------|-------------|----------|
| Manual mark-complete only, all types | One code path for all content types | |
| Auto-complete VIDEO on watch-through, manual for the rest | Content-type-appropriate per LRN-04 | ✓ |

**User's choice:** Auto-complete VIDEO, manual for the rest.

| Option | Description | Selected |
|--------|-------------|----------|
| 90% | Industry-convention threshold | ✓ |
| 100% | Must reach the very end | |
| Other percentage | — | |

**User's choice:** 90%.

| Option | Description | Selected |
|--------|-------------|----------|
| New field on LessonProgress, written periodically by the player | Explicit tracking mechanism | ✓ |
| You decide — planner/researcher figure out the mechanism | Defer implementation detail | |

**User's choice:** New field, written periodically by the player. Exact shape left to research/planning.

| Option | Description | Selected |
|--------|-------------|----------|
| Required lessons + attendance threshold | Reads the Phase-5 attendance component | ✓ |
| Required lessons only, attendance deferred too | Narrower v1 scope | |

**User's choice:** Required lessons + attendance threshold.

| Option | Description | Selected |
|--------|-------------|----------|
| On every LessonProgress write + attendance-changed event | Reactive recalculation | ✓ |
| Scheduled batch recalculation only | Periodic job | |

**User's choice:** Reactive, on write + event.

| Option | Description | Selected |
|--------|-------------|----------|
| supersededAt is set, no new record until re-satisfied | Uses the existing field | ✓ |
| Completion is permanent once recorded | supersededAt unused | |

**User's choice:** supersededAt is set; re-evaluated later.

---

## Manual completion behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, freely, learner-initiated | No reason required | ✓ |
| No — one-way for learners, staff-only reversal | Mirrors attendance corrections | |

**User's choice:** Yes, freely, learner-initiated.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, mirroring attendance corrections | Mandatory reason, audited | ✓ |
| No staff override in v1 | Only learner/AUTO_VIDEO can set progress | |

**User's choice:** Yes, mirroring attendance corrections.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, same self-undo rule applies | AUTO_VIDEO treated like MANUAL for undo | ✓ |
| No — auto-completions are locked once triggered | | |

**User's choice:** Yes, same rule applies regardless of source.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, re-locks downstream lessons | Consistent with the sequencing gate | ✓ |
| No, later lessons stay unlocked once reached | Sequencing becomes advisory after first pass | |

**User's choice:** Yes, re-locks downstream lessons.

---

## Claude's Discretion

- Exact video watch-progress tracking mechanism (polling interval, client event model, field
  shape/location).
- The learner dashboard's "next action" derivation logic.
- The `completionRule` JSON payload's exact schema/versioning for the two v1 rule types, and
  where the evaluation engine lives in the codebase.
- Whether downstream re-locking on an un-complete is computed eagerly or lazily.

## Deferred Ideas

- Preview/marketing content access before payment (`PENDING_PAYMENT` state) — considered and
  explicitly not chosen for v1.
- Per-lesson or per-module access windows distinct from the whole-Course access window.
- Assessment-based completion criteria — deferred to Phase 10.
- Two pending todos were reviewed via `todo.match-phase` but not folded into this phase's scope:
  the Phase 7 manual-payment race-condition fix (unrelated domain — payments) and the Phase 4.1
  UI mutation-warnings cleanup (unrelated domain — staff arrange/editor UI).
