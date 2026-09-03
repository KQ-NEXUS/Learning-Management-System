/**
 * Writes audit events.
 *
 * PRD RBAC-08 and NFR-07: sensitive actions record actor, target, before and
 * after state, scope, reason, outcome, time, and a correlation reference.
 * Audit rows are append-only to application users — there is no update or
 * delete path here by design (tests/audit-append-only.test.ts enforces this
 * across all of `src`, not just this file).
 *
 * Redaction happens here, at the sink, rather than at each call site:
 * `staff-account-service` will pass a whole `User` row as `before`, and a
 * per-call-site rule would have to be remembered by every future
 * contributor, whereas a sink-level rule cannot be forgotten.
 */

import { prisma } from "@/server/db";
import type { AuditEntry } from "@/server/permissions/with-permission";
import type { ScopeType } from "@/server/permissions/scope";

export type BusinessAuditEvent = {
  actorId: string | null;
  /**
   * Who the actor IS — "USER" (default) or "SYSTEM" for a row written by a
   * worker with no session (D-28 scan verdicts). `AuditEvent.actorType`
   * defaults to "USER" in the schema; this is what lets a system-actor row be
   * told apart from a user row in the audit view (RBAC-08, Phase 8 export).
   */
  actorType?: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  scopeType?: ScopeType | null;
  scopeId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  outcome: string;
  correlationId?: string | null;
  ipAddress?: string | null;
};

/** Credential-shaped keys that must never reach the audit table. */
export const AUDIT_REDACTED_KEYS: ReadonlySet<string> = Object.freeze(
  new Set(["passwordHash", "password", "sessionToken", "token", "secret"]),
);

const REDACTION_PLACEHOLDER = "[redacted]";

/**
 * Walks plain objects and arrays recursively, replacing any value at a key
 * in `AUDIT_REDACTED_KEYS` with a fixed placeholder. Dates, primitives, null,
 * and non-plain objects (class instances) pass through untouched. Guarded
 * against cycles with a seen-set — a self-referential input returns without
 * recursing a second time into the same object, rather than hanging.
 */
export function redactForAudit(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactForAudit(item, seen));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = AUDIT_REDACTED_KEYS.has(key) ? REDACTION_PLACEHOLDER : redactForAudit(val, seen);
  }
  return result;
}

/** The row shape handed to `prisma.auditEvent.create` — a pure function so redaction and scope threading are unit-testable without a database. */
export function buildAuditRow(event: BusinessAuditEvent) {
  return {
    actorId: event.actorId,
    // "USER" (default) or "SYSTEM" for a worker-written row with no session
    // (D-28 scan verdicts). `AuditEvent.actorType` defaults to "USER" in the
    // schema; this is what tells a system-actor row apart in the audit view.
    actorType: event.actorType ?? "USER",
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    scopeType: event.scopeType ?? null,
    scopeId: event.scopeId ?? null,
    before: redactForAudit(event.before ?? undefined) as never,
    after: redactForAudit(event.after ?? undefined) as never,
    reason: event.reason ?? null,
    outcome: event.outcome,
    correlationId: event.correlationId ?? null,
    ipAddress: event.ipAddress ?? null,
  };
}

export async function recordAudit(event: BusinessAuditEvent): Promise<void> {
  await prisma.auditEvent.create({ data: buildAuditRow(event) });
}

/** Adapts an authorization denial to the audit table. */
export async function recordAuthorizationAudit(entry: AuditEntry): Promise<void> {
  await recordAudit({
    actorId: entry.actorId,
    action: entry.action,
    targetType: "PERMISSION",
    targetId: entry.permission,
    outcome: entry.outcome,
    reason: entry.reason,
  });
}
