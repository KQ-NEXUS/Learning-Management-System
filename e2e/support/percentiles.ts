/**
 * Nearest-rank percentiles for the time-to-usable probe (Phase 15, plan 15-18;
 * D-03, NFR-02).
 *
 * Nearest rank: sort a copy ascending and take the value at rank
 * ceil(p / 100 * n), counting from 1. No interpolation, so a reported p75 is
 * always a time that was actually measured. The method is fixed here, before
 * any loaded or signed run, so numbers from different runs stay comparable.
 */

export function percentiles(samples: readonly number[], ps: readonly number[]): Record<number, number> {
  if (samples.length === 0) {
    throw new Error("percentiles needs at least one sample");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const result: Record<number, number> = {};
  for (const p of ps) {
    if (!(p >= 0 && p <= 100)) {
      throw new Error(`percentile must be between 0 and 100, got ${p}`);
    }
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    result[p] = sorted[rank - 1];
  }
  return result;
}
