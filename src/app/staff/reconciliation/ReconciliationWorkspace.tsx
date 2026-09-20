"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { StatusPill } from "@/components/primitives";
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

const PROVIDER_LABEL = { PAYSTACK: "Paystack", STRIPE: "Stripe", MANUAL: "Manual" } as const;
const CHECKBOX = "size-4 accent-accent";

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

  const breadcrumbs = [{ label: "Finance" }, { label: "Reconciliation" }];
  const totalsSize = figureSize(summary.map((item) => money(item.amountMinor, item.currency)));

  if (denied) {
    return (
      <div className="flex min-w-0 flex-col gap-8">
        <PageHeader breadcrumbs={breadcrumbs} title="Reconciliation" />
        <section className="border-t border-foreground pt-5">
          <p className="text-sm text-muted-foreground">You do not have access to perform this action.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Reconciliation"
        subtitle="Review unresolved payment and refund exceptions before totals and the complete ledger."
        actions={
          <>
            <button type="button" onClick={() => router.refresh()} className={BTN_ON_NAVY}>Refresh data</button>
            {canExportRefunds && !loading && !error && <button type="button" onClick={() => { setRefundExportQueued(false); setRefundExportOpen(true); }} className={BTN_PRIMARY_ON_NAVY}>Export refunds CSV</button>}
          </>
        }
        band={<p className="mt-4 font-mono text-[13px] text-sidebar-soft">Data as of <time dateTime={asOf.toISOString()}>{asOf.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</time></p>}
      />

      {refundExportQueued && <p role="status" className={NOTE_SUCCESS}>Export queued. You can leave this page and follow its progress in Export History. <Link href="/staff/reports/exports" className="font-semibold text-accent hover:underline">View export history</Link></p>}

      <nav aria-label="Provider" className="flex gap-8 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PROVIDERS.map((item) => {
          const active = provider === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              onClick={() => setParam("provider", item)}
              className={`-mb-px shrink-0 border-b-2 pb-3 font-medium whitespace-nowrap ${active ? "border-accent font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {item === "ALL" ? "All" : PROVIDER_LABEL[item]}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap gap-6" aria-label="Reconciliation filters">
        <label className={FIELD}>Currency
          <select value={searchParams.get("currency") ?? ""} onChange={(event) => setParam("currency", event.target.value)} className={CONTROL}>
            <option value="">All currencies</option><option value="NGN">NGN</option><option value="USD">USD</option>
          </select>
        </label>
        <label className={FIELD}>Subject
          <select value={searchParams.get("subject") ?? ""} onChange={(event) => setParam("subject", event.target.value)} className={CONTROL}>
            <option value="">All subjects</option><option value="PAYMENT">Payment</option><option value="REFUND">Refund</option>
          </select>
        </label>
      </div>

      <section aria-labelledby="queue-title" aria-busy={loading || isNavigating} className="min-w-0">
        <h2 id="queue-title" className={`${SECTION_TITLE} pb-4`}>Unresolved exceptions</h2>
        <div className="border-t border-foreground">
          {loading ? (
            <p role="status" className="py-6 text-sm text-muted-foreground">Loading reconciliation exceptions…</p>
          ) : error ? (
            <div role="alert" className="py-6">
              <h3 className="text-base font-semibold">Could not load reconciliation data. Your filters are unchanged.</h3>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => router.refresh()} className={BTN_PRIMARY}>Retry reconciliation</button>
                <Link href="/staff/payments" className={BTN}>View all transactions</Link>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-6">
              <h3 className="text-base font-semibold">No unresolved exceptions</h3>
              <p className="mt-2 text-sm text-muted-foreground">Payments that need Finance review will appear here. Use All transactions to review the complete ledger.</p>
            </div>
          ) : (
            <>
              {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-4 border-b border-border py-3">
                  <strong className="text-sm">{selected.length} selected</strong>
                  <button type="button" onClick={() => setAssignmentOpen(true)} className={BTN_PRIMARY}>Assign cases</button>
                </div>
              )}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={TH}>Select</th><th className={TH}>Risk</th><th className={TH}>Case</th><th className={TH}>Learner / offer</th><th className={TH}>Provider</th><th className={TH}>Difference / issue</th><th className={TH}>Owner</th><th className={TH}>Age</th>
                    </tr>
                  </thead>
                  <tbody>{rows.map((row) => <QueueTableRow key={row.caseId} row={row} checked={selected.includes(row.caseId)} onToggle={() => toggle(row.caseId)} />)}</tbody>
                </table>
              </div>
              <ul className="flex flex-col sm:hidden">{rows.map((row) => <QueueCard key={row.caseId} row={row} checked={selected.includes(row.caseId)} onToggle={() => toggle(row.caseId)} />)}</ul>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="summary-title">
        <h2 id="summary-title" className={SECTION_TITLE}>Scoped totals</h2>
        <p className="mt-2 text-sm text-muted-foreground">Totals use the same provider, currency, subject, date, status, and permission scope as the rows above.</p>
        {summary.length > 0 && (
          <div className="mt-4 grid gap-x-10 border-t border-foreground md:grid-cols-2 xl:grid-cols-3">
            {summary.map((item) => (
              <article key={`${item.currency}-${item.provider}-${item.subject}`} className="border-b border-border py-5">
                <p className="text-sm text-muted-foreground">{item.currency} · {PROVIDER_LABEL[item.provider]} · {item.subject === "PAYMENT" ? "Payments" : "Refunds"}</p>
                <p className={`mt-1 font-mono ${totalsSize} leading-[1.15] font-medium tracking-[-0.03em] tabular-nums`}>{money(item.amountMinor, item.currency)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.count} {item.count === 1 ? "case" : "cases"}</p>
              </article>
            ))}
          </div>
        )}
      </section>
      <Link href={`/staff/payments${searchParams.size ? `?${searchParams}` : ""}`} className="w-fit text-sm font-semibold text-accent hover:underline">View all transactions</Link>

      <AssignmentDialog open={assignmentOpen} assignees={assignees} assigneeId={assigneeId} pending={isAssigning} error={assignmentError} onAssigneeChange={setAssigneeId} onSubmit={submitAssignment} onClose={() => !isAssigning && setAssignmentOpen(false)} />
      {refundExportOpen && <RefundExportDialog searchParams={searchParams} asOf={asOf} canExportSensitive={canExportSensitiveRefunds} onClose={() => setRefundExportOpen(false)} onQueued={() => { setRefundExportOpen(false); setRefundExportQueued(true); }} />}
    </div>
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

  return (
    <div className={DIALOG_SCRIM}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={DIALOG_PANEL}>
        <div>
          <h2 id={titleId} className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">Refund CSV options</h2>
          <p className="mt-2 text-sm text-muted-foreground">Uses the current provider, currency and date filters. Refund status is separate from case status. Files appear in Export History when ready.</p>
        </div>
        <label className={FIELD}>Refund status
          <select value={refundStatus} disabled={pending} onChange={(event) => setRefundStatus(event.target.value)} className={CONTROL}>
            <option value="">All refund statuses</option>
            {REFUND_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        {canExportSensitive && (
          <fieldset className="flex flex-col gap-3">
            <legend className="pb-1 text-sm font-semibold">Additional columns</legend>
            {REFUND_EXPORT.sensitiveColumns.map((column) => (
              <label key={column.key} className="flex items-center gap-3 text-sm">
                <input type="checkbox" className={CHECKBOX} disabled={pending} checked={selectedSensitive.includes(column.key)} onChange={(event) => setSelectedSensitive(event.target.checked ? [...selectedSensitive, column.key] : selectedSensitive.filter((key) => key !== column.key))} />
                {column.label}
              </label>
            ))}
          </fieldset>
        )}
        {selectedSensitive.length > 0 && <label className={FIELD}>Operational reason<textarea value={reason} disabled={pending} required maxLength={2000} onChange={(event) => setReason(event.target.value)} className={TEXTAREA} /></label>}
        {error && <p role="alert" className={NOTE_DANGER}>{error}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={pending} onClick={onClose} className={BTN}>Keep editing reconciliation</button>
          <button type="button" disabled={pending || (selectedSensitive.length > 0 && !reason.trim())} onClick={queue} className={BTN_PRIMARY}>{pending ? "Queuing export" : "Queue refund export"}</button>
        </div>
      </div>
    </div>
  );
}

function QueueTableRow({ row, checked, onToggle }: { row: ReconciliationCaseRow; checked: boolean; onToggle: () => void }) {
  return (
    <tr className="border-b border-border">
      <td className={TD}><input type="checkbox" className={CHECKBOX} aria-label={`Select case ${row.caseId}`} checked={checked} onChange={onToggle} /></td>
      <td className={TD}><StatusPill label={RISK_LABELS[row.risk]} tone={row.risk === "CAPTURED_MONEY" ? "danger" : "warning"} /></td>
      <td className={TD}>
        <Link href={`/staff/reconciliation/${row.caseId}`} className="font-mono font-semibold break-all text-accent hover:underline">{row.caseId}</Link>
        <div className="font-mono text-[13px] break-all text-muted-foreground">{row.orderReference}</div>
      </td>
      <td className={TD}><div className="break-words">{row.learnerName}</div><div className="break-words text-muted-foreground">{row.cohortTitle}</div></td>
      <td className={TD}>{PROVIDER_LABEL[row.provider]}<div className="font-mono text-[13px] text-muted-foreground">{row.currency}</div></td>
      <td className={`${TD} font-mono tabular-nums`}>{row.varianceMinor === null ? RISK_LABELS[row.risk] : money(row.varianceMinor, row.currency)}</td>
      <td className={TD}>{row.assigneeName ?? "Unassigned"}</td>
      <td className={TD}><time dateTime={new Date(row.openedAt).toISOString()} title={new Date(row.openedAt).toISOString()}>{age(row.openedAt)}</time></td>
    </tr>
  );
}

function QueueCard({ row, checked, onToggle }: { row: ReconciliationCaseRow; checked: boolean; onToggle: () => void }) {
  return (
    <li className="border-b border-border py-5">
      <div className="flex items-start gap-3">
        <input type="checkbox" className={`${CHECKBOX} mt-1`} aria-label={`Select case ${row.caseId}`} checked={checked} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <StatusPill label={RISK_LABELS[row.risk]} tone={row.risk === "CAPTURED_MONEY" ? "danger" : "warning"} />
          <Link href={`/staff/reconciliation/${row.caseId}`} className="mt-2 block font-mono font-semibold break-all text-accent hover:underline">{row.caseId}</Link>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Subject</dt><dd>{row.subject === "PAYMENT" ? "Payment" : "Refund"}</dd>
            <dt className="text-muted-foreground">Learner / offer</dt><dd className="break-words">{row.learnerName} · {row.cohortTitle}</dd>
            <dt className="text-muted-foreground">Provider / currency</dt><dd>{row.provider} · {row.currency}</dd>
            <dt className="text-muted-foreground">Issue</dt><dd className="font-mono break-words">{row.varianceMinor === null ? RISK_LABELS[row.risk] : money(row.varianceMinor, row.currency)}</dd>
            <dt className="text-muted-foreground">Owner</dt><dd>{row.assigneeName ?? "Unassigned"}</dd>
            <dt className="text-muted-foreground">Age</dt><dd>{age(row.openedAt)}</dd>
          </dl>
        </div>
      </div>
    </li>
  );
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
  return (
    <div className={DIALOG_SCRIM}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={DIALOG_PANEL}>
        <h2 id={titleId} className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">Assign cases</h2>
        <label className={FIELD}>Assign to
          <select value={props.assigneeId} disabled={props.pending} onChange={(event) => props.onAssigneeChange(event.target.value)} className={CONTROL}>
            <option value="">Unassigned</option>
            {props.assignees.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        {props.error && <div role="alert" className={NOTE_DANGER}>{props.error}<div className="mt-1 font-semibold">Try assignment again or Keep current assignments.</div></div>}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={props.pending} onClick={props.onClose} className={BTN}>Keep current assignments</button>
          <button type="button" disabled={props.pending} onClick={props.onSubmit} className={BTN_PRIMARY}>{props.pending ? "Assigning…" : "Assign cases"}</button>
        </div>
      </div>
    </div>
  );
}
