import type { Config } from "@netlify/functions";
import { runCloseResolvedTicketsTask } from "../../src/server/scheduled/close-resolved-tickets-task";

export function createCloseResolvedTicketsHandler(run: () => Promise<void>) {
  return async function closeResolvedTickets(): Promise<void> {
    await run();
  };
}

export default createCloseResolvedTicketsHandler(runCloseResolvedTicketsTask);

export const config: Config = {
  schedule: "15 * * * *",
};
