/**
 * Paystack refund adapter (PAY-05, PAY-13, PAY-09) — `POST /refund`.
 *
 * Isolated inside `providers/paystack/`, same discipline as `initialize.ts`/
 * `webhook.ts`: every request/response TYPE this file declares stays behind
 * the adapter boundary — `tests/checkout-phase-invariants.test.ts`'s
 * generalized provider-isolation scan is extended (Task 3) to flag a
 * type-only import of this file's path from outside it, mirroring the three
 * existing Paystack entries in `typeOnlySpecifierPrefixes`.
 *
 * 07-01's locked Decision B ("ship now, record what Paystack reports," option
 * B2): this adapter does not attempt a second corrective transfer against the
 * school's subaccount, and it does not assume the split reversed. It calls
 * the standard Refund endpoint and returns exactly what Paystack reports —
 * `refund-service.ts` (the caller) is the one that decides, from that
 * reported outcome plus the Order's own snapshot, whether a KQ reconciliation
 * variance needs recording. Never invents a settlement fact this response
 * does not actually contain.
 */

import { paystackFetch } from "@/server/payments/providers/paystack/client";

/** The exact `POST /refund` request body Paystack's API documents. */
export type PaystackRefundRequest = {
  transaction: string;
  /** Omitted entirely for a full refund — Paystack's own "refund everything" shape. */
  amount?: number;
  currency?: string;
  merchant_note?: string;
};

/**
 * The narrow, allow-listed subset of Paystack's Refund response this
 * codebase ever reads (D-21/PAY-14 — never the raw envelope). `status` here
 * is Paystack's own refund lifecycle status string (e.g. `"processed"`,
 * `"pending"`, `"failed"`), not a boolean.
 */
export type PaystackRefundOutcome = {
  id: number;
  transactionReference: string;
  status: string;
  amount: number;
  currency: string;
};

/**
 * Pure — no network call. `amountMinor` omitted means a full refund (D-23);
 * `note` carries the staff-entered reason so it is visible on Paystack's own
 * side of the transaction, matching `merchant_note`'s documented purpose.
 */
export function buildPaystackRefundRequest(args: {
  transactionReference: string;
  amountMinor?: number;
  currency: string;
  note: string;
}): PaystackRefundRequest {
  return {
    transaction: args.transactionReference,
    ...(args.amountMinor !== undefined ? { amount: args.amountMinor } : {}),
    currency: args.currency,
    merchant_note: args.note,
  };
}

/**
 * `POST /refund` — `body` is built by `buildPaystackRefundRequest`, above;
 * this function performs no shaping of its own, mirroring
 * `client.ts#initializeTransaction`'s own "no shaping here" discipline.
 */
export async function refundPaystackTransaction(
  body: PaystackRefundRequest,
): Promise<PaystackRefundOutcome> {
  const raw = await paystackFetch<Record<string, unknown>>("/refund", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return {
    id: raw.id as number,
    transactionReference: (raw.transaction_reference as string | undefined) ?? body.transaction,
    status: raw.status as string,
    amount: raw.amount as number,
    currency: raw.currency as string,
  };
}
