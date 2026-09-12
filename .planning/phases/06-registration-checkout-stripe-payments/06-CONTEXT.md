# Phase 6: Registration, Checkout & Stripe Payments - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

A visitor selects an open Cohort, is carried through identity (sign-in/registration/verification) if needed with their selection preserved, reviews order details and accepts required policies, pays via Stripe, and ends up with exactly one traceable Order and one active Enrolment — with confirmation shown on-screen and emailed. This phase covers Stripe only (Paystack/manual/refunds are Phase 7); it reuses Phase 5's seat-accounting mechanism rather than reimplementing it, and reuses Phase 3's minimal email-send wrapper rather than building Phase 13's full notification system.

</domain>

<decisions>
## Implementation Decisions

### Checkout flow shape

> **Supersession notice (approved 2026-09-11):** D-07 describes the Phase 6 tracer as implemented. Phase 7 replaces it with administrator-entered NGN and USD base prices, NGN-only Paystack routing, USD-only Stripe routing, an immutable base/platform/gateway/total snapshot, and provider-native split settlement. Existing Phase 6 tests remain historical regression evidence and must be migrated deliberately; D-07 is not the future pricing contract.
- **D-01:** Payment uses **Stripe Checkout** (hosted, redirect) — not embedded Stripe Elements. Lowest build effort for a first Stripe integration, PCI scope stays minimal. — **Reversibility:** costly — switching to embedded Elements later means rebuilding the payment step's UI and its redirect/webhook handling.
- **D-02:** The app shows its **own order-summary/review page** before redirecting to Stripe — cohort details, price, dates, and required policy checkboxes (terms/refund-cancellation/marketing) all render there, not on Stripe's page.
- **D-03:** **Card only** at launch — no Apple Pay / Google Pay wallet buttons for v1. Both Stripe Checkout and Elements support enabling wallets later without a schema change, so this is purely a config toggle to revisit.
- **D-04:** On a card decline, the learner gets an **inline retry on the same Order** (not a new order) — they can try a different card against the same seat hold, provided it hasn't expired.
- **D-05:** After Stripe redirects back, the learner sees a **"Confirming payment..." interstitial** while the app waits for the server-verified webhook (PAY-10) to actually flip the order to PAID — the redirect itself never marks anything paid. The interstitial resolves to the real confirmation page once the webhook lands (poll or refresh).
- **D-06:** Abandoning checkout and starting again **always creates a new Order** — no resuming a prior PENDING order. Abandoned orders/holds clean up via Phase 5's existing hold-expiry worker; this phase does not need order-resume logic.
- **D-07:** The Stripe charge always uses the **cohort's own stored currency** (`Cohort.currency`/`amountMinor`) — no platform-wide default currency override.
- **D-08:** The order-summary/review page is **read-only** — review + policy consent only, no editable fields (no quantity/cart concept; the schema is single-seat self-enrolment).

