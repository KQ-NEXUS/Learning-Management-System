import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { toClientDatasetReport } from "@/lib/report-client-projection";
import { isReportDataset } from "@/server/services/report-registry";
import { reportQueryService } from "@/server/services/report-query-service";
import { ReportDashboard } from "./ReportDashboard";

export const metadata = { title: "Report dashboard" };

function filterParams(params: Record<string, string | string[] | undefined>) {
  const filters: Record<string, string> = {};
  for (const key of ["from", "to", "programmeId", "cohortId", "provider", "currency", "status", "page", "pageSize"]) {
    const value = params[key];
    if (typeof value === "string" && value) filters[key] = value;
  }
  return filters;
}

export default async function DatasetReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataset: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataset }, query] = await Promise.all([params, searchParams]);
  if (!isReportDataset(dataset)) {
    return <main className="rounded-xl border border-border bg-surface p-6 text-sm">Report unavailable.</main>;
  }
  let report: Awaited<ReturnType<typeof reportQueryService.getDatasetReport>> | null = null;
  let loadError = false;
  try {
    report = await reportQueryService.getDatasetReport(dataset, filterParams(query));
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return <main className="rounded-xl border border-border bg-surface p-6 text-sm">Report unavailable.</main>;
    }
    if (error instanceof Error && error.message.startsWith("Report filters are invalid")) {
      return <main role="alert" className="rounded-xl border border-danger/30 bg-danger-surface p-6 text-sm text-danger">Could not load this report. No value has been replaced with zero. Check the filters and try again.</main>;
    }
    console.error("Report dashboard query failed", error);
    loadError = true;
  }
  if (loadError || report === null) {
    const retryQuery = new URLSearchParams(filterParams(query)).toString();
    const retryHref = `/staff/reports/${dataset}${retryQuery ? `?${retryQuery}` : ""}`;
    return <main role="alert" className="rounded-xl border border-danger/30 bg-danger-surface p-6 text-sm text-danger"><p>Could not load this report. No value has been replaced with zero.</p><div className="mt-3 flex flex-wrap gap-4"><Link href={retryHref} className="underline">Retry report</Link><Link href="/staff/reports" className="underline">Back to Reports</Link></div></main>;
  }
  return <ReportDashboard report={toClientDatasetReport(report)} />;
}
import Link from "next/link";
