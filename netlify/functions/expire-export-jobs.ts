import type { Config } from "@netlify/functions";
import { runExpireExportJobsTask } from "../../src/server/scheduled/expire-export-jobs-task";

export function createExpireExportJobsHandler(run: () => Promise<void>) {
  return async function expireExportJobs(): Promise<void> {
    await run();
  };
}

export default createExpireExportJobsHandler(runExpireExportJobsTask);

export const config: Config = { schedule: "*/15 * * * *" };
