/**
 * F-14b — sign-in throttling by device, not by account.
 *
 * Per-account lockout let anyone lock any account (five guesses every 15
 * minutes kept an administrator out indefinitely) and, because only real
 * accounts could lock, revealed which addresses had one. Instead, failures are
 * counted per client IP and per client IP + address, in a fixed window:
 *
 *   - 5 failures for one address from one device → that device waits;
 *   - 20 failures from one device across any addresses → that device waits.
 *
 * The owner signing in from their own device is never affected by someone
 * else's guessing. Unknown and real addresses are counted identically, so the
 * throttle reveals nothing about which accounts exist.
 *
 * When the client IP cannot be established from a trusted header, the key
 * falls back to the address alone — never to one shared "unknown" bucket,
 * which would throttle every anonymous visitor together.
 */

export const THROTTLE_WINDOW_MINUTES = 15;
export const THROTTLE_LIMITS = Object.freeze({ perIpAndEmail: 5, perIp: 20 });

export type ThrottleKey = { key: string; limit: number; email: string | null };
export type ThrottleRow = { key: string; failures: number; windowStartedAt: Date };

export function throttleKeysFor(ip: string | null, email: string): ThrottleKey[] {
  const address = email.toLowerCase().trim();
  if (!ip) {
    return [{ key: `email:${address}`, limit: THROTTLE_LIMITS.perIpAndEmail, email: address }];
  }
  return [
    { key: `ip:${ip}`, limit: THROTTLE_LIMITS.perIp, email: null },
    { key: `ip-email:${ip}|${address}`, limit: THROTTLE_LIMITS.perIpAndEmail, email: address },
  ];
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - THROTTLE_WINDOW_MINUTES * 60_000);
}

export function isThrottled(keys: ThrottleKey[], rows: ThrottleRow[], now: Date): boolean {
  const since = windowStart(now);
  return keys.some((k) => {
    const row = rows.find((r) => r.key === k.key);
    return row !== undefined && row.windowStartedAt > since && row.failures >= k.limit;
  });
}

/**
 * The client IP from a header the platform guarantees, never a
 * client-supplied one: Netlify's `x-nf-client-connection-ip`, or — behind an
 * operator's own reverse proxy — the header named in
 * `TRUSTED_CLIENT_IP_HEADER` (first value). `null` when neither is present.
 */
export function clientIpFrom(headers: Headers): string | null {
  const netlify = headers.get("x-nf-client-connection-ip")?.trim();
  if (netlify) return netlify;
  const trusted = process.env.TRUSTED_CLIENT_IP_HEADER?.trim();
  if (trusted) {
    const value = headers.get(trusted)?.split(",")[0]?.trim();
    if (value) return value;
  }
  return null;
}

/** The narrow Prisma slice the throttle needs. */
export type ThrottleStore = {
  loginThrottle: {
    findMany(args: { where: { key: { in: string[] } } }): Promise<ThrottleRow[]>;
    deleteMany(args: { where: { key: { in: string[] } } | { email: string } }): Promise<unknown>;
  };
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

export async function readThrottle(store: ThrottleStore, keys: ThrottleKey[]): Promise<ThrottleRow[]> {
  return store.loginThrottle.findMany({ where: { key: { in: keys.map((k) => k.key) } } });
}

/** Atomic count-or-restart per key, safe under concurrent failures. */
export async function recordFailure(store: ThrottleStore, keys: ThrottleKey[], now: Date): Promise<void> {
  const since = windowStart(now);
  for (const k of keys) {
    await store.$executeRaw`
      INSERT INTO "LoginThrottle" ("key", "email", "failures", "windowStartedAt", "updatedAt")
      VALUES (${k.key}, ${k.email}, 1, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "failures" = CASE WHEN "LoginThrottle"."windowStartedAt" <= ${since} THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
        "windowStartedAt" = CASE WHEN "LoginThrottle"."windowStartedAt" <= ${since} THEN ${now} ELSE "LoginThrottle"."windowStartedAt" END,
        "updatedAt" = ${now}
    `;
  }
}

/** A successful sign-in clears the device+address counter (not the device-wide one). */
export async function clearAddressKeys(store: ThrottleStore, keys: ThrottleKey[]): Promise<void> {
  const addressKeys = keys.filter((k) => k.email !== null).map((k) => k.key);
  if (addressKeys.length) await store.loginThrottle.deleteMany({ where: { key: { in: addressKeys } } });
}
