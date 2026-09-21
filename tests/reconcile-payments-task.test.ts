import { describe, expect, it, vi } from "vitest";
import {
  RECONCILE_PAYMENTS_BATCH_SIZE,
  createReconcilePaymentsTask,
} from "@/server/scheduled/reconcile-payments-task";

describe("reconcile-payments scheduled task", () => {
  it("uses the fixed 25-row serverless batch and logs the result", async () => {
    const reconcilePayments = vi.fn(async () => ({ reconciled: 4, failed: 1 }));
    const log = vi.fn();
    const run = createReconcilePaymentsTask({ reconcilePayments, log });

    await run();

    expect(RECONCILE_PAYMENTS_BATCH_SIZE).toBe(25);
    expect(reconcilePayments).toHaveBeenCalledWith(25);
    expect(reconcilePayments).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "[scheduled] reconciled 4 payment attempts; 1 failed",
    );
  });

  it("propagates a database failure rather than swallowing it", async () => {
    const run = createReconcilePaymentsTask({
      reconcilePayments: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      log: vi.fn(),
    });

    await expect(run()).rejects.toThrow("database unavailable");
  });
});
