import {
  closeResolvedTicketsAsSystem,
  type AutoCloseResult,
} from "@/server/services/ticket-auto-close-system-service";

/** Bounded so a backlog drains across hourly runs, not one long invocation. */
export const AUTO_CLOSE_BATCH_SIZE = 50;

export type CloseResolvedTicketsTaskDeps = {
  close: (now: Date, batchLimit: number) => Promise<AutoCloseResult>;
  now: () => Date;
  log: (message: string) => void;
};

export function createCloseResolvedTicketsTask(deps: CloseResolvedTicketsTaskDeps) {
  return async function runCloseResolvedTicketsTask(): Promise<void> {
    const result = await deps.close(deps.now(), AUTO_CLOSE_BATCH_SIZE);
    deps.log(
      `[scheduled] auto-closed ${result.closed} resolved tickets; ${result.skipped} skipped; ${result.failed} failed`,
    );
  };
}

export const runCloseResolvedTicketsTask = createCloseResolvedTicketsTask({
  close: closeResolvedTicketsAsSystem,
  now: () => new Date(),
  log: (message) => console.info(message),
});
