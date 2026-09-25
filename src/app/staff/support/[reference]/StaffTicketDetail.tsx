"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { DetailFacts, DetailLayout } from "@/components/primitives";
import { BTN, BTN_PRIMARY, NOTE_DANGER, NOTE_WARNING } from "@/components/primitives/controls";
import { StaffTicketTimeline, type StaffTimelineEntry } from "@/components/support/StaffTicketTimeline";
import {
  TicketActionDialog,
  type ActionAssignee,
  type ActionPayload,
  type ActionVariant,
} from "@/components/support/TicketActionDialog";
import { TicketComposer } from "@/components/support/TicketComposer";
import { TicketPriorityPill, TicketStatusPill } from "@/components/support/TicketStatusPill";
import { TicketTime, ticketCategoryLabel } from "@/components/support/ticket-labels";
import { QUEUE_OPTIONS } from "@/lib/support-queue";
import type { StaffTicketWorkspace } from "@/server/services/ticket-staff-queue-service";
import type { StaffTicketActionResult } from "../action-result";
import {
  acceptEscalationAction,
  addInternalNoteAction,
  assignTicketAction,
  changePriorityAction,
  claimTicketAction,
  escalateTicketAction,
  moveQueueAction,
  resolveTicketAction,
  sendPublicReplyAction,
} from "./actions";

const QUEUE_LABEL: Record<string, string> = Object.fromEntries(QUEUE_OPTIONS.map((o) => [o.value, o.label]));
const KIND_LABEL: Record<string, string> = {
  COURSE: "Course",
  COHORT: "Cohort",
  ORDER: "Order",
  SUBMISSION: "Submission",
  CERTIFICATE: "Certificate",
  USER: "Account",
};
const DONE_MESSAGE: Record<ActionVariant | "claim" | "accept", string> = {
  assign: "Ticket assigned.",
  reassign: "Ticket reassigned.",
  queue: "Ticket moved to the new queue.",
  priority: "Priority changed.",
  escalate: "Ticket escalated.",
  resolve: "Ticket resolved.",
  claim: "Ticket assigned to you.",
  accept: "Escalation accepted.",
};

export type StaffTicketDetailProps = {
  workspace: StaffTicketWorkspace;
  /** Presentation hint only; every action re-checks tickets.manage server-side. */
  canManage: boolean;
  assignees?: readonly ActionAssignee[];
};

