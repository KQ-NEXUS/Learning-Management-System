/**
 * The outbox drain's scheduled entrypoint (D-01) — mirrors
 * `release-expired-holds-task.ts` exactly: a small `createX(deps)` factory
 * for testability, and a real singleton wired to the live drain service.
 * Also the exported on-demand runner: `runDrainDomainEventsTask` has no HTTP
 * trigger or shared secret, per the plan's assumption that on-demand
 * invocation is this export, nothing more.
 */

import { domainEventDrainService } from "@/server/services/domain-event-drain-service";

export const DRAIN_EVENT_BATCH_SIZE = 25;
export const DRAIN_SEND_BATCH_SIZE = 25;

export type DrainDomainEventsTaskDeps = {
  drain: (limits: { events: number; sends: number }) => Promise<{
    processed: number;
    skipped: number;
    poisoned: number;
    sent: number;
    retried: number;
    failed: number;
  }>;
  log: (message: string) => void;
};

export function createDrainDomainEventsTask(deps: DrainDomainEventsTaskDeps) {
  return async function runDrainDomainEventsTask(): Promise<void> {
    const result = await deps.drain({ events: DRAIN_EVENT_BATCH_SIZE, sends: DRAIN_SEND_BATCH_SIZE });
    deps.log(
      `[scheduled] drained ${result.processed} events (${result.skipped} skipped, ${result.poisoned} poisoned); ` +
        `sent ${result.sent}, retried ${result.retried}, failed ${result.failed}`,
    );
  };
}

export const runDrainDomainEventsTask = createDrainDomainEventsTask({
  drain: (limits) => domainEventDrainService.drain(limits),
  log: (message) => console.info(message),
});
