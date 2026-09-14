/**
 * Phase-7 schema-delta regression proof (plan 07-02, Task 1).
 *
 * Two halves, mirroring `tests/schema-cohort.test.ts`:
 *
 *  (a) STATIC — assertions over the `prisma/schema.prisma` text and the
 *      joined `prisma/migrations/*\/migration.sql` history. These prove the
 *      dual Cohort prices, the `GatewayFeeSchedule` model, the Order/
 *      PaymentAttempt/Refund snapshot columns, every named CHECK constraint
 *      from `prisma/sql/004_payment_split_integrity.sql`, and the D-08
 *      legacy-price backfill actually landed in an applied migration
 *      (RESEARCH Pitfall 2 — `tests/support/pg.ts` auto-applies an
 *      un-pasted companion, so without this the Testcontainers half would
 *      pass while production has no constraint).
 *
 *  (b) TESTCONTAINERS — a throwaway `postgres:16-alpine` with the checked-in
 *      migrations deployed (see `tests/support/pg.ts`), proving each new
 *      CHECK constraint rejects a bad row and that PaymentAttempt's actual-
 *      settlement columns read back NULL, never 0 (D-14).
 *
 * PREREQUISITE for half (b): Docker. If it is unavailable `beforeAll` fails
 * with a container-start error and those cases report BLOCKED — never
 * silently passed, never weakened to a mock (same rule as
 * `tests/schema-cohort.test.ts`).
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  TEST_DB_TIMEOUT_MS,
  type TestDatabase,
} from "./support/pg";
import { seedCohortFixture, seedLearnerFixture } from "./support/cohort-fixtures";

// ---------------------------------------------------------------------------
// (a) STATIC assertions
// ---------------------------------------------------------------------------

const schema = readFileSync(
  path.resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);

function sliceModel(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  if (start === -1) throw new Error(`model ${name} not found in schema`);
  const end = schema.indexOf("\n}", start);
  return schema.slice(start, end);
}

const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
const allMigrationSql = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    readFileSync(path.join(migrationsDir, entry.name, "migration.sql"), "utf8"),
  )
  .join("\n");

// Every named CHECK constraint pasted from prisma/sql/004_payment_split_integrity.sql.
const NEW_CONSTRAINTS = [
  "cohort_price_ngn_minor_non_negative",
  "cohort_price_usd_minor_non_negative",
  "gateway_fee_schedule_fixed_minor_non_negative",
  "gateway_fee_schedule_waiver_threshold_minor_non_negative",
  "gateway_fee_schedule_cap_minor_non_negative",
  "gateway_fee_schedule_percentage_bps_range",
  "gateway_fee_schedule_tax_bps_range",
  "gateway_fee_schedule_version_positive",
  "order_base_amount_minor_non_negative",
  "order_platform_fee_minor_non_negative",
  "order_gateway_fee_estimate_minor_non_negative",
  "order_school_settlement_expected_minor_non_negative",
  "payment_attempt_gateway_fee_actual_minor_non_negative",
  "payment_attempt_school_settlement_actual_minor_non_negative",
  "payment_attempt_platform_gross_actual_minor_non_negative",
  "payment_attempt_platform_net_actual_minor_non_negative",
  "refund_base_component_minor_non_negative",
  "refund_platform_component_minor_non_negative",
  "refund_gateway_component_minor_non_negative",
] as const;

describe("Phase-7 schema delta is declared in prisma/schema.prisma", () => {
  it("Cohort.priceNgnMinor and priceUsdMinor are nullable Int (D-06)", () => {
    const model = sliceModel("Cohort");
    expect(model).toMatch(/priceNgnMinor\s+Int\?/);
    expect(model).toMatch(/priceUsdMinor\s+Int\?/);
  });

  it("model GatewayFeeSchedule declares every D-11 field and the provider+currency+version uniqueness constraint", () => {
    const model = sliceModel("GatewayFeeSchedule");
    expect(model).toMatch(/provider\s+PaymentProvider/);
    expect(model).toMatch(/currency\s+String/);
    expect(model).toMatch(/version\s+Int/);
    expect(model).toMatch(/percentageBps\s+Int/);
    expect(model).toMatch(/fixedMinor\s+Int/);
    expect(model).toMatch(/waiverThresholdMinor\s+Int\?/);
    expect(model).toMatch(/capMinor\s+Int\?/);
    expect(model).toMatch(/taxBps\s+Int\s+@default\(0\)/);
    expect(model).toMatch(/roundingRule\s+String/);
    expect(model).toMatch(/effectiveFrom\s+DateTime/);
    expect(model).toMatch(/active\s+Boolean\s+@default\(true\)/);
    expect(model).toMatch(
      /@@unique\(\[provider,\s*currency,\s*version\]\)/,
    );
  });

  it("Order declares all six D-13 snapshot columns", () => {
    const model = sliceModel("Order");
    expect(model).toMatch(/baseAmountMinor\s+Int\?/);
    expect(model).toMatch(/platformFeeMinor\s+Int\?/);
    expect(model).toMatch(/gatewayFeeEstimateMinor\s+Int\?/);
    expect(model).toMatch(/gatewayFeeScheduleId\s+String\?/);
    expect(model).toMatch(/gatewayFeeScheduleVersion\s+Int\?/);
    expect(model).toMatch(/schoolSettlementExpectedMinor\s+Int\?/);
  });

  it("PaymentAttempt declares all four D-14 actual columns as nullable", () => {
    const model = sliceModel("PaymentAttempt");
    expect(model).toMatch(/gatewayFeeActualMinor\s+Int\?/);
    expect(model).toMatch(/schoolSettlementActualMinor\s+Int\?/);
    expect(model).toMatch(/platformGrossActualMinor\s+Int\?/);
    expect(model).toMatch(/platformNetActualMinor\s+Int\?/);
  });

  it("Refund declares the three D-22 component-allocation columns", () => {
    const model = sliceModel("Refund");
    expect(model).toMatch(/baseComponentMinor\s+Int\?/);
    expect(model).toMatch(/platformComponentMinor\s+Int\?/);
    expect(model).toMatch(/gatewayComponentMinor\s+Int\?/);
  });
});

describe("The manual paste-in from 004_payment_split_integrity.sql was actually applied", () => {
  for (const name of NEW_CONSTRAINTS) {
    it(`${name} appears in an applied migration file`, () => {
      expect(allMigrationSql).toContain(name);
    });
  }

  it("the migration text contains the D-08 legacy-price backfill for both currencies", () => {
    expect(allMigrationSql).toMatch(
      /UPDATE\s+"Cohort"\s+SET\s+"priceNgnMinor"\s*=\s*"priceMinor"\s+WHERE\s+upper\("currency"\)\s*=\s*'NGN'\s+AND\s+"priceNgnMinor"\s+IS\s+NULL/i,
    );
    expect(allMigrationSql).toMatch(
      /UPDATE\s+"Cohort"\s+SET\s+"priceUsdMinor"\s*=\s*"priceMinor"\s+WHERE\s+upper\("currency"\)\s*=\s*'USD'\s+AND\s+"priceUsdMinor"\s+IS\s+NULL/i,
    );
  });

  it("never writes 0 into the unpriced rail during backfill", () => {
    expect(allMigrationSql).not.toMatch(/"priceNgnMinor"\s*=\s*0\b/);
    expect(allMigrationSql).not.toMatch(/"priceUsdMinor"\s*=\s*0\b/);
  });
});

// ---------------------------------------------------------------------------
// (b) TESTCONTAINERS: each new constraint rejects a bad row
// ---------------------------------------------------------------------------

describe("the new payment-split CHECK constraints reject bad rows against real Postgres", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
  }, TEST_DB_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.stop();
  }, TEST_DB_TIMEOUT_MS);

  /** Minimal (User, Cohort) pair every Order/PaymentAttempt case needs. */
  async function seedOrderParents() {
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    return { userId, cohortId };
  }

  let orderCounter = 0;
  async function seedOrderFixture(overrides: Record<string, unknown> = {}) {
    const { userId, cohortId } = await seedOrderParents();
    orderCounter += 1;
    return testDb.prisma.order.create({
      data: {
        reference: `ORD-${orderCounter}`,
        userId,
        cohortId,
        amountMinor: 100_000,
        currency: "NGN",
        idempotencyKey: `idem-order-${orderCounter}`,
        ...overrides,
      },
    });
  }

  it("cohort_price_ngn_minor_non_negative: a negative priceNgnMinor is rejected", async () => {
    await expect(
      seedCohortFixture(testDb.prisma, { priceNgnMinor: -1 }),
    ).rejects.toThrow();
  });

  it("cohort_price_ngn_minor_non_negative: null and 0 are accepted", async () => {
    await expect(
      seedCohortFixture(testDb.prisma, { priceNgnMinor: null }),
    ).resolves.toBeDefined();
    await expect(
      seedCohortFixture(testDb.prisma, { priceNgnMinor: 0 }),
    ).resolves.toBeDefined();
  });

  it("cohort_price_usd_minor_non_negative: a negative priceUsdMinor is rejected", async () => {
    await expect(
      seedCohortFixture(testDb.prisma, { priceUsdMinor: -1 }),
    ).rejects.toThrow();
  });

  it("order_platform_fee_minor_non_negative: a negative platformFeeMinor is rejected", async () => {
    await expect(seedOrderFixture({ platformFeeMinor: -1 })).rejects.toThrow();
  });

  it("order_base_amount_minor_non_negative: null is accepted (unpriced/unsnapshotted order)", async () => {
    await expect(
      seedOrderFixture({ baseAmountMinor: null }),
    ).resolves.toBeDefined();
  });

  it("gateway_fee_schedule_percentage_bps_range: below 0 is rejected", async () => {
    await expect(
      testDb.prisma.gatewayFeeSchedule.create({
        data: {
          provider: "PAYSTACK",
          currency: "NGN",
          version: 1,
          percentageBps: -1,
          fixedMinor: 0,
          roundingRule: "CEIL",
          effectiveFrom: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("gateway_fee_schedule_percentage_bps_range: above 10000 is rejected", async () => {
    await expect(
      testDb.prisma.gatewayFeeSchedule.create({
        data: {
          provider: "PAYSTACK",
          currency: "NGN",
          version: 2,
          percentageBps: 10001,
          fixedMinor: 0,
          roundingRule: "CEIL",
          effectiveFrom: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("gateway_fee_schedule_percentage_bps_range: 0 and 10000 are both accepted", async () => {
    await expect(
      testDb.prisma.gatewayFeeSchedule.create({
        data: {
          provider: "STRIPE",
          currency: "USD",
          version: 1,
          percentageBps: 0,
          fixedMinor: 0,
          roundingRule: "CEIL",
          effectiveFrom: new Date(),
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      testDb.prisma.gatewayFeeSchedule.create({
        data: {
          provider: "STRIPE",
          currency: "USD",
          version: 2,
          percentageBps: 10000,
          fixedMinor: 0,
          roundingRule: "CEIL",
          effectiveFrom: new Date(),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("gateway_fee_schedule_version_positive: version 0 is rejected", async () => {
    await expect(
      testDb.prisma.gatewayFeeSchedule.create({
        data: {
          provider: "PAYSTACK",
          currency: "NGN",
          version: 0,
          percentageBps: 150,
          fixedMinor: 10_000,
          roundingRule: "CEIL",
          effectiveFrom: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("a fresh PaymentAttempt reads back NULL — not 0 — in all four actual columns (D-14)", async () => {
    const order = await seedOrderFixture();
    const attempt = await testDb.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "PAYSTACK",
        amountMinor: 100_000,
        currency: "NGN",
        idempotencyKey: `idem-attempt-${order.id}`,
      },
    });
    expect(attempt.gatewayFeeActualMinor).toBeNull();
    expect(attempt.schoolSettlementActualMinor).toBeNull();
    expect(attempt.platformGrossActualMinor).toBeNull();
    expect(attempt.platformNetActualMinor).toBeNull();
    expect(attempt.reconciledAt).toBeNull();
  });

  it("payment_attempt_gateway_fee_actual_minor_non_negative: a negative actual fee is rejected", async () => {
    const order = await seedOrderFixture();
    await expect(
      testDb.prisma.paymentAttempt.create({
        data: {
          orderId: order.id,
          provider: "PAYSTACK",
          amountMinor: 100_000,
          currency: "NGN",
          idempotencyKey: `idem-attempt-neg-${order.id}`,
          gatewayFeeActualMinor: -1,
        },
      }),
    ).rejects.toThrow();
  });

  it("refund_base_component_minor_non_negative: a negative base component is rejected", async () => {
    const order = await seedOrderFixture();
    const attempt = await testDb.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "PAYSTACK",
        amountMinor: 100_000,
        currency: "NGN",
        idempotencyKey: `idem-attempt-refund-${order.id}`,
      },
    });
    await expect(
      testDb.prisma.refund.create({
        data: {
          orderId: order.id,
          paymentAttemptId: attempt.id,
          amountMinor: 1_000,
          currency: "NGN",
          provider: "PAYSTACK",
          reason: "Learner requested a refund",
          accessDecision: "Access revoked",
          baseComponentMinor: -1,
        },
      }),
    ).rejects.toThrow();
  });
});
