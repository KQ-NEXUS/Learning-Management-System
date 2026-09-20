"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { BTN_ON_NAVY, BTN_PRIMARY, CONTROL, FIELD, NOTE_DANGER, NOTE_SUCCESS, TD, TH } from "@/components/primitives/controls";
import { REPORT_REGISTRY } from "@/server/services/report-registry";
import type { ExportHistoryRow } from "@/server/services/export-read-service";
import { retryHistoryExportAction, rerunHistoryExportAction } from "./actions";

type Filters = { dataset: string; status: string; from: string; to: string; search: string };
type Props = { filters: Filters } & ({ state: "ready"; rows: readonly ExportHistoryRow[]; page?: number; hasMore?: boolean } | { state: "loading" | "error"; rows?: never; page?: never; hasMore?: never });
const statusLabels = { QUEUED: "Queued", PROCESSING: "Processing", SUCCEEDED: "Succeeded", FAILED: "Failed", EXPIRED: "Expired" } as const;
const datasets = [...REPORT_REGISTRY.map(({ id, label }) => ({ id, label })), { id: "reconciliation-refunds", label: "Reconciliation refunds" }, { id: "audit", label: "Audit" }];
function date(value: string): string { return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(value)); }
function datasetLabel(id: string): string { return datasets.find((item) => item.id === id)?.label ?? id; }

function statusTone(status: ExportHistoryRow["status"]): "success" | "danger" | "neutral" {
  return status === "SUCCEEDED" ? "success" : status === "FAILED" ? "danger" : "neutral";
}

const LINK_ACTION = "font-semibold text-accent hover:underline disabled:opacity-60";

