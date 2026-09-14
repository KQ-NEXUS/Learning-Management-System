# Phase 7: Multi-Gateway Payments, Learner-Paid Fees, Split Settlement, Manual Payments and Refunds — Pattern Map

**Mapped:** 2026-09-12
**Files analyzed:** 31 (create/modify, across schema, server, providers, scheduled, routes, staff UI, learner UI)
**Analogs found:** 29 / 31 (2 have no direct analog — flagged below, use RESEARCH.md's cited external API shapes instead)

> This document does not re-derive facts `07-RESEARCH.md` already verified with exact line numbers —
> it cites them and adds the concrete excerpt shape the planner needs per file. See
> `07-RESEARCH.md`'s "Task-by-Task Drift Reconciliation" section for the underlying verification.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `prisma/schema.prisma` (Cohort dual price, `GatewayFeeSchedule`, Order/PaymentAttempt/Refund snapshot fields) | model | CRUD | same file, existing `Order`/`PaymentAttempt`/`Refund` models | exact (additive to same file) |
| `prisma/migrations/20260911120000_dual_currency_split_settlement/migration.sql` | migration | batch | prior migration directories (8 existing) | exact |
| `src/server/payments/pricing.ts` | utility | transform | none in-tree (genuinely new, pure module) | no analog — build per D-10/D-12, see below |
| `src/server/payments/routing.ts` | utility | transform | none in-tree (genuinely new) | no analog — trivial, see below |
| `src/app/staff/cohorts/CohortForm.tsx` (dual price fields) | component | CRUD (form) | itself, existing `priceMinor`/`currency` `FormField` pair | exact (same file, duplicate-and-diverge) |
| `src/app/staff/cohorts/actions.ts` (dual price validation) | controller (server action) | request-response | itself, existing `priceMinor`/`currency` zod validation | exact |
| `src/server/services/readiness-service.ts` (per-rail price check) | service | CRUD | itself, existing single-price check | exact |
| `src/app/staff/cohorts/[id]/page.tsx` (dual price facts + readiness items) | component | request-response | itself, existing Price `DetailFacts` row + `ReadinessPanel` wiring | exact |
| `src/server/services/checkout-service.ts` (`startCheckout` +currency param) | service | CRUD (transaction) | itself, existing `startCheckout` | exact |
| `src/app/(checkout)/enrol/[cohortId]/page.tsx` / `actions.ts` (currency-aware call site) | controller (server action) | request-response | itself, existing single-currency call site | exact |
| `src/server/payments/payment-provider.ts` (`PaymentProviderAdapter` interface) | service | request-response | `src/server/payments/providers/stripe/checkout-session.ts` (the function this interface generalizes) | role-match |
| `src/server/payments/providers/paystack/client.ts` | service (adapter) | request-response | `src/server/payments/providers/stripe/client.ts`; secondarily `src/server/integrations/brevo-client.ts`-style thin fetch wrapper (cited in RESEARCH.md) | role-match |
| `src/server/payments/providers/paystack/initialize.ts` | service (adapter) | request-response | `src/server/payments/providers/stripe/checkout-session.ts` | role-match |
| `src/server/payments/providers/paystack/webhook.ts` | service (adapter, crypto) | event-driven | `src/server/payments/providers/stripe/webhook.ts` | role-match (different HMAC algorithm) |
| `src/app/api/webhooks/paystack/route.ts` | route | event-driven | `src/app/api/webhooks/stripe/route.ts` | exact (role + data flow) |
| `tests/checkout-phase-invariants.test.ts` (generalize `findProviderIsolationViolations`) | test | transform (AST scan) | itself, existing `STRIPE_PROVIDER_DIR` scan | exact |
| `src/server/payments/providers/stripe/checkout-session.ts` (+`transfer_data`) | service (adapter) | request-response | itself, existing `buildCheckoutSessionParams` | exact |
| `src/server/services/checkout-webhook-system-service.ts` (extend `activateOrderAsSystem`, add actual-settlement recording) | service | event-driven / CRUD | itself, existing `activateOrderAsSystem`/`recordPaymentFailureAsSystem` | exact |
| `src/server/services/payment-reconciliation-service.ts` | service | batch | `checkout-webhook-system-service.ts` (settlement-writing discipline) + `hold-release-system-service.ts` (batch `AsSystem` shape) | role-match |
| `src/server/scheduled/reconcile-payments-task.ts` | service (scheduled task factory) | batch | `src/server/scheduled/release-expired-holds-task.ts` | exact |
| `netlify/functions/reconcile-payments.ts` | config (function wiring) | event-driven (cron) | `netlify/functions/release-expired-holds.ts` | exact |
| `src/server/services/manual-payment-service.ts` | service (staff action) | CRUD | `checkout-webhook-system-service.ts`'s `activateOrderAsSystem` (must call into it, not replicate) | role-match |
| `src/server/services/refund-service.ts` | service (staff action + provider adapter) | CRUD / request-response | none in-tree for refunds specifically; nearest shape is `manual-payment-service.ts` (sibling, same phase) + Paystack/Stripe refund API cited in RESEARCH.md | no strong in-tree analog — see Code Examples below |
| `src/app/staff/payments/page.tsx` | component (list) | request-response | `src/app/staff/enrolments/page.tsx` or any other `ResourceTable`-based staff list (e.g. `src/app/staff/users/page.tsx`) | role-match |
| `src/app/staff/payments/[orderId]/page.tsx` | component (detail) | request-response | `src/app/staff/cohorts/[id]/page.tsx` (`DetailLayout`, stacked-mode analog: any existing stacked `DetailLayout` consumer) | role-match |
| `ManualPaymentDialog` (new component under `src/app/staff/payments/` or `src/components/catalogue/`) | component (dialog) | request-response | `src/components/catalogue/PublishDialog.tsx` | exact (explicit UI-SPEC precedent) |
| `RefundDialog` (new component, same directory convention as above) | component (dialog) | request-response | `src/components/catalogue/PublishDialog.tsx` | exact (explicit UI-SPEC precedent) |
| `src/app/(public)/CohortCards.tsx` (dual-currency CTA pair) | component | request-response | itself, existing single "Enroll now" button | exact |
| `src/app/(checkout)/checkout/[orderId]/page.tsx` (4-line breakdown card) | component | request-response | itself, existing single "Price" fact in the `<dl>` grid | exact |
| `src/app/(checkout)/orders/[reference]/page.tsx` (4-line breakdown, receipt) | component | request-response | itself, existing single "Amount" fact | exact |
| `src/app/staff/layout.tsx` (nav entry) | config | request-response | itself, existing flat `StaffNavItem[]` array | exact |
| `tests/checkout-phase-invariants.test.ts` (Task 9 legacy-reference invariant) | test | transform (AST scan) | itself, existing two AST-walk invariants | exact |

## Pattern Assignments

### `prisma/schema.prisma` — dual price, `GatewayFeeSchedule`, snapshot fields

**Analog:** same file, existing `Cohort`/`Order`/`PaymentAttempt`/`Refund` blocks `[VERIFIED in RESEARCH.md: prisma/schema.prisma:729-801,1227-1351]`

**Core pattern (additive columns, no destructive change):**
```prisma
model Cohort {
  priceMinor Int      // legacy — kept until Task 9 drops it
  currency   String   @default("NGN")
  priceNgnMinor Int?   // new, nullable — D-06, D-08
  priceUsdMinor Int?   // new, nullable — D-06, D-08
}

model Order {
  amountMinor Int
  currency    String
  status      OrderStatus
  selectedProvider PaymentProvider?
  // new, additive, D-13:
  baseAmountMinor              Int?
  platformFeeMinor             Int?
  gatewayFeeEstimateMinor      Int?
  gatewayFeeScheduleId         String?
  gatewayFeeScheduleVersion    Int?
  schoolSettlementExpectedMinor Int?
}
```
`PaymentStatus.PENDING_MANUAL_REVIEW` and `RefundStatus.RECORDED_MANUALLY` already exist in the enum unions (lines 141-148, 160-166) — reuse, do not re-add.

**Migration naming pattern:** `prisma/migrations/YYYYMMDDHHMMSS_snake_case_name/migration.sql`, matching 8 existing migration directories.

---

### `src/server/payments/pricing.ts` and `routing.ts` (no in-tree analog)

**No analog found** — genuinely new, pure, dependency-free modules (confirmed: nothing exists under `src/server/payments/` except `providers/stripe/` and a `.gitkeep`). Build directly from CONTEXT.md's formulas, not from an existing file:

```ts
// D-10
export function calculatePlatformFeeMinor(baseAmountMinor: number): number {
  return roundHalfUp((baseAmountMinor * 150) / 10_000);
}

// D-12 — uncapped case; apply threshold/cap from GatewayFeeSchedule before this final step
// totalMinor = ceil((baseAmountMinor + platformFeeMinor + fixedMinor) / (1 - rate))
// gatewayFeeEstimateMinor = totalMinor - baseAmountMinor - platformFeeMinor

// D-07 — routing.ts
export function providerForCurrency(currency: "NGN" | "USD"): "PAYSTACK" | "STRIPE" {
  return currency === "NGN" ? "PAYSTACK" : "STRIPE";
}
```
**Constraint (D-24):** integer minor units only, checked overflow, deterministic rounding — no floating point (`price * 0.015` is explicitly forbidden per RESEARCH.md's Don't-Hand-Roll table).

---

### `src/app/staff/cohorts/CohortForm.tsx` — dual price fields

**Analog:** same file, existing `priceMinor`/`currency` `FormField` pair `[VERIFIED: src/app/staff/cohorts/CohortForm.tsx:59-60,299-326]`

**Imports (unchanged):**
```tsx
import { ResourceForm, FormField, TextInput } from "@/components/primitives";
```

**Core pattern to duplicate-and-diverge (values type + two independent fields, neither required per D-08):**
```tsx
export type Values = {
  // ...
  priceNgnMinor?: number;
  priceUsdMinor?: number;
};

<FormField
  name="priceNgnMinor"
  label="NGN base price"
  error={errorFor("priceNgnMinor")}
  hint="Whole integer minor units (kobo) — e.g. 45000000 for ₦450,000.00. Leave blank if this Cohort does not sell in NGN."
>
  {(field) => (
    <TextInput {...field} type="number" min={0} step={1} mono defaultValue={values.priceNgnMinor ?? ""} />
  )}
</FormField>
// second FormField, name="priceUsdMinor", label="USD base price", same shape, no `required` on either
```
Neither field carries `required` (contrast with the existing `priceMinor` field's `required` at line 301) — D-08 blocks publication via readiness, not form validation.

---

### `src/server/services/readiness-service.ts` — per-rail price check

**Analog:** itself, `ReadinessCohortInput` type + price check `[VERIFIED in RESEARCH.md: src/server/services/readiness-service.ts:262-269,350-364]`

Existing shape: `ReadinessCohortInput` carries `priceMinor: number; currency: string | null`, and a single currency+non-negative-price test at lines 350-364. Replace with two independent per-rail checks, one `ReadinessItem` each (`id: "price-ngn"` / `id: "price-usd"`), `blocking: true` only for rails this deployment enables (per UI-SPEC §7.1) — reuse the exact `ReadinessItem` shape (`id`/`category`/`label`/`blocking`/`state`/`detail`) already used for `catalogue`/`schedule`/`capacity`.

---

### `src/server/services/checkout-service.ts` — `startCheckout` + currency, snapshot, provider

**Analog:** same file, existing `startCheckout` `[VERIFIED: src/server/services/checkout-service.ts:266-351]` (full excerpt read this session)

**Core transaction pattern to extend (add currency param; compute provider + fee snapshot before `tx.order.create`; leave lock/supersede/takeSeat/writeDomainEvent structure untouched):**
```ts
async function startCheckout(actor: Actor, cohortId: string, currency: "NGN" | "USD"): Promise<{ orderId: string }> {
  const { orderId } = await deps.db.$transaction(async (tx) => {
    await lockOpenCohort(tx, cohortId);
    const cohort = await tx.cohort.findUnique({
      where: { id: cohortId },
      select: { title: true, priceNgnMinor: true, priceUsdMinor: true, holdMinutes: true },
    });
    // supersede existing PENDING_PAYMENT hold — UNCHANGED, lines 285-300
    const provider = providerForCurrency(currency);                 // Task 2
    const baseAmountMinor = currency === "NGN" ? cohort.priceNgnMinor : cohort.priceUsdMinor;
    const breakdown = calculateCheckoutBreakdown({ baseAmountMinor, currency, provider }); // Task 2
    const order = await tx.order.create({
      data: {
        reference: generateOrderReference(),
        userId: actor.userId,
        cohortId,
        amountMinor: breakdown.amountMinor,          // learner total, D-13
        currency,
        selectedProvider: provider,
        baseAmountMinor,
        platformFeeMinor: breakdown.platformFeeMinor,
        gatewayFeeEstimateMinor: breakdown.gatewayFeeEstimateMinor,
        gatewayFeeScheduleId: breakdown.gatewayFeeScheduleId,
        gatewayFeeScheduleVersion: breakdown.gatewayFeeScheduleVersion,
        schoolSettlementExpectedMinor: baseAmountMinor,
        status: "PENDING",
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      },
      select: { id: true },
    });
    const enrolment = await takeSeat(tx, { /* UNCHANGED, lines 316-325 */ });
    await writeDomainEvent(tx, { /* UNCHANGED shape, add new snapshot fields to payload */ });
    return { orderId: order.id };
  });
  await deps.audit({ /* UNCHANGED, lines 342-348 */ });
  return { orderId };
}
```
`getOwnOrder`/`getOwnOrderByReference`/`getOwnVerificationStatus`/`getCohortOfferPath` must be preserved unchanged.

---

### `src/server/payments/providers/paystack/webhook.ts` — HMAC-SHA512 verification

**Analog:** `src/server/payments/providers/stripe/webhook.ts` (full file, `[VERIFIED: src/server/payments/providers/stripe/webhook.ts:1-45]`)

**Auth/verification pattern to mirror (raw-body-first discipline, thrown typed error, never `===` compare):**
```ts
// stripe/webhook.ts — the shape to replicate
export class StripeSignatureError extends Error { /* ... */ }
export function verifyStripeWebhook(rawBody: string, signature: string | null, secret: string | undefined): Stripe.Event {
  if (!signature || !secret) throw new StripeSignatureError();
  try { return getStripe().webhooks.constructEvent(rawBody, signature, secret); }
  catch { throw new StripeSignatureError(); }
}
```
**Paystack replacement (HMAC-SHA512, not SHA-256 — different algorithm from Stripe's SDK-internal one; must use `crypto.timingSafeEqual`, per RESEARCH.md's Code Examples and Don't-Hand-Roll table):**
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export class PaystackSignatureError extends Error {
  constructor(message = "Paystack webhook signature verification failed.") {
    super(message);
    this.name = "PaystackSignatureError";
  }
}

export function verifyPaystackWebhook(rawBody: string, signatureHeader: string | null, secret: string | undefined): unknown {
  if (!signatureHeader || !secret) throw new PaystackSignatureError();
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new PaystackSignatureError();
  }
  return JSON.parse(rawBody);
}
```
Pitfall (RESEARCH.md Pitfall 1): after signature verification, still call the Verify Transaction endpoint and check `data.status === "success"`, never the top-level `status`.

---

### `src/app/api/webhooks/paystack/route.ts`

**Analog:** `src/app/api/webhooks/stripe/route.ts` (full file header + `POST` handler read this session, `[VERIFIED: src/app/api/webhooks/stripe/route.ts:1-70]`)

**Core pattern (raw body first, narrow provider-agnostic type instead of SDK type, delegate to shared settlement service, never write `PAID` itself — PAY-10):**
```ts
import { verifyPaystackWebhook, PaystackSignatureError } from "@/server/payments/providers/paystack/webhook";
import {
  recordWebhookEventOrSkip,
  activateOrderAsSystem,
  recordPaymentFailureAsSystem,
} from "@/server/services/checkout-webhook-system-service";

// Deliberately NOT any Paystack SDK/response type — this file lives outside
// providers/paystack/, so a Paystack-namespaced type here fails the
// generalized provider-isolation scan (tests/checkout-phase-invariants.test.ts).
type VerifiedPaystackEvent = { event: string; data: { id: number; reference: string; status: string; amount: number; currency: string } };

export async function POST(req: Request): Promise<Response> {
  const body = await req.text(); // RAW bytes — never re-parsed before verification
  const signature = req.headers.get("x-paystack-signature");
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return new Response(null, { status: 500 });

  let event: VerifiedPaystackEvent;
  try {
    event = verifyPaystackWebhook(body, signature, secret) as VerifiedPaystackEvent;
  } catch (err) {
    if (err instanceof PaystackSignatureError) return new Response(null, { status: 400 }); // zero writes past this point
    throw err;
  }
  // recordWebhookEventOrSkip({ provider: "PAYSTACK", providerEventId: String(event.data.id) }) then
  // independently re-verify via Paystack's Verify Transaction endpoint before calling activateOrderAsSystem —
  // never trust event.data.status alone (Pitfall 1).
}
```
This route must never contain a `status: "PAID"` object-literal assignment — `assertSinglePaidOrderWriter` in `tests/checkout-phase-invariants.test.ts` mechanically enforces this (`[VERIFIED in RESEARCH.md: tests/checkout-phase-invariants.test.ts:151-169]`).

---

### `tests/checkout-phase-invariants.test.ts` — generalize provider-isolation scan for Paystack

**Analog:** itself, existing `findProviderIsolationViolations` / `STRIPE_PROVIDER_DIR` scan `[VERIFIED in RESEARCH.md: tests/checkout-phase-invariants.test.ts:89-100, quoted \`if (specifier === "stripe")\` at line 94]`

**Pattern (generalize, do not duplicate — RESEARCH.md Pitfall 5):**
```ts
const STRIPE_PROVIDER_DIR = path.join("server", "payments", "providers", "stripe");
const PAYSTACK_PROVIDER_DIR = path.join("server", "payments", "providers", "paystack");

const PROVIDER_ISOLATION_RULES = [
  { dir: STRIPE_PROVIDER_DIR, specifiers: ["stripe"] },
  { dir: PAYSTACK_PROVIDER_DIR, specifiers: [/* internal Paystack type-module specifier(s), no npm package to check */] },
];
// findProviderIsolationViolations(rules: typeof PROVIDER_ISOLATION_RULES) — one shared walk, not two
```

---

### `src/server/payments/providers/stripe/checkout-session.ts` — extend for destination charge

**Analog:** itself, existing `buildCheckoutSessionParams` `[VERIFIED in RESEARCH.md: src/server/payments/providers/stripe/checkout-session.ts:21-55]`

**Core pattern (additive args, additive `transfer_data` key — no restructuring):**
```ts
payment_intent_data: {
  metadata: { orderId: args.orderId, enrolmentId: args.enrolmentId }, // existing, unchanged
  transfer_data: {
    destination: args.connectedAccountId,   // STRIPE_CONNECTED_ACCOUNT_ID, D-02/D-04
    amount: args.schoolSettlementMinor,     // order.baseAmountMinor — NOT the learner total, D-04
  },
  // on_behalf_of: args.connectedAccountId, // ONLY if platform/connected-account countries differ — Pitfall 3
},
```

---

### `src/server/scheduled/reconcile-payments-task.ts` + `netlify/functions/reconcile-payments.ts`

**Analog:** `src/server/scheduled/release-expired-holds-task.ts` + `netlify/functions/release-expired-holds.ts` (both read in full this session, verbatim structure already quoted in RESEARCH.md — replicated below unmodified as the exact shape to copy)

```ts
// netlify/functions/reconcile-payments.ts
import type { Config } from "@netlify/functions";
import { runReconcilePaymentsTask } from "../../src/server/scheduled/reconcile-payments-task";

export function createReconcilePaymentsHandler(run: () => Promise<void>) {
  return async function reconcilePayments(): Promise<void> {
    await run();
  };
}

export default createReconcilePaymentsHandler(runReconcilePaymentsTask);

export const config: Config = {
  schedule: "*/15 * * * *", // discretionary cadence, A5 — lower urgency than the 5-min hold sweep
};
```

```ts
// src/server/scheduled/reconcile-payments-task.ts
import { reconcilePaymentsAsSystem } from "@/server/services/payment-reconciliation-service";

export const RECONCILE_PAYMENTS_BATCH_SIZE = 25;

export type ReconcilePaymentsTaskDeps = {
  reconcilePayments: (batchLimit: number) => Promise<{ reconciled: number; failed: number }>;
  log: (message: string) => void;
};

export function createReconcilePaymentsTask(deps: ReconcilePaymentsTaskDeps) {
  return async function runReconcilePaymentsTask(): Promise<void> {
    const result = await deps.reconcilePayments(RECONCILE_PAYMENTS_BATCH_SIZE);
    deps.log(`[scheduled] reconciled ${result.reconciled} payment attempts; ${result.failed} failed`);
  };
}

export const runReconcilePaymentsTask = createReconcilePaymentsTask({
  reconcilePayments: reconcilePaymentsAsSystem,
  log: (message) => console.info(message),
});
```
This is the corrected replacement for the superpowers plan's `worker/handlers/reconcile-payments.ts`/`worker/index.ts` targets — `worker/` and `pg-boss` no longer exist in this codebase (confirmed absent).

---

### `src/server/services/manual-payment-service.ts` and `refund-service.ts`

**Analog:** `checkout-webhook-system-service.ts`'s `activateOrderAsSystem` signature/discipline (must be the call target, never re-implemented) — `[VERIFIED in RESEARCH.md: ActivateOrderAsSystemInput = { orderId, providerIntentId, amountMinor, currency, eventId }, lines quoted in Pattern 2]`. No direct in-tree analog exists for a staff-initiated manual-confirmation or refund service; the closest structural sibling is this same phase's other new service files (same permission-gated staff-action shape) plus the existing `withPermission`/`payments.confirm`/`refunds.manage` wrapper used across all staff actions.

**Core pattern — manual confirmation must delegate, never write `PAID` itself:**
```ts
// manual-payment-service.ts (new) — calls the ONE settlement writer
import { activateOrderAsSystem } from "@/server/services/checkout-webhook-system-service";

export async function confirmManualPayment(actor: Actor, input: ManualPaymentInput) {
  // permission check: payments.confirm (withPermission wrapper, existing catalogue entry)
  // PAY-04 duplicate guard: if order.status === "PAID", return existing PaymentAttempt, do not re-confirm
  return activateOrderAsSystem({
    orderId: input.orderId,
    providerIntentId: input.reference,       // manual reference stands in for a provider intent id
    amountMinor: input.amountMinor,
    currency: input.currency,
    eventId: `manual:${input.orderId}:${input.reference}`, // idempotency key, mirrors provider+eventId shape
  });
}
```

**Refund API shapes to call (no in-tree analog — cite RESEARCH.md's Code Examples directly):**
```ts
// Paystack refund — POST https://api.paystack.co/refund
type PaystackRefundRequest = { transaction: string; amount?: number; currency?: string; merchant_note?: string };
// Stripe refund of a destination charge — reverse_transfer semantics are an OPEN QUESTION (RESEARCH.md Open Question 1, Pitfall 4)
// not resolved by CONTEXT.md D-22/D-23 — flag for a locked decision before implementing this file in detail.
```

---

### `src/app/staff/payments/page.tsx` (Finance list)

**Analog:** any existing `ResourceTable`-based staff list, e.g. `src/app/staff/cohorts/page.tsx` or `src/app/staff/enrolments/page.tsx` — role-match on `ResourceTable`/`StatusPill` usage confirmed present in `src/components/primitives/ResourceTable.tsx` per UI-SPEC §2.

**Core pattern (per UI-SPEC §7.5):** `ResourceTable<OrderRow>` with columns Order/Learner/Amount/Provider/Payment/Settlement; segmented `Provider` filter (≤4 options auto-segments); no `onCreate`; empty state override `emptyBody="Payments appear here once a learner completes checkout or staff record a manual payment."`

---

### `src/app/staff/payments/[orderId]/page.tsx` (Finance detail)

**Analog:** any existing `DetailLayout`/`DetailFacts` staff detail page (e.g. `src/app/staff/cohorts/[id]/page.tsx`, though that one uses tabbed mode — this new page uses `mode="stacked"` per UI-SPEC §0.3/§7.6).

**Core pattern:** four stacked sections (Learner charge / Settlement / Manual confirmation / Refunds); expected/actual `DetailFacts` pairs render `"— (pending reconciliation)"` for unresolved `null` actual values, never `"0"` (D-14).

---

### `ManualPaymentDialog` / `RefundDialog`

**Analog:** `src/components/catalogue/PublishDialog.tsx` (confirmed read this session per UI-SPEC §0.3 — explicit precedent named by the checked UI-SPEC)

**Core pattern:** custom dialog collecting structured fields (amount/currency/date/channel/reference/evidence for manual payment; amount/reason for refund), gates confirm behind `MIN_REASON = 10`-character reason, reuses `ConfirmModal`'s focus-trap/ESC/return-focus behavior verbatim, `"Action not applied"` failure copy verbatim.

---

## Shared Patterns

### Single settlement writer (PAY-10)
**Source:** `src/server/services/checkout-webhook-system-service.ts`, `activateOrderAsSystem` (`[VERIFIED in RESEARCH.md]`)
**Apply to:** `src/app/api/webhooks/paystack/route.ts`, `manual-payment-service.ts`, `payment-reconciliation-service.ts` — none of these may write `status: "PAID"` directly; all must call `activateOrderAsSystem`. Mechanically enforced by `assertSinglePaidOrderWriter` in `tests/checkout-phase-invariants.test.ts`.

### Provider isolation (PAY-09)
**Source:** `tests/checkout-phase-invariants.test.ts`, `findProviderIsolationViolations` + `STRIPE_PROVIDER_DIR`
**Apply to:** every new Paystack file — no Paystack-specific type/import may appear outside `src/server/payments/providers/paystack/` and its webhook route. Generalize the existing scan function; do not duplicate it (Pitfall 5).

### Raw-body-first webhook verification
**Source:** `src/app/api/webhooks/stripe/route.ts` lines 54-56 (`req.text()` before any parse)
**Apply to:** `src/app/api/webhooks/paystack/route.ts` — same discipline, HMAC-SHA512 instead of Stripe SDK's internal SHA-256 scheme.

### Idempotent webhook dedup
**Source:** `WebhookEvent.@@unique([provider, providerEventId])` (existing model, provider-generic already)
**Apply to:** Paystack webhook route — reuse unmodified, keyed by `provider: "PAYSTACK"` + Paystack's numeric transaction id as `providerEventId`.

### Pure task factory + thin scheduled-function handler
**Source:** `src/server/scheduled/release-expired-holds-task.ts` + `netlify/functions/release-expired-holds.ts`
**Apply to:** `reconcile-payments-task.ts` + `netlify/functions/reconcile-payments.ts`.

### Integer minor-unit arithmetic only (D-24)
**Source:** none in-tree yet for this phase's calculators — a project-wide constraint stated in CONTEXT.md/RESEARCH.md's Don't-Hand-Roll table, not an existing money-math file to copy. No floating point anywhere in `pricing.ts`/`refund-service.ts` allocation math.

### Permission-gated staff actions
**Source:** existing `withPermission`/permission-catalogue pattern (confirmed present for `payments.confirm`/`payments.view`/`refunds.manage`)
**Apply to:** `manual-payment-service.ts`, `refund-service.ts`, `src/app/staff/payments/*` pages.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/server/payments/pricing.ts` | utility | transform | No pure fee-calculator module exists anywhere in `src/server/payments/`; build directly from D-10/D-12's formulas, not from an existing analog |
| `src/server/services/refund-service.ts` | service | CRUD / request-response | No refund-processing service exists yet; nearest sibling is this phase's own `manual-payment-service.ts` (same permission-gated shape) plus the external Paystack/Stripe refund API shapes cited in RESEARCH.md's Code Examples — the Stripe `reverse_transfer` semantics are an open policy question (RESEARCH.md Open Question 1), not resolvable from an existing file |

## Metadata

**Analog search scope:** `src/server/payments/`, `src/server/services/`, `src/app/api/webhooks/`, `src/app/staff/`, `src/app/(checkout)/`, `src/app/(public)/`, `netlify/functions/`, `src/server/scheduled/`, `tests/checkout-phase-invariants.test.ts`, `src/components/primitives/`, `src/components/catalogue/`.
**Files scanned this session (direct Read):** `CohortForm.tsx`, `checkout-service.ts`, `providers/stripe/webhook.ts`, `api/webhooks/stripe/route.ts`, plus full-file/line-ranged excerpts already verified in `07-RESEARCH.md` for `prisma/schema.prisma`, `readiness-service.ts`, `providers/stripe/checkout-session.ts`, `checkout-webhook-system-service.ts`, `release-expired-holds-task.ts`/`release-expired-holds.ts`, `tests/checkout-phase-invariants.test.ts`.
**Pattern extraction date:** 2026-09-12
