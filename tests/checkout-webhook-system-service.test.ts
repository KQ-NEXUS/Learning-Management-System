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
  type SettlementTxClient,
  type SettlementDeps,
  type OrderEmailFacts,
} from "@/server/services/checkout-webhook-system-service";
import type { DispatchParams } from "@/server/services/email-dispatch-service";

type CohortRow = { status: string; seatsTaken: number; capacity: number };

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
};

function buildHarness(args: {
  cohort: CohortRow;
  cohortId: string;
  order: OrderRow;
  attempts: PaymentAttemptRow[];
  email: string | null;
}) {
  const cohorts = new Map<string, CohortRow>([[args.cohortId, args.cohort]]);
  const orders = new Map<string, OrderRow>([[args.order.id, args.order]]);
  const attempts = new Map<string, PaymentAttemptRow>(args.attempts.map((a) => [a.id, a]));
  const webhookEvents = new Map<string, Record<string, unknown>>([
    ["evt-1", { providerEventId: "evt-1", status: "RECEIVED" }],
  ]);
  const domainEvents: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const dispatchCalls: DispatchParams[] = [];

  const tx: SettlementTxClient = {
    $queryRaw: async <T = unknown>(_s: TemplateStringsArray, ...vals: unknown[]): Promise<T> => {
      const c = cohorts.get(vals[0] as string);
      return (c ? [{ status: c.status, seatsTaken: c.seatsTaken, capacity: c.capacity }] : []) as T;
    },
    $executeRaw: async () => 1,
    enrolment: {
      update: async ({ where, data }) => {
        const e = args.order.enrolments.find((row) => row.id === (where as { id: string }).id);
        Object.assign(e as object, data);
        return e;
      },
    },
    cohort: {
      update: async ({ where, data }) => {
        const c = cohorts.get((where as { id: string }).id) as CohortRow;
        const inc = (data as { seatsTaken?: { increment?: number } }).seatsTaken?.increment;
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
      findUnique: async ({ where }) => orders.get((where as { id: string }).id) ?? null,
      update: async ({ where, data }) => {
        const o = orders.get((where as { id: string }).id) as OrderRow;
        Object.assign(o, data);
        return o;
      },
    },
    paymentAttempt: {
      findFirst: async ({ where }) => {
        const w = where as { orderId: string; providerIntentId?: string };
        const list = [...attempts.values()].filter((a) => a.orderId === w.orderId);
        return (
          (w.providerIntentId ? list.find((a) => a.providerIntentId === w.providerIntentId) : list[0]) ?? null
        );
      },
      update: async ({ where, data }) => {
        const a = attempts.get((where as { id: string }).id) as PaymentAttemptRow;
        Object.assign(a, data);
        return a;
      },
    },
    webhookEvent: {
      updateMany: async ({ where, data }) => {
        const w = where as { providerEventId: string };
        const row = webhookEvents.get(w.providerEventId);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };

  const deps: SettlementDeps = {
    db: { $transaction: (fn) => fn(tx) },
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

  return { deps, dispatchCalls, auditEvents, domainEvents, orders, attempts };
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

function baseOrder(enrolment: EnrolmentRow, overrides: Partial<OrderRow> = {}): OrderRow {
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
  it("a successful settlement dispatches exactly one confirmation email naming the reference, cohort, amount and receipt link", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [{ id: "pa-1", status: "PROCESSING", orderId: BASE_ORDER_ID, providerIntentId: SESSION_ID }],
      email: "learner@example.test",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
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
    expect(dispatchCalls[0].textContent).toContain("https://app.example.test/orders/ORD-order-1");
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
      attempts: [{ id: "pa-1", status: "PROCESSING", orderId: BASE_ORDER_ID, providerIntentId: SESSION_ID }],
      email: null,
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
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
    const enrolment = baseEnrolment({ status: "CANCELLED", holdExpiresAt: null });
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 0, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [{ id: "pa-1", status: "PROCESSING", orderId: BASE_ORDER_ID, providerIntentId: SESSION_ID }],
      email: "learner@example.test",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
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

  it("an amount/currency mismatch (REG-03) never dispatches — the PaymentAttempt never reached SUCCEEDED, so 'your payment succeeded' would be false", async () => {
    const enrolment = baseEnrolment();
    const order = baseOrder(enrolment);
    const { deps, dispatchCalls } = buildHarness({
      cohort: { status: "PUBLISHED", seatsTaken: 1, capacity: 2 },
      cohortId: COHORT_ID,
      order,
      attempts: [{ id: "pa-1", status: "PROCESSING", orderId: BASE_ORDER_ID, providerIntentId: SESSION_ID }],
      email: "learner@example.test",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
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
      attempts: [{ id: "pa-1", status: "SUCCEEDED", orderId: BASE_ORDER_ID, providerIntentId: SESSION_ID }],
      email: "learner@example.test",
    });

    const result = await createActivateOrderAsSystem(deps)({
      orderId: BASE_ORDER_ID,
      providerIntentId: SESSION_ID,
      amountMinor: 45_000_000,
      currency: "NGN",
      eventId: "evt-1",
    });

    expect(result.outcome).toBe("EXCEPTION");
    expect(dispatchCalls).toHaveLength(0);
  });
});
