# Phase 15: Launch Readiness — NFR Verification & Operational Cutover - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-06
**Phase:** 15-Launch Readiness — NFR Verification & Operational Cutover
**Areas discussed:** Where and how we test, What counts as done, Security and privacy depth, Accessibility and browsers, plus the carried-in items (U-11, U-12) and monitoring

---

## Folded todos

| Option | Description | Selected |
|--------|-------------|----------|
| Support queue filtering into SQL | Performance work on the staff support queue (NFR-02) | ✓ |
| Latent async-mutation warnings | Three small warnings from the 04.1 review (NFR-03, NFR-14) | ✓ |

**User's choice:** Both folded. The Phase 15 prerequisites todo was folded without asking.

---

## Where and how we test

| Question | Options | Selected |
|----------|---------|----------|
| Environment | Local first plus one staging run / Staging only / Local only | Local first plus one staging run |
| Pilot load | 50 learners + 5 staff / 25 + 3 / 150 + 10 | 150 learners, 10 staff |
| Speed tool | k6 plus Playwright / Playwright only / You decide | k6 plus Playwright |
| Restore test | Neon restore plus Docker dump / Neon only / Dump only | Neon restore plus Docker dump |

**Notes:** The user chose the stress-style 150 learner load instead of the recommended 50. Performance work may be needed to meet 2.5s p75 at that load.

---

## What counts as done

| Question | Options | Selected |
|----------|---------|----------|
| Gate evidence | One file per gate / One launch checklist / Only a report at the end | Only a report at the end |
| Owner items | Complete with a tracked checklist / Wait for every sign-off | Complete with a tracked checklist |
| Failures | Written waiver with owner and expiry / No waivers | Written waiver with owner and expiry |
| Journey test | Automated plus one manual / Automated only / Manual only | Automated plus one manual |

**Notes:** The user chose a single end report over per-gate files, so the launch checklist file carries the owner-dependent items.

---

## Security and privacy depth

| Question | Options | Selected |
|----------|---------|----------|
| Bypass tests | Every server action and download route / Critical paths only | Every server action and download route |
| CI and scans | GitHub Actions plus Dependabot / Manual scan | GitHub Actions plus Dependabot |
| Rate limits | Add to other entry points / Document the gap | Add to other entry points |
| Privacy tools | Staff export and anonymise, deletion locked / Policy only / Self-service too | Staff export and anonymise, deletion locked |

---

## Accessibility and browsers

| Question | Options | Selected |
|----------|---------|----------|
| A11y proof | axe + keyboard + screen reader / axe + keyboard / External audit | axe + keyboard + one screen-reader pass |
| Browsers | Playwright 3 engines + real Safari / Playwright only / Manual only | Playwright 3 engines + real Safari |
| Viewports | 320 to 1920 plus 200% zoom / 390 to 1440 | 320 to 1920 plus 200% zoom |

---

## Carried-in items and monitoring

| Question | Options | Selected |
|----------|---------|----------|
| U-11 unverified sign-in | Neutral message plus quiet resend / Tell them not verified / Leave as is | Neutral message plus quiet resend |
| U-12 time zones | Lagos time with label / Viewer's zone / UTC | Lagos time with label |
| Monitoring | In-product ops page plus free uptime monitor / Error-tracking service / Document only | In-product ops page plus free uptime monitor |
| Anything else | Ready for the context / Explore more | Ready for the context |

---

## Claude's Discretion

- k6 scenarios and thresholds, seeding scripts, split of tests between local and staging.
- Ops status page layout and the health endpoint shape.
- Organisation of the report and launch checklist.
- Runbook format and content (not discussed in detail).

## Deferred Ideas

- Learner self-service export and deletion requests.
- A paid error-tracking service.
- Hard deletion of personal data.
- Small inline table links under 24px.
