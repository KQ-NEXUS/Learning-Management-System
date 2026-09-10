import { releaseExpiredHoldsAsSystem } from "@/server/services/hold-release-system-service";

export const HOLD_SWEEP_BATCH_SIZE = 25;

export type ReleaseExpiredHoldsTaskDeps = {
  releaseExpiredHolds: (
    batchLimit: number,
  ) => Promise<{ released: number; failed: number }>;
  log: (message: string) => void;
};

export function createReleaseExpiredHoldsTask(
  deps: ReleaseExpiredHoldsTaskDeps,
) {
  return async function runReleaseExpiredHoldsTask(): Promise<void> {
    const result = await deps.releaseExpiredHolds(HOLD_SWEEP_BATCH_SIZE);
    deps.log(
      `[scheduled] released ${result.released} expired seat holds; ${result.failed} failed`,
    );
  };
}

export const runReleaseExpiredHoldsTask = createReleaseExpiredHoldsTask({
  releaseExpiredHolds: releaseExpiredHoldsAsSystem,
  log: (message) => console.info(message),
});
