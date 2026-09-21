import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("stripe client singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    "does not throw on import when STRIPE_SECRET_KEY is unset",
    async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "");
      await expect(
        import("@/server/payments/providers/stripe/client"),
      ).resolves.toBeDefined();
    },
    15_000, // first import of the Stripe SDK's module graph is slow to transform
  );

  it("throws StripeNotConfiguredError from getStripe() when STRIPE_SECRET_KEY is unset", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { getStripe, StripeNotConfiguredError } = await import(
      "@/server/payments/providers/stripe/client"
    );
    expect(() => getStripe()).toThrow(StripeNotConfiguredError);
  });

  it("returns the identical singleton instance across repeated calls when configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake_key_for_unit_tests");
    const { getStripe } = await import("@/server/payments/providers/stripe/client");
    const first = getStripe();
    const second = getStripe();
    expect(second).toBe(first);
  });

  it("exports a non-empty STRIPE_API_VERSION string", async () => {
    const { STRIPE_API_VERSION } = await import(
      "@/server/payments/providers/stripe/client"
    );
    expect(typeof STRIPE_API_VERSION).toBe("string");
    expect(STRIPE_API_VERSION.length).toBeGreaterThan(0);
  });
});
