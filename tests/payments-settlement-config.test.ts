import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ENV_KEYS = ["PAYSTACK_SECRET_KEY", "PAYSTACK_SUBACCOUNT_CODE", "STRIPE_CONNECTED_ACCOUNT_ID"] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("settlement-config module import", () => {
  it("does not throw when process.env has none of the three variables set", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    await expect(import("@/server/payments/settlement-config")).resolves.toBeDefined();
  });
});

describe.each([
  { label: "paystackSecretKey", envVar: "PAYSTACK_SECRET_KEY" as const, accessor: "paystackSecretKey" as const },
  {
    label: "paystackSubaccountCode",
    envVar: "PAYSTACK_SUBACCOUNT_CODE" as const,
    accessor: "paystackSubaccountCode" as const,
  },
  {
    label: "stripeConnectedAccountId",
    envVar: "STRIPE_CONNECTED_ACCOUNT_ID" as const,
    accessor: "stripeConnectedAccountId" as const,
  },
])("$label", ({ envVar, accessor }) => {
  it("returns the exact value when present and non-blank", async () => {
    process.env[envVar] = "test-value-abc-123";
    const mod = await import("@/server/payments/settlement-config");
    const fn = mod[accessor];
    expect(fn()).toBe("test-value-abc-123");
  });

  it("throws MissingSettlementAccountError when absent", async () => {
    delete process.env[envVar];
    const mod = await import("@/server/payments/settlement-config");
    const fn = mod[accessor];
    expect(() => fn()).toThrow(mod.MissingSettlementAccountError);
  });

  it("throws MissingSettlementAccountError when whitespace-only", async () => {
    process.env[envVar] = "   \t  ";
    const mod = await import("@/server/payments/settlement-config");
    const fn = mod[accessor];
    expect(() => fn()).toThrow(mod.MissingSettlementAccountError);
  });

  it("error message names the variable and says 'deployment configuration'", async () => {
    delete process.env[envVar];
    const mod = await import("@/server/payments/settlement-config");
    const fn = mod[accessor];
    expect(() => fn()).toThrowError(new RegExp(`${envVar}.*deployment configuration`, "s"));
  });

  it("never leaks a fragment of a value set in a sibling case, even after the variable is unset", async () => {
    const canary = "canary-secret-fragment-should-never-appear";
    process.env[envVar] = canary;
    const mod = await import("@/server/payments/settlement-config");
    // Confirm the canary was actually readable once, so the negative assertion below is meaningful.
    expect(mod[accessor]()).toBe(canary);

    delete process.env[envVar];
    try {
      mod[accessor]();
      throw new Error("expected MissingSettlementAccountError to be thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(canary);
      expect(message).not.toContain("canary-secret-fragment");
    }
  });
});

describe("paystackWebhookSecretKey", () => {
  it("aliases paystackSecretKey rather than reading a second variable", async () => {
    process.env.PAYSTACK_SECRET_KEY = "shared-secret-value";
    const mod = await import("@/server/payments/settlement-config");
    expect(mod.paystackWebhookSecretKey()).toBe("shared-secret-value");
  });

  it("throws MissingSettlementAccountError when PAYSTACK_SECRET_KEY is absent", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const mod = await import("@/server/payments/settlement-config");
    expect(() => mod.paystackWebhookSecretKey()).toThrow(mod.MissingSettlementAccountError);
  });
});

describe("provider isolation (PAY-09)", () => {
  it("imports nothing from stripe, @prisma/client, or a providers/ path", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/server/payments/settlement-config.ts"),
      "utf8",
    );
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']stripe["']/);
      expect(line).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(line).not.toMatch(/providers\//);
    }
  });
});
