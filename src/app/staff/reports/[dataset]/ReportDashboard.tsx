"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  BTN,
  BTN_ON_NAVY,
  BTN_PRIMARY,
  BTN_PRIMARY_ON_NAVY,
  CONTROL,
  DIALOG_PANEL,
  DIALOG_SCRIM,
  FIELD,
  NOTE_DANGER,
  NOTE_SUCCESS,
  SECTION_TITLE,
  TD,
  TEXTAREA,
  TH,
  figureSize,
} from "@/components/primitives/controls";
import { permittedSensitiveColumnsAction, requestReportExportAction } from "../actions";
import type {
  ClientAvailableDatasetReport,
  ClientDatasetReport,
} from "@/lib/report-client-projection";
import type {
  ReportRow,
} from "@/server/services/report-query-service";

function count(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

function money(value: number | null, currency: "NGN" | "USD") {
  if (value === null) return "Pending";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
  }).format(value / 100);
}

function dateTime(value: Date) {
  return <time dateTime={value.toISOString()} className="font-mono text-sm tabular-nums [overflow-wrap:anywhere]">{value.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</time>;
}

function scopeLabel(report: ClientDatasetReport) {
  const scope = report.request.scope;
  if (scope.kind === "GLOBAL") return "All authorised collections";
  return `${scope.programmeIds.length} programme, ${scope.courseIds.length} course, ${scope.cohortIds.length} cohort grants`;
}

function pageHref(report: ClientAvailableDatasetReport, page: number) {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "programmeId", "cohortId", "provider", "currency", "status"] as const) {
    const value = report.request.filters[key];
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  params.set("pageSize", String(report.pageSize));
  return `${report.definition.drillDownPath}?${params.toString()}#rows`;
}

function rowFields(row: ReportRow): Array<[string, string]> {
  switch (row.kind) {
    case "registrations": return [
      ["Registration", row.reference], ["Learner", row.learnerName], ["Cohort", row.cohortTitle],
      ["Verification", row.status.replaceAll("_", " ")], ["Registration date", row.businessDate.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })],
    ];
    case "payments": return [
      ["Reference", row.reference], ["Learner", row.learnerName], ["Cohort", row.cohortTitle],
      ["Provider", row.provider ?? "Not applicable"], ["Currency", row.currency],
      ["Learner total", row.currency === "NGN" || row.currency === "USD" ? money(row.learnerTotalMinor, row.currency) : String(row.learnerTotalMinor)],
      ["Payment state", row.status], ["Transaction reference", row.transactionReference ?? "Not applicable"],
      ["Base price", amountState(row.baseAmountMinor, row)], ["Platform fee", amountState(row.platformFeeMinor, row)],
      ["Estimated gateway fee", row.provider === "MANUAL" ? "Not applicable" : amountState(row.gatewayFeeEstimateMinor, row)],
      ["Actual gateway fee", row.provider === "MANUAL" ? "Not applicable" : amountState(row.gatewayFeeActualMinor, row, true)],
      ["Expected school settlement", amountState(row.schoolSettlementExpectedMinor, row)],
      ["Actual school settlement", row.provider === "MANUAL" ? "Not applicable" : amountState(row.schoolSettlementActualMinor, row, true)],
      ["KQ NEXUS gross", row.provider === "MANUAL" ? "Not applicable" : amountState(row.platformGrossActualMinor, row, true)],
      ["KQ NEXUS net", row.provider === "MANUAL" ? "Not applicable" : amountState(row.platformNetActualMinor, row, true)],
      ["Refunds", row.currency === "NGN" || row.currency === "USD" ? money(row.refundAmountMinor, row.currency) : String(row.refundAmountMinor)],
      ["Exception", row.exceptionContext ?? "None"],
      ["Payment confirmation date", row.businessDate.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })],
    ];
    case "enrolments": return [
      ["Enrolment", row.id], ["Learner", row.learnerName], ["Cohort", row.cohortTitle],
      ["State", row.status.replaceAll("_", " ")], ["Transition date", row.businessDate.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })],
    ];
    case "attendance": return [
      ["Session", row.sessionTitle], ["Cohort", row.cohortTitle],
      ["Session date", row.businessDate.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })],
      ["Records", count(row.totalRecords)],
      ["Register", row.expected && row.totalRecords === 0 ? "Missing register" : "Recorded"],
    ];
  }
}

