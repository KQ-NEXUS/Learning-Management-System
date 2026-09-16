# Phase 11 Decisions

| Decision | Chosen | Rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| PDF construction library | Option A | `pdf-lib` 1.17.1 with `@pdf-lib/fontkit` 1.1.1 uses explicit coordinates that map directly to positioned certificate elements and supports custom font embedding without a browser binary. The plan's `@pdf-lib/fontkit` 2.0.4 pin was corrected after npm returned `ETARGET`; the human then verified the official npm/GitHub listing and explicitly approved 1.1.1. | Human — replies recorded verbatim: “Option A” and approval of exactly `pdf-lib@1.17.1` and `@pdf-lib/fontkit@1.1.1` | 2026-09-16 |
