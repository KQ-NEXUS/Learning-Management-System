# Phase 6: Registration, Checkout & Stripe Payments - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 6-Registration, Checkout & Stripe Payments
**Areas discussed:** Checkout flow shape, Seat hold + abandonment UX, Identity timing during checkout, Order/receipt confirmation experience

---

## Checkout flow shape

| Option | Description | Selected |
|--------|-------------|----------|
| Stripe Checkout (hosted, redirect) | Least build effort, minimal PCI scope, briefly leaves branding | ✓ |
| Embedded Stripe Elements | Inline, matches design system fully, more build/error-handling work | |

| Option | Description | Selected |
|--------|-------------|----------|
| Order summary page first | In-app review of cohort/price/policies before redirecting to Stripe | ✓ |
| Minimal — straight to payment | Skip dedicated review page | |

| Option | Description | Selected |
|--------|-------------|----------|
| Card only for v1 | Simpler; wallets addable later without schema change | ✓ |
| Include wallets now | Apple Pay/Google Pay at launch | |

| Option | Description | Selected |
|--------|-------------|----------|
| Inline retry on the same order | Retry a different card against the same Order/hold | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| "Confirming payment..." interstitial | Waits for server-verified webhook before showing success | ✓ |
| Show success immediately on redirect | Trust the redirect, reconcile later if wrong | |

| Option | Description | Selected |
|--------|-------------|----------|
| Resume the existing PENDING order | Reuse prior order/hold if not expired | |
| Always start a new order | Simpler; abandoned orders expire on their own | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Always the cohort's stored currency | Matches schema's per-cohort currency field | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only review + consent only | No editable fields; single-seat self-enrolment model | ✓ |
| You decide | | |

**User's choice:** Stripe Checkout (hosted), with an in-app order-summary review page, card-only, inline retry on decline, a confirming-payment interstitial pending webhook confirmation, always-new-order on retry, cohort's own currency, read-only review page.
**Notes:** No additional notes beyond the selections above.

---

## Seat hold + abandonment UX

| Option | Description | Selected |
|--------|-------------|----------|
| On "Enroll" click (before summary) | Reserves seat immediately; countdown shown on summary page | ✓ (Claude recommendation, confirmed) |
| Only when Stripe payment starts | Less contention from window-shoppers, risk of sell-out before payment | |

| Option | Description | Selected |
|--------|-------------|----------|
| Clear error + back to cohort page | Return to cohort page to re-check availability | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Visible countdown timer | "Seat held for 9:47" style urgency UI | ✓ |
| No visible countdown | Hold invisible until it expires | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse cohort.holdMinutes | Same value Phase 5's staff-facing addEnrolment already uses | ✓ |
| You decide | | |

**User's choice:** Hold on Enroll click, clear error + return to cohort page on expiry, visible countdown, reuse cohort.holdMinutes.
**Notes:** Mid-discussion, user pointed to a WhatsApp-transferred folder containing the complete Phase 5 GSD bundle (16 plan/summary pairs, CONTEXT, RESEARCH, SECURITY, UAT, VALIDATION) that had never been copied into this repo's `.planning/`. It was copied in during this discussion. Phase 5's own `05-CONTEXT.md` (D-01–D-05) had already locked the seat-hold mechanism (PENDING_PAYMENT + shared takeSeat/releaseSeat helper, 30min default holdMinutes, auto-release worker) and explicitly states "Phase 6 checkout calls the same helper — it is not re-implemented," which directly informed the hold-trigger recommendation. Claude recommended holding on "Enroll" click (consistent with the already-chosen visible countdown) and the user accepted the recommendation after asking "what do you recommend?"

---

## Identity timing during checkout

| Option | Description | Selected |
|--------|-------------|----------|
| Must verify before paying | Payment blocked until email verified; safer for REG-05 confirmation delivery and fraud exposure | ✓ (Claude recommendation, confirmed) |
| Can pay while unverified | Less friction, more fraud/delivery risk | |

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve selection through auth (REG-02) | Cohort selection remembered through sign-in/registration | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Sign in/register required to see order summary | Unauthenticated visitor routed to auth first | ✓ |
| Guest can view order summary first | Summary visible before auth | |

**User's choice:** Verification required before payment (accepted Claude's recommendation), selection preserved through auth (mechanism left to planner), sign-in required before seeing the order summary.
**Notes:** User asked "what do you recommend?" for the verification-timing question; Claude recommended requiring verification before payment based on REG-05's confirmation-email requirement and fraud/chargeback exposure, and the user confirmed.

---

## Order/receipt confirmation experience

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmation + clear next-step CTA | Order details plus one clear action pointing to /account | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| On-screen page only for v1 | The order page itself is the receipt | ✓ |
| Also generate a downloadable PDF | Added scope for a nice-to-have | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Phase 3's Brevo wrapper | Same minimal send-wrapper as verification/reset emails | ✓ |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Static contact info (mailto/phone) | Simple contact line, upgradeable once Phase 12 ships | ✓ |
| You decide | | |

**User's choice:** Confirmation page with next-step CTA, on-screen receipt only (no PDF), reuse Phase 3's email wrapper, static support contact info.
**Notes:** No additional notes beyond the selections above.

---

## Claude's Discretion

- Exact mechanism for preserving cohort selection through auth (query param vs. session vs. DB-backed intent record).
- Exact visual layout of the confirmation and order-summary pages (use existing 04.1 design-system primitives).
- Source of static support contact info, if it exists elsewhere in the app already.

## Deferred Ideas

- Embedded Stripe Elements — deferred in favor of hosted Checkout for v1.
- Apple Pay / Google Pay wallets — deferred to a later config toggle.
- Downloadable/printable PDF receipts — deferred; on-screen page is the receipt for v1.
- Real support-ticket linking on confirmation — deferred to Phase 12.
- Order-resume logic for abandoned checkouts — explicitly rejected in favor of always-new-order.
