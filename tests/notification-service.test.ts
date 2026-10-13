/**
 * Unit tests for `notification-service.ts` against a fake, in-memory
 * `NotificationStore` (T-13-01). `notification-service.integration.test.ts`
 * proves the same boundaries against real Postgres; this file proves the
 * exact `where` clauses, cursor encoding/validation, and clamping logic
 * that a fake db can assert cheaply and fast.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createNotificationService,
  InvalidCursorError,
  type NotificationRow,
  type NotificationStore,
} from "@/server/services/notification-service";
import type { Actor } from "@/server/permissions/with-permission";

const ACTOR: Actor = { userId: "user-1" };
const FIXED_NOW = new Date("2026-09-27T12:00:00.000Z");

function makeRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n-1",
    type: "enrolment.confirmed",
    targetType: "LEARNER_ENROLMENT",
    targetId: "enr-1",
    params: {},
    readAt: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeFakeStore(overrides: Partial<NotificationStore["notification"]> = {}) {
  const notification = {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async (): Promise<NotificationRow[]> => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
    ...overrides,
  };
  const db: NotificationStore = { notification };
  return { db, count: notification.count, findMany: notification.findMany, updateMany: notification.updateMany };
}

describe("notificationService.unreadCount (T-13-01)", () => {
  it("counts only the actor's own unarchived, unread rows", async () => {
    const { db, count } = makeFakeStore({ count: vi.fn(async () => 2) });
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    const result = await service.unreadCount(ACTOR);

    expect(result).toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: { recipientId: "user-1", archivedAt: null, readAt: null },
    });
  });
});

describe("notificationService.list — clamping and cursor validation", () => {
  it("clamps limit 0 (and negative) up to 1", async () => {
    const { db, findMany } = makeFakeStore();
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    await service.list(ACTOR, { limit: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }), // limit 1 + 1
    );

    await service.list(ACTOR, { limit: -5 });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2 }));
  });

  it("clamps a limit above 50 down to 50", async () => {
    const { db, findMany } = makeFakeStore();
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    await service.list(ACTOR, { limit: 999 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
  });

  it("defaults to 20 when no limit is given", async () => {
    const { db, findMany } = makeFakeStore();
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    await service.list(ACTOR);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 21 }));
  });

  it("excludes archived rows and other users via the where clause", async () => {
    const { db, findMany } = makeFakeStore();
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    await service.list(ACTOR, { limit: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: "user-1", archivedAt: null },
      }),
    );
  });

  it("throws InvalidCursorError for a malformed cursor without calling the db", async () => {
    const { db, findMany } = makeFakeStore();
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    await expect(service.list(ACTOR, { cursor: "not-a-real-cursor" })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects a cursor that base64url-decodes to garbage", async () => {
    const garbage = Buffer.from("nonsense-not-a-cursor", "utf8").toString("base64url");
    const { db } = makeFakeStore();
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    await expect(service.list(ACTOR, { cursor: garbage })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it("produces a nextCursor only when there is a row beyond the page", async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeRow({ id: `n-${i}`, createdAt: new Date(FIXED_NOW.getTime() - i * 1000) }),
    );
    const { db } = makeFakeStore({ findMany: vi.fn(async () => rows) });
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    const page = await service.list(ACTOR, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it("nextCursor is null when exactly `limit` rows come back", async () => {
    const rows = Array.from({ length: 2 }, (_, i) =>
      makeRow({ id: `n-${i}`, createdAt: new Date(FIXED_NOW.getTime() - i * 1000) }),
    );
    const { db } = makeFakeStore({ findMany: vi.fn(async () => rows) });
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    const page = await service.list(ACTOR, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("a decoded cursor adds an OR clause scoped to createdAt/id", async () => {
    const first = await (async () => {
      const { db } = makeFakeStore({
        findMany: vi.fn(async () => [makeRow({ id: "n-only" })]),
      });
      return createNotificationService({ db, now: () => FIXED_NOW }).list(ACTOR, { limit: 1 });
    })();
    expect(first.nextCursor).toBeNull(); // exactly 1 row for limit 1 -> no more pages

    const { db, findMany } = makeFakeStore();
    const service = createNotificationService({ db, now: () => FIXED_NOW });
    const cursor = Buffer.from(
      `${FIXED_NOW.toISOString()}|n-1`,
      "utf8",
    ).toString("base64url");

    await service.list(ACTOR, { cursor, limit: 10 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ createdAt: { lt: FIXED_NOW } }, { createdAt: FIXED_NOW, id: { lt: "n-1" } }],
        }),
      }),
    );
  });
});

describe("notificationService.markRead — ownership (T-13-01)", () => {
  it("returns false and never updates for a missing or foreign id", async () => {
    const { db, findMany, updateMany } = makeFakeStore({ findMany: vi.fn(async () => []) });
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    const result = await service.markRead(ACTOR, "someone-elses-notification");

    expect(result).toBe(false);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: "someone-elses-notification", recipientId: "user-1" },
      take: 1,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns true and sets readAt for an owned, unread row", async () => {
    const { db, updateMany } = makeFakeStore({
      findMany: vi.fn(async () => [makeRow({ id: "n-1", readAt: null })]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    });
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    const result = await service.markRead(ACTOR, "n-1");

    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "n-1", recipientId: "user-1", readAt: null },
      data: { readAt: FIXED_NOW },
    });
  });

  it("returns true for an owned row that is already read, without erroring", async () => {
    const { db, updateMany } = makeFakeStore({
      findMany: vi.fn(async () => [makeRow({ id: "n-1", readAt: FIXED_NOW })]),
      updateMany: vi.fn(async () => ({ count: 0 })),
    });
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    const result = await service.markRead(ACTOR, "n-1");

    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalled();
  });
});

describe("notificationService.markAllRead", () => {
  it("scopes to the actor's own unarchived unread rows and returns the count changed", async () => {
    const { db, updateMany } = makeFakeStore({ updateMany: vi.fn(async () => ({ count: 5 })) });
    const service = createNotificationService({ db, now: () => FIXED_NOW });

    const result = await service.markAllRead(ACTOR);

    expect(result).toBe(5);
    expect(updateMany).toHaveBeenCalledWith({
      where: { recipientId: "user-1", archivedAt: null, readAt: null },
      data: { readAt: FIXED_NOW },
    });
  });
});
