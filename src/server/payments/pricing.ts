/**
 * Pure integer money calculator for KQ NEXUS's checkout pricing (D-10, D-11,
 * D-12, D-24, D-25).
 *
 * This file imports nothing — no Prisma, no Stripe, no Paystack, no React,
 * no browser API — on purpose. It is called from both provider adapter
 * directories (`providers/stripe/` and `providers/paystack/`), and any
 * provider or Prisma import here would break the PAY-09 provider-isolation
 * invariant that `tests/checkout-phase-invariants.test.ts` mechanically
 * enforces. Keeping it dependency-free also makes the two formulas the
 * entire commercial model rests on (D-10 and D-12) exhaustively testable
 * without a database, a provider account, or a browser.
 *
 * All arithmetic is integer-only, on minor currency units (kobo/cents), with
 * checked overflow and a single deterministic rounding rule (D-24). No
 * floating-point calculation is allowed anywhere in this module.
 */

/** KQ NEXUS's platform fee: 150 basis points (1.5%) of the base price (D-10). */
export const PLATFORM_FEE_BPS = 150;

/** The two currencies this deployment can charge in (D-06, D-07). */
export type SupportedCurrency = "NGN" | "USD";

/**
 * Plain-value mirror of the `GatewayFeeSchedule` Prisma model's columns
 * (07-02). Declared as plain values — not imported from `@prisma/client` —
 * so this calculator stays dependency-free and its tests need no database.
 */
export type GatewayFeeScheduleValues = {
  provider: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency: SupportedCurrency;
  version: number;
  percentageBps: number;
  fixedMinor: number;
  waiverThresholdMinor: number | null;
  capMinor: number | null;
  taxBps: number;
  roundingRule: string;
};

export type PricingInput = {
  baseAmountMinor: number;
  /** Overrides `PLATFORM_FEE_BPS`. Exposed for testability; production callers should omit it. */
  platformFeeBps?: number;
  schedule: GatewayFeeScheduleValues;
};

export type CheckoutBreakdown = {
  baseAmountMinor: number;
  platformFeeMinor: number;
  gatewayFeeEstimateMinor: number;
  totalAmountMinor: number;
};

/** A `GatewayFeeSchedule` (or an input amount) that cannot produce a valid, safe result. */
export class InvalidFeeScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFeeScheduleError";
  }
}

/** A monetary calculation would exceed `Number.MAX_SAFE_INTEGER`. Thrown instead of returning a silently wrong amount. */
export class MoneyOverflowError extends Error {
  constructor(message = "Money calculation exceeded the safe integer range.") {
    super(message);
    this.name = "MoneyOverflowError";
  }
}

const BPS_DENOMINATOR = 10_000;

function assertSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyOverflowError(`${label} is not a safe integer: ${value}.`);
  }
  return value;
}

function safeAdd(a: number, b: number, label: string): number {
  return assertSafeInteger(a + b, label);
}

function safeMultiply(a: number, b: number, label: string): number {
  return assertSafeInteger(a * b, label);
}

/** Integer division rounding up. `numerator` and `denominator` must both already be safe integers, `denominator > 0`. */
function ceilDiv(numerator: number, denominator: number, label: string): number {
  const adjusted = safeAdd(numerator, denominator - 1, label);
  return Math.trunc(adjusted / denominator);
}

function assertValidBaseAmount(baseAmountMinor: number): void {
  if (!Number.isInteger(baseAmountMinor) || baseAmountMinor < 0) {
    throw new InvalidFeeScheduleError(
      `baseAmountMinor must be a non-negative integer, received ${baseAmountMinor}.`,
    );
  }
}

function assertValidSchedule(schedule: GatewayFeeScheduleValues): void {
  const effectiveBps = schedule.percentageBps + schedule.taxBps;
  if (effectiveBps < 0 || effectiveBps >= BPS_DENOMINATOR) {
    throw new InvalidFeeScheduleError(
      `Combined gateway rate (percentageBps ${schedule.percentageBps} + taxBps ${schedule.taxBps} = ${effectiveBps} bps) must be less than ${BPS_DENOMINATOR} bps.`,
    );
  }
  if (schedule.fixedMinor < 0) {
    throw new InvalidFeeScheduleError(`fixedMinor must not be negative, received ${schedule.fixedMinor}.`);
  }
  if (schedule.capMinor !== null && schedule.capMinor < 0) {
    throw new InvalidFeeScheduleError(`capMinor must not be negative, received ${schedule.capMinor}.`);
  }
  if (schedule.waiverThresholdMinor !== null && schedule.waiverThresholdMinor < 0) {
    throw new InvalidFeeScheduleError(
      `waiverThresholdMinor must not be negative, received ${schedule.waiverThresholdMinor}.`,
    );
  }
}

