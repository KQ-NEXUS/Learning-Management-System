# Phase 6: Registration, Checkout & Stripe Payments - Pattern Map

**Mapped:** 2026-09-09
**Files analyzed:** 14
**Analogs found:** 12 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/payments/providers/stripe/client.ts` | config | request-response | *(none — first Stripe SDK client)* | no analog |
| `src/server/payments/providers/stripe/checkout-session.ts` | utility | transform | `src/server/services/seat-accounting.ts` (pure-helper style, e.g. `holdExpiryFrom`) | role-match |
| `src/server/payments/providers/stripe/webhook.ts` | utility | event-driven | `src/server/services/verification-service.ts` (`consumeToken` — thin verified-input wrapper) | partial |
| `src/server/services/checkout-service.ts` | service | CRUD + request-response | `src/server/services/profile-service.ts` (ownership-authorized, no `withPermission`) + `src/server/services/enrolment-service.ts` (`addEnrolment`'s `$transaction`/`takeSeat` call shape) | exact (composite) |
| `src/server/services/checkout-webhook-system-service.ts` | service | event-driven | `src/server/services/hold-release-system-service.ts` (`*AsSystem`, unauthorized, worker-shaped) | exact |
| `enrolment-service.ts` (add `applyEnrolmentActivation` export) | service | CRUD | `enrolment-service.ts`'s own `applyEnrolmentExit` (module-scope extracted transition body) | exact |
| `src/lib/identity.ts` (add `REFUND_CANCELLATION` policy type) | config | transform | itself — additive edit to existing `POLICY_TYPE`/`POLICY_VERSIONS` | exact |
| `src/server/services/domain-event-service.ts` (extend `DomainEventType` union) | config | transform | itself — additive edit to existing closed union | exact |
| `src/server/auth/landing.ts` (add `checkoutReturnPathFor` + intent cookie) | utility | transform | itself — additive edit alongside existing `landingPathFor` | exact |
| `src/server/services/public-catalogue-service.ts` (extend `PublicCohort`) | service | CRUD (read) | itself — additive `select`/type edit to `upcomingCohorts()` | exact |
| `src/app/api/webhooks/stripe/route.ts` | route | event-driven | *(no existing webhook route — first one)*; closest shape precedent is `src/app/api/lesson-resources/upload/route.ts` (route.ts that stays thin and calls a service, imports no `@prisma/client`) | partial |
| `src/app/(checkout)/checkout/[orderId]/page.tsx` | component | request-response | `src/app/(public)/courses/[slug]/page.tsx` (SSR fact-card page, `notFound()`, `dynamic = "force-dynamic"`) | role-match |
| `src/app/(checkout)/checkout/[orderId]/confirming/page.tsx` + `PollForPayment.tsx` | component | streaming (polling) | `src/app/(auth)/verify/page.tsx` + `ResendVerificationForm.tsx` (server page + small client interaction component pairing) | role-match |
| `src/app/orders/[reference]/page.tsx` | component | request-response | `src/app/(public)/courses/[slug]/page.tsx` (fact-card `<dl>` pattern, ownership-checked variant) | role-match |

## Pattern Assignments

### `src/server/services/checkout-service.ts` (service, CRUD + request-response)

**Analogs:** `src/server/services/profile-service.ts` (ownership model) + `src/server/services/enrolment-service.ts`'s `addEnrolment` (transaction/seat-take shape)

**Ownership-authorization pattern** (`profile-service.ts` lines 1-12, 116-127):
```typescript
/**
 * Authorization here is an ownership comparison, not a permission check —
 * and that is the intended model, not a gap. ... No entry point below accepts
 * a target user id parameter; every one derives the target exclusively from
 * `actor.userId`.
 */
