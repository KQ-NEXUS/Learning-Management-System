/**
 * The fixed currency-to-provider routing policy (D-07, PAY-08).
 *
 * `NGN -> PAYSTACK` and `USD -> STRIPE` are fixed, server-side mappings.
 * `providerForCurrency` takes exactly one argument — no second parameter, no
 * options object, no override. That absence is deliberate and structural: it
 * is what makes "a client cannot select Stripe for NGN, or Paystack for USD"
 * true by construction rather than merely true by validation. If a future
 * requirement needs a different provider for the same currency (see the
 * deferred idea "learner-selected gateway independent of currency" in
 * 07-CONTEXT.md), that is a new routing policy and belongs in a new, named
 * function — do not add a `preferredProvider` parameter to this one.
 *
 * Imports only from `./pricing`, which owns the single `SupportedCurrency`
 * union — this module re-exports it rather than declaring a second,
 * divergent copy.
 */

import type { SupportedCurrency } from "./pricing";

export type { SupportedCurrency } from "./pricing";

/** The only two currencies this deployment can route online payments for (D-06, D-07). */
export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = ["NGN", "USD"];

/** A currency was requested that has no provider mapping. Never falls back to a default provider. */
export class UnsupportedCurrencyError extends Error {
  constructor(received: string) {
    super(
      `Unsupported currency: ${JSON.stringify(received)}. Supported currencies are ${SUPPORTED_CURRENCIES.join(", ")}.`,
    );
    this.name = "UnsupportedCurrencyError";
  }
}

/** Narrows an arbitrary string to `SupportedCurrency`. Case-sensitive: "ngn"/"usd" are rejected. */
export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Derives the fixed provider for a currency. Takes exactly one argument — see
 * the module header for why a second, override parameter must never be added.
 *
 * @throws {UnsupportedCurrencyError} for any value other than "NGN" or "USD".
 */
export function providerForCurrency(currency: string): "PAYSTACK" | "STRIPE" {
  if (!isSupportedCurrency(currency)) {
    throw new UnsupportedCurrencyError(currency);
  }
  return currency === "NGN" ? "PAYSTACK" : "STRIPE";
}
