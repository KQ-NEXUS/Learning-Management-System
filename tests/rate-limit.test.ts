/**
 * D-11, NFR-04 — the generalised entry-point limiter (plan 15-03).
 *
 * Pure-module proof in the style of tests/sign-in-throttle.test.ts: key
 * namespacing per scope, the no-trusted-IP fallback (never one shared
 * bucket), the N / N+1 boundary, and the exact 15-minute window edge. The
 * real-Postgres atomicity proof is tests/rate-limit.integration.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  consumeAttempts,
  isOverLimit,
  RATE_LIMITS,
  RATE_LIMIT_WINDOW_MINUTES,
  rateLimitKeysFor,
  type RateLimitStore,
} from "@/server/auth/rate-limit";

const NOW = new Date("2026-10-06T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("limits and window (ledger A13)", () => {
  it("are the documented per-device and per-learner numbers over 15 minutes", () => {
    expect(RATE_LIMIT_WINDOW_MINUTES).toBe(15);
    expect(RATE_LIMITS).toEqual({
      register: { perDevice: 30 },
      forgotPassword: { perDevice: 20 },
      resendVerification: { perDevice: 20 },
      certificateCheck: { perDevice: 60 },
      supportTicket: { perLearner: 5 },
    });
    expect(Object.isFrozen(RATE_LIMITS)).toBe(true);
    expect(Object.isFrozen(RATE_LIMITS.register)).toBe(true);
  });
});

describe("rateLimitKeysFor — namespaced per scope, never a shared bucket", () => {
  it("keys a known device per scope", () => {
    const ip = "203.0.113.9";
    expect(rateLimitKeysFor("register", { ip, email: "Ada@Example.com" })).toEqual([
      { key: "register:ip:203.0.113.9", limit: 30, email: null },
    ]);
    expect(rateLimitKeysFor("forgotPassword", { ip, email: "ada@example.com" })).toEqual([
      { key: "forgot:ip:203.0.113.9", limit: 20, email: null },
    ]);
    expect(rateLimitKeysFor("resendVerification", { ip, email: "ada@example.com" })).toEqual([
      { key: "resend:ip:203.0.113.9", limit: 20, email: null },
    ]);
    expect(rateLimitKeysFor("certificateCheck", { ip })).toEqual([
      { key: "cert-check:ip:203.0.113.9", limit: 60, email: null },
    ]);
  });

  it("keys a support request by learner, never by device", () => {
    expect(rateLimitKeysFor("supportTicket", { ip: "203.0.113.9", userId: "user_1" })).toEqual([
      { key: "ticket:user:user_1", limit: 5, email: null },
    ]);
    expect(rateLimitKeysFor("supportTicket", { ip: null, userId: "user_1" })).toEqual([
      { key: "ticket:user:user_1", limit: 5, email: null },
    ]);
  });

  it("falls back to a per-address key with the same limit when no trusted IP exists", () => {
    expect(rateLimitKeysFor("register", { ip: null, email: "  Ada@Example.COM " })).toEqual([
      { key: "register:email:ada@example.com", limit: 30, email: "ada@example.com" },
    ]);
    expect(rateLimitKeysFor("forgotPassword", { ip: null, email: "ada@example.com" })).toEqual([
      { key: "forgot:email:ada@example.com", limit: 20, email: "ada@example.com" },
    ]);
    expect(rateLimitKeysFor("resendVerification", { ip: null, email: "ada@example.com" })).toEqual([
      { key: "resend:email:ada@example.com", limit: 20, email: "ada@example.com" },
    ]);
  });

  it("applies no limit to the certificate check without a trusted IP", () => {
    expect(rateLimitKeysFor("certificateCheck", { ip: null })).toEqual([]);
  });

  it("never produces a shared key: no IP and no address yields no key", () => {
    expect(rateLimitKeysFor("register", { ip: null, email: "" })).toEqual([]);
    expect(rateLimitKeysFor("supportTicket", { ip: null })).toEqual([]);
    const all = [
      ...rateLimitKeysFor("register", { ip: null }),
      ...rateLimitKeysFor("forgotPassword", { ip: null }),
      ...rateLimitKeysFor("resendVerification", { ip: null }),
    ];
    expect(all).toEqual([]);
  });
});

describe("isOverLimit — attempts 1..N allowed, N+1 refused", () => {
  const keys = rateLimitKeysFor("forgotPassword", { ip: "203.0.113.9" });

  it("false at the limit, true one past it", () => {
    expect(isOverLimit(keys, [{ key: keys[0].key, failures: 1 }])).toBe(false);
    expect(isOverLimit(keys, [{ key: keys[0].key, failures: 20 }])).toBe(false);
    expect(isOverLimit(keys, [{ key: keys[0].key, failures: 21 }])).toBe(true);
  });

  it("ignores counts for keys it was not given, and is false with no keys", () => {
    expect(isOverLimit(keys, [{ key: "other", failures: 999 }])).toBe(false);
    expect(isOverLimit([], [])).toBe(false);
  });
});

/**
 * A fake store that applies the same window rule as the SQL statement, reading
 * the bound values by position (key, email, now, now, since, since, now, now).
 * It checks the statement shape too, so a rewrite that drops the atomic
 * upsert or the RETURNING clause fails here before the integration suite.
 */
