# Phase 6: Registration, Checkout & Stripe Payments - Research

**Researched:** 2026-09-09
**Domain:** Stripe Checkout (hosted redirect) integration, server-verified webhook processing, seat-hold-to-payment orchestration on top of Phase 5's enrolment/seat-accounting primitives
**Confidence:** MEDIUM-HIGH — the Stripe integration shape is HIGH confidence (official docs + SDK verified); the exact authorization pattern for the webhook-driven enrolment transition is a new architectural decision this research derives from strong in-repo precedent (`hold-release-system-service.ts`), not copied from an existing Phase-6-shaped example, so it is flagged for planner confirmation rather than treated as settled fact.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Checkout flow shape**
- **D-01:** Payment uses **Stripe Checkout** (hosted, redirect) — not embedded Stripe Elements. Lowest build effort for a first Stripe integration, PCI scope stays minimal. — **Reversibility:** costly — switching to embedded Elements later means rebuilding the payment step's UI and its redirect/webhook handling.
- **D-02:** The app shows its **own order-summary/review page** before redirecting to Stripe — cohort details, price, dates, and required policy checkboxes (terms/refund-cancellation/marketing) all render there, not on Stripe's page.
- **D-03:** **Card only** at launch — no Apple Pay / Google Pay wallet buttons for v1. Both Stripe Checkout and Elements support enabling wallets later without a schema change, so this is purely a config toggle to revisit.
- **D-04:** On a card decline, the learner gets an **inline retry on the same Order** (not a new order) — they can try a different card against the same seat hold, provided it hasn't expired.
- **D-05:** After Stripe redirects back, the learner sees a **"Confirming payment..." interstitial** while the app waits for the server-verified webhook (PAY-10) to actually flip the order to PAID — the redirect itself never marks anything paid. The interstitial resolves to the real confirmation page once the webhook lands (poll or refresh).
- **D-06:** Abandoning checkout and starting again **always creates a new Order** — no resuming a prior PENDING order. Abandoned orders/holds clean up via Phase 5's existing hold-expiry worker; this phase does not need order-resume logic.
- **D-07:** The Stripe charge always uses the **cohort's own stored currency** (`Cohort.currency`/`amountMinor`) — no platform-wide default currency override.
- **D-08:** The order-summary/review page is **read-only** — review + policy consent only, no editable fields (no quantity/cart concept; the schema is single-seat self-enrolment).

