"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { DetailFacts, DetailLayout, StatusPill } from "@/components/primitives";
import { BTN, BTN_PRIMARY, CONTROL, DIALOG_PANEL, DIALOG_SCRIM, FIELD, NOTE_DANGER, NOTE_WARNING, TEXTAREA } from "@/components/primitives/controls";
import type { MoneyState, ReconciliationCaseDetail } from "@/server/services/reconciliation-case-service";
import { resolveReconciliationCaseAction } from "../actions";
import { humanizeCode, humanizeKey, providerLabel, shortId } from "@/lib/humanize";

const STATUS_LABEL = { OPEN: "Open", RESOLVED: "Resolved", REOPENED: "Reopened" } as const;
const RISK_LABEL = { CAPTURED_MONEY: "Captured money", SETTLEMENT_VARIANCE: "Settlement difference", MISSING_PROVIDER_DATA: "Missing provider data" } as const;
const EVENT_LABEL: Record<string, string> = { OPENED: "Opened", EVIDENCE_CHANGED: "Evidence changed", ASSIGNED: "Assigned", RESOLVED: "Resolved", REOPENED: "Reopened" };
const REASONS = [
  ["MATCHED_PROVIDER_EVIDENCE", "Matched provider evidence"],
  ["CORRECTED_UPSTREAM", "Corrected upstream"],
  ["DUPLICATE_RECORD", "Duplicate record"],
  ["ACCEPTED_VARIANCE", "Accepted variance"],
  ["OTHER", "Other"],
] as const;

function money(value: MoneyState, currency: string): string {
  if (value.kind === "NOT_APPLICABLE") return "Not applicable";
  if (value.kind === "PENDING") return "— (pending reconciliation)";
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(value.minor / 100); }
  catch { return `${(value.minor / 100).toFixed(2)} ${currency}`; }
}

const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS);

/** Evidence value in words: ids shortened, providers and statuses named. */
function evidenceValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "See raw evidence";
  if (/provider$/i.test(key)) return providerLabel(value);
  if (/(status|state|risk|subject)$/i.test(key)) return humanizeCode(value);
  if (/id$/i.test(key)) return <span className="font-mono" title={value}>{shortId(value)}</span>;
  return <span className="break-words">{value}</span>;
}

/**
 * UX batch C — provider evidence as labelled facts, not a JSON dump. The raw
 * JSON stays one click away for an investigation that needs exact values.
 */