function fakeStore(rows: Map<string, { failures: number; windowStartedAt: Date }>) {
  const statements: string[] = [];
  const store: RateLimitStore = {
    async $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      statements.push(query.join("?"));
      const key = values[0] as string;
      const now = values[2] as Date;
      const since = values[4] as Date;
      const existing = rows.get(key);
      const next =
        !existing || existing.windowStartedAt <= since
          ? { failures: 1, windowStartedAt: now }
          : { failures: existing.failures + 1, windowStartedAt: existing.windowStartedAt };
      rows.set(key, next);
      return [{ key, failures: next.failures }] as T;
    },
  };
  return { store, statements };
}

describe("consumeAttempts — one atomic upsert per key, returning the count", () => {
  const keys = rateLimitKeysFor("register", { ip: "203.0.113.9" });

  it("issues INSERT ... ON CONFLICT ... RETURNING and returns the new count", async () => {
    const { store, statements } = fakeStore(new Map());
    expect(await consumeAttempts(store, keys, NOW)).toEqual([{ key: keys[0].key, failures: 1 }]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('INSERT INTO "LoginThrottle"');
    expect(statements[0]).toContain('ON CONFLICT ("key")');
    expect(statements[0]).toContain('RETURNING "key", "failures"');
  });

  it("an attempt at exactly 15 minutes after windowStartedAt starts a new window", async () => {
    const rows = new Map([[keys[0].key, { failures: 30, windowStartedAt: minutesAgo(15) }]]);
    const { store } = fakeStore(rows);
    const counts = await consumeAttempts(store, keys, NOW);
    expect(counts).toEqual([{ key: keys[0].key, failures: 1 }]);
    expect(isOverLimit(keys, counts)).toBe(false);
    expect(rows.get(keys[0].key)?.windowStartedAt).toEqual(NOW);
  });

  it("one millisecond inside the window still counts against it", async () => {
    const rows = new Map([
      [keys[0].key, { failures: 30, windowStartedAt: new Date(minutesAgo(15).getTime() + 1) }],
    ]);
    const { store } = fakeStore(rows);
    const counts = await consumeAttempts(store, keys, NOW);
    expect(counts).toEqual([{ key: keys[0].key, failures: 31 }]);
    expect(isOverLimit(keys, counts)).toBe(true);
  });

  it("does nothing for an empty key list", async () => {
    const { store, statements } = fakeStore(new Map());
    expect(await consumeAttempts(store, [], NOW)).toEqual([]);
    expect(statements).toHaveLength(0);
  });
});