function StaffContextCard({ context }: { context: NonNullable<StaffTicketWorkspace["context"]> }) {
  const type = KIND_LABEL[context.kind] ?? context.kind;
  const body = (
    <span className="min-w-0 break-words">
      {type} <span className="font-mono">{context.safeReference}</span>
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface-2 p-4">
      {context.href && !context.locked ? (
        <Link href={context.href} className="text-sm font-semibold text-accent hover:underline">{body}</Link>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm text-foreground">
            <Lock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {body}
          </p>
          <p className="text-sm text-foreground">Your role cannot open this record.</p>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Captured when this ticket was created. This reference cannot be changed.
      </p>
    </div>
  );
}

export function StaffTicketDetail({ workspace, canManage, assignees = [] }: StaffTicketDetailProps) {
  const router = useRouter();
  const [open, setOpen] = useState<{ public: boolean; internal: boolean }>({ public: false, internal: false });
  const [dialog, setDialog] = useState<ActionVariant | null>(null);
  const [direct, setDirect] = useState<"claim" | "accept" | null>(null);
  const [banner, setBanner] = useState<{ kind: "conflict" | "error"; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const opener = useRef<HTMLElement | null>(null);

  const { names } = workspace;
  const status = workspace.status;
  const closed = status === "CLOSED";
  const resolved = status === "RESOLVED";
  const live = !closed && !resolved;
  const learner = workspace.learner;
  const owner = workspace.assigneeId ? (names[workspace.assigneeId] ?? "Unknown user") : "Unassigned";
  const entries = workspace.timeline as unknown as StaffTimelineEntry[];
  const version = workspace.version;
  const reference = workspace.reference;
  const hasOwner = workspace.assigneeId !== null;

  /** Reload latest activity from the server; nothing is changed optimistically. */
  function reload() {
    startRefresh(() => router.refresh());
  }

  function settle(result: StaffTicketActionResult, doneKey: ActionVariant | "claim" | "accept") {
    if (result.ok) {
      setBanner(null);
      setAnnouncement(DONE_MESSAGE[doneKey]);
      reload();
      return;
    }
    if (result.kind === "conflict") reload();
    setBanner({ kind: result.kind === "conflict" ? "conflict" : "error", message: result.message });
  }

  async function runDirect(kind: "claim" | "accept") {
    setDirect(kind);
    setBanner(null);
    const input = { reference, expectedVersion: version };
    const result = kind === "claim" ? await claimTicketAction(input) : await acceptEscalationAction(input);
    setDirect(null);
    settle(result, kind);
  }

  async function runDialog(variant: ActionVariant, payload: ActionPayload): Promise<StaffTicketActionResult> {
    const input = { reference, expectedVersion: version };
    let result: StaffTicketActionResult;
    switch (variant) {
      case "assign":
      case "reassign":
        result = await assignTicketAction({ ...input, assigneeId: payload.assigneeId ?? "", reason: payload.reason });
        break;
      case "queue":
        result = await moveQueueAction({ ...input, queue: payload.queue as never, reason: payload.reason ?? "" });
        break;
      case "priority":
        result = await changePriorityAction({ ...input, priority: payload.priority as never, reason: payload.reason });
        break;
      case "escalate":
        result = await escalateTicketAction({ ...input, queue: payload.queue as never, assigneeId: payload.assigneeId, reason: payload.reason ?? "" });
        break;
      case "resolve":
        result = await resolveTicketAction({ ...input, reason: payload.reason ?? "" });
        break;
    }
    if (result.ok) {
      setBanner(null);
      setAnnouncement(DONE_MESSAGE[variant]);
      reload();
    } else if (result.kind === "conflict") {
      reload();
    }
    return result;
  }

  function openDialog(variant: ActionVariant, event: React.MouseEvent<HTMLElement>) {
    opener.current = event.currentTarget;
    setBanner(null);
    setDialog(variant);
  }

  function closeDialog() {
    setDialog(null);
    queueMicrotask(() => opener.current?.focus());
  }

  const actionButtons = canManage && live ? (
    <div className="flex flex-wrap gap-3" role="group" aria-label="Ticket actions">
      {status === "ESCALATED" && (
        <button type="button" disabled={direct === "accept"} onClick={() => void runDirect("accept")} className={BTN_PRIMARY}>
          {direct === "accept" ? "Accepting…" : "Accept escalation"}
        </button>
      )}
      {!hasOwner && status !== "ESCALATED" && (
        <button type="button" disabled={direct === "claim"} onClick={() => void runDirect("claim")} className={BTN_PRIMARY}>
          {direct === "claim" ? "Assigning…" : "Assign to me"}
        </button>
      )}
      {!hasOwner && (
        <button type="button" onClick={(event) => openDialog("assign", event)} className={BTN}>Assign</button>
      )}
      {hasOwner && (
        <button type="button" onClick={(event) => openDialog("reassign", event)} className={BTN}>Reassign</button>
      )}
      <button type="button" onClick={(event) => openDialog("queue", event)} className={BTN}>Move queue</button>
      <button type="button" onClick={(event) => openDialog("priority", event)} className={BTN}>Change priority</button>
      {status !== "ESCALATED" && (
        <button type="button" onClick={(event) => openDialog("escalate", event)} className={BTN}>Escalate</button>
      )}
      <button type="button" onClick={(event) => openDialog("resolve", event)} className={BTN}>Resolve ticket</button>
    </div>
  ) : null;

  const facts = [
    { label: "Learner", value: <span className="break-words [overflow-wrap:anywhere]">{learner ? `${learner.name} (${learner.email})` : "Unknown learner"}</span> },
    { label: "Category", value: ticketCategoryLabel(workspace.category) },
    { label: "Current owner", value: owner },
    { label: "Queue", value: QUEUE_LABEL[workspace.queue] ?? workspace.queue },
    { label: "Created", value: <TicketTime value={workspace.createdAt} /> },
    { label: "Last activity", value: <TicketTime value={workspace.updatedAt} /> },
    ...(workspace.resolvedAt ? [{ label: "Resolved", value: <TicketTime value={workspace.resolvedAt} /> }] : []),
    ...(workspace.closedAt ? [{ label: "Closed", value: <TicketTime value={workspace.closedAt} /> }] : []),
  ];

  const composeSection = canManage && !closed ? (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <button type="button" aria-expanded={open.public} onClick={() => setOpen((c) => ({ ...c, public: !c.public }))} className={BTN}>
          Reply to learner
        </button>
        <button type="button" aria-expanded={open.internal} onClick={() => setOpen((c) => ({ ...c, internal: !c.internal }))} className={BTN}>
          Add internal note
        </button>
      </div>
      <div hidden={!open.public}>
        <TicketComposer
          mode="public"
          recipient={learner ? { name: learner.name, email: learner.email } : undefined}
          submit={(body) => sendPublicReplyAction({ reference, expectedVersion: version, body })}
        />
      </div>
      <div hidden={!open.internal}>
        <TicketComposer
          mode="internal"
          submit={(body) => addInternalNoteAction({ reference, expectedVersion: version, body })}
        />
      </div>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">
      {closed
        ? "This ticket is closed. The chronology is read-only."
        : "Your role can read this ticket but cannot reply or add notes."}
    </p>
  );

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {banner && (
        <div role="alert" className={`${banner.kind === "conflict" ? NOTE_WARNING : NOTE_DANGER} mb-4`}>
          {banner.message}
        </div>
      )}
      <DetailLayout
        mode="stacked"
        breadcrumbs={[{ label: "Operations" }, { label: "Support", href: "/staff/support" }, { label: reference }]}
        title={workspace.subject}
        identifier={reference}
        badges={<><TicketStatusPill status={status} /><TicketPriorityPill priority={workspace.priority} /></>}
        actions={actionButtons}
        sections={[
          { id: "facts", label: "Details", content: <DetailFacts facts={facts} /> },
          ...(workspace.context ? [{ id: "context", label: "Context", content: <StaffContextCard context={workspace.context} /> }] : []),
          {
            id: "chronology",
            label: "Chronology",
            badge: entries.length,
            content: <StaffTicketTimeline entries={entries} names={names} learnerId={learner?.id ?? null} />,
          },
          { id: "compose", label: "Respond", content: composeSection },
        ]}
      />
      {dialog && (
        <TicketActionDialog
          key={dialog}
          variant={dialog}
          currentAssigneeId={workspace.assigneeId}
          currentQueue={workspace.queue}
          currentPriority={workspace.priority}
          assignees={assignees}
          refreshing={refreshing}
          submit={(payload) => runDialog(dialog, payload)}
          onClose={(outcome) => {
            if (outcome === "done") setBanner(null);
            closeDialog();
          }}
        />
      )}
    </>
  );
}