**Seat hold + abandonment UX**
- **D-09:** The seat hold (`PENDING_PAYMENT` enrolment via Phase 5's shared `takeSeat` helper in `seat-accounting.ts`) is created **on the "Enroll" click, before the order-summary page** — not deferred until the Stripe step. Chosen over holding at the payment step because the order-summary page also carries a visible countdown (D-11), which only makes sense if the hold already exists when the page loads; it also avoids a visitor reading policies in good faith only to find the seat gone when they try to pay. — **Reversibility:** reversible — a single call-site move (which action creates the PENDING_PAYMENT row), no schema change.
- **D-10:** If the hold expires while the learner is still mid-checkout (summary page or Stripe), they see a **clear error and are returned to the cohort's public page** to re-check availability and start over (consistent with D-06 — a fresh Order every attempt).
- **D-11:** The order-summary page shows a **visible countdown timer** for the seat hold (e.g. "Seat held for 9:47") — deliberate urgency/expectation-setting, not a silent server-side hold.
- **D-12:** The checkout hold window reuses **`Cohort.holdMinutes`** — the same per-cohort field Phase 5's staff-facing `addEnrolment` already reads (default 30 min). No separate checkout-specific hold duration. Per Phase 5's own D-04: "Phase 6 checkout calls the same helper — it is not re-implemented."

**Identity timing during checkout**
- **D-13:** Email verification **must complete before payment** — an account can register, sign in, and reach the order-summary page while `PENDING_VERIFICATION`, but the "pay" action blocks with a clear "verify your email first" message until verification completes. Chosen because REG-05's confirmation email needs a proven-real address, and tying payment to a confirmed identity reduces fraud/chargeback exposure. — **Reversibility:** reversible — a single guard condition on the payment-initiation action.
- **D-14:** An unauthenticated visitor's cohort selection is **preserved through sign-in/registration/verification** (REG-02) so they land back on that cohort's order-summary page automatically afterward. Exact mechanism (return-to param vs. short-lived server-side intent record) is left to the planner, informed by Phase 3's existing post-auth redirect pattern (D-15 in `03-CONTEXT.md`).
- **D-15:** A visitor must be **signed in and registered to even see the order-summary page** — clicking "Enroll" while unauthenticated routes straight to sign-in/registration first (carrying the selection per D-14), and the order-summary page only renders once authenticated. Consistent with D-09: the seat hold is tied to a real `userId` from the moment it's created, so there's no unauthenticated "browse the summary" state to support.

**Order/receipt confirmation experience**
- **D-16:** The confirmation page shows REG-05's required fields (order reference, offer, amount, payment state, enrolment state, support route) plus **one clear next-step CTA** — pointing wherever `/account` currently leads, since Phase 9's real learner dashboard doesn't exist yet.
- **D-17:** **No downloadable/printable PDF receipt for v1** — the on-screen order page at its order-reference URL *is* the receipt, viewable any time. Matches REG-05's literal wording ("receipt/order record is exposed") without adding a PDF-generation dependency.
- **D-18:** The confirmation email reuses **Phase 3's minimal Brevo send-wrapper pattern** (D-01 in `03-CONTEXT.md`) — a plain, functional order-confirmation email, not Phase 13's richer templating/dedup system.
- **D-19:** The required "support route" on the confirmation page is **static contact info** (e.g. a mailto/phone line) — Phase 12's real ticket system doesn't exist yet; this becomes a real ticket-creation link once it ships.

### Claude's Discretion
- Exact mechanism for preserving cohort selection through auth (D-14) — query param, session, or DB-backed intent record; follow whatever is simplest given Phase 3's existing redirect pattern.
- Exact visual layout of the confirmation page and order-summary page — use the 04.1 design system's existing primitives (e.g. `DetailLayout`).
- Where static support contact info (D-19) is sourced from, if it exists elsewhere in the app already.

### Deferred Ideas (OUT OF SCOPE)
- Embedded Stripe Elements (in-app card entry matching the design system pixel-for-pixel) — deferred in favor of hosted Checkout for v1 (D-01); revisit once the payment flow is proven.
- Apple Pay / Google Pay wallet buttons — deferred to a later config toggle (D-03).
- Downloadable/printable PDF receipts — deferred (D-17); the on-screen order page is the receipt for v1.
- Real support-ticket linking on the confirmation page — deferred to Phase 12; static contact info for now (D-19).
- Order-resume logic for abandoned checkouts — explicitly rejected in favor of always-new-order (D-06); Phase 5's hold-expiry worker already cleans up abandoned holds.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REG-01 | Visitor sees price, dates, mode, availability, prerequisites, completion expectation before continuing | `public-catalogue-service.ts` extension pattern (Architecture Patterns §1); needs new `PublicCohort` fields — see Pitfall 6 |
| REG-02 | Selected offer survives identity verification/sign-in, returns learner to intended order | D-14 mechanism recommendation — cookie-based checkout intent + `returnTo` param (Architecture Patterns §2) |
| REG-03 | One traceable, idempotent order per checkout attempt; replays cannot duplicate enrolment | `Order.idempotencyKey`/`PaymentAttempt.idempotencyKey` unique constraints + Stripe API idempotency key (Code Examples §1, §4) |
| REG-04 | Terms/privacy/refund-cancellation/marketing captured separately with versions at order time | `PolicyAcceptance` (orderId-bound) + `POLICY_TYPE`/`POLICY_VERSIONS` extension (Pitfall 7) |
| REG-05 | Confirmation email + receipt/order record exposed after success | `emailDispatchService.dispatch`/`dispatchBestEffort` reuse (D-18) + `/orders/[reference]` page (Architecture Patterns §5) |
| PAY-02 | Payment states represented; transitions valid, idempotent, timestamped | Existing `OrderStatus`/`PaymentStatus` enums (already schema-complete) + shared transition body pattern (Architecture Patterns §3) |
| PAY-09 | Stripe sits behind one product-owned payment interface and shared state machine | `PaymentProvider` enum + `Order`/`PaymentAttempt` models already provider-agnostic; keep Stripe-specific code confined to `src/server/payments/providers/stripe/` (Architecture Patterns §1) |
| PAY-10 | Results verified server-side via signature; redirect/invalid webhook cannot mark paid | `stripe.webhooks.constructEvent` raw-body verification (Pitfall 1) + `WebhookEvent` idempotency table (Pitfall 2) |
</phase_requirements>

## Summary

Phase 6 is new-service work sitting on top of two things that already exist and must not be rebuilt: the `Order`/`PaymentAttempt`/`Refund`/`PolicyAcceptance`/`WebhookEvent` Prisma models (schema-complete, `prisma/schema.prisma:1229-1353`), and Phase 5's seat-accounting/enrolment machinery (`seat-accounting.ts`, `enrolment-service.ts`). The Stripe-specific work is genuinely new: no `stripe` package is installed, `src/server/payments/providers/` is empty, and this is the app's first webhook-receiving endpoint. The standard shape — Stripe Checkout Session created server-side with `client_reference_id`/`metadata` carrying the Order id, a raw-body-verified webhook route, and an idempotency table keyed on Stripe's `event.id` — is well documented and low-risk (HIGH confidence, `stripe` npm SDK v22.6.1, official docs).

The one finding that most changes how the planner should scope tasks: **the webhook handler cannot call `approveEnrolment` as written.** `approveEnrolment` (`enrolment-service.ts:442-503`) is wrapped in `withPermission("enrolments.manage", scope)`, which resolves the current actor via `getCurrentActor()` — a session-cookie read (`src/server/auth/current-actor.ts:14-17`). A Stripe webhook POST carries no session cookie; there is no actor to authorize. The codebase already solved exactly this problem twice — `hold-release-system-service.ts` (worker, no request) and `scan-system-service.ts` (used from an upload route) — with a documented pattern: a separate, explicitly unauthorized, narrowly-scoped `*AsSystem` module that never imports the permission choke point, audits as `actorId: null, actorType: "SYSTEM"`, and is checked by `tests/boundary.test.ts`'s import-closure assertions. Phase 6's webhook-driven `PENDING_PAYMENT → ACTIVE` transition should follow this same shape rather than trying to force a session-based authorization call into a server-to-server callback. See Architecture Pattern 3 and Pitfall 3.

The second most consequential finding is that `Cohort.currency` defaults to, and every seeded demo cohort uses, `"NGN"` (`prisma/seed.ts:319-320,360-361,406-407`) — and Stripe's NGN support is scoped to Nigeria-specific local payment methods/account configurations, not guaranteed to "just work" from an arbitrary Stripe account the same way USD/GBP/EUR do. D-07 locks "always use the cohort's own stored currency, no override," so this needs a concrete verification step against the actual Stripe test account before the planner treats Stripe-for-NGN-cohorts as a given. See Pitfall 5.

**Primary recommendation:** Build a new `src/server/services/checkout-service.ts` (learner-facing, ownership-authorized like `profile-service.ts`, not `withPermission`-gated) for Order/hold creation and Stripe Checkout Session initiation, and a new `src/server/services/checkout-webhook-system-service.ts` (unauthorized, `*AsSystem`, mirroring `hold-release-system-service.ts`) for the webhook's atomic Order/PaymentAttempt/Enrolment transition — both calling into `seat-accounting.ts`'s existing primitives, never re-deriving them.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cohort selection + price/date/availability display | Frontend Server (SSR) | API/Backend (data read) | Extends existing `(public)` route group; server component reads via an extended `public-catalogue-service.ts` |
| Seat hold creation ("Enroll" click) | API/Backend | Database | Server Action calling `takeSeat` inside a `$transaction`, same shape as `addEnrolment` |
| Cohort-selection persistence through auth | Browser / Client (cookie) | Frontend Server (redirect resolution) | httpOnly cookie set client-adjacent (Server Action `Set-Cookie`), read by post-auth redirect logic |
| Order-summary/policy-consent page | Frontend Server (SSR) | Browser (countdown timer, client component) | Read-only server-rendered facts + a small client component for the live countdown |
| Stripe Checkout Session creation | API/Backend | External Service (Stripe) | Server Action / Route Handler calls `stripe.checkout.sessions.create`; the actual redirect happens in the browser |
| Payment verification | API/Backend | External Service (Stripe) | New webhook Route Handler (`src/app/api/webhooks/stripe/route.ts`) — the ONLY writer of `PaymentAttempt.status = SUCCEEDED` |
| Enrolment activation (PENDING_PAYMENT → ACTIVE) | API/Backend | Database | New `*AsSystem` service, called only from the webhook handler, sharing the transition body with `approveEnrolment` |
| Confirmation email | API/Backend | External Service (Brevo) | `dispatchBestEffort(emailDispatchService.dispatch, ...)` called from the webhook handler after the DB transaction commits |
| "Confirming payment..." interstitial | Browser / Client | Frontend Server (SSR) | Client component polls via `router.refresh()`; the Server Component it wraps re-reads Order status from the DB each refresh |
| Order/receipt record | Frontend Server (SSR) | Database | Permanent page at `/orders/[reference]`, ownership-checked, no PDF generation (D-17) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` | `22.6.1` [VERIFIED: npm registry, `npm view stripe version` = 22.6.1, published 2026-09-01] | Official Stripe Node SDK — Checkout Session creation, webhook signature verification | The only supported way to call Stripe's API from Node; hand-rolling HMAC verification or raw HTTP calls to Stripe's REST API is explicitly the kind of thing `stripe.webhooks.constructEvent` exists to prevent (timing-safe comparison, tolerance window, versioned signature scheme) |

No supporting/alternative packages are needed — `stripe` is the entire new dependency surface for this phase. Raw-body handling, idempotency storage, and the payment state machine all use infrastructure the codebase already has (`WebhookEvent`, `Order`, `PaymentAttempt`, `DomainEvent`).

**Installation:**
```bash
npm install stripe
```

**Version verification:** `npm view stripe version` → `22.6.1`, `npm view stripe time.modified` → `2026-09-01T20:27:03.469Z` [VERIFIED: npm registry]. Note the SDK ships weekly-ish releases tracking Stripe's API version bumps — pin the exact version installed (do not `^`-range it loosely against a fast-moving major) and record the pinned API version Stripe associates with that SDK release, the same discipline the project already applied to `@tiptap/extensions` (pinned exact, `package.json:25`).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `stripe` | npm | 798 published versions back to `0.0.1`; latest patch published 2026-09-01 [VERIFIED: npm registry] | 18,069,705/week [VERIFIED: npm registry `api.npmjs.org/downloads`] | `github.com/stripe/stripe-node` [VERIFIED: npm registry `repository.url`], maintainer `stripe-bindings <dev-platform-bots@stripe.com>` | **SUS** (automated verdict) | Flagged — planner must add `checkpoint:human-verify` before install |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `stripe` — the automated `package-legitimacy check` seam flags it `SUS` with reason `"too-new"`. This is the **same heuristic false positive** Phase 3's research documented for `@getbrevo/brevo` (03-CONTEXT.md D-20): the heuristic reads the *latest patch's* publish date, not the package's actual origin. `stripe` ships new patch versions roughly weekly to track Stripe's own API version bumps (798 versions since 2013), which trips a "published very recently" check on every single run regardless of when you look. The counter-evidence — 18M weekly downloads, the official `stripe/stripe-node` GitHub org, no `postinstall` script, maintainer account belonging to Stripe itself — is about as strong as npm registry evidence gets for a payment SDK. **Recommendation:** proceed with `npm install stripe`, but per protocol still gate the actual `npm install` behind a `checkpoint:human-verify` task in the plan (do not silently override the automated verdict even though the evidence is strong — same discipline Phase 3 applied to `@getbrevo/brevo`).

*`stripe` was discovered via WebSearch/training knowledge and is tagged `[ASSUMED]` for the package **name** despite the registry/download/repo evidence being `[VERIFIED]` — per the package-name provenance rule, only the checkpoint's own confirmation converts this to a locked decision.*

## Architecture Patterns

### System Architecture Diagram

```
 Visitor (browser)
     │
     │ 1. GET /courses/[slug]  (or /programmes/[slug])
     ▼
 Public catalogue page  ──reads──▶ public-catalogue-service.ts (extended: id, priceMinor,
 (extended w/ cohort list,          currency, deliveryMode, seatsAvailable, prerequisites)
  price, dates, "Enroll" CTA)
     │
     │ 2. POST "Enroll" (Server Action)
     ▼
 checkout-service.ts: createHoldAndOrder(cohortId, actor)
     │  - if !actor: set checkout_intent cookie, redirect /register?returnTo=... (D-14/D-15)
     │  - if actor:  $transaction { takeSeat(...) [seat-accounting.ts] + Order.create(PENDING) }
     ▼
 /checkout/[orderId]  — order-summary page (D-02, D-08, read-only)
     │  - shows price/dates/mode from Cohort, countdown from Enrolment.holdExpiresAt (D-11)
     │  - policy checkboxes (terms / refund-cancellation / marketing)
     │  - "Pay" button DISABLED unless actor.emailVerified (D-13)
     │
     │ 3. POST "Pay" (Server Action)
     ▼
 checkout-service.ts: initiateStripePayment(orderId)
     │  - re-check hold not expired (else D-10: error + redirect to cohort page)
     │  - create PolicyAcceptance rows (orderId-bound, REG-04)
     │  - create PaymentAttempt (PENDING, provider=STRIPE, idempotencyKey)
     │  - stripe.checkout.sessions.create({ client_reference_id: orderId,
     │      metadata: { orderId, enrolmentId }, line_items, mode:"payment",
     │      success_url, cancel_url }, { idempotencyKey })
     │  - store session.id → PaymentAttempt.providerIntentId
     ▼
 redirect(303) → Stripe-hosted Checkout page  (external, PCI scope stays with Stripe)
     │
     │ 4a. learner pays successfully           │ 4b. learner cancels / session expires
     ▼                                          ▼
 redirect → success_url                    redirect → cancel_url
 /checkout/[orderId]/confirming            /checkout/[orderId]  (same Order, D-04 retry
     │  (D-05 interstitial, polls via         if hold still valid; D-10 error if expired)
     │   router.refresh() every ~2-3s)
     │
     │                     ▲ (async, server-to-server, arrives independently of the redirect)
     │                     │
     │        Stripe ──POST──▶ /api/webhooks/stripe  (route.ts)
     │                     │    1. body = await req.text()  [MUST be raw — Pitfall 1]
     │                     │    2. event = stripe.webhooks.constructEvent(body, sig, secret)
     │                     │    3. INSERT WebhookEvent (provider, providerEventId=event.id)
     │                     │       — @@unique constraint IS the idempotency guard (Pitfall 2)
     │                     │       — P2002 on retry ⇒ return 200 immediately, no reprocessing
     │                     │    4. checkout-webhook-system-service.ts:
     │                     │       activateOrderAsSystem(orderId, sessionId) — SYSTEM actor,
     │                     │       mirrors approveEnrolment's tx body (Pitfall 3):
     │                     │         $transaction {
     │                     │           PaymentAttempt → SUCCEEDED (match providerIntentId)
     │                     │           assertTransition(enrolment.status, "ACTIVE")
     │                     │             — if illegal (hold already expired, Pitfall 4):
     │                     │               Order → EXCEPTION, PaymentAttempt.exceptionNote set,
     │                     │               DO NOT touch seat count, still return 200 to Stripe
     │                     │           else: claimSeat-or-lockOpenCohort + updateCurrentEnrolment
     │                     │                 (ACTIVE) + writeDomainEvent("enrolment.activated")
     │                     │           Order → PAID, paidAt = now()
     │                     │         }
     │                     │       recordAudit(actorType: SYSTEM) x2 (Order, Enrolment)
     │                     │       dispatchBestEffort(emailDispatchService.dispatch, ...) (D-18)
     ▼                     │
 Server Component re-reads Order.status on next router.refresh() tick
     │
     │ status === PAID
     ▼
 redirect → /orders/[reference]  (D-16/D-17: the permanent confirmation/receipt page)
```

### Recommended Project Structure
```
src/server/payments/
├── providers/
│   └── stripe/
│       ├── client.ts            # new Stripe() singleton, reads STRIPE_SECRET_KEY
│       ├── checkout-session.ts  # buildCheckoutSessionParams(order, cohort) — pure, testable
│       └── webhook.ts           # verifyStripeWebhook(rawBody, sig) — thin wrapper over constructEvent
src/server/services/
├── checkout-service.ts             # learner-facing: createHoldAndOrder, initiateStripePayment,
│                                    # getOwnOrder — ownership-authorized (no withPermission), mirrors
│                                    # profile-service.ts's "derive target from actor.userId only" shape
├── checkout-webhook-system-service.ts  # *AsSystem, unauthorized, webhook-only — mirrors
│                                        # hold-release-system-service.ts exactly
src/app/(public)/courses/[slug]/page.tsx      # extended: full cohort list + "Enroll" CTA (REG-01)
src/app/(public)/programmes/[slug]/page.tsx   # same extension for Programme cohorts
src/app/(checkout)/
├── checkout/[orderId]/page.tsx        # order-summary + policy consent + Pay (D-02/D-08)
├── checkout/[orderId]/confirming/page.tsx  # D-05 interstitial + polling client component
src/app/orders/[reference]/page.tsx    # D-16/D-17 permanent receipt page, ownership-checked
src/app/api/webhooks/stripe/route.ts   # POST only, raw body, no @prisma/client import (calls the
                                        # webhook-system-service, same boundary rule as every route)
```

### Pattern 1: Extend the public catalogue read path, don't build a parallel one
**What:** `PublicCohort` (`public-catalogue-service.ts:52-56`) currently exposes only `startsAt`/`enrolmentOpensAt`/`enrolmentClosesAt` — verified by reading the file this session. REG-01 needs price, mode, availability, and an id to link "Enroll" to. Extend the existing `PUBLIC_VISIBILITY_WHERE`-gated select, do not add a second query path (the file's own header comment warns against exactly this: "a future edit that fixes one `where` and misses the others is the whole failure mode this shape prevents").
**When to use:** Any time the public cohort-selection UI needs a field not currently in `PublicCohort`.
**Example:**
```typescript
// src/server/services/public-catalogue-service.ts — extend, don't replace
export type PublicCohort = {
  id: string;                    // NEW — needed for the Enroll link target
  startsAt: Date;
  endsAt: Date;                  // NEW — REG-01 "dates"
  enrolmentOpensAt: Date;
  enrolmentClosesAt: Date;
  deliveryMode: "SELF_PACED" | "INSTRUCTOR_LED" | "BLENDED"; // NEW — REG-01 "mode"
  priceMinor: number;            // NEW — REG-01 "price"
  currency: string;              // NEW
  seatsAvailable: number;        // NEW — derived (capacity - seatsTaken), never expose raw seatsTaken
};
```
`select` in `upcomingCohorts()` must add exactly these fields — no bare `findMany`.

### Pattern 2: Cookie-based checkout intent for D-14 (the register→verify email round-trip breaks query params)
**What:** REG-02 requires the cohort selection to survive registration AND email verification, which is a genuinely asynchronous, possibly multi-session flow — verified by reading `register/actions.ts` and `verify/actions.ts`: registration returns a "check your email" state with no session created, and the verification link is consumed later, sometimes from a different browser tab days later. A single `returnTo` query param bounced through `/register` → `/verify` cannot survive that gap (the verification link's URL is generated once, at send time, and mailed — it does not know what the visitor does between clicking "Enroll" and opening their inbox). A `returnTo` query param DOES survive the immediate `/register?returnTo=X` → submit → "check email" step (same page load), so use both: an httpOnly cookie for the cross-request case, `returnTo` param as a same-request convenience.
**When to use:** Any post-auth redirect that needs to carry state through a multi-step, multi-page identity flow — this is the first time the codebase needs this; `landingPathFor` (`src/server/auth/landing.ts:14-16`) only branches on `isStaff`, it has no concept of a caller-supplied target.
**Example:**
```typescript
// src/server/auth/landing.ts — add alongside the existing landingPathFor, don't replace it
export const CHECKOUT_INTENT_COOKIE = "checkout_intent";

export function checkoutReturnPathFor(
  user: { isStaff?: boolean | null },
  cohortIntent: string | null,
): string {
  if (user.isStaff) return STAFF_LANDING_PATH;
  if (cohortIntent) return `/checkout/${cohortIntent}`; // cohortId, resolved to an orderId inside the route
  return LEARNER_LANDING_PATH;
}
```
`signInAction` (`src/app/(auth)/signin/actions.ts:33-42`) and the post-verification redirect both read the cookie (short TTL, e.g. matching `HOLD_MINUTES_DEFAULT` + a margin) before falling back to `landingPathFor`. The "Enroll" Server Action sets this cookie (`httpOnly`, `sameSite: "lax"`, short `maxAge`) before `redirect("/register?returnTo=...")` when `getCurrentActor()` is null.

### Pattern 3: Factor the enrolment-activation transition body so both the staff action and the webhook can call it
**What:** `approveEnrolment` (`enrolment-service.ts:442-503`) already contains exactly the `PENDING_PAYMENT → ACTIVE` transition Phase 6 needs — the `holdsSeat`/`claimSeat`/`lockOpenCohort`/`updateCurrentEnrolment`/`writeDomainEvent` sequence — but it is inlined inside a `withPermission`-wrapped closure. The codebase's own precedent for sharing a transition body across an authorized caller and an unauthorized one is `applyEnrolmentExit` (`enrolment-service.ts:282-324`, module-scope export, called by both `makeTerminalAction` and Phase 5's bulk `cancelCohort` path). Apply the same extraction here: pull the transaction body out of `approveEnrolment` into an exported `applyEnrolmentActivation(tx, { enrolment, reason, now })`, have `approveEnrolment` call it (staff path, `withPermission` still gates entry), and have the new webhook-only system service call it directly (no `withPermission`, `actorId: null, actorType: "SYSTEM"`, its own audit action name).
**When to use:** Whenever a transition needs both a staff-authorized entry point and a system-triggered entry point — this is the second such case in the codebase (the first is `applyEnrolmentExit`), so the extraction pattern is now an established convention, not a one-off.
**Example:**
```typescript
// src/server/services/checkout-webhook-system-service.ts — mirrors hold-release-system-service.ts
// exactly (WORKER-adjacent, DELIBERATELY unauthorized — same file-header discipline required).
import { applyEnrolmentActivation } from "@/server/services/enrolment-service"; // newly exported

export const SYSTEM_ACTOR_TYPE = "SYSTEM";

export async function activateOrderAsSystem(input: {
  orderId: string;
  providerIntentId: string;   // Stripe Checkout Session id — matches PaymentAttempt.providerIntentId
  amountMinor: number;
  currency: string;
}): Promise<{ outcome: "ACTIVATED" | "EXCEPTION" }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { enrolments: true, paymentAttempts: true },
    });
    if (!order) throw new Error(`Order ${input.orderId} not found`); // webhook: log + 200, don't retry forever
    const enrolment = order.enrolments[0]; // one Enrolment per Order in this schema shape

    try {
      await applyEnrolmentActivation(tx, {
        enrolment,
        reason: "Stripe payment confirmed",
        actorId: null,
        now: new Date(),
      });
      await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
      // ... PaymentAttempt -> SUCCEEDED, writeDomainEvent("order.paid") ...
      return { outcome: "ACTIVATED" as const };
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        // Pitfall 4 — hold already expired/released. Money was captured; do NOT touch seats.
        await tx.order.update({ where: { id: order.id }, data: { status: "EXCEPTION" } });
        // ... PaymentAttempt.exceptionNote set, still SUCCEEDED (money moved) ...
        return { outcome: "EXCEPTION" as const };
      }
      throw err;
    }
  });
}
```

### Pattern 4: Raw-body webhook route handler (Next.js 16 App Router)
**What:** App Router Route Handlers do NOT apply the automatic body-parsing that the old Pages Router API routes did — there is no `export const config = { api: { bodyParser: false } }` equivalent needed, and none should be added. The fix for "signature verification failed" is almost always calling `req.json()` before verification anywhere in the handler; read the body with `req.text()` first, always [CITED: multiple current App-Router Stripe integration guides, cross-checked against Stripe's own webhook-verification requirement that the raw bytes must be unmodified].
**When to use:** Every Stripe (or any HMAC-signed) webhook Route Handler.
**Example:**
```typescript
// src/app/api/webhooks/stripe/route.ts
export async function POST(req: Request) {
  const body = await req.text();                       // RAW — never req.json() first
  const signature = req.headers.get("stripe-signature");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response("Invalid signature", { status: 400 }); // PAY-10: never proceeds past here
  }
  // ... insert-first idempotency check against WebhookEvent, then dispatch by event.type ...
  return new Response(null, { status: 200 });
}
```
This route file must NOT import `@prisma/client` directly (`tests/boundary.test.ts` enforces this for every file under `src/app/**`) — it calls the new webhook-system-service, same as every other route.

### Pattern 5: "Confirming payment..." interstitial via `router.refresh()` polling
**What:** With no websocket/SSE infrastructure in the app, the standard low-infra pattern is a small client component that calls `router.refresh()` on an interval; this re-runs the wrapping Server Component's data fetch (a fresh read of `Order.status`) without a full page navigation, and once the DB shows `PAID` the Server Component itself performs the `redirect()` to `/orders/[reference]` [CITED: multiple current Next.js App Router polling guides; matches `useRouter` official docs' description of `router.refresh()` re-fetching Server Component data].
**Example:**
```tsx
// src/app/(checkout)/checkout/[orderId]/confirming/PollForPayment.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PollForPayment({ intervalMs = 2500 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
```
The server component for this route reads the Order fresh on every render (no caching), and once `status === "PAID"` calls `redirect(\`/orders/${order.reference}\`)`; if `status === "EXCEPTION"` it redirects to a distinct "we're sorting this out" state rather than looping forever.

### Anti-Patterns to Avoid
- **Trusting the `success_url` redirect to mean "paid":** D-05/PAY-10 both explicitly forbid this. The redirect only proves the browser bounced back from Stripe — it proves nothing about payment success (a user can hand-navigate to `success_url` without paying). Only the webhook may write `PaymentAttempt.status = SUCCEEDED` / `Order.status = PAID`.
- **Calling `stripe.checkout.sessions.retrieve()` from the success page to "confirm" payment client-side and then writing PAID from that read:** this reintroduces exactly the same trust problem one layer removed — the client-facing page triggering a state write based on what it was told, rather than the server-to-server signed webhook. If a "confirm now" fallback for slow webhooks is wanted later, it must still be the SAME server-verified code path (fetch the session server-side, verify it belongs to this Order, then feed it through the identical `activateOrderAsSystem` function the webhook calls) — not a shortcut that skips signature verification.
- **A new Checkout Session per card-decline retry:** Stripe Checkout's hosted page already lets a customer retry with a different card within the same session until it expires or completes — D-04's "inline retry on the same Order" does not require app code to create a new `PaymentAttempt`/Session per declined swipe. Only build a new-session path for the genuinely new-order case (D-06 — hold expired, or the whole session/page was abandoned and reopened).
- **Wrapping the webhook's enrolment transition in `withPermission`:** there is no actor to resolve; see Pitfall 3.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Webhook signature verification | Manual HMAC-SHA256 comparison against the `Stripe-Signature` header | `stripe.webhooks.constructEvent(body, sig, secret)` | Handles the timestamp-tolerance window, the versioned `v1=`/`v0=` signature scheme, and uses a timing-safe compare — a hand-rolled `===` string compare is a timing side-channel |
| Webhook idempotency / duplicate delivery | A new dedupe table, Redis set, or job queue | The existing `WebhookEvent` model's `@@unique([provider, providerEventId])` (`prisma/schema.prisma:1339-1353`) — insert-first, catch P2002, skip reprocessing | The schema already models this correctly; a second dedupe mechanism is a second place for staleness to hide (same reasoning `hold-release-system-service.ts`'s header gives for NOT adding a job-level dedupe key on top of a convergent work set) |
| Seat capacity / hold accounting | Any new "reservation" logic, counters, or locks | `takeSeat` / `claimSeat` / `releaseSeat` / `holdExpiryFrom` / `lockOpenCohort` (`seat-accounting.ts`) | D-09/D-12 explicitly lock this — Phase 5 built this exact primitive for Phase 6 to call |
| Order/Payment/Refund schema | New tables, new enums | `Order`, `PaymentAttempt`, `Refund`, `WebhookEvent`, `PaymentProvider`/`PaymentStatus`/`OrderStatus`/`WebhookStatus` enums (already fully modelled, `prisma/schema.prisma:1229-1353`, `:136-176`) | Already designed multi-provider/idempotent per the header comments (§19.1/§19.2 PRD references); adding parallel models would fragment the state machine PAY-09 requires to be shared |
| Transactional email sending | A new mail client, template engine, or dedup layer | `sendTransactionalEmail` (`src/server/email/brevo-client.ts`) + `emailDispatchService.dispatch`/`dispatchBestEffort` (`email-dispatch-service.ts`) | D-18 explicitly reuses Phase 3's wrapper; a second email pathway means two `EmailDispatch`-adjacent bookkeeping shapes to reconcile later |
| "Is this my own record" authorization for checkout actions | A new permission catalogue entry (`orders.view`, `orders.pay`, etc.) via `withPermission` | The ownership-comparison model `profile-service.ts` documents in its own header ("Authorization here is an ownership comparison, not a permission check... no entry point below accepts a target user id parameter") | Confirmed by reading `permissions/catalogue.ts:49-51` — the only payment-adjacent permissions are staff-only (`payments.view`, `payments.confirm`, `refunds.manage`), for Phase 7. A learner paying for their own order is not an RBAC concern any more than editing their own profile is |
| HMAC/crypto primitives generally | Any custom crypto | `stripe.webhooks.constructEvent` (delegates to Node's `crypto` internally) | Same "never hand-roll cryptography" rule the project already follows elsewhere |

**Key insight:** Every piece of new infrastructure this phase seems to need at first glance — an idempotency store, a seat-hold mechanism, an email sender, an authorization model for self-service actions — already exists in the codebase in a form built either explicitly for this phase (`seat-accounting.ts`, `WebhookEvent`) or generalizably from an earlier phase (`profile-service.ts`'s ownership model, `hold-release-system-service.ts`'s system-actor pattern). The actual new code this phase writes is thin: the Stripe SDK calls themselves, the webhook route, and the two new services that glue Stripe's events to the existing state machine.

## Common Pitfalls

### Pitfall 1: Reading the webhook body as JSON anywhere before signature verification
**What goes wrong:** `stripe.webhooks.constructEvent` recomputes the HMAC over the exact raw bytes Stripe sent. If the handler (or any middleware) calls `req.json()` first, or the framework re-serializes the body, the recomputed hash will not match the header — verification fails with a generic "No signatures found matching the expected signature for payload" error, even though the request is completely legitimate.
**Why it happens:** It's the natural instinct to `await req.json()` in a Next.js Route Handler, and Next.js does not warn you that this consumes/transforms the body stream before it reaches `constructEvent`.
**How to avoid:** `const body = await req.text();` — always, in every code path of this specific route — then pass that raw string to `constructEvent`. Do not add any other body-reading call in this file.
**Warning signs:** Signature verification fails in production/staging (real Stripe traffic) but a hand-crafted local test with the raw body and a locally-computed signature succeeds — that mismatch is the signature of this exact bug.

### Pitfall 2: Treating "the event was received" as "the event was processed" (no idempotency)
**What goes wrong:** Stripe retries webhook delivery with exponential backoff for up to 3 days on any non-2xx response, and can also legitimately deliver the same `event.id` more than once even on a 200 (network-level double-send). Without a dedupe check, a retried `checkout.session.completed` re-runs the full activation transaction — attempting to claim a second seat, sending a second confirmation email, or (if the transition guard is missing) throwing on the second `assertTransition` call because the enrolment is already ACTIVE. [CITED: docs.stripe.com/webhooks — retries for up to 3 days, `event.id` stable across retries]
**Why it happens:** It's easy to build the "happy path" transaction and forget delivery is at-least-once, not exactly-once, by contract.
**How to avoid:** Insert into `WebhookEvent` (`provider`, `providerEventId: event.id`) BEFORE processing, inside its own short transaction or as the first statement; if the insert raises the `@@unique([provider, providerEventId])` violation (P2002), the event was already processed (or is currently being processed) — return `200` immediately without touching Order/Enrolment state again. This is the exact "insert-first, unique constraint as the idempotency guard" pattern web research confirms is standard practice for Stripe webhooks generally, and the schema already has the table shaped for it (`status: WebhookStatus` even has a dedicated `DUPLICATE` value to record this outcome).
**Warning signs:** Duplicate `EmailDispatch`/confirmation-email sends for one order; `seatsTaken` incremented twice for one paid enrolment.

### Pitfall 3: Calling a `withPermission`-wrapped action from a session-less context
**What goes wrong:** `approveEnrolment`, and every other exported function in `enrolment-service.ts`, resolves its actor via `withPermission`'s bound `getActor` — which is `getCurrentActor()`, which reads a session cookie off the current request (`src/server/permissions/index.ts:16-17`, `src/server/auth/current-actor.ts:14-17` — both read this session). A Stripe webhook is an unauthenticated server-to-server POST from Stripe's infrastructure with no cookie jar. Calling `approveEnrolment` from the webhook handler will resolve `actor = null` and the authorization check will deny the action (fail-closed) — the enrolment never activates despite a successful payment, which is a silent, hard-to-diagnose PAY-02/REG-05 failure.
**Why it happens:** `approveEnrolment` is the obviously-correct-looking function name for "flip PENDING_PAYMENT to ACTIVE" and CONTEXT.md's own wording ("reusing whatever Phase 5 helper does that transition") reads as an instruction to call it directly.
**How to avoid:** Do NOT call `approveEnrolment` (or any `withPermission`-wrapped export) from the webhook path. Follow the codebase's own established precedent for this exact problem — `hold-release-system-service.ts` and `scan-system-service.ts` — by factoring the transition BODY out of `approveEnrolment` into a plain, transaction-taking function (Architecture Pattern 3) and calling that directly from a new, explicitly unauthorized, narrowly-scoped `*AsSystem` webhook service. Audit the write as `actorId: null, actorType: "SYSTEM"` under its own action name (e.g. `enrolment.activated`, distinct from staff-driven `enrolment.approved`) so the audit trail can always tell a webhook-triggered activation apart from a staff override.
**Warning signs:** `tests/boundary.test.ts`-style import-closure checks would need extending to cover the webhook route the same way they cover the worker; if a plan skips writing that test, this failure mode has no automated guard.

### Pitfall 4: The seat hold can legitimately expire before the webhook lands (Stripe-timing vs. hold-timing race)
**What goes wrong:** The seat hold (`Enrolment.holdExpiresAt`, from `Cohort.holdMinutes`, default 30 min) and Stripe Checkout's own session lifetime (default 24h, but the learner could also simply sit on the Stripe page past the hold window) are two independent clocks. Phase 5's hold-release worker sweeps every 5 minutes (`worker/index.ts:62`, `HOLD_SWEEP_QUEUE` schedule `*/5 * * * *`) and has no knowledge of Stripe or of an in-flight PaymentAttempt — it will cancel a `PENDING_PAYMENT` enrolment and release its seat purely because `holdExpiresAt < now()`, even if the learner is mid-payment on Stripe's page at that exact moment. If the learner then completes payment seconds later, the webhook arrives to find the enrolment already `CANCELLED` (a terminal status — `VALID_TRANSITIONS.CANCELLED = []`) and the cohort seat already given back to the pool (possibly taken by someone else in the meantime).
**Why it happens:** Two independently-designed subsystems (Phase 5's worker, Phase 6's Stripe integration) share a resource (the seat) with no coordination point, and were built in separate phases against separate research.
**How to avoid:** The webhook handler MUST treat "hold already expired / enrolment already terminal" as a distinct, expected outcome rather than an unhandled exception. Catch the `IllegalTransitionError` `assertTransition` would raise, and route to an explicit exception state: `Order.status = "EXCEPTION"` (the enum already has this value, `prisma/schema.prisma:152-160`), `PaymentAttempt.status` stays/moves to `SUCCEEDED` (the money was actually captured by Stripe — do not lose that fact), `PaymentAttempt.exceptionNote` records what happened, and the seat count is left untouched (re-claiming a seat that may now be full, or that was given to someone else, is worse than leaving it as a flagged exception for Phase 7/8's manual reconciliation). This is precisely the PAY-07 "ambiguous cases enter a visible exception state" requirement, arriving one phase early because Phase 6 is where the race is actually possible. The webhook handler should still return `200` to Stripe in this case — retrying will not change the outcome, and leaving the event unacknowledged just adds pointless Stripe retry traffic for 3 days.
**Warning signs:** An integration test analogous to `tests/hold-release.integration.test.ts` / `tests/seat-accounting.integration.test.ts` that runs the hold-release sweep between "seat taken" and "webhook fires" should be part of Wave 0 test scope for this exact reason — see Validation Architecture.

### Pitfall 5: `Cohort.currency` defaults to NGN; Stripe's NGN support is not a drop-in guarantee
**What goes wrong:** D-07 locks "the Stripe charge always uses the cohort's own stored currency, no platform-wide override" — and `Cohort.currency` defaults to `"NGN"` in the schema, with every seeded demo cohort priced in NGN (`prisma/seed.ts:319-320` — `priceMinor: 45000000, currency: "NGN"`; `:360-361`; `:406-407`). Stripe's NGN presentment-currency support is real but is documented specifically in the context of Nigeria-targeted local payment methods and account configuration (`docs.stripe.com/payments/countries/nigeria`, `docs.stripe.com/payments/ng-card/accept-a-payment`) — it is not automatically enabled for every Stripe account the way USD/GBP/EUR settlement is. Whether `stripe.checkout.sessions.create({ currency: "ngn", ... })` succeeds depends on the specific Stripe account's country and enabled payment methods, which this research cannot verify without access to the actual deployment's Stripe account.
**Why it happens:** The currency choice was locked at the schema level in an earlier phase (Phase 5, business-driven — the client is presumably Nigeria-based) independent of which payment gateway would eventually charge it; Phase 6 is the first phase where that choice meets Stripe specifically (PAY-08's multi-gateway design, "unavailable options cannot be chosen," anticipates exactly this class of constraint, but that logic is Phase 7+ scope, not built yet).
**How to avoid:** Before building the Checkout Session creation code against real cohort data, verify against the actual Stripe test-mode account whether `currency: "ngn"` Checkout Sessions can be created and completed successfully — Stripe's TEST mode is generally more permissive about presentment currencies than LIVE mode, so a test-mode success does not guarantee the same in production. Flag this explicitly as a `checkpoint:human-verify` in the plan rather than assuming it works, and treat "Stripe does not support NGN on this account" as a real possible outcome that would need a decision (a different pricing currency for Stripe-processed cohorts, USD-equivalent pricing, or gating Stripe checkout entirely until Phase 7's Paystack — NGN-native — is available for those cohorts).
**Warning signs:** `stripe.checkout.sessions.create` throwing a `StripeInvalidRequestError` mentioning the currency at the FIRST real end-to-end test against a live/test Stripe account, well after the schema/service-layer code is otherwise complete.

### Pitfall 6: The public catalogue's cohort payload has no `id`, price, or mode fields today
**What goes wrong:** Reading `public-catalogue-service.ts` in full shows `PublicCohort` (lines 52-56) currently exposes exactly `startsAt`, `enrolmentOpensAt`, `enrolmentClosesAt` — no `id` (so there is nothing to link an "Enroll" button to), no `priceMinor`/`currency`, no `deliveryMode`, no capacity/availability signal, and the corresponding public course/programme detail pages (`src/app/(public)/courses/[slug]/page.tsx`) render only a bare "Starts {date}" list with no CTA at all. REG-01's full acceptance criteria (price, dates, mode, availability, prerequisites, completion expectation) cannot be satisfied by data that isn't selected yet.
**Why it happens:** Phase 4 built the public catalogue for course/programme browsing only; cohort-level commerce data was explicitly out of scope until Phase 6 (per Phase 4/5's own phase boundaries).
**How to avoid:** Extend `PublicCohort`'s type and the `select` clause in `upcomingCohorts()` (Architecture Pattern 1) — this is additive to an existing, already-vetted anonymous-access query shape, not a new read path. Do not build a second, separate "cohort detail" query that duplicates `PUBLIC_VISIBILITY_WHERE` — the file's own header comment explicitly warns against exactly that failure mode.
**Warning signs:** A plan that proposes a brand-new `getPublicCohortById` service file instead of extending the existing one is a sign this pitfall wasn't caught.

### Pitfall 7: `POLICY_TYPE` has no refund/cancellation policy type yet
**What goes wrong:** REG-04 requires terms, privacy, refund/cancellation policy, and marketing consent to each be recorded separately with a version. Reading `src/lib/identity.ts` in full (lines 27-38) shows `POLICY_TYPE` currently defines exactly `TERMS`, `PRIVACY`, `MARKETING` — there is no `REFUND_CANCELLATION` (or similar) entry, and correspondingly no version string for it in `POLICY_VERSIONS`. Phase 3's own CONTEXT.md (D-06) explicitly deferred this: "Refund/Cancellation policy and Marketing consent move to Phase 6 checkout."
**Why it happens:** Phase 3 scoped registration-time policy acceptance narrowly (terms + privacy only) by design, leaving the remaining policy type for the phase that actually needs it.
**How to avoid:** Add a new key (e.g. `REFUND_CANCELLATION: "refund_cancellation"`) to `POLICY_TYPE` and a corresponding entry in `POLICY_VERSIONS` in `src/lib/identity.ts` — additive, no schema migration needed (`PolicyAcceptance.policyType` is a plain `String` column, not an enum). Marketing consent at checkout reuses the EXISTING `POLICY_TYPE.MARKETING` — this is the same "one consistent source of truth for marketing consent state" `03-CONTEXT.md` D-12 already established for the profile-page toggle; checkout's marketing checkbox should write to the same `policyType`, not a parallel one.
**Warning signs:** A plan proposing a new enum in `prisma/schema.prisma` for policy types, when the existing model already uses a plain string column specifically so new policy types are additive.

### Pitfall 8: `DomainEventType` is a closed union — new event types must be added deliberately
**What goes wrong:** `DomainEventType` (`src/server/services/domain-event-service.ts:34-46`) is a TypeScript union of exactly eleven string literals, by explicit design ("A string outside this union is a compile error by design — a later phase must not be able to invent an event type that no drain job knows about"). None of Phase 6's new events (`order.created`, `order.paid`, `enrolment.activated`) exist in that union today. Code that tries to `writeDomainEvent(tx, { type: "order.paid", ... })` without first adding it to the union will fail to compile — which is the intended guardrail, not a bug to route around.
**Why it happens:** The union was correctly scoped to Phase-5-and-earlier events at the time it was written; it was never meant to be exhaustive forever.
**How to avoid:** Add the new event types this phase needs directly to the union at `domain-event-service.ts:34-46` — recommend at minimum `"order.created"`, `"order.paid"`, `"enrolment.activated"` (kept distinct from staff-driven `"enrolment.approved"` per Pitfall 3's audit-trail reasoning), and consider `"order.exception"` for Pitfall 4's race outcome so Phase 13's future email drain and Phase 8's reconciliation views have a typed hook for it.
**Warning signs:** A plan that doesn't mention touching `domain-event-service.ts` at all despite adding new mutation paths that should emit events is missing this.

## Code Examples

### 1. Stripe Checkout Session creation with idempotency and correlation metadata
```typescript
// src/server/payments/providers/stripe/checkout-session.ts
import Stripe from "stripe";

