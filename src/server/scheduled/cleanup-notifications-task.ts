/**
 * Scheduled 90-day archive of read notifications (D-23, D-01 pattern).
 *
 * Mirrors `release-expired-holds-task.ts` exactly: a small, injected-deps
 * factory (`createCleanupNotificationsTask`) for the RED/GREEN test cycle,
 * plus a wired singleton (`runCleanupNotificationsTask`) the Netlify
 * scheduled function invokes. This file and everything it imports
 * (`notification-service.ts`) must never import `next/headers`, the
 * permission layer, or `getCurrentActor` — proven by `tests/boundary.test.ts`'s
 * worker-runtime-closure scan, which walks every file in `netlify/functions/`
 * automatically.
 */

import { notificationService } from "@/server/services/notification-service";

/** A0-01: the retention window (D-23). */
export const NOTIFICATION_ARCHIVE_DAYS = 90;
/** Bounded batch per run so no single invocation holds a long lock. */
export const CLEANUP_BATCH_SIZE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CleanupNotificationsTaskDeps = {
  archiveReadOlderThan: (cutoff: Date, limit: number) => Promise<number>;
  log: (message: string) => void;
  now?: () => Date;
};

export function createCleanupNotificationsTask(deps: CleanupNotificationsTaskDeps) {
  const now = deps.now ?? (() => new Date());

  return async function runCleanupNotificationsTask(): Promise<void> {
    const cutoff = new Date(now().getTime() - NOTIFICATION_ARCHIVE_DAYS * DAY_MS);
    const archived = await deps.archiveReadOlderThan(cutoff, CLEANUP_BATCH_SIZE);
    deps.log(
      `[scheduled] archived ${archived} read notifications older than ${NOTIFICATION_ARCHIVE_DAYS} days`,
    );
  };
}

export const runCleanupNotificationsTask = createCleanupNotificationsTask({
  archiveReadOlderThan: notificationService.archiveReadOlderThan,
  log: (message) => console.info(message),
});
