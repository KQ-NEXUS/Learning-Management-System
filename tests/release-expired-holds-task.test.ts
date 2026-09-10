import { describe, expect, it, vi } from "vitest";
import {
  HOLD_SWEEP_BATCH_SIZE,
  createReleaseExpiredHoldsTask,
} from "@/server/scheduled/release-expired-holds-task";

describe("release-expired-holds scheduled task", () => {
  it("uses the fixed 25-row serverless batch and logs the result", async () => {
    const releaseExpiredHolds = vi.fn(async () => ({ released: 3, failed: 1 }));
    const log = vi.fn();
    const run = createReleaseExpiredHoldsTask({ releaseExpiredHolds, log });

    await run();

    expect(HOLD_SWEEP_BATCH_SIZE).toBe(25);
    expect(releaseExpiredHolds).toHaveBeenCalledWith(25);
    expect(log).toHaveBeenCalledWith(
      "[scheduled] released 3 expired seat holds; 1 failed",
    );
  });

  it("propagates a database failure", async () => {
    const run = createReleaseExpiredHoldsTask({
      releaseExpiredHolds: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      log: vi.fn(),
    });

    await expect(run()).rejects.toThrow("database unavailable");
  });
});
