/**
 * Plan 06-03: `checkout-service.ts` (REG-01..05, PAY-02, PAY-09) and
 * `buildCheckoutSessionParams` (D-01, D-03, D-07).
 *
 * Driven by an in-memory, staged-commit fake `$transaction` — the same
 * pattern `tests/enrolment-service.test.ts` uses for `applyEnrolmentActivation`
 * — so the real `seat-accounting.ts` primitives (`takeSeat`/`releaseSeat`/
 * `lockOpenCohort`) run for real against the fake `tx`. No Postgres — the
 * end-to-end settlement spine (webhook route, real signature, real seat
 * accounting under a real row lock) is proven separately by
 * `tests/checkout-webhook.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  createCheckoutService,
  HoldExpiredError,
  OrderNotFoundError,
  OrderNotPayableError,
  EmailNotVerifiedError,
  PolicyConsentRequiredError,
} from "@/server/services/checkout-service";
import { buildCheckoutSessionParams } from "@/server/payments/providers/stripe/checkout-session";
import { POLICY_TYPE, POLICY_VERSIONS } from "@/lib/identity";
import {
  CapacityExceededError,
  CohortClosedError,
  CohortNotFoundError,
} from "@/server/services/seat-accounting";

/** Every required-consent field affirmative — the common case in tests that
 *  aren't specifically exercising the consent gate. */
const FULL_CONSENT = {
  acceptedTerms: true,
  acceptedRefundCancellation: true,
  acceptedMarketing: false,
};

// ---------------------------------------------------------------------------
// Fake store + staged-commit transaction
// ---------------------------------------------------------------------------

type CohortRow = {
  id: string;
  title: string;
  status: string;
  capacity: number;
  seatsTaken: number;
  holdMinutes: number | null;
  priceMinor: number;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  deliveryMode: string;
};

type EnrolmentRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: string;
  holdExpiresAt: Date | null;
  orderId: string | null;
};

type OrderRow = {
  id: string;
  reference: string;
  userId: string;
  cohortId: string;
  amountMinor: number;
  currency: string;
  status: string;
  selectedProvider: string | null;
  idempotencyKey: string;
};

type PaymentAttemptRow = {
  id: string;
  orderId: string;
  provider: string;
  amountMinor: number;
  currency: string;
  status: string;
  idempotencyKey: string;
  providerIntentId: string | null;
};

type PolicyAcceptanceRow = {
  id: string;
  userId: string;
  policyType: string;
  version: string;
  accepted: boolean;
  orderId: string | null;
};

const NOW = new Date("2026-09-10T12:00:00.000Z");

function coh(over: Partial<CohortRow> = {}): CohortRow {
  return {
    id: over.id ?? "cohort-1",
    title: over.title ?? "Cohort Fixture",
    status: over.status ?? "PUBLISHED",
    capacity: over.capacity ?? 10,
    seatsTaken: over.seatsTaken ?? 0,
    holdMinutes: over.holdMinutes === undefined ? 30 : over.holdMinutes,
    priceMinor: over.priceMinor ?? 45000000,
    currency: over.currency ?? "NGN",
    startsAt: over.startsAt ?? new Date("2026-10-01T00:00:00.000Z"),
    endsAt: over.endsAt ?? new Date("2026-10-05T00:00:00.000Z"),
    deliveryMode: over.deliveryMode ?? "INSTRUCTOR_LED",
  };
}

