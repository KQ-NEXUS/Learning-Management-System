import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsHub } from "@/app/staff/reports/ReportsHub";
import type { HubOverview } from "@/server/services/report-query-service";
import { ReportDashboard } from "@/app/staff/reports/[dataset]/ReportDashboard";
import { getReportDefinition } from "@/server/services/report-registry";
import type { AvailableDatasetReport, UnavailableDatasetReport } from "@/server/services/report-query-service";

const exportActions = vi.hoisted(() => ({ request: vi.fn(), sensitive: vi.fn() }));
vi.mock("@/app/staff/reports/actions", () => ({ requestReportExportAction: exportActions.request, permittedSensitiveColumnsAction: exportActions.sensitive }));
exportActions.sensitive.mockResolvedValue([]);
exportActions.request.mockResolvedValue({ ok: true, jobId: "queued-job", status: "QUEUED" });

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(cleanup);

const overview: HubOverview = {
  request: {
    dataset: "registrations",
    version: "1.0",
    filters: {
      from: "2026-09-01",
      to: "2026-09-15",
      programmeId: "programme-a",
      cohortId: "cohort-a",
      provider: "PAYSTACK",
    },
    scope: {
      kind: "LIMITED",
      programmeIds: ["programme-a"],
      courseIds: [],
      cohortIds: ["cohort-a"],
    },
    cohortWhere: { id: { in: ["cohort-a"] } },
    asOf: new Date("2026-09-15T12:34:56.000Z"),
  },
  lastRefreshed: new Date("2026-09-15T12:34:56.000Z"),
  headlines: {
    registrations: 12,
    activeEnrolments: 8,
    unresolvedPaymentExceptions: 3,
    paymentTotals: { NGN: 45_600_000, USD: 125_000 },
  },
};

describe("ReportsHub", () => {
  it("renders the three groups and all ten reports in stable registry order", () => {
    render(<ReportsHub state="ready" overview={overview} scopeLabel="Programme A / Cohort A" />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Admissions & Finance",
      "Learning Delivery",
      "Outcomes & Support",
    ]);
    expect(screen.getAllByTestId("report-card").map((card) => card.getAttribute("data-dataset"))).toEqual([
      "registrations",
      "payments",
      "enrolments",
      "attendance",
      "progress",
      "submissions",
      "grades",
      "completion",
      "certificates",
      "support",
    ]);
  });

  it("makes every headline a destination-named link that preserves applicable filters", () => {
    render(<ReportsHub state="ready" overview={overview} scopeLabel="Programme A / Cohort A" />);
    const registration = screen.getByRole("link", { name: "View 12 registrations" });
    expect(registration.getAttribute("href")).toContain("/staff/reports/registrations?");
    expect(registration.getAttribute("href")).toContain("from=2026-09-01");
    expect(registration.getAttribute("href")).toContain("programmeId=programme-a");
    expect(registration.getAttribute("href")).toContain("cohortId=cohort-a");

    const exceptions = screen.getByRole("link", { name: "View 3 unresolved payment exceptions" });
    expect(exceptions.getAttribute("href")).toContain("/staff/reconciliation?");
    expect(exceptions.getAttribute("href")).toContain("provider=PAYSTACK");
  });

  it("renders separately labelled NGN and USD payment totals and no combined total", () => {
    render(<ReportsHub state="ready" overview={overview} scopeLabel="Limited scope" />);
    expect(screen.getByRole("link", { name: /View NGN confirmed payments/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /View USD confirmed payments/ })).toBeTruthy();
    expect(screen.queryByText("Combined payment total")).toBeNull();
    expect(screen.queryByText("All-currency total")).toBeNull();
  });

  it("shows mixed availability explicitly and never gives unavailable reports a zero", () => {
    render(<ReportsHub state="ready" overview={overview} scopeLabel="Limited scope" />);
    expect(screen.getAllByText("Available")).toHaveLength(4);
    expect(screen.getAllByText("Not available yet")).toHaveLength(6);
    const progress = screen
      .getAllByTestId("report-card")
      .find((card) => card.getAttribute("data-dataset") === "progress")!;
    expect(within(progress).getByText("Not available yet")).toBeTruthy();
    expect(progress.textContent).not.toMatch(/\b0\b/);
    expect(progress.textContent).toContain("authoritative");
  });

  it("renders genuine checked zeros only in the populated ready state", () => {
    render(
      <ReportsHub
        state="ready"
        overview={{
          ...overview,
          headlines: {
            registrations: 0,
            activeEnrolments: 0,
            unresolvedPaymentExceptions: 0,
            paymentTotals: { NGN: 0, USD: 0 },
          },
        }}
        scopeLabel="No matching collections"
      />,
    );
    expect(screen.getByRole("link", { name: "View 0 registrations" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /View NGN confirmed payments: NGN\s0\.00/ })).toBeTruthy();
  });

  it("keeps page chrome and report navigation visible while loading", () => {
    render(<ReportsHub state="loading" />);
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading report overview");
    expect(screen.getAllByTestId("report-card")).toHaveLength(10);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders a non-revealing error without stale metrics or scope identifiers", () => {
    render(<ReportsHub state="error" />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load this report. No value has been replaced with zero.",
    );
    expect(screen.queryByText("cohort-a")).toBeNull();
    expect(screen.queryByRole("link", { name: /^View .* registrations$/i })).toBeNull();
    expect(screen.getAllByTestId("report-card")).toHaveLength(10);
  });

  it("wraps a long scope label and exposes exact machine-readable timestamps", () => {
    const longLabel = "Executive Leadership Programme with an intentionally exceptionally long cohort label";
    render(<ReportsHub state="ready" overview={overview} scopeLabel={longLabel} />);
    const scope = screen.getByText(longLabel);
    expect(scope.className).toContain("break-words");
    expect(scope.className).not.toContain("truncate");
    const times = screen.getAllByRole("time");
    expect(times).toHaveLength(2);
    expect(times.every((time) => time.getAttribute("datetime") === "2026-09-15T12:34:56.000Z")).toBe(true);
  });
});

