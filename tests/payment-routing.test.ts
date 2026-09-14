/**
 * Task 1 (plan 07-03): the fixed currency-to-provider routing policy (D-07,
 * PAY-08).
 *
 * `providerForCurrency` takes exactly one argument — there is no override by
 * which a caller could ask for STRIPE with NGN or PAYSTACK with USD. That
 * absence is asserted directly (`.length`), not just inferred from types,
 * because TypeScript's structural typing cannot stop a caller who ignores
 * the compiler.
 */

import { describe, expect, it } from "vitest";
import {
  isSupportedCurrency,
  providerForCurrency,
  SUPPORTED_CURRENCIES,
  UnsupportedCurrencyError,
} from "@/server/payments/routing";

describe("providerForCurrency — D-07 fixed mapping", () => {
  it('maps "NGN" to "PAYSTACK"', () => {
    expect(providerForCurrency("NGN")).toBe("PAYSTACK");
  });

  it('maps "USD" to "STRIPE"', () => {
    expect(providerForCurrency("USD")).toBe("STRIPE");
  });

  it("has exactly one declared parameter — no second argument by which a caller could override the pairing", () => {
    expect(providerForCurrency.length).toBe(1);
  });

  const rejectedCases = ["ngn", "usd", "GBP", "EUR", "", "NGD", "USDT", " NGN"];
  for (const value of rejectedCases) {
    it(`rejects ${JSON.stringify(value)} with UnsupportedCurrencyError`, () => {
      expect(() => providerForCurrency(value)).toThrow(UnsupportedCurrencyError);
    });
  }

  it("names the received value in the thrown error", () => {
    try {
      providerForCurrency("GBP");
      expect.unreachable("providerForCurrency should have thrown for GBP");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedCurrencyError);
      expect((err as Error).message).toContain("GBP");
    }
  });

  it("never falls back to a default provider for an unsupported currency", () => {
    expect(() => providerForCurrency("EUR")).toThrow();
  });
});

describe("isSupportedCurrency — narrowing guard", () => {
  it("accepts NGN and USD", () => {
    expect(isSupportedCurrency("NGN")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(true);
  });

  it("rejects case variants and every other currency string", () => {
    for (const value of ["ngn", "usd", "GBP", "EUR", ""]) {
      expect(isSupportedCurrency(value)).toBe(false);
    }
  });
});

describe("SUPPORTED_CURRENCIES", () => {
  it("contains exactly NGN and USD", () => {
    expect([...SUPPORTED_CURRENCIES].sort()).toEqual(["NGN", "USD"]);
  });
});
