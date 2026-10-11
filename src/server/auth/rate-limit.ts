/**
 * D-11, NFR-04 — rate limits for the public and learner entry points
 * (plan 15-03), generalised from the sign-in throttle (F-14b).
 *
 * Sign-in has its own failure-counting throttle in `sign-in-throttle.ts`. This
 * module counts every ATTEMPT at five more entry points, in the same
 * `LoginThrottle` table and the same fixed 15-minute window, so the counter
 * lives in Postgres and works across serverless instances that share no
 * memory. There is deliberately no in-memory store here.
 *
 *   - register, forgot password, resend verification and the public
 *     certificate check are limited per device (the client IP from
 *     `clientIpFrom`, which trusts only platform headers);
 *   - a new support request is limited per learner (the signed-in user id).
 *
 * The per-device numbers are loose on purpose (Pitfall 6, P7): mobile
 * carriers and NAT put many learners behind one address, so a strict
 * per-device threshold would throttle a whole cohort. The strict per-address
 * protection stays the silent 60-second cooldown in `request-cooldown.ts`,
 * which shows the normal confirmation and so reveals nothing about accounts.
 *
 * Keys are namespaced per scope. When no trusted client IP exists, register,
 * forgot password and resend verification fall back to a per-address key
 * with the same limit — never one shared "unknown" bucket, which would
 * throttle every anonymous visitor together. The certificate check carries
 * no address, so without an IP it applies no limit and records nothing.
 *
 * Known and unknown addresses produce identical keys and counts: the limiter
 * never looks an account up (P4).
 */

import { THROTTLE_WINDOW_MINUTES, type ThrottleKey } from "@/server/auth/sign-in-throttle";

export const RATE_LIMIT_WINDOW_MINUTES = THROTTLE_WINDOW_MINUTES;

/** Attempts allowed per 15-minute window (ledger A13). */
export const RATE_LIMITS = Object.freeze({
  register: Object.freeze({ perDevice: 30 }),
  forgotPassword: Object.freeze({ perDevice: 20 }),
  resendVerification: Object.freeze({ perDevice: 20 }),
  certificateCheck: Object.freeze({ perDevice: 60 }),
  supportTicket: Object.freeze({ perLearner: 5 }),
});

export type RateLimitScope = keyof typeof RATE_LIMITS;

export type RateLimitSubject = { ip: string | null; email?: string; userId?: string };

export type RateLimitCount = { key: string; failures: number };

/** Key prefixes for the device-limited scopes that carry an address. */
const ADDRESS_SCOPES = {
  register: "register",
  forgotPassword: "forgot",
  resendVerification: "resend",
} as const;

export function rateLimitKeysFor(scope: RateLimitScope, subject: RateLimitSubject): ThrottleKey[] {
  if (scope === "supportTicket") {
    const userId = subject.userId?.trim();
    return userId ? [{ key: `ticket:user:${userId}`, limit: RATE_LIMITS.supportTicket.perLearner, email: null }] : [];
  }

  if (scope === "certificateCheck") {
    return subject.ip
      ? [{ key: `cert-check:ip:${subject.ip}`, limit: RATE_LIMITS.certificateCheck.perDevice, email: null }]
      : [];
  }

  const prefix = ADDRESS_SCOPES[scope];
  const limit = RATE_LIMITS[scope].perDevice;
  if (subject.ip) return [{ key: `${prefix}:ip:${subject.ip}`, limit, email: null }];

  const address = (subject.email ?? "").toLowerCase().trim();
  return address ? [{ key: `${prefix}:email:${address}`, limit, email: address }] : [];
}

/** True when any key's count, after this attempt, is past its limit (attempt N+1). */
export function isOverLimit(keys: readonly ThrottleKey[], counts: readonly RateLimitCount[]): boolean {
  return keys.some((k) => {
    const row = counts.find((c) => c.key === k.key);
    return row !== undefined && row.failures > k.limit;
  });
}

/**
 * The narrow Prisma slice the limiter needs: `$queryRaw` only, so the
 * increment and the count it returns are one statement.
 */
export type RateLimitStore = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/**
 * Counts one attempt per key and returns the new counts. Each key is one
 * `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement, so the
 * count read is atomic with the increment and 2N concurrent attempts allow
 * exactly N. The window reset is the same CASE as `recordFailure`: a row
 * whose window started at or before `now - 15 minutes` restarts at 1.
 */
export async function consumeAttempts(
  store: RateLimitStore,
  keys: readonly ThrottleKey[],
  now: Date,
): Promise<RateLimitCount[]> {
  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60_000);
  const counts: RateLimitCount[] = [];
  for (const k of keys) {
    const rows = await store.$queryRaw<RateLimitCount[]>`
      INSERT INTO "LoginThrottle" ("key", "email", "failures", "windowStartedAt", "updatedAt")
      VALUES (${k.key}, ${k.email}, 1, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "failures" = CASE WHEN "LoginThrottle"."windowStartedAt" <= ${since} THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
        "windowStartedAt" = CASE WHEN "LoginThrottle"."windowStartedAt" <= ${since} THEN ${now} ELSE "LoginThrottle"."windowStartedAt" END,
        "updatedAt" = ${now}
      RETURNING "key", "failures"
    `;
    const row = rows[0];
    if (row) counts.push({ key: row.key, failures: Number(row.failures) });
  }
  return counts;
}
