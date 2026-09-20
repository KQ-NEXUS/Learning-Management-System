"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { StatusPill } from "@/components/primitives";
import { getExportDatasetDefinition } from "@/server/services/report-registry";
import type {
  ReconciliationAssigneeOption,
  ReconciliationCaseRow,
  ReconciliationSummaryRow,
} from "@/server/services/reconciliation-case-service";
import { assignReconciliationCasesAction, requestReconciliationRefundExportAction } from "./actions";

type Props = {
  rows?: ReconciliationCaseRow[];
  summary?: ReconciliationSummaryRow[];
  assignees?: ReconciliationAssigneeOption[];
  asOf?: Date;
  loading?: boolean;
  error?: boolean;
  denied?: boolean;
  canExportRefunds?: boolean;
  canExportSensitiveRefunds?: boolean;
};

const PROVIDERS = ["ALL", "STRIPE", "PAYSTACK", "MANUAL"] as const;
const REFUND_STATUSES = ["REQUESTED", "PROCESSING", "COMPLETED", "FAILED", "RECORDED_MANUALLY"] as const;
const REFUND_EXPORT = getExportDatasetDefinition("reconciliation-refunds");
const RISK_LABELS = {
  CAPTURED_MONEY: "Captured money",
  SETTLEMENT_VARIANCE: "Settlement difference",
  MISSING_PROVIDER_DATA: "Missing provider data",
} as const;

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${minor} minor units ${currency}`;
  }
}

function age(openedAt: Date): string {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function ReconciliationWorkspace({
  rows = [],
  summary = [],
  assignees = [],
  asOf = new Date(),
  loading = false,
  error = false,
  denied = false,
  canExportRefunds = false,
  canExportSensitiveRefunds = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [isAssigning, startAssignment] = useTransition();
  const [refundExportOpen, setRefundExportOpen] = useState(false);
  const [refundExportQueued, setRefundExportQueued] = useState(false);

  const provider = (searchParams.get("provider") ?? "ALL").toUpperCase();

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "ALL") params.set(name, value);
    else params.delete(name);
    startNavigation(() => router.push(params.size ? `${pathname}?${params}` : pathname));
  }

  function toggle(caseId: string) {
    setSelected((current) => current.includes(caseId)
      ? current.filter((id) => id !== caseId)
      : [...current, caseId]);
  }

  function submitAssignment() {
    setAssignmentError(null);
    startAssignment(async () => {
      const result = await assignReconciliationCasesAction({
        caseIds: selected,
        assigneeId: assigneeId || null,
      });
      if (!result.ok) {
        setAssignmentError("Cases not assigned. Your selection and current assignments are unchanged.");
        return;
      }
      setSelected([]);
      setAssignmentOpen(false);
      router.refresh();
    });
  }

  if (denied) {
    return <section className="rounded-xl border border-border bg-surface p-6"><h1 className="text-2xl font-semibold">Reconciliation</h1><p className="mt-2 text-sm text-muted-foreground">You do not have access to perform this action.</p></section>;
  }

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Finance / Reconciliation</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Reconciliation</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review unresolved payment and refund exceptions before totals and the complete ledger.</p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">Data as of <time dateTime={asOf.toISOString()}>{asOf.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</time></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => router.refresh()} className="min-h-10 rounded-md border border-input-border bg-surface px-4 text-sm font-semibold">Refresh data</button>
          {canExportRefunds && !loading && !error && <button type="button" onClick={() => { setRefundExportQueued(false); setRefundExportOpen(true); }} className="min-h-10 rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast">Export refunds CSV</button>}
        </div>
      </header>
      {refundExportQueued && <p role="status" className="rounded-md border border-success/30 bg-surface p-3 text-sm">Export queued. You can leave this page and follow its progress in Export History. <Link href="/staff/reports/exports" className="font-semibold text-accent underline">View export history</Link></p>}

      <nav aria-label="Provider" className="flex flex-wrap gap-2">
        {PROVIDERS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={provider === item}
            onClick={() => setParam("provider", item)}
            className="min-h-10 rounded-md border border-input-border bg-surface px-4 text-sm font-semibold aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-contrast"
          >
            {item === "ALL" ? "All" : item === "PAYSTACK" ? "Paystack" : item === "STRIPE" ? "Stripe" : "Manual"}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap gap-3" aria-label="Reconciliation filters">
        <label className="flex flex-col gap-1 text-sm font-semibold">Currency
          <select value={searchParams.get("currency") ?? ""} onChange={(event) => setParam("currency", event.target.value)} className="min-h-10 rounded-md border border-input-border bg-surface px-3 font-normal">
            <option value="">All currencies</option><option value="NGN">NGN</option><option value="USD">USD</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Subject
          <select value={searchParams.get("subject") ?? ""} onChange={(event) => setParam("subject", event.target.value)} className="min-h-10 rounded-md border border-input-border bg-surface px-3 font-normal">
            <option value="">All subjects</option><option value="PAYMENT">Payment</option><option value="REFUND">Refund</option>
          </select>
        </label>
      </div>

      <section aria-labelledby="queue-title" aria-busy={loading || isNavigating} className="min-w-0 rounded-xl border border-border bg-surface shadow-xs">
        <div className="border-b border-border p-4"><h2 id="queue-title" className="text-base font-semibold">Unresolved exceptions</h2></div>
        {loading ? (
          <p role="status" className="p-8 text-sm text-muted-foreground">Loading reconciliation exceptionsâ€¦</p>
        ) : error ? (
          <div role="alert" className="p-8"><h3 className="font-semibold">Could not load reconciliation data. Your filters are unchanged.</h3><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => router.refresh()} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast">Retry reconciliation</button><Link href="/staff/payments" className="rounded-md border border-input-border px-4 py-2 text-sm font-semibold">View all transactions</Link></div></div>
        ) : rows.length === 0 ? (
          <div className="p-8"><h3 className="font-semibold">No unresolved exceptions</h3><p className="mt-2 text-sm text-muted-foreground">Payments that need Finance review will appear here. Use All transactions to review the complete ledger.</p></div>
        ) : (
          <>
            {selected.length > 0 && <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2 p-3"><strong>{selected.length} selected</strong><button type="button" onClick={() => setAssignmentOpen(true)} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast">Assign cases</button></div>}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-left text-sm"><thead><tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground"><th className="p-3">Select</th><th className="p-3">Risk</th><th className="p-3">Case</th><th className="p-3">Learner / offer</th><th className="p-3">Provider</th><th className="p-3">Difference / issue</th><th className="p-3">Owner</th><th className="p-3">Age</th></tr></thead><tbody>{rows.map((row) => <QueueTableRow key={row.caseId} row={row} checked={selected.includes(row.caseId)} onToggle={() => toggle(row.caseId)} />)}</tbody></table>
            </div>
            <ul className="flex flex-col divide-y divide-border sm:hidden">{rows.map((row) => <QueueCard key={row.caseId} row={row} checked={selected.includes(row.caseId)} onToggle={() => toggle(row.caseId)} />)}</ul>
          </>
        )}
      </section>

      <section aria-labelledby="summary-title"><h2 id="summary-title" className="text-base font-semibold">Scoped totals</h2><p className="mt-1 text-sm text-muted-foreground">Totals use the same provider, currency, subject, date, status, and permission scope as the rows above.</p><div className="mt-3 grid gap-3 md:grid-cols-2">{summary.map((item) => <article key={`${item.currency}-${item.provider}-${item.subject}`} className="rounded-xl border border-border bg-surface p-4"><p className="text-sm font-semibold">{item.currency} Â· {item.provider === "PAYSTACK" ? "Paystack" : item.provider === "STRIPE" ? "Stripe" : "Manual"} Â· {item.subject === "PAYMENT" ? "Payments" : "Refunds"}</p><p className="mt-2 font-mono text-lg tabular-nums">{money(item.amountMinor, item.currency)}</p><p className="mt-1 text-sm text-muted-foreground">{item.count} {item.count === 1 ? "case" : "cases"}</p></article>)}</div></section>
      <Link href={`/staff/payments${searchParams.size ? `?${searchParams}` : ""}`} className="w-fit text-sm font-semibold text-accent hover:underline">View all transactions</Link>

      <AssignmentDialog open={assignmentOpen} assignees={assignees} assigneeId={assigneeId} pending={isAssigning} error={assignmentError} onAssigneeChange={setAssigneeId} onSubmit={submitAssignment} onClose={() => !isAssigning && setAssignmentOpen(false)} />
      {refundExportOpen && <RefundExportDialog searchParams={searchParams} asOf={asOf} canExportSensitive={canExportSensitiveRefunds} onClose={() => setRefundExportOpen(false)} onQueued={() => { setRefundExportOpen(false); setRefundExportQueued(true); }} />}
    </main>
  );
}

function RefundExportDialog({ searchParams, asOf, canExportSensitive, onClose, onQueued }: { searchParams: URLSearchParams; asOf: Date; canExportSensitive: boolean; onClose: () => void; onQueued: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedSensitive, setSelectedSensitive] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const initialStatus = searchParams.get("refundStatus")?.toUpperCase();
  const [refundStatus, setRefundStatus] = useState(initialStatus && REFUND_STATUSES.some((status) => status === initialStatus) ? initialStatus : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startExport] = useTransition();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("select")?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]');
      if (!focusable?.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onClose]);

  function queue() {
    setError(null);
    const provider = searchParams.get("provider")?.toUpperCase();
    const currency = searchParams.get("currency")?.toUpperCase();
    const from = searchParams.get("dateFrom");
    const to = searchParams.get("dateTo");
    const filters = {
      ...(provider && provider !== "ALL" ? { provider } : {}),
      ...(currency ? { currency } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(refundStatus ? { status: refundStatus } : {}),
    };
    const columns = [...REFUND_EXPORT.safeColumns.map((column) => column.key), ...selectedSensitive];
    startExport(async () => {
      try {
        const result = await requestReconciliationRefundExportAction({ filters, columns, ...(selectedSensitive.length ? { reason: reason.trim() } : {}), asOf: asOf.toISOString() });
        if (result.ok) onQueued();
        else setError(result.message);
      } catch { setError("Export not queued. Your filters and choices are unchanged."); }
    });
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-surface p-6 shadow-card"><div><h2 id={titleId} className="text-base font-semibold">Refund CSV options</h2><p className="mt-1 text-sm text-muted-foreground">Uses the current provider, currency and date filters. Refund status is separate from case status. Files appear in Export History when ready.</p></div><label className="flex flex-col gap-1 text-sm font-semibold">Refund status<select value={refundStatus} disabled={pending} onChange={(event) => setRefundStatus(event.target.value)} className="min-h-10 rounded-md border border-input-border bg-surface px-3 font-normal"><option value="">All refund statuses</option>{REFUND_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>{canExportSensitive && <fieldset className="flex flex-col gap-2"><legend className="text-sm font-semibold">Additional columns</legend>{REFUND_EXPORT.sensitiveColumns.map((column) => <label key={column.key} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={pending} checked={selectedSensitive.includes(column.key)} onChange={(event) => setSelectedSensitive(event.target.checked ? [...selectedSensitive, column.key] : selectedSensitive.filter((key) => key !== column.key))} />{column.label}</label>)}</fieldset>}{selectedSensitive.length > 0 && <label className="flex flex-col gap-1 text-sm font-semibold">Operational reason<textarea value={reason} disabled={pending} required maxLength={2000} onChange={(event) => setReason(event.target.value)} className="min-h-20 rounded-md border border-input-border bg-surface p-2 font-normal" /></label>}{error && <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">{error}</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={pending || (selectedSensitive.length > 0 && !reason.trim())} onClick={queue} className="min-h-10 rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast disabled:opacity-50">{pending ? "Queuing export" : "Queue refund export"}</button><button type="button" disabled={pending} onClick={onClose} className="min-h-10 rounded-md border border-input-border px-4 text-sm font-semibold">Keep editing reconciliation</button></div></div></div>;
}

function QueueTableRow({ row, checked, onToggle }: { row: ReconciliationCaseRow; checked: boolean; onToggle: () => void }) {
  return <tr className="border-b border-border last:border-0"><td className="p-3"><input type="checkbox" aria-label={`Select case ${row.caseId}`} checked={checked} onChange={onToggle} /></td><td className="p-3"><StatusPill label={RISK_LABELS[row.risk]} tone={row.risk === "CAPTURED_MONEY" ? "danger" : "warning"} /></td><td className="p-3"><Link href={`/staff/reconciliation/${row.caseId}`} className="break-all font-mono font-semibold text-accent hover:underline">{row.caseId}</Link><div className="break-all font-mono text-[11px] text-muted-foreground">{row.orderReference}</div></td><td className="p-3"><div className="break-words">{row.learnerName}</div><div className="break-words text-muted-foreground">{row.cohortTitle}</div></td><td className="p-3">{row.provider === "PAYSTACK" ? "Paystack" : row.provider === "STRIPE" ? "Stripe" : "Manual"}<div className="font-mono text-[11px]">{row.currency}</div></td><td className="p-3 font-mono tabular-nums">{row.varianceMinor === null ? RISK_LABELS[row.risk] : money(row.varianceMinor, row.currency)}</td><td className="p-3">{row.assigneeName ?? "Unassigned"}</td><td className="p-3"><time dateTime={new Date(row.openedAt).toISOString()} title={new Date(row.openedAt).toISOString()}>{age(row.openedAt)}</time></td></tr>;
}

function QueueCard({ row, checked, onToggle }: { row: ReconciliationCaseRow; checked: boolean; onToggle: () => void }) {
  return <li className="p-4"><div className="flex items-start gap-3"><input type="checkbox" aria-label={`Select case ${row.caseId}`} checked={checked} onChange={onToggle} /><div className="min-w-0 flex-1"><StatusPill label={RISK_LABELS[row.risk]} tone={row.risk === "CAPTURED_MONEY" ? "danger" : "warning"} /><Link href={`/staff/reconciliation/${row.caseId}`} className="mt-2 block break-all font-mono font-semibold text-accent">{row.caseId}</Link><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt className="text-muted-foreground">Subject</dt><dd>{row.subject === "PAYMENT" ? "Payment" : "Refund"}</dd><dt className="text-muted-foreground">Learner / offer</dt><dd className="break-words">{row.learnerName} Â· {row.cohortTitle}</dd><dt className="text-muted-foreground">Provider / currency</dt><dd>{row.provider} Â· {row.currency}</dd><dt className="text-muted-foreground">Issue</dt><dd className="break-words font-mono">{row.varianceMinor === null ? RISK_LABELS[row.risk] : money(row.varianceMinor, row.currency)}</dd><dt className="text-muted-foreground">Owner</dt><dd>{row.assigneeName ?? "Unassigned"}</dd><dt className="text-muted-foreground">Age</dt><dd>{age(row.openedAt)}</dd></dl></div></div></li>;
}

function AssignmentDialog(props: { open: boolean; assignees: ReconciliationAssigneeOption[]; assigneeId: string; pending: boolean; error: string | null; onAssigneeChange: (value: string) => void; onSubmit: () => void; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("select")?.focus();
    return () => previous?.focus();
  }, [props.open]);
  if (!props.open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-xl bg-surface p-6 shadow-card"><h2 id={titleId} className="text-base font-semibold">Assign cases</h2><label className="mt-4 flex flex-col gap-1 text-sm font-semibold">Assign to<select value={props.assigneeId} disabled={props.pending} onChange={(event) => props.onAssigneeChange(event.target.value)} className="min-h-10 rounded-md border border-input-border bg-surface px-3 font-normal"><option value="">Unassigned</option>{props.assignees.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>{props.error && <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">{props.error}<div className="mt-2 font-semibold">Try assignment again or Keep current assignments.</div></div>}<div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={props.pending} onClick={props.onSubmit} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50">{props.pending ? "Assigningâ€¦" : "Assign cases"}</button><button type="button" disabled={props.pending} onClick={props.onClose} className="rounded-md border border-input-border px-4 py-2 text-sm font-semibold">Keep current assignments</button></div></div></div>;
}
