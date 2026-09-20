"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { DetailFacts, DetailLayout, StatusPill } from "@/components/primitives";
import type { MoneyState, ReconciliationCaseDetail } from "@/server/services/reconciliation-case-service";
import { resolveReconciliationCaseAction } from "../actions";

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
  if (value.kind === "PENDING") return "â€” (pending reconciliation)";
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(value.minor / 100); }
  catch { return `${value.minor} minor units ${currency}`; }
}

function exactTime(value: Date): React.ReactNode {
  const date = new Date(value);
  return <time dateTime={date.toISOString()} className="font-mono tabular-nums">{date.toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</time>;
}

export function ReconciliationCaseDetailView({ detail }: { detail: ReconciliationCaseDetail }) {
  const [resolveOpen, setResolveOpen] = useState(false);
  const statusTone = detail.status === "RESOLVED" ? "success" : detail.status === "REOPENED" ? "warning" : "neutral";
  return <>
    <DetailLayout mode="stacked" breadcrumbs={[{ label: "Workspace", href: "/staff/reconciliation" }, { label: "Reconciliation", href: "/staff/reconciliation" }, { label: detail.caseId }]} title="Reconciliation case" identifier={detail.caseId}
      badges={<><StatusPill label={STATUS_LABEL[detail.status]} tone={statusTone} /><StatusPill label={RISK_LABEL[detail.risk]} tone={detail.risk === "CAPTURED_MONEY" ? "danger" : "warning"} /><StatusPill label={detail.provider === "PAYSTACK" ? "Paystack" : detail.provider === "STRIPE" ? "Stripe" : "Manual"} tone="neutral" /><StatusPill label={detail.currency} tone="neutral" /></>}
      sections={[
        { id: "investigation-summary", label: "Investigation summary", content: <div className="flex flex-col gap-4">{detail.status === "REOPENED" && <div role="alert" className="rounded-md border border-warning/30 bg-warning-surface px-4 py-3"><p className="text-sm font-semibold text-warning">This exception was reopened because new provider evidence no longer matches the previous resolution.</p></div>}<DetailFacts facts={[{ label: "Subject", value: detail.subject === "PAYMENT" ? "Payment" : "Refund" }, { label: "Risk", value: RISK_LABEL[detail.risk] }, { label: "Opened", value: exactTime(detail.openedAt) }, { label: "Last evidence", value: exactTime(detail.lastEvidenceAt) }, { label: "Owner", value: detail.assignment.assigneeName ?? "Unassigned" }]} />{detail.status !== "RESOLVED" && <div><button type="button" onClick={() => setResolveOpen(true)} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast">Resolve exception</button></div>}<pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-4 font-mono text-[11px]">{JSON.stringify(detail.evidence, null, 2)}</pre></div> },
        { id: "order-and-learner", label: "Order and learner", content: <DetailFacts facts={[{ label: "Order reference", value: detail.order.reference, mono: true }, { label: "Learner", value: <span className="break-words">{detail.order.learnerName}</span> }, { label: "Email", value: <span className="break-words">{detail.order.learnerEmail}</span> }, { label: "Cohort", value: detail.order.cohortTitle }, { label: "Payment state", value: detail.order.status }, { label: "Enrolment state", value: detail.order.enrolmentStates.join(", ") || "No enrolment" }, { label: "Provider", value: detail.provider }, { label: "Currency", value: detail.currency, mono: true }, { label: detail.subject === "PAYMENT" ? "Payment amount" : "Refund amount", value: money(detail.subjectAmount, detail.currency), mono: true }]} /> },
        { id: "expected-and-actual", label: "Expected and actual settlement", content: <DetailFacts facts={[{ label: "Base price", value: money(detail.amounts.base, detail.currency), mono: true }, { label: "KQ platform fee", value: money(detail.amounts.platformFee, detail.currency), mono: true }, { label: "Estimated gateway fee", value: money(detail.amounts.gatewayFeeEstimated, detail.currency), mono: true }, { label: "Learner total", value: money(detail.amounts.learnerTotal, detail.currency), mono: true }, { label: "Expected school settlement", value: money(detail.amounts.schoolSettlementExpected, detail.currency), mono: true }, { label: "Actual school settlement", value: money(detail.amounts.schoolSettlementActual, detail.currency), mono: true }, { label: "Actual gateway fee", value: money(detail.amounts.gatewayFeeActual, detail.currency), mono: true }, { label: "Actual KQ gross", value: money(detail.amounts.platformGrossActual, detail.currency), mono: true }, { label: "Actual KQ net", value: money(detail.amounts.platformNetActual, detail.currency), mono: true }]} /> },
        { id: "payment-history", label: "Evidence and payment history", content: <ol className="flex flex-col gap-3">{detail.paymentTimeline.map((entry) => <li key={`${entry.kind}-${entry.id}`} className="rounded-md border border-border bg-surface-2 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{entry.kind === "PAYMENT" ? "Payment" : "Refund"} Â· {entry.status}</p>{exactTime(entry.occurredAt)}</div><p className="mt-2 break-words font-mono text-sm">{money({ kind: "VALUE", minor: entry.amountMinor }, entry.currency)} Â· {entry.provider}</p><p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">{entry.reference ?? "No external reference"}</p>{entry.actorName && <p className="mt-1 text-sm text-muted-foreground">Recorded by {entry.actorName}</p>}</li>)}</ol> },
        { id: "investigation-history", label: "Investigation history", content: <div className="flex flex-col gap-5"><ol className="flex flex-col gap-3">{detail.caseHistory.map((event) => <li key={event.id} className="min-w-0 border-l-2 border-border pl-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{EVENT_LABEL[event.type] ?? event.type}</p>{exactTime(event.createdAt)}</div><p className="mt-1 break-words text-sm text-muted-foreground">{event.actorName ?? (event.actorType === "SYSTEM" ? "System" : "Finance user")}{event.resolutionReason ? ` Â· ${event.resolutionReason.replaceAll("_", " ")}` : ""}</p>{event.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{event.note}</p>}{event.evidence != null && <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{JSON.stringify(event.evidence, null, 2)}</pre>}</li>)}</ol>{detail.operationalHistory.length > 0 && <div className="border-t border-border pt-4"><h3 className="text-sm font-semibold">Related operational history</h3><ol className="mt-3 flex flex-col gap-2">{detail.operationalHistory.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 text-sm"><span className="break-words">{event.action} Â· {event.targetType}</span>{exactTime(event.createdAt)}</li>)}</ol></div>}</div> },
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
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"><div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-card"><h2 id={titleId} className="text-base font-semibold">Resolve exception</h2><p className="mt-2 text-sm text-muted-foreground">This closes the investigation only. It does not change the payment, refund, settlement, or enrolment.</p>{error && <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">{error}</div>}<label className="mt-4 flex flex-col gap-1 text-sm font-semibold">Resolution category<select ref={categoryRef} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} className="min-h-10 rounded-md border border-input-border bg-surface px-3 font-normal"><option value="">Choose a category</option>{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="mt-4 flex flex-col gap-1 text-sm font-semibold">Case note<textarea rows={5} value={note} disabled={pending} onChange={(event) => setNote(event.target.value)} className="rounded-md border border-input-border bg-surface px-3 py-2 font-normal" /></label><div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={!valid || pending} onClick={submit} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50">{pending ? "Resolvingâ€¦" : "Resolve exception"}</button><button type="button" disabled={pending} onClick={onClose} className="rounded-md border border-input-border px-4 py-2 text-sm font-semibold">Keep exception open</button></div></div></div>;
}
