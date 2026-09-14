/**
 * Learner-facing checkout: seat hold + Order creation, ownership-scoped order
 * reads, and Stripe/Paystack payment initiation (REG-01..05, PAY-02, PAY-08,
 * PAY-09, PAY-17).
 *
 * Authorization here is an ownership comparison, not a permission check —
 * and that is the intended model, not a gap, following `profile-service.ts`'s
 * own header exactly. The closed permission catalogue's only payment-adjacent
 * entries (`payments.view`, `payments.confirm`, `refunds.manage`) are
 * staff-facing, Phase 7 scope; a learner paying for their own order is no
 * more an RBAC concern than editing their own profile. No entry point below
 * accepts a target-user-id parameter — every one derives its target
 * exclusively from `actor.userId` or an id whose ownership it checks against
 * that same field. This file imports no permission wrapper — that is
 * deliberate, not an oversight.
 *
 * Every seat/capacity operation below calls straight into
 * `seat-accounting.ts` — `takeSeat`, `releaseSeat`, `holdExpiryFrom`,
 * `holdsSeat`, `lockOpenCohort` — never re-derives the row lock or the
 * capacity check. The amount, currency and provider a payment adapter is
 * ever told about come from the `Cohort` row and the active
 * `GatewayFeeSchedule`, both read inside the same transaction that takes the
 * seat — never from a client-supplied value (D-07, D-13).
 *
 * `providerForCurrency` (07-03) is the ONLY place a provider is chosen —
 * this file never accepts a provider as an argument or a form field.
 * Importing `providers/paystack/initialize.ts`'s `initiatePaystackTransaction`
 * here, like this file already imports `providers/stripe/client.ts`'s
 * `getStripe` and `providers/stripe/checkout-session.ts`'s
 * `buildCheckoutSessionParams`, is not a PAY-09 violation: the generalized
 * provider-isolation scan (`tests/checkout-phase-invariants.test.ts`) flags
 * the `"stripe"` SDK specifier and a Paystack-namespaced *type*, never a
 * project-owned wrapper function whose own return shape is already
 * provider-neutral (`payment-provider.ts`'s `PaymentInitiationResult`).
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { POLICY_TYPE, POLICY_VERSIONS } from "@/lib/identity";
import {
  AlreadyEnrolledError,
  takeSeat,
  releaseSeat,
  holdExpiryFrom,
  holdsSeat,
  lockOpenCohort,
  type SeatTxClient,
} from "@/server/services/seat-accounting";
import { writeDomainEvent, type DomainEventTxClient } from "@/server/services/domain-event-service";
import { recordAudit, type BusinessAuditEvent } from "@/server/services/audit-service";
import { getStripe } from "@/server/payments/providers/stripe/client";
import { buildCheckoutSessionParams } from "@/server/payments/providers/stripe/checkout-session";
import { initiatePaystackTransaction } from "@/server/payments/providers/paystack/initialize";
import { providerForCurrency, type SupportedCurrency } from "@/server/payments/routing";
import { calculateCheckoutBreakdown, type GatewayFeeScheduleValues } from "@/server/payments/pricing";
import {
  paystackSubaccountCode,
  stripeConnectedAccountId,
} from "@/server/payments/settlement-config";

// ---------------------------------------------------------------------------
// Typed refusals — one class per case, never a raw thrown string.
// ---------------------------------------------------------------------------

export class OrderNotFoundError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`Order ${orderId} does not exist.`);
    this.name = "OrderNotFoundError";
    this.orderId = orderId;
  }
}

export class OrderNotPayableError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`Order ${orderId} is not in a payable state.`);
    this.name = "OrderNotPayableError";
    this.orderId = orderId;
  }
}

export class HoldExpiredError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`The seat hold for order ${orderId} has expired.`);
    this.name = "HoldExpiredError";
    this.orderId = orderId;
  }
}

/**
 * D-13's guard, kept as defence in depth. Read against the actual auth
 * implementation, a `PENDING_VERIFICATION` learner cannot hold a session at
 * all: `signIn` refuses any non-ACTIVE user (auth-service.ts), a non-ACTIVE
 * user's session resolves to no actor (session-service.ts), and
 * `verifyEmail` sets ACTIVE and the verified timestamp in the same write
 * (verification-service.ts). This branch is therefore not reachable through
 * the normal flow today — it exists so a future relaxation of the sign-in
 * status rule cannot silently open a payment path for an unproven identity.
 * Do not delete it as dead code, and do not weaken the sign-in check to
 * exercise it.
 */