function amountState(value: number | null, row: Extract<ReportRow, { kind: "payments" }>, actual = false) {
  if (value === null) return actual ? "— (pending reconciliation)" : "Not applicable";
  return row.currency === "NGN" || row.currency === "USD" ? money(value, row.currency) : String(value);
}

function Filters({ report }: { report: ClientAvailableDatasetReport }) {
  const { filters } = report.request;
  return (
    <form
      method="get"
      aria-label="Report filters"
      className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-5 border-t border-foreground pt-5 sm:grid-cols-2 xl:grid-cols-4"
    >
      {filters.status && <input type="hidden" name="status" value={filters.status} />}
      <label className={FIELD}>Date from<input className={CONTROL} type="date" name="from" defaultValue={filters.from ?? ""} /></label>
      <label className={FIELD}>Date to<input className={CONTROL} type="date" name="to" defaultValue={filters.to ?? ""} /></label>
      <label className={FIELD}>Programme<select className={CONTROL} name="programmeId" defaultValue={filters.programmeId ?? ""}><option value="">All authorised programmes</option>{report.options.programmes.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label className={FIELD}>Cohort<select className={CONTROL} name="cohortId" defaultValue={filters.cohortId ?? ""}><option value="">All authorised cohorts</option>{report.options.cohorts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      {report.definition.id === "payments" && (
        <>
          <label className={FIELD}>Provider<select className={CONTROL} name="provider" defaultValue={filters.provider ?? ""}><option value="">All providers</option><option value="PAYSTACK">Paystack</option><option value="STRIPE">Stripe</option><option value="MANUAL">Manual</option></select></label>
          <label className={FIELD}>Currency<select className={CONTROL} name="currency" defaultValue={filters.currency ?? ""}><option value="">Both currencies</option><option value="NGN">NGN</option><option value="USD">USD</option></select></label>
        </>
      )}
      <div className="flex items-end gap-3">
        <button type="submit" className={BTN}>Apply filters</button>
        <Link href={report.definition.drillDownPath} className={`${BTN} no-underline`}>Clear</Link>
      </div>
    </form>
  );
}

/** A label and value on the navy band. */
function BandFact({ label, children, first }: { label: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${first ? "" : "lg:border-l lg:border-sidebar-line lg:pl-6"}`}>
      <dt className="text-sm text-sidebar-soft">{label}</dt>
      <dd className="text-base text-white break-words">{children}</dd>
    </div>
  );
}

function metricValue(metric: ClientAvailableDatasetReport["metrics"][number]): string {
  if (metric.format === "MONEY" && metric.currency) return money(metric.value, metric.currency);
  return metric.value === null ? "Pending" : count(metric.value);
}

export function ReportDashboard({ report, sectionErrors = [] }: { report: ClientDatasetReport; sectionErrors?: readonly string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allowedSensitive, setAllowedSensitive] = useState<string[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [selectedSensitive, setSelectedSensitive] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [exportResult, setExportResult] = useState<"queued" | "failed" | null>(null);
  const { definition, request } = report;
  useEffect(() => {
    let active = true;
    if (report.available) void permittedSensitiveColumnsAction(definition.id).then((columns) => { if (active) setAllowedSensitive(columns); }).catch(() => {});
    return () => { active = false; };
  }, [definition.id, report.available]);
  function queueExport() {
    if (!report.available) return;
    setExportResult(null);
    const filters = Object.fromEntries(Object.entries(request.filters).filter(([key, value]) => !["page", "pageSize"].includes(key) && value !== undefined && value !== "")) as Record<string, string>;
    const columns = [...definition.safeColumns.map((column) => column.key), ...selectedSensitive];
    startTransition(async () => {
      try {
        const result = await requestReportExportAction({ dataset: definition.id, filters, columns, reason: selectedSensitive.length ? reason : undefined, asOf: request.asOf.toISOString(), idempotencyKey: `report-${Date.now()}-${Math.random().toString(36).slice(2)}` });
        setExportResult(result.ok ? "queued" : "failed");
        if (result.ok) setOptionsOpen(false);
      } catch { setExportResult("failed"); }
    });
  }
  const failedSections = report.available ? [...(report.sectionErrors ?? []), ...sectionErrors] : sectionErrors;
  const retry = () => startTransition(() => router.refresh());
  const metricSize = report.available ? figureSize(report.metrics.map(metricValue)) : "";

  const band = (
    <div className="mt-6 flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        <BandFact first label="Date basis">{definition.businessDateLabel}</BandFact>
        <BandFact label="Permission scope">{scopeLabel(report)}</BandFact>
        <BandFact label="Last refreshed">{dateTime(report.lastRefreshed)}</BandFact>
        <BandFact label="Data as of">{dateTime(request.asOf)}</BandFact>
      </dl>
      <p className="text-sm break-words text-sidebar-soft">Filters: {request.filters.from ?? "All dates"} to {request.filters.to ?? "data as of"}; {request.filters.programmeId ? "selected programme" : "all authorised programmes"}; {request.filters.cohortId ? "selected cohort" : "all authorised cohorts"}{request.filters.provider ? `; ${request.filters.provider}` : ""}{request.filters.currency ? `; ${request.filters.currency}` : ""}{request.filters.status ? `; ${request.filters.status.replaceAll("_", " ")}` : ""}</p>
    </div>
  );

  const actions = report.available ? (
    <>
      <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className={BTN_ON_NAVY}>{pending ? "Refreshing data" : "Refresh data"}</button>
      {allowedSensitive.length > 0 && <button type="button" className={BTN_ON_NAVY} onClick={() => setOptionsOpen(true)}>Export options</button>}
      <button type="button" disabled={pending} onClick={queueExport} className={BTN_PRIMARY_ON_NAVY}>Export CSV</button>
    </>
  ) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/staff/reports" }, { label: definition.label }]}
        title={definition.label}
        subtitle={definition.definition}
        actions={actions}
        band={band}
      />

      {!report.available ? (
        <section className="border-t border-foreground pt-5">
          <h2 className={SECTION_TITLE}>Not available yet</h2>
          <p className="mt-2 max-w-prose text-sm break-words text-muted-foreground">This report will become available when {definition.unavailableReason} starts collecting authoritative data.</p>
        </section>
      ) : (
        <>
          {exportResult === "queued" && <p role="status" className={NOTE_SUCCESS}>Export queued. You can leave this page and follow its progress in Export History. <Link href="/staff/reports/exports" className="font-semibold text-accent hover:underline">View export history</Link></p>}
          {exportResult === "failed" && <div role="alert" className={NOTE_DANGER}>Export not queued. Your report and choices are unchanged. <button type="button" className="font-semibold underline" onClick={queueExport}>Try queuing export</button> <button type="button" className="font-semibold underline" onClick={() => setOptionsOpen(true)}>Keep editing export options</button></div>}
          {optionsOpen && (
            <div className={DIALOG_SCRIM}>
              <div role="dialog" aria-modal="true" aria-label="Export options" className={DIALOG_PANEL}>
                <div>
                  <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">Export options</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Safe columns are included by default. Sensitive-field access is audited.</p>
                </div>
                <div className="flex flex-col gap-3">{definition.sensitiveColumns.filter((column) => allowedSensitive.includes(column.key)).map((column) => <label key={column.key} className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-accent" checked={selectedSensitive.includes(column.key)} onChange={(event) => setSelectedSensitive(event.target.checked ? [...selectedSensitive, column.key] : selectedSensitive.filter((key) => key !== column.key))} />{column.label}</label>)}</div>
                {selectedSensitive.length > 0 && <label className={FIELD}>Operational reason<textarea className={TEXTAREA} value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={2000} /></label>}
                <div className="flex flex-wrap justify-end gap-3">
                  <button type="button" className={BTN} onClick={() => setOptionsOpen(false)}>Keep editing report</button>
                  <button type="button" disabled={pending || (selectedSensitive.length > 0 && !reason.trim())} onClick={queueExport} className={BTN_PRIMARY}>Queue export</button>
                </div>
              </div>
            </div>
          )}
          {failedSections.includes("filters") ? <SectionError section="filters" onRetry={retry} /> : <Filters report={report} />}
          {failedSections.includes("metrics") ? <SectionError section="metrics" onRetry={retry} /> : (
            <section aria-label="Report metrics" className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-foreground pt-5 lg:grid-cols-5">
              {report.metrics.map((metric, index) => (
                <Link
                  key={metric.id}
                  href={metric.href}
                  aria-label={`${metric.label}: ${metricValue(metric)}. View matching rows`}
                  className={`group flex min-w-0 flex-col gap-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${index === 0 ? "" : "lg:border-l lg:border-border lg:pl-6"}`}
                >
                  <span className="text-sm text-muted-foreground">{metric.label}</span>
                  <span className={`font-mono ${metricSize} leading-[1.15] font-medium tracking-[-0.03em] break-words text-foreground tabular-nums`}>{metricValue(metric)}</span>
                  <span className="text-sm text-accent group-hover:underline">View matching rows</span>
                </Link>
              ))}
            </section>
          )}
          {report.breakdown.length > 0 && (failedSections.includes("breakdown") ? <SectionError section="breakdown" onRetry={retry} /> : (
            <section aria-labelledby="breakdown-heading">
              <h2 id="breakdown-heading" className={`${SECTION_TITLE} pb-4`}>Breakdown</h2>
              <ul className="flex flex-wrap gap-x-8 gap-y-3 border-t border-foreground pt-4">
                {report.breakdown.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="inline-flex min-h-10 items-center gap-2 text-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      <span>{item.label}</span>
                      <span className="font-mono text-foreground tabular-nums">{count(item.value)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {failedSections.includes("rows") ? <SectionError section="rows" onRetry={retry} /> : (
            <section id="rows" aria-labelledby="rows-heading" className="flex min-w-0 flex-col gap-4">
              <h2 id="rows-heading" className={SECTION_TITLE}>Matching rows ({count(report.totalRows)})</h2>
              {report.totalRows === 0 ? (
                <div className="border-t border-foreground pt-5">
                  <h3 className="text-base font-semibold text-foreground">No {definition.id} match these filters</h3>
                  <p className="mt-2 text-sm text-muted-foreground">The report was checked using the filters and scope shown above. Adjust or clear filters to broaden the result.</p>
                </div>
              ) : <Rows report={report} />}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionError({ section, onRetry }: { section: string; onRetry: () => void }) {
  return (
    <div role="alert" className={NOTE_DANGER}>
      <p>Could not load {section}. The other report sections are unchanged.</p>
      <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">Retry {section}</button>
    </div>
  );
}

function Rows({ report }: { report: ClientAvailableDatasetReport }) {
  const headers = report.rows[0] ? rowFields(report.rows[0]).map(([label]) => label) : [];
  return (
    <>
      <div tabIndex={0} aria-label="Scrollable matching rows" className="hidden min-w-0 overflow-x-auto border-t border-foreground sm:block">
        <table className="min-w-max border-collapse text-sm">
          <caption className="sr-only">Matching {report.definition.id} rows</caption>
          <thead>
            <tr>{headers.map((header) => <th key={header} scope="col" className={TH}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.id} className="border-b border-border">
                {rowFields(row).map(([label, value]) => <td key={label} className={`${TD} max-w-80 min-w-36 font-mono break-words tabular-nums`}>{value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col border-t border-foreground sm:hidden">
        {report.rows.map((row) => (
          <li key={row.id} className="min-w-0 border-b border-border py-4">
            <dl className="grid grid-cols-1 gap-3">
              {rowFields(row).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[13px] text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-sm tabular-nums [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {report.totalRows > report.pageSize && (
        <nav aria-label="Report pages" className="flex flex-wrap items-center gap-4 text-sm">
          <span>Page {report.page} of {Math.ceil(report.totalRows / report.pageSize)}</span>
          {report.page > 1 && <Link href={pageHref(report, report.page - 1)} className="font-semibold text-accent hover:underline">Previous page</Link>}
          {report.page * report.pageSize < report.totalRows && <Link href={pageHref(report, report.page + 1)} className="font-semibold text-accent hover:underline">Next page</Link>}
        </nav>
      )}
    </>
  );
}
