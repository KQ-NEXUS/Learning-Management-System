import { describe, expect, it } from "vitest";
import {
  assertArrangementSize,
  MAX_ARRANGEMENT_SIZE,
  nextAppendPosition,
  parkedWithdrawnPosition,
  WITHDRAWN_PARK_BASE,
} from "@/lib/positions";

describe("positions — the shared two-band convention (D-17, D-34)", () => {
  it("WITHDRAWN_PARK_BASE is -1,000,000", () => {
    expect(WITHDRAWN_PARK_BASE).toBe(-1_000_000);
  });

  it("MAX_ARRANGEMENT_SIZE is 100,000", () => {
    expect(MAX_ARRANGEMENT_SIZE).toBe(100_000);
  });

  it("parkedWithdrawnPosition(null) returns WITHDRAWN_PARK_BASE - 1 (first withdrawal for this parent)", () => {
    expect(parkedWithdrawnPosition(null)).toBe(WITHDRAWN_PARK_BASE - 1);
  });

  it("parkedWithdrawnPosition(5) (the minimum sibling position is a live 5) returns WITHDRAWN_PARK_BASE - 1", () => {
    expect(parkedWithdrawnPosition(5)).toBe(WITHDRAWN_PARK_BASE - 1);
  });

  it("parkedWithdrawnPosition(-1000001) returns -1000002 — each withdrawal parks one slot deeper", () => {
    expect(parkedWithdrawnPosition(-1_000_001)).toBe(-1_000_002);
  });

  it("two successive withdrawals from the same parent never collide", () => {
    const first = parkedWithdrawnPosition(null);
    const second = parkedWithdrawnPosition(first);
    const third = parkedWithdrawnPosition(second);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("every value parkedWithdrawnPosition can return is strictly less than -MAX_ARRANGEMENT_SIZE", () => {
    const samples = [null, 0, 5, -1, -50, -999_999, -1_000_000, -1_000_001, -2_000_000];
    for (const s of samples) {
      expect(parkedWithdrawnPosition(s)).toBeLessThan(-MAX_ARRANGEMENT_SIZE);
    }
  });

  it("nextAppendPosition(null) returns 0 (empty parent)", () => {
    expect(nextAppendPosition(null)).toBe(0);
  });

  it("nextAppendPosition(4) returns 5", () => {
    expect(nextAppendPosition(4)).toBe(5);
  });

  it("nextAppendPosition(-1000002) returns 0 — a parent whose only rows are withdrawn appends at 0, not a negative successor", () => {
    expect(nextAppendPosition(-1_000_002)).toBe(0);
  });

  it("nextAppendPosition never returns a negative number", () => {
    const samples = [null, 0, 1, 100, -1, -5, -1_000_001, -1_000_002, -2_000_000];
    for (const s of samples) {
      expect(nextAppendPosition(s)).toBeGreaterThanOrEqual(0);
    }
  });

  it("assertArrangementSize throws for n > MAX_ARRANGEMENT_SIZE", () => {
    expect(() => assertArrangementSize(MAX_ARRANGEMENT_SIZE + 1)).toThrow();
  });

  it("assertArrangementSize passes for n <= MAX_ARRANGEMENT_SIZE", () => {
    expect(() => assertArrangementSize(MAX_ARRANGEMENT_SIZE)).not.toThrow();
    expect(() => assertArrangementSize(0)).not.toThrow();
    expect(() => assertArrangementSize(1)).not.toThrow();
  });
});
