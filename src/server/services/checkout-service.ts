/**
 * Learner-facing checkout: seat hold + Order creation, ownership-scoped order
 * reads, and Stripe Checkout Session initiation (REG-01..05, PAY-02, PAY-09).
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
 * capacity check. The amount and currency Stripe is ever told about come
 * from the `Cohort` row read inside the same transaction that takes the
 * seat — never from a client-supplied value (D-07).
 */

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import {
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
  cohort: OrderCohortFacts;
  enrolment: OrderEnrolmentFacts | null;
};

type OrderWithRelationsRow = OrderSnapshot & { userId: string };

/** The `cohort` columns `startCheckout` reads inside its own transaction. */
type TxCohortFacts = {
  title: string;
  priceMinor: number;
  currency: string;
  holdMinutes: number | null;
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
    order: {
      create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
  };

export type CheckoutServiceDeps = {
  db: { $transaction: <R>(fn: (tx: CheckoutTxClient) => Promise<R>) => Promise<R> };
  order: {
    findUnique(args: { where: { id: string } }): Promise<OrderWithRelationsRow | null>;
    findByReference(args: { reference: string }): Promise<OrderWithRelationsRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  paymentAttempt: {
    create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  stripe: {
    checkout: {
      sessions: {
        create(
          params: Stripe.Checkout.SessionCreateParams,
          options: { idempotencyKey: string },
        ): Promise<{ id: string; url: string | null }>;
      };
    };
  };
  audit: (event: BusinessAuditEvent) => Promise<void>;
  baseUrl?: () => string;
  now?: () => Date;
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
  async function startCheckout(actor: Actor, cohortId: string): Promise<{ orderId: string }> {
    const at = now();

    const { orderId } = await deps.db.$transaction(async (tx) => {
      // Serialises against cohort cancellation and capacity the same way
      // `addEnrolment` does; also the authoritative "does this cohort exist
      // and accept enrolments right now" check.
      await lockOpenCohort(tx, cohortId);

      const cohort = await tx.cohort.findUnique({
        where: { id: cohortId },
        select: { title: true, priceMinor: true, currency: true, holdMinutes: true },
      });
      if (!cohort) {
        // lockOpenCohort already proved the row exists — reachable only if a
        // concurrent hard-delete happened, which this codebase forbids.
        throw new Error(`Cohort ${cohortId} vanished mid-transaction.`);
      }

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
          amountMinor: cohort.priceMinor,
          currency: cohort.currency,
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
          amountMinor: cohort.priceMinor,
          currency: cohort.currency,
          enrolmentId: enrolment.id,
        },
      });

      return { orderId: order.id };
    });

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
   * Creates one `PaymentAttempt` and a real Stripe Checkout Session for it.
   * The hold check here is server-side and authoritative — the client
   * countdown (plan 06-07) is a UI clock and proves nothing.
   */
  async function initiateStripePayment(actor: Actor, orderId: string): Promise<{ url: string }> {
    const order = await getOwnOrder(actor, orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    if (order.status !== "PENDING") throw new OrderNotPayableError(orderId);

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

    const idempotencyKey = randomUUID();
    const attempt = await deps.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "STRIPE",
        amountMinor: order.amountMinor,
        currency: order.currency,
        status: "PENDING",
        idempotencyKey,
        correlationId: randomUUID(),
      },
      select: { id: true },
    });

    await deps.order.update({ where: { id: order.id }, data: { selectedProvider: "STRIPE" } });

    const root = baseUrl();
    // The idempotency key is a Stripe request OPTION (second argument), not a
    // field inside the session params object — a retried submission returns
    // the same Session rather than creating a second one (T-06-14).
    const session = await deps.stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
        orderId: order.id,
        enrolmentId: enrolment.id,
        cohortTitle: order.cohort.title,
        amountMinor: order.amountMinor,
        currency: order.currency,
        successUrl: `${root}/checkout/${order.id}/confirming`,
        cancelUrl: `${root}/checkout/${order.id}`,
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

  return { startCheckout, getOwnOrder, getOwnOrderByReference, initiateStripePayment };
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
      $transaction: (fn) => client.$transaction((tx: unknown) => fn(tx as CheckoutTxClient)),
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
      create: (args) => client.paymentAttempt.create({ data: args.data, select: args.select }),
      update: (args) => client.paymentAttempt.update({ where: args.where, data: args.data }),
    },
    stripe: {
      checkout: {
        sessions: {
          create: (params, options) => getStripe().checkout.sessions.create(params, options),
        },
      },
    },
    audit: recordAudit,
  });
}

const built = createPrismaBackedCheckoutService(prisma);

export const startCheckout = built.startCheckout;
export const getOwnOrder = built.getOwnOrder;
export const getOwnOrderByReference = built.getOwnOrderByReference;
export const initiateStripePayment = built.initiateStripePayment;
