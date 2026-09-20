import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { getCurrentActor } from "@/server/auth/current-actor";
import { createExportService, type SnapshotRow, type TrustedExportProducer } from "@/server/services/export-service";

const blockedKey = /password|secret|credential|token|authorization|private.?key|storage.?key|payload|stack|cookie|signature|access.?key|api.?key/i;
const contextFields = new Set(["id", "status", "state", "amountMinor", "currency", "provider", "scopeType", "scopeId", "role", "permissions", "active", "createdAt", "updatedAt", "reference", "orderId", "paymentId", "refundId", "courseId", "cohortId", "programmeId", "outcome", "assignment", "action", "method", "source", "nested"]);

function safeAuditReference(value: string | null): string | null {
  if (!value) return null;
  return /[/\\]|\bBearer\b|(?:sk|pk)_(?:live|test)_|ghp_|token|secret|credential|password|storage/i.test(value) ? "[redacted]" : value.slice(0, 128);
}

/** Investigative context names only. Arbitrary audit values are never copied to CSV. */
export function redactedAuditContext(before: unknown, after: unknown): string {
  const paths = new Set<string>();
  function visit(value: unknown, prefix = "", depth = 0) {
    if (!value || typeof value !== "object" || depth > 5) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 10)) visit(item, prefix, depth + 1); return; }
    for (const [key, child] of Object.entries(value)) {
      if (blockedKey.test(key) || !contextFields.has(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof child === "object" && child !== null) visit(child, path, depth + 1);
      else paths.add(path.slice(0, 80));
      if (paths.size >= 30) return;
    }
  }
  visit(before); visit(after);
  return [...paths].sort().join(", ").slice(0, 500);
}

export function createAuditExportProducer(): TrustedExportProducer {
  return async ({ datasetId, normalizedFilters, authorizedScope, selectedColumns, asOf, tx }): Promise<readonly SnapshotRow[]> => {
    if (datasetId !== "audit" || authorizedScope.kind !== "GLOBAL") throw new Error("Invalid audit export boundary");
    const from = typeof normalizedFilters.from === "string" ? new Date(`${normalizedFilters.from}T00:00:00.000Z`) : undefined;
    const to = typeof normalizedFilters.to === "string" ? new Date(`${normalizedFilters.to}T23:59:59.999Z`) : undefined;
    const events = await tx.auditEvent.findMany({
      where: {
        createdAt: { lte: asOf, ...(from ? { gte: from } : {}), ...(to && to < asOf ? { lte: to } : {}) },
        ...(normalizedFilters.actorId ? { actorId: String(normalizedFilters.actorId) } : {}),
        ...(normalizedFilters.action ? { action: String(normalizedFilters.action) } : {}),
      },
      include: { actor: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25_001,
    });
    return events.map((event) => Object.freeze(Object.fromEntries(selectedColumns.map((column) => {
      const value: Record<string, string | null> = {
        eventId: event.id, createdAt: event.createdAt.toISOString(), actorType: event.actorType,
        action: event.action, targetType: event.targetType, targetId: safeAuditReference(event.targetId),
        outcome: event.outcome, correlationId: safeAuditReference(event.correlationId),
        context: redactedAuditContext(event.before, event.after),
        actorName: event.actor?.name ?? null, actorEmail: event.actor?.email ?? null,
      };
      return [column.key, value[column.key] ?? null];
    }))));
  };
}

export function createAuditExportService(deps: { db: Pick<PrismaClient, "$transaction">; actor: () => Promise<{ userId: string } | null> }) {
  const service = createExportService({ db: deps.db, actor: deps.actor, producers: { audit: createAuditExportProducer() } });
  return {
    requestAuditExport(input: { filters?: unknown; columns?: unknown; reason?: unknown; idempotencyKey?: unknown }) {
      return service.requestExport({ dataset: "audit", ...input });
    },
  };
}

export const auditExportService = createAuditExportService({ db: prisma, actor: getCurrentActor });
