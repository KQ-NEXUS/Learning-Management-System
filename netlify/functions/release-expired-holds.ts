import type { Config } from "@netlify/functions";
import { runReleaseExpiredHoldsTask } from "../../src/server/scheduled/release-expired-holds-task";

export function createReleaseExpiredHoldsHandler(run: () => Promise<void>) {
  return async function releaseExpiredHolds(): Promise<void> {
    await run();
  };
}

export default createReleaseExpiredHoldsHandler(runReleaseExpiredHoldsTask);

export const config: Config = {
  schedule: "*/5 * * * *",
};
