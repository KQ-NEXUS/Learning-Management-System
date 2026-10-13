/**
 * Unit coverage for `activateOrderAsSystem`'s settlement transaction,
 * exercised against fully faked deps (no Docker, no real Postgres — the same
 * in-memory staged-commit fake `$transaction` pattern
 * `tests/checkout-service.test.ts` and `tests/enrolment-service.test.ts`
 * already use for this module's sibling services). The settlement
 * transaction's OWN correctness against a real database is proven separately
 * by `tests/checkout-webhook.integration.test.ts`.
 *
 * Plan 08 (D-07, D-02) removed this module's direct confirmation-email send
 * entirely — the checkout path now only ever writes `order.paid`/
 * `order.exception`/`enrolment.activated` outbox rows, and the Phase 13 drain
 * (proven separately, `tests/enrolment-payment-drain.integration.test.ts`)
 * is the only sender. `SettlementDeps` therefore carries no
 * `orderEmailFacts`/`dispatchEmail` member at all — a test literal that
 * tried to pass either would fail to compile (TypeScript's excess-property
 * check on an object literal assigned to a typed variable), which is this
 * file's own proof that the dependency is gone, not merely unused.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createActivateOrderAsSystem,
  createRecordSessionExpiredAsSystem,
  createMarkWebhookEventRetryable,
  createRecordWebhookEventOrSkip,
  createRecordPaymentFailureAsSystem,
  type SettlementTxClient,
  type SettlementDeps,
} from "@/server/services/checkout-webhook-system-service";

type CohortRow = { status: string; seatsTaken: number; capacity: number };

describe("recordWebhookEventOrSkip — retryable processing failures", () => {
  it("reclaims an already-recorded event whose previous processing attempt was marked retryable", async () => {
    const row = {
      provider: "PAYSTACK",
      providerEventId: "tx-1",
      status: "RECEIVED",
      error: "Webhook processing failed; awaiting provider retry.",
    };
    const create = async () => {
      throw Object.assign(new Error("duplicate"), { code: "P2002" });
    };
    const updateMany = async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (
        where.status === row.status &&
        typeof where.error === "object" &&
        where.error !== null &&
        "not" in where.error &&
        row.error !== null
      ) {
        Object.assign(row, data);
        return { count: 1 };
      }
      return { count: 0 };
    };

    const result = await createRecordWebhookEventOrSkip({
      webhookEvent: { create, updateMany },
    })({
      provider: "PAYSTACK",
      providerEventId: "tx-1",
      eventType: "charge.success",
      payload: {},
    });

    expect(result).toEqual({ isNew: true });
    expect(row).toMatchObject({ status: "DUPLICATE", error: null });
  });

  it("marks a recorded event retryable without persisting exception details", async () => {
    const calls: Array<{
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }> = [];
    const markRetryable = createMarkWebhookEventRetryable({
      webhookEvent: {
        create: async () => undefined,
        updateMany: async (args) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    });

    await expect(
      markRetryable({ provider: "PAYSTACK", providerEventId: "tx-1" }),
    ).resolves.toEqual({ marked: true });
    expect(calls).toEqual([
      {
        where: {
          provider: "PAYSTACK",
          providerEventId: "tx-1",
          status: { in: ["RECEIVED", "DUPLICATE"] },
        },
        data: {
          status: "RECEIVED",
          error: "Webhook processing failed; awaiting provider retry.",
          processedAt: null,
        },
      },
    ]);
  });
});

type EnrolmentRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: string;
  holdExpiresAt: Date | null;
  activatedAt: Date | null;
  withdrawnAt: Date | null;
  reason: string | null;
  orderId: string | null;
  transferredFromId: string | null;
};

type OrderRow = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  baseAmountMinor?: number | null;
  platformFeeMinor?: number | null;
  gatewayFeeEstimateMinor?: number | null;
  selectedProvider?: string | null;
  schoolSettlementExpectedMinor?: number | null;
  createdAt?: Date | null;
  enrolments: EnrolmentRow[];
};

type PaymentAttemptRow = {
  id: string;
  status: string;
  orderId: string;
  providerIntentId: string | null;
  providerRef?: string | null;
  provider?: string;
  confirmedAt?: Date | null;
  initiatedAt?: Date | null;
  exceptionNote?: string | null;
};

function buildHarness(args: {
  cohort: CohortRow;
  cohortId: string;
  order: OrderRow;
  attempts: PaymentAttemptRow[];
  /**
   * 07-04 Task 2 — the seeded `WebhookEvent` row's own `provider`. Defaults
   * to `"STRIPE"` (every pre-existing test in this file settles a Stripe
   * event). `webhookEvent.updateMany` below filters by BOTH `provider` AND
   * `providerEventId` — exactly like the real `@@unique([provider,
   * providerEventId])` constraint — so a test that seeds `"PAYSTACK"` but
   * calls `activateOrderAsSystem` with a mismatched `provider` proves the
   * regression a hard-coded `provider: "STRIPE"` `where` clause would cause:
   * the row's status never moves off `RECEIVED`.
   */
  webhookEventProvider?: string;
  activeEnrolmentId?: string;
}) {
  const cohorts = new Map<string, CohortRow>([[args.cohortId, args.cohort]]);
  const orders = new Map<string, OrderRow>([[args.order.id, args.order]]);
  const attempts = new Map<string, PaymentAttemptRow>(
    args.attempts.map((a) => [a.id, a]),
  );
  const webhookEvents = new Map<string, Record<string, unknown>>([
    [
      "evt-1",
      {
        provider: args.webhookEventProvider ?? "STRIPE",
        providerEventId: "evt-1",
        status: "RECEIVED",
      },
    ],
  ]);
  const domainEvents: Array<Record<string, unknown>> = [];
  const transactionOptions: Array<{ timeout?: number } | undefined> = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const rawQueries: string[] = [];

  const tx: SettlementTxClient = {
    $queryRaw: async <T = unknown>(
      strings: TemplateStringsArray,
      ...vals: unknown[]
    ): Promise<T> => {
      rawQueries.push(strings.join("?"));
      const c = cohorts.get(vals[0] as string);
      return (
        c
          ? [
              {
                status: c.status,
                seatsTaken: c.seatsTaken,
                capacity: c.capacity,
              },
            ]
          : []
      ) as T;
    },
    $executeRaw: async () => 1,
    enrolment: {
      findFirst: async () =>
        args.activeEnrolmentId ? { id: args.activeEnrolmentId } : null,
      update: async ({ where, data }) => {
        const e = args.order.enrolments.find(
          (row) => row.id === (where as { id: string }).id,
        );
        Object.assign(e as object, data);
        return e;
      },
    },
    cohort: {
      update: async ({ where, data }) => {
        const c = cohorts.get((where as { id: string }).id) as CohortRow;
        const inc = (data as { seatsTaken?: { increment?: number } }).seatsTaken
          ?.increment;
        if (inc) c.seatsTaken += inc;
        return c;
      },
    },
    domainEvent: {
      create: async ({ data }) => {
        domainEvents.push(data);
        return { id: `de-${domainEvents.length}` };
      },
    },
    order: {
      findUnique: async ({ where }) =>
        orders.get((where as { id: string }).id) ?? null,
      update: async ({ where, data }) => {
        const o = orders.get((where as { id: string }).id) as OrderRow;
        Object.assign(o, data);
        return o;
      },
    },
    paymentAttempt: {
      findFirst: async ({ where }) => {
        const w = where as { orderId: string; providerIntentId?: string };
        const list = [...attempts.values()].filter(
          (a) => a.orderId === w.orderId,
        );
        return (
          (w.providerIntentId
            ? list.find((a) => a.providerIntentId === w.providerIntentId)
            : list[0]) ?? null
        );
      },
      update: async ({ where, data }) => {
        const a = attempts.get(
          (where as { id: string }).id,
        ) as PaymentAttemptRow;
        Object.assign(a, data);
        return a;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `pa-${attempts.size + 1}`;
        const created = { id, ...data } as PaymentAttemptRow;
        attempts.set(id, created);
        return { id };
      },
    },
    webhookEvent: {
      updateMany: async ({ where, data }) => {
        const w = where as { provider?: string; providerEventId: string };
        const row = webhookEvents.get(w.providerEventId);
        if (!row || (w.provider !== undefined && row.provider !== w.provider))
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };

  const deps: SettlementDeps = {
    db: {
      $transaction: (fn, options?: { timeout?: number }) => {
        transactionOptions.push(options);
        return fn(tx);
      },
    },
    audit: async (event) => {
      auditEvents.push(event);
    },
  };

  return {
    deps,
    auditEvents,
    domainEvents,
    cohorts,
    orders,
    attempts,
    webhookEvents,
    transactionOptions,
    rawQueries,
  };
}

const BASE_ORDER_ID = "order-1";
const COHORT_ID = "cohort-1";
const SESSION_ID = "cs_test_1";

function baseEnrolment(overrides: Partial<EnrolmentRow> = {}): EnrolmentRow {
  return {
    id: "enr-1",
    userId: "user-1",
    cohortId: COHORT_ID,
    status: "PENDING_PAYMENT",
    holdExpiresAt: new Date("2026-09-10T13:00:00Z"),
    activatedAt: null,
    withdrawnAt: null,
    reason: null,
    orderId: BASE_ORDER_ID,
    transferredFromId: null,
    ...overrides,
  };
}

function baseOrder(
  enrolment: EnrolmentRow,
  overrides: Partial<OrderRow> = {},
): OrderRow {
  return {
    id: BASE_ORDER_ID,
    status: "PENDING",
    amountMinor: 45_000_000,
    currency: "NGN",
    enrolments: [enrolment],
    ...overrides,
  };
}

describe("activateOrderAsSystem — settlement writes outbox events, never dispatches email directly (D-07, D-02)", () => {
  it("locks the Order row before reading settlement state", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, rawQueries } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-order-lock",
    });

    expect(rawQueries[0]).toMatch(/FROM "Order"[\s\S]*FOR UPDATE/);
  });

  it("prepares and settles a manual confirmation inside the shared transaction", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment, {
      amountMinor: 45_875_000,
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 200_000,
      selectedProvider: "PAYSTACK",
      schoolSettlementExpectedMinor: 45_000_000,
    });
    const { deps, orders, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "MANUAL",
      providerIntentId: "BANK-REF-1",
      providerRef: "BANK-REF-1",
      amountMinor: 45_675_000,
      currency: "NGN",
      eventId: "manual:order-1:BANK-REF-1",
      manualConfirmation: {
        confirmedById: "staff-1",
        manualChannel: "bank_transfer",
        manualReference: "BANK-REF-1",
        manualPaidAt: new Date("2026-09-14T10:00:00Z"),
        manualEvidenceKey: "evidence/order-1.pdf",
        reason: "Matched against the school bank statement.",
      },
    });

    expect(result).toEqual({ outcome: "ACTIVATED" });
    expect(orders.get(BASE_ORDER_ID)).toMatchObject({
      status: "PAID",
      amountMinor: 45_675_000,
      gatewayFeeEstimateMinor: 0,
      selectedProvider: "MANUAL",
    });
    expect([...attempts.values()]).toHaveLength(1);
    expect([...attempts.values()][0]).toMatchObject({
      provider: "MANUAL",
      providerRef: "BANK-REF-1",
      status: "SUCCEEDED",
    });
  });

  it("writes the provider transaction reference when settlement succeeds", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      providerRef: "ch_test_1",
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-provider-ref",
    });

    expect(attempts.get("pa-1")?.providerRef).toBe("ch_test_1");
  });

  it("treats a manual confirmation that loses the race to online settlement as already paid", async () => {
    const enrolment = baseEnrolment({ status: "ACTIVE" });
    const order = baseOrder(enrolment, {
      status: "PAID",
      baseAmountMinor: 45_000_000,
      selectedProvider: "PAYSTACK",
    });
    const { deps, orders, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-online",
          status: "SUCCEEDED",
          orderId: BASE_ORDER_ID,
          provider: "PAYSTACK",
          providerIntentId: "paystack-reference",
          providerRef: "paystack-reference",
          confirmedAt: new Date("2026-09-14T09:59:00Z"),
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "MANUAL",
      providerIntentId: "BANK-REF-2",
      amountMinor: 45_675_000,
      currency: "NGN",
      eventId: "manual:order-1:BANK-REF-2",
      manualConfirmation: {
        confirmedById: "staff-1",
        manualChannel: "bank_transfer",
        manualReference: "BANK-REF-2",
        manualPaidAt: new Date("2026-09-14T10:00:00Z"),
        manualEvidenceKey: "evidence/order-1.pdf",
        reason: "Matched against the school bank statement.",
      },
    });

    expect(result).toMatchObject({
      outcome: "ALREADY_PAID",
      existingAttempt: {
        provider: "PAYSTACK",
        providerIntentId: "paystack-reference",
      },
    });
    expect(orders.get(BASE_ORDER_ID)).toMatchObject({
      status: "PAID",
      selectedProvider: "PAYSTACK",
    });
    expect([...attempts.values()]).toHaveLength(1);
  });

  it("gives the settlement transaction enough time to finish the full paid-order write sequence", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, transactionOptions } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-timeout-budget",
    });

    expect(transactionOptions).toEqual([{ timeout: 15_000 }]);
  });

  it("a successful settlement writes order.paid with the settled amount and currency, and touches no email dependency", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, domainEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("ACTIVATED");
    // D-07/D-02 — the checkout path only ever writes the outbox row; the
    // Phase 13 drain (proven separately) is the only sender, and
    // `SettlementDeps` above carries no email member for this test to fake.
    expect(domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.paid",
        payload: expect.objectContaining({
          orderId: BASE_ORDER_ID,
          amountMinor: 45_000_000,
          currency: "NGN",
        }),
      }),
    );
  });

  it("the Pitfall-4 exception branch (hold already expired) writes order.exception with reason illegal_transition, never touching email", async () => {
    // The enrolment is already CANCELLED (the hold-sweep worker beat the
    // webhook here) — VALID_TRANSITIONS.CANCELLED is empty, so
    // applyEnrolmentActivation throws IllegalTransitionError.
    const enrolment = baseEnrolment({
      status: "CANCELLED",
      holdExpiresAt: null,
    });
    const order = baseOrder(enrolment);
    const { deps, domainEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 0, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    // The "payment received, finishing up" mail is now the drain's own
    // enrolment-payment mapper's job (tests/enrolment-payment-drain.integration.test.ts) —
    // this module's own responsibility ends at writing the event.
    expect(domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.exception",
        payload: expect.objectContaining({
          orderId: BASE_ORDER_ID,
          reason: "illegal_transition",
        }),
      }),
    );
  });

  it("settles a successful retry after the same provider attempt was previously marked FAILED", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, orders, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "FAILED",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-retry-success",
    });

    expect(result.outcome).toBe("ACTIVATED");
    expect(orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
    expect(attempts.get("pa-1")?.status).toBe("SUCCEEDED");
    expect(enrolment.status).toBe("ACTIVE");
  });

  it("records a delayed successful payment after cancellation as SUCCEEDED plus an order exception", async () => {
    const enrolment = baseEnrolment({ status: "CANCELLED", holdExpiresAt: null });
    const order = baseOrder(enrolment);
    const { deps, orders, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 0, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "CANCELLED",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-delayed-success",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(orders.get(BASE_ORDER_ID)?.status).toBe("EXCEPTION");
    expect(attempts.get("pa-1")?.status).toBe("SUCCEEDED");
    expect(enrolment.status).toBe("CANCELLED");
  });

  it("records a controlled exception when the learner already has another ACTIVE enrolment, without activating the duplicate", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, orders, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 2, capacity: 3 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
      activeEnrolmentId: "enr-already-active",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(orders.get(BASE_ORDER_ID)?.status).toBe("EXCEPTION");
    expect(attempts.get("pa-1")).toMatchObject({
      status: "SUCCEEDED",
      exceptionNote: expect.stringContaining("already has an active enrolment"),
    });
    expect(enrolment.status).toBe("PENDING_PAYMENT");
  });

  it("an amount/currency mismatch (REG-03) writes order.exception with reason amount_or_currency_mismatch — the PaymentAttempt never reached SUCCEEDED, so 'your payment succeeded' would be false", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, domainEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 1_000, // does not match the Order's recorded amountMinor
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.exception",
        payload: expect.objectContaining({ reason: "amount_or_currency_mismatch" }),
      }),
    );
  });

  it("no matching PaymentAttempt writes order.exception with reason payment_attempt_not_found — nothing can be correlated or trusted yet", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, domainEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [], // no PaymentAttempt row at all
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.exception",
        payload: expect.objectContaining({ reason: "payment_attempt_not_found" }),
      }),
    );
  });

  it("an echo of an already-settled event writes order.exception with reason illegal_payment_transition, never a second order.paid", async () => {
    const enrolment = baseEnrolment({ status: "ACTIVE", holdExpiresAt: null });
    const order = baseOrder(enrolment, { status: "PAID" });
    const { deps, domainEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      // Already terminal — SUCCEEDED's own allow-list is empty.
      attempts: [
        {
          id: "pa-1",
          status: "SUCCEEDED",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.exception",
        payload: expect.objectContaining({ reason: "illegal_payment_transition" }),
      }),
    );
    expect(domainEvents.filter((e) => e.type === "order.paid")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 07-04 Task 2 — provider-parameterized: the generalized markWebhookEvent*
// helpers must be proven provider-aware, not just correct for Stripe. This
// is the specific regression a hard-coded `provider: "STRIPE"` `where`
// clause would cause: it would silently mark ZERO rows for a Paystack event
// (a real `updateMany` with no matching `(provider, providerEventId)` pair
// returns `count: 0` and throws nothing), leaving the row stuck RECEIVED.
// ---------------------------------------------------------------------------

describe("activateOrderAsSystem — provider-aware WebhookEvent marking (07-04)", () => {
  it("a successful PAYSTACK settlement moves the seeded PAYSTACK WebhookEvent row to PROCESSED", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, webhookEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: "ORD-REF-1",
        },
      ],
      webhookEventProvider: "PAYSTACK",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "PAYSTACK",
      providerIntentId: "ORD-REF-1",
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("ACTIVATED");
    expect(webhookEvents.get("evt-1")).toMatchObject({ status: "PROCESSED" });
  });

  it("a PAYSTACK amount/currency mismatch moves the seeded PAYSTACK WebhookEvent row to EXCEPTION and names Paystack in the note", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, webhookEvents, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: "ORD-REF-1",
        },
      ],
      webhookEventProvider: "PAYSTACK",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "PAYSTACK",
      providerIntentId: "ORD-REF-1",
      amountMinor: 1_000, // does not match the Order's recorded amountMinor
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(webhookEvents.get("evt-1")).toMatchObject({ status: "PROCESSED" });
    const attempt = attempts.get("pa-1")!;
    expect(attempt.exceptionNote).toContain("PAYSTACK");
    expect(attempt.exceptionNote).toContain("1000");
    expect(attempt.exceptionNote).toContain("45000000");
  });

  it("a PAYSTACK event with no matching Order moves the seeded PAYSTACK WebhookEvent row to EXCEPTION, never STRIPE's row", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, webhookEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [],
      webhookEventProvider: "PAYSTACK",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: "order-does-not-exist",
      provider: "PAYSTACK",
      providerIntentId: "ORD-REF-1",
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(webhookEvents.get("evt-1")).toMatchObject({ status: "EXCEPTION" });
  });

  it("a PAYSTACK settlement never marks a row seeded under a different provider (proves the where clause is provider-scoped, not a no-op default)", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, webhookEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: "ORD-REF-1",
        },
      ],
      webhookEventProvider: "STRIPE", // seeded row is STRIPE, event below claims PAYSTACK
    });

    await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "PAYSTACK",
      providerIntentId: "ORD-REF-1",
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    // The provider mismatch means updateMany matched zero rows — the seeded
    // row is left exactly as it was (RECEIVED), never silently flipped.
    expect(webhookEvents.get("evt-1")).toMatchObject({ status: "RECEIVED" });
  });
});