export class EmailNotVerifiedError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`The learner for order ${orderId} has not verified their email.`);
    this.name = "EmailNotVerifiedError";
    this.orderId = orderId;
  }
}

/**
 * REG-04's server-side enforcement — the same RBAC-06 shape applied to
 * consent. A disabled Pay button is a courtesy to an honest learner; this is
 * what actually stops a direct POST that never rendered the form.
 */
export class PolicyConsentRequiredError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`Order ${orderId} is missing a required policy acceptance.`);
    this.name = "PolicyConsentRequiredError";
    this.orderId = orderId;
  }
}

/**
 * D-05/D-19 — a Cohort has no price set for the currency the learner picked.
 * Raised BEFORE any seat hold or Order is created, so the caller can route
 * to a support path instead of creating an unpayable order (07-UI-SPEC's
 * "Payment is temporarily unavailable" notice reads this as a configuration
 * gap, distinct from `CapacityExceededError`'s capacity gap).
 */
export class CurrencyUnavailableError extends Error {
  readonly cohortId: string;
  readonly currency: string;
  constructor(cohortId: string, currency: string) {
    super(`Cohort ${cohortId} does not offer a price in ${currency}.`);
    this.name = "CurrencyUnavailableError";
    this.cohortId = cohortId;
    this.currency = currency;
  }
}

/**
 * D-05 — the deployment has no active, effective `GatewayFeeSchedule` for
 * the derived provider/currency pair. Distinct from `CurrencyUnavailableError`
 * (a Cohort-level configuration gap): this is a deployment-level one — every
 * Cohort priced in this currency is unpayable until an administrator seeds a
 * schedule (07-02).
 */
export class MissingGatewayFeeScheduleError extends Error {
  readonly provider: string;
  readonly currency: string;
  constructor(provider: string, currency: string) {
    super(`No active GatewayFeeSchedule found for provider ${provider} and currency ${currency}.`);
    this.name = "MissingGatewayFeeScheduleError";
    this.provider = provider;
    this.currency = currency;
  }
}

/**
 * D-07/T-07-29 — the two payment rails never cross: an NGN Order can only be
 * paid through Paystack, a USD Order only through Stripe. Raised BEFORE any
 * provider network call and BEFORE the `PaymentAttempt` transaction, so a
 * crossed rail leaves no orphan attempt row.
 */
