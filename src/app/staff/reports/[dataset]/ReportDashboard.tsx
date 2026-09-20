"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { permittedSensitiveColumnsAction, requestReportExportAction } from "../actions";
import type {
  ClientAvailableDatasetReport,
  ClientDatasetReport,
} from "@/lib/report-client-projection";
import type {
  ReportRow,
} from "@/server/services/report-query-service";

const control = "h-[38px] min-w-0 rounded-md border border-input-border bg-surface px-2 text-sm text-foreground";
const secondary = "inline-flex h-[38px] items-center justify-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
  return <form method="get" className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs sm:grid-cols-2 xl:grid-cols-4">
    {filters.status && <input type="hidden" name="status" value={filters.status} />}
    <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Date from<input className={control} type="date" name="from" defaultValue={filters.from ?? ""} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Date to<input className={control} type="date" name="to" defaultValue={filters.to ?? ""} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Programme<select className={control} name="programmeId" defaultValue={filters.programmeId ?? ""}><option value="">All authorised programmes</option>{report.options.programmes.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Cohort<select className={control} name="cohortId" defaultValue={filters.cohortId ?? ""}><option value="">All authorised cohorts</option>{report.options.cohorts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    {report.definition.id === "payments" && <>
      <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Provider<select className={control} name="provider" defaultValue={filters.provider ?? ""}><option value="">All providers</option><option value="PAYSTACK">Paystack</option><option value="STRIPE">Stripe</option><option value="MANUAL">Manual</option></select></label>
      <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Currency<select className={control} name="currency" defaultValue={filters.currency ?? ""}><option value="">Both currencies</option><option value="NGN">NGN</option><option value="USD">USD</option></select></label>
    </>}
    <div className="flex items-end gap-2"><button type="submit" className={secondary}>Apply filters</button><Link href={report.definition.drillDownPath} className={`${secondary} no-underline`}>Clear</Link></div>
  </form>;
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
  return <main className="flex min-w-0 flex-col gap-8">
    <header className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground"><Link href="/staff/reports" className="text-accent underline">Reports</Link> / {definition.label}</p>
      <h1 className="text-[25px] font-semibold leading-tight text-foreground">{definition.label}</h1>
      <p className="max-w-prose break-words text-sm text-muted-foreground">{definition.definition}</p>
      <dl className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface p-4 text-sm shadow-xs sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="font-semibold">Date basis</dt><dd className="break-words">{definition.businessDateLabel}</dd></div>
        <div><dt className="font-semibold">Permission scope</dt><dd className="break-words">{scopeLabel(report)}</dd></div>
        <div><dt className="font-semibold">Last refreshed</dt><dd>{dateTime(report.lastRefreshed)}</dd></div>
        <div><dt className="font-semibold">Data as of</dt><dd>{dateTime(request.asOf)}</dd></div>
      </dl>
      <p className="break-words text-sm text-muted-foreground">Filters: {request.filters.from ?? "All dates"} to {request.filters.to ?? "data as of"}; {request.filters.programmeId ? "selected programme" : "all authorised programmes"}; {request.filters.cohortId ? "selected cohort" : "all authorised cohorts"}{request.filters.provider ? `; ${request.filters.provider}` : ""}{request.filters.currency ? `; ${request.filters.currency}` : ""}{request.filters.status ? `; ${request.filters.status.replaceAll("_", " ")}` : ""}</p>
    </header>

    {!report.available ? <section className="rounded-xl border border-border bg-surface-2 px-6 py-12 shadow-xs"><h2 className="text-base font-semibold">Not available yet</h2><p className="mt-2 max-w-prose break-words text-sm text-muted-foreground">This report will become available when {definition.unavailableReason} starts collecting authoritative data.</p></section> : <>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className={secondary}>{pending ? "Refreshing data" : "Refresh data"}</button><button type="button" disabled={pending} onClick={queueExport} className="inline-flex h-[38px] items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white">Export CSV</button>{allowedSensitive.length > 0 && <button type="button" className={secondary} onClick={() => setOptionsOpen(true)}>Export options</button>}</div>
      {exportResult === "queued" && <p role="status" className="rounded-md border border-success/30 bg-surface p-3 text-sm">Export queued. You can leave this page and follow its progress in Export History. <Link href="/staff/reports/exports" className="text-accent underline">View export history</Link></p>}
      {exportResult === "failed" && <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">Export not queued. Your report and choices are unchanged. <button type="button" className="underline" onClick={queueExport}>Try queuing export</button> <button type="button" className="underline" onClick={() => setOptionsOpen(true)}>Keep editing export options</button></div>}
      {optionsOpen && <div role="dialog" aria-modal="true" aria-label="Export options" className="rounded-xl border border-border bg-surface p-4 shadow-lg"><h2 className="font-semibold">Export options</h2><p className="text-sm text-muted-foreground">Safe columns are included by default. Sensitive-field access is audited.</p><div className="mt-3 flex flex-col gap-2">{definition.sensitiveColumns.filter((column) => allowedSensitive.includes(column.key)).map((column) => <label key={column.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedSensitive.includes(column.key)} onChange={(event) => setSelectedSensitive(event.target.checked ? [...selectedSensitive, column.key] : selectedSensitive.filter((key) => key !== column.key))} />{column.label}</label>)}</div>{selectedSensitive.length > 0 && <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">Operational reason<textarea className={control} value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={2000} /></label>}<div className="mt-4 flex gap-2"><button type="button" disabled={pending || (selectedSensitive.length > 0 && !reason.trim())} onClick={queueExport} className={secondary}>Queue export</button><button type="button" className={secondary} onClick={() => setOptionsOpen(false)}>Keep editing report</button></div></div>}
      {failedSections.includes("filters") ? <SectionError section="filters" onRetry={() => startTransition(() => router.refresh())} /> : <Filters report={report} />}
      {failedSections.includes("metrics") ? <SectionError section="metrics" onRetry={() => startTransition(() => router.refresh())} /> : <section aria-label="Report metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">{report.metrics.map((metric) => <Link key={metric.id} href={metric.href} aria-label={`${metric.label}: ${metric.format === "MONEY" && metric.currency ? money(metric.value, metric.currency) : metric.value === null ? "Pending" : count(metric.value)}. View matching rows`} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><span className="text-sm font-semibold">{metric.label}</span><span className="break-words font-mono text-2xl tabular-nums text-accent">{metric.format === "MONEY" && metric.currency ? money(metric.value, metric.currency) : metric.value === null ? "Pending" : count(metric.value)}</span><span className="text-sm text-muted-foreground">View matching rows</span></Link>)}</section>}
      {report.breakdown.length > 0 && (failedSections.includes("breakdown") ? <SectionError section="breakdown" onRetry={() => startTransition(() => router.refresh())} /> : <section aria-labelledby="breakdown-heading" className="rounded-xl border border-border bg-surface p-4 shadow-xs"><h2 id="breakdown-heading" className="text-base font-semibold">Breakdown</h2><ul className="mt-4 flex flex-wrap gap-2">{report.breakdown.map((item) => <li key={item.id}><Link href={item.href} className="inline-flex min-h-[38px] items-center gap-2 rounded-md border border-border px-3 text-sm text-accent underline focus-visible:ring-2 focus-visible:ring-accent"><span>{item.label}</span><span className="font-mono tabular-nums">{count(item.value)}</span></Link></li>)}</ul></section>)}
      {failedSections.includes("rows") ? <SectionError section="rows" onRetry={() => startTransition(() => router.refresh())} /> : <section id="rows" aria-labelledby="rows-heading" className="flex min-w-0 flex-col gap-4"><h2 id="rows-heading" className="text-base font-semibold">Matching rows ({count(report.totalRows)})</h2>{report.totalRows === 0 ? <div className="rounded-xl border border-border bg-surface px-6 py-12"><h3 className="text-sm font-semibold">No {definition.id} match these filters</h3><p className="mt-2 text-sm text-muted-foreground">The report was checked using the filters and scope shown above. Adjust or clear filters to broaden the result.</p></div> : <Rows report={report} />}</section>}
    </>}
  </main>;
}

function SectionError({ section, onRetry }: { section: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-xl border border-danger/30 bg-danger-surface p-4 text-sm text-danger"><p>Could not load {section}. The other report sections are unchanged.</p><button type="button" onClick={onRetry} className="mt-2 underline">Retry {section}</button></div>;
}

function Rows({ report }: { report: ClientAvailableDatasetReport }) {
  const headers = report.rows[0] ? rowFields(report.rows[0]).map(([label]) => label) : [];
  return <>
    <div tabIndex={0} aria-label="Scrollable matching rows" className="hidden min-w-0 overflow-x-auto rounded-xl border border-border bg-surface shadow-xs sm:block"><table className="min-w-max border-collapse text-sm"><caption className="sr-only">Matching {report.definition.id} rows</caption><thead><tr>{headers.map((header) => <th key={header} scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground">{header}</th>)}</tr></thead><tbody>{report.rows.map((row) => <tr key={row.id} className="border-t border-border">{rowFields(row).map(([label, value]) => <td key={label} className="min-w-36 max-w-80 break-words px-3 py-3 align-top font-mono tabular-nums">{value}</td>)}</tr>)}</tbody></table></div>
    <ul className="flex flex-col gap-2 sm:hidden">{report.rows.map((row) => <li key={row.id} className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-xs"><dl className="grid grid-cols-1 gap-2">{rowFields(row).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</dt><dd className="font-mono text-sm tabular-nums [overflow-wrap:anywhere]">{value}</dd></div>)}</dl></li>)}</ul>
    {report.totalRows > report.pageSize && <nav aria-label="Report pages" className="flex flex-wrap items-center gap-3 text-sm"><span>Page {report.page} of {Math.ceil(report.totalRows / report.pageSize)}</span>{report.page > 1 && <Link href={pageHref(report, report.page - 1)} className="text-accent underline">Previous page</Link>}{report.page * report.pageSize < report.totalRows && <Link href={pageHref(report, report.page + 1)} className="text-accent underline">Next page</Link>}</nav>}
  </>;
}
