/**
 * Plan 06-08 Task 1 — unit coverage for the confirmation-email dispatch
 * `activateOrderAsSystem` performs after settlement, exercised against fully
 * faked deps (no Docker, no real Postgres — the same in-memory staged-commit
 * fake `$transaction` pattern `tests/checkout-service.test.ts` and
 * `tests/enrolment-service.test.ts` already use for this module's sibling
 * services). The settlement transaction's OWN correctness against a real
 * database is proven separately by `tests/checkout-webhook.integration.test.ts`.
 *
 * Why this file exists alongside that one: `EmailDispatch` has no body
 * column (see `email-dispatch-service.ts`'s own row shape — `template`,
 * `toEmail`, `status`, timestamps, but never `textContent`), so a real-DB
 * assertion can prove a row was created but cannot prove what the email
 * SAYS. This file captures the exact `DispatchParams` passed to
 * `dispatchEmail` instead, so the plan's own transparency prohibition — the
 * exception-branch body never claims enrolment — has a direct, deterministic
 * assertion rather than an inferred one.
 */
import { describe, expect, it } from "vitest";
import {
  createActivateOrderAsSystem,
  createMarkWebhookEventRetryable,
  createRecordWebhookEventOrSkip,
  type SettlementTxClient,
  type SettlementDeps,
  type OrderEmailFacts,
} from "@/server/services/checkout-webhook-system-service";
import type { DispatchParams } from "@/server/services/email-dispatch-service";

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
  enrolments: EnrolmentRow[];
};

type PaymentAttemptRow = {
  id: string;
  status: string;
  orderId: string;
  providerIntentId: string | null;
  exceptionNote?: string | null;
};

function buildHarness(args: {
  cohort: CohortRow;
  cohortId: string;
  order: OrderRow;
  attempts: PaymentAttemptRow[];
  email: string | null;
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
  const dispatchCalls: DispatchParams[] = [];

  const tx: SettlementTxClient = {
    $queryRaw: async <T = unknown>(
      _s: TemplateStringsArray,
      ...vals: unknown[]
    ): Promise<T> => {
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
    orderEmailFacts: {
      findUnique: async ({ where }) => {
        const o = orders.get(where.id);
        if (!o) return null;
        const facts: OrderEmailFacts = {
          reference: `ORD-${o.id}`,
          cohortTitle: "Advanced Testing",
          userId: o.enrolments[0]?.userId ?? "user-unknown",
          email: args.email,
        };
        return facts;
      },
    },
    dispatchEmail: async (params) => {
      dispatchCalls.push(params);
      return { id: "ed-1", status: "SENT" };
    },
    baseUrl: () => "https://app.example.test",
    now: () => new Date("2026-09-10T12:00:00Z"),
  };

  return {
    deps,
    dispatchCalls,
    auditEvents,
    domainEvents,
    orders,
    attempts,
    webhookEvents,
    transactionOptions,
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

describe("activateOrderAsSystem — confirmation email dispatch (D-18)", () => {
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
      email: "learner@example.test",
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

  it("a successful settlement dispatches exactly one confirmation email naming the reference, cohort, amount and receipt link", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
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
      email: "learner@example.test",
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
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].template).toBe("order-confirmation");
    expect(dispatchCalls[0].toEmail).toBe("learner@example.test");
    expect(dispatchCalls[0].userId).toBe("user-1");
    expect(dispatchCalls[0].textContent).toContain("ORD-order-1");
    expect(dispatchCalls[0].textContent).toContain("Advanced Testing");
    expect(dispatchCalls[0].textContent).toContain(
      "https://app.example.test/orders/ORD-order-1",
    );
    // Never a secret, a raw Stripe object, or a raw provider error string.
    expect(dispatchCalls[0].textContent).not.toMatch(/sk_|whsec_|pi_|cs_test_/);
  });

  it("skips dispatch entirely when the order's owner has no email on file, without changing the settlement outcome", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
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
      email: null,
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
    expect(dispatchCalls).toHaveLength(0);
  });

  it("the Pitfall-4 exception branch (hold already expired) dispatches exactly one email that never claims enrolment", async () => {
    // The enrolment is already CANCELLED (the hold-sweep worker beat the
    // webhook here) — VALID_TRANSITIONS.CANCELLED is empty, so
    // applyEnrolmentActivation throws IllegalTransitionError.
    const enrolment = baseEnrolment({
      status: "CANCELLED",
      holdExpiresAt: null,
    });
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
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
      email: "learner@example.test",
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
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].template).toBe("order-payment-exception");
    expect(dispatchCalls[0].subject).not.toMatch(/enroll/i);
    // The transparency prohibition, directly: the body must never use
    // success-framing enrolment language for a seat that is not ACTIVE.
    expect(dispatchCalls[0].textContent).not.toMatch(/enroll(ed|ment)?/i);
    expect(dispatchCalls[0].textContent).toContain("no action is needed");
    expect(dispatchCalls[0].textContent).toContain("ORD-order-1");
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
      email: "learner@example.test",
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
      email: "learner@example.test",
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
      email: "learner@example.test",
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

  it("an amount/currency mismatch (REG-03) never dispatches — the PaymentAttempt never reached SUCCEEDED, so 'your payment succeeded' would be false", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
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
      email: "learner@example.test",
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
    expect(dispatchCalls).toHaveLength(0);
  });

  it("no matching PaymentAttempt never dispatches — nothing can be correlated or trusted yet", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [], // no PaymentAttempt row at all
      email: "learner@example.test",
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
    expect(dispatchCalls).toHaveLength(0);
  });

  it("an echo of an already-settled event (illegal payment transition) never dispatches a second copy", async () => {
    const enrolment = baseEnrolment({ status: "ACTIVE", holdExpiresAt: null });
    const order = baseOrder(enrolment, { status: "PAID" });
    const { deps, dispatchCalls } = buildHarness({
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
      email: "learner@example.test",
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
    expect(dispatchCalls).toHaveLength(0);
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
      email: null,
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
      email: null,
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
      email: null,
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
      email: null,
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
      email: null,
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
