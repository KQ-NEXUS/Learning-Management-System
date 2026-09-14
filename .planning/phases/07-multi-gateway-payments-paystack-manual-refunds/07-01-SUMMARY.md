---
phase: 07-multi-gateway-payments-paystack-manual-refunds
plan: 01
subsystem: payments
tags: [paystack, stripe-connect, settlement-config, checkpoint]

requires: []
provides:
  - "Real Paystack test-mode subaccount and Stripe Connect test-mode connected account provisioned by the repository owner"
  - "src/server/payments/settlement-config.ts — the single fail-closed reader every later plan uses for provider secrets and school settlement identifiers"
  - "Locked refund-reversal and on_behalf_of policy decisions, unblocking 07-06 and 07-08"
affects: [07-04, 07-06, 07-07, 07-08]

actuals:
  tokens: 9500
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Lazy process.env read inside each accessor (mirrors providers/stripe/client.ts's getStripe() shape) — module import never throws even with no env set"
    - "Fail-closed named error (MissingSettlementAccountError) instead of a blank/placeholder fallback for a missing settlement identifier"

key-files:
  created:
    - src/server/payments/settlement-config.ts
    - tests/payments-settlement-config.test.ts
  modified:
    - .env.example

key-decisions:
  - "Stripe refund reversal (Decision A): reverse_transfer: true for a full refund, false for a partial refund (Option A3) — a cancelled enrolment unwinds the school's transfer cleanly; small goodwill/partial refunds leave the school's settlement alone and KQ NEXUS absorbs that smaller amount."
  - "Paystack split-refund handling (Decision B): ship now, record Paystack's actual response (Option B2) — process the refund via the API and record whatever settlement evidence actually comes back; a reconciliation variance flags Finance if the school's balance doesn't move as expected, rather than blocking 07-08 on an unconfirmed provider-support answer."
  - "on_behalf_of requirement (Decision C): both the KQ NEXUS Stripe platform account and the new connected account are registered in the United States — same country — so payment_intent_data.on_behalf_of is NOT required on the Connect destination charge (07-06 reads this as a resolved fact, not a conditional)."

patterns-established:
  - "settlement-config.ts sits above both provider directories and imports nothing from stripe/@prisma/client/providers/ — verified by a source-scan test in tests/payments-settlement-config.test.ts, ahead of 07-04 generalizing the project-wide PAY-09 isolation scan to include it."

requirements-completed: [PAY-13, PAY-14, PAY-17]

coverage:
  - id: D1
    description: "Fail-closed settlement-config reader for PAYSTACK_SECRET_KEY, PAYSTACK_SUBACCOUNT_CODE, STRIPE_CONNECTED_ACCOUNT_ID and the aliased PAYSTACK_WEBHOOK_SECRET, throwing MissingSettlementAccountError (naming the variable, never leaking a value fragment) for absent/blank input, importable with no env set"
    requirement: "PAY-14"
    verification:
      - kind: unit
        ref: "tests/payments-settlement-config.test.ts (19 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Real Paystack test-mode subaccount and Stripe Connect test-mode connected account provisioned outside the LMS (D-05) — genuinely human-only work, not automatable"
    human_judgment: true
    rationale: "No CLI/API this codebase may call substitutes for the account-onboarding checkpoint (D-05); the repository owner confirmed completion interactively and the values now live in .env.local, never echoed back into this conversation or any file per PAY-14."
  - id: D3
    description: "Three settlement/refund policy decisions locked (reverse_transfer split by full/partial refund, Paystack ship-and-record, on_behalf_of not required for this USA/USA pair) before any refund or Connect code exists"
    human_judgment: true
    rationale: "Business-policy decisions with real financial consequences once live settlements exist — the repository owner chose all three options interactively via AskUserQuestion, recorded here as the resolved facts 07-06/07-08 must read rather than re-derive."

duration: 55min
completed: 2026-09-12
status: complete
---

# Phase 07 Plan 01: Provider settlement credentials and locked refund/on_behalf_of policy Summary

**Paystack test subaccount + Stripe Connect test account provisioned, fail-closed settlement-config.ts reader shipped (19/19 tests), and the refund-reversal + on_behalf_of policy decisions locked before any provider code exists.**

## Performance

- **Duration:** ~55 min (mostly interactive credential/decision checkpoints)
- **Tasks:** 3/3
- **Files modified:** 3 (2 new, 1 modified)

## Accomplishments

- Real Paystack test-mode subaccount and Stripe Connect test-mode connected account created by the repository owner (D-05 — genuinely human-only, no LMS-callable API substitutes for this). Both `PAYSTACK_SUBACCOUNT_CODE` and `STRIPE_CONNECTED_ACCOUNT_ID` are in `.env.local`; neither value was ever echoed back into this conversation or written to any tracked file, per PAY-14.
- Both the KQ NEXUS Stripe platform account and the new connected account confirmed registered in the **United States** — same country, so `on_behalf_of` is not required on the Connect destination charge (resolves 07-RESEARCH.md Open Question 2 and Pitfall 3 as a plain fact for 07-06 to read).
- Two refund-policy decisions locked (07-RESEARCH.md Open Question 1 / Pitfall 4): Stripe refunds pass `reverse_transfer: true` for a full refund and `false` for a partial refund; Paystack refunds ship now, recording whatever settlement evidence Paystack's API actually returns and flagging a reconciliation variance if the school's balance doesn't move as expected.
- `src/server/payments/settlement-config.ts` created: four lazy accessors (`paystackSecretKey`, `paystackSubaccountCode`, `stripeConnectedAccountId`, `paystackWebhookSecretKey` — the last aliasing the first, since Paystack signs webhooks with the same secret key) and a `MissingSettlementAccountError` class. Every accessor trims the value, treats whitespace-only as absent, and fails closed with a named error rather than returning a blank/placeholder.
- `.env.example` extended: `STRIPE_CONNECTED_ACCOUNT_ID` and `PAYSTACK_SUBACCOUNT_CODE` documented with placeholder shapes and one-line purpose comments; the pre-existing bare `PAYSTACK_SECRET_KEY`/`PAYSTACK_WEBHOOK_SECRET` lines (already present from a teammate's earlier commit, undocumented) gained the same documentation treatment, and the unused `PAYSTACK_WEBHOOK_SECRET` variable was removed with a comment explaining it aliases the secret key rather than being a second value to configure — confirmed unreferenced anywhere else in the codebase before removal.

## Task Commits

Per this plan's `<global_constraints>` (never run `git commit`), **no commits were made**. All changes are staged with `git add` only:

1. **Task 1: Provision Paystack and Stripe Connect test-mode settlement accounts** — no files changed (external dashboard work; both `.env.local` values confirmed present by the repository owner, not staged/tracked)
2. **Task 2: Lock the refund-reversal policy and the on_behalf_of requirement** — no files changed (decision recorded in this SUMMARY)
3. **Task 3: Fail-closed settlement-config reader and .env.example documentation** — staged: `src/server/payments/settlement-config.ts`, `tests/payments-settlement-config.test.ts`, `.env.example`

**Suggested commit messages** (repository owner creates these explicitly):
- `test(07-01): add failing tests for the fail-closed settlement-config reader`
- `feat(07-01): add settlement-config.ts and document Paystack/Stripe Connect env vars`

## Files Created/Modified
- `src/server/payments/settlement-config.ts` — the single server-side reader for provider secrets and school settlement identifiers; fails closed, never leaks a value fragment
- `tests/payments-settlement-config.test.ts` — 19 tests covering presence/absence/whitespace for all three variables, the webhook-secret alias, no-value-leak-across-sibling-cases, and a provider-isolation source scan
- `.env.example` — documents `STRIPE_CONNECTED_ACCOUNT_ID` and `PAYSTACK_SUBACCOUNT_CODE` (new), plus adds documentation to the pre-existing `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`PAYSTACK_SECRET_KEY` lines; removes the unused, unreferenced `PAYSTACK_WEBHOOK_SECRET` placeholder

## Decisions Made

See `key-decisions` in frontmatter for Decisions A, B, and C in full — all three are now resolved facts, not conditionals, for 07-06 (Stripe Connect) and 07-08 (manual payments/refunds) to read directly.

## Deviations from Plan

**1. [Rule 2 - Missing Critical] Removed the unused `PAYSTACK_WEBHOOK_SECRET` line from `.env.example` instead of merely documenting it**
- **Found during:** Task 3 (`.env.example` documentation)
- **Issue:** A bare `PAYSTACK_WEBHOOK_SECRET=` line already existed in `.env.example` (from a teammate's earlier commit) but this plan's own design — and the Paystack API itself — has no separate webhook-signing secret; Paystack signs with the same `PAYSTACK_SECRET_KEY`. Leaving the variable undocumented and unused invites a future contributor to fill it in and expect it to do something.
- **Fix:** Removed the line, replaced with a comment on `PAYSTACK_SECRET_KEY` explaining it also signs webhooks, referencing `paystackWebhookSecretKey()`.
- **Files modified:** `.env.example`
- **Verification:** `PAYSTACK_WEBHOOK_SECRET` confirmed unreferenced anywhere else in the codebase via grep before removal.

---

**Total deviations:** 1 auto-fixed (1 missing-critical cleanup). **Impact:** Removes a dead, confusing env var; no behavior change since it was never read anywhere.

## Issues Encountered

None — both checkpoints resolved cleanly with the repository owner's direct input; no ambiguity required escalation beyond the plan's own decision options.

## User Setup Required

**External services required manual configuration — already completed by the repository owner during this plan's execution:**
- Paystack test-mode account + subaccount created; `PAYSTACK_SECRET_KEY` and `PAYSTACK_SUBACCOUNT_CODE` in `.env.local`; Paystack Test Webhook URL set to `{BASE_URL}/api/webhooks/paystack`.
- Stripe Connect test-mode connected account created (`acct_1UDaQgDP8AyoFm7U`, confirmed same-country USA pairing); `STRIPE_CONNECTED_ACCOUNT_ID` in `.env.local`. No new Stripe webhook needed — the existing Phase 6 `/api/webhooks/stripe` endpoint already receives destination-charge events since the charge is created on the platform account.

## Next Phase Readiness

- 07-04 (the NGN Paystack tracer, wave 2) can now read `paystackSecretKey()`/`paystackSubaccountCode()` and build the Paystack provider adapter against real test-mode credentials.
- 07-06 (Stripe Connect, wave 3) can read `stripeConnectedAccountId()` and skip `on_behalf_of` entirely — resolved as not required for this deployment.
- 07-08 (manual payments/refunds, wave 5) has both refund-reversal decisions locked and can pass `reverse_transfer` explicitly rather than by omission.
- No blockers. All three credentials confirmed present by the repository owner; none deferred.

---
*Phase: 07-multi-gateway-payments-paystack-manual-refunds*
*Completed: 2026-09-12*
