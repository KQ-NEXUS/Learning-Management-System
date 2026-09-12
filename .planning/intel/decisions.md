# Decisions (ADR-sourced)

No documents classified as `ADR` were present in this ingest batch (`CLASSIFICATIONS_DIR` contained 1 PRD, 2 SPEC, 3 DOC — zero ADR). No entries to record here.

Architecture-style decisions embedded inside SPEC and DOC documents (e.g. "D1–D4" in `docs/superpowers/specs/2026-09-01-track-a-foundation-design.md`, and the "no Auth.js" decision in `docs/superpowers/plans/2026-09-01-auth-and-courses-slice.md`) are routed to `constraints.md` and `context.md` respectively, per their document classification, not here. None of them carry `locked: true`.

If a future ingest introduces an ADR, populate this file using:
```
## ADR-{id}: {title}
- source: {path}
- status: locked (Accepted) | proposed
- decision: {statement}
- scope: {scope}
```
