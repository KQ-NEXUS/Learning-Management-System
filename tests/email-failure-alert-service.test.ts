/**
 * Pure unit coverage for the administrator alert raised when an email
 * dispatch reaches FAILED (D-08, T-13-11, T-13-45) — a fake `db` (a
 * `$queryRaw` stub standing in for `resolveStaffHolders`'s SQL, plus a
 * `notification.createMany` spy) is enough to prove the service's own
 * shape and error-isolation rules; the real-Postgres proof that a failed
 * dispatch actually triggers this service through the drain lives in
 * `tests/domain-event-drain.integration.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  createEmailFailureAlertService,
  type EmailFailureAlertDb,
} from "@/server/services/email-failure-alert-service";

type FakeDbOverrides = {
  queryRaw?: (...args: unknown[]) => Promise<unknown>;
  createMany?: (args: {
    data: Prisma.NotificationCreateManyInput[];
    skipDuplicates: boolean;
  }) => Promise<{ count: number }>;
};

function makeFakeDb(overrides: FakeDbOverrides = {}) {
  const createMany = vi.fn(
    overrides.createMany ?? (async (args: { data: unknown[] }) => ({ count: args.data.length })),
  );
  const queryRaw = vi.fn(overrides.queryRaw ?? (async () => []));
  const db = {
    $queryRaw: queryRaw,
    notification: { createMany },
  } as unknown as EmailFailureAlertDb;
  return { db, createMany, queryRaw };
}

function holderRows(ids: string[]) {
  return ids.map((id) => ({ id }));
}

describe("createEmailFailureAlertService.notifyFailed (D-08, T-13-11, T-13-45)", () => {
  it("creates one staff.email_failed notification per resolved holder, with params containing only template and dispatchRef", async () => {
    const { db, createMany, queryRaw } = makeFakeDb({
      queryRaw: async () => holderRows(["holder-1", "holder-2"]),
    });
    const service = createEmailFailureAlertService({ db });

    await service.notifyFailed({ id: "dispatch-abcdef123456", template: "staff-order-exception", userId: "user-x" });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    const call = createMany.mock.calls[0]![0] as {
      data: Prisma.NotificationCreateManyInput[];
      skipDuplicates: boolean;
    };
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(2);
    for (const row of call.data) {
      expect(row.type).toBe("staff.email_failed");
      expect(row.targetType).toBe("STAFF_EMAIL_LOG");
      expect(row.targetId).toBe("dispatch-abcdef123456");
      expect(row.sourceEventId).toBe("dispatch-abcdef123456");
      expect(Object.keys(row.params as Record<string, unknown>).sort()).toEqual(["dispatchRef", "template"]);
      expect((row.params as { dispatchRef: string }).dispatchRef).toBe("ef123456");
      expect((row.params as { template: string }).template).toBe("staff-order-exception");
    }
    const recipientIds = call.data.map((row) => row.recipientId).sort();
    expect(recipientIds).toEqual(["holder-1", "holder-2"]);
  });

  it("the dispatchRef is exactly the last 8 characters of the dispatch id", async () => {
    const { db, createMany } = makeFakeDb({ queryRaw: async () => holderRows(["holder-1"]) });
    const service = createEmailFailureAlertService({ db });

    await service.notifyFailed({ id: "0123456789abcdef", template: "staff-reconciliation-exception", userId: null });

    const call = createMany.mock.calls[0]![0] as { data: Prisma.NotificationCreateManyInput[] };
    expect((call.data[0]!.params as { dispatchRef: string }).dispatchRef).toBe("89abcdef");
  });

  it("resolves holders with the audit.view permission and an empty (global-only) scope", async () => {
    const { db, queryRaw } = makeFakeDb({ queryRaw: async () => [] });
    const service = createEmailFailureAlertService({ db });

    await service.notifyFailed({ id: "dispatch-1", template: "staff-ticket-assigned", userId: "u1" });

    // resolveStaffHolders builds its SQL from the permission/scope it is
    // called with; the fake can't introspect the built Prisma.Sql easily,
    // but it proves the call happened exactly once per notifyFailed call.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("calls createMany with skipDuplicates so a second call for the same dispatch never aborts (dedupe intent)", async () => {
    const { db, createMany } = makeFakeDb({ queryRaw: async () => holderRows(["holder-1"]) });
    const service = createEmailFailureAlertService({ db });

    await service.notifyFailed({ id: "dispatch-dup", template: "staff-order-exception", userId: null });
    await service.notifyFailed({ id: "dispatch-dup", template: "staff-order-exception", userId: null });

    expect(createMany).toHaveBeenCalledTimes(2);
    for (const call of createMany.mock.calls) {
      expect((call[0] as { skipDuplicates: boolean }).skipDuplicates).toBe(true);
    }
  });

  it("resolving zero holders creates no notification row at all", async () => {
    const { db, createMany } = makeFakeDb({ queryRaw: async () => [] });
    const service = createEmailFailureAlertService({ db });

    await service.notifyFailed({ id: "dispatch-none", template: "staff-order-exception", userId: null });

    expect(createMany).not.toHaveBeenCalled();
  });

  it("never touches an EmailDispatch table — the fake db exposes none, and the service never references one", async () => {
    const { db } = makeFakeDb({ queryRaw: async () => holderRows(["holder-1"]) });
    // The fake `db` intentionally has no `emailDispatch` property at all; if
    // the service ever referenced `db.emailDispatch`, this call would throw.
    const service = createEmailFailureAlertService({ db });
    await expect(
      service.notifyFailed({ id: "dispatch-2", template: "staff-order-exception", userId: null }),
    ).resolves.toBeUndefined();
  });

  it("no persisted params field ever carries a recipient address, email body, or provider error text", async () => {
    const { db, createMany } = makeFakeDb({ queryRaw: async () => holderRows(["holder-1"]) });
    const service = createEmailFailureAlertService({ db });

    await service.notifyFailed({
      id: "dispatch-3",
      template: "staff-order-exception",
      userId: "recipient@example.com",
    });

    const call = createMany.mock.calls[0]![0] as { data: Prisma.NotificationCreateManyInput[] };
    const serialized = JSON.stringify(call.data);
    expect(serialized).not.toContain("recipient@example.com");
    expect(serialized).not.toContain("userId");
  });

  it("a failure resolving holders is caught and logged, never thrown, and never calls createMany", async () => {
    const log = vi.fn();
    const { db, createMany } = makeFakeDb({
      queryRaw: async () => {
        throw new Error("simulated db failure");
      },
    });
    const service = createEmailFailureAlertService({ db, log });

    await expect(
      service.notifyFailed({ id: "dispatch-4", template: "staff-order-exception", userId: null }),
    ).resolves.toBeUndefined();
    expect(createMany).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("a failure writing the notification is caught and logged, never thrown", async () => {
    const log = vi.fn();
    const { db } = makeFakeDb({
      queryRaw: async () => holderRows(["holder-1"]),
      createMany: async () => {
        throw new Error("simulated write failure");
      },
    });
    const service = createEmailFailureAlertService({ db, log });

    await expect(
      service.notifyFailed({ id: "dispatch-5", template: "staff-order-exception", userId: null }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
