/**
 * Plan 07-04 Task 1: the Paystack adapter (`providers/paystack/{client,initialize,webhook}.ts`).
 *
 * Covers the D-25 worked-example initialize request shape, the
 * USD-rejection-before-network case, and signature verification
 * accept/reject — no real network call is made anywhere in this file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildInitializeTransactionRequest,
  initiatePaystackTransaction,
  NonNgnPaystackInitiationError,
  type PaystackInitiationInput,
} from "@/server/payments/providers/paystack/initialize";
import {
  verifyPaystackWebhook,
  PaystackSignatureError,
} from "@/server/payments/providers/paystack/webhook";

// 07-04 Task 2 — the webhook ROUTE's own settlement calls are mocked so this
// file never touches the real `prisma` singleton `checkout-webhook-system-
// service.ts` binds to at import time; the route's actual control flow
// (raw-body-first, signature verification, Verify Transaction cross-check,
// PAY-10 delegation) is exercised for real against these mocks.
const settlementMocks = vi.hoisted(() => ({
  recordWebhookEventOrSkip: vi.fn(),
  markWebhookEventRetryable: vi.fn(),
  activateOrderAsSystem: vi.fn(),
}));
vi.mock("@/server/services/checkout-webhook-system-service", () => ({
  recordWebhookEventOrSkip: settlementMocks.recordWebhookEventOrSkip,
  markWebhookEventRetryable: settlementMocks.markWebhookEventRetryable,
  activateOrderAsSystem: settlementMocks.activateOrderAsSystem,
}));

const ENV_KEYS = ["PAYSTACK_SECRET_KEY", "PAYSTACK_SUBACCOUNT_CODE"] as const;
const originalEnv: Partial<
  Record<(typeof ENV_KEYS)[number], string | undefined>
> = {};

function setEnv() {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture_secret";
  process.env.PAYSTACK_SUBACCOUNT_CODE = "ACCT_fixture_subaccount";
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.unstubAllGlobals();
});

/** The D-25 worked example: base 45_000_000 -> platformFee 675_000, gatewayFeeEstimate 200_000, total 45_875_000. */
const D25_INPUT: PaystackInitiationInput = {
  orderId: "order-1",
  orderReference: "ORD-20260910-ABCD1234",
  enrolmentId: "enr-1",
  learnerEmail: "learner@example.test",
  currency: "NGN",
  amountMinor: 45_875_000,
  platformFeeMinor: 675_000,
  gatewayFeeEstimateMinor: 200_000,
  callbackUrl: "https://app.example.test/checkout/order-1/confirming",
};

describe("buildInitializeTransactionRequest — D-25 worked example", () => {
  it("carries amount 45_875_000, transaction_charge 875_000, bearer 'account', the subaccount code, currency 'NGN' explicitly, and the order's own reference", () => {
    setEnv();
    const request = buildInitializeTransactionRequest(D25_INPUT);

    expect(request.amount).toBe(45_875_000);
    expect(request.transaction_charge).toBe(875_000);
    expect(request.bearer).toBe("account");
    expect(request.subaccount).toBe("ACCT_fixture_subaccount");
    expect(request.currency).toBe("NGN");
    expect(request.reference).toBe("ORD-20260910-ABCD1234");
    expect(request.email).toBe("learner@example.test");
    expect(request.callback_url).toBe(
      "https://app.example.test/checkout/order-1/confirming",
    );
    expect(request.metadata).toEqual({
      orderId: "order-1",
      enrolmentId: "enr-1",
    });
  });

  it("passes currency explicitly rather than omitting it (D-07 defense in depth)", () => {
    setEnv();
    const request = buildInitializeTransactionRequest(D25_INPUT);
    expect("currency" in request).toBe(true);
    expect(request.currency).not.toBeUndefined();
  });
});

