import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportJob } from "@prisma/client";
import type { RawGrant } from "@/server/permissions/with-permission";
import { createExportDownloadService } from "@/server/services/export-download-service";
import { createExportReadService, ExportUnavailableError } from "@/server/services/export-read-service";

const routeCalls = vi.hoisted(() => ({ getDownloadUrl: vi.fn() }));
vi.mock("@/server/services/export-download-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/export-download-service")>()),
  exportDownloadService: routeCalls,
}));
import { GET } from "../src/app/api/staff/reports/exports/[jobId]/download/route";

const now = new Date("2026-09-16T12:00:00.000Z");
const globalGrant = (permission: RawGrant["permission"]): RawGrant => ({ permission, scopeType: "GLOBAL", scopeId: null, active: true, revokedAt: null, startsAt: null, endsAt: null });
const grants = [globalGrant("reports.view"), globalGrant("reports.export")];
const job = (changes: Partial<ExportJob> = {}) => ({
  id: "job-1", requestedById: "staff-1", dataset: "payments", datasetVersion: "1.0", filters: { currency: "NGN" },
  asOf: now, timezone: "Africa/Lagos", scopeSnapshot: { kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] },
  columnSnapshot: [{ key: "reference", label: "Reference" }], sensitiveReason: null, idempotencyKey: null, retryOfId: null,
  status: "SUCCEEDED", rowCount: 1, storageKey: "exports/private.csv", expiresAt: new Date(now.getTime() + 60_000),
  error: null, errorCode: null, errorMessage: null, createdAt: now, startedAt: now, completedAt: now,
  downloadedAt: null, updatedAt: now, ...changes,
}) as ExportJob;

function download(input: { record?: ExportJob | null; user?: string | null; permissions?: RawGrant[]; count?: number } = {}) {
  const audit = vi.fn().mockResolvedValue(undefined);
  const presign = vi.fn().mockResolvedValue("https://private.example.test/signed");
  const service = createExportDownloadService({
    actor: async () => input.user === null ? null : { userId: input.user ?? "staff-1" },
    loadGrants: async () => input.permissions ?? grants,
    findJob: async () => input.record === undefined ? job() : input.record,
    countCohorts: async () => input.count ?? 0,
    audit, presign, now: () => now,
  });
  return { service, audit, presign };
}

describe("current authorization for export downloads", () => {
  it("audits before presigning an unexpired owned job", async () => {
    const { service, audit, presign } = download();
    expect(await service.getDownloadUrl("job-1")).toBe("https://private.example.test/signed");
    expect(audit).toHaveBeenCalledWith("job-1", "staff-1");
    expect(presign).toHaveBeenCalledWith({ key: "exports/private.csv", filename: "payments-2026-09-16.csv" });
    expect(audit.mock.invocationCallOrder[0]).toBeLessThan(presign.mock.invocationCallOrder[0]);
  });

  it.each([
    { name: "missing", input: { record: null } },
    { name: "different owner", input: { record: job({ requestedById: "staff-2" }) } },
    { name: "revoked export permission", input: { permissions: [globalGrant("reports.view")] } },
    { name: "expired at exact boundary", input: { record: job({ expiresAt: now }) } },
    { name: "failed", input: { record: job({ status: "FAILED" }) } },
    { name: "sensitive identity revoked", input: { record: job({ columnSnapshot: [{ key: "learnerEmail", label: "Learner email", permission: "users.view" }] }) } },
    { name: "original global scope narrowed", input: { permissions: [{ ...globalGrant("reports.view"), scopeType: "COHORT" as const, scopeId: "cohort-1" }, globalGrant("reports.export")] } },
    { name: "signed out", input: { user: null } },
  ])("denies $name identically without minting a URL", async ({ input }) => {
    const { service, audit, presign } = download(input);
    await expect(service.getDownloadUrl("job-1")).rejects.toThrow(ExportUnavailableError);
    expect(audit).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();
  });

  it("hides jobs after scope revocation and projects no storage key or sensitive reason", async () => {
    const read = createExportReadService({
      actor: async () => ({ userId: "staff-1" }), loadGrants: async () => grants,
      findJobs: async () => [Object.assign(job({ sensitiveReason: "operational detail" }), { retries: [{ id: "job-2" }] })], countCohorts: async () => 0, now: () => now,
    });
    const rows = await read.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dataset: "payments", status: "SUCCEEDED", canDownload: true, rowCount: 1, retriedById: "job-2" });
    expect(JSON.stringify(rows)).not.toContain("storageKey");
    expect(JSON.stringify(rows)).not.toContain("operational detail");
  });

  it("pages only currently visible jobs in stable order", async () => {
    const records = Array.from({ length: 51 }, (_, index) => job({ id: `job-${String(index).padStart(3, "0")}` }));
    const read = createExportReadService({ actor: async () => ({ userId: "staff-1" }), loadGrants: async () => grants,
      findJobs: async () => records, countCohorts: async () => 0, now: () => now });
    const first = await read.listPage({ page: 1 });
    const second = await read.listPage({ page: 2 });
    expect(first.rows).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.rows.map((row) => row.id)).toEqual(["job-050"]);
    expect(second.hasMore).toBe(false);
  });
});

describe("download route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("awaits promised params and redirects privately", async () => {
    routeCalls.getDownloadUrl.mockResolvedValue("https://private.example.test/signed");
    const response = await GET(new Request("https://lms.example.test"), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(routeCalls.getDownloadUrl).toHaveBeenCalledWith("job-1");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://private.example.test/signed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns one non-revealing recovery response for unavailable jobs", async () => {
    routeCalls.getDownloadUrl.mockRejectedValue(new ExportUnavailableError());
    const response = await GET(new Request("https://lms.example.test"), { params: Promise.resolve({ jobId: "missing" }) });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("The file may have expired or your access may have changed.");
    expect(response.headers.get("location")).toBeNull();
  });
});