async function getOwnProfile(actor: Actor): Promise<ProfileSnapshot | null> {
  const user = await store.user.findUnique({ where: { id: actor.userId } });
  if (!user) return null;
  // ...
}
```
Apply verbatim to `checkout-service.ts`: `getOwnOrder(actor, orderId)` must derive scope from `actor.userId` only — no `withPermission`, no permission-catalogue entry (RESEARCH's "Don't Hand-Roll" table already confirms no `orders.*` learner-facing permission exists).

**Transaction + seat-take pattern** (`enrolment-service.ts` lines 399-416, `addEnrolment`):
```typescript
const created = await db.$transaction(async (tx) => {
  if (!takesSeat) await lockOpenCohort(tx, input.cohortId);
  const row = takesSeat
    ? await takeSeat(tx, { cohortId: input.cohortId, enrolment: data })
    : await tx.enrolment.create({ data, select: { id: true } });
  await writeDomainEvent(tx, {
    type: "enrolment.created",
    payload: { enrolmentId: row.id, cohortId: input.cohortId, userId: input.userId, status: input.target, actorId: ctx.actor.userId },
  });
  return row;
});
```
`checkout-service.ts`'s `createHoldAndOrder` should mirror this shape exactly: one `$transaction` calling `takeSeat` (imported directly from `seat-accounting.ts`, never re-derived — RESEARCH D-09/D-12) plus `Order.create`, then `writeDomainEvent(tx, { type: "order.created", ... })` in the same transaction.

**Idempotency-key generation** (RESEARCH Code Example 4):
```typescript
import { randomUUID } from "node:crypto";
function generateOrderReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ORD-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
```

**Error handling pattern** — reuse `seat-accounting.ts`'s typed-error style (own file, lines 48-121): `class CapacityExceededError extends Error { ... }` — one class per refusal case, never a raw thrown string. `checkout-service.ts` should catch `CapacityExceededError`/`AlreadyEnrolledError`/`CohortClosedError` from `takeSeat` and translate to Server-Action-friendly result shapes, following the `updateOwnProfile`-style `{ ok: true, ... } | { ok: false, reason: ... }` return contract from `profile-service.ts` lines 47-49.

---

### `src/server/services/checkout-webhook-system-service.ts` (service, event-driven)

**Analog:** `src/server/services/hold-release-system-service.ts` (exact structural match — this is the second `*AsSystem` module in the codebase)

**File-header discipline pattern** (lines 1-51) — copy this warning-comment shape verbatim, adapted to the webhook context:
```typescript
/**
 * WORKER-ONLY / WEBHOOK-ONLY ... — DELIBERATELY unauthorized.
 * ─────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE "FIXING" THE MISSING AUTHORIZATION CHECK.
 * ─────────────────────────────────────────────────────────────────────────
 * The request-scoped permission choke point ... reads the session cookie off
 * the incoming request. A Stripe webhook POST carries no session cookie —
 * there is no actor to authorize. ...
 * This module MUST NOT import the permission choke point, the request
 * actor-getter, `cohort-scope.ts`, or anything under `next/`.
 */
