/**
 * Real-Postgres proof for `notification-service.ts` (COM-03, T-13-01, D-18,
 * D-19). A fake db can assert the exact `where` clause a query builds, but
 * only a real database can prove the actual set of rows a query returns —
 * this is where "another user's unread rows never count" and "cursor
 * paging has no duplicate or gap" get proven against real SQL.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails
 * with a container-start error and every case reports BLOCKED — the
 * expected failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedLearnerFixture } from "./support/cohort-fixtures";
import { createNotificationService, type NotificationStore } from "@/server/services/notification-service";
import type { Actor } from "@/server/permissions/with-permission";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function buildService() {
  return createNotificationService({
    db: testDb.prisma as unknown as NotificationStore,
  });
}

let eventCounter = 0;
function nextEventId(): string {
  eventCounter += 1;
  return `evt-${eventCounter}`;
}

async function seedNotification(args: {
  recipientId: string;
  createdAt?: Date;
  readAt?: Date | null;
  archivedAt?: Date | null;
  type?: string;
}) {
  return testDb.prisma.notification.create({
    data: {
      recipientId: args.recipientId,
      type: args.type ?? "enrolment.confirmed",
      targetType: "LEARNER_ENROLMENT",
      targetId: "enr-fixture",
      params: {},
      sourceEventId: nextEventId(),
      createdAt: args.createdAt ?? new Date(),
      readAt: args.readAt ?? null,
      archivedAt: args.archivedAt ?? null,
    },
  });
}

describe("notificationService — real Postgres (COM-03, T-13-01)", () => {
  it(
    "unreadCount: 2 unread, 1 read, 1 archived-unread, plus another user's 3 unread -> 2",
    async () => {
      const { userId: userA } = await seedLearnerFixture(testDb.prisma);
      const { userId: userB } = await seedLearnerFixture(testDb.prisma);

      await seedNotification({ recipientId: userA }); // unread
      await seedNotification({ recipientId: userA }); // unread
      await seedNotification({ recipientId: userA, readAt: new Date() }); // read
      await seedNotification({ recipientId: userA, archivedAt: new Date() }); // archived-unread
      await seedNotification({ recipientId: userB });
      await seedNotification({ recipientId: userB });
      await seedNotification({ recipientId: userB });

      const service = buildService();
      expect(await service.unreadCount({ userId: userA })).toBe(2);
      expect(await service.unreadCount({ userId: userB })).toBe(3);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "lists newest first; exactly `limit` rows means no nextCursor",
    async () => {
      const { userId } = await seedLearnerFixture(testDb.prisma);
      const base = Date.now();
      const created = [] as { id: string; createdAt: Date }[];
      for (let i = 0; i < 20; i += 1) {
        const row = await seedNotification({
          recipientId: userId,
          createdAt: new Date(base - i * 1000),
        });
        created.push(row);
      }

      const service = buildService();
      const page = await service.list({ userId }, { limit: 20 });
      expect(page.items).toHaveLength(20);
      expect(page.nextCursor).toBeNull();

      const timestamps = page.items.map((row) => row.createdAt.getTime());
      const sortedDesc = [...timestamps].sort((a, b) => b - a);
      expect(timestamps).toEqual(sortedDesc);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "21 rows and limit 20: page 1 has 20 + a cursor, page 2 has 1 + no cursor, no id repeats or gaps",
    async () => {
      const { userId } = await seedLearnerFixture(testDb.prisma);
      const base = Date.now();
      const createdIds: string[] = [];
      for (let i = 0; i < 21; i += 1) {
        const row = await seedNotification({
          recipientId: userId,
          createdAt: new Date(base - i * 1000),
        });
        createdIds.push(row.id);
      }

      const service = buildService();
      const first = await service.list({ userId }, { limit: 20 });
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.list(
        { userId },
        { cursor: first.nextCursor!, limit: 20 },
      );
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();

      const seenIds = [...first.items, ...second.items].map((row) => row.id);
      expect(new Set(seenIds).size).toBe(21); // no duplicates
      expect([...seenIds].sort()).toEqual([...createdIds].sort()); // no gaps
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "excludes archived rows and another user's rows from the list",
    async () => {
      const { userId: userA } = await seedLearnerFixture(testDb.prisma);
      const { userId: userB } = await seedLearnerFixture(testDb.prisma);
      await seedNotification({ recipientId: userA, archivedAt: new Date() });
      await seedNotification({ recipientId: userB });
      const visible = await seedNotification({ recipientId: userA });

      const service = buildService();
      const page = await service.list({ userId: userA }, { limit: 20 });
      expect(page.items.map((row) => row.id)).toEqual([visible.id]);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "markRead: another user's id returns false and leaves it unread; a nonexistent id also returns false",
    async () => {
      const { userId: userA } = await seedLearnerFixture(testDb.prisma);
      const { userId: userB } = await seedLearnerFixture(testDb.prisma);
      const foreign = await seedNotification({ recipientId: userB });

      const service = buildService();
      const actorA: Actor = { userId: userA };
      expect(await service.markRead(actorA, foreign.id)).toBe(false);
      expect(await service.markRead(actorA, "does-not-exist")).toBe(false);

      const reloaded = await testDb.prisma.notification.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      expect(reloaded.readAt).toBeNull();
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "markRead sets readAt for an owned row and is idempotent on a second call",
    async () => {
      const { userId } = await seedLearnerFixture(testDb.prisma);
      const own = await seedNotification({ recipientId: userId });
      const service = buildService();
      const actor: Actor = { userId };

      expect(await service.markRead(actor, own.id)).toBe(true);
      const firstReadAt = (
        await testDb.prisma.notification.findUniqueOrThrow({ where: { id: own.id } })
      ).readAt;
      expect(firstReadAt).not.toBeNull();

      expect(await service.markRead(actor, own.id)).toBe(true);
      const secondReadAt = (
        await testDb.prisma.notification.findUniqueOrThrow({ where: { id: own.id } })
      ).readAt;
      expect(secondReadAt?.getTime()).toBe(firstReadAt?.getTime());
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "markAllRead changes only the caller's unread rows; another user's unread rows stay unread",
    async () => {
      const { userId: userA } = await seedLearnerFixture(testDb.prisma);
      const { userId: userB } = await seedLearnerFixture(testDb.prisma);
      await seedNotification({ recipientId: userA });
      await seedNotification({ recipientId: userA });
      const otherUnread = await seedNotification({ recipientId: userB });

      const service = buildService();
      const changed = await service.markAllRead({ userId: userA });
      expect(changed).toBe(2);

      const reloadedOther = await testDb.prisma.notification.findUniqueOrThrow({
        where: { id: otherUnread.id },
      });
      expect(reloadedOther.readAt).toBeNull();
      expect(await service.unreadCount({ userId: userA })).toBe(0);
      expect(await service.unreadCount({ userId: userB })).toBe(1);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "archiveReadOlderThan: a row read exactly at the cutoff and one read a day earlier are archived; one read a millisecond after the cutoff, and any unread row, are not; already-archived rows are untouched; the total row count never changes (D-23)",
    async () => {
      const { userId } = await seedLearnerFixture(testDb.prisma);
      const cutoff = new Date("2026-06-29T00:00:00.000Z");

      const atCutoff = await seedNotification({ recipientId: userId, readAt: cutoff });
      const beforeCutoff = await seedNotification({
        recipientId: userId,
        readAt: new Date(cutoff.getTime() - 24 * 60 * 60 * 1000),
      });
      const afterCutoff = await seedNotification({
        recipientId: userId,
        readAt: new Date(cutoff.getTime() + 1),
      });
      const unreadOld = await seedNotification({
        recipientId: userId,
        createdAt: new Date(cutoff.getTime() - 400 * 24 * 60 * 60 * 1000),
        readAt: null,
      });
      const alreadyArchived = await seedNotification({
        recipientId: userId,
        readAt: new Date(cutoff.getTime() - 1),
        archivedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const countBefore = await testDb.prisma.notification.count();

      const service = buildService();
      const archivedCount = await service.archiveReadOlderThan(cutoff, 500);
      expect(archivedCount).toBe(2); // atCutoff + beforeCutoff only

      const countAfter = await testDb.prisma.notification.count();
      expect(countAfter).toBe(countBefore); // no row deleted (D-23)

      const reload = (id: string) =>
        testDb.prisma.notification.findUniqueOrThrow({ where: { id } });

      expect((await reload(atCutoff.id)).archivedAt).not.toBeNull();
      expect((await reload(beforeCutoff.id)).archivedAt).not.toBeNull();
      expect((await reload(afterCutoff.id)).archivedAt).toBeNull();
      expect((await reload(unreadOld.id)).archivedAt).toBeNull();
      // Already-archived row keeps its original archivedAt, not re-stamped.
      const reloadedArchived = await reload(alreadyArchived.id);
      expect(reloadedArchived.archivedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "archiveReadOlderThan respects the limit and returns the number of rows actually changed",
    async () => {
      const { userId } = await seedLearnerFixture(testDb.prisma);
      const cutoff = new Date();
      for (let i = 0; i < 5; i += 1) {
        await seedNotification({ recipientId: userId, readAt: new Date(cutoff.getTime() - 1000) });
      }

      const service = buildService();
      const archivedCount = await service.archiveReadOlderThan(cutoff, 3);
      expect(archivedCount).toBe(3);
    },
    TEST_DB_TIMEOUT_MS,
  );
});