/**
 * KQ NEXUS's platform fee (D-10): `roundHalfUp(baseAmountMinor * bps / 10_000)`,
 * computed from the base price — never from the learner's grossed-up total.
 *
 * Implemented as pure integer arithmetic: multiply first, then divide with an
 * explicit half-up adjustment (`(n + 5_000) / 10_000`, truncated), so no
 * intermediate value is a fraction of a minor unit carried through a later
 * multiplication.
 */
export function calculatePlatformFeeMinor(baseAmountMinor: number, bps: number = PLATFORM_FEE_BPS): number {
  assertValidBaseAmount(baseAmountMinor);
  const scaled = safeMultiply(baseAmountMinor, bps, "baseAmountMinor * platformFeeBps");
  const numerator = safeAdd(scaled, BPS_DENOMINATOR / 2, "baseAmountMinor * platformFeeBps + half-up adjustment");
  return Math.trunc(numerator / BPS_DENOMINATOR);
}

/**
 * The full checkout breakdown (D-12): base price, KQ's platform fee, the
 * estimated gateway gross-up, and the learner's total.
 *
 * Order of operations, per D-12 — each step matters:
 *  1. Compute the platform fee from the base (D-10).
 *  2. Apply the waiver threshold to the *subtotal* (base + platform fee):
 *     below the threshold, the schedule's fixed component is omitted.
 *  3. Compute the uncapped gross-up: `ceil((subtotal + fixed) / (1 - rate))`,
 *     with `rate` the combined `percentageBps + taxBps` folded into one
 *     effective rate (never applied as two sequential multiplications).
 *  4. Clamp the gateway estimate to `capMinor` when the schedule has one.
 *     This produces the cap exactly, with no rounding remainder added on
 *     top: `totalAmountMinor` is re-derived from the (possibly clamped)
 *     gateway estimate, not from the pre-clamp rounded value.
 */
export function calculateCheckoutBreakdown(input: PricingInput): CheckoutBreakdown {
  const { baseAmountMinor, schedule } = input;
  const platformFeeBps = input.platformFeeBps ?? PLATFORM_FEE_BPS;

  assertValidSchedule(schedule);
  // Validates baseAmountMinor and guards the multiplication for overflow.
  const platformFeeMinor = calculatePlatformFeeMinor(baseAmountMinor, platformFeeBps);

  const subtotalMinor = safeAdd(baseAmountMinor, platformFeeMinor, "baseAmountMinor + platformFeeMinor");

  const fixedMinor =
    schedule.waiverThresholdMinor !== null && subtotalMinor < schedule.waiverThresholdMinor
      ? 0
      : schedule.fixedMinor;

  const effectiveBps = schedule.percentageBps + schedule.taxBps;
  const denominatorBps = BPS_DENOMINATOR - effectiveBps; // > 0, guaranteed by assertValidSchedule

  const grossBaseMinor = safeAdd(subtotalMinor, fixedMinor, "subtotal + fixedMinor");
  const grossNumerator = safeMultiply(grossBaseMinor, BPS_DENOMINATOR, "(subtotal + fixedMinor) * 10_000");
  const uncappedTotalMinor = ceilDiv(grossNumerator, denominatorBps, "gross-up ceiling division");

  let gatewayFeeEstimateMinor = uncappedTotalMinor - subtotalMinor;
  if (schedule.capMinor !== null && gatewayFeeEstimateMinor > schedule.capMinor) {
    gatewayFeeEstimateMinor = schedule.capMinor;
  }

  const totalAmountMinor = safeAdd(subtotalMinor, gatewayFeeEstimateMinor, "subtotal + gatewayFeeEstimateMinor");

  return {
    baseAmountMinor,
    platformFeeMinor,
    gatewayFeeEstimateMinor,
    totalAmountMinor,
  };
}