export function buildCheckoutSessionParams(args: {
  orderId: string;
  enrolmentId: string;
  cohortTitle: string;
  amountMinor: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    payment_method_types: ["card"], // D-03 — card only for v1
    client_reference_id: args.orderId, // webhook's primary lookup key
    metadata: { orderId: args.orderId, enrolmentId: args.enrolmentId }, // belt-and-suspenders
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: args.currency.toLowerCase(), // Stripe expects lowercase ISO codes
          unit_amount: args.amountMinor,          // already minor units — no conversion needed
          product_data: { name: args.cohortTitle },
        },
      },
    ],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  };
}

// call site — pass the idempotency key as the SECOND argument, a Stripe request option,
// not a field inside the session params object [CITED: docs.stripe.com/api/idempotency]
const session = await stripe.checkout.sessions.create(
  buildCheckoutSessionParams({ ...args }),
  { idempotencyKey: paymentAttempt.idempotencyKey },
);
```

### 2. Webhook route handler skeleton (raw body, signature check, insert-first idempotency)
```typescript
// src/app/api/webhooks/stripe/route.ts
import Stripe from "stripe";
import { stripe } from "@/server/payments/providers/stripe/client";
import { recordWebhookEventOrSkip } from "@/server/services/checkout-webhook-system-service";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text(); // RAW bytes — Pitfall 1
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return new Response("Misconfigured", { status: 500 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 }); // PAY-10 — never proceeds
  }

  const { isNew } = await recordWebhookEventOrSkip({
    provider: "STRIPE",
    providerEventId: event.id,
    eventType: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (!isNew) return new Response(null, { status: 200 }); // Pitfall 2 — already processed

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.client_reference_id;
    if (orderId) {
      await activateOrderAsSystem({
        orderId,
        providerIntentId: session.id,
        amountMinor: session.amount_total ?? 0,
        currency: session.currency ?? "ngn",
      });
    }
  }
  // checkout.session.expired -> mark Order/PaymentAttempt FAILED/CANCELLED (D-10 path)
  // payment_intent.payment_failed -> optional PaymentAttempt FAILED record (D-04's in-Stripe retry
  //   handles the UX; this event is for bookkeeping only, not user-facing)

  return new Response(null, { status: 200 });
}
```

### 3. Insert-first idempotency guard against `WebhookEvent`
```typescript
// src/server/services/checkout-webhook-system-service.ts
export async function recordWebhookEventOrSkip(input: {
  provider: "STRIPE";
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<{ isNew: boolean }> {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payload: input.payload,
        signatureValid: true, // only reached after constructEvent succeeded
        status: "RECEIVED",
      },
    });
    return { isNew: true };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { isNew: false }; // Pitfall 2
    throw err;
  }
}
```

### 4. Order-level idempotency key generation (REG-03)
```typescript
// src/server/services/checkout-service.ts — one Order per checkout attempt (D-06)
import { randomUUID } from "node:crypto";

