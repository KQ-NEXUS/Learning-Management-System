# Phase 11 Decisions

| Decision | Chosen | Rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| PDF construction library | Option A | `pdf-lib` 1.17.1 with `@pdf-lib/fontkit` 1.1.1 uses explicit coordinates that map directly to positioned certificate elements and supports custom font embedding without a browser binary. The plan's `@pdf-lib/fontkit` 2.0.4 pin was corrected after npm returned `ETARGET`; the human then verified the official npm/GitHub listing and explicitly approved 1.1.1. | Human — replies recorded verbatim: “Option A” and approval of exactly `pdf-lib@1.17.1` and `@pdf-lib/fontkit@1.1.1` | 2026-09-16 |
| Certificate-template authoring permission | `new-manage` — `certificates.manage` | Template authoring controls the visual identity of every issued credential and must be independently grantable from manual issuance and revocation. Plan 11-05 must add `certificates.manage` to `src/server/permissions/catalogue.ts` and update the default-role seed; this is an in-scope addition to Plan 11-05 rather than a new plan. | Human — reply recorded verbatim: “new-manage” | 2026-09-16 |