export class ProviderCurrencyMismatchError extends Error {
  readonly orderId: string;
  readonly provider: "STRIPE" | "PAYSTACK";
  readonly currency: string;
  constructor(orderId: string, provider: "STRIPE" | "PAYSTACK", currency: string) {
    super(`Order ${orderId}'s currency (${currency}) cannot be paid through ${provider} — the two rails never cross (D-07).`);
    this.name = "ProviderCurrencyMismatchError";
    this.orderId = orderId;
    this.provider = provider;
    this.currency = currency;
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type OrderCohortFacts = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  deliveryMode: string;
};

export type OrderEnrolmentFacts = {
  id: string;
  status: string;
  holdExpiresAt: Date | null;
};

export type OrderSnapshot = {
  id: string;
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
  // §19.1/D-13 — snapshotted once at Order creation. `selectedProvider` is
  // what `payAction` dispatches on so the page never chooses a provider
  // itself (PAY-08); the other three feed a Paystack `initiate` call. All
  // three are `null` only for a pre-Phase-7 Order this migration backfilled
  // with no snapshot (D-08) — never for one created by this file.
  selectedProvider: string | null;
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
  cohort: OrderCohortFacts;
  enrolment: OrderEnrolmentFacts | null;
};

type OrderWithRelationsRow = OrderSnapshot & { userId: string };

/**
 * The `cohort` columns `startCheckout` reads inside its own transaction —
 * the two independent, nullable rails (D-06), not the legacy
 * `priceMinor`/`currency` pair this file no longer reads.
 */
type TxCohortFacts = {
  title: string;
  priceNgnMinor: number | null;
  priceUsdMinor: number | null;
  holdMinutes: number | null;
};

/** The `GatewayFeeSchedule` columns `startCheckout` reads inside its own transaction (07-02, 07-03). */
type TxGatewayFeeScheduleRow = {
  id: string;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency: string;
  version: number;
  percentageBps: number;
  fixedMinor: number;
  waiverThresholdMinor: number | null;
  capMinor: number | null;
  taxBps: number;
  roundingRule: string;
};

type TxEnrolmentFindRow = {
  id: string;
  status: string;
  holdExpiresAt: Date | null;
  orderId: string | null;
};

/**
 * The transaction surface `startCheckout` needs — a superset of
 * `SeatTxClient`/`DomainEventTxClient` (so `takeSeat`/`releaseSeat`/
 * `lockOpenCohort`/`writeDomainEvent` are callable directly, no cast) plus
 * `cohort.findUnique`, `enrolment.findFirst` and `order.create`/`update` —
 * structural, so this file carries no `@prisma/client` type import.
 */
export type CheckoutTxClient = SeatTxClient &
  DomainEventTxClient & {
    cohort: SeatTxClient["cohort"] & {
      findUnique(args: {
        where: { id: string };
        select: Record<string, unknown>;
      }): Promise<TxCohortFacts | null>;
    };
    enrolment: SeatTxClient["enrolment"] & {
      findFirst(args: { where: Record<string, unknown> }): Promise<TxEnrolmentFindRow | null>;
    };
    gatewayFeeSchedule: {
      findFirst(args: {
        where: Record<string, unknown>;
        orderBy?: Record<string, unknown>;
      }): Promise<TxGatewayFeeScheduleRow | null>;
    };
    order: {
      create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
    paymentAttempt: {
      create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
    };
    /**
     * Order-bound acceptances are create-only, never find-then-update — the
     * `setMarketingPreference` upsert shape is right for a standing profile
     * preference and wrong here, because a row here records what was agreed
     * for one order at one moment and must not be mutated by a later order.
     */
    policyAcceptance: {
      findMany(args: { where: { orderId: string } }): Promise<Array<{ id: string; policyType: string }>>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
  };

export type CheckoutServiceDeps = {
  db: {
    $transaction: <R>(
      fn: (tx: CheckoutTxClient) => Promise<R>,
      options?: { timeout?: number },
    ) => Promise<R>;
  };
  order: {
    findUnique(args: { where: { id: string } }): Promise<OrderWithRelationsRow | null>;
    findByReference(args: { reference: string }): Promise<OrderWithRelationsRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  paymentAttempt: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  /**
   * The one-off, non-transactional `User.emailVerified` read the D-13 guard
   * needs — `Actor` carries only `userId`/`isStaff`, so verification status
   * is never already in hand.
   */
  user: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ email: string; emailVerified: Date | null } | null>;
  };
  // PAY-09 — deliberately NOT `Stripe.Checkout.SessionCreateParams`. This
  // file lives outside `src/server/payments/providers/stripe/`, so it must
  // not name any Stripe-namespaced type (tests/checkout-phase-invariants.test.ts's
  // provider-isolation scan). `buildCheckoutSessionParams`'s own return type
  // already describes exactly the shape this deps surface accepts, sourced
  // through the provider wrapper rather than a direct SDK type import.
  stripe: {
    checkout: {
      sessions: {
        create(
          params: ReturnType<typeof buildCheckoutSessionParams>,
          options: { idempotencyKey: string },
        ): Promise<{ id: string; url: string | null }>;
      };
    };
  };
  // PAY-09 — deliberately a structural shape, not
  // `ReturnType<typeof initiatePaystackTransaction>`'s parameter type named
  // directly here; the shape below is exactly `PaymentProviderAdapter`'s own
  // `initiate` signature (`payment-provider.ts`), which this deps surface
  // satisfies without importing anything Paystack-namespaced.
  paystack: {
    initiate(input: {
      orderId: string;
      orderReference: string;
      enrolmentId: string;
      learnerEmail: string;
      currency: string;
      amountMinor: number;
      platformFeeMinor: number;
      gatewayFeeEstimateMinor: number;
      callbackUrl: string;
    }): Promise<{ redirectUrl: string; providerIntentId: string }>;
  };
  audit: (event: BusinessAuditEvent) => Promise<void>;
  baseUrl?: () => string;
  now?: () => Date;
  /**
   * A standalone (non-transactional) cohort -> course-slug lookup for the
   * `/enrol/[cohortId]` resumption route's typed-refusal redirects — a
   * `CapacityExceededError`/`CohortClosedError` sends the visitor back to
   * the cohort's own public course page rather than a generic error, and
   * that page is addressed by the course's slug, not the cohort's id.
   */
  cohortOffer?: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ courseSlug: string | null } | null>;
  };
};

