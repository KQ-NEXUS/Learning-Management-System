import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ request: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/services/audit-export-service", () => ({ auditExportService: { requestAuditExport: calls.request } }));
vi.mock("next/cache", () => ({ revalidatePath: calls.revalidate }));
import { requestAuditExportAction } from "@/app/staff/audit/actions";

beforeEach(() => vi.clearAllMocks());

describe("audit export public action", () => {
  it("rejects browser-selected dataset, rows, scope and producer callbacks", async () => {
    const base = { filters: { action: "record.updated" }, columns: ["eventId"] };
    for (const extra of [{ dataset: "payments" }, { rows: [{ secret: "x" }] }, { scope: { kind: "GLOBAL" } }, { producer: "forged" }]) {
      expect(await requestAuditExportAction({ ...base, ...extra })).toMatchObject({ ok: false });
    }
    expect(calls.request).not.toHaveBeenCalled();
  });
  it("sends only filters, columns and reason to the server-owned audit producer", async () => {
    calls.request.mockResolvedValue({ jobId: "job-1", status: "QUEUED", storageKey: "private" });
    const input = { filters: { actorId: "staff-1", from: "2026-09-01" }, columns: ["eventId", "actorName"], reason: "Case investigation" };
    expect(await requestAuditExportAction(input)).toEqual({ ok: true, jobId: "job-1", status: "QUEUED" });
    expect(calls.request).toHaveBeenCalledWith(input);
    expect(calls.revalidate).toHaveBeenCalledWith("/staff/reports/exports", "page");
  });
});