function harness(opts?: {
  cohorts?: CohortRow[];
  sessionFactory?: (params: unknown) => { id: string; url: string | null };
  /** Defaults to a verified learner — set false to exercise D-13's gate. */
  emailVerified?: boolean;
}) {
  const cohorts = new Map<string, CohortRow>(
    (opts?.cohorts ?? [coh()]).map((c) => [c.id, { ...c }]),
  );
  const enrolments = new Map<string, EnrolmentRow>();
  const orders = new Map<string, OrderRow>();
  const paymentAttempts = new Map<string, PaymentAttemptRow>();
  const policyAcceptances = new Map<string, PolicyAcceptanceRow>();
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const sessionsCreated: Array<{ params: unknown; options: { idempotencyKey: string } }> = [];
  let seq = 0;

  const cloneMap = <V,>(m: Map<string, V>) =>
    new Map<string, V>([...m].map(([k, v]) => [k, { ...(v as object) } as V]));

  function makeTx(
    cStore: Map<string, CohortRow>,
    eStore: Map<string, EnrolmentRow>,
    oStore: Map<string, OrderRow>,
    evStore: Array<Record<string, unknown>>,
    paStore: Map<string, PaymentAttemptRow>,
    polStore: Map<string, PolicyAcceptanceRow>,
  ) {
    return {
      $queryRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
        const c = cStore.get(vals[0] as string);
        if (!c) return [];
        return [{ status: c.status, seatsTaken: c.seatsTaken, capacity: c.capacity }];
      },
      $executeRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
        const c = cStore.get(vals[0] as string);
        if (c) c.seatsTaken = Math.max(c.seatsTaken - 1, 0);
        return 1;
      },
      cohort: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const c = cStore.get(where.id);
          if (!c) return null;
          return { title: c.title, priceMinor: c.priceMinor, currency: c.currency, holdMinutes: c.holdMinutes };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const c = cStore.get(where.id) as CohortRow;
          const s = data.seatsTaken as { increment?: number; decrement?: number } | undefined;
          if (s?.increment) c.seatsTaken += s.increment;
          if (s?.decrement) c.seatsTaken -= s.decrement;
          return c;
        },
      },
      enrolment: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          seq += 1;
          const id = `enr-new-${seq}`;
          eStore.set(id, {
            id,
            userId: data.userId as string,
            cohortId: data.cohortId as string,
            status: data.status as string,
            holdExpiresAt: (data.holdExpiresAt as Date | null) ?? null,
            orderId: (data.orderId as string) ?? null,
          });
          return { id };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = eStore.get(where.id) as EnrolmentRow;
          Object.assign(row, data);
          return row;
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const w = where as { userId: string; cohortId: string; status: string };
          for (const row of eStore.values()) {
            if (row.userId === w.userId && row.cohortId === w.cohortId && row.status === w.status) {
              return row;
            }
          }
          return null;
        },
      },
      order: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          seq += 1;
          const id = `ord-new-${seq}`;
          oStore.set(id, {
            id,
            reference: data.reference as string,
            userId: data.userId as string,
            cohortId: data.cohortId as string,
            amountMinor: data.amountMinor as number,
            currency: data.currency as string,
            status: data.status as string,
            selectedProvider: null,
            idempotencyKey: data.idempotencyKey as string,
          });
          return { id };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = oStore.get(where.id) as OrderRow;
          Object.assign(row, data);
          return row;
        },
      },
      domainEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          evStore.push(data);
          return { id: `evt-${evStore.length}` };
        },
      },
      paymentAttempt: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          seq += 1;
          const id = `pa-${seq}`;
          paStore.set(id, {
            id,
            orderId: data.orderId as string,
            provider: data.provider as string,
            amountMinor: data.amountMinor as number,
            currency: data.currency as string,
            status: data.status as string,
            idempotencyKey: data.idempotencyKey as string,
            providerIntentId: null,
          });
          return { id };
        },
      },
      policyAcceptance: {
        findMany: async ({ where }: { where: { orderId: string } }) => {
          return [...polStore.values()]
            .filter((row) => row.orderId === where.orderId)
            .map((row) => ({ id: row.id, policyType: row.policyType }));
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          seq += 1;
          const id = `pol-${seq}`;
          polStore.set(id, {
            id,
            userId: data.userId as string,
            policyType: data.policyType as string,
            version: data.version as string,
            accepted: data.accepted as boolean,
            orderId: (data.orderId as string) ?? null,
          });
          return { id };
        },
      },
    };
  }

  const db = {
    $transaction: async <R,>(fn: (tx: unknown) => Promise<R>): Promise<R> => {
      const cStaged = cloneMap(cohorts);
      const eStaged = cloneMap(enrolments);
      const oStaged = cloneMap(orders);
      const evStaged: Array<Record<string, unknown>> = [];
      const paStaged = cloneMap(paymentAttempts);
      const polStaged = cloneMap(policyAcceptances);
      const result = await fn(makeTx(cStaged, eStaged, oStaged, evStaged, paStaged, polStaged));
      for (const [k, v] of cStaged) cohorts.set(k, v);
      for (const [k, v] of eStaged) enrolments.set(k, v);
      for (const [k, v] of oStaged) orders.set(k, v);
      for (const e of evStaged) events.push(e);
      for (const [k, v] of paStaged) paymentAttempts.set(k, v);
      for (const [k, v] of polStaged) policyAcceptances.set(k, v);
      return result;
    },
  };

  function mapOrder(o: OrderRow) {
    const c = cohorts.get(o.cohortId);
    const enrolment = [...enrolments.values()].find((e) => e.orderId === o.id) ?? null;
    return {
      id: o.id,
      userId: o.userId,
      reference: o.reference,
      status: o.status,
      amountMinor: o.amountMinor,
      currency: o.currency,
      cohort: c
        ? { id: c.id, title: c.title, startsAt: c.startsAt, endsAt: c.endsAt, deliveryMode: c.deliveryMode }
        : { id: o.cohortId, title: "", startsAt: NOW, endsAt: NOW, deliveryMode: "" },
      enrolment: enrolment
        ? { id: enrolment.id, status: enrolment.status, holdExpiresAt: enrolment.holdExpiresAt }
        : null,
    };
  }

  const service = createCheckoutService({
    db: db as never,
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const o = orders.get(where.id);
        return o ? mapOrder(o) : null;
      },
      findByReference: async ({ reference }: { reference: string }) => {
        const o = [...orders.values()].find((row) => row.reference === reference);
        return o ? mapOrder(o) : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = orders.get(where.id) as OrderRow;
        Object.assign(row, data);
        return row;
      },
    } as never,
    paymentAttempt: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = paymentAttempts.get(where.id) as PaymentAttemptRow;
        Object.assign(row, data);
        return row;
      },
    } as never,
    user: {
      findUnique: async () => ({
        email: "learner@example.test",
        emailVerified: opts?.emailVerified === false ? null : new Date("2026-09-01T00:00:00.000Z"),
      }),
    } as never,
    stripe: {
      checkout: {
        sessions: {
          create: async (params: unknown, options: { idempotencyKey: string }) => {
            sessionsCreated.push({ params, options });
            const factory =
              opts?.sessionFactory ??
              (() => ({
                id: `cs_test_${sessionsCreated.length}`,
                url: `https://checkout.stripe.com/pay/cs_test_${sessionsCreated.length}`,
              }));
            return factory(params);
          },
        },
      },
    },
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    baseUrl: () => "https://app.example.test",
    now: () => NOW,
  });

  return {
    service,
    cohorts,
    enrolments,
    orders,
    paymentAttempts,
    policyAcceptances,
    events,
    audits,
    sessionsCreated,
  };
}

