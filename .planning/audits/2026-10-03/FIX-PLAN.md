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
| A-14 | First production drain emails every historic DomainEvent | done (migration `20261003120000`, real-Postgres test) |
| R3-02 | Docker image has no `assets/`: certificate PDFs fail (font missing) | done (Dockerfile + guard test; verified in the rebuilt container: two certificates with no file rendered and downloaded) |
| R3-01 | Fresh seed cannot sell: no `priceNgnMinor`/`priceUsdMinor` on the bookable cohorts; FCM seeded with end = start | done (seed sets rail prices and a valid end; repairs older databases without overwriting staff edits) |
| A-03 | Seed never repairs pre-20-Sep assessments (pass mark 70 of 2; `application/pdf` file type) | done (seed repairs the exact stale values; re-run the seed on Neon if it was seeded before 20 Sep) |

## Batch 2 — crashes and dead ends
| Id | Finding | Status |
|---|---|---|
| A-04 | `/staff/users/new` and `/staff/roles/new` crash for roles without the permission | done (denied branch passes no function; static guard over every Server Component in `src/app`) |
| R3-04 | Passing the final quiz lands on a 404; "Open" on a completed course 404s | done (completed course opens as a read-only record; lesson page shows a completed panel; lesson content stays closed per G-01) |
| A-13 | 4 stale event-mapper tests | done (tests select the group's own mapper; no named "unmapped" example to go stale) |

## Batch 3 — access control
| Id | Finding | Status |
|---|---|---|
| A-02 | Payments report and export need only `reports.view` | done (`payments.view` also required on the dashboard, export request and download; the hub's aggregate totals are unchanged) |
| A-05 | Finance can override lesson completion (`enrolments.manage`) | done (override now needs `enrolments.manage` AND `attendance.manage`; no new permission, nobody gains access. A dedicated `progress.override` would be a catalogue change for the owner to approve) |

## Batch 4 — learning rules
| Id | Finding | Status |
|---|---|---|
| A-01 | Quiz/assignment lessons: skip-able or stuck after passing | done (quiz lesson completes on pass, assignment lesson on submit, in the same transaction; no manual mark or undo on these lessons. Learners who passed BEFORE this fix are not back-filled: use the staff override for any who are stuck) |
| A-07 | A published quiz can be saved with a pass mark above its total | done (service refuses it on a published assessment, both when the pass mark or total is edited and when the questions are replaced) |

## Batch 5 — staff workflow
| Id | Finding | Status |
|---|---|---|
| R3-05 | Staff forms lose typed values when a save fails validation | done (fixed once in the shared ResourceForm, covering every staff create/edit form; registration also keeps name and email. Sign-in, password reset and the account email form still clear on a refusal) |
| R3-06 | Cohort cannot be published without a USD price | done (one priced rail is enough; the unpriced rail is a warning naming the currency learners cannot pay in; zero/negative prices and no price at all still block) |
| R3-07 | A started cohort cannot be bought online; enrol link bounces silently | done (catalogue lists what checkout accepts: published, not finished, enrolment window not closed; a started cohort shows "Started ... still enrolling") |
| A-08 | Flagged certificate has no "confirm" action | done ("Keep certificate active" beside Revoke: clears the flag, same permission and mandatory reason as revoke, audited as `certificate.review_confirmed`) |
| A-12 | Reconciliation / Overview / Reports disagree on exceptions | done for the overview (the item is now "Orders needing review" and opens the payments list filtered to Exception). Order exceptions and reconciliation cases remain two separate queues by design; whether an order exception should also open a reconciliation case is an open product question |
| R3-08 | 5 of 10 report dashboards "Not available yet" | deferred (five new reports; to be planned as its own phase, does not block go-live) |
| A-11 | Sessions cannot be edited, so "session updated" mail never sends | done (Edit on each scheduled session; `session.updated` is written when the title, time, location or meeting link changes, which the phase 13 mapper already turns into the learner email and notification) |
| A-15 | Reopened ticket alerts no staff | done (in-product alert to the ticket's current owner, or to every ticket manager when it has none) |

## Batch 6 — polish
| Id | Finding | Status |
|---|---|---|
| U-01 | Email log and audit show raw codes | done for the email log (template names, statuses and skip reasons read as words; a provider's own error text is shown as recorded). The audit log's action codes are unchanged |
| R3-09 | Attempt wording off by one in the submit dialog | done |
| R3-10 | Dashboard results panel "No results yet" after a pass | done (a completed course's card now loads its released results) |
| R3-11 | Certificate design upload accepts PNG/JPEG only (no PDF) | todo |
| R3-12 | Temporary staff password is not forced to change | done as a SUGGESTION (owner decision 2026-10-04): a staff member still on the password an administrator set sees a notice with a link to choose their own; nothing is blocked. The notice hides itself after 12 seconds and has a Dismiss button that keeps it away for 30 days on that browser. Migration `20261004120000` adds the flag. Accounts created before it are not prompted |
| U-14 | Notification time is drain time, not event time | done |
| other | Remaining U-/NOTE items in the two source documents | todo |
