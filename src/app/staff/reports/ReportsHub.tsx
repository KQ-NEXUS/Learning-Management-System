import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { SECTION_TITLE, figureSize } from "@/components/primitives/controls";
import { REPORT_REGISTRY, type ReportGroup } from "@/server/services/report-registry";
import type { HubOverview, ReportFilters } from "@/server/services/report-query-service";

type ReportsHubProps =
  | { state: "loading" | "error"; overview?: never; scopeLabel?: never }
  | { state: "ready"; overview: HubOverview; scopeLabel: string };

const GROUPS: ReadonlyArray<{ id: ReportGroup; label: string }> = [
  { id: "ADMISSIONS_FINANCE", label: "Admissions & Finance" },
  { id: "LEARNING_DELIVERY", label: "Learning Delivery" },
  { id: "OUTCOMES_SUPPORT", label: "Outcomes & Support" },
];

function queryString(filters: ReportFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "programmeId", "cohortId", "provider"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

function formatMoney(value: number | null, currency: "NGN" | "USD"): string {
  if (value === null) return "Pending";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
  }).format(value / 100);
}

/** One headline figure in the navy band: a link to the records behind it. */
function MetricLink({ href, name, label, value, size, first }: { href: string; name: string; label: string; value: string; size: string; first?: boolean }) {
  return (
    <Link
      href={href}
      aria-label={name}
      className={`group flex min-w-0 flex-col gap-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
        first ? "" : "lg:border-l lg:border-sidebar-line lg:pl-6"
      }`}
    >
      <span className="text-sm text-sidebar-soft">{label}</span>
      <span className={`font-mono ${size} leading-[1.15] font-medium tracking-[-0.03em] break-words text-white tabular-nums`}>{value}</span>
      <span className="text-sm text-sidebar-soft group-hover:text-white group-hover:underline">View matching records</span>
    </Link>
  );
}

function ReportGroups({ filters = {} }: { filters?: ReportFilters }) {
  const commonQuery = queryString(filters);
  return (
    <div className="flex flex-col gap-10">
      {GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`report-group-${group.id}`}>
          <h2 id={`report-group-${group.id}`} className={`${SECTION_TITLE} pb-4`}>
            {group.label}
          </h2>
          <ul className="grid grid-cols-1 gap-x-10 border-t border-foreground md:grid-cols-2 xl:grid-cols-3">
            {REPORT_REGISTRY.filter((definition) => definition.group === group.id).map((definition) => (
              <li
                key={definition.id}
                data-testid="report-card"
                data-dataset={definition.id}
                className="min-w-0 border-b border-border py-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`${definition.drillDownPath}${commonQuery}`}
                    className="text-base font-semibold break-words text-foreground hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {definition.label}
                  </Link>
                  <StatusPill
                    label={definition.availability === "AVAILABLE" ? "Available" : "Not available yet"}
                    tone={definition.availability === "AVAILABLE" ? "success" : "neutral"}
                  />
                </div>
                <p className="mt-2 text-sm break-words text-muted-foreground">{definition.definition}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Date basis:</span>{" "}
                  {definition.businessDateLabel}
                </p>
                {definition.availability === "NOT_AVAILABLE_YET" && (
                  <p className="mt-2 text-sm break-words text-muted-foreground">
                    This report will become available when {definition.unavailableReason}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ContextItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

export function ReportsHub(props: ReportsHubProps) {
  const ready = props.state === "ready";
  const filters = ready ? props.overview.request.filters : {};

  const money = ready
    ? (["NGN", "USD"] as const).map((currency) => formatMoney(props.overview.headlines.paymentTotals[currency], currency))
    : [];
  const size = ready
    ? figureSize([
        formatCount(props.overview.headlines.registrations),
        formatCount(props.overview.headlines.activeEnrolments),
        formatCount(props.overview.headlines.unresolvedPaymentExceptions),
        ...money,
      ])
    : "";

  const band = ready ? (
    <section aria-label="Report headlines" className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-5">
      <MetricLink
        size={size}
        first
        href={`/staff/reports/registrations${queryString(filters)}`}
        name={`View ${formatCount(props.overview.headlines.registrations)} registrations`}
        label="Registrations"
        value={formatCount(props.overview.headlines.registrations)}
      />
      <MetricLink
        size={size}
        href={`/staff/reports/enrolments${queryString(filters, { status: "ACTIVE" })}`}
        name={`View ${formatCount(props.overview.headlines.activeEnrolments)} active enrolments`}
        label="Active enrolments"
        value={formatCount(props.overview.headlines.activeEnrolments)}
      />
      <MetricLink
        size={size}
        href={`/staff/reconciliation${queryString(filters, { status: "UNRESOLVED" })}`}
        name={`View ${formatCount(props.overview.headlines.unresolvedPaymentExceptions)} unresolved payment exceptions`}
        label="Unresolved payment exceptions"
        value={formatCount(props.overview.headlines.unresolvedPaymentExceptions)}
      />
      {(["NGN", "USD"] as const).map((currency) => {
        const formatted = formatMoney(props.overview.headlines.paymentTotals[currency], currency);
        return (
          <MetricLink
        size={size}
            key={currency}
            href={`/staff/reports/payments${queryString(filters, { currency })}`}
            name={`View ${currency} confirmed payments: ${formatted}`}
            label={`${currency} confirmed payments`}
            value={formatted}
          />
        );
      })}
    </section>
  ) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader
        breadcrumbs={[{ label: "Finance" }, { label: "Reports" }]}
        title="Reports"
        subtitle="Trusted operational headlines and direct paths to the platform's fixed reporting datasets."
        band={band}
      />

      {props.state === "loading" && (
        <div role="status" aria-busy="true" className="border-t border-foreground pt-5">
          <p className="text-sm font-semibold text-foreground">Loading report overview</p>
          <div aria-hidden className="mt-4 grid grid-cols-2 gap-6 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="h-16 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        </div>
      )}

      {props.state === "error" && (
        <div role="alert" className="border-l-2 border-danger py-1 pl-4 text-sm text-danger">
          <p className="font-semibold">Could not load this report. No value has been replaced with zero.</p>
          <p className="mt-1">Retry the report or return later. No collection names, counts, or identifiers are shown.</p>
        </div>
      )}

      {ready && (
        <section aria-label="Report context" className="grid grid-cols-1 gap-x-10 gap-y-5 border-t border-foreground pt-5 sm:grid-cols-2 xl:grid-cols-4">
          <ContextItem label="Date range">
            <p className="break-words">{filters.from ?? "All dates"} to {filters.to ?? "Data as of"}</p>
          </ContextItem>
          <ContextItem label="Permission scope">
            <p className="break-words">{props.scopeLabel}</p>
          </ContextItem>
          <ContextItem label="Last refreshed">
            <time className="font-mono break-words" dateTime={props.overview.lastRefreshed.toISOString()}>
              {props.overview.lastRefreshed.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
            </time>
          </ContextItem>
          <ContextItem label="Data as of">
            <time className="font-mono break-words" dateTime={props.overview.request.asOf.toISOString()}>
              {props.overview.request.asOf.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
            </time>
          </ContextItem>
        </section>
      )}

      <ReportGroups filters={filters} />

      <p>
        <Link href="/staff/reports/exports" className="text-sm font-semibold text-accent hover:underline">
          View export history
        </Link>
      </p>
    </div>
  );
}
