/**
 * Writes audit events.
 *
 * PRD RBAC-08 and NFR-07: sensitive actions record actor, target, before and
 * after state, scope, reason, outcome, time, and a correlation reference.
 * Audit rows are append-only to application users — there is no update or
 * delete path here by design.
 */

import { prisma } from "@/server/db";
import type { AuditEntry } from "@/server/permissions/with-permission";

export type BusinessAuditEvent = {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  outcome: string;
  correlationId?: string | null;
  ipAddress?: string | null;
};

export async function recordAudit(event: BusinessAuditEvent): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      before: (event.before ?? undefined) as never,
      after: (event.after ?? undefined) as never,
      reason: event.reason ?? null,
      outcome: event.outcome,
      correlationId: event.correlationId ?? null,
      ipAddress: event.ipAddress ?? null,
    },
  });
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
