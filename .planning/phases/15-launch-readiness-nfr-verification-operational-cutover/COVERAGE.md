# API Coverage — Neon REST API (staging and restore tooling, plan 15-29)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
>
> Scope note: Phase 15 adds no product integration with an external API. The only new external API use is the guarded operations script `scripts/ops/neon-branch.ts` (plan 15-29) for the D-01 staging branch and the D-04 point-in-time restore rehearsal. The existing Brevo, Stripe and Paystack integrations are unchanged; the Brevo client only gains a loopback-only base-URL option for tests (plan 15-15). The uptime monitor polls the app and is configured by the owner in its own dashboard, with no API call from this repository.

| capability | decision | reason |
|---|---|---|
| create-branch | INTEGRATE | |
| create-branch-at-timestamp (point-in-time parent) | INTEGRATE | |
| poll-operations-until-ready | INTEGRATE | |
| list-branches | INTEGRATE | |
| delete-branch | INTEGRATE | |
| restore-branch-in-place | OPT-OUT | explicitly out of scope: in-place restore can rewrite a production branch; only new branches at a timestamp are allowed (D-04, P1) |
| connection-uri / passwords | OPT-OUT | not needed: connection strings are supplied by the owner in the shell and never fetched or written by scripts (public repository) |
| endpoints-compute-management | OPT-OUT | not needed: compute size and scale-to-zero are owner plan settings recorded in 15-STAGING.md |
| roles-and-databases | OPT-OUT | not needed: the staging branch inherits roles from its parent |
| projects-management | OPT-OUT | explicitly out of scope: the owner manages the Neon project and plan |
| schema-diff / branch-compare | OPT-OUT | not needed: integrity checks and row counts compare restored data |
| consumption-metrics | OPT-OUT | not needed yet: the owner reads compute usage in the console before approving the full staging run (plan 15-30 Task 2) |