function generateOrderReference(): string {
  // Human-readable, not guessable-as-sequential — matches the project's existing
  // "no predictable identifiers" posture (NFR-06) without needing a new dependency.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ORD-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

// Order.idempotencyKey and PaymentAttempt.idempotencyKey are separate unique columns —
// generate a fresh UUID per Order and per PaymentAttempt (not derived from user input),
// and pass the PaymentAttempt's key to Stripe as the request-level idempotencyKey (Example 1).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Pages Router API routes needed `export const config = { api: { bodyParser: false } }` to get the raw body for webhook signature verification | App Router Route Handlers never auto-parse the body — just `await req.text()` | Next.js 13+ App Router (this project is on 16.3.4) | Any Stripe/Next.js tutorial written against the Pages Router (`pages/api/webhooks/stripe.ts`) is showing the WRONG pattern for this codebase; the `bodyParser: false` config block does not exist in App Router and adding it is a no-op at best, confusing at worst |
| `stripe.webhooks.constructEvent` (sync) on the default Node.js runtime | `stripe.webhooks.constructEventAsync` exists specifically for Edge runtimes (Cloudflare Workers, Vercel Edge Functions) where Node's synchronous `crypto` isn't available | Introduced as the SDK added Edge support | Not directly relevant unless the route handler's `runtime` export is set to `"edge"` — leave it as the Node.js default (implicit) and use the synchronous `constructEvent`, matching every other route in this codebase which already assumes Node APIs (e.g. `clamscan`, `@aws-sdk/*`) |

**Deprecated/outdated:** None specific to this SDK version at time of research — `stripe` 22.6.1 is current as of 2026-09-09.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommending `stripe` npm package name/API shape (Checkout Sessions, webhooks) is correct despite training-data currency concerns for a fast-moving SDK | Standard Stack, Code Examples | Low — cross-checked against current WebSearch results and the actual installed-version registry metadata (798 versions, weekly cadence, official repo); the core API shape (`checkout.sessions.create`, `webhooks.constructEvent`) has been stable across major versions for years |
| A2 | Stripe's NGN presentment-currency support will work for this project's specific Stripe account without additional Nigeria-specific account configuration | Pitfall 5 | High if wrong — every seeded demo cohort is NGN-priced; if Stripe rejects NGN Checkout Sessions on the actual account, the entire checkout flow is blocked for all current demo/seed data until pricing or the payment method is reconsidered. This is an absence-of-evidence situation (this research could not access the actual Stripe account) and is flagged, not resolved |
| A3 | The recommended `applyEnrolmentActivation` extraction (Architecture Pattern 3) is the right shape, rather than e.g. reusing `approveEnrolment` with an internal actor-bypass flag | Architecture Patterns §3, Pitfall 3 | Medium — this is a genuinely new architectural decision (no Phase-6-shaped precedent existed before this phase), derived by analogy from `applyEnrolmentExit`/`hold-release-system-service.ts`. It is a strong, consistent analogy but the planner should confirm this shape rather than treat it as already-proven code |
| A4 | Recommending `"order.created"`, `"order.paid"`, `"enrolment.activated"`, `"order.exception"` as the exact new `DomainEventType` literals to add | Pitfall 8 | Low — the literal names are a naming convenience the planner/executor can freely adjust; the load-bearing fact (the union is closed and must be edited) is what matters |
| A5 | An httpOnly cookie is the right mechanism for D-14's cohort-selection persistence (vs. a DB-backed intent record) | Architecture Patterns §2 | Low-Medium — CONTEXT.md explicitly leaves this to planner discretion; the cookie approach is simpler and has no schema cost, but breaks if the learner switches devices/browsers between clicking Enroll and clicking the verification email link. A DB-backed intent record (keyed on the pending User row) would survive a device switch but adds a new table for a v1 feature whose failure mode (falls back to `/account`, per REG-02's own "if still valid" qualifier) is already graceful |

