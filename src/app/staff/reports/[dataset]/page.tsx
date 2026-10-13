import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { PageHeader } from "@/components/shell/PageHeader";
import { toClientDatasetReport } from "@/lib/report-client-projection";
import { getReportDefinition, isReportDataset } from "@/server/services/report-registry";
import { reportQueryService } from "@/server/services/report-query-service";
import { ReportDashboard } from "./ReportDashboard";

export const metadata = { title: "Report dashboard" };

function filterParams(params: Record<string, string | string[] | undefined>) {
  const filters: Record<string, string> = {};
  for (const key of ["from", "to", "programmeId", "cohortId", "provider", "currency", "status", "category", "priority", "queue", "owner", "page", "pageSize"]) {
    const value = params[key];
    if (typeof value === "string" && value) filters[key] = value;
  }
  return filters;
}

const PRIMARY =
  "inline-flex min-h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast hover:bg-accent-deep";
const SECONDARY = "text-sm font-semibold text-accent underline underline-offset-2";

/**
 * UX batch B — a failure is still a page: the report's header, plain words,
 * and a next step. (It used to be a bare bordered `<main>` inside the staff
 * shell's own `<main>`.)
 */
function ReportProblem({
  title,
  message,
  primary,
}: {
  title: string;
  message: string;
  primary: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: "Reports", href: "/staff/reports" }, { label: title }]}
      />
      <div role="alert" className="flex flex-col items-start gap-4 border-l-2 border-danger bg-danger-surface px-5 py-4">
        <p className="text-sm text-foreground">{message}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href={primary.href} className={PRIMARY}>
            {primary.label}
          </Link>
          <Link href="/staff/reports" className={SECONDARY}>
            Back to Reports
          </Link>
        </div>
      </div>
    </div>
  );
}

export default async function DatasetReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataset: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataset }, query] = await Promise.all([params, searchParams]);
  // An unknown report and one this role cannot open are the same staff 404,
  // so the response never hints that a report exists.
  if (!isReportDataset(dataset)) notFound();
  const title = getReportDefinition(dataset).label;

  let report: Awaited<ReturnType<typeof reportQueryService.getDatasetReport>> | null = null;
  try {
    report = await reportQueryService.getDatasetReport(dataset, filterParams(query));
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) notFound();
    if (error instanceof Error && error.message.startsWith("Report filters are invalid")) {
      return (
        <ReportProblem
          title={title}
          message="Some of the filters in this link aren't valid, so the report wasn't run. Clear the filters and choose them again."
          primary={{ href: `/staff/reports/${dataset}`, label: "Clear filters" }}
        />
      );
    }
    console.error("Report dashboard query failed", error);
  }
  if (report === null) {
    const retryQuery = new URLSearchParams(filterParams(query)).toString();
    return (
      <ReportProblem
        title={title}
        message="We couldn't load this report just now. Nothing was changed — try again in a moment."
        primary={{ href: `/staff/reports/${dataset}${retryQuery ? `?${retryQuery}` : ""}`, label: "Try again" }}
      />
    );
  }
  return <ReportDashboard report={toClientDatasetReport(report)} />;
}
