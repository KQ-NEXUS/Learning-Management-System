/**
 * Pure unit coverage for the enrolment/payment mapper group (D-07, D-09,
 * T-13-03) against a fake transaction client — no database needed, since a
 * mapper is a pure function of its event payload plus whatever `ctx.tx`
 * returns. Real-Postgres proof of the drain actually persisting these
 * intents lives in `tests/enrolment-payment-drain.integration.test.ts`.
 *
 * Mappers are looked up through `buildMapperTable(EVENT_MAPPER_GROUPS)` —
 * the same path production code (`domain-event-drain-service.ts`,
 * `tests/support/drain-harness.ts`) and the sibling
 * `tests/event-intent-mappers.test.ts` use — rather than importing
 * `enrolment-payment.ts` directly. `event-intent-mappers.ts` and each
 * `event-mappers/*.ts` group file import each other (the group needs
 * `requireString`/the shared types; the aggregator needs the group's factory
 * to build `EVENT_MAPPER_GROUPS`), so entering through the aggregator module
 * is what keeps the ES module cycle resolving in the direction every other
 * consumer already relies on.
 */

import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { formatMinorAmount } from "@/server/communications/format-amount";
import {
  buildMapperTable,
  EVENT_MAPPER_GROUPS,
  type DrainEvent,
  type EventMapper,
  type MapperContext,
} from "@/server/services/event-intent-mappers";
import { createEnrolmentPaymentMappers } from "@/server/services/event-mappers/enrolment-payment";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const mapperTable = buildMapperTable(EVENT_MAPPER_GROUPS);

function requireOneMapper(type: DrainEvent["type"]): EventMapper {
  const mappers = mapperTable[type];
  expect(mappers).toHaveLength(1);
  return mappers[0]!;
}

/**
 * `order.exception` is registered by BOTH this group (learner mail,
 * `illegal_transition` only — A-06) and Plan 11's staff group (every reason,
 * `event-mappers/staff.ts`), so `mapperTable["order.exception"]` now fans out
 * to two mappers (`event-intent-mappers.ts`'s own header comment documents
 * this). The tests below exercise ONLY the learner-facing mapper, so they
 * pull it directly from this group's own factory rather than the merged
 * table, exactly as `requireOneMapper` does for every event type this group
 * is the SOLE registrant of.
 */
function requireEnrolmentPaymentOrderExceptionMapper(): EventMapper {
  const mapper = createEnrolmentPaymentMappers()["order.exception"];
  if (!mapper) throw new Error("enrolment-payment group has no order.exception mapper");
  return mapper;
}

function makeCtx(
  overrides: {
    enrolment?: (args: unknown) => Promise<unknown>;
    order?: (args: unknown) => Promise<unknown>;
    refund?: (args: unknown) => Promise<unknown>;
  } = {},
): MapperContext {
  return {
    tx: {
      enrolment: { findUnique: overrides.enrolment ?? (async () => null) },
      order: { findUnique: overrides.order ?? (async () => null) },
      refund: { findUnique: overrides.refund ?? (async () => null) },
    } as unknown as Prisma.TransactionClient,
    now: () => NOW,
  };
}

function makeEvent(type: DrainEvent["type"], payload: Record<string, unknown>): DrainEvent {
  return { id: "evt-1", type, payload, occurredAt: NOW };
}

describe("formatMinorAmount (money in minor units)", () => {
  it("formats an NGN amount", () => {
    expect(formatMinorAmount(500000, "NGN")).toBe("NGN 5,000.00");
  });

  it("formats a zero amount", () => {
    expect(formatMinorAmount(0, "NGN")).toBe("NGN 0.00");
  });

  it("formats a large amount", () => {
    expect(formatMinorAmount(123456789, "NGN")).toBe("NGN 1,234,567.89");
  });
});

