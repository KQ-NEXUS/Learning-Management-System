import Link from "next/link";
import { StatusPill } from "@/components/primitives/ResourceTable";
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

function MetricLink({ href, name, label, value }: { href: string; name: string; label: string; value: string }) {
  return (
    <Link
      href={href}
      aria-label={name}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs outline-none transition-colors hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="break-words font-mono text-2xl font-semibold tabular-nums text-accent">{value}</span>
      <span className="text-sm text-muted-foreground">View matching records</span>
    </Link>
  );
}

function ReportGroups({ filters = {} }: { filters?: ReportFilters }) {
  const commonQuery = queryString(filters);
  return (
    <div className="flex flex-col gap-8">
      {GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`report-group-${group.id}`} className="flex flex-col gap-4">
          <h2 id={`report-group-${group.id}`} className="text-base font-semibold text-foreground">
            {group.label}
          </h2>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {REPORT_REGISTRY.filter((definition) => definition.group === group.id).map((definition) => (
              <li
                key={definition.id}
                data-testid="report-card"
                data-dataset={definition.id}
                className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`${definition.drillDownPath}${commonQuery}`}
                    className="break-words text-base font-semibold text-foreground underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {definition.label}
                  </Link>
                  <StatusPill
                    label={definition.availability === "AVAILABLE" ? "Available" : "Not available yet"}
                    tone={definition.availability === "AVAILABLE" ? "success" : "neutral"}
                  />
                </div>
                <p className="mt-3 break-words text-sm text-muted-foreground">{definition.definition}</p>
                <p className="mt-3 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Date basis:</span>{" "}
                  {definition.businessDateLabel}
                </p>
                {definition.availability === "NOT_AVAILABLE_YET" && (
                  <p className="mt-3 break-words text-sm text-muted-foreground">
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

export function ReportsHub(props: ReportsHubProps) {
  const ready = props.state === "ready";
  const filters = ready ? props.overview.request.filters : {};

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Staff workspace / Reports</p>
        <h1 className="text-[25px] font-semibold leading-tight text-foreground">Reports</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Trusted operational headlines and direct paths to the platform&apos;s fixed reporting datasets.
        </p>
      </header>

      {props.state === "loading" && (
        <div role="status" aria-busy="true" className="rounded-xl border border-border bg-surface p-6 shadow-xs">
          <p className="text-sm font-semibold text-foreground">Loading report overview</p>
          <div aria-hidden className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="h-28 animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        </div>
      )}

      {props.state === "error" && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-surface p-6 text-sm text-danger">
          <p className="font-semibold">Could not load this report. No value has been replaced with zero.</p>
          <p className="mt-2">Retry the report or return later. No collection names, counts, or identifiers are shown.</p>
        </div>
      )}

      {ready && (
        <>
          <section aria-label="Report headlines" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricLink
              href={`/staff/reports/registrations${queryString(filters)}`}
              name={`View ${formatCount(props.overview.headlines.registrations)} registrations`}
              label="Registrations"
              value={formatCount(props.overview.headlines.registrations)}
            />
            <MetricLink
              href={`/staff/reports/enrolments${queryString(filters, { status: "ACTIVE" })}`}
              name={`View ${formatCount(props.overview.headlines.activeEnrolments)} active enrolments`}
              label="Active enrolments"
              value={formatCount(props.overview.headlines.activeEnrolments)}
            />
            <MetricLink
              href={`/staff/reconciliation${queryString(filters, { status: "UNRESOLVED" })}`}
              name={`View ${formatCount(props.overview.headlines.unresolvedPaymentExceptions)} unresolved payment exceptions`}
              label="Unresolved payment exceptions"
              value={formatCount(props.overview.headlines.unresolvedPaymentExceptions)}
            />
            {(["NGN", "USD"] as const).map((currency) => {
              const formatted = formatMoney(props.overview.headlines.paymentTotals[currency], currency);
              return (
                <MetricLink
                  key={currency}
                  href={`/staff/reports/payments${queryString(filters, { currency })}`}
                  name={`View ${currency} confirmed payments: ${formatted}`}
                  label={`${currency} confirmed payments`}
                  value={formatted}
                />
              );
            })}
          </section>

          <section aria-label="Report context" className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface p-4 shadow-xs sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Date range</p>
              <p className="break-words text-sm text-muted-foreground">
                {filters.from ?? "All dates"} to {filters.to ?? "Data as of"}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Permission scope</p>
              <p className="break-words text-sm text-muted-foreground">{props.scopeLabel}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Last refreshed</p>
              <time className="break-words font-mono text-sm text-muted-foreground" dateTime={props.overview.lastRefreshed.toISOString()}>
                {props.overview.lastRefreshed.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
              </time>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Data as of</p>
              <time className="break-words font-mono text-sm text-muted-foreground" dateTime={props.overview.request.asOf.toISOString()}>
                {props.overview.request.asOf.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
              </time>
            </div>
          </section>
        </>
      )}

      <ReportGroups filters={filters} />

      <div>
        <Link href="/staff/reports/exports" className="text-sm font-semibold text-accent underline underline-offset-2">
          View export history
        </Link>
      </div>
    </main>
  );
}
