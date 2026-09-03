/**
 * Read-only access to the audit trail.
 *
 * Adds no create, update, delete, or upsert call against the audit model —
 * `audit-service.ts` remains the sole writer, and `tests/audit-append-only.test.ts`
 * keeps checking that across all of `src`, this file included.
 *
 * `list`/`filterOptions` are both gated on `audit.view` with an empty
 * `ResourceScope`, so reading the trail is a GLOBAL-only capability, same as
 * role administration (Pattern 1).
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import type { ScopeType } from "@/server/permissions/scope";

type WithPermission = ReturnType<typeof createWithPermission>;

export const AUDIT_PAGE_LIMIT = 100;

/**
 * D-31 — actor, date range, and action are the version-1 filters. Filtering
 * to one target record is reached through that record's own History tab
 * instead, so no targetType/targetId filter exists here.
 */
export type AuditFilter = {
  actorId?: string | null;
  from?: Date | null;
  to?: Date | null;
  action?: string | null;
  limit?: number;
};

export function buildAuditWhere(filter: AuditFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filter.actorId) where.actorId = filter.actorId;
  if (filter.action) where.action = filter.action;

  if (filter.from || filter.to) {
    const createdAt: Record<string, Date> = {};
    if (filter.from) createdAt.gte = filter.from;
    if (filter.to) createdAt.lte = filter.to;
    where.createdAt = createdAt;
  }

  return where;
}

/** The projection AuditTable renders. */
export type AuditRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string | null;
  scopeType: ScopeType | null;
  scopeId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  outcome: string;
  correlationId: string | null;
};

export type AuditFilterOptions = {
  actions: string[];
  actors: { id: string; name: string; email: string }[];
};

type RawAuditEventRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string | null;
  scopeType: ScopeType | null;
  scopeId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  outcome: string;
  correlationId: string | null;
  actor: { name: string; email: string } | null;
};

function toAuditRow(row: RawAuditEventRow): AuditRow {
  return {
    id: row.id,
    createdAt: row.createdAt,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    actorEmail: row.actor?.email ?? null,
    actorType: row.actorType,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    before: row.before,
    after: row.after,
    // D-16 — visible to any audit.view holder; no second gate layered on.
    reason: row.reason,
    outcome: row.outcome,
    correlationId: row.correlationId,
  };
}

/** The narrow slice of the Prisma client this service actually uses. */
export type AuditReadStore = {
  auditEvent: {
    findMany(args: Record<string, unknown>): Promise<RawAuditEventRow[]>;
    findFirst(args: Record<string, unknown>): Promise<RawAuditEventRow | null>;
  };
  user: {
    findMany(args?: Record<string, unknown>): Promise<{ id: string; name: string; email: string }[]>;
  };
};

export function createAuditReadService(deps: {
  store: AuditReadStore;
  withPermission: WithPermission;
}) {
  const { store, withPermission: authorize } = deps;

  const listInternal = authorize<AuditFilter>("audit.view", () => ({}))(
    async (filter) => {
      const where = buildAuditWhere(filter);
      const rows = await store.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: filter.limit ?? AUDIT_PAGE_LIMIT,
        include: { actor: { select: { name: true, email: true } } },
      });
      return rows.map(toAuditRow);
    },
  );

  const filterOptionsInternal = authorize<Record<string, never>>(
    "audit.view",
    () => ({}),
  )(async () => {
    const actionRows = (await store.auditEvent.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    })) as unknown as { action: string }[];

    const actorIdRows = (await store.auditEvent.findMany({
      distinct: ["actorId"],
      select: { actorId: true },
    })) as unknown as { actorId: string | null }[];

    const actorIds = actorIdRows
      .map((row) => row.actorId)
      .filter((id): id is string => id !== null);

    const actors =
      actorIds.length > 0
        ? await store.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, email: true },
          })
        : [];

    const options: AuditFilterOptions = {
      actions: actionRows.map((row) => row.action),
      actors,
    };
    return options;
  });

  return {
    list: (filter: AuditFilter = {}) => listInternal(filter),
    filterOptions: () => filterOptionsInternal({}),
  };
}

export const auditReadService = createAuditReadService({
  store: prisma as unknown as AuditReadStore,
  withPermission,
});
