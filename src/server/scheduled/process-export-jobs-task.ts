import { exportWorkerService } from "@/server/services/export-worker-service";

export const PROCESS_EXPORT_BATCH_SIZE = 10;

export function createProcessExportJobsTask(deps: {
  processBatch: (limit: number) => Promise<{ processed: number; failed: number }>;
  log: (message: string) => void;
}) {
  return async function runProcessExportJobsTask(): Promise<void> {
    const result = await deps.processBatch(PROCESS_EXPORT_BATCH_SIZE);
    deps.log(`[scheduled] processed ${result.processed} exports; ${result.failed} failed`);
  };
}

export const runProcessExportJobsTask = createProcessExportJobsTask({
  processBatch: exportWorkerService.processBatch,
  log: (message) => console.info(message),
});
