import { beforeEach, describe, expect, it, vi } from "vitest";

const requestExport = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/services/export-service", () => ({
  exportService: { requestExport },
  ExportRequestError: class ExportRequestError extends Error {},
}));
vi.mock("@/server/services/reconciliation-case-service", () => ({
  assignReconciliationCases: vi.fn(),
  resolveReconciliationCase: vi.fn(),
}));

import { requestReconciliationRefundExportAction } from "@/app/staff/reconciliation/actions";

const valid = {
  filters: { provider: "PAYSTACK", currency: "NGN", from: "2026-09-01", status: "COMPLETED" },
  columns: ["reference", "occurredAt", "amountMinor", "currency"],
  asOf: "2026-09-16T09:00:00.000Z",
};

beforeEach(() => requestExport.mockReset());

describe("reconciliation refund export action boundary", () => {
  it("fixes the dataset on the server and returns only a job reference", async () => {
    requestExport.mockResolvedValue({ jobId: "job-1", status: "QUEUED", storageKey: "private-key" });
    expect(await requestReconciliationRefundExportAction(valid)).toEqual({ ok: true, jobId: "job-1", status: "QUEUED" });
    expect(requestExport).toHaveBeenCalledWith({ dataset: "reconciliation-refunds", ...valid });
  });

  it("rejects forged dataset, scope and row fields before reaching the service", async () => {
    for (const forged of [{ ...valid, dataset: "audit" }, { ...valid, scope: { kind: "GLOBAL" } }, { ...valid, rows: [{ secret: "x" }] }]) {
      expect((await requestReconciliationRefundExportAction(forged)).ok).toBe(false);
    }
    expect(requestExport).not.toHaveBeenCalled();
  });
});
