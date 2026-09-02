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
      actorType: event.actorType ?? "USER",
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