describe("activateOrderAsSystem — never writes the four actual-settlement columns (07-07, D-14)", () => {
  it("a successful settlement leaves gatewayFeeActualMinor/schoolSettlementActualMinor/platformGrossActualMinor/platformNetActualMinor/reconciledAt completely untouched", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
        },
      ],
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("ACTIVATED");
    // Regression guard: the most consequential mistake a future edit to this
    // file could make is writing an estimate into an "actual" column at
    // webhook/settlement time (D-14) — only 07-07's reconciliation sweep,
    // working from independently verified provider evidence, may ever write
    // these. `undefined` here means the settlement write's own `data` object
    // never mentioned the key at all, not merely that it was set to `null`.
    const attempt = attempts.get("pa-1")!;
    expect(attempt).not.toHaveProperty("gatewayFeeActualMinor");
    expect(attempt).not.toHaveProperty("schoolSettlementActualMinor");
    expect(attempt).not.toHaveProperty("platformGrossActualMinor");
    expect(attempt).not.toHaveProperty("platformNetActualMinor");
    expect(attempt).not.toHaveProperty("reconciledAt");
  });
});

// ---------------------------------------------------------------------------
// F-16 — a settled order is never downgraded by a late or duplicate payment
// ---------------------------------------------------------------------------

describe("F-16 — settled orders stay settled; extra money is flagged, not the order", () => {
  function paidSetup(extraAttempt: PaymentAttemptRow) {
    const enrolment = baseEnrolment({ status: "ACTIVE", holdExpiresAt: null, activatedAt: new Date("2026-09-10T11:00:00Z") });
    const order = baseOrder(enrolment, { status: "PAID" });
    return buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 2, capacity: 3 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        { id: "pa-1", status: "SUCCEEDED", orderId: BASE_ORDER_ID, providerIntentId: SESSION_ID, provider: "STRIPE" },
        extraAttempt,
      ],
    });
  }

  it("a second successful payment on a PAID order keeps the order PAID and flags the duplicate attempt", async () => {
    const h = paidSetup({ id: "pa-2", status: "CANCELLED", orderId: BASE_ORDER_ID, providerIntentId: "cs_test_2", provider: "STRIPE" });
    const result = await createActivateOrderAsSystem(h.deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: "cs_test_2",
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });
    expect(result.outcome).toBe("EXCEPTION");
    expect(h.orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
    expect(h.attempts.get("pa-2")).toMatchObject({
      status: "SUCCEEDED",
      exceptionNote: expect.stringContaining("already paid"),
    });
    expect(h.domainEvents).toContainEqual(
      expect.objectContaining({ type: "order.exception", payload: expect.objectContaining({ reason: "duplicate_payment_on_settled_order" }) }),
    );
  });

  it("an amount mismatch reported against a PAID order leaves the order PAID", async () => {
    const h = paidSetup({ id: "pa-2", status: "PROCESSING", orderId: BASE_ORDER_ID, providerIntentId: "cs_test_2", provider: "STRIPE" });
    await createActivateOrderAsSystem(h.deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: "cs_test_2",
      amountMinor: 1,
      currency: "NGN",
      eventId: "evt-1",
    });
    expect(h.orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
  });

  it("an unmatched settlement against a PAID order leaves the order PAID", async () => {
    const h = paidSetup({ id: "pa-2", status: "PROCESSING", orderId: BASE_ORDER_ID, providerIntentId: "cs_test_2", provider: "STRIPE" });
    await createActivateOrderAsSystem(h.deps)({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: "cs_unknown",
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });
    expect(h.orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
  });

  it("Stripe's expiry webhook for an attempt we already retired is a quiet no-op", async () => {
    const enrolment = baseEnrolment();
    const h = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 2, capacity: 3 },
      cohortId: COHORT_ID,
      order: baseOrder(enrolment),
      attempts: [{ id: "pa-1", status: "CANCELLED", orderId: BASE_ORDER_ID, providerIntentId: SESSION_ID, provider: "STRIPE" }],
    });
    const result = await createRecordSessionExpiredAsSystem(h.deps)({
      orderId: BASE_ORDER_ID,
      providerIntentId: SESSION_ID,
      eventId: "evt-1",
    });
    expect(result.outcome).toBe("CANCELLED");
    expect(h.domainEvents.filter((e) => e.type === "order.exception")).toEqual([]);
  });
});