### Seat hold + abandonment UX
- **D-09:** The seat hold (`PENDING_PAYMENT` enrolment via Phase 5's shared `takeSeat` helper in `seat-accounting.ts`) is created **on the "Enroll" click, before the order-summary page** — not deferred until the Stripe step. Chosen over holding at the payment step because the order-summary page also carries a visible countdown (D-11), which only makes sense if the hold already exists when the page loads; it also avoids a visitor reading policies in good faith only to find the seat gone when they try to pay. — **Reversibility:** reversible — a single call-site move (which action creates the PENDING_PAYMENT row), no schema change.
- **D-10:** If the hold expires while the learner is still mid-checkout (summary page or Stripe), they see a **clear error and are returned to the cohort's public page** to re-check availability and start over (consistent with D-06 — a fresh Order every attempt).
- **D-11:** The order-summary page shows a **visible countdown timer** for the seat hold (e.g. "Seat held for 9:47") — deliberate urgency/expectation-setting, not a silent server-side hold.
- **D-12:** The checkout hold window reuses **`Cohort.holdMinutes`** — the same per-cohort field Phase 5's staff-facing `addEnrolment` already reads (default 30 min). No separate checkout-specific hold duration. Per Phase 5's own D-04: "Phase 6 checkout calls the same helper — it is not re-implemented."

### Identity timing during checkout
- **D-13:** Email verification **must complete before payment** — an account can register, sign in, and reach the order-summary page while `PENDING_VERIFICATION`, but the "pay" action blocks with a clear "verify your email first" message until verification completes. Chosen because REG-05's confirmation email needs a proven-real address, and tying payment to a confirmed identity reduces fraud/chargeback exposure. — **Reversibility:** reversible — a single guard condition on the payment-initiation action.
- **D-14:** An unauthenticated visitor's cohort selection is **preserved through sign-in/registration/verification** (REG-02) so they land back on that cohort's order-summary page automatically afterward. Exact mechanism (return-to param vs. short-lived server-side intent record) is left to the planner, informed by Phase 3's existing post-auth redirect pattern (D-15 in `03-CONTEXT.md`).
- **D-15:** A visitor must be **signed in and registered to even see the order-summary page** — clicking "Enroll" while unauthenticated routes straight to sign-in/registration first (carrying the selection per D-14), and the order-summary page only renders once authenticated. Consistent with D-09: the seat hold is tied to a real `userId` from the moment it's created, so there's no unauthenticated "browse the summary" state to support.

### Order/receipt confirmation experience
- **D-16:** The confirmation page shows REG-05's required fields (order reference, offer, amount, payment state, enrolment state, support route) plus **one clear next-step CTA** — pointing wherever `/account` currently leads, since Phase 9's real learner dashboard doesn't exist yet.
- **D-17:** **No downloadable/printable PDF receipt for v1** — the on-screen order page at its order-reference URL *is* the receipt, viewable any time. Matches REG-05's literal wording ("receipt/order record is exposed") without adding a PDF-generation dependency.
- **D-18:** The confirmation email reuses **Phase 3's minimal Brevo send-wrapper pattern** (D-01 in `03-CONTEXT.md`) — a plain, functional order-confirmation email, not Phase 13's richer templating/dedup system.
- **D-19:** The required "support route" on the confirmation page is **static contact info** (e.g. a mailto/phone line) — Phase 12's real ticket system doesn't exist yet; this becomes a real ticket-creation link once it ships.

### Claude's Discretion
- Exact mechanism for preserving cohort selection through auth (D-14) — query param, session, or DB-backed intent record; follow whatever is simplest given Phase 3's existing redirect pattern.
- Exact visual layout of the confirmation page and order-summary page — use the 04.1 design system's existing primitives (e.g. `DetailLayout`).
- Where static support contact info (D-19) is sourced from, if it exists elsewhere in the app already.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product authority
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` — REG-01..05, PAY-02/09/10 full acceptance criteria; §19.1/§19.2 order/payment-attempt design referenced in schema comments
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` — checkout/registration UI-workflow spec

### Requirements
- `.planning/REQUIREMENTS.md` — REG-01 through REG-05, PAY-02, PAY-09, PAY-10 (full acceptance criteria)
- `.planning/PROJECT.md` — Key Decisions table (no-Auth.js, money-in-integer-minor-units, no-hard-deletes constraints all apply here)

### Prior-phase decisions this phase depends on
- `.planning/phases/03-public-identity-registration-verification-secure-sessions/03-CONTEXT.md` — D-06 (registration captures only Terms+Privacy; refund/cancellation + marketing consent deferred here, per D-02 above), D-15 (post-auth redirect pattern, informs D-14), D-12 (marketing-consent `PolicyAcceptance` pattern to reuse for order-bound consent)
- `.planning/phases/05-cohorts-scheduling-enrolment-operations-attendance/05-CONTEXT.md` — D-01 through D-05 (seat-hold mechanism, `holdMinutes`, shared `takeSeat`/`releaseSeat` helper, hold-expiry worker) — **this phase must call these helpers, not reimplement them**
- `.planning/phases/05-cohorts-scheduling-enrolment-operations-attendance/05-REVIEW.md` — 3 CRITICAL findings (CR-01/02/03) in the enrolment/cohort/attendance services this phase's checkout path calls into; candidate fixes exist uncommitted in the working tree as of 2026-09-09 pending user sign-off — planner should confirm these are resolved before building checkout on top of `enrolment-service.ts`/`cohort-service.ts`

### Existing code (source of truth)
- `prisma/schema.prisma` — `Order` (~line 1229: reference, idempotencyKey, correlationId, selectedProvider, status), `PaymentAttempt` (~line 1266: provider, providerRef/providerIntentId, evidence Json, exceptionNote for PAY-07), `Refund`, `PolicyAcceptance` (orderId-nullable, reused here with a real orderId), `Enrolment` (`PENDING_PAYMENT` status), `Cohort` (`holdMinutes`, `amountMinor`, `currency`)
- `src/server/services/seat-accounting.ts` — `takeSeat`, `releaseSeat`, `holdExpiryFrom`, `lockOpenCohort` — the shared seat-hold mechanism this phase's Order/checkout creation must call
- `src/server/services/enrolment-service.ts` — existing `addEnrolment`/`transferEnrolment` show the established transaction/audit/domain-event pattern for enrolment mutations to follow
- `src/server/payments/providers/` — empty placeholder (`.gitkeep` only); no Stripe SDK installed yet — needs a package-legitimacy checkpoint at planning/execution time (same pattern as Phase 04.1's lucide-react/tiptap checks)
- `src/app/(auth)/` — Phase 3's auth page pattern (page.tsx + actions.ts + client form), informs D-14's redirect mechanism
- `.planning/codebase/CONCERNS.md` — "Payment provider integrations (Stripe, Paystack) are schema-only, no logic" gap this phase closes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `takeSeat`/`releaseSeat`/`holdExpiryFrom`/`lockOpenCohort` (`seat-accounting.ts`): call directly for the D-09 seat-hold-on-Enroll step — do not reimplement capacity/hold logic.
- `Order`/`PaymentAttempt`/`Refund` Prisma models: already shaped for multi-provider (Stripe/Paystack/manual), idempotency, and correlation — this phase populates them for Stripe only, Phase 7 adds the other providers to the same models.
- Phase 3's Brevo send-wrapper (`src/server/email/` or equivalent, per `03-CONTEXT.md`'s Integration Points): reused as-is for D-18's confirmation email, not rebuilt.
- `PolicyAcceptance` model with nullable `orderId`: Phase 3 already uses it for registration (orderId null) and the marketing toggle; this phase is the first to populate it with a real `orderId` for refund/cancellation-policy and order-bound marketing consent (REG-04).

### Established Patterns
- Service layer pattern (`src/server/services/*.ts`): one file per concern, `withPermission` for authorization, audit-first write path, domain events — the new order/checkout service should follow the same shape as `enrolment-service.ts`/`cohort-service.ts`.
- No hard deletes, integer minor units for money, `@prisma/client` confined to `src/server/services/**` — all apply directly to Order/PaymentAttempt handling.

### Integration Points
- Checkout order creation calls into `seat-accounting.ts` (seat hold) and will need to call `enrolment-service.ts`'s transition logic (or a Phase-6-owned equivalent) to move `PENDING_PAYMENT` → `ACTIVE` once Stripe's webhook confirms payment.
- New checkout/order routes likely sit under a new `src/app/(checkout)/` or similar group, following the 04.1 design system and the `page.tsx` + `actions.ts` + client-form shape established in `(auth)/`.
- Stripe webhook handler is a new API route (`src/app/api/webhooks/stripe/` or similar) — first webhook-receiving endpoint in the codebase; needs its own signature-verification pattern (PAY-10).

</code_context>

<specifics>
## Specific Ideas

- The order-summary page's countdown timer (D-11) should feel like standard ticketing-checkout UX (e.g. Eventbrite-style "seat held for X:XX") — creates urgency without being alarming.
- The "Confirming payment..." interstitial (D-05) should make clear to the learner that this is normal, brief processing — not an error state.

</specifics>

<deferred>
## Deferred Ideas

- Embedded Stripe Elements (in-app card entry matching the design system pixel-for-pixel) — deferred in favor of hosted Checkout for v1 (D-01); revisit once the payment flow is proven.
- Apple Pay / Google Pay wallet buttons — deferred to a later config toggle (D-03).
- Downloadable/printable PDF receipts — deferred (D-17); the on-screen order page is the receipt for v1.
- Real support-ticket linking on the confirmation page — deferred to Phase 12; static contact info for now (D-19).
- Order-resume logic for abandoned checkouts — explicitly rejected in favor of always-new-order (D-06); Phase 5's hold-expiry worker already cleans up abandoned holds.

### Reviewed Todos (not folded)
None — `todo.match-phase` returned zero matches for Phase 6.

</deferred>

---

*Phase: 6-Registration, Checkout & Stripe Payments*
*Context gathered: 2026-09-09*