## Open Questions

1. **Does the deployment's actual Stripe account support NGN Checkout Sessions end-to-end (test AND live mode)?**
   - What we know: NGN is a documented Stripe presentment currency, tied to Nigeria-specific payment methods/account setup.
   - What's unclear: Whether the specific Stripe account this project will use has NGN enabled, and whether test-mode success implies live-mode success.
   - Recommendation: `checkpoint:human-verify` — create a real test-mode Checkout Session with `currency: "ngn"` against the project's actual Stripe test keys before writing extensive Checkout-session code against seeded NGN cohort data.

2. **Should `checkout.session.expired` also drive the D-10 "hold expired, show an error" UX, or does the app rely solely on the pre-existing hold-expiry worker for that signal?**
   - What we know: Stripe emits `checkout.session.expired` when a session times out unpaid (default 24h) — much later than the 30-min hold TTL in most cases, so the hold-release worker will almost always fire first and the learner will already see D-10's error via a direct hold-expiry check on page load, not via this webhook event.
   - What's unclear: Whether there's a narrow window where the Stripe session is still valid (has not hit its own 24h expiry) but the seat hold has expired, and what the app should do if a learner is STILL on Stripe's page (not yet redirected back) when that happens — Stripe itself has no way to notify the app's UI mid-session.
   - Recommendation: Treat this as already covered by Pitfall 4's exception-state handling (whichever event arrives, the transition-guard catch handles it); no separate handling needed for `checkout.session.expired` beyond an optional cosmetic `PaymentAttempt` status update for reconciliation views.

