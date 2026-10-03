/**
 * Clock policy for the software-licence module (Phase 14, plan 14-04): skew
 * tolerance, rollback detection, the high-water write throttle and a monotonic
 * monitor. Pure: the callers inject every time source.
 *
 * Evaluation always uses the current clock and never the stored high-water
 * mark. One forward clock error persisted in the database would otherwise
 * restrict every user, contradicting "rather than locking anyone out"
 * (research Pitfall 3, D-12). The high-water mark is for detection and
 * alerting only; offline clock tampering is an accepted residual risk (D-12).
 */

import { HIGH_WATER_WRITE_THROTTLE_MS, SKEW_TOLERANCE_MS } from "./constants";

/**
 * D-12: a backward jump is detected only when the high-water mark exceeds now
 * by strictly more than the skew tolerance (exactly 10 minutes is tolerated).
 */
export function detectRollback(input: {
  now: Date;
  highWaterAt: Date;
}): { rolledBack: boolean; behindMs: number } {
  const behindMs = Math.max(0, input.highWaterAt.getTime() - input.now.getTime());
  return { rolledBack: behindMs > SKEW_TOLERANCE_MS, behindMs };
}

/**
 * True only when `now` exceeds the high-water mark by strictly more than the
 * write throttle, so the allow path almost never writes.
 */
export function shouldAdvanceHighWater(input: { now: Date; highWaterAt: Date }): boolean {
  return input.now.getTime() - input.highWaterAt.getTime() > HIGH_WATER_WRITE_THROTTLE_MS;
}

/**
 * Compares wall-clock movement with monotonic movement between samples, so a
 * mid-run backward step is visible even when the database read is unavailable.
 * Each sample is measured against the previous one, so a single step is
 * reported once rather than on every later sample.
 */
export function createClockMonitor(sources: {
  wallNow: () => number;
  monotonicNow: () => number;
}): { sample(): { backwardJumpMs: number } } {
  let previous: { wall: number; monotonic: number } | null = null;
  return {
    sample() {
      const current = { wall: sources.wallNow(), monotonic: sources.monotonicNow() };
      const before = previous;
      previous = current;
      if (before === null) return { backwardJumpMs: 0 };
      const wallDelta = current.wall - before.wall;
      const monotonicDelta = current.monotonic - before.monotonic;
      return { backwardJumpMs: Math.max(0, monotonicDelta - wallDelta) };
    },
  };
}

/** UTC hour bucket (YYYY-MM-DDTHH): the dedupe key suffix of the clock-rollback notice. */
export function utcHourBucket(date: Date): string {
  return date.toISOString().slice(0, 13);
}
