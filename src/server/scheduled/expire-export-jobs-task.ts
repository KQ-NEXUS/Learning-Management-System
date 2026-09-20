import { exportWorkerService } from "@/server/services/export-worker-service";

export const EXPIRE_EXPORT_BATCH_SIZE = 25;

export function createExpireExportJobsTask(deps: {
  expireBatch: (limit: number) => Promise<number>;
  log: (message: string) => void;
}) {
  return async function runExpireExportJobsTask(): Promise<void> {
    const expired = await deps.expireBatch(EXPIRE_EXPORT_BATCH_SIZE);
    deps.log(`[scheduled] expired ${expired} export files`);
  };
}

export const runExpireExportJobsTask = createExpireExportJobsTask({
  expireBatch: exportWorkerService.expireBatch,
  log: (message) => console.info(message),
});
