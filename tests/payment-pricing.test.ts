/**
 * Task 1 (plan 07-03): the pure integer fee calculator (D-10, D-11, D-12,
 * D-24, D-25).
 *
 * Table-driven so an added schedule shape is a one-line addition. The D-25
 * worked example is a named row and is the phase's acceptance anchor: base
 * 45_000_000 kobo under Paystack's Nigeria schedule (150 bps + 10_000 fixed,
 * capped at 200_000) must yield platformFee 675_000, gatewayFeeEstimate
 * 200_000 and total 45_875_000 — and 1.5% of the *total* (688_125) must never
 * appear anywhere in the result, because the platform fee is computed from
 * the base, not the grossed-up total.
 *
 * `GatewayFeeScheduleValues` fixtures below are plain objects matching the
 * `GatewayFeeSchedule` column names from 07-02's schema — no Prisma type is
 * imported, so this suite needs no database.
 */

import { describe, expect, it } from "vitest";
import {
  calculateCheckoutBreakdown,
  calculatePlatformFeeMinor,
  InvalidFeeScheduleError,
  MoneyOverflowError,
  PLATFORM_FEE_BPS,
  type CheckoutBreakdown,
  type GatewayFeeScheduleValues,
} from "@/server/payments/pricing";

/** Paystack's public Nigeria local schedule cited by D-25: 1.5% + NGN 100, capped at NGN 2,000. */
const PAYSTACK_NIGERIA_SCHEDULE: GatewayFeeScheduleValues = {
  provider: "PAYSTACK",
  currency: "NGN",
  version: 1,
  percentageBps: 150,
  fixedMinor: 10_000,
  waiverThresholdMinor: null,
  capMinor: 200_000,
  taxBps: 0,
  roundingRule: "HALF_UP",
};

describe("calculatePlatformFeeMinor — D-10 (150 bps of base, never of total)", () => {
  it("D-25 anchor: 1.5% of 45_000_000 is 675_000", () => {
    expect(calculatePlatformFeeMinor(45_000_000)).toBe(675_000);
  });

  it("uses PLATFORM_FEE_BPS (150) as the default rate", () => {
    expect(PLATFORM_FEE_BPS).toBe(150);
  });

  it("rounds half-up when the exact fraction is .5 of a minor unit (base 100 -> 1.5 -> 2)", () => {
    expect(calculatePlatformFeeMinor(100)).toBe(2);
  });

  it("rounds down one unit below the exact-.5 case (base 99 -> 1.485 -> 1)", () => {
    expect(calculatePlatformFeeMinor(99)).toBe(1);
  });

  it("never equals 1.5% of the D-25 grossed-up total (688_125 must not appear)", () => {
    const platformFee = calculatePlatformFeeMinor(45_000_000);
    expect(platformFee).not.toBe(688_125);
  });

  it("raises MoneyOverflowError when base * bps would exceed Number.MAX_SAFE_INTEGER", () => {
    expect(() => calculatePlatformFeeMinor(100_000_000_000_000)).toThrow(MoneyOverflowError);
  });

  it("raises a named error for a negative baseAmountMinor", () => {
    expect(() => calculatePlatformFeeMinor(-100)).toThrow(InvalidFeeScheduleError);
  });

  it("raises a named error for a non-integer baseAmountMinor", () => {
    expect(() => calculatePlatformFeeMinor(100.5)).toThrow(InvalidFeeScheduleError);
  });
});

describe("calculateCheckoutBreakdown — D-25 worked acceptance example", () => {
  it("base 45_000_000 under the capped Paystack Nigeria schedule yields the exact D-25 breakdown", () => {
    const breakdown = calculateCheckoutBreakdown({
      baseAmountMinor: 45_000_000,
      schedule: PAYSTACK_NIGERIA_SCHEDULE,
    });

    const expected: CheckoutBreakdown = {
      baseAmountMinor: 45_000_000,
      platformFeeMinor: 675_000,
      gatewayFeeEstimateMinor: 200_000,
      totalAmountMinor: 45_875_000,
    };
    expect(breakdown).toEqual(expected);
  });

  it("the cap is applied before final rounding: total is base + platformFee + capMinor exactly, with no rounding remainder", () => {
    const breakdown = calculateCheckoutBreakdown({
      baseAmountMinor: 45_000_000,
      schedule: PAYSTACK_NIGERIA_SCHEDULE,
    });
    expect(breakdown.totalAmountMinor).toBe(
      breakdown.baseAmountMinor + breakdown.platformFeeMinor + PAYSTACK_NIGERIA_SCHEDULE.capMinor!,
    );
  });
});

