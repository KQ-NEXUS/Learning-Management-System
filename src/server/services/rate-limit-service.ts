/**
 * D-11, NFR-04, NFR-07 — the rate limiter bound to Postgres and the audit sink
 * (plan 15-03).
 *
 * `consume(scope, subject)` counts one attempt against the scope's keys
 * (`src/server/auth/rate-limit.ts`, the `LoginThrottle` table) and answers
 * whether this attempt is past the limit. Every refused attempt writes one
 * audit row — action `rate_limit.blocked`, the scope, outcome DENIED, the
 * client IP and a correlation id — and never the email address, the key
 * (which can carry an address) or any text the visitor typed.
 *
 * `windowMinutes` is the window length rounded up to whole minutes (15 by
 * default), never a computed remainder: the message a visitor sees must not
 * vary with how far into the window they are.
 *
 * Licence: classified `continuity` in `src/server/licence/registry.ts` — the
 * counters guard identity and support entry points that keep working in the
 * restricted state.
 */

import { prisma } from "@/server/db";
import {
  consumeAttempts,
  isOverLimit,
  RATE_LIMIT_WINDOW_MINUTES,
  rateLimitKeysFor,
  type RateLimitScope,
  type RateLimitStore,
  type RateLimitSubject,
} from "@/server/auth/rate-limit";
import { requestCorrelationId } from "@/server/auth/request-context";
import { recordAudit, type BusinessAuditEvent } from "@/server/services/audit-service";

export const RATE_LIMIT_BLOCKED_ACTION = "rate_limit.blocked";

export type RateLimitDecision = { limited: boolean; windowMinutes: number };

export type RateLimitServiceDeps = {
  store: RateLimitStore;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  now?: () => Date;
  correlationId?: () => Promise<string>;
};

export function createRateLimitService(deps: RateLimitServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const correlationId = deps.correlationId ?? requestCorrelationId;
  const windowMinutes = Math.ceil(RATE_LIMIT_WINDOW_MINUTES);

  async function consume(scope: RateLimitScope, subject: RateLimitSubject): Promise<RateLimitDecision> {
    const keys = rateLimitKeysFor(scope, subject);
    if (keys.length === 0) return { limited: false, windowMinutes };

    const counts = await consumeAttempts(deps.store, keys, now());
    if (!isOverLimit(keys, counts)) return { limited: false, windowMinutes };

    try {
      await deps.audit({
        actorId: subject.userId ?? null,
        actorType: subject.userId ? "USER" : "SYSTEM",
        action: RATE_LIMIT_BLOCKED_ACTION,
        targetType: "RateLimit",
        targetId: scope,
        outcome: "DENIED",
        ipAddress: subject.ip,
        correlationId: await correlationId(),
      });
    } catch (error) {
      // The refusal is the security decision and stands even when the audit
      // write fails; the failure reaches the server log without the address.
      console.error(
        JSON.stringify({ event: "rate_limit.audit_failed", scope, error: error instanceof Error ? error.name : "unknown" }),
      );
    }
    return { limited: true, windowMinutes };
  }

  return { consume };
}

export const rateLimitService = createRateLimitService({
  store: prisma as unknown as RateLimitStore,
  audit: recordAudit,
});
