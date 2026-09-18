---
phase: 11-certificates-completion-lifecycle
plan: 15
subsystem: ui
tags: [nextjs, react, resourcetable, detaillayout, confirmmodal, zod, server-actions]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "certificate-service.ts's list/get/revokeCertificate/reissueCertificate (plan 11-11), certificateDisplayStatus (UI-SPEC §5 precedence helper)"
provides:
  - "Full certificate-record list at /staff/certificates/issued (All/Active/Flagged/Revoked filter, no inline destructive actions)"
  - "Certificate detail page at /staff/certificates/issued/[id] (facts, revoked/flagged banners, one-hop-each-way supersede chain)"
  - "Revoke and reissue mutations with server-enforced 10-character mandatory reasons and audit trail"
  - "getCertificateIssuer -- resolves a certificate's issuing actor from its own AuditEvent row"
  - "src/lib/certificate-display-status.ts -- the pure, client-safe extraction of certificateDisplayStatus"
affects: [12-support-tickets, 13-communications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure display-logic modules under src/lib/ for anything a \"use client\" component must call from a server-service module (avoids pulling Prisma/withPermission/next-headers into the browser bundle)"
    - "A \"use server\" action file exports async validate*Input wrappers around its module-private zod schemas so tests can assert schema behavior directly without importing a non-function binding a Server Actions file cannot export"

key-files:
  created:
    - src/app/staff/certificates/issued/page.tsx
    - src/app/staff/certificates/issued/IssuedCertificatesTable.tsx
    - "src/app/staff/certificates/issued/[id]/page.tsx"
    - "src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx"
    - "src/app/staff/certificates/issued/[id]/certificate-record-actions.ts"
    - src/lib/certificate-display-status.ts
    - tests/components/certificate-record.test.tsx
  modified:
    - src/server/services/certificate-service.ts
    - tests/certificate-service.test.ts
    - tests/certificate-revocation.test.ts

key-decisions:
  - "Extracted certificateDisplayStatus into src/lib/certificate-display-status.ts (Rule 3 auto-fix) -- IssuedCertificatesTable is a \"use client\" component and importing the value from certificate-service.ts dragged Prisma/withPermission/next/headers into the browser bundle, failing next build"
  - "Added getCertificateIssuer to certificate-service.ts (Rule 2 auto-fix) -- resolves the detail page's \"Issued by\" fact from the certificate's own issuance AuditEvent row, gated by certificates.view, mirroring roster-service.ts's own-record AuditEvent read rather than the GLOBAL-only audit.view"
  - "Revoke/reissue schemas stay module-private in certificate-record-actions.ts with exported async validate*Input wrappers, since a \"use server\" file may only export async functions -- satisfies both the literal grep-based .strict() acceptance criterion and the plan's \"assert the schema directly\" test requirement"

patterns-established:
  - "certificateDisplayStatus is the single source of truth for certificate status tone everywhere (queue, list, detail, dashboard) -- never recompute from status alone"

requirements-completed: [CRD-03, CRD-05, CRD-06]

# Metrics
duration: 55min
completed: 2026-09-18
---

# Phase 11 Plan 15: Staff Certificate Record Surface Summary

**Filterable full certificate list, a facts/banner/supersede-chain detail page, and revoke/reissue mutations with a server-enforced 10-character mandatory reason -- all driven by one precedence helper so a flagged certificate can never render as plainly "Active".**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3
- **Files modified:** 10 (7 created, 3 modified)

## Accomplishments

- `/staff/certificates/issued` -- the full certificate record list with the All/Active/Flagged/Revoked segmented filter, mono `break-all` verification references, and zero inline row actions (revoke/reissue live only on the detail page)
- `/staff/certificates/issued/[id]` -- award facts, the "Issued {date} by {actor or System (automatic issuance)}" fact resolved from the certificate's own audit trail, revoked/flagged banners (revoked always wins), and the one-hop-each-way supersede chain
- Revoke (`tone="danger"`) and Reissue (`tone="default"`) actions, both gated behind a `ConfirmModal` with `minReasonLength={10}`, both re-enforced server-side by a `.strict()` zod schema independent of the client control
- A successful reissue navigates staff to the NEW certificate's detail page, not the just-superseded one

## Task Commits

Each task was committed atomically:

1. **Task 1: Issued list with the four-branch status pill** - `86a3dd1` (feat)
2. **Task 2: Certificate detail — facts, banners, supersede chain** - `c106a5c` (feat)
3. **Task 3: Revoke and reissue actions** - `0800e72` (feat)

## Files Created/Modified

- `src/app/staff/certificates/issued/page.tsx` - Server page listing all certificates (GLOBAL-scope `certificateService.list({})`, `notFound()` on auth failure)
- `src/app/staff/certificates/issued/IssuedCertificatesTable.tsx` - Client table: four-branch status pill, All/Active/Flagged/Revoked filter, no inline actions
- `src/app/staff/certificates/issued/[id]/page.tsx` - Detail page: `DetailFacts`, revoked/flagged banners, supersede chain, wires `CertificateRecordActions` into the header
- `src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx` - Client action zone: Revoke/Reissue/nothing per display status, two `ConfirmModal`s
- `src/app/staff/certificates/issued/[id]/certificate-record-actions.ts` - `"use server"` revoke/reissue actions, `.strict()` schemas, fixed error-message mapping
- `src/lib/certificate-display-status.ts` - New pure module: `certificateDisplayStatus`/`CertificateDisplayStatus`, extracted from `certificate-service.ts`
- `src/server/services/certificate-service.ts` - Re-exports `certificateDisplayStatus` from the new pure module; adds `getCertificateIssuer` (+ `CertificateAuditStore`/`CertificateIssuerRow` types, `auditStore` dep)
- `tests/certificate-service.test.ts`, `tests/certificate-revocation.test.ts` - Added the new required `auditStore` stub to each harness's `createCertificateService` call
- `tests/components/certificate-record.test.tsx` - New: 22 tests covering all three tasks

## Decisions Made

- `certificateDisplayStatus` now lives in `src/lib/certificate-display-status.ts` as a pure, dependency-free module; `certificate-service.ts` re-exports it so every existing server-side import keeps working unchanged.
- `getCertificateIssuer` resolves the issuing actor from the certificate's own `AuditEvent` row (`action` in `["certificate.issued", "certificate.issued_auto"]`), gated by `certificates.view` at the certificate's own scope -- never the GLOBAL-only `audit.view` a plain `audit-read-service.ts` call would have required.
- The supersede chain's reverse hop ("Superseded by") is resolved via `certificateService.list({ where: { supersedesId }, scope })` using the SAME enrolment's cohort scope the forward `get` already proved reachable; both chain lookups are best-effort and degrade to "no chain fact shown" on failure rather than 404ing the whole record.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted `certificateDisplayStatus` into a pure `src/lib/` module**
- **Found during:** Task 1 verification (`npx next build`)
- **Issue:** `IssuedCertificatesTable.tsx` is a `"use client"` component. Importing the *value* `certificateDisplayStatus` from `@/server/services/certificate-service` (even though the function itself is pure) pulled that module's server-only import graph -- `@prisma/client`, `withPermission`, and transitively `next/headers` -- into the client bundle, and Turbopack failed the build with "You're importing a module that depends on 'next/headers' ... in the Pages Router."
- **Fix:** Moved `certificateDisplayStatus`/`CertificateDisplayStatus` into a new dependency-free `src/lib/certificate-display-status.ts`. `certificate-service.ts` now re-exports both from there, so every existing server-side `import ... from "@/server/services/certificate-service"` (e.g. `enrolment-dashboard-service.ts`, the detail page) keeps working unchanged; the client table imports the value directly from the pure module, and `CertificateRow`/`CertificateDisplayStatus` types stay `import type`-only where used client-side (fully erased, no bundle impact).
- **Files modified:** `src/lib/certificate-display-status.ts` (new), `src/server/services/certificate-service.ts`, `src/app/staff/certificates/issued/IssuedCertificatesTable.tsx`, `src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx`
- **Verification:** `npx next build` clean; all new routes listed; `npx tsc --noEmit` exits 0
- **Committed in:** `86a3dd1` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added `getCertificateIssuer` to `certificate-service.ts`**
- **Found during:** Task 2 (the "Issued {date} by {actor}" fact)
- **Issue:** The plan's own Task 2 text anticipates this: "Resolve this from the audit trail rather than inventing a column on `Certificate`... if the audit lookup is not reachable from the current read, say so in the summary." No existing exported function reads a `Certificate`'s own issuance audit row at `certificates.view` scope -- `audit-read-service.ts`'s `list` is GLOBAL-only (`audit.view`), a much broader grant a scoped certificate reviewer should not need.
- **Fix:** Added `getCertificateIssuer(id)` to `certificate-service.ts`, gated by `certificates.view` at the same scope `get` already uses, reading the certificate's own `AuditEvent` row (`targetType: "Certificate"`, `action` in `["certificate.issued", "certificate.issued_auto"]`) -- the exact "read a record's own history off `AuditEvent`, gated by the record's own permission" shape `roster-service.ts` already established for `Enrolment`. Required adding a new `auditStore` dependency to `CertificateServiceDeps`, wired to `prisma.auditEvent` in the live binding, and a matching stub added to the two existing test harnesses (`tests/certificate-service.test.ts`, `tests/certificate-revocation.test.ts`) so they keep compiling.
- **Files modified:** `src/server/services/certificate-service.ts`, `tests/certificate-service.test.ts`, `tests/certificate-revocation.test.ts`
- **Verification:** Both existing test files pass (43 tests); new detail-page tests assert both the system-issued and staff-issued branches
- **Committed in:** `86a3dd1` (bundled with Task 1's commit since it is a small, self-contained service addition landed before Task 2's page consumes it)

**3. [Rule 3 - Blocking] Server action schemas kept module-private with async `validate*Input` test wrappers**
- **Found during:** Task 3 (writing `certificate-record-actions.ts`)
- **Issue:** Next.js's Server Actions constraint disallows a `"use server"` file from exporting anything other than async functions. The plan's acceptance criteria require both (a) `.strict()` to appear at least twice in `certificate-record-actions.ts` and (b) a test that "asserts the schema directly... without calling the action" -- which would normally mean exporting the zod schema value directly, an export Next.js rejects from this file.
- **Fix:** Kept both `.strict()` schemas defined (not exported) inside `certificate-record-actions.ts`, and added two exported `async function validateRevokeCertificateInput`/`validateReissueCertificateInput` wrappers that just call `.safeParse` -- valid async-function exports that let a test assert schema rejection directly, independent of `revokeCertificateAction`/`reissueCertificateAction`'s own `safeParse` call.
- **Files modified:** `src/app/staff/certificates/issued/[id]/certificate-record-actions.ts`
- **Verification:** `npx tsc --noEmit` and `npx next build` both clean (a non-async or non-function export from this file would have failed the build); `grep -c "strict()" certificate-record-actions.ts` returns 3
- **Committed in:** `0800e72` (Task 3 commit)

**4. [Rule 1 - Bug] Reworded two docstring comments that literally contained grep-checked substrings**
- **Found during:** Running the plan's own acceptance-criteria greps after implementation
- **Issue:** `IssuedCertificatesTable.tsx`'s comment said "never `truncate`" (matching the `grep -c "truncate"` acceptance check, which requires 0), and `CertificateRecordActions.tsx`'s docstring named `RotateCcw` by identifier when explaining why reissue uses a different icon (matching the `grep -c "RotateCcw"` check, which also requires 0). Neither comment reflected a real code defect -- both were prose false positives against a literal grep gate.
- **Fix:** Reworded both comments to convey the same intent without the literal matched substrings.
- **Files modified:** `src/app/staff/certificates/issued/IssuedCertificatesTable.tsx`, `src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx`
- **Verification:** Both greps now return 0
- **Committed in:** `86a3dd1` and `0800e72` respectively

---

**Total deviations:** 4 auto-fixed (1 blocking client-boundary bug, 1 missing critical functionality, 1 blocking Server-Actions-constraint workaround, 1 grep-false-positive wording fix)
**Impact on plan:** All four were necessary for correctness (client bundle boundary), literal acceptance-criteria compliance (schema export constraint, grep wording), or the plan's own explicitly-anticipated functionality (issuer resolution). No scope creep beyond what the plan's own task text called for.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The staff certificate lifecycle (issue → find/filter → revoke → reissue) is now fully wired end to end; CRD-03, CRD-05, CRD-06 are complete.
- `certificateDisplayStatus`'s client-safe pure-module extraction is a reusable precedent for any future `"use client"` component that needs a server-service's pure display-logic helper without its Prisma-bound import graph.
- Plan 11-16 (the final plan in this phase) can proceed; no blockers identified.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
