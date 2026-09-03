import { describe, expect, it } from "vitest";
import {
  isInCooldown,
  cooldownRemainingMs,
  REQUEST_COOLDOWN_MS,
} from "@/server/auth/request-cooldown";

const NOW = new Date("2026-09-02T12:00:00Z");

describe("isInCooldown", () => {
  it("is false when there is no prior issue", () => {
    expect(isInCooldown(null, NOW)).toBe(false);
  });

  it("is true inside the cooldown window", () => {
    const lastIssuedAt = new Date(NOW.getTime() - 30_000);
    expect(isInCooldown(lastIssuedAt, NOW)).toBe(true);
  });

  it("is allowed exactly at the boundary (inclusive)", () => {
    const lastIssuedAt = new Date(NOW.getTime() - REQUEST_COOLDOWN_MS);
    expect(isInCooldown(lastIssuedAt, NOW)).toBe(false);
  });

  it("is blocked one millisecond before the boundary", () => {
    const lastIssuedAt = new Date(NOW.getTime() - (REQUEST_COOLDOWN_MS - 1));
    expect(isInCooldown(lastIssuedAt, NOW)).toBe(true);
  });

  it("is false once the window has fully passed", () => {
    const lastIssuedAt = new Date(NOW.getTime() - 120_000);
    expect(isInCooldown(lastIssuedAt, NOW)).toBe(false);
  });
});

describe("cooldownRemainingMs", () => {
  it("is 0 when there is no prior issue", () => {
    expect(cooldownRemainingMs(null, NOW)).toBe(0);
  });

  it("is 0 once the window has passed", () => {
    const lastIssuedAt = new Date(NOW.getTime() - REQUEST_COOLDOWN_MS);
    expect(cooldownRemainingMs(lastIssuedAt, NOW)).toBe(0);
  });

  it("reports the remaining milliseconds inside the window", () => {
    const lastIssuedAt = new Date(NOW.getTime() - 40_000);
    expect(cooldownRemainingMs(lastIssuedAt, NOW)).toBe(20_000);
  });
});