/**
 * Human-readable, non-sequential order reference (REG-03) — a random suffix,
 * not an incrementing counter, so one reference cannot be guessed from
 * another (T-06-13).
 */
function generateOrderReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ORD-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

const DEFAULT_BASE_URL = () => process.env.APP_BASE_URL ?? "http://localhost:3000";

export function createCheckoutService(deps: CheckoutServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;

  /**
   * The D-09 hold point — the seat is taken on the Enroll click, before the
   * order-summary page ever renders, using the cohort's own `holdMinutes`
   * (D-12). Superseding an existing live `PENDING_PAYMENT` hold for this
   * (userId, cohortId) and cancelling its Order happens in the SAME
   * transaction that takes the new seat, so a repeated Enroll click never
   * leaves a learner holding two seats (D-06) — net seat delta zero.
   */
  async function startCheckout(
    actor: Actor,
    cohortId: string,
    currency: SupportedCurrency,
  ): Promise<{ orderId: string }> {
    const at = now();

    const { orderId } = await deps.db.$transaction(async (tx) => {
      // Serialises against cohort cancellation and capacity the same way
      // `addEnrolment` does; also the authoritative "does this cohort exist
      // and accept enrolments right now" check.
      await lockOpenCohort(tx, cohortId);

      const cohort = await tx.cohort.findUnique({
        where: { id: cohortId },
        select: { title: true, priceNgnMinor: true, priceUsdMinor: true, holdMinutes: true },
      });
      if (!cohort) {
        // lockOpenCohort already proved the row exists — reachable only if a
        // concurrent hard-delete happened, which this codebase forbids.
        throw new Error(`Cohort ${cohortId} vanished mid-transaction.`);
      }

      const activeEnrolment = await tx.enrolment.findFirst({
        where: { userId: actor.userId, cohortId, status: "ACTIVE" },
      });
      if (activeEnrolment) {
        throw new AlreadyEnrolledError(actor.userId, cohortId);
      }

      // D-05/D-19 — refuse BEFORE any seat/hold mutation. A missing rail is a
      // configuration gap, not a capacity gap; no Order and no seat hold are
      // ever created for it.
      const baseAmountMinor = currency === "NGN" ? cohort.priceNgnMinor : cohort.priceUsdMinor;
      if (baseAmountMinor === null) {
        throw new CurrencyUnavailableError(cohortId, currency);
      }

      // D-07 — the ONLY call site that chooses a provider. No request field,
      // form field, cookie or query parameter reaches this call.
      const provider = providerForCurrency(currency);

      // D-11/D-16 — the active, effective-dated fee schedule for this
      // provider+currency pair, read inside THIS transaction so the snapshot
      // below is reproducible even if a later plan edits the schedule.
      const schedule = await tx.gatewayFeeSchedule.findFirst({
        where: { provider, currency, active: true, effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: "desc" },
      });
      if (!schedule) {
        throw new MissingGatewayFeeScheduleError(provider, currency);
      }

      const scheduleValues: GatewayFeeScheduleValues = {
        provider: schedule.provider,
        currency: currency,
        version: schedule.version,
        percentageBps: schedule.percentageBps,
        fixedMinor: schedule.fixedMinor,
        waiverThresholdMinor: schedule.waiverThresholdMinor,
        capMinor: schedule.capMinor,
        taxBps: schedule.taxBps,
        roundingRule: schedule.roundingRule,
      };
      const breakdown = calculateCheckoutBreakdown({ baseAmountMinor, schedule: scheduleValues });

      const existing = await tx.enrolment.findFirst({
        where: { userId: actor.userId, cohortId, status: "PENDING_PAYMENT" },
      });
      if (existing) {
        await releaseSeat(tx, {
          cohortId,
          enrolmentId: existing.id,
          toStatus: "CANCELLED",
          reason: "superseded by a new checkout attempt",
          heldSeat: holdsSeat(existing),
          expected: { status: existing.status, holdExpiresAt: existing.holdExpiresAt },
        });
        if (existing.orderId) {
          await tx.order.update({ where: { id: existing.orderId }, data: { status: "CANCELLED" } });
        }
      }

      const order = await tx.order.create({
        data: {
          reference: generateOrderReference(),
          userId: actor.userId,
          cohortId,
          // D-13 — the learner's total charge, the full commercial snapshot.
          amountMinor: breakdown.totalAmountMinor,
          currency,
          selectedProvider: provider,
          baseAmountMinor: breakdown.baseAmountMinor,
          platformFeeMinor: breakdown.platformFeeMinor,
          gatewayFeeEstimateMinor: breakdown.gatewayFeeEstimateMinor,
          gatewayFeeScheduleId: schedule.id,
          gatewayFeeScheduleVersion: schedule.version,
          // The base price, not the total (D-03/D-04) — what the school is
          // expected to receive net of the split.
          schoolSettlementExpectedMinor: baseAmountMinor,
          status: "PENDING",
          idempotencyKey: randomUUID(),
          correlationId: randomUUID(),
        },
        select: { id: true },
      });

      const enrolment = await takeSeat(tx, {
        cohortId,
        enrolment: {
          cohortId,
          userId: actor.userId,
          status: "PENDING_PAYMENT",
          orderId: order.id,
          holdExpiresAt: holdExpiryFrom(cohort.holdMinutes, at),
        },
      });

      await writeDomainEvent(tx, {
        type: "order.created",
        payload: {
          orderId: order.id,
          cohortId,
          userId: actor.userId,
          amountMinor: breakdown.totalAmountMinor,
          currency,
          provider,
          baseAmountMinor: breakdown.baseAmountMinor,
          platformFeeMinor: breakdown.platformFeeMinor,
          gatewayFeeEstimateMinor: breakdown.gatewayFeeEstimateMinor,
          enrolmentId: enrolment.id,
        },
      });

      return { orderId: order.id };
    }, { timeout: 15_000 });

    await deps.audit({
      actorId: actor.userId,
      action: "order.created",
      targetType: "Order",
      targetId: orderId,
      outcome: "SUCCESS",
    });

    return { orderId };
  }

  /**
   * "Not mine" and "does not exist" are the SAME answer — a guessed id
   * cannot be used to confirm another learner's order exists (T-06-13).
   */
  async function getOwnOrder(actor: Actor, orderId: string): Promise<OrderSnapshot | null> {
    const order = await deps.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== actor.userId) return null;
    const { userId: _userId, ...snapshot } = order;
    return snapshot;
  }

  /**
   * Same ownership-comparison contract as `getOwnOrder`, keyed on the
   * permanent, publicly-shown `Order.reference` instead of the internal id —
   * the receipt page's lookup key (D-16/D-17). "Not mine" and "does not
   * exist" are still the same answer.
   */
  async function getOwnOrderByReference(actor: Actor, reference: string): Promise<OrderSnapshot | null> {
    const order = await deps.order.findByReference({ reference });
    if (!order || order.userId !== actor.userId) return null;
    const { userId: _userId, ...snapshot } = order;
    return snapshot;
  }

  /**
   * `Actor` carries no `emailVerified` — a fresh `User` read is the only way
   * to answer it. Exposed so the order-summary page can decide whether to
   * render the D-13 verification banner without duplicating this read.
   */
  async function getOwnVerificationStatus(actor: Actor): Promise<{ verified: boolean; email: string }> {
    const user = await deps.user.findUnique({ where: { id: actor.userId } });
    return { verified: !!user?.emailVerified, email: user?.email ?? "" };
  }

  type PaymentConsent = { acceptedTerms: boolean; acceptedRefundCancellation: boolean; acceptedMarketing: boolean };

  /**
   * The gate chain both `initiateStripePayment` and `initiatePaystackPayment`
   * run, in the same cheapest-first order: ownership (via `getOwnOrder`),
   * then verification, then the hold, then consent. Shared so the two
   * providers can never drift apart on which checks run or in what order —
   * exactly the same "one shared walk, not two" discipline
   * `checkout-phase-invariants.test.ts`'s own header comment states for its
   * provider-isolation scan.
   */
  async function runPaymentGuards(
    actor: Actor,
    orderId: string,
    consent: PaymentConsent,
  ): Promise<{ order: OrderSnapshot; enrolment: OrderEnrolmentFacts; email: string }> {
    const order = await getOwnOrder(actor, orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    if (order.status !== "PENDING") throw new OrderNotPayableError(orderId);

    // D-13 defence in depth — see EmailNotVerifiedError's own doc comment for
    // why this is not reachable through the normal sign-in flow today.
    const user = await deps.user.findUnique({ where: { id: actor.userId } });
    if (!user || !user.emailVerified) {
      throw new EmailNotVerifiedError(orderId);
    }

    const enrolment = order.enrolment;
    const at = now();
    if (
      !enrolment ||
      enrolment.status !== "PENDING_PAYMENT" ||
      !enrolment.holdExpiresAt ||
      enrolment.holdExpiresAt <= at
    ) {
      throw new HoldExpiredError(orderId);
    }

    // REG-04's server-side gate — a direct POST that never rendered the form
    // must not be able to produce a paid order, exactly as RBAC-06 requires
    // of every protected operation in this codebase. Marketing is optional
    // and never part of this check.
    if (!consent.acceptedTerms || !consent.acceptedRefundCancellation) {
      throw new PolicyConsentRequiredError(orderId);
    }

    return { order, enrolment, email: user.email };
  }

  /**
   * Creates one `PaymentAttempt` (for `provider`) and, on the first call for
   * this Order, the three order-bound `PolicyAcceptance` rows — in the SAME
   * transaction, so a provider-side failure afterwards cannot leave consent
   * recorded for a payment that never started, and consent can never be
   * missing for an attempt that did. Idempotent per order (D-04's retry path
   * re-enters this function against the same Order): create-only, never
   * find-then-update — an order-bound acceptance records what was agreed for
   * one order at one moment and must not be mutated by a later attempt.
   */
  async function createPaymentAttemptWithConsent(
    actor: Actor,
    order: OrderSnapshot,
    provider: "STRIPE" | "PAYSTACK",
    consent: PaymentConsent,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    return deps.db.$transaction(async (tx) => {
      const created = await tx.paymentAttempt.create({
        data: {
          orderId: order.id,
          provider,
          amountMinor: order.amountMinor,
          currency: order.currency,
          status: "PENDING",
          idempotencyKey,
          correlationId: randomUUID(),
        },
        select: { id: true },
      });

      const existing = await tx.policyAcceptance.findMany({ where: { orderId: order.id } });
      if (existing.length === 0) {
        await tx.policyAcceptance.create({
          data: {
            userId: actor.userId,
            policyType: POLICY_TYPE.TERMS,
            version: POLICY_VERSIONS[POLICY_TYPE.TERMS],
            accepted: true,
            orderId: order.id,
          },
        });
        await tx.policyAcceptance.create({
          data: {
            userId: actor.userId,
            policyType: POLICY_TYPE.REFUND_CANCELLATION,
            version: POLICY_VERSIONS[POLICY_TYPE.REFUND_CANCELLATION],
            accepted: true,
            orderId: order.id,
          },
        });
        // A `false` row and no row at all are different facts — one is a
        // stated refusal, the other is an unanswered question. Uses the same
        // policyType the profile toggle writes (`setMarketingPreference`),
        // so a learner ends up with one marketing-consent history rather
        // than a checkout-only parallel key.
        await tx.policyAcceptance.create({
          data: {
            userId: actor.userId,
            policyType: POLICY_TYPE.MARKETING,
            version: POLICY_VERSIONS[POLICY_TYPE.MARKETING],
            accepted: consent.acceptedMarketing === true,
            orderId: order.id,
          },
        });
      }

      return created;
    });
  }

  /**
   * Creates one `PaymentAttempt` and a real Stripe Checkout Session for it.
   * The hold check here is server-side and authoritative — the client
   * countdown (plan 06-07) is a UI clock and proves nothing.
   */
  async function initiateStripePayment(
    actor: Actor,
    orderId: string,
    consent: PaymentConsent,
  ): Promise<{ url: string }> {
    const { order, enrolment } = await runPaymentGuards(actor, orderId, consent);

    // D-07/T-07-29 — refuse before any provider call and before the
    // PaymentAttempt transaction, so a crossed rail leaves no orphan row.
    if (order.currency !== "USD") {
      throw new ProviderCurrencyMismatchError(orderId, "STRIPE", order.currency);
    }

    // D-13's snapshot is read back from the Order itself, never recomputed —
    // see OrderSnapshot's own doc comment for why this is never null for an
    // Order this file created.
    if (order.baseAmountMinor === null) {
      throw new Error(`Order ${orderId} has no commercial snapshot to initiate a Stripe payment from.`);
    }

    // D-05 — fails checkout closed (MissingSettlementAccountError) rather
    // than creating a Session whose funds would settle into the platform
    // account unattributed. Resolved BEFORE the PaymentAttempt transaction.
    const connectedAccountId = stripeConnectedAccountId();

    const idempotencyKey = randomUUID();
    const attempt = await createPaymentAttemptWithConsent(actor, order, "STRIPE", consent, idempotencyKey);

    await deps.order.update({ where: { id: order.id }, data: { selectedProvider: "STRIPE" } });

    const root = baseUrl();
    // The idempotency key is a Stripe request OPTION (second argument), not a
    // field inside the session params object — a retried submission returns
    // the same Session rather than creating a second one (T-06-14).
    //
    // cancelUrl carries a `declined=1` marker: Stripe's own hosted page does
    // not tell the app WHY a customer left (cancelled vs. gave up after a
    // decline) — this is the only signal the app-side D-04 retry banner has
    // to work with, and it is read by the order-summary page, never trusted
    // as a security fact.
    const session = await deps.stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        orderId: order.id,
        enrolmentId: enrolment.id,
        cohortTitle: order.cohort.title,
        amountMinor: order.amountMinor,
        currency: order.currency,
        successUrl: `${root}/checkout/${order.id}/confirming`,
        cancelUrl: `${root}/checkout/${order.id}?declined=1`,
        // D-04/PAY-17 — the Connect destination-charge split, sourced only
        // from the Order's own immutable snapshot and deployment config.
        schoolSettlementMinor: order.baseAmountMinor,
        connectedAccountId,
      }),
      { idempotencyKey },
    );

    await deps.paymentAttempt.update({
      where: { id: attempt.id },
      data: { providerIntentId: session.id, status: "PROCESSING" },
    });

    if (!session.url) {
      throw new Error(`Stripe returned no Checkout Session URL for order ${orderId}.`);
    }

    return { url: session.url };
  }

  /**
   * Creates one `PaymentAttempt` and a real Paystack split transaction for
   * it — the same guard chain, transaction shape and idempotency discipline
   * as `initiateStripePayment`, above (Layer 6, 07-04).
   */
  async function initiatePaystackPayment(
    actor: Actor,
    orderId: string,
    consent: PaymentConsent,
  ): Promise<{ url: string }> {
    const { order, enrolment, email } = await runPaymentGuards(actor, orderId, consent);

    // D-07/T-07-29 — the mirror-image refusal of initiateStripePayment's own
    // guard. Refused before any provider call and before the PaymentAttempt
    // transaction, so a crossed rail leaves no orphan row.
    if (order.currency !== "NGN") {
      throw new ProviderCurrencyMismatchError(orderId, "PAYSTACK", order.currency);
    }

    // D-13's snapshot is read back from the Order itself, never recomputed —
    // see `OrderSnapshot`'s own doc comment for why these three are never
    // null for an Order this file created.
    if (
      order.baseAmountMinor === null ||
      order.platformFeeMinor === null ||
      order.gatewayFeeEstimateMinor === null
    ) {
      throw new Error(`Order ${orderId} has no commercial snapshot to initiate a Paystack payment from.`);
    }

    // D-05 — validate the school split destination before reserving a
    // PaymentAttempt. The provider builder validates it again when building
    // the request, but this earlier check prevents an orphan attempt when
    // deployment configuration is missing.
    paystackSubaccountCode();

    const idempotencyKey = randomUUID();
    const attempt = await createPaymentAttemptWithConsent(actor, order, "PAYSTACK", consent, idempotencyKey);

    await deps.order.update({ where: { id: order.id }, data: { selectedProvider: "PAYSTACK" } });

    const root = baseUrl();
    const result = await deps.paystack.initiate({
      orderId: order.id,
      orderReference: order.reference,
      enrolmentId: enrolment.id,
      learnerEmail: email,
      currency: order.currency,
      amountMinor: order.amountMinor,
      platformFeeMinor: order.platformFeeMinor,
      gatewayFeeEstimateMinor: order.gatewayFeeEstimateMinor,
      callbackUrl: `${root}/checkout/${order.id}/confirming`,
    });

    await deps.paymentAttempt.update({
      where: { id: attempt.id },
      data: { providerIntentId: result.providerIntentId, status: "PROCESSING" },
    });

    return { url: result.redirectUrl };
  }

  /**
   * Resolves the public path the `/enrol/[cohortId]` resumption route should
   * send a visitor to when their held cohort has since filled up or closed —
   * that cohort's own course page when one can be found, the public
   * catalogue index otherwise (a programme-linked cohort, or a cohort whose
   * course is no longer publicly listed). Never throws; this is a
   * fallback-redirect helper, not a source of truth about existence.
   */
  async function getCohortOfferPath(cohortId: string): Promise<string> {
    const cohort = await deps.cohortOffer?.findUnique({ where: { id: cohortId } });
    return cohort?.courseSlug ? `/courses/${cohort.courseSlug}` : "/courses";
  }

  return {
    startCheckout,
    getOwnOrder,
    getOwnOrderByReference,
    getOwnVerificationStatus,
    initiateStripePayment,
    initiatePaystackPayment,
    getCohortOfferPath,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const ORDER_SELECT = {
  id: true,
  userId: true,
  reference: true,
  status: true,
  amountMinor: true,
  currency: true,
  selectedProvider: true,
  baseAmountMinor: true,
  platformFeeMinor: true,
  gatewayFeeEstimateMinor: true,
  cohort: {
    select: { id: true, title: true, startsAt: true, endsAt: true, deliveryMode: true },
  },
  enrolments: {
    select: { id: true, status: true, holdExpiresAt: true },
  },
} as const;

function mapOrderRow(row: AnyPrisma): OrderWithRelationsRow {
  const { enrolments, ...rest } = row;
  return { ...rest, enrolment: enrolments[0] ?? null } as OrderWithRelationsRow;
}

export function createPrismaBackedCheckoutService(client: AnyPrisma) {
  return createCheckoutService({
    db: {
      $transaction: (fn, options) =>
        client.$transaction((tx: unknown) => fn(tx as CheckoutTxClient), options),
    },
    order: {
      findUnique: async (args) => {
        const row = await client.order.findUnique({ where: args.where, select: ORDER_SELECT });
        return row ? mapOrderRow(row) : null;
      },
      findByReference: async (args) => {
        const row = await client.order.findUnique({
          where: { reference: args.reference },
          select: ORDER_SELECT,
        });
        return row ? mapOrderRow(row) : null;
      },
      update: (args) => client.order.update({ where: args.where, data: args.data }),
    },
    paymentAttempt: {
      update: (args) => client.paymentAttempt.update({ where: args.where, data: args.data }),
    },
    user: {
      findUnique: async ({ where }) =>
        client.user.findUnique({ where, select: { email: true, emailVerified: true } }),
    },
    stripe: {
      checkout: {
        sessions: {
          create: (params, options) => getStripe().checkout.sessions.create(params, options),
        },
      },
    },
    paystack: {
      initiate: (input) => initiatePaystackTransaction(input),
    },
    audit: recordAudit,
    cohortOffer: {
      findUnique: async ({ where }) => {
        const row = await client.cohort.findUnique({
          where,
          select: { course: { select: { slug: true } } },
        });
        return row ? { courseSlug: row.course?.slug ?? null } : null;
      },
    },
  });
}

const built = createPrismaBackedCheckoutService(prisma);

export const startCheckout = built.startCheckout;
export const getOwnOrder = built.getOwnOrder;
export const getOwnOrderByReference = built.getOwnOrderByReference;
export const getOwnVerificationStatus = built.getOwnVerificationStatus;
export const initiateStripePayment = built.initiateStripePayment;
export const initiatePaystackPayment = built.initiatePaystackPayment;
export const getCohortOfferPath = built.getCohortOfferPath;
