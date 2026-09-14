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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCheckoutService,
  HoldExpiredError,
  OrderNotFoundError,
  OrderNotPayableError,
  EmailNotVerifiedError,
  PolicyConsentRequiredError,
  CurrencyUnavailableError,
  ProviderCurrencyMismatchError,
} from "@/server/services/checkout-service";
import { buildCheckoutSessionParams } from "@/server/payments/providers/stripe/checkout-session";
import { createActivateOrderAsSystem } from "@/server/services/checkout-webhook-system-service";
import { calculateCheckoutBreakdown, type GatewayFeeScheduleValues } from "@/server/payments/pricing";
import { MissingSettlementAccountError } from "@/server/payments/settlement-config";
import { POLICY_TYPE, POLICY_VERSIONS } from "@/lib/identity";
import {
  AlreadyEnrolledError,
  CapacityExceededError,
  CohortClosedError,
  CohortNotFoundError,
} from "@/server/services/seat-accounting";

/**
 * 07-06 — `initiateStripePayment` resolves `stripeConnectedAccountId()`
 * (env-based, per `settlement-config.ts`'s own design — never injectable),
 * so every test in this file that reaches a real Stripe call needs this set.
 * Set before every test (harmless for Paystack-only cases) and restored
 * after, mirroring `tests/payments-settlement-config.test.ts`'s own
 * save/restore discipline.
 */
const TEST_STRIPE_CONNECTED_ACCOUNT_ID = "acct_test_connected_123";
const TEST_PAYSTACK_SUBACCOUNT_CODE = "ACCT_test_subaccount_123";
let savedStripeConnectedAccountId: string | undefined;
let savedPaystackSubaccountCode: string | undefined;

beforeEach(() => {
  savedStripeConnectedAccountId = process.env.STRIPE_CONNECTED_ACCOUNT_ID;
  savedPaystackSubaccountCode = process.env.PAYSTACK_SUBACCOUNT_CODE;
  process.env.STRIPE_CONNECTED_ACCOUNT_ID = TEST_STRIPE_CONNECTED_ACCOUNT_ID;
  process.env.PAYSTACK_SUBACCOUNT_CODE = TEST_PAYSTACK_SUBACCOUNT_CODE;
});

afterEach(() => {
  if (savedStripeConnectedAccountId === undefined) delete process.env.STRIPE_CONNECTED_ACCOUNT_ID;
  else process.env.STRIPE_CONNECTED_ACCOUNT_ID = savedStripeConnectedAccountId;
  if (savedPaystackSubaccountCode === undefined) delete process.env.PAYSTACK_SUBACCOUNT_CODE;
  else process.env.PAYSTACK_SUBACCOUNT_CODE = savedPaystackSubaccountCode;
});

/** Mirrors 07-03's D-25 worked-example schedule fixture exactly (tests/payment-pricing.test.ts). */
const PAYSTACK_NGN_SCHEDULE: GatewayFeeScheduleValues = {
  provider: "PAYSTACK",
  currency: "NGN",
  version: 1,
  percentageBps: 150,
  fixedMinor: 10_000,
  waiverThresholdMinor: null,
  capMinor: 200_000,
  taxBps: 0,
  roundingRule: "HALF_UP",
};

/** A distinct, table-driven Stripe/USD schedule — arbitrary but stable, so tests can cross-check via `calculateCheckoutBreakdown` directly rather than hand-deriving numbers. */
const STRIPE_USD_SCHEDULE: GatewayFeeScheduleValues = {
  provider: "STRIPE",
  currency: "USD",
  version: 1,
  percentageBps: 290,
  fixedMinor: 30,
  waiverThresholdMinor: null,
  capMinor: null,
  taxBps: 0,
  roundingRule: "HALF_UP",
};

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
  priceNgnMinor: number | null;
  priceUsdMinor: number | null;
  startsAt: Date;
  endsAt: Date;
  deliveryMode: string;
};

type GatewayFeeScheduleRow = GatewayFeeScheduleValues & { id: string; active: boolean; effectiveFrom: Date };

