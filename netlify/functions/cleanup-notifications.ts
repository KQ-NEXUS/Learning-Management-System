import type { Config } from "@netlify/functions";
import { runCleanupNotificationsTask } from "../../src/server/scheduled/cleanup-notifications-task";

export function createCleanupNotificationsHandler(run: () => Promise<void>) {
  return async function cleanupNotifications(): Promise<void> {
    await run();
  };
}

export default createCleanupNotificationsHandler(runCleanupNotificationsTask);

export const config: Config = {
  schedule: "0 3 * * *",
};
