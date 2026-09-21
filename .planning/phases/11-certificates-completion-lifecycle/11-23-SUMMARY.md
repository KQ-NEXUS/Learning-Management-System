---
phase: 11-certificates-completion-lifecycle
plan: 23
subsystem: certificates
tags: [gap-closure, uat-test-8, certificates, staff-ui, landing-page]
requires: ["11-22"]
provides:
  - "RecentlyIssuedList presentational section"
  - "Certificates landing page shows the newest 10 non-superseded certificates with Automatic / staff-name source"
  - "Shared CERTIFICATE_STATUS_TONE / CERTIFICATE_STATUS_LABEL in src/lib/certificate-display-status.ts"
affects: []
tech-stack:
  added: []
  patterns:
    - "Landing page reuses 11-22 listCertificateIssuanceSources (one batched call for exactly the rows shown)"
    - "Server Component page tested by direct invocation plus renderToStaticMarkup in the node project"
key-files:
  created:
    - src/app/staff/certificates/RecentlyIssuedList.tsx
    - tests/components/recently-issued-list.test.tsx
    - tests/certificates-landing-page.test.ts
  modified:
    - src/app/staff/certificates/page.tsx
    - src/lib/certificate-display-status.ts
    - src/app/staff/certificates/issued/IssuedCertificatesTable.tsx
key-decisions:
  - "No email/notification added: certificate emails are Phase 13 scope; each row links to the detail page, which already states the issuer"
  - "SUPERSEDED rows excluded from the recent list so staff see the replacement"
  - "Status tone/label maps moved into the pure certificate-display-status module and shared, not forked"
requirements-completed: [CRD-01, CRD-02]
duration: 20min
completed: 2026-09-19
---

# Phase 11 Plan 23: Recently issued on the Certificates landing page Summary

Staff opening Certificates now see the newest ten certificates, each marked Automatic or with the issuing staff member's name, below the pending queue, so an automatic issuance is no longer invisible while the queue reads "Nothing awaiting issuance" (closes the landing-page half of UAT test 8).

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1. RecentlyIssuedList | 34a59b2 | New component tests were red (module missing) before the component existed |
| 2. Landing page wiring | 84a95fe | 7 of 9 page tests failed against the old page before wiring; the other 2 are labelled guards |

- `RecentlyIssuedList` renders learner, award, timestamp, status pill (via `certificateDisplayStatus`, so flagged and revoked never show as plain Active), and an Issued-by label: an accent "Automatic" pill, the staff name, "Staff member", or "Not recorded". Each row links to `/staff/certificates/issued/{id}`. Empty state: "No certificates have been issued yet." Names and titles use `break-words`, no truncation. A "View all certificates" link ends the section.
- The page loads `listPendingIssuance()` and `certificateService.list({})` in the same try block, drops SUPERSEDED, sorts by `issuedAt` descending, takes 10, then calls `listCertificateIssuanceSources` once with exactly those ids (skipped when empty). Any `AuthenticationError`/`AuthorizationError` from any of the three reads still gives `notFound()`. Heading, header links, queue and its copy are unchanged. No `dynamic`/`revalidate` export.

## Deviations from Plan

**1. [Rule 3 - Blocking] Design tokens.** My first draft used `text-muted` and `bg-surface-muted`, which do not exist in this repo. Replaced with `text-muted-foreground` and `bg-surface-2` as used in sibling components. Caught before the first test run passed.

**2. TDD commit granularity.** As in 11-22, test and implementation are in one commit per task; red was verified by running the suites first.

The status tone/label maps were not exported from the table, so per the plan they were moved to `src/lib/certificate-display-status.ts` and imported by both files. The existing `certificate-record` tests stay green.

## Verification

- `tests/certificates-landing-page.test.ts`, `tests/components/recently-issued-list.test.tsx`, `tests/components/certificate-queue.test.tsx`, `tests/components/certificate-record.test.tsx`: 52/52 green.
- `tests/boundary.test.ts` and `tests/certificate-phase-invariants.test.ts`: 24/24 green.
- `npx tsc --noEmit` exit 0. `npx next build` clean.
- No raw hex and no `revocationReason` in the new component or page; `package.json` and `package-lock.json` unchanged.
- Browser re-check of UAT test 8 is left for the orchestrator/user.

## Threat model

T-11-95 (denial from any of the three reads becomes notFound, tested per read), T-11-96 (only name, award, timestamp, status, source label rendered; guard test), T-11-97 (no static/revalidate export; page dynamic via authenticated reads), T-11-SC (nothing installed) all mitigated. No new threat surface.

## Known Stubs

None.

## Self-Check: PASSED

Commits 34a59b2 and 84a95fe exist; created and modified files present.
