---
phase: 11-certificates-completion-lifecycle
plan: 22
subsystem: certificates
tags: [gap-closure, uat-test-8, certificates, audit, staff-ui]
requires: ["11-16"]
provides:
  - "listCertificateIssuanceSources + IssuanceSource (batched, authorized issuer lookup)"
  - "Issued by column and filter on the All certificates list"
affects: [11-23]
tech-stack:
  added: []
  patterns:
    - "Batched audit read behind certificates.view at the same global scope as certificateService.list({})"
    - "import type only for service types in a use-client component"
key-files:
  created: []
  modified:
    - src/server/services/certificate-service.ts
    - src/app/staff/certificates/issued/page.tsx
    - src/app/staff/certificates/issued/IssuedCertificatesTable.tsx
    - tests/certificate-service.test.ts
    - tests/certificate-revocation.test.ts
    - tests/components/certificate-record.test.tsx
key-decisions:
  - "Issued by column and filter render only when the sources prop is supplied, keeping existing table tests and callers unchanged (two segmented filters would otherwise duplicate the All button and break existing role queries)"
  - "Missing audit row maps to not-recorded ('Not recorded'), never Automatic"
requirements-completed: [CRD-01, CRD-02]
duration: 20min
completed: 2026-09-19
---

# Phase 11 Plan 22: Issued-by source in the All certificates list Summary

The staff issued list now shows whether each certificate was issued automatically or by a named staff member, and can be filtered by that, from a single batched authorized audit read (closes the data half of UAT test 8).

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1. listCertificateIssuanceSources | 61f5a30 | 9 new service tests, all failing before the function existed |
| 2. Issued-by column and filter | 82685e4 | 6 of 7 new component tests failed before; the 7th is a labelled guard (no `sources` prop renders as before) |

- `listCertificateIssuanceSources` is wrapped in `withPermission("certificates.view", () => ({}))` (global scope, same as `list({})`). It makes one `auditEvent.findMany` filtered on targetType Certificate, the requested ids, and exactly the two issuance actions, ordered newest first. The first row per id wins. Ids with no row become `not-recorded`. An empty list returns `{}` without querying. The result carries only `{ kind, actorName }`, with no actor id.
- The table adds an "Issued by" column after "Issued" (Automatic / staff name / "Staff member" / "Not recorded") and an "Issued by" filter (All / Automatic / Staff) that composes with Status. Clear filters resets both. `activeFilterCount` and `activeQuery` include both.
- The page calls the lookup once, inside the existing try block, so authorization failures still become `notFound()`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Filter and column only rendered when `sources` is passed.** The plan says no-`sources` must render exactly as before. Adding a second three-option filter unconditionally would have made two "All" buttons and broken the existing `getByRole("button", {name: "All"})` test, so both are conditional on `sources !== undefined`. The page always passes it.

**2. [Rule 3 - Blocking] `tests/certificate-revocation.test.ts` fake `auditStore` gained `findMany: async () => []`** because `CertificateAuditStore.auditEvent.findMany` is now required by the type (tsc). No behavior change.

**3. TDD commit granularity.** Test and implementation for each task are in one commit rather than separate RED and GREEN commits. Red was verified by running the suites before implementing (9 and 6 failures respectively).

## Verification

- `tests/certificate-service.test.ts`, `tests/certificate-revocation.test.ts`, `tests/components/certificate-record.test.tsx`: green (56 across the first and third plus service).
- `tests/boundary.test.ts` 17/17 and `tests/certificate-phase-invariants.test.ts` 7/7 (run separately).
- `npx tsc --noEmit` exit 0. `npx next build` clean.
- `grep auditEvent src/app/staff/certificates` empty. No diff to package.json, package-lock.json or prisma/ (no install, no migration).

## Threat model

T-11-91 (no actorId in output, tested), T-11-92 (permission plus denied global and cohort-only caller tests), T-11-93 (not-recorded never shown as Automatic, tested), T-11-SC (nothing installed) all mitigated. No new threat surface.

## Known Stubs

None.

## Self-Check: PASSED

Commits 61f5a30 and 82685e4 exist; modified files present.
