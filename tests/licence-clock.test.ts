/**
 * Clock policy (plan 14-04, D-12): exact 10-minute and 5-minute boundaries.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HIGH_WATER_WRITE_THROTTLE_MS,
  SKEW_TOLERANCE_MS,
} from "@/server/licence/constants";
import {
  createClockMonitor,
  detectRollback,
  shouldAdvanceHighWater,
  utcHourBucket,
} from "@/server/licence/clock";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("detectRollback (D-12)", () => {
  it("Test 4: a high-water mark exactly 10 minutes ahead is tolerated; 10 minutes plus 1 ms is a rollback", () => {
    expect(SKEW_TOLERANCE_MS).toBe(10 * 60 * 1000);
    const tolerated = detectRollback({ now: NOW, highWaterAt: at(SKEW_TOLERANCE_MS) });
    expect(tolerated).toEqual({ rolledBack: false, behindMs: SKEW_TOLERANCE_MS });

    const rolledBack = detectRollback({ now: NOW, highWaterAt: at(SKEW_TOLERANCE_MS + 1) });
    expect(rolledBack.rolledBack).toBe(true);
    expect(rolledBack.behindMs).toBe(SKEW_TOLERANCE_MS + 1);
  });

  it("a high-water mark in the past reports zero behind and no rollback", () => {
    expect(detectRollback({ now: NOW, highWaterAt: at(-60_000) })).toEqual({ rolledBack: false, behindMs: 0 });
    expect(detectRollback({ now: NOW, highWaterAt: NOW })).toEqual({ rolledBack: false, behindMs: 0 });
  });
});

describe("shouldAdvanceHighWater (D-12 throttle)", () => {
  it("Test 5: false up to exactly 5 minutes after the mark; true one millisecond beyond; false when now is before the mark", () => {
    expect(HIGH_WATER_WRITE_THROTTLE_MS).toBe(5 * 60 * 1000);
    const highWaterAt = NOW;
    expect(shouldAdvanceHighWater({ now: highWaterAt, highWaterAt })).toBe(false);
    expect(
      shouldAdvanceHighWater({ now: new Date(highWaterAt.getTime() + HIGH_WATER_WRITE_THROTTLE_MS), highWaterAt }),
    ).toBe(false);
    expect(
      shouldAdvanceHighWater({
        now: new Date(highWaterAt.getTime() + HIGH_WATER_WRITE_THROTTLE_MS + 1),
        highWaterAt,
      }),
    ).toBe(true);
    expect(shouldAdvanceHighWater({ now: new Date(highWaterAt.getTime() - 1), highWaterAt })).toBe(false);
  });
});

describe("createClockMonitor", () => {
  function monitorWith() {
    let wall = 1_000_000;
    let mono = 5_000;
    const monitor = createClockMonitor({ wallNow: () => wall, monotonicNow: () => mono });
    return {
      monitor,
      advance(wallDelta: number, monoDelta: number) {
        wall += wallDelta;
        mono += monoDelta;
      },
    };
  }

  it("Test 6: reports 0 on the first sample", () => {
    const { monitor } = monitorWith();
    expect(monitor.sample()).toEqual({ backwardJumpMs: 0 });
  });

  it("reports the amount wall time lags monotonic time after a backward step", () => {
    const { monitor, advance } = monitorWith();
    monitor.sample();
    // 60 s of real time passed but the wall clock was stepped back 30 s.
    advance(60_000 - 90_000, 60_000);
    expect(monitor.sample()).toEqual({ backwardJumpMs: 90_000 });
  });

  it("reports 0 for a forward step and for agreeing clocks", () => {
    const { monitor, advance } = monitorWith();
    monitor.sample();
    advance(60_000 + 3_600_000, 60_000);
    expect(monitor.sample()).toEqual({ backwardJumpMs: 0 });
    advance(1_000, 1_000);
    expect(monitor.sample()).toEqual({ backwardJumpMs: 0 });
  });

  it("reports a single step once, not on every later sample", () => {
    const { monitor, advance } = monitorWith();
    monitor.sample();
    advance(-120_000, 0);
    expect(monitor.sample().backwardJumpMs).toBe(120_000);
    advance(10_000, 10_000);
    expect(monitor.sample().backwardJumpMs).toBe(0);
  });
});

describe("utcHourBucket", () => {
  it("Test 7: returns the UTC hour for any instant inside it", () => {
    expect(utcHourBucket(new Date("2026-10-01T14:00:00.000Z"))).toBe("2026-10-01T14");
    expect(utcHourBucket(new Date("2026-10-01T14:37:12.345Z"))).toBe("2026-10-01T14");
    expect(utcHourBucket(new Date("2026-10-01T14:59:59.999Z"))).toBe("2026-10-01T14");
    expect(utcHourBucket(new Date("2026-10-01T15:00:00.000Z"))).toBe("2026-10-01T15");
  });
});

describe("clock.ts documents that evaluation never uses the high-water mark (T-14-04-02)", () => {
  it("states the rule in its header and imports only ./constants", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/server/licence/clock.ts"), "utf8");
    expect(source).toContain("never the stored high-water");
    expect(source).toContain("rather than locking anyone out");
    expect(source.includes("new Date()")).toBe(false);
    expect(source.includes("Date.now()")).toBe(false);
  });
});
