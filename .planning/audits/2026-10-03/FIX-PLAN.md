# Audit fix plan — started 2026-10-03

Sources: `../2026-09-30/PRODUCT-AUDIT.md` (A-/U- ids) and `UAT-ROUND-3.md` (R3- ids, fresh database on develop `39423b0`).

Decisions (owner, 2026-10-03):
- **A-01:** a Quiz lesson completes automatically when the learner passes; an Assignment lesson completes automatically when they submit. No manual "Mark complete" on these lessons.
- **Cohort pricing:** one rail price is enough to publish; a missing USD (or NGN) price is a warning, not a block.
- **Commits:** one local commit per fix on `Khaliddev`; no push until asked.

Status: `todo` / `done <commit>` / `deferred (why)`.

## Batch 1 — blockers for going live
| Id | Finding | Status |
|---|---|---|
| A-14 | First production drain emails every historic DomainEvent | todo |
| R3-02 | Docker image has no `assets/`: certificate PDFs fail (font missing) | todo |
| R3-01 | Fresh seed cannot sell: no `priceNgnMinor`/`priceUsdMinor` on the bookable cohorts; FCM seeded with end = start | todo |
| A-03 | Seed never repairs pre-20-Sep assessments (pass mark 70 of 2; `application/pdf` file type) | todo |

## Batch 2 — crashes and dead ends
| Id | Finding | Status |
|---|---|---|
| A-04 | `/staff/users/new` and `/staff/roles/new` crash for roles without the permission | todo |
| R3-04 | Passing the final quiz lands on a 404; "Open" on a completed course 404s | todo |
| A-13 | 4 stale event-mapper tests | todo |

## Batch 3 — access control
| Id | Finding | Status |
|---|---|---|
| A-02 | Payments report and export need only `reports.view` | todo |
| A-05 | Finance can override lesson completion (`enrolments.manage`) | todo |

## Batch 4 — learning rules
| Id | Finding | Status |
|---|---|---|
| A-01 | Quiz/assignment lessons: skip-able or stuck after passing | todo |
| A-07 | A published quiz can be saved with a pass mark above its total | todo |

## Batch 5 — staff workflow
| Id | Finding | Status |
|---|---|---|
| R3-05 | Staff forms lose typed values when a save fails validation | todo |
| R3-06 | Cohort cannot be published without a USD price | todo |
| R3-07 | A started cohort cannot be bought online; enrol link bounces silently | todo |
| A-08 | Flagged certificate has no "confirm" action | todo |
| A-12 | Reconciliation / Overview / Reports disagree on exceptions | todo |
| R3-08 | 5 of 10 report dashboards "Not available yet" | todo |
| A-11 | Sessions cannot be edited, so "session updated" mail never sends | todo |
| A-15 | Reopened ticket alerts no staff | todo |

## Batch 6 — polish
| Id | Finding | Status |
|---|---|---|
| U-01 | Email log and audit show raw codes | todo |
| R3-09 | Attempt wording off by one in the submit dialog | todo |
| R3-10 | Dashboard results panel "No results yet" after a pass | todo |
| R3-11 | Certificate design upload accepts PNG/JPEG only (no PDF) | todo |
| R3-12 | Temporary staff password is not forced to change | todo |
| U-14 | Notification time is drain time, not event time | todo |
| other | Remaining U-/NOTE items in the two source documents | todo |