describe("enrolment.activated / enrolment.approved (D-07)", () => {
  it("registers exactly one mapper for each type", () => {
    expect(mapperTable["enrolment.activated"]).toHaveLength(1);
    expect(mapperTable["enrolment.approved"]).toHaveLength(1);
  });

  it("enrolment.activated with an order returns one enrolment-confirmed intent with an order section", async () => {
    const mapper = requireOneMapper("enrolment.activated");
    const ctx = makeCtx({
      enrolment: async () => ({
        id: "enr-1",
        userId: "user-1",
        cohort: { title: "March cohort" },
        order: { reference: "KQO-1042", amountMinor: 500000, currency: "NGN" },
      }),
    });
    const intents = await mapper(
      makeEvent("enrolment.activated", { enrolmentId: "enr-1", cohortId: "cohort-1", claimedSeat: true, actorId: null }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-1");
    expect(intents[0]!.email).toEqual({
      template: "enrolment-confirmed",
      params: {
        cohortTitle: "March cohort",
        orderReference: "KQO-1042",
        amountLabel: "NGN 5,000.00",
        enrolmentPath: "/learn/enr-1",
      },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "enrolment.confirmed",
      targetType: "LEARNER_ENROLMENT",
      targetId: "enr-1",
      params: { cohortTitle: "March cohort" },
    });
  });

  it("enrolment.activated without an order returns no orderReference and no amountLabel", async () => {
    const mapper = requireOneMapper("enrolment.activated");
    const ctx = makeCtx({
      enrolment: async () => ({
        id: "enr-2",
        userId: "user-2",
        cohort: { title: "April cohort" },
        order: null,
      }),
    });
    const intents = await mapper(
      makeEvent("enrolment.activated", { enrolmentId: "enr-2", cohortId: "cohort-2", claimedSeat: true, actorId: null }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.params).toEqual({
      cohortTitle: "April cohort",
      enrolmentPath: "/learn/enr-2",
    });
    expect(intents[0]!.email!.params).not.toHaveProperty("orderReference");
    expect(intents[0]!.email!.params).not.toHaveProperty("amountLabel");
  });

  it("enrolment.approved (staff approval, no order) reuses the same mapper with the same shape", async () => {
    const mapper = requireOneMapper("enrolment.approved");
    const ctx = makeCtx({
      enrolment: async () => ({
        id: "enr-3",
        userId: "user-3",
        cohort: { title: "May cohort" },
        order: null,
      }),
    });
    const intents = await mapper(
      makeEvent("enrolment.approved", { enrolmentId: "enr-3", cohortId: "cohort-3", claimedSeat: true, actorId: "staff-1" }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.template).toBe("enrolment-confirmed");
    expect(intents[0]!.email!.params).toEqual({
      cohortTitle: "May cohort",
      enrolmentPath: "/learn/enr-3",
    });
  });

  it("returns no intents when the enrolment no longer exists (edge)", async () => {
    const mapper = requireOneMapper("enrolment.activated");
    const ctx = makeCtx({ enrolment: async () => null });
    const intents = await mapper(
      makeEvent("enrolment.activated", { enrolmentId: "gone", cohortId: "cohort-x", claimedSeat: true, actorId: null }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("never copies a hostile extra payload key into the persisted params", async () => {
    const mapper = requireOneMapper("enrolment.activated");
    const ctx = makeCtx({
      enrolment: async () => ({
        id: "enr-4",
        userId: "user-4",
        cohort: { title: "June cohort" },
        order: null,
      }),
    });
    const intents = await mapper(
      makeEvent("enrolment.activated", {
        enrolmentId: "enr-4",
        cohortId: "cohort-4",
        claimedSeat: true,
        actorId: null,
        staffNote: "internal only — must never leak",
      }),
      ctx,
    );
    const serialized = JSON.stringify(intents[0]!.email!.params) + JSON.stringify(intents[0]!.notification!.params);
    expect(serialized).not.toContain("internal only");
    expect(Object.keys(intents[0]!.email!.params)).toEqual(["cohortTitle", "enrolmentPath"]);
  });
});

describe("order.exception learner mail (A-06)", () => {
  it("illegal_transition maps to exactly one order-payment-exception intent", async () => {
    const mapper = requireEnrolmentPaymentOrderExceptionMapper();
    const ctx = makeCtx({
      order: async () => ({
        reference: "KQO-2000",
        userId: "user-9",
        cohort: { title: "July cohort" },
      }),
    });
    const intents = await mapper(
      makeEvent("order.exception", { orderId: "order-9", providerIntentId: "pi_1", reason: "illegal_transition" }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-9");
    expect(intents[0]!.email).toEqual({
      template: "order-payment-exception",
      params: {
        cohortTitle: "July cohort",
        orderReference: "KQO-2000",
        orderPath: "/orders/KQO-2000",
      },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "order.payment_exception",
      targetType: "LEARNER_ORDER",
      targetId: "KQO-2000",
      params: { orderReference: "KQO-2000" },
    });
  });

  it("duplicate_active_enrolment yields zero learner intents", async () => {
    const mapper = requireEnrolmentPaymentOrderExceptionMapper();
    const ctx = makeCtx();
    const intents = await mapper(
      makeEvent("order.exception", { orderId: "order-9", reason: "duplicate_active_enrolment" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("amount_or_currency_mismatch yields zero learner intents", async () => {
    const mapper = requireEnrolmentPaymentOrderExceptionMapper();
    const ctx = makeCtx();
    const intents = await mapper(
      makeEvent("order.exception", { orderId: "order-9", reason: "amount_or_currency_mismatch" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("returns no intents when the order no longer exists (edge)", async () => {
    const mapper = requireEnrolmentPaymentOrderExceptionMapper();
    const ctx = makeCtx({ order: async () => null });
    const intents = await mapper(
      makeEvent("order.exception", { orderId: "gone", reason: "illegal_transition" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("payment.failed learner mail (D-09)", () => {
  it("maps to exactly one payment-failed intent, loaded fresh from the order", async () => {
    const mapper = requireOneMapper("payment.failed");
    const ctx = makeCtx({
      order: async () => ({
        reference: "KQO-3000",
        userId: "user-11",
        cohort: { title: "August cohort" },
      }),
    });
    const intents = await mapper(
      makeEvent("payment.failed", { orderId: "order-11", paymentAttemptId: "pa-1", provider: "STRIPE" }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-11");
    expect(intents[0]!.email).toEqual({
      template: "payment-failed",
      params: {
        cohortTitle: "August cohort",
        orderReference: "KQO-3000",
        orderPath: "/orders/KQO-3000",
      },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "payment.failed",
      targetType: "LEARNER_ORDER",
      targetId: "KQO-3000",
      params: { orderReference: "KQO-3000" },
    });
  });

  it("returns no intents when the order no longer exists (edge)", async () => {
    const mapper = requireOneMapper("payment.failed");
    const ctx = makeCtx({ order: async () => null });
    const intents = await mapper(
      makeEvent("payment.failed", { orderId: "gone", paymentAttemptId: "pa-1", provider: "STRIPE" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("never copies the paymentAttemptId or provider into the persisted params", async () => {
    const mapper = requireOneMapper("payment.failed");
    const ctx = makeCtx({
      order: async () => ({
        reference: "KQO-3001",
        userId: "user-12",
        cohort: { title: "September cohort" },
      }),
    });
    const intents = await mapper(
      makeEvent("payment.failed", { orderId: "order-12", paymentAttemptId: "pa-secret", provider: "PAYSTACK" }),
      ctx,
    );
    const serialized = JSON.stringify(intents[0]!.email!.params) + JSON.stringify(intents[0]!.notification!.params);
    expect(serialized).not.toContain("pa-secret");
    expect(serialized).not.toContain("PAYSTACK");
  });
});

describe("payment.refunded learner mail (D-09)", () => {
  it("maps to exactly one payment-refunded intent, loaded fresh from the Refund's own order", async () => {
    const mapper = requireOneMapper("payment.refunded");
    const ctx = makeCtx({
      refund: async () => ({
        amountMinor: 500000,
        currency: "NGN",
        order: {
          reference: "KQO-4000",
          userId: "user-13",
          cohort: { title: "October cohort" },
        },
      }),
    });
    const intents = await mapper(
      makeEvent("payment.refunded", { orderId: "order-13", refundId: "refund-1", amountMinor: 500000, currency: "NGN", status: "COMPLETED" }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-13");
    expect(intents[0]!.email).toEqual({
      template: "payment-refunded",
      params: {
        cohortTitle: "October cohort",
        orderReference: "KQO-4000",
        amountLabel: "NGN 5,000.00",
        orderPath: "/orders/KQO-4000",
      },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "payment.refunded",
      targetType: "LEARNER_ORDER",
      targetId: "KQO-4000",
      params: { orderReference: "KQO-4000", amountLabel: "NGN 5,000.00" },
    });
  });

  it("returns no intents when the refund no longer exists (edge)", async () => {
    const mapper = requireOneMapper("payment.refunded");
    const ctx = makeCtx({ refund: async () => null });
    const intents = await mapper(
      makeEvent("payment.refunded", { orderId: "order-13", refundId: "gone", amountMinor: 500000, currency: "NGN", status: "COMPLETED" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("never copies a refund reason string into the persisted params, even when the payload carries one", async () => {
    const mapper = requireOneMapper("payment.refunded");
    const ctx = makeCtx({
      refund: async () => ({
        amountMinor: 250000,
        currency: "NGN",
        order: {
          reference: "KQO-4001",
          userId: "user-14",
          cohort: { title: "November cohort" },
        },
      }),
    });
    const intents = await mapper(
      makeEvent("payment.refunded", {
        orderId: "order-14",
        refundId: "refund-2",
        amountMinor: 250000,
        currency: "NGN",
        status: "COMPLETED",
        // Hostile — a real payload never carries this, but the mapper must
        // never copy it even if it did (T-13-03).
        reason: "Learner cancelled — staff-internal detail, must never leak",
      }),
      ctx,
    );
    const serialized = JSON.stringify(intents[0]!.email!.params) + JSON.stringify(intents[0]!.notification!.params);
    expect(serialized).not.toContain("staff-internal");
    expect(Object.keys(intents[0]!.email!.params)).toEqual(["cohortTitle", "orderReference", "amountLabel", "orderPath"]);
  });
});