describe("calculateCheckoutBreakdown — table-driven cases", () => {
  const cases: Array<{
    name: string;
    baseAmountMinor: number;
    platformFeeBps?: number;
    schedule: GatewayFeeScheduleValues;
    expected: CheckoutBreakdown;
  }> = [
    {
      name: "D-25 anchor (capped Paystack Nigeria schedule)",
      baseAmountMinor: 45_000_000,
      schedule: PAYSTACK_NIGERIA_SCHEDULE,
      expected: {
        baseAmountMinor: 45_000_000,
        platformFeeMinor: 675_000,
        gatewayFeeEstimateMinor: 200_000,
        totalAmountMinor: 45_875_000,
      },
    },
    {
      name: "uncapped percentage-plus-fixed gross-up",
      baseAmountMinor: 1_000_000,
      schedule: {
        provider: "PAYSTACK",
        currency: "NGN",
        version: 1,
        percentageBps: 150,
        fixedMinor: 10_000,
        waiverThresholdMinor: null,
        capMinor: null,
        taxBps: 0,
        roundingRule: "HALF_UP",
      },
      expected: {
        baseAmountMinor: 1_000_000,
        platformFeeMinor: 15_000,
        gatewayFeeEstimateMinor: 25_610,
        totalAmountMinor: 1_040_610,
      },
    },
    {
      name: "waiver threshold above the subtotal omits the fixed component entirely",
      baseAmountMinor: 500_000,
      schedule: {
        provider: "PAYSTACK",
        currency: "NGN",
        version: 1,
        percentageBps: 150,
        fixedMinor: 10_000,
        waiverThresholdMinor: 2_000_000,
        capMinor: null,
        taxBps: 0,
        roundingRule: "HALF_UP",
      },
      expected: {
        baseAmountMinor: 500_000,
        platformFeeMinor: 7_500,
        gatewayFeeEstimateMinor: 7_729,
        totalAmountMinor: 515_229,
      },
    },
    {
      name: "taxBps is folded into one effective rate, not applied as a second multiplication pass",
      baseAmountMinor: 197_000,
      platformFeeBps: 0,
      schedule: {
        provider: "STRIPE",
        currency: "USD",
        version: 1,
        percentageBps: 75,
        fixedMinor: 0,
        waiverThresholdMinor: null,
        capMinor: null,
        taxBps: 75,
        roundingRule: "HALF_UP",
      },
      expected: {
        baseAmountMinor: 197_000,
        platformFeeMinor: 0,
        gatewayFeeEstimateMinor: 3_000,
        totalAmountMinor: 200_000,
      },
    },
  ];

  for (const { name, baseAmountMinor, platformFeeBps, schedule, expected } of cases) {
    it(name, () => {
      const breakdown = calculateCheckoutBreakdown({ baseAmountMinor, platformFeeBps, schedule });
      expect(breakdown).toEqual(expected);
    });
  }

  it("gatewayFeeEstimateMinor is always defined as totalAmountMinor - baseAmountMinor - platformFeeMinor, not a second calculation", () => {
    for (const { baseAmountMinor, platformFeeBps, schedule } of cases) {
      const breakdown = calculateCheckoutBreakdown({ baseAmountMinor, platformFeeBps, schedule });
      expect(breakdown.gatewayFeeEstimateMinor).toBe(
        breakdown.totalAmountMinor - breakdown.baseAmountMinor - breakdown.platformFeeMinor,
      );
    }
  });
});

describe("calculateCheckoutBreakdown — invalid schedule and overflow guards", () => {
  it("raises InvalidFeeScheduleError when percentageBps + taxBps is at or above 10000", () => {
    expect(() =>
      calculateCheckoutBreakdown({
        baseAmountMinor: 1_000,
        schedule: {
          provider: "PAYSTACK",
          currency: "NGN",
          version: 1,
          percentageBps: 10_000,
          fixedMinor: 0,
          waiverThresholdMinor: null,
          capMinor: null,
          taxBps: 0,
          roundingRule: "HALF_UP",
        },
      }),
    ).toThrow(InvalidFeeScheduleError);
  });

  it("raises InvalidFeeScheduleError when percentageBps + taxBps sums to exactly 10000 across two fields", () => {
    expect(() =>
      calculateCheckoutBreakdown({
        baseAmountMinor: 1_000,
        schedule: {
          provider: "PAYSTACK",
          currency: "NGN",
          version: 1,
          percentageBps: 9_999,
          fixedMinor: 0,
          waiverThresholdMinor: null,
          capMinor: null,
          taxBps: 1,
          roundingRule: "HALF_UP",
        },
      }),
    ).toThrow(InvalidFeeScheduleError);
  });

  it("raises InvalidFeeScheduleError for a negative fixedMinor", () => {
    expect(() =>
      calculateCheckoutBreakdown({
        baseAmountMinor: 1_000,
        schedule: { ...PAYSTACK_NIGERIA_SCHEDULE, fixedMinor: -1 },
      }),
    ).toThrow(InvalidFeeScheduleError);
  });

  it("raises InvalidFeeScheduleError for a negative capMinor", () => {
    expect(() =>
      calculateCheckoutBreakdown({
        baseAmountMinor: 1_000,
        schedule: { ...PAYSTACK_NIGERIA_SCHEDULE, capMinor: -1 },
      }),
    ).toThrow(InvalidFeeScheduleError);
  });

  it("raises InvalidFeeScheduleError for a negative waiverThresholdMinor", () => {
    expect(() =>
      calculateCheckoutBreakdown({
        baseAmountMinor: 1_000,
        schedule: { ...PAYSTACK_NIGERIA_SCHEDULE, waiverThresholdMinor: -1 },
      }),
    ).toThrow(InvalidFeeScheduleError);
  });

  it("raises MoneyOverflowError for a base amount beyond safe-integer range", () => {
    expect(() =>
      calculateCheckoutBreakdown({
        baseAmountMinor: 100_000_000_000_000,
        schedule: PAYSTACK_NIGERIA_SCHEDULE,
      }),
    ).toThrow(MoneyOverflowError);
  });

  it("raises InvalidFeeScheduleError for a negative baseAmountMinor", () => {
    expect(() =>
      calculateCheckoutBreakdown({ baseAmountMinor: -1, schedule: PAYSTACK_NIGERIA_SCHEDULE }),
    ).toThrow(InvalidFeeScheduleError);
  });

  it("raises InvalidFeeScheduleError for a non-integer baseAmountMinor", () => {
    expect(() =>
      calculateCheckoutBreakdown({ baseAmountMinor: 1.5, schedule: PAYSTACK_NIGERIA_SCHEDULE }),
    ).toThrow(InvalidFeeScheduleError);
  });
});
