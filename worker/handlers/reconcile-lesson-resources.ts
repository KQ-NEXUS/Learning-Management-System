import { enqueueScan } from "@/server/jobs/queue";
import { findStuckPendingAsSystem } from "@/server/services/scan-system-service";

type StuckResource = { id: string };

export type ReconcileLessonResourcesDeps = {
  findStuckPending: (olderThanMinutes: number) => Promise<StuckResource[]>;
  enqueue: (lessonResourceId: string) => Promise<void>;
  log: (message: string) => void;
};

export function createReconcileLessonResourcesHandler(
  deps: ReconcileLessonResourcesDeps,
) {
  return async function reconcileLessonResources(): Promise<void> {
    const stuck = await deps.findStuckPending(10);
    for (const resource of stuck) {
      await deps.enqueue(resource.id);
    }
    deps.log(`[worker] re-enqueued ${stuck.length} stuck lesson resources`);
  };
}

const built = createReconcileLessonResourcesHandler({
  findStuckPending: findStuckPendingAsSystem,
  enqueue: enqueueScan,
  log: (message) => console.info(message),
});

export const reconcileLessonResources = built;