3. **Exact `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` environment variable names and where they're documented.**
   - What we know: `.env.example` exists in the repo but this research session could not read it (blocked by a deny rule, the same restriction Phase 3's research hit for Brevo's variable names).
   - What's unclear: Whether any placeholder Stripe env vars already exist there, or what naming convention (`STRIPE_SECRET_KEY` vs `STRIPE_API_KEY`, etc.) the project prefers.
   - Recommendation: Same resolution Phase 3 used (D-21) — the executor opens `.env.example` directly at execution time (not blocked in the actual execution environment) and either uses the existing naming or adds it following whatever convention is already there.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v24.6.0 [VERIFIED: `node --version`] | — |
| npm | Package install | ✓ | 11.5.1 [VERIFIED: `npm --version`] | — |
| PostgreSQL | Order/PaymentAttempt/WebhookEvent storage, Testcontainers integration tests | ✓ | listening on :5432 [VERIFIED: `pg_isready`] | — |
| Docker | `docker-compose.yml` stack, Testcontainers-based integration tests | ✗ (not running in this research sandbox) | — | Existing test suite already depends on Docker/Testcontainers for `tests/*.integration.test.ts` — this is a pre-existing project dependency, not new to Phase 6; the actual execution environment is expected to have it (per `docker-compose.yml`'s presence and Phase 4/5's established Testcontainers usage) |
| `stripe` npm package | Checkout Session creation, webhook verification | ✗ (not yet installed) | not installed — `npm view stripe version` confirms `22.6.1` available on the registry | None — this is the phase's core new dependency; install is gated behind the `checkpoint:human-verify` in the Package Legitimacy Audit |
| Stripe test-mode API keys / webhook signing secret | All Stripe API calls and webhook verification | Unknown — could not be verified from this sandbox (`.env.example` read blocked) | — | Executor confirms at execution time per Open Question 3 |

