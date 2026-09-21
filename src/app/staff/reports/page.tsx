import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { reportQueryService, type ReportFilters } from "@/server/services/report-query-service";
import { ReportsHub } from "./ReportsHub";

export const metadata = { title: "Reports" };

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pageFilters(params: Record<string, string | string[] | undefined>): ReportFilters {
  const provider = single(params.provider);
  const currency = single(params.currency);
  return {
    from: single(params.from),
    to: single(params.to),
    programmeId: single(params.programmeId),
    cohortId: single(params.cohortId),
    ...(provider === "PAYSTACK" || provider === "STRIPE" || provider === "MANUAL"
      ? { provider }
      : {}),
    ...(currency === "NGN" || currency === "USD" ? { currency } : {}),
  };
}

function scopeSummary(scope: Awaited<ReturnType<typeof reportQueryService.getHubOverview>>["request"]["scope"]): string {
  if (scope.kind === "GLOBAL") return "All authorised collections";
  const parts = [
    scope.programmeIds.length ? `${scope.programmeIds.length} programme scope${scope.programmeIds.length === 1 ? "" : "s"}` : "",
    scope.courseIds.length ? `${scope.courseIds.length} course scope${scope.courseIds.length === 1 ? "" : "s"}` : "",
    scope.cohortIds.length ? `${scope.cohortIds.length} cohort scope${scope.cohortIds.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let overview: Awaited<ReturnType<typeof reportQueryService.getHubOverview>>;
  try {
    overview = await reportQueryService.getHubOverview(pageFilters(params));
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return <ReportsHub state="error" />;
    }
    throw error;
  }
  return <ReportsHub state="ready" overview={overview} scopeLabel={scopeSummary(overview.request.scope)} />;
}
