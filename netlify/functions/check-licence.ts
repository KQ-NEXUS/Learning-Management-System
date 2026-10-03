import type { Config } from "@netlify/functions";
import { runCheckLicenceTask } from "../../src/server/scheduled/check-licence-task";

export function createCheckLicenceHandler(run: () => Promise<void>) {
  return async function checkLicence(): Promise<void> {
    await run();
  };
}

export default createCheckLicenceHandler(runCheckLicenceTask);

export const config: Config = {
  schedule: "0 * * * *",
};
