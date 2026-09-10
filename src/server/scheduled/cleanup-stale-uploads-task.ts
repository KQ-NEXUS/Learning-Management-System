import { cleanupStaleLessonUploadsAsSystem } from "@/server/services/upload-cleanup-system-service";

/** Intents older than this are abandoned; the R2 lifecycle rule is the backstop. */
export const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

/** Bounded so a backlog drains across hourly runs, not one long invocation. */
export const STALE_UPLOAD_BATCH_SIZE = 50;

export type CleanupStaleUploadsTaskDeps = {
  cleanup: (
    olderThan: Date,
    batchLimit: number,
  ) => Promise<{ removed: number; failed: number }>;
  now: () => Date;
  log: (message: string) => void;
};

export function createCleanupStaleUploadsTask(deps: CleanupStaleUploadsTaskDeps) {
  return async function runCleanupStaleUploadsTask(): Promise<void> {
    const olderThan = new Date(deps.now().getTime() - STALE_UPLOAD_AGE_MS);
    const result = await deps.cleanup(olderThan, STALE_UPLOAD_BATCH_SIZE);
    deps.log(
      `[scheduled] removed ${result.removed} abandoned uploads; ${result.failed} failed`,
    );
  };
}

export const runCleanupStaleUploadsTask = createCleanupStaleUploadsTask({
  cleanup: cleanupStaleLessonUploadsAsSystem,
  now: () => new Date(),
  log: (message) => console.info(message),
});
