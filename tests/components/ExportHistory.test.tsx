import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportHistory } from "@/app/staff/reports/exports/ExportHistory";
import type { ExportHistoryRow } from "@/server/services/export-read-service";

const refresh = vi.fn();
const retry = vi.fn();
const rerun = vi.fn();
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/staff/reports/exports/actions", () => ({ retryHistoryExportAction: (...args: unknown[]) => retry(...args), rerunHistoryExportAction: (...args: unknown[]) => rerun(...args) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const filters = { dataset: "", status: "", from: "", to: "", search: "" };
const base: ExportHistoryRow = {
  id: "job-1", dataset: "payments", datasetVersion: "1.0", filters: { currency: "NGN" }, columns: ["Reference"],
  status: "SUCCEEDED", rowCount: 1, asOf: "2026-09-16T10:00:00.000Z", timezone: "Africa/Lagos",
  createdAt: "2026-09-16T10:00:00.000Z", completedAt: "2026-09-16T10:01:00.000Z",
  expiresAt: "2026-09-17T10:01:00.000Z", retryOfId: null, failure: null, canDownload: true,
};

describe("Export History", () => {
  it("keeps filters and manual Refresh status in the empty state", () => {
    render(<ExportHistory state="ready" rows={[]} filters={{ ...filters, dataset: "payments" }} />);
    expect(screen.getByText("No exports yet")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Dataset" }).getAttribute("name")).toBe("dataset");
    expect((screen.getByRole("combobox", { name: "Dataset" }) as HTMLSelectElement).value).toBe("payments");
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("renders pending separately from genuine zero, with text status and frozen timestamp", () => {
    render(<ExportHistory state="ready" filters={filters} rows={[{ ...base, id: "queued", status: "QUEUED", rowCount: null, canDownload: false }, { ...base, id: "zero", rowCount: 0, canDownload: false }]} />);
    expect(screen.getAllByText("Pending rows").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0 rows").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/As of/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("link", { name: "Download CSV" })).toBeNull();
  });
  it("shows a route download only for a currently available success", () => {
    render(<ExportHistory state="ready" filters={filters} rows={[base, { ...base, id: "expired-success", canDownload: false }]} />);
    const link = within(screen.getByRole("table")).getByRole("link", { name: "Download CSV" });
    expect(link.getAttribute("href")).toBe("/api/staff/reports/exports/job-1/download");
    expect(document.body.textContent).not.toContain("storageKey");
  });
  it("keeps dataset, status, count, as-of and action in a mobile card", () => {
    render(<ExportHistory state="ready" filters={filters} rows={[base]} />);
    const cards = screen.getByRole("list", { name: "Export history cards" });
    const card = within(cards).getByRole("listitem");
    expect(within(card).getByText("Payments")).toBeTruthy();
    expect(within(card).getByText("Succeeded")).toBeTruthy();
    expect(within(card).getByText("1 row")).toBeTruthy();
    expect(within(card).getByText("As of")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Download CSV" })).toBeTruthy();
  });
  it("links both sides of retry lineage without exposing a storage key", () => {
    render(<ExportHistory state="ready" filters={filters} rows={[{ ...base, id: "old", status: "FAILED", canDownload: false, retriedById: "new" }, { ...base, id: "new", retryOfId: "old", canDownload: false }]} />);
    const cards = screen.getByRole("list", { name: "Export history cards" });
    expect(within(cards).getByRole("link", { name: "new" }).getAttribute("href")).toBe("/staff/reports/exports?search=new");
    expect(within(cards).getByText("Retry of old")).toBeTruthy();
  });
  it("preserves URL filters when paging through many jobs", () => {
    render(<ExportHistory state="ready" filters={{ ...filters, dataset: "payments" }} rows={[base]} page={1} hasMore />);
    expect(screen.getByRole("link", { name: "Next page" }).getAttribute("href")).toBe("/staff/reports/exports?dataset=payments&page=2");
  });
  it("retries a failed job without hiding the old row on action failure", async () => {
    retry.mockResolvedValue({ ok: false, message: "Could not queue the retry." });
    render(<ExportHistory state="ready" filters={filters} rows={[{ ...base, status: "FAILED", canDownload: false, failure: "The storage operation failed safely." }]} />);
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Retry export" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not queue the retry.");
    expect(retry).toHaveBeenCalledWith("job-1");
    expect(screen.getAllByText("The storage operation failed safely.").length).toBeGreaterThan(0);
  });
  it("explains new snapshot semantics before rerunning an expired job", async () => {
    rerun.mockResolvedValue({ ok: true, jobId: "job-2", status: "QUEUED" });
    render(<ExportHistory state="ready" filters={filters} rows={[{ ...base, status: "EXPIRED", canDownload: false }]} />);
    expect(screen.getAllByText(/Rerunning captures current data/).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Rerun export" }));
    await waitFor(() => expect(rerun).toHaveBeenCalledWith("job-1"));
    expect(await screen.findByRole("link", { name: "View new attempt" })).toBeTruthy();
  }, 15_000);
  it("keeps chrome and recovery in loading and error states", () => {
    const { rerender } = render(<ExportHistory state="loading" filters={filters} />);
    expect(screen.getByRole("status", { name: "Loading export history" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeTruthy();
    rerender(<ExportHistory state="error" filters={filters} />);
    expect(within(screen.getByRole("alert")).getByText(/Export History is unavailable/)).toBeTruthy();
  });
});
