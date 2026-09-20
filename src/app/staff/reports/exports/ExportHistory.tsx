"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { REPORT_REGISTRY } from "@/server/services/report-registry";
import type { ExportHistoryRow } from "@/server/services/export-read-service";
import { retryHistoryExportAction, rerunHistoryExportAction } from "./actions";

type Filters = { dataset: string; status: string; from: string; to: string; search: string };
type Props = { filters: Filters } & ({ state: "ready"; rows: readonly ExportHistoryRow[]; page?: number; hasMore?: boolean } | { state: "loading" | "error"; rows?: never; page?: never; hasMore?: never });
const statusLabels = { QUEUED: "Queued", PROCESSING: "Processing", SUCCEEDED: "Succeeded", FAILED: "Failed", EXPIRED: "Expired" } as const;
const datasets = [...REPORT_REGISTRY.map(({ id, label }) => ({ id, label })), { id: "reconciliation-refunds", label: "Reconciliation refunds" }, { id: "audit", label: "Audit" }];
function date(value: string): string { return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(value)); }
function datasetLabel(id: string): string { return datasets.find((item) => item.id === id)?.label ?? id; }

function HistoryCard({ row, submit, busy }: { row: ExportHistoryRow; submit: (id: string, kind: "retry" | "rerun") => void; busy: boolean }) {
  return <li className="min-w-0 rounded-xl border border-border bg-surface p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-words">{datasetLabel(row.dataset)}</strong><StatusPill label={statusLabels[row.status]} tone={row.status === "SUCCEEDED" ? "success" : row.status === "FAILED" ? "danger" : "neutral"} /></div>
    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{row.id}</p>
    <p className="text-xs text-muted-foreground">Version {row.datasetVersion}</p>
    {row.retryOfId && <p className="break-all text-xs">Retry of {row.retryOfId}</p>}
    {row.retriedById && <p className="break-all text-xs">Retried by <Link href={`/staff/reports/exports?search=${encodeURIComponent(row.retriedById)}`} className="text-accent underline">{row.retriedById}</Link></p>}
    {row.columns.length > 0 && <p className="break-words text-xs text-muted-foreground">{row.columns.join(", ")}</p>}
    {Object.keys(row.filters).length > 0 && <p className="break-words text-xs text-muted-foreground">{Object.entries(row.filters).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>}
    <dl className="mt-3 grid grid-cols-2 gap-2"><div><dt className="text-xs text-muted-foreground">Requested</dt><dd><time dateTime={row.createdAt}>{date(row.createdAt)}</time></dd></div><div><dt className="text-xs text-muted-foreground">As of</dt><dd><time dateTime={row.asOf}>{date(row.asOf)}</time></dd></div><div><dt className="text-xs text-muted-foreground">Rows</dt><dd>{row.rowCount === null ? "Pending" : row.rowCount} {row.rowCount === 1 ? "row" : "rows"}</dd></div><div><dt className="text-xs text-muted-foreground">Availability</dt><dd>{row.canDownload && row.expiresAt ? <>Until <time dateTime={row.expiresAt}>{date(row.expiresAt)}</time></> : row.status === "EXPIRED" ? "Expired" : row.status === "FAILED" ? "Failed" : "Pending"}</dd></div></dl>
    {row.status === "PROCESSING" && <span className="sr-only">Processing export</span>}
    {row.status === "FAILED" && <p className="mt-2 break-words text-xs">{row.failure ?? "Export failed."}</p>}
    {row.canDownload && <a href={`/api/staff/reports/exports/${encodeURIComponent(row.id)}/download`} className="mt-3 inline-block font-semibold text-accent underline">Download CSV</a>}
    {row.status === "FAILED" && <button type="button" disabled={busy} onClick={() => submit(row.id, "retry")} className="mt-3 block font-semibold text-accent underline disabled:opacity-60">{busy ? "Queuing…" : "Retry export"}</button>}
    {row.status === "EXPIRED" && <><p className="mt-2 text-xs text-muted-foreground">Rerunning captures current data with a new as of time.</p><button type="button" disabled={busy} onClick={() => submit(row.id, "rerun")} className="mt-3 block font-semibold text-accent underline disabled:opacity-60">{busy ? "Queuing…" : "Rerun export"}</button></>}
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

  return <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6">
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground"><Link href="/staff/reports" className="underline-offset-2 hover:underline">Reports</Link> / Export History</nav>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-foreground">Export History</h1><p className="mt-1 text-sm text-muted-foreground">Review frozen requests and download files while they are available.</p></div>
      <button ref={refreshRef} type="button" onClick={refresh} disabled={refreshing} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">{refreshing ? "Refreshing status…" : "Refresh status"}</button>
    </header>
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4" aria-label="Export history filters">
      <label className="flex min-w-40 flex-col gap-1 text-sm">Dataset<select name="dataset" defaultValue={filters.dataset} className="rounded-lg border border-border bg-background px-2 py-2"><option value="">All datasets</option>{datasets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="flex min-w-36 flex-col gap-1 text-sm">Status<select name="status" defaultValue={filters.status} className="rounded-lg border border-border bg-background px-2 py-2"><option value="">All statuses</option>{Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm">Requested from<input type="date" name="from" defaultValue={filters.from} className="rounded-lg border border-border bg-background px-2 py-2" /></label>
      <label className="flex flex-col gap-1 text-sm">Requested to<input type="date" name="to" defaultValue={filters.to} className="rounded-lg border border-border bg-background px-2 py-2" /></label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">Job reference<input type="search" name="search" defaultValue={filters.search} maxLength={128} className="rounded-lg border border-border bg-background px-2 py-2" /></label>
      <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">Apply filters</button>
    </form>
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{announcement}</p>
    {actionError && <p role="alert" className="rounded-lg border border-border p-3 text-sm text-foreground">{actionError}</p>}
    {queuedJob && <p role="status" className="text-sm">Export queued. <Link href={`/staff/reports/exports?search=${encodeURIComponent(queuedJob)}`} className="underline">View new attempt</Link></p>}
    {data.state === "loading" && <div role="status" className="space-y-3" aria-label="Loading export history">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl border border-border bg-surface" />)}</div>}
    {data.state === "error" && <p role="alert" className="rounded-xl border border-border bg-surface p-5 text-sm">Export History is unavailable. Refresh status or return to Reports.</p>}
    {data.state === "ready" && data.rows.length === 0 && <section className="rounded-xl border border-border bg-surface p-6"><h2 className="font-semibold">No exports yet</h2><p className="mt-1 text-sm text-muted-foreground">Exports matching these filters will appear here.</p></section>}
    {data.state === "ready" && data.rows.length > 0 && <ul aria-label="Export history cards" className="space-y-3 md:hidden">{data.rows.map((row) => <HistoryCard key={row.id} row={row} submit={submit} busy={submitting && pendingJob === row.id} />)}</ul>}
    {data.state === "ready" && data.rows.length > 0 && <div className="hidden min-w-0 overflow-x-auto rounded-xl border border-border bg-surface md:block"><table className="w-full min-w-[720px] table-fixed text-left text-sm"><thead className="border-b border-border text-muted-foreground"><tr><th className="p-3">Dataset / reference</th><th className="p-3">Requested / as of</th><th className="p-3">Rows / status</th><th className="p-3">Availability / action</th></tr></thead><tbody>{data.rows.map((row) => <tr id={row.id} key={row.id} className="border-t border-border align-top"><td className="min-w-0 p-3"><strong className="block break-words">{datasetLabel(row.dataset)}</strong><span className="block break-all font-mono text-xs text-muted-foreground">{row.id}</span><span className="text-xs text-muted-foreground">Version {row.datasetVersion}</span>{row.retryOfId && <span className="block break-all text-xs">Retry of {row.retryOfId}</span>}{row.retriedById && <span className="block break-all text-xs">Retried by <Link href={`/staff/reports/exports?search=${encodeURIComponent(row.retriedById)}`} className="text-accent underline">{row.retriedById}</Link></span>}{row.columns.length > 0 && <span className="block break-words text-xs text-muted-foreground">{row.columns.join(", ")}</span>}{Object.keys(row.filters).length > 0 && <span className="block break-words text-xs text-muted-foreground">{Object.entries(row.filters).map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>}</td><td className="p-3"><time dateTime={row.createdAt}>{date(row.createdAt)}</time><span className="block text-xs text-muted-foreground">As of <time dateTime={row.asOf}>{date(row.asOf)}</time> ({row.timezone})</span></td><td className="p-3"><span className="block">{row.rowCount === null ? "Pending" : new Intl.NumberFormat("en").format(row.rowCount)} {row.rowCount === 1 ? "row" : "rows"}</span><StatusPill label={statusLabels[row.status]} tone={row.status === "SUCCEEDED" ? "success" : row.status === "FAILED" ? "danger" : "neutral"} />{row.status === "PROCESSING" && <span className="sr-only">Processing export</span>}</td><td className="p-3">{row.status === "FAILED" && <p className="max-w-full break-words text-xs">{row.failure ?? "Export failed. Review the safe error below, then retry as a new attempt."}</p>}{row.status === "EXPIRED" && <p>Expired</p>}{row.status === "SUCCEEDED" && <p>{row.canDownload && row.expiresAt ? <>Available until <time dateTime={row.expiresAt}>{date(row.expiresAt)}</time></> : "Download unavailable"}</p>}{row.canDownload && <a href={`/api/staff/reports/exports/${encodeURIComponent(row.id)}/download`} className="mt-2 inline-block font-semibold text-accent underline">Download CSV</a>}{row.status === "FAILED" && <button type="button" disabled={submitting && pendingJob === row.id} onClick={() => submit(row.id, "retry")} className="mt-2 block font-semibold text-accent underline disabled:opacity-60">{submitting && pendingJob === row.id ? "Queuing…" : "Retry export"}</button>}{row.status === "EXPIRED" && <><p className="mt-1 text-xs text-muted-foreground">Rerunning captures current data with a new as of time.</p><button type="button" disabled={submitting && pendingJob === row.id} onClick={() => submit(row.id, "rerun")} className="mt-2 block font-semibold text-accent underline disabled:opacity-60">{submitting && pendingJob === row.id ? "Queuing…" : "Rerun export"}</button></>}</td></tr>)}</tbody></table></div>}
    {data.state === "ready" && ((data.page ?? 1) > 1 || data.hasMore) && <nav aria-label="Export history pages" className="flex flex-wrap items-center gap-3 text-sm"><span>Page {data.page ?? 1}</span>{(data.page ?? 1) > 1 && <Link href={pageHref((data.page ?? 1) - 1)} className="font-semibold text-accent underline">Previous page</Link>}{data.hasMore && <Link href={pageHref((data.page ?? 1) + 1)} className="font-semibold text-accent underline">Next page</Link>}</nav>}
  </main>;
}
