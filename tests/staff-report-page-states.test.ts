import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/** UX batch B — the report page's failure states are proper pages, not bare boxes. */

const m = vi.hoisted(() => ({ getDatasetReport: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/server/services/report-query-service", () => ({ reportQueryService: { getDatasetReport: m.getDatasetReport } }));
vi.mock("@/app/staff/reports/[dataset]/ReportDashboard", () => ({ ReportDashboard: () => null }));

import { AuthorizationError } from "@/server/permissions";
import DatasetReportPage from "@/app/staff/reports/[dataset]/page";

const run = (dataset: string, query: Record<string, string> = {}) =>
  DatasetReportPage({ params: Promise.resolve({ dataset }), searchParams: Promise.resolve(query) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("report page states", () => {
  it("an unknown report is the staff 404", async () => {
    await expect(run("not-a-dataset")).rejects.toThrow("NOT_FOUND");
  });

  it("a report the role cannot open is the staff 404 too (no hint it exists)", async () => {
    m.getDatasetReport.mockRejectedValue(new AuthorizationError("reports.view"));
    await expect(run("registrations")).rejects.toThrow("NOT_FOUND");
  });

  it("invalid filters get a header, plain words and a way to clear them — no nested main", async () => {
    m.getDatasetReport.mockRejectedValue(new Error("Report filters are invalid: from"));
    const html = renderToStaticMarkup(await run("registrations", { from: "nonsense" })).replaceAll("&#x27;", "'");
    expect(html).toContain("Registrations");
    expect(html).toMatch(/filters in this link aren't valid/i);
    expect(html).toContain('href="/staff/reports/registrations"');
    expect(html).toContain('href="/staff/reports"');
    expect(html).not.toContain("<main");
    expect(html).not.toMatch(/replaced with zero/);
  });

  it("a failed load offers Retry with the same filters and Back to Reports", async () => {
    m.getDatasetReport.mockRejectedValue(new Error("connection reset"));
    const html = renderToStaticMarkup(await run("registrations", { from: "2026-09-01" })).replaceAll("&#x27;", "'");
    expect(html).toMatch(/couldn.t load this report/i);
    expect(html).toContain('href="/staff/reports/registrations?from=2026-09-01"');
    expect(html).not.toContain("<main");
    expect(html).not.toContain("connection reset");
  });
});
