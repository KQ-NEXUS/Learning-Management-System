import type { Config } from "@netlify/functions";
import { runDrainDomainEventsTask } from "../../src/server/scheduled/drain-domain-events-task";

export function createDrainDomainEventsHandler(run: () => Promise<void>) {
  return async function drainDomainEvents(): Promise<void> {
    await run();
  };
}

export default createDrainDomainEventsHandler(runDrainDomainEventsTask);

export const config: Config = {
  schedule: "* * * * *",
};
