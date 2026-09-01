import { describe, expect, it } from "vitest";
import {
  isLockedOut,
  nextFailureState,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
} from "@/server/auth/lockout";

const NOW = new Date("2026-09-01T12:00:00Z");

describe("isLockedOut", () => {
  it("is false when there is no lockout", () => {
    expect(isLockedOut({ lockedUntil: null }, NOW)).toBe(false);
  });

  it("is true while the lockout is in the future", () => {
    expect(isLockedOut({ lockedUntil: new Date("2026-09-01T12:05:00Z") }, NOW)).toBe(true);
  });

  it("is false once the lockout has passed", () => {
    expect(isLockedOut({ lockedUntil: new Date("2026-09-01T11:55:00Z") }, NOW)).toBe(false);
  });
});

describe("nextFailureState", () => {
  it("increments without locking below the threshold", () => {
    const state = nextFailureState(0, NOW);
    expect(state.failedLoginAttempts).toBe(1);
    expect(state.lockedUntil).toBeNull();
  });

  it("locks on reaching the threshold", () => {
    const state = nextFailureState(MAX_FAILED_ATTEMPTS - 1, NOW);
    expect(state.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(state.lockedUntil).toEqual(
      new Date(NOW.getTime() + LOCKOUT_MINUTES * 60_000),
    );
  });

  it("keeps extending the lockout beyond the threshold", () => {
    const state = nextFailureState(MAX_FAILED_ATTEMPTS + 3, NOW);
    expect(state.lockedUntil).not.toBeNull();
  });
});