describe("initiatePaystackTransaction — USD rejection before any network call", () => {
  it("throws NonNgnPaystackInitiationError and never calls fetch for a non-NGN input", async () => {
    setEnv();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      initiatePaystackTransaction({ ...D25_INPUT, currency: "USD" }),
    ).rejects.toBeInstanceOf(NonNgnPaystackInitiationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the built request and returns { redirectUrl, providerIntentId } from Paystack's own authorization_url/reference on a valid NGN input", async () => {
    setEnv();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: "Authorization URL created",
        data: {
          authorization_url: "https://checkout.paystack.com/abc123",
          access_code: "abc123",
          reference: "ORD-20260910-ABCD1234",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await initiatePaystackTransaction(D25_INPUT);

    expect(result).toEqual({
      redirectUrl: "https://checkout.paystack.com/abc123",
      providerIntentId: "ORD-20260910-ABCD1234",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_test_fixture_secret");
    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(45_875_000);
    expect(body.transaction_charge).toBe(875_000);
  });
});

describe("verifyPaystackWebhook — accept/reject", () => {
  const SECRET = "whsec_fixture_paystack_secret";
  const BODY = JSON.stringify({
    event: "charge.success",
    data: { id: 1, reference: "ORD-1", status: "success" },
  });

  function sign(body: string, secret: string): string {
    return createHmac("sha512", secret).update(body).digest("hex");
  }

  it("accepts a signature computed with the correct secret over the exact raw body, and returns the parsed JSON", () => {
    const signature = sign(BODY, SECRET);
    const parsed = verifyPaystackWebhook(BODY, signature, SECRET);
    expect(parsed).toEqual(JSON.parse(BODY));
  });

  it("rejects a missing signature header", () => {
    expect(() => verifyPaystackWebhook(BODY, null, SECRET)).toThrow(
      PaystackSignatureError,
    );
  });

  it("rejects when the secret is undefined (misconfiguration)", () => {
    const signature = sign(BODY, SECRET);
    expect(() => verifyPaystackWebhook(BODY, signature, undefined)).toThrow(
      PaystackSignatureError,
    );
  });

  it("rejects a signature computed with the wrong secret", () => {
    const signature = sign(BODY, "a-completely-different-secret");
    expect(() => verifyPaystackWebhook(BODY, signature, SECRET)).toThrow(
      PaystackSignatureError,
    );
  });

  it("rejects a signature computed over a mutated body — the raw body is verified, not a re-serialized parse", () => {
    const signature = sign(BODY, SECRET);
    const mutatedBody = JSON.stringify({
      event: "charge.success",
      data: {
        id: 1,
        reference: "ORD-1",
        status: "success",
        amount: 999_999_999,
      },
    });
    expect(() => verifyPaystackWebhook(mutatedBody, signature, SECRET)).toThrow(
      PaystackSignatureError,
    );
  });

  it("rejects a signature of a different length than the computed one without throwing an unrelated error", () => {
    expect(() => verifyPaystackWebhook(BODY, "short", SECRET)).toThrow(
      PaystackSignatureError,
    );
  });

  it("uses HMAC-SHA512, not SHA-256 — a SHA-256 signature over the same body/secret is rejected", () => {
    const sha256Signature = createHmac("sha256", SECRET)
      .update(BODY)
      .digest("hex");
    expect(() => verifyPaystackWebhook(BODY, sha256Signature, SECRET)).toThrow(
      PaystackSignatureError,
    );
  });
});

// ---------------------------------------------------------------------------
// 07-04 Task 2 — the webhook route: replay safety, transaction verification,
// honest exceptions. `recordWebhookEventOrSkip`/`activateOrderAsSystem` are
// mocked (see the top of this file); signature verification and the Verify
// Transaction cross-check run for real.
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/paystack — replay safety, transaction verification, honest exceptions", () => {
  const ROUTE_SECRET = "sk_test_route_fixture_secret";

  function sign(body: string, secret: string): string {
    return createHmac("sha512", secret).update(body).digest("hex");
  }

  function paystackRequest(
    body: string,
    signature: string | undefined,
  ): Request {
    const headers: Record<string, string> = {};
    if (signature !== undefined) headers["x-paystack-signature"] = signature;
    return new Request("http://localhost/api/webhooks/paystack", {
      method: "POST",
      body,
      headers,
    });
  }

  function chargeSuccessBody(
    overrides: {
      id?: number;
      reference?: string;
      amount?: number;
      currency?: string;
      orderId?: string | null;
    } = {},
  ): string {
    return JSON.stringify({
      event: "charge.success",
      data: {
        id: overrides.id ?? 1001,
        reference: overrides.reference ?? "ORD-20260910-TESTREF1",
        status: "success",
        amount: overrides.amount ?? 45_875_000,
        currency: overrides.currency ?? "NGN",
        metadata:
          overrides.orderId === null
            ? null
            : { orderId: overrides.orderId ?? "order-1", enrolmentId: "enr-1" },
      },
    });
  }

  /** Verify Transaction's own response envelope — `data.status` is the field under test (Pitfall 1). */
  function verifyTransactionFetchResponse(data: {
    status: string;
    amount?: number;
    currency?: string;
    reference?: string;
  }) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: true, // the API-call-succeeded envelope flag — deliberately true even when data.status isn't
        message: "Verification successful",
        data: {
          id: 1001,
          reference: data.reference ?? "ORD-20260910-TESTREF1",
          status: data.status,
          amount: data.amount ?? 45_875_000,
          currency: data.currency ?? "NGN",
          channel: "card",
          paid_at: "2026-09-10T12:00:00.000Z",
          fees: 200_000,
        },
      }),
    };
  }

  function freshEnvAndMocks() {
    setEnv();
    process.env.PAYSTACK_SECRET_KEY = ROUTE_SECRET;
    settlementMocks.recordWebhookEventOrSkip.mockReset();
    settlementMocks.markWebhookEventRetryable.mockReset();
    settlementMocks.activateOrderAsSystem.mockReset();
  }

  it("a request with no x-paystack-signature header returns 400 and performs zero database writes", async () => {
    freshEnvAndMocks();
    const { POST } = await import("@/app/api/webhooks/paystack/route");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(paystackRequest(chargeSuccessBody(), undefined));

    expect(res.status).toBe(400);
    expect(settlementMocks.recordWebhookEventOrSkip).not.toHaveBeenCalled();
    expect(settlementMocks.activateOrderAsSystem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a signature computed with the wrong secret returns 400 and performs zero writes", async () => {
    freshEnvAndMocks();
    const { POST } = await import("@/app/api/webhooks/paystack/route");
    const body = chargeSuccessBody();
    const signature = sign(body, "a-completely-different-secret");

    const res = await POST(paystackRequest(body, signature));

    expect(res.status).toBe(400);
    expect(settlementMocks.recordWebhookEventOrSkip).not.toHaveBeenCalled();
    expect(settlementMocks.activateOrderAsSystem).not.toHaveBeenCalled();
  });

  it("a signature computed over a mutated body returns 400 — the raw body is verified, not a re-serialized parse", async () => {
    freshEnvAndMocks();
    const { POST } = await import("@/app/api/webhooks/paystack/route");
    const originalBody = chargeSuccessBody();
    const signature = sign(originalBody, ROUTE_SECRET);
    const mutatedBody = chargeSuccessBody({ amount: 1 });

    const res = await POST(paystackRequest(mutatedBody, signature));

    expect(res.status).toBe(400);
    expect(settlementMocks.recordWebhookEventOrSkip).not.toHaveBeenCalled();
  });

  it("a valid first delivery calls recordWebhookEventOrSkip with provider PAYSTACK, verifies the transaction, settles, and returns 200", async () => {
    freshEnvAndMocks();
    settlementMocks.recordWebhookEventOrSkip.mockResolvedValue({ isNew: true });
    settlementMocks.activateOrderAsSystem.mockResolvedValue({
      outcome: "ACTIVATED",
    });
    const { POST } = await import("@/app/api/webhooks/paystack/route");

    const body = chargeSuccessBody({ id: 2002, orderId: "order-42" });
    const signature = sign(body, ROUTE_SECRET);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          verifyTransactionFetchResponse({ status: "success" }),
        ),
    );

    const res = await POST(paystackRequest(body, signature));

    expect(res.status).toBe(200);
    expect(settlementMocks.recordWebhookEventOrSkip).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "PAYSTACK",
        providerEventId: "2002",
        eventType: "charge.success",
      }),
    );
    expect(settlementMocks.activateOrderAsSystem).toHaveBeenCalledWith({
      orderId: "order-42",
      provider: "PAYSTACK",
      providerIntentId: "ORD-20260910-TESTREF1",
      providerRef: "ORD-20260910-TESTREF1",
      amountMinor: 45_875_000,
      currency: "NGN",
      eventId: "2002",
    });
  });

  it("an identical redelivery returns 200, never re-verifies the transaction, and never calls activateOrderAsSystem a second time", async () => {
    freshEnvAndMocks();
    settlementMocks.recordWebhookEventOrSkip.mockResolvedValue({
      isNew: false,
    });
    const { POST } = await import("@/app/api/webhooks/paystack/route");

    const body = chargeSuccessBody();
    const signature = sign(body, ROUTE_SECRET);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(paystackRequest(body, signature));

    expect(res.status).toBe(200);
    expect(settlementMocks.activateOrderAsSystem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks a recorded event retryable when settlement throws, then lets the error produce a non-2xx response", async () => {
    freshEnvAndMocks();
    settlementMocks.recordWebhookEventOrSkip.mockResolvedValue({ isNew: true });
    settlementMocks.activateOrderAsSystem.mockRejectedValue(
      new Error("database timeout"),
    );
    settlementMocks.markWebhookEventRetryable.mockResolvedValue({
      marked: true,
    });
    const { POST } = await import("@/app/api/webhooks/paystack/route");

    const body = chargeSuccessBody({ id: 3003, orderId: "order-retry" });
    const signature = sign(body, ROUTE_SECRET);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          verifyTransactionFetchResponse({ status: "success" }),
        ),
    );

    await expect(POST(paystackRequest(body, signature))).rejects.toThrow(
      "database timeout",
    );
    expect(settlementMocks.markWebhookEventRetryable).toHaveBeenCalledWith({
      provider: "PAYSTACK",
      providerEventId: "3003",
    });
  });

  it("refuses to settle when the verified payload's nested data.status is not successful, even though the envelope's own status field is successful (Pitfall 1)", async () => {
    freshEnvAndMocks();
    settlementMocks.recordWebhookEventOrSkip.mockResolvedValue({ isNew: true });
    const { POST } = await import("@/app/api/webhooks/paystack/route");

    const body = chargeSuccessBody(); // the delivered event itself claims "success"
    const signature = sign(body, ROUTE_SECRET);
    // The Verify Transaction call's OWN envelope succeeded (status: true) but
    // the nested transaction status did not.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          verifyTransactionFetchResponse({ status: "failed" }),
        ),
    );

    const res = await POST(paystackRequest(body, signature));

    expect(res.status).toBe(200);
    expect(settlementMocks.activateOrderAsSystem).not.toHaveBeenCalled();
  });

  it("passes the Verify Transaction response's own amount/currency/reference to activateOrderAsSystem, never the delivered event body's", async () => {
    freshEnvAndMocks();
    settlementMocks.recordWebhookEventOrSkip.mockResolvedValue({ isNew: true });
    settlementMocks.activateOrderAsSystem.mockResolvedValue({
      outcome: "ACTIVATED",
    });
    const { POST } = await import("@/app/api/webhooks/paystack/route");

    // The delivered body claims one amount/currency/reference...
    const body = chargeSuccessBody({
      amount: 1,
      currency: "USD",
      reference: "spoofed-reference",
    });
    const signature = sign(body, ROUTE_SECRET);
    // ...but the independently-verified transaction reports the real ones.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        verifyTransactionFetchResponse({
          status: "success",
          amount: 45_875_000,
          currency: "NGN",
          reference: "ORD-20260910-REAL",
        }),
      ),
    );

    await POST(paystackRequest(body, signature));

    expect(settlementMocks.activateOrderAsSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 45_875_000,
        currency: "NGN",
        providerIntentId: "ORD-20260910-REAL",
        providerRef: "ORD-20260910-REAL",
      }),
    );
  });

  it("a webhook whose metadata carries no orderId at all returns 200 without settling anything", async () => {
    freshEnvAndMocks();
    settlementMocks.recordWebhookEventOrSkip.mockResolvedValue({ isNew: true });
    const { POST } = await import("@/app/api/webhooks/paystack/route");

    const body = chargeSuccessBody({ orderId: null });
    const signature = sign(body, ROUTE_SECRET);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          verifyTransactionFetchResponse({ status: "success" }),
        ),
    );

    const res = await POST(paystackRequest(body, signature));

    expect(res.status).toBe(200);
    expect(settlementMocks.activateOrderAsSystem).not.toHaveBeenCalled();
  });

  it("returns 200 for a duplicate, an exception outcome, and a no-matching-order outcome alike — 400 is reserved for signature failure only", async () => {
    freshEnvAndMocks();
    settlementMocks.recordWebhookEventOrSkip.mockResolvedValue({ isNew: true });
    settlementMocks.activateOrderAsSystem.mockResolvedValue({
      outcome: "EXCEPTION",
    });
    const { POST } = await import("@/app/api/webhooks/paystack/route");

    const body = chargeSuccessBody({ orderId: "order-does-not-exist" });
    const signature = sign(body, ROUTE_SECRET);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          verifyTransactionFetchResponse({ status: "success" }),
        ),
    );

    const res = await POST(paystackRequest(body, signature));

    // The route never inspects activateOrderAsSystem's own outcome — every
    // outcome the shared service can resolve returns 200 uniformly.
    expect(res.status).toBe(200);
  });
});
