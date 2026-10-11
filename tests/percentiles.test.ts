/**
 * Nearest-rank percentiles for the time-to-usable probe (Phase 15, plan 15-18;
 * D-03, NFR-02). The boundaries are exact because the signed p75 depends on
 * the method being fixed before any run.
 */

import { describe, expect, it } from "vitest";
import { percentiles } from "../e2e/support/percentiles";

describe("percentiles (nearest rank)", () => {
  const oneToHundred = Array.from({ length: 100 }, (_, index) => index + 1);

  it("returns the value at the matching rank for 1..100", () => {
    expect(percentiles(oneToHundred, [50, 75, 95])).toEqual({ 50: 50, 75: 75, 95: 95 });
  });

  it("rounds the rank up: p75 of four samples is the third, not an interpolation", () => {
    expect(percentiles([10, 20, 30, 40], [75])).toEqual({ 75: 30 });
    // 0.75 * 5 = 3.75, so the fourth value.
    expect(percentiles([10, 20, 30, 40, 50], [75])).toEqual({ 75: 40 });
  });

  it("does not depend on the input order and does not mutate the input", () => {
    const shuffled = [40, 10, 30, 20];
    expect(percentiles(shuffled, [50, 100])).toEqual({ 50: 20, 100: 40 });
    expect(shuffled).toEqual([40, 10, 30, 20]);
  });

  it("returns the single sample for every percentile", () => {
    expect(percentiles([1234], [50, 75, 95])).toEqual({ 50: 1234, 75: 1234, 95: 1234 });
  });

  it("covers the extremes: p0 is the smallest sample and p100 the largest", () => {
    expect(percentiles([5, 1, 9], [0, 100])).toEqual({ 0: 1, 100: 9 });
  });

  it("throws on an empty array", () => {
    expect(() => percentiles([], [50])).toThrow(/at least one sample/i);
  });

  it("throws on a percentile outside 0 to 100", () => {
    expect(() => percentiles([1, 2, 3], [101])).toThrow(/between 0 and 100/i);
    expect(() => percentiles([1, 2, 3], [-1])).toThrow(/between 0 and 100/i);
  });
});