export const SYSTEM_ACTOR_TYPE = "SYSTEM";
```

**Per-row/per-event try-catch with typed-error routing** (lines 154-196):
```typescript
for (const row of work) {
  try {
    await deps.runInTransaction(async (tx) => { /* transition + event */ });
    await deps.audit({ actorId: null, actorType: SYSTEM_ACTOR_TYPE, action: "...", outcome: "SUCCESS", ... });
    released += 1;
  } catch (err) {
    if (err instanceof StaleEnrolmentError) continue;
    failed += 1;
    console.error(`[...] failed ...`, err);
  }
}
```
Adapt for `activateOrderAsSystem`: catch `IllegalTransitionError` specifically (Pitfall 4's race) and route to the `Order.status = "EXCEPTION"` path rather than treating it as a generic failure — this is a DISTINCT branch from `hold-release-system-service.ts`'s "log and skip," because the money already moved and must not be silently dropped.

**Audit-as-SYSTEM pattern** (lines 174-185): `actorId: null, actorType: SYSTEM_ACTOR_TYPE`, distinct action name (`enrolment.hold_expired` there → `enrolment.activated`/`order.paid` here) so the audit trail always distinguishes a system-triggered write from a staff one.

**Prisma-binding footer pattern** (lines 205-221) — same shape for wiring the live `prisma` client and exporting the bound function:
```typescript
const built = createHoldReleaseSystemService({ enrolment: prisma.enrolment as unknown as EnrolmentDelegate, ... });
export function releaseExpiredHoldsAsSystem(...) { return built.releaseExpiredHolds(...); }
```

---

### `enrolment-service.ts` — new export `applyEnrolmentActivation` (extraction)

**Analog:** the file's own `applyEnrolmentExit` (lines 268-324) — the established precedent for factoring a transition body out of a `withPermission`-wrapped action so both an authorized caller and an unauthorized one can call it.

**Extraction shape to copy** (lines 282-324):
```typescript
export async function applyEnrolmentExit(
  tx: EnrolmentExitTxClient,
  args: { enrolment: EnrolmentRow; toStatus: "WITHDRAWN" | "CANCELLED"; reason: string; actorId: string; now: Date },
): Promise<{ id: string; before: EnrolmentStatusValue; toStatus: "WITHDRAWN" | "CANCELLED" }> {
  const { enrolment: e, toStatus, reason, actorId, now } = args;
  const before = e.status as EnrolmentStatusValue;
  assertTransition(before, toStatus, e.id);
  await releaseSeat(tx as unknown as SeatTxClient, { /* ... */ });
  await writeDomainEvent(tx, { type: eventType, payload: { /* ... */ } });
  return { id: e.id, before, toStatus };
}
```
Apply the identical shape to extract `applyEnrolmentActivation(tx, { enrolment, reason, actorId, now })` from `approveEnrolment`'s inline body (`enrolment-service.ts` lines 449-488: `holdsSeat`/`claimSeat`/`lockOpenCohort`/`updateCurrentEnrolment`/`writeDomainEvent` sequence). `approveEnrolment` then calls it (staff path, `withPermission` still gates entry); the new webhook system-service calls it directly with `actorId: null`.

---

### `src/app/(checkout)/checkout/[orderId]/page.tsx` (component, request-response)

**Analog:** `src/app/(public)/courses/[slug]/page.tsx`

**SSR + top-level-await + notFound pattern** (lines 1-39):
```typescript
export const dynamic = "force-dynamic";

export default async function PublicCourseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // TOP-LEVEL await, BEFORE any streaming boundary — a soft-404 after
  // streaming begins does not satisfy "unpublished URLs reveal nothing".
  const course = await getPublicCourseBySlug(slug);
  if (!course) notFound();
  // ...
}
```
For `/checkout/[orderId]`, apply the same top-level-await-before-notFound discipline, but with an ownership check instead of a public-visibility one: fetch the order via `checkoutService.getOwnOrder(actor, orderId)`, and treat "not mine" the same as "not found" (IDOR mitigation per RESEARCH's Security Domain table) rather than a distinguishable 403.

**Fact-card `<dl>` pattern** (lines 73-87) — reuse verbatim for the order-summary card, per `06-UI-SPEC.md` §0.3:
```tsx
<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {facts.map(([label, value]) => (
    <div key={label} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{value}</dd>
    </div>
  ))}
</dl>
```

**Back-link pattern** (lines 49-55) — reuse verbatim for "Back to cohort" on the hold-expired panel (`ChevronLeft` + text, same treatment).

---

### `src/server/auth/landing.ts` (extend for D-14 checkout intent)

**Analog:** the file's own `landingPathFor` (lines 11-16)

```typescript
export const STAFF_LANDING_PATH = "/staff/courses";
export const LEARNER_LANDING_PATH = "/account";