**Missing dependencies with no fallback:** `stripe` npm package (expected — this phase installs it) and confirmed Stripe test-mode credentials (needed before any live end-to-end test of the checkout flow is possible).

**Missing dependencies with fallback:** Docker/Testcontainers — not available in this research sandbox but already a standing project dependency for the integration-test pattern Phase 6 should extend, not a new gap this phase introduces.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.11 [VERIFIED: `package.json:56`] |
| Config file | `vitest.config.mts` |
| Quick run command | `npm test -- tests/checkout-service.test.ts` (unit, no DB) |
| Full suite command | `npm test` (== `vitest run --no-file-parallelism`, `package.json:13` — the `--no-file-parallelism` flag matters because Testcontainers-backed integration tests share a Postgres container per the existing `tests/*.integration.test.ts` pattern) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REG-01 | Public cohort page shows price/dates/mode/availability/prerequisites | component/unit | `npm test -- tests/public-catalogue-service.test.ts` | ❌ Wave 0 (extend existing suite if one covers `public-catalogue-service.ts` today, else create) |
| REG-02 | Cohort selection survives register→verify→signin round-trip | integration | `npm test -- tests/checkout-intent.integration.test.ts` | ❌ Wave 0 |
| REG-03 | One Order per checkout attempt; concurrent "Pay" submissions and webhook replays produce exactly one PaymentAttempt SUCCEEDED / one ACTIVE Enrolment | integration (Testcontainers) | `npm test -- tests/checkout-webhook.integration.test.ts` | ❌ Wave 0 |
| REG-04 | PolicyAcceptance rows (terms/refund-cancellation/marketing) created with correct type/version/orderId | unit | `npm test -- tests/checkout-service.test.ts` | ❌ Wave 0 |
| REG-05 | Confirmation email dispatched + `/orders/[reference]` shows required fields after PAID | integration | `npm test -- tests/checkout-webhook.integration.test.ts` | ❌ Wave 0 (same file as REG-03, different assertions) |
| PAY-02 | Order/PaymentAttempt state transitions are valid and idempotent | unit | `npm test -- tests/checkout-service.test.ts` | ❌ Wave 0 |
| PAY-09 | No Stripe-specific type/logic leaks outside `src/server/payments/providers/stripe/` | boundary/lint | code-review checkpoint, not a Vitest assertion | n/a |
| PAY-10 | Invalid webhook signature rejected with no state mutation; redirect-only page load never marks PAID | integration | `npm test -- tests/checkout-webhook.integration.test.ts` | ❌ Wave 0 (same file, dedicated test cases) |
| — | Seat hold expires while Stripe webhook is in flight (Pitfall 4 race) | integration (Testcontainers) | `npm test -- tests/checkout-hold-race.integration.test.ts` | ❌ Wave 0 — extends the existing `tests/hold-release.integration.test.ts`/`tests/seat-accounting.integration.test.ts` concurrency-proving pattern to include a webhook arriving after the sweep |

### Sampling Rate
- **Per task commit:** the relevant unit test file for the service just touched (e.g. `checkout-service.test.ts`)
- **Per wave merge:** `npm test` (full suite, including all Testcontainers integration tests — matches how Phase 5 validated the seat-accounting race)
- **Phase gate:** Full suite green before `/gsd-verify-work`, PLUS a manual end-to-end run against Stripe TEST mode (card-decline retry, successful payment, webhook received) since no automated test can substitute for an actual round-trip through Stripe's hosted page

