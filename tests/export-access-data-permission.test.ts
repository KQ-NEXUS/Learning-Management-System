/**
 * Audit A-02, download side: a finished payments export stays downloadable
 * only while its requester still holds `payments.view` over everything the
 * file contains. `canAccessExportJob` is the predicate both the export history
 * and the download route use.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExportJob } from "@prisma/client";
import type { RawGrant } from "@/server/permissions/with-permission";
import { canAccessExportJob } from "@/server/services/export-read-service";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const GLOBAL_SCOPE = { kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] };

function grant(permission: RawGrant["permission"], scopeType: RawGrant["scopeType"] = "GLOBAL", scopeId: string | null = null): RawGrant {
  return { permission, scopeType, scopeId, active: true, revokedAt: null, startsAt: null, endsAt: null };
}

function job(dataset: string): ExportJob {
  return {
    id: "job-1",
    dataset,
    requestedById: "staff-1",
    scopeSnapshot: GLOBAL_SCOPE,
    columnSnapshot: [{ key: "reference", label: "Reference" }],
  } as unknown as ExportJob;
}

const deps = { countCohorts: vi.fn(async () => 0) };
const access = (dataset: string, grants: RawGrant[]) => canAccessExportJob(job(dataset), "staff-1", grants, NOW, deps);

describe("canAccessExportJob — records' own module grant (A-02)", () => {
  const reportGrants = [grant("reports.view"), grant("reports.export")];

  it("refuses a payments export to a requester without payments.view", async () => {
    expect(await access("payments", reportGrants)).toBe(false);
  });

  it("refuses when payments.view no longer covers the exported scope", async () => {
    expect(await access("payments", [...reportGrants, grant("payments.view", "COHORT", "cohort-a")])).toBe(false);
  });

  it("allows it with payments.view over the whole exported scope", async () => {
    expect(await access("payments", [...reportGrants, grant("payments.view")])).toBe(true);
  });

  it("leaves datasets with no module of their own on the report grants alone", async () => {
    expect(await access("registrations", reportGrants)).toBe(true);
  });
});
