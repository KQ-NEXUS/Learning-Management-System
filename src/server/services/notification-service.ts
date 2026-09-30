/**
 * Ownership-scoped in-product notification service (COM-03, D-17, D-19).
 *
 * Every query and mutation here is filtered by `recipientId` equal to the
 * authenticated actor (T-13-01) — reading the unread count, listing,
 * marking one item read, and marking all read can never touch another
 * user's rows. A foreign or missing notification id produces the same
 * result from `markRead` (`false`) so this service can never become an
 * existence oracle for someone else's notifications.
 *
 * There is no delete anywhere in this file (D-23): retention is a
 * scheduled archive job added by a later plan, never a hard delete, and
 * this service only ever reads and updates `readAt`.
 *
 * This module imports nothing from `next/headers` — it takes an already
 * resolved `Actor`, so it can be called from a route handler, a server
 * action, or a future scheduled task without pulling in a request-only API
 * (T-13-22, mirrors the `next/headers`-free discipline of
 * `audit-read-service.ts`).
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";

export class InvalidCursorError extends Error {
  constructor(message = "Invalid cursor.") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Raw row shape read from the `Notification` table. */
export type NotificationRow = {
  id: string;
  type: string;
  targetType: string;
  targetId: string;
  params: unknown;
  readAt: Date | null;
  createdAt: Date;
};

export type NotificationListOptions = {
  cursor?: string | null;
  limit?: number;
};

export type NotificationListPage = {
  items: NotificationRow[];
  nextCursor: string | null;
};

/** The narrow slice of the Prisma client this service actually uses. */
export type NotificationStore = {
  notification: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
      take?: number;
    }): Promise<NotificationRow[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit) || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  const whole = Math.floor(limit);
  if (whole < 1) return 1;
  if (whole > MAX_LIMIT) return MAX_LIMIT;
  return whole;
}

// `<ISO createdAt>|<id>`, base64url-encoded. The ISO shape is pinned to
// `Date#toISOString()`'s exact format so a tampered or hand-built cursor
// (a different precision, a missing `Z`, extra fields) is rejected rather
// than silently accepted with surprising semantics.
const CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[A-Za-z0-9_-]+$/;

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new InvalidCursorError();
  }
  if (!CURSOR_PATTERN.test(decoded)) {
    throw new InvalidCursorError();
  }
  const separatorIndex = decoded.indexOf("|");
  const iso = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) {
    throw new InvalidCursorError();
  }
  return { createdAt, id };
}

export function createNotificationService(deps: {
  db: NotificationStore;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  /** D-19 — unread means the caller's own, unarchived, unread rows. */
  async function unreadCount(actor: Actor): Promise<number> {
    return db.notification.count({
      where: { recipientId: actor.userId, archivedAt: null, readAt: null },
    });
  }

  /**
   * D-18 — newest first, cursor-paged. Fetches `limit + 1` rows to decide
   * `nextCursor` without a second round trip; excludes archived rows and
   * every other user's rows via the same `recipientId` filter every method
   * in this service uses (T-13-01).
   */
  async function list(
    actor: Actor,
    options: NotificationListOptions = {},
  ): Promise<NotificationListPage> {
    const limit = clampLimit(options.limit);
    const where: Record<string, unknown> = {
      recipientId: actor.userId,
      archivedAt: null,
    };

    if (options.cursor) {
      const { createdAt, id } = decodeCursor(options.cursor);
      where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }];
    }

    const rows = await db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : null;

    return { items, nextCursor };
  }

  /**
   * Sets `readAt` only when the row belongs to `actor` and is currently
   * unread. Returns `true` for any owned row (already read or not) and
   * `false` for a missing or foreign id — the two denial reasons are
   * indistinguishable to the caller.
   */
  async function markRead(actor: Actor, notificationId: string): Promise<boolean> {
    const owned = await db.notification.findMany({
      where: { id: notificationId, recipientId: actor.userId },
      take: 1,
    });
    if (owned.length === 0) {
      return false;
    }
    await db.notification.updateMany({
      where: { id: notificationId, recipientId: actor.userId, readAt: null },
      data: { readAt: now() },
    });
    return true;
  }

  /** Marks every unarchived, unread row owned by `actor` read. Returns the count changed. */
  async function markAllRead(actor: Actor): Promise<number> {
    const result = await db.notification.updateMany({
      where: { recipientId: actor.userId, archivedAt: null, readAt: null },
      data: { readAt: now() },
    });
    return result.count;
  }

  /**
   * D-23 — retention is archive-only, system-wide (no `recipientId` filter:
   * this runs from a scheduled task, not a request). Selects at most
   * `limit` candidate ids first, then updates only that bounded id subset
   * in a single statement, so a run with many eligible rows never holds one
   * long-running, unbounded UPDATE lock. Only ever sets `archivedAt` — no
   * delete path exists anywhere in this file. A row already archived is
   * excluded by the `archivedAt: null` filter, so a second run never
   * re-stamps it. Returns the number of rows actually changed.
   */
  async function archiveReadOlderThan(cutoff: Date, limit: number): Promise<number> {
    const candidates = await db.notification.findMany({
      where: { readAt: { not: null, lte: cutoff }, archivedAt: null },
      take: limit,
    });
    if (candidates.length === 0) {
      return 0;
    }
    const result = await db.notification.updateMany({
      where: { id: { in: candidates.map((row) => row.id) } },
      data: { archivedAt: now() },
    });
    return result.count;
  }

  return { unreadCount, list, markRead, markAllRead, archiveReadOlderThan };
}

export const notificationService = createNotificationService({
  db: prisma as unknown as NotificationStore,
});