### Wave 0 Gaps
- [ ] `tests/checkout-service.test.ts` — unit coverage for Order/PaymentAttempt/PolicyAcceptance creation logic (REG-03, REG-04, PAY-02)
- [ ] `tests/checkout-webhook.integration.test.ts` — Testcontainers-backed: signature rejection, idempotent replay, successful activation, the illegal-transition/exception path (REG-03, REG-05, PAY-10, Pitfall 4's happy-path complement)
- [ ] `tests/checkout-hold-race.integration.test.ts` (or extend `tests/hold-release.integration.test.ts`) — the specific hold-expires-before-webhook race (Pitfall 4)
- [ ] `tests/checkout-intent.integration.test.ts` — cohort selection surviving the auth round-trip (REG-02)
- [ ] Extend `tests/boundary.test.ts` — assert the new webhook route does not import `@prisma/client` directly, and (if a dedicated webhook-runtime import-closure concept is introduced) that `checkout-webhook-system-service.ts` never imports `@/server/permissions` or `next/headers`, mirroring the existing worker-closure check

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Yes | Existing database-session model (`getCurrentActor`) gates every checkout page/action; the webhook route is explicitly NOT session-authenticated — it is authenticated by HMAC signature instead (V6-adjacent), which is the correct model for a server-to-server callback |
| V3 Session Management | No new surface | Reuses existing session cookie infrastructure unchanged |
| V4 Access Control | Yes | Ownership comparison (`order.userId === actor.userId`) on every order-scoped read/write — same model as `profile-service.ts`, no new permission catalogue entries |
| V5 Input Validation | Yes | Webhook payload is a Stripe-typed `Stripe.Event` post-`constructEvent`, but any field the app reads out of it and persists (amounts, currency, ids) should still be validated/narrowed (e.g. zod) before it reaches a DB write — never trust `session.amount_total`/`session.currency` blindly as the source of truth for what was CHARGED; cross-check against `Order.amountMinor`/`Order.currency` recorded at Order-creation time and treat a mismatch as an exception, not an overwrite |
| V6 Cryptography | Yes | Webhook signature verification via `stripe.webhooks.constructEvent` — never hand-rolled (Don't Hand-Roll table); `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` live in deployment-managed secret storage only (PAY-14), never in client-visible code, exports, or audit payloads (`redactForAudit` already runs on every `DomainEvent`/`AuditEvent` payload — confirm Stripe raw event payloads stored in `WebhookEvent.payload` don't carry anything PAY-14 forbids; Stripe Checkout Session objects do not include full card numbers, but do include the customer's email — treat that as normal PII already covered by existing data-handling policy, not a secret) |

### Known Threat Patterns for Stripe Checkout + webhook integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Forged webhook POST (attacker submits a fake "payment succeeded" body without a valid Stripe signature) | Spoofing | `stripe.webhooks.constructEvent` rejects with a thrown error → route returns 400, nothing is mutated (PAY-10) |
| Webhook replay (legitimate event re-delivered, or a captured request replayed by an attacker) | Tampering / Replay | `WebhookEvent` unique constraint on `(provider, providerEventId)`, insert-first (Pitfall 2) |
| Success-URL redirect manipulation (hand-navigating to `success_url` without paying) | Spoofing / Tampering | The redirect target reads live `Order.status` from the DB; only the webhook path writes `PAID` (D-05, PAY-10) |
| IDOR on `/orders/[reference]` or `/checkout/[orderId]` (guessing another learner's order id/reference) | Elevation of Privilege | Ownership check (`order.userId === actor.userId`) before rendering any order data, mirroring `profile-service.ts`'s pattern; `Order.reference` should not be sequential/guessable (Code Example 4 uses a random suffix, not an incrementing counter) |
| Client-supplied amount/currency tampering (a manipulated Checkout Session creation request trying to pay less than the cohort price) | Tampering | `amountMinor`/`currency` for the Stripe Checkout Session are ALWAYS derived server-side from the `Cohort` row at Order-creation time (D-07 already locks this) — never accepted as a parameter from the client |
| Duplicate "Pay" submission (rapid double-click, or a retried Server Action) creating two Checkout Sessions / two Orders | Tampering (unintended duplication) | `Order.idempotencyKey`/`PaymentAttempt.idempotencyKey` unique DB constraints + Stripe's own request-level `idempotencyKey` option (Code Example 1) |
| Secrets in logs/audit trail (Stripe secret key or webhook signing secret ending up in an `AuditEvent`/`DomainEvent` payload or a thrown-error message logged verbatim) | Information Disclosure | `redactForAudit` already runs on every audit/domain-event payload; still, avoid interpolating raw Stripe SDK error objects (which can echo back request parameters) directly into logged strings — same discipline `brevo-client.ts`'s `describeBrevoFailure` already applies for Brevo errors |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view stripe ...`) — version 22.6.1, publish date, repository URL, maintainer, 798 versions, no postinstall script [VERIFIED: npm registry]
- `api.npmjs.org/downloads/point/last-week/stripe` — 18,069,705 weekly downloads [VERIFIED: npm registry]
- In-repo source read this session: `prisma/schema.prisma` (Order :1229-1262, PaymentAttempt :1266-1307, Refund :1311+, WebhookEvent :1339-1353, PolicyAcceptance :330-343, Enrolment :905-956, Cohort :731-803, EmailDispatch :1463-1478, AuditEvent :422-445, enums :47-176), `src/server/services/seat-accounting.ts`, `src/server/services/enrolment-service.ts`, `src/server/services/hold-release-system-service.ts`, `src/server/services/scan-system-service.ts`, `src/server/auth/current-actor.ts`, `src/server/auth/landing.ts`, `src/server/services/profile-service.ts`, `src/server/services/public-catalogue-service.ts`, `src/server/services/domain-event-service.ts`, `src/server/services/audit-service.ts`, `src/server/services/email-dispatch-service.ts`, `src/server/email/brevo-client.ts`, `src/lib/identity.ts`, `src/server/permissions/catalogue.ts` (payments.* lines 49-51), `tests/boundary.test.ts`, `worker/index.ts`, `worker/handlers/release-expired-holds.ts`, `src/app/account/actions.ts`, `src/app/account/layout.tsx`, `src/app/(auth)/signin/actions.ts`, `src/app/(auth)/register/actions.ts`, `src/app/(auth)/verify/actions.ts`, `src/app/(public)/courses/[slug]/page.tsx`, `prisma/seed.ts` (:319-320, :360-361, :406-407), `package.json`
- `git log`/`git show` on commit `6deffb982b3902973d0c2dfee485743d50f279a3` (state_head) confirming CR-01/02/03 fixes from `05-REVIEW.md` are committed at current HEAD [VERIFIED: git]

### Secondary (MEDIUM confidence)
- WebSearch, cross-checked against multiple independent current sources: Stripe Checkout Session creation shape and metadata/client_reference_id usage; raw-body App Router webhook pattern (`req.text()` before `constructEvent`); Stripe webhook idempotency/event.id tracking best practice; Stripe idempotency-key request option for `checkout.sessions.create`; Next.js `router.refresh()` polling pattern; Stripe NGN presentment-currency documentation pages

### Tertiary (LOW confidence)
- Whether the project's actual Stripe account has NGN enabled end-to-end (Pitfall 5, Open Question 1) — could not be verified from this sandbox; flagged for a human checkpoint rather than asserted

## Metadata

**Confidence breakdown:**
- Standard stack (Stripe SDK choice/version): HIGH — verified against the npm registry directly, cross-checked with current WebSearch results, no conflicting information found
- Architecture (webhook-authorization pattern, event/state-machine wiring): MEDIUM-HIGH — the individual pieces (`hold-release-system-service.ts` precedent, `WebhookEvent` idempotency table, closed `DomainEventType` union) are all directly read from the codebase this session (HIGH), but the specific combination into a new `checkout-webhook-system-service.ts` is this research's own synthesis, not a pattern that already exists verbatim anywhere in the repo — treat as a strong recommendation, not settled fact
- Pitfalls: HIGH for the Stripe-specific ones (raw body, signature verification, idempotency — all directly grounded in official/cross-checked sources and existing schema); MEDIUM for the NGN-currency pitfall (real but unverifiable from this sandbox) and the seat-hold-race pitfall (logically derived from reading both subsystems' code, not observed in an actual production incident)

**Research date:** 2026-09-09
**Valid until:** ~14 days for the Stripe SDK-version specifics (fast-moving package, weekly releases) — re-verify `npm view stripe version` at execution time if more than ~2 weeks pass; ~30 days for the architectural/pattern findings (in-repo code, changes only if Phase 5's services are refactored again before Phase 6 executes)