export function landingPathFor(user: { isStaff?: boolean | null }): string {
  return user.isStaff === true ? STAFF_LANDING_PATH : LEARNER_LANDING_PATH;
}
```
Add `checkoutReturnPathFor` alongside, not replacing it (RESEARCH Architecture Pattern 2 gives the exact target shape). The cookie-set/read call sites follow `signInAction`'s existing cookie pattern verbatim.

---

### `signInAction` cookie-set pattern (`src/app/(auth)/signin/actions.ts` lines 1-43)

**Analog for setting/reading the `checkout_intent` cookie:**
```typescript
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const jar = await cookies();
jar.set(SESSION_COOKIE, result.token, {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_DAYS * 86_400,
});
redirect(landingPathFor(result));
```
Apply identically for `checkout_intent`: same `httpOnly`/`sameSite: "lax"`/`secure`-in-prod flags, short `maxAge` (matching `HOLD_MINUTES_DEFAULT` + margin per RESEARCH Pattern 2). Read it in `signInAction`/post-verification flow before falling back to `landingPathFor`.

---

### `src/lib/identity.ts` — add `REFUND_CANCELLATION` policy type

**Analog:** the file's own existing `POLICY_TYPE`/`POLICY_VERSIONS` (lines 27-38)

```typescript
export const POLICY_TYPE = Object.freeze({
  TERMS: "terms",
  PRIVACY: "privacy",
  MARKETING: "marketing",
} as const);