const dashboardRequest = {
  ...overview.request,
  dataset: "registrations" as const,
  filters: { from: "2026-09-01", to: "2026-09-15", programmeId: "programme-a", cohortId: "cohort-a" },
};

function registrationDashboard(): AvailableDatasetReport {
  return {
    available: true,
    definition: getReportDefinition("registrations"),
    request: dashboardRequest,
    lastRefreshed: new Date("2026-09-15T12:34:56.000Z"),
    metrics: [{ id: "total", label: "Total registrations", value: 1, format: "COUNT", href: "/staff/reports/registrations?from=2026-09-01&to=2026-09-15&programmeId=programme-a&cohortId=cohort-a#rows" }],
    breakdown: [],
    rows: [{ kind: "registrations", id: "registration-a", reference: "REG-A", learnerName: "Ada", cohortTitle: "Cohort A", status: "ACTIVE", businessDate: new Date("2026-09-01T12:00:00.000Z") }],
    totalRows: 1,
    page: 1,
    pageSize: 25,
    options: { programmes: [{ id: "programme-a", label: "Programme A" }], cohorts: [{ id: "cohort-a", label: "Cohort A" }] },
  };
}

describe("ReportDashboard", () => {
  it("queues normalized active filters and safe columns with the rendered as-of", async () => {
    exportActions.request.mockResolvedValueOnce({ ok: true, jobId: "queued-job", status: "QUEUED" });
    render(<ReportDashboard report={registrationDashboard()} />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(exportActions.request).toHaveBeenCalled());
    expect(exportActions.request.mock.lastCall?.[0]).toMatchObject({
      dataset: "registrations",
      filters: { from: "2026-09-01", to: "2026-09-15", programmeId: "programme-a", cohortId: "cohort-a" },
      columns: ["id", "registeredAt", "status"],
      asOf: "2026-09-15T12:34:56.000Z",
    });
    expect((await screen.findByRole("status")).textContent).toContain("Export queued");
    expect(screen.getByRole("link", { name: "View export history" })).toBeTruthy();
  });

  it("retains sensitive selections and reason on failed queue requests", async () => {
    exportActions.sensitive.mockResolvedValueOnce(["learnerName"]);
    exportActions.request.mockResolvedValueOnce({ ok: false, message: "Unavailable" });
    render(<ReportDashboard report={registrationDashboard()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Export options" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Learner" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Operational reason" }), { target: { value: "Case review" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue export" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Export not queued"));
    expect(exportActions.request.mock.lastCall?.[0]).toMatchObject({ columns: ["id", "registeredAt", "status", "learnerName"], reason: "Case review" });
    expect((screen.getByRole("textbox", { name: "Operational reason" }) as HTMLTextAreaElement).value).toBe("Case review");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("renders an available report trust frame and matching metric link", () => {
    const report = registrationDashboard();
    render(<ReportDashboard report={report} />);
    expect(screen.getByRole("heading", { level: 1, name: "Registrations" })).toBeTruthy();
    expect(screen.getAllByText("Registration date").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Total registrations/ }).getAttribute("href")).toContain("cohortId=cohort-a");
    expect(screen.getAllByText("REG-A")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps desktop report columns readable inside a horizontal scroll region", () => {
    render(<ReportDashboard report={registrationDashboard()} />);
    const table = screen.getByRole("table", { name: "Matching registrations rows" });
    expect(table.className).toContain("min-w-max");
    expect(table.className).not.toContain("table-fixed");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  it("shows not available yet without refresh or export actions", () => {
    const report: UnavailableDatasetReport = {
      available: false,
      definition: getReportDefinition("progress"),
      request: { ...dashboardRequest, dataset: "progress" },
      lastRefreshed: new Date("2026-09-15T12:34:56.000Z"),
    };
    render(<ReportDashboard report={report} />);
    expect(screen.getByRole("heading", { name: "Not available yet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh data" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
  });

  it("shows checked zero copy only for a successful empty query", () => {
    const report = { ...registrationDashboard(), rows: [], totalRows: 0, metrics: [{ id: "total", label: "Total registrations", value: 0, format: "COUNT" as const, href: "/staff/reports/registrations#rows" }] };
    render(<ReportDashboard report={report} />);
    expect(screen.getByRole("heading", { name: "No registrations match these filters" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Total registrations: 0/ })).toBeTruthy();
  });

  it("keeps the trust frame and successful rows when metrics fail independently", () => {
    render(<ReportDashboard report={registrationDashboard()} sectionErrors={["metrics"]} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load metrics. The other report sections are unchanged.");
    expect(screen.getAllByText("REG-A")).toHaveLength(2);
    expect(screen.getAllByRole("time")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Total registrations/ })).toBeNull();
  });
});
