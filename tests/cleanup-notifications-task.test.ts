/**
 * `cleanup-notifications-task.ts` — cutoff arithmetic against a fixed clock,
 * a single bounded call, and the log message (D-23). Mirrors
 * `release-expired-holds-task.test.ts` exactly.
 */

import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_ARCHIVE_DAYS,
  CLEANUP_BATCH_SIZE,
  createCleanupNotificationsTask,
} from "@/server/scheduled/cleanup-notifications-task";

describe("cleanup-notifications scheduled task", () => {
  it("computes the cutoff as now minus 90 days, calls the service with the fixed batch size exactly once, and logs the count", async () => {
    const fixedNow = new Date("2026-09-27T00:00:00.000Z");
    const archiveReadOlderThan = vi.fn(async (cutoff: Date, limit: number) => {
      void cutoff;
      void limit;
      return 7;
    });
    const log = vi.fn();
    const run = createCleanupNotificationsTask({
      archiveReadOlderThan,
      log,
      now: () => fixedNow,
    });

    await run();

    expect(NOTIFICATION_ARCHIVE_DAYS).toBe(90);
    expect(CLEANUP_BATCH_SIZE).toBe(500);
    expect(archiveReadOlderThan).toHaveBeenCalledTimes(1);
    const [cutoff, limit] = archiveReadOlderThan.mock.calls[0];
    expect(limit).toBe(500);
    expect(cutoff.toISOString()).toBe("2026-06-29T00:00:00.000Z");
    expect(log).toHaveBeenCalledWith(
      "[scheduled] archived 7 read notifications older than 90 days",
    );
  });

  it("propagates a database failure", async () => {
    const run = createCleanupNotificationsTask({
      archiveReadOlderThan: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      log: vi.fn(),
    });

    await expect(run()).rejects.toThrow("database unavailable");
  });
});
