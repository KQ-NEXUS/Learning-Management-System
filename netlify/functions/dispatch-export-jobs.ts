import type { Config } from "@netlify/functions";
import { runDispatchExportJobsTask } from "../../src/server/scheduled/dispatch-export-jobs-task";

export function createDispatchExportJobsHandler(run: () => Promise<void>) {
  return async function dispatchExportJobs(): Promise<void> {
    await run();
  };
}

export default createDispatchExportJobsHandler(runDispatchExportJobsTask);

export const config: Config = { schedule: "* * * * *" };
