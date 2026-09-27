import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientIpFrom,
  isThrottled,
  throttleKeysFor,
  THROTTLE_LIMITS,
  THROTTLE_WINDOW_MINUTES,
} from "@/server/auth/sign-in-throttle";

const NOW = new Date("2026-09-27T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

afterEach(() => vi.unstubAllEnvs());

describe("F-14b — throttle keys are per device, never per account alone", () => {
  it("a known IP gives an IP key and an IP+email key", () => {
    expect(throttleKeysFor("203.0.113.9", "Ada@Example.com")).toEqual([
      { key: "ip:203.0.113.9", limit: THROTTLE_LIMITS.perIp, email: null },
      { key: "ip-email:203.0.113.9|ada@example.com", limit: THROTTLE_LIMITS.perIpAndEmail, email: "ada@example.com" },
    ]);
  });

  it("an unknown IP falls back to a per-email key only (never one shared global IP bucket)", () => {
    expect(throttleKeysFor(null, "ada@example.com")).toEqual([
      { key: "email:ada@example.com", limit: THROTTLE_LIMITS.perIpAndEmail, email: "ada@example.com" },
    ]);
  });

  it("limits: 5 per device+email, 20 per device, within a 15-minute window", () => {
    expect(THROTTLE_LIMITS).toEqual({ perIpAndEmail: 5, perIp: 20 });
    expect(THROTTLE_WINDOW_MINUTES).toBe(15);
  });
});

describe("isThrottled", () => {
  const keys = throttleKeysFor("203.0.113.9", "ada@example.com");

  it("true once a key reaches its limit inside the window", () => {
    expect(isThrottled(keys, [{ key: keys[1].key, failures: 5, windowStartedAt: minutesAgo(3) }], NOW)).toBe(true);
    expect(isThrottled(keys, [{ key: keys[0].key, failures: 20, windowStartedAt: minutesAgo(3) }], NOW)).toBe(true);
  });

  it("false below the limit, and false once the window has passed", () => {
    expect(isThrottled(keys, [{ key: keys[1].key, failures: 4, windowStartedAt: minutesAgo(3) }], NOW)).toBe(false);
    expect(isThrottled(keys, [{ key: keys[1].key, failures: 9, windowStartedAt: minutesAgo(16) }], NOW)).toBe(false);
  });
});

describe("clientIpFrom — only trusted headers", () => {
  it("uses Netlify's client IP header", () => {
    expect(clientIpFrom(new Headers({ "x-nf-client-connection-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" }))).toBe(
      "198.51.100.7",
    );
  });

  it("ignores a spoofable X-Forwarded-For unless an operator names it as trusted", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBeNull();
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "X-Forwarded-For");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
});
