import { describe, expect, it, vi } from "vitest";
import {
  DRAIN_EVENT_BATCH_SIZE,
  DRAIN_SEND_BATCH_SIZE,
  createDrainDomainEventsTask,
} from "@/server/scheduled/drain-domain-events-task";

describe("drain-domain-events scheduled task", () => {
  it("drains with the fixed 25/25 batch and logs the processed/skipped/poisoned/sent/retried/failed counts", async () => {
    const drain = vi.fn(async () => ({
      processed: 3,
      skipped: 1,
      poisoned: 1,
      sent: 2,
      retried: 1,
      failed: 0,
    }));
    const log = vi.fn();
    const run = createDrainDomainEventsTask({ drain, log });

    await run();

    expect(DRAIN_EVENT_BATCH_SIZE).toBe(25);
    expect(DRAIN_SEND_BATCH_SIZE).toBe(25);
    expect(drain).toHaveBeenCalledWith({ events: 25, sends: 25 });
    expect(log).toHaveBeenCalledWith(
      "[scheduled] drained 3 events (1 skipped, 1 poisoned); sent 2, retried 1, failed 0",
    );
  });

  it("propagates a database failure", async () => {
    const run = createDrainDomainEventsTask({
      drain: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      log: vi.fn(),
    });

    await expect(run()).rejects.toThrow("database unavailable");
  });
});