export const POLICY_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  [POLICY_TYPE.TERMS]: "2026-09-02",
  [POLICY_TYPE.PRIVACY]: "2026-09-02",
  [POLICY_TYPE.MARKETING]: "2026-09-02",
});
```
Additive edit: add `REFUND_CANCELLATION: "refund_cancellation"` to `POLICY_TYPE` and a matching version string to `POLICY_VERSIONS` — `PolicyAcceptance.policyType` is a plain string column (Pitfall 7), no schema migration needed. Marketing consent at checkout MUST reuse the existing `POLICY_TYPE.MARKETING` key (same pattern `profile-service.ts`'s `setMarketingPreference`, lines 288-322, already uses), not a parallel checkout-only key.

---

### `src/server/services/public-catalogue-service.ts` — extend `PublicCohort`

**Analog:** the file's own `upcomingCohorts()` (lines 97-117)

```typescript
async function upcomingCohorts(link: { courseId: string } | { programmeId: string }): Promise<PublicCohort[]> {
  const at = now();
  const rows = (await deps.cohortDelegate.findMany({
    where: { ...link, status: "PUBLISHED", startsAt: { gt: at } },
    select: { startsAt: true, enrolmentOpensAt: true, enrolmentClosesAt: true },
    orderBy: { startsAt: "asc" },
  })) as Array<PublicCohort & { status?: string }>;
  return rows.filter(/* ... */).map(/* ... */);
}
```
Extend `select` (add `id`, `endsAt`, `deliveryMode`, `priceMinor`, `currency`, plus a derived `seatsAvailable = capacity - seatsTaken`) and extend the `PublicCohort` type/mapping in the same file — do NOT create a second query path (file's own header comment, lines 1-14, explicitly warns against this).

---

## Shared Patterns

### `withPermission`-free, ownership-derived services
**Source:** `src/server/services/profile-service.ts` (lines 1-12)
**Apply to:** `checkout-service.ts` — every learner-facing entry point (`createHoldAndOrder`, `initiateStripePayment`, `getOwnOrder`) derives its target exclusively from `actor.userId`/an id the actor already owns, never accepts a target-user-id parameter, and imports no `withPermission`.

### `*AsSystem` unauthorized worker/webhook services
**Source:** `src/server/services/hold-release-system-service.ts` (whole file, and `src/server/services/scan-system-service.ts` as the second precedent)
**Apply to:** `checkout-webhook-system-service.ts` — file-header warning comment, `SYSTEM_ACTOR_TYPE` constant, no import of the permission choke point or `next/headers`, `actorId: null, actorType: "SYSTEM"` on every audit write, and a distinct audit action name per event so system-triggered writes never look like staff ones.

### Seat accounting — never re-derive
**Source:** `src/server/services/seat-accounting.ts` (whole file)
**Apply to:** `checkout-service.ts` (seat hold on Enroll, calls `takeSeat`) and `checkout-webhook-system-service.ts` (activation, calls `claimSeat`/`lockOpenCohort` via the extracted `applyEnrolmentActivation`). Both call the existing exported functions directly — never re-implement capacity/hold/lock logic (D-09/D-12, RESEARCH "Don't Hand-Roll" table).

### Domain events — closed union, additive edit required
**Source:** `src/server/services/domain-event-service.ts` (`DomainEventType` union, ~lines 34-46)
**Apply to:** every new mutation path (`order.created`, `order.paid`, `enrolment.activated`, `order.exception`) — add the literal to the union first; a string outside it is a compile error by design (Pitfall 8).

### Typed-error-per-refusal-case
**Source:** `src/server/services/seat-accounting.ts` (`CapacityExceededError`, `AlreadyEnrolledError`, `CohortNotFoundError`, `CohortClosedError`) and `enrolment-service.ts` (`IllegalTransitionError`, `ReasonRequiredError`, `EnrolmentNotFoundError`)
**Apply to:** all new checkout-flow refusal cases (hold expired, order not found, payment already succeeded, currency mismatch) — one named `class X extends Error` per case, never a raw string throw, so Server Actions can translate deterministically.

### Best-effort email dispatch
**Source:** `src/server/services/email-dispatch-service.ts` (`dispatchBestEffort`, lines ~115-127) as used by `profile-service.ts` (lines 220-228)
```typescript
await dispatchBestEffort(dispatch, {
  template: "email-change-confirmation",
  toEmail: newEmail,
  userId: actor.userId,
  subject: "Confirm your new email address",
  textContent: buildEmailChangeText(confirmUrl),
});
```
**Apply to:** the confirmation email sent from `checkout-webhook-system-service.ts` after the DB transaction commits (D-18) — same `dispatchBestEffort` wrapper, a provider outage must never fail the webhook's 200 response back to Stripe.

### Fact-card `<dl>` visual pattern (not `DetailLayout`)
**Source:** `src/app/(public)/courses/[slug]/page.tsx` (lines 73-87), per `06-UI-SPEC.md` §0.3's explicit discretionary ruling
**Apply to:** `/checkout/[orderId]`, `/orders/[reference]` — `rounded-lg border border-border bg-surface px-4 py-2 shadow-xs`, 11px/600 muted uppercase `<dt>`, 14px/400 `<dd>`. Do not import `DetailLayout` (staff/RBAC-shaped, wrong error-state contract for a learner-owned record).

### Route handler stays thin, no `@prisma/client` import
**Source:** `tests/boundary.test.ts`'s existing enforcement (referenced in RESEARCH Pattern 4) + general route shape in `src/app/api/lesson-resources/upload/route.ts`
**Apply to:** `src/app/api/webhooks/stripe/route.ts` — verify signature, call `checkout-webhook-system-service.ts`, return a `Response`; never import `@prisma/client` directly in the route file.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/server/payments/providers/stripe/client.ts` | config | request-response | First external-payment-SDK client in the codebase; no prior third-party API singleton to copy beyond generic "read env var, construct client" shape (`brevo-client.ts` is the nearest spiritual analog for an external-API wrapper, not structurally similar enough to cite as a pattern source) |
| `src/app/api/webhooks/stripe/route.ts` | route | event-driven | First webhook-receiving endpoint in the codebase (RESEARCH: "this is the app's first webhook-receiving endpoint") — RESEARCH's own Code Examples 1-2 (raw-body read, `constructEvent`, insert-first idempotency) are the primary source for this file's shape, not an in-repo analog |

## Metadata

**Analog search scope:** `src/server/services/**`, `src/server/auth/**`, `src/app/(public)/**`, `src/app/(auth)/**`, `src/lib/identity.ts`, `src/server/services/domain-event-service.ts`, `src/server/services/email-dispatch-service.ts`
**Files scanned:** 9 read in full (`seat-accounting.ts`, `enrolment-service.ts`, `hold-release-system-service.ts`, `profile-service.ts`, `public-catalogue-service.ts`, `src/app/(public)/courses/[slug]/page.tsx`, `src/lib/identity.ts`, `src/app/(auth)/signin/actions.ts`, `src/server/auth/landing.ts`), plus grep-located excerpt from `email-dispatch-service.ts`
**Pattern extraction date:** 2026-09-09