function HistoryCard({ row, submit, busy }: { row: ExportHistoryRow; submit: (id: string, kind: "retry" | "rerun") => void; busy: boolean }) {
  return <li className="min-w-0 border-b border-border py-5 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-base break-words">{datasetLabel(row.dataset)}</strong><StatusPill label={statusLabels[row.status]} tone={statusTone(row.status)} /></div>
    <p className="mt-1 font-mono text-[13px] break-all text-muted-foreground">{row.id}</p>
    <p className="text-[13px] text-muted-foreground">Version {row.datasetVersion}</p>
    {row.retryOfId && <p className="text-[13px] break-all">Retry of {row.retryOfId}</p>}
    {row.retriedById && <p className="text-[13px] break-all">Retried by <Link href={`/staff/reports/exports?search=${encodeURIComponent(row.retriedById)}`} className="text-accent hover:underline">{row.retriedById}</Link></p>}
    {row.columns.length > 0 && <p className="text-[13px] break-words text-muted-foreground">{row.columns.join(", ")}</p>}
    {Object.keys(row.filters).length > 0 && <p className="text-[13px] break-words text-muted-foreground">{Object.entries(row.filters).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>}
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3"><div><dt className="text-[13px] text-muted-foreground">Requested</dt><dd><time dateTime={row.createdAt}>{date(row.createdAt)}</time></dd></div><div><dt className="text-[13px] text-muted-foreground">As of</dt><dd><time dateTime={row.asOf}>{date(row.asOf)}</time></dd></div><div><dt className="text-[13px] text-muted-foreground">Rows</dt><dd>{row.rowCount === null ? "Pending" : row.rowCount} {row.rowCount === 1 ? "row" : "rows"}</dd></div><div><dt className="text-[13px] text-muted-foreground">Availability</dt><dd>{row.canDownload && row.expiresAt ? <>Until <time dateTime={row.expiresAt}>{date(row.expiresAt)}</time></> : row.status === "EXPIRED" ? "Expired" : row.status === "FAILED" ? "Failed" : "Pending"}</dd></div></dl>
    {row.status === "PROCESSING" && <span className="sr-only">Processing export</span>}
    {row.status === "FAILED" && <p className="mt-3 break-words">{row.failure ?? "Export failed."}</p>}
    {row.canDownload && <a href={`/api/staff/reports/exports/${encodeURIComponent(row.id)}/download`} className={`mt-3 inline-block ${LINK_ACTION}`}>Download CSV</a>}
    {row.status === "FAILED" && <button type="button" disabled={busy} onClick={() => submit(row.id, "retry")} className={`mt-3 block ${LINK_ACTION}`}>{busy ? "Queuing…" : "Retry export"}</button>}
    {row.status === "EXPIRED" && <><p className="mt-3 text-[13px] text-muted-foreground">Rerunning captures current data with a new as of time.</p><button type="button" disabled={busy} onClick={() => submit(row.id, "rerun")} className={`mt-2 block ${LINK_ACTION}`}>{busy ? "Queuing…" : "Rerun export"}</button></>}
  </li>;
}

export function ExportHistory({ filters, ...data }: Props) {
  const router = useRouter();
  const refreshRef = useRef<HTMLButtonElement>(null);
  const previous = useRef<Map<string, string> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [actionError, setActionError] = useState("");
  const [queuedJob, setQueuedJob] = useState("");
  const [pendingJob, setPendingJob] = useState("");
  const [refreshing, beginRefresh] = useTransition();
  const [submitting, beginSubmit] = useTransition();

  useEffect(() => {
    if (data.state !== "ready") return;
    const next = new Map(data.rows.map((row) => [row.id, row.status]));
    if (previous.current) {
      const changes = data.rows.filter((row) => previous.current?.get(row.id) && previous.current.get(row.id) !== row.status);
      if (changes.length) setAnnouncement(`${changes.length} export status${changes.length === 1 ? "" : "es"} changed.`);
    }
    previous.current = next;
  }, [data]);

  function refresh() {
    setAnnouncement("Refreshing export status.");
    beginRefresh(() => router.refresh());
    queueMicrotask(() => refreshRef.current?.focus());
  }

  function submit(jobId: string, kind: "retry" | "rerun") {
    setPendingJob(jobId); setActionError(""); setQueuedJob("");
    beginSubmit(async () => {
      const result = kind === "retry" ? await retryHistoryExportAction(jobId) : await rerunHistoryExportAction(jobId);
      setPendingJob("");
      if (!result.ok) { setActionError(result.message); return; }
      setQueuedJob(result.jobId);
      setAnnouncement("Export queued. You can leave this page and follow its progress in Export History.");
      router.refresh();
    });
  }

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    params.set("page", String(page));
    return `/staff/reports/exports?${params.toString()}`;
  }

  return <div className="flex min-w-0 flex-col gap-8">
    <PageHeader
      breadcrumbs={[{ label: "Reports", href: "/staff/reports" }, { label: "Export History" }]}
      title="Export History"
      subtitle="Review frozen requests and download files while they are available."
      actions={<button ref={refreshRef} type="button" onClick={refresh} disabled={refreshing} className={BTN_ON_NAVY}>{refreshing ? "Refreshing status…" : "Refresh status"}</button>}
    />
    <form method="get" className="grid grid-cols-1 gap-x-6 gap-y-5 border-t border-foreground pt-5 sm:grid-cols-2 lg:grid-cols-6" aria-label="Export history filters">
      <label className={FIELD}>Dataset<select name="dataset" defaultValue={filters.dataset} className={CONTROL}><option value="">All datasets</option>{datasets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className={FIELD}>Status<select name="status" defaultValue={filters.status} className={CONTROL}><option value="">All statuses</option>{Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className={FIELD}>Requested from<input type="date" name="from" defaultValue={filters.from} className={CONTROL} /></label>
      <label className={FIELD}>Requested to<input type="date" name="to" defaultValue={filters.to} className={CONTROL} /></label>
      <label className={`${FIELD} sm:col-span-2 lg:col-span-1`}>Job reference<input type="search" name="search" defaultValue={filters.search} maxLength={128} className={CONTROL} /></label>
      <div className="flex items-end"><button type="submit" className={BTN_PRIMARY}>Apply filters</button></div>
    </form>
    <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground empty:hidden">{announcement}</p>
    {actionError && <p role="alert" className={NOTE_DANGER}>{actionError}</p>}
    {queuedJob && <p role="status" className={NOTE_SUCCESS}>Export queued. <Link href={`/staff/reports/exports?search=${encodeURIComponent(queuedJob)}`} className="font-semibold text-accent hover:underline">View new attempt</Link></p>}
    {data.state === "loading" && <div role="status" className="flex flex-col gap-3" aria-label="Loading export history">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-md bg-surface-2" />)}</div>}
    {data.state === "error" && <p role="alert" className={NOTE_DANGER}>Export History is unavailable. Refresh status or return to Reports.</p>}
    {data.state === "ready" && data.rows.length === 0 && <section className="border-t border-foreground pt-5"><h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">No exports yet</h2><p className="mt-2 text-sm text-muted-foreground">Exports matching these filters will appear here.</p></section>}
    {data.state === "ready" && data.rows.length > 0 && <ul aria-label="Export history cards" className="flex flex-col border-t border-foreground md:hidden">{data.rows.map((row) => <HistoryCard key={row.id} row={row} submit={submit} busy={submitting && pendingJob === row.id} />)}</ul>}
    {data.state === "ready" && data.rows.length > 0 && <div className="hidden min-w-0 overflow-x-auto border-t border-foreground md:block"><table className="w-full min-w-[720px] table-fixed text-left text-sm"><thead><tr><th className={TH}>Dataset / reference</th><th className={TH}>Requested / as of</th><th className={TH}>Rows / status</th><th className={TH}>Availability / action</th></tr></thead><tbody>{data.rows.map((row) => <tr id={row.id} key={row.id} className="border-b border-border align-top"><td className={`${TD} min-w-0`}><strong className="block text-base break-words">{datasetLabel(row.dataset)}</strong><span className="block font-mono text-[13px] break-all text-muted-foreground">{row.id}</span><span className="text-[13px] text-muted-foreground">Version {row.datasetVersion}</span>{row.retryOfId && <span className="block text-[13px] break-all">Retry of {row.retryOfId}</span>}{row.retriedById && <span className="block text-[13px] break-all">Retried by <Link href={`/staff/reports/exports?search=${encodeURIComponent(row.retriedById)}`} className="text-accent hover:underline">{row.retriedById}</Link></span>}{row.columns.length > 0 && <span className="block text-[13px] break-words text-muted-foreground">{row.columns.join(", ")}</span>}{Object.keys(row.filters).length > 0 && <span className="block text-[13px] break-words text-muted-foreground">{Object.entries(row.filters).map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>}</td><td className={TD}><time dateTime={row.createdAt}>{date(row.createdAt)}</time><span className="block text-[13px] text-muted-foreground">As of <time dateTime={row.asOf}>{date(row.asOf)}</time> ({row.timezone})</span></td><td className={TD}><span className="block">{row.rowCount === null ? "Pending" : new Intl.NumberFormat("en").format(row.rowCount)} {row.rowCount === 1 ? "row" : "rows"}</span><StatusPill label={statusLabels[row.status]} tone={statusTone(row.status)} />{row.status === "PROCESSING" && <span className="sr-only">Processing export</span>}</td><td className={TD}>{row.status === "FAILED" && <p className="max-w-full break-words">{row.failure ?? "Export failed. Review the safe error below, then retry as a new attempt."}</p>}{row.status === "EXPIRED" && <p>Expired</p>}{row.status === "SUCCEEDED" && <p>{row.canDownload && row.expiresAt ? <>Available until <time dateTime={row.expiresAt}>{date(row.expiresAt)}</time></> : "Download unavailable"}</p>}{row.canDownload && <a href={`/api/staff/reports/exports/${encodeURIComponent(row.id)}/download`} className={`mt-2 inline-block ${LINK_ACTION}`}>Download CSV</a>}{row.status === "FAILED" && <button type="button" disabled={submitting && pendingJob === row.id} onClick={() => submit(row.id, "retry")} className={`mt-2 block ${LINK_ACTION}`}>{submitting && pendingJob === row.id ? "Queuing…" : "Retry export"}</button>}{row.status === "EXPIRED" && <><p className="mt-1 text-[13px] text-muted-foreground">Rerunning captures current data with a new as of time.</p><button type="button" disabled={submitting && pendingJob === row.id} onClick={() => submit(row.id, "rerun")} className={`mt-2 block ${LINK_ACTION}`}>{submitting && pendingJob === row.id ? "Queuing…" : "Rerun export"}</button></>}</td></tr>)}</tbody></table></div>}
    {data.state === "ready" && ((data.page ?? 1) > 1 || data.hasMore) && <nav aria-label="Export history pages" className="flex flex-wrap items-center gap-4 text-sm"><span>Page {data.page ?? 1}</span>{(data.page ?? 1) > 1 && <Link href={pageHref((data.page ?? 1) - 1)} className="font-semibold text-accent hover:underline">Previous page</Link>}{data.hasMore && <Link href={pageHref((data.page ?? 1) + 1)} className="font-semibold text-accent hover:underline">Next page</Link>}</nav>}
  </div>;
}