describe("recordPaymentFailureAsSystem — payment.failed outbox event (D-09)", () => {
  it("writes exactly one payment.failed event, on the same transaction as the FAILED update, with orderId/paymentAttemptId/provider only", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, domainEvents, attempts } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
          provider: "STRIPE",
        },
      ],
    });

    const result = await createRecordPaymentFailureAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      eventId: "evt-payment-failed-1",
      providerIntentId: SESSION_ID,
      failureReason: "card_declined",
    });

    expect(result.outcome).toBe("FAILED");
    expect(attempts.get("pa-1")?.status).toBe("FAILED");
    expect(domainEvents).toContainEqual(
      expect.objectContaining({
        type: "payment.failed",
        payload: expect.objectContaining({
          orderId: BASE_ORDER_ID,
          paymentAttemptId: "pa-1",
          provider: "STRIPE",
        }),
      }),
    );
    // T-13-03 — the provider failure reason never reaches the outbox payload.
    expect(JSON.stringify(domainEvents)).not.toContain("card_declined");
  });

  it("an illegal-transition failure (already SUCCEEDED) writes order.exception and no payment.failed event", async () => {
    const enrolment = baseEnrolment({ status: "ACTIVE", holdExpiresAt: null });
    const order = baseOrder(enrolment, { status: "PAID" });
    const { deps, domainEvents } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "SUCCEEDED",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
          provider: "STRIPE",
        },
      ],
    });

    const result = await createRecordPaymentFailureAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      eventId: "evt-payment-failed-2",
      providerIntentId: SESSION_ID,
      failureReason: "late_failure_echo",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(domainEvents.some((e) => e.type === "payment.failed")).toBe(false);
    expect(domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.exception",
        payload: expect.objectContaining({ reason: "illegal_payment_transition" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 14 (D-08) - the initiated-before rule for restricted continuity mode
// ---------------------------------------------------------------------------

describe("activateOrderAsSystem - D-08 initiated-before rule (Phase 14)", () => {
  // The restriction instant R (graceEndsAt for a time-derived restriction).
  const R = new Date("2026-10-01T12:00:00.000Z");
  const TOLERANCE_MS = 600_000;
  const at = (offsetMs: number) => new Date(R.getTime() + offsetMs);

  function restrictedLicence() {
    return {
      getRestrictionCutoff: vi.fn(async () => ({
        restricted: true,
        restrictedAt: R,
      })),
    };
  }

  function webhookSetup(attemptInitiatedAt: Date | undefined, orderStatus = "PENDING") {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment, { status: orderStatus });
    const h = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
          provider: "STRIPE",
          ...(attemptInitiatedAt ? { initiatedAt: attemptInitiatedAt } : {}),
        },
      ],
    });
    return { ...h, enrolment };
  }

  const settleInput = {
    orderId: BASE_ORDER_ID,
    provider: "STRIPE" as const,
    providerIntentId: SESSION_ID,
    amountMinor: 45_000_000,
    currency: "NGN",
    eventId: "evt-1",
  };

  it("activates an attempt initiated one hour before the restriction instant", async () => {
    const h = webhookSetup(at(-3_600_000));
    const licence = restrictedLicence();
    const result = await createActivateOrderAsSystem({ ...h.deps, licence })(settleInput);

    expect(result.outcome).toBe("ACTIVATED");
    expect(h.enrolment.status).toBe("ACTIVE");
    expect(h.attempts.get("pa-1")?.status).toBe("SUCCEEDED");
    expect(h.orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
    // Activation converts the held seat; the counter itself does not move.
    expect(h.cohorts.get(COHORT_ID)?.seatsTaken).toBe(1);
    expect(licence.getRestrictionCutoff).toHaveBeenCalledTimes(1);
  });

  it("tolerance boundary: initiatedAt at restrictedAt plus 10 minutes activates, plus 1 ms becomes the payment_after_restriction exception", async () => {
    const onBoundary = webhookSetup(at(TOLERANCE_MS));
    const ok = await createActivateOrderAsSystem({
      ...onBoundary.deps,
      licence: restrictedLicence(),
    })(settleInput);
    expect(ok.outcome).toBe("ACTIVATED");
    expect(onBoundary.enrolment.status).toBe("ACTIVE");

    const beyond = webhookSetup(at(TOLERANCE_MS + 1));
    const syncs: Array<Record<string, unknown>> = [];
    const result = await createActivateOrderAsSystem({
      ...beyond.deps,
      licence: restrictedLicence(),
      syncOrderReconciliationEvidence: (async (args: Record<string, unknown>) => {
        syncs.push(args);
      }) as unknown as SettlementDeps["syncOrderReconciliationEvidence"],
    })(settleInput);

    expect(result.outcome).toBe("EXCEPTION");
    // The money is recorded, never lost.
    expect(beyond.attempts.get("pa-1")).toMatchObject({
      status: "SUCCEEDED",
      exceptionNote: expect.stringContaining("needs reconciliation"),
    });
    expect(beyond.attempts.get("pa-1")?.confirmedAt).toBeInstanceOf(Date);
    expect(beyond.orders.get(BASE_ORDER_ID)?.status).toBe("EXCEPTION");
    // No enrolment activation and no seat movement.
    expect(beyond.enrolment.status).toBe("PENDING_PAYMENT");
    expect(beyond.cohorts.get(COHORT_ID)?.seatsTaken).toBe(1);
    expect(beyond.rawQueries.filter((q) => /FROM "Cohort"/.test(q))).toEqual([]);
    expect(beyond.domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.exception",
        payload: expect.objectContaining({
          orderId: BASE_ORDER_ID,
          reason: "payment_after_restriction",
        }),
      }),
    );
    expect(beyond.domainEvents.some((e) => e.type === "order.paid")).toBe(false);
    expect(beyond.auditEvents).toContainEqual(
      expect.objectContaining({ action: "order.exception", targetId: BASE_ORDER_ID }),
    );
    expect(syncs).toHaveLength(1);
    expect(syncs[0]).toMatchObject({
      orderId: BASE_ORDER_ID,
      risk: "CAPTURED_MONEY",
      evidence: expect.objectContaining({ reason: "payment_after_restriction" }),
    });
  });

  it("an already-settled order is not downgraded by a payment after restriction", async () => {
    const h = webhookSetup(at(TOLERANCE_MS + 1), "PAID");
    const result = await createActivateOrderAsSystem({
      ...h.deps,
      licence: restrictedLicence(),
    })(settleInput);
    expect(result.outcome).toBe("EXCEPTION");
    expect(h.orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
    expect(h.attempts.get("pa-1")?.status).toBe("SUCCEEDED");
  });

  it("not restricted: behaves exactly as before for any date, with or without a licence dependency", async () => {
    const farFuture = at(10 * 365 * 86_400_000);

    const withLicence = webhookSetup(farFuture);
    const notRestricted = {
      getRestrictionCutoff: vi.fn(async () => ({
        restricted: false,
        restrictedAt: null,
      })),
    };
    const a = await createActivateOrderAsSystem({
      ...withLicence.deps,
      licence: notRestricted,
    })(settleInput);
    expect(a.outcome).toBe("ACTIVATED");

    const withoutLicence = webhookSetup(farFuture);
    const b = await createActivateOrderAsSystem(withoutLicence.deps)(settleInput);
    expect(b.outcome).toBe("ACTIVATED");
    expect(withoutLicence.orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
  });

  it("a restricted cutoff without a restrictedAt instant applies no rule (fail open)", async () => {
    const h = webhookSetup(at(86_400_000));
    const result = await createActivateOrderAsSystem({
      ...h.deps,
      licence: {
        getRestrictionCutoff: async () => ({ restricted: true, restrictedAt: null }),
      },
    })(settleInput);
    expect(result.outcome).toBe("ACTIVATED");
  });

  it("T-14-13-03: a rejecting cutoff read is treated as not restricted and the order activates", async () => {
    const h = webhookSetup(at(86_400_000));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await createActivateOrderAsSystem({
        ...h.deps,
        licence: {
          getRestrictionCutoff: async () => {
            throw new Error("licence read unavailable");
          },
        },
      })(settleInput);
      expect(result.outcome).toBe("ACTIVATED");
      expect(h.orders.get(BASE_ORDER_ID)?.status).toBe("PAID");
      // The failure is logged by name only, never the message.
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("licence read unavailable");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("an attempt row without initiatedAt (older fakes) is treated as before the cutoff", async () => {
    const h = webhookSetup(undefined);
    const result = await createActivateOrderAsSystem({
      ...h.deps,
      licence: restrictedLicence(),
    })(settleInput);
    expect(result.outcome).toBe("ACTIVATED");
  });

  it("the cutoff is read once, before the transaction opens", async () => {
    const h = webhookSetup(at(-60_000));
    const order: string[] = [];
    const licence = {
      getRestrictionCutoff: vi.fn(async () => {
        order.push("cutoff");
        return { restricted: true, restrictedAt: R };
      }),
    };
    const wrapped: SettlementDeps = {
      ...h.deps,
      licence,
      db: {
        $transaction: (fn, options) => {
          order.push("transaction");
          return h.deps.db.$transaction(fn, options);
        },
      },
    };
    await createActivateOrderAsSystem(wrapped)(settleInput);
    expect(order).toEqual(["cutoff", "transaction"]);
  });

  it("recordPaymentFailureAsSystem and recordSessionExpiredAsSystem never consult the licence dependency", async () => {
    const licence = restrictedLicence();

    const failing = webhookSetup(at(86_400_000));
    const failed = await createRecordPaymentFailureAsSystem({
      ...failing.deps,
      licence,
    })({
      orderId: BASE_ORDER_ID,
      eventId: "evt-1",
      providerIntentId: SESSION_ID,
      failureReason: "card_declined",
    });
    expect(failed.outcome).toBe("FAILED");

    const expiring = webhookSetup(at(86_400_000));
    const expired = await createRecordSessionExpiredAsSystem({
      ...expiring.deps,
      licence,
    })({
      orderId: BASE_ORDER_ID,
      providerIntentId: SESSION_ID,
      eventId: "evt-1",
    });
    expect(expired.outcome).toBe("CANCELLED");

    expect(licence.getRestrictionCutoff).not.toHaveBeenCalled();
  });
});

describe("activateOrderAsSystem - D-08 manual confirmation anchor (OQ4, A13)", () => {
  const R = new Date("2026-10-01T12:00:00.000Z");
  const TOLERANCE_MS = 600_000;
  const at = (offsetMs: number) => new Date(R.getTime() + offsetMs);

  const licence = () => ({
    getRestrictionCutoff: async () => ({ restricted: true, restrictedAt: R }),
  });

  function manualSetup(orderCreatedAt: Date) {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment, {
      amountMinor: 45_875_000,
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 200_000,
      selectedProvider: "PAYSTACK",
      schoolSettlementExpectedMinor: 45_000_000,
      createdAt: orderCreatedAt,
    });
    const h = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [],
    });
    return { ...h, enrolment };
  }

  const manualInput = {
    orderId: BASE_ORDER_ID,
    provider: "MANUAL" as const,
    providerIntentId: "BANK-REF-1",
    providerRef: "BANK-REF-1",
    amountMinor: 45_675_000,
    currency: "NGN",
    eventId: "manual:order-1:BANK-REF-1",
    manualConfirmation: {
      confirmedById: "staff-1",
      manualChannel: "bank_transfer",
      manualReference: "BANK-REF-1",
      manualPaidAt: new Date("2026-10-01T10:00:00Z"),
      manualEvidenceKey: "evidence/order-1.pdf",
      reason: "Matched against the school bank statement.",
    },
  };

  it("an order created one day before the restriction is confirmed and activated", async () => {
    const h = manualSetup(at(-86_400_000));
    const result = await createActivateOrderAsSystem({
      ...h.deps,
      licence: licence(),
    })(manualInput);
    expect(result.outcome).toBe("ACTIVATED");
    expect(h.enrolment.status).toBe("ACTIVE");
    expect([...h.attempts.values()]).toHaveLength(1);
  });

  it("an order created at restrictedAt plus 10 minutes plus 1 ms becomes the exception, with the manual evidence intact", async () => {
    const h = manualSetup(at(TOLERANCE_MS + 1));
    const result = await createActivateOrderAsSystem({
      ...h.deps,
      licence: licence(),
    })(manualInput);

    expect(result.outcome).toBe("EXCEPTION");
    const attempts = [...h.attempts.values()];
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      provider: "MANUAL",
      status: "SUCCEEDED",
      providerRef: "BANK-REF-1",
      manualChannel: "bank_transfer",
      manualReference: "BANK-REF-1",
      manualEvidenceKey: "evidence/order-1.pdf",
      confirmedById: "staff-1",
      reason: "Matched against the school bank statement.",
    });
    expect(h.orders.get(BASE_ORDER_ID)?.status).toBe("EXCEPTION");
    expect(h.enrolment.status).toBe("PENDING_PAYMENT");
    expect(h.cohorts.get(COHORT_ID)?.seatsTaken).toBe(1);
    expect(h.domainEvents).toContainEqual(
      expect.objectContaining({
        type: "order.exception",
        payload: expect.objectContaining({ reason: "payment_after_restriction" }),
      }),
    );
    expect(h.auditEvents).toContainEqual(
      expect.objectContaining({ action: "order.exception_manual" }),
    );
  });

  it("an order created exactly at restrictedAt plus 10 minutes is still confirmed", async () => {
    const h = manualSetup(at(TOLERANCE_MS));
    const result = await createActivateOrderAsSystem({
      ...h.deps,
      licence: licence(),
    })(manualInput);
    expect(result.outcome).toBe("ACTIVATED");
  });

  it("the anchor differs by rail: an old order with a fresh manual attempt activates, a fresh webhook attempt on the same old order is judged by its own initiatedAt", async () => {
    // Manual: the attempt is created inside the transaction (initiatedAt is
    // "now", after R), but the Order is old, so it activates.
    const manual = manualSetup(at(-86_400_000));
    const m = await createActivateOrderAsSystem({
      ...manual.deps,
      licence: licence(),
    })(manualInput);
    expect(m.outcome).toBe("ACTIVATED");

    // Webhook rail: the Order is old but the attempt was initiated after the
    // cutoff plus tolerance, so the attempt's own timestamp decides.
    const enrolment = baseEnrolment();
    const web = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order: baseOrder(enrolment, { createdAt: at(-86_400_000) }),
      attempts: [
        {
          id: "pa-1",
          status: "PROCESSING",
          orderId: BASE_ORDER_ID,
          providerIntentId: SESSION_ID,
          provider: "STRIPE",
          initiatedAt: at(TOLERANCE_MS + 1),
        },
      ],
    });
    const w = await createActivateOrderAsSystem({
      ...web.deps,
      licence: licence(),
    })({
      orderId: BASE_ORDER_ID,
      provider: "STRIPE",
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });
    expect(w.outcome).toBe("EXCEPTION");
    expect(web.orders.get(BASE_ORDER_ID)?.status).toBe("EXCEPTION");
  });
});
