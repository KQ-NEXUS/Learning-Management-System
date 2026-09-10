# Phase 6: User Setup Required

**Generated:** 2026-09-10
**Phase:** 06-registration-checkout-stripe-payments
**Status:** Incomplete

Complete these items for the Stripe integration to be fully wired. Claude automated everything
possible in plan 06-01; these items require human access to Stripe's dashboard/CLI or arrive
naturally once plan 06-03 builds the webhook route.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [x] | `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → Secret key (TEST mode) | `.env.local` (done — provided by user 2026-09-10, TEST mode, account country USA) |
| [ ] | `STRIPE_WEBHOOK_SECRET` | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (local dev) or Stripe Dashboard → Developers → Webhooks → {endpoint} → Signing secret (deployed) | `.env.local` |

`STRIPE_WEBHOOK_SECRET` is deliberately left unset. The webhook route
(`src/app/api/webhooks/stripe/route.ts`) does not exist yet — it is built in plan 06-03. Obtaining
a `whsec_...` value before that route exists has nothing to verify signatures against. This is not
a blocker for 06-01 or 06-02; it becomes actionable once 06-03 lands.

## Account Setup

Already complete — user confirmed on 2026-09-10 via https://www.npmjs.com/package/stripe that the
`stripe` package repository link, download volume, version history, and publisher are genuine
(approved version 22.6.1), and separately provided TEST-mode Stripe credentials (secret key,
account country USA). No new Stripe account creation is needed.

## Dashboard Configuration

- [x] **Confirm the account country and that NGN is an accepted presentment currency**
  - Location: Stripe Dashboard → Settings → Business → Account details / Payment methods
  - User-reported account country: USA
  - **Result:** VERIFIED PROGRAMMATICALLY — plan 06-01's NGN probe created a real test-mode
    Checkout Session (`cs_test_...`) using `currency: "ngn"` and the seeded cohort price
    (45,000,000 minor units) against this account, and it succeeded. See
    [06-01-SUMMARY.md](./06-01-SUMMARY.md) "Stripe NGN probe" section for the verbatim result.
    No further dashboard action needed for this item.

- [ ] **Obtain and set `STRIPE_WEBHOOK_SECRET` once 06-03 creates the webhook route**
  - Location: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (prints
    `whsec_...`) for local dev, or Stripe Dashboard → Developers → Webhooks → Add endpoint →
    Signing secret for a deployed environment
  - Notes: The Stripe CLI (`stripe`) was not found on this machine as of 2026-09-10 — install it
    (https://docs.stripe.com/stripe-cli) before running `stripe listen`, or use the Dashboard path.

## Verification

After completing the remaining item, verify with:

```bash
# Confirm the webhook secret is present (does not print the value)
grep -c "^STRIPE_WEBHOOK_SECRET=." .env.local

# Confirm the webhook route rejects an unsigned request with 400, not a 500 crash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" -d '{}'
```

Expected results:
- The grep returns `1` once `STRIPE_WEBHOOK_SECRET` is set to a non-empty value.
- The curl command returns `400` (signature verification working) — only meaningful after 06-03
  creates the route; running it before then will 404, which is expected.

---

**Once all items complete:** Mark status as "Complete" at top of file.
