# Phase 13: Transactional Communications & Notifications - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-27
**Phase:** 13-transactional-communications-notifications
**Areas discussed:** Drain & retry engine, Email catalogue & recipients, Email look & sender, In-product notifications UX

---

## Drain & retry engine

| Question | Options | Selected |
|----------|---------|----------|
| Drain trigger | Scheduled task every 1-2 min / Scheduled + inline kick / pg-boss worker | Scheduled task (Recommended) |
| Retry policy | Backoff x5 then FAILED / Retry 24h / Per-template policy | Backoff, 5 tries |
| Failed mail visibility | Staff log + resend / Read-only log / Audit alert only | Staff log + manual resend |
| Dedup key | Event id + recipient / Business key / Hybrid | Event id + recipient |
| Event marking | Per-event transaction then send / Send inline, mark after | Per-event transaction |
| Poison events | Skip + audit after 3 / Leave unprocessed | Skip + audit after 3 |

## Email catalogue & recipients

| Question | Selected |
|----------|----------|
| Learner mails | All four groups: payment+enrolment, session changes, results+certificates, ticket activity |
| Staff mails | Ticket assigned/escalated, payment exceptions, grading inbox (in-product), failed-email alert |
| Coverage gaps (payment failed/refunded, verify/reset) | Add events + route all through pipeline |
| Token mails | Same dispatch + dedup, immediate send |
| Recipient eligibility | Resolve at drain, skip ineligible |
| Session burst | Coalesce per session per drain window |

## Email look & sender

| Question | Selected |
|----------|----------|
| Format | HTML + plain-text fallback (hand-written, no dependency) |
| Sender | Env-configured single identity |
| Opt-out | User chose opt-out for non-critical (option differed from the recommended "no opt-out") |
| Mutable categories | Ticket replies, result releases, session changes, enrolment changes |
| Email links | Absolute URL from env base, sign-in gated |

## In-product notifications UX

| Question | Selected |
|----------|----------|
| Surface | Bell + dropdown as a right-side slider, no full page (user's own wording) |
| Read state | On open of link + mark all |
| Muted alerts | In-product still shown |
| Preferences placement | User asked for a visual design; approved the drawer design with settings inside the drawer |
| Staff scope | Permission + scope holders |
| Retention | 90 days then archive |
| Stale links | Check access before navigating (differed from the recommended same-404 approach) |
| Live update | Refresh on navigation + ~60 s poll |

## Additional

| Question | Selected |
|----------|----------|
| Delivery-log access | Global Administrators via existing permission |
| Testing | Template render tests + stubbed transport; one opt-in live Brevo smoke test |

## Claude's Discretion

Delivery-log permission choice, backoff timings, batch/lock details, notification type naming, preference store shape, template copy.

## Deferred Ideas

Full-page notification centre, signed one-click links, staff opt-out, separate no-reply sender; two todos reviewed but not folded.
