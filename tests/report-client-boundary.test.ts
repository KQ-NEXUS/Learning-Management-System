import { describe, expect, it } from "vitest";
import { toClientDatasetReport } from "@/lib/report-client-projection";
import { getReportDefinition } from "@/server/services/report-registry";
import type { UnavailableDatasetReport } from "@/server/services/report-query-service";

describe("report dashboard client boundary", () => {
  it("removes the executable filter schema before the report enters a Client Component", () => {
    const report: UnavailableDatasetReport = {
      available: false,
      definition: getReportDefinition("progress"),
      request: {
        dataset: "progress",
        version: "1.0",
        filters: {},
        scope: {
          kind: "LIMITED",
          programmeIds: ["programme-a"],
          courseIds: [],
          cohortIds: ["cohort-a"],
        },
        cohortWhere: { id: { in: ["cohort-a"] } },
        asOf: new Date("2026-09-20T00:00:00.000Z"),
      },
      lastRefreshed: new Date("2026-09-20T00:00:00.000Z"),
    };

    const clientReport = toClientDatasetReport(report);

    expect(clientReport.definition.id).toBe("progress");
    expect(clientReport.definition).not.toHaveProperty("filterSchema");
    expect(clientReport.request.asOf).toBeInstanceOf(Date);
  });
});
