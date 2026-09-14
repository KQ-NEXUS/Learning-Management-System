/**
 * Thin `fetch()` wrapper over `https://api.paystack.co` (PAY-09, PAY-14).
 *
 * No official first-party Paystack Node SDK exists (confirmed:
 * `package.json` has no `paystack-*` dependency) — this file is the
 * project-owned equivalent, mirroring `src/server/email/brevo-client.ts`'s
 * established thin-wrapper convention for an external HTTPS provider with no
 * SDK. `PAYSTACK_SECRET_KEY` is read lazily, at call time, through
 * `settlement-config.ts` — never at module/import time — so importing this
 * module during `next build` (no secrets present) never throws, mirroring
 * `providers/stripe/client.ts`'s own documented shape.
 *
 * A hard rule enforced by every function below: no response body is ever
 * logged, and only an explicit, narrowed subset of a Paystack response is
 * ever returned to a caller (D-21, PAY-14) — never the raw envelope.
 */

import { paystackSecretKey } from "@/server/payments/settlement-config";

const PAYSTACK_API_BASE = "https://api.paystack.co";

/** Thrown for a non-2xx Paystack response, or `status: false` inside a 2xx envelope. */
export class PaystackApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PaystackApiError";
    this.status = status;
  }
}

type PaystackEnvelope<T> = {
  status: boolean;
  message: string;
  data: T;
};

/**
 * Every call in this module funnels through here: attaches the bearer
 * secret, parses the JSON envelope, and throws `PaystackApiError` on either
 * transport failure (`!response.ok`) or an API-level failure
 * (`envelope.status === false`) — the same "API call succeeded" vs
 * "operation succeeded" distinction this codebase's own Paystack research
 * (07-RESEARCH.md Pitfall 1) warns is easy to conflate for the transaction
 * *content*, and is exactly as easy to conflate here for the *request*
 * itself, so both checks are explicit and separate.
 */
// Exported (07-08) so `providers/paystack/refund.ts` — a sibling module
// inside this same adapter directory — reuses the one envelope-unwrap/error
// discipline rather than hand-rolling a second `fetch()` wrapper that could
// drift from the `status === false` vs `!response.ok` distinction this
// function already gets right. Still never called from outside
// `providers/paystack/` (PAY-09) — nothing outside this directory imports it.
export async function paystackFetch<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${PAYSTACK_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${paystackSecretKey()}`,
      "Content-Type": "application/json",
    },
  });

  const envelope = (await response.json()) as PaystackEnvelope<T>;
  if (!response.ok || envelope.status !== true) {
    throw new PaystackApiError(response.status, envelope.message ?? "Paystack API request failed.");
  }
  return envelope.data;
}

/** The narrow subset of Paystack's Initialize Transaction response this codebase reads. */
export type PaystackInitializeTransactionResponse = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

/**
 * `POST /transaction/initialize` — `body` is a plain request object built by
 * `initialize.ts`'s pure `buildInitializeTransactionRequest`; this function
 * performs no shaping of its own.
 */
export async function initializeTransaction(
  body: Record<string, unknown>,
): Promise<PaystackInitializeTransactionResponse> {
  return paystackFetch<PaystackInitializeTransactionResponse>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * The narrow, allow-listed subset of Paystack's Verify Transaction response
 * this codebase ever reads (D-21 forbids storing an unrestricted payload —
 * this is also the shape the webhook route's `data` and, later,
 * `PaymentAttempt.evidence` reads). `status` here is the NESTED transaction
 * outcome (`"success" | "failed" | "abandoned" | ...`), never the envelope's
 * own top-level `status: boolean` — see this function's own call site in
 * `api/webhooks/paystack/route.ts` for the Pitfall-1 comment on why that
 * distinction matters.
 */
export type PaystackVerifiedTransaction = {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  channel: string | null;
  paid_at: string | null;
  fees: number | null;
  /**
   * 07-07 — present on a split (subaccount) transaction: the actual
   * per-recipient breakdown Paystack settled the charge into. `subaccount`
   * is the amount that actually reached the school's subaccount — the
   * figure `payment-reconciliation-service.ts` reads as the actual school
   * settlement, never the `transaction_charge` this codebase itself
   * requested at initialize time (D-14 — actual, not the estimate echoed
   * back). `null` when Paystack has not yet reported the split (a
   * reconciliation sweep must treat that as "not yet available", never as
   * zero).
   */
  fees_split: { paystack: number | null; integration: number | null; subaccount: number | null } | null;
};

/**
 * `GET /transaction/verify/:reference` — called independently after
 * signature verification and BEFORE settling, so the webhook route never
 * trusts the delivered event's own `data.status` alone (07-RESEARCH.md
 * Pitfall 1). Allow-lists the response explicitly rather than passing the
 * raw payload through.
 */
export async function verifyTransaction(reference: string): Promise<PaystackVerifiedTransaction> {
  const raw = await paystackFetch<Record<string, unknown>>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
  const rawFeesSplit = raw.fees_split as Record<string, unknown> | null | undefined;
  return {
    id: raw.id as number,
    reference: raw.reference as string,
    status: raw.status as string,
    amount: raw.amount as number,
    currency: raw.currency as string,
    channel: (raw.channel as string | null) ?? null,
    paid_at: (raw.paid_at as string | null) ?? null,
    fees: (raw.fees as number | null) ?? null,
    fees_split: rawFeesSplit
      ? {
          paystack: (rawFeesSplit.paystack as number | null) ?? null,
          integration: (rawFeesSplit.integration as number | null) ?? null,
          subaccount: (rawFeesSplit.subaccount as number | null) ?? null,
        }
      : null,
  };
}

/**
 * 07-07 — resolves the actual settlement figures for a completed split
 * transaction from Paystack's own Verify Transaction response (never the
 * delivered webhook body), narrowed into the provider-neutral
 * `ActualSettlement` shape `payment-reconciliation-service.ts` consumes so
 * no Paystack-specific type crosses out of this directory (PAY-09).
 *
 * Throws — never returns a partial or zero-filled result — when Paystack has
 * not yet reported `fees` or the subaccount's settled amount. The caller
 * (the reconciliation sweep) must treat a throw as "not yet available" and
 * leave the row untouched for the next scheduled invocation (D-14 — NULL is
 * never equivalent to zero, and neither is an unresolved lookup).
 */
export async function fetchActualSettlement(reference: string): Promise<{
  gatewayFeeActualMinor: number;
  schoolSettlementActualMinor: number;
  platformGrossActualMinor: number;
}> {
  const verified = await verifyTransaction(reference);
  const gatewayFeeActualMinor = verified.fees;
  const schoolSettlementActualMinor = verified.fees_split?.subaccount ?? null;
  if (gatewayFeeActualMinor === null || schoolSettlementActualMinor === null) {
    throw new PaystackApiError(
      200,
      `Paystack has not yet reported final settlement figures for reference ${reference}.`,
    );
  }
  return {
    gatewayFeeActualMinor,
    schoolSettlementActualMinor,
    platformGrossActualMinor: verified.amount - schoolSettlementActualMinor,
  };
}