// ---------------------------------------------------------------------------
// startCheckout
// ---------------------------------------------------------------------------

describe("startCheckout", () => {
  it("creates exactly one Order (PENDING) and one PENDING_PAYMENT Enrolment holding a seat, in one transaction", async () => {
    const { service, orders, enrolments, cohorts } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");

    expect(orders.size).toBe(1);
    const order = orders.get(orderId)!;
    expect(order.status).toBe("PENDING");
    expect(order.userId).toBe("user-1");
    expect(order.cohortId).toBe("cohort-1");

    expect(enrolments.size).toBe(1);
    const enrolment = [...enrolments.values()][0]!;
    expect(enrolment.status).toBe("PENDING_PAYMENT");
    expect(enrolment.orderId).toBe(orderId);

    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
  });

  it("reads amountMinor/currency from the Cohort row, never a hardcoded or client value", async () => {
    const { service, orders } = harness({
      cohorts: [coh({ priceMinor: 12_345_00, currency: "USD" })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    const order = orders.get(orderId)!;
    expect(order.amountMinor).toBe(12_345_00);
    expect(order.currency).toBe("USD");
  });

  it("gives each Order a distinct, non-sequential reference and idempotencyKey", async () => {
    const { service, orders } = harness({ cohorts: [coh({ capacity: 5 })] });
    const first = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    const second = await service.startCheckout({ userId: "user-2" }, "cohort-1");

    const o1 = orders.get(first.orderId)!;
    const o2 = orders.get(second.orderId)!;
    expect(o1.reference).not.toBe(o2.reference);
    expect(o1.idempotencyKey).not.toBe(o2.idempotencyKey);
    expect(o1.reference).toMatch(/^ORD-\d{8}-[A-F0-9]{8}$/);
  });

  it("sets Enrolment.holdExpiresAt from the cohort's own holdMinutes, not a fixed constant", async () => {
    const { service, enrolments } = harness({ cohorts: [coh({ holdMinutes: 45 })] });
    await service.startCheckout({ userId: "user-1" }, "cohort-1");
    const enrolment = [...enrolments.values()][0]!;
    expect(enrolment.holdExpiresAt?.getTime()).toBe(NOW.getTime() + 45 * 60_000);
  });

  it("supersedes a prior live PENDING_PAYMENT hold with a net seat delta of zero", async () => {
    const { service, enrolments, orders, cohorts } = harness({
      cohorts: [coh({ capacity: 1, seatsTaken: 0 })],
    });

    const first = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);

    const second = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    expect(second.orderId).not.toBe(first.orderId);

    expect(orders.get(first.orderId)!.status).toBe("CANCELLED");
    expect(orders.get(second.orderId)!.status).toBe("PENDING");

    const firstEnrolment = [...enrolments.values()].find((e) => e.orderId === first.orderId)!;
    expect(firstEnrolment.status).toBe("CANCELLED");
    const secondEnrolment = [...enrolments.values()].find((e) => e.orderId === second.orderId)!;
    expect(secondEnrolment.status).toBe("PENDING_PAYMENT");

    // Capacity-1 cohort: this only succeeds if release-then-take happened
    // atomically in the same transaction.
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
  });

  it("throws CapacityExceededError on a full cohort and creates no Order", async () => {
    const { service, orders, enrolments, cohorts } = harness({
      cohorts: [coh({ capacity: 1, seatsTaken: 1 })],
    });
    await expect(service.startCheckout({ userId: "user-1" }, "cohort-1")).rejects.toBeInstanceOf(
      CapacityExceededError,
    );
    expect(orders.size).toBe(0);
    expect(enrolments.size).toBe(0);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
  });

  it("throws CohortClosedError on a non-open cohort and creates no Order", async () => {
    const { service, orders } = harness({ cohorts: [coh({ status: "CANCELLED" })] });
    await expect(service.startCheckout({ userId: "user-1" }, "cohort-1")).rejects.toBeInstanceOf(
      CohortClosedError,
    );
    expect(orders.size).toBe(0);
  });

  it("throws CohortNotFoundError for an unknown cohort", async () => {
    const { service, orders } = harness();
    await expect(
      service.startCheckout({ userId: "user-1" }, "cohort-missing"),
    ).rejects.toBeInstanceOf(CohortNotFoundError);
    expect(orders.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getOwnOrder
// ---------------------------------------------------------------------------

describe("getOwnOrder", () => {
  it("returns the order only when it belongs to the actor", async () => {
    const { service } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");

    const mine = await service.getOwnOrder({ userId: "user-1" }, orderId);
    expect(mine?.id).toBe(orderId);

    const notMine = await service.getOwnOrder({ userId: "user-2" }, orderId);
    expect(notMine).toBeNull();
  });

  it("returns null for a non-existent order id — indistinguishable from 'not mine'", async () => {
    const { service } = harness();
    expect(await service.getOwnOrder({ userId: "user-1" }, "does-not-exist")).toBeNull();
  });
});

describe("getOwnOrderByReference", () => {
  it("returns the order only when it belongs to the actor, looked up by reference", async () => {
    const { service, orders } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    const reference = orders.get(orderId)!.reference;

    const mine = await service.getOwnOrderByReference({ userId: "user-1" }, reference);
    expect(mine?.id).toBe(orderId);

    const notMine = await service.getOwnOrderByReference({ userId: "user-2" }, reference);
    expect(notMine).toBeNull();
  });

  it("returns null for a non-existent reference", async () => {
    const { service } = harness();
    expect(await service.getOwnOrderByReference({ userId: "user-1" }, "ORD-DOES-NOT-EXIST")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initiateStripePayment
// ---------------------------------------------------------------------------

describe("initiateStripePayment", () => {
  it("refuses with OrderNotFoundError for another learner's order", async () => {
    const { service } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await expect(
      service.initiateStripePayment({ userId: "user-2" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it("refuses with OrderNotFoundError for a non-existent order id", async () => {
    const { service } = harness();
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, "does-not-exist", FULL_CONSENT),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it("refuses with OrderNotPayableError when the order is not PENDING", async () => {
    const { service, orders } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    orders.get(orderId)!.status = "PAID";
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(OrderNotPayableError);
  });

  it("refuses with EmailNotVerifiedError before any write when the learner's email is unverified", async () => {
    const { service, paymentAttempts, policyAcceptances } = harness({ emailVerified: false });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
    expect(paymentAttempts.size).toBe(0);
    expect(policyAcceptances.size).toBe(0);
  });

  it("refuses with HoldExpiredError when the linked enrolment's hold has expired", async () => {
    const { service, enrolments } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    const enrolment = [...enrolments.values()][0]!;
    enrolment.holdExpiresAt = new Date(NOW.getTime() - 1_000);
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(HoldExpiredError);
  });

  it("refuses with HoldExpiredError when the enrolment is no longer PENDING_PAYMENT", async () => {
    const { service, enrolments } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    const enrolment = [...enrolments.values()][0]!;
    enrolment.status = "CANCELLED";
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(HoldExpiredError);
  });

  it("refuses with PolicyConsentRequiredError and creates no PaymentAttempt or PolicyAcceptance when a required consent is missing", async () => {
    const { service, paymentAttempts, policyAcceptances } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await expect(
      service.initiateStripePayment(
        { userId: "user-1" },
        orderId,
        { acceptedTerms: true, acceptedRefundCancellation: false, acceptedMarketing: true },
      ),
    ).rejects.toBeInstanceOf(PolicyConsentRequiredError);
    expect(paymentAttempts.size).toBe(0);
    expect(policyAcceptances.size).toBe(0);
  });

  it("records exactly three PolicyAcceptance rows — terms and refund-cancellation true, marketing matching the learner's actual answer — all order-bound with the correct versions", async () => {
    const { service, policyAcceptances } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await service.initiateStripePayment(
      { userId: "user-1" },
      orderId,
      { acceptedTerms: true, acceptedRefundCancellation: true, acceptedMarketing: true },
    );

    const rows = [...policyAcceptances.values()];
    expect(rows).toHaveLength(3);
    const byType = Object.fromEntries(rows.map((r) => [r.policyType, r]));
    expect(new Set(rows.map((r) => r.policyType))).toEqual(
      new Set([POLICY_TYPE.TERMS, POLICY_TYPE.REFUND_CANCELLATION, POLICY_TYPE.MARKETING]),
    );
    for (const row of rows) {
      expect(row.orderId).toBe(orderId);
      expect(row.userId).toBe("user-1");
    }
    expect(byType[POLICY_TYPE.TERMS]!.accepted).toBe(true);
    expect(byType[POLICY_TYPE.TERMS]!.version).toBe(POLICY_VERSIONS[POLICY_TYPE.TERMS]);
    expect(byType[POLICY_TYPE.REFUND_CANCELLATION]!.accepted).toBe(true);
    expect(byType[POLICY_TYPE.REFUND_CANCELLATION]!.version).toBe(
      POLICY_VERSIONS[POLICY_TYPE.REFUND_CANCELLATION],
    );
    expect(byType[POLICY_TYPE.MARKETING]!.accepted).toBe(true);
    expect(byType[POLICY_TYPE.MARKETING]!.version).toBe(POLICY_VERSIONS[POLICY_TYPE.MARKETING]);
  });

  it("records an explicit accepted: false marketing row when the learner declines it — not the absence of a row", async () => {
    const { service, policyAcceptances } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const marketingRow = [...policyAcceptances.values()].find(
      (r) => r.policyType === POLICY_TYPE.MARKETING,
    );
    expect(marketingRow).toBeDefined();
    expect(marketingRow!.accepted).toBe(false);
  });

  it("does not duplicate PolicyAcceptance rows on a repeat call for the same order (D-04 retry)", async () => {
    const { service, policyAcceptances } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    expect(policyAcceptances.size).toBe(3);
  });

  it("creates one PaymentAttempt copying the Order's amount/currency, stores the session id, sets selectedProvider, and passes the idempotency key as a Stripe request option", async () => {
    const { service, paymentAttempts, orders } = harness({
      sessionFactory: () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" }),
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    const order = orders.get(orderId)!;

    const { url } = await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    expect(paymentAttempts.size).toBe(1);
    const attempt = [...paymentAttempts.values()][0]!;
    expect(attempt.provider).toBe("STRIPE");
    expect(attempt.amountMinor).toBe(order.amountMinor);
    expect(attempt.currency).toBe(order.currency);
    expect(attempt.providerIntentId).toBe("cs_test_123");
    expect(attempt.status).toBe("PROCESSING");

    expect(orders.get(orderId)!.selectedProvider).toBe("STRIPE");
    expect(url).toBe("https://checkout.stripe.com/pay/cs_test_123");
  });

  it("passes the PaymentAttempt's own idempotencyKey as the Stripe request option, not a field inside the session params", async () => {
    const { service, paymentAttempts, sessionsCreated } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const attempt = [...paymentAttempts.values()][0]!;
    expect(sessionsCreated).toHaveLength(1);
    expect(sessionsCreated[0]!.options).toEqual({ idempotencyKey: attempt.idempotencyKey });
    expect((sessionsCreated[0]!.params as Record<string, unknown>).idempotencyKey).toBeUndefined();
  });

  it("appends a declined=1 marker to the Stripe cancel_url so the D-04 retry banner has a signal to key off", async () => {
    const { service, sessionsCreated } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const params = sessionsCreated[0]!.params as { cancel_url?: string };
    expect(params.cancel_url).toBe(`https://app.example.test/checkout/${orderId}?declined=1`);
  });
});

describe("getOwnVerificationStatus", () => {
  it("reports verified: false and no email for an unverified learner", async () => {
    const { service } = harness({ emailVerified: false });
    const status = await service.getOwnVerificationStatus({ userId: "user-1" });
    expect(status.verified).toBe(false);
  });

  it("reports verified: true for a verified learner", async () => {
    const { service } = harness();
    const status = await service.getOwnVerificationStatus({ userId: "user-1" });
    expect(status.verified).toBe(true);
    expect(status.email).toBe("learner@example.test");
  });
});

// ---------------------------------------------------------------------------
// buildCheckoutSessionParams (pure, no network)
// ---------------------------------------------------------------------------

describe("buildCheckoutSessionParams", () => {
  it("emits unit_amount exactly equal to amountMinor with no rounding, and lowercases currency", () => {
    const params = buildCheckoutSessionParams({
      orderId: "order-1",
      enrolmentId: "enr-1",
      cohortTitle: "Advanced Testing",
      amountMinor: 45_000_000,
      currency: "NGN",
      successUrl: "https://app.example.test/checkout/order-1/confirming",
      cancelUrl: "https://app.example.test/checkout/order-1",
    });

    expect(params.mode).toBe("payment");
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.client_reference_id).toBe("order-1");
    expect(params.metadata).toEqual({ orderId: "order-1", enrolmentId: "enr-1" });

    const lineItem = params.line_items?.[0];
    expect(lineItem?.quantity).toBe(1);
    expect(lineItem?.price_data?.unit_amount).toBe(45_000_000);
    expect(lineItem?.price_data?.currency).toBe("ngn");
    expect(lineItem?.price_data?.product_data).toEqual({ name: "Advanced Testing" });
  });
});
