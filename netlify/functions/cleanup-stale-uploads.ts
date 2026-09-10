import type { Config } from "@netlify/functions";
import { runCleanupStaleUploadsTask } from "../../src/server/scheduled/cleanup-stale-uploads-task";

export function createCleanupStaleUploadsHandler(run: () => Promise<void>) {
  return async function cleanupStaleUploads(): Promise<void> {
    await run();
  };
}

export default createCleanupStaleUploadsHandler(runCleanupStaleUploadsTask);

export const config: Config = {
  schedule: "0 * * * *",
};