function EvidenceFacts({ evidence }: { evidence: unknown }) {
  if (evidence === null || evidence === undefined) return null;
  const entries = typeof evidence === "object" && !Array.isArray(evidence)
    ? Object.entries(evidence as Record<string, unknown>)
    : [];
  return (
    <div className="flex flex-col gap-2">
      {entries.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          {entries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{humanizeKey(key)}</dt>
              <dd className="min-w-0">{evidenceValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-accent">Show raw evidence</summary>
        <pre className="mt-2 max-w-full rounded-md bg-surface-2 p-4 font-mono text-[13px] break-words whitespace-pre-wrap">{JSON.stringify(evidence, null, 2)}</pre>
      </details>
    </div>
  );
}

function exactTime(value: Date): React.ReactNode {
  const date = new Date(value);
  return <time dateTime={date.toISOString()} className="font-mono tabular-nums">{date.toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</time>;
}

export function ReconciliationCaseDetailView({ detail }: { detail: ReconciliationCaseDetail }) {
  const [resolveOpen, setResolveOpen] = useState(false);
  const statusTone = detail.status === "RESOLVED" ? "success" : detail.status === "REOPENED" ? "warning" : "neutral";
  return <>
    <DetailLayout mode="stacked" breadcrumbs={[{ label: "Reconciliation", href: "/staff/reconciliation" }, { label: `Case ${shortId(detail.caseId)}` }]} title="Reconciliation case" identifier={shortId(detail.caseId)}
      badges={<><StatusPill label={STATUS_LABEL[detail.status]} tone={statusTone} /><StatusPill label={RISK_LABEL[detail.risk]} tone={detail.risk === "CAPTURED_MONEY" ? "danger" : "warning"} /><StatusPill label={providerLabel(detail.provider)} tone="neutral" /><StatusPill label={detail.currency} tone="neutral" /></>}
      sections={[
        { id: "investigation-summary", label: "Investigation summary", content: <div className="flex flex-col gap-4">{detail.status === "REOPENED" && <div role="alert" className={`${NOTE_WARNING} mt-4`}><p className="font-semibold">This exception was reopened because new provider evidence no longer matches the previous resolution.</p></div>}<DetailFacts facts={[{ label: "Subject", value: detail.subject === "PAYMENT" ? "Payment" : "Refund" }, { label: "Risk", value: RISK_LABEL[detail.risk] }, { label: "Opened", value: exactTime(detail.openedAt) }, { label: "Last evidence", value: exactTime(detail.lastEvidenceAt) }, { label: "Owner", value: detail.assignment.assigneeName ?? "Unassigned" }]} />{detail.status !== "RESOLVED" && <div><button type="button" onClick={() => setResolveOpen(true)} className={BTN_PRIMARY}>Resolve exception</button></div>}<EvidenceFacts evidence={detail.evidence} /></div> },
        { id: "order-and-learner", label: "Order and learner", content: <DetailFacts facts={[{ label: "Order reference", value: detail.order.reference, mono: true }, { label: "Learner", value: <span className="break-words">{detail.order.learnerName}</span> }, { label: "Email", value: <span className="break-words">{detail.order.learnerEmail}</span> }, { label: "Cohort", value: detail.order.cohortTitle }, { label: "Payment state", value: humanizeCode(detail.order.status) }, { label: "Enrolment state", value: detail.order.enrolmentStates.map(humanizeCode).join(", ") || "No enrolment" }, { label: "Provider", value: providerLabel(detail.provider) }, { label: "Currency", value: detail.currency, mono: true }, { label: detail.subject === "PAYMENT" ? "Payment amount" : "Refund amount", value: money(detail.subjectAmount, detail.currency), mono: true }]} /> },
        { id: "expected-and-actual", label: "Expected and actual settlement", content: <DetailFacts facts={[{ label: "Base price", value: money(detail.amounts.base, detail.currency), mono: true }, { label: "KQ platform fee", value: money(detail.amounts.platformFee, detail.currency), mono: true }, { label: "Estimated gateway fee", value: money(detail.amounts.gatewayFeeEstimated, detail.currency), mono: true }, { label: "Learner total", value: money(detail.amounts.learnerTotal, detail.currency), mono: true }, { label: "Expected school settlement", value: money(detail.amounts.schoolSettlementExpected, detail.currency), mono: true }, { label: "Actual school settlement", value: money(detail.amounts.schoolSettlementActual, detail.currency), mono: true }, { label: "Actual gateway fee", value: money(detail.amounts.gatewayFeeActual, detail.currency), mono: true }, { label: "Actual KQ gross", value: money(detail.amounts.platformGrossActual, detail.currency), mono: true }, { label: "Actual KQ net", value: money(detail.amounts.platformNetActual, detail.currency), mono: true }]} /> },
        { id: "payment-history", label: "Evidence and payment history", content: <ol className="flex flex-col">{detail.paymentTimeline.map((entry) => <li key={`${entry.kind}-${entry.id}`} className="border-b border-border py-4 first:pt-0 last:border-0"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{entry.kind === "PAYMENT" ? "Payment" : "Refund"} · {humanizeCode(entry.status)}</p>{exactTime(entry.occurredAt)}</div><p className="mt-2 break-words font-mono text-sm">{money({ kind: "VALUE", minor: entry.amountMinor }, entry.currency)} · {providerLabel(entry.provider)}</p><p className="mt-1 break-all font-mono text-[13px] text-muted-foreground">{entry.reference ?? "No external reference"}</p>{entry.actorName && <p className="mt-1 text-sm text-muted-foreground">Recorded by {entry.actorName}</p>}</li>)}</ol> },
        { id: "investigation-history", label: "Investigation history", content: <div className="flex flex-col gap-5"><ol className="flex flex-col gap-3">{detail.caseHistory.map((event) => <li key={event.id} className="min-w-0 border-l-2 border-border pl-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{EVENT_LABEL[event.type] ?? humanizeCode(event.type)}</p>{exactTime(event.createdAt)}</div><p className="mt-1 break-words text-sm text-muted-foreground">{event.actorName ?? (event.actorType === "SYSTEM" ? "System" : "Finance user")}{event.resolutionReason ? ` · ${REASON_LABEL[event.resolutionReason] ?? humanizeCode(event.resolutionReason)}` : ""}</p>{event.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{event.note}</p>}{event.evidence != null && <div className="mt-2"><EvidenceFacts evidence={event.evidence} /></div>}</li>)}</ol>{detail.operationalHistory.length > 0 && <div className="border-t border-border pt-4"><h3 className="text-sm font-semibold">Related operational history</h3><ol className="mt-3 flex flex-col gap-2">{detail.operationalHistory.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 text-sm"><span className="break-words">{humanizeCode(event.action)} · {humanizeCode(event.targetType)}</span>{exactTime(event.createdAt)}</li>)}</ol></div>}</div> },
        { id: "corrective-paths", label: "Corrective paths", content: <div className="flex flex-col gap-3"><p className="max-w-prose text-sm text-muted-foreground">Corrections happen in the authorized operational workflow. Closing this investigation does not change the payment, refund, settlement, or enrolment.</p><div className="flex flex-wrap gap-3"><Link href={detail.links.paymentHref} className="text-sm font-semibold text-accent hover:underline">Review payment facts</Link>{detail.links.refundHref && <Link href={detail.links.refundHref} className="text-sm font-semibold text-accent hover:underline">Open refund controls</Link>}{detail.links.cohortHref && <Link href={detail.links.cohortHref} className="text-sm font-semibold text-accent hover:underline">Open cohort enrolments</Link>}</div></div> },
      ]} />
    <ResolveDialog caseId={detail.caseId} open={resolveOpen} onClose={() => setResolveOpen(false)} />
  </>;
}

function ResolveDialog({ caseId, open, onClose }: { caseId: string; open: boolean; onClose: () => void }) {
  const titleId = useId();
  const categoryRef = useRef<HTMLSelectElement>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => { if (!open) return; const previous = document.activeElement as HTMLElement | null; categoryRef.current?.focus(); return () => previous?.focus(); }, [open]);
  if (!open) return null;
  const valid = reason !== "" && note.trim() !== "";
  function submit() {
    if (!valid) { setError("Choose a resolution category and enter a case note."); return; }
    setError(null);
    startTransition(async () => {
      const result = await resolveReconciliationCaseAction({ caseId, reason: reason as typeof REASONS[number][0], note });
      if (!result.ok) { setError("Exception not resolved. Nothing in the investigation or payment record was changed."); return; }
      onClose();
      window.location.reload();
    });
  }
  return (
    <div className={DIALOG_SCRIM}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={DIALOG_PANEL}>
        <div>
          <h2 id={titleId} className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">Resolve exception</h2>
          <p className="mt-2 text-sm text-muted-foreground">This closes the investigation only. It does not change the payment, refund, settlement, or enrolment.</p>
        </div>
        {error && <div role="alert" className={NOTE_DANGER}>{error}</div>}
        <label className={FIELD}>Resolution category
          <select ref={categoryRef} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} className={CONTROL}>
            <option value="">Choose a category</option>
            {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={FIELD}>Case note
          <textarea rows={5} value={note} disabled={pending} onChange={(event) => setNote(event.target.value)} className={TEXTAREA} />
        </label>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={pending} onClick={onClose} className={BTN}>Keep exception open</button>
          <button type="button" disabled={!valid || pending} onClick={submit} className={BTN_PRIMARY}>{pending ? "Resolving…" : "Resolve exception"}</button>
        </div>
      </div>
    </div>
  );
}
