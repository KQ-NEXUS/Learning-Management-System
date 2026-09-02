import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import {
  createAuditReadService,
  buildAuditWhere,
  AUDIT_PAGE_LIMIT,
  type AuditReadStore,
} from "@/server/services/audit-read-service";

const grant = (
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType,
  scopeId,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});

function harness(grants: RawGrant[]) {
  const rows = [
    {
      id: "e1",
      createdAt: new Date("2026-09-01T10:00:00Z"),
      actorId: "user-1",
      actorType: "USER",
      action: "role.created",
      targetType: "Role",
      targetId: "r1",
      scopeType: "GLOBAL" as const,
      scopeId: null,
      before: null,
      after: { name: "Custom" },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
      actor: { name: "Ada Admin", email: "admin@kqnexus.test" },
    },
  ];

  const store: AuditReadStore = {
    auditEvent: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        if (args.select) return [] as never;
        return rows as never;
      }),
      findFirst: vi.fn(async () => rows[0] as never),
    },
    user: {
      findMany: vi.fn(async () => []),
    },
  };

  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createAuditReadService({ store, withPermission });

  return { service, store };
}

describe("buildAuditWhere", () => {
  it("returns an object with no keys for an empty filter", () => {
    expect(Object.keys(buildAuditWhere({}))).toEqual([]);
  });

  it("sets exactly an actorId key when only actorId is supplied", () => {
    const where = buildAuditWhere({ actorId: "u1" });
    expect(where).toEqual({ actorId: "u1" });
  });

  it("sets a createdAt range with only a lower bound for a from-only filter", () => {
    const from = new Date("2026-01-01");
    expect(buildAuditWhere({ from })).toEqual({ createdAt: { gte: from } });
  });

  it("sets a createdAt range with only an upper bound for a to-only filter", () => {
    const to = new Date("2026-01-31");
    expect(buildAuditWhere({ to })).toEqual({ createdAt: { lte: to } });
  });

  it("sets both bounds when both from and to are supplied", () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");
    expect(buildAuditWhere({ from, to })).toEqual({ createdAt: { gte: from, lte: to } });
  });

  it("sets an action key when an action is supplied", () => {
    expect(buildAuditWhere({ action: "role.created" })).toEqual({ action: "role.created" });
  });
});

describe("audit read service", () => {
  it("refuses list without an audit.view grant", async () => {
    const { service, store } = harness([grant("roles.view")]);
    await expect(service.list()).rejects.toThrow();
    expect(store.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("refuses list when the only audit.view grant is Cohort-scoped", async () => {
    const { service, store } = harness([grant("audit.view", "COHORT", "c1")]);
    await expect(service.list()).rejects.toThrow();
    expect(store.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("orders by createdAt descending and passes AUDIT_PAGE_LIMIT as take when no limit is supplied", async () => {
    const { service, store } = harness([grant("audit.view")]);
    await service.list();

    expect(store.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        take: AUDIT_PAGE_LIMIT,
      }),
    );
  });

  it("lets a caller-supplied limit override AUDIT_PAGE_LIMIT", async () => {
    const { service, store } = harness([grant("audit.view")]);
    await service.list({ limit: 10 });

    expect(store.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });

  it("returns rows carrying scopeType and scopeId", async () => {
    const { service } = harness([grant("audit.view")]);
    const rows = await service.list();
    expect(rows[0]).toMatchObject({ scopeType: "GLOBAL", scopeId: null });
  });

  it("refuses filterOptions without the grant", async () => {
    const { service } = harness([grant("roles.view")]);
    await expect(service.filterOptions()).rejects.toThrow();
  });
});