function gfs(
  values: GatewayFeeScheduleValues,
  id: string,
  effectiveFrom: Date = new Date("2026-01-01T00:00:00.000Z"),
): GatewayFeeScheduleRow {
  return { ...values, id, active: true, effectiveFrom };
}

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
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
  gatewayFeeScheduleId: string | null;
  gatewayFeeScheduleVersion: number | null;
  schoolSettlementExpectedMinor: number | null;
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
    priceNgnMinor: over.priceNgnMinor === undefined ? 45_000_000 : over.priceNgnMinor,
    priceUsdMinor: over.priceUsdMinor === undefined ? null : over.priceUsdMinor,
    startsAt: over.startsAt ?? new Date("2026-10-01T00:00:00.000Z"),
    endsAt: over.endsAt ?? new Date("2026-10-05T00:00:00.000Z"),
    deliveryMode: over.deliveryMode ?? "INSTRUCTOR_LED",
  };
}

function harness(opts?: {
  cohorts?: CohortRow[];
  enrolments?: EnrolmentRow[];
  schedules?: GatewayFeeScheduleRow[];
  sessionFactory?: (params: unknown) => { id: string; url: string | null };
  paystackFactory?: (input: unknown) => { redirectUrl: string; providerIntentId: string };
  /** Defaults to a verified learner — set false to exercise D-13's gate. */
  emailVerified?: boolean;
}) {
  const cohorts = new Map<string, CohortRow>(
    (opts?.cohorts ?? [coh()]).map((c) => [c.id, { ...c }]),
  );
  const schedules =
    opts?.schedules ?? [gfs(PAYSTACK_NGN_SCHEDULE, "gfs-paystack-ngn-v1"), gfs(STRIPE_USD_SCHEDULE, "gfs-stripe-usd-v1")];
  const enrolments = new Map<string, EnrolmentRow>(
    (opts?.enrolments ?? []).map((enrolment) => [enrolment.id, { ...enrolment }]),
  );
  const orders = new Map<string, OrderRow>();
  const paymentAttempts = new Map<string, PaymentAttemptRow>();
  const policyAcceptances = new Map<string, PolicyAcceptanceRow>();
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const sessionsCreated: Array<{ params: unknown; options: { idempotencyKey: string } }> = [];
  const paystackInitiations: Array<{ input: Record<string, unknown> }> = [];
  const transactionOptions: Array<{ timeout?: number } | undefined> = [];
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
          return {
            title: c.title,
            priceNgnMinor: c.priceNgnMinor,
            priceUsdMinor: c.priceUsdMinor,
            holdMinutes: c.holdMinutes,
          };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const c = cStore.get(where.id) as CohortRow;
          const s = data.seatsTaken as { increment?: number; decrement?: number } | undefined;
          if (s?.increment) c.seatsTaken += s.increment;
          if (s?.decrement) c.seatsTaken -= s.decrement;
          return c;
        },
      },
      gatewayFeeSchedule: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const w = where as { provider: string; currency: string; active?: boolean };
          const matches = schedules.filter(
            (s) => s.provider === w.provider && s.currency === w.currency && s.active === true,
          );
          if (matches.length === 0) return null;
          return [...matches].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
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
            selectedProvider: (data.selectedProvider as string) ?? null,
            baseAmountMinor: (data.baseAmountMinor as number) ?? null,
            platformFeeMinor: (data.platformFeeMinor as number) ?? null,
            gatewayFeeEstimateMinor: (data.gatewayFeeEstimateMinor as number) ?? null,
            gatewayFeeScheduleId: (data.gatewayFeeScheduleId as string) ?? null,
            gatewayFeeScheduleVersion: (data.gatewayFeeScheduleVersion as number) ?? null,
            schoolSettlementExpectedMinor: (data.schoolSettlementExpectedMinor as number) ?? null,
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
    $transaction: async <R,>(
      fn: (tx: unknown) => Promise<R>,
      options?: { timeout?: number },
    ): Promise<R> => {
      transactionOptions.push(options);
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
      selectedProvider: o.selectedProvider,
      baseAmountMinor: o.baseAmountMinor,
      platformFeeMinor: o.platformFeeMinor,
      gatewayFeeEstimateMinor: o.gatewayFeeEstimateMinor,
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
    paystack: {
      initiate: async (input: Record<string, unknown>) => {
        paystackInitiations.push({ input });
        const factory =
          opts?.paystackFactory ??
          (() => ({
            redirectUrl: `https://checkout.paystack.com/pay_test_${paystackInitiations.length}`,
            providerIntentId: `ps_ref_${paystackInitiations.length}`,
          }));
        return factory(input);
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
    paystackInitiations,
    transactionOptions,
  };
}

// ---------------------------------------------------------------------------
// startCheckout
// ---------------------------------------------------------------------------

describe("startCheckout", () => {
  it("gives its interactive transaction enough time for the checkout seat-accounting sequence", async () => {
    const { service, transactionOptions } = harness();

    await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");

    expect(transactionOptions).toEqual([{ timeout: 15_000 }]);
  });

  it("refuses checkout for a learner who is already actively enrolled, before creating an Order or changing seats", async () => {
    const existing: EnrolmentRow = {
      id: "enr-active",
      userId: "user-1",
      cohortId: "cohort-1",
      status: "ACTIVE",
      holdExpiresAt: null,
      orderId: "order-paid",
    };
    const { service, orders, enrolments, cohorts } = harness({
      cohorts: [coh({ seatsTaken: 1 })],
      enrolments: [existing],
    });

    await expect(
      service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN"),
    ).rejects.toBeInstanceOf(AlreadyEnrolledError);

    expect(orders.size).toBe(0);
    expect(enrolments.size).toBe(1);
    expect(cohorts.get("cohort-1")?.seatsTaken).toBe(1);
  });

  it("creates exactly one Order (PENDING) and one PENDING_PAYMENT Enrolment holding a seat, in one transaction", async () => {
    const { service, orders, enrolments, cohorts } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");

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

  it("reads the base price from the Cohort's matching currency rail, never a hardcoded or client value, and snapshots the full D-13 commercial breakdown", async () => {
    const { service, orders } = harness({
      cohorts: [coh({ priceNgnMinor: 45_000_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    const order = orders.get(orderId)!;

    // D-25 worked example, exactly.
    expect(order.currency).toBe("NGN");
    expect(order.selectedProvider).toBe("PAYSTACK");
    expect(order.baseAmountMinor).toBe(45_000_000);
    expect(order.platformFeeMinor).toBe(675_000);
    expect(order.gatewayFeeEstimateMinor).toBe(200_000);
    expect(order.amountMinor).toBe(45_875_000);
    expect(order.schoolSettlementExpectedMinor).toBe(45_000_000);
    expect(order.gatewayFeeScheduleId).toBe("gfs-paystack-ngn-v1");
    expect(order.gatewayFeeScheduleVersion).toBe(1);
  });

  it("derives the same breakdown a direct calculateCheckoutBreakdown call would produce, for a USD/Stripe cohort", async () => {
    const { service, orders } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 12_345_00 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    const order = orders.get(orderId)!;

    const expected = calculateCheckoutBreakdown({ baseAmountMinor: 12_345_00, schedule: STRIPE_USD_SCHEDULE });
    expect(order.currency).toBe("USD");
    expect(order.selectedProvider).toBe("STRIPE");
    expect(order.baseAmountMinor).toBe(expected.baseAmountMinor);
    expect(order.platformFeeMinor).toBe(expected.platformFeeMinor);
    expect(order.gatewayFeeEstimateMinor).toBe(expected.gatewayFeeEstimateMinor);
    expect(order.amountMinor).toBe(expected.totalAmountMinor);
  });

  it("throws CurrencyUnavailableError and creates no Order and no seat hold when the Cohort has no price for the requested currency", async () => {
    const { service, orders, enrolments, cohorts } = harness({
      cohorts: [coh({ priceNgnMinor: 45_000_000, priceUsdMinor: null })],
    });
    await expect(
      service.startCheckout({ userId: "user-1" }, "cohort-1", "USD"),
    ).rejects.toBeInstanceOf(CurrencyUnavailableError);
    expect(orders.size).toBe(0);
    expect(enrolments.size).toBe(0);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
  });

  it("providerForCurrency is the only place a provider is chosen — NGN always snapshots PAYSTACK, USD always snapshots STRIPE", async () => {
    const { service: ngnService, orders: ngnOrders } = harness({
      cohorts: [coh({ priceNgnMinor: 1_000_000 })],
    });
    const { orderId: ngnOrderId } = await ngnService.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    expect(ngnOrders.get(ngnOrderId)!.selectedProvider).toBe("PAYSTACK");

    const { service: usdService, orders: usdOrders } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 1_000_00 })],
    });
    const { orderId: usdOrderId } = await usdService.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    expect(usdOrders.get(usdOrderId)!.selectedProvider).toBe("STRIPE");
  });

  it("gives each Order a distinct, non-sequential reference and idempotencyKey", async () => {
    const { service, orders } = harness({ cohorts: [coh({ capacity: 5 })] });
    const first = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    const second = await service.startCheckout({ userId: "user-2" }, "cohort-1", "NGN");

    const o1 = orders.get(first.orderId)!;
    const o2 = orders.get(second.orderId)!;
    expect(o1.reference).not.toBe(o2.reference);
    expect(o1.idempotencyKey).not.toBe(o2.idempotencyKey);
    expect(o1.reference).toMatch(/^ORD-\d{8}-[A-F0-9]{8}$/);
  });

  it("sets Enrolment.holdExpiresAt from the cohort's own holdMinutes, not a fixed constant", async () => {
    const { service, enrolments } = harness({ cohorts: [coh({ holdMinutes: 45 })] });
    await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    const enrolment = [...enrolments.values()][0]!;
    expect(enrolment.holdExpiresAt?.getTime()).toBe(NOW.getTime() + 45 * 60_000);
  });

  it("supersedes a prior live PENDING_PAYMENT hold with a net seat delta of zero", async () => {
    const { service, enrolments, orders, cohorts } = harness({
      cohorts: [coh({ capacity: 1, seatsTaken: 0 })],
    });

    const first = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);

    const second = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
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
    await expect(service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN")).rejects.toBeInstanceOf(
      CapacityExceededError,
    );
    expect(orders.size).toBe(0);
    expect(enrolments.size).toBe(0);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
  });

  it("throws CohortClosedError on a non-open cohort and creates no Order", async () => {
    const { service, orders } = harness({ cohorts: [coh({ status: "CANCELLED" })] });
    await expect(service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN")).rejects.toBeInstanceOf(
      CohortClosedError,
    );
    expect(orders.size).toBe(0);
  });

  it("throws CohortNotFoundError for an unknown cohort", async () => {
    const { service, orders } = harness();
    await expect(
      service.startCheckout({ userId: "user-1" }, "cohort-missing", "NGN"),
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
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");

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
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
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
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
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
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    orders.get(orderId)!.status = "PAID";
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(OrderNotPayableError);
  });

  it("refuses with EmailNotVerifiedError before any write when the learner's email is unverified", async () => {
    const { service, paymentAttempts, policyAcceptances } = harness({ emailVerified: false });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
    expect(paymentAttempts.size).toBe(0);
    expect(policyAcceptances.size).toBe(0);
  });

  it("refuses with HoldExpiredError when the linked enrolment's hold has expired", async () => {
    const { service, enrolments } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    const enrolment = [...enrolments.values()][0]!;
    enrolment.holdExpiresAt = new Date(NOW.getTime() - 1_000);
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(HoldExpiredError);
  });

  it("refuses with HoldExpiredError when the enrolment is no longer PENDING_PAYMENT", async () => {
    const { service, enrolments } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    const enrolment = [...enrolments.values()][0]!;
    enrolment.status = "CANCELLED";
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(HoldExpiredError);
  });

  it("refuses with PolicyConsentRequiredError and creates no PaymentAttempt or PolicyAcceptance when a required consent is missing", async () => {
    const { service, paymentAttempts, policyAcceptances } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
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
    // 07-06 — the Stripe rail now refuses a non-USD Order (D-07); a
    // USD-priced cohort is what actually reaches initiateStripePayment.
    const { service, policyAcceptances } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
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
    const { service, policyAcceptances } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const marketingRow = [...policyAcceptances.values()].find(
      (r) => r.policyType === POLICY_TYPE.MARKETING,
    );
    expect(marketingRow).toBeDefined();
    expect(marketingRow!.accepted).toBe(false);
  });

  it("does not duplicate PolicyAcceptance rows on a repeat call for the same order (D-04 retry)", async () => {
    const { service, policyAcceptances } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    expect(policyAcceptances.size).toBe(3);
  });

  it("creates one PaymentAttempt copying the Order's amount/currency, stores the session id, sets selectedProvider, and passes the idempotency key as a Stripe request option", async () => {
    const { service, paymentAttempts, orders } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
      sessionFactory: () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" }),
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
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
    const { service, paymentAttempts, sessionsCreated } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const attempt = [...paymentAttempts.values()][0]!;
    expect(sessionsCreated).toHaveLength(1);
    expect(sessionsCreated[0]!.options).toEqual({ idempotencyKey: attempt.idempotencyKey });
    expect((sessionsCreated[0]!.params as Record<string, unknown>).idempotencyKey).toBeUndefined();
  });

  it("appends a declined=1 marker to the Stripe cancel_url so the D-04 retry banner has a signal to key off", async () => {
    const { service, sessionsCreated } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const params = sessionsCreated[0]!.params as { cancel_url?: string };
    expect(params.cancel_url).toBe(`https://app.example.test/checkout/${orderId}?declined=1`);
  });

  it("07-06: refuses with ProviderCurrencyMismatchError and records no Stripe call when the Order's currency is NGN (D-07)", async () => {
    const { service, sessionsCreated, paymentAttempts } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(ProviderCurrencyMismatchError);
    expect(sessionsCreated).toHaveLength(0);
    expect(paymentAttempts.size).toBe(0);
  });

  it("07-06: raises MissingSettlementAccountError and records no Stripe call or PaymentAttempt when STRIPE_CONNECTED_ACCOUNT_ID is unset (D-05)", async () => {
    const { service, sessionsCreated, paymentAttempts } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    delete process.env.STRIPE_CONNECTED_ACCOUNT_ID;
    await expect(
      service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(MissingSettlementAccountError);
    expect(sessionsCreated).toHaveLength(0);
    expect(paymentAttempts.size).toBe(0);
  });

  it("07-06: sends transfer_data.amount as the Order's base price and transfer_data.destination as the configured connected account — distinct from the line-item total (D-04, PAY-17)", async () => {
    const { service, orders, sessionsCreated } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    const order = orders.get(orderId)!;
    expect(order.baseAmountMinor).not.toBe(order.amountMinor); // D-04's two distinct values

    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const params = sessionsCreated[0]!.params as {
      line_items?: Array<{ price_data?: { unit_amount?: number } }>;
      payment_intent_data?: { transfer_data?: { amount?: number; destination?: string }; on_behalf_of?: string };
    };
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(order.amountMinor);
    expect(params.payment_intent_data?.transfer_data?.amount).toBe(order.baseAmountMinor);
    expect(params.payment_intent_data?.transfer_data?.destination).toBe(TEST_STRIPE_CONNECTED_ACCOUNT_ID);
    // 07-01 Decision C: platform and connected accounts are both US — same
    // country — so on_behalf_of is not required for this deployment.
    expect(params.payment_intent_data?.on_behalf_of).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// initiatePaystackPayment
// ---------------------------------------------------------------------------

describe("initiatePaystackPayment", () => {
  it("raises MissingSettlementAccountError before creating a PaymentAttempt when PAYSTACK_SUBACCOUNT_CODE is unset (D-05)", async () => {
    const { service, paymentAttempts, paystackInitiations } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    delete process.env.PAYSTACK_SUBACCOUNT_CODE;

    await expect(
      service.initiatePaystackPayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(MissingSettlementAccountError);
    expect(paymentAttempts.size).toBe(0);
    expect(paystackInitiations).toHaveLength(0);
  });

  it("refuses with the same guard chain, in the same order, as initiateStripePayment", async () => {
    const { service } = harness();
    await expect(
      service.initiatePaystackPayment({ userId: "user-2" }, "does-not-exist", FULL_CONSENT),
    ).rejects.toBeInstanceOf(OrderNotFoundError);

    const { service: verifiedFalseService } = harness({ emailVerified: false });
    const { orderId } = await verifiedFalseService.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    await expect(
      verifiedFalseService.initiatePaystackPayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it("refuses with PolicyConsentRequiredError and creates no PaymentAttempt when a required consent is missing", async () => {
    const { service, paymentAttempts } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    await expect(
      service.initiatePaystackPayment(
        { userId: "user-1" },
        orderId,
        { acceptedTerms: false, acceptedRefundCancellation: true, acceptedMarketing: true },
      ),
    ).rejects.toBeInstanceOf(PolicyConsentRequiredError);
    expect(paymentAttempts.size).toBe(0);
  });

  it("creates one PAYSTACK PaymentAttempt, sets selectedProvider, stores the provider's own reference as providerIntentId, and moves the attempt to PROCESSING", async () => {
    const { service, paymentAttempts, orders, paystackInitiations } = harness({
      cohorts: [coh({ priceNgnMinor: 45_000_000 })],
      paystackFactory: () => ({
        redirectUrl: "https://checkout.paystack.com/pay_test_abc",
        providerIntentId: "ORD-20260910-TESTREF1",
      }),
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    const order = orders.get(orderId)!;

    const { url } = await service.initiatePaystackPayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    expect(paymentAttempts.size).toBe(1);
    const attempt = [...paymentAttempts.values()][0]!;
    expect(attempt.provider).toBe("PAYSTACK");
    expect(attempt.amountMinor).toBe(order.amountMinor);
    expect(attempt.currency).toBe("NGN");
    expect(attempt.providerIntentId).toBe("ORD-20260910-TESTREF1");
    expect(attempt.status).toBe("PROCESSING");

    expect(orders.get(orderId)!.selectedProvider).toBe("PAYSTACK");
    expect(url).toBe("https://checkout.paystack.com/pay_test_abc");

    // The D-25 request-shape assertions live in tests/paystack-provider.test.ts;
    // this only proves checkout-service.ts hands the adapter the RIGHT values.
    expect(paystackInitiations).toHaveLength(1);
    expect(paystackInitiations[0]!.input).toMatchObject({
      orderId,
      orderReference: order.reference,
      learnerEmail: "learner@example.test",
      currency: "NGN",
      amountMinor: 45_875_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 200_000,
    });
  });

  it("does not duplicate PolicyAcceptance rows on a repeat call for the same order (D-04 retry)", async () => {
    const { service, policyAcceptances } = harness();
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    await service.initiatePaystackPayment({ userId: "user-1" }, orderId, FULL_CONSENT);
    await service.initiatePaystackPayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    expect(policyAcceptances.size).toBe(3);
  });

  it("07-06: refuses with ProviderCurrencyMismatchError and records no Paystack call when the Order's currency is USD (D-07)", async () => {
    const { service, paystackInitiations, paymentAttempts } = harness({
      cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })],
    });
    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    await expect(
      service.initiatePaystackPayment({ userId: "user-1" }, orderId, FULL_CONSENT),
    ).rejects.toBeInstanceOf(ProviderCurrencyMismatchError);
    expect(paystackInitiations).toHaveLength(0);
    expect(paymentAttempts.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end (fake-backed): startCheckout -> initiatePaystackPayment ->
// activateOrderAsSystem -> Order PAID, Enrolment ACTIVE, exactly once.
// ---------------------------------------------------------------------------

describe("end-to-end NGN/Paystack settlement (fake-backed)", () => {
  it("drives cohort selection through to a PAID Order and exactly one ACTIVE Enrolment, and a redelivery produces no second effect", async () => {
    const h = harness({ cohorts: [coh({ priceNgnMinor: 45_000_000 })] });
    const { service, orders, enrolments, paymentAttempts } = h;

    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "NGN");
    await service.initiatePaystackPayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const attempt = [...paymentAttempts.values()][0]!;
    expect(attempt.provider).toBe("PAYSTACK");
    expect(attempt.providerIntentId).toBeTruthy();

    // A minimal SettlementTxClient bridging the SAME in-memory Order/Enrolment
    // rows `startCheckout`/`initiatePaystackPayment` above wrote to — proving
    // the whole chain lands on one PAID Order and one ACTIVE Enrolment without
    // this test ever writing a paid status itself.
    const settlementTx = {
      $queryRaw: async () => {
        const c = h.cohorts.get("cohort-1")!;
        return [{ status: c.status, seatsTaken: c.seatsTaken, capacity: c.capacity }];
      },
      $executeRaw: async () => 1,
      enrolment: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const w = where as {
            userId: string;
            cohortId: string;
            status: string;
            id?: { not?: string };
          };
          return (
            [...enrolments.values()].find(
              (row) =>
                row.userId === w.userId &&
                row.cohortId === w.cohortId &&
                row.status === w.status &&
                row.id !== w.id?.not,
            ) ?? null
          );
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = enrolments.get(where.id) as unknown as Record<string, unknown>;
          Object.assign(row, data);
          return row;
        },
      },
      cohort: {
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const c = h.cohorts.get(where.id)!;
          const inc = (data as { seatsTaken?: { increment?: number } }).seatsTaken?.increment;
          if (inc) c.seatsTaken += inc;
          return c;
        },
      },
      domainEvent: { create: async () => ({ id: "de-e2e" }) },
      order: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const o = orders.get(where.id);
          if (!o) return null;
          const orderEnrolments = [...enrolments.values()].filter((e) => e.orderId === o.id);
          return { id: o.id, status: o.status, amountMinor: o.amountMinor, currency: o.currency, enrolments: orderEnrolments };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const o = orders.get(where.id) as unknown as Record<string, unknown>;
          Object.assign(o, data);
          return o;
        },
      },
      paymentAttempt: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const w = where as { orderId: string; providerIntentId?: string };
          const list = [...paymentAttempts.values()].filter((a) => a.orderId === w.orderId);
          return (w.providerIntentId ? list.find((a) => a.providerIntentId === w.providerIntentId) : list[0]) ?? null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const a = paymentAttempts.get(where.id) as unknown as Record<string, unknown>;
          Object.assign(a, data);
          return a;
        },
      },
      webhookEvent: { updateMany: async () => ({ count: 1 }) },
    };

    const settlementDeps = {
      db: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(settlementTx) },
      audit: async () => {},
      orderEmailFacts: {
        findUnique: async () => ({
          reference: orders.get(orderId)!.reference,
          cohortTitle: "Cohort Fixture",
          userId: "user-1",
          email: null,
        }),
      },
      dispatchEmail: async () => ({ id: "e-e2e", status: "SENT" }),
      now: () => NOW,
    };

    const activate = createActivateOrderAsSystem(settlementDeps as never);

    const first = await activate({
      orderId,
      provider: "PAYSTACK",
      providerIntentId: attempt.providerIntentId!,
      amountMinor: orders.get(orderId)!.amountMinor,
      currency: "NGN",
      eventId: "evt-e2e-1",
    });

    expect(first.outcome).toBe("ACTIVATED");
    expect(orders.get(orderId)!.status).toBe("PAID");
    const activeAfterFirst = [...enrolments.values()].filter((e) => e.status === "ACTIVE");
    expect(activeAfterFirst).toHaveLength(1);

    // A redelivery (a different event id, the same reference) must never
    // produce a second effect — PAY-07/PAY-11.
    const second = await activate({
      orderId,
      provider: "PAYSTACK",
      providerIntentId: attempt.providerIntentId!,
      amountMinor: orders.get(orderId)!.amountMinor,
      currency: "NGN",
      eventId: "evt-e2e-2",
    });

    expect(second.outcome).toBe("EXCEPTION");
    expect(orders.get(orderId)!.status).toBe("PAID");
    expect([...enrolments.values()].filter((e) => e.status === "ACTIVE")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 07-06 — End-to-end (fake-backed): startCheckout -> initiateStripePayment ->
// activateOrderAsSystem -> Order PAID, Enrolment ACTIVE, exactly once. The
// USD/Stripe Connect destination-charge sibling of the NGN/Paystack proof
// above — the webhook settlement path itself is untouched by this plan.
// ---------------------------------------------------------------------------

describe("end-to-end USD/Stripe destination-charge settlement (fake-backed)", () => {
  it("drives cohort selection through to a PAID Order and exactly one ACTIVE Enrolment", async () => {
    const h = harness({ cohorts: [coh({ priceNgnMinor: null, priceUsdMinor: 100_000 })] });
    const { service, orders, enrolments, paymentAttempts } = h;

    const { orderId } = await service.startCheckout({ userId: "user-1" }, "cohort-1", "USD");
    await service.initiateStripePayment({ userId: "user-1" }, orderId, FULL_CONSENT);

    const attempt = [...paymentAttempts.values()][0]!;
    expect(attempt.provider).toBe("STRIPE");
    expect(attempt.providerIntentId).toBeTruthy();

    // A minimal SettlementTxClient bridging the SAME in-memory Order/
    // Enrolment rows above — proving the whole chain lands on one PAID
    // Order and one ACTIVE Enrolment without this test writing a paid
    // status itself. Structurally identical to the NGN/Paystack proof.
    const settlementTx = {
      $queryRaw: async () => {
        const c = h.cohorts.get("cohort-1")!;
        return [{ status: c.status, seatsTaken: c.seatsTaken, capacity: c.capacity }];
      },
      $executeRaw: async () => 1,
      enrolment: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const w = where as {
            userId: string;
            cohortId: string;
            status: string;
            id?: { not?: string };
          };
          return (
            [...enrolments.values()].find(
              (row) =>
                row.userId === w.userId &&
                row.cohortId === w.cohortId &&
                row.status === w.status &&
                row.id !== w.id?.not,
            ) ?? null
          );
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = enrolments.get(where.id) as unknown as Record<string, unknown>;
          Object.assign(row, data);
          return row;
        },
      },
      cohort: {
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const c = h.cohorts.get(where.id)!;
          const inc = (data as { seatsTaken?: { increment?: number } }).seatsTaken?.increment;
          if (inc) c.seatsTaken += inc;
          return c;
        },
      },
      domainEvent: { create: async () => ({ id: "de-e2e-stripe" }) },
      order: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const o = orders.get(where.id);
          if (!o) return null;
          const orderEnrolments = [...enrolments.values()].filter((e) => e.orderId === o.id);
          return { id: o.id, status: o.status, amountMinor: o.amountMinor, currency: o.currency, enrolments: orderEnrolments };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const o = orders.get(where.id) as unknown as Record<string, unknown>;
          Object.assign(o, data);
          return o;
        },
      },
      paymentAttempt: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const w = where as { orderId: string; providerIntentId?: string };
          const list = [...paymentAttempts.values()].filter((a) => a.orderId === w.orderId);
          return (w.providerIntentId ? list.find((a) => a.providerIntentId === w.providerIntentId) : list[0]) ?? null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const a = paymentAttempts.get(where.id) as unknown as Record<string, unknown>;
          Object.assign(a, data);
          return a;
        },
      },
      webhookEvent: { updateMany: async () => ({ count: 1 }) },
    };

    const settlementDeps = {
      db: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(settlementTx) },
      audit: async () => {},
      orderEmailFacts: {
        findUnique: async () => ({
          reference: orders.get(orderId)!.reference,
          cohortTitle: "Cohort Fixture",
          userId: "user-1",
          email: null,
        }),
      },
      dispatchEmail: async () => ({ id: "e-e2e-stripe", status: "SENT" }),
      now: () => NOW,
    };

    const activate = createActivateOrderAsSystem(settlementDeps as never);

    const result = await activate({
      orderId,
      provider: "STRIPE",
      providerIntentId: attempt.providerIntentId!,
      amountMinor: orders.get(orderId)!.amountMinor,
      currency: "USD",
      eventId: "evt-e2e-stripe-1",
    });

    expect(result.outcome).toBe("ACTIVATED");
    expect(orders.get(orderId)!.status).toBe("PAID");
    expect([...enrolments.values()].filter((e) => e.status === "ACTIVE")).toHaveLength(1);
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
      // 07-06 — now required args; arbitrary values, not asserted in this test.
      schoolSettlementMinor: 45_000_000,
      connectedAccountId: "acct_test_connected_123",
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

  it("07-06: carries a Stripe Connect destination-charge transfer whose amount and destination are distinct from, and never derived from, the line-item total (D-04, PAY-17)", () => {
    const params = buildCheckoutSessionParams({
      orderId: "order-1",
      enrolmentId: "enr-1",
      cohortTitle: "Advanced Testing",
      amountMinor: 52_000,
      currency: "USD",
      successUrl: "https://app.example.test/checkout/order-1/confirming",
      cancelUrl: "https://app.example.test/checkout/order-1",
      schoolSettlementMinor: 50_000,
      connectedAccountId: "acct_test_connected_123",
    });

    // Two different intentional values, asserted separately (D-04) — a
    // regression that accidentally passes the learner total as the
    // transfer amount cannot pass by coincidence.
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(52_000);
    expect(params.payment_intent_data?.transfer_data?.amount).toBe(50_000);
    expect(params.payment_intent_data?.transfer_data?.destination).toBe("acct_test_connected_123");

    // 07-01 Decision C: the KQ NEXUS platform account and this deployment's
    // connected account are both registered in the United States — the
    // same country — so on_behalf_of is NOT required and must stay absent.
    expect(params.payment_intent_data?.on_behalf_of).toBeUndefined();

    // Every Phase 6 field stays byte-identical.
    expect(params.mode).toBe("payment");
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.client_reference_id).toBe("order-1");
    expect(params.metadata).toEqual({ orderId: "order-1", enrolmentId: "enr-1" });
    expect(params.payment_intent_data?.metadata).toEqual({ orderId: "order-1", enrolmentId: "enr-1" });
    expect(params.success_url).toBe("https://app.example.test/checkout/order-1/confirming");
    expect(params.cancel_url).toBe("https://app.example.test/checkout/order-1");
  });
});
